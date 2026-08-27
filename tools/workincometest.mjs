// 바깥 회계 앱 창구 — 넓힌 건 '필드'지 '사람'이 아니다.
//
//  ★처음엔 { date, count, amount } 세 필드로 좁게 열었다. 2026-08-27, 회계 앱이 본인 개인용이라
//   '내 정산 내역은 다 달라'는 결정이 나와 수입 7필드 + 지출까지 넓혔다.
//   그래서 이 검사의 기준도 바뀐다 — '필드가 몇 개냐'가 아니라 **경계가 그대로냐**다:
//     ① 열쇠는 여전히 회원 한 명에 묶인다(남의 줄은 한 줄도 안 나간다)
//     ② 여전히 읽기 전용이다
//     ③ 영수증 사진·열쇠 원문은 안 나간다
//     ④ 열쇠 발급 문은 여전히 로그인 뒤에 있다
//     ⑤ 앱 전체의 쿠키 방어(SameSite=Lax)는 그대로다
//   필드는 넓힐 수 있다. 이 다섯 개가 무너지면 그건 다른 사고다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wi from '../src/workincome.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const SV = read('src/server.mjs');
const AU = read('src/auth.mjs');
const WI = read('src/workincome.mjs');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 수입: 하루 한 줄, 정해진 필드 ──');
{
  const i = WI.indexOf('out.push({ date, count:');
  ok(i > 0, '내보내는 자리가 한 곳이다');
  ok(/out\.push\(\{ date, count: parts\.length \|\| 1, amount, fee, tip: tp, parts, holed: !!r\.holed \}\);/.test(WI),
    'date·count·amount·fee·tip·parts·holed',
    '앞의 셋은 자리를 지킨다 — 바깥 앱이 이미 그 셋으로 붙어 있다');
  ok(/const amount = fee \+ \(tip \? tp : 0\);/.test(WI), 'amount = 캐디피 + 팁(tip=0이면 캐디피만)');
  ok(/if \(!\(amount > 0\)\) continue;/.test(WI), '0원 줄은 안 나간다');
  ok(/out\.sort\(/.test(WI.slice(i)), '날짜 오름차순으로 준다');
}

console.log('\n── 지출: 건별, 사진은 빼고 ──');
{
  const i = WI.indexOf('export function expenseRows');
  ok(i > 0, '지출 창구가 있다');
  const body = WI.slice(i);
  ok(/date, amount,\n\s+category:/.test(body), 'date·amount·category·method·vendor·memo');
  ok(!/photo/.test(body.slice(0, body.indexOf('export function earliestDate'))),
    '★영수증 사진은 안 내보낸다', '파일이고, 계약에 없고, 회계 앱이 쓸 데도 없다');
  ok(/app\.get\('\/api\/work-income\/expenses'/.test(SV), '지출 경로가 열려 있다');
}

console.log('\n── 숫자는 새로 세지 않는다 ──');
{
  ok((WI.match(/ledger\.summary\(\{\}, Number\(userId\)\)/g) || []).length === 2,
    '★정산 탭이 쓰는 그 값을 그대로 쓴다(수입·지출 둘 다)',
    '따로 세면 두 화면이 갈라진다 — 이 저장소가 반복해 겪은 사고다(일지 30일·정산 29일)');
  ok(/res\.set\('Cache-Control', 'no-store'\)\.json\(rows\);/.test(SV),
    '배열 그대로 돌려준다(감싸지 않는다)', '바깥 앱 계약이 "객체의 배열"이다');
}

console.log('\n── 경계 ①②③: 회원 한 명 · 읽기만 · 원문 없음 ──');
{
  ok(/export const SCOPE = 'work-income';/.test(WI), '용도가 못박혀 있다');
  ok(/WHERE user_id = \?/.test(WI), '★회원별로 묶인다', '넓힌 건 필드지 사람이 아니다');
  ok(/incomeRows\(userId/.test(WI) && /expenseRows\(userId/.test(WI),
    '두 창구 다 userId를 받는다');
  ok(!/app\.(post|put|patch|delete)\('\/api\/work-income'/.test(SV)
    && !/app\.(post|put|patch|delete)\('\/api\/work-income\/expenses'/.test(SV),
    '★조회 창구에 쓰기 메서드가 없다');
  ok(/crypto\.createHash\('sha256'\)/.test(WI) && /token_hash/.test(WI),
    '★열쇠 원문은 저장하지 않는다(해시만)',
    'DB가 새도 남의 앱 열쇠가 그대로 나가지 않아야 한다');
  ok(/AND scope = \?/.test(WI) && /revoked_at IS NULL/.test(WI),
    '용도가 맞고 회수 안 된 열쇠만 통과');
  ok(!/service|admin|MONITOR_TOKEN|INGEST_TOKEN/.test(WI),
    '★관리자·서비스 키와 아무 관계가 없다');
  const db = read('src/db.mjs');
  ok(/CREATE TABLE IF NOT EXISTS api_tokens/.test(db), '표가 있다');
  ok(/ON DELETE CASCADE/.test(db.slice(db.indexOf('api_tokens'))), '회원이 지워지면 열쇠도 지워진다');
}

console.log('\n── 경계 ④: 조회만 열고 발급은 안 연다 ──');
{
  ok(/if \(p === '\/work-income' \|\| p === '\/work-income\/expenses'\) return next\(\);/.test(SV),
    "★정확히 그 두 경로만 연다(=== 비교)",
    "'/work-income/' 을 넣거나 OPEN_API에 올리면 startsWith 때문에 열쇠 발급까지 같이 열린다");
  ok(!/'\/work-income\/token'/.test(SV.slice(SV.indexOf('const OPEN_API'), SV.indexOf('app.use(\'/api\''))),
    '열쇠 발급 경로는 어디에도 안 열려 있다');
  const gi = SV.indexOf('const OPEN_API');
  ok(!/'\/work-income/.test(SV.slice(gi, gi + 200)), 'OPEN_API 목록에는 없다');
  ok((SV.match(/if \(!uid\) return res\.status\(401\)\.json\(\{ error: '열쇠가 필요합니다' \}\);/g) || []).length === 2,
    '두 창구 다 열쇠가 없으면 아무것도 안 준다');
  ok(!/error: '열쇠가 (틀렸|없)/.test(SV),
    '왜 막혔는지는 안 알려준다', '틀림/없음을 구분해 주면 그게 곧 대조 도구가 된다');
}

console.log('\n── CORS: 이 경로들에만, 그 출처에만 ──');
{
  ok(/const _wiCors = \(req, res\) => \{/.test(SV), '창구 전용 함수로 둔다');
  ok(/if \(!workincome\.allowedOrigins\(\)\.includes\(origin\)\) return false;/.test(SV),
    '★목록에 없는 출처에는 헤더를 안 붙인다');
  ok(!/Access-Control-Allow-Origin', '\*'/.test(SV), '와일드카드(*)를 쓰지 않는다',
    '열쇠가 새는 날 피해 범위가 인터넷 전체가 된다');
  ok(!/Access-Control-Allow-Credentials/.test(SV),
    '★자격증명(쿠키)은 허용하지 않는다', '쿠키가 안 실리면 CSRF도 성립하지 않는다');
  ok(/res\.set\('Vary', 'Origin'\)/.test(SV), 'Vary: Origin을 붙인다', '캐시가 한 출처 응답을 딴 출처에 주면 안 된다');
  ok(wi.allowedOrigins().includes('https://ghdrn2889-maker.github.io'), '회계 앱 출처가 들어 있다');
  ok(wi.allowedOrigins().length >= 1 && !wi.allowedOrigins().includes('*'), '기본은 그 하나뿐이다');
  ok((SV.match(/app\.options\('\/api\/work-income/g) || []).length === 2,
    '두 경로 다 사전 요청(OPTIONS)에 답한다',
    'Authorization 헤더를 쓰면 브라우저가 먼저 물어본다');
}

console.log('\n── 경계 ⑤: 앱 전체의 쿠키 방어는 그대로 ──');
{
  ok(/'SameSite=Lax'/.test(AU) && !/SameSite=None/.test(AU),
    '★세션 쿠키는 여전히 SameSite=Lax다',
    '창구 하나 열자고 앱 전체의 CSRF 방어를 낮추지 않았다 — 이게 뒤집히면 여기서 잡는다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
