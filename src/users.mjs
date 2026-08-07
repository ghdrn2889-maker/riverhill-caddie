// 회원·프로필·세션 로직. (판독/기능은 아직 1번 회원 기준으로 동작 — 이관은 단계적)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db, run, get, all } from './db.mjs';
import { loadJSON, userDataDir } from './store.mjs';

const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 90);

// ★테스트캐디 — '가입 성공 애니메이션'만 확인하는 테스트 전용 이름. 이 이름으로 가입하면
//  실제 가입·저장·로그 없이 애니메이션만 재생하고, 계정은 role='test'로 격리 + 늘 초기화(온보딩 반복).
export const TEST_CADDIE_NAME = process.env.TEST_CADDIE_NAME || '테스트캐디';
export function isTestCaddieName(name) { return String(name || '').trim() === TEST_CADDIE_NAME; }
// 테스트 계정 격리·초기화: role='test'로 표시(목록·활성회원·알림에서 제외) + 프로필 이름 비워 늘 온보딩 상태로 되돌림.
export function markTestAccount(id) {
  const uid = Number(id); if (!uid) return;
  run("UPDATE users SET role = 'test' WHERE id = ?", uid);
  run("UPDATE profiles SET board_name = '', updated_at = ? WHERE user_id = ?", Date.now(), uid);
}

// ── 회원 ────────────────────────────────────────────────
export function getUser(id) { return get('SELECT * FROM users WHERE id = ?', id); }
export function getUserByNaver(naverId) { return get('SELECT * FROM users WHERE naver_id = ?', naverId); }
export function getUserByGoogle(googleId) { return googleId ? get('SELECT * FROM users WHERE google_id = ?', googleId) : null; }

// ★신규 회원 기본 status='pending' — 관리자(김홍구) 승인 전엔 데이터·푸시 차단(외부인 배제).
//  시드/관리자만 status='active'로 생성.
export function createUser({ naverId = null, googleId = null, role = 'member', status = 'pending' } = {}) {
  const now = Date.now();
  const r = run('INSERT INTO users (naver_id, google_id, created_at, role, status) VALUES (?, ?, ?, ?, ?)', naverId, googleId, now, role, status);
  const id = Number(r.lastInsertRowid);
  run('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)', id, now);
  return getUser(id);
}

// 회원 상태 변경(관리자 승인/보류/차단). status ∈ 'active'|'pending'|'disabled'.
export function setUserStatus(id, status, reason = null) {
  if (!['active', 'pending', 'disabled'].includes(status)) return null;
  // 차단(disabled)일 때만 사유 저장(roster|other). 승인·대기로 바꾸면 사유 비움.
  const br = status === 'disabled' ? (['roster', 'other'].includes(reason) ? reason : 'other') : null;
  run('UPDATE users SET status = ?, block_reason = ? WHERE id = ?', status, br, id);
  return getUser(id);
}

export function touchLogin(id) { run('UPDATE users SET last_login = ? WHERE id = ?', Date.now(), id); }

// ★역할 토글 — 테스터 킷 지정/해제(운영 모니터 관리자 전용). member↔tester만 허용, admin 계정은 불변.
//  tester 계정은 activeMembers에서 제외돼 실제 캐디/알림에 안 섞이고, 앱에선 테스터 킷 기능만 켜진다.
export function setUserRole(id, role) {
  if (!['member', 'tester'].includes(role)) return null;
  const u = getUser(id);
  if (!u || u.role === 'admin') return null;   // 관리자 역할은 절대 변경 안 함
  run('UPDATE users SET role = ? WHERE id = ?', role, id);
  return getUser(id);
}

// ★회원 완전 삭제 — 계정·프로필·세션·푸시구독까지 DB에서 제거(관리자 제외).
//  (개인 데이터 폴더 data/users/<id> 는 호출측에서 별도 삭제.)
// 무인증 '테스터 체험' 계정 — 비공개 링크로 들어온 테스터가 OAuth 없이 앱을 둘러보는 데모 계정.
//  ★세션(브라우저)마다 새로 만든다 → 두 사람 이상이 동시에 써도 이름·정산·일지가 서로 안 겹친다(격리).
//  board_name은 비워둔다 → 진입 시 실제 가입과 동일한 온보딩(이름·소요시간 입력)을 거치게.
//  role='tester'라 activeMembers(실제 캐디/알림)에서 제외되고, 앱에선 테스터 킷 기능(회원 선택기 등)만 켜진다.
export function createTesterAccount() {
  return createUser({ role: 'tester', status: 'active' });
}

// 오래된 테스터 계정 청소 — last_login(없으면 created_at)이 maxAgeHours 지난 tester 계정 + 데이터 폴더 제거.
//  세션마다 계정이 생기므로 무한정 쌓이지 않게 진입 때마다 한 번 훑는다. 반환: 지운 id 수.
export function pruneStaleTesters(maxAgeHours = 48) {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  const rows = all("SELECT id, last_login, created_at FROM users WHERE role = 'tester'");
  let gone = 0;
  for (const r of rows) {
    const seen = r.last_login || r.created_at || 0;
    if (seen >= cutoff) continue;
    const d = deleteUser(r.id);
    if (d.ok) { try { fs.rmSync(userDataDir(r.id), { recursive: true, force: true }); } catch { /* 무해 */ } gone++; }
  }
  return gone;
}

export function deleteUser(id) {
  const uid = Number(id);
  if (!uid) return { ok: false, error: 'id 필요' };
  const u = getUser(uid);
  if (!u) return { ok: false, error: '회원을 찾을 수 없어요.' };
  if (u.role === 'admin') return { ok: false, error: '관리자 계정은 삭제할 수 없어요.' };
  const prof = get('SELECT board_name FROM profiles WHERE user_id = ?', uid) || {};
  const boardName = prof.board_name || '';
  run('DELETE FROM sessions WHERE user_id = ?', uid);
  run('DELETE FROM push_subscriptions WHERE user_id = ?', uid);
  run('DELETE FROM profiles WHERE user_id = ?', uid);
  run('DELETE FROM users WHERE id = ?', uid);
  return { ok: true, id: uid, boardName };
}

// ── 프로필 ──────────────────────────────────────────────
export function getProfile(userId) { return get('SELECT * FROM profiles WHERE user_id = ?', userId); }

const PROFILE_FIELDS = {
  board_name: (v) => String(v).slice(0, 40),
  part: (v) => (['1', '2', '3'].includes(String(v)) ? String(v) : '3'),
  caddie_type: (v) => (['house', 'part3'].includes(String(v)) ? String(v) : 'part3'), // 하우스(1·2부) / 3부 캐디

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
  // ★status 판단은 호출부(attachUser/게이트)에서 — pending 회원도 온보딩(이름 입력)은 해야 하므로 여기선 그대로 반환.
  return getUser(s.user_id) || null;
}

export function destroySession(token) { if (token) run('DELETE FROM sessions WHERE token = ?', token); }

// ── OAuth state(CSRF) ───────────────────────────────────
//  handoff: 설치형 PWA 로그인 시 이 state에 연결된 핸드오프 nonce(없으면 null=일반 브라우저 로그인).
export function newOAuthState(handoff = null) {
  const state = crypto.randomBytes(16).toString('base64url');
  run('INSERT INTO oauth_states (state, created_at, handoff) VALUES (?, ?, ?)', state, Date.now(), handoff || null);
  // 오래된 state 청소(10분)
  run('DELETE FROM oauth_states WHERE created_at < ?', Date.now() - 10 * 60 * 1000);
  return state;
}
// 반환: { ok, handoff } — ok=state 유효, handoff=연결된 PWA nonce(있으면).
export function consumeOAuthState(state) {
  if (!state) return { ok: false, handoff: null };
  const row = get('SELECT state, handoff FROM oauth_states WHERE state = ?', state);
  if (row) run('DELETE FROM oauth_states WHERE state = ?', state);
  return { ok: !!row, handoff: row ? (row.handoff || null) : null };
}

// ── 설치형 PWA 로그인 핸드오프 ───────────────────────────
//  앱이 nonce 발급 → 브라우저에서 OAuth 완료 → 콜백이 done 표시 → 앱이 폴링 후 nonce로 세션 교환.
export function newLoginHandoff() {
  const nonce = crypto.randomBytes(24).toString('base64url');
  run('INSERT INTO login_handoff (nonce, status, created_at) VALUES (?, ?, ?)', nonce, 'pending', Date.now());
  run('DELETE FROM login_handoff WHERE created_at < ?', Date.now() - 10 * 60 * 1000); // 단명 청소
  return nonce;
}
// 브라우저 콜백에서 로그인 완료를 이 nonce에 기록(pending → done + user_id).
export function completeLoginHandoff(nonce, userId) {
  if (!nonce) return false;
  const row = get('SELECT nonce, status FROM login_handoff WHERE nonce = ?', nonce);
  if (!row || row.status !== 'pending') return false;
  run('UPDATE login_handoff SET status = ?, user_id = ? WHERE nonce = ?', 'done', userId, nonce);
  return true;
}
// 앱 폴링: 상태 조회(민감정보 없음).
export function pollLoginHandoff(nonce) {
  const row = nonce ? get('SELECT status FROM login_handoff WHERE nonce = ?', nonce) : null;
  if (!row) return { status: 'expired' };
  return { status: row.status === 'done' ? 'done' : 'pending' };
}
// 앱 교환: done이면 user_id 반환 + 1회용으로 삭제(재사용 차단). 아니면 null.
export function redeemLoginHandoff(nonce) {
  if (!nonce) return null;
  const row = get('SELECT user_id, status FROM login_handoff WHERE nonce = ?', nonce);
  if (!row || row.status !== 'done' || !row.user_id) return null;
  run('DELETE FROM login_handoff WHERE nonce = ?', nonce);
  return row.user_id;
}

// ── 1번 회원(김홍구) 시드 — .env + 기존 근무일지 설정에서 ──────
//  회원제 도입 전의 '나'를 그대로 1번 회원으로 만들어, 지금 쓰던 게 안 끊기게 한다.
//  이미 있으면 아무것도 안 함(멱등).
export function seedPrimaryUser() {
  const existing = getUser(1);
  if (existing) return existing;
  const u = createUser({ role: 'admin', status: 'active' }); // 첫 회원 = 관리자(활성)
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
              WHERE u.status = 'active' AND p.board_name != '' AND u.role != 'test' AND u.role != 'tester'
              ORDER BY u.id`);
}

// 전체 회원 id — 라운드 점검 사진 자동정리 등 회원별 유지보수 작업에 사용.
export function allUserIds() {
  return all('SELECT id FROM users ORDER BY id').map((r) => r.id);
}

// 관리자(운영자) 계정 id 목록 — 네이버 쿠키 만료·테스트 등 '관리자 전용 알림' 수신 대상.
//  일반 회원(테스터 등)에게는 운영성 알림이 절대 가지 않도록 역할(role)로 구분한다.
export function adminUserIds() {
  return all(`SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id`).map((r) => r.id);
}

// (배치표 이름 + 부) 중복 방지: 다른 활성 회원이 이미 같은 이름·부를 쓰는지.
//  리버힐 한 부(部) 안엔 같은 이름이 없으므로 '이름+부'가 사실상 한 캐디의 고유 신원.
//  → 같은 캐디가 계정 2개로 알림 2번 받는 문제 차단. 본인 프로필 수정은 exceptUserId로 제외.
export function boardNameTaken(boardName, part, exceptUserId = 0) {
  const name = String(boardName || '').trim();
  if (!name) return false; // 빈 이름(가입 전)은 중복 대상 아님
  // ★이름 기준(부 무관) 유일 강제 — 같은 이름이 이미 가입돼 있으면 어느 부로 넣든 중복으로 본다.
  //  (배치표 판독은 이름으로 사람을 구분하므로, 같은 이름 두 계정은 부가 달라도 알림이 겹친다.)
  //  part 인자는 호환을 위해 유지하되 검사에는 쓰지 않음.
  const row = get(`SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id
                   WHERE p.board_name = ? AND u.status = 'active' AND u.id != ?`,
    name, exceptUserId);
  return !!row;
}

// ── 캐디 실명 대조(외부인 배제 보조) ────────────────────────
//  배치표에서 누적된 실제 캐디 명부(caddies.json 키)에 이 이름이 있는지. 승인 화면의 ✅/⚠️ 판단용.
//  괄호·공백 제거 후 비교(예 "표승완(54)"→"표승완"). 판단 보조일 뿐, 최종 승인은 관리자가 함.
function normName(s) { return String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim(); }
let _caddieCache = { at: 0, set: null };
export function caddieNameKnown(name) {
  const key = normName(name);
  if (!key) return false;
  const now = Date.now();
  if (!_caddieCache.set || now - _caddieCache.at > 60000) {
    const dict = loadJSON('caddies.json', {}) || {};
    _caddieCache = { at: now, set: new Set(Object.keys(dict).map(normName)) };
  }
  return _caddieCache.set.has(key);
}

// 관리자 회원관리 화면용 — 전체 회원 + 상태 + 명부 일치 여부.
export function listMembersForAdmin() {
  // ★테스트(test)·테스터 체험(tester) 계정은 관리자 회원/승인 목록에서 제외 — 실제 캐디 승인 흐름과 무관한 임시 데모 계정.
  const rows = all(`SELECT u.id, u.role, u.status, u.created_at, u.last_login, u.block_reason, p.board_name, p.part
                    FROM users u LEFT JOIN profiles p ON p.user_id = u.id
                    WHERE u.role != 'test' AND u.role != 'tester' ORDER BY u.status='pending' DESC, u.id`);
  return rows.map((r) => ({
    id: r.id, role: r.role, status: r.status, createdAt: r.created_at, lastLogin: r.last_login,
    boardName: r.board_name || '', part: r.part || '', nameKnown: caddieNameKnown(r.board_name),
    blockReason: r.block_reason || '',
  }));
}

export function ensureDb() { db(); } // 부팅 시 스키마 생성 트리거
