// 인턴 칸이 앱 배치표까지 가는가 — "대조표엔 있는데 앱엔 없다"가 다시 생기지 않게.
//
//  2026-08-26에 있었던 일: 3부 인턴(17:35 OUT)을 대조판에 넣었는데 앱 배치표에 아무것도 안 떴다.
//   두 군데서 끊겨 있었다. ①대조판 저장은 테스트판(sandbox)으로 가고 board-correct 문을 안 지난다.
//   ②그 문을 지났더라도 앱에는 인턴을 그릴 코드가 아예 없었다(grep intern public/app.js → 0건).
//  ②를 막는 검사다. ①은 관리자가 '반영'을 누르는 문제라 코드로 막을 게 아니다.
//
//  ★인턴은 칸을 '차지'한다 — 겹치는 게 아니라 뒤를 밀어낸다. 그날 8번(17:21) 다음에 인턴이 들어가
//   9번이 17:35 → 18:10으로 밀리고 확정선이 13 → 12가 됐다. 미는 계산은 대조판·검수가 하고,
//   앱은 이미 밀린 표를 그대로 그린다. 앱이 스스로 밀면 앱이 티오프를 지어내는 것이 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoardsView } from '../src/boardsview.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BV = fs.readFileSync(path.join(ROOT, 'src', 'boardsview.mjs'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const HT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 서버: 앱이 받는 값에 인턴이 실린다 ──');
{
  const i = BV.indexOf('const internsFor = (boardInterns, iso, part) => {');
  ok(i > 0, '★인턴을 뽑는 자리가 있다');
  ok(/import \{ internTeesFor \} from '\.\/interns\.mjs';/.test(BV),
    '검수·대조와 같은 함수(internTeesFor)를 쓴다',
    '앱만 따로 계산하면 화면마다 다른 인턴을 보게 된다 — 그게 이번 사고의 모양이다');
  ok(/interns: internsFor\(boardInterns, targetISO, part\),/.test(BV), '부마다 payload에 interns를 담는다');
  ok(/push\(p, d\.roster, d\.teeGrid, cutOf\(d\), d\.cutoffName, teamsOf\(d\), label, d\._at \|\| s\.at, d\.internTees\);/.test(BV),
    '1·2부는 저장소의 internTees를 넘긴다');
  ok(/lb\.dateLabel \|\| v\.dateLabel \|\| '', lb\.at, v\.internTees\);/.test(BV), '3부는 lastboard의 internTees를 넘긴다');

  const parts = buildBoardsView({ labelToISO: () => '' });
  ok(Array.isArray(parts), 'buildBoardsView가 돈다');
  ok(parts.every((p) => Array.isArray(p.interns)), `모든 부에 interns 배열이 있다(부 ${parts.length}개)`,
    '없으면 앱이 undefined를 받아 조용히 아무것도 안 그린다');
}

console.log('\n── 앱: 한 출처에서 받아 그린다 ──');
{
  ok(/function internsOfPart\(part\) \{/.test(JS), '★부별 인턴을 /api\\/boards 한 곳에서 가져온다');
  ok(/interns: internsOfPart\(b\.part\),/.test(JS), '내 부에도 싣는다',
    '내 부만 today.json에서 따로 뽑으면 옆 부와 값이 갈린다');
  ok(/interns: Array\.isArray\(b\.interns\) \? b\.interns : \[\],/.test(JS), '옆 부에도 싣는다');
}

console.log('\n── 앱: 시각 자리에 끼운다(밀지는 않는다) ──');
{
  const i = JS.indexOf('function withInterns(list, interns) {');
  ok(i > 0, '★인턴 줄을 명단 사이에 끼우는 자리가 있다');
  const blk = i > 0 ? JS.slice(i, i + 900) : '';
  ok(/list\.splice\(at, 0, \{ p: 0, nm: '인턴', tee: time, crs, intern: true/.test(blk),
    "인턴은 순번을 안 가진다(p: 0)", '번호를 주면 명단 순번과 뒤섞인다');
  ok(/if \(!Number\.isFinite\(om\) \|\| om > tm\) \{ at = i; break; \}/.test(blk),
    '자기 시각보다 늦은 첫 줄 앞에 선다(대기 줄보다는 앞)');
  ok(!/teeGrid\[.*\]\s*=\s*/.test(blk) && !/\.tee\s*=\s*/.test(blk),
    '앱은 남의 티오프를 고치지 않는다',
    '미는 계산은 대조판·검수가 한다 — 앱이 밀면 앱이 시각을 지어내는 것이 된다');
}

console.log('\n── 앱: 번호 자리에 번호 대신 인턴 ──');
{
  ok(/<span class="fb-nb it">인턴<\/span><span class="fb-nm"><\/span>/.test(JS),
    '★순번순 — 번호 배지에 인턴, 이름 칸은 비움', '인턴은 명단에 없는 사람이라 쓸 이름이 없다');
  ok(/\$\{e\.intern \? '인턴' : e\.p\}/.test(JS), '시간순도 같은 규칙');
  ok(/\$\{e\.intern \? '' : esc\(e\.nm \|\| '—'\)\}/.test(JS), '시간순 이름 칸도 비움');
  ok(/\$\{ic \? ` · 인턴 \$\{ic\}` : ''\}/.test(JS), '확정선 옆에 인턴 수를 붙인다',
    '순번만 세면 팀 수가 안 맞는다 — 인턴은 칸을 쓰고 순번은 안 쓴다');
}

console.log('\n── 스타일: 다른 줄과 같은 동그라미, 색만 노랑 ──');
{
  const i = HT.indexOf('.fb-nb.it {');
  ok(i > 0, '★인턴 배지 규칙이 있다');
  const blk = i > 0 ? HT.slice(i, i + 240) : '';
  ok(!/width:/.test(blk) && !/border-radius:/.test(blk),
    '동그라미를 다시 정의하지 않는다(.fb-nb 26px 원 그대로)',
    '알약으로 늘리면 그 줄만 오와 열이 어긋난다');
  ok(/background:var\(--fbintnb\); color:var\(--fbintnbc\)/.test(blk), '색은 인턴 변수로만');
  ok(/font:850 9px sans-serif/.test(blk), '두 글자가 26px 원에 들어가게 9px', '앱이 이미 쓰는 라벨 크기');
  ok(/--fbintnb:#ffcf1f; --fbintnbc:#3a2a00; \}/.test(HT), '낮 하늘 노랑이 정의돼 있다');
  ok(/--fbintnb:#ffd233; --fbintnbc:#2a1e00; \}/.test(HT), '밤 하늘 노랑이 따로 정의돼 있다',
    '밤엔 노랑이 더 튄다 — 한 색으로 두면 한쪽이 깨진다');
  ok(!/\.fb-row\.intern/.test(HT) && !/\.fb-brow\.intern/.test(HT),
    '줄 전체를 칠하지 않는다', '배경·테두리·레일까지 노랗게 하면 촌스럽다(사용자 판단)');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
