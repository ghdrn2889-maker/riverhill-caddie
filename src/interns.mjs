// ── 인턴 티오프 — 자동 판독 + 관리자 수동 지정 ──────────────────────────────
//
//  왜 필요한가: 인턴 캐디는 티오프 칸을 차지하되 '정규 순번을 소비하지 않는다'(노란 칸).
//   카카오골프는 그 칸이 찼다는 것만 알지 인턴인지 정규인지 영원히 모른다 — 인턴 여부는
//   배치표에만 있다. 빼지 않으면 인턴 하나당 그 뒤 전원의 티오프가 한 칸씩 밀린다.
//   그리고 인턴은 그날그날 섭외돼 중간에 끼기 때문에, 밀림이 꼬리가 아니라 중간부터 시작된다.
//
//  ★수동이 이긴다. 판독(노란 칸)이 놓치거나 잘못 잡을 수 있고, 그때 관리자는 원본을 보고 있다.
//   대신 '언제·무엇을 바꿨는지'를 남겨 자동이 조용히 되돌리지 못하게 한다.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';

const FILE = 'intern-tees.json';
const TTL_MS = 45 * 24 * 3600 * 1000;      // 45일 롤링(라운드 점검과 같은 보관 기준)

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : NaN; };
const toHM = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
// ★시각 키는 분으로 환산해 재조립 — 1부 판독은 "6:23", 카카오는 "06:23"을 쓴다(실측 8/17).
export const normTee = (time, course) => {
  const m = toMin(time);
  return Number.isFinite(m) ? { time: toHM(m), course: /IN/i.test(course) ? 'IN' : 'OUT' } : null;
};
export const teeKey = (t) => `${t.time}|${t.course}`;
export const dateKey = (d) => String(d || '').replace(/\D/g, '').slice(0, 8);
// ★키는 날짜'와 부'다. 예전엔 날짜뿐이라 3부에 지정한 인턴이 1·2부 계산에도 그대로 실려 갔다
//  (실측 2026-08-23: 3부 17:14 OUT이 1부·2부 카카오 계산에 들어감). 부 창이 안 겹쳐서 무해했을 뿐이다.
//  인턴은 그 부의 티오프표에 있는 칸이다 — 날짜만으로는 어느 표를 말하는지 정할 수 없다.
export const partKey = (d, part = '3') => {
  const k = dateKey(d);
  return k ? `${k}:${String(part || '3')}` : '';
};

function load() {
  const all = loadJSON(FILE, {}) || {};
  const cut = Date.now() - TTL_MS;
  let dirty = false;
  // 옛 기록(날짜만인 키)은 3부 것이다 — 그때는 3부만 인턴을 다뤘다. 읽을 때 한 번 옮긴다.
  for (const k of Object.keys(all)) {
    if (!/^\d{8}$/.test(k)) continue;
    const nk = `${k}:3`;
    if (!all[nk]) all[nk] = { ...all[k], part: '3' };
    delete all[k]; dirty = true;
  }
  for (const [k, v] of Object.entries(all)) if (!v || (v.at || 0) < cut) { delete all[k]; dirty = true; }
  if (dirty) saveJSON(FILE, all);
  return all;
}

// 관리자가 지정한 인턴 칸(그 날짜의 '전부'). 없으면 null — 자동 판독을 쓰라는 뜻.
export function manualFor(date, part = '3') {
  const k = partKey(date, part);
  return k ? (load()[k] || null) : null;
}

// 그 날짜에 실제로 쓸 인턴 칸. 수동이 있으면 수동이 전부다(자동은 무시).
//  ★합집합을 안 쓰는 이유: 관리자가 '자동이 잘못 잡은 칸을 뺀' 경우를 표현할 수 없다.
//   자동이 노란 칸을 오검출했을 때 그걸 못 지우면 수동 편집이 반쪽이 된다.
export function internTeesFor(date, autoTees = [], part = '3') {
  const man = manualFor(date, part);
  if (man && Array.isArray(man.tees)) return man.tees.map((t) => ({ ...t, _manual: true }));
  return (autoTees || []).map((t) => normTee(t.time, t.course)).filter(Boolean);
}

// 관리자 저장 — 그 날짜의 인턴 칸을 통째로 교체한다(빈 배열 = '인턴 없음'을 명시).
export function setManual(date, tees, { by = '', note = '', part = '3' } = {}) {
  const k = partKey(date, part);
  if (!k) throw new Error('날짜가 필요합니다(YYYYMMDD)');
  const clean = [];
  const seen = new Set();
  for (const t of (tees || [])) {
    const n = normTee(t?.time, t?.course);
    if (!n) continue;
    const key = teeKey(n);
    if (seen.has(key)) continue;         // 같은 칸 두 번 = 무시(멱등)
    seen.add(key);
    clean.push(n);
  }
  clean.sort((a, b) => toMin(a.time) - toMin(b.time) || (a.course === 'OUT' ? -1 : 1));
  const all = load();
  const prev = all[k];
  all[k] = { date: dateKey(date), part: String(part || '3'), tees: clean, at: Date.now(), by: String(by || '').slice(0, 40), note: String(note || '').slice(0, 120) };
  saveJSON(FILE, all);
  const before = (prev?.tees || []).map(teeKey).join(' ') || '(없음)';
  console.log(`[인턴] ${dateKey(date)} ${part}부 수동 지정 ${clean.length}칸: ${clean.map(teeKey).join(' ') || '(없음)'} (이전 ${before})`);
  appendJSONL('intern-tees.jsonl', { at: Date.now(), date: dateKey(date), part: String(part || '3'), tees: clean.map(teeKey), prev: (prev?.tees || []).map(teeKey), by, note });
  return all[k];
}

// 수동 지정 해제 → 다시 자동 판독을 따른다.
export function clearManual(date, by = '', part = '3') {
  const k = partKey(date, part);
  const all = load();
  if (!all[k]) return false;
  const prev = all[k];
  delete all[k];
  saveJSON(FILE, all);
  console.log(`[인턴] ${dateKey(date)} ${part}부 수동 지정 해제 — 자동 판독을 따릅니다(이전 ${(prev.tees || []).length}칸)`);
  appendJSONL('intern-tees.jsonl', { at: Date.now(), date: dateKey(date), part: String(part || '3'), kind: 'clear', prev: (prev.tees || []).map(teeKey), by });
  return true;
}

// 칸 하나 켜고 끄기 — 화면에서 칸을 눌러 바꾸는 경로. 현재 상태(자동 포함)에서 시작한다.
export function toggle(date, time, course, autoTees = [], { by = '', part = '3' } = {}) {
  const n = normTee(time, course);
  if (!n) throw new Error('시각·코스가 올바르지 않습니다');
  const cur = internTeesFor(date, autoTees, part).map((t) => ({ time: t.time, course: t.course }));
  const key = teeKey(n);
  const has = cur.some((t) => teeKey(t) === key);
  const next = has ? cur.filter((t) => teeKey(t) !== key) : [...cur, n];
  const rec = setManual(date, next, { by, part, note: has ? `${key} 해제` : `${key} 지정` });
  return { ...rec, toggled: key, on: !has };
}

export const allManual = () => load();
