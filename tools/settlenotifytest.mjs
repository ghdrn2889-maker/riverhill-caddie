// 근무 마침 알림 — 마쳐지는 순간에, 하루 한 번만, 판정과 같은 숫자로.
//
//  수익은 따로 '기록되는' 순간이 없다. isWorkDone(마지막 티오프 + 4시간 30분)이 참이 되면
//  그날이 정산의 '예정'에서 '근무 확정'으로 넘어가고 그때부터 금액이 합계에 들어간다.
//  그 문턱을 넘는 순간을 알린다. 두 탕이면 마지막 라운드 기준으로 한 번만.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wd from '../src/workday.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => {
  if (c) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const srv = fs.readFileSync(path.join(ROOT, 'src/server.mjs'), 'utf8').replace(/\r\n/g, '\n');
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

console.log('\n[★언제 마쳐지는가 — 두 탕이면 마지막 라운드]');
{
  const day1 = { date: '2026-08-23', kind: 'work', teeTime: '17:14', rounds: { 3: { kind: 'work', teeTime: '17:14' } } };
  ok(wd.settleAtMin(day1) === 17 * 60 + 14 + 270, `3부 17:14 → ${hm(wd.settleAtMin(day1))} 마침`);

  // 2부 12:30 + 3부 17:14 두 탕 — 마지막(3부)이 기준이다.
  const day2 = { date: '2026-08-23', kind: 'work', teeTime: '12:30',
    rounds: { 2: { kind: 'work', teeTime: '12:30' }, 3: { kind: 'work', teeTime: '17:14' } } };
  ok(wd.settleAtMin(day2) === 17 * 60 + 14 + 270,
    `★2부 12:30 + 3부 17:14 → ${hm(wd.settleAtMin(day2))} (마지막 라운드 기준)`,
    '2부가 끝났다고 먼저 알리면 3부를 남겨둔 사람에게 두 번 울린다');

  // 순서가 뒤집혀 들어와도 같은 답
  const day3 = { date: '2026-08-23', kind: 'work', teeTime: '17:14',
    rounds: { 3: { kind: 'work', teeTime: '17:14' }, 1: { kind: 'work', teeTime: '06:30' } } };
  ok(wd.settleAtMin(day3) === 17 * 60 + 14 + 270, '라운드 순서가 뒤집혀도 마지막이 기준');

  ok(wd.settleAtMin({ date: '2026-08-23', kind: 'work', rounds: {} }) === null,
    '티오프를 모르면 null', '모르는 걸 마쳤다고 하지 않는다');
}

console.log('\n[★근무 라운드 하나라도 티오프를 모르면 기다린다]');
{
  // 실측(2026-08-23 박수현): 2부 12:25 + 3부(티오프 미상).
  //  아는 티오프만 보면 16:55에 '다 끝났다'가 된다 — 3부를 나가지도 않은 사람에게.
  const half = { date: '2026-08-23', kind: 'work', teeTime: '12:25',
    rounds: { 2: { kind: 'work', teeTime: '12:25' }, 3: { kind: 'work', teeTime: '' } } };
  ok(wd.allWorkTeesKnown(half) === false, '★3부 티오프를 모르면 아직 모른다고 답한다',
    '2부만 보고 16:55에 알리면 3부를 남겨둔 사람에게 거짓말이 된다');
  const full = { date: '2026-08-23', kind: 'work', teeTime: '12:25',
    rounds: { 2: { kind: 'work', teeTime: '12:25' }, 3: { kind: 'work', teeTime: '17:21' } } };
  ok(wd.allWorkTeesKnown(full) === true, '채워지면 안다고 답한다');
  ok(wd.settleAtMin(full) === 17 * 60 + 21 + 270, `그때 마침은 ${hm(wd.settleAtMin(full))}`);
  // 스페어 라운드는 티오프가 없어도 상관없다 — 뛰는 게 아니니 끝날 일도 없다
  const sp = { date: '2026-08-23', kind: 'work', teeTime: '12:25',
    rounds: { 2: { kind: 'work', teeTime: '12:25' }, 3: { kind: 'spare', teeTime: '' } } };
  ok(wd.allWorkTeesKnown(sp) === true, '스페어 라운드는 안 센다');
  ok(srv.includes('if (!wd.allWorkTeesKnown(day)) {'), '틱이 이 문을 지킨다');
  ok(srv.includes('store.waiting'), '기다리는 중이라고 한 번 남긴다',
    '알림이 안 온 이유를 나중에 알 수 있어야 한다');
}

console.log('\n[판정과 알림이 같은 숫자를 보는가]');
{
  const day = { date: '2026-08-23', kind: 'work', teeTime: '17:14', rounds: { 3: { kind: 'work', teeTime: '17:14' } } };
  const at = wd.settleAtMin(day);
  const atMs = (m) => Date.parse('2026-08-23T00:00:00+09:00') + m * 60000;
  ok(wd.isWorkDone(day, atMs(at - 1)) === false, `${hm(at)} 1분 전에는 아직 아니다`);
  ok(wd.isWorkDone(day, atMs(at)) === true, `★${hm(at)} 정각에 마쳐진다`,
    'settleAtMin과 isWorkDone이 어긋나면 "기록됐다"고 알린 뒤 화면엔 안 잡힌다');
  ok(wd.isWorkDone(day, atMs(at + 60)) === true, '그 뒤로도 계속 마친 근무');
  // 근무가 아닌 날은 언제도 아니다
  ok(wd.isWorkDone({ date: '2026-08-23', kind: 'spare', rounds: { 3: { kind: 'spare' } } }, atMs(at + 60)) === false,
    '스페어인 날은 마쳐지지 않는다');
  ok(wd.isWorkDone({ date: '2026-08-23', kind: 'work', excluded: true, teeTime: '17:14' }, atMs(at + 60)) === false,
    '순번에서 빠진 날은 마쳐지지 않는다');
}

console.log('\n[★하루 한 번만 — 라운드마다 울리지 않는가]');
{
  ok(/loadUserJSON\(mem\.id, 'settle-notify\.json', \{\}\)/.test(srv), '회원별 발송 기록을 둔다');
  ok(/if \(store\.date === todayISO && store\.at\) continue;/.test(srv),
    '★기록 키가 날짜 하나다 — 부별로 나뉘지 않는다',
    '부별 키였다면 두 탕인 사람에게 두 번 울린다');
  ok(/const at = wd\.settleAtMin\(day\);/.test(srv), '마침 시각은 workday가 정한다');
  ok(/if \(!day \|\| !wd\.isWorkDone\(day\)\) continue;/.test(srv), '마친 근무일 때만 보낸다');
}

console.log('\n[함부로 울리지 않는가]');
{
  ok(/if \(late > SETTLE_GRACE_MIN\)/.test(srv), '★한참 지난 일은 알리지 않는다',
    '서버가 오래 멈췄다 켜졌을 때 어제 같은 알림이 새벽에 몰려가면 안 된다');
  ok(/saveUserJSON\(mem\.id, 'settle-notify\.json', \{ \.\.\.mark, skipped/.test(srv),
    '생략해도 보낸 것으로 표시한다', '안 그러면 5분마다 같은 판단을 다시 한다');
  ok(/bypassQuiet: h >= 7/.test(srv), '★조용시간이라도 저녁엔 보낸다',
    '3부 마지막 티오프면 마치는 시각이 23시다 — 자는 사람이 아니라 방금 일 끝낸 사람이다');
  ok(/const SETTLE_NOTIFY_ON = !\['0', 'false', 'no'\]/.test(srv), '끄는 문이 있다(SETTLE_NOTIFY=0)');
  ok(/setInterval\(checkSettleNotices, 5 \* 60 \* 1000\)/.test(srv), '5분마다 본다');
  const at = srv.indexOf('async function checkSettleNotices');
  const head = srv.slice(0, at).replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, '');
  let d = 0; for (const c of head) { if (c === '{') d++; else if (c === '}') d--; }
  ok(d === 0, '★최상위에 있다 — 틱이 최상위에서 부른다');
}

console.log('\n[알림이 무엇을 말하는가]');
{
  ok(/title: '오늘 수익이 자동 기록되었습니다'/.test(srv), '제목이 무슨 일이 있었는지 말한다');
  ok(/정확하게 기재되었는지 확인하세요/.test(srv), '무엇을 하면 되는지 말한다');
  ok(/url: '\/#settle'/.test(srv), '★누르면 정산 화면으로 간다', "확인하라고 해놓고 어디서 확인할지 안 알려주면 안 된다");
  ok(/ledger\.daySettle\(todayISO, mem\.id\)/.test(srv), '금액은 정산과 같은 함수에서 가져온다',
    '알림이 따로 세면 알림과 화면의 숫자가 갈라진다');
  ok(/notifyPartLabel\(p\)/.test(srv), '어느 부인지 말한다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
