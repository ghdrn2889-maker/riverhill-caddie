// 알림 문구 규칙 파수꾼 — 소스에 이모지·느낌표가 다시 기어들어오는지 본다.
//  ★2026-08-20 실측: '🏌️ 3부 대기 현황' 28건, '⚠️ 티오프 시간 변경!' 20건이 실제로 회원 폰에 갔다.
//   앱 전체 이모지 금지 규칙이 있었는데도 알림에서만 새어 나갔다. 규칙은 지키는 장치가 있어야 규칙이다.
//  ★대상은 title:/body: 속성뿐이다. console.log의 이모지는 운영 로그라 건드리지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
// 문자열 리터럴('…' "…" `…`)을 값으로 갖는 title:/body: 만 본다.
const PROP = /\b(title|body)\s*:\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

let bad = 0, seen = 0;
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.mjs'))) {
  const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n');
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\*)/.test(ln)) return;                 // 주석은 건너뛴다
    for (const m of ln.matchAll(PROP)) {
      const lit = m[2];
      seen++;
      const hit = [];
      if (EMOJI.test(lit)) hit.push('이모지');
      if (/[!！]/.test(lit)) hit.push('느낌표');
      if (hit.length) { bad++; console.log(`  X  ${f}:${i + 1}  ${hit.join('·')}  ${lit.slice(0, 70)}`); }
    }
  });
}
console.log(bad ? `\n${bad}건 위반 (문구 ${seen}개 검사)` : `\n문구 ${seen}개 — 이모지·느낌표 없음`);
process.exit(bad ? 1 : 0);
