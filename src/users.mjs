// 회원·프로필·세션 로직. (판독/기능은 아직 1번 회원 기준으로 동작 — 이관은 단계적)
import crypto from 'node:crypto';
import { db, run, get, all } from './db.mjs';
import { loadJSON } from './store.mjs';

const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 90);

// ── 회원 ────────────────────────────────────────────────
export function getUser(id) { return get('SELECT * FROM users WHERE id = ?', id); }
export function getUserByNaver(naverId) { return get('SELECT * FROM users WHERE naver_id = ?', naverId); }

export function createUser({ naverId = null, role = 'member' } = {}) {
  const now = Date.now();
  const r = run('INSERT INTO users (naver_id, created_at, role) VALUES (?, ?, ?)', naverId, now, role);
  const id = Number(r.lastInsertRowid);
  run('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)', id, now);
  return getUser(id);
}

export function touchLogin(id) { run('UPDATE users SET last_login = ? WHERE id = ?', Date.now(), id); }

// ── 프로필 ──────────────────────────────────────────────
export function getProfile(userId) { return get('SELECT * FROM profiles WHERE user_id = ?', userId); }

const PROFILE_FIELDS = {
  board_name: (v) => String(v).slice(0, 40),
  part: (v) => (['1', '2', '3'].includes(String(v)) ? String(v) : '3'),
  home_km: (v) => Math.max(0, Number(v) || 0),
  commute_min: (v) => Math.min(300, Math.max(0, Math.round(Number(v) || 0))), // 출근 소요시간(분)
  car_no: (v) => String(v).slice(0, 20),
  workplace: (v) => String(v).slice(0, 40),
  km_per_l: (v) => Math.max(1, Number(v) || 12),
  station_id: (v) => String(v).slice(0, 30),
  fuel_enabled: (v) => (v ? 1 : 0),
};

export function setProfile(userId, patch = {}) {
  const sets = [], vals = [];
  for (const [k, clean] of Object.entries(PROFILE_FIELDS)) {
    if (patch[k] != null) { sets.push(`${k} = ?`); vals.push(clean(patch[k])); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); vals.push(Date.now());
    run(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`, ...vals, userId);
  }
  return getProfile(userId);
}

// ── 세션 ────────────────────────────────────────────────
export function createSession(userId, ua = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO sessions (token, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)',
    token, userId, now, now + SESSION_DAYS * 86400 * 1000, String(ua).slice(0, 200));
  return token;
}

export function userForSession(token) {
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token = ?', token);
  if (!s) return null;
  if (s.expires_at < Date.now()) { run('DELETE FROM sessions WHERE token = ?', token); return null; }
  const u = getUser(s.user_id);
  return u && u.status === 'active' ? u : null;
}

export function destroySession(token) { if (token) run('DELETE FROM sessions WHERE token = ?', token); }

// ── OAuth state(CSRF) ───────────────────────────────────
export function newOAuthState() {
  const state = crypto.randomBytes(16).toString('base64url');
  run('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)', state, Date.now());
  // 오래된 state 청소(10분)
  run('DELETE FROM oauth_states WHERE created_at < ?', Date.now() - 10 * 60 * 1000);
  return state;
}
export function consumeOAuthState(state) {
  if (!state) return false;
  const row = get('SELECT state FROM oauth_states WHERE state = ?', state);
  if (row) run('DELETE FROM oauth_states WHERE state = ?', state);
  return !!row;
}

// ── 1번 회원(김홍구) 시드 — .env + 기존 근무일지 설정에서 ──────
//  회원제 도입 전의 '나'를 그대로 1번 회원으로 만들어, 지금 쓰던 게 안 끊기게 한다.
//  이미 있으면 아무것도 안 함(멱등).
export function seedPrimaryUser() {
  const existing = getUser(1);
  if (existing) return existing;
  const u = createUser({ role: 'admin' }); // 첫 회원 = 관리자
  // .env 값으로 프로필 채우기
  const boardName = (process.env.MY_NAME || '').trim();
  const part = (process.env.MY_PART || '3').trim();
  const patch = { board_name: boardName, part };
  // 기존 worklog.json 설정이 있으면 거리·차량·연비 이관(있을 때만).
  try {
    const wl = getLegacyWorklogSettings();
    if (wl) {
      if (wl.homeGolfKmOneway != null) patch.home_km = wl.homeGolfKmOneway;
      if (wl.carNo) patch.car_no = wl.carNo;
      if (wl.workplace) patch.workplace = wl.workplace;
      if (wl.kmPerL != null) patch.km_per_l = wl.kmPerL;
      if (wl.fuelEnabled != null) patch.fuel_enabled = wl.fuelEnabled;
    }
  } catch { /* 기존 설정 없으면 기본값 */ }
  setProfile(u.id, patch);
  console.log(`👤 1번 회원 시드 완료: ${boardName || '(이름미설정)'} · ${part}부`);
  return u;
}

// 기존 JSON 근무일지 설정 읽기(이관 1회용).
function getLegacyWorklogSettings() {
  const d = loadJSON('worklog.json', null);
  return d && d.settings ? d.settings : null;
}

// board 판독 대상 회원들(실명 등록·활성). 크롤러가 board 1회 읽고 이들 각자에게 판단·발송.
export function activeMembers() {
  return all(`SELECT u.id, p.board_name, p.part, p.commute_min
              FROM users u JOIN profiles p ON p.user_id = u.id
              WHERE u.status = 'active' AND p.board_name != ''
              ORDER BY u.id`);
}

// (배치표 이름 + 부) 중복 방지: 다른 활성 회원이 이미 같은 이름·부를 쓰는지.
//  리버힐 한 부(部) 안엔 같은 이름이 없으므로 '이름+부'가 사실상 한 캐디의 고유 신원.
//  → 같은 캐디가 계정 2개로 알림 2번 받는 문제 차단. 본인 프로필 수정은 exceptUserId로 제외.
export function boardNameTaken(boardName, part, exceptUserId = 0) {
  const name = String(boardName || '').trim();
  if (!name) return false; // 빈 이름(가입 전)은 중복 대상 아님
  const row = get(`SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id
                   WHERE p.board_name = ? AND p.part = ? AND u.status = 'active' AND u.id != ?`,
    name, String(part || '3'), exceptUserId);
  return !!row;
}

export function ensureDb() { db(); } // 부팅 시 스키마 생성 트리거
