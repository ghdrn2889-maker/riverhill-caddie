// 메뉴 → 팝업 넘어가기 — 열자마자 스스로 닫히지 않는가.
//
//  ★2026-08-29 사고: 테스터가 배치표로 볼 회원을 한 번 고르면 그 뒤로 바꿀 수 없었다.
//   진입 직후 자동으로 열린 선택기에서 한 번은 고를 수 있었고, 두 번째부터는 메뉴 이름줄을
//   눌러도 아무 일이 안 일어나는 것처럼 보였다.
//
//   원인은 히스토리 순서였다. menuClose()의 history.back()은 '나중에 처리되는' 일이라,
//   그 사이에 팝업이 pushState를 하면 되감기가 한 칸 밀려 방금 연 팝업을 되감는다.
//   팝업은 열리자마자 남의 popstate를 맞고 그 자리에서 닫힌다.
//
//   그래서 이 검사가 지키는 건 하나다 — 메뉴에서 팝업으로 넘어갈 때는
//   **되감기가 끝난 뒤에** 다음 팝업을 연다. menuClose(); fn() 을 나란히 쓰면 다시 깨진다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 넘겨주는 다리가 있다 ──');
{
  const i = APP.indexOf('function menuThen(');
  ok(i > 0, 'menuThen()이 있다');
  const body = APP.slice(i, APP.indexOf('function initMenu()', i));
  ok(/window\.addEventListener\('popstate', once\);/.test(body) && /history\.back\(\);/.test(body),
    '★popstate를 기다렸다가 연다',
    'back()은 나중에 처리된다 — 기다리지 않으면 새 팝업이 그 되감기를 대신 맞는다');
  ok(body.indexOf("window.addEventListener('popstate', once)") < body.indexOf('history.back()'),
    '듣기부터 걸고 되감는다', '되감은 뒤에 걸면 그 사이 도착한 popstate를 놓친다');
  ok(/setTimeout\(go, \d+\)/.test(body),
    '되감기가 안 와도 버튼이 죽지 않는다', '되돌아갈 칸이 없으면 popstate가 영영 안 온다');
  ok(/let done = false;/.test(body) && /if \(done\) return;/.test(body),
    '두 번 열지 않는다', 'popstate와 시한장치가 둘 다 올 수 있다');
  ok(/if \(!\(menuPushed && history\.state && history\.state\.mnu\)\)/.test(body),
    '쌓아둔 칸이 없으면 그냥 연다');
}

console.log('\n── 이름줄이 그 다리를 쓴다 ──');
{
  ok(/\$\('mnuWho'\)\.onclick = \(\) => menuThen\(openAccount\);/.test(APP),
    '★메뉴 이름줄 → menuThen(openAccount)',
    "menuClose(); openAccount(); 로 되돌리면 테스터가 회원을 다시 못 바꾼다");
  ok(!/menuClose\(\); openAccount\(\);/.test(APP), '나란히 부르는 옛 방식이 남아 있지 않다');
}

console.log('\n── 팝업 쪽 규칙은 그대로 ──');
{
  ok(/function pushOvHistory\(\) \{ if \(!\(history\.state && history\.state\.ov\)\) history\.pushState/.test(APP),
    '팝업은 자기 칸을 한 번만 쌓는다');
  ok(/if \(ovIsOpen\(\) && ovDismissable\)/.test(APP),
    '뒤로가기는 열려 있고 닫아도 되는 팝업만 닫는다');
  ok(/if \(meState && meState\.user && meState\.user\.role === 'tester'\) \{ openTesterPicker\(\); return; \}/.test(APP),
    '테스터는 계정 대신 회원 선택기가 열린다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
