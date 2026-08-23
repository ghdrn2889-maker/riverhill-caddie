// 인원 요약 — 배치표가 스스로 적어둔 답과 우리가 센 수를 맞댄다.
//
//  ★왜 필요한가: 지금까지 판독은 틀려도 '틀린 줄'을 몰랐다. 명단이 두 명 빠져도 남은 명단은
//   그럴듯해 보이고, 그 두 명은 침묵한다. 그래서 정확도를 물으면 "대충 95%쯤"이라고 답할 수밖에 없었다.
//   그런데 배치표 오른쪽 아래엔 총원·가용·제외인원이 인쇄돼 있다 — 그날의 정답이 이미 그림 안에 있었다.
//   그걸 읽어 대면 정확도는 감이 아니라 숫자가 되고, 틀린 날은 그날 바로 안다.
//
//  ★이건 '고치는' 코드가 아니라 '채점하는' 코드다. 명단을 손대지 않는다.
//   판독을 무엇으로 고치든(근태 판독 복구·다수결·정본 보강) 효과는 이 숫자로만 확인된다.
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'board-headcount.json';
const KEEP_DAYS = 60;

// 상자에 인쇄되는 항목들. 앞 세 개는 '근태'(불가용), 뒤는 '역할'(그날의 보직).
export const OFF_KEYS = ['휴가', '병가', '휴무'];
export const ROLE_KEYS = ['당번', '벌당', '배치', '프리'];
// 동반·접종은 우리가 따로 세는 상태가 없다 — 기록만 하고 대조는 하지 않는다.
export const UNMODELED_KEYS = ['동반', '접종'];

// ── 상자 자체의 검산 ────────────────────────────────────────
//  총원 − 제외인원 = 가용. 배치표가 스스로 지키는 항등식이라, 이게 깨지면 '오늘이 이상한 날'이 아니라
//  '판독이 숫자를 잘못 읽은 날'이다. 그런 상자로 판독을 채점하면 채점자가 먼저 틀린 꼴이 된다.
export function boxConsistent(hc) {
  if (!hc || hc.total == null || hc.available == null || hc.excluded == null) return null;   // 검산할 재료가 없다
  return hc.total - hc.excluded === hc.available;
}

// ── 우리가 센 수 ────────────────────────────────────────────
//  전원 대조 결과(rows)에서 상자와 같은 축으로 집계한다.
//  ★가용 = 근무 + 스페어. '어느 부 순번표엔가 이름이 올라간 사람'이 곧 가용이다.
export function countedFrom(rc) {
  const rows = (rc && rc.rows) || [];
  const has = (r, k) => String(r.why || '').includes(k);
  const breakdown = {};
  for (const k of OFF_KEYS) breakdown[k] = rows.filter((r) => r.state === '불가용' && has(r, k)).length;
  for (const k of ROLE_KEYS) breakdown[k] = rows.filter((r) => r.state === '역할' && has(r, k)).length;
  const available = rows.filter((r) => r.state === '근무' || r.state === '스페어').length;
  const excluded = rows.filter((r) => r.state === '불가용').length;
  const role = rows.filter((r) => r.state === '역할').length;
  return {
    total: rows.length,
    available,
    excluded,
    role,
    // ★placed — 어떤 자리든 찾아준 사람. 이게 총원과 맞으면 그날을 다 읽은 것이다.
    placed: available + excluded + role,
    breakdown,
  };
}

// ── 채점표 ──────────────────────────────────────────────────
//  gap = 우리가 센 수 − 배치표가 말한 수. 음수면 그만큼 놓쳤다는 뜻이다.
//
//  ★hard(알림을 좌우하는 줄)는 '설명' 하나뿐이다 — 총원 83명 중 우리가 자리를 찾아준 사람 수.
//   왜 '가용'이 아니라 '설명'인가: 가용/제외의 경계는 흔들린다. 실측 8/21 배치표를 보면
//   제외인원 19인데 상세 합은 20이다(휴가1 병가1 휴무16 당번1 배치1). 당번·배치 같은 역할은
//   가용 쪽에 설 수도, 제외 쪽에 설 수도 있어 그 경계에서 ±1씩 논다.
//   반면 '총원 83명 각자에게 자리가 있었나'는 경계와 무관하다. 근무든 스페어든 근태든 역할이든
//   자리를 찾았으면 설명된 것이고, 못 찾았으면 그 사람은 판독에서 사라진 것이다.
//
//  다른 줄이 hard가 아닌 이유:
//   · 총원 — 정본 명단은 퇴사·신입 때문에 배치표 총원과 상시로 어긋난다(오늘 정본 89 vs 총원 83).
//     매일 알리면 알림이 배경음이 된다. 대신 차이를 기록해 정본을 손볼 때 쓴다.
//   · 당번·프리 — 당번이어도 가용이 모자라면 나가서 뛴다. 뛴 사람은 우리 셈에서 '근무'로 올라가고
//     배치표 당번 칸엔 그대로 남는다. 즉 ±1은 정상적으로 생긴다.
//
//  ★알림은 '모자랄 때만'이다. 남는 건(정본이 배치표보다 많은 것) 판독 실패가 아니라 명부 문제다.
//  ★기준값은 아직 보정 중이다 — 실측 8/21이 −3(당번·배치 2명 + 진짜 누락 1명)이라, 그보다 위에서
//   시작해 며칠 실데이터를 보고 좁힌다. 이제 잴 수 있으니 보정할 근거가 생겼다.
export const ALERT_GAP = 5;

export function scoreHeadcount(declared, rc) {
  if (!declared || !rc) return null;
  const counted = countedFrom(rc);
  const lines = [];
  const add = (key, dec, cnt, hard) => {
    if (dec == null) return;
    lines.push({ key, declared: dec, counted: cnt, gap: cnt - dec, hard: !!hard });
  };
  add('설명', declared.total, counted.placed, true);          // ★총원 중 자리를 찾아준 사람
  add('가용', declared.available, counted.available, false);
  add('총원', declared.total, counted.total, false);          // 정본 명부 크기 — 판독이 아니라 명부 이야기
  // ★배치표가 말하는 '제외인원'은 근태 + 역할을 다 담은 수다 — 상자 표에 당번·배치·프리·벌당이
  //  휴가·병가·휴무와 나란히 인쇄되고, 제외인원은 그 표의 합계 자리에 찍힌다.
  //  우리 쪽 '불가용'(근태만)을 그 수에 맞대면 역할 인원만큼 매일 모자란 것처럼 보인다.
  //   실측 2026-08-23: 우리 13 vs 배치표 18로 다섯 명이 새는 것처럼 찍혔는데,
  //   역할 4명(프리2·배치1·벌당1)을 더하면 17이고 배치표 상세 합도 17이다 — 진짜 차이는 한 명이었다.
  //  틀린 자로 재면 진짜 어긋남이 가짜 어긋남에 묻힌다. 같은 바구니끼리 맞댄다.
  add('제외인원', declared.excluded, counted.excluded + counted.role, false);
  const bd = declared.breakdown || {};
  for (const k of [...OFF_KEYS, ...ROLE_KEYS]) add(k, bd[k], counted.breakdown[k] || 0, false);

  const consistent = boxConsistent(declared);
  // ★상자가 자기 검산을 못 지키면 채점을 하지 않는다 — 틀린 자로 재면 틀린 값이 나온다.
  const usable = consistent !== false;
  const hard = lines.find((l) => l.hard);
  const gap = hard ? hard.gap : 0;
  const rate = declared.total > 0
    ? Math.round((Math.min(counted.placed, declared.total) / declared.total) * 1000) / 10
    : 0;
  return {
    usable, consistent, rate, gap, lines, counted,
    // 어긋난 줄만 — 어디서 몇 명이 새는지 바로 짚는다.
    misses: lines.filter((l) => l.gap !== 0),
    // 모자랄 때만 알린다. 남는 건 판독 실패가 아니라 정본에 옛 사람이 남은 것이다.
    alert: usable && gap <= -ALERT_GAP,
  };
}

// 한 줄 요약 — 로그·모니터에 그대로 쓴다.
export function scoreLine(sc) {
  if (!sc) return '';
  if (sc.consistent === false) return '인원요약 상자 검산 실패(총원−제외≠가용) — 채점 보류';
  const head = `총원 ${sc.lines.find((l) => l.key === '설명')?.declared ?? '?'}명 중 ${sc.counted.placed}명 설명(${sc.rate}%)`;
  const miss = sc.misses.filter((l) => l.key !== '설명')
    .map((l) => `${l.key} ${l.counted}/${l.declared}`).join(' · ');
  return head + (miss ? ` · 어긋남: ${miss}` : ' · 전부 일치');
}

// ── 날짜별 보관 ─────────────────────────────────────────────
export function saveHeadcount(dateKey, hc) {
  if (!dateKey || !hc) return false;
  const all = loadJSON(FILE, {}) || {};
  all[dateKey] = { at: Date.now(), ...hc };
  const keys = Object.keys(all).sort();
  while (keys.length > KEEP_DAYS) delete all[keys.shift()];
  saveJSON(FILE, all);
  return true;
}

export function loadHeadcount(dateKey) {
  if (!dateKey) return null;
  const all = loadJSON(FILE, {}) || {};
  return all[dateKey] || null;
}

export function listHeadcount(n = 14) {
  const all = loadJSON(FILE, {}) || {};
  return Object.entries(all).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, n)
    .map(([date, v]) => ({ date, ...v }));
}
