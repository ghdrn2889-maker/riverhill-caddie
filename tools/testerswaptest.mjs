// 테스터 전환 카드 — 실제 회원 화면에 절대 안 뜨는가.
//
//  ★이 검사의 요점은 '보이는가'가 아니라 '안 보여야 할 사람에게 안 보이는가'다.
//   테스터 도구가 실제 회원 메뉴에 한 번이라도 뜨면, 회원은 자기 앱에서 남의 이름을 보게 된다.
//   그래서 잠금을 세 겹으로 두고, 그 세 겹이 다 살아 있는지를 여기서 지킨다:
//     ① 마크업이 hidden으로 태어난다(JS가 못 돌아도 안 뜬다)
//     ② 메뉴를 열 때마다 role을 다시 본다
//     ③ 눌렸을 때 한 번 더 본다
//   그리고 ①이 진짜 숨김이려면 CSS가 [hidden]을 다시 못박아야 한다 —
//   .mnu-swap 이 display:flex 라서 그 한 줄이 없으면 '숨김'이 숨김이 아니게 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const APP = read('public/app.js');
const HTML = read('public/index.html');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 잠금 ① 마크업은 숨은 채로 태어난다 ──');
{
  ok(/<button class="mnu-swap" id="mnuSwap" type="button" hidden>/.test(HTML),
    '★hidden으로 태어난다', 'JS가 못 돌거나 늦게 돌아도 실제 회원에겐 안 뜬다');
  ok(/\.mnu-swap\[hidden\]\{display:none !important;\}/.test(HTML),
    '★CSS가 [hidden]을 다시 못박는다',
    '.mnu-swap이 display:flex라 이 줄이 없으면 hidden이 무시된다 — 숨김이 숨김이 아니게 된다');
  const i = HTML.indexOf('.mnu-swap[hidden]');
  const j = HTML.indexOf('.mnu-swap{');
  ok(i > 0 && j > 0 && i < j, '[hidden] 규칙이 먼저 온다(뒤에 와도 !important로 이기지만 읽는 순서가 뜻을 만든다)');
}

console.log('\n── 잠금 ② 열 때마다 다시 본다 ──');
{
  ok(/function isTesterRole\(\) \{ return !!\(meState && meState\.user && meState\.user\.role === 'tester'\); \}/.test(APP),
    '테스터 판단이 한 곳에 모여 있다', '흩어놓으면 한 군데만 빠져도 샌다');
  const i = APP.indexOf('async function renderTesterSwap()');
  ok(i > 0, 'renderTesterSwap()이 있다');
  const body = APP.slice(i, APP.indexOf('function renderMenu()', i));
  ok(/if \(!isTesterRole\(\)\) \{ el\.hidden = true; return; \}/.test(body),
    '★테스터가 아니면 숨기고 즉시 끝낸다');
  ok(body.indexOf('if (!isTesterRole())') < body.indexOf('el.hidden = false'),
    '★role 확인이 여는 것보다 먼저다', '먼저 열고 나중에 확인하면 그 사이에 보인다');
  ok(/renderTesterSwap\(\);/.test(APP.slice(APP.indexOf('function renderMenu()'))),
    'renderMenu()가 메뉴를 열 때마다 부른다');
}

console.log('\n── 잠금 ③ 눌렸을 때 한 번 더 본다 ──');
{
  ok(/\$\('mnuSwap'\)\.onclick = \(\) => \{ if \(!isTesterRole\(\)\) return; menuThen\(openTesterPicker\); \};/.test(APP),
    '★누를 때도 role을 본다', '숨겨져 있어도 눌린 척할 수 있다');
  ok(/menuThen\(openTesterPicker\)/.test(APP),
    '되감기를 기다렸다가 연다', '바로 열면 메뉴의 뒤로가기를 대신 맞고 닫힌다(2026-08-29 사고)');
}

console.log('\n── 카드가 말하는 내용 ──');
{
  const i = APP.indexOf('async function renderTesterSwap()');
  const body = APP.slice(i, APP.indexOf('function renderMenu()', i));
  ok(/배치표로 보는 회원/.test(HTML), '머리말이 무엇을 바꾸는지 말한다');
  ok(/if \(!testerAsMember\)/.test(body), '아직 안 골랐을 때도 말이 되게 쓴다');
  ok(/_boardOwnerName \|\| \(m && m\.name\)/.test(body),
    '이름은 방금 읽은 배치표 주인이 먼저다', '목록 이름은 낡을 수 있다');
  ok(/pr\.part \+ '부'/.test(body) && /myPosition/.test(body),
    '부·순번은 화면이 보고 있는 그 근무에서 가져온다', '따로 세면 화면과 갈라진다');
  ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(body), '이모지를 쓰지 않는다');
  ok(!/탕/.test(body) && !/탕/.test(HTML.slice(HTML.indexOf('class="mnu-swap"'), HTML.indexOf('class="mnu-swap"') + 600)),
    "'탕'이라는 말을 쓰지 않는다");
}

console.log('\n── 실제 회원 화면은 안 건드렸다 ──');
{
  const i = APP.indexOf('function renderMenu()');
  const body = APP.slice(i, i + 700);
  ok(/\$\('mnuName'\)\.textContent = p\.boardName \|\| '회원';/.test(body),
    '이름줄은 그대로 로그인한 사람이다');
  ok(/caddieTypeOf\(p\) === 'house' \? '하우스 캐디' : '3부 캐디'/.test(body),
    '태그줄 기본값도 그대로다', "'체험 계정'으로 바꾸는 건 테스터 분기 안에서만");
  const sw = APP.slice(APP.indexOf('async function renderTesterSwap()'));
  ok(sw.indexOf("$('mnuTag').textContent = '체험 계정") > sw.indexOf('if (!isTesterRole())'),
    '★태그줄 바꾸기도 role 확인 뒤에 있다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
