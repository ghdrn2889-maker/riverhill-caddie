// ── 미판독 배치표 대기표 + 끝점 검사 ─────────────────────────────────────
//
//  ★왜 만드나 (2026-08-16 사고):
//   그날 8/17 배치표가 카페에 올라왔고, 시스템은 6번 판독을 시도해 6번 다 실패했고,
//   실패했다는 걸 로그에 정확히 적었고, 그리고 seen 처리하고 넘어갔다. 아무도 몰랐다.
//   사흘 동안 같은 일이 반복됐는데 관리자가 화를 낼 때까지 아무도 몰랐다.
//
//   부분마다 가드는 많았다. 캡·재시도·중복차단·심각부족 게이트. 전부 '멈추고, 성공한 척하고,
//   사람에게 안 알리는' 모양이었다. 정작 끝에서 "그래서 내일 배치표가 회원에게 갔나?"를
//   묻는 곳이 하나도 없었다. 가드를 더 만드는 게 답이 아니라, 결과를 확인하는 곳이 답이다.
//
//  ★규칙 하나: 배치표를 봤는데 반영이 안 됐으면, 그건 반드시 사람에게 간다.
//   판독기가 왜 실패했는지는 몰라도 된다. '봤다'와 '반영됐다'가 어긋난 사실만으로 충분하다.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';
import { raiseBoardIssue } from './boardalert.mjs';

const FILE = 'board-pending.json';
const TTL_MS = 30 * 3600 * 1000;          // 하루 넘게 묵은 대기표는 의미 없다(그 날은 이미 지났다)
const GRACE_MS = 12 * 60 * 1000;          // 판독은 몇 분 걸린다 — 이 시간은 봐준다(폴링 45s × 재시도 6회 여유)

const pad = (n) => String(n).padStart(2, '0');
export const dateKeyOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// "2026년 08월 17일 월요일" / "8월 17일" → YYYYMMDD. 연도 없으면 오늘 기준으로 채운다.
export function keyFromLabel(label, at = Date.now()) {
  const t = String(label || '');
  const full = t.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (full) return `${full[1]}${pad(full[2])}${pad(full[3])}`;
  const md = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!md) return '';
  const base = new Date(at);
  const d = new Date(base.getFullYear(), +md[1] - 1, +md[2]);
  // 연말연시 되감기 — 12월 글에 1월 날짜면 내년이다.
  if (d.getTime() < at - 180 * 24 * 3600 * 1000) d.setFullYear(base.getFullYear() + 1);
  return dateKeyOf(d);
}

function load() {
  const all = loadJSON(FILE, {}) || {};
  const cut = Date.now() - TTL_MS;
  let dirty = false;
  for (const [k, v] of Object.entries(all)) if (!v || (v.at || 0) < cut) { delete all[k]; dirty = true; }
  if (dirty) saveJSON(FILE, all);
  return all;
}

// 배치표를 봤는데 반영이 안 됐다 — 대기표에 올린다. 같은 글이면 시도횟수만 올린다.
export function notePending({ articleId, subject = '', dateKey = '', reason = '' }) {
  const id = String(articleId || '');
  if (!id) return null;
  const all = load();
  const prev = all[id];
  all[id] = {
    articleId: id, subject: String(subject).slice(0, 120), dateKey: String(dateKey || ''),
    reason: String(reason || '').slice(0, 200),
    firstAt: prev?.firstAt || Date.now(), at: Date.now(),
    tries: (prev?.tries || 0) + 1, alerted: prev?.alerted || false,
  };
  saveJSON(FILE, all);
  return all[id];
}

// 반영됐다 — 대기표에서 내린다.
export function clearPending(articleId, why = '') {
  const id = String(articleId || '');
  const all = load();
  if (!all[id]) return false;
  delete all[id];
  saveJSON(FILE, all);
  console.log(`·  [대기표] #${id} 해제(${why})`);
  appendJSONL('board-pending.jsonl', { at: Date.now(), kind: 'clear', articleId: id, why });
  return true;
}

// 그 날짜가 반영됐으면 그 날짜의 대기표를 전부 내린다(글 번호가 달라도 목적은 이뤄졌다).
export function clearPendingForDate(dateKey, why = '') {
  const k = String(dateKey || '');
  if (!k) return 0;
  const all = load();
  let n = 0;
  for (const [id, v] of Object.entries(all)) if (v.dateKey === k) { delete all[id]; n++; }
  if (n) {
    saveJSON(FILE, all);
    console.log(`·  [대기표] ${k} 반영 확인 → ${n}건 해제(${why})`);
    appendJSONL('board-pending.jsonl', { at: Date.now(), kind: 'clear_date', dateKey: k, count: n, why });
  }
  return n;
}

export const allPending = () => Object.values(load());

// ── 끝점 검사 ──────────────────────────────────────────────────────────
//  "봤는데 아직 반영이 안 된 배치표"가 유예시간을 넘겼으면 관리자 폰으로 보낸다.
//  ★한 글당 한 번만 울린다(alerted 플래그) — 5분마다 도는 검사라 이게 없으면 알림 폭풍.
//   단, 실패가 계속되면 tries가 늘고, 그건 이미 첫 알림에 담긴 사실이라 다시 울릴 필요가 없다.
//
//  reflectedKeys: 지금 시스템이 실제로 들고 있는 배치표 날짜들(lastboard·부별 store에서 뽑아 넘긴다).
//   여기 들어 있으면 목적이 이뤄진 것이므로 조용히 내린다.
export async function checkPending(reflectedKeys = []) {
  const have = new Set((reflectedKeys || []).filter(Boolean).map(String));
  const all = load();
  const now = Date.now();
  let alerted = 0;
  for (const [id, v] of Object.entries(all)) {
    if (v.dateKey && have.has(v.dateKey)) { clearPending(id, '반영 확인'); continue; }
    if (v.alerted) continue;
    if (now - (v.firstAt || v.at || now) < GRACE_MS) continue;   // 아직 판독 중일 수 있다
    const waited = Math.round((now - (v.firstAt || now)) / 60000);
    await raiseBoardIssue({
      kind: 'board_not_reflected', part: 3, articleId: id,
      note: `${v.subject || '배치표'} — 올라온 지 ${waited}분, 판독 ${v.tries}회 시도했지만 아직 반영 안 됨`
        + `${v.reason ? ` (${v.reason})` : ''}. 모니터에서 사진을 직접 올려 판독시켜 주세요.`,
    });
    const fresh = load();
    if (fresh[id]) { fresh[id].alerted = true; saveJSON(FILE, fresh); }
    appendJSONL('board-pending.jsonl', { at: now, kind: 'alert', articleId: id, dateKey: v.dateKey, tries: v.tries, waitedMin: waited });
    alerted++;
  }
  return { pending: Object.keys(load()).length, alerted };
}
