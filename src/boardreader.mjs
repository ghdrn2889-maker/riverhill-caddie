// 배치표 판독 오케스트레이터 — Claude(서버, MAX 구독)를 주 판독자로 삼는다.
//  흐름: 합본 배치표 → Claude 부 경계 → 부별 크롭(파이썬 crop_only, 업스케일) → Claude가 부별 명단·티오프·커트 판독.
//  변동(단일부 크롭 업로드)은 경계 없이 그 이미지를 바로 부 판독. 커트는 요약숫자(있으면)로 교차확정.
//  ★검증(8/4): 경계 정확 + 부별 명단/티오프/커트 정확(3부 29·티오프16·커트16). VLM보다 슬라이스에서 압도적.
//  비용: 합본당 Claude ~4회(경계1+부별3), 변동당 1회. 하루 하드캡(claudereader) 보호.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPartBoundaries, readPartWithClaude, readColumnRoster, getRosterColumns, readSummaryCounts, readOffList, getCrewColumns, readCrewColumn, claudeBudgetLeft, claudeTimeouts, readPart3Holistic, readRosterVerbatim } from './claudereader.mjs';
import { snapStrong, snapName, confirmedCaddies, officialNearCandidates } from './roster.mjs';
import { DATA_DIR, appendJSONL } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON_BIN || 'python3';
const SCRIPT = path.join(HERE, '..', 'scripts', 'board_read_local.py');
const TMP = os.tmpdir();

function runPy(payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(PY, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('py 타임아웃')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (c) => { clearTimeout(timer); c === 0 ? resolve(JSON.parse(out)) : reject(new Error(err.slice(0, 200))); });
    p.stdin.write(JSON.stringify(payload)); p.stdin.end();
  });
}

// 이미지(URL/파일) → 로컬 파일 경로. URL이면 임시로 내려받는다.
async function ensureLocal(imageOrUrl) {
  if (!imageOrUrl) return null;
  if (fs.existsSync(imageOrUrl)) return imageOrUrl;
  if (/^https?:/.test(imageOrUrl)) {
    const dest = path.join(TMP, `board_${Date.now()}.png`);
    const buf = Buffer.from(await (await fetch(imageOrUrl)).arrayBuffer());
    fs.writeFileSync(dest, buf);
    return dest;
  }
  return null;
}

// 판독 명단에 명단 최근접 스냅 적용(박시숙→박시윤·성신영→정진영 등 오독 교정). 괄호 점유자도 각각.
//  ★체인: snapName(같은길이 1글자, 유일)로 먼저, 이어 snapStrong(편집거리≤2, 유일)로. 둘 다 '유일 최근접'만
//   교정(서동한처럼 서동환·서동명 사이 애매하면 그대로 둠) → 정본명 정확 반영 + 비슷한 이름 섣부른 치환 방지.
const snapOfficial = (x) => snapStrong(snapName(String(x || '').trim()));
const _bareNameOf = (cell) => {
  const s = String(cell || '').trim();
  const m = s.match(/^(.+?)\(([^)]+)\)\s*$/);
  return (m ? m[1] : s).trim();
};
// 셀에서 주인(맨앞 이름)과 대체자(대바) 추출 — crossparts.cellOwnerSub와 동일 규칙(순환 import 회피용 복제).
//  "차은경(1,3)구경은"→{owner:차은경,sub:구경은}, "남재권(정민철)"→{owner:남재권,sub:정민철}, "우겸조(54)"→{sub:''}.
const _SUB_TAGWORDS = new Set(['조출', '찾근', '조퇴', '반차', '오전', '오후', '대기', '스페어', '정출', '선발', '당번', '프리', '벌당', '배치', '콜', '정근', '휴무', '휴가', '병가', '연차', '월차', '격리', '마감', '대리', '주임', '마샬']);
function _ownerSubOf(cell) {
  const s = String(cell || '');
  const om = s.match(/^([가-힣]{2,4})/); if (!om) return { owner: '', sub: '' };
  const owner = om[1]; let sub = '';
  for (const g of s.matchAll(/\(([^)]*)\)/g)) { const p = g[1].trim(); if (/^[가-힣]{2,4}$/.test(p) && p !== owner && !_SUB_TAGWORDS.has(p)) sub = p; }
  if (!sub) { const tail = s.slice(owner.length).replace(/\([^)]*\)/g, '').trim(); const bm = tail.match(/([가-힣]{2,4})\s*$/); if (bm && bm[1] !== owner && !_SUB_TAGWORDS.has(bm[1])) sub = bm[1]; }
  return { owner, sub };
}

// ★대바 복구 — 검증된 '명단 전용' 재판독으로 마젠타 '주인(태그)대체자'/'주인(대체자)' 셀을 순번별로 덧씌운다.
//  홀리스틱/부 프롬프트가 무거워 대체자를 정규화로 버리므로(실증 8/11), 명단만 얇게 다시 읽어 '주인이 일치하는
//  자리'에만 오버레이한다 → 구조(순번·주인)는 절대 안 바꾸고 대바만 추가(안전). 캡 초과·실패면 원본 그대로.
async function recoverSubstitutes(imagePath, names) {
  try {
    if (!imagePath || claudeBudgetLeft() <= 0) return names;
    const vb = await readRosterVerbatim(imagePath);
    if (!vb || !vb.length) return names;
    const out = names.slice();
    let n = 0;
    for (const it of vb) {
      const pos = Number(it.pos) || 0; if (pos < 1 || pos > out.length) continue;
      const vbRaw = String(it.name || '').trim();
      const hol = String(out[pos - 1] || '').trim();
      if (!hol) continue;                                    // 홀리스틱이 안 읽은 자리는 안 건드림(구조 보존)
      const { owner, sub } = _ownerSubOf(vbRaw);
      if (!sub) continue;                                    // verbatim에도 대체자 없으면 스킵
      const holOwner = (hol.match(/^([가-힣]{2,4})/) || [])[1] || '';
      if (owner && holOwner && owner === holOwner && vbRaw !== hol) { out[pos - 1] = vbRaw; n += 1; }
    }
    if (n) console.log(`[boardreader] 대바 복구: ${n}건 오버레이(명단 전용 재판독)`);
    return out;
  } catch (e) { console.error('[boardreader] 대바 복구 오류:', e.message); return names; }
}

// ★성(姓) 복원 — 부 크롭 좌변 클립으로 성 글자가 잘려 '이름 2글자'만 읽힌 셀을, 정본 명단에서
//  '끝 2글자(=이름)가 유일하게 일치하는' 3글자 full-name으로 복원한다(서동환→'동환'류 오독 교정).
//  유일할 때만 복원(서동명/서동환 같은 애매는 그대로) → 잘못된 성 복원 방지. confirmedCaddies=정본 스냅 기준 명단.
export function restoreSurname(bare) {
  const s = String(bare || '').replace(/\s/g, '');
  if (!/^[가-힣]{2}$/.test(s)) return null;
  const hits = [...new Set(confirmedCaddies().filter((n) => /^[가-힣]{3}$/.test(n) && n.slice(1) === s))];
  return hits.length === 1 ? hits[0] : null;
}

export function snapRoster(roster) {
  // ★중복 생성 방지 — 이미 명단에 '정본명 그대로' 있는 이름으로는 스냅하지 않는다.
  //  (예: 남재권이 정본 누락이라 편집거리2로 '최재영'에 스냅되려 하지만, 최재영이 이미 다른 순번에 있으면
  //   그건 오독교정이 아니라 서로 다른 사람을 한 명으로 뭉개는 오스냅 → 원문 유지.) 실제 캐디 누락에 견고.
  const CONF = new Set(confirmedCaddies());
  const present = new Set();
  for (const cell of (roster || [])) { const nm = _bareNameOf(cell); if (nm && CONF.has(nm)) present.add(nm); }
  const snap1 = (x) => {
    const y = snapOfficial(x);
    if (y !== x && present.has(y) && !CONF.has(String(x).trim())) return String(x).trim();  // 이미 있는 정본명으로 스냅 = 중복 → 원문 유지
    // ★성 복원 — 스냅 후에도 2글자(성 흘림)면 정본 유일완성 시도(동환→서동환). 이미 있는 이름으론 복원 안 함(중복 방지).
    if (!CONF.has(y)) { const r = restoreSurname(y); if (r && !present.has(r)) { present.add(r); return r; } }
    return y;
  };
  return (roster || []).map((cell) => {
    const s = String(cell || '').trim();
    const m = s.match(/^(.+?)\(([^)]+)\)\s*$/);
    if (m) return `${snap1(m[1].trim())}(${m[2].trim()})`;   // 태그(54·조출 등)는 스냅 안 함
    return snap1(s) || s;
  });
}

// 이름처럼 보이는가(2~4 한글, 괄호태그 허용) — 열분할에서 티오프 열 오검출을 거른다.
const _looksName = (nm) => /^[가-힣]{2,4}$/.test(String(nm || '').replace(/\([^)]*\).*/, '').replace(/\s/g, ''));

// ★티오프 충돌 시각 — 한 시각에 3명↑ 또는 같은 코스(OUT/IN) 중복 = 순번↔시각 사다리 밀림. 충돌 시각 문자열 배열.
//  (boardReadFault의 티오프 규칙과 동일. 밀림 자가교정 트리거·해소판정 공용.)
function _teeConflicts(tees) {
  const byTime = {};
  for (const t of (tees || [])) {
    const m = String((t && t.time) || '').match(/\d{1,2}:\d{2}/); if (!m) continue;
    (byTime[m[0]] = byTime[m[0]] || []).push(String((t && t.course) || '').toUpperCase());
  }
  const bad = [];
  for (const tm in byTime) {
    const arr = byTime[tm];
    if (arr.length > 2 || arr.filter((c) => /IN/.test(c)).length > 1 || arr.filter((c) => /OUT/.test(c)).length > 1) bad.push(tm);
  }
  return bad;
}

// ★열분할 채택 가드 — 열분할 결과(cand)가 기존 판독(base)과 '같은 순서'인지(겹치는 자리 접두 일치율).
//  한 행 밀림/드롭으로 어긋났거나, 옆 부를 흡수해 이름이 통째로 다르면 낮은 일치율 → 채택 거부(유령 방지).
//  base의 채워진 앞자리들을 cand 같은 index와 대조. 표본이 적으면(<3) 신뢰 못해 거부.
function _prefixAgrees(cand, base) {
  let checked = 0, matched = 0;
  const n = Math.min((cand || []).length, (base || []).length);
  for (let i = 0; i < n; i++) {
    const b = _bare(base[i]); if (!b) continue;
    checked += 1;
    if (_bare(cand[i]) === b) matched += 1;
  }
  return checked >= 3 && (matched / checked) >= 0.85;
}

// ★열분할 판독 — 밀집 다열 명단은 열별로 따로 크롭해 '단일열'로 읽어야 하단·정렬이 정확(2부 50명).
//  rosterCols(크롭 fraction) → 원본 fraction 역매핑 → 각 열 단일 크롭 판독 → 열 순서로 이어붙여 위치정렬.
async function readColumnsAssemble(img, rosterCols, cropX0, cropX1, y1, part) {
  const cw = cropX1 - cropX0;
  // ★Claude의 열 x경계(특히 오른쪽 x1)가 과소추정돼 3글자 이름 끝글자가 잘린다(송승은→송승).
  //  좌표를 곧이곧대로 믿지 말고 '최소 폭 보장'(순번+3글자 이름 ≈ 0.075)으로 넓힌다.
  const cols = rosterCols
    .map((rc) => ({ x0: Math.max(0, cropX0 + rc.x0 * cw - 0.008), x1: cropX0 + rc.x1 * cw }))
    .filter((c) => c.x1 > c.x0)
    .sort((a, b) => a.x0 - b.x0);
  // ★최소 폭 보장하되 오른쪽 확장을 '부 경계(cropX1)'로 클램프 — 넓힘이 부 경계를 넘어 옆 부 명단을 흡수해
  //  유령 스페어를 만들던 근본 버그 차단(실측: 부1 crop 0~0.240인데 열이 0.283=2부 침범 → 41명 과대판독).
  for (const c of cols) c.x1 = Math.min(cropX1, Math.max(c.x1 + 0.02, c.x0 + 0.075));   // 최소 폭 + 부경계 클램프
  // 넓힌 오른쪽이 '다음 열'을 물면 그 열 첫 이름을 중복 판독 → 다음 열 시작 직전까지로 제한(마지막 열은 여유 유지).
  for (let i = 0; i < cols.length - 1; i++) cols[i].x1 = Math.min(cols[i].x1, cols[i + 1].x0 - 0.003);
  const _cols2 = cols.filter((c) => c.x1 - c.x0 >= 0.02);   // 클램프로 뭉개진(부경계 밖에서 시작한) 헛열 제거
  cols.length = 0; cols.push(..._cols2);
  console.log(`[boardreader] 부${part} 열크롭(crop ${cropX0.toFixed(3)}~${cropX1.toFixed(3)}): ${cols.map((c) => `${c.x0.toFixed(3)}~${c.x1.toFixed(3)}`).join(' | ')}`);
  // ★열 병렬(Promise.all) — 열은 서로 독립이라 동시 판독으로 속도↑. Promise.all이 열 순서(정렬됨)를 보존해 위치정렬 유지.
  //  (부 3개는 순차 유지 — 무거운 부 판독 동시 발사는 429/명단 빈값 위험. 열 단위는 가벼워 병렬 안전.)
  const perCol = await Promise.all(cols.map(async (c, k) => {
    const colPath = path.join(TMP, `col_${part}_${Date.now()}_${k}.png`);
    try {
      await runPy({ image: img, crop_only: colPath, slice: { x0: c.x0, x1: c.x1, y1, lmargin: 0, margin: 0 }, scale: 6 }, 30000);
      const rows = await readColumnRoster(colPath);
      try { fs.unlinkSync(colPath); } catch { /* noop */ }
      if (!rows || !rows.length) return [];
      const valid = rows.filter((r) => _looksName(r.name));
      return valid.length >= 2 ? valid.map((r) => r.name) : [];   // 명단 열 아님(티오프 등)이면 빈 배열
    } catch (e) { console.error(`[boardreader] 부${part} 열${k} 오류:`, e.message); return []; }
  }));
  const names = perCol.flat();   // 열 순서 유지(위→아래 누적 순서 그대로)
  return names.length ? names : null;
}

// ★조편성표 열분할 근태 판독 — 조별로 단일 크롭해 이름·근태를 안정적으로(통짜 크롭의 이름 뭉갬 해결: 박시윤→박신훈 방지).
//  흐름: 크루영역 크롭 → Claude가 조 x경계 검출 → 각 조 원본 fraction 역매핑(★좌측 여유로 첫 글자 잘림 방지) → 단일 조 판독.
//  반환 [{name,reason}](스냅 전) 또는 null(조 경계 판독 실패 → 호출부가 통짜 폴백).
const OFF_REASON_RE = /병가|휴가|연차|반차|월차|격리|휴무/;
async function readOffByColumns(img) {
  const crewPath = path.join(TMP, `crew_${Date.now()}.png`);
  let meta;
  try { meta = await runPy({ image: img, crop_only: crewPath, slice: { x0: 0.64, x1: 1.0, y1: 0.92, lmargin: 0 }, scale: 3 }, 45000); }
  catch { return null; }
  let cols = null;
  try { cols = await getCrewColumns(crewPath); } catch { /* noop */ }
  try { fs.unlinkSync(crewPath); } catch { /* noop */ }
  const cx0 = Number(meta?.x0), cx1 = Number(meta?.x1), cy1 = Number(meta?.y1) || 0.92;
  if (!cols || !cols.length || !Number.isFinite(cx0) || !(cx1 > cx0)) return null;   // 조 경계 실패 → 통짜 폴백
  const cw = cx1 - cx0;
  // 크루크롭 fraction → 원본 fraction. 조 경계는 다음 조 시작 직전까지로 클램프(중복 방지).
  const cols2 = cols
    .map((c) => ({ x0: cx0 + c.x0 * cw, x1: cx0 + c.x1 * cw }))
    .filter((c) => c.x1 > c.x0).sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < cols2.length - 1; i++) cols2[i].x1 = Math.min(cols2[i].x1, cols2[i + 1].x0 - 0.002);
  console.log(`[boardreader] 조편성 열분할 ${cols2.length}조: ${cols2.map((c) => `${c.x0.toFixed(3)}~${c.x1.toFixed(3)}`).join(' | ')}`);
  // ★조 병렬(Promise.all) — 조는 서로 독립이라 동시 판독으로 속도 회복(조 열분할이 더한 지연 상쇄).
  const perJo = await Promise.all(cols2.map(async (c, k) => {
    const colPath = path.join(TMP, `crewcol_${Date.now()}_${k}.png`);
    const off = []; const crew = [];
    try {
      // ★lmargin 0.01 — 조 왼쪽 이름 첫 글자 잘림 방지(jo4 실측: 천→변·전→변 좌측 잘림). 오른쪽은 카트열까지라 여유 충분.
      await runPy({ image: img, crop_only: colPath, slice: { x0: c.x0, x1: c.x1, y1: cy1, lmargin: 0.01, margin: 0 }, scale: 8 }, 30000);
      const rows = await readCrewColumn(colPath);
      try { fs.unlinkSync(colPath); } catch { /* noop */ }
      for (const r of (rows || [])) {
        if (!r.name) continue;
        crew.push({ name: r.name, duty: String(r.duty || '') });            // 전원(근무·근태) 수집 — 애매이름 티브레이크용
        const m = OFF_REASON_RE.exec(String(r.duty || ''));
        if (m) off.push({ name: r.name, reason: m[0] });
      }
    } catch (e) { console.error(`[boardreader] 조${k} 근태 오류:`, e.message); }
    return { off, crew };
  }));
  return { off: perJo.flatMap((x) => x.off), crew: perJo.flatMap((x) => x.crew) };
}

// 한 세트의 경계로 부별 크롭+판독 1회. { '1':{roster,tee,cut,x0,x1}, ... }.
async function readPartsOnce(img, sorted, cuts) {
  const parts = {};
  // ★부3(현재 회원 전원의 부)를 '먼저' 판독 — 예산(캡)이 모자라도 우리 회원 부는 절대 굶지 않게.
  //  경계(x1)는 여전히 x0정렬 이웃으로 계산하므로 크롭 정확도는 그대로. 순서만 3부 우선.
  const order = sorted.map((_, i) => i).sort((a, b) => {
    const ra = String(sorted[a].part) === '3' ? 0 : 1;
    const rb = String(sorted[b].part) === '3' ? 0 : 1;
    return ra - rb || a - b;
  });
  for (const i of order) {
    const b = sorted[i];
    try {
      // ★가운데 부는 '다음 부 경계'까지만(번짐 방지). 마지막 부만 우측 여유(margin)로 티오프 안 잘리게.
      const next = sorted[i + 1];
      const x1 = next ? next.x0 : b.x1;
      const margin = next ? 0.0 : 0.05;
      const cropPath = path.join(TMP, `part_${b.part}_${Date.now()}_${i}.png`);
      // ★y1=0.73 — 명단 세로 전체 포착(공지영역 위까지). crop_only가 실제 사용 경계(x0/x1/y1)를 함께 반환.
      const meta = await runPy({ image: img, crop_only: cropPath, slice: { x0: b.x0, x1, margin, y1: 0.73 }, scale: 6 }, 30000);
      // ★3부 홀리스틱 우선(토글) — 명단·티오프를 이 크롭에서 '한 번에' 대응 판독(순번↔시각 어긋남 원천 차단).
      //  부실(명단 심각부족)하면 아래 기존 분할 판독으로 폴백. 티오프 배열은 verdictFromPart이 그대로 소비.
      if (String(b.part) === '3' && useHolisticP3()) {
        // ★홀리스틱 전용 크롭 — 티오프표 '전체 세로'(하단 18:45까지)가 필요하다. y1:0.73(공지영역 배제용)로
        //  자르면 그리드 하단 티오프가 통째로 잘려, 무거운 scale6 업스케일과 겹쳐 판독기가 timeout/null →
        //  분할판독(하단 누락 18개)으로 '조용히' 폴백하던 근원(8/5 #26994 사고). 전체높이+가벼운 업스케일로 읽는다.
        //  (실증: 원본 전체이미지 홀리스틱 = 티오프 25개 정확·빠름 / y1:0.73·scale6 = 타임아웃.)
        const holPath = path.join(TMP, `part3hol_${b.part}_${Date.now()}_${i}.png`);
        let holReady = false;
        try { await runPy({ image: img, crop_only: holPath, slice: { x0: b.x0, x1, margin, y1: 0.98 }, scale: 3 }, 30000); holReady = true; }
        catch (e) { console.error('[boardreader] 홀리스틱 크롭 오류 → 기본 크롭 사용:', e.message); }
        const holImg = holReady ? holPath : cropPath;
        try {
          let h = await readPart3Holistic(holImg);
          if (h && Array.isArray(h.roster) && h.roster.length) {
            const maxPos = h.roster.reduce((mx, x) => Math.max(mx, x.pos), 0);
            let names = new Array(maxPos).fill('');
            h.roster.forEach((x) => { if (x.pos >= 1 && x.pos <= maxPos) names[x.pos - 1] = x.name; });
            let filled = names.filter(Boolean).length;
            const firstSpare = h.roster.filter((x) => x.spare).reduce((mn, x) => Math.min(mn, x.pos), Infinity);
            let gridMax = (h.tees || []).reduce((mx, t) => Math.max(mx, Number(t.pos) || 0), 0);
            const cut = Number(cuts[b.part]) || (Number.isFinite(firstSpare) ? firstSpare - 1 : 0) || gridMax || 0;
            // ★티오프 누락 자가검증(근원 재발차단) — 컷 이내인데 티가 빈 순번(중간 구멍 or 하단 누락)을
            //  콕 집어 1회 재판독. 하단누락(8/5: 21~25 통째누락)·중간구멍(8/6: 18:10 OUT 정용만 단독행 흘림) 모두 커버.
            //  재판독은 '구멍만 채움'(기존 값은 안 덮음) → 오판독으로 나빠질 일 없음. 재판독에도 빈 자리는
            //  원본이 진짜 빈 것(작성자 미매칭: 신지현·홍아름)으로 확정. ※코스 오독(있는 티의 IN/OUT 뒤바뀜)은 별개.
            if (cut > 0 && claudeBudgetLeft() > 0) {
              const have = new Set((h.tees || []).map((t) => Number(t.pos)));
              const gaps = []; for (let p = 1; p <= cut; p++) if (!have.has(p)) gaps.push(p);
              if (gaps.length) {
                console.log(`[boardreader] 3부 티오프 누락 감지(컷 이내 티없음 ${gaps.join(',')}) → 집중 재판독`);
                try {
                  const h2 = await readPart3Holistic(holImg, { gapPositions: gaps, tailRetry: gridMax < cut });
                  if (h2 && Array.isArray(h2.tees) && h2.tees.length) {
                    const byPos = new Map((h.tees || []).map((t) => [t.pos, t]));
                    let rec = 0;
                    for (const t of h2.tees) if (Number(t.pos) > 0 && t.time && !byPos.has(Number(t.pos))) { byPos.set(Number(t.pos), t); rec += 1; }
                    h = { ...h, tees: [...byPos.values()].sort((a, z) => a.pos - z.pos) };
                    gridMax = h.tees.reduce((mx, t) => Math.max(mx, Number(t.pos) || 0), 0);
                    const now = new Set(h.tees.map((t) => Number(t.pos)));
                    const still = []; for (let p = 1; p <= cut; p += 1) if (!now.has(p)) still.push(p);
                    console.log(`[boardreader] 집중 재판독: ${rec}개 복구, 잔여 티없음 ${still.join(',') || '없음'}(원본이 진짜 빈 자리)`);
                  }
                } catch (e) { console.error('[boardreader] 집중 재판독 오류:', e.message); }
              }
            }
            // ★티오프 사다리 밀림 자가교정 — 한 시각 3명↑/코스중복(순번↔시각 어긋남)이면 티오프만 재판독하되
            //  '충돌이 완전히 해소되고 티 수가 줄지 않을 때만' 채택 → 절대 나빠지지 않음(안 되면 원본 유지).
            //  이게 해소하면 boardReadFault도 안 울려 전체 재시도(비쌈)를 아낀다. 코스 뒤바뀜(있는 티 IN↔OUT)까지 커버.
            if (claudeBudgetLeft() > 0) {
              const conf = _teeConflicts(h.tees);
              if (conf.length) {
                console.log(`[boardreader] 3부 티오프 밀림 감지(${conf.join(',')}) → 티오프 재판독`);
                try {
                  const h3 = await readPart3Holistic(holImg, { conflictTimes: conf });
                  const h3t = (h3 && Array.isArray(h3.tees)) ? h3.tees : [];
                  if (h3t.length && !_teeConflicts(h3t).length && h3t.length >= (h.tees || []).length) {
                    h = { ...h, tees: h3t.slice().sort((a, z) => (Number(a.pos) || 0) - (Number(z.pos) || 0)) };
                    gridMax = h.tees.reduce((mx, t) => Math.max(mx, Number(t.pos) || 0), 0);
                    console.log(`[boardreader] 티오프 재판독 채택(충돌 해소, ${h.tees.length}개)`);
                  } else {
                    console.log('[boardreader] 티오프 재판독 미채택(충돌 잔존/티 감소 — 원본 유지)');
                  }
                } catch (e) { console.error('[boardreader] 티오프 재판독 오류:', e.message); }
              }
            }
            // ★명단 완전성 보완 — 홀리스틱이 순번명단 '2번째 서브컬럼(뒤 스페어)'을 통째 놓치는 경우가 있다
            //  (8/7: 왼쪽 1~20 + 오른쪽 첫줄 21만 읽고 22~35 유실). 열분할로 전체 명단을 다시 읽어 '더 완전하면'
            //  명단만 교체한다(티오프는 홀리스틱 값 유지). 열분할은 서브컬럼을 좌→우로 이어붙여 순번 순서 보존.
            try {
              if (claudeBudgetLeft() > 0 && cut > 0 && filled <= cut + 3) {   // 스페어가 거의 안 읽힘 = 뒤 서브컬럼 유실 의심일 때만
                const rc = await getRosterColumns(holImg);
                if (rc && rc.length) {
                  const colR = await readColumnsAssemble(img, rc, b.x0, x1, 0.98, b.part);
                  // ★채택 가드 강화 — 첫 이름만이 아니라 겹치는 앞자리가 홀리스틱과 '접두 일치'할 때만 채택
                  //  (밀림/옆부 침범 판독 배제). 유실이 진짜면 앞자리는 그대로라 접두 일치하며 뒤만 늘어난다.
                  if (colR && colR.length > filled && colR.length <= 60 && _prefixAgrees(colR, names)) {
                    console.log(`[boardreader] 3부 명단 열분할 보완: ${filled}→${colR.length}명(뒤 스페어 복구)`);
                    names = colR.slice(); filled = names.filter(Boolean).length;
                  }
                }
              }
            } catch (e) { console.error('[boardreader] 3부 명단 열분할 보완 오류:', e.message); }
            // ★대바 복구 — 무거운 홀리스틱이 버린 마젠타 '주인(태그)대체자' 셀을 명단전용 재판독으로 순번별 오버레이.
            names = await recoverSubstitutes(holImg, names);
            // 사니티: 컷 대비 명단 심각부족이면 채택 안 함(폴백). 인턴 여유(_rosterFloor) 재사용.
            if (filled >= _rosterFloor(cut || filled)) {
              try { fs.unlinkSync(cropPath); } catch { /* noop */ }
              try { if (holReady) fs.unlinkSync(holPath); } catch { /* noop */ }
              parts[String(b.part)] = { roster: snapRoster(names), tee: h.tees, cut, x0: b.x0, x1: b.x1 };
              console.log(`[boardreader] 3부 홀리스틱 채택: 명단${filled}·티${(h.tees || []).length}·컷${cut}(스페어첫 ${Number.isFinite(firstSpare) ? firstSpare : '-'})`);
              // ★재판독 후에도 티오프가 컷보다 짧으면 이상 기록 — 감시 클로드·모니터가 잡아 사람이 정정하도록(무음 통과 금지).
              if (cut > 0 && gridMax < cut) {
                appendJSONL('dayboard-anomaly.jsonl', { at: Date.now(), kind: 'grid_short', part: 3, teeMax: gridMax, cut, articleHint: '3부 홀리스틱', note: '티오프 하단 누락 — 꼬리 재판독 후에도 컷 미달(사람 확인 필요)' });
              }
              continue;
            }
            console.log(`[boardreader] 3부 홀리스틱 부실(명단${filled}<floor ${_rosterFloor(cut || filled)}) → 분할판독 폴백`);
          }
        } catch (e) { console.error('[boardreader] 3부 홀리스틱 오류 → 폴백:', e.message); }
        try { if (holReady) fs.unlinkSync(holPath); } catch { /* noop */ }
      }
      const r = await readPartWithClaude(cropPath);
      // ★열 경계 — part 판독의 rosterCols가 있으면 쓰고, 없으면(들쭉날쭉) 전용 호출로 확실히 잡는다.
      let rcols = (r && Array.isArray(r.rosterCols) && r.rosterCols.length) ? r.rosterCols : null;
      if (!rcols) { try { rcols = await getRosterColumns(cropPath); } catch { /* noop */ } }
      if (!r) { try { fs.unlinkSync(cropPath); } catch { /* noop */ } continue; }
      const cut = Number(cuts[b.part]) || r.cut || 0;   // 요약숫자 우선(더 신뢰), 없으면 per-part cut
      // ★열분할: 판독한 열 경계로 각 열을 단일 크롭 재판독 → 더 완전하면 채택(2부 다열 하단 누락·밀림 해결).
      let roster = r.roster;
      const cx0 = Number(meta?.x0), cx1 = Number(meta?.x1), cy1 = Number(meta?.y1) || 0.73;
      if (rcols && rcols.length && Number.isFinite(cx0) && Number.isFinite(cx1) && cx1 > cx0) {
        const colRoster = await readColumnsAssemble(img, rcols, cx0, cx1, cy1, b.part);
        const base = r.roster.filter(Boolean).length;
        // ★접두 일치 가드 — 단일판독과 앞자리가 어긋나면(밀림·옆부 침범) 채택 거부(유령/과대판독 방지).
        if (colRoster && colRoster.length >= base && colRoster.length <= 60 && _prefixAgrees(colRoster, r.roster)) {
          console.log(`[boardreader] 부${b.part} 열분할 채택: ${colRoster.length}명(${rcols.length}열, 단일 대비 +${colRoster.length - base})`);
          roster = colRoster;
        }
      }
      // ★대바 복구 — 부 프롬프트가 버린 마젠타 '주인(태그)대체자' 셀을 명단전용 재판독으로 순번별 오버레이.
      roster = await recoverSubstitutes(cropPath, roster);
      try { fs.unlinkSync(cropPath); } catch { /* noop */ }
      parts[String(b.part)] = { roster: snapRoster(roster), tee: r.tee, cut, x0: b.x0, x1: b.x1 };
    } catch (e) { console.error(`[boardreader] 부 ${b.part} 오류:`, e.message); }
  }
  return parts;
}

// 명단 심각부족 판정 floor — 인턴(노란칸=순번 없는 팀)이 있으면 정규명단 < 커트가 정상이라 여유(−4·60%)를 둔다.
//  경계로 순번열이 통째 누락된 '심각' 부족(예: 커트16에 명단9)만 잡고, 인턴발 1~3 부족은 통과.
const _rosterFloor = (cut) => Math.max(cut - 4, Math.ceil(cut * 0.6));

// 판독 불량 판정 — 경계 흔들림으로 순번열이 통째 누락돼 '명단 심각부족'일 때.
//  ★부 머리 중복은 불량 신호가 아니다: (54)·(1,3) 교차근무 캐디는 1부·3부 명단 머리에 '정상적으로' 함께 뜬다.
//   그래서 '명단 < 커트'(근무자 누락)라는 건전한 불변식만 본다. 붕괴로 한 부가 반쪽만 읽히면 그 부가 커트 미달로 걸린다.
function boardReadFault(parts, cuts) {
  const keys = Object.keys(parts);
  for (const p of keys) {
    const cut = Number(cuts[p]) || Number(parts[p].cut) || 0;
    const rl = (parts[p].roster || []).filter(Boolean).length;
    const floor = _rosterFloor(cut);
    if (cut > 0 && rl < floor) return `${p}부 명단 심각부족(${rl} < ${floor}, 커트 ${cut}) — 순번열 누락`;
    // ★티오프 구조 위반(김홍구님 규칙: 한 시각 = OUT·IN 최대 2명). 3명↑ 또는 같은 코스 중복 = 사다리 밀림 오판독 → 재시도.
    const tees = parts[p].tee || parts[p].tees || [];
    const byTime = {};
    for (const t of tees) { const m = String((t && t.time) || '').match(/\d{1,2}:\d{2}/); if (!m) continue; (byTime[m[0]] = byTime[m[0]] || []).push(t); }
    for (const tm in byTime) {
      const arr = byTime[tm];
      if (arr.length > 2) return `${p}부 티오프 ${tm}에 ${arr.length}명 — 한 시각 최대 2명 위반(사다리 밀림)`;
      if (arr.filter((t) => /IN/i.test(String(t.course))).length > 1) return `${p}부 티오프 ${tm} IN 코스 중복 — 판독 어긋남`;
      if (arr.filter((t) => /OUT/i.test(String(t.course))).length > 1) return `${p}부 티오프 ${tm} OUT 코스 중복 — 판독 어긋남`;
    }
  }
  return '';
}

// ── 부 간 앞순번 교차보정 (근본: 유령 이름 제거) ──
//  리버힐 규칙(김홍구님): 54·1,3·2,3 중복근무자는 각 부의 '앞 순번'을 '같은 순서'로 차지한다(대바 없으면).
//  → 1부·3부의 (1,3)·54 워커, 2부·3부의 (2,3)·54 워커는 이름·순서가 동일해야 한다. 한쪽이 정본 이름,
//    다른쪽이 정본에 없는 유령이면 확인된 쪽으로 보정(예: 3부 '하유린'(유령) → 1부에서 확인된 '정유경').
const _bare = (c) => String(c || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim();
const _tag = (c) => { const m = String(c || '').match(/\(([^)]*)\)/); return m ? m[1].replace(/\s/g, '') : ''; };
function _sharesParts(tag, a, b) {
  if (/54/.test(tag)) return true;                                   // 54 = 전 부 근무
  const nums = tag.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  return nums.includes(a) && nums.includes(b);
}
export function reconcileCrossPart(parts, known) {
  try {
    const CONF = new Set((known || []).map(_bare));
    const isConf = (c) => CONF.has(_bare(c));
    for (const [a, b] of [['1', '3'], ['2', '3']]) {
      if (!parts[a] || !parts[b]) continue;
      const listA = (parts[a].roster || []).map((c, i) => ({ c, i })).filter((x) => x.c && _sharesParts(_tag(x.c), a, b));
      const listB = (parts[b].roster || []).map((c, i) => ({ c, i })).filter((x) => x.c && _sharesParts(_tag(x.c), a, b));
      const n = Math.min(listA.length, listB.length);
      for (let k = 0; k < n; k++) {
        const A = listA[k], B = listB[k];
        if (_bare(A.c) === _bare(B.c)) continue;                     // 이름 일치 → OK
        const okA = isConf(A.c), okB = isConf(B.c);
        if (okA && !okB) { console.log(`[교차보정] ${b}부 순번${B.i + 1} '${B.c}'(유령)→'${A.c}'(${a}부 확인)`); parts[b].roster[B.i] = A.c; }
        else if (okB && !okA) { console.log(`[교차보정] ${a}부 순번${A.i + 1} '${A.c}'(유령)→'${B.c}'(${b}부 확인)`); parts[a].roster[A.i] = B.c; }
        // 둘 다 정본(대바 가능) 또는 둘 다 유령(복구불가) → 손대지 않음
      }
    }
  } catch (e) { console.error('[교차보정 오류]', e.message); }
  return parts;
}

// ── 교차 오염 제거 (근본: 옆 부 명단이 크롭 번짐으로 이 부에 통째 유입되는 사고 차단) ──
//  2026-08-13 실사고: 부3.x0 경계가 3부 로스터 안쪽으로 밀려 '2부 크롭'이 3부 명단을 흡수 → 2부에 3부 전용
//  캐디(서동환·박준서·장성원…)가 유입, 회원에 유령 2부 대기가 붙음. reconcile은 '태그 교차근무자'만 봐서 못 잡음.
//  규칙(안전): 태그(54·1,3·2,3)는 정당한 전부/교차 근무라 절대 안 건드림. '태그 없이' 3부와 겹치는 이름 =
//   단일부 캐디가 두 부에 중복 = 번짐. 회원 부(3부)는 절대 안 지우고 마이너 부(1·2)에서만 제거한다.
//   3개 이상 겹칠 때만(우연 동명 1~2건 오제거 방지). 어디든 교차태그로 등장하는 이름은 정당 교차라 보존.
export function purgeCrossPartContamination(parts) {
  try {
    const p3 = parts && parts['3']; if (!p3 || !Array.isArray(p3.roster)) return parts;
    const CROSS_TAG = /(^|[^0-9])(54|1[,、]3|2[,、]3)([^0-9]|$)/;
    const crossTagged = new Set();                       // 어느 부에서든 교차태그로 등장 = 정당 교차근무자(보존)
    for (const p of ['1', '2', '3']) for (const c of ((parts[p] && parts[p].roster) || [])) {
      if (CROSS_TAG.test(_tag(c))) { const b = _bare(c); if (b) crossTagged.add(b); }
    }
    const p3untag = new Set();                            // 3부의 '태그 없는' 이름 = 3부 전용 캐디(옆 부에 있으면 번짐)
    for (const c of p3.roster) { if (_tag(c)) continue; const b = _bare(c); if (b) p3untag.add(b); }
    for (const a of ['1', '2']) {
      const pa = parts[a]; if (!pa || !Array.isArray(pa.roster)) continue;
      const hits = [];
      for (let i = 0; i < pa.roster.length; i++) {
        const c = pa.roster[i]; if (!c || _tag(c)) continue;          // 태그 있는 셀 보존
        const b = _bare(c); if (!b || crossTagged.has(b)) continue;   // 정당 교차근무자 보존
        if (p3untag.has(b)) hits.push({ i, b });
      }
      if (hits.length >= 3) {
        for (const h of hits) pa.roster[h.i] = '';
        pa._contaminated = true;
        const detail = hits.map((h) => `순번${h.i + 1} ${h.b}`);
        console.warn(`[boardreader] ★교차오염 정리: ${a}부에서 3부 전용 이름 ${hits.length}개 제거(크롭 번짐) — ${detail.slice(0, 12).join(', ')}`);
        try { appendJSONL('dayboard-anomaly.jsonl', { at: Date.now(), kind: 'cross_part_contamination', part: Number(a), purged: hits.length, names: detail, note: '옆 부(3부) 명단이 크롭 번짐으로 이 부에 유입 → 제거. 부 명단 불완전할 수 있어 관리자 검수 권장.' }); } catch { /* noop */ }
      }
    }
  } catch (e) { console.error('[교차오염 정리 오류]', e.message); }
  return parts;
}

// 조편성 근무칸이 '근무'인가(근태 아님) — 애매이름 티브레이크의 '오늘 근무자' 판정.
const _WORK_DUTY_RE = /1부|2부|3부|1,3|2,3|54|조출|찾근|정출|선발|당번|배치|마감|대리|주임|마샬|프리|콜|정근/;

// ★애매 오독 티브레이크 — 스냅이 '유일하지 않다'며 포기한 순번 이름을, '오늘 근무자'에 유일하게 있는
//  정본 근접후보로 확정(이수련↔이수현/이승현/박수현). 안전: 평범한 2~4한글 셀만·정본 아님·후보 근무자 유일·중복금지.
//  대바/태그 복합 셀·이미 정본 이름은 절대 안 건드림(officialNearCandidates가 정본이면 [] 반환).
function disambiguateByWorking(parts, workingSet) {
  if (!workingSet || !workingSet.size) return;
  for (const p of Object.keys(parts)) {
    const roster = parts[p].roster || [];
    const present = new Set(roster.map(_bare).filter(Boolean));
    for (let i = 0; i < roster.length; i++) {
      const cell = String(roster[i] || ''); if (!cell) continue;
      const bare = _bare(cell); if (!/^[가-힣]{2,4}$/.test(bare)) continue;   // 평범한 단일이름 셀만
      const cands = officialNearCandidates(bare);
      if (cands.length < 2) continue;                                        // 애매(2개↑)한 것만 — 유일이면 스냅이 이미 처리
      const hit = cands.filter((c) => workingSet.has(c) && !present.has(c));
      if (hit.length === 1) {
        const tag = _tag(cell);
        const repl = tag ? `${hit[0]}(${tag})` : hit[0];
        console.log(`[boardreader] 애매이름 티브레이크: ${p}부 순번${i + 1} '${cell}'→'${repl}'(근무자 유일)`);
        roster[i] = repl; present.add(hit[0]);
      }
    }
  }
}

// ── 합본 배치표: Claude 경계 → 부별 크롭 → Claude 부 판독. 경계 흔들림 대비 검증+재시도(최대 3회). ──
//  반환 { boundaries, parts: { '1': {roster,tee,cut}, ... }, _claudeCalls }
export async function readBoardByClaude(imageOrUrl, { known = confirmedCaddies(), summaryCuts = {}, maxTries = 3 } = {}) {
  const img = await ensureLocal(imageOrUrl);
  if (!img) return null;
  const startBudget = claudeBudgetLeft();
  let cuts = { ...summaryCuts };
  let best = null, bestBounds = null, bestScore = -1, lastFault = '';
  for (let attempt = 0; attempt < maxTries; attempt++) {
    if (claudeBudgetLeft() <= 0) break;
    const toBefore = claudeTimeouts();
    const bounds = await getPartBoundaries(img);
    if (!bounds || !bounds.length) continue;
    const sorted = bounds.slice().sort((a, b) => a.x0 - b.x0);
    // ★커트(근무/스페어 선) 확정 = 상단 요약 팀수("3부 16"). per-part 티오프 판독은 ±2 흔들려(14~16) 커트로 부적합.
    //  요약은 큰 인쇄 숫자라 안정적. 합본에만 있음. 첫 시도에서 1회만 판독해 재사용.
    if (!Object.keys(cuts).length && sorted.length >= 2) {
      try {
        const sumPath = path.join(TMP, `sum_${Date.now()}.png`);
        await runPy({ image: img, crop_only: sumPath, slice: { x0: 0.55, x1: 0.90, y1: 0.06, lmargin: 0 }, scale: 6 }, 30000);
        const sc = await readSummaryCounts(sumPath);
        try { fs.unlinkSync(sumPath); } catch { /* noop */ }
        if (sc) { cuts = sc; console.log(`[boardreader] 요약 커트 확정: ${Object.entries(sc).map(([p, n]) => `${p}부 ${n}`).join(', ')}`); }
      } catch (e) { console.error('[boardreader] 요약 판독 실패:', e.message); }
    }
    const parts = await readPartsOnce(img, sorted, cuts);
    const fault = boardReadFault(parts, cuts);
    if (!fault) { best = parts; bestBounds = bounds; lastFault = ''; break; }   // 깨끗 → 채택
    lastFault = fault;
    const score = Object.values(parts).reduce((s, p) => s + (p.roster || []).filter(Boolean).length, 0);
    if (score > bestScore) { best = parts; bestBounds = bounds; bestScore = score; }   // 불량이어도 가장 완전한 판독 보관
    // ★타임아웃 재시도 완화 — 이번 시도에 Claude 타임아웃이 있었으면 풀 재시도 중단. 느린 상태에선 재시도(≈6콜)가
    //  예산·시간만 태우고 또 타임아웃날 확률이 크다(실측 8/12: 150콜 캡 소진). 최선 판독 채택 → judge가 로컬/Gemini로 폴백.
    const timedOut = claudeTimeouts() - toBefore;
    if (timedOut > 0) { console.warn(`[boardreader] Claude 타임아웃 ${timedOut}회 — 재시도 중단(느린 판독·예산 보호, 최선 판독 채택)`); break; }
    // 예산이 다음 풀 시도(경계+요약+부3개+근태 ≈ 6콜)에 못 미치면 재시도 안 함.
    if (claudeBudgetLeft() < 6) { console.warn(`[boardreader] 예산 부족(${claudeBudgetLeft()}<6) — 재시도 중단(최선 판독 채택)`); break; }
    console.warn(`[boardreader] 시도 ${attempt + 1}/${maxTries} 불량(${fault}) → 경계 재추정 재시도`);
  }
  if (!best) return null;
  if (lastFault) console.warn(`[boardreader] 재시도 소진 — 최선 판독 채택(마지막 불량: ${lastFault})`);
  reconcileCrossPart(best, known);   // ★부 간 앞순번 교차보정 — 유령 이름 제거(하유린→정유경)
  purgeCrossPartContamination(best); // ★교차 오염 제거 — 옆 부(3부) 명단이 크롭 번짐으로 유입된 것(2부=3부 사고) 정리
  // ★근태(휴무/병가/휴가) 판독 — 근태는 배치표 오른쪽 '조편성표' 근무칸(색태그)에 있다. 부 크롭엔 없어 전용 판독.
  //  ★조 열분할 우선: 통짜 크루 크롭은 다열이 빽빽해 이름을 다른 유효이름으로 뭉갠다(박시윤→박신훈, 스냅으로도 못 잡음).
  //   조별 단일 크롭(8배)이면 이름·근태 안정(실측 박시윤·서동명 정확). 조 경계 실패 시 통짜 크루 크롭(6배)으로 폴백.
  //   ★로컬 VLM은 이 판독에 못 씀(qwen2.5vl 실측 2명만 뱉음) → Claude로만.
  let offList = [];
  if (claudeBudgetLeft() > 0) {
    try {
      let raw = await readOffByColumns(img);              // {off, crew} — 조 열분할(이름 안정)
      if (raw == null) {                                   // 조 경계 실패 → 통짜 크루 크롭 폴백(근태만)
        const offPath = path.join(TMP, `off_${Date.now()}.png`);
        await runPy({ image: img, crop_only: offPath, slice: { x0: 0.64, x1: 1.0, y1: 0.92, lmargin: 0 }, scale: 6 }, 45000);
        raw = { off: (await readOffList(offPath)) || [], crew: [] };
        try { fs.unlinkSync(offPath); } catch { /* noop */ }
      }
      const offRaw = Array.isArray(raw) ? raw : (raw.off || []);   // 배열형(옛) 호환
      offList = offRaw.map((o) => ({ name: snapOfficial(o.name) || o.name, reason: o.reason }));
      console.log(`[boardreader] 근태 판독: ${offList.length}명${offList.length ? ` (${offList.map((o) => `${o.name}:${o.reason}`).slice(0, 20).join(', ')})` : ''}`);
      // ★오늘 근무자 집합 → 애매 오독 티브레이크(이수련↔이수현 등). 근무태그만(근태·빈칸 제외), 정본 스냅 후 수집.
      const workingSet = new Set();
      for (const cr of ((raw && raw.crew) || [])) {
        const duty = String(cr.duty || '');
        if (OFF_REASON_RE.test(duty) || !_WORK_DUTY_RE.test(duty)) continue;
        const nm = snapOfficial(cr.name); if (nm) workingSet.add(nm);
      }
      if (workingSet.size) disambiguateByWorking(best, workingSet);
    } catch (e) { console.error('[boardreader] 근태 판독 실패:', e.message); }
  }
  return { boundaries: bestBounds, parts: best, offList, _claudeCalls: startBudget - claudeBudgetLeft(), _fault: lastFault };
}

// ★즉시 토글(재시작 불필요) — data/use-claude-reader 파일 있으면 배치표 판독을 서버 Claude로. 롤백=rm 파일.
//  (env CLAUDE_READER=1 도 허용.) 판독 시점마다 확인 → touch/rm 즉시 반영. 실패·캡초과면 judge가 로컬/Gemini 폴백.
export function useClaudeReader() {
  if (['1', 'true', 'yes'].includes(String(process.env.CLAUDE_READER || '').toLowerCase())) return true;
  try { return fs.existsSync(path.join(DATA_DIR, 'use-claude-reader')); } catch { return false; }
}

// ★홀리스틱 3부 판독 토글 — data/use-holistic-p3 있으면 3부는 '명단+티오프 1회 통합 판독'(어긋남 원천 차단).
//  즉시 토글(재시작 불필요). 실패·부실하면 기존 크롭-분할 경로로 자동 폴백. 롤백=rm 파일.
export function useHolisticP3() {
  if (['1', 'true', 'yes'].includes(String(process.env.HOLISTIC_P3 || '').toLowerCase())) return true;
  try { return fs.existsSync(path.join(DATA_DIR, 'use-holistic-p3')); } catch { return false; }
}

// ── 배치표 셀 파서 — "차은경(54)"·"신지현(1,3)"·"정진영(조하빈)"(순번교환)·"우겸조(찾근)" 해석. ──
//  name=실제 그 자리 사람(교환이면 점유자), holder=공백제거 키, duty=근무태그('54'/'1,3'/'찾근'), cross=부중복.
//  (judge.mjs normRosterName과 동일 규칙 — import 순환 피하려 여기 축약 복제.)
function parseCell(cell) {
  const s = String(cell || '').trim();
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
  if (!m) return { name: s, holder: s.replace(/\s/g, ''), duty: '', cross: false };
  const base = m[1].trim(), inner = m[2].trim().replace(/\s/g, ''), tail = m[3].trim();
  const isNum = /^[\d,.]+$/.test(inner);
  if (tail && /[가-힣]/.test(tail)) return { name: tail, holder: tail.replace(/\s/g, ''), duty: isNum ? inner : '', cross: isNum };
  if (isNum) return { name: base, holder: base.replace(/\s/g, ''), duty: inner, cross: true };
  if (/^(찾근|조출|정출|선발|당번|프리|벌당|배치|콜|정근|휴무|휴가|병가|연차|반차|월차|격리)$/.test(inner)) return { name: base, holder: base.replace(/\s/g, ''), duty: inner, cross: false };
  return { name: inner || base, holder: (inner || base).replace(/\s/g, ''), duty: '', cross: false };
}

// 부별 Claude 판독({roster,tee,cut}) → judge()가 쓰는 verdict 형식. localvlm.readBoardLocalVerdict와 동일 계약 +
//  괄호 태그에서 crewDuty·guaranteedWork(54/찾근)·crossPartNames를 파생(3부 54·1,3 근무판정 게이트 근거).
function verdictFromPart(article, member, pd, allParts, offList = []) {
  const roster = Array.isArray(pd?.roster) ? pd.roster.slice() : [];
  if (!roster.length) return null;
  const part = String(member?.part || '3').replace(/\D/g, '') || '3';
  const teeGrid = (pd.tee || [])
    .map((t) => ({ pos: Number(t.pos), time: String(t.time || ''), course: String(t.course || '').toUpperCase() }))
    .filter((t) => t.pos > 0 && /^\d{1,2}:\d{2}$/.test(t.time));
  // ★티오프 칸 전체 시각(팀번호 유무 무관) — 검수에서 모든 시간대를 고를 수 있게.
  const _tmin = (t) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]);
  const teeTimes = [...new Set([
    ...(Array.isArray(pd.times) ? pd.times : []).map((t) => (String(t).match(/\d{1,2}:\d{2}/) || [''])[0]),
    ...teeGrid.map((t) => t.time),
  ].filter(Boolean))].sort((a, b) => _tmin(a) - _tmin(b));
  const gridMax = teeGrid.reduce((mx, t) => Math.max(mx, t.pos), 0);
  const cutPos = Number(pd.cut) || 0;
  const cut = cutPos || gridMax || 0;
  const dm = String(article?.subject || '').match(/(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일(?:\s*[월화수목금토일]요일)?/);
  const nk = String(member?.name || '').replace(/\s/g, '');
  const crewDuty = {}; const guaranteed = []; const cross = [];
  let myPos = 0;
  roster.forEach((cell, i) => {
    const c = parseCell(cell);
    if (c.holder && c.duty && !crewDuty[c.holder]) crewDuty[c.holder] = c.duty;
    if (c.duty && /(?:^|,)(?:54|찾근)/.test(c.duty)) guaranteed.push(c.name);
    if (c.cross && c.name) cross.push(c.name);
    if (nk && c.holder === nk && myPos === 0) myPos = i + 1;
  });
  // ★근태(휴무/병가/휴가…) 주입 — 부 크롭엔 없어 전용 판독(readOffList)으로 잡은 근태를 crewDuty에 넣는다.
  //  이래야 judge.fixMemberPosByRoster의 근태 오프 게이트가 발화(무조건 오프 + offType sick/vacation 확정).
  //  근태가 근무태그보다 우선(오늘 안 나옴) → 뒤에 덮어씀. 명단에 이름이 남아 스페어로 잡혀도 게이트가 오프로 못박음.
  for (const o of (offList || [])) { if (o && o.name) crewDuty[o.name] = o.reason; }
  const onLeave = nk && /휴무|휴가|병가|격리|연차|반차|월차/.test(String(crewDuty[nk] || ''));
  const myStatus = onLeave ? 'off' : (myPos > 0 ? (cut && myPos <= cut ? 'assigned' : 'spare') : 'off');
  const tee = (!onLeave && myPos > 0) ? teeGrid.find((t) => t.pos === myPos) : null;
  return {
    part, category: '배치표', relevant: true, rosterReliable: true,
    part3Roster: roster,
    teeGrid,
    teeTimes,
    teamCount: cut || null,
    cutoffPosition: cutPos || null,
    cutoffName: cutPos ? parseCell(roster[cutPos - 1] || '').name : '',
    cutoffAnnounced: !!cutPos,
    internCount: 0, internTees: [],
    dateLabel: dm ? dm[0].trim() : '',
    boardTables: (allParts || []).map((p) => ({ part: Number(p), color: '' })),
    crewDuty,
    guaranteedWork: [...new Set(guaranteed)],
    crossPartNames: [...new Set(cross)],
    assignMap: {},
    myPosition: myPos,
    myStatus,
    teeTime: tee ? tee.time : '',
    course: tee ? tee.course : '',
    confidence: 0.92,
    _claude: true, _source: 'claude:crop',
  };
}

// ── 이미지별 캐시 — 합본을 부마다(1·2·3) 다시 읽지 않게(Claude 4회를 12회로 늘리지 않음). ──
//  한 배치표(=한 이미지)당 whole-board 판독을 '한 번'만. notifyForArticle 안 여러 judge()가 이 결과를 공유.
//  Promise를 저장 → 동시 진입도 한 번의 판독으로 합쳐짐. 오류면 삭제(재시도 가능). 최근 4장만 보관.
const _boardCache = new Map();
function readBoardByClaudeCached(img, opts = {}) {
  if (!img) return Promise.resolve(null);
  if (_boardCache.has(img)) return _boardCache.get(img);
  // ★null(판독 실패)은 캐시에 남기지 않는다 — 일시적 실패 1건이 재시작 전까지 이후 모든 판독을
  //  같은 널로 오염시키던 버그(증상: "재시작해야 새 배치표가 잡힘"). 성공(board)만 캐시.
  const pr = readBoardByClaude(img, opts)
    .then((board) => { if (!board) _boardCache.delete(img); return board; })
    .catch((e) => { _boardCache.delete(img); throw e; });
  _boardCache.set(img, pr);
  if (_boardCache.size > 4) { const k = _boardCache.keys().next().value; _boardCache.delete(k); }
  return pr;
}

// judge() 진입점 — article(회원 기준) → 그 회원 부(部) verdict. 합본은 캐시로 1회 판독 후 해당 부만 변환.
//  해당 부가 판독에 없으면(예: 다른 부만 잘라 올린 변동) null → judge가 로컬/Gemini 폴백.
export async function readBoardClaudeVerdict(article, member) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img) return null;
  let board;
  try { board = await readBoardByClaudeCached(img); }
  catch (e) { console.error('[claude] board 판독 오류:', e.message); return null; }
  if (!board || !board.parts) return null;
  const part = String(member?.part || '3').replace(/\D/g, '') || '3';
  const pd = board.parts[part];
  if (!pd || !Array.isArray(pd.roster) || !pd.roster.length) return null;
  // ★안전 게이트: 이 부 명단이 커트를 '심각' 미달(순번열 누락)이면 회원 발송에 쓰지 않는다 → null로 폴백.
  //  경계 흔들림 잔여가 회원에게 잘못된 '근무 없음' 알림을 내는 것을 차단. (인턴발 1~3 부족은 정상 허용.)
  const cut = Number(pd.cut) || 0;
  const rl = pd.roster.filter(Boolean).length;
  if (cut > 0 && rl < _rosterFloor(cut)) { console.warn(`[claude] ${part}부 명단 심각부족(${rl}<${_rosterFloor(cut)}, 커트 ${cut}) — 발송용 판독 보류(폴백)`); return null; }
  return verdictFromPart(article, member, pd, Object.keys(board.parts), board.offList);
}

// 모니터(board-parts-store) 채움용 — 이미 캐시된 whole-board 판독에서 지정 부들을 뽑아 setBoardPart payload로.
//  ★추가 Claude 호출 0(캐시 히트만). 캐시에 없으면 null(판독 안 켜졌거나 아직 안 읽음).
export async function claudeMonitorParts(article, wantParts = ['1', '2']) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img || !_boardCache.has(img)) return null;
  let board;
  try { board = await _boardCache.get(img); } catch { return null; }
  if (!board || !board.parts) return null;
  const out = {};
  for (const p of wantParts) {
    const pd = board.parts[String(p)];
    if (!pd || !Array.isArray(pd.roster) || !pd.roster.length) continue;
    const v = verdictFromPart(article, { name: '', part: p }, pd, Object.keys(board.parts), board.offList);
    out[String(p)] = {
      roster: v.part3Roster.slice(), teeGrid: v.teeGrid, teeTimes: v.teeTimes || [], teamCount: Number(v.teamCount) || 0,
      internTees: v.internTees, internCount: v.internCount,
      cutoffPosition: v.cutoffPosition, cutoffName: v.cutoffName,
      crewDuty: v.crewDuty, rosterReliable: true, uncertain: '',
    };
  }
  return Object.keys(out).length ? out : null;
}

// ── 단일부(변동 크롭): 경계 없이 그 이미지를 바로 부 판독. ──
export async function readSinglePartByClaude(imageOrUrl, { cut = 0 } = {}) {
  const img = await ensureLocal(imageOrUrl);
  if (!img) return null;
  // 작은 크롭은 업스케일이 결정적 — 통째 6배 업스케일 후 판독.
  const big = path.join(TMP, `single_${Date.now()}.png`);
  try { await runPy({ image: img, crop_only: big, slice: { x0: 0, x1: 1, y1: 1 }, scale: 4 }, 30000); }
  catch { return null; }
  const r = await readPartWithClaude(big);
  try { fs.unlinkSync(big); } catch { /* noop */ }
  if (!r) return null;
  return { roster: snapRoster(r.roster), tee: r.tee, times: r.times || [], cut: cut || r.cut || 0 };
}
