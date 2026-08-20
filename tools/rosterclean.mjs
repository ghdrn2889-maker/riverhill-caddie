// 이름 사전 청소 — 오독이 '확정'으로 굳어 판독을 계속 망치는 것을 걷어낸다.
//
//  ★왜: 확정 사전에 오독이 한 번 들어가면 두 가지 해를 끼친다.
//   ① 그 이름은 다시는 안 고쳐진다(이미 확정이니 스냅이 손대지 않는다).
//   ② 다른 이름의 '1글자 차 후보'를 하나 더 만들어, 유일하지 않다며 스냅을 포기하게 만든다.
//     실측: '김수륭'(김수룡 오독)이 확정으로 남아 '김수원'의 후보를 5개로 늘렸다 — 오염이 오염을 낳는다.
//
//  기본은 '보기만'. 실제로 지우려면 --apply.
//   node tools/rosterclean.mjs            보고서만
//   node tools/rosterclean.mjs --apply    확실한 것만 삭제(애매한 건 손대지 않고 남긴다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../src/store.mjs';
import { OFFICIAL_ROSTER } from '../src/roster-official.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(DATA_DIR, 'caddies.json');
const APPLY = process.argv.includes('--apply');

const hamming1 = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++d > 1) return false; }
  return d === 1;
};

// 근무·근태 태그 — 이름이 아니다.
const DUTY_WORD = /^(찾근|조출|후출|정출|선발|당번|프리|벌당|배치|콜|정근|마감|대리|주임|마샬|휴무|휴가|병가|연차|반차|월차|격리|스페어|대기)$/;

const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const OFF = new Set(OFFICIAL_ROSTER);
const CONFIRM_MIN = Number(process.env.CADDIE_CONFIRM_MIN ?? 3);

// 판정 — 왜 지우는지(또는 왜 못 지우는지)를 이름마다 붙인다.
function classify(name, e) {
  if (e?.official || OFF.has(name)) return null;                      // 정본은 손대지 않는다
  if (/[()（）]/.test(name)) return { kind: 'junk', why: '괄호가 붙은 셀이 통째로 이름이 됐다' };
  if (/\s/.test(name)) return { kind: 'junk', why: '이름 안에 공백이 있다' };
  if (/[0-9]/.test(name)) return { kind: 'junk', why: '숫자가 섞였다' };
  if (!/^[가-힣]{2,4}$/.test(name)) return { kind: 'junk', why: '사람 이름 모양이 아니다' };
  if (/테스트/.test(name)) return { kind: 'junk', why: '테스트용 이름' };
  // ★근무태그가 이름으로 학습된 것 — '찾근'(22회) '조출'(13회)이 캐디 이름 행세를 하고 있었다.
  //  괄호 파서가 태그를 떼기 전에 수확(learnCrews)이 셀을 통째로 삼킨 흔적이다.
  if (DUTY_WORD.test(name)) return { kind: 'junk', why: '근무·근태 태그가 이름으로 학습됐다' };
  const near = OFFICIAL_ROSTER.filter((o) => hamming1(name, o));
  if (near.length === 1) return { kind: 'typo', why: `정본 '${near[0]}'와 1글자 차이`, to: near[0] };
  if (near.length > 1) return { kind: 'keep', why: `정본 ${near.join('·')} 어느 쪽인지 못 정한다 — 사람이 판단` };
  return { kind: 'keep', why: '정본에 비슷한 이름이 없다 — 새 캐디일 수 있다' };
}

const rows = [];
for (const [name, e] of Object.entries(db)) {
  const c = classify(name, e);
  if (!c) continue;
  rows.push({ name, n: e?.n || 0, confirmed: (e?.n || 0) >= CONFIRM_MIN, ...c });
}
rows.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : b.n - a.n));

const F = (r) => `${r.name}(${r.n}회${r.confirmed ? '·확정' : ''})`;
const junk = rows.filter((r) => r.kind === 'junk');
const typo = rows.filter((r) => r.kind === 'typo');
const keep = rows.filter((r) => r.kind === 'keep');

console.log(`사전 ${Object.keys(db).length}개 · 정본 ${OFFICIAL_ROSTER.length} · 정본 밖 ${rows.length}`);

console.log(`\n[지운다 — 이름 모양이 아니다] ${junk.length}개`);
for (const r of junk) console.log(`  ${F(r)}  ${r.why}`);

console.log(`\n[지운다 — 정본 오독이 확실] ${typo.length}개`);
for (const r of typo) console.log(`  ${F(r)} → ${r.to}  ${r.why}`);

console.log(`\n[남긴다 — 사람이 판단해야 한다] ${keep.length}개`);
for (const r of keep) console.log(`  ${F(r)}  ${r.why}`);

// 오염이 실제로 무엇을 막고 있었나 — 지우면 스냅이 살아나는 이름을 보여준다.
const doomed = new Set([...junk, ...typo].map((r) => r.name));
const confAll = Object.keys(db).filter((k) => k.length >= 3 && ((db[k]?.n || 0) >= CONFIRM_MIN || db[k]?.official));
const unblocked = [];
for (const k of confAll) {
  if (OFF.has(k) || doomed.has(k)) continue;
  const before = confAll.filter((c) => hamming1(k, c));
  const after = before.filter((c) => !doomed.has(c));
  if (before.length > 1 && after.length === 1) unblocked.push(`${k} → ${after[0]} (후보 ${before.length}개 → 1개)`);
}
if (unblocked.length) {
  console.log(`\n[청소하면 스냅이 살아나는 이름] ${unblocked.length}개`);
  for (const u of unblocked) console.log('  ' + u);
}

if (!APPLY) {
  console.log(`\n보기만 했습니다. 실제로 지우려면: node tools/rosterclean.mjs --apply`);
  process.exit(0);
}

// ★지우기 전에 통째로 백업 — 되돌릴 수 없는 삭제는 하지 않는다.
const bak = FILE + '.bak-clean-' + Date.now();
fs.copyFileSync(FILE, bak);
for (const name of doomed) delete db[name];
fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
console.log(`\n${doomed.size}개 삭제 · 남은 ${Object.keys(db).length}개`);
console.log(`백업: ${path.relative(ROOT, bak)}`);
