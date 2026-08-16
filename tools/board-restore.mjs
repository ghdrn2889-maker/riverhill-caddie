// 3부 배치표를 칠판(dayboard) 스냅샷으로 되돌린다 — 교정이 잘못 들어갔을 때의 복구 경로.
//
//  왜 필요했나: 대조판 저장이 '카카오 예상 격자'를 본배치표로 밀어넣어 8/17 3부가
//   10팀 → 13팀으로 덮였다. 칠판은 그 직전 상태를 시각·코스까지 그대로 들고 있다.
//  ★교정은 boardcorrect.correctPart3 한 곳에서만 일어난다 — 여기서 따로 쓰지 않는다.
//
//  사용:  node tools/board-restore.mjs <YYYY-MM-DD> [--apply]
//         --apply 없이는 무엇이 바뀌는지만 보여준다(기본 = 미리보기).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import { correctPart3, loadLastBoard } from '../src/boardcorrect.mjs';

const date = process.argv[2];
const apply = process.argv.includes('--apply');
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('사용법: node tools/board-restore.mjs <YYYY-MM-DD> [--apply]');
  process.exit(1);
}

const f = path.join(DATA_DIR, `dayboard-${date}.json`);
let db;
try { db = JSON.parse(fs.readFileSync(f, 'utf8')); }
catch { console.error(`칠판이 없습니다: ${f}`); process.exit(1); }

const teams = db.board?.teams || {};
const poss = Object.keys(teams).map(Number).filter(Boolean).sort((a, b) => a - b);
if (!poss.length) { console.error('칠판에 명단이 없습니다.'); process.exit(1); }

// 현재 배치표의 이름을 쓴다 — 칠판 스냅샷 이후의 이름 교정(예: 진수→박진수)을 되살리면 안 된다.
//  되돌리는 건 '티오프 격자와 커트'뿐이다.
const lb = loadLastBoard();
const cur = (lb?.rawVerdict?.part3Roster) || [];
const rows = poss.map((p) => {
  const t = teams[String(p)] || {};
  return { pos: p, name: cur[p - 1] || t.name || '', tee: t.spare ? '' : (t.tee || ''), course: t.spare ? '' : (t.course || '') };
});
const cutLine = Number(db.board?.cut) || rows.filter((r) => r.tee).length;

const curGrid = {}; (lb?.rawVerdict?.teeGrid || []).forEach((g) => { curGrid[Number(g.pos)] = `${g.time}${g.course}`; });
console.log(`칠판 ${date} (갱신 ${new Date(db.updatedAt || 0).toLocaleString('ko-KR')}, seq ${db.seq})`);
console.log(`커트 ${lb?.rawVerdict?.cutoffPosition || '-'} → ${cutLine} · 격자 ${(lb?.rawVerdict?.teeGrid || []).length}칸 → ${rows.filter((r) => r.tee).length}칸`);
for (const r of rows) {
  const now = curGrid[r.pos] || '';
  const want = r.tee ? `${r.tee}${r.course}` : '';
  if (now !== want) console.log(`  ${String(r.pos).padStart(2)}번 ${(r.name || '').padEnd(10)} ${now || '(스페어)'} → ${want || '(스페어)'}`);
}

if (!apply) { console.log('\n미리보기입니다. 실제로 되돌리려면 --apply 를 붙이세요.'); process.exit(0); }

// ★인턴은 비운다 — 되돌리는 대상은 사진이 읽은 본배치표이고, 거기엔 인턴 칸이 없었다.
//  카카오 예상용 수동 인턴(data/intern-tees.json)은 건드리지 않는다(별개 저장소).
const out = correctPart3({ rows, interns: [], cutLine, notify: false, by: 'restore' });
console.log(`\n되돌렸습니다 — 칸 ${out.cellChanges} · 회원 재계산 ${out.updated}명 (알림 없음)`);
