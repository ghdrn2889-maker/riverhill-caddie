// 인증 — 네이버 로그인(OAuth2) + 쿠키 세션 + '솔로 모드' 폴백.
//  ★솔로 모드: 지인이 아직 없을 때(또는 네이버 미설정)엔 로그인 없이 자동으로 1번 회원(김홍구)로 동작.
//   → 지금처럼 불편 없이 혼자 쓰다가, 회원제로 열 땐 SOLO_MODE=0 한 줄로 로그인 벽을 켠다.
import {
  getUserByNaver, getUserByGoogle, createUser, touchLogin, seedPrimaryUser,
  createSession, userForSession, destroySession, newOAuthState, consumeOAuthState,
  newLoginHandoff, completeLoginHandoff, pollLoginHandoff, redeemLoginHandoff,
} from './users.mjs';

const COOKIE = 'rh_sess';

export function naverConfigured() {
  return !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}
// 로그인 수단이 하나라도(네이버 또는 구글) 설정돼 있으면 회원제 가능.
export function authConfigured() {
  return naverConfigured() || googleConfigured();
}
// 네이버 미설정이면 무조건 솔로. 설정돼 있어도 SOLO_MODE=0 으로 바꾸기 전엔 솔로 유지(의도적 전환).
export function soloMode() {
  if (!authConfigured()) return true;
  return process.env.SOLO_MODE !== '0';
}

// ── 쿠키 헬퍼(외부 의존성 없이) ──
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}
function setSessionCookie(req, res, token) {
  const bits = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Number(process.env.SESSION_DAYS ?? 90) * 86400}`];
  if (isHttps(req)) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}
function clearSessionCookie(req, res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps(req)) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

// ── 미들웨어: req.user 를 채운다 ──
//  1) 유효한 세션 쿠키 → 그 회원 (항상 우선)
//  2) 없으면 솔로 모드 → 1번 회원(김홍구) 자동
//  3) 그 외 → null(비로그인)
export function attachUser(req, res, next) {
  try {
    const token = parseCookies(req)[COOKIE];
    let user = token ? userForSession(token) : null;
    if (!user && soloMode()) user = seedPrimaryUser();
    req.user = user || null;
    req._sessionToken = token || null;
  } catch (e) {
    console.error('attachUser 오류:', e.message);
    req.user = null;
  }
  next();
}

// 로그인 필수 라우트 보호. 솔로 모드에선 항상 통과(1번 회원).
export function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: '로그인이 필요합니다', loginUrl: '/api/auth/google' });
}

// 관리자 전용 라우트 보호(테스트 알림 등 운영 기능) — 일반 회원은 403.
export function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: '관리자 전용 기능입니다' });
}

// ── 네이버 OAuth ──
function callbackURL(req) {
  if (process.env.NAVER_CALLBACK) return process.env.NAVER_CALLBACK;
  const proto = isHttps(req) ? 'https' : 'http';
  return `${proto}://${req.headers.host}/api/auth/naver/callback`;
}

export function beginNaverLogin(req, res) {
  if (!authConfigured()) return res.status(503).json({ error: '네이버 로그인이 아직 설정되지 않았습니다(.env)' });
  const state = newOAuthState();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.NAVER_CLIENT_ID,
    redirect_uri: callbackURL(req),
    state,
  });
  // ?switch=1 → 재인증 강제(auth_type=reprompt). 네이버가 이미 로그인돼 있어도 계정 선택/재로그인 화면을
  //  다시 띄워, 김홍구님이 '부계정'으로 갈아탈 수 있게 한다(다른 계정으로 로그인).
  if (req.query.switch) params.set('auth_type', 'reprompt');
  res.redirect(`https://nid.naver.com/oauth2.0/authorize?${params}`);
}

export async function naverCallback(req, res) {
  try {
    if (!authConfigured()) return res.status(503).send('네이버 로그인 미설정');
    const { code, state } = req.query;
    if (!code || !consumeOAuthState(state).ok) return res.status(400).send('로그인 요청이 유효하지 않습니다(state 불일치). 다시 시도해주세요.');

    // 1) 코드 → 액세스 토큰
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.NAVER_CLIENT_ID,
      client_secret: process.env.NAVER_CLIENT_SECRET,
      code, state,
    });
    const tokRes = await fetch(`https://nid.naver.com/oauth2.0/token?${tokenParams}`);
    const tok = await tokRes.json();
    if (!tok.access_token) return res.status(502).send('네이버 토큰 발급 실패');

    // 2) 토큰 → 프로필(고유 id)
    const meRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    const naverId = me?.response?.id;
    if (!naverId) return res.status(502).send('네이버 프로필 조회 실패');

    // 3) 회원 찾기/생성 + 세션
    let user = getUserByNaver(naverId);
    if (!user) {
      // 첫 로그인이 김홍구님(1번 회원)이면 그 계정에 네이버 id 연결, 아니면 새 회원.
      user = linkOrCreate(naverId);
    }
    touchLogin(user.id);
    const sessTok = createSession(user.id, req.headers['user-agent'] || '');
    setSessionCookie(req, res, sessTok);

    // 온보딩 필요 여부: board_name(실명) 비어있으면 가입 완성 화면으로.
    //  ?new=1 = '방금 로그인함' 마커 — 미완료 가입자가 앱을 닫았다 다시 열면(마커 없음) 자동 로그아웃하기 위함.
    res.redirect('/?new=1');
  } catch (e) {
    console.error('naverCallback 오류:', e.message);
    res.status(500).send('로그인 처리 중 오류가 발생했습니다.');
  }
}

// 1번 회원(김홍구)이 아직 네이버 미연결이면 그 계정에 붙이고, 아니면 신규 생성.
import { getUser } from './users.mjs';
import { run } from './db.mjs';
function linkOrCreate(naverId) {
  const primary = getUser(1);
  if (primary && !primary.naver_id) {
    run('UPDATE users SET naver_id = ? WHERE id = 1', naverId);
    console.log(`🔗 1번 회원에 네이버 계정 연결됨`);
    return getUser(1);
  }
  return createUser({ naverId });
}

// ── 구글 OAuth ──
export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function googleCallbackURL(req) {
  if (process.env.GOOGLE_CALLBACK) return process.env.GOOGLE_CALLBACK;
  const proto = isHttps(req) ? 'https' : 'http';
  return `${proto}://${req.headers.host}/api/auth/google/callback`;
}

export function beginGoogleLogin(req, res) {
  if (!googleConfigured()) return res.status(503).json({ error: '구글 로그인이 아직 설정되지 않았습니다(.env)' });
  // ★설치형 PWA는 ?h=<nonce> 로 핸드오프를 건다 → state에 연결(콜백에서 이 nonce에 완료 기록).
  const state = newOAuthState(req.query.h ? String(req.query.h) : null);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleCallbackURL(req),
    scope: 'openid email profile',
    state,
    // ?switch=1 → 계정 선택 화면 강제(다른 구글 계정으로 로그인). 기본도 계정 선택을 띄워 실수 방지.
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export async function googleCallback(req, res) {
  try {
    if (!googleConfigured()) return res.status(503).send('구글 로그인 미설정');
    const { code, state } = req.query;
    const stx = consumeOAuthState(state);
    if (!code || !stx.ok) return res.status(400).send('로그인 요청이 유효하지 않습니다(state 불일치). 다시 시도해주세요.');

    // 1) 코드 → 액세스 토큰(폼 인코딩 POST)
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleCallbackURL(req),
      grant_type: 'authorization_code',
    });
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return res.status(502).send('구글 토큰 발급 실패');

    // 2) 토큰 → 프로필(고유 sub)
    const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    const googleId = me?.sub;
    if (!googleId) return res.status(502).send('구글 프로필 조회 실패');

    // 3) 회원 찾기/생성 + 세션.
    let user = getUserByGoogle(googleId);
    if (!user) user = linkOrCreateGoogle(googleId, me.email, me.email_verified);
    touchLogin(user.id);
    const sessTok = createSession(user.id, req.headers['user-agent'] || '');
    setSessionCookie(req, res, sessTok);
    // ★설치형 PWA 핸드오프: 이 로그인은 '브라우저'에서 일어났으므로 앱은 아직 세션이 없다.
    //  이 nonce에 완료를 기록해 두면, 대기 중인 앱이 폴링으로 감지→교환해 앱 컨텍스트에 세션을 심는다.
    if (stx.handoff) {
      completeLoginHandoff(stx.handoff, user.id);
      return res.send(handoffDonePage());
    }
    // ?new=1 = '방금 로그인함' 마커(미완료 가입자 재방문 시 자동 로그아웃 판별용).
    res.redirect('/?new=1');
  } catch (e) {
    console.error('googleCallback 오류:', e.message);
    res.status(500).send('로그인 처리 중 오류가 발생했습니다.');
  }
}

// 브라우저에서 OAuth를 마친 뒤 보여줄 안내 페이지(앱으로 돌아가라고). 앱은 폴링으로 자동 로그인된다.
function handoffDonePage() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 완료</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
gap:14px;padding:32px;background:linear-gradient(180deg,#fbe6cf,#a9c58f);font-family:'Malgun Gothic',system-ui,sans-serif;color:#26331f;text-align:center}
.ck{width:64px;height:64px;border-radius:50%;background:#2c3a24;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(50,50,20,.3)}
.ck svg{stroke:#f3efe0;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
h1{font-size:20px;margin:6px 0 0}p{font-size:14px;line-height:1.7;color:#4a5340;margin:0;max-width:320px}
b{color:#26331f}</style></head><body>
<div class="ck"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 13l4 4L19 7"/></svg></div>
<h1>로그인 완료</h1>
<p><b>리버힐 캐디 앱으로 돌아가세요.</b><br>앱이 자동으로 로그인됩니다. 이 창은 닫으셔도 됩니다.</p>
</body></html>`;
}

// ── 설치형 PWA 로그인 핸드오프 라우트(비로그인 통과) ──
export function startLoginHandoff(req, res) {
  if (!googleConfigured()) return res.status(503).json({ ok: false, error: '구글 로그인 미설정' });
  res.json({ ok: true, nonce: newLoginHandoff() });
}
export function pollLoginHandoffRoute(req, res) {
  res.json(pollLoginHandoff(req.query.h ? String(req.query.h) : ''));
}
export function exchangeLoginHandoff(req, res) {
  const nonce = (req.body && req.body.nonce) ? String(req.body.nonce) : '';
  const userId = redeemLoginHandoff(nonce);
  if (!userId) return res.status(400).json({ ok: false, error: '만료되었거나 유효하지 않은 로그인입니다.' });
  const tok = createSession(userId, req.headers['user-agent'] || '');
  setSessionCookie(req, res, tok);   // ★이 응답이 '앱' 컨텍스트에서 오므로 쿠키가 앱 저장소에 심긴다.
  res.json({ ok: true });
}

// 관리자 구글 이메일 화이트리스트(ADMIN_GOOGLE_EMAILS, 콤마구분). 소문자 정규화.
function adminGoogleEmails() {
  return String(process.env.ADMIN_GOOGLE_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// 1번 회원(김홍구)에 구글을 이어붙이는 규칙:
//  (a) 1번이 아직 구글 미연결 + 로그인 이메일이 관리자 화이트리스트에 있고 구글이 검증한 이메일(email_verified)
//      → 네이버가 이미 연결돼 있어도 같은 사람이므로 1번에 구글 연결(네이버 잠긴 동안 구글로 같은 계정 접속).
//  (b) 예전 폴백: 1번이 네이버·구글 어디에도 연결 안 됐을 때(솔로 초기) 첫 소셜을 1번에 연결.
//  그 외 → 정상적으로 새 회원 생성.
function linkOrCreateGoogle(googleId, email = '', emailVerified = false) {
  const primary = getUser(1);
  const em = String(email || '').trim().toLowerCase();
  const isAdmin = em && emailVerified && adminGoogleEmails().includes(em);
  if (primary && !primary.google_id && (isAdmin || (!primary.naver_id))) {
    run('UPDATE users SET google_id = ? WHERE id = 1', googleId);
    console.log(`🔗 1번 회원에 구글 계정 연결됨${isAdmin ? ' (관리자 이메일)' : ''}`);
    return getUser(1);
  }
  return createUser({ googleId });
}

export function logout(req, res) {
  destroySession(req._sessionToken);
  clearSessionCookie(req, res);
  res.json({ ok: true });
}

