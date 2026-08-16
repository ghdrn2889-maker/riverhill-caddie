// 카페를 주기적으로 감시 → 새 글 감지 → 분석기로 판단 → onMatch 콜백 호출.
// 쿠키 만료 등으로 감시가 조용히 멈추면 onCafeError 로 알린다.
import { fetchLatestArticles } from './naverCafe.mjs';
import { analyze } from './analyzer.mjs';
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';
import { notePending, clearPending, keyFromLabel } from './boardpending.mjs';

const SEEN_FILE = 'seen.json';
const MAX_SEEN = 800;

const MAX_BOARD_RETRIES = Number(process.env.BOARD_READ_RETRIES ?? 6);

export function startCrawler({ onMatch, onComment, onCafeError }) {
  const seen = new Set(loadJSON(SEEN_FILE, []));
  const boardRetries = loadJSON('board-retries.json', {}); // {id: 재시도횟수} — 판독 실패한 배치표를 다음 폴링에 재시도
  const commentCounts = loadJSON('commentcounts.json', {}); // 글별 최근 댓글 수(댓글 변동 감지용)
  const CH = process.env.CHANGE_MENU_ID || '13';
  const SC = process.env.SCHEDULE_MENU_ID || '2';
  const isSched = (a) => String(a.menuId) === CH || String(a.menuId) === SC;
  let baseline = seen.size === 0; // 첫 실행이면 기존 글은 기준선으로만 삼고 알림 X
  let failStreak = 0;
  let notifiedError = false;

  async function tick() {
    let articles;
    try {
      articles = await fetchLatestArticles(Number(process.env.FETCH_PER_PAGE ?? 40)); // 근태 신청 폭주 시 배치표가 밀려나지 않게 넉넉히
    } catch (e) {
      // 쿠키 만료/차단 가능성 — 2회 연속 실패 시 1번만 알림
      failStreak += 1;
      console.error(`[크롤러] 조회 실패(${failStreak}): ${e.message}`);
      saveJSON('health.json', { ...loadJSON('health.json', {}), lastPollAt: Date.now(), failStreak, lastError: e.message });
      if (failStreak >= 2 && !notifiedError) {
        notifiedError = true;
        try { await onCafeError?.(e); } catch {}
      }
      return;
    }
    // 정상 복구
    if (failStreak > 0) console.log('[크롤러] 정상 복구됨');
    failStreak = 0;
    notifiedError = false;

    const fresh = articles.filter((a) => !seen.has(a.id));
    // heartbeat: 감시가 살아있음을 기록(앱이 /api/health 로 확인).
    saveJSON('health.json', { lastPollAt: Date.now(), lastOkAt: Date.now(), fresh: fresh.length, failStreak: 0, lastError: null });

    // ★seen 기록은 '글 처리 성공 후에만' 한다 — 판독(Gemini) 도중 재시작/크래시로 죽어도 그 글이
    //  유실되지 않고 다음 폴링에서 자동 재처리된다. (처리 '전에' seen 기록하던 옛 방식은 배치표 판독 중
    //  프로세스가 재시작되면 그 배치표를 영구히 놓쳐 시스템이 옛 배치표에 동결되는 버그가 있었다.)
    const markSeen = (id) => { seen.add(id); saveJSON(SEEN_FILE, [...seen].slice(-MAX_SEEN)); };

    if (baseline) {
      baseline = false;
      for (const a of articles) seen.add(a.id);
      saveJSON(SEEN_FILE, [...seen].slice(-MAX_SEEN));
      console.log(`[기준선] 현재 글 ${articles.length}건 기록. 지금부터 새 글만 알립니다.`);
      return;
    }

    const staleMs = Number(process.env.STALE_HOURS ?? 24) * 3600 * 1000;
    for (const a of fresh.reverse()) { // 오래된 것부터
      // 하루 지난 글은 알림 제외(어제 소식이 되살아나지 않게).
      if (a.ts && Date.now() - a.ts > staleMs) {
        console.log(`·  (오래된 글, 알림 제외) ${a.subject}`);
        markSeen(a.id);
        continue;
      }
      const result = analyze(a);
      const who = [a.writer, a.writeDate].filter(Boolean).join(' · ');
      if (result.relevant) {
        console.log(`🔔 [${result.priority}] ${a.subject}  (${result.hits.join(', ')})  — ${who}`);
        // ★처리(onMatch)가 성공해야 seen 기록. 실패·재시작 시 seen에 안 남아 다음 폴링에서 재시도된다.
        //  ★근본 수정: '배치표인데 티오프표를 못 읽은' 판독 실패(boardReadFailed)면 seen 을 찍지 않고 재시도한다.
        //   (기존엔 판독 실패해도 onMatch가 throw만 안 하면 seen 확정 → 새 배치표가 영구 미반영되던 재발 버그.)
        try {
          const r = await onMatch(a, result);
          // ★대기표 — '봤는데 반영이 안 됐다'를 기록한다. seen 처리와 무관하게 남아서,
          //  끝점 검사(boardpending.checkPending)가 유예시간 뒤 관리자 폰으로 보낸다.
          //  2026-08-16 사고의 핵심: 여기서 로그만 남기고 넘어가면 아무도 모른다. 사흘을 몰랐다.
          if (r && r.boardReadFailed) {
            try { notePending({ articleId: a.id, subject: a.subject, dateKey: keyFromLabel(r.dateLabel || a.subject), reason: r.boardReadReason || '' }); }
            catch (e) { console.error('[대기표] 기록 실패:', e.message); }
          } else if (r && r.rawVerdict) {
            try { clearPending(a.id, '판독 성공'); } catch { /* noop */ }
          }
          if (r && r.boardReadFailed && (boardRetries[a.id] || 0) < MAX_BOARD_RETRIES) {
            boardRetries[a.id] = (boardRetries[a.id] || 0) + 1;
            saveJSON('board-retries.json', boardRetries);
            console.warn(`⏳ 배치표 판독 실패 → seen 미기록, 다음 폴링 재시도 (${boardRetries[a.id]}/${MAX_BOARD_RETRIES}): ${a.subject}`);
          } else {
            if (boardRetries[a.id]) { delete boardRetries[a.id]; saveJSON('board-retries.json', boardRetries); }
            if (r && r.boardReadFailed) {
              // ★재시도 소진 = 최신 배치표를 못 읽고 옛 배치표에 동결될 위험.
              //  seen 은 찍는다(안 찍으면 매 폴링마다 같은 글을 다시 판독해 예산을 태운다 —
              //  8/16에 한 글을 13번 다시 읽어 캡 150을 소진시킨 게 정확히 그 모양이었다).
              //  대신 대기표에 남아 있으므로 끝점 검사가 반드시 관리자를 부른다. 포기가 아니라 인계다.
              console.warn(`⚠️ 배치표 판독 재시도 ${MAX_BOARD_RETRIES}회 소진 — seen 처리(대기표에 남김, 관리자 알림 예정): ${a.subject}`);
              appendJSONL('dayboard-anomaly.jsonl', { at: Date.now(), kind: 'board_read_exhausted', articleId: String(a.id), subject: String(a.subject || ''), retries: MAX_BOARD_RETRIES, note: '최신 배치표 판독 반복 실패 — 옛 배치표 동결 위험, 관리자 확인 필요' });
            }
            markSeen(a.id);
          }
        }
        catch (e) { console.error(`onMatch 오류(seen 미기록 → 다음 폴링 재시도): ${e.message}`); }
      } else {
        console.log(`·  (무관) ${a.subject}  — ${who}`);
        markSeen(a.id);
      }
    }

    // 댓글 감시: 일정 게시판(번호표/배치표) 글에 새 댓글이 달리면(변동이 댓글로도 옴) 처리.
    for (const a of articles) {
      const prev = commentCounts[a.id];
      const now = a.commentCount || 0;
      if (isSched(a) && prev != null && now > prev) {
        console.log(`💬 새 댓글 ${now - prev}개: ${a.subject}`);
        try { await onComment?.(a, prev, now); } catch (e) { console.error('onComment 오류:', e.message); }
      }
      commentCounts[a.id] = now;
    }
    // 오래된 항목 정리(목록 밖 글은 제거).
    const live = new Set(articles.map((a) => a.id));
    for (const k of Object.keys(commentCounts)) if (!live.has(k)) delete commentCounts[k];
    saveJSON('commentcounts.json', commentCounts);
  }

  // 적응형 폴링: 3부 활성 시간대(기본 12~24시)엔 자주, 그 외엔 뜸하게.
  function nextDelayMs() {
    if (process.env.POLL_INTERVAL_MS) return Number(process.env.POLL_INTERVAL_MS); // 고정값 지정시 우선
    const h = new Date().getHours();
    const aStart = Number(process.env.ACTIVE_START_HOUR ?? 12);
    const aEnd = Number(process.env.ACTIVE_END_HOUR ?? 24);
    const active = h >= aStart && h < aEnd;
    return Number(active ? (process.env.ACTIVE_POLL_MS ?? 45000) : (process.env.IDLE_POLL_MS ?? 120000));
  }

  let stopped = false, timer = null;
  async function loop() {
    if (stopped) return;
    try { await tick(); } catch (e) { console.error('[크롤러] tick 오류:', e.message); }
    if (!stopped) timer = setTimeout(loop, nextDelayMs());
  }
  loop();
  console.log(`👀 감시 시작: 활성 ${Number(process.env.ACTIVE_POLL_MS ?? 45000) / 1000}s / 대기 ${Number(process.env.IDLE_POLL_MS ?? 120000) / 1000}s (활성 ${process.env.ACTIVE_START_HOUR ?? 12}~${process.env.ACTIVE_END_HOUR ?? 24}시)`);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
