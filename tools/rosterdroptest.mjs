// 반영할 때 명단에서 사람이 조용히 사라지지 않는가.
//
//  2026-08-27 사용자 보고: "대조표에서 앱에 반영을 하면 자꾸 어디선가 순번 중 한 사람이나
//   몇 사람이 생략돼서 그냥 사라져버린다." 며칠째 반복됐는데 로그에도 알림에도 흔적이 없었다.
//
//  ★코드는 이걸 이미 알고 있었다 — boardcorrect.mjs 머리말에 "rows … 명단 전체.
//   일부만 주면 나머지가 사라진다"고 적혀 있다. 그런데 그걸 '세는' 곳이 없었다.
//   boardIntegrity는 겹친 칸·이름 없는 티오프·명단보다 큰 커트 셋만 본다.
//   경고를 주석에만 적어두면 아무도 못 본다 — 검사가 세야 사람이 안다.
//
//  ★막지는 않는다. 검수에는 '행 삭제'가 있고 부 간 대바로 나가는 사람도 있다 — 지우는 건
//   정당할 수 있다. 정당하지 않은 건 '조용한 것'이다. 그래서 세고, 적고, 화면에 띄운다.
//   단 하나, '구멍'(rows에 아예 없는 중간 순번)은 저장 자체를 안 한다 —
//   그건 '지웠다'가 아니라 '말하지 않았다'이고, 뒤 전원이 한 칸씩 밀려 올라간다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const BC = read('src/boardcorrect.mjs');
const MO = read('src/monitor.mjs');
const CL = read('tools/daejo-client.js');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 3부: 사라진 사람을 센다 ──');
{
  const i = BC.indexOf('const _lost = (() => {');
  ok(i > 0, '★사라진 사람을 세는 자리가 있다');
  const blk = i > 0 ? BC.slice(i, i + 900) : '';
  ok(/origRoster\.forEach\(\(nm, i\) => \{/.test(blk), '이전 명단을 기준으로 센다',
    '보낸 rows만 보면 "없는 것"을 볼 수 없다 — 없어진 건 안 온 것이다');
  ok(/movedK\.has\(k\)/.test(blk), '부 간 대바로 나간 사람은 빼고 센다',
    "그건 '사라진 것'이 아니라 '다른 부로 간 것'이다");
  ok(/nkey/.test(blk), '이름 비교는 태그를 뗀 키로 한다',
    '문태익 → 문태익(1,3)처럼 태그만 붙어도 사라진 걸로 세면 매번 헛경보가 난다');
}

console.log('\n── 구멍은 저장하지 않는다 ──');
{
  const i = BC.indexOf('const _holes = [];');
  ok(i > 0, '★구멍을 따로 찾는다');
  const blk = i > 0 ? BC.slice(i, i + 600) : '';
  ok(/if \(roster\[i\] === undefined\) _holes\.push\(i \+ 1\)/.test(blk),
    'undefined(=rows에 그 순번이 아예 없음)를 찾는다',
    "빈 문자열과 다르다 — 빈칸은 '비웠다'는 말이고 구멍은 '말하지 않았다'는 뜻이다");
  ok(/throw new Error\(/.test(blk) && /저장하지 않았습니다/.test(blk),
    '★구멍이면 저장하지 않고 돌려보낸다',
    '그대로 두면 뒤에서 걸러지며 그 아래 전원이 한 칸씩 올라간다');
  const io2 = MO.indexOf('const _holes = [];');
  ok(io2 > 0, '1·2부에도 같은 검사가 있다');
  ok(/holes: _holes/.test(MO), '1·2부는 어느 순번이 빠졌는지 같이 돌려준다');
}

console.log('\n── 흔적을 남긴다 ──');
{
  ok(/if \(cellDiffs\.length \|\| _lost\.length\) \{/.test(BC),
    '★사라진 사람만 있어도 교정 로그를 쓴다',
    'cellDiffs는 그 순번을 돌아야 생긴다 — 안 온 순번은 루프를 돌지도 않아 흔적이 없었다');
  ok(/dropped: _lost, rowsSent: rows\.length, rosterWas: origRoster\.length/.test(BC),
    '몇 행을 보냈고 명단이 몇이었는지 같이 적는다', '다음에 같은 일이 나면 경로를 바로 안다');
  ok(/if \(cellDiffs\.length \|\| _lostP\.length\) \{/.test(MO), '1·2부도 같은 규칙');
  ok(/dropped: _lostP, rowsSent: rows\.length, rosterWas: origRoster\.length/.test(MO), '1·2부도 같이 적는다');
  ok(/★사라진 사람 \$\{_lost\.length\}명/.test(BC) || /사라진 사람 \$\{_lost\.length\}/.test(BC),
    '한 줄 요약에도 드러난다');
}

console.log('\n── 화면이 그 자리에서 말한다 ──');
{
  ok(/dropped: _lost \};/.test(BC), '★3부 교정이 사라진 사람을 돌려준다');
  ok(/dropped: out\.dropped \|\| \[\]/.test(MO), '3부 응답에 실린다');
  ok(/dropped: _lostP/.test(MO) && /pulls, dropped: _lostP/.test(MO), '1·2부 응답에도 실린다');
  ok(/const DROPPED = \[\];/.test(CL), '대조판이 모은다');
  ok(/if \(\(j\.dropped \|\| \[\]\)\.length\) DROPPED\.push/.test(CL), '부마다 받아 쌓는다');
  ok(/alert\('명단에서 다음 사람이 빠졌습니다\.'/.test(CL),
    "★alert로 크게 말한다", '작은 글자에 쓰면 못 본다 — 8/26 판본 거절에서 이미 겪었다');
  ok(/state\.classList\.add\('bad'\);[\s\S]{0,200}명단에서 빠짐/.test(CL), '실패색으로도 남는다');
  ok(/일부러 지우셨으면 그대로 두셔도 됩니다/.test(CL),
    '지우는 것 자체는 정당할 수 있다고 말한다', '헛경보처럼 들리면 다음부터 안 읽는다');
}

console.log('\n── 세는 자리가 저장보다 앞이다 ──');
{
  const lost = BC.indexOf('const _lost = (() => {');
  const holes = BC.indexOf('const _holes = [];');
  const save = BC.indexOf('v.part3Roster = roster;');
  ok(lost > 0 && holes > 0 && save > 0 && lost < save && holes < save,
    '★명단을 갈아끼우기 전에 센다',
    '갈아끼운 뒤에 세면 무엇이 있었는지 알 방법이 없다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
