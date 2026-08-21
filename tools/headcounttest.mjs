// 인원 채점 검사 — 채점자가 정확한가. 채점자가 틀리면 "95%"가 "97%"로 바뀔 뿐 아무것도 나아지지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxConsistent, countedFrom, scoreHeadcount, scoreLine, ALERT_GAP } from '../src/headcount.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const noComment = (s) => s.replace(/^[ \t]*\/\/.*$/gm, '');

// 2026-08-21 실제 배치표에 인쇄된 값. 이게 그날의 정답지다.
const REAL = { total: 83, available: 64, excluded: 19,
  breakdown: { 휴가: 1, 병가: 1, 동반: 0, 휴무: 16, 당번: 1, 배치: 1, 접종: 0, 프리: 0, 벌당: 0 } };

// 전원 대조 결과를 흉내 낸다 — {name, state, why} 행들.
const rc = (spec) => ({ rows: Object.entries(spec).flatMap(([k, n]) => {
  const [state, why] = k.split('/');
  return Array.from({ length: n }, (_, i) => ({ name: `${state}${i}`, state, why: why || '' }));
}) });

console.log('\n[상자가 자기 검산을 지키는가 — 틀린 자로는 재지 않는다]');
ok(boxConsistent(REAL) === true, '총원 83 − 제외 19 = 가용 64');
ok(boxConsistent({ total: 83, available: 64, excluded: 20 }) === false, '안 맞으면 잡는다',
  '숫자 하나를 잘못 읽은 상자로 채점하면 채점자가 먼저 틀린다');
ok(boxConsistent({ total: 83, available: 64 }) === null, '제외인원이 없으면 검산 자체를 못 한다');
ok(boxConsistent(null) === null, '상자가 없어도 안전하다');

console.log('\n[우리가 센 수 — 상자와 같은 축으로]');
{
  const c = countedFrom(rc({ 근무: 33, 스페어: 29, '불가용/휴무': 16, '불가용/병가': 1, '역할/당번': 1, 설명안됨: 3 }));
  ok(c.available === 62, '가용 = 근무 + 스페어', `지금 ${c.available}`);
  ok(c.excluded === 17, '제외 = 불가용');
  ok(c.role === 1, '역할은 따로 센다');
  ok(c.breakdown['휴무'] === 16 && c.breakdown['병가'] === 1, '근태는 사유별로 나뉜다');
  ok(c.breakdown['당번'] === 1, '역할도 종류별로 나뉜다');
  ok(c.breakdown['휴가'] === 0, '없는 사유는 0이다 — 빠뜨리지 않는다',
    '없는 줄을 안 만들면 배치표가 휴가 3명이라 해도 어긋남이 안 잡힌다');
  ok(countedFrom({}).available === 0, '빈 대조도 안전하다');
}

console.log('\n[채점 — 배치표가 정답, 우리가 오답]');
{
  // 오늘 실측: 근무 33 + 스페어 29 = 62. 배치표는 가용 64. 두 명을 놓쳤다.
  const sc = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1, '역할/당번': 1 }));
  ok(sc.gap === -2, '못 찾은 사람은 음수로 나온다', `지금 ${sc.gap}`);
  ok(sc.rate === 96.9, `62/64 = ${sc.rate}%`, '형이 "대충 95%"라 한 그 숫자가 여기서 확정된다');
  ok(sc.usable === true, '검산 통과한 상자로만 채점한다');
  ok(sc.alert === true, `${ALERT_GAP}명 이상 어긋나면 알린다`);
  const avail = sc.lines.find((l) => l.key === '가용');
  ok(avail && avail.hard, '가용만이 반드시 맞아야 하는 줄이다');
  ok(sc.lines.some((l) => l.key === '휴무' && l.gap === 0), '맞은 줄은 어긋남 0');
  ok(!sc.misses.some((l) => l.key === '휴무'), '맞은 줄은 어긋남 목록에 없다');
}

console.log('\n[어디서 새는지 짚어준다 — 이게 "다음에 뭘 고칠까"의 답이다]');
{
  // 근태 판독이 통째로 실패한 날(로그의 '근태 판독: 0명'). 휴무 16명이 전부 설명 안 됨으로 떨어진다.
  const sc = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 29, 설명안됨: 21 }));
  const off = sc.misses.find((l) => l.key === '휴무');
  ok(off && off.declared === 16 && off.counted === 0, '휴무 16명을 통째로 놓친 걸 짚는다',
    '"정확도가 낮다"가 아니라 "휴무 칸을 못 읽었다"라고 말해야 고칠 수 있다');
  ok(sc.misses.some((l) => l.key === '제외인원' && l.counted === 0), '제외인원도 같이 어긋난다');
  ok(scoreLine(sc).includes('휴무 0/16'), '한 줄 요약에 어긋난 곳이 나온다');
}

console.log('\n[★1명 차이는 안 알린다 — 당번이 나가서 뛴 날]');
{
  // 당번인 사람이 가용 부족으로 대신 근무 → 우리 셈에선 '근무', 배치표 당번 칸엔 그대로.
  //  가용이 1 늘고 당번이 1 준다. 정상적인 어긋남이라 알리면 안 된다.
  const sc = scoreHeadcount(REAL, rc({ 근무: 34, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1 }));
  ok(sc.gap === -1, '가용은 1 모자라게 잡힌다');
  ok(sc.alert === false, '1명 차이로는 안 알린다',
    '당번 한 명이 어느 쪽에 서느냐로 갈릴 수 있다 — 매일 울리면 알림이 배경음이 된다');
  ok(sc.misses.some((l) => l.key === '당번' && l.counted === 0), '그래도 기록엔 남는다');
}

console.log('\n[검산 깨진 상자로는 채점하지 않는다]');
{
  const bad = { ...REAL, excluded: 25 };                    // 83 − 25 ≠ 64
  const sc = scoreHeadcount(bad, rc({ 근무: 10, 스페어: 5 }));
  ok(sc.usable === false, '못 쓰는 상자로 표시된다');
  ok(sc.alert === false, '못 쓰는 상자로는 알리지 않는다',
    '판독이 숫자를 흘려 읽은 날 멀쩡한 명단을 틀렸다고 알리면 신뢰를 잃는다');
  ok(scoreLine(sc).includes('검산 실패'), '왜 채점을 안 했는지 말해준다');
}

console.log('\n[총원은 알림 대상이 아니다 — 정본은 상시로 어긋난다]');
{
  const sc = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 31, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1, '역할/당번': 1, 설명안됨: 6 }));
  ok(sc.gap === 0, '가용은 맞았다');
  ok(sc.alert === false, '정본이 6명 많아도 안 알린다',
    '퇴사·신입으로 정본 89 vs 총원 83 같은 차이는 늘 있다 — 매일 알리면 배경음이 된다');
  const tot = sc.lines.find((l) => l.key === '총원');
  ok(tot && tot.gap === 6 && !tot.hard, '차이는 기록해 둔다 — 정본을 손볼 때 쓴다');
}

console.log('\n[아무것도 고치지 않는다]');
{
  const before = JSON.stringify(REAL);
  scoreHeadcount(REAL, rc({ 근무: 1 }));
  ok(JSON.stringify(REAL) === before, '입력을 건드리지 않는다');
  const src = noComment(read('src/headcount.mjs'));
  ok(!/saveToday|saveBoardPartsStore|broadcast\(|raiseBoardIssue/.test(src), '배치표·회원 카드·알림을 건드리지 않는다',
    '재는 코드가 고치기 시작하면 잰 값을 못 믿는다');
  ok(scoreHeadcount(null, rc({ 근무: 1 })) === null && scoreHeadcount(REAL, null) === null, '재료가 없으면 null');
}

console.log('\n[판독기 계약 — 소스 검사]');
{
  const cr = noComment(read('src/claudereader.mjs'));
  ok(/export async function readHeadcountBox\(/.test(cr), '인원 요약 판독기가 있다');
  ok(/if \(j\.found === false\) return null;[\s\S]{0,400}?readHeadcountBox|readHeadcountBox[\s\S]{0,900}?if \(j\.found === false\) return null;/.test(cr),
    '★상자 없음(부분 크롭)은 null — 총원 0명과 다르다',
    '부분 크롭을 "오늘 아무도 없음"으로 읽으면 멀쩡한 채점이 0점이 된다');
  ok(/total == null \|\| available == null\) return null/.test(cr), '반쪽짜리 상자는 안 쓴다');

  const br = noComment(read('src/boardreader.mjs'));
  ok(/readHeadcountBox\(hPath\)/.test(br), '판독 파이프라인이 상자를 읽는다');
  ok(/key: 'hc'/.test(br), '★증분 비교에 인원 요약 전용 띠가 있다',
    "duty 띠는 x1=0.76에서 끊겨 '가용' 숫자를 못 본다 — 그 띠로 재사용하면 어제 점수를 물려받는다");
  ok(/export async function claudeHeadcount\(/.test(br), '캐시에서 꺼내 쓴다(추가 호출 0)');

  const rcSrc = noComment(read('src/rollcall.mjs'));
  ok(/recordRollCall\(board = currentBoard\(\), declared = null\)/.test(rcSrc), '전원 대조가 채점표를 받는다');
  ok(/declared \|\| loadHeadcount\(key\)/.test(rcSrc), "그날 이미 읽어둔 상자를 다시 쓴다",
    "'변동' 글은 상자가 없는 부분 크롭이라, 그때마다 점수를 잃으면 안 된다");

  const srv = noComment(read('src/server.mjs'));
  ok(/runRollCall\(full\)/.test(srv), '배치표 처리 끝에서 그 글로 채점한다');
  ok(/kind: 'headcount_mismatch'/.test(srv), '크게 어긋나면 알린다');
  ok(/rc\.score && rc\.score\.alert/.test(srv), '알림 여부는 채점자가 정한다');

  const al = read('src/boardalert.mjs');
  ok(/case 'headcount_mismatch':/.test(al), '문구가 있다');
  ok(/headcount_mismatch' \? `\$\{it\.declared\}-\$\{it\.counted\}`/.test(al), '중복차단 서명이 몇 대 몇을 담는다',
    '서명이 같으면 어긋남이 커져도 다시 안 알린다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
