// 전원 대조 검사 — 재는 자가 정확한가. 자가 틀리면 나머지 측정이 전부 거짓말이 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRollCall, stateOf } from '../src/rollcall.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// 작은 가짜 명부로 본다 — 진짜 정본을 쓰면 명단이 바뀔 때마다 검사가 깨진다.
const ROSTER = ['김근무', '이스페어', '박휴무', '최당번', '정미상', '한당겨옴', '조원번'];
const board = {
  dateLabel: '2026년 8월 21일 금요일',
  parts: {
    1: { roster: ['김근무(54)', '한당겨옴'], cut: 2 },
    2: { roster: ['김근무(54)', '조원번', '이스페어'], cut: 2 },
    3: { roster: ['김근무(54)', '이스페어'], cut: 1 },
  },
  duty: { 박휴무: '휴무', 최당번: '당번' },
};

console.log('\n[한 사람의 상태는 정확히 하나다]');
{
  const rc = buildRollCall(board, ROSTER);
  const of = (n) => rc.rows.find((r) => r.name === n);
  ok(of('김근무').state === '근무' && of('김근무').parts.join('·') === '1·2·3', '54는 세 부 근무');
  ok(of('조원번').state === '근무' && of('조원번').why.includes('2부'), '2부 근무자');
  ok(of('이스페어').state === '스페어', '커트 밖이면 스페어', `지금 ${of('이스페어').state}`);
  ok(of('박휴무').state === '불가용' && of('박휴무').why === '휴무', '근태는 불가용');
  ok(of('최당번').state === '역할' && of('최당번').why === '당번', '당번은 역할 — 불가용과 다르다');
  ok(of('정미상').state === '설명안됨', '어디에도 없으면 설명 안 됨',
    '침묵하던 자리다. 이걸 세지 않으면 판독이 스무 명을 놓쳐도 명단은 그럴듯해 보인다');
  ok(of('한당겨옴').state === '근무' && of('한당겨옴').why.includes('1부'), '당겨온 사람은 받는 부의 근무');
  ok(rc.rows.length === ROSTER.length, '정본 전원을 빠짐없이 센다');
  const sum = Object.values(rc.states).reduce((a, b) => a + b, 0);
  ok(sum === ROSTER.length, `상태 합이 전원과 같다 — ${sum}/${ROSTER.length}`, '한 사람이 두 상태에 들면 숫자가 거짓말을 한다');
}

console.log('\n[★근무가 근태보다 앞선다 — 당번도 나가서 뛴다]');
{
  const who = { 최당번: { parts: ['2'], spare: [], kind: 'single', from: '' } };
  ok(stateOf('최당번', who, '당번').state === '근무', '당번인데 뛰었으면 근무다',
    '가용이 모자라면 당번도 나간다 — 뛴 걸 역할로 덮으면 캐디피가 사라진다');
  ok(stateOf('박휴무', {}, '휴무').state === '불가용', '안 뛴 근태는 불가용');
}

console.log('\n[설명률]');
{
  const rc = buildRollCall(board, ROSTER);
  ok(rc.rate === Math.round((1 - 1 / 7) * 1000) / 10, `7명 중 1명 미상 → ${rc.rate}%`);
  ok(buildRollCall({ parts: {}, duty: {} }, ROSTER).rate === 0, '아무것도 못 읽으면 0%',
    '판독이 통째로 실패한 날이 100%로 보이면 안 된다');
  ok(buildRollCall({ parts: {}, duty: {} }, []).total === 0, '빈 명부도 안전하다');
}

console.log('\n[정본에 없는 이름 — 오독이거나 신입]');
{
  const b2 = { ...board, parts: { ...board.parts, 1: { roster: ['김근무(54)', '없는사람'], cut: 2 } } };
  const rc = buildRollCall(b2, ROSTER);
  ok(rc.strangers.includes('없는사람'), '정본 밖 이름을 골라낸다');
  ok(!rc.strangers.includes('김근무'), '정본에 있는 이름은 안 고른다');
}

console.log('\n[근무자 수 = 팀 수 — 깨질 수 없는 불변식]');
{
  const rc = buildRollCall(board, ROSTER);
  const p1 = rc.partCheck.find((x) => x.part === '1');
  ok(p1 && p1.ok && p1.workers === 2 && p1.cut === 2, '맞으면 통과');
  const b3 = { ...board, parts: { ...board.parts, 1: { roster: ['김근무(54)'], cut: 5 } } };
  const bad = buildRollCall(b3, ROSTER).partCheck.find((x) => x.part === '1');
  ok(bad && !bad.ok, '어긋나면 잡는다 — 명단이 잘렸거나 커트를 잘못 읽었다');
}

console.log('\n[아무것도 고치지 않는다]');
{
  const before = JSON.stringify(board);
  buildRollCall(board, ROSTER);
  ok(JSON.stringify(board) === before, '입력을 건드리지 않는다', '재는 코드가 고치기 시작하면 잰 값을 못 믿는다');
  const src = read('src/rollcall.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(!/saveToday|saveBoardPartsStore|broadcast\(/.test(src), '배치표·회원 카드·알림을 건드리지 않는다');
}

console.log('\n[알림은 셀 수 있는 것만]');
{
  const srv = read('src/server.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/async function runRollCall\(/.test(srv), '판독 끝에 도는 자리가 있다');
  ok(/kind: 'part_count_mismatch'/.test(srv), '근무자 수 어긋남은 알린다');
  ok(/kind: 'unknown_names'/.test(srv), '정본 밖 이름은 알린다');
  ok(!/rate.*raiseBoardIssue|raiseBoardIssue.*rate/.test(srv), '설명률 자체로는 알리지 않는다',
    '근태 캡처가 낫기 전엔 매일 낮게 나온다 — 매일 울리면 알림이 배경음이 된다');
  const al = read('src/boardalert.mjs');
  for (const k of ['part_count_mismatch', 'unknown_names']) ok(new RegExp(`case '${k}':`).test(al), `${k} 문구가 있다`);
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
