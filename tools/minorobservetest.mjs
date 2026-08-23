// 카카오 보조 1·2부 관측(1단계) 검사 — 재기만 하는가, 정말로 아무것도 안 바꾸는가.
//
//  ★2026-08-23 결정: 일주일 계측에서 카카오의 '커트를 올려라' 22건이 전부 3부였다. 1·2부는 표본이 0건이다.
//   그래서 1·2부는 켜기 전에 먼저 잰다. 이 검사가 지키는 건 하나다 — 재는 동안에는 아무 일도 일어나지 않는다.
//  ★1·2부가 무주공산이라는 말은 사실이 아니다. 주 부는 전원 3부지만 (1,3)·(2,3) 두 탕을 뛰는 회원이
//   그 부 카드를 들고 있다(8/23 실측 6명 · 연승준 1부 06:37). 그래서 반영은 이 단계에 없어야 한다.
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
// 함수 본문만 정확히 도려낸다 — 넉넉히 자르면 옆 함수의 코드까지 검사에 섞인다.
const bodyOf = (src, head) => {
  const i = src.indexOf(head); if (i < 0) return '';
  const end = src.indexOf('\n}\n', i);
  return end < 0 ? src.slice(i) : src.slice(i, end + 2);
};
const OBS = bodyOf(srv, 'async function observeMinorKakao');
const brg = noC(read('src/kakaobridge.mjs'));

console.log('\n[1·2부를 재기는 하는가]');
{
  ok(/async function observeMinorKakao\(dateISO\)/.test(srv), '관측 함수가 있다');
  const fn = OBS;
  ok(/for \(const p of \['1', '2'\]\)/.test(fn), '1부와 2부를 돈다');
  ok(/loadBoardPartsStore\(\)/.test(fn), '그 부 배치표는 store에서 읽는다', '3부 판독 결과로 1·2부를 재면 안 된다');
  ok(/kakaoAssist\(\{/.test(fn) && /part: p/.test(fn), '카카오 보조를 그 부로 부른다');
  ok(/d\._targetISO \|\| store\.targetISO/.test(fn),
    '★날짜를 store가 실제로 쓰는 자리에서 읽는다(_targetISO·targetISO)',
    'd.dateLabel만 보면 언제나 빈 값이라 가드가 걸린 적이 없다 — 가드가 아니라 장식이 된다');
  ok(/if \(!dISO\) \{[\s\S]*?continue; \}/.test(fn), '★날짜를 모르면 재지 않는다',
    '재는 일에서 아마 오늘 것 은 재지 않는 것만 못하다');
  ok(/if \(dISO !== dateISO\) continue;/.test(fn), '다른 날 store는 재지 않는다');
  ok((srv.match(/await observeMinorKakao\(boardISO\);/g) || []).length === 2,
    '두 경로(발송 잠금·1·2부 판독) 모두에서 부른다', '한쪽만 붙이면 그 날의 표본이 통째로 빈다');
}

console.log('\n[★재는 동안 아무것도 바꾸지 않는가]');
{
  const fn = OBS;
  ok(/observeOnly: true/.test(fn), '★관측 전용으로 부른다');
  ok(!/rawVerdict/.test(fn), '판정(rawVerdict)에 손대지 않는다', '결과를 얹는 순간 이건 관측이 아니다');
  ok(!/setBoardPart|saveToday|processForMember|correctPart3/.test(fn),
    '★저장·회원 처리·교정을 부르지 않는다', '1·2부에도 두 탕 회원 6명의 카드가 걸려 있다');
  ok(!/notify|push|broadcast/i.test(fn), '알림을 보내지 않는다');
}

console.log('\n[켠 적 없는 부가 켠 것처럼 기록되지 않는가]');
{
  ok(/observeOnly = false \}\)/.test(brg), '보조가 관측 전용 표식을 받는다');
  ok(/applied: observeOnly \? false : assistOn\(\)/.test(brg),
    '★관측 호출은 전역 스위치와 무관하게 applied:false로 남는다',
    '나중에 3부용으로 스위치를 켜면 1·2부 기록까지 켠 것처럼 남아, 재려던 숫자가 거짓이 된다');
  ok(/observeOnly: !!observeOnly/.test(brg), '기록에 관측 전용이었음을 남긴다');
  ok(/appendJSONL\('kakao-assist\.jsonl', rec\)/.test(brg), '기록은 같은 장부에 쌓인다 — 3부와 나란히 비교하려면');
}

console.log('\n[어긋남은 여전히 사람에게 가는가]');
{
  ok(/kind: 'kakao_conflict'/.test(brg), '배치표와 카카오가 어긋나면 관리자에게 올린다',
    '관측이라고 조용하면 이 다리의 제일 큰 값어치가 사라진다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
