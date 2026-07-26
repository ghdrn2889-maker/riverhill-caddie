// 카트 점검 — 근무일마다 '카트 정리 증거 + 습관'을 남긴다.
//  카트가 매일 바뀌고 고객이 소지품을 두고 가는 환경에서,
//   ① 시작 기준사진(받았을 때 이미 있던 것) ② 종료 체크리스트+빈카트 사진(내가 비웠다는 증거)
//   ③ 발견물 신고(애매하면 즉시 경기과로 책임 이관) 를 하루 단위로 기록.
//  세무 사진과 동일한 파일 저장 패턴(data/photos)을 재사용한다.
import fs from 'node:fs';
import path from 'node:path';
import { loadUserJSON, saveUserJSON, userPhotoDir } from './store.mjs';

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
export const PHOTO_LEGS = ['intake', 'exit', 'club_pre', 'club_post']; // 카트 시작/빈카트 · 클럽 라운드전/후
const SETTINGS_KEY = '__settings'; // 날짜 키와 안 겹치는 예약 키

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
    remindedAt: null, updatedAt: null };
}

// 하루 기록 조회(없으면 빈 구조). 체크리스트 진행률도 같이 계산(현재 항목 기준).
export function getDay(dateISO, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  const items = getItems(userId);
  const checked = items.filter((i) => rec.checklist[i.key]).length;
  return { ...rec, progress: { checked, total: items.length, done: items.length > 0 && checked === items.length } };
}

function mutate(dateISO, fn, userId = 1) {
  if (!isISO(dateISO)) return null;
  const d = loadAll(userId);
  const rec = d[dateISO] || blank(dateISO);
  fn(rec);
  rec.updatedAt = Date.now();
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

let photoSeq = 0;
// intake(카트 상태)·exit(빈 카트) 모두 여러 장 누적(배열). 갤러리에서 여러 장 올릴 수 있다.
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
