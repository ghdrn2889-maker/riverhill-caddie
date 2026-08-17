// 판매이력(kakao-sellable.json)을 기존 스냅샷에서 한 번 채운다 — '카카오가 안 파는 칸' 판단의 밑천.
//  스냅샷마다 그 날짜에서 판매중으로 본 칸(everOpenKeys)이 있다. 전 날짜를 합치면
//  "이 칸은 어느 날짜에서든 팔린 적이 있는가"가 나오고, 그게 안 파는 칸을 가르는 유일한 근거다.
//  안 돌려도 며칠이면 저절로 쌓이지만, 돌리면 그동안 본 걸 안 버린다.
//
//  실행: node tools/kakaoseed.mjs        (보기만)
//        node tools/kakaoseed.mjs --write (저장)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadJSON, saveJSON } from '../src/store.mjs';
import { fixedSlots } from '../src/kakaogolf.mjs';

const WRITE = process.argv.includes('--write');
const SNAP_DIR = path.join(DATA_DIR, 'kakao-board');
const FILE = 'kakao-sellable.json';

const sell = loadJSON(FILE, {}) || {};
let added = 0;
const files = fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR).filter((f) => /^\d{8}\.json$/.test(f)).sort() : [];
for (const f of files) {
  const date = f.replace('.json', '');
  let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
  for (const k of [...(s.everOpenKeys || []), ...(s.openKeys || [])]) {
    const arr = (sell[k] ||= []);
    if (!arr.includes(date)) { arr.push(date); added++; }
  }
}
console.log(`스냅샷 ${files.length}개 → 판매이력 ${Object.keys(sell).length}칸 (새로 ${added}건)`);

// 부·코스별로 무엇이 안 팔리는지 보여준다 — 이 목록이 곧 엔진의 사각지대다.
const F = fixedSlots();
const soldTimes = {};
for (const x of F) if ((sell[`${x.time}|${x.course}`] || []).length) (soldTimes[`${x.part}|${x.course}`] ||= new Set()).add(x.time);
const MATURE = Number(process.env.KAKAO_SELL_MATURE || 8);
for (const p of [...new Set(F.map((x) => x.part))].sort()) {
  for (const c of [...new Set(F.filter((x) => x.part === p).map((x) => x.course))].sort()) {
    const n = soldTimes[`${p}|${c}`]?.size || 0;
    const never = F.filter((x) => x.part === p && x.course === c && !(sell[`${x.time}|${x.course}`] || []).length).map((x) => x.time);
    const verdict = n < MATURE ? `판단보류(팔린 시각 ${n} < ${MATURE})` : (never.length ? `★안 파는 칸 ${never.length}: ${never.join(' ')}` : '전 칸 판매 확인');
    console.log(`  ${p}부 ${c.padEnd(3)} 팔린 시각 ${String(n).padStart(2)}종 — ${verdict}`);
  }
}

if (WRITE) { saveJSON(FILE, sell); console.log(`\n저장했다: data/${FILE}`); }
else console.log('\n(보기만 했다. 저장하려면 --write)');
