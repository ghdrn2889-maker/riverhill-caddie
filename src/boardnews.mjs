// ══ 새 배치 소식 — 관리자에게만 ════════════════════════════════════
//  카페에 배치 관련 글이 뜨면, 앱이 그 글을 읽고 난 뒤 관리자 폰으로 한 번 알린다.
//
//  ★왜 '읽고 난 뒤'인가.
//   글이 떴다는 사실만으로는 할 일이 없다. 관리자가 알아야 하는 것은
//   "앱이 이걸 어떻게 읽었나"다 — 그래야 맞으면 그냥 두고, 틀리면 고치러 간다.
//   그래서 알림 글 안에 앱이 읽은 커트·티오프를 그대로 적는다.
//   알림만 보고 '맞다'가 서면 아무것도 안 열어도 된다.
//
//  ★회원에게는 안 간다(운영 통로 broadcastOps). 회원은 원래대로 제 근무 알림만 받는다.
//  ★밤에도 간다 — 3부 배치표는 밤에 올라오고, 틀린 것은 회원이 보기 전에 고쳐야 한다.
//
//  ★한 글에 한 번. 다만 '못 읽음'으로 한 번 알린 글을 나중에 읽어 내면 그때 한 번 더 알린다 —
//   크롤러가 실패한 글을 몇 번 다시 시도하는데, 처음 실패만 알리고 끝나면 성공을 모른다.
import { loadJSON, saveJSON } from './store.mjs';
import { broadcastOps } from './push.mjs';
import { looksLikeBoardPost } from './analyzer.mjs';

const SEEN_FILE = 'board-news-seen.json';
const KEEP_MS = 14 * 24 * 3600 * 1000;           // 두 주 지난 표시는 걷는다(파일이 끝없이 크지 않게)

function loadSeen() {
  const o = loadJSON(SEEN_FILE, {});
  return (o && typeof o === 'object') ? o : {};
}
function saveSeen(m) {
  const now = Date.now();
  for (const k of Object.keys(m)) if (!m[k] || now - (m[k].at || 0) > KEEP_MS) delete m[k];
  saveJSON(SEEN_FILE, m);
}

// '2026년 09월 15일' → '9월 15일'
function shortDate(label) {
  const m = String(label || '').match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : '';
}

// 한 부를 한 줄로 — '3부 커트 16번 임태희 · 15:40~17:28'
function partLine(p, v) {
  if (!v) return '';
  const cut = Number(v.cutoffPosition || v.cutLine) || 0;
  const who = String(v.cutoffName || '').trim();
  const tees = (Array.isArray(v.teeGrid) ? v.teeGrid : []).map((t) => t && t.time).filter(Boolean);
  const span = tees.length ? (tees.length > 1 ? `${tees[0]}~${tees[tees.length - 1]}` : tees[0]) : '';
  const head = cut ? `${p}부 커트 ${cut}번${who ? ` ${who}` : ''}` : `${p}부`;
  return [head, span].filter(Boolean).join(' · ');
}

// 이 글에서 앱이 실제로 받아 둔 것만 모은다.
//  ★다른 글이 남긴 판을 섞지 않는다 — 글 번호가 같은 것만 '이번에 읽은 것'이다.
export function readSummary(articleId) {
  const id = String(articleId || '');
  const lines = [];
  let date = '';
  try {
    const st = loadJSON('board-parts-store.json', null);
    if (st && String(st.articleId || '') === id) {
      date = date || shortDate(st.dateLabel);
      for (const p of ['1', '2']) {
        const l = partLine(p, (st.parts || {})[p]);
        if (l) lines.push(l);
      }
    }
  } catch { /* 없으면 없는 대로 */ }
  try {
    const lb = loadJSON('lastboard.json', null);
    if (lb && String(lb.id || '') === id && lb.rawVerdict) {
      date = date || shortDate(lb.rawVerdict.dateLabel || lb.dateLabel);
      const l = partLine('3', lb.rawVerdict);
      if (l) lines.push(l);
    }
  } catch { /* 없으면 없는 대로 */ }
  return { date, lines };
}

// 알림 한 건을 짓는다 — 보내지는 않는다(시험이 이걸 따로 본다).
//  kind: 'new'(새 글) · 'revised'(같은 글 사진이 바뀜)
//  r   : notifyForArticle 이 돌려준 것
export function compose(full, r, kind = 'new', summary = null) {
  const subj = String((full && full.subject) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const writer = String((full && full.writer) || '').trim();
  const src = `${writer ? writer + ' ' : ''}「${subj || '제목 없음'}」`;
  const hasImg = !!(full && full.images && full.images.length);
  const sum = summary || readSummary(full && full.id);
  const verb = kind === 'revised' ? '배치표 수정' : (hasImg ? '새 배치표' : '새 배치 소식');

  // 읽다가 막혔다 — 크롤러가 다시 시도한다
  if (r && r.boardReadFailed) {
    return { title: `${verb} — 아직 못 읽었습니다`,
      body: `${r.boardReadReason || '판독 불완전'} · 다시 시도하고 있습니다\n${src}` };
  }
  // 판독을 꺼 둔 상태 — 글이 왔다는 것만 안다
  if (!r || (typeof r === 'object' && !Object.keys(r).length)) {
    return { title: verb, body: `앱은 이 글을 읽지 않았습니다(판독 꺼짐)\n${src}` };
  }
  if (sum.lines.length) {
    return { title: `${verb}${sum.date ? ` — ${sum.date}` : ''}`,
      body: `${sum.lines.join('\n')}\n${src}` };
  }
  // 글로만 온 소식(커트 공지·당일 추가 등) — 제목이 곧 내용이다
  return { title: verb, body: src };
}

// 배치 소식인가 — 글 자체를 보고 정한다.
//  ★앱이 돌려준 relevant 를 쓰면 안 된다. 그건 '1번 회원(3부) 기준'의 답이라서
//   "2부 40팀 배문숙님까지 근무됩니다" 같은 1·2부 커트 공지가 무관으로 나온다(실측 #29426).
//  ★개인 신청은 뺀다 — "10월 28일 정용만 프리조출 신청합니다", "문태익(12월23,24,25)".
//   같은 게시판에 올라와도 배치가 바뀐 소식이 아니다. 관리자 폰이 하루 열 번 울리면 안 본다.
export function isBoardNews(full) {
  const subj = String((full && full.subject) || '');
  if (/신청/.test(subj)) return false;
  if (looksLikeBoardPost(full)) return true;                     // 배치표 사진
  return /님\s*까지|\d+\s*팀|캔슬|취소|추가|당추|티오프|배치|시간표|번호표|업데이트|변경/.test(subj);
}

// 이 글로 지금 울릴까 — 보내는 일과 떼어 둔다(시험이 이것만 따로 본다).
export function shouldAlert(seen, key, r, full = null) {
  if (full && !isBoardNews(full)) return { go: false, why: '배치 소식 아님' };
  if (r && r.adminOnly) return { go: false, why: '못 읽은 글 알림이 이미 감' }; // 같은 글로 두 번 울리지 않게
  const state = r && r.boardReadFailed ? 'fail' : 'ok';
  const was = seen && seen[key] && seen[key].state;
  if (was === 'ok') return { go: false, why: '이미 알림' };
  if (was === 'fail' && state === 'fail') return { go: false, why: '실패는 한 번만' };
  return { go: true, state };
}

// 보낸다. 같은 글은 한 번만 — 단, 못 읽었다가 읽어 내면 한 번 더.
export async function alertBoardNews(full, r, kind = 'new', extraKey = '') {
  try {
    if (!full || !full.id) return { sent: false, why: '글 번호 없음' };
    const key = `${kind}:${full.id}${extraKey ? ':' + extraKey : ''}`;
    const seen = loadSeen();
    const d = shouldAlert(seen, key, r, full);
    if (!d.go) return { sent: false, why: d.why };
    const state = d.state;
    const msg = compose(full, r, kind);
    seen[key] = { state, at: Date.now() };
    saveSeen(seen);
    await broadcastOps({ title: msg.title, body: msg.body, url: '/', level: 'check', bypassQuiet: true });
    return { sent: true, ...msg };
  } catch (e) {
    console.error('[새 배치 소식] 관리자 알림 오류:', e.message);
    return { sent: false, why: e.message };
  }
}
