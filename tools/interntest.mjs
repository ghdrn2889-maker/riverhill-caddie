// 인턴 수동 지정 검증 — 수동이 자동을 이기는가, 밀림이 제대로 반영되는가.
import fs from 'node:fs';
import path from 'node:path';
const I = await import('../src/interns.mjs');
const B = await import('../src/kakaobridge.mjs');
const { DATA_DIR } = await import('../src/store.mjs');
const J = JSON.parse(fs.readFileSync(process.env.SRC, 'utf8'));
const D = '20260817';
const line = (n) => console.log('\n── ' + n + ' ' + '─'.repeat(Math.max(0, 52 - n.length)));

const auto = [{ time: '16:39', course: 'OUT' }];      // 판독이 잡았다고 가정한 노란 칸
line('① 수동 없음 → 자동을 따른다');
console.log(' 실효:', I.internTeesFor(D, auto).map((t) => `${t.time}${t.course[0]}`).join(' ') || '(없음)');

line('② 칸 하나 켜기 — 화면에서 누르는 경로');
I.toggle(D, '17:00', 'IN', auto, { by: '테스트' });
console.log(' 실효:', I.internTeesFor(D, auto).map((t) => `${t.time}${t.course[0]}`).join(' '));

line('③ ★자동이 잘못 잡은 칸 끄기 — 합집합이면 못 지운다');
I.toggle(D, '16:39', 'OUT', auto, { by: '테스트' });
const eff = I.internTeesFor(D, auto);
console.log(' 실효:', eff.map((t) => `${t.time}${t.course[0]}`).join(' ') || '(없음)');
console.log(' 자동이 잡은 16:39O가 빠졌나:', eff.some((t) => t.time === '16:39' && t.course === 'OUT') ? '★아니오(문제)' : '예');

line('④ 시각 표기 흔들림 흡수 — "6:39"와 "06:39"');
I.setManual(D, [{ time: '6:39', course: 'out' }, { time: '06:39', course: 'OUT' }], { by: '테스트' });
console.log(' 저장 결과:', I.manualFor(D).tees.map((t) => `${t.time}${t.course}`).join(' '), '(같은 칸 두 번 → 하나로)');

line('⑤ 인턴이 재매칭에 실제로 반영되는가');
I.setManual(D, [{ time: '16:39', course: 'OUT' }, { time: '17:00', course: 'IN' }], { by: '테스트' });
const P3 = J.parts['3'];
const g = B.augmentGrid({ teeGrid: P3.teeGrid, roster: P3.roster, cut: P3.cut, internTees: I.internTeesFor(D, auto) }, J.snap, '3');
console.log(' ' + g.why);
console.log(' 정규 격자:', g.teeGrid.slice(0, 8).map((x) => `${x.pos}:${x.time}${x.course[0]}`).join(' '), '…');
console.log(' 승격:', g.promoted.map((p) => `${p.pos}번 ${p.name}`).join(', ') || '(없음)');

line('⑥ 인턴 없음을 명시할 수 있는가');
I.setManual(D, [], { by: '테스트', note: '인턴 없음' });
console.log(' 실효:', I.internTeesFor(D, auto).length, '칸 (기대 0 — 자동이 잡았어도 관리자가 없다고 하면 없다)');

line('⑦ 해제하면 다시 자동');
I.clearManual(D, '테스트');
console.log(' 실효:', I.internTeesFor(D, auto).map((t) => `${t.time}${t.course[0]}`).join(' ') || '(없음)', '(기대 16:39O — 자동으로 복귀)');
try { fs.unlinkSync(path.join(DATA_DIR, 'intern-tees.json')); } catch {}
