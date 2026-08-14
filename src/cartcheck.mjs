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

// 경기팀 반납 확인(고정 4종) — 사진 없이 탭 체크. 카트 청소·상태는 카트 사진(intake/exit)이 증거.
//  key = 저장 식별자(체크 시각이 여기 묶임). 편집 불가(경기팀 필수 항목).
export const OPS_RETURN_ITEMS = [
  { key: 'battery',  label: '카트 배터리 충전' },
  { key: 'tablet',   label: '태블릿 충전' },
  { key: 'radio',    label: '무전기 충전' },
  { key: 'guidekey', label: '유도키 전용칸 반납' },
];
const OPS_KEYS = new Set(OPS_RETURN_ITEMS.map((i) => i.key));

// 반납 완료 판정(경기팀 공유·캐디 대시보드 링 공용):
//  6칸 = 카트(전·후 사진 있음) + 클럽(전·후 사진 있음) + 반납체크 4종.
function legCount(photos, leg) { const c = photos && photos[leg]; return Array.isArray(c) ? c.length : (c ? 1 : 0); }
//  ★당번·벌당인 날(dutyDay)은 라운드에 카트를 끌고 나가지 않는다 → 카트·클럽 사진 자체가 없으므로
//   4칸(반납체크)만으로 완료 판정한다. 안 그러면 영원히 6칸을 못 채워 완료 도장을 못 찍는다.
export function computeReturn(rec, dutyDay = false) {
  const p = (rec && rec.photos) || {};
  const cart = { before: legCount(p, 'intake'), after: legCount(p, 'exit') };
  cart.done = cart.before > 0 && cart.after > 0;
  const club = { before: legCount(p, 'club_pre'), after: legCount(p, 'club_post') };
  club.done = club.before > 0 && club.after > 0;
  const or = (rec && rec.opsReturn) || {};
  const checks = OPS_RETURN_ITEMS.map((i) => ({ key: i.key, label: i.label, done: !!or[i.key], at: or[i.key] || null }));
  const checkDone = checks.filter((c) => c.done).length;
  const doneCount = dutyDay ? checkDone : ((cart.done ? 1 : 0) + (club.done ? 1 : 0) + checkDone);
  const total = dutyDay ? OPS_RETURN_ITEMS.length : (2 + OPS_RETURN_ITEMS.length); // 4 또는 6
  return { cart, club, checks, doneCount, total, allDone: doneCount === total, dutyDay };
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
  return { date: dateISO, cartNo: '', photos: {}, checklist: {}, checklistDoneAt: null,
    opsReturn: {}, returnDoneAt: null, stampedAt: null, remindedAt: null, updatedAt: null, lostItems: [] };
}

// 하루 기록 조회(없으면 빈 구조). 체크리스트 진행률 + 반납 완료 판정(6칸)도 같이 계산.
export function getDay(dateISO, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  const items = getItems(userId);
  const checked = items.filter((i) => (rec.checklist || {})[i.key]).length;
  return { ...rec, opsReturn: rec.opsReturn || {}, lostItems: Array.isArray(rec.lostItems) ? rec.lostItems : [],
    progress: { checked, total: items.length, done: items.length > 0 && checked === items.length },
    returnStatus: computeReturn(rec, isDutyDay(dateISO, userId)) };
}

function mutate(dateISO, fn, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  fn(rec);
  rec.updatedAt = Date.now();
  const st = computeReturn(rec, isDutyDay(dateISO, userId));      // 반납 완료 시각(경기팀 '반납 완료' 표시)
  rec.returnDoneAt = st.allDone ? (rec.returnDoneAt || Date.now()) : null;
  if (!st.allDone) rec.stampedAt = null;                          // 완료 미달로 떨어지면 '완료 도장' 자동 해제
  d[dateISO] = rec;
  saveAll(userId, d);
  return getDay(dateISO, userId);
}

export function setCartNo(dateISO, cartNo, userId = 1) {
  return mutate(dateISO, (r) => { r.cartNo = String(cartNo || '').slice(0, 20); }, userId);
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
  if (!isISO(dateISO) || !PHOTO_LEGS.includes(leg)) return null;
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  const dir = userPhotoDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `cart_${dateISO}_${leg}_${Date.now()}_${photoSeq++}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
  return mutate(dateISO, (r) => {
    const cur = r.photos && r.photos[leg];
    const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []); // 과거 단일 문자열도 배열로 흡수(하위호환)
    r.photos = { ...r.photos, [leg]: [...arr, fname] };
  }, userId);
}

// 사진 삭제 — 두 구간 모두 배열에서 해당 파일만 제거. 파일도 지운다.
export function removePhoto(dateISO, leg, fname, userId = 1) {
  return mutate(dateISO, (r) => {
    if (!r.photos) return;
    const cur = r.photos[leg];
    const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
    r.photos = { ...r.photos, [leg]: arr.filter((f) => f !== fname) };
    try { if (fname && /^[\w.-]+\.(jpg|png)$/.test(fname)) fs.unlinkSync(path.join(userPhotoDir(userId), fname)); } catch { /* 이미 없음 */ }
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
    const photos = rec.photos || {};
    const nPhoto = PHOTO_LEGS.reduce((s, leg) => { const c = photos[leg]; return s + (Array.isArray(c) ? c.length : (c ? 1 : 0)); }, 0);
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
    const photos = rec.photos || {};
    const nPhoto = PHOTO_LEGS.reduce((s, leg) => {
      const c = photos[leg]; return s + (Array.isArray(c) ? c.length : (c ? 1 : 0));
    }, 0);
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
    const photos = rec.photos || {};
    const nPhoto = PHOTO_LEGS.reduce((s, leg) => { const c = photos[leg]; return s + (Array.isArray(c) ? c.length : (c ? 1 : 0)); }, 0);
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
    const photos = (d[key] && d[key].photos) || {};
    for (const leg of PHOTO_LEGS) {
      const cur = photos[leg];
      const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
      for (const f of arr) {
        try { if (f && /^[\w.-]+\.(jpg|png)$/.test(f)) { fs.unlinkSync(path.join(userPhotoDir(userId), f)); files++; } } catch { /* 이미 없음 */ }
      }
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
