// 카페를 주기적으로 감시 → 새 글 감지 → 분석기로 판단 → onMatch 콜백 호출.
// 쿠키 만료 등으로 감시가 조용히 멈추면 onCafeError 로 알린다.
import { fetchLatestArticles } from './naverCafe.mjs';
import { analyze } from './analyzer.mjs';
import { loadJSON, saveJSON } from './store.mjs';

const SEEN_FILE = 'seen.json';
const MAX_SEEN = 800;

export function startCrawler({ onMatch, onCafeError }) {
  const intervalMs = Number(process.env.POLL_INTERVAL_MS || 90000);
  const seen = new Set(loadJSON(SEEN_FILE, []));
  let baseline = seen.size === 0; // 첫 실행이면 기존 글은 기준선으로만 삼고 알림 X
  let failStreak = 0;
  let notifiedError = false;

  async function tick() {
    let articles;
    try {
      articles = await fetchLatestArticles(20);
    } catch (e) {
      // 쿠키 만료/차단 가능성 — 2회 연속 실패 시 1번만 알림
      failStreak += 1;
      console.error(`[크롤러] 조회 실패(${failStreak}): ${e.message}`);
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
    for (const a of articles) seen.add(a.id);
    saveJSON(SEEN_FILE, [...seen].slice(-MAX_SEEN));

    if (baseline) {
      baseline = false;
      console.log(`[기준선] 현재 글 ${articles.length}건 기록. 지금부터 새 글만 알립니다.`);
      return;
    }

    for (const a of fresh.reverse()) { // 오래된 것부터
      const result = analyze(a);
      const who = [a.writer, a.writeDate].filter(Boolean).join(' · ');
      if (result.relevant) {
        console.log(`🔔 [${result.priority}] ${a.subject}  (${result.hits.join(', ')})  — ${who}`);
        try { await onMatch(a, result); } catch (e) { console.error('onMatch 오류:', e.message); }
      } else {
        console.log(`·  (무관) ${a.subject}  — ${who}`);
      }
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  console.log(`👀 감시 시작: ${intervalMs / 1000}초 간격`);
  return () => clearInterval(timer);
}
