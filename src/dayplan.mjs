// ── 그날 그 부만 시간표가 다른 날 ─────────────────────────────
//  샷건 대회처럼 '티오프에서 거꾸로 센 출근'이 통하지 않는 날이 있다. 2026-08-25 청송 군수배가 그랬다:
//  2부 배치표의 티오프 칸(11:50~14:17)은 근무 인원을 줄세우려고 찍은 것뿐이고, 실제로는 전원이
//  10시 40분까지 나와 10시 50분 출석 확인을 받고 12시 30분에 동시에 나간다.
//  그런 날 앱은 43번에게 "12:17 출발"이라고 말하고 그 시각에 푸시까지 보낸다 — 출석 확인이 끝나고 한참 뒤에.
//  ★그래서 날짜+부 하나에 '고정 시간표'를 못박는다. 이게 있는 날 그 부는 역산을 쓰지 않는다.
//
//  data/dayplan.json = { "2026-08-25": { "2": { kind, arrive, standby, tee, note, by, at } } }
//    arrive  = 출근(골프장 도착) 시각      ← 이 날의 진짜 기준점
//    standby = 출석 확인/백대기 시각
//    tee     = 티오프(샷건은 전원 동일)
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'dayplan.json';
const KEEP_DAYS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const toMin = (hhmm) => { const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fmt = (x) => { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };

function loadAll() {
  const raw = loadJSON(FILE, null);
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

function saveAll(all) {
  const keys = Object.keys(all).sort();
  while (keys.length > KEEP_DAYS) delete all[keys.shift()];
  saveJSON(FILE, all);
}

// 그 날짜 그 부의 고정 시간표. 없으면 null(= 평소대로 티오프 역산).
export function dayPlanFor(dateISO, part) {
  const d = String(dateISO || ''); const p = String(part || '').replace(/[^123]/g, '');
  if (!DATE_RE.test(d) || !p) return null;
  const rec = loadAll()[d]?.[p];
  if (!rec || toMin(rec.arrive) == null) return null;
  return { date: d, part: p, ...rec };
}

export function listDayPlans() {
  const all = loadAll(); const out = [];
  for (const d of Object.keys(all).sort()) {
    for (const p of Object.keys(all[d] || {}).sort()) out.push({ date: d, part: p, ...all[d][p] });
  }
  return out;
}

// 등록·수정·삭제(plan=null이면 삭제). 시각은 HH:MM만 받는다 — 지어낸 값이 들어오면 그날 전체가 틀어진다.
export function setDayPlan(dateISO, part, plan, by = 'admin') {
  const d = String(dateISO || ''); const p = String(part || '').replace(/[^123]/g, '');
  if (!DATE_RE.test(d)) throw new Error('날짜는 YYYY-MM-DD');
  if (!p) throw new Error('부는 1·2·3 중 하나');
  const all = loadAll();
  if (!plan) {
    if (all[d]) { delete all[d][p]; if (!Object.keys(all[d]).length) delete all[d]; }
    saveAll(all); return null;
  }
  const pick = (v, what) => {
    const s = String(v || '').trim();
    if (!HHMM_RE.test(s)) throw new Error(`${what} 시각은 HH:MM (받은 값: "${s}")`);
    return s;
  };
  const arrive = pick(plan.arrive, '출근');
  const standby = plan.standby ? pick(plan.standby, '출석 확인') : arrive;
  const tee = plan.tee ? pick(plan.tee, '티오프') : standby;
  // ★출근 → 출석 확인 → 티오프 순서가 어긋나면 히어로 게이지가 거꾸로 간다. 저장 전에 막는다.
  if (!(toMin(arrive) <= toMin(standby) && toMin(standby) <= toMin(tee))) {
    throw new Error(`시각 순서가 어긋납니다 — 출근 ${arrive} ≤ 출석 ${standby} ≤ 티오프 ${tee}`);
  }
  const rec = {
    kind: String(plan.kind || 'shotgun').trim().slice(0, 20),
    arrive, standby, tee,
    note: String(plan.note || '').trim().slice(0, 60),
    by: String(by || 'admin').slice(0, 20), at: Date.now(),
  };
  all[d] = { ...(all[d] || {}), [p]: rec };
  saveAll(all);
  return { date: d, part: p, ...rec };
}

// 고정 시간표 → commuteInfo와 '같은 모양'. 쓰는 쪽(히어로·카드·리마인더)은 아무것도 몰라도 된다.
//  ★출발만 회원별로 계산한다(각자 집이 다르니까). 나머지 셋은 그날 모두에게 같다.
export function planCommute(plan, commuteMin) {
  if (!plan) return null;
  const a = toMin(plan.arrive), s = toMin(plan.standby), t = toMin(plan.tee);
  if (a == null || s == null || t == null) return null;
  const commute = Number.isFinite(Number(commuteMin)) ? Number(commuteMin) : Number(process.env.COMMUTE_MIN ?? 60);
  return {
    tee: fmt(t), standby: fmt(s), arrive: fmt(a), leave: fmt(a - commute),
    backWaitMin: t - s, arriveBeforeMin: s - a, commuteMin: commute,
    fixed: true, kind: plan.kind || 'shotgun', note: plan.note || '',
  };
}
