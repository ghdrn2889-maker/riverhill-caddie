// 근무 확정 검사 — 판정이 한 자리에만 있고, 세 화면이 같은 숫자를 세는지.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wd from '../src/workday.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const noComment = (s) => s.replace(/^[ \t]*\/\/.*$/gm, '');

const noon = Date.UTC(2026, 7, 20, 3, 0);            // 2026-08-20 12:00 KST
const day = (o) => ({ date: '2026-08-19', kind: 'work', rounds: {}, ...o });

console.log('\n[마쳤는가 — 배치표는 전날 밤에 온다]');
ok(wd.isSettled('2026-08-19', [], noon), '어제 근무는 마친 근무다');
ok(!wd.isSettled('2026-08-21', ['06:30'], noon), '내일 근무는 아직 근무가 아니다',
  '배치표가 올라온 밤에 수익·트로피가 먼저 터지면 거짓말이 된다');
ok(!wd.isSettled('2026-08-20', ['12:20'], noon), '오늘 12:20 티오프는 정오엔 안 끝났다');
ok(wd.isSettled('2026-08-20', ['06:30'], noon), '오늘 06:30 티오프는 정오면 끝났다');
ok(!wd.isSettled('2026-08-20', [], noon), '티오프를 모르는 오늘 근무는 아직 안 한 것으로 본다');
ok(!wd.isSettled('2026-08-20', ['06:30', '12:20'], noon), '두 부는 마지막 티오프가 기준이다');

console.log('\n[근무인가]');
ok(wd.isWorkDay(day({})), '대표 kind가 work면 근무');
ok(wd.isWorkDay(day({ kind: 'spare', rounds: { 2: { part: '2', kind: 'work' } } })), '어느 부든 work면 근무');
ok(!wd.isWorkDay(day({ excluded: true })), '순번 제외는 근무가 아니다');
ok(!wd.isWorkDay(day({ kind: 'off' })), '휴무는 근무가 아니다');
ok(!wd.isWorkDay(null), '기록 없는 날도 안전하다');
// 사용자가 손으로 고친 날은 그 분류가 이긴다 — 남은 라운드 찌꺼기로 뒤집으면 수동 보정이 무의미해진다.
ok(!wd.isWorkDay(day({ kind: 'off', userKind: true, rounds: { 3: { part: '3', kind: 'work' } } })),
  '수동으로 휴무라 한 날은 라운드가 남아 있어도 휴무', '수동 보정이 자동 판독을 이겨야 한다');
ok(wd.isWorkDay(day({ kind: 'work', userKind: true, rounds: {} })), '수동으로 근무라 한 날은 근무');

console.log('\n[근무 확정 = 근무 + 마침]');
ok(wd.isWorkDone(day({ date: '2026-08-19' }), noon), '어제 근무는 확정');
ok(!wd.isWorkDone(day({ date: '2026-08-21', teeTime: '06:30' }), noon), '내일 근무는 미확정');
ok(wd.isUpcomingWork(day({ date: '2026-08-21', teeTime: '06:30' }), noon), '내일 근무는 예정으로 센다');
ok(!wd.isUpcomingWork(day({ date: '2026-08-21', kind: 'off' }), noon), '내일 휴무는 예정이 아니다');
// 근무이면서 아직 안 끝난 날은 '확정'과 '예정' 중 정확히 하나에만 든다(둘 다 세면 합이 안 맞는다).
for (const d of [day({ date: '2026-08-20', teeTime: '06:30' }), day({ date: '2026-08-20', teeTime: '17:35' })]) {
  ok(wd.isWorkDone(d, noon) !== wd.isUpcomingWork(d, noon), `${d.teeTime} — 확정과 예정 중 하나에만 든다`);
}

console.log('\n[캐디피 대상인가 — 뛴 라운드는 준다]');
// 회원 18번 2026-08-16 실기록: 1부 벌당 + 2부 근무 13:21.
const duty = day({ duty: { kind: '벌당', part: '1' }, rounds: { 2: { part: '2', kind: 'work', teeTime: '13:21' } } });
ok(wd.isWorkDay(duty), '당번·벌당이 낀 근무일도 근무다', '무보수라고 일한 사실까지 지우면 안 된다');
// ★관리자 확인: 당번·벌당 중인 캐디도 가용 인원이 모자라면 나가서 대신 근무한다. 그건 뛴 근무다.
ok(wd.isPayable(duty), '당번·벌당이 낀 날도 뛴 라운드는 캐디피 대상이다',
  '예전엔 하루를 통째로 뺐다 — 8/16 2부 캐디피 14만원이 그렇게 사라졌다');
ok(!wd.isPayable(day({ kind: 'off', duty: { kind: '당번', part: '3' } })), '당번만 서고 안 뛴 날은 0원',
  '역할 자체는 무보수다');

// ★당번·벌당인 날은 '배치표 순번에 이름이 있어야' 캐디피가 붙는다(관리자 확인).
//  나가서 뛰었다면 반드시 그 부 순번에 이름이 올라간다 — 뛴 부가 없다는 건 안 나갔다는 뜻이다.
{
  const led = read('src/ledger.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/if \(wd\.hasDuty\(day\)\) return \[\];/.test(led),
    '당번 날엔 기본부(3부)를 가정하지 않는다',
    '순번에 이름도 없는 사람에게 15만원이 잡힌다');
  const i = led.indexOf('const ov = d.dayParts[day.date];');
  const j = led.indexOf('if (wd.hasDuty(day)) return [];');
  ok(i > -1 && j > i, '수동 보정(dayParts)은 그대로 이긴다',
    '판독이 놓친 걸 사람이 넣는 길이라 막으면 안 된다');
}
ok(wd.isPayable(day({})), '보통 근무는 캐디피 대상');
ok(!wd.isPayable(day({ kind: 'off' })), '휴무는 캐디피 대상이 아니다');
ok(wd.hasDuty(duty) && !wd.hasDuty(day({})), '당번 여부를 따로 볼 수 있다');

console.log('\n[티오프 모으기]');
ok(wd.teesOf(day({ teeTime: '06:30', rounds: { 2: { teeTime: '13:21' }, 3: { teeTime: '' } } })).length === 2,
  '대표·부별 티오프를 모으고 빈 값은 버린다');
ok(wd.teesOf(null).length === 0, '기록 없는 날도 안전하다');

console.log('\n[판정이 한 자리에만 있는가 — 소스 검사]');
{
  // ★같은 판정을 두 번 적으면 언젠가 한쪽만 고친다. 그게 일지 30 · 정산 29를 만든 원인이다.
  const led = noComment(read('src/ledger.mjs'));
  const tro = noComment(read('src/trophy.mjs'));
  ok(!/ROUND_MIN\s*=\s*270/.test(led), '정산이 라운드 소요를 따로 안 들고 있다');
  ok(!/const\s+ROUND_MIN\s*=\s*270/.test(tro), '트로피가 라운드 소요를 따로 안 들고 있다');
  ok(/from '\.\/workday\.mjs'/.test(led), '정산이 단일 판정을 가져다 쓴다');
  ok(/from '\.\/workday\.mjs'/.test(tro), '트로피가 단일 판정을 가져다 쓴다');
  ok(!/kind === 'work' && !x\.excluded/.test(led), '정산이 근무 조건을 손으로 다시 안 쓴다');
  ok(!/isWork = r\.kind === 'work'/.test(tro), '트로피가 근무 조건을 손으로 다시 안 쓴다');

  const app = noComment(read('public/app.js'));
  ok(!/`근무 \$\{cnt\(\(d\) => d\.kind === 'work'/.test(app), '일지 화면이 근무를 제각기 안 센다',
    '화면이 세기 시작하면 서버와 또 갈라진다');
  ok(/cnt\(\(d\) => d\.settled\)/.test(app), '일지 화면은 서버가 붙인 표식을 읽는다');
  ok(/Number\(lgData\.workedDays\)/.test(app), '정산 화면도 같은 숫자를 쓴다');

  const srv = noComment(read('src/server.mjs'));
  ok(/settled: wd\.isWorkDone\(d\)/.test(srv), '/api/journal이 날짜마다 판정을 붙여 내려준다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
