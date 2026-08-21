// 팁 저장 검사 — 넣은 팁이 서버까지 가는가.
//
//  ★2026-08-21 실사고: 팁을 넣어도 저장이 안 된다는 신고. 서버(setTip)는 멀쩡했다.
//   문제는 보내는 시점이었다 — 퀵 칩을 눌러도 화면만 바뀌고, 저장은 '다른 날짜를 열 때'나
//   '입력칸에서 포커스가 빠질 때'만 일어났다. 팁만 찍고 탭을 옮기면 아무것도 안 보냈고,
//   정산에 다시 들어오면 loadLedger가 서버값으로 화면을 덮어 넣은 값이 사라졌다.
//  돈이 걸린 입력은 '누른 순간' 가야 한다. 홀정산은 이미 그렇게 하고 있었다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const has = (t) => app.includes(t);

console.log('\n[누른 순간 간다]');
{
  ok(has("d.tip = Number(v) * 10000; lgSaveTip(date);"),
    '★퀵 칩(1만·2만…)은 누르면 바로 저장한다',
    '예전엔 메모리에만 적고 말았다 — 칩만 누르고 탭을 옮기면 그대로 사라졌다');
  ok(has("postJSON('/api/ledger/tip', { date, amount: d.tip || 0 })"),
    '저장은 실제로 서버로 보낸다');
  ok(has(".catch(() => lgTipDirty.add(date))"),
    '전송이 실패하면 다시 보낼 목록에 남긴다', '실패를 삼키면 조용히 사라진다');
  ok(has("function lgTipLater(date)") && has("lgTipLater(date); };"),
    '직접 입력은 타이핑이 멈추면 저장한다(포커스가 안 빠져도)');
}

console.log('\n[나갈 때·덮을 때도 잃지 않는다]');
{
  ok(has("if (curView === 'settle' && name !== 'settle')"),
    '★정산 탭을 떠나기 전에 남은 팁을 보낸다',
    '안 보내고 나가면 다시 들어올 때 서버값이 화면을 덮는다');
  ok(has("window.addEventListener('pagehide', lgBeaconTips)"),
    '앱을 덮을 때 마지막으로 보낸다');
  ok(has("navigator.sendBeacon('/api/ledger/tip', blob)"),
    'beacon으로 보낸다 — 화면이 닫히는 중엔 fetch가 끊긴다');
  ok(has("await lgFlushTips();   //"),
    '★다시 불러오기 전에 남은 팁부터 보낸다',
    'loadLedger가 먼저 읽으면 방금 넣은 값을 서버값이 덮는다 — 이게 신고의 마지막 조각이다');
}

console.log('\n[서버는 넣은 값을 그대로 돌려주는가]');
{
  const l = await import('../src/ledger.mjs');
  const TEST_USER = 99901, D = '2020-01-01';
  ok(l.setTip(D, 12345, TEST_USER)?.tip === 12345, '팁을 넣으면 그 값이 저장된다');
  ok(l.setTip(D, 0, TEST_USER)?.tip === 0, '0을 넣으면 지워진다');
  ok(l.setTip('아무날', 1000, TEST_USER) === null, '날짜 형식이 아니면 거절한다');
  ok(l.setTip(D, -5, TEST_USER)?.tip === 0, '음수는 0으로 막는다');
  try { fs.rmSync(path.join(ROOT, 'data/users/' + TEST_USER), { recursive: true, force: true }); } catch { /* 무해 */ }
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
