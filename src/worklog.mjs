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
const DEFAULTS = { homeGolfKmOneway: 30, workplace: '리버힐CC', driverName: '', carNo: '', fuelEnabled: false, kmPerL: 12, fuelPrice: 1700 };

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
  if (patch.driverName != null) clean.driverName = String(patch.driverName).slice(0, 20);
  if (patch.carNo != null) clean.carNo = String(patch.carNo).slice(0, 20);
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

// 로컬(KST) 기준 오늘 날짜 'YYYY-MM-DD'.
function localISO(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 리마인더 대상: '이미 지난(오늘 포함) 근무일' 중 최근 3일 내인데 기록이 비어있고, 하루 안에 재알림 안 한 날.
// ★미래 근무일(내일 배치표 등)은 아직 출퇴근 전이므로 제외 — 계기판 사진은 당일 이동 중에 찍는 것.
export function dueReminders(now = Date.now()) {
  const todayISO = localISO(now);
  const cutoff = now - 3 * 86400 * 1000;
  return Object.values(load().days).filter((day) => {
    if (day.worked === false || !isBlank(day)) return false;
    if (day.date > todayISO) return false; // 아직 오지 않은 날은 리마인드 안 함
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

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (dateISO) => WD[new Date(dateISO + 'T00:00:00').getDay()];

// 차량운행일지 CSV (엑셀/세무사 제출용). 국세청 운행기록부 항목(계기판 전/후·주행거리) 포함.
export function toCSV({ year, month } = {}) {
  const s = load().settings;
  const rows = listDays({ year, month })
    .filter((x) => x.worked === true)
    .sort((a, b) => (a.date < b.date ? -1 : 1)); // CSV는 오래된 순
  const header = ['일자', '요일', '사용목적', '출발지', '도착지', '주행전(km)', '주행후(km)', '주행거리(km)', '티오프', '코스', '계기판사진', '비고'];
  const line = (arr) => arr.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
  let totalKm = 0;
  const body = rows.map((r) => {
    const km = dayKm(r, s); totalKm += km;
    const o = r.odo || {};
    const photos = r.photos ? Object.keys(r.photos).length : 0;
    return line([r.date, dow(r.date), '업무(출퇴근)', '자택', s.workplace,
      o.start ?? '', o.home ?? '', km, r.teeTime || '', r.course || '',
      photos ? `사진 ${photos}장` : '', r.note || '']);
  });
  const footer = line([`합계 ${rows.length}일`, '', '', '', '', '', '', totalKm, '', '', '',
    s.fuelEnabled ? `예상유류비 ${Math.round((totalKm / s.kmPerL) * (s.fuelPrice || 0))}원` : '']);
  return '﻿' + [line(header), ...body, footer].join('\r\n'); // BOM(엑셀 한글깨짐 방지)
}

// 사진 파일 → data URI (문서에 그대로 박아 자체 완결형 HTML 만들기).
function photoDataUri(fname) {
  try {
    const buf = fs.readFileSync(path.join(PHOTO_DIR, fname));
    const ext = fname.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

// 제출용 증빙 문서(HTML): 운행기록부 표 + 그날 계기판 사진이 한 장에.
// 브라우저에서 인쇄 → 'PDF로 저장'하면 세무사·홈택스 제출용 단일 파일 완성.
export function reportHTML({ year, month } = {}) {
  const s = load().settings;
  const rows = listDays({ year, month })
    .filter((x) => x.worked === true)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const period = `${year || '전체'}년${month ? ` ${month}월` : ''}`;
  let totalKm = 0;

  const tableRows = rows.map((r, i) => {
    const km = dayKm(r, s); totalKm += km;
    const o = r.odo || {};
    return `<tr>
      <td>${i + 1}</td><td>${esc(r.date)} (${dow(r.date)})</td>
      <td>업무(출퇴근)</td><td>자택 → ${esc(s.workplace)}</td>
      <td class="num">${o.start ?? '-'}</td><td class="num">${o.home ?? '-'}</td>
      <td class="num strong">${km}</td>
      <td>${esc(r.teeTime || '')}${r.course ? ` / ${esc(r.course)}` : ''}</td>
    </tr>`;
  }).join('');

  const galleries = rows.map((r) => {
    const photos = r.photos || {};
    const slots = LEGS.map((leg) => {
      const uri = photos[leg] ? photoDataUri(photos[leg]) : null;
      const o = (r.odo || {})[leg];
      return `<figure class="shot">
        ${uri ? `<img src="${uri}" alt="${LEG_KO[leg]}"/>` : `<div class="noimg">사진 없음</div>`}
        <figcaption>${LEG_KO[leg]}${o != null ? ` · ${o}km` : ''}</figcaption>
      </figure>`;
    }).join('');
    const has = Object.keys(photos).length > 0 || (r.odo && Object.keys(r.odo).length > 0);
    if (!has) return '';
    return `<section class="day">
      <h3>${esc(r.date)} (${dow(r.date)}) · ${esc(r.teeTime || '')} ${esc(r.course || '')}</h3>
      <div class="shots">${slots}</div>
    </section>`;
  }).join('');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>차량 운행기록부 ${esc(period)}</title>
<style>
  body{font-family:-apple-system,"Malgun Gothic",sans-serif;color:#1a201d;margin:0;padding:24px;background:#fff;}
  h1{font-size:22px;margin:0 0 4px;} .sub{color:#666;font-size:13px;margin-bottom:16px;}
  .meta{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;}
  .meta td{border:1px solid #ccc;padding:6px 10px;} .meta .k{background:#f4f6f5;font-weight:700;width:90px;}
  table.log{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:6px;}
  table.log th,table.log td{border:1px solid #bbb;padding:6px 8px;text-align:left;}
  table.log th{background:#0b5d34;color:#fff;font-weight:700;font-size:12px;}
  table.log td.num{text-align:right;} table.log td.strong{font-weight:700;}
  table.log tfoot td{background:#eef2f0;font-weight:700;}
  .note{font-size:11px;color:#777;margin:10px 0 26px;line-height:1.6;}
  .day{margin-bottom:20px;page-break-inside:avoid;}
  .day h3{font-size:14px;margin:0 0 8px;padding-bottom:4px;border-bottom:2px solid #0b5d34;}
  .shots{display:flex;gap:10px;} .shot{flex:1;margin:0;text-align:center;}
  .shot img{width:100%;height:150px;object-fit:cover;border:1px solid #ccc;border-radius:6px;}
  .shot .noimg{width:100%;height:150px;border:1px dashed #ccc;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;background:#fafafa;}
  .shot figcaption{font-size:11px;color:#555;margin-top:4px;font-weight:600;}
  .toolbar{position:sticky;top:0;background:#0b5d34;padding:10px;text-align:center;margin:-24px -24px 20px;}
  .toolbar button{font-size:14px;font-weight:700;padding:9px 18px;border:0;border-radius:8px;background:#fff;color:#0b5d34;cursor:pointer;}
  @media print{.toolbar{display:none;} body{padding:0;}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">🖨️ 인쇄 / PDF로 저장</button></div>
<h1>차량 운행기록부</h1>
<div class="sub">대상 기간: ${esc(period)} · 사업소득(캐디) 종합소득세 증빙</div>
<table class="meta">
  <tr><td class="k">성명</td><td>${esc(s.driverName || '(설정에서 입력)')}</td>
      <td class="k">차량번호</td><td>${esc(s.carNo || '(설정에서 입력)')}</td></tr>
  <tr><td class="k">사업장</td><td>${esc(s.workplace)}</td>
      <td class="k">총 근무일</td><td>${rows.length}일 · 총 주행 ${totalKm}km</td></tr>
</table>
<table class="log">
  <thead><tr><th>No</th><th>일자(요일)</th><th>사용목적</th><th>구간</th><th>주행 전</th><th>주행 후</th><th>주행거리</th><th>티오프/코스</th></tr></thead>
  <tbody>${tableRows || '<tr><td colspan="8" style="text-align:center;color:#999;">기록된 근무일이 없습니다.</td></tr>'}</tbody>
  <tfoot><tr><td colspan="6">합계</td><td class="num">${totalKm}km</td><td>${rows.length}일</td></tr></tfoot>
</table>
<div class="note">※ 계기판 '주행 전/후' 값은 운전자가 입력한 계기판 숫자이며, 아래 계기판 사진으로 뒷받침됩니다. 계기판 숫자 미입력일은 편도 ${s.homeGolfKmOneway}km 기준 왕복(${s.homeGolfKmOneway * 2}km)으로 추정 계상했습니다. 실제 경비 공제 가능 여부·범위는 신고 방식(장부작성 여부)에 따라 다르므로 세무사 상담을 권장합니다.</div>
${galleries ? `<h2 style="font-size:16px;border-top:2px solid #0b5d34;padding-top:14px;">계기판 사진 증빙</h2>${galleries}` : ''}
</body></html>`;
}
