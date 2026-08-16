// 이름 스냅 안전성 — '박하늘'이 '이하늘'로 둔갑하지 않는가.
//  2026-08-17: 신입 박진수·박하늘의 성이 흘려 읽혔다. 사전 복원은 이 둘을 못 고친다
//  (진수=후보 0, 하늘=후보 2). 그래서 ①정본 등재로 오스냅을 막고 ②두 번째 판독으로 성을 메운다.
const { snapRoster } = await import('../src/boardreader.mjs');
const { seedOfficial, confirmedCaddies } = await import('../src/roster.mjs');
const { OFFICIAL_ROSTER } = await import('../src/roster-official.mjs');
try { seedOfficial?.(); } catch { /* noop */ }

const CONF = new Set(confirmedCaddies());
console.log('정본 등재 — 박하늘:', CONF.has('박하늘'), '| 박진수:', CONF.has('박진수'), '| 이하늘:', CONF.has('이하늘'), '| 박한늘(옛오타):', CONF.has('박한늘'));
console.log('');

const cases = [
  // [입력 명단, 검사할 자리, 기대값, 설명]
  [['박하늘(54)'], 0, '박하늘(54)', '박하늘 단독 — 이하늘로 바뀌면 안 됨(★핵심)'],
  [['이하늘(54)', '박하늘'], 1, '박하늘', '둘이 같은 배치표에 — 서로 안 뭉개져야'],
  [['박진수(54)'], 0, '박진수(54)', '박진수 단독 유지'],
  [['이하늘(54)'], 0, '이하늘(54)', '이하늘도 그대로'],
  [['하늘'], 0, '하늘', '성 빠진 2글자 — 후보 2개라 추측 금지(그대로 둬야)'],
  [['진수'], 0, '진수', '성 빠진 2글자 — 박진수 유일하지만 신입이라… 복원 여부 확인'],
];
let pass = 0;
for (const [roster, idx, want, why] of cases) {
  const got = snapRoster(roster)[idx];
  const ok = got === want;
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'PASS' : '★FAIL'}  ${JSON.stringify(roster)} → "${got}"  ${ok ? '' : `(기대 "${want}")`}\n        ${why}`);
}
console.log(`\n${pass}/${cases.length}`);
