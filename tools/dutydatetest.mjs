// 당번 저장 — '오늘 한 건'에서 '날짜별'로. 기준은 2026-08-23 홍준표 실사고다.
//  관리자가 내일(8/24) 2부 당번을 넣었는데 오늘(8/23)로 저장됐고, 화면엔 어느 날에도 안 떴다.
//  ★DATA_DIR은 컴파일 시점 상수라 환경변수로 못 돌린다 → 실제 data/users/<UID>를 쓴다.
//   그래서 아무도 안 쓰는 번호를 골라 쓰고, 끝나면 지운 걸 확인까지 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../src/duty.mjs';

const UID = 990009;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'data', 'users', String(UID));
const wipe = () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* noop */ } };
wipe();

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };
const TODAY = '2026-08-23', TOMO = '2026-08-24';

console.log('\n── 내일 당번을 미리 넣을 수 있다(이게 안 돼서 사고가 났다) ──');
{
  D.saveDuty(UID, TOMO, '당번', '2', 'admin');
  const t = D.dutyForToday(UID, TOMO);
  ok(!!t && t.label === '2부 당번', '내일 날짜로 넣으면 내일 조회된다', JSON.stringify(t));
  ok(t.start === '11:00' && t.end === '18:00', '2부 당번은 11:00~18:00', `${t && t.start}~${t && t.end}`);
  ok(D.dutyForToday(UID, TODAY) === null, '★오늘 조회하면 없다 — 내일 것이 오늘 화면에 새지 않는다');
}

console.log('\n── 오늘과 내일이 같이 있을 수 있다(그릇이 하루치가 아니다) ──');
{
  D.saveDuty(UID, TODAY, '벌당', '1', 'admin');
  ok(D.dutyForToday(UID, TODAY).label === '1부 벌당', '오늘은 1부 벌당');
  ok(D.dutyForToday(UID, TOMO).label === '2부 당번', '내일은 2부 당번 — 서로 안 지운다',
    '예전엔 한 건만 담겨서 나중에 넣은 게 앞엣것을 덮었다');
  ok(JSON.stringify(D.dutyDates(UID)) === JSON.stringify([TODAY, TOMO]), '넣어둔 날짜들을 돌려준다');
}

console.log('\n── 해제는 그 날짜만 ──');
{
  D.saveDuty(UID, TODAY, '', '', 'admin');
  ok(D.dutyForToday(UID, TODAY) === null, '오늘은 해제됐고');
  ok(D.dutyForToday(UID, TOMO) !== null, '★내일은 그대로다',
    '한 날을 지우다 다른 날까지 날리면 미리 넣어둔 게 조용히 사라진다');
}

console.log('\n── 옛 파일(한 건짜리)을 그대로 읽는다 ──');
{
  wipe();
  fs.mkdirSync(DIR, { recursive: true });
  // 2026-08-23 현재 서버에 실제로 저장돼 있던 모양.
  fs.writeFileSync(path.join(DIR, 'duty.json'),
    JSON.stringify({ date: TOMO, kind: '당번', part: '2', by: 'admin', at: 1787479398582 }));
  ok(D.dutyForToday(UID, TOMO).label === '2부 당번', '옛 모양도 날짜로 찾아진다',
    '배포하자마자 기존 회원 당번이 사라지면 안 된다');
  ok(D.dutyForToday(UID, TODAY) === null, '옛 모양도 다른 날엔 안 뜬다');
  D.saveDuty(UID, TODAY, '당번', '3', 'admin');   // 한 번 쓰면 새 모양으로 옮겨진다
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'duty.json'), 'utf8'));
  ok(!raw.kind && raw[TODAY] && raw[TOMO], '★한 번 저장하면 날짜별로 옮겨지고 옛 값도 살아남는다',
    JSON.stringify(raw));
}

console.log('\n── 날짜 없는 저장은 받지 않는다 ──');
{
  wipe();
  ok(D.saveDuty(UID, '', '당번', '3', 'admin') === null, '어느 날인지 없으면 저장하지 않는다',
    '날짜 없는 당번은 "언젠가 당번"이라 화면이 못 쓴다');
  ok(D.loadDuty(UID, '') === null, '날짜 없이 물으면 답하지 않는다');
}

console.log('\n── 관리자 확정은 자동판독이 못 덮는다(그대로) ──');
{
  wipe();
  D.saveDuty(UID, TOMO, '당번', '2', 'admin');
  ok(D.isAdminSet(UID, TOMO) === true, '내일 것이 관리자 확정으로 잡힌다');
  ok(D.isAdminSet(UID, TODAY) === false, '오늘 것은 비어 있으니 확정도 아니다');
  D.saveDuty(UID, TODAY, '당번', '3', 'board');
  ok(D.isAdminSet(UID, TODAY) === false, '자동판독이 넣은 건 확정이 아니다');
  ok(D.isAdminSet(UID, TOMO) === true, '★내일 관리자 확정은 그대로 — 하루가 다른 하루를 흔들지 않는다');
}

console.log('\n── 오래된 건 쌓이지 않는다 ──');
{
  wipe();
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    D.saveDuty(UID, d, '당번', '3', 'board');
  }
  const dates = D.dutyDates(UID);
  ok(dates.length === 30, '한 달치만 남는다', `지금 ${dates.length}일`);
  ok(dates[dates.length - 1] === '2026-02-09', '최근 것이 남고 옛것이 밀린다', dates[dates.length - 1]);
}

wipe();
ok(!fs.existsSync(DIR), '★검사가 쓴 폴더를 지웠다(진짜 data/를 쓰므로 흔적을 남기지 않는다)');

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
