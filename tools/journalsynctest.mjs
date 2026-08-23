// 오늘 카드와 일일 근무 일지는 같은 사실을 말해야 한다.
//
//  실측 2026-08-23: 검수에서 3부 배치표를 교정하자 회원 카드는 새 순번·티오프로 바뀌었는데
//  일지는 8분 전 값에 멈췄다. 회원17 — 카드 [assigned 14번 17:21] / 일지 [work 20번 12:46].
//  monitor.mjs·boardcorrect.mjs 어디에도 일지를 쓰는 코드가 없었다(import조차 없었다).
//  일지는 정산 수익 산정의 단일 소스다(ledger.summary → wd.isWorkDone → 일지의 티오프).
//  그러니 이건 화면이 틀린 문제가 아니라 '돈이 틀린' 문제였다 — 교정할 때마다 조용히.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => {
  if (c) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

console.log('\n[★길목 하나에서 함께 쓰는가]');
{
  const td = read('src/today.mjs');
  ok(/export function saveToday\(s, userId = 1, part = '3'\) \{\n  saveUserJSON\(userId, fileFor\(part\), s\);\n  syncJournal\(s, userId, part\);/.test(td),
    '★카드를 저장하면 일지도 함께 쓴다',
    '자리마다 호출을 따라 붙이면 새 자리가 생길 때마다 또 샌다 — 실제로 일곱 군데였다');
  ok(/function syncJournal\(s, userId, part\)/.test(td), '옮기는 함수가 있다');
  ok(/journal\.recordDayStatus\(iso, \{/.test(td), '일지의 그 날 그 부 라운드로 간다');
  ok(/part: String\(part \|\| '3'\)/.test(td), '부를 그대로 넘긴다',
    '안 넘기면 1·2부 카드가 전부 3부 라운드에 적힌다');
  ok(/if \(!iso\) return;/.test(td), '어느 날 카드인지 모르면 적지 않는다');
  ok(/catch \{ \/\* 일지 실패가 카드 저장을 막지 않는다 \*\//.test(td),
    '일지가 실패해도 카드는 저장된다', '일지는 부수 기록이다 — 그것 때문에 카드를 잃으면 안 된다');
  ok(td.indexOf('saveUserJSON(userId, fileFor(part), s);') < td.indexOf('syncJournal(s, userId, part);'),
    '카드를 먼저 쓴다');
}

console.log('\n[교정 경로가 이제 일지에 닿는가]');
{
  // 교정 경로들은 today.mjs의 saveToday를 통해서만 카드를 쓴다 — 그 길이 곧 일지로 가는 길이다.
  for (const f of ['src/monitor.mjs', 'src/boardcorrect.mjs']) {
    const src = read(f);
    const n = (src.match(/saveToday\(/g) || []).length;
    ok(/from '\.\/today\.mjs'/.test(src) && n > 0, `${f} 가 saveToday로 카드를 쓴다 (${n}곳)`);
    ok(!/writeFileSync\([^)]*today\d?\.json/.test(src),
      `${f} 가 today.json을 직접 쓰지 않는다`, '직접 쓰면 길목을 우회해 다시 갈라진다');
  }
}

console.log('\n[실제로 옮겨지는가 — 임시 회원으로 왕복]');
{
  // ★이 검사는 실제 data/ 폴더에 쓴다. DATA_DIR은 모듈이 뜰 때 정해지는 상수라 환경변수로 못 바꾼다.
  //  그래서 실제 회원과 절대 겹치지 않는 번호를 쓰고, 끝나면 지운다(아래 finally).
  const UID_DIR = path.join(ROOT, 'data', 'users', '990001');
  const { saveToday } = await import('../src/today.mjs');
  const journal = await import('../src/journal.mjs');
  const UID = 990001;
  saveToday({ date: '2026년 08월 23일 일요일', status: 'assigned', myPosition: 14,
    teeTime: '17:21', course: 'IN', cutoffName: '장성원' }, UID, '3');
  let d = journal.getDay('2026-08-23', UID);
  ok(!!d && d.rounds && d.rounds['3'] && d.rounds['3'].teeTime === '17:21',
    `★3부 카드가 일지 3부 라운드로 갔다 (${d?.rounds?.['3']?.teeTime || '없음'})`);
  saveToday({ date: '2026년 08월 23일 일요일', status: 'assigned', myPosition: 20,
    teeTime: '12:46', course: 'OUT' }, UID, '2');
  d = journal.getDay('2026-08-23', UID);
  ok(d.rounds['2'] && d.rounds['2'].teeTime === '12:46' && d.rounds['3'].teeTime === '17:21',
    '★2부는 2부 라운드로 — 3부를 덮지 않는다', '두 탕인 사람의 라운드가 서로를 지우면 안 된다');
  ok(d.twoRounds === true, '두 라운드로 센다');
  // 교정으로 티오프가 바뀌면 일지도 따라간다 — 이게 이번에 터진 바로 그 지점이다
  saveToday({ date: '2026년 08월 23일 일요일', status: 'assigned', myPosition: 14,
    teeTime: '18:31', course: 'OUT' }, UID, '3');
  d = journal.getDay('2026-08-23', UID);
  ok(d.rounds['3'].teeTime === '18:31',
    '★교정으로 티오프가 바뀌면 일지도 따라간다 (17:21 → 18:31)',
    '여기가 안 따라가서 정산이 옛 티오프로 근무 마침을 판정했다');
  // 미상은 일지에 남기지 않는다
  saveToday({ date: '2026년 08월 23일 일요일', status: 'unknown', myPosition: 0, teeTime: '' }, UID, '1');
  d = journal.getDay('2026-08-23', UID);
  ok(!d.rounds['1'], '미상 상태는 일지에 남기지 않는다', "'모른다'와 '없다'는 다르다");
  fs.rmSync(UID_DIR, { recursive: true, force: true });          // 쓴 것은 지운다
  ok(!fs.existsSync(UID_DIR), '검사가 쓴 것을 치웠다', '검사가 실제 data/ 에 흔적을 남기면 안 된다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
