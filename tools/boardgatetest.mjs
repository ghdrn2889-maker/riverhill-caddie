// 배치표를 만지는 화면이 셋인데 문은 하나다 — 그 문이 제대로 지키는가.
//
//  · 배치표 검수(모니터 탭) · 대조판(/daejo) · 예약 구성판(/booking)
//  셋 다 살아 있는 배치표를 /api/board-correct 하나로만 쓴다.
//  화면 수는 문제가 아니다. 문제는 두 가지였다.
//   ① 판본 검사가 검수 탭에만, 그것도 클라이언트에만 있었다 — 나머지 둘은 무방비.
//   ② 화면마다 서버에 말할 수 있는 어휘가 달라서, 말하지 않은 것을 서버가 추측했다.
//     그 추측이 인턴을 건드리지도 않은 교정에서 그날 수동 지정을 지웠다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { correctPart3 } from '../src/boardcorrect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => {
  if (c) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const mon = read('src/monitor.mjs');
const idx = read('monitor/index.html');
const dae = read('tools/daejo-client.js');
const bkc = read('tools/booking-client.js');
const bkg = read('tools/gen-booking.mjs');
const dad = read('src/daejodata.mjs');
const bc = read('src/boardcorrect.mjs');

console.log('\n[문은 하나인가]');
{
  const live = [...mon.matchAll(/app\.post\('(\/api\/[a-z0-9-]+)'/g)].map((m) => m[1]);
  ok(live.includes('/api/board-correct'), '살아 있는 배치표를 쓰는 문이 있다');
  // 화면 셋이 모두 그 문으로 들어오는가
  ok(/apiUrl\('\/api\/board-correct'\)/.test(idx), '검수 탭이 그 문으로 들어온다');
  ok(/\/api\/board-correct/.test(dae), '대조판이 그 문으로 들어온다');
  ok(/\/api\/board-correct/.test(mon.slice(mon.indexOf("app.post('/api/booking-save'"))),
    '예약 구성판도 그 문으로 들어온다', '따로 쓰는 화면이 하나라도 있으면 검사도 로그도 새어나간다');
}

console.log('\n[★판본 검사 — 불러온 뒤 바뀌었으면 덮지 않는다]');
{
  ok(/function boardSigOf\(part\)/.test(mon), '서명을 세는 곳이 서버에 하나 있다');
  const g = mon.slice(mon.indexOf('function boardSigOf'), mon.indexOf('function boardSigOf') + 900);
  ok(/bp\.at \|\| ''\}\|\$\{\(pd\._adminCorrected/.test(g) && /v\._t1Sig \|\| ''\}\|\$\{\(v\._adminCorrected/.test(g),
    '서명 식이 board-review가 내려주는 것과 같다',
    '식이 다르면 검사가 늘 걸려 아무도 저장을 못 한다 — 안전장치가 자물쇠가 된다');
  ok(/if \(baseSig && nowSig && baseSig !== nowSig\)/.test(mon), '★다르면 저장하지 않는다');
  ok(/stale: true/.test(mon), '왜 막혔는지 화면이 알아들을 수 있게 말한다');
  ok(/baseSig && nowSig/.test(mon), '서명을 안 실은 옛 호출은 막지 않는다',
    '검사를 강제하면 아직 안 고친 화면이 통째로 멎는다 — 문을 좁히되 잠그진 않는다');

  ok(/if\(baseSig\) body\.baseSig=baseSig;/.test(idx) && /notify, iSplit\.all, rvSyncSig\)/.test(idx),
    '검수 탭이 서명을 싣는다');
  ok(/baseSig: String\(\(BOARD\[part\] \|\| \{\}\)\.syncSig \|\| ''\)/.test(dae), '★대조판이 서명을 싣는다',
    '여기가 비어 있던 게 병행 사용의 실제 비용이었다');
  ok(/syncSig: S\[p\]\.syncSig/.test(bkc) && /baseSig: String\(v\.syncSig \|\| ''\)/.test(mon),
    '★예약 구성판이 서명을 싣는다');
  ok(/syncSig: String\(src\?\.syncSig \|\| ''\)/.test(bkg), '구성판 화면에 서명이 실려 나간다');
  ok(/out\[p\]\.syncSig =/.test(dad) && /out\['3'\]\.syncSig =/.test(dad),
    '대조판·구성판이 읽는 데이터가 서명을 들고 있다');

  ok(/if\(res\.stale\)/.test(idx), '검수 탭이 막혔을 때 사람 말로 알려준다');
  ok(/if \(j\.stale\)/.test(dae), '대조판이 막혔을 때 사람 말로 알려준다');
  ok(/if \(j\.stale\)/.test(mon), '구성판이 막혔을 때 사람 말로 알려준다');
}

console.log('\n[★인턴 — 말하지 않은 것을 추측하지 않는다]');
{
  ok(/: null;\n  if \(ikey && manTees\) \{/.test(bc),
    '★안 실은 호출은 인턴을 손대지 않은 것으로 본다',
    "예전엔 '넘어온 게 곧 전부'로 추측해서, 이름만 고친 교정이 그날 수동 지정을 지웠다");
  ok(/const internSource = _ikey && internManualFor\(_ikey\)/.test(mon), '수동 지정이 있는 날인지 화면에 말해준다');
  ok(/const interns = _ikey\n\s+\? internTeesFor\(_ikey, boardInterns\)/.test(mon),
    '★검수 탭이 실제로 쓰이는 인턴을 본다', '판독값만 보여주면 관리자가 틀린 걸 보고 틀린 걸 저장한다');
  ok(/rows, interns, boardInterns, internSource,/.test(mon), '사진이 읽은 칸은 따로 준다');
  ok(/function rvInternSplit\(rows, interns\)/.test(idx), '검수 탭이 두 갈래로 나눠 싣는다');
  ok(/onBoard: all\.filter\(function\(x\)\{ return slot\[x\.time\+'\|'\+x\.course\]; \}\)/.test(idx),
    '배치표에는 팀이 있는 칸만', '팀 없는 칸을 넣으면 없는 팀이 유령으로 생겨 순번 밀림이 어긋난다');
  ok(/body\.allInterns=allInterns/.test(idx), '수동 지정에는 전부를');
}

console.log('\n[실제로 지워지는가 — 인턴 수동 지정 보존]');
{
  // correctPart3 를 부르지 않고, 그 안의 규칙만 재현해 확인한다(라이브 데이터를 만지지 않는다).
  const src = bc.slice(bc.indexOf('const manTees'), bc.indexOf('v.part3Roster = roster'));
  ok(!/: iTees;/.test(src), '★넘어온 목록을 수동 지정으로 굳히는 길이 사라졌다');
  ok(/before !== sig\(manTees\)/.test(src), '실제로 달라졌을 때만 수동 지정을 옮긴다',
    '이름만 고친 교정까지 수동으로 굳히면 그 뒤 새 배치표의 노란 칸 판독이 조용히 무시된다');
  ok(typeof correctPart3 === 'function', 'correctPart3 가 여전히 불러와진다');
}

console.log('\n[문패가 사실을 말하는가]');
{
  ok(!/대조판 저장은 테스트판으로만 간다/.test(mon),
    '★"대조판은 테스트판으로만 간다"는 낡은 말이 사라졌다', '대조판에는 반영 버튼이 있다 — 주석이 거짓말을 하고 있었다');
  ok(/배치표를 만지는 화면은 셋이다. 문은 하나다/.test(mon), '세 화면의 역할이 코드에 적혀 있다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
