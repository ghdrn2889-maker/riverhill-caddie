// 앱이 부르는 이름이 실제로 있는가 — 정의가 통째로 사라졌는데도 조용히 넘어가던 구멍.
//  ★2026-08-20 사고 두 건이 같은 뿌리다.
//   ① 성장 공간 블록을 main() 뒤에 붙임 → gwSeen이 아직 안 산 const를 건드려 ReferenceError.
//   ② 축하 화면을 갈아끼우며 gwSeen·gwFail이 함께 지워짐 → 아예 없는 이름을 불러 ReferenceError.
//  둘 다 부팅 중(main → initNav → showView)에 터져 hideSplash까지 못 갔고, 앱은 '일정 불러오는 중'에 얼어붙었다.
//  node --check로는 안 잡힌다 — 문법은 멀쩡하기 때문이다. 그래서 '이름'을 직접 센다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};

const raw = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');

// 주석과 따옴표 안을 걷어낸다 — 주석 속 이름을 정의로 착각하면 검사가 거짓말을 한다.
//  ★줄 단위로만 지운다. 여러 줄을 통째로 훑는 방식은 정규식 리터럴 하나에 어긋나면
//   파일의 절반을 삼켜버려, 검사가 '전부 없다'고 우기게 된다(처음에 그렇게 됐다).
const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
const code = noBlock.split('\n').map((line) => line
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const DECL = (name) => new RegExp('(?:function|const|let|var)\\s+' + name + '(?![\\w$])');
// 한 줄에 쉼표로 여러 개를 선언하는 경우(let a = 1, b = 2)도 세어야 한다 —
//  이름 바로 앞에 let이 붙은 것만 찾으면 두 번째부터는 '없는 이름'으로 오해한다.
const declaredNames = new Set();
for (const m of code.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declaredNames.add(m[1]);
for (const m of code.matchAll(/(?:const|let|var)\s+([^;\n]+)/g)) {
  for (const part of m[1].split(',')) {
    const t = part.trim().match(/^([A-Za-z_$][\w$]*)/);
    if (t) declaredNames.add(t[1]);
  }
}
const declared = (name) => declaredNames.has(name);

console.log('\n[성장 공간 — 부르는 이름이 전부 정의되어 있는가]');
{
  const used = new Set();
  // 앞에 '.'이 붙으면 속성(다른 객체의 것), 뒤에 ':'이 붙으면 객체 열쇠 — 둘 다 변수가 아니다.
  for (const m of code.matchAll(/(?:^|[^.\w$])(gw[A-Za-z0-9_]*|GW_[A-Za-z0-9_]*)(?![\w$])\s*(:?)/g)) {
    if (m[2] !== ':') used.add(m[1]);
  }
  const missing = [...used].filter((n) => !declared(n));
  ok(used.size > 10, `성장 공간 이름을 ${used.size}개 찾았다`, '검사가 아무것도 못 찾으면 통과는 무의미하다');
  ok(missing.length === 0, '쓰이는 이름이 전부 정의되어 있다',
    missing.length ? '없는 이름: ' + missing.join(', ') + ' — 부팅 중에 부르면 앱이 로딩 화면에서 멈춘다' : '');
}

console.log('\n[부팅 경로가 부르는 이름 — 이름을 박아 지킨다]');
{
  // 위 검사가 무뎌지더라도 이건 남는다. showView·openAccount·main이 실제로 부르는 것들.
  for (const n of ['gwSeen', 'GW_SEEN', 'gwFail', 'gwBootCheck', 'gwCelebrate', 'gwCelebrateClose', 'gwOpen', 'initGrowth']) {
    ok(declared(n), `${n} 정의가 있다`);
  }
  // 지워졌던 두 함수는 '부르는 곳'도 함께 확인한다 — 정의만 있고 아무도 안 부르면 되살린 의미가 없다.
  ok(/gwSeen\(/.test(code.slice(0, code.search(DECL('gwSeen')))), 'showView가 gwSeen을 부른다',
    '화면을 처음 연 날 기록이 이 호출에 달려 있다');
  ok(/gwFail\(/.test(code.slice(code.search(DECL('gwFail')) + 20)), '못 불러왔을 때 gwFail로 그 사실을 알린다');
}

console.log('\n[정의는 전부 main() 앞에]');
{
  const call = code.lastIndexOf('\nmain();');
  ok(call > -1, 'app.js가 main()을 부른다');
  ok(code.slice(call + 8).trim() === '', 'main()이 파일의 마지막이다',
    '뒤에 무언가를 더 붙이는 순간 같은 사고가 반복된다');
  for (const n of ['gwSeen', 'GW_SEEN', 'gwFail']) {
    const at = code.search(DECL(n));
    ok(at > -1 && at < call, `${n} 정의가 main() 앞에 있다`,
      'const/let은 선언줄을 지나야 산다 — 뒤에 있으면 부팅 중 ReferenceError로 앱이 멈춘다');
  }
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
