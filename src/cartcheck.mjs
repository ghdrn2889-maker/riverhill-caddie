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

// 종료 점검 표준 체크리스트(김홍구님이 실제 카트에 맞춰 조정 가능).
//  key = 저장 식별자, label = 화면 문구.
export const CHECK_ITEMS = [
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
const ITEM_KEYS = new Set(CHECK_ITEMS.map((i) => i.key));
export const PHOTO_LEGS = ['intake', 'exit']; // 시작 기준 / 빈 카트

function loadAll() { return loadJSON(FILE, {}); }
function saveAll(d) { saveJSON(FILE, d); }
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function blank(dateISO) {
  return { date: dateISO, cartNo: '', photos: {}, checklist: {}, checklistDoneAt: null,
    found: [], remindedAt: null, updatedAt: null };
}

// 하루 기록 조회(없으면 빈 구조). 체크리스트 진행률도 같이 계산.
export function getDay(dateISO) {
  if (!isISO(dateISO)) return null;
  const d = loadAll();
  const rec = d[dateISO] || blank(dateISO);
  const checked = ITEM_KEYS.size ? CHECK_ITEMS.filter((i) => rec.checklist[i.key]).length : 0;
  return { ...rec, progress: { checked, total: CHECK_ITEMS.length, done: checked === CHECK_ITEMS.length } };
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
  if (!ITEM_KEYS.has(key)) return getDay(dateISO);
  return mutate(dateISO, (r) => {
    r.checklist = { ...r.checklist };
    if (done) r.checklist[key] = true; else delete r.checklist[key];
    const allDone = CHECK_ITEMS.every((i) => r.checklist[i.key]);
    r.checklistDoneAt = allDone ? (r.checklistDoneAt || Date.now()) : null;
  });
}

export function savePhoto(dateISO, leg, dataUrl) {
  if (!isISO(dateISO) || !PHOTO_LEGS.includes(leg)) return null;
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const fname = `cart_${dateISO}_${leg}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, fname), Buffer.from(m[2], 'base64'));
  return mutate(dateISO, (r) => { r.photos = { ...r.photos, [leg]: fname }; });
}

// 발견물 신고: 사진(선택)+메모. 애매한 물건을 즉시 기록해 책임을 넘긴다.
export function addFound(dateISO, { note = '', dataUrl = '' } = {}) {
  if (!isISO(dateISO)) return null;
  let photo = '';
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) {
    const ext = m[1] === 'image/png' ? 'png' : 'jpg';
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    photo = `cart_${dateISO}_found_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(PHOTO_DIR, photo), Buffer.from(m[2], 'base64'));
  }
  return mutate(dateISO, (r) => {
    r.found = [...(r.found || []), { id: `f${Date.now()}`, note: String(note || '').slice(0, 200), photo, at: Date.now(), reported: false }];
  });
}

export function setFoundReported(dateISO, foundId, reported) {
  return mutate(dateISO, (r) => {
    r.found = (r.found || []).map((f) => (f.id === foundId ? { ...f, reported: !!reported } : f));
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
