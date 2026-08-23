// 인원 채점 검사 — 채점자가 정확한가. 채점자가 틀리면 "95%"가 "97%"로 바뀔 뿐 아무것도 나아지지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxConsistent, countedFrom, scoreHeadcount, scoreLine, ALERT_GAP } from '../src/headcount.mjs';
import { rolesFromCrew } from '../src/boardreader.mjs';

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
  ok(c.placed === 80, '★설명 = 어떤 자리든 찾아준 사람(근무+스페어+불가용+역할)', `지금 ${c.placed}`);
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
  // 2026-08-21 서버 실측: 근무 33 · 스페어 29 · 불가용 18 · 역할 0 = 80. 배치표 총원 83.
  const sc = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1 }));
  ok(sc.gap === -3, '못 찾은 사람은 음수로 나온다', `지금 ${sc.gap}`);
  ok(sc.rate === 96.4, `80/83 = ${sc.rate}% — 실데이터로 확정된 그날의 정확도`, `지금 ${sc.rate}`);
  ok(sc.usable === true, '검산 통과한 상자로만 채점한다');
  ok(sc.alert === false, `−3은 안 알린다(기준 ${ALERT_GAP})`,
    '당번·배치는 가용·제외 경계에서 정상적으로 논다 — 매일 울리면 알림이 배경음이 된다');
  const hard = sc.lines.find((l) => l.hard);
  ok(hard && hard.key === '설명', '★hard는 설명 하나다 — 경계와 무관한 축',
    '실측 배치표는 제외인원 19인데 상세 합이 20이다. 가용/제외 경계는 흔들린다');
  ok(sc.lines.some((l) => l.key === '가용' && !l.hard), '가용은 참고 줄로 남긴다');
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

console.log('\n[★당번이 나가서 뛰어도 점수는 안 흔들린다 — 축을 이렇게 고른 이유]');
{
  // 같은 하루, 같은 판독. 다른 건 당번 한 명이 대신 뛰었느냐뿐이다.
  //  뛰면 우리 셈에서 '역할'→'근무'로 옮겨 가용이 1 는다. 배치표 당번 칸엔 그대로 남는다.
  const 대기 = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1, '역할/당번': 1 }));
  const 출근 = scoreHeadcount(REAL, rc({ 근무: 34, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1 }));
  const av = (s) => s.lines.find((l) => l.key === '가용').counted;
  ok(av(출근) - av(대기) === 1, '가용은 한 명 움직인다');
  ok(대기.gap === 출근.gap, '★설명은 안 움직인다 — 어느 쪽이든 자리는 찾아준 사람이다',
    '가용을 기준 삼았다면 같은 판독이 날마다 다른 점수를 받는다');
  ok(대기.alert === false && 출근.alert === false, '둘 다 안 알린다');
  ok(출근.misses.some((l) => l.key === '당번' && l.counted === 0), '그래도 기록엔 남는다');
}

console.log('\n[★제외인원은 같은 바구니끼리 맞댄다 — 근태 + 역할]');
{
  // 2026-08-23 서버 실측. 배치표 상자: 제외인원 18 · 상세(휴가5 병가1 휴무7 배치1 프리2 벌당1) 합 17.
  //  우리 판독도 근태 13 + 역할 4 = 17이었다. 그런데 채점은 근태 13만 18에 맞대 −5로 찍었다.
  //  다섯 명이 새는 것처럼 보이지만 진짜로 어긋난 건 한 명이다.
  const D = { total: 83, available: 65, excluded: 18,
    breakdown: { 휴가: 5, 병가: 1, 동반: 0, 휴무: 7, 당번: 0, 배치: 1, 접종: 0, 프리: 2, 벌당: 1 } };
  const sc = scoreHeadcount(D, rc({ 근무: 54, 스페어: 11,
    '불가용/휴가': 5, '불가용/병가': 1, '불가용/휴무': 7,
    '역할/배치': 1, '역할/프리': 2, '역할/벌당': 1 }));
  const ex = sc.lines.find((l) => l.key === '제외인원');
  ok(ex.counted === 17, '근태 13에 역할 4를 더해서 맞댄다', `지금 ${ex.counted}`);
  ok(ex.gap === -1, '★진짜 차이는 한 명이다(예전엔 −5로 찍혔다)', `지금 ${ex.gap}`);
  ok(sc.counted.excluded === 13, '불가용 자체는 그대로 근태만 센다(다른 셈이 쓰는 값이다)');
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
  ok(sc.gap === 0, '83명 전원에게 자리를 찾아줬다');
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

console.log('\n[역할 수확 — 이미 읽어둔 걸 버리지 않는다]');
{
  // 2026-08-21 실측: 조편성표 4열에서 83명 전원을 읽었고 역할 태그는 정확히 2건이었다.
  const crew = [{ name: '석정일', duty: '당번' }, { name: '우겸조', duty: '배치' },
    { name: '정진영', duty: '3부' }, { name: '박수현', duty: '2,3' }, { name: '차은경', duty: '54' },
    { name: '이수련', duty: '휴무' }, { name: '우겸조', duty: '배치' }, { name: '홍길동', duty: '' }];
  const roles = rolesFromCrew(crew);
  ok(roles.length === 2, `역할만 골라낸다 — ${roles.length}건`);
  ok(roles.some((r) => r.name === '석정일' && r.role === '당번'), '당번을 잡는다');
  ok(roles.some((r) => r.name === '우겸조' && r.role === '배치'), '배치를 잡는다');
  ok(!roles.some((r) => /^(3부|2,3|54)$/.test(r.role)), '★근무부 태그는 안 가져온다',
    "'3부'는 순번표에 있어야 할 사람이라는 뜻이다 — 역할로 인정하면 명단을 못 읽어 사라진 사람을 '설명됨'으로 덮어 채점이 거짓말을 한다");
  ok(!roles.some((r) => r.role === '휴무'), '근태는 여기로 안 온다 — 근태는 따로 다룬다');
  ok(roles.filter((r) => r.name === '우겸조').length === 1, '같은 사람이 두 번 안 들어간다');
  ok(rolesFromCrew([]).length === 0 && rolesFromCrew(null).length === 0, '빈 입력도 안전하다');
}

console.log('\n[역할이 붙으면 채점이 어떻게 움직이나]');
{
  // 배선 전: 석정일·우겸조가 어디에도 안 잡혀 설명 −3.
  const 전 = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1 }));
  // 배선 후: 둘이 '역할'로 잡힌다.
  const 후 = scoreHeadcount(REAL, rc({ 근무: 33, 스페어: 29, '불가용/휴무': 16, '불가용/휴가': 1, '불가용/병가': 1,
    '역할/당번': 1, '역할/배치': 1 }));
  ok(전.gap === -3 && 후.gap === -1, `설명 −3 → −1`, '두 사람이 자리를 찾는다');
  ok(후.rate > 전.rate, `${전.rate}% → ${후.rate}%`);
  ok(!후.misses.some((l) => l.key === '당번' || l.key === '배치'), '당번·배치 줄이 맞는다',
    '채점표가 짚은 구멍이 그대로 메워지는지 — 이게 이 작업의 성적표다');
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
  ok(/roleList = rolesFromCrew\(\(raw && raw\.crew\) \|\| \[\]\)/.test(br), '역할을 같은 판독에서 건진다(추가 호출 0)',
    '조편성표는 이미 전원의 근무칸을 읽고 있었다 — 티브레이크에만 쓰고 버렸을 뿐이다');
  {
    // ★주입 순서: 순번 괄호 태그 → 역할 → 근태. 근태가 마지막이라 '오늘 안 나옴'이 무엇이든 이긴다.
    const iRole = br.indexOf('for (const r of (roleList || []))');
    const iOff = br.indexOf('for (const o of (offList || []))');
    const iRoster = br.indexOf('if (c.holder && c.duty && !crewDuty[c.holder])');
    ok(iRoster > -1 && iRole > iRoster, '순번 셀 괄호 태그가 역할보다 먼저다(그쪽이 더 구체적)');
    ok(iRole > -1 && iOff > iRole, '★근태가 역할을 덮는다 — 휴무인 사람은 당번이어도 안 나온다');
    ok(/!crewDuty\[r\.name\]\) crewDuty\[r\.name\] = r\.role/.test(br), '이미 있는 값은 안 건드린다');
  }
  ok(/const ROLE_TAG_RE = \/\^\(당번\|벌당\|배치\|프리\)\$\//.test(br), '역할 태그가 배치표 요약 상자 항목과 같다',
    '상자가 직접 세는 넷이라 대조해 맞는지 확인할 수 있다');
  ok(/crop_only: hPath, trim: true/.test(br), '★검은 여백을 떼고 내용 기준으로 자른다',
    '같은 배치표가 2520x945(좌우 검은 띠)와 1555x933 두 가지로 들어온다 — 전체 폭 비율로는 상자가 한쪽은 x 0.65, 다른 쪽은 x 0.81이라 한 값으로 둘 다 못 맞춘다');
  const hcBand = br.match(/\{ key: 'hc',[^}]*\}/);
  ok(hcBand && /x1: 1\b/.test(hcBand[0]), '증분 띠가 오른쪽 끝까지 본다',
    '여백 없는 캡처에선 상자가 오른쪽 끝에 붙는다');

  const py = read('scripts/board_read_local.py');
  ok(/def _content_box\(/.test(py), '내용 경계를 재는 함수가 있다');
  ok(/if cfg\.get\("trim"\):\n\s+fx0, fy0, fx1, fy1 = _content_box\(im\)/.test(py), 'trim을 켤 때만 잰다');
  ok(/fx0, fy0, fx1, fy1 = \(0, 0, W, H\)/.test(py), '★trim 없으면 원본 그대로 — 기존 크롭 전부 무변화',
    '부 크롭·근태·당번이 다 이 경로를 쓴다. 여기서 기하가 흔들리면 판독 전체가 흔들린다');
  ok(/if \(x1 - x0\) < W \* 0\.3 or \(y1 - y0\) < H \* 0\.3:\n\s+return \(0, 0, W, H\)/.test(py),
    '내용이 터무니없이 작게 잡히면 원본을 쓴다', '잘못 떼느니 안 떼는 게 낫다');

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
