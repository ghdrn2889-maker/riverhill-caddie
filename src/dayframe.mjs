// 하루치 운영 선언 — 그날 그 부가 '몇 시부터 몇 시까지, 몇 코스로' 도는가.
//
//  ★왜 필요한가: 기준표(riverhill-tee-schedule.json)는 '기본틀'이지 그날의 사실이 아니다.
//   예약팀은 날씨·수요에 따라 앞뒤로 늘리고 줄이고, 캐디가 모자라면 한 코스만 돌린다(원웨이).
//   엔진은 그걸 관측으로 뒤늦게 배운다 — 8/18 원웨이는 3부 IN 24칸을 통째로 허위 팀으로 만들었고,
//   증거(everOpenKeys)가 쌓여 스스로 풀리기까지 반나절이 걸렸다. 그동안 배치표 13팀이 39팀으로 보였다.
//   관리자는 아침에 이미 안다. 아는 사람이 말할 자리를 만든다.
//
//  ★선언은 관측을 이긴다. 선언은 사람이 본 사실이고 여집합은 추론이다.
//   틀렸으면 버튼을 다시 눌러 되돌린다 — 되돌릴 수 있는 것은 위험하지 않다.
//   단 하나 예외: 원웨이라고 선언한 코스가 실제로 판매되는 게 보이면 엔진이 그걸 로그에 남긴다.
//   (판정은 선언을 따르되, 사람이 잘못 눌렀다는 걸 알 수 있어야 한다.)
//
//  ★이 파일은 날짜별 선언만 담는다. 기준표(config/)는 건드리지 않는다 —
//   하루의 사정으로 기본틀을 고치면 그 다음 날부터 조용히 틀린다.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';

const FILE = 'kakao-dayframe.json';
const TTL_MS = 45 * 24 * 3600 * 1000;    // 45일 롤링 — 지난 날의 선언은 쓸모가 없다
const COURSES = ['OUT', 'IN'];
const MAX_ROWS = 40;                     // 한 부 시각 수 상한 — 잘못 눌러 하루를 통째로 만들지 못하게
const DAY_MIN = 4 * 60, DAY_MAX = 23 * 60 + 59;

export const dateKey = (d) => String(d || '').replace(/\D/g, '').slice(0, 8);
const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

function load() {
  const all = loadJSON(FILE, {}) || {};
  const cut = Date.now() - TTL_MS;
  let dirty = false;
  for (const [k, v] of Object.entries(all)) if (!v || (v.at || 0) < cut) { delete all[k]; dirty = true; }
  if (dirty) saveJSON(FILE, all);
  return all;
}

// 그 날짜의 선언 — { parts: { '3': { first, last, oneway } }, at, by }.  없으면 null.
export function dayFrame(date) {
  const k = dateKey(date);
  if (!k) return null;
  const rec = load()[k];
  return rec && rec.parts && Object.keys(rec.parts).length ? rec : null;
}
export const dayFrameParts = (date) => dayFrame(date)?.parts || {};

function put(date, part, patch, by) {
  const k = dateKey(date);
  if (!k) throw new Error('날짜가 필요합니다(YYYYMMDD)');
  const p = String(part);
  if (!['1', '2', '3'].includes(p)) throw new Error('부는 1·2·3만');
  const all = load();
  const rec = (all[k] ||= { date: k, parts: {} });
  const cur = { ...(rec.parts[p] || {}), ...patch };
  // 빈 선언은 남기지 않는다 — '아무 말도 안 한 상태'와 '기본틀과 같다고 말한 상태'는 같아야 한다.
  for (const f of ['first', 'last', 'oneway']) if (!cur[f]) delete cur[f];
  if (Array.isArray(cur.extra) && !cur.extra.length) delete cur.extra;
  if (Object.keys(cur).length) rec.parts[p] = cur; else delete rec.parts[p];
  rec.at = Date.now(); rec.by = String(by || '관리자').slice(0, 40);
  if (!Object.keys(rec.parts).length) delete all[k];
  saveJSON(FILE, all);
  appendJSONL('kakao-dayframe.jsonl', { at: Date.now(), date: k, part: p, ...patch, by });
  return rec.parts[p] || null;
}

// 첫·마지막 티오프 선언. cadence 격자 위의 값만 받는다 — 격자를 벗어난 시각은 기준표가 틀렸다는 뜻이지
//  하루의 사정이 아니다(그건 config/를 고쳐야 한다).
//  ★검사는 '지금 이 부의 실제 범위'(cur)를 기준으로 한다 — 기본틀이 아니다.
//   두 끝은 따로 움직이므로, 한쪽을 이미 옮겨둔 상태에서 다른 쪽을 옮길 때
//   기본틀과 대보면 앞이 뒤보다 늦어지는 조합도 통과해버린다.
export function setPartRange(date, part, { first, last, cur, base, cadence = 7, by } = {}) {
  const ref = cur || base;
  const a = first == null ? null : toMin(first);
  const b = last == null ? null : toMin(last);
  if (first != null && a == null) throw new Error('첫 시각이 이상합니다');
  if (last != null && b == null) throw new Error('마지막 시각이 이상합니다');
  const A = a != null ? a : toMin(ref?.first);
  const B = b != null ? b : toMin(ref?.last);
  if (A == null || B == null) throw new Error('기준 시각을 알 수 없습니다');
  if (A > B) throw new Error('첫 시각이 마지막보다 늦습니다');
  if (A < DAY_MIN || B > DAY_MAX) throw new Error('하루 밖의 시각입니다');
  if (Math.floor((B - A) / cadence) + 1 > MAX_ROWS) throw new Error(`한 부에 시각 ${MAX_ROWS}개가 넘습니다`);
  const patch = {};
  if (a != null) patch.first = toHM(a);
  if (b != null) patch.last = toHM(b);
  // 기본틀과 같아지면 선언을 지운다 — 되돌리면 흔적도 없어야 한다.
  if (base) { if (patch.first === base.first) patch.first = ''; if (patch.last === base.last) patch.last = ''; }
  return put(date, part, patch, by);
}

// 원웨이 — 그날 그 부가 도는 코스 하나. ''이면 투웨이(기본).
export function setPartOneway(date, part, oneway, { by } = {}) {
  const c = String(oneway || '').toUpperCase();
  if (c && !COURSES.includes(c)) throw new Error('코스는 OUT·IN만');
  return put(date, part, { oneway: c }, by);
}

// ── 격자 밖 칸 끼워넣기 ──────────────────────────────────────────
//  ★7분 배수는 원칙이지 법이 아니다. 예약팀은 팀을 하나 더 받으려고 격자 사이에 칸을 끼운다.
//   실측 2026-08-18 3부: 순번 10이 17:35 → 17:30으로 앞당겨졌고, 11번은 17:35를 그대로 받았다.
//   즉 한 칸이 통째로 새로 생긴 것이고 그 앞사람만 밀렸다 — 끝을 늘린 것도, 전체가 민 것도 아니다.
//  ★그날 그 칸은 대조판에도 없고(격자에 행이 없다) 카카오 여집합에도 없다(기준틀 밖이라 판정 대상이 아니다).
//   팀이 하나 더 있는데 두 경로 모두 모른다. 그래서 사람이 '여기 칸이 하나 더 있다'고 말할 자리가 필요하다.
//  ★기준표에는 안 적는다 — 그날 하루의 사정이지 기본틀이 바뀐 게 아니다.
export function setPartSlot(date, part, time, course, on = true, { by, range } = {}) {
  const m = toMin(time);
  if (m == null) throw new Error('시각이 이상합니다(예: 17:30)');
  const c = String(course || 'OUT').toUpperCase();
  if (!COURSES.includes(c)) throw new Error('코스는 OUT·IN만');
  if (m < DAY_MIN || m > DAY_MAX) throw new Error('하루 밖의 시각입니다');
  // 그 부의 시간대 안이어야 한다 — 3부 격자에 06:23을 끼우는 건 실수지 사정이 아니다.
  if (range) {
    const a = toMin(range.first), b = toMin(range.last);
    if (a != null && b != null && (m < a || m > b)) throw new Error(`${part}부 시간대(${range.first}~${range.last}) 밖입니다`);
  }
  const k = `${toHM(m)}|${c}`;
  const all = load();
  const cur = { ...((all[dateKey(date)]?.parts || {})[String(part)] || {}) };
  const set = new Set(Array.isArray(cur.extra) ? cur.extra : []);
  if (on) set.add(k); else set.delete(k);
  return put(date, part, { extra: [...set].sort() }, by);
}
export const partExtras = (date, part) => ((dayFrameParts(date)[String(part)] || {}).extra || []).slice();

// 그 부의 선언을 통째로 거둔다 — 기본틀로 되돌리기.
export function clearPart(date, part, { by } = {}) {
  return put(date, part, { first: '', last: '', oneway: '', extra: [] }, by);
}

// ── 선언을 칸 목록에 적용한다 ────────────────────────────────────────
//  ★한 곳에서만 계산한다. 엔진(여집합)과 대조판(격자)이 각자 해석하면 화면과 판정이 갈라진다 —
//   그 갈라짐이 8/18 사고의 형태였다(서버 파일은 멀쩡한데 화면만 뒤죽박죽).
//
//  slots: [{part, mins, time, course}]  ·  frame: dayFrameParts(date)
//  돌려주는 것:
//   slots   — 선언 범위대로 늘리고 줄인 칸 목록
//   idle    — 원웨이로 안 도는 '부|코스' (엔진은 여기를 판정하지 않는다 = 팀 0)
//   added   — 선언으로 새로 생긴 칸  ·  dropped — 선언으로 빠진 칸
export function reframeSlots(slots, { cadence = 7, courses = COURSES, frame = {} } = {}) {
  const cs = Array.isArray(courses) && courses.length ? courses : COURSES;
  const declared = Object.keys(frame || {});
  if (!declared.length) return { slots, idle: [], added: [], dropped: [], declared: [] };
  const out = [], added = [], dropped = [], idle = [];
  // 원웨이는 칸 목록과 무관하게 선언 그 자체다 — 그 부에 칸이 하나도 없어도 말은 남아야 한다.
  for (const [p, d] of Object.entries(frame)) {
    if (!d || !d.oneway) continue;
    for (const c of cs) if (c !== d.oneway) idle.push(`${p}|${c}`);
  }
  const byPart = {};
  for (const s of slots) (byPart[s.part] ||= []).push(s);
  for (const [p, arr] of Object.entries(byPart)) {
    const d = frame[p];
    if (!d) { out.push(...arr); continue; }
    const a = toMin(d.first), b = toMin(d.last);
    if (a == null && b == null) { out.push(...arr); continue; }
    const lo = a != null ? a : Math.min(...arr.map((s) => s.mins));
    const hi = b != null ? b : Math.max(...arr.map((s) => s.mins));
    const seen = new Set();
    for (const s of arr) {
      if (s.mins < lo || s.mins > hi) { dropped.push(s); continue; }
      seen.add(`${s.mins}|${s.course}`); out.push(s);
    }
    // 늘어난 쪽 — 격자를 이어서 만든다. 새 시각의 코스 구성은 기준표의 기본값을 쓴다
    //  (예외 칸은 그 시각에만 걸린 규칙이라 새 시각에 옮겨 붙일 근거가 없다).
    for (let t = lo; t <= hi; t += cadence) for (const c of cs) {
      if (seen.has(`${t}|${c}`)) continue;
      const s = { part: p, mins: t, time: toHM(t), course: c };
      out.push(s); added.push(s);
    }
  }
  // ★격자 밖에 끼운 칸 — 부에 원래 칸이 하나도 없어도 넣는다(그 자체가 사람이 말한 사실이다).
  for (const [p, d] of Object.entries(frame)) {
    for (const k of (Array.isArray(d?.extra) ? d.extra : [])) {
      const [t, c] = String(k).split('|');
      const m = toMin(t);
      if (m == null || !cs.includes(c)) continue;
      if (out.some((s) => s.part === p && s.mins === m && s.course === c)) continue;
      const s = { part: p, mins: m, time: toHM(m), course: c, inserted: true };
      out.push(s); added.push(s);
    }
  }
  out.sort((x, y) => x.mins - y.mins || x.course.localeCompare(y.course));
  return { slots: out, idle, added, dropped, declared };
}
