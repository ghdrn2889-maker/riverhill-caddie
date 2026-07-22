// 카트 점검 — 근무일마다 '카트 정리 증거 + 습관'을 남긴다.
//  카트가 매일 바뀌고 고객이 소지품을 두고 가는 환경에서,
//   ① 시작 기준사진(받았을 때 이미 있던 것) ② 종료 체크리스트+빈카트 사진(내가 비웠다는 증거)
//   ③ 발견물 신고(애매하면 즉시 경기과로 책임 이관) 를 하루 단위로 기록.
//  세무 사진과 동일한 파일 저장 패턴(data/photos)을 재사용한다.
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, saveJSON, DATA_DIR } from './store.mjs';

const FILE = 'cartcheck.json';
const PHOTO_DIR = path.join(DATA_DIR, 'photos');

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
export const PHOTO_LEGS = ['intake', 'exit']; // 시작 기준 / 빈 카트
const SETTINGS_KEY = '__settings'; // 날짜 키와 안 겹치는 예약 키

function loadAll() { return loadJSON(FILE, {}); }
function saveAll(d) { saveJSON(FILE, d); }
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// 현재 체크리스트 항목(편집됐으면 개인목록, 아니면 기본 예시).
export function getItems() {
  const s = loadAll()[SETTINGS_KEY];
  if (s && s.customized && Array.isArray(s.items)) return s.items;
  return DEFAULT_ITEMS.slice();
}
function itemKeySet() { return new Set(getItems().map((i) => i.key)); }
function saveItems(items) {
  const d = loadAll();
  d[SETTINGS_KEY] = { ...(d[SETTINGS_KEY] || {}), items, customized: true };
  saveAll(d);
  return getItems();
}
let addSeq = 0;
export function addItem(label) {
  const l = String(label || '').trim().slice(0, 40);
  if (!l) return getItems();
  const items = getItems();
  const key = `u${Date.now().toString(36)}${addSeq++}`;
  return saveItems([...items, { key, label: l }]);
}
export function renameItem(key, label) {
  const l = String(label || '').trim().slice(0, 40);
  if (!l) return getItems();
  return saveItems(getItems().map((i) => (i.key === key ? { ...i, label: l } : i)));
}
export function removeItem(key) {
  return saveItems(getItems().filter((i) => i.key !== key));
}
export function reorderItems(keys) {
  const map = new Map(getItems().map((i) => [i.key, i]));
  const items = (keys || []).map((k) => map.get(k)).filter(Boolean);
  return items.length ? saveItems(items) : getItems();
}
export function resetItems() {
  const d = loadAll();
  d[SETTINGS_KEY] = { customized: false, items: DEFAULT_ITEMS.slice() };
  saveAll(d);
  return getItems();
}
// 추천 항목 받기: 기본(추천) 항목 중 아직 없는 것만 목록에 더한다(기존 항목·이름 유지, 비파괴).
export function recommendItems() {
  const cur = getItems();
  const have = new Set(cur.map((i) => i.key));
  const add = DEFAULT_ITEMS.filter((i) => !have.has(i.key));
  return add.length ? saveItems([...cur, ...add]) : cur;
}

function blank(dateISO) {
  return { date: dateISO, cartNo: '', photos: {}, checklist: {}, checklistDoneAt: null,
    remindedAt: null, updatedAt: null };
}

// 하루 기록 조회(없으면 빈 구조). 체크리스트 진행률도 같이 계산(현재 항목 기준).
export function getDay(dateISO) {
  if (!isISO(dateISO)) return null;
  const d = loadAll();
  const rec = d[dateISO] || blank(dateISO);
  const items = getItems();
  const checked = items.filter((i) => rec.checklist[i.key]).length;
  return { ...rec, progress: { checked, total: items.length, done: items.length > 0 && checked === items.length } };
}

function mutate(dateISO, fn) {
  if (!isISO(dateISO)) return null;
  const d = loadAll();
  const rec = d[dateISO] || blank(dateISO);
  fn(rec);
  rec.updatedAt = Date.now();
  d[dateISO] = rec;
  saveAll(d);
  return getDay(dateISO);
}

export function setCartNo(dateISO, cartNo) {
  return mutate(dateISO, (r) => { r.cartNo = String(cartNo || '').slice(0, 20); });
}

// 체크리스트 항목 토글. 전부 체크되면 완료시각 기록(=증거 타임스탬프).
export function toggleCheck(dateISO, key, done) {
  const items = getItems();
  if (!itemKeySet().has(key)) return getDay(dateISO);
  return mutate(dateISO, (r) => {
    r.checklist = { ...r.checklist };
    if (done) r.checklist[key] = true; else delete r.checklist[key];
    const allDone = items.length > 0 && items.every((i) => r.checklist[i.key]);
    r.checklistDoneAt = allDone ? (r.checklistDoneAt || Date.now()) : null;
  });
}

let photoSeq = 0;
export function savePhoto(dateISO, leg, dataUrl) {
  if (!isISO(dateISO) || !PHOTO_LEGS.includes(leg)) return null;
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  if (leg === 'intake') { // 카트 상태 — 여러 장 누적(배열)
    const fname = `cart_${dateISO}_intake_${Date.now()}_${photoSeq++}.${ext}`;
    fs.writeFileSync(path.join(PHOTO_DIR, fname), Buffer.from(m[2], 'base64'));
    return mutate(dateISO, (r) => {
      const cur = r.photos && r.photos.intake;
      const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
      r.photos = { ...r.photos, intake: [...arr, fname] };
    });
  }
  const fname = `cart_${dateISO}_${leg}.${ext}`; // exit(빈 카트) — 단일
  fs.writeFileSync(path.join(PHOTO_DIR, fname), Buffer.from(m[2], 'base64'));
  return mutate(dateISO, (r) => { r.photos = { ...r.photos, [leg]: fname }; });
}

// 사진 삭제(intake는 배열에서 해당 파일만, exit는 통째로). 파일도 지운다.
export function removePhoto(dateISO, leg, fname) {
  return mutate(dateISO, (r) => {
    if (!r.photos) return;
    if (leg === 'intake') {
      const cur = r.photos.intake;
      const arr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
      r.photos = { ...r.photos, intake: arr.filter((f) => f !== fname) };
    } else {
      const p = { ...r.photos }; delete p[leg]; r.photos = p;
    }
    try { if (fname && /^[\w.-]+\.(jpg|png)$/.test(fname)) fs.unlinkSync(path.join(PHOTO_DIR, fname)); } catch { /* 이미 없음 */ }
  });
}

export function photoPath(fname) { return path.join(PHOTO_DIR, fname); }
export function markReminded(dateISO) { return mutate(dateISO, (r) => { r.remindedAt = Date.now(); }); }

// 리마인더 판단용: 해당 근무일에 종료 점검이 아직 미완인가?
export function needsExitCheck(dateISO) {
  const rec = getDay(dateISO);
  if (!rec) return false;
  return !rec.progress.done; // 체크리스트 전부 완료 전이면 상기 대상
}
