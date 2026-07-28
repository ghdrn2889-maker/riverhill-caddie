// 운영 모니터링용 기록·집계. 본 앱은 record*()로 이벤트만 남기고,
//  별도 모니터링 사이트(src/monitor.mjs)가 computeStats()로 한 눈에 보여준다.
//  ★모두 부가 기능 — 기존 알림/판독 경로에 영향 없음(append-only, 실패해도 조용).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, appendJSONL, loadJSON, loadUserJSON } from './store.mjs';
import { all, get, run } from './db.mjs';

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
function buildLatestBoard() {
  const lb = loadJSON('lastboard.json', null);
  const t1 = loadUserJSON(1, 'today.json', null) || {};
  const v = (lb && lb.rawVerdict) ? lb.rawVerdict : {};
  const roster = (Array.isArray(v.part3Roster) && v.part3Roster.length) ? v.part3Roster
    : (Array.isArray(t1.roster3) ? t1.roster3 : []);
  if (!roster.length) return null;
  const cutoffPos = Number(v.cutoffPosition) > 0 ? Number(v.cutoffPosition)
    : (Number(t1.cutoffPosition) > 0 ? Number(t1.cutoffPosition) : 0);
  const teamCount = Number(v.teamCount) > 0 ? Number(v.teamCount) : null;
  const teeGrid = (Array.isArray(v.teeGrid) && v.teeGrid.length) ? v.teeGrid
    : (Array.isArray(t1.teeGrid) ? t1.teeGrid : []);
  const teeByPos = new Map(teeGrid.map((g) => [Number(g.pos), g]));
  const workLimit = cutoffPos || teamCount || 0;   // 근무 확정선(없으면 티오프표 유무로)
  const rows = roster.map((cell, i) => {
    const pos = i + 1;
    const g = teeByPos.get(pos);
    const work = workLimit > 0 ? pos <= workLimit : !!g;
    return {
      pos, name: String(cell || ''),
      work,
      spareRank: (!work && workLimit > 0) ? (pos - workLimit) : null,
      tee: g ? (String(g.time || '').match(/\d{1,2}:\d{2}/) || [''])[0] : '',
      course: g ? String(g.course || '') : '',
      isCut: workLimit > 0 && pos === workLimit,
    };
  });
  const art = (lb && lb.article) || {};
  return {
    at: (lb && lb.at) || null,
    articleId: (lb && lb.id) || v.articleId || '',
    subject: art.subject || '',
    writer: art.writer || '',
    writeDate: art.writeDate || null,
    dateLabel: v.dateLabel || (lb && lb.dateLabel) || '',
    image: (Array.isArray(art.images) && art.images[0]) || '',
    url: art.url || '',
    model: process.env.GEMINI_BOARD_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest',
    cutoffName: v.cutoffName || t1.cutoffName || '',
    cutoffPosition: cutoffPos || null,
    teamCount,
    internCount: Number(v.internCount) > 0 ? Number(v.internCount) : (Number(t1.internCount) > 0 ? Number(t1.internCount) : 0),
    internTees: (Array.isArray(v.internTees) && v.internTees.length) ? v.internTees
      : (Array.isArray(t1.internTees) ? t1.internTees : []),
    swaps: Array.isArray(v._swaps) ? v._swaps : [],
    uncertain: v._uncertain || '',
    reliable: !!v.rosterReliable,
    comments: (Array.isArray(art.comments) ? art.comments : [])
      .map((c) => String(c.content || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
    workCount: rows.filter((r) => r.work).length,
    spareCount: rows.filter((r) => !r.work).length,
    total: rows.length,
    rows,
  };
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
  //  범위는 어제~오늘 고정. 회원별로 묶어(발송 없는 회원도 노출) 문구까지 그대로 보여준다.
  const nameById = new Map(users.map((u) => [u.id, u.board_name || `#${u.id}`]));
  const partById = new Map(users.map((u) => [u.id, u.part || '']));
  const statusById = new Map(users.map((u) => [u.id, u.status]));
  const yStart = startToday - DAY; // 어제 00:00(KST)
  const sentPush = readJSONL('sent-push.jsonl', { sinceTs: yStart });
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
    range: { from: yStart, to: now },
    sentToday: sentPush.filter((p) => p.at >= startToday).length,
    sentYesterday: sentPush.filter((p) => p.at >= yStart && p.at < startToday).length,
    total: sentPush.length,
    byMember: memberRows,
  };

  const latestBoard = buildLatestBoard();

  return { generatedAt: now, members, signups, sessions: sessInfo, visits, presence, recentLogins, board, devices, health, feed, pushes, latestBoard };
}
