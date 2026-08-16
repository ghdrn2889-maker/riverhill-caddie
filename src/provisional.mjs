// 가배치 감지 — "이건 참고용 배치표다"를 알아내는 유일한 단서는 사람이 남긴 말 한 마디다.
//
//  사용자 설명: "가배치가 한 번씩 올라올 때도 있는데 그건 그냥 참고용이고 본배치랑 완전히 결과가
//   달라지니까 신경쓸 필요도 없고 오히려 지금 이 시스템에서는 걸러내야 하는 정보야."
//  그리고 배치표 그림 자체에는 가배치라는 표시가 없다 — 오직 글로만 알려준다.
//
//  그래서 규칙이 뒤집힌다. 지금까지는 못 알아보면 '진짜'로 보고 조용히 덮어썼다.
//  앞으로는 예고가 살아 있는 동안 그 날짜 배치표를 '참고용'으로 세워둔다 —
//  틀려서 본배치를 늦게 반영하는 건 되돌릴 수 있지만, 가배치를 진짜로 내보내면 되돌릴 수 없다.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';

const FILE = 'provisional-notice.json';
const TTL_MS = 20 * 3600 * 1000;   // 예고는 하루를 못 넘긴다(본배치가 그 사이 반드시 온다)

// ★표기 흔들림 흡수 — PC 카톡 OCR은 '가배치'를 꾸준히 '가배지'로 읽는다(실측, 3배 확대해도 동일).
//  마지막 글자만 흔들리므로 거기만 넓게 받는다. '추가배치'는 전혀 다른 뜻이라 반드시 뺀다.
const PROVISIONAL_RE = /(?<![추증])가\s*배\s*[치지시직정]|임시\s*배\s*[치지]/;
const CONFIRMED_RE = /본\s*배\s*[치지]|확정\s*배\s*[치지]|정식\s*배\s*[치지]/;

export const looksProvisional = (t) => PROVISIONAL_RE.test(String(t || ''));
export const looksConfirmed = (t) => CONFIRMED_RE.test(String(t || ''));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// 어느 날짜의 가배치인가 — "내일 가배치입니다"가 대부분이고, 날짜를 박아 쓰기도 한다.
export function targetDateOf(text, at = Date.now()) {
  const t = String(text || '');
  const base = new Date(at);
  const md = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const y = base.getFullYear();
    const d = new Date(y, +md[1] - 1, +md[2]);
    // 연말연시 되감기: 12월 글에서 1월 날짜면 내년
    if (d.getTime() < at - 180 * 24 * 3600 * 1000) d.setFullYear(y + 1);
    return ymd(d);
  }
  if (/오늘|금일/.test(t)) return ymd(base);
  const tomorrow = new Date(base); tomorrow.setDate(tomorrow.getDate() + 1);
  return ymd(tomorrow);   // 기본값 — 가배치는 거의 언제나 '내일치'다
}

function load() {
  const all = loadJSON(FILE, {}) || {};
  const cut = Date.now() - TTL_MS;
  let dirty = false;
  for (const [k, v] of Object.entries(all)) if (!v || (v.at || 0) < cut) { delete all[k]; dirty = true; }
  if (dirty) saveJSON(FILE, all);
  return all;
}

// 글에서 가배치 예고를 발견하면 기록한다. 카페 글·카톡 메시지 어느 쪽이든 같은 입구를 쓴다.
export function noteFromText(text, { source = '', at = Date.now(), id = '' } = {}) {
  const t = String(text || '');
  if (!looksProvisional(t)) return null;
  const date = targetDateOf(t, at);
  const all = load();
  const prev = all[date];
  all[date] = { date, at, source, id, text: t.slice(0, 120), hits: (prev?.hits || 0) + 1 };
  saveJSON(FILE, all);
  console.log(`⚠️ [가배치] ${date} 예고 감지(${source}) — 그 날짜 배치표는 참고용으로 둡니다: "${t.slice(0, 40)}"`);
  appendJSONL('provisional.jsonl', { at, kind: 'notice', date, source, id, text: t.slice(0, 200) });
  return all[date];
}

// 본배치가 왔다고 사람이 알려주면 예고를 푼다.
export function clearFor(date, why = '') {
  const all = load();
  if (!all[date]) return false;
  delete all[date];
  saveJSON(FILE, all);
  console.log(`·  [가배치] ${date} 예고 해제(${why})`);
  appendJSONL('provisional.jsonl', { at: Date.now(), kind: 'clear', date, why });
  return true;
}

export const noticeFor = (date) => load()[String(date)] || null;
export const allNotices = () => load();

// 배치표 날짜표기("2026년 08월 16일 일요일") → YYYYMMDD
export function dateKeyOfLabel(label) {
  const m = String(label || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}${pad(m[2])}${pad(m[3])}` : '';
}

// 이 배치표를 정본으로 받아들여도 되나?
//  ★그림만으로는 절대 알 수 없다(가배치표에 아무 표시가 없다) — 예고가 살아 있으면 보류한다.
//
//  ★풀어주는 규칙: 예고 하나당 배치표 '한 장'만 붙잡는다.
//   가배치 뒤엔 반드시 본배치가 온다. 그러니 같은 날짜의 '다음' 배치표는 본배치로 본다.
//   이게 없으면 본배치가 "본배치입니다"라고 안 적고 올라올 때 20시간을 통째로 굶는다 —
//   가배치를 내보내는 것도 나쁘지만, 본배치를 못 내보내는 건 더 나쁘다.
export function boardIsProvisional(dateLabel, articleText = '', boardId = '') {
  const date = dateKeyOfLabel(dateLabel);
  if (!date) return null;
  if (looksConfirmed(articleText)) { clearFor(date, '본배치 명시'); return null; }
  const n = noticeFor(date);
  if (!n) return null;
  if (n.heldId && boardId && n.heldId !== boardId) {   // 이미 한 장 붙잡았는데 다른 배치표가 왔다 = 본배치
    clearFor(date, `다음 배치표 도착(#${boardId})`);
    return null;
  }
  if (!n.heldId && boardId) {                          // 이번 장을 붙잡는다
    const all = load();
    if (all[date]) { all[date].heldId = boardId; saveJSON(FILE, all); }
  }
  appendJSONL('provisional.jsonl', { at: Date.now(), kind: 'hold', date, boardId, notice: n.text });
  return n;
}
