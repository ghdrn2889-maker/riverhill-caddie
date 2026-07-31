// 운영 모니터링용 기록·집계. 본 앱은 record*()로 이벤트만 남기고,
//  별도 모니터링 사이트(src/monitor.mjs)가 computeStats()로 한 눈에 보여준다.
//  ★모두 부가 기능 — 기존 알림/판독 경로에 영향 없음(append-only, 실패해도 조용).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, appendJSONL, loadJSON, loadUserJSON } from './store.mjs';
import { all, get, run } from './db.mjs';
import { analyzeRoster, analyzeInterns, analyzePartTeams } from './gemini.mjs';
import { getBoardPart } from './boardparts.mjs';

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
  const workLimit = cutoffPos || teamCount || 0;   // 근무 확정선(없으면 티오프표 유무로)
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
  // 부별 데이터 소스: 신형(lastboard-parts) 우선, 없으면 구형(lastboard 3부 + user1 today).
  let partsSrc = (lbp && lbp.parts) || null;
  if (!partsSrc) {
    const v = (lb && lb.rawVerdict) ? lb.rawVerdict : {};
    const t1 = loadUserJSON(1, 'today.json', null) || {};
    partsSrc = { 3: {
      roster: (Array.isArray(v.part3Roster) && v.part3Roster.length) ? v.part3Roster : (Array.isArray(t1.roster3) ? t1.roster3 : []),
      teamCount: v.teamCount, teeGrid: (Array.isArray(v.teeGrid) && v.teeGrid.length) ? v.teeGrid : t1.teeGrid,
      cutoffName: v.cutoffName || t1.cutoffName, cutoffPosition: v.cutoffPosition || t1.cutoffPosition,
      internCount: v.internCount || t1.internCount, internTees: (v.internTees && v.internTees.length) ? v.internTees : t1.internTees,
      swaps: v._swaps, reliable: v.rosterReliable, uncertain: v._uncertain,
    } };
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

// ★모니터 전용 — 앱을 건드리지 않고 모니터가 '직접' 1·2·3부 부별 판독(온디맨드, board별 1회 캐시).
//  3부는 앱이 저장한 lastboard.json(rawVerdict)을 재사용(추가 판독 0), 1·2부만 새로 판독.
//  각 부 근무자(순번≤팀수)를 교차해 두 탕(🔁)도 산출. 관리자만 보는 판독검증 탭의 데이터.
let _boardPartsCache = { key: null, data: null };
export async function computeBoardParts() {
  const lb = loadJSON('lastboard.json', null);
  if (!lb || !lb.article) return null;
  const id = String(lb.id || '');
  // ★캐시 키에 판독시각(at) 포함 — 같은 배치표가 재판독(recheck/수정)되면 lastboard.at이 바뀌어
  //  캐시가 자동 갱신된다. (id만으로 걸면 첫 판독본을 계속 보여줘 모니터가 스테일되던 문제 수정)
  const key = `${id}|${lb.at || ''}`;
  if (_boardPartsCache.key === key) return _boardPartsCache.data;   // 같은 배치표+같은 판독시각이면 캐시
  try {
    const article = lb.article;
    const v3 = lb.rawVerdict || {};
    const teams = await analyzePartTeams(article);                 // 상단 헤더 "N부 M" 팀수
    const partsSrc = {};
    for (const p of ['1', '2', '3']) {
      const tc = Number(teams[p]) || (p === '3' ? (Number(v3.teamCount) || 0) : 0);
      let roster = [], teeGrid = [], internCount = 0, internTees = [], cutoffName = '', cutoffPosition = null, swaps = [], reliable = false, uncertain = '';
      if (p === '3') {                                             // 3부는 앱 저장분 재사용(추가 판독 없음)
        roster = (Array.isArray(v3.part3Roster) && v3.part3Roster.length) ? v3.part3Roster : await analyzeRoster(article, '3');
        teeGrid = Array.isArray(v3.teeGrid) ? v3.teeGrid : [];
        internCount = Number(v3.internCount) || 0; internTees = Array.isArray(v3.internTees) ? v3.internTees : [];
        cutoffName = v3.cutoffName || ''; cutoffPosition = Number(v3.cutoffPosition) || null;
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
      partsSrc[p] = { roster, teamCount: tc || null, teeGrid, internCount, internTees, cutoffName, cutoffPosition, swaps, reliable, uncertain };
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
      at: lb.at || null, articleId: id, subject: art.subject || '', writer: art.writer || '',
      writeDate: art.writeDate || null, dateLabel: v3.dateLabel || lb.dateLabel || '',
      image: (Array.isArray(art.images) && art.images[0]) || '', url: art.url || '',
      model: process.env.GEMINI_BOARD_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest',
      comments: (Array.isArray(art.comments) ? art.comments : []).map((c) => String(c.content || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
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

  // 회원(users) + 프로필
  const users = all(`SELECT u.id, u.naver_id, u.google_id, u.created_at, u.last_login, u.last_seen, u.left_at, u.role, u.status,
                            p.board_name, p.part
                     FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.id`) || [];
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
