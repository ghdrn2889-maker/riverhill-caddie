// 카카오 보조 — 어느 부를 맡겼고, 맡긴 부에서 무엇이 실제로 바뀌는가.
//
//  ★2026-08-23 결정: 1·2부는 카카오 예상 엔진에 맡긴다. 3부는 아직 아니다.
//   일주일 계측에서 3부는 커트를 두 번 높게 불렀다 — 8/21 최재영(29번) · 8/22 박준서(34번),
//   둘 다 실제로는 스페어였다. 켰다면 근무가 아닌 사람에게 근무 알림이 나갔다.
//   같은 기간 1·2부는 승격 제안이 0건이었고 놓침도 1부 3% · 2부 0%였다.
//  ★그래서 스위치는 부마다 따로여야 한다. 전역 하나로 켜면 3부가 딸려 켜진다.
//  ★1·2부가 무주공산이라는 말은 사실이 아니다 — (1,3)·(2,3) 두 탕을 뛰는 회원이 그 부 카드를
//   들고 있다(8/23 실측 6명, 연승준 1부 06:37). 맡긴다는 건 그 사람들 카드도 맡긴다는 뜻이다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const noC = (t) => t.replace(/^[ \t]*\/\/.*$/gm, '');
const srv = noC(read('src/server.mjs'));
const brg = noC(read('src/kakaobridge.mjs'));
// 함수 본문만 정확히 도려낸다 — 넉넉히 자르면 옆 함수 코드까지 검사에 섞인다.
const bodyOf = (src, head) => {
  const i = src.indexOf(head); if (i < 0) return '';
  const end = src.indexOf('\n}\n', i);
  return end < 0 ? src.slice(i) : src.slice(i, end + 2);
};
const APPLY = bodyOf(srv, 'async function kakaoForPart');
const OBS = bodyOf(srv, 'async function observeMinorKakao');

console.log('\n[스위치는 부마다 따로인가]');
{
  ok(/export function assistOn\(part = ''\)/.test(brg), '★부를 받아서 판단한다',
    '전역 하나면 1·2부를 켜는 순간 3부까지 켜진다 — 3부는 커트를 높게 부른다');
  ok(/use-kakao-assist-\$\{part\}/.test(brg), '부별 스위치 파일을 본다(use-kakao-assist-2)');
  ok(/\['1', 'true', 'yes', 'all'\]\.includes\(env\)/.test(brg), '옛 전역 스위치는 그대로 산다(회귀 0)');
  ok(/env\.includes\(','\)/.test(brg), '부 목록은 쉼표로만 읽는다',
    "'1' 한 글자는 옛 뜻(=켬)이라 부 번호로 읽으면 안 된다");
  ok(/applied: observeOnly \? false : assistOn\(part\)/.test(brg),
    '기록의 applied는 그 부의 스위치를 따른다');
}

console.log('\n[맡긴 부는 실제로 카카오가 이끄는가]');
{
  ok(!!APPLY, '판독한 부에 카카오를 얹는 함수가 있다');
  ok(/vp\.teeGrid = a\.teeGrid;/.test(APPLY) && /vp\.cutoffPosition = a\.cut;/.test(APPLY),
    '★켜져 있으면 티오프표와 커트를 카카오 값으로 바꾼다', '이게 맡긴다는 말의 실제 내용이다');
  ok(/if \(a\.applied\)/.test(APPLY), '꺼져 있으면 바꾸지 않는다(기록만)');
  ok(/vp\._kakaoAssist = \{/.test(APPLY), '무엇을 카카오가 바꿨는지 판정에 남긴다',
    '나중에 틀렸을 때 누구 탓인지 알 수 있어야 한다');
  const i = srv.indexOf('await kakaoForPart(vp, p,');
  const j = srv.indexOf('setBoardPart(full.id,', i);
  const k = srv.indexOf('interpretForMember(full, outP.rawVerdict', i);
  ok(i > 0 && j > i && k > i,
    '★모니터 저장·회원 처리보다 먼저 얹는다',
    '뒤에 얹으면 모니터엔 카카오, 회원 카드엔 사진 판독이 남아 같은 날 배치표가 두 개가 된다');
}

console.log('\n[이번에 안 읽은 부는 재기만 하는가]');
{
  ok(/observeOnly: true/.test(OBS), '관측 함수는 관측 전용으로 부른다');
  ok(!/vp\.|rawVerdict|setBoardPart|processForMember/.test(OBS), '관측은 아무것도 바꾸지 않는다');
  ok(/d\._targetISO \|\| store\.targetISO/.test(OBS),
    '날짜를 store가 실제로 쓰는 자리에서 읽는다', 'd.dateLabel은 언제나 빈 값이라 가드가 걸린 적이 없었다');
  ok(/if \(!dISO\) \{[\s\S]*?continue; \}/.test(OBS), '날짜를 모르면 재지 않는다');
  ok((srv.match(/await observeMinorKakao\(boardISO\);/g) || []).length === 1,
    '판독 경로가 다룬 부를 두 번 기록하지 않는다', '같은 부가 두 줄로 남으면 나중에 세는 숫자가 부풀어 오른다');
}

console.log('\n[어긋남은 여전히 사람에게 가는가]');
{
  ok(/kind: 'kakao_conflict'/.test(brg), '배치표와 카카오가 어긋나면 관리자에게 올린다');
  ok(/mode === 'conflict' \|\| a\.mode === 'refuse'/.test(APPLY), '어긋난 날은 손대지 않는다',
    '둘 중 하나가 틀렸는데 어느 쪽인지 기계는 모른다 — 모를 땐 사람이 본다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
