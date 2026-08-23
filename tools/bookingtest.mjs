// 예약 구성판 검사 — '재미있는 거짓말'이 되지 않게 지키는 선들.
//  이 화면은 예약팀장이 짜고, 관리자가 승인하면 회원 13명의 카드가 실제로 바뀐다.
//  그러니 여기서 지켜야 할 것은 두 가지다.
//   ① 앱과 같은 규칙으로 계산하는가(찬 칸 시각순 → 순번 1..N, 인턴 칸은 세되 짝짓지 않는다)
//   ② 손대지 않은 부를 조용히 덮지 않는가
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBooking } from './gen-booking.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => {
  if (c) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const cli = read('tools/booking-client.js');
const mon = read('src/monitor.mjs');

const J = {
  dateKey: '20260824', dateLabel: '8월 24일',
  sched: { cadence: 7, parts: { 1: { first: '06:23', last: '08:50' }, 2: { first: '11:00', last: '13:00' }, 3: { first: '16:32', last: '18:38' } } },
  parts: {
    3: {
      roster: ['가나다', '라마바', '사아자', '차카타'],
      teeGrid: [{ pos: 1, time: '16:32', course: 'OUT' }, { pos: 2, time: '16:32', course: 'IN' }],
      internTees: [{ time: '16:39', course: 'OUT' }],
      cutLine: 2,
    },
  },
};

console.log('\n[화면이 만들어지는가]');
{
  const html = renderBooking(J, { admin: false });
  ok(html.includes('예약 구성판'), '연습용 화면이 나온다');
  ok(!html.includes('id="applyBtn"'), '★손님 링크에는 반영 버튼이 없다',
    'admin=1을 뺀 주소를 넘기면 연습만 된다 — 이게 예약팀장에게 링크를 줄 수 있는 근거다');
  const adm = renderBooking(J, { admin: true });
  ok(adm.includes('id="applyBtn"'), '관리자 링크에는 반영 버튼이 있다');
  const smp = renderBooking(J, { admin: true, sample: true });
  ok(smp.includes('샘플'), '견본은 견본이라고 말한다', '샘플을 라이브로 착각해 한나절을 헛돈 적이 있다');
  ok(adm.includes('16:32|OUT') || adm.includes('window.__BOOK'), '배치표가 화면 안에 실려 간다');
}

console.log('\n[앱과 같은 규칙으로 세는가]');
{
  ok(/filter\(\(k\) => !s\.intern\.has\(k\)\)/.test(cli),
    '★인턴 칸은 순번에서 뺀다', '팀은 있지만 캐디 순번을 먹지 않는다 — 여기가 틀리면 전원이 한 칸씩 밀린다');
  ok(/a\.mins - b\.mins \|\| \(a\.course === 'OUT' \? -1 : 1\)/.test(cli),
    '시각순, 같은 시각이면 아웃 먼저');
  ok(/const cut = seats\.length;/.test(cli), '찬 칸 수가 곧 근무선이다');
}

console.log('\n[손대지 않은 부를 덮지 않는가]');
{
  ok(/const partSnap =/.test(cli) && /touched\.push\(p\)/.test(cli),
    '★클라이언트가 손댄 부를 가려낸다');
  ok(/if \(apply && !body\.touched\.length\)/.test(cli), '바꾼 게 없으면 반영을 부르지 않는다');
  ok(/if \(!touched\.includes\(String\(p\)\)\) continue;/.test(mon),
    '★서버도 손댄 부만 회원 앱으로 보낸다',
    '화면이 세 부를 한꺼번에 들고 있다 — 1부만 고쳐도 3부가 그대로 실려 온다');
  const i = mon.indexOf("app.post('/api/booking-save'");
  const seg = mon.slice(i, mon.indexOf("app.post('/api/daejo-save'", i));
  ok(/saveSandbox\(date, sb,/.test(seg) && seg.indexOf('saveSandbox') < seg.indexOf('if (!apply)'),
    '테스트판 저장이 먼저다 — 반영은 그 다음 갈림길');
  ok(/const apply = req\.body\?\.apply === true && String\(req\.query\.admin \|\| ''\) === '1';/.test(seg),
    '★반영은 관리자 링크로 들어온 요청만',
    '손님이 개발자도구로 apply:true를 넣어도 admin=1이 없으면 테스트판까지만 간다');
  ok(/notify: false/.test(seg), '반영해도 알림은 보내지 않는다',
    '시험 삼아 눌러보는 화면이다 — 카드가 조용히 바뀌는 것과 13명 폰이 울리는 것은 다르다');
}

console.log('\n[반영 뒤에 같은 일을 또 하지 않는가]');
{
  ok(/let BASE = snap\(\);/.test(cli) && /BASE = snap\(\); undo\.length = 0;/.test(cli),
    '★반영에 성공하면 거기가 새 출발선이다', '안 그러면 같은 변경을 두 번 반영하게 된다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
