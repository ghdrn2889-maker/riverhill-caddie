// 남의 부 시간이 이 부 표에 남아 있지 않은가.
//
//  2026-08-27: 3부 티오프표에 12:04·13:35·13:42가 들어 있었다. 셋 다 2부 열에서 번진 값이고
//   (12:04는 실제로 도대영의 2부 티오프였다), 3부는 16:25부터 돈다 — 있을 수 없는 시각이다.
//
//  ★두 화면이 각자 다르게 거짓말을 했다. 이게 이 검사가 있는 이유다.
//   - 대조판은 7분 격자 위에 사람을 놓는다 → 격자에 없는 칸을 가진 사람은 놓을 자리가 없어
//     화면에서 통째로 사라진다("서동환이 없어졌다").
//   - 앱 배치표는 명단을 그대로 그린다 → 이름은 뜨고 옆에 없는 시각이 붙는다.
//   같은 데이터인데 한쪽은 사람을 지우고 한쪽은 거짓 시각을 보여줬다.
//
//  ★_offGridTees는 이미 이걸 보고 관리자 알림까지 보내고 있었다. 보고도 저장한 게 문제였다 —
//   보고만 하는 검사는 사람이 그 알림을 읽을 때까지 거짓값을 살려둔다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partWindow, inPartWindow } from '../src/parts.mjs';
import { dropForeignPartTees } from '../src/boardreader.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 부 시간창은 한 곳에만 산다 ──');
{
  const J = read('src/judge.mjs');
  ok(/export \{ partWindow \};/.test(J), '★judge.mjs는 다시 내보내기만 한다',
    'judge는 boardreader를 import한다 — 여기 두면 판독기가 쓸 때 순환이 된다');
  ok(/import \{ partWindow \} from '\.\/parts\.mjs';/.test(J), 'parts.mjs에서 받아온다');
  ok(!/^export function partWindow/m.test(J), 'judge에 사본이 남아 있지 않다',
    '같은 지식의 두 사본은 조용히 갈라진다 — 이 저장소가 반복해 겪은 사고다');
  const P = read('src/parts.mjs');
  ok(!/^import /m.test(P), '★parts.mjs는 아무것도 import하지 않는다', '바닥 모듈이라야 누구나 쓸 수 있다');
  ok(partWindow('1').min === 5 && partWindow('2').min === 10 && partWindow('3').min === 16, '창 값이 그대로다');
}

console.log('\n── inPartWindow: 모르는 것과 틀린 것을 구분한다 ──');
{
  ok(inPartWindow('16:25', '3') === true, '3부 16:25는 안이다');
  ok(inPartWindow('12:04', '3') === false, '★3부 12:04는 밖이다');
  ok(inPartWindow('13:42', '3') === false, '3부 13:42도 밖이다');
  ok(inPartWindow('12:04', '2') === true, '같은 12:04도 2부에서는 안이다', '값이 나쁜 게 아니라 자리가 틀린 것이다');
  ok(inPartWindow('', '3') === null, '★못 읽은 시각은 null — 판단하지 않는다',
    "모르는 것을 틀린 것으로 취급하면 멀쩡한 칸을 버린다");
  ok(inPartWindow('없음', '3') === null, '시각이 아니면 null');
}

console.log('\n── dropForeignPartTees: 시각만 버리고 사람은 남긴다 ──');
{
  const parts = {
    3: { roster: ['가', '나', '다', '라'], cut: 4,
      tee: [{ pos: 1, time: '16:25', course: 'OUT' }, { pos: 2, time: '12:04', course: 'IN' },
        { pos: 3, time: '17:30', course: 'OUT' }, { pos: 4, time: '13:42', course: 'IN' }] },
    2: { roster: ['마'], cut: 1, tee: [{ pos: 1, time: '12:32', course: 'OUT' }] },
  };
  const out = dropForeignPartTees(parts);
  ok(out.length === 1 && out[0].part === '3', '★3부에서만 버렸다');
  ok(out[0].dropped.length === 2, `두 칸을 버렸다 (${out[0].dropped.join(' · ')})`);
  ok(parts[3].tee.length === 2, '3부에 두 칸이 남았다');
  ok(parts[3].tee.some((t) => t.time === '17:30'),
    '★7분 격자 밖(17:30)은 안 버린다',
    '예약팀이 팀을 더 받으려 끼운 칸일 수 있다 — 격자 밖과 남의 부는 다른 것이다');
  ok(parts[3].roster.length === 4, '★사람은 그대로 넷이다',
    "사람을 지우면 그 순번이 통째로 없어진다 — 버리는 건 시각뿐이다");
  ok(parts[2].tee.length === 1, '2부 12:32는 멀쩡히 남았다');
  ok(out[0].window === '16~24시', '어느 창인지 말해준다');

  // 버릴 게 없으면 손대지 않는다
  const clean = { 3: { roster: ['가'], tee: [{ pos: 1, time: '16:25', course: 'OUT' }] } };
  ok(dropForeignPartTees(clean).length === 0 && clean[3].tee.length === 1, '멀쩡한 표는 안 건드린다');
  ok(dropForeignPartTees({}).length === 0 && dropForeignPartTees(null).length === 0, '빈 입력에도 안 터진다');
}

console.log('\n── 채택 자리에 걸려 있는가 ──');
{
  const B = read('src/boardreader.mjs');
  const i = B.indexOf('export function raiseAdoptedBoardIssues');
  ok(i > 0, '채택 확정본 점검 자리를 찾았다');
  const fn = B.slice(i, i + 1600);
  ok(/for \(const f of dropForeignPartTees\(parts\)\) \{/.test(fn), '★채택본에서 부른다');
  const drop = fn.indexOf('dropForeignPartTees(parts)');
  const holes = fn.indexOf('_rosterHoles(pd.roster');
  ok(drop > 0 && holes > 0 && drop < holes,
    '★세기 전에 버린다', '버린 뒤에 세야 그 다음 검사가 진짜 구멍을 본다');
  ok(/kind: 'foreign_part_tee'/.test(fn), '관리자에게 알린다');
  ok(/case 'foreign_part_tee':/.test(read('src/boardalert.mjs')), '그 알림에 제 문구가 있다',
    "문구가 없으면 default로 빠져 '판독 이상'이라고만 뜬다");
  ok(/있을 수 없는 시각입니다/.test(read('src/boardalert.mjs')), '왜 버렸는지 말한다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
