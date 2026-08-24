// 대바로 넘긴 부가 일지에 근무로 남지 않는가 — 2026-08-24 김홍구↔강혜영 실사고 그대로.
//  ★DATA_DIR은 컴파일 시점 상수라 진짜 data/users/<UID>를 쓴다. 아무도 안 쓰는 번호로 쓰고 끝에 지운다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as journal from '../src/journal.mjs';

const UID = 990024;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'data', 'users', String(UID));
const wipe = () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* noop */ } };
wipe();

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };
const D = '2026-08-24';
const day = () => journal.getDay ? journal.getDay(D, UID) : JSON.parse(fs.readFileSync(path.join(DIR, 'journal.json'), 'utf8'))[D];
const rec = (o) => journal.recordDayStatus(D, o, UID);

console.log('\n── 대바로 3부를 넘기고 2부로 갔다 ──');
{
  // ① 아침: 3부 1번 근무로 잡혀 있었다.
  rec({ status: 'assigned', teeTime: '16:32', course: 'OUT', myPosition: 1, cutoffName: '도대영', part: '3' });
  // ② 2부 14번으로 배정됐다(대바로 받은 자리).
  rec({ status: 'assigned', teeTime: '13:21', course: 'IN', myPosition: 14, part: '2' });
  ok(day().twoRounds === true, '이 시점엔 두 탕이 맞다(아직 3부를 안 넘겼다)');

  // ③ 대바 정합이 3부 카드를 비운다 — status:'unknown' + 넘겼다는 표식.
  rec({ status: 'unknown', myPosition: 0, teeTime: '', course: '', part: '3', swappedOut: true });
  const d = day();
  ok(!d.rounds['3'], '★넘긴 3부 라운드가 사라진다', JSON.stringify(d.rounds));
  ok(!!d.rounds['2'], '받은 2부 라운드는 남는다');
  ok(d.twoRounds === false, '★두 탕이 아니다', `지금 twoRounds=${d.twoRounds}`);
  ok(d.kind === 'work', '그래도 그날은 근무다(2부를 뛰었다)');
  ok(d.teeTime === '13:21' && d.course === 'IN', '★대표 티오프가 2부 것으로 바뀐다',
    `지금 ${d.teeTime} ${d.course} — 넘긴 3부 16:32가 남으면 정산이 남의 라운드로 돈다`);
  ok(d.myPosition === 14, '대표 순번도 2부 것', `지금 ${d.myPosition}`);
}

console.log('\n── 하나뿐인 라운드를 넘기면 그날 기록이 없어진다 ──');
{
  wipe();
  rec({ status: 'assigned', teeTime: '16:32', course: 'OUT', myPosition: 1, part: '3' });
  ok(!!day(), '먼저 근무로 잡히고');
  rec({ status: 'unknown', myPosition: 0, part: '3', swappedOut: true });
  ok(!day(), '★넘기고 나면 그날 기록이 사라진다', '남겨두면 안 뛴 날이 근무일로 정산된다');
}

console.log('\n── 메모를 남긴 날은 메모만 지킨다 ──');
{
  wipe();
  rec({ status: 'assigned', teeTime: '16:32', course: 'OUT', myPosition: 1, part: '3' });
  journal.setDayNote(D, { memo: '무릎 조심' }, UID);
  rec({ status: 'unknown', myPosition: 0, part: '3', swappedOut: true });
  const d = day();
  ok(!!d && d.memo === '무릎 조심', '★사람이 쓴 글은 안 지운다', JSON.stringify(d));
  ok(!!d && !Object.keys(d.rounds || {}).length, '근무는 비었다');
}

console.log('\n── 평소 「모르겠다」는 예전 그대로 물러난다 ──');
{
  wipe();
  rec({ status: 'assigned', teeTime: '16:32', course: 'OUT', myPosition: 1, part: '3' });
  const before = JSON.stringify(day().rounds);
  rec({ status: 'unknown', myPosition: 0, part: '3' });            // 표식 없음 = 판독이 흔들린 것
  ok(JSON.stringify(day().rounds) === before, '★표식 없는 미상은 기록을 건드리지 않는다',
    '판독이 잠깐 흔들렸다고 근무 기록을 지우면 그날 일한 사실이 사라진다');
}

console.log('\n── 진짜 두 탕은 그대로 두 탕이다 ──');
{
  wipe();
  rec({ status: 'assigned', teeTime: '12:25', course: 'OUT', myPosition: 8, part: '2' });
  rec({ status: 'assigned', teeTime: '17:00', course: 'IN', myPosition: 5, part: '3' });
  const d = day();
  ok(d.twoRounds === true, '2·3부 진짜 두 탕은 유지', JSON.stringify(d.rounds));
  ok(d.teeTime === '17:00', '대표는 3부 우선(예전 규칙 그대로)', d.teeTime);
}

wipe();
ok(!fs.existsSync(DIR), '★검사가 쓴 폴더를 지웠다');

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
