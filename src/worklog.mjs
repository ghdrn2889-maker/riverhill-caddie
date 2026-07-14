// 근무일지 + 차량운행일지 (세금 신고 증빙용).
//  - 근무 확정을 감지하면 그날을 '임시 기록'(worked=null)으로 자동 저장 → 앱에서 실제근무 확인.
//  - 근무일 × 왕복거리 = 주행거리. (유류비 추정은 옵션)
//  - 원본은 data/worklog.json 에 장기 보관. CSV 로 내보내 세무사/홈택스 제출.
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, saveJSON, DATA_DIR } from './store.mjs';

const FILE = 'worklog.json';
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
export const LEGS = ['start', 'work', 'home']; // 집출발 / 직장도착 / 집복귀
export const LEG_KO = { start: '집 출발', work: '직장 도착', home: '집 복귀' };
const DEFAULTS = { homeGolfKmOneway: 30, workplace: '리버힐CC', fuelEnabled: false, kmPerL: 12, fuelPrice: 1700 };

function load() {
  const d = loadJSON(FILE, null) || { days: {}, settings: {} };
  d.days = d.days || {};
  d.settings = { ...DEFAULTS, ...(d.settings || {}) };
  return d;
}
function save(d) { saveJSON(FILE, d); }

export function getSettings() { return load().settings; }
export function setSettings(patch = {}) {
  const d = load();
  const clean = {};
  if (patch.homeGolfKmOneway != null) clean.homeGolfKmOneway = Math.max(0, Number(patch.homeGolfKmOneway) || 0);
  if (patch.workplace != null) clean.workplace = String(patch.workplace).slice(0, 40);
  if (patch.fuelEnabled != null) clean.fuelEnabled = !!patch.fuelEnabled;
  if (patch.kmPerL != null) clean.kmPerL = Math.max(1, Number(patch.kmPerL) || 12);
  if (patch.fuelPrice != null) clean.fuelPrice = Math.max(0, Number(patch.fuelPrice) || 0);
  d.settings = { ...d.settings, ...clean };
  save(d);
  return d.settings;
}

// "7월 14일 화요일" / "2026년 07월 14일" → 'YYYY-MM-DD' (연도 없으면 올해).
export function labelToISO(label, now = new Date()) {
  if (!label) return null;
  const m = String(label).match(/(?:(\d{4})년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!m) return null;
  const y = m[1] ? Number(m[1]) : now.getFullYear();
  const mo = String(Number(m[2])).padStart(2, '0');
  const da = String(Number(m[3])).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// 근무 확정 자동 기록(임시, worked=null). 이미 확인(worked 지정)된 날은 덮어쓰지 않음.
export function recordWorkDay(dateISO, info = {}) {
  if (!dateISO) return null;
  const d = load();
  const cur = d.days[dateISO] || { date: dateISO, worked: null, source: 'auto', detectedAt: Date.now() };
  d.days[dateISO] = {
    ...cur, date: dateISO,
    teeTime: info.teeTime || cur.teeTime || '',
    course: info.course || cur.course || '',
    articleId: info.articleId || cur.articleId || '',
  };
  save(d);
  return d.days[dateISO];
}

// 실제 근무 여부 확인(예/아니오). 없던 날이면 수동 생성.
export function confirmWorkDay(dateISO, worked) {
  if (!dateISO) return null;
  const d = load();
  const cur = d.days[dateISO] || { date: dateISO, source: 'manual', detectedAt: Date.now(), teeTime: '', course: '' };
  cur.worked = worked === null ? null : !!worked;
  cur.confirmedAt = Date.now();
  d.days[dateISO] = cur;
  save(d);
  return cur;
}

// 수동 추가(시스템이 놓친 날 직접 입력).
export function addWorkDay(dateISO, info = {}) {
  if (!dateISO) return null;
  const d = load();
  d.days[dateISO] = {
    date: dateISO, worked: true, source: 'manual', detectedAt: Date.now(), confirmedAt: Date.now(),
    teeTime: info.teeTime || '', course: info.course || '', note: info.note || '',
  };
  save(d);
  return d.days[dateISO];
}

// ── 계기판 사진 저장(증빙) ──────────────────────────────
// base64 데이터URL(앱에서 압축본)을 파일로 저장하고 day.photos[leg] 에 연결.
export function savePhoto(dateISO, leg, dataUrl) {
  if (!dateISO || !LEGS.includes(leg)) return null;
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const fname = `${dateISO}_${leg}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, fname), Buffer.from(m[2], 'base64'));
  const d = load();
  const cur = d.days[dateISO] || { date: dateISO, worked: null, source: 'manual', detectedAt: Date.now() };
  cur.photos = { ...(cur.photos || {}), [leg]: fname };
  d.days[dateISO] = cur;
  save(d);
  return cur;
}
export function photoPath(fname) { return path.join(PHOTO_DIR, fname); }

// 계기판 숫자(선택) 입력 → 정확한 거리 계산에 사용.
export function saveOdo(dateISO, odo = {}) {
  if (!dateISO) return null;
  const d = load();
  const cur = d.days[dateISO] || { date: dateISO, worked: null, source: 'manual', detectedAt: Date.now() };
  const o = { ...(cur.odo || {}) };
  for (const leg of LEGS) if (odo[leg] != null && odo[leg] !== '') o[leg] = Number(odo[leg]);
  cur.odo = o;
  d.days[dateISO] = cur;
  save(d);
  return cur;
}

// 그 날 실제 왕복거리: 계기판 숫자가 있으면 그걸로, 없으면 설정 편도×2.
function dayKm(day, settings) {
  const o = day.odo || {};
  if (o.start != null && o.home != null && o.home >= o.start) return o.home - o.start;
  return (settings.homeGolfKmOneway || 0) * 2;
}

// 기록이 '비어있는' 근무일(사진·계기판 전혀 없음) → 리마인더 대상.
function isBlank(day) {
  const hasPhoto = day.photos && Object.keys(day.photos).length > 0;
  const hasOdo = day.odo && Object.keys(day.odo).length > 0;
  return !hasPhoto && !hasOdo && !day.recorded;
}

export function listDays({ year, month } = {}) {
  const days = Object.values(load().days);
  let out = days;
  if (year) out = out.filter((x) => x.date.startsWith(`${year}-`));
  if (month) out = out.filter((x) => x.date.slice(5, 7) === String(month).padStart(2, '0'));
  out.sort((a, b) => (a.date < b.date ? 1 : -1)); // 최신순
  return out;
}

export function summary({ year, month } = {}) {
  const s = load().settings;
  const all = listDays({ year, month });
  const worked = all.filter((x) => x.worked === true);
  const pending = all.filter((x) => x.worked == null); // 확인 대기
  const blank = worked.filter(isBlank);                // 근무했지만 기록 비어있음
  const roundKm = (s.homeGolfKmOneway || 0) * 2;
  const totalKm = worked.reduce((sum, d) => sum + dayKm(d, s), 0);
  const estFuel = s.fuelEnabled && s.kmPerL ? Math.round((totalKm / s.kmPerL) * (s.fuelPrice || 0)) : null;
  return { workedDays: worked.length, pendingDays: pending.length, blankDays: blank.length, roundKm, totalKm, estFuel };
}

// 리마인더 대상: 최근 3일 내 (근무확정 or 확인대기)인데 기록이 비어있고, 하루 안에 재알림 안 한 날.
export function dueReminders(now = Date.now()) {
  const cutoff = now - 3 * 86400 * 1000;
  return Object.values(load().days).filter((day) => {
    if (day.worked === false || !isBlank(day)) return false;
    const t = new Date(day.date + 'T00:00:00').getTime();
    if (isNaN(t) || t < cutoff) return false;
    if (day.remindedAt && now - day.remindedAt < 20 * 3600 * 1000) return false;
    return true;
  });
}
export function markReminded(dateISO, now = Date.now()) {
  const d = load();
  if (d.days[dateISO]) { d.days[dateISO].remindedAt = now; save(d); }
}

// 차량운행일지 CSV (엑셀/세무사 제출용).
export function toCSV({ year, month } = {}) {
  const s = load().settings;
  const rows = listDays({ year, month })
    .filter((x) => x.worked === true)
    .sort((a, b) => (a.date < b.date ? -1 : 1)); // CSV는 오래된 순
  const header = ['일자', '요일', '사용목적', '출발지', '도착지', '왕복거리(km)', '티오프', '코스', '계기판사진', '비고'];
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  const line = (arr) => arr.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
  let totalKm = 0;
  const body = rows.map((r) => {
    const km = dayKm(r, s); totalKm += km;
    const dow = wd[new Date(r.date + 'T00:00:00').getDay()];
    const photos = r.photos ? Object.keys(r.photos).length : 0;
    return line([r.date, dow, '업무(출퇴근)', '자택', s.workplace, km, r.teeTime || '', r.course || '', photos ? `사진 ${photos}장` : '', r.note || '']);
  });
  const footer = line([`합계 ${rows.length}일`, '', '', '', '', totalKm, '', '', '', s.fuelEnabled ? `예상유류비 ${Math.round((totalKm / s.kmPerL) * (s.fuelPrice || 0))}원` : '']);
  return '﻿' + [line(header), ...body, footer].join('\r\n'); // BOM(엑셀 한글깨짐 방지)
}
