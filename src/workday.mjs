// 근무 확정 — 한 회원의 하루가 '근무인가'를 정하는 단 하나의 자리.
//  ★이 판정이 일지·정산·트로피·세무에 각자 복사돼 있었다. 같은 사람의 근무 일수가 화면마다
//   달라졌고(일지 30 · 정산 29 · 트로피 29), 누가 맞는지 아무도 몰랐다. 그래서 여기로 모은다.
//  기준은 두 축이다. 섞으면 안 된다.
//   ① 근무인가        — 그날 실제로 라운드를 나갔나.            isWorkDay
//   ② 캐디피 대상인가 — 그 근무에 돈이 붙나(당번·벌당은 무보수). isPayable
//   당번을 '근무가 아님'으로 처리하면 일한 사실 자체가 기록에서 사라진다.
import * as journal from './journal.mjs';

// 라운드 소요 ≈ 4시간 30분. 티오프 후 이만큼 지나야 '일을 마쳤다'로 본다.
export const ROUND_MIN = 270;

const toMin = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// ── 마친 근무인가 ──────────────────────────────────────────
//  ★배치표는 전날 밤에 올라오고 그때 일지에 '근무'로 적힌다. 그대로 세면 아직 나가지도 않은
//   근무가 오늘 수익으로 잡히고(티오프 17:56인데 00:53에 돈이 뜨던 문제), 트로피도 하루 먼저 열린다.
//  티오프를 모르는 오늘 근무는 아직 안 한 것으로 본다(먼저 축하하느니 늦게 축하한다).
export function isSettled(dateISO, tees = [], now = Date.now()) {
  const k = new Date(now + 9 * 3600 * 1000);          // KST
  const today = k.toISOString().slice(0, 10);
  if (dateISO < today) return true;
  if (dateISO > today) return false;                  // 내일 근무는 아직 근무가 아니다
  const mins = (tees || []).map(toMin).filter((v) => v != null);
  if (!mins.length) return false;
  return (k.getUTCHours() * 60 + k.getUTCMinutes()) >= Math.max(...mins) + ROUND_MIN;
}

// 그날 일지에 적힌 티오프 전부(대표 + 부별 라운드) — 두 탕이면 마지막 것이 기준이 된다.
export function teesOf(day) {
  if (!day) return [];
  return [day.teeTime, ...Object.values(day.rounds || {}).map((r) => r && r.teeTime)]
    .filter((t) => toMin(t) != null);
}

// ── ① 근무인가 ────────────────────────────────────────────
//  · 순번 제외(excluded)는 근무가 아니다.
//  · 사용자가 일지에서 직접 고친 날(userKind)은 그 분류가 이긴다 — 남은 라운드 찌꺼기로 뒤집지 않는다.
export function isWorkDay(day) {
  if (!day || day.excluded) return false;
  if (day.userKind) return day.kind === 'work';
  if (day.kind === 'work') return true;
  return Object.values(day.rounds || {}).some((r) => r && r.kind === 'work');
}

// 마친 근무 — 이 날이 '근무 확정'이다. 모든 화면이 세는 숫자는 이것 하나여야 한다.
export function isWorkDone(day, now = Date.now()) {
  return isWorkDay(day) && isSettled(day.date, teesOf(day), now);
}

// 아직 안 한 근무(내일 배치표·오늘 진행 중) — 세되, 다른 칸에 센다.
export function isUpcomingWork(day, now = Date.now()) {
  return isWorkDay(day) && !isSettled(day.date, teesOf(day), now);
}

// ── ② 캐디피 대상인가 ─────────────────────────────────────
//  당번·벌당은 '그 역할'이 무보수다. 그날 전체가 무보수인 게 아니다.
//  ★관리자 확인 2026-08-21: 당번·벌당 중인 캐디도 그날 갑자기 가용 인원이 모자라면
//   나가서 대신 근무한다. 그 라운드는 실제로 뛴 근무이므로 캐디피가 붙는다.
//   예전 규칙은 '당번이 있는 날은 통째로 제외'였다 — 회원 18번 8/16이 1부 벌당 + 2부 근무 13:21인데
//   하루가 통째로 빠져 2부 캐디피 14만원이 사라졌다. 뛴 걸 안 준 셈이다.
//  그래서 지금은 '근무했는가'와 같다. 두 축을 남겨두는 건 규칙이 또 갈릴 때 여기 한 곳만 고치기 위해서다.
//  당번만 서고 라운드를 안 뛴 날은 kind가 work가 아니므로 자연히 0원이다.
export function hasDuty(day) { return !!(day && day.duty && day.duty.kind); }
export function isPayable(day) { return isWorkDay(day); }

// ── 한 회원의 근무일 목록 ─────────────────────────────────
//  일지가 단일 소스. 정산·트로피·일지 요약이 전부 이 함수를 통과한다.
export function workDays({ year, month } = {}, userId = 1, now = Date.now()) {
  const all = journal.listJournal({ year, month }, userId) || [];
  return {
    all,
    done: all.filter((d) => isWorkDone(d, now)),
    upcoming: all.filter((d) => isUpcomingWork(d, now)),
    paid: all.filter((d) => isWorkDone(d, now) && isPayable(d)),
    duty: all.filter((d) => hasDuty(d)),
  };
}
