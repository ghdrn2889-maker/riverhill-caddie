// 바깥 회계 앱에 내주는 창구 — 본인의 정산 내역(수입·지출), 읽기 전용.
//
//  ★처음엔 { date, count, amount } 세 필드로 좁게 열었다. 2026-08-27, 회계 앱이 본인 개인용이라
//   '김홍구 정산 내역은 다 달라'는 결정이 나와 정산 탭이 들고 있는 것까지 넓혔다.
//   넓힌 건 '필드'지 '사람'이 아니다 — 열쇠는 여전히 회원 한 명에 묶이고, 남의 줄은 한 줄도 안 나간다.
//
//  ★숫자는 여기서 새로 세지 않는다. ledger.summary()가 정산 탭에 그리는 그 값을 그대로 쓴다.
//   따로 세면 두 화면이 갈라진다 — 이 저장소가 반복해서 겪은 사고다(일지 30일 · 정산 29일).
//
//  ★그래도 안 나가는 게 있다: 다른 회원의 것, 영수증 사진 파일, 열쇠 원문. 그리고 쓰기.
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
const won = (n) => Math.round(Number(n) || 0);

// 기간 자르개 — from·to 둘 다 선택, 양끝 포함.
const inRange = (date, from, to) => {
  if (!isDate(date)) return false;
  if (isDate(from) && date < from) return false;
  if (isDate(to) && date > to) return false;
  return true;
};

// ── 수입: 하루 한 줄 ────────────────────────────────────────────
//  date   : 'YYYY-MM-DD' 근무일
//  count  : 그날 뛴 라운드 수(1·2·3부 중 몇 부). 세 부 다 뛰면 3
//  amount : 그날 번 돈(원, 정수) = fee + tip
//  fee    : 캐디피만(홀정산 감액 반영)
//  tip    : 팁만
//  parts  : 어느 부를 뛰었나 — ['2','3'] 처럼
//  holed  : 그날 홀정산(감액)이 있었나
//
//  ★날짜별 합산이다 — 일지가 하루 한 줄이고 그 안에 부 조합이 들어 있다. 건별이 아니다.
//  ★캐디피도 팁도 없는 날(휴무·당번·벌당·미완료)은 애초에 rows에 없다. 0원 줄은 안 나간다.
//  ★date·count·amount는 자리를 지킨다 — 바깥 앱이 이미 그 셋으로 붙어 있다. 뒤는 덧붙인 것.
export function incomeRows(userId, { from = '', to = '', tip = true } = {}) {
  const rows = (ledger.summary({}, Number(userId)).rows || []);
  const out = [];
  for (const r of rows) {
    const date = String(r.date || '');
    if (!inRange(date, from, to)) continue;
    const fee = won(r.revenue);
    const tp = won(r.tip);
    const amount = fee + (tip ? tp : 0);
    if (!(amount > 0)) continue;
    const parts = (Array.isArray(r.parts) ? r.parts : []).map(String);
    out.push({ date, count: parts.length || 1, amount, fee, tip: tp, parts, holed: !!r.holed });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// ── 지출: 건별 ─────────────────────────────────────────────────
//  하루에 여러 건이 있을 수 있어 합치지 않는다(회계 앱이 영수증 단위로 다룬다).
//  ★영수증 사진은 안 내보낸다 — 파일이고, 계약에 없고, 회계 앱이 쓸 데도 없다.
export function expenseRows(userId, { from = '', to = '' } = {}) {
  const exps = (ledger.summary({}, Number(userId)).expenses || []);
  const out = [];
  for (const e of exps) {
    const date = String(e.date || '');
    if (!inRange(date, from, to)) continue;
    const amount = won(e.amount);
    if (!(amount > 0)) continue;
    out.push({
      date, amount,
      category: String(e.category || '기타'),
      method: String(e.method || ''),
      vendor: String(e.vendor || ''),
      memo: String(e.memo || ''),
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// 과거 데이터가 언제부터 있는가 — 바깥 앱이 첫 조회 범위를 정할 때 쓴다.
export function earliestDate(userId) {
  const rows = incomeRows(userId, {});
  const exps = expenseRows(userId, {});
  const first = [rows[0] && rows[0].date, exps[0] && exps[0].date].filter(Boolean).sort();
  return first[0] || '';
}
