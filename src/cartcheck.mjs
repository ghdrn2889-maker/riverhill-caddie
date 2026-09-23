// 카트 점검 — 근무일마다 '카트 정리 증거 + 습관'을 남긴다.
//  카트가 매일 바뀌고 고객이 소지품을 두고 가는 환경에서,
//   ① 시작 기준사진(받았을 때 이미 있던 것) ② 종료 체크리스트+빈카트 사진(내가 비웠다는 증거)
//   ③ 발견물 신고(애매하면 즉시 경기과로 책임 이관) 를 하루 단위로 기록.
//  세무 사진과 동일한 파일 저장 패턴(data/photos)을 재사용한다.
import fs from 'node:fs';
import path from 'node:path';
import { loadUserJSON, saveUserJSON, userPhotoDir } from './store.mjs';
import { getDay as journalDay } from './journal.mjs';

// 그날이 당번·벌당이었나 — 일지가 날짜별로 갖고 있다(duty.json은 '오늘' 한 건만 보관).
//  당번인 날은 라운드에 카트를 안 끌고 나가므로 카트·클럽 사진 점검을 면제한다.
function isDutyDay(dateISO, userId) {
  try { const d = journalDay(dateISO, userId); return !!(d && d.duty && d.duty.kind); }
  catch { return false; }
}

const FILE = 'cartcheck.json'; // ★userId 미지정이면 1번 회원. 사진은 data/users/{id}/photos.

// 종료 점검 기본(예시) 체크리스트 — 편집 전까지의 '씨앗'.
//  김홍구님이 항목을 추가/삭제/이름변경하면 개인 목록으로 대체된다.
//  key = 저장 식별자(체크 상태가 여기에 묶임 — 이름 바꿔도 key 유지 → 기존 체크 보존).
export const DEFAULT_ITEMS = [
  { key: 'front_basket', label: '앞 수납바구니(볼·티·장갑)' },
  { key: 'cupholder', label: '컵홀더 좌·우(음료·소지품)' },
  { key: 'storage', label: '보관대·서랍(지갑·폰·귀중품)' },
  { key: 'extra_storage', label: '이 카트만의 추가 보관대' },
  { key: 'under_seat', label: '좌석 밑·뒤' },
  { key: 'umbrella', label: '우산꽂이·파라솔' },
  { key: 'scorecard', label: '스코어카드 홀더' },
  { key: 'cooler', label: '쿨러·아이스박스' },
  { key: 'golfbag', label: '골프백 주머니(고객 확인 요청)' },
];
export const PHOTO_LEGS = ['intake', 'exit', 'club_pre', 'club_post']; // 카트 라운드전/후 · 클럽 라운드전/후
const SETTINGS_KEY = '__settings'; // 날짜 키와 안 겹치는 예약 키

// ══ 하루에 카트를 여러 대 타는 날 ═══════════════════════════════
//  중복 근무자는 한 라운드를 돌고 배터리가 모자라 카트를 바꿔 탄다. 그래서 '오늘 카트'는
//  하나가 아니라 목록이다. 클럽도 팀마다 따로 받으므로 칸이 늘 수 있다.
//  ★사진 칸 이름(leg)은 첫 칸이 옛 이름 그대로다 — intake·exit·club_pre·club_post.
//   두 번째 칸부터만 '#2'가 붙는다. 그래야 여태 쌓인 기록·바깥 화면이 안 깨진다.
const MAX_SLOT = 6;
const legOf = (base, slot) => (slot > 0 ? `${base}#${slot + 1}` : base);
const LEG_RE = /^(intake|exit|club_pre|club_post)(?:#([2-6]))?$/;
function legArr(rec, leg) {
  const c = rec && rec.photos && rec.photos[leg];
  return Array.isArray(c) ? c : (c ? [c] : []);   // 과거 단일 문자열도 배열로 흡수(하위호환)
}
const usedLegs = (rec) => Object.keys((rec && rec.photos) || {}).filter((k) => LEG_RE.test(k));
const countShots = (rec) => usedLegs(rec).reduce((s, l) => s + legArr(rec, l).length, 0);

let cartSeq = 0;
const newCartId = () => 'c' + Date.now().toString(36) + (cartSeq++).toString(36);
const blankCart = () => ({ id: newCartId(), no: '', chg: false, chgAt: null, bad: false, note: '', outAt: null });
// 저장본을 늘 같은 모양으로 펴 준다 — 옛 기록(cartNo 한 칸)도 여기서 목록으로 흡수한다.
function normCarts(rec) {
  const raw = Array.isArray(rec && rec.carts) && rec.carts.length ? rec.carts : null;
  if (!raw) return [{ ...blankCart(), no: String((rec && rec.cartNo) || '').slice(0, 4) }];
  return raw.slice(0, MAX_SLOT).map((c) => ({
    id: String((c && c.id) || newCartId()), no: String((c && c.no) || '').slice(0, 4),
    chg: !!(c && c.chg), chgAt: (c && c.chgAt) || null, bad: !!(c && c.bad),
    note: String((c && c.note) || '').slice(0, 60), outAt: (c && c.outAt) || null,
  }));
}
const normClubN = (rec) => Math.max(1, Math.min(MAX_SLOT, Number(rec && rec.clubN) || 1));

// 경기팀 반납 확인(고정 4종) — 사진 없이 탭 체크. 카트 청소·상태는 카트 사진(intake/exit)이 증거.
//  key = 저장 식별자(체크 시각이 여기 묶임). 편집 불가(경기팀 필수 항목).
export const OPS_RETURN_ITEMS = [
  // ★카트 배터리는 이제 카트 칸에서 '충전 중'으로 적는다(카트마다 따로다).
  //  여기 남는 건 캐디가 몸에 지니고 다니는 보조배터리다.
  { key: 'battery',  label: '보조배터리 충전' },
  { key: 'tablet',   label: '태블릿 충전' },
  { key: 'radio',    label: '무전기 충전' },
  { key: 'guidekey', label: '유도키 전용칸 반납' },
];
const OPS_KEYS = new Set(OPS_RETURN_ITEMS.map((i) => i.key));

// 반납 완료 판정 — ★무엇이 도장을 막는가가 여기서 정해진다.
//  막는 것 : ① 카트 칸마다 번호   ② 장비 반납 4종
//  안 막는 것: 사진. 카트를 바꿔 탈 때마다 찍으라고 하면 압박이 된다. 남기고 싶은 사람만 남긴다.
//  ★번호는 왜 막나 — 경기과가 이 카트를 다음 캐디에게 줄 수 있는지 그 번호로 본다.
//   한 사람이 안 적으면 다른 캐디가 빈 카트를 못 받는다. 그래서 여기만 죈다.
//  ★당번·벌당인 날(dutyDay)은 라운드에 카트를 끌고 나가지 않는다 → 번호도 안 묻고 4종만 본다.
export function computeReturn(rec, dutyDay = false) {
  const carts = normCarts(rec), clubN = normClubN(rec);
  const shots = (base, i) => { const a = legArr(rec, legOf(base, i)); return a.length; };
  const cartShots = carts.map((c, i) => ({ before: shots('intake', i), after: shots('exit', i) }));
  const clubShots = Array.from({ length: clubN }, (unused, i) => ({ before: shots('club_pre', i), after: shots('club_post', i) }));
  // 첫 칸 요약 — 여태 이 두 값을 읽어 온 자리(모니터·응원·옛 화면)가 그대로 돌게 남긴다.
  const cart = { ...cartShots[0], done: cartShots[0].before > 0 && cartShots[0].after > 0 };
  const club = { ...clubShots[0], done: clubShots[0].before > 0 && clubShots[0].after > 0 };
  const or = (rec && rec.opsReturn) || {};
  const checks = OPS_RETURN_ITEMS.map((i) => ({ key: i.key, label: i.label, done: !!or[i.key], at: or[i.key] || null }));
  const checkDone = checks.filter((c) => c.done).length;
  const needNo = dutyDay ? [] : carts.map((c, i) => (c.no ? -1 : i)).filter((i) => i >= 0);
  const numsDone = needNo.length === 0;
  const doneCount = (dutyDay ? 0 : (numsDone ? 1 : 0)) + checkDone;
  const total = (dutyDay ? 0 : 1) + OPS_RETURN_ITEMS.length;     // 5칸(당번인 날은 4칸)
  return { cart, club, cartShots, clubShots, carts, clubN, checks,
    nums: { need: needNo, done: numsDone },
    nPhoto: countShots(rec),
    doneCount, total, allDone: doneCount === total, dutyDay };
}

function loadAll(userId = 1) { return loadUserJSON(userId, FILE, {}); }
function saveAll(userId, d) { saveUserJSON(userId, FILE, d); }
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// 현재 체크리스트 항목(편집됐으면 개인목록, 아니면 기본 예시).
export function getItems(userId = 1) {
  const s = loadAll(userId)[SETTINGS_KEY];
  if (s && s.customized && Array.isArray(s.items)) return s.items;
  return DEFAULT_ITEMS.slice();
}
function itemKeySet(userId = 1) { return new Set(getItems(userId).map((i) => i.key)); }
function saveItems(items, userId = 1) {
  const d = loadAll(userId);
  d[SETTINGS_KEY] = { ...(d[SETTINGS_KEY] || {}), items, customized: true };
  saveAll(userId, d);
  return getItems(userId);
}
let addSeq = 0;
export function addItem(label, userId = 1) {
  const l = String(label || '').trim().slice(0, 40);
  if (!l) return getItems(userId);
  const items = getItems(userId);
  const key = `u${Date.now().toString(36)}${addSeq++}`;
  return saveItems([...items, { key, label: l }], userId);
}
export function renameItem(key, label, userId = 1) {
  const l = String(label || '').trim().slice(0, 40);
  if (!l) return getItems(userId);
  return saveItems(getItems(userId).map((i) => (i.key === key ? { ...i, label: l } : i)), userId);
}
export function removeItem(key, userId = 1) {
  return saveItems(getItems(userId).filter((i) => i.key !== key), userId);
}
export function reorderItems(keys, userId = 1) {
  const map = new Map(getItems(userId).map((i) => [i.key, i]));
  const items = (keys || []).map((k) => map.get(k)).filter(Boolean);
  return items.length ? saveItems(items, userId) : getItems(userId);
}
export function resetItems(userId = 1) {
  const d = loadAll(userId);
  d[SETTINGS_KEY] = { customized: false, items: DEFAULT_ITEMS.slice() };
  saveAll(userId, d);
  return getItems(userId);
}
// 추천 항목 받기: 기본(추천) 항목 중 아직 없는 것만 목록에 더한다(기존 항목·이름 유지, 비파괴).
export function recommendItems(userId = 1) {
  const cur = getItems(userId);
  const have = new Set(cur.map((i) => i.key));
  const add = DEFAULT_ITEMS.filter((i) => !have.has(i.key));
  return add.length ? saveItems([...cur, ...add], userId) : cur;
}

function blank(dateISO) {
  return { date: dateISO, cartNo: '', carts: [blankCart()], clubN: 1,
    photos: {}, checklist: {}, checklistDoneAt: null,
    opsReturn: {}, returnDoneAt: null, stampedAt: null, remindedAt: null, updatedAt: null, lostItems: [] };
}

// 하루 기록 조회(없으면 빈 구조). 체크리스트 진행률 + 반납 완료 판정(6칸)도 같이 계산.
export function getDay(dateISO, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  const items = getItems(userId);
  const checked = items.filter((i) => (rec.checklist || {})[i.key]).length;
  const carts = normCarts(rec);
  return { ...rec, opsReturn: rec.opsReturn || {}, lostItems: Array.isArray(rec.lostItems) ? rec.lostItems : [],
    carts, clubN: normClubN(rec), cartNo: rec.cartNo || carts[0].no || '',
    progress: { checked, total: items.length, done: items.length > 0 && checked === items.length },
    returnStatus: computeReturn(rec, isDutyDay(dateISO, userId)) };
}

function mutate(dateISO, fn, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  fn(rec);
  rec.carts = normCarts(rec);
  rec.clubN = normClubN(rec);
  rec.cartNo = rec.carts[0].no || '';     // ★첫 칸 번호를 거울로 남긴다 — 홈 위젯·지난 기록이 이걸 읽는다
  rec.updatedAt = Date.now();
  const st = computeReturn(rec, isDutyDay(dateISO, userId));      // 반납 완료 시각(경기팀 '반납 완료' 표시)
  rec.returnDoneAt = st.allDone ? (rec.returnDoneAt || Date.now()) : null;
  if (!st.allDone) rec.stampedAt = null;                          // 완료 미달로 떨어지면 '완료 도장' 자동 해제
  d[dateISO] = rec;
  saveAll(userId, d);
  return getDay(dateISO, userId);
}

export function setCartNo(dateISO, cartNo, userId = 1) {   // 옛 길 — 첫 칸을 고친다
  return setCart(dateISO, 0, { no: cartNo }, userId);
}

// ── 오늘 탄 카트 칸 ─────────────────────────────────────────────
//  한 칸씩 고친다. 번호·충전·문제는 각각 따로 눌리므로 통째로 덮지 않는다.
export function setCart(dateISO, i, patch, userId = 1) {
  return mutate(dateISO, (r) => {
    const cs = normCarts(r);
    const c = cs[i]; if (!c) return;
    if (patch.no !== undefined) c.no = String(patch.no || '').replace(/[^0-9]/g, '').slice(0, 4);
    if (patch.bad !== undefined) { c.bad = !!patch.bad; if (!c.bad) c.note = ''; }
    if (patch.note !== undefined) c.note = String(patch.note || '').slice(0, 60);
    // ★충전은 퍼센트를 못 본다. 꽂았다는 사실과 '꽂은 시각'만 남긴다 —
    //  얼마나 됐는지는 보는 쪽(경기과)이 시계로 셈한다.
    if (patch.chg !== undefined) { c.chg = !!patch.chg; c.chgAt = c.chg ? (c.chgAt || Date.now()) : null; }
    r.carts = cs;
  }, userId);
}
// 칸 늘리기 — 바꿔 탄 것이므로 앞 카트는 그 시각에 '내놓음'이 된다.
export function addCart(dateISO, userId = 1) {
  return mutate(dateISO, (r) => {
    const cs = normCarts(r);
    if (cs.length >= MAX_SLOT) return;
    const last = cs[cs.length - 1];
    if (last && !last.outAt) last.outAt = Date.now();
    r.carts = [...cs, blankCart()];
  }, userId);
}
// 칸 지우기 — 그 칸에 남긴 사진도 같이 지우고, 뒤 칸 사진을 한 자리씩 당긴다.
//  (사진 칸 이름이 자리 번호를 쓰므로, 안 당기면 남의 칸 사진으로 보인다)
export function removeCart(dateISO, i, userId = 1) {
  return mutate(dateISO, (r) => {
    const cs = normCarts(r);
    if (cs.length <= 1 || i < 0 || i >= cs.length) return;
    shiftLegs(r, ['intake', 'exit'], i, cs.length, userId);
    cs.splice(i, 1);
    r.carts = cs;
  }, userId);
}
export function addClub(dateISO, userId = 1) {
  return mutate(dateISO, (r) => { r.clubN = Math.min(MAX_SLOT, normClubN(r) + 1); }, userId);
}
export function removeClub(dateISO, i, userId = 1) {
  return mutate(dateISO, (r) => {
    const n = normClubN(r);
    if (n <= 1 || i < 0 || i >= n) return;
    shiftLegs(r, ['club_pre', 'club_post'], i, n, userId);
    r.clubN = n - 1;
  }, userId);
}
// i번 칸의 사진을 지우고 i+1..n-1 칸을 한 자리씩 당긴다.
function shiftLegs(r, bases, i, n, userId) {
  r.photos = { ...(r.photos || {}) };
  for (const b of bases) {
    for (const f of legArr(r, legOf(b, i))) dropFile(f, userId);
    for (let k = i; k < n - 1; k++) r.photos[legOf(b, k)] = legArr(r, legOf(b, k + 1));
    delete r.photos[legOf(b, n - 1)];
  }
}
function dropFile(fname, userId) {
  try { if (fname && /^[\w.-]+\.(jpg|png)$/.test(fname)) fs.unlinkSync(path.join(userPhotoDir(userId), fname)); }
  catch { /* 이미 없음 */ }
}

// 체크리스트 항목 토글. 전부 체크되면 완료시각 기록(=증거 타임스탬프).
export function toggleCheck(dateISO, key, done, userId = 1) {
  const items = getItems(userId);
  if (!itemKeySet(userId).has(key)) return getDay(dateISO, userId);
  return mutate(dateISO, (r) => {
    r.checklist = { ...r.checklist };
    if (done) r.checklist[key] = true; else delete r.checklist[key];
    const allDone = items.length > 0 && items.every((i) => r.checklist[i.key]);
    r.checklistDoneAt = allDone ? (r.checklistDoneAt || Date.now()) : null;
  }, userId);
}

// 경기팀 반납 4종 토글(배터리·태블릿·무전기·유도키). done이면 완료시각 기록(=증거 타임스탬프).
export function toggleReturn(dateISO, key, done, userId = 1) {
  if (!OPS_KEYS.has(key)) return getDay(dateISO, userId);
  return mutate(dateISO, (r) => {
    r.opsReturn = { ...(r.opsReturn || {}) };
    if (done) r.opsReturn[key] = r.opsReturn[key] || Date.now(); else delete r.opsReturn[key];
  }, userId);
}

// '완료 도장' 찍기/해제 — 6칸 완료(allDone)일 때만 도장이 찍힌다. 미완료면 stampError로 되돌려준다(프런트가 미완료 안내).
//  수정하기(stamped=false)는 언제든 도장 해제(다시 편집 가능). getDay가 stampedAt를 그대로 내려준다.
export function setStamp(dateISO, stamped, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  if (stamped) {
    if (!computeReturn(rec, isDutyDay(dateISO, userId)).allDone) return { ...getDay(dateISO, userId), stampError: 'incomplete' };
    rec.stampedAt = rec.stampedAt || Date.now();
  } else {
    rec.stampedAt = null;
  }
  rec.updatedAt = Date.now();
  d[dateISO] = rec;
  saveAll(userId, d);
  return getDay(dateISO, userId);
}

let photoSeq = 0;
// intake(카트 전)·exit(카트 후)·club_pre(클럽 전)·club_post(클럽 후) 모두 여러 장 누적(배열).
export function savePhoto(dateISO, leg, dataUrl, userId = 1) {
  if (!isISO(dateISO) || !LEG_RE.test(leg)) return null;   // intake / exit#3 ... 칸 번호까지 검사한다
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  const dir = userPhotoDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  // ★파일 이름에 '#'을 넣지 않는다 — 사진을 내주는 문과 지우는 손이
  //  이름을 [\w.-]로만 받아서, '#'가 끼면 안 보이고 안 지워진다(실측).
  const tag = leg.replace('#', '-');
  const fname = `cart_${dateISO}_${tag}_${Date.now()}_${photoSeq++}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
  return mutate(dateISO, (r) => {
    r.photos = { ...r.photos, [leg]: [...legArr(r, leg), fname] };
  }, userId);
}

// 사진 삭제 — 두 구간 모두 배열에서 해당 파일만 제거. 파일도 지운다.
export function removePhoto(dateISO, leg, fname, userId = 1) {
  return mutate(dateISO, (r) => {
    if (!r.photos || !LEG_RE.test(leg)) return;
    r.photos = { ...r.photos, [leg]: legArr(r, leg).filter((f) => f !== fname) };
    dropFile(fname, userId);
  }, userId);
}

// 고객 분실물 로그 — 물건 이름(제목) + 선택 사진 1장(없으면 이름만). 완료 6칸과 독립.
let lostSeq = 0;
export function addLostItem(dateISO, name, dataUrl, userId = 1) {
  const nm = String(name || '').trim().slice(0, 60);
  if (!isISO(dateISO) || !nm) return getDay(dateISO, userId);
  let fname = null;
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) {
    const ext = m[1] === 'image/png' ? 'png' : 'jpg';
    const dir = userPhotoDir(userId);
    fs.mkdirSync(dir, { recursive: true });
    fname = `lost_${dateISO}_${Date.now()}_${photoSeq++}.${ext}`;
    fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
  }
  const id = `l${Date.now().toString(36)}${lostSeq++}`;
  return mutate(dateISO, (r) => {
    const arr = Array.isArray(r.lostItems) ? r.lostItems : [];
    r.lostItems = [...arr, { id, name: nm, photo: fname, at: Date.now() }];
  }, userId);
}
// 경기과에 갔는가 — 한 건마다 자국을 남긴다.
//  ★못 갔으면 못 갔다고 적는다. 캐디 화면이 '갔다'고 거짓말하면
//   손님이 찾을 때 경기과에는 없고 캐디만 억울해진다.
export function markLostSent(dateISO, id, ok, userId = 1) {
  return mutate(dateISO, (r) => {
    const arr = Array.isArray(r.lostItems) ? r.lostItems : [];
    r.lostItems = arr.map((x) => (x.id === id ? { ...x, sentAt: ok ? Date.now() : null, sendFail: !ok } : x));
  }, userId);
}
export function removeLostItem(dateISO, id, userId = 1) {
  return mutate(dateISO, (r) => {
    const arr = Array.isArray(r.lostItems) ? r.lostItems : [];
    const it = arr.find((x) => x.id === id);
    if (it && it.photo) { try { if (/^[\w.-]+\.(jpg|png)$/.test(it.photo)) fs.unlinkSync(path.join(userPhotoDir(userId), it.photo)); } catch { /* 이미 없음 */ } }
    r.lostItems = arr.filter((x) => x.id !== id);
  }, userId);
}

// 유예기간 내(sinceISO 이상) 기록 있는 날 요약 — 상단 날짜바용.
export function recordsSince(userId = 1, sinceISO) {
  const d = loadAll(userId);
  const items = getItems(userId);
  return Object.keys(d).filter((k) => isISO(k) && (!sinceISO || k >= sinceISO)).sort().map((date) => {
    const rec = d[date] || {};
    const nPhoto = countShots(rec);
    const checked = items.filter((i) => rec.checklist && rec.checklist[i.key]).length;
    return { date, cartNo: rec.cartNo || '', nPhoto, checked, total: items.length,
      done: items.length > 0 && checked === items.length };
  });
}

// 최근 기록 요약(지난 카트 점검 열람용). 기록이 있는 날 + 오늘을 최신순으로.
export function recentDays(userId = 1, n = 14, todayISO = null) {
  const d = loadAll(userId);
  const items = getItems(userId);
  const dates = new Set(Object.keys(d).filter(isISO));
  if (todayISO && isISO(todayISO)) dates.add(todayISO);
  return [...dates].sort().reverse().slice(0, n).map((date) => {
    const rec = d[date] || {};
    const nPhoto = countShots(rec);
    const checked = items.filter((i) => rec.checklist && rec.checklist[i.key]).length;
    return { date, cartNo: rec.cartNo || '', nPhoto, checked, total: items.length,
      done: items.length > 0 && checked === items.length };
  });
}

// 지난 반납 기록 '검색/찾기'용 — 유예기간 내 '실제 기록이 있는 날'만 최신순으로. 6칸 완료여부·도장·카트#·사진수 포함.
//  분쟁 등으로 특정 날짜를 빠르게 찾을 때 리스트로 보여주고 날짜 검색으로 좁힌다.
export function returnRecords(userId = 1, sinceISO) {
  const d = loadAll(userId);
  return Object.keys(d).filter((k) => isISO(k) && (!sinceISO || k >= sinceISO)).sort().reverse().map((date) => {
    const rec = d[date] || {};
    const nPhoto = countShots(rec);
    const st = computeReturn(rec, isDutyDay(date, userId));
    return { date, cartNo: rec.cartNo || '', nPhoto, allDone: st.allDone, doneCount: st.doneCount, total: st.total, stamped: !!rec.stampedAt };
  }).filter((r) => r.nPhoto > 0 || r.cartNo || r.doneCount > 0);   // 빈 날 제외(실제 기록만)
}

// 블랙박스식 롤링 삭제: cutoffISO보다 오래된 날(카트·클럽 점검)의 사진 파일 + 기록을 통째로 삭제.
//  ★근무기록(worklog·세무 증빙)과는 별개 파일이라 영향 없음. 체크리스트 항목 설정(__settings)은 보존.
export function pruneOld(userId, cutoffISO) {
  if (!isISO(cutoffISO)) return { days: 0, files: 0 };
  const d = loadAll(userId);
  let days = 0, files = 0;
  for (const key of Object.keys(d)) {
    if (!isISO(key) || key >= cutoffISO) continue;   // 예약키(__settings)·유예기간 내 날짜는 보존
    const rec = d[key] || {};
    for (const leg of usedLegs(rec)) {            // ★늘어난 칸(intake#2 …)까지 빠짐없이 걷는다
      for (const f of legArr(rec, leg)) { dropFile(f, userId); files++; }
    }
    const lost = Array.isArray(d[key] && d[key].lostItems) ? d[key].lostItems : [];  // 분실물 사진도 롤링 삭제
    for (const it of lost) {
      try { if (it && it.photo && /^[\w.-]+\.(jpg|png)$/.test(it.photo)) { fs.unlinkSync(path.join(userPhotoDir(userId), it.photo)); files++; } } catch { /* 이미 없음 */ }
    }
    delete d[key];
    days++;
  }
  if (days) saveAll(userId, d);
  return { days, files };
}

export function photoPath(fname, userId = 1) { return path.join(userPhotoDir(userId), fname); }
export function markReminded(dateISO, userId = 1) { return mutate(dateISO, (r) => { r.remindedAt = Date.now(); }, userId); }

// 리마인더 판단용: 해당 근무일에 종료 점검이 아직 미완인가?
export function needsExitCheck(dateISO, userId = 1) {
  const rec = getDay(dateISO, userId);
  if (!rec) return false;
  return !rec.progress.done; // 체크리스트 전부 완료 전이면 상기 대상
}
