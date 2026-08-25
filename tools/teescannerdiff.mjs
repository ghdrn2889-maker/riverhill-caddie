// 카카오 ↔ 티스캐너 여러 날 대조 — 두 번째 소스가 값어치가 있는지 판정한다.
//  기준은 단순하다: 한쪽에만 뜨는 칸이 있으면 그 칸은 '팀이 차서 사라진 게 아니다'를 증명한다.
//  하루도 어긋나지 않으면 두 소스는 같은 창고를 보는 것이고, 두 번째 소스는 값어치가 없다.
//  쓰기: node tools/teescannerdiff.mjs [날수=7]
import { loadEnv } from '../src/env.mjs';
loadEnv();
import * as ts from '../src/teescanner.mjs';
import * as kakao from '../src/kakaogolf.mjs';

const DAYS = Math.max(1, Math.min(14, Number(process.argv[2]) || 7));
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n오늘부터 ${DAYS}일 — 카카오와 티스캐너가 같은 칸을 보는가\n`);
console.log('날짜        카카오  티스캐너  양쪽   티스캐너만   카카오만');

let anyGap = 0;
const detail = [];
for (let i = 0; i < DAYS; i++) {
  const date = ymd(new Date(Date.now() + i * 86400000));
  let kk = null, tee = null, err = '';
  try { kk = await kakao.fetchOpen(date); } catch (e) { err += `카카오(${e.message.slice(0, 40)}) `; }
  try { tee = await ts.fetchOpen(date); } catch (e) { err += `티스캐너(${e.message.slice(0, 40)})`; }
  if (!kk || !tee) { console.log(`${date}   ${err}`); continue; }
  const K = new Set(kk.map((x) => `${x.time}|${x.course}`));
  const T = new Set(tee.map((x) => `${x.time}|${x.course}`));
  const both = [...T].filter((k) => K.has(k));
  const onlyT = [...T].filter((k) => !K.has(k)).sort();
  const onlyK = [...K].filter((k) => !T.has(k)).sort();
  anyGap += onlyT.length + onlyK.length;
  console.log(`${date}   ${String(K.size).padStart(4)}   ${String(T.size).padStart(6)}   ${String(both.length).padStart(4)}   ${String(onlyT.length).padStart(8)}   ${String(onlyK.length).padStart(7)}`);
  if (onlyT.length || onlyK.length) detail.push({ date, onlyT, onlyK });
  await sleep(1200);   // 남의 서버다 — 카카오에 지키는 예의를 여기에도 지킨다
}

if (detail.length) {
  console.log('\n── 어긋난 칸 ──');
  for (const d of detail) {
    if (d.onlyT.length) console.log(`  ${d.date} 티스캐너에만 ${d.onlyT.length}칸: ${d.onlyT.slice(0, 14).join(' ')}`);
    if (d.onlyK.length) console.log(`  ${d.date} 카카오에만   ${d.onlyK.length}칸: ${d.onlyK.slice(0, 14).join(' ')}`);
  }
}

console.log(`\n판정: ${anyGap
  ? `${DAYS}일 동안 어긋난 칸 ${anyGap}개 — 두 소스가 서로 다른 걸 본다. 검산에 쓸 값어치가 있다.`
  : `${DAYS}일 동안 한 칸도 안 어긋났다. 두 소스는 같은 창고를 본다 — 두 번째 소스로 새로 알아낼 게 없다.`}\n`);
