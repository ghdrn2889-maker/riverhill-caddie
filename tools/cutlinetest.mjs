// 확정선 검사 — '○○님까지 근무'와 'N팀'이 어긋날 때 어느 쪽을 믿는가.
//
//  ★2026-08-21 실사고: "금일 3부 27팀, 장성원님까지 근무됩니다."
//   장성원은 26번인데 코드가 큰 쪽(27팀)을 골라, 27번 조하빈이 앱에서만 근무로 보였다.
//   검수·대조표는 커트 26을 읽어 스페어였다 — 한 사람이 화면마다 다르게 보였다.
//  팀수는 순번 단위와 어긋난다(인턴·캐디 없는 팀). 사람 이름이 적힌 문장이 언제나 더 정확하다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyVerdict } from '../src/today.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const DAY = '2026년 8월 21일 금요일';
const article = { id: '27495', subject: '금일 3부 27팀, 장성원님까지 근무됩니다.', writeDate: Date.now() };
// 배치표 스냅샷: 26번까지 티오프, 조하빈 27번.
const grid = Array.from({ length: 26 }, (_, i) => ({ pos: i + 1, time: `1${6 + Math.floor(i / 9)}:${String((i * 7) % 60).padStart(2, '0')}`, course: i % 2 ? 'IN' : 'OUT' }));
const prevOf = (pos, status = 'spare') => ({ date: DAY, name: '아무개', part: '3부', myPosition: pos, status, teeTime: '', course: '', teeGrid: grid, cutLine: 26, cutoffPosition: 26 });
const vd = ({ tc, cut = 0, name = '' }) => ({
  date: DAY, part: '3부', category: '배치표', relevant: true,
  teamCount: tc, cutoffPosition: cut || null, cutoffName: name, cutoffAnnounced: !!cut,
  myPosition: 0, myStatus: '', teeTime: '', course: '', teeGrid: grid,
});
const run = (prev, verdict) => applyVerdict(prev, verdict, article, {}).next;

console.log('\n[★실사고 — 팀수가 이름보다 클 때]');
{
  // "27팀, 장성원(26번)님까지" → 27번은 스페어여야 한다.
  const n = run(prevOf(27, 'spare'), vd({ tc: 27, cut: 26, name: '장성원' }));
  ok(n.status === 'spare', '27번은 스페어로 남는다', `지금 ${n.status} — 앱에서만 근무로 보이던 그 자리`);
  ok(n.cutLine === 26, '확정선은 26 — 팀수 27이 못 밀어 올린다', `지금 ${n.cutLine}`);
  ok(!n.teeTime, '티오프는 비어 있다');
  const n26 = run(prevOf(26, 'spare'), vd({ tc: 27, cut: 26, name: '장성원' }));
  ok(['work', 'assigned'].includes(n26.status), '26번(장성원 본인)은 근무다', '경계 안쪽까지 같이 내리면 안 된다');
}

console.log('\n[팀수가 이름보다 작을 때 — 예전 사고도 그대로 막혀 있나]');
{
  // 2026-08-17: "팀수 23인데 확정선 34번" — 확정 근무자를 스페어로 내리던 자리.
  const big = Array.from({ length: 34 }, (_, i) => ({ pos: i + 1, time: '17:00', course: 'OUT' }));
  const prev = { ...prevOf(34, 'assigned'), teeGrid: big, teeTime: '18:31', cutLine: 34, cutoffPosition: 34 };
  const n = run(prev, { ...vd({ tc: 23, cut: 34, name: '연승준' }), teeGrid: big });
  ok(['work', 'assigned'].includes(n.status), '34번은 근무를 지킨다', `지금 ${n.status} — 팀수 23이 못 끌어내린다`);
  ok(n.cutLine === 34, '확정선은 34');
  ok(n.teeTime === '18:31', '티오프가 지워지지 않는다');
}

console.log('\n[이름이 없으면 팀수를 쓴다]');
{
  const a = run(prevOf(27, 'spare'), vd({ tc: 27 }));
  ok(['work', 'assigned'].includes(a.status), '확정선 문구가 없으면 27팀이 기준 — 27번 근무');
  ok(a.cutLine === 27, '확정선은 팀수 27');
  const b = run(prevOf(28, 'spare'), vd({ tc: 27 }));
  ok(b.status === 'spare', '28번은 스페어');
}

console.log('\n[문구 — 무엇을 근거로 바뀌었는지 말해준다]');
{
  const m = applyVerdict(prevOf(27, 'work'), vd({ tc: 27, cut: 26, name: '장성원' }), article, {}).change.message;
  ok(/장성원님까지 근무/.test(m), '이름을 그대로 알린다', `지금: ${m}`);
  ok(!/27팀/.test(m), '쓰지도 않은 팀수를 근거로 대지 않는다',
    '"27팀이라 스페어"라고 하면 회원이 납득할 수 없다');
  const m2 = applyVerdict(prevOf(27, 'spare'), vd({ tc: 27 }), article, {}).change.message;
  ok(/현재 3부 27팀/.test(m2), '이름이 없을 땐 팀수를 근거로 든다', `지금: ${m2}`);
}

console.log('\n[소스 — max로 되돌아가지 않게]');
{
  const src = read('src/today.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(!/Math\.max\(tc, annCut\)/.test(src), '★팀수와 확정선을 max로 섞지 않는다',
    '큰 쪽을 고르면 이름이 적힌 문장을 팀수가 덮는다 — 8/21 조하빈 사고가 그것이다');
  ok(/annCut > 0 \? annCut : tc/.test(src), '이름이 있으면 이름, 없으면 팀수');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
