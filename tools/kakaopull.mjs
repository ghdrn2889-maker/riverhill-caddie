// 철수 소급 적용 — 이미 기록된 '한꺼번에 내려감'을 되짚어 옛 스냅샷에서 허위 팀을 걷어낸다.
//
//  왜 필요한가: 엔진은 앞으로의 철수는 알아서 거른다. 하지만 규칙이 생기기 전에 지나간 철수는
//  이미 '찼다'로 굳어 있다(8/18 1부 07:01에 24칸이 한 번에 내려갔고, 마감선 밖 12칸이 예약으로
//  잡혀 배치표 3팀이 카카오 15팀이 됐다). 다행히 그 순간을 엔진이 kakao-close.jsonl에 적어뒀다.
//
//  판정 규칙은 엔진과 같다 — '한 부 안에서 PULL_BULK칸 이상 한 틱에' 내려가면 철수.
//  (부를 섞어 우연히 겹친 것은 철수가 아니다. 실측에서 2부 2칸 + 3부 2칸이 겹친 사건이 있었다.)
//
//  사용: node tools/kakaopull.mjs           (미리보기)
//        node tools/kakaopull.mjs --save    (스냅샷에 반영 — 다음 틱부터 엔진이 이어받는다)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import { fixedSlots } from '../src/kakaogolf.mjs';

const SAVE = process.argv.includes('--save');
const PULL_BULK = Number(process.env.KAKAO_PULL_BULK || 4);

const partOf = new Map(fixedSlots().map((f) => [`${f.time}|${f.course}`, f.part]));
const logFile = path.join(DATA_DIR, 'kakao-close.jsonl');
if (!fs.existsSync(logFile)) { console.error('kakao-close.jsonl 이 없습니다.'); process.exit(1); }

// ── 기록에서 '철수'로 읽히는 칸을 날짜별로 모은다 ──
const byDate = new Map();
for (const line of fs.readFileSync(logFile, 'utf8').trim().split('\n')) {
  let r; try { r = JSON.parse(line); } catch { continue; }
  const slots = Array.isArray(r.slots) ? r.slots : [];
  if (slots.length < PULL_BULK) continue;                       // 틱 전체가 문턱 미만이면 볼 것도 없다
  const byPart = {};
  for (const k of slots) (byPart[partOf.get(k) || '?'] ||= []).push(k);
  for (const [p, arr] of Object.entries(byPart)) {
    if (arr.length < PULL_BULK) continue;
    const d = String(r.date);
    if (!byDate.has(d)) byDate.set(d, { keys: new Set(), events: [] });
    const e = byDate.get(d);
    arr.forEach((k) => e.keys.add(k));
    e.events.push({ at: r.at, part: p, n: arr.length });
  }
}
if (!byDate.size) { console.log(`철수로 읽히는 사건이 없습니다(문턱 ${PULL_BULK}칸/부).`); process.exit(0); }

let touched = 0;
for (const [date, e] of [...byDate].sort()) {
  const f = path.join(DATA_DIR, 'kakao-board', `${date}.json`);
  for (const ev of e.events) console.log(`${date}  ${new Date(ev.at).toLocaleTimeString('ko-KR')}  ${ev.part}부 ${ev.n}칸 한 번에 내려감`);
  if (!fs.existsSync(f)) { console.log(`  · 스냅샷 없음 — 건너뜀\n`); continue; }
  const snap = JSON.parse(fs.readFileSync(f, 'utf8'));

  const pulled = new Set(snap.pulledKeys || []);
  const openNow = new Set(snap.openKeys || []);
  let added = 0;
  for (const k of e.keys) { if (openNow.has(k)) continue; if (!pulled.has(k)) { pulled.add(k); added++; } }  // 지금 팔리는 중이면 철수가 아니다

  const before = Number(snap.bookedCount || 0);
  const confirmed = (snap.confirmedKeys || []).filter((k) => !pulled.has(k));
  const byPart = {};
  for (const [p, arr] of Object.entries(snap.byPart || {})) {
    const kept = arr.filter((x) => !pulled.has(`${x.time}|${x.course}`));
    if (kept.length) byPart[p] = kept;
  }
  const peak = {};
  for (const [p, arr] of Object.entries(snap.peakByPart || {})) {
    const kept = arr.filter((x) => !pulled.has(`${x.time}|${x.course}`));
    if (kept.length) peak[p] = kept;
  }
  const after = Object.values(byPart).reduce((s, a) => s + a.length, 0);
  console.log(`  · 철수 칸 ${pulled.size}개(새로 ${added}개) · 찬 팀 ${before} → ${after} · 확정칸 ${(snap.confirmedKeys || []).length} → ${confirmed.length}`);

  if (SAVE) {
    fs.copyFileSync(f, `${f}.bak-pull-${Date.now()}`);
    fs.writeFileSync(f, JSON.stringify({ ...snap, pulledKeys: [...pulled].sort(), confirmedKeys: confirmed, byPart, peakByPart: peak, bookedCount: after }));
    console.log('  · 저장함(백업 남김)');
  }
  touched++;
  console.log('');
}
console.log(SAVE ? `${touched}개 날짜 반영 완료 — 다음 틱부터 엔진이 이어받습니다.` : `${touched}개 날짜가 대상입니다  (실제로 반영하려면 --save)`);
