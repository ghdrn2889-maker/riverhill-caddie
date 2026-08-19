// 선언이 '늘려 만든 칸'과 '끼워넣은 칸'이 갈라지는지 — 8/19 3부 18:52 실사고를 그대로 재현한다.
//  ★둘을 못 가르면 "꼬리가 여기까지"라는 말이 "거기 팀이 있다"로 둔갑한다. 그게 그날 일어난 일이다.
import { reframeSlots } from '../src/dayframe.mjs';

// 기준표 3부: 16:32 ~ 18:45, 7분 간격, OUT·IN
const base = [];
for (let t = 16 * 60 + 32; t <= 18 * 60 + 45; t += 7) {
  for (const c of ['OUT', 'IN']) base.push({ part: '3', mins: t, time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, course: c });
}
const K = (s) => `${s.time}|${s.course}`;

let bad = 0;
const check = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '  OK ' : '  ✗  '} ${name}${detail ? '  ' + detail : ''}`); };

// ── 1. 8/19 재현: 3부 last=18:52 선언 ──
{
  const r = reframeSlots(base, { cadence: 7, frame: { 3: { last: '18:52' } } });
  const grown = r.added.filter((s) => !s.inserted).map(K).sort();
  check('꼬리 선언 → 18:52 두 칸이 새로 생긴다', JSON.stringify(grown) === JSON.stringify(['18:52|IN', '18:52|OUT']), `[${grown.join(', ')}]`);
  check('새로 생긴 칸에 inserted 표식이 없다(=끼워넣기가 아니다)', r.added.every((s) => !s.inserted));
  check('기존 칸은 하나도 안 빠진다', r.dropped.length === 0, `빠짐 ${r.dropped.length}`);
  check('18:45는 원래 있던 칸이라 새로 생긴 목록에 없다', !grown.includes('18:45|OUT'));
}

// ── 2. 끼워넣기(extra)는 갈라져야 한다 ──
{
  const r = reframeSlots(base, { cadence: 7, frame: { 3: { extra: ['17:10|OUT'] } } });
  const ins = r.added.filter((s) => s.inserted).map(K);
  const grown = r.added.filter((s) => !s.inserted).map(K);
  check('끼워넣은 칸엔 inserted 표식이 붙는다', JSON.stringify(ins) === JSON.stringify(['17:10|OUT']), `[${ins.join(', ')}]`);
  check('끼워넣기만 했을 땐 늘어난 칸이 없다', grown.length === 0, `[${grown.join(', ')}]`);
}

// ── 3. 둘이 섞여도 갈라진다 ──
{
  const r = reframeSlots(base, { cadence: 7, frame: { 3: { last: '18:52', extra: ['17:10|OUT'] } } });
  const ins = r.added.filter((s) => s.inserted).map(K).sort();
  const grown = r.added.filter((s) => !s.inserted).map(K).sort();
  check('섞여도 끼워넣기는 끼워넣기', JSON.stringify(ins) === JSON.stringify(['17:10|OUT']), `[${ins.join(', ')}]`);
  check('섞여도 늘어난 칸은 18:52 둘', JSON.stringify(grown) === JSON.stringify(['18:52|IN', '18:52|OUT']), `[${grown.join(', ')}]`);
}

// ── 4. 꼬리를 줄이는 선언은 칸을 만들지 않는다 ──
{
  const r = reframeSlots(base, { cadence: 7, frame: { 3: { last: '18:31' } } });
  check('꼬리를 줄이면 새로 생기는 칸이 없다', r.added.length === 0, `새 칸 ${r.added.length}`);
  check('줄인 만큼 빠진다(18:38·18:45 네 칸)', r.dropped.length === 4, `빠짐 ${r.dropped.length}`);
}

// ── 5. 선언이 없으면 아무것도 안 바뀐다 ──
{
  const r = reframeSlots(base, { cadence: 7, frame: {} });
  check('선언 없음 = 그대로', r.added.length === 0 && r.dropped.length === 0 && r.slots.length === base.length);
}

console.log(bad ? `\n${bad}건 실패` : '\n전부 통과');
process.exit(bad ? 1 : 0);
