// 증분 판독 판단 검증 — 실제 배치표 이미지로 '어느 부를 건너뛸지'를 확인한다. Claude 호출 0회.
//  이 판단이 틀리면 바뀐 부를 안 읽고 넘어가는 사고가 나므로, 배포 전에 실이미지로 돌려본다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import { incrPlan } from '../src/boardreader.mjs';

const IMG = path.join(DATA_DIR, 'ingest-images');
const CACHE = path.join(DATA_DIR, 'board-incremental.json');
const BOUNDS = [ // 3부 배치표 표준 배치(좌→우 1·2·3부)
  { part: 1, x0: 0.02, x1: 0.34 }, { part: 2, x0: 0.35, x1: 0.67 }, { part: 3, x0: 0.68, x1: 0.99 },
];
const backup = fs.existsSync(CACHE) ? fs.readFileSync(CACHE) : null;

async function run(label, prev, now, expect) {
  fs.writeFileSync(CACHE, JSON.stringify([{
    img: path.join(IMG, prev), at: Date.now(), bounds: BOUNDS,
    cuts: { 1: 10, 2: 12, 3: 16 }, parts: { 1: { roster: ['가'] }, 2: { roster: ['나'] }, 3: { roster: ['다'] } },
    offList: [{ name: '홍길동', reason: '휴무' }], dutyList: [],
  }]));
  const plan = await incrPlan(path.join(IMG, now));
  const got = plan ? [...plan.unchanged].sort().join(',') : '(전체판독)';
  const ok = got === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      그대로: ${got}\n      기대  : ${expect}\n`);
  return ok;
}

const cases = [
  // 같은 그림 — 전 구역 그대로
  ['같은 그림(8/14 14:56 재전송)', 'img_1786686975689.png', 'img_1786686975689.png', 'crew,duty,p1,p2,p3,sum'],
  // 실제 수정본 15분 뒤 — 오른쪽만 바뀜 → 1·2부는 건너뛰고 3부만 읽어야 한다
  ['수정본(8/14 14:41→14:56)', 'img_1786686091205.png', 'img_1786686975689.png', 'p1,p2,sum'],
  // 다른 날 배치표 — 아무것도 건너뛰면 안 된다
  ['다른 날(8/14→8/15)', 'img_1786686975689.png', 'img_1786777095859.png', '(전체판독)'],
  // 화면을 찍은 JPEG 사진 — 재압축 잡음. 절대 건너뛰면 안 된다
  ['JPEG 사진(8/15 09:00→15:06)', 'img_1786752019801.jpeg', 'img_1786773980470.jpeg', '(전체판독)'],
  // 크기가 다른 그림 — 비교 불가 → 전체 판독
  ['크기 다름(770x1515 vs 1120x1040)', 'img_1786806018842.png', 'img_1786845126387.png', '(전체판독)'],
];

let pass = 0;
for (const [l, a, b, e] of cases) if (await run(l, a, b, e)) pass += 1;
if (backup) fs.writeFileSync(CACHE, backup); else { try { fs.unlinkSync(CACHE); } catch { /* noop */ } }
console.log(`${pass}/${cases.length} 통과`);
process.exit(pass === cases.length ? 0 : 1);
