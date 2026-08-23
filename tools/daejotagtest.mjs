// 대조판 부 태그 — 8/20 "조하빈(1,3)" 사고를 그대로 재현해 다시는 안 나는지 본다.
//  ★사본을 짜서 시험하면 시험만 통과한다. 그래서 daejo-client.js 원문에서 함수를 뽑아 돌린다.
//   (브라우저 스크립트라 통째로는 못 돌린다 — 필요한 조각만 이름으로 집어낸다.)
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./daejo-client.js', import.meta.url), 'utf8');
const grab = (re, label) => {
  const m = SRC.match(re);
  if (!m) { console.error(`원문에서 ${label}을(를) 못 찾았습니다 — 이름이 바뀌었으면 테스트도 같이 고치세요.`); process.exit(2); }
  return m[0];
};
const PIECES = [
  grab(/^ {2}const bare = .*$/m, 'bare'),
  grab(/^ {2}const tagOf = .*$/m, 'tagOf'),
  grab(/^ {2}const PART_TAG_RE = .*$/m, 'PART_TAG_RE'),
  grab(/^ {2}const partsWord = .*$/m, 'partsWord'),
  grab(/^ {2}const tagRank = .*$/m, 'tagRank'),
  grab(/^ {2}const nkd = .*$/m, 'nkd'),
  grab(/^ {2}const nk = .*$/m, 'nk'),
  grab(/^ {2}const placedIn = .*$/m, 'placedIn'),
  grab(/^ {2}const elsewhere = .*$/m, 'elsewhere'),
  grab(/^ {2}const ownTag = [\s\S]*?\n {2}\};$/m, 'ownTag'),
  grab(/^ {2}function retagParts[\s\S]*?\n {2}\}$/m, 'retagParts'),
].join('\n');

// eslint-disable-next-line no-new-func
const make = new Function('PARTS', 'roster', 'BOARD', `${PIECES}\nreturn { retagParts, ownTag, elsewhere };`);
const PARTS = ['1', '2', '3'];
const load = (roster, board = {}) => {
  const R = {}; for (const p of PARTS) R[p] = (roster[p] || []).slice();
  const B = {}; for (const p of PARTS) B[p] = { roster: (board[p] || roster[p] || []).slice() };
  return { R, api: make(PARTS, R, B) };
};

let bad = 0;
const check = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '  OK ' : '  X  '} ${name}${detail ? '   ' + detail : ''}`); };

// 8/20 실제 배치 — 1부 5번 서동명(1,3) · 2부 9번 박선하 · 3부 30번 조하빈.
const BASE = () => ({
  1: ['가1', '가2', '가3', '가4', '서동명(1,3)', '표승완(54)', '우겸조(찾근)'],
  2: ['나1', '나2', '나3', '나4', '나5', '나6', '나7', '나8', '박선하', '나10'],
  3: ['표승완(54)', '다2', '다3', '다4', '서동명', '다6', '조하빈'],
});

// ── 1. 사고 재현: 2부 9번을 조하빈으로 바꾸면 (2,3)이 나와야 한다 ──
{
  const { R, api } = load(BASE());
  R['2'][8] = '조하빈';                                  // ★이름 편집이 앞사람 태그를 안 물려준 상태
  const log = api.retagParts('2');
  check('2부 9번 조하빈 → (2,3)으로 스스로 붙는다', R['2'][8] === '조하빈(2,3)', R['2'][8]);
  check('무엇을 바꿨는지 말한다', /조하빈/.test(log.join('')) && /2,3/.test(log.join('')), log.join(' | '));
  check('손 안 댄 3부는 안 건드린다', R['3'][6] === '조하빈', R['3'][6]);
}

// ── 2. 앞사람 태그가 남아 있어도 실제 배치대로 고쳐 쓴다 ──
{
  const { R, api } = load(BASE());
  R['2'][8] = '조하빈(1,3)';                             // 옛 버전이 만들어 놓은 값(테스트판에 실제로 박힌 글자)
  api.retagParts('2');
  check('박혀 있던 (1,3)을 (2,3)으로 바로잡는다', R['2'][8] === '조하빈(2,3)', R['2'][8]);
}

// ── 3. 깎아내리지 않는다 — 판독이 읽은 (54)는 그대로 ──
{
  const { R, api } = load(BASE());
  api.retagParts('1', '3');
  check('표승완(54)은 1·3부에만 보여도 (54) 유지', R['1'][5] === '표승완(54)' && R['3'][0] === '표승완(54)', `${R['1'][5]} / ${R['3'][0]}`);
}

// ── 4. 근태성 태그는 파생 대상이 아니다 ──
{
  const { R, api } = load(BASE());
  api.retagParts('1');
  check('(찾근)은 건드리지 않는다', R['1'][6] === '우겸조(찾근)', R['1'][6]);
}

// ── 5. 태그를 지우지는 않는다 — 안 보이는 부는 '없다'가 아니라 '모른다' ──
{
  const b = BASE(); b['3'] = b['3'].filter((x) => !/서동명/.test(x));   // 3부에서 사라짐
  const { R, api } = load(b);
  api.retagParts('1');
  check('한 부에만 남아도 (1,3)을 떼지 않는다', R['1'][4] === '서동명(1,3)', R['1'][4]);
}

// ── 6. 세 부가 다 안 올라온 날은 아예 손대지 않는다 ──
{
  const b = BASE(); b['1'] = [];
  const { R, api } = load(b);
  R['2'][8] = '조하빈';
  const log = api.retagParts('2');
  check('1부 명단이 없으면 아무것도 안 한다', log.length === 0 && R['2'][8] === '조하빈', R['2'][8]);
}

// ── 7. 두 부에 다 앉으면 태그가 없던 사람에게도 붙는다 ──
{
  const b = BASE(); b['2'] = b['2'].concat('서동명');
  const { R, api } = load(b);
  api.retagParts('2');
  check('서동명이 2부에도 앉으면 (54)로 올라간다', R['2'][10] === '서동명(54)', R['2'][10]);
}

// ── 8. ownTag — 새로 앉는 사람 '자신의' 태그만, 그것도 근태성만 ──
{
  const { api } = load(BASE());
  check('새 사람이 (찾근)이면 가져온다', api.ownTag('우겸조') === '찾근', api.ownTag('우겸조'));
  check('부 태그는 안 가져온다(파생이 할 일)', api.ownTag('표승완') === '', `"${api.ownTag('표승완')}"`);
  check('명부에 없는 이름이면 빈 태그', api.ownTag('없는사람') === '', `"${api.ownTag('없는사람')}"`);
}

// ── 9. 원문 가드 — 이름 편집이 다시 앞사람 태그를 물려받게 되면 잡는다 ──
{
  check('이름 편집이 앞사람 태그를 승계하지 않는다(원문)',
    /const keep = same \? tagOf\(cell\) : ownTag\(nm\);/.test(SRC));
  check('옛 코드(무조건 승계)가 되살아나지 않았다',
    !/roster\[part\]\[pos - 1\] = next\.trim\(\) \+ \(tg \? '\(' \+ tg \+ '\)' : ''\);/.test(SRC));
}

// ── 10. 원래 주인 표기 — 맞바꾼 칸에만, 판독 원본과 다를 때만 ──
//  배치표 원본은 "조하빈(54)오동현"처럼 한 칸에 두 이름을 적고 순번은 고정한다.
//  대조판은 맞바꾸면 이름만 옮겨가 '이 순번이 원래 누구 것이었나'가 화면에서 사라졌다 —
//  표를 대조하며 손으로 고칠 때 관리자가 헷갈리는 원인이었다(2026-08-23).
{
  check('원본 명단(BOARD.roster)과 대조해서 원래 주인을 뽑는다',
    /const own0 = bare\(String\(\(\(BOARD\[part\] \|\| \{\}\)\.roster \|\| \[\]\)\[pos - 1\] \|\| ''\)\);/.test(SRC));
  check('★같을 땐 표시하지 않는다 — 안 바뀐 칸까지 취소선이 붙으면 표를 못 읽는다',
    /if \(own0 && nowNm && nkd\(own0\) !== nkd\(nowNm\)\) \{/.test(SRC));
  check('★되돌리면 표식이 지워진다(남아 있으면 유령 대바가 된다)',
    /else \{ if \(ow\) ow\.remove\(\); td\.classList\.remove\('swapped'\); \}/.test(SRC));
  check('순번 자체는 건드리지 않는다 — 원본도 순번은 고정하고 점유자 표기만 바꾼다',
    /pe\.textContent = String\(pos\);/.test(SRC));
}

console.log(bad ? `\n${bad}건 실패` : '\n전부 통과');
process.exit(bad ? 1 : 0);
