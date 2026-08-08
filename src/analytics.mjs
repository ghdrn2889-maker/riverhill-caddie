// 운영 모니터링용 기록·집계. 본 앱은 record*()로 이벤트만 남기고,
//  별도 모니터링 사이트(src/monitor.mjs)가 computeStats()로 한 눈에 보여준다.
//  ★모두 부가 기능 — 기존 알림/판독 경로에 영향 없음(append-only, 실패해도 조용).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, appendJSONL, loadJSON, loadUserJSON } from './store.mjs';
import { all, get, run } from './db.mjs';
import { analyzeRoster, analyzeInterns, analyzePartTeams } from './gemini.mjs';
import { getBoardPart, loadBoardPartsStore } from './boardparts.mjs';
import { loadDayboard, teamsArray as dayboardTeams } from './dayboard.mjs';
import { labelToISO } from './worklog.mjs';

// ── 기록(본 앱에서 호출) ────────────────────────────────
const VISIT_THROTTLE_MS = 10 * 60 * 1000; // 같은 회원 10분 내 재방문은 1건으로
const _lastVisit = new Map();             // in-memory(재시작 시 초기화 — 무해)

// 앱 오픈(방문). /api/me 호출 시 회원당 10분 스로틀로 1건 기록.
export function recordVisit(userId, meta = {}) {
  if (!userId) return;
  const now = Date.now();
  if (now - (_lastVisit.get(userId) || 0) < VISIT_THROTTLE_MS) return;
  _lastVisit.set(userId, now);
  appendJSONL('visits.jsonl', { at: now, uid: Number(userId), ...meta });
}

// 배치표(및 관련 글) 판독 1건. 시스템이 잘 이해했는지 = 불확실률·확신도로 평가.
export function recordBoardRead(rec = {}) {
  if (!rec || !rec.articleId) return;
  appendJSONL('board-reads.jsonl', { at: Date.now(), ...rec });
}

// 접속 하트비트/이탈 — 회원이 앱을 보는 동안 주기 호출(활동시각 갱신), 닫으면 leaving=true(즉시 나감).
//  last_seen=마지막 활동(=마지막 방문 시각, 보존). left_at=마지막 이탈. last_seen>left_at 이면 접속 중.
export function recordPresence(userId, { leaving = false } = {}) {
  if (!userId) return;
  try {
    if (leaving) run('UPDATE users SET left_at = ? WHERE id = ?', Date.now(), userId);
    else run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), userId);
  } catch { /* noop */ }
}

// ── 읽기 유틸 ──────────────────────────────────────────
function readJSONL(name, { sinceTs = 0, maxLines = 20000 } = {}) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const slice = lines.length > maxLines ? lines.slice(-maxLines) : lines;
    const out = [];
    for (const ln of slice) {
      try { const o = JSON.parse(ln); if (!sinceTs || (o.at || 0) >= sinceTs) out.push(o); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

const DAY = 86400 * 1000;
// KST(서버 로컬) 기준 YYYY-MM-DD
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lastDays(n, now = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(now - i * DAY));
  return out;
}
// 값 배열 → {key:count} 히스토그램
function tally(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count);
}
// 날짜별 카운트(빈 날 0 채움)
function seriesByDay(items, days, tsFn = (x) => x.at) {
  const c = new Map(days.map((d) => [d, 0]));
  for (const it of items) { const d = dayKey(tsFn(it)); if (c.has(d)) c.set(d, c.get(d) + 1); }
  return days.map((d) => ({ date: d, count: c.get(d) }));
}

// ── 시스템이 판독한 '최신 배치표' — 매일 실제 배치표와 대조 검증용 ─────────
//  lastboard.json(원문+판독결과) + 1번 회원 today.json(명단/컷/티오프) 을 합쳐 순번별로 재구성.
//  원문 이미지 링크를 함께 줘서, 관리자가 실제 배치표와 나란히 눈으로 대조할 수 있게 한다.
// 이름 정규화(듀티태그·교환 제거) — 교차확인 맵(byName) 조회용. "정유경(54)"→"정유경".
function baseName(cell) { return String(cell || '').replace(/\s*\([^)]*\).*$/, '').replace(/\s/g, ''); }

// 한 부(部)의 판독 essentials → 순번별 행 + 요약. crossByName로 두 탕 표시.
function buildPartView(pv, crossByName) {
  if (!pv) return null;                                   // 그 부 없음(undefined) → 탭 미생성
  const roster = Array.isArray(pv.roster) ? pv.roster : [];
  if (!roster.length) return null;
  const teeGrid = Array.isArray(pv.teeGrid) ? pv.teeGrid : [];
  const teeByPos = new Map(teeGrid.map((g) => [Number(g.pos), g]));
  const cutoffPos = Number(pv.cutoffPosition) > 0 ? Number(pv.cutoffPosition) : 0;
  const teamCount = Number(pv.teamCount) > 0 ? Number(pv.teamCount) : null;
  // ★근무 확정선: 대시보드가 쓰는 live cutLine(당추·팀추가로 전진) 최우선 → 커트공지 → 헤더 팀수 → 티오프표 유무.
  const cutLine = Number(pv.cutLine) > 0 ? Number(pv.cutLine) : 0;
  const workLimit = cutLine || cutoffPos || teamCount || 0;
  const rows = roster.map((cell, i) => {
    const pos = i + 1;
    const g = teeByPos.get(pos);
    const work = workLimit > 0 ? pos <= workLimit : !!g;
    const ce = crossByName && crossByName[baseName(cell)];
    return {
      pos, name: String(cell || ''), work,
      spareRank: (!work && workLimit > 0) ? (pos - workLimit) : null,
      tee: g ? (String(g.time || '').match(/\d{1,2}:\d{2}/) || [''])[0] : '',
      course: g ? String(g.course || '') : '',
      isCut: workLimit > 0 && pos === workLimit,
      crossDuty: (ce && Array.isArray(ce.parts) && ce.parts.length >= 2) ? ce.duty : '', // 두 탕/54 표시
    };
  });
  return {
    teamCount, cutoffName: pv.cutoffName || '', cutoffPosition: cutoffPos || null,
    internCount: Number(pv.internCount) > 0 ? Number(pv.internCount) : 0,
    internTees: Array.isArray(pv.internTees) ? pv.internTees : [],
    swaps: Array.isArray(pv.swaps) ? pv.swaps : [],
    reliable: !!pv.reliable, uncertain: pv.uncertain || '',
    workCount: rows.filter((r) => r.work).length,
    spareCount: rows.filter((r) => !r.work).length,
    total: rows.length, rows,
  };
}

function buildLatestBoard() {
  const lbp = loadJSON('lastboard-parts.json', null);   // 부별 판독(server가 배치표 처리 시 저장)
  const lb = loadJSON('lastboard.json', null);          // 3부 메인(하위호환 폴백)
  const crossByName = (lbp && lbp.crossPart && lbp.crossPart.byName) || {};
  // 부별 데이터 소스: 신형(lastboard-parts) 우선, 없으면 ★대시보드와 같은 최신본(today.json 3부 + board-parts-store 1·2부).
  //  ★★핵심: 3부는 effectivePart3Verdict로 today.json(대시보드 소스)을 얹어 '얼어붙은 lastboard'가 아닌 최신 상태를 쓴다.
  let partsSrc = (lbp && lbp.parts) || null;
  if (!partsSrc) {
    const v = effectivePart3Verdict(lb) || {};      // 대시보드와 동일한 최신 3부
    const bp = loadBoardPartsStore();               // 1·2부: 메인 파이프라인 저장분(재판독 0)
    partsSrc = { 3: {
      roster: (Array.isArray(v.part3Roster) && v.part3Roster.length) ? v.part3Roster : [],
      teamCount: v.teamCount, teeGrid: Array.isArray(v.teeGrid) ? v.teeGrid : [],
      cutoffName: v.cutoffName, cutoffPosition: v.cutoffPosition, cutLine: v.cutLine,
      internCount: v.internCount, internTees: v.internTees,
      swaps: v._swaps, reliable: v.rosterReliable, uncertain: v._uncertain,
    } };
    for (const p of ['1', '2']) {                   // 1·2부도 즉시 렌더(store에 있으면) — 3부만 뜨던 지연 제거
      const pd = bp && bp.parts && bp.parts[p];
      if (pd && Array.isArray(pd.roster) && pd.roster.length) {
        partsSrc[p] = {
          roster: pd.roster, teamCount: pd.teamCount, teeGrid: pd.teeGrid,
          cutoffName: pd.cutoffName, cutoffPosition: pd.cutoffPosition,
          internCount: pd.internCount, internTees: pd.internTees,
          reliable: pd.rosterReliable || pd.roster.length > 0, uncertain: pd.uncertain,
        };
      }
    }
  }
  const parts = {};
  const availableParts = [];
  for (const p of ['1', '2', '3']) {
    const view = buildPartView(partsSrc[p] || partsSrc[Number(p)], crossByName);
    if (view) { parts[p] = view; availableParts.push(p); }
  }
  if (!availableParts.length) return null;
  const art = (lbp && lbp.article) || (lb && lb.article) || {};
  const twoRounds = (lbp && lbp.crossPart && Array.isArray(lbp.crossPart.twoRounds))
    ? lbp.crossPart.twoRounds.map((nm) => ({ name: nm, duty: crossByName[nm]?.duty || '', pos: crossByName[nm]?.pos || {} }))
    : [];
  return {
    at: (lbp && lbp.at) || (lb && lb.at) || null,
    articleId: (lbp && lbp.articleId) || (lb && lb.id) || '',
    subject: (lbp && lbp.subject) || art.subject || '',
    writer: (lbp && lbp.writer) || art.writer || '',
    writeDate: art.writeDate || null,
    dateLabel: (lbp && lbp.dateLabel) || (lb && lb.rawVerdict && lb.rawVerdict.dateLabel) || (lb && lb.dateLabel) || '',
    image: (lbp && lbp.image) || (Array.isArray(art.images) && art.images[0]) || '',
    url: (lbp && lbp.url) || art.url || '',
    model: process.env.GEMINI_BOARD_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest',
    comments: (Array.isArray(art.comments) ? art.comments : [])
      .map((c) => String(c.content || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
    // ★신선도 서명 — 얼어붙은 articleId/at이 아니라 today.json·store 상태가 바뀌면 값이 달라져 프런트가 재렌더·재요청.
    //  computeBoardParts와 '동일 포맷'(boardSyncSig)이라 프런트 게이트가 정확히 맞물린다.
    syncSig: boardSyncSig(lb, loadBoardPartsStore()),
    availableParts, twoRounds, parts,
  };
}

// 부(部) 집합 → 근무표시. {1,2,3}→"54", {1,3}→"1,3", {2}→"2부".
function partsToDuty(set) {
  const a = [...set].sort();
  if (a.length >= 3) return '54';
  if (a.length === 2) return a.join(',');
  if (a.length === 1) return `${a[0]}부`;
  return '';
}

// ★★검수·판독검증이 '대시보드와 같은 최신 3부'를 보게 하는 핵심 병합.
//  문제: lastboard.rawVerdict(정본 스냅샷)은 rememberBoard의 clobber 가드로 '얼어' 있어
//   당추·커트 같은 변동을 못 따라간다. 반면 1번 회원 today.json은 applyVerdict가 매 글마다
//   지능적으로 병합(불안정 baseline 보존·당추 티오프 재매칭)해 갱신 → 대시보드가 읽는 '적용된 최신 3부'.
//  해법: 변동에 민감한 board-level 필드(순번명단·티오프표·확정선·커트·인턴)는 today.json 우선,
//   없으면 스냅샷 폴백. today.json에 없는 것(crewDuty 근무표시맵·teamCount 헤더)만 스냅샷 유지.
//  ※member-specific(myPosition/status/teeTime)은 절대 안 씀 — board-level만 취함.
// ★검수/판독 기준 today.json — 1번 회원(김홍구)이 병가·휴무면 컷이동이 그의 상태에 안 실려 검수가 얼어붙는다.
//  → 3부 '근무/스페어'(off 아님) 회원 중 가장 최근 갱신된 today.json을 기준으로 삼아 실시간 컷을 항상 따라간다.
//  (명단·구조는 아래 로직이 lastboard/교정을 우선하므로, 여기선 '가장 신선한 시간민감 상태'만 고른다.)
function freshestPart3Ref() {
  let best = null, bestT = -1;
  try {
    const base = path.join(DATA_DIR, 'users');
    for (const id of fs.readdirSync(base)) {
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(base, id, 'today.json'), 'utf8')); } catch { continue; }
      if (!j || !(j.part && String(j.part).includes('3'))) continue;
      if (j.status === 'off' || j.status === 'unknown') continue;          // off(병가·휴무)는 컷이동 미반영 → 기준 제외
      if (!(Array.isArray(j.roster3) && j.roster3.length) && !(Number(j.cutLine) > 0)) continue;
      const ts = Number(j.updatedAt) || 0;
      if (ts > bestT) { bestT = ts; best = j; }
    }
  } catch { /* noop */ }
  return best || loadUserJSON(1, 'today.json', null);
}

// ★네 화면 통합 — 회원 개인 today.json의 티오프(수동/관리자 교정 포함)를 공유 그리드에 덮어씌운다.
//  검수·판독검증이 대시보드·알림과 절대 못 어긋나게: 같은 회원은 어디서나 같은 티오프·근무여부.
//  (회원 아닌 순번은 그리드 유지 — 그건 배치표 이미지로만 갱신.)
function overlayMemberTees(v) {
  if (!v) return v;
  try {
    const grid = Array.isArray(v.teeGrid) ? v.teeGrid.slice() : [];
    const byPos = new Map(grid.map((g) => [Number(g.pos), { pos: Number(g.pos), time: String(g.time || ''), course: g.course || '' }]));
    const dir = path.join(DATA_DIR, 'users');
    for (const d of fs.readdirSync(dir)) {
      if (!/^\d+$/.test(d)) continue;
      const j = loadUserJSON(Number(d), 'today.json', null);
      if (!j) continue;
      const pn = String(j.part || '3').replace(/[^0-9]/g, '') || '3';   // '3부'/'3' 모두 허용
      if (pn !== '3') continue;
      const pos = Number(j.myPosition) || 0;
      const tee = String(j.teeTime || '');
      if (pos >= 1 && /^\d{1,2}:\d{2}$/.test(tee)) {
        byPos.set(pos, { pos, time: tee, course: /IN/i.test(String(j.course)) ? 'IN' : 'OUT' });
      }
    }
    v.teeGrid = [...byPos.values()].sort((a, b) => a.pos - b.pos);
  } catch { /* noop */ }
  return v;
}

// ★칠판(dayboard) 오버레이 — 검수·판독이 '시각순 단일 진실원'을 최종 권위로 삼는다.
//  칠판은 이미지 배치표든 텍스트 업데이트(컷 "28번까지"·변동)든 시각순으로 반영하므로,
//  '본배치표에서 얼고 이후 변동엔 안 움직이던' 검수를 대시보드·알림과 동행시킨다.
//  precedence: 칠판이 board(컷·티오프)를 깔고 → 그 위에 회원/관리자 today 교정이 최종(overlayMemberTees).
//  관리자 교정 정본(_adminCorrected)은 칠판이 건드리지 않는다.
function overlayDayboard(v) {
  if (!v || v._adminCorrected) return v;
  try {
    const iso = labelToISO(v.dateLabel || '');
    if (!iso) return v;
    const db = loadDayboard(iso);
    if (!db || !Array.isArray(db.log) || !db.log.length) return v;
    const board = db.board || {};
    if (Number(board.cut) > 0) { v.cutoffPosition = board.cut; v.cutLine = board.cut; }
    const byPos = new Map((v.teeGrid || []).map((g) => [Number(g.pos), { pos: Number(g.pos), time: String(g.time || ''), course: g.course || '' }]));
    for (const t of dayboardTeams(board)) {
      if (t.tee && /^\d{1,2}:\d{2}$/.test(t.tee)) byPos.set(t.pos, { pos: t.pos, time: t.tee, course: t.course || '' });
    }
    v.teeGrid = [...byPos.values()].sort((a, b) => a.pos - b.pos);
    v._t1Sig = `${v._t1Sig || ''}|db:${iso}:${board.cut || 0}:${db.updatedAt || 0}`;   // 칠판 변경 시 캐시 무효화
  } catch { /* noop */ }
  return v;
}

export function effectivePart3Verdict(lb) {
  const v = _effPart3VerdictRaw(lb);
  if (v) {
    const before = (v.teeGrid || []).map((g) => `${g.pos}:${g.time}`).join(',');
    overlayDayboard(v);    // 칠판(단일 진실원) — 텍스트 컷/변동까지 반영해 검수·판독을 동행시킴
    overlayMemberTees(v);  // 회원 개인 today(관리자 교정 포함)가 최종 권위
    const after = (v.teeGrid || []).map((g) => `${g.pos}:${g.time}${g.course}`).join(',');
    if (before !== after) v._t1Sig = `${v._t1Sig || ''}|mo:${after}`;   // 오버레이 반영 → 캐시 정확 무효화
  }
  return v;
}

function _effPart3VerdictRaw(lb) {
  const t1 = freshestPart3Ref();
  const digits = (s) => Number(String(s || '').replace(/\D/g, '')) || 0;
  const lbId = digits(lb && lb.id);
  const t1Id = digits(t1 && t1.articleId);
  // ★★근본 수정(재발 차단) — today.json(대시보드가 읽는 소스)이 lastboard보다 '새 배치표'(글번호↑)로
  //  넘어갔으면, 대시보드는 이미 그 새 배치표를 반영 중이다. 얼어붙은 lastboard(+지난 배치표의 관리자교정)를
  //  버리고 board를 today.json으로 통째로 재구성 → 판독/검수가 대시보드와 '구조적으로' 절대 못 어긋난다.
  //  (lastboard의 isAuthoritativeBoard/_adminCorrected freeze가 정상 새 배치표를 거부해 얼어도, 판독은
  //   대시보드 소스를 그대로 따라간다. roster3=매 본배치표 전체명단, teeGrid·cutLine=당추 반영 최신.)
  if (t1 && t1Id && t1Id > lbId) {
    const nv = {
      part3Roster: Array.isArray(t1.roster3) ? t1.roster3.slice() : [],
      teeGrid: Array.isArray(t1.teeGrid) ? t1.teeGrid.slice() : [],
      internTees: Array.isArray(t1.internTees) ? t1.internTees.slice() : [],
      internCount: Number(t1.internCount) || 0,
      cutoffName: t1.cutoffName || '',
      cutoffPosition: Number(t1.cutoffPosition) || null,
      cutLine: Number(t1.cutLine) || 0,
      teamCount: Number(t1.teamCount) || 0,
      dateLabel: t1.date || (lb && lb.dateLabel) || '',
      rosterReliable: (Array.isArray(t1.roster3) ? t1.roster3.length : 0) >= 9,
      crewDuty: (lb && lb.rawVerdict && lb.rawVerdict.crewDuty) || {},
      _effArticleId: String(t1.articleId || ''),
      _fromToday: true,
    };
    nv._t1Sig = `today:${t1.articleId}|${t1.updatedAt || 0}|${(t1.roster3 || []).length}|${t1.cutLine || 0}|`
      + `${(t1.teeGrid || []).map((g) => `${g.pos}:${g.time}`).join(',')}`;
    return nv;
  }
  // ── 같은 배치표(또는 today.json이 더 옛것): lastboard가 정본 — 기존 병합 로직 유지. ──
  const v = (lb && lb.rawVerdict) ? { ...lb.rawVerdict } : {};
  // ★관리자 교정 배치표(_adminCorrected)는 그 자체가 정본 — today.json 오버레이로 절대 덮지 않는다.
  //  (검수에서 서동명→서동환 교정한 이름을, 자동 판독이 담긴 today.json이 다시 서동명으로 되돌리던 사고 방지.)
  //  ※단 위 today-branch가 '더 새 배치표'면 이미 그쪽으로 빠져나감 — 지난 배치표 교정에 영구히 갇히지 않음.
  if (v._adminCorrected) { v._t1Sig = `corrected:${v._adminCorrected.at || ''}`; return v; }
  if (!t1) { v._t1Sig = ''; return v; }
  // ★날짜 안전장치: today.json이 '다음 날'로 넘어갔으면(월-일 다름) 오늘 배치표에 안 얹는다.
  const dayNums = (s) => (String(s || '').match(/\d+/g) || []).slice(0, 2).join('-');
  const dLb = dayNums(lb && (lb.dateLabel || (lb.rawVerdict && lb.rawVerdict.dateLabel)));
  const dT1 = dayNums(t1.date);
  if (dLb && dT1 && dLb !== dT1) { v._t1Sig = ''; return v; }
  // ★이름(명단)은 절대 today.json에서 안 읽는다 — roster3는 관리자 잠금에 안 들어가고 근무 회원만 갱신돼
  //  교정이 안 보이거나 되돌아가는 사고의 원인. 이름은 교정 가능한 lastboard(part3Roster) 그대로 두고,
  //  당추로 실제 바뀌는 '시간민감 값'(티오프표·커트·인턴)만 today.json으로 최신화한다.
  if (Array.isArray(t1.teeGrid) && t1.teeGrid.length) v.teeGrid = t1.teeGrid.slice();
  if (Array.isArray(t1.internTees)) v.internTees = t1.internTees.slice();
  if (Number.isFinite(Number(t1.internCount))) v.internCount = Number(t1.internCount);
  if (t1.cutoffName) v.cutoffName = t1.cutoffName;
  if (Number(t1.cutoffPosition) > 0) v.cutoffPosition = Number(t1.cutoffPosition);
  if (Number(t1.cutLine) > 0) v.cutLine = Number(t1.cutLine);
  // ★캐시 신선도 서명 — today.json이 갱신되면(당추로 teeGrid 시각이 바뀌는 등) 이 값이 달라져 캐시가 뚫린다.
  v._t1Sig = `${(t1.roster3 || []).length}|${t1.cutLine || 0}|${t1.cutoffPosition || 0}|${t1.rosterAt || 0}|${t1.updatedAt || 0}|`
    + `${(t1.teeGrid || []).map((g) => `${g.pos}:${g.time}`).join(',')}`;
  return v;
}

// ★검수·판독검증·즉시렌더가 '같은 신선도 기준'으로 비교되도록 단일 서명 — 3부(today.json _t1Sig) + 1·2부(store 상태).
//  얼어붙은 articleId/at이 아니라 대시보드 소스(today.json·board-parts-store)가 바뀌면 값이 달라진다.
//  buildLatestBoard·computeBoardParts가 '동일 포맷'으로 내보내야 프런트 게이트(재요청 판단)가 정확히 맞물린다.
// ★1·2부 관리자 교정 지문 — store.at은 '배치표 도착시각'이라 교정해도 안 바뀐다. 교정(_adminCorrected.at)을
//  서명에 넣어야 캐시·프런트 게이트가 '1·2부 교정'에도 갱신된다. (안 넣으면 검수엔 보여도 판독검증이 교정 전에
//  굳던 버그 — 예: 2부 pos5·6 권미영·정이슬 티오프 자유입력이 판독검증에 반영 안 됨.)
function bpCorrSig(bpStore) {
  if (!bpStore || !bpStore.parts) return '';
  return Object.keys(bpStore.parts).sort()
    .map((p) => `${p}:${(bpStore.parts[p] && bpStore.parts[p]._adminCorrected && bpStore.parts[p]._adminCorrected.at) || ''}`).join(',');
}
export function boardSyncSig(lb, bpStore) {
  const v = effectivePart3Verdict(lb);
  const keys = (bpStore && bpStore.parts) ? Object.keys(bpStore.parts).sort().join('') : '';
  return `${v._t1Sig || ''}|${(bpStore && bpStore.at) || ''}|${keys}|${bpCorrSig(bpStore)}`;
}

// ★모니터 전용 — 앱을 건드리지 않고 모니터가 '직접' 1·2·3부 부별 판독(온디맨드, board별 1회 캐시).
//  3부는 대시보드와 동일한 최신 상태(effectivePart3Verdict)를 재사용(추가 판독 0), 1·2부만 새로 판독.
//  각 부 근무자(순번≤팀수)를 교차해 두 탕(🔁)도 산출. 관리자만 보는 판독검증 탭의 데이터.
let _boardPartsCache = { key: null, data: null };
export async function computeBoardParts() {
  const lb = loadJSON('lastboard.json', null);
  if (!lb || !lb.article) return null;
  const id = String(lb.id || '');
  // ★캐시 키에 판독시각(at) 포함 — 같은 배치표가 재판독(recheck/수정)되면 lastboard.at이 바뀌어
  //  캐시가 자동 갱신된다. (id만으로 걸면 첫 판독본을 계속 보여줘 모니터가 스테일되던 문제 수정)
  //  ★★1·2부는 board-parts-store에 lastboard와 '독립적으로'(3부 저장 뒤) 채워지므로, 그 상태도 키에 포함해야
  //     1·2부가 뒤늦게 들어오거나 교정돼도 캐시가 갱신된다. (안 넣으면 판독검증이 3부만 뜨고 굳던 버그)
  const bpStore = loadBoardPartsStore();
  const bpSig = bpStore ? `${bpStore.articleId || ''}:${bpStore.at || ''}:${Object.keys(bpStore.parts || {}).sort().join(',')}:${bpCorrSig(bpStore)}` : '';
  // ★3부는 이제 대시보드와 같은 today.json 최신본을 얹으므로(effectivePart3Verdict), 그 신선도 서명(_t1Sig)도
  //  캐시 키에 포함 — 안 넣으면 당추로 대시보드가 바뀌어도 판독검증 캐시가 옛 스냅샷에 굳는다.
  const v3 = effectivePart3Verdict(lb);
  const key = `${id}|${lb.at || ''}|${bpSig}|${v3._t1Sig || ''}`;
  if (_boardPartsCache.key === key) return _boardPartsCache.data;   // 같은 배치표+같은 판독시각이면 캐시
  try {
    const article = lb.article;
    // ★Gemini 헤더 판독 제거 — 크레딧 고갈(429)로 판독검증 탭 전체가 죽던 원인.
    //  팀수는 이미 저장돼 있다: 3부=대시보드 v3(teamCount/cutLine), 1·2부=board-parts-store(pd.teamCount, 아래 324행).
    const teams = {};
    const partsSrc = {};
    for (const p of ['1', '2', '3']) {
      let tc = Number(teams[p]) || (p === '3' ? (Number(v3.teamCount) || Number(v3.cutLine) || 0) : 0);   // ★let — 아래 1·2부에서 재할당(const면 예외 → 1·2부 판독 전체가 죽고 3부만 뜨던 버그)
      let roster = [], teeGrid = [], internCount = 0, internTees = [], cutoffName = '', cutoffPosition = null, cutLine = 0, swaps = [], reliable = false, uncertain = '';
      if (p === '3') {                                             // 3부는 대시보드와 같은 최신본(v3) 재사용(추가 판독 없음)
        roster = (Array.isArray(v3.part3Roster) && v3.part3Roster.length) ? v3.part3Roster : [];   // ★죽은 Gemini(analyzeRoster) 폴백 제거 — part3Roster는 today.json에서 항상 채워짐
        teeGrid = Array.isArray(v3.teeGrid) ? v3.teeGrid : [];
        internCount = Number(v3.internCount) || 0; internTees = Array.isArray(v3.internTees) ? v3.internTees : [];
        cutoffName = v3.cutoffName || ''; cutoffPosition = Number(v3.cutoffPosition) || null;
        cutLine = Number(v3.cutLine) || 0;                        // ★대시보드 live 확정선(당추·팀추가 반영)
        swaps = Array.isArray(v3._swaps) ? v3._swaps : []; reliable = !!v3.rosterReliable; uncertain = v3._uncertain || '';
      } else {                                                    // ★1·2부는 메인 파이프라인이 저장한 board 순번표 재사용(재판독 0)
        const pd = getBoardPart(p);
        if (!pd || !Array.isArray(pd.roster) || !pd.roster.length) continue; // 저장된 그 부 배치표 없음
        roster = pd.roster.slice();
        teeGrid = Array.isArray(pd.teeGrid) ? pd.teeGrid : [];
        internCount = Number(pd.internCount) || 0; internTees = Array.isArray(pd.internTees) ? pd.internTees : [];
        cutoffName = pd.cutoffName || ''; cutoffPosition = Number(pd.cutoffPosition) || null;
        reliable = !!pd.rosterReliable || roster.length > 0; uncertain = pd.uncertain || '';
        tc = Number(pd.teamCount) || tc;                          // 헤더 재판독 대신 저장된 팀수
      }
      if (!roster.length) continue;
      partsSrc[p] = { roster, teamCount: tc || null, teeGrid, internCount, internTees, cutoffName, cutoffPosition, cutLine, swaps, reliable, uncertain };
    }
    // 교차확인(두 탕): 각 부 근무자(순번≤팀수) 이름을 교차. baseName으로 듀티태그 제거.
    const acc = {};
    for (const p of ['1', '2', '3']) {
      const ps = partsSrc[p]; if (!ps) continue; const tc = ps.teamCount || 0;
      ps.roster.forEach((cell, i) => {
        if (tc > 0 && i + 1 <= tc) { const nm = baseName(cell); if (nm) { (acc[nm] ||= { parts: new Set(), pos: {} }); acc[nm].parts.add(p); if (acc[nm].pos[p] == null) acc[nm].pos[p] = i + 1; } }
      });
    }
    const crossByName = {};
    for (const nm in acc) crossByName[nm] = { parts: [...acc[nm].parts].sort(), duty: partsToDuty(acc[nm].parts), pos: acc[nm].pos };
    const twoRounds = Object.keys(crossByName).filter((nm) => crossByName[nm].parts.length >= 2);
    const parts = {}; const availableParts = [];
    for (const p of ['1', '2', '3']) { const view = buildPartView(partsSrc[p], crossByName); if (view) { parts[p] = view; availableParts.push(p); } }
    if (!availableParts.length) { _boardPartsCache = { key, data: null }; return null; }
    const art = article;
    const data = {
      at: lb.at || null, articleId: v3._effArticleId || id, subject: art.subject || '', writer: art.writer || '',
      writeDate: art.writeDate || null, dateLabel: v3.dateLabel || lb.dateLabel || '',
      // ★원본은 '전체 배치표'(article 본문 이미지)를 우선 — latestImage는 3부만 잘린 당추 변동본(크롭)이라
      //  관리자가 "옛날/이상한 사진"으로 인지. 전체판을 주고, 변동 크롭은 latestImage로 별도 제공.
      image: (Array.isArray(art.images) && art.images[0]) || lb.latestImage || '',
      variantImage: lb.latestImage || '', url: art.url || '',
      model: process.env.GEMINI_BOARD_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest',
      comments: (Array.isArray(art.comments) ? art.comments : []).map((c) => String(c.content || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
      // ★신선도 서명 — buildLatestBoard와 동일 포맷(boardSyncSig) → 프런트 재요청 게이트가 정확히 맞물림.
      syncSig: boardSyncSig(lb, bpStore),
      availableParts, twoRounds: twoRounds.map((nm) => ({ name: nm, duty: crossByName[nm].duty, pos: crossByName[nm].pos })), parts,
    };
    _boardPartsCache = { key, data };
    return data;
  } catch (e) { console.error('computeBoardParts 오류:', e.message); return _boardPartsCache.data || null; }
}

// 발송 알림 표시 컷오프 = '최신 배치표의 첫 판독 시각'(약간의 여유 lead 포함).
//  ★한 배치표의 알림(공지 푸시)은 그 배치표를 처리하는 도중에 나가고, lastboard.json '기록'은
//   푸시를 다 보낸 뒤에 쓰인다. 그래서 컷오프를 lastboard 기록 시각으로 잡으면 그 배치표
//   알림이 통째로 잘린다(밀리초 차이). 실제 순서: 판독기록 → 푸시발송 → lastboard 기록.
//   따라서 '첫 판독 시각'을 컷오프로 삼으면 그 배치표의 알림 배치는 온전히 남고, 이전 배치표
//   (보통 수 시간 전) 알림은 자연히 빠진다. 새 배치표가 뜨면 컷오프가 그 배치표로 옮겨가
//   이전 배치표 알림이 정리된다. lead(3분)는 푸시가 판독기록보다 살짝 앞서는 경우 대비.
//  board-reads.jsonl에서 최신 배치표 id의 첫 판독 시각(댓글 #c1 등은 같은 배치표로 묶음).
function boardPushCutoff(latestBoard, startToday, now) {
  const fallback = startToday - DAY;
  if (!latestBoard) return fallback;
  const baseId = String(latestBoard.articleId || '').split('#')[0];
  const reads = readJSONL('board-reads.jsonl', { sinceTs: now - 21 * DAY })
    .filter((r) => String(r.subject || '').includes('배치표'));
  let latestFirst = null;
  for (const r of reads) {
    if (baseId && String(r.articleId || '').split('#')[0] !== baseId) continue;
    if (latestFirst == null || r.at < latestFirst) latestFirst = r.at;
  }
  const base = latestFirst || latestBoard.at || fallback;
  return base - 3 * 60 * 1000;   // 첫 판독 3분 전(푸시가 기록보다 앞설 여유)
}

// ── 집계(모니터 사이트에서 호출) ─────────────────────────
export function computeStats(now = Date.now()) {
  const startToday = new Date(dayKey(now) + 'T00:00:00').getTime();
  const week = now - 7 * DAY, month = now - 30 * DAY;
  const days30 = lastDays(30, now), days14 = lastDays(14, now), days7 = lastDays(7, now);

  // 회원(users) + 프로필 — ★test/tester(체험·데모 계정)는 회원 집계·가입·접속·DAU에서 전부 제외.
  //  activeMembers·listMembersForAdmin은 이미 제외하지만 대시보드 KPI는 raw users를 세서 테스터가 잡히던 문제 수정.
  const users = all(`SELECT u.id, u.naver_id, u.google_id, u.created_at, u.last_login, u.last_seen, u.left_at, u.role, u.status,
                            p.board_name, p.part
                     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
                     WHERE u.role != 'test' AND u.role != 'tester' ORDER BY u.id`) || [];
  const active = users.filter((u) => u.status === 'active');
  const pending = users.filter((u) => u.status === 'pending');
  const disabled = users.filter((u) => u.status === 'disabled');
  const members = {
    total: users.length,
    active: active.length, pending: pending.length, disabled: disabled.length,
    admins: users.filter((u) => u.role === 'admin').length,
    naver: users.filter((u) => u.naver_id).length,
    google: users.filter((u) => u.google_id).length,
  };
  const signups = {
    today: users.filter((u) => (u.created_at || 0) >= startToday).length,
    week: users.filter((u) => (u.created_at || 0) >= week).length,
    month: users.filter((u) => (u.created_at || 0) >= month).length,
    daily: seriesByDay(users, days30, (u) => u.created_at || 0),
    byStatus: [
      { k: 'active', count: members.active },
      { k: 'pending', count: members.pending },
      { k: 'disabled', count: members.disabled },
    ],
    byProvider: [
      { k: 'naver', count: members.naver },
      { k: 'google', count: members.google },
    ],
  };

  // 세션(로그인) — 방문 보조 지표
  const sessions = all('SELECT user_id, created_at, expires_at, ua FROM sessions') || [];
  const sessDaily = seriesByDay(sessions, days30, (s) => s.created_at || 0);
  const sessInfo = {
    total: sessions.length,
    activeNow: sessions.filter((s) => (s.expires_at || 0) > now).length,
    last24h: sessions.filter((s) => (s.created_at || 0) >= now - DAY).length,
    daily: sessDaily,
  };

  // 방문(visits.jsonl) — 실제 앱 오픈. 없으면 세션으로 대체.
  const visitEvents = readJSONL('visits.jsonl', { sinceTs: month });
  const hasVisits = visitEvents.length > 0;
  const visitDaily = hasVisits ? seriesByDay(visitEvents, days30) : sessDaily;
  // DAU(최근 7일 순 방문자수)
  const dau = days7.map((d) => {
    const set = new Set();
    for (const v of visitEvents) if (dayKey(v.at) === d) set.add(v.uid);
    return { date: d, uniq: set.size };
  });
  // 재접속: 방문일이 2일 이상인 회원 비율
  const daysByUser = new Map();
  for (const v of visitEvents) {
    if (!daysByUser.has(v.uid)) daysByUser.set(v.uid, new Set());
    daysByUser.get(v.uid).add(dayKey(v.at));
  }
  const visitedUsers = daysByUser.size;
  const returningUsers = [...daysByUser.values()].filter((s) => s.size >= 2).length;
  const visits = {
    source: hasVisits ? 'visits' : 'sessions',
    total: hasVisits ? visitEvents.length : sessions.length,
    today: hasVisits ? visitEvents.filter((v) => v.at >= startToday).length : sessInfo.last24h,
    daily: visitDaily,
    dau,
    visitedUsers, returningUsers,
    returningRate: visitedUsers ? Math.round((returningUsers / visitedUsers) * 100) : 0,
  };

  // 회원 현황(접속 상태) — 전 회원 각자 지금 접속 중인지/나갔는지 + 마지막 방문 시각.
  //  online = 앱을 닫은 뒤(left_at) 이후로 활동이 있고(last_seen>left_at) + 활동이 STALE 이내(크래시 대비 폴백).
  //   → 정상 종료 시 즉시 오프라인, 강제종료/네트워크 끊김이면 STALE(기본 90초) 지나 자동 오프라인.
  const ONLINE_MS = Number(process.env.ONLINE_WINDOW_MS || 90000);
  const presenceRows = users.map((u) => ({
    id: u.id, name: u.board_name || '(이름미설정)', part: u.part || '', role: u.role, status: u.status,
    lastSeen: u.last_seen || null, lastLogin: u.last_login || null,
    online: !!(u.last_seen && (now - u.last_seen) < ONLINE_MS && u.last_seen > (u.left_at || 0)),
  }));
  presenceRows.sort((a, b) => (Number(b.online) - Number(a.online))
    || ((b.lastSeen || b.lastLogin || 0) - (a.lastSeen || a.lastLogin || 0)) || a.id - b.id);
  const presence = { onlineNow: presenceRows.filter((r) => r.online).length, staleSec: Math.round(ONLINE_MS / 1000), members: presenceRows };
  // (호환) 최근 접속 회원 — 마지막 방문/로그인 순 상위
  const recentLogins = presenceRows.slice(0, 20).map((u) => ({ id: u.id, name: u.name, part: u.part,
    role: u.role, status: u.status, lastLogin: u.lastSeen || u.lastLogin }));

  // 배치표 이해도 — 전체 판독(board-reads.jsonl) + 불확실(uncertain-log.jsonl)
  const reads = readJSONL('board-reads.jsonl', { sinceTs: month });
  const boardReads = reads.filter((r) => !r.category || String(r.category).includes('배치'));
  const uncFromReads = boardReads.filter((r) => r.uncertain);
  const uncLog = readJSONL('uncertain-log.jsonl', { sinceTs: month });
  const confVals = boardReads.map((r) => r.confidence).filter((c) => typeof c === 'number');
  const avgConf = confVals.length ? Math.round((confVals.reduce((a, b) => a + b, 0) / confVals.length) * 100) / 100 : null;
  const confBuckets = [
    { k: '≥0.9', count: confVals.filter((c) => c >= 0.9).length },
    { k: '0.7–0.9', count: confVals.filter((c) => c >= 0.7 && c < 0.9).length },
    { k: '0.5–0.7', count: confVals.filter((c) => c >= 0.5 && c < 0.7).length },
    { k: '<0.5', count: confVals.filter((c) => c < 0.5).length },
  ];
  const totalReads = boardReads.length;
  const uncertainCount = uncFromReads.length || uncLog.length;
  const board = {
    hasReadLog: reads.length > 0,
    totalReads,
    reads7: seriesByDay(boardReads, days14),
    uncertain: uncertainCount,
    uncertainRate: totalReads ? Math.round((uncFromReads.length / totalReads) * 100) : null,
    avgConfidence: avgConf,
    confBuckets,
    byReason: tally(uncLog, (u) => u.reason || '기타').slice(0, 8),
    byPart: tally(uncLog, (u) => (u.part ? `${u.part}부` : '?')),
    recentUncertain: uncLog.slice(-12).reverse().map((u) => ({
      at: u.at, subject: u.subject || '', reason: u.reason || '', confidence: u.confidence ?? null,
      part: u.part || '', status: u.status || '',
    })),
    understoodRate: totalReads ? Math.round(((totalReads - uncFromReads.length) / totalReads) * 100) : null,
  };

  // 기기 텔레메트리(플랫폼·구독)
  const tel = loadJSON('telemetry.json', {}) || {};
  const telArr = Object.values(tel);
  const devices = {
    reported: telArr.length,
    subscribed: telArr.filter((t) => t.subscribed).length,
    standalone: telArr.filter((t) => t.standalone).length,
    platforms: tally(telArr, (t) => t.platform || '기타'),
    subsInDb: (get('SELECT COUNT(*) c FROM push_subscriptions') || {}).c || 0,
  };

  // 시스템 상태(크롤러 하트비트)
  const health = loadJSON('health.json', null);

  // 최근 판독 피드(1번 회원 recent.json — 대표 예시)
  const feed = (loadUserJSON(1, 'recent.json', null) || loadJSON('recent.json', []) || [])
    .slice(0, 8)
    .map((r) => ({ subject: r.subject, status: r.status, category: r.category, push: r.push,
      relevant: r.relevant, at: r.detectedAt || r.writeDate || 0, aiMessage: r.aiMessage || '' }));

  // 발송 알림 — sent-push.jsonl. ★목적: '각 회원에게 맞는 알림이 제대로 갔는지' 점검.
  //  ★표시 범위 = '최신 배치표 판독 시각 이후'. 새 배치표가 뜨면 그 시각으로 컷오프가 옮겨가
  //   이전 배치표 관련 알림은 자동으로 화면에서 빠진다(로그 파일은 보존 — 표시만 정리).
  const latestBoard = buildLatestBoard();
  const boardCutoff = boardPushCutoff(latestBoard, startToday, now);
  const nameById = new Map(users.map((u) => [u.id, u.board_name || `#${u.id}`]));
  const partById = new Map(users.map((u) => [u.id, u.part || '']));
  const statusById = new Map(users.map((u) => [u.id, u.status]));
  const yStart = startToday - DAY; // 어제 00:00(KST)
  const readFloor = Math.min(yStart, boardCutoff);  // 오늘/어제 카운트도 유지하려 더 이른 시점부터 읽음
  const sentPushAll = readJSONL('sent-push.jsonl', { sinceTs: readFloor });
  const sentPush = sentPushAll.filter((p) => p.at >= boardCutoff);   // 회원별 목록은 최신 배치표 이후만
  const fmtPush = (p) => ({ at: p.at, title: p.title || '', body: p.body || '', level: p.level || 'normal', sent: p.sent ?? null, devices: p.devices ?? null });
  const byUid = new Map();
  for (const p of sentPush) { if (!byUid.has(p.uid)) byUid.set(p.uid, []); byUid.get(p.uid).push(p); }
  const memberRows = [];
  const shown = new Set();
  for (const u of active) { // 알림을 받아야 하는 활성 회원 — 발송 0건이어도 노출(누락 점검)
    const items = (byUid.get(u.id) || []).sort((a, b) => b.at - a.at).map(fmtPush);
    memberRows.push({ uid: u.id, name: u.board_name || `#${u.id}`, part: u.part || '', status: u.status, count: items.length, items });
    shown.add(u.id);
  }
  for (const [uid, arr] of byUid) { // 활성 명단 밖(대기/차단)인데 알림이 나간 경우 — 오발송 점검
    if (shown.has(uid)) continue;
    memberRows.push({ uid, name: nameById.get(uid) || `#${uid}`, part: partById.get(uid) || '', status: statusById.get(uid) || '', count: arr.length, items: arr.sort((a, b) => b.at - a.at).map(fmtPush) });
  }
  // 발송 있는 회원 먼저(최근 발송 순), 발송 없는 회원은 뒤로
  memberRows.sort((a, b) => (b.items[0]?.at || 0) - (a.items[0]?.at || 0) || a.uid - b.uid);
  const pushes = {
    range: { from: boardCutoff, to: now },
    boardAt: (latestBoard && latestBoard.at) || null,
    boardLabel: (latestBoard && latestBoard.dateLabel) || '',
    boardSubject: (latestBoard && latestBoard.subject) || '',
    sinceBoard: sentPush.length,                                    // 최신 배치표 이후 발송 건수
    sentToday: sentPushAll.filter((p) => p.at >= startToday).length,
    sentYesterday: sentPushAll.filter((p) => p.at >= yStart && p.at < startToday).length,
    total: sentPushAll.length,
    byMember: memberRows,
  };

  return { generatedAt: now, members, signups, sessions: sessInfo, visits, presence, recentLogins, board, devices, health, feed, pushes, latestBoard };
}
