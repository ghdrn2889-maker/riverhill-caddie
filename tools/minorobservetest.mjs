// 카카오와 사진의 역할 분담 검사 — 누가 베이스를 만들고, 누가 그 뒤를 맡는가.
//
//  ★관리자 확정(2026-08-23):
//    · 전체 본배치표 = 사진 판독. 순번·가용/비가용 인원이 거기에만 있다. 베이스는 사진이 만든다.
//    · 그 뒤 변동    = 카카오. 1·2부 수정배치표 자동 판독은 멈춰 있고(MINOR_PART_UPDATE=0),
//                     그 빈자리를 카카오가 대신한다.
//  ★3부는 맡기지 않는다. 일주일 계측에서 3부는 커트를 두 번 높게 불렀다(8/21 최재영 29번 ·
//   8/22 박준서 34번, 둘 다 실제로는 스페어) — 켰다면 근무가 아닌 사람에게 근무 알림이 나갔다.
//  ★1·2부에도 (1,3)·(2,3) 두 탕 회원이 있다(8/23 실측 6명). 맡긴다는 건 그 카드도 맡긴다는 뜻이다.
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
const bodyOf = (src, head) => {   // 함수 본문만 도려낸다 — 넉넉히 자르면 옆 함수가 섞인다
  const i = src.indexOf(head); if (i < 0) return '';
  const end = src.indexOf('\n}\n', i);
  return end < 0 ? src.slice(i) : src.slice(i, end + 2);
};
const UPD = bodyOf(srv, 'async function kakaoUpdatePart');
const APPLY = bodyOf(srv, 'async function kakaoForPart');

console.log('\n[★베이스는 사진이 만든다]');
{
  // 본배치표 판독 경로(부별 루프)에서 카카오를 얹으면 안 된다.
  const i = srv.indexOf('const vp = outP.rawVerdict || {};');
  const j = srv.indexOf('setBoardPart(full.id,', i);
  const seg = i > 0 && j > i ? srv.slice(i, j) : '';
  ok(!!seg, '본배치표 판독 경로를 찾았다');
  ok(!/kakaoForPart\(|kakaoUpdatePart\(/.test(seg),
    '★본배치표 판독에는 카카오를 얹지 않는다',
    '순번·가용/비가용 인원은 사진에만 있다 — 베이스가 흔들리면 그 위의 모든 것이 흔들린다');
}

console.log('\n[멈춰둔 1·2부 수정 판독을 카카오가 대신하는가]');
{
  const i = srv.indexOf('if (minorReadFrozen(p, worklog.labelToISO(');   // 1·2부 판독 경로의 그 자리
  const seg = srv.slice(i, i + 500);
  ok(/frozenLog\(p, full\.subject\);/.test(seg), '잠금은 그대로 — 사진 재판독은 여전히 안 한다');
  ok(/await kakaoUpdatePart\(p,/.test(seg),
    '★멈춘 자리에서 카카오가 갱신한다', '이게 대신한다는 말의 실제 내용이다');
  ok(!!UPD, '갱신 함수가 있다');
  ok(/loadBoardPartsStore\(\)/.test(UPD), '베이스는 저장소(사진 판독본)에서 가져온다',
    '카카오는 이름을 만들지 못한다 — 명단은 언제나 사진에서 온다');
  ok(/setBoardPart\(/.test(UPD) && /processForMemberPart\(/.test(UPD),
    '모니터와 회원 카드가 함께 간다', '한쪽만 바뀌면 같은 날 배치표가 두 개가 된다');
}

console.log('\n[갱신이 함부로 돌지 않는가]');
{
  ok(/if \(!assistOn\(p\)\) return false;/.test(UPD), '★맡기지 않은 부는 손대지 않는다(3부 포함)');
  ok(/if \(!roster\.length\) return false;/.test(UPD), '베이스가 없으면 아무것도 만들지 않는다');
  ok(/if \(!iso\) return false;/.test(UPD), '어느 날 베이스인지 모르면 손대지 않는다');
  ok(/if \(iso < todayISOKST\(\)\) return false;/.test(UPD), '지나간 날은 갱신하지 않는다');
  ok(/nowH >= Number\(w\.max\)/.test(UPD),
    '★오늘이라도 이미 끝난 부는 건드리지 않는다',
    '1부는 아침에 끝난다 — 오후 3시에 고쳐서 근무 배정 을 보내면 이미 끝난 라운드 이야기다');
  ok(/if \(after\.cut === before\.cut && after\.tees === before\.tees\) return false;/.test(UPD),
    '★바뀐 게 없으면 아무 일도 하지 않는다',
    '5분마다 도는 자리다 — 변화가 없는데 저장·알림이 돌면 그게 스팸이다');
  ok(/a\.mode !== 'augment'/.test(UPD), '어긋남(conflict)·거부(refuse)에는 갱신하지 않는다');
}

console.log('\n[예약이 차는 건 글과 무관하다]');
{
  ok(/async function kakaoUpdateMinorTick\(\)/.test(srv), '5분 틱에서도 갱신을 시도한다');
  ok(/\.then\(\(\) => kakaoUpdateMinorTick\(\)\)/.test(srv), '카카오 관측이 끝난 뒤에 갱신한다',
    '방금 본 예약으로 고쳐야 한 틱을 번다');
  const t = bodyOf(srv, 'async function kakaoUpdateMinorTick');
  ok(/for \(const p of \['1', '2'\]\)/.test(t), '1·2부만 돈다 — 3부는 이 틱에 없다');
}

console.log('\n[스위치는 부마다 따로인가]');
{
  ok(/export function assistOn\(part = ''\)/.test(brg), '부를 받아서 판단한다');
  ok(/use-kakao-assist-\$\{part\}/.test(brg), '부별 스위치 파일(use-kakao-assist-2)');
  ok(/\['1', 'true', 'yes', 'all'\]\.includes\(env\)/.test(brg), '옛 전역 스위치는 그대로 산다');
  ok(/applied: observeOnly \? false : assistOn\(part\)/.test(brg), '기록의 applied는 그 부 스위치를 따른다');
  ok(/vp\._kakaoAssist = \{/.test(APPLY), '카카오가 무엇을 바꿨는지 판정에 남긴다',
    '나중에 틀렸을 때 누구 탓인지 알 수 있어야 한다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
