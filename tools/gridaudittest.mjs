// 티오프표 자가 검산 — 표가 스스로 어긋남을 고발하는지 본다.
//  기준 데이터는 2026-08-23 #27554 실사고다. 원본 사진과 오독본을 나란히 넣고,
//  "원본은 조용하고 오독본은 시끄러운가"만 묻는다.
import { auditTeeGrid } from '../src/judge.mjs';

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

const g = (arr) => arr.map(([pos, time, course]) => ({ pos, time, course }));

// ── 8/23 3부 원본(사진 그대로) — 16팀, 인턴 4칸 ──
const TRUE_GRID = g([
  [1, '16:32', 'IN'], [2, '16:39', 'OUT'], [3, '16:39', 'IN'],
  [4, '16:46', 'OUT'], [5, '16:46', 'IN'], [6, '16:53', 'OUT'],
  [7, '16:53', 'IN'], [8, '17:00', 'OUT'], [9, '17:00', 'IN'],
  [10, '17:07', 'OUT'], [11, '17:07', 'IN'], [12, '17:14', 'IN'],
  [13, '17:21', 'OUT'], [14, '17:21', 'IN'], [15, '17:28', 'OUT'],
  [16, '17:35', 'OUT'],
]);
// ── 같은 날 오독본 — 16:53 OUT 한 칸을 놓쳐 6~10이 밀리고 16번이 떨어져 나갔다 ──
const BAD_GRID = g([
  [1, '16:32', 'IN'], [2, '16:39', 'OUT'], [3, '16:39', 'IN'],
  [4, '16:46', 'OUT'], [5, '16:46', 'IN'], [6, '16:53', 'IN'],
  [7, '17:00', 'OUT'], [8, '17:00', 'IN'], [9, '17:07', 'OUT'],
  [10, '17:35', 'OUT'], [11, '17:07', 'IN'], [12, '17:14', 'IN'],
  [13, '17:21', 'OUT'], [14, '17:21', 'IN'], [15, '17:28', 'OUT'],
]);

console.log('\n── 원본은 조용해야 한다 ──');
{
  const v = { teeGrid: TRUE_GRID, cutoffPosition: 16, internTees: [
    { time: '17:14', course: 'OUT' }, { time: '17:28', course: 'IN' },
    { time: '18:03', course: 'IN' }, { time: '18:31', course: 'OUT' }] };
  const f = auditTeeGrid(v);
  ok(f === null, '사진 그대로의 표는 아무 말도 하지 않는다');
  ok(!v._gridFlaw, '표식도 남기지 않는다');
}
{ // 인턴은 순번을 먹지 않으므로 구멍을 만들지 않는다 — 노란 칸 4개가 있어도 1~16은 빈틈없다.
  const v = { teeGrid: TRUE_GRID, cutoffPosition: 16, internCount: 4 };
  ok(auditTeeGrid(v) === null, '노란 칸(인턴)은 구멍으로 세지 않는다', '인턴은 티오프 칸만 먹고 순번은 안 먹는다');
}

console.log('\n── 8/23 오독본은 시끄러워야 한다 ──');
{
  const v = { teeGrid: BAD_GRID, cutoffPosition: 16 };
  const f = auditTeeGrid(v);
  ok(!!f, '오독본을 잡아낸다', '이걸 못 잡으면 8/23이 그대로 되풀이된다');
  ok(!!f && JSON.stringify(f.holes) === '[16]', '커트 16번에 티오프가 없다는 걸 짚는다');
  ok(!!f && (f.backsteps || []).length === 1, '10번 17:35 → 11번 17:07 역행을 짚는다');
  ok(!!f && /10번 17:35/.test(f.backsteps[0]), '어느 칸끼리 어긋났는지 말한다', f && f.backsteps && f.backsteps[0]);
  ok(!!v._gridFlaw && /16번에 티오프가 없/.test(v._gridFlaw.text), '사람이 읽을 문장으로 남는다', v._gridFlaw && v._gridFlaw.text);
}

console.log('\n── 한 칸에 순번이 둘이면 잡는다 ──');
{ // 2026-08-10 실데이터: 28·29번이 24·25번과 같은 18:31 칸에 얹혀 있었다(같은 칸을 두 번 쓴 판독).
  const v = { teeGrid: g([
    [24, '18:31', 'OUT'], [25, '18:31', 'IN'], [26, '18:38', 'OUT'], [27, '18:38', 'IN'],
    [28, '18:31', 'OUT'], [29, '18:31', 'IN'], [30, '18:38', 'OUT'], [31, '18:38', 'IN']]) };
  const f = auditTeeGrid(v);
  ok(!!f && (f.dups || []).length === 4, '겹친 칸 넷을 모두 짚는다', f && JSON.stringify(f.dups));
  ok(!!f && /18:31 OUT에 24번·28번/.test(f.dups[0]), '어느 칸에 누가 겹쳤는지 말한다', f && f.dups && f.dups[0]);
  ok(!!f && /한 티오프 칸에 순번이 둘/.test(f.text), '문장에도 담긴다');
}
{ // 2026-08-12 실데이터: 26·27번이 같은 18:45 IN.
  const v = { teeGrid: g([[23, '18:31', 'OUT'], [24, '18:31', 'IN'], [25, '18:45', 'OUT'], [26, '18:45', 'IN'], [27, '18:45', 'IN']]) };
  const f = auditTeeGrid(v);
  ok(!!f && (f.dups || []).length === 1, '한 칸만 겹쳐도 잡는다');
}
{ // OUT과 IN은 서로 다른 칸이다 — 같은 시각이라고 겹친 게 아니다.
  const v = { teeGrid: g([[1, '16:32', 'OUT'], [2, '16:32', 'IN'], [3, '16:39', 'OUT'], [4, '16:39', 'IN']]) };
  ok(auditTeeGrid(v) === null, '같은 시각 OUT·IN은 겹침이 아니다', '두 코스는 별개 칸이다');
}

console.log('\n── 헛경보를 만들지 않는다 ──');
{ // 부분 크롭: 앞쪽 10칸만 읽힌 표. '어긋남'이 아니라 '못 읽음'이라 여기서 다룰 문제가 아니다.
  const v = { teeGrid: TRUE_GRID.slice(0, 10), cutoffPosition: 16 };
  ok(auditTeeGrid(v) === null, '앞부분만 읽힌 크롭은 구멍으로 몰지 않는다', '못 읽은 표와 어긋난 표는 다르다');
}
{ // 구멍이 무더기면 판독 실패다 — 한두 칸 놓친 것과 구분한다.
  const v = { teeGrid: TRUE_GRID.filter((x) => ![5, 7, 9, 11].includes(x.pos)), cutoffPosition: 16 };
  const f = auditTeeGrid(v);
  ok(!f || !f.holes, '구멍이 넷이면 구멍으로 신고하지 않는다');
}
{ // 커트를 모르면 구멍은 판별 불가 — 그래도 역행은 시각만으로 알 수 있다.
  const v = { teeGrid: BAD_GRID };
  const f = auditTeeGrid(v);
  ok(!!f && !f.holes, '커트를 모르면 구멍은 말하지 않는다');
  ok(!!f && f.backsteps.length === 1, '커트를 몰라도 역행은 잡는다', '시각 순서는 컷과 무관한 사실이다');
}
{ // 표를 거의 못 읽었으면 침묵. 이때 소리치면 매 판독마다 늑대가 온다.
  ok(auditTeeGrid({ teeGrid: TRUE_GRID.slice(0, 3), cutoffPosition: 16 }) === null, '3칸 이하는 검산하지 않는다');
  ok(auditTeeGrid({ teeGrid: [] }) === null, '빈 표는 검산하지 않는다');
  ok(auditTeeGrid(null) === null, 'verdict가 없으면 조용하다');
}
{ // 컷 대신 팀 수만 있는 날.
  const v = { teeGrid: BAD_GRID, teamCount: 16 };
  const f = auditTeeGrid(v);
  ok(!!f && JSON.stringify(f.holes) === '[16]', '커트가 없으면 팀 수로 근무선을 본다');
  ok(!!f && f.cut === 16, '어느 근무선으로 쟀는지 남긴다');
}
{ // 고쳐지면 표식이 지워져야 한다 — 안 지우면 교정한 배치표가 영영 '이상한 표'로 남는다.
  const v = { teeGrid: BAD_GRID, cutoffPosition: 16 };
  auditTeeGrid(v);
  ok(!!v._gridFlaw, '먼저 표식이 붙는다');
  v.teeGrid = TRUE_GRID;
  auditTeeGrid(v);
  ok(!v._gridFlaw, '고치면 표식이 사라진다', '한 번 붙은 경고가 안 없어지면 아무도 안 보게 된다');
}
{ // 순번이 시각과 같이 가는 정상 표에 시각 없는 칸이 섞여도 흔들리지 않는다.
  const v = { teeGrid: [...TRUE_GRID, { pos: 17, time: '', course: 'IN' }], cutoffPosition: 16 };
  ok(auditTeeGrid(v) === null, '시각 없는 칸은 무시한다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
