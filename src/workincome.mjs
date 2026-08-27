// 바깥 회계 앱에 내주는 창구 — { date, count, amount } 세 필드, 읽기 전용.
//
//  ★계약이 좁은 게 이 파일의 전부다. 이 세 필드만 지키면 캐디 앱 안쪽(일지 구조·정산 로직·
//   캐디피 단가)은 마음대로 바꿔도 회계 앱은 그대로 돈다. 반대로 여기서 팀·코스·손님·팁 내역을
//   흘리면, 바깥 앱이 그걸 쓰기 시작하는 순간 계약이 넓어지고 다시는 못 좁힌다.
//
//  ★숫자는 여기서 새로 세지 않는다. ledger.summary()가 정산 탭에 그리는 그 값을 그대로 쓴다.
//   따로 세면 두 화면이 갈라진다 — 이 저장소가 반복해서 겪은 사고다(일지 30일 · 정산 29일).
import crypto from 'node:crypto';
import { run, get, all } from './db.mjs';
import * as ledger from './ledger.mjs';

export const SCOPE = 'work-income';

// ★출처는 못박는다. 와일드카드(*)를 쓰면 아무 웹페이지나 이 창구를 부를 수 있다 —
//  열쇠가 있어야 답하긴 하지만, 열쇠가 새는 날 피해 범위가 인터넷 전체가 된다.
//  env로 덧붙일 수 있게는 두되(테스트·주소 변경), 기본은 이 하나뿐이다.
export function allowedOrigins() {
  const extra = String(process.env.WORK_INCOME_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return ['https://ghdrn2889-maker.github.io', ...extra];
}

const hash = (t) => crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex');

// 열쇠 발급 — 원문은 이 순간에만 존재한다. 저장은 해시만.
export function issueToken(userId, note = '') {
  const raw = 'wi_' + crypto.randomBytes(24).toString('base64url');
  run('INSERT INTO api_tokens (token_hash, user_id, scope, note, created_at) VALUES (?, ?, ?, ?, ?)',
    hash(raw), Number(userId), SCOPE, String(note || '').slice(0, 60), Date.now());
  return raw;
}

// 이 회원의 살아 있는 열쇠들 — 원문은 못 돌려준다(해시만 있으니까). 있다/없다와 언제 썼는지만.
export function listTokens(userId) {
  return all('SELECT note, created_at, last_used FROM api_tokens WHERE user_id = ? AND scope = ? AND revoked_at IS NULL ORDER BY created_at DESC',
    Number(userId), SCOPE);
}

// 이 회원의 열쇠를 전부 거둔다. 잃어버렸을 때 할 수 있는 일은 이것뿐이다(원문을 모르므로).
export function revokeAll(userId) {
  const r = run('UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND scope = ? AND revoked_at IS NULL',
    Date.now(), Number(userId), SCOPE);
  return Number(r.changes) || 0;
}

// 열쇠 → 회원. 없거나 거둬들였으면 null.
export function userForToken(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const row = get('SELECT user_id FROM api_tokens WHERE token_hash = ? AND scope = ? AND revoked_at IS NULL', hash(t), SCOPE);
  if (!row) return null;
  try { run('UPDATE api_tokens SET last_used = ? WHERE token_hash = ?', Date.now(), hash(t)); } catch { /* 기록 실패가 조회를 막지는 않는다 */ }
  return Number(row.user_id);
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// ── 창구 본체 ──────────────────────────────────────────────────
//  date  : 'YYYY-MM-DD' 근무일
//  count : 그날 라운드(부) 수 — 1·2·3부 중 몇 부를 뛰었나. 54(세 부)면 3.
//  amount: 그날 번 금액(원, 정수). 기본은 캐디피+팁. tip=false면 캐디피만.
//
//  ★날짜별 합산이다 — 일지가 하루 한 줄이고 그 안에 부 조합이 들어 있다. 건별이 아니다.
//  ★캐디피가 안 붙는 날(휴무·당번·벌당·미완료)은 애초에 rows에 없다. amount 0인 줄은 안 나간다.
export function incomeRows(userId, { from = '', to = '', tip = true } = {}) {
  const rows = (ledger.summary({}, Number(userId)).rows || []);
  const out = [];
  for (const r of rows) {
    const date = String(r.date || '');
    if (!isDate(date)) continue;
    if (isDate(from) && date < from) continue;
    if (isDate(to) && date > to) continue;
    const amount = Math.round(Number(r.revenue) || 0) + (tip ? Math.round(Number(r.tip) || 0) : 0);
    if (!(amount > 0)) continue;                       // 계약대로 '번 금액'만 — 0원 줄은 뜻이 없다
    out.push({ date, count: Array.isArray(r.parts) ? r.parts.length : 1, amount });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// 과거 데이터가 언제부터 있는가 — 바깥 앱이 첫 조회 범위를 정할 때 쓴다.
export function earliestDate(userId) {
  const rows = incomeRows(userId, {});
  return rows.length ? rows[0].date : '';
}
