// 철수(캐디 부족으로 내려간 칸)를 스냅샷에 반영한다 — 자동으로 못 잡는 날은 사람이 정한다.
//
//  ── 왜 두 갈래인가 ──
//  ①뭉텅이 철수: 한 부에서 여러 칸이 한 틱에 내려간다(8/18 1부 07:01, 24칸). 엔진이 실시간으로
//    거르지만, 규칙이 생기기 전에 지나간 날은 이 도구로 기록(kakao-close.jsonl)을 되짚어 소급한다.
//  ②꼬리가 한 칸씩 몇 시간에 걸쳐 내려가는 날(8/18 3부: 09:21·09:56·10:36·11:11·11:16).
//    동시 개수를 보는 규칙으로는 원리상 못 잡는다 — 문턱을 1로 내리면 모든 예약이 철수가 된다.
//    그렇다고 "당일 소멸은 전부 철수"로 못박으면 진짜 당일 예약이 들어온 날 그 팀을 통째로 지운다
//    (blind 규칙으로 이미 겪었다 — 정확도 100%→88.9%). 그래서 이런 날은 관리자가 정한다.
//
//  ★관리자 입력은 칸이 아니라 '끝선'이다 — "오늘 이 부는 여기까지".
//   스페어가 다 나가면 그 뒤는 아무도 없다는, 관리자가 이미 아는 사실 그대로의 모양이다.
//   지정한 뒤라도 그 칸이 다시 판매중으로 뜨면 엔진이 알아서 되돌린다(철수가 아니었다는 뜻).
//
//  사용: node tools/kakaopull.mjs                                              (기록에서 뭉텅이 철수 찾기)
//        node tools/kakaopull.mjs --save
//        node tools/kakaopull.mjs --date 20260818 --part 3 --end 18:10         (끝선 지정 — 미리보기)
//        node tools/kakaopull.mjs --date 20260818 --part 3 --end 18:10 --save
//        node tools/kakaopull.mjs --date 20260818 --slots "08:50|IN" --save     (칸 지정)
//   ★같은 시각에 IN·OUT 두 칸이 있어 끝선으로는 못 가르는 날이 있다 — 8/18 1부는 마지막 팀이
//    08:50 OUT이라 08:50 IN만 팀이 없었다. 그때는 칸을 직접 준다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import { fixedSlots } from '../src/kakaogolf.mjs';

const SAVE = process.argv.includes('--save');
const PULL_BULK = Number(process.env.KAKAO_PULL_BULK || 4);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? String(process.argv[i + 1] || '') : ''; };
const toMin = (hm) => { const m = String(hm).match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

const SLOTS = fixedSlots();
const partOf = new Map(SLOTS.map((f) => [`${f.time}|${f.course}`, f.part]));
const snapPath = (date) => path.join(DATA_DIR, 'kakao-board', `${date}.json`);

// 스냅샷에서 그 칸들을 '철수'로 옮긴다 — 찼다는 판정·최대치에서 함께 걷어낸다.
//  (최대치는 줄지 않는 값이라 걷어내지 않으면 허위 팀이 하루 종일 대조표에 남는다.)
function applyToSnapshot(date, keys, note) {
  const f = snapPath(date);
  if (!fs.existsSync(f)) { console.log(`  · ${date} 스냅샷 없음 — 건너뜀`); return false; }
  const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
  const openNow = new Set(snap.openKeys || []);
  const pulled = new Set(snap.pulledKeys || []);
  let added = 0, selling = 0;
  for (const k of keys) {
    if (openNow.has(k)) { selling++; continue; }        // 지금 팔리는 중이면 철수가 아니다
    if (!pulled.has(k)) { pulled.add(k); added++; }
  }
  const keep = (x) => !pulled.has(`${x.time}|${x.course}`);
  const byPart = {}; for (const [p, a] of Object.entries(snap.byPart || {})) { const k = a.filter(keep); if (k.length) byPart[p] = k; }
  const peak = {}; for (const [p, a] of Object.entries(snap.peakByPart || {})) { const k = a.filter(keep); if (k.length) peak[p] = k; }
  const confirmed = (snap.confirmedKeys || []).filter((k) => !pulled.has(k));
  const after = Object.values(byPart).reduce((s, a) => s + a.length, 0);
  console.log(`  · 철수 ${pulled.size}칸(새로 ${added})${selling ? ` · 판매중이라 건너뜀 ${selling}칸` : ''} · 찬 팀 ${snap.bookedCount || 0} → ${after}`);
  if (!SAVE) return true;
  fs.copyFileSync(f, `${f}.bak-pull-${Date.now()}`);
  fs.writeFileSync(f, JSON.stringify({ ...snap, pulledKeys: [...pulled].sort(), confirmedKeys: confirmed, byPart, peakByPart: peak, bookedCount: after }));
  // ★사람이 손댄 것은 남긴다 — 계측을 볼 때 '엔진이 알아낸 것'과 섞이면 안 된다.
  fs.appendFileSync(path.join(DATA_DIR, 'kakao-manual.jsonl'),
    JSON.stringify({ at: Date.now(), date, note, keys: [...keys], by: 'admin' }) + '\n');
  console.log('  · 저장함(백업 남김)');
  return true;
}

// ── 갈래 ② 관리자 지정(칸 단위) ──
const dateArg = arg('--date').replace(/-/g, '');
const partArg = arg('--part');
const endArg = arg('--end');
const slotArg = arg('--slots');
if (dateArg && slotArg) {
  const known = new Set(SLOTS.map((f) => `${f.time}|${f.course}`));
  const keys = slotArg.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const bad = keys.filter((k) => !known.has(k));
  if (bad.length) { console.error(`기본틀에 없는 칸입니다: ${bad.join(' ')}  (형식: 08:50|IN)`); process.exit(1); }
  console.log(`${dateArg}  관리자 지정 ${keys.length}칸을 철수로 봅니다`);
  console.log(`  ${keys.join(' ')}`);
  applyToSnapshot(dateArg, keys, '관리자 칸 지정');
  console.log(SAVE ? '\n반영 완료 — 다음 틱부터 엔진이 이어받습니다(다시 팔리면 저절로 풀립니다).' : '\n미리보기입니다  (반영하려면 --save)');
  process.exit(0);
}

// ── 갈래 ③ 관리자 끝선 지정 ──
if (dateArg && partArg && endArg) {
  const end = toMin(endArg);
  if (!Number.isFinite(end)) { console.error('--end 는 HH:MM 형식이어야 합니다(예: 18:10).'); process.exit(1); }
  const keys = SLOTS.filter((f) => String(f.part) === String(partArg) && f.mins > end).map((f) => `${f.time}|${f.course}`);
  if (!keys.length) { console.log(`${partArg}부 기본틀에 ${endArg} 뒤 칸이 없습니다 — 할 일이 없습니다.`); process.exit(0); }
  console.log(`${dateArg}  ${partArg}부 끝선 ${endArg} — 그 뒤 ${keys.length}칸을 철수로 봅니다`);
  console.log(`  ${keys.join(' ')}`);
  applyToSnapshot(dateArg, keys, `관리자 끝선 지정 ${partArg}부 ${endArg}`);
  console.log(SAVE ? '\n반영 완료 — 다음 틱부터 엔진이 이어받습니다(다시 팔리면 저절로 풀립니다).' : '\n미리보기입니다  (반영하려면 --save)');
  process.exit(0);
}
if (dateArg || partArg || endArg) { console.error('끝선은 --date --part --end, 칸 지정은 --date --slots 를 주셔야 합니다.'); process.exit(1); }

// ── 갈래 ① 기록에서 뭉텅이 철수 찾기 ──
//  판정 규칙은 엔진과 같다 — '한 부 안에서 PULL_BULK칸 이상 한 틱에'.
//  (부를 섞어 우연히 겹친 것은 철수가 아니다. 실측에 2부 2칸 + 3부 2칸이 겹친 사건이 있었다.)
const logFile = path.join(DATA_DIR, 'kakao-close.jsonl');
if (!fs.existsSync(logFile)) { console.error('kakao-close.jsonl 이 없습니다.'); process.exit(1); }
const byDate = new Map();
for (const line of fs.readFileSync(logFile, 'utf8').trim().split('\n')) {
  let r; try { r = JSON.parse(line); } catch { continue; }
  const slots = Array.isArray(r.slots) ? r.slots : [];
  if (slots.length < PULL_BULK) continue;
  const grp = {};
  for (const k of slots) (grp[partOf.get(k) || '?'] ||= []).push(k);
  for (const [p, a] of Object.entries(grp)) {
    if (a.length < PULL_BULK) continue;
    const d = String(r.date);
    if (!byDate.has(d)) byDate.set(d, { keys: new Set(), events: [] });
    const e = byDate.get(d);
    a.forEach((k) => e.keys.add(k));
    e.events.push({ at: r.at, part: p, n: a.length });
  }
}
if (!byDate.size) { console.log(`뭉텅이 철수로 읽히는 사건이 없습니다(문턱 ${PULL_BULK}칸/부).`); process.exit(0); }
let touched = 0;
for (const [date, e] of [...byDate].sort()) {
  for (const ev of e.events) console.log(`${date}  ${new Date(ev.at).toLocaleTimeString('ko-KR')}  ${ev.part}부 ${ev.n}칸 한 번에 내려감`);
  if (applyToSnapshot(date, e.keys, '기록에서 되짚은 뭉텅이 철수')) touched++;
  console.log('');
}
console.log(SAVE ? `${touched}개 날짜 반영 완료 — 다음 틱부터 엔진이 이어받습니다.` : `${touched}개 날짜가 대상입니다  (반영하려면 --save)`);
