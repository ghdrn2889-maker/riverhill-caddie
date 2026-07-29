// 정산(회계) — 캐디피 수익 자동 산정 + 팁(선택) + 지출/영수증 증빙 + 수익계산서 문서(PDF/Word).
//  · 수익: 근무 확정일 × 그날 근무한 부(部)의 캐디피 합(1·2부 14만, 3부 15만 — 설정에서 수정).
//    부 조합은 근무일지(worklog)의 rounds에서 자동 감지, 틀리면 dayParts로 수동 보정(유령 2부 대비).
//  · 팁: 날짜별 선택 입력(미기재=0).
//  · 지출: 날짜·항목·금액·결제수단·증빙유형·상호 + 영수증 사진(선택). AI 판독으로 자동 채움 후 사용자 확인.
//  · 문서: 부별 항목 → 총합. 수익/팁/지출 토글 5조합 + 사진 포함/제외. 세무사·홈택스 소명자료용.
import fs from 'node:fs';
import path from 'node:path';
import { loadUserJSON, saveUserJSON, userPhotoDir } from './store.mjs';
import * as worklog from './worklog.mjs';
import * as journal from './journal.mjs';

const FILE = 'ledger.json';
// 캐디피 단가 — 고정값(로직에 박음, 설정에서 변경 불가). 1·2부 14만, 3부 15만.
//   조합은 자동 합산: 1·3부 = 14+15 = 29만, 54(1·2·3부) = 14+14+15 = 43만.
const FEES = { 1: 140000, 2: 140000, 3: 150000 };
const DEFAULT_PART = '3'; // 부를 알 수 없을 때 가정하는 기본부(3부 스페어).
const EXP_CATS = ['주유', '톨비', '식대', '주차', '기타'];
const EXP_METHODS = ['카드', '현금영수증', '현금', '세금계산서', '간이영수증', ''];

function load(userId = 1) {
  const d = loadUserJSON(userId, FILE, null) || {};
  d.tips = d.tips || {};        // { 'YYYY-MM-DD': 금액 }
  d.dayParts = d.dayParts || {}; // { 'YYYY-MM-DD': ['2','3'] }  수동 부 보정
  d.expenses = d.expenses || []; // [{ id, date, category, amount, method, vendor, memo, photo, scanned }]
  return d;
}
function save(userId, d) { saveUserJSON(userId, FILE, d); }

// 일지 rounds에서 '실제 근무(work)'로 뛴 부만 추출 — 스페어(대기)로만 잡힌 부는 수익 대상 아님.
//  (예: 2부 스페어 + 3부 근무 = 3부만 수익. 실제로 2부도 뛰었으면 사용자가 dayParts로 보정.)
function workedPartsOf(rounds) {
  if (!rounds) return [];
  return Object.entries(rounds)
    .filter(([p, r]) => ['1', '2', '3'].includes(p) && r && r.kind === 'work')
    .map(([p]) => p);
}
// 그날 근무한 부 배열 — 수동 보정(dayParts) 우선, 없으면 일지의 '근무' 라운드, 그것도 없으면 기본부(3부).
function partsForDay(day, d) {
  const ov = d.dayParts[day.date];
  if (Array.isArray(ov) && ov.length) return ov.slice().sort();
  const r = workedPartsOf(day.rounds);
  if (r.length) return r.slice().sort();
  return [DEFAULT_PART];
}
function feeOf(part) { return FEES[part] || 0; }
function dayRevenue(parts) { return parts.reduce((sum, p) => sum + feeOf(p), 0); } // 부 조합 자동 합산(1·3부=29만 등)

// 한 날짜의 '유효 부 조합' — 수동보정(dayParts) → 일일 근무 일지 rounds → 근거 없으면 null.
//  일지 표시와 정산 수익이 같은 값을 쓰도록 하는 단일 소스(partsForDay와 동일 우선순위).
export function effPartsFor(dateISO, userId = 1) {
  const d = load(userId);
  const ov = d.dayParts[dateISO];
  if (Array.isArray(ov) && ov.length) return ov.slice().sort();
  const jday = journal.getDay(dateISO, userId);
  const r = workedPartsOf(jday && jday.rounds);
  if (r.length) return r.slice().sort();
  return null;
}
// 수동보정 존재 여부(일지의 '직접 지정' 표시용).
export function hasDayPartsOverride(dateISO, userId = 1) { return Array.isArray(load(userId).dayParts[dateISO]); }

const inPeriod = (dateISO, year, month) => {
  if (!dateISO) return false;
  if (year && !String(dateISO).startsWith(`${year}-`)) return false;
  if (month && String(dateISO).slice(5, 7) !== String(month).padStart(2, '0')) return false;
  return true;
};
const PART_KO = { 1: '1부', 2: '2부', 3: '3부' };

// 월(또는 연) 정산 집계 + 일자별 내역.
export function summary({ year, month } = {}, userId = 1) {
  const d = load(userId);
  // ★수익 산정 = 일일 근무 일지(journal)의 '근무'일 기준(사용자가 보고 편집하는 그 일지와 동일 소스).
  //  worklog(세무·차량 기록)는 주행거리·영수증 전용으로 분리 — 정산 수익은 일지가 단일 진실.
  const all = journal.listJournal({ year, month }, userId);
  const worked = all.filter((x) => x.kind === 'work' && !x.excluded);  // 확정 근무일 → 수익 산정 대상
  const pending = [];                                                   // 일지엔 '확인 대기' 개념 없음(확정만 기록)

  const byPart = { 1: { days: 0, amount: 0, fee: feeOf('1') }, 2: { days: 0, amount: 0, fee: feeOf('2') }, 3: { days: 0, amount: 0, fee: feeOf('3') } };
  let workRevenue = 0;
  const rows = worked.map((day) => {
    const parts = partsForDay(day, d);
    const rev = dayRevenue(parts);
    parts.forEach((p) => { if (byPart[p]) { byPart[p].days++; byPart[p].amount += feeOf(p); } });
    workRevenue += rev;
    const tip = Math.max(0, Number(d.tips[day.date]) || 0);
    return { date: day.date, parts, tang: parts.length >= 3 ? '54' : parts.join('/'), revenue: rev, tip };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));

  const pendingRevenue = 0;
  const tipTotal = rows.reduce((a, r) => a + r.tip, 0);
  const expenses = d.expenses.filter((e) => inPeriod(e.date, year, month)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const expTotal = expenses.reduce((a, e) => a + (Math.max(0, Number(e.amount) || 0)), 0);
  const expByCat = {};
  for (const e of expenses) { const c = EXP_CATS.includes(e.category) ? e.category : '기타'; expByCat[c] = (expByCat[c] || 0) + (Math.max(0, Number(e.amount) || 0)); }

  return {
    fees: FEES,
    byPart, partKo: PART_KO,
    workedDays: worked.length, pendingDays: pending.length,
    workRevenue, pendingRevenue,
    tipTotal, revenueTotal: workRevenue + tipTotal,
    expTotal, expByCat,
    netProfit: workRevenue + tipTotal - expTotal,
    rows, expenses,
  };
}

// ── 팁 ─────────────────────────────────────────
export function setTip(dateISO, amount, userId = 1) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const d = load(userId);
  const n = amount == null || amount === '' ? 0 : Math.max(0, Math.round(Number(amount) || 0));
  if (n > 0) d.tips[dateISO] = n; else delete d.tips[dateISO];
  save(userId, d);
  return { date: dateISO, tip: n };
}

// ── 부(部) 수동 보정 — 유령 2부 등 오검출 교정 ──
export function setDayParts(dateISO, parts, userId = 1) {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const d = load(userId);
  const clean = (Array.isArray(parts) ? parts : []).map(String).filter((p) => ['1', '2', '3'].includes(p));
  if (clean.length) d.dayParts[dateISO] = [...new Set(clean)].sort(); else delete d.dayParts[dateISO];
  save(userId, d);
  return { date: dateISO, parts: d.dayParts[dateISO] || null };
}

// ── 지출(영수증) CRUD ──────────────────────────
function newId(d) {
  let n = 1; const used = new Set(d.expenses.map((e) => e.id));
  while (used.has('e' + n)) n++;
  return 'e' + n;
}
export function addExpense(exp = {}, userId = 1) {
  const d = load(userId);
  const id = newId(d);
  const row = {
    id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(exp.date) ? exp.date : new Date().toISOString().slice(0, 10),
    category: EXP_CATS.includes(exp.category) ? exp.category : '기타',
    amount: Math.max(0, Math.round(Number(exp.amount) || 0)),
    method: EXP_METHODS.includes(exp.method) ? exp.method : '',
    vendor: String(exp.vendor || '').slice(0, 40),
    memo: String(exp.memo || '').slice(0, 80),
    photo: null,
    scanned: !!exp.scanned,
    at: Date.now(),
  };
  d.expenses.push(row);
  save(userId, d);
  return row;
}
export function updateExpense(id, patch = {}, userId = 1) {
  const d = load(userId);
  const row = d.expenses.find((e) => e.id === id);
  if (!row) return null;
  if (patch.date != null && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) row.date = patch.date;
  if (patch.category != null) row.category = EXP_CATS.includes(patch.category) ? patch.category : row.category;
  if (patch.amount != null) row.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
  if (patch.method != null) row.method = EXP_METHODS.includes(patch.method) ? patch.method : '';
  if (patch.vendor != null) row.vendor = String(patch.vendor).slice(0, 40);
  if (patch.memo != null) row.memo = String(patch.memo).slice(0, 80);
  save(userId, d);
  return row;
}
export function deleteExpense(id, userId = 1) {
  const d = load(userId);
  const i = d.expenses.findIndex((e) => e.id === id);
  if (i < 0) return false;
  const [row] = d.expenses.splice(i, 1);
  if (row && row.photo) { try { fs.unlinkSync(path.join(userPhotoDir(userId), row.photo)); } catch { /* noop */ } }
  save(userId, d);
  return true;
}
export function getExpense(id, userId = 1) { return load(userId).expenses.find((e) => e.id === id) || null; }

// 영수증 사진 저장(증빙) — base64 데이터URL → 파일. exp.photo 에 연결.
export function saveExpensePhoto(id, dataUrl, userId = 1) {
  const d = load(userId);
  const row = d.expenses.find((e) => e.id === id);
  if (!row) return null;
  const m = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  const dir = userPhotoDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `exp_${id}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
  row.photo = fname;
  save(userId, d);
  return row;
}
export function expensePhotoPath(fname, userId = 1) { return path.join(userPhotoDir(userId), fname); }

// ── 수익계산서 문서(HTML — PDF 인쇄/Word .doc 공용) ──────────────
//  include: { revenue, tips, expenses } 토글(5조합) · photos: 영수증 사진 포함 여부 · forWord: Word 저장용.
const won = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (iso) => WD[new Date(iso + 'T00:00:00').getDay()];
function photoDataUri(fname, userId) {
  try {
    const buf = fs.readFileSync(path.join(userPhotoDir(userId), fname));
    const ext = fname.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

export function incomeReportHTML(opts = {}, userId = 1) {
  const year = opts.year, month = opts.month;
  const inc = opts.include || { revenue: true, tips: true, expenses: true };
  const showRev = !!inc.revenue, showTip = !!inc.tips, showExp = !!inc.expenses;
  const showPhotos = !!opts.photos;
  const st = summary({ year, month }, userId);
  const wl = worklog.getSettings(userId);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const period = `${year || '전체'}년${month ? ` ${month}월` : ''}`;

  // 제목: 선택 조합에 따라 문서 성격 표기.
  const titleWord = showRev && showExp ? '수입·지출 정산서' : showRev ? '수입 정산서' : '지출 정산서';

  // [수익] 부별 표
  let revenueBlock = '';
  if (showRev) {
    // 근무일별 내역 — 실제 근무 날짜 + 부 조합 + 캐디피(+팁).
    const dayRowsAsc = st.rows.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const tangKo = (parts) => parts.length >= 3 ? '54(1·2·3부)' : parts.map((p) => `${p}부`).join('·');
    const dayCols = showTip ? 5 : 4;
    const dayRows = dayRowsAsc.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${esc(r.date)}(${dow(r.date)})</td><td>${tangKo(r.parts)}</td>
      <td class="num strong">${won(r.revenue)}</td>${showTip ? `<td class="num">${r.tip ? won(r.tip) : '-'}</td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${dayCols}" class="mid">확정된 근무가 없습니다.</td></tr>`;
    // 부별 요약.
    const partRows = ['1', '2', '3'].filter((p) => st.byPart[p].days > 0).map((p) => `<tr>
      <td>${st.partKo[p]}</td><td class="num">${st.byPart[p].days}일</td>
      <td class="num">${won(st.byPart[p].fee)}</td><td class="num strong">${won(st.byPart[p].amount)}</td></tr>`).join('')
      || `<tr><td colspan="4" class="mid">-</td></tr>`;
    const tipRow = showTip ? `<tr class="sub"><td colspan="3">팁 합계</td><td class="num strong">${won(st.tipTotal)}</td></tr>` : '';
    const totalRev = showTip ? st.revenueTotal : st.workRevenue;
    revenueBlock = `
      <h2>1. 수입</h2>
      <h3>근무일별 내역</h3>
      <table class="log"><thead><tr><th>No</th><th>근무일</th><th>근무(부)</th><th>캐디피</th>${showTip ? '<th>팁</th>' : ''}</tr></thead>
        <tbody>${dayRows}</tbody></table>
      <h3>부별 요약</h3>
      <table class="log"><thead><tr><th>구분</th><th>근무일</th><th>캐디피(1회)</th><th>금액</th></tr></thead>
        <tbody>${partRows}</tbody>
        <tfoot>
          <tr class="sub"><td colspan="3">근무 수입 소계</td><td class="num strong">${won(st.workRevenue)}</td></tr>
          ${tipRow}
          <tr class="tot"><td colspan="3">수입 합계</td><td class="num">${won(totalRev)}</td></tr>
        </tfoot>
      </table>`;
  }

  // [지출] 항목별 + 상세
  let expenseBlock = '';
  if (showExp) {
    const catRows = Object.keys(st.expByCat).length
      ? Object.entries(st.expByCat).map(([c, a]) => `<tr><td>${esc(c)}</td><td class="num strong">${won(a)}</td></tr>`).join('')
      : `<tr><td colspan="2" class="mid">등록된 지출이 없습니다.</td></tr>`;
    const detailRows = st.expenses.map((e, i) => `<tr>
      <td>${i + 1}</td><td>${esc(e.date)}(${dow(e.date)})</td><td>${esc(e.category)}</td>
      <td>${esc(e.vendor || '')}</td><td>${esc(e.method || '')}</td><td class="num strong">${won(e.amount)}</td></tr>`).join('')
      || `<tr><td colspan="6" class="mid">—</td></tr>`;
    expenseBlock = `
      <h2>${showRev ? '2' : '1'}. 지출(업무 경비)</h2>
      <table class="log half"><thead><tr><th>항목</th><th>금액</th></tr></thead>
        <tbody>${catRows}</tbody>
        <tfoot><tr class="tot"><td>지출 합계</td><td class="num">${won(st.expTotal)}</td></tr></tfoot>
      </table>
      <h3>지출 상세(증빙)</h3>
      <table class="log"><thead><tr><th>No</th><th>일자</th><th>항목</th><th>사용처</th><th>결제</th><th>금액</th></tr></thead>
        <tbody>${detailRows}</tbody></table>`;
  }

  // [순이익] 수익·지출 둘 다일 때만
  const netBlock = (showRev && showExp) ? `
    <table class="net"><tbody>
      <tr><td>수입 합계</td><td class="num">${won(showTip ? st.revenueTotal : st.workRevenue)}</td></tr>
      <tr><td>지출 합계</td><td class="num">− ${won(st.expTotal)}</td></tr>
      <tr class="tot"><td>순이익</td><td class="num">${won((showTip ? st.revenueTotal : st.workRevenue) - st.expTotal)}</td></tr>
    </tbody></table>` : '';

  // 영수증 사진 부록(옵션)
  let photoBlock = '';
  if (showExp && showPhotos) {
    const shots = st.expenses.filter((e) => e.photo).map((e) => {
      const uri = photoDataUri(e.photo, userId);
      if (!uri) return '';
      return `<figure class="rc"><img src="${uri}" alt="${esc(e.category)} 영수증"/><figcaption>${esc(e.date)} · ${esc(e.category)} · ${won(e.amount)}${e.vendor ? ` · ${esc(e.vendor)}` : ''}</figcaption></figure>`;
    }).filter(Boolean).join('');
    if (shots) photoBlock = `<h2>영수증 증빙 사진</h2><div class="rcs">${shots}</div>`;
  }

  const noteBits = [];
  if (showRev) noteBits.push('수입은 확정 근무일 × 부별 캐디피(1·2부 14만원, 3부 15만원) 자동 합산입니다.');
  if (showExp) noteBits.push('지출은 업무를 위한 실제 경비이며, 실제 증빙은 영수증·카드매출전표·현금영수증(지출증빙용)·세금계산서입니다. 본 문서는 이를 정리·집계한 소명자료로, 신고 방식(장부작성 여부)에 따라 공제 범위가 다르므로 세무사 상담을 권장합니다.');

  const mso = opts.forWord ? `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->` : '';
  const toolbar = opts.forWord ? '' : `<div class="toolbar"><button onclick="window.print()">🖨️ 인쇄 / PDF로 저장</button></div>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(titleWord)} ${esc(period)}</title>${mso}
<style>
  body{font-family:-apple-system,"Malgun Gothic",sans-serif;color:#1a201d;margin:0;padding:26px;background:#fff;}
  h1{font-size:22px;margin:0 0 3px;} .sub{color:#666;font-size:13px;margin-bottom:18px;}
  h2{font-size:16px;border-top:2px solid #0b5d34;padding-top:12px;margin:22px 0 8px;}
  h3{font-size:13px;color:#0b5d34;margin:14px 0 6px;}
  .meta{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;}
  .meta td{border:1px solid #ccc;padding:6px 10px;} .meta .k{background:#f4f6f5;font-weight:700;width:92px;}
  table.log{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:8px;}
  table.log.half{width:60%;} table.log th,table.log td{border:1px solid #bbb;padding:6px 9px;text-align:left;}
  table.log th{background:#0b5d34;color:#fff;font-weight:700;font-size:12px;}
  table.log td.num{text-align:right;font-variant-numeric:tabular-nums;} table.log td.strong{font-weight:700;}
  table.log td.mid{text-align:center;color:#999;}
  table.log tfoot td{background:#eef2f0;font-weight:700;}
  table.log tfoot tr.tot td{background:#0b5d34;color:#fff;font-size:13.5px;}
  .net{width:60%;border-collapse:collapse;margin:10px 0 6px;font-size:13.5px;}
  .net td{border:1px solid #bbb;padding:8px 10px;} .net td.num{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;}
  .net tr.tot td{background:#0b5d34;color:#fff;font-size:15px;}
  .note{font-size:11px;color:#777;margin:14px 0 8px;line-height:1.65;}
  .rcs{display:flex;flex-wrap:wrap;gap:12px;} .rc{margin:0;width:calc(50% - 6px);page-break-inside:avoid;}
  .rc img{width:100%;max-height:260px;object-fit:contain;border:1px solid #ccc;border-radius:6px;background:#fafafa;}
  .rc figcaption{font-size:11px;color:#555;margin-top:4px;text-align:center;}
  .toolbar{position:sticky;top:0;background:#0b5d34;padding:10px;text-align:center;margin:-26px -26px 20px;}
  .toolbar button{font-size:14px;font-weight:700;padding:9px 18px;border:0;border-radius:8px;background:#fff;color:#0b5d34;cursor:pointer;}
  @media print{.toolbar{display:none;} body{padding:0;}}
</style></head><body>
${toolbar}
<h1>${esc(titleWord)}</h1>
<div class="sub">대상 기간: ${esc(period)} · 사업소득(캐디) 종합소득세 참고자료</div>
<table class="meta">
  <tr><td class="k">성명</td><td>${esc(wl.driverName || '(설정에서 입력)')}</td>
      <td class="k">사업장</td><td>${esc(wl.workplace || '리버힐CC')}</td></tr>
  <tr><td class="k">확정 근무</td><td>${st.workedDays}일${st.pendingDays ? ` (확인 대기 ${st.pendingDays}일 제외)` : ''}</td>
      <td class="k">작성 구분</td><td>${esc(titleWord)}</td></tr>
</table>
${revenueBlock}
${expenseBlock}
${netBlock}
${photoBlock}
${noteBits.length ? `<div class="note">※ ${noteBits.join('<br>※ ')}</div>` : ''}
</body></html>`;
}
