// 칠판(dayboard) — 하루치 배치표를 시각순 이벤트로 스스로 갱신하는 단일 진실원.
//  사용자 확정 아키텍처: "거대한 칠판에 그날의 배치표를 크게 적어두고, 업데이트가 올라올 때마다
//  시간 순서대로 칠판을 고쳐 쓴다." 이미지든 구두(텍스트)든 전부 동등한 '갱신 이벤트'.
//
//  저장: data/dayboard-YYYY-MM-DD.json = { date, updatedAt, log:[event], board }
//   log  = 들어온 이벤트 원본(시각·출처·종류·페이로드) — 절대 소실 안 함(감사·재현용).
//   board= log 를 시각순으로 fold 한 '지금 이 순간의 확정 상태'(파생물, 언제든 재계산 가능).
//
//  불변식: 리듀스는 순수함수 — 같은 log 를 다시 먹이면 같은 board (순서 무관·멱등).
//  각 화면(대시보드·알림·판독·검수)은 board 에서만 파생 → 낡은 값이 남을 자리가 없음.
import { loadJSON, saveJSON, DATA_DIR } from './store.mjs';
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s == null ? '' : s).trim();
const normCourse = (c) => {
  const t = norm(c).toUpperCase();
  if (t === 'OUT' || t === 'O' || t.includes('아웃')) return 'OUT';
  if (t === 'IN' || t === 'I' || t.includes('인')) return 'IN';
  return '';
};
const normTime = (t) => {
  const m = norm(t).match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return '';
  const h = String(Math.min(23, Number(m[1]))).padStart(2, '0');
  return `${h}:${m[2]}`;
};
// 이름에서 배치표 표기 꼬리(괄호·대기·인턴 등)를 떼 순수 이름만 — 대조/색인용.
const bareName = (n) => norm(n).replace(/\([^)]*\)/g, '').replace(/\s+/g, '').replace(/[0-9]/g, '');

function fileFor(date) { return `dayboard-${date}.json`; }

export function loadDayboard(date) {
  const d = loadJSON(fileFor(date), null);
  if (d && d.date === date) return d;
  return { date, updatedAt: 0, seq: 0, log: [], board: emptyBoard() };
}

function emptyBoard() { return { cut: 0, teams: {} }; }

// ── 이벤트 추가 → 재리듀스 → 저장. 같은 id 재수신은 무시(멱등). ──
export function addEvent(date, ev) {
  const db = loadDayboard(date);
  const id = norm(ev.id) || `${ev.source || 'x'}:${ev.at || 0}:${ev.kind || '?'}`;
  if (db.log.some((e) => e.id === id)) return db;            // 중복 방지
  const seq = (db.seq || 0) + 1;
  db.seq = seq;
  db.log.push({
    id,
    at: Number(ev.at) || 0,
    seq,
    source: norm(ev.source) || 'text',                       // 'image' | 'text' | 'comment'
    kind: norm(ev.kind) || 'note',
    payload: ev.payload || {},
    note: norm(ev.note),
  });
  db.board = reduce(db.log);
  db.updatedAt = maxAt(db.log);
  saveJSON(fileFor(date), db);
  return db;
}

function maxAt(log) { let m = 0; for (const e of log) if (e.at > m) m = e.at; return m; }

// ── 순수 리듀서: log 를 (at, seq) 오름차순으로 fold → board ──
//  종류별 규칙:
//   board_full : 이미지 배치표 전체 판독 → 칠판을 크게 새로 씀(teams·cut 교체)
//   cut        : "28번까지 근무" → 컷 선만 이동
//   tee        : "장성원 18:45 out" → 그 사람/순번의 티오프만 수정
//   roster     : 텍스트 순번표(티오프 없음) → 순번↔이름만 병합(기존 티오프 유지)
//   position   : "도대영 3부 27번" → 한 사람 순번 배치
//   swap       : 대바 → 두 순번의 이름 교환
export function reduce(log) {
  const ordered = [...log].sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
  let board = emptyBoard();
  for (const e of ordered) board = applyEvent(board, e);
  return board;
}

function applyEvent(board, e) {
  const b = { cut: board.cut, teams: { ...board.teams } };
  const p = e.payload || {};
  switch (e.kind) {
    case 'board_full': {
      const teams = {};
      for (const t of (Array.isArray(p.teams) ? p.teams : [])) {
        const pos = Number(t.pos); if (!(pos > 0)) continue;
        teams[pos] = {
          pos, name: norm(t.name),
          tee: normTime(t.tee || t.time), course: normCourse(t.course),
          spare: !!t.spare,
        };
      }
      b.teams = teams;
      if (Number(p.cut) > 0) b.cut = Number(p.cut);
      else { let mx = 0; for (const k of Object.keys(teams)) if (!teams[k].spare && Number(k) > mx) mx = Number(k); b.cut = mx; }
      break;
    }
    case 'cut': {
      if (Number(p.cut) > 0) b.cut = Number(p.cut);
      break;
    }
    case 'tee': {
      const pos = resolvePos(b, p);
      if (pos > 0) {
        const cur = b.teams[pos] || { pos, name: norm(p.name), spare: false };
        b.teams[pos] = { ...cur, pos, tee: normTime(p.tee || p.time) || cur.tee, course: normCourse(p.course) || cur.course, name: cur.name || norm(p.name) };
      }
      break;
    }
    case 'roster': {
      for (const t of (Array.isArray(p.teams) ? p.teams : [])) {
        const pos = Number(t.pos); if (!(pos > 0)) continue;
        const cur = b.teams[pos] || { pos, tee: '', course: '' };
        b.teams[pos] = { ...cur, pos, name: norm(t.name), spare: t.spare != null ? !!t.spare : !!cur.spare };
      }
      break;
    }
    case 'position': {
      const pos = Number(p.pos); if (pos > 0) {
        const cur = b.teams[pos] || { pos, tee: '', course: '' };
        b.teams[pos] = { ...cur, pos, name: norm(p.name), spare: p.spare != null ? !!p.spare : !!cur.spare };
      }
      break;
    }
    case 'swap': {
      const pa = resolvePos(b, p.a || {}), pb = resolvePos(b, p.b || {});
      if (pa > 0 && pb > 0 && pa !== pb && b.teams[pa] && b.teams[pb]) {
        const na = b.teams[pa].name, nb = b.teams[pb].name;
        b.teams[pa] = { ...b.teams[pa], name: nb };
        b.teams[pb] = { ...b.teams[pb], name: na };
      }
      break;
    }
    default: break;   // note 등 — board 변화 없음(감사 기록만)
  }
  return b;
}

// 이벤트 대상 순번 해석 — pos 우선, 없으면 이름으로 색인.
function resolvePos(board, sel) {
  if (Number(sel.pos) > 0) return Number(sel.pos);
  const want = bareName(sel.name);
  if (!want) return 0;
  for (const k of Object.keys(board.teams)) {
    if (bareName(board.teams[k].name) === want) return Number(k);
  }
  return 0;
}

// ── board → 순번 1..N 배열(정렬) ──
//  spare 는 저장값이 아니라 '컷에서 파생' — 컷이 이동하면 근무/스페어가 즉시 따라감(낡은 spare 방지).
export function teamsArray(board) {
  const out = [];
  const max = Math.max(0, ...Object.keys(board.teams).map(Number));
  for (let i = 1; i <= max; i++) {
    const t = board.teams[i] || { pos: i, name: '', tee: '', course: '' };
    const spare = board.cut > 0 ? i > board.cut : !!t.spare;
    out.push({ ...t, pos: i, spare });
  }
  return out;
}

export function teeForPos(board, pos) {
  const t = board.teams[Number(pos)];
  return t ? { tee: t.tee || '', course: t.course || '' } : { tee: '', course: '' };
}

// ── 검증 규칙(사용자 규칙 = 낡음 탐지기) ──
//  1) 한 티오프 시각 = 최대 2명(OUT 1·IN 1). 3명↑ 또는 같은 코스 2명 → 그리드 낡음.
//  2) 컷 이내인데 티오프 없음 → 미확정.
//  3) 티오프가 있는 최대 순번 < 컷 → 티오프 부족(낡음 신호).
export function validate(board) {
  const issues = [];
  const byTime = {};
  for (const t of teamsArray(board)) {
    if (t.spare) continue;
    if (t.pos <= board.cut && !t.tee) issues.push({ level: 'warn', kind: 'missing_tee', pos: t.pos, name: t.name, msg: `${t.pos}번(${t.name || '?'}) 컷 이내인데 티오프 미확정` });
    if (!t.tee) continue;
    (byTime[t.tee] ||= []).push(t);
  }
  for (const time of Object.keys(byTime)) {
    const arr = byTime[time];
    if (arr.length > 2) issues.push({ level: 'error', kind: 'overfull_time', time, msg: `${time} 에 ${arr.length}명 — 한 시각 최대 2명(OUT·IN) 위반 → 그리드 낡음` });
    const outs = arr.filter((x) => x.course === 'OUT'), ins = arr.filter((x) => x.course === 'IN');
    if (outs.length > 1) issues.push({ level: 'error', kind: 'dup_course', time, course: 'OUT', msg: `${time} OUT 코스 ${outs.length}명 중복` });
    if (ins.length > 1) issues.push({ level: 'error', kind: 'dup_course', time, course: 'IN', msg: `${time} IN 코스 ${ins.length}명 중복` });
  }
  let maxTeePos = 0;
  for (const t of teamsArray(board)) if (t.tee && t.pos > maxTeePos) maxTeePos = t.pos;
  if (board.cut > 0 && maxTeePos < board.cut) issues.push({ level: 'error', kind: 'grid_short', msg: `티오프 최대순번 ${maxTeePos} < 컷 ${board.cut} — 최신 배치표 티오프 필요(낡음)` });
  return issues;
}

// 최신 칠판 상태 요약(모니터 대조용).
export function summarize(date) {
  const db = loadDayboard(date);
  return { date, cut: db.board.cut, updatedAt: db.updatedAt, events: db.log.length, teams: teamsArray(db.board), issues: validate(db.board) };
}

// ── 어댑터: 기존 판독 결과(rawVerdict)+글을 칠판 이벤트로 번역(섀도우 피드) ──
//  이미지 배치표 → board_full(로스터+티오프+컷 전체) / 텍스트 컷 → cut / 텍스트 티오프 → tee.
//  기존 시스템이 이미 계산한 필드를 재사용 — 재파싱 최소화, 3부 경로 불변.
export function eventsFromVerdict(article, rv = {}) {
  const events = [];
  const at = Number(article.writeDate || article.at) || 0;
  const id = String(article.id || `${at}`);
  const roster = Array.isArray(rv.part3Roster) ? rv.part3Roster : [];
  const grid = Array.isArray(rv.teeGrid) ? rv.teeGrid : [];
  const hasImage = Array.isArray(article.images) && article.images.length > 0;
  const cut = Number(rv.cutoffPosition) || Number(rv.teamCount) || 0;

  if (hasImage && (roster.length || grid.length)) {
    const byPos = {};
    roster.forEach((nm, i) => { const pos = i + 1; byPos[pos] = { pos, name: norm(nm), spare: false }; });
    for (const g of grid) {
      const pos = Number(g.pos); if (!(pos > 0)) continue;
      byPos[pos] = { ...(byPos[pos] || { pos, name: '' }), tee: normTime(g.time || g.tee), course: normCourse(g.course) };
    }
    const teams = Object.values(byPos).map((t) => ({ ...t, spare: cut > 0 ? t.pos > cut : !!t.spare }));
    events.push({ id: `${id}:board`, at, source: 'image', kind: 'board_full', payload: { teams, cut } });
  } else if (cut > 0) {
    events.push({ id: `${id}:cut:${cut}`, at, source: 'text', kind: 'cut', payload: { cut }, note: norm(rv.cutoffName) });
  }
  return events;
}

// 섀도우 인제스트 — 절대 throw 안 함(3부 경로 보호). 칠판 파일에만 기록.
export function ingestVerdict(date, article, rv) {
  try {
    if (!date) return null;
    for (const ev of eventsFromVerdict(article, rv || {})) addEvent(date, ev);
    return summarize(date);
  } catch (e) { return { error: e.message }; }
}

// 존재하는 칠판 날짜 목록.
export function listDayboardDates() {
  try {
    return fs.readdirSync(DATA_DIR)
      .map((f) => (f.match(/^dayboard-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
      .filter(Boolean).sort();
  } catch { return []; }
}
