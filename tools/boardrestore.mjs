// 3부 배치표를 그날 '칠판 원본'(dayboard-YYYY-MM-DD.json)으로 되돌린다.
//
//  왜 필요한가: 교정이 여러 순번에 같은 티오프를 주면(8/18 실사고 — 17:35에 둘, 17:56에 셋,
//  18:03에 셋) 표는 한 시각에 한 명만 그리므로 나머지가 화면에서 사라진다. 이름이 지워진 게
//  아닌데 지워진 것처럼 보인다. 그때 아침 판독으로 되돌릴 길이 있어야 한다.
//
//  ★교정은 한 곳에서만 일어난다 — correctPart3를 그대로 쓴다(사본을 만들지 않는다).
//  ★인턴과 근태는 지금 값을 그대로 실어 보낸다. 안 그러면 되돌리면서 그것들이 지워진다.
//
//  사용: node tools/boardrestore.mjs 2026-08-18            (미리보기)
//        node tools/boardrestore.mjs 2026-08-18 --save
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import { correctPart3, loadLastBoard, nkey } from '../src/boardcorrect.mjs';
import { internTeesFor } from '../src/interns.mjs';
import { keyFromLabel } from '../src/boardpending.mjs';

const iso = String(process.argv[2] || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
const SAVE = process.argv.includes('--save');
if (!iso) { console.error('날짜가 필요합니다: node tools/boardrestore.mjs 2026-08-18 [--save]'); process.exit(1); }

const dbFile = path.join(DATA_DIR, `dayboard-${iso}.json`);
if (!fs.existsSync(dbFile)) { console.error(`칠판이 없습니다: ${path.basename(dbFile)}`); process.exit(1); }
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const teams = (db.board && db.board.teams) || {};
const poss = Object.keys(teams).map(Number).filter(Boolean).sort((a, b) => a - b);
if (!poss.length) { console.error('칠판에 팀이 없습니다.'); process.exit(1); }

const lb = loadLastBoard();
if (!lb || !lb.rawVerdict) { console.error('현재 배치표가 없습니다.'); process.exit(1); }
const v = lb.rawVerdict;
const crew = v.crewDuty || {};
const ikey = keyFromLabel(v.dateLabel || lb.dateLabel || '') || '';
const allInterns = internTeesFor(ikey, v.internTees || []).map((t) => ({ time: t.time, course: t.course }));
const boardInterns = (v.internTees || []).map((t) => ({ time: t.time, course: t.course }));

const rows = poss.map((p) => {
  const t = teams[p] || {};
  const name = String(t.name || t.caddie || '').trim();
  return { pos: p, name, tee: String(t.tee || ''), course: String(t.course || ''), duty: String(crew[nkey(name)] || '') };
});
const cutLine = rows.filter((r) => /\d{1,2}:\d{2}/.test(r.tee)).length;   // 티오프가 있는 만큼이 그날 근무선이다

console.log(`${iso} 칠판 원본 — ${rows.length}명 · 티오프 ${cutLine}칸 (기록 ${new Date(db.updatedAt || 0).toLocaleString('ko-KR')})`);
for (const r of rows) console.log(`  ${String(r.pos).padStart(2)}. ${r.name.padEnd(10)} ${r.tee || '(티오프 없음)'} ${r.course}${r.duty ? '  근태:' + r.duty : ''}`);
const dup = {};
for (const r of rows) if (r.tee) (dup[r.tee + '|' + r.course] ||= []).push(r.pos);
const bad = Object.entries(dup).filter(([, a]) => a.length > 1);
console.log(bad.length ? `★겹친 칸: ${bad.map(([k, a]) => k + '←' + a.join(',')).join('  ')}` : '겹친 칸 없음');
console.log(`인턴(그대로 유지): 배치표 ${boardInterns.length}칸 · 수동 포함 ${allInterns.length}칸`);

if (!SAVE) { console.log('\n미리보기입니다  (되돌리려면 --save)'); process.exit(0); }
fs.copyFileSync(path.join(DATA_DIR, 'lastboard.json'), path.join(DATA_DIR, `lastboard.json.bak-restore-${Date.now()}`));
const out = correctPart3({ rows, interns: boardInterns, allInterns, cutLine, notify: false, by: 'restore' });
console.log(`\n되돌렸습니다 — 회원 ${out.updated || 0}명 재계산 (알림은 안 나갔습니다). lastboard 백업 남김.`);
