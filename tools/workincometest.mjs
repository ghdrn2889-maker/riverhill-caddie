// 바깥 회계 앱 창구 — 계약이 넓어지지 않는가.
//
//  ★이 검사의 요점은 '되는가'가 아니라 '더 나가지 않는가'다. 창구는 넓어지기만 하고 좁아지지 않는다 —
//   바깥 앱이 한 번 쓰기 시작한 필드는 다시 못 거둔다. 그래서 세 필드(date·count·amount)를 못박는다.
//
//  ★세션 쿠키를 안 쓰는 이유도 여기서 지킨다. 이 앱 쿠키는 SameSite=Lax라 다른 출처에서는 안 실린다.
//   실리게 하려면 SameSite=None으로 내려야 하는데 그건 앱 전체의 CSRF 방어를 낮추는 일이다.
//   창구 하나 열자고 문 전체를 헐 수 없다 — 그 판단이 코드에서 뒤집히면 이 검사가 잡는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wi from '../src/workincome.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const SV = read('src/server.mjs');
const AU = read('src/auth.mjs');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 계약: 세 필드 그 이상은 안 나간다 ──');
{
  const src = read('src/workincome.mjs');
  const i = src.indexOf('out.push({');
  ok(i > 0, '내보내는 자리가 한 곳이다');
  ok(/out\.push\(\{ date, count: Array\.isArray\(r\.parts\) \? r\.parts\.length : 1, amount \}\);/.test(src),
    '★date·count·amount 셋만 담는다',
    '팀·코스·손님·팁 내역이 한 번 새 나가면 바깥 앱이 그걸 쓰기 시작해 다시는 못 좁힌다');
  ok(!/parts:/.test(src.slice(i, i + 300)) && !/tip:/.test(src.slice(i, i + 300)),
    '부 조합·팁 내역은 안 담는다');
  ok(/res\.set\('Cache-Control', 'no-store'\)\.json\(rows\);/.test(SV),
    '배열 그대로 돌려준다(감싸지 않는다)', '바깥 앱 계약이 "객체의 배열"이다');
}

console.log('\n── 숫자는 새로 세지 않는다 ──');
{
  const src = read('src/workincome.mjs');
  ok(/ledger\.summary\(\{\}, Number\(userId\)\)\.rows/.test(src),
    '★정산 탭이 쓰는 그 값을 그대로 쓴다',
    '따로 세면 두 화면이 갈라진다 — 이 저장소가 반복해 겪은 사고다(일지 30일·정산 29일)');
  ok(/if \(!\(amount > 0\)\) continue;/.test(src), '0원 줄은 안 나간다', "계약이 '번 금액'이다");
  ok(/out\.sort\(/.test(src), '날짜 오름차순으로 준다');
}

console.log('\n── 열쇠: 회원 한 명 · 용도 하나 · 읽기만 ──');
{
  const src = read('src/workincome.mjs');
  ok(/export const SCOPE = 'work-income';/.test(src), '용도가 못박혀 있다');
  ok(/crypto\.createHash\('sha256'\)/.test(src) && /token_hash/.test(src),
    '★원문은 저장하지 않는다(해시만)',
    'DB가 새도 남의 앱 열쇠가 그대로 나가지 않아야 한다');
  ok(/AND scope = \?/.test(src) && /revoked_at IS NULL/.test(src),
    '용도가 맞고 회수 안 된 열쇠만 통과');
  ok(/WHERE user_id = \?/.test(src), '회원별로 묶인다');
  ok(!/service|admin|MONITOR_TOKEN|INGEST_TOKEN/.test(src),
    '★관리자·서비스 키와 아무 관계가 없다', '요청서의 첫 번째 제약이다');
  const db = read('src/db.mjs');
  ok(/CREATE TABLE IF NOT EXISTS api_tokens/.test(db), '표가 있다');
  ok(/ON DELETE CASCADE/.test(db.slice(db.indexOf('api_tokens'))), '회원이 지워지면 열쇠도 지워진다');
}

console.log('\n── 문: 조회만 열고 발급은 안 연다 ──');
{
  ok(/if \(p === '\/work-income'\) return next\(\);/.test(SV),
    "★정확히 그 한 경로만 연다(=== 비교)",
    "OPEN_API에 넣으면 startsWith 때문에 /work-income/token(열쇠 발급)까지 같이 열린다");
  ok(!/'\/work-income'\]/.test(SV) && !/, '\/work-income'/.test(SV.slice(SV.indexOf('const OPEN_API'), SV.indexOf('const OPEN_API') + 200)),
    'OPEN_API 목록에는 없다');
  ok(/if \(!uid\) return res\.status\(401\)\.json\(\{ error: '열쇠가 필요합니다' \}\);/.test(SV),
    '열쇠가 없으면 아무것도 안 준다');
  ok(!/error: '열쇠가 (틀렸|없)/.test(SV.replace("error: '열쇠가 필요합니다'", '')),
    '왜 막혔는지는 안 알려준다', '틀림/없음을 구분해 주면 그게 곧 대조 도구가 된다');
}

console.log('\n── CORS: 이 경로에만, 그 출처에만 ──');
{
  ok(/const _wiCors = \(req, res\) => \{/.test(SV), '창구 전용 함수로 둔다');
  ok(/if \(!workincome\.allowedOrigins\(\)\.includes\(origin\)\) return false;/.test(SV),
    '★목록에 없는 출처에는 헤더를 안 붙인다');
  ok(!/Access-Control-Allow-Origin', '\*'/.test(SV), "와일드카드(*)를 쓰지 않는다",
    '열쇠가 새는 날 피해 범위가 인터넷 전체가 된다');
  ok(!/Access-Control-Allow-Credentials/.test(SV),
    '★자격증명(쿠키)은 허용하지 않는다', '쿠키가 안 실리면 CSRF도 성립하지 않는다');
  ok(/res\.set\('Vary', 'Origin'\)/.test(SV), 'Vary: Origin을 붙인다', '캐시가 한 출처 응답을 딴 출처에 주면 안 된다');
  ok(wi.allowedOrigins().includes('https://ghdrn2889-maker.github.io'), '회계 앱 출처가 들어 있다');
  ok(wi.allowedOrigins().length >= 1 && !wi.allowedOrigins().includes('*'), '기본은 그 하나뿐이다');
  ok(/app\.options\('\/api\/work-income'/.test(SV), '사전 요청(OPTIONS)에 답한다',
    'Authorization 헤더를 쓰면 브라우저가 먼저 물어본다');
}

console.log('\n── 앱 전체의 쿠키 방어는 그대로 ──');
{
  ok(/'SameSite=Lax'/.test(AU) && !/SameSite=None/.test(AU),
    '★세션 쿠키는 여전히 SameSite=Lax다',
    '창구 하나 열자고 앱 전체의 CSRF 방어를 낮추지 않았다 — 이게 뒤집히면 여기서 잡는다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
