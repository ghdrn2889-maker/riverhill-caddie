// Claude 판독 호출이 실제로 몇 초 걸리나 — 타임아웃을 '재서' 정하기 위한 표.
//
//  ★왜 있나: 타임아웃을 얼마로 잡을지 지금까지 아무도 재지 않았다. 그래서 타임아웃이 뜨면
//   "느린가 보다"로 끝났고, 로그의 타임아웃 줄이 오늘 것인지 지난주 것인지도 알 수 없었다.
//   한도는 실측 최대에서 정해야 한다 — 짐작으로 올리면 매달린 호출이 파이프라인을 잡아먹고,
//   짐작으로 내리면 멀쩡한 판독이 잘린다.
//
//  쓰기: node tools/claudetime.mjs [며칠치]     (기본 7일)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';

const DAYS = Number(process.argv[2] || 7);
const FILE = path.join(DATA_DIR, 'claude-calls.jsonl');
if (!fs.existsSync(FILE)) {
  console.log('아직 기록이 없습니다 — 계측을 배포한 뒤 배치표를 한 번 읽어야 쌓입니다.');
  process.exit(0);
}
const kst = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const rows = fs.readFileSync(FILE, 'utf8').trim().split('\n')
  .map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
const since = Date.now() - DAYS * 86400000;
const R = rows.filter((r) => (r.at || 0) >= since);
if (!R.length) { console.log(`최근 ${DAYS}일 기록이 없습니다(전체 ${rows.length}건).`); process.exit(0); }

const sec = (ms) => (ms / 1000).toFixed(1) + '초';
const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);
const cap = R[R.length - 1].capMs || 0;

console.log(`\nClaude 호출 시간 — 최근 ${DAYS}일 · ${R.length}건 · 현재 한도 ${sec(cap)}\n`);

// ── 날짜별: 성공·타임아웃·기타실패 ──
const byDay = {};
for (const r of R) { const d = kst(r.at); (byDay[d] ||= { ok: 0, to: 0, err: 0, max: 0 });
  if (r.ok) { byDay[d].ok += 1; byDay[d].max = Math.max(byDay[d].max, r.ms || 0); }
  else if (r.why === 'timeout') byDay[d].to += 1; else byDay[d].err += 1; }
console.log('날짜별');
for (const [d, v] of Object.entries(byDay).sort()) {
  console.log(`  ${d}  성공 ${String(v.ok).padStart(3)} · 타임아웃 ${String(v.to).padStart(3)} · 기타실패 ${String(v.err).padStart(3)} · 성공 중 최장 ${sec(v.max)}`);
}

// ── 종류별: 성공 호출의 중앙값·95%·최장 ──
const byKind = {};
for (const r of R) { (byKind[r.kind || '기타'] ||= { ok: [], to: 0 });
  if (r.ok) byKind[r.kind || '기타'].ok.push(r.ms || 0); else if (r.why === 'timeout') byKind[r.kind || '기타'].to += 1; }
console.log('\n종류별 (성공한 호출만 · 정렬해 백분위)');
for (const [k, v] of Object.entries(byKind).sort((a, b) => Math.max(...(b[1].ok.length ? b[1].ok : [0])) - Math.max(...(a[1].ok.length ? a[1].ok : [0])))) {
  const a = v.ok.slice().sort((x, y) => x - y);
  const mx = a.length ? a[a.length - 1] : 0;
  console.log(`  ${k.padEnd(6)} ${String(a.length).padStart(3)}건`
    + (a.length ? ` · 중앙 ${sec(pct(a, 0.5)).padStart(7)} · 95% ${sec(pct(a, 0.95)).padStart(7)} · 최장 ${sec(mx).padStart(7)}` : ' · 성공 0')
    + (v.to ? ` · ★타임아웃 ${v.to}건` : ''));
}

// ── 한도를 얼마로 잡아야 하나 ──
const okAll = R.filter((r) => r.ok).map((r) => r.ms).sort((x, y) => x - y);
const to = R.filter((r) => !r.ok && r.why === 'timeout').length;
console.log('\n한도 잡기');
if (!okAll.length) { console.log('  성공한 호출이 없어 아직 정할 수 없습니다.'); }
else {
  const mx = okAll[okAll.length - 1];
  console.log(`  성공 중 최장 ${sec(mx)} · 95% ${sec(pct(okAll, 0.95))} · 중앙 ${sec(pct(okAll, 0.5))}`);
  console.log(`  → 여유 2배면 ${sec(mx * 2)} · 3배면 ${sec(mx * 3)}  (현재 한도 ${sec(cap)})`);
  if (cap && mx > cap * 0.6) console.log('  ★최장 호출이 한도의 60%를 넘었습니다 — 한도를 올릴 근거가 있습니다.');
  else if (cap) console.log('  최장 호출이 한도에 한참 못 미칩니다 — 타임아웃은 느려서가 아니라 매달려서 난 것입니다(한도를 올려도 안 낫습니다).');
}
if (to) console.log(`  타임아웃 ${to}건 — 위 '날짜별'에서 언제 났는지 보세요.`);
console.log('');
