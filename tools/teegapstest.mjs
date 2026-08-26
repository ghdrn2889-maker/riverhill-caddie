// 티오프 빈칸 검사 — 실제로 무는지 표로 확인한다.
//  ★이 검사가 없어서 2부 IN 열이 빠진 날들이 조용히 지나갔다. 그러니 '있다'가 아니라 '문다'를 증명한다.
import { teeGaps } from '../src/boardreader.mjs';

const T = [
  // [이름, tee, cut, 기대]
  ['8/20 2부 판독 당시(IN 열 잘림)',
    [1, 4, 6, 8, 9, 10, 12, 13, 14, 15].map((p) => ({ pos: p, time: '12:00', course: 'OUT' })), 16, [2, 3, 5, 7, 11, 16]],
  ['8/20 2부 채운 뒤',
    Array.from({ length: 16 }, (_, i) => ({ pos: i + 1, time: '12:00', course: i % 2 ? 'IN' : 'OUT' })), 16, []],
  ['8/20 1부(멀쩡)',
    Array.from({ length: 15 }, (_, i) => ({ pos: i + 1, time: '06:30', course: 'OUT' })), 15, []],
  ['스페어는 안 센다(컷 20·티오프 20, 명단 31)',
    Array.from({ length: 20 }, (_, i) => ({ pos: i + 1, time: '17:00', course: 'OUT' })), 20, []],
  ['꼬리 누락(3부 하단 잘림)',
    Array.from({ length: 16 }, (_, i) => ({ pos: i + 1, time: '17:00', course: 'OUT' })), 20, [17, 18, 19, 20]],
  ['컷 0 = 알 수 없음 → 아무 말 안 함', [], 0, []],
  ['티오프 없음 + 컷 3', [], 3, [1, 2, 3]],
  ['순번 0·음수는 무시', [{ pos: 0, time: '17:00' }, { pos: -1, time: '17:00' }, { pos: 2, time: '17:00' }], 2, [1]],
  ['중복 순번이 있어도 빈칸 계산은 그대로',
    [{ pos: 1, time: '17:00' }, { pos: 1, time: '17:00' }, { pos: 3, time: '17:00' }], 3, [2]],
  // ★2026-08-26에 배운 것 — '칸이 있다'는 '시각을 읽었다'가 아니다.
  //  순번만 세던 옛 계산은 시각이 빈 칸도 채워진 것으로 세어 "구멍 없음"이라 답했고,
  //  정작 그 순번의 캐디는 앱에서 티오프가 빈 채로 하루를 보냈다.
  ['순번은 있는데 시각이 없으면 빈칸이다',
    [{ pos: 1, time: '17:00' }, { pos: 2, time: '' }, { pos: 3 }], 3, [2, 3]],
  ['시각 형식이 깨진 칸도 빈칸이다',
    [{ pos: 1, time: '17:00' }, { pos: 2, time: '18:0' }, { pos: 3, time: '오후 6시' }], 3, [2, 3]],
];

let bad = 0;
for (const [name, tee, cut, want] of T) {
  const got = teeGaps(tee, cut);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? '  OK ' : '  ✗  '} ${name.padEnd(34)} 컷${String(cut).padStart(3)} → [${got.join(',')}]${ok ? '' : `  기대 [${want.join(',')}]`}`);
}
console.log(bad ? `\n${bad}건 실패` : `\n${T.length}건 전부 통과`);
process.exit(bad ? 1 : 0);
