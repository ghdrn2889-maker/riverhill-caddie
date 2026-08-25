// 티스캐너(골프존) 예약가능 조회 — 카카오골프와 '같은 사실'을 다른 경로로 구한다.
//
//  왜 두 번째 소스인가: 여집합 엔진의 급소는 '골프장이 그 칸을 아예 안 내놓는 경우'다. 안 뜨는 이유가
//   ①팀이 차서인지 ②안 팔아서인지를 소스 하나로는 영영 못 가른다. 그런데 티스캐너엔 뜨는데 카카오엔
//   안 뜨는 칸이 있으면, 그 칸은 찬 게 아니다 — 처음으로 '카카오가 틀렸다'를 사람 눈 없이 말할 수 있다.
//
//  ★카카오와 결정적으로 다른 점: 여긴 로그인이 필수다. 비회원 임시 토큰 같은 건 없다(번들 확인).
//   모든 요청이 x-token을 요구하고, 그 토큰은 오직 login/authMemberLoginV2에서만 나온다.
//   그래서 이 파일은 남의 계정이 아니라 '우리 계정'으로 우리 골프장 한 곳만 본다.
//
//  robots.txt: `User-agent: * / Disallow:` (2026-08-25 확인) — 전 경로 허용.
import { loadJSON, saveJSON } from './store.mjs';

const API = 'https://foapi.teescanner.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const AUTH_FILE = 'teescanner-auth.json';     // { token, refreshToken, at, userSeq }
const HEALTH_FILE = 'teescanner-health.json';
const SEQ_FILE = 'teescanner-club.json';      // { golfclub_seq, name, at } — 한 번 찾으면 굳힌다

export class TeeShapeError extends Error {}
export class TeeAuthError extends Error {}

export const teescannerOn = () => ['1', 'true', 'yes'].includes(String(process.env.TEESCANNER || '').toLowerCase());

const toMin = (hhmm) => {
  const m = String(hhmm || '').match(/(\d{1,2})\s*:?\s*(\d{2})/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) : null;
};
export const toHM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

function health(patch) {
  const cur = loadJSON(HEALTH_FILE, {}) || {};
  const next = { ...cur, ...patch, at: Date.now() };
  saveJSON(HEALTH_FILE, next);
  return next;
}
export const teeHealth = () => loadJSON(HEALTH_FILE, null);

// ── 인증 ──────────────────────────────────────────────────────────────
//  ★토큰은 응답 '헤더'로 온다(x-token-yn: Y 일 때 x-token). 본문에는 없다.
//  ★비밀번호는 .env에만 두고 어디에도 찍지 않는다 — 로그에도, 오류 메시지에도.
let _mem = null;   // 프로세스 안 캐시(파일 왕복을 줄인다)

function loadAuth() {
  if (_mem && _mem.token) return _mem;
  const a = loadJSON(AUTH_FILE, null);
  if (a && a.token) _mem = a;
  return _mem;
}

function saveAuth(a) { _mem = a; saveJSON(AUTH_FILE, a); }

export function forgetAuth() { _mem = null; saveJSON(AUTH_FILE, null); }

export async function login() {
  const id = String(process.env.TEESCANNER_ID || '').trim();
  const pw = String(process.env.TEESCANNER_PW || '');
  if (!id || !pw) throw new TeeAuthError('TEESCANNER_ID·TEESCANNER_PW가 .env에 없습니다');
  const form = new FormData();
  form.append('id', id);
  form.append('pw', pw);
  form.append('service_code', 'TEESCANNER');
  form.append('platform', String(process.env.TEESCANNER_PLATFORM || 'WEB'));
  let res;
  try {
    res = await fetch(`${API}/login/authMemberLoginV2`, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://www.teescanner.com', Referer: 'https://www.teescanner.com/' },
      body: form,
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    health({ authFail: (loadJSON(HEALTH_FILE, {})?.authFail || 0) + 1, lastErr: `로그인 연결 실패: ${e.message}` });
    throw new TeeAuthError(`티스캐너 로그인 연결 실패(${e.message})`);
  }
  const token = res.headers.get('x-token') || '';
  const refreshToken = res.headers.get('x-refresh-token') || '';
  let body = null;
  try { body = await res.json(); } catch { /* 본문이 JSON이 아닐 수도 있다 — 토큰만 있으면 된다 */ }
  if (!token) {
    // ★여기서 아이디·비번을 되풀이하지 않는다. 서버가 준 말만 옮긴다.
    const said = (body && body.message) ? String(body.message).slice(0, 80) : `HTTP ${res.status}`;
    health({ authFail: (loadJSON(HEALTH_FILE, {})?.authFail || 0) + 1, lastErr: `토큰 없음: ${said}` });
    throw new TeeAuthError(`티스캐너 로그인 실패 — ${said}`);
  }
  const userSeq = body?.data?.user_seq ?? null;
  saveAuth({ token, refreshToken, at: Date.now(), userSeq });
  health({ authOk: (loadJSON(HEALTH_FILE, {})?.authOk || 0) + 1, lastAuth: Date.now(), lastErr: '' });
  console.log('[티스캐너] 로그인 성공 — 토큰 확보');
  return _mem;
}

// 로그인한 채로 한 번 부른다. 토큰이 죽었으면(result -100) 한 번만 다시 로그인하고 재시도.
//  ★재시도는 한 번뿐이다. 비밀번호가 틀렸는데 무한히 다시 시도하면 계정이 잠긴다.
async function call(path, params = {}, { retried = false } = {}) {
  let auth = loadAuth();
  if (!auth || !auth.token) auth = await login();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    qs.append(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const url = `${API}/${path}${qs.toString() ? `?${qs}` : ''}`;
  let res, j;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA, Accept: 'application/json',
        Origin: 'https://www.teescanner.com', Referer: 'https://www.teescanner.com/',
        'x-token': auth.token,
        ...(auth.refreshToken ? { 'x-refresh-token': auth.refreshToken } : {}),
      },
      signal: AbortSignal.timeout(25000),
    });
    j = await res.json();
  } catch (e) {
    const h = health({ fail: (loadJSON(HEALTH_FILE, {})?.fail || 0) + 1, streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: e.message });
    throw new Error(`티스캐너 조회 실패(${e.message}, 연속 ${h.streak}회)`);
  }
  // ★토큰이 갱신돼 오면 받아 둔다 — 안 받으면 다음 호출이 또 만료 토큰을 들고 간다.
  const nt = res.headers.get('x-token');
  if (res.headers.get('x-token-yn') === 'Y' && nt) saveAuth({ ...auth, token: nt, at: Date.now() });
  if (j && j.result === -100) {
    if (retried) throw new TeeAuthError('티스캐너 인증이 계속 거절됩니다 — 아이디·비밀번호를 확인해주세요');
    console.warn('[티스캐너] 토큰 만료 — 다시 로그인합니다');
    forgetAuth();
    await login();
    return call(path, params, { retried: true });
  }
  return j;
}

// ── 우리 골프장 찾기 ──────────────────────────────────────────────────
//  ★한 번 찾으면 data/에 굳힌다. 매번 검색하면 그만큼 남의 서버를 두드리는 것이고,
//   검색 결과 순서가 바뀌면 어느 날 조용히 다른 골프장을 보게 된다.
export async function findClub(keyword = process.env.TEESCANNER_CLUB || '리버힐') {
  const fixed = Number(process.env.TEESCANNER_CLUB_SEQ || 0);
  if (fixed > 0) return { golfclub_seq: fixed, name: `(고정값 ${fixed})`, at: Date.now() };
  const cached = loadJSON(SEQ_FILE, null);
  if (cached && cached.golfclub_seq) return cached;
  const j = await call('search/getSearchKeywordGolfClubAutoCompleteList', { keyword });
  const rows = pickRows(j);
  if (!rows.length) throw new TeeShapeError(`티스캐너에서 '${keyword}'를 못 찾았습니다`);
  const hit = rows.find((r) => String(r.golfclub_name || r.name || '').includes(keyword)) || rows[0];
  const seq = Number(hit.golfclub_seq || hit.seq || 0);
  if (!seq) throw new TeeShapeError('검색 결과에 golfclub_seq가 없습니다 — 응답 형식이 바뀌었을 수 있습니다');
  const rec = { golfclub_seq: seq, name: String(hit.golfclub_name || hit.name || keyword), at: Date.now() };
  saveJSON(SEQ_FILE, rec);
  console.log(`[티스캐너] 골프장 확정 — ${rec.name} (seq ${seq})`);
  return rec;
}

// 응답 안에서 '줄 목록'을 찾아낸다. 감싸는 이름은 엔드포인트마다 다르고 바뀌기도 한다.
function pickRows(j) {
  if (Array.isArray(j)) return j;
  const d = j && (j.data ?? j.result_data ?? j.list);
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k of ['list', 'teetime_list', 'teetimeList', 'items', 'rows', 'golfclub_list', 'result']) {
      if (Array.isArray(d[k])) return d[k];
    }
    // 이름을 모르면 '배열인 칸' 중 가장 긴 것을 쓴다 — 이름이 바뀌어도 살아남게.
    const arrays = Object.values(d).filter(Array.isArray);
    if (arrays.length) return arrays.sort((a, b) => b.length - a.length)[0];
  }
  return [];
}

// ── 예약 가능한 티오프 ────────────────────────────────────────────────
//  카카오골프 fetchOpen과 '같은 모양'으로 돌려준다: [{ mins, time, course, fee }]
//  ★모양이 다르면 숫자를 만들지 않는다 — 이 엔진은 없는 팀을 만들어내는 게 가장 나쁜 실패다.
export async function fetchOpen(dateYYYYMMDD) {
  const club = await findClub();
  const d = String(dateYYYYMMDD);
  const roundDay = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
  const j = await call('booking/getTeeTimeListbyGolfclub', { golfclub_seq: club.golfclub_seq, roundDay });
  const rows = pickRows(j);
  if (!Array.isArray(rows)) {
    health({ streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: '목록 배열 없음' });
    throw new TeeShapeError('티스캐너 응답에서 티오프 목록을 못 찾았습니다 — 형식이 바뀌었을 수 있습니다');
  }
  const out = rows.map((x) => {
    const t = x.teetime_time ?? x.teetime ?? x.tee_time ?? x.time ?? '';
    const mins = toMin(t);
    const course = String(x.course_name ?? x.teetime_zone ?? x.course ?? x.zone ?? '').toUpperCase().trim();
    return { mins, time: mins == null ? '' : toHM(mins), course, fee: Number(x.green_fee ?? x.greenFee ?? 0) || 0, raw: x };
  }).filter((x) => x.mins != null && x.course);
  if (rows.length && !out.length) {
    health({ streak: (loadJSON(HEALTH_FILE, {})?.streak || 0) + 1, lastErr: '시각·코스 해석 실패' });
    throw new TeeShapeError(`티스캐너 ${rows.length}건을 받았지만 시각·코스를 하나도 못 읽었습니다 — 값 형식이 바뀌었을 수 있습니다`);
  }
  health({ ok: (loadJSON(HEALTH_FILE, {})?.ok || 0) + 1, streak: 0, lastOk: Date.now(), lastCount: out.length });
  return out.map(({ raw, ...keep }) => keep);
}

// 진단용 — 응답 원문 그대로. 파서를 고칠 때 '무엇이 왔는지' 보려고 쓴다.
export async function raw(path, params = {}) { return call(path, params); }
