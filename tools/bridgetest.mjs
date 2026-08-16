// 보조 다리 검증 — 거들어야 할 때 거들고, 손대면 안 될 때 손 떼는가.
import fs from 'node:fs';
import path from 'node:path';
const { DATA_DIR } = await import('../src/store.mjs');
const B = await import('../src/kakaobridge.mjs');

// 실데이터: 8/17 카카오 스냅 + 3부 배치표
const J = JSON.parse(fs.readFileSync(process.env.SRC, 'utf8'));
const snap = J.snap;
const P3 = J.parts['3'];
const line = (n) => console.log('\n── ' + n + ' ' + '─'.repeat(Math.max(0, 56 - n.length)));

line('① 정상 보강 — 실제 8/17 (배치표 10칸, 카카오 14칸)');
let r = B.augmentGrid({ teeGrid: P3.teeGrid, roster: P3.roster, cut: P3.cut }, snap, '3');
console.log(' mode:', r.mode, '|', r.why);
console.log(' 채운 칸:', (r.added || []).join(' '));
console.log(' 승격  :', (r.promoted || []).map((p) => `${p.pos}번 ${p.name}`).join(', '));
console.log(' 밀림  :', (r.moved || []).slice(0, 4).map((m) => `${m.from}→${m.to}`).join(' '), '…');

line('② 완전 일치 — 1부(42칸, 카카오도 42칸)');
const P1 = J.parts['1'];
r = B.augmentGrid({ teeGrid: P1.teeGrid, roster: P1.roster, cut: P1.cut }, snap, '1');
console.log(' mode:', r.mode, '|', r.why, '(기대 agree — 채울 게 없다)');

line('③ ★어긋남 — 배치표에만 있는 칸(둘 중 하나가 틀렸다)');
const fake = [...P3.teeGrid, { pos: 99, time: '18:45', course: 'OUT' }];
r = B.augmentGrid({ teeGrid: fake, roster: P3.roster, cut: P3.cut }, snap, '3');
console.log(' mode:', r.mode, '|', r.why, '(기대 conflict — 손대지 않고 사람 부름)');

line('④ ★과다 보강 — 갑자기 많이 늘면 당추가 아니라 고장');
r = B.augmentGrid({ teeGrid: P3.teeGrid.slice(0, 1), roster: P3.roster, cut: 1 }, snap, '3');
console.log(' mode:', r.mode, '|', r.why, '(기대 refuse — 상한 초과)');

line('⑤ 대체 — 사진이 아예 실패했을 때');
r = B.substituteTeamCount(snap, '3');
console.log(' mode:', r.mode, '|', r.why);
console.log(' ★이름은 없다:', r.teeGrid.slice(0, 3).map((x) => `${x.pos}번 ${x.time}${x.course[0]}`).join(' '), '…');

line('⑥ 신뢰 게이트 — 관측이 얕으면 아무것도 안 한다');
const t = B.kakaoTrustworthy('20260817');
console.log(' 신뢰:', t.ok ? '가능' : '불가', t.why ? `(${t.why})` : '');
const t2 = B.kakaoTrustworthy('20991231');
console.log(' 없는 날짜:', t2.ok ? '★가능(문제!)' : `불가 (${t2.why})`);

line('⑦ 토글 — 기본은 꺼져 있어야 한다');
console.log(' assistOn():', B.assistOn(), '(기대 false — 관리자가 켜야 회원에게 반영)');

line('⑧ 태그 — 리버힐 근무 성격이 갈리는가');
for (const c of ['연승준(54)', '남재권(1,3)', '차은경(2,3)', '우겸조(찾근)', '홍길동(조출)', '강혜영']) {
  const t = B.tagOf(c);
  console.log(` ${c.padEnd(12)} 이름 ${t.name.padEnd(5)} 태그 ${(t.tag || '-').padEnd(5)}`
    + ` 무조건근무 ${t.guaranteed ? 'O' : '·'}  중복근무 ${t.cross ? 'O' : '·'}  조출 ${t.early ? 'O' : '·'}`);
}

line('⑨ ★인턴 — 중간에 끼면 그 뒤가 밀리는가');
const slots = B.kakaoSlots(snap, '3');
const noIntern = B.assignPositions(slots, { roster: P3.roster, internTees: [] });
const withIntern = B.assignPositions(slots, { roster: P3.roster, internTees: [{ time: '16:39', course: 'OUT' }, { time: '17:00', course: 'IN' }] });
console.log(' 인턴 없음:', noIntern.slice(0, 8).map((s) => `${s.pos}${s.name}`).join(' '));
console.log(' 인턴 2명:', withIntern.slice(0, 8).map((s) => (s.intern ? '[인턴]' : `${s.pos}${s.name}`)).join(' '));
console.log(' 정규 근무선:', noIntern.filter((s) => !s.intern).length, '→', withIntern.filter((s) => !s.intern).length, '(인턴이 칸을 먹으니 정규는 줄어든다)');

line('⑩ 승격 — 54는 원래 근무라 승격이 아니다');
let g = B.augmentGrid({ teeGrid: P3.teeGrid.slice(0, 8), roster: P3.roster, cut: 8 }, snap, '3');
console.log(' 커트 8 → ' + (g.cut || '-') + ' :', g.mode === 'augment'
  ? (g.promoted.length ? g.promoted.map((p) => `${p.pos}번 ${p.name}(${p.tag || '무태그'})`).join(', ') : '(승격 없음)')
  : g.why);
console.log(' ★4~9번은 전부 (54)라 커트 밖에서도 근무 — 승격 목록에서 빠져야 정상');
