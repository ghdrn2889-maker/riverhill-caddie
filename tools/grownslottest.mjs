// 범위를 늘려 생긴 칸에도 '여기 팀 있다'고 말할 수 있는가.
//
//  2026-08-27: 본배치표는 3부 16:25 OUT에 팀을 배정했는데 카카오·티스캐너 둘 다 못 봤다.
//   16:25는 기본 시간표에 없다(3부 기본틀 first = 16:32). 어제 18:46에 모니터에서
//   "오늘 3부 첫 티오프는 16:25"로 선언해 격자가 한 줄 앞으로 늘어난 칸이다.
//
//  ★엔진은 여집합이다 — '고정표에 있는데 지금 안 팔린다 = 찼다'. 카카오 재고에 애초에 없던
//   칸은 "판매중이 사라졌다"가 성립하지 않는다. 그대로 여집합을 돌리면 없는 칸이 영영
//   '찼다'로 잡힌다(8/19: 3부 last를 18:52로 선언한 17초 뒤 18:52 OUT·IN이 허위 팀).
//   그래서 kakaogolf에 frameGrown 가드가 있다 — 판 적 없는 늘린 칸은 판정하지 않는다.
//
//  ★그 가드는 inserted 표식이 있는 칸을 봐준다("사람이 여기 팀을 끼웠다고 말한 것").
//   그런데 그 표식을 붙일 길이 막혀 있었다. 두 군데서.
//    ① setPartSlot이 기본틀로 범위를 재서 16:25를 거절했다("3부 시간대(16:32~18:45) 밖")
//    ② reframeSlots의 extra 루프가 '이미 있는 칸이면 continue'라 표식을 안 얹었다
//   즉 늘린 칸에는 '팀 있다'고 말할 방법이 아예 없었다 — 우회로가 없는 막다른 길이었다.
//
//  ★'늘렸다'와 '거기 팀이 있다'는 다른 말이고, 사람은 둘 다 말할 수 있어야 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reframeSlots } from '../src/dayframe.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

// 3부 기본틀을 흉내 낸다 — 16:32부터(오늘 실제 config 그대로).
const baseSlots = () => {
  const out = [];
  for (let m = 16 * 60 + 32; m <= 16 * 60 + 46; m += 7) {
    for (const c of ['OUT', 'IN']) out.push({ part: '3', mins: m, time: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, course: c });
  }
  return out;
};

console.log('\n── 늘리기만 하면: 판정 대상이 아니다(가드는 그대로) ──');
{
  const r = reframeSlots(baseSlots(), { cadence: 7, frame: { 3: { first: '16:25' } } });
  const grown = r.added.filter((s) => s.mins === 16 * 60 + 25);
  ok(grown.length === 2, `16:25 OUT·IN이 새로 생겼다 (${grown.length}칸)`);
  ok(grown.every((s) => !s.inserted),
    '★표식이 없다 — 늘린 것만으로는 팀이 있다는 뜻이 아니다',
    "8/19에 18:52를 선언했더니 있지도 않은 팀 둘이 생겼다 — 그 가드는 살아 있어야 한다");
}

console.log('\n── 늘린 칸에 ＋칸을 찍으면: 표식이 얹힌다 ──');
{
  const r = reframeSlots(baseSlots(), { cadence: 7, frame: { 3: { first: '16:25', extra: ['16:25|OUT'] } } });
  const at = r.slots.filter((s) => s.mins === 16 * 60 + 25);
  ok(at.length === 2, '칸이 늘지 않는다(중복 생성 없음)', '두 번 들어가면 팀 수가 하나 더 잡힌다');
  const out16 = at.find((s) => s.course === 'OUT');
  const in16 = at.find((s) => s.course === 'IN');
  ok(!!(out16 && out16.inserted === true), '★찍은 칸(16:25 OUT)에 표식이 붙었다',
    '전에는 이미 있는 칸이면 continue라 이 말이 통째로 버려졌다');
  ok(!!(in16 && !in16.inserted), '안 찍은 칸(16:25 IN)은 그대로다', '한 코스만 도는 날이 있다');
  const grownKeys = r.added.filter((s) => !s.inserted).map((s) => `${s.time}|${s.course}`);
  ok(!grownKeys.includes('16:25|OUT'),
    '★엔진의 판정 제외 목록에서 빠진다(frameGrown)',
    'kakaogolf가 보는 건 added 중 inserted가 아닌 것뿐이다');
  ok(grownKeys.some((k) => k.startsWith('16:25|IN')), '안 찍은 쪽은 여전히 제외된다');
}

console.log('\n── 기본틀 안의 칸을 찍어도 탈나지 않는다 ──');
{
  const r = reframeSlots(baseSlots(), { cadence: 7, frame: { 3: { extra: ['16:39|OUT'] } } });
  ok(r.slots.filter((s) => s.mins === 16 * 60 + 39 && s.course === 'OUT').length === 1, '칸이 두 개가 되지 않는다');
  ok(r.added.length === 0 || !r.added.some((s) => s.mins === 16 * 60 + 39),
    '원래 있던 칸은 added에 안 들어간다', 'added는 선언으로 새로 생긴 칸만이다');
}

console.log('\n── 격자 밖 진짜 끼움은 그대로 동작한다 ──');
{
  const r = reframeSlots(baseSlots(), { cadence: 7, frame: { 3: { extra: ['16:36|OUT'] } } });
  const s = r.slots.find((x) => x.mins === 16 * 60 + 36);
  ok(!!(s && s.inserted === true), '★7분 배수가 아닌 칸도 끼울 수 있다',
    '예약팀이 팀을 하나 더 받으려 사이에 칸을 끼우는 날이 있다(tee-offgrid-insert)');
}

console.log('\n── 모니터가 그날 범위로 검사한다 ──');
{
  const M = read('src/monitor.mjs');
  ok(/setPartSlot\(date, part, t, c \|\| 'OUT', req\.body\.on !== false, \{ by: '모니터', range: cur \|\| base \}\);/.test(M),
    '★검사 기준이 그날 선언 범위(cur)다',
    "기본틀로 재면 앞으로 늘린 16:25에 ＋칸을 못 찍는다 — 정작 그 칸이 말해줘야 하는 자리다");
  ok(/막으려던 것\(3부 격자에 06:23을 끼우는 실수\)은 cur로도 그대로 막힌다/.test(M),
    '무엇을 막으려던 검사였는지 적어뒀다');
  const D = read('src/dayframe.mjs');
  ok(/const hit = out\.find\(\(s\) => s\.part === p && s\.mins === m && s\.course === c\);/.test(D)
    && /if \(hit\) \{ hit\.inserted = true; continue; \}/.test(D), '★건너뛰지 않고 표식을 얹는다');
  ok(/const frameGrown = new Set\(framed\.added\.filter\(\(s\) => !s\.inserted\)/.test(read('src/kakaogolf.mjs')),
    '엔진이 그 표식을 본다(계약이 살아 있다)');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
