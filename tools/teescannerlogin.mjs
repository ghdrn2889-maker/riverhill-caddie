// 티스캐너 로그인 변형 시험 — 어떤 모양이 통하는지 하나씩 두드려 본다.
//  ★비밀번호는 인자로 받지 않는다(프로세스 목록에 남는다). .env에서만 읽고 어디에도 안 찍는다.
//  ★변형마다 한 번씩만 시도한다 — 되풀이하면 계정이 잠긴다.
import { loadEnv } from '../src/env.mjs';
loadEnv();

const API = 'https://foapi.teescanner.com/v1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = String(process.env.TEESCANNER_ID || '').trim();
const PW = String(process.env.TEESCANNER_PW || '');
if (!ID || !PW) { console.log('X  .env에 TEESCANNER_ID·TEESCANNER_PW가 없습니다'); process.exit(1); }

const H = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.teescanner.com',
  Referer: 'https://www.teescanner.com/',
};

// 로그인 폼이 보내는 것과 같은 순서로 담는다.
function form({ ip = '', platform = 'WEB', service = 'TEESCANNER', extra = {} } = {}) {
  const f = new FormData();
  if (ip) f.append('user_ip', ip);
  f.append('platform', platform);
  f.append('id', ID);
  f.append('pw', PW);
  f.append('service_code', service);
  for (const [k, v] of Object.entries(extra)) f.append(k, String(v));
  return f;
}

async function ip() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
    return (await r.json()).ip || '';
  } catch { return ''; }
}

// 본문에 비밀번호가 되비쳐 올 수 있으므로, 찍기 전에 반드시 가린다.
const mask = (s) => String(s).split(PW).join('***').split(ID).join('***');

async function attempt(name, path, body, extraHeaders = {}) {
  let res, text;
  try {
    res = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: { ...H, ...extraHeaders, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
      body,
      signal: AbortSignal.timeout(20000),
    });
    text = await res.text();
  } catch (e) {
    console.log(`  X  ${name}: 연결 실패 ${e.message}`);
    return false;
  }
  let seen = null;
  try { seen = JSON.parse(text); } catch { /* JSON이 아닐 수도 있다 */ }
  const hdrTok = res.headers.get('x-token') || '';
  const bodyTok = String(seen?.data?.token || '');
  const tok = hdrTok || bodyTok;
  console.log(`  ${tok ? 'ok ' : 'X  '} ${name}`);
  console.log(`       HTTP ${res.status} · Code=${seen?.data?.Code ?? '-'} · result=${seen?.result ?? '-'} · 토큰 ${tok ? `확보(${tok.length}자, ${hdrTok ? '헤더' : '본문'})` : '없음'}`);
  console.log(`       응답: ${mask(text).slice(0, 220)}`);
  return !!tok;
}

const myIp = await ip();
console.log(`\n아이디 ${ID.slice(0, 2)}*** · 서버 공인 IP ${myIp || '(못 구함)'}\n`);
console.log('── 로그인 변형 시험(각 1회) ──');

const tries = [
  ['F. V2 · funnels=0', 'login/authMemberLoginV2', () => form({ ip: myIp, extra: { funnels: 0 } })],
  ['G. V2 · funnels=1', 'login/authMemberLoginV2', () => form({ ip: myIp, extra: { funnels: 1 } })],
  ['H. V2 · funnels=0 · b2b_seq=0', 'login/authMemberLoginV2', () => form({ ip: myIp, extra: { funnels: 0, b2b_seq: 0 } })],
  ['I. V1 · user_platform 추가', 'login/authMemberLogin', () => form({ ip: myIp, extra: { user_platform: 'WEB' } })],
  ['J. V1 · JSON 본문', 'login/authMemberLogin', () => JSON.stringify({ user_ip: myIp, platform: 'WEB', id: ID, pw: PW, service_code: 'TEESCANNER' })],
];

for (const [name, path, mk] of tries) {
  if (await attempt(name, path, mk())) { console.log(`\n→ 통하는 모양: ${name}\n`); process.exit(0); }
}
console.log('\n→ 다섯 가지 모두 실패했습니다.\n');
