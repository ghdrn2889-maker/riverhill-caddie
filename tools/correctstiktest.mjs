// 교정 소급 검사 — 관리자 교정이 '약한 재판독'에 지워지지 않는가.
//
//  ★2026-08-21 실사고: 14:31 검수에서 27번을 조하빈→김홍구로 대바 교정. 1분 뒤 글 #27496이
//   같은 사진을 다시 읽어 회원 카드를 옛 명단으로 되돌렸다. 검수·대조표는 김홍구, 앱만 조하빈이었다.
//   ★대바는 사진에 안 찍힌다 — 사진을 다시 읽으면 언제나 교정 전으로 돌아간다.
//   정본 가드(rememberBoard)는 lastboard만 지켰고 회원 카드는 안 지켰다.
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
const src = read('src/server.mjs');
const noC = src.replace(/^[ \t]*\/\/.*$/gm, '');

console.log('\n[교정 소급이 같은 글에만 갇혀 있지 않은가]');
{
  ok(/_sameArticle \|\| _weakerThanCorrected/.test(noC),
    '★같은 글이 아니어도 약한 판독이면 교정본을 쓴다',
    '옛 코드는 lastboard.id === full.id 일 때만 소급해, 다음 글 하나에 교정이 통째로 날아갔다');
  ok(/const _weakerThanCorrected = !isAuthoritativeBoard\(out\.rawVerdict\);/.test(noC),
    '판정은 정본 가드와 같은 함수를 쓴다',
    '같은 질문에 두 개의 답을 두면 언젠가 한쪽만 고친다');
  ok(!/_cv\._adminCorrected && String\(_lbCorr\.id\) === String\(full\.id\) &&/.test(noC),
    '옛 게이트가 남아 있지 않다');
}

console.log('\n[소급해도 지켜야 하는 것]');
{
  const i = noC.indexOf('_sameArticle || _weakerThanCorrected');
  ok(i > 0, '소급 게이트를 찾았다', '앵커를 못 찾으면 아래 검사는 전부 헛것을 본다');
  const blk = noC.slice(i, i + 3000);
  ok(/pd && nd && pd !== nd/.test(blk), '날짜가 다르면 소급하지 않는다 — 새 날 배치표는 그대로',
    '어제 교정이 오늘 명단을 덮으면 더 큰 사고다');
  ok(/part3Roster/.test(blk) && /teeGrid/.test(blk) && /crewDuty/.test(blk),
    '명단·티오프·근태를 함께 얹는다', '명단만 바꾸면 티오프가 옛 사람에게 붙는다');
  // ★2026-08-26 — 소급은 '덜 읽은 판독'을 구제하는 장치다. 더 많이 읽은 판독까지 덮으면 그건 되돌리기다.
  //  그날 어제 컷9 교정본이 오늘 컷14 판독을 덮어 10~14번이 빈칸이 됐고, 그 빈칸이 알림으로 나갔다.
  ok(/_corrTees\.length >= _newTees\.length/.test(blk),
    '★교정본이 새 판독보다 짧으면 티오프를 안 덮는다', '짧다는 건 그 교정이 옛 배치표의 것이라는 뜻이다');
  ok(/_corrRoster\.length >= _newRoster\.length/.test(blk),
    '명단도 같은 규칙', '길이가 같을 때는 그대로 덮는다 — 대바 보호는 살아 있어야 한다');
  ok(/teeGaps\(out\.rawVerdict\.teeGrid \|\| \[\], _cutNow\)/.test(blk),
    '덮은 뒤에 티오프 구멍을 다시 센다', '판독 직후 검산은 소급보다 앞에서 끝난다 — 소급 뒤엔 아무도 안 셌다');
}

console.log('\n[정본 판정 자체는 그대로인가]');
{
  ok(/function isAuthoritativeBoard\(v\) \{/.test(src), '정본 판정 함수가 있다');
  const f = src.slice(src.indexOf('function isAuthoritativeBoard'), src.indexOf('function isAuthoritativeBoard') + 420);
  ok(/rosterReliable !== true/.test(f) && /part3Roster\) && v\.part3Roster\.length >= 9/.test(f),
    '명단을 실제로 들고 온 판독만 정본이다',
    '텍스트 커트라인 글이 정본이 되면 이 가드가 통째로 무력해진다');
}

console.log('\n[★명단까지 바뀌는가 — 순번만 바뀌면 카드 안에서 말이 엇갈린다]');
{
  const td = read('src/today.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/_readAuth \|\| !!verdict\._adminCorrected/.test(td),
    '★관리자 교정본은 판독 신뢰도와 무관하게 정본이다',
    '교정 명단이 스테일 명단보다 짧다는 이유로 막히면 대바가 명단에 영원히 안 들어간다');
  ok(/_wouldShrink/.test(td), '프레임보호 자체는 살아 있다 — 약한 부분 크롭은 여전히 막는다');
  const bc = read('src/boardcorrect.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/mout\.rawVerdict\._adminCorrected = v\._adminCorrected/.test(bc),
    '교정 재계산이 교정본 표식을 다시 붙인다',
    'interpretForMember가 _adminCorrected·rosterReliable을 떨어뜨린다 — 실측으로 확인했다');
  ok(/mout\.rawVerdict\.rosterReliable = true/.test(bc), '판독 신뢰 표식도 같이 붙인다');
}

console.log('\n[★내 자리도 교정 명단에서 다시 뽑는가 — 1번 회원은 명단만 바꾸면 안 따라온다]');
{
  const i = noC.indexOf('_sameArticle || _weakerThanCorrected');
  ok(i > 0, '소급 게이트를 찾았다');
  const blk = noC.slice(i, i + 4000);
  ok(/relocateOnRoster\(out\.rawVerdict, primary, loadToday\(1\)\)/.test(blk),
    '★교정 명단을 얻은 뒤 본인 순번을 그 명단으로 재설정한다',
    '1번 회원은 out.rawVerdict가 곳 자기 판정 — 명단만 갈면 명단은 27번이 김홍구인데 myPosition은 옛 30으로 남는다');
  ok(/Object\.assign\(out, decide\(full, out\.rawVerdict, primary\)\)/.test(blk),
    '자리가 바뀌면 알림 문구도 다시 쓴다',
    '카드는 근무인데 푸시만 스페어면 같은 엇갈림이 알림으로 옮겨간다');
  ok(!/resolveCutoff\(out\.rawVerdict/.test(blk),
    '커트는 재계산하지 않는다 — 관리자가 손으로 정한 근무선을 명단 순서로 덮지 않는다');
  const jd = read('src/judge.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/export function relocateOnRoster\(v, member = memberFromEnv\(\), today = null\)/.test(jd),
    '재설정은 명단·순번 가드와 같은 함수를 쓴다(fixMemberPosByRoster)',
    '같은 질문에 두 개의 답을 두면 언젠가 한쪽만 고친다');
}

console.log('\n[교정은 lastboard에도 여전히 남는가]');
{
  ok(/_adminCorrected/.test(src), '교정 표식이 살아 있다');
  ok(/약한 변동 판독\(#\$\{full\.id\}\)이 정본 배치표/.test(src), 'lastboard 정본 가드는 그대로');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
