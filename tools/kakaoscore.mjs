// 카카오 예상 채점 — 하루치 자세히 보거나, 며칠치 흐름을 본다.
//  실행:  node tools/kakaoscore.mjs            오늘·내일 채점(저장 안 함)
//         node tools/kakaoscore.mjs 20260818   그날 자세히
//         node tools/kakaoscore.mjs --log      지금까지 남은 채점 기록(설정 변화와 함께)
//         node tools/kakaoscore.mjs 20260818 --save   채점해서 기록에 남긴다
import { scoreDay, recordDay, readScores } from '../src/kakaoscore.mjs';
import * as worklog from '../src/worklog.mjs';

const args = process.argv.slice(2);
const save = args.includes('--save');
const days = args.filter((a) => /^\d{8}$/.test(a));
const opts = { labelToISO: worklog.labelToISO };
const pad = (s, n) => String(s).padEnd(n);

if (args.includes('--log')) {
  const rows = readScores(60);
  if (!rows.length) { console.log('아직 채점 기록이 없습니다.'); process.exit(0); }
  console.log('\n날짜        정답 맞음  허위 누락(비움/설명안됨)  중간리드   마감선 blind 비움칸  관측');
  let prev = '';
  for (const r of rows) {
    const t = r.totals, c = r.config || {};
    const sig = `${c.closeLead}|${c.blindOn}|${(c.hold || []).join(',')}|${c.frame}`;
    if (prev && sig !== prev) console.log('  ── 설정이 바뀐 지점 ──');
    prev = sig;
    console.log(`${r.date}  ${pad(t.board, 4)} ${pad(`${t.hit}(${t.rate}%)`, 10)} ${pad(t.phantom, 4)} ${pad(`${t.missHeld}/${t.missOther}`, 21)}`
      + ` ${pad(r.lead?.medianMin != null ? `${r.lead.medianMin}분` : '-', 9)} ${pad(c.closeLead, 6)} ${pad(c.blindOn ? '켬' : '끔', 5)} ${pad((c.hold || []).length, 7)} ${c.snapSeen}`);
  }
  console.log('\n★ 설명 안 되는 누락이 늘면 규칙이 팀을 지우고 있다는 뜻이다 — 그때 되돌린다.');
  process.exit(0);
}

const targets = days.length ? days : (() => {
  const d = new Date(), t = new Date(); t.setDate(t.getDate() + 1);
  const y = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
  return [y(d), y(t)];
})();

for (const date of targets) {
  const r = save ? recordDay(date, opts) : scoreDay(date, opts);
  if (!r.ok) { console.log(`\n== ${date} — ${r.why}`); continue; }
  const t = r.totals;
  console.log(`\n== ${date}  정답 ${t.board}팀 → 맞음 ${t.hit} (${t.rate}%) · 허위 ${t.phantom} · 누락 ${t.missHeld + t.missOther}`);
  for (const [p, x] of Object.entries(r.parts)) {
    console.log(`   ${p}부  배치표 ${pad(x.board, 3)} 카카오 ${pad(x.kakao, 3)} 맞음 ${pad(x.hit, 3)}`);
    if (x.phantom.length) console.log(`         허위(없는 팀)★     : ${x.phantom.join(' ')}`);
    if (x.lateBooked.length) console.log(`         배치표 뒤 당추     : ${x.lateBooked.join(' ')}  ← 카카오가 먼저 봤다`);
    if (x.missHeld.length) console.log(`         누락(비워둔 칸)    : ${x.missHeld.join(' ')}  ← 설계대로. 사람이 채운다`);
    if (x.missOther.length) console.log(`         누락(설명 안 됨)★ : ${x.missOther.join(' ')}`);
  }
  if (r.lead.n) console.log(`   속도  지켜보는 중에 찬 ${r.lead.n}칸 — 중간값 ${r.lead.medianMin}분 · 가장 늦은 ${r.lead.minMin}분 · 가장 빠른 ${r.lead.maxMin}분 (배치표 대비)`);
  if (r.lead.floorN) console.log(`         첫 관측 때 이미 차 있던 ${r.lead.floorN}칸 — 최소 ${r.lead.floorMinAtLeast}분 빠름(하한이지 측정값이 아님)`);
  if (r.intern.designated.length || r.intern.candidates.length) {
    console.log(`   인턴  지정 ${r.intern.designated.length} [${r.intern.designated.join(' ')}] · 후보 ${r.intern.candidates.length} [${r.intern.candidates.join(' ')}] · 맞힌 것 ${r.intern.hit}`);
  }
  if (r.adminFixes) console.log(`   관리자가 손으로 고친 티오프 ${r.adminFixes}칸`);
  const c = r.config;
  console.log(`   설정  마감선 ${c.closeLead}분 · blind ${c.blindOn ? '켬' : '끔'} · 비움칸 ${c.hold.length} · 기본틀 ${c.frame}칸 · 관측 ${c.snapSeen}회`);
}
