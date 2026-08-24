// 회원 대시보드 '라운드' 조립 — 앱(GET /api/today)과 관리자 모니터(GET /api/user-dash)의 단일 진실원.
//  두 곳이 같은 today1/2/3.json을 읽지만 라운드 조립을 각각 따로 구현해 화면이 갈라지던 문제(관리자 모니터가
//  회원이 실제로 보는 걸 못 드러냄)를 없애기 위해, '대표부 해석 + 라운드 배열'을 여기서 한 번만 계산한다.
//  ★출력/필터는 server.mjs GET /api/today(리팩터 전) 로직과 100% 동일 — 앱 회귀 0.
import { loadToday } from './today.mjs';
import { commuteInfo } from './judge.mjs';
import { dayPlanFor, planCommute } from './dayplan.mjs';
import * as worklog from './worklog.mjs';

const WORK = ['assigned', 'work', 'your_turn'];
const SPARE = ['spare', 'waiting', 'near'];

// 대표부(홈 베이스) + primaryPart 해석. 3부 우선, 3부가 없거나 낡고 minorPartOn이면 1·2부에서 대표 라운드 선택.
//  반환: { base: today객체|null, primaryPart, tISO, t3Usable }.  (server.mjs GET /api/today 506~531행과 동일.)
export function resolvePrimary({ uid, minorPartOn, todayISO }) {
  let base = loadToday(uid);            // 3부(홈 베이스) 우선
  let primaryPart = '3';
  const t3ISO = base ? worklog.labelToISO(base.date) : null;
  const t3Usable = base && !(t3ISO && t3ISO < todayISO);   // 3부가 있고 낡지 않음
  if (!t3Usable && minorPartOn) {
    const cands = [];
    for (const pp of ['1', '2']) {
      const s = loadToday(uid, pp);
      if (!s) continue;
      const iso = worklog.labelToISO(s.date);
      if (iso && iso < todayISO) continue;                 // 과거(낡음) 제외
      const work = WORK.includes(s.status);
      const spare = SPARE.includes(s.status) && Number(s.myPosition) > 0;
      if (!work && !spare) continue;
      cands.push({ part: pp, s, work });
    }
    if (cands.length) {
      cands.sort((a, b) => (a.work ? 0 : 1) - (b.work ? 0 : 1) || Number(a.part) - Number(b.part)); // 근무 먼저, 그다음 1→2
      base = cands[0].s; primaryPart = cands[0].part;
    }
  }
  const tISO = base ? worklog.labelToISO(base.date) : null;
  return { base, primaryPart, tISO, t3Usable };
}

// 같은 날 1·2·3부 활성 라운드 배열(카드 스택·조합 요약용). 근무는 항상, 스페어는 순번 있을 때만.
//  ★server.mjs GET /api/today 556~590행의 루프를 그대로 이관 — 필터·필드 100% 동일.
export function buildMemberRounds({ uid, primaryPart, base, minorPartOn, tISO, todayISO, commuteMin }) {
  const rounds = [];
  if (!base) return rounds;
  const primaryOff = base.status === 'off';   // 대표(3부) 휴무면 다른 부 유령 라운드 억제(조출 예외)
  for (const pp of ['1', '2', '3']) {
    const tp = (pp === primaryPart) ? base : loadToday(uid, pp);
    const isChulgn = pp === '1' && tp && tp.assign === 'chulgn' && WORK.includes(tp.status);
    if (pp !== '3' && !minorPartOn && !isChulgn) continue;                 // 섀도: 1·2부 숨김(조출 예외)
    if (pp !== primaryPart && primaryOff && !isChulgn) continue;           // 휴무=휴무
    if (!tp) continue;
    const isWork = WORK.includes(tp.status);
    const isSpare = SPARE.includes(tp.status);
    const hasPos = Number(tp.myPosition) > 0;
    if (!isWork && !(isSpare && hasPos)) continue;
    if (pp !== primaryPart && isWork && !tp.teeTime && !isChulgn) continue; // 비대표 근무는 티오프 확정분만
    const tpISO = worklog.labelToISO(tp.date);
    const sameDay = !tpISO || tpISO === tISO || (!tISO && tpISO >= todayISO);
    if (!sameDay) continue;
    // ★샷건처럼 그날 그 부만 시간표가 다른 날 — 티오프 역산 대신 고정 시간표를 쓴다(dayplan.mjs).
    //  배치표의 티오프 칸이 '근무 인원을 줄세운 것'뿐인 날이 있어, 그대로 두면 앱이 틀린 출발 시각을 단언한다.
    const plan = dayPlanFor(tpISO || tISO || todayISO, pp);
    const pc = (isWork && plan) ? planCommute(plan, commuteMin) : null;
    rounds.push({
      part: pp, kind: isWork ? 'work' : 'spare', status: tp.status,
      teeTime: pc ? pc.tee : (tp.teeTime || ''), course: pc ? '' : (tp.course || ''), myPosition: tp.myPosition || null,
      cutLine: tp.cutLine || null, cutoffName: tp.cutoffName || null,
      assign: pp === '1' ? (tp.assign || null) : null,
      commute: pc || ((isWork && tp.teeTime) ? commuteInfo(tp.teeTime, commuteMin) : null),
      dayPlan: plan ? { kind: plan.kind, note: plan.note || '', arrive: plan.arrive, standby: plan.standby, tee: plan.tee } : null,
      roster3: Array.isArray(tp.roster3) ? tp.roster3 : null,
      teeGrid: Array.isArray(tp.teeGrid) ? tp.teeGrid : null,
      date: tp.date || base.date,
    });
  }
  return rounds;
}

// MINOR_PART_PUSH(1·2부 대시보드 노출) 플래그 — 앱·모니터가 같은 값을 쓰도록 공용.
export function minorPartActive() {
  return ['1', 'true', 'yes'].includes(String(process.env.MINOR_PART_PUSH || '').toLowerCase());
}
