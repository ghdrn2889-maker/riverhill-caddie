// 인증 — 네이버 로그인(OAuth2) + 쿠키 세션 + '솔로 모드' 폴백.
//  ★솔로 모드: 지인이 아직 없을 때(또는 네이버 미설정)엔 로그인 없이 자동으로 1번 회원(김홍구)로 동작.
//   → 지금처럼 불편 없이 혼자 쓰다가, 회원제로 열 땐 SOLO_MODE=0 한 줄로 로그인 벽을 켠다.
import {
  getUserByNaver, createUser, touchLogin, seedPrimaryUser,
  createSession, userForSession, destroySession, newOAuthState, consumeOAuthState,
} from './users.mjs';

const COOKIE = 'rh_sess';

export function authConfigured() {
  return !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
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
  res.status(401).json({ error: '로그인이 필요합니다', loginUrl: '/api/auth/naver' });
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
    if (!code || !consumeOAuthState(state)) return res.status(400).send('로그인 요청이 유효하지 않습니다(state 불일치). 다시 시도해주세요.');

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
    res.redirect('/');
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

export function logout(req, res) {
  destroySession(req._sessionToken);
  clearSessionCookie(req, res);
  res.json({ ok: true });
}

