// Claude 호출 재시도 규칙 — 언제 다시 부르고 언제 안 부르나.
//
//  ★재시도는 잘못 걸면 조용히 비싸진다. 실패마다 다시 부르면 하루 상한을 두 배로 먹고,
//   두 번 넘게 부르면 매달린 호출 하나가 파이프라인을 몇십 분씩 잡는다.
//   그래서 '다시 부를까'만 순수 함수로 떼어(shouldRetry) 여기서 표로 세운다.
import { shouldRetry } from '../src/claudereader.mjs';

let fails = 0;
const chk = (got, want, msg) => { if (got !== want) { fails += 1; console.log(`   ★NG ${msg} — ${want ? '다시 불러야' : '안 불러야'} 하는데 ${got ? '불렀' : '안 불렀'}다`); } };

console.log('\nClaude 재시도 규칙\n');

// 다시 부른다 — 매달린(타임아웃) 첫 판, 예산 남음
chk(shouldRetry({ why: 'timeout', attempt: 1, budgetLeft: 100 }), true, '타임아웃 1번째');

// 안 부른다
chk(shouldRetry({ why: 'timeout', attempt: 2, budgetLeft: 100 }), false, '★타임아웃 2번째 — 한 번만 다시 부른다');
chk(shouldRetry({ why: 'exit1', attempt: 1, budgetLeft: 100 }), false, 'exit 실패 — 다시 불러도 같은 이유로 죽는다');
chk(shouldRetry({ why: 'spawn', attempt: 1, budgetLeft: 100 }), false, 'spawn 실패 — 실행 자체가 안 된 것');
chk(shouldRetry({ why: 'timeout', attempt: 1, budgetLeft: 0 }), false, '★하루 상한 소진 — 폭주 방지선을 재시도가 넘지 않는다');
chk(shouldRetry({ why: 'timeout', attempt: 1, budgetLeft: 100, on: false }), false, '스위치 꺼짐(CLAUDE_RETRY_ON_TIMEOUT=0)');

console.log('  다시 부른다 — 타임아웃 1번째(예산 남음)');
console.log('  안 부른다 — 2번째 · exit/spawn 실패 · 상한 소진 · 스위치 꺼짐');

// ★최악의 경우 얼마나 잡히나 — 이 계산이 틀리면 '고치려던 문제'를 키운다.
const cap = Number(process.env.CLAUDE_TIMEOUT_MS || 600000);
const retry = Number(process.env.CLAUDE_RETRY_TIMEOUT_MS || 240000);
const worst = cap + retry;
console.log(`\n  최악(둘 다 매달림): ${Math.round(cap / 1000)}초 + ${Math.round(retry / 1000)}초 = ${Math.round(worst / 60000)}분`);
chk(retry < cap, true, '재시도 한도가 첫 한도보다 짧아야 한다(안 그러면 매달림이 두 배로 잡는다)');
chk(worst <= 20 * 60000, true, `최악이 20분을 넘는다(${Math.round(worst / 60000)}분) — 재확인 루프가 그동안 막힌다`);

console.log('');
console.log(fails ? `★ 실패 ${fails}건` : '★ 전부 통과');
process.exit(fails ? 1 : 0);
