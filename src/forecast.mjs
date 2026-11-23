// ══ 순번 계산기 — "내 순번이 일이 될까" ═════════════════════════════════════════
//  관리자 모니터 전용(/forecast). 회원 앱·알림과는 이어져 있지 않다(사용자 2026-11-23
//  "예약 수집은 다시 켜는데 앱과의 연결은 끊고 이 대시보드에만 넣어").
//
//  두 가지를 센다.
//   ① 스페어 칸마다 '일 될 가능성' — 배치표가 올라온 뒤 그 부 예약이 몇 팀 더 늘었나(지난 기록).
//      늘어난 팀 수는 '두 시각의 예약 수 차이'라, 시간표에 없는 칸을 찬 칸으로 잘못 세는 문제가 빼기에서 지워진다.
//   ② 앞으로 며칠 부별 예상 팀 수 — 지금 예약 수 + (지난 날들이 같은 시점부터 배치표까지 더 늘어난 만큼).
//      이건 예약 수 그 자체를 쓰므로, 고정 시간표와 그날 시간표가 어긋나는 날은 계산하지 않는다.
//  ★3부는 둘 다 계산하지 않는다 — 해가 짧아진 9월부터 안 여는 칸을 찬 칸으로 센다(고치는 중).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadJSON, saveJSON } from './store.mjs';
import { buildBoardsView } from './boardsview.mjs';
import { isPartClosed } from './closure.mjs';
import { loadSnapshot, fixedSlots, holdSlots, flexSlots } from './kakaogolf.mjs';
import { teeHealth } from './teescanner.mjs';

const KST = 9 * 3600e3;
const isoOfMs = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
const ymdOfISO = (iso) => String(iso || '').replace(/-/g, '');
const dayStart = (ymd) => Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`);
const partOfKey = (k) => { const [h, m] = String(k).split('|')[0].split(':').map(Number); const t = h * 60 + m; return t < 600 ? '1' : t < 900 ? '2' : '3'; };
const PART_START = { 1: '06:00', 2: '10:30' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const wkType = (ymd) => { const d = new Date(dayStart(ymd) + KST).getUTCDay(); return (d === 0 || d === 6) ? '주말' : '평일'; };

const quant = (arr, q) => { const b = arr.slice().sort((x, y) => x - y); if (!b.length) return 0; return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };

// ── 예약 기록·정답(배치표 팀 수) 읽기 — 파일이 바뀌었을 때만 다시 읽는다 ──────────────
let _cache = { sig: '', series: null, truth: null };
function sigOf(f) { try { const s = fs.statSync(path.join(DATA_DIR, f)); return `${s.size}:${s.mtimeMs}`; } catch { return '0'; } }
function readLines(f, fn) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(DATA_DIR, f), 'utf8'); } catch { return; }
  for (const l of txt.split('\n')) { if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; } fn(j); }
}
function history() {
  const sig = sigOf('kakao-golf.jsonl') + '|' + sigOf('kakao-score.jsonl');
  if (_cache.sig === sig) return _cache;
  const truth = {};
  readLines('kakao-score.jsonl', (j) => {
    if (!j.parts || !j.date) return;
    const t = truth[j.date] || (truth[j.date] = {});
    for (const [p, v] of Object.entries(j.parts)) if (v && v.board > 0) t[p] = { board: v.board, boardAt: v.boardAt || j.at };
  });
  const byDate = {};
  readLines('kakao-golf.jsonl', (j) => { if (j.date) (byDate[j.date] || (byDate[j.date] = [])).push(j); });
  // ★해 뜨기 전 칸 — 겨울엔 06:30~06:58이 아예 없다(11/24 실측: 그 10칸이 한 번도 판매중이 아닌데 '찬 칸'으로 셌다).
  //  그날 1부에서 한 번이라도 판매중이던 가장 이른 칸보다 앞선 칸은 '없는 칸'으로 뺀다.
  //  여름엔 첫 관측(열하루 전)에 06:30이 판매중이라 아무것도 안 빠진다.
  //  비워두는 칸(06:23 같은 hold·flex)은 판정 대상이 아니라 '찬 칸'에도 없다 — 판매중으로 착각하지 않게 뺀다.
  const kOf = (x) => `${x.time}|${x.course}`;
  const notJudged = new Set([...holdSlots(), ...flexSlots()].map(kOf));
  const fixed1 = fixedSlots().map(kOf).filter((k) => partOfKey(k) === '1' && !notJudged.has(k));
  const mins = (k) => { const [h, m] = String(k).split('|')[0].split(':').map(Number); return h * 60 + m; };
  const series = {};
  for (const [date, recs] of Object.entries(byDate)) {
    const first = new Set(recs[0].newBooked || []);
    const ever = new Set(fixed1.filter((k) => !first.has(k)));
    for (const r of recs) for (const k of r.freed || []) if (partOfKey(k) === '1') ever.add(k);
    const edge = ever.size ? Math.min(...[...ever].map(mins)) : 0;
    const s = new Set();
    for (const j of recs) {
      for (const k of j.newBooked || []) s.add(k);
      for (const k of j.freed || []) s.delete(k);
      const c = { 1: 0, 2: 0, 3: 0 };
      for (const k of s) { const p = partOfKey(k); if (p === '1' && mins(k) < edge) continue; c[p]++; }
      (series[date] || (series[date] = [])).push({ at: j.at, c });
    }
  }
  _cache = { sig, series, truth };
  return _cache;
}
const bookedAt = (series, ymd, T) => { let r = null; for (const e of series[ymd] || []) { if (e.at <= T) r = e; else break; } return r; };

// 배치표가 올라온 뒤 시작 한 시간 전까지 늘어난 팀 수(부별) — 스페어 가능성의 근거
function growthAfterBoard(H) {
  const out = { 1: [], 2: [] };
  for (const [ymd, t] of Object.entries(H.truth)) for (const p of ['1', '2']) {
    const v = t[p]; if (!v) continue;
    const a = bookedAt(H.series, ymd, v.boardAt);
    const b = bookedAt(H.series, ymd, Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${PART_START[p]}:00+09:00`) - 3600e3);
    if (a && b) out[p].push({ ymd, grow: b.c[p] - a.c[p] });
  }
  return out;
}

// 같은 시점(그 날 0시 기준 몇 시간 전)에 지난 날들은 배치표까지 몇 팀이 더 붙었나
function offsetsAtLead(H, p, leadH, { wk = '', limit = 21 } = {}) {
  const rows = [];
  for (const ymd of Object.keys(H.truth).sort().reverse()) {
    const v = H.truth[ymd][p]; if (!v) continue;
    const T = dayStart(ymd) + leadH * 3600e3;
    if (T > v.boardAt) continue;
    const e = bookedAt(H.series, ymd, T); if (!e) continue;
    rows.push({ ymd, off: v.board - e.c[p], wk: wkType(ymd) });
    if (rows.length >= limit * 2) break;
  }
  const same = rows.filter((r) => r.wk === wk);
  return (same.length >= 4 ? same : rows).slice(0, limit);
}

// 채점표 — 예약 수만 보고 배치표 팀 수 맞히기(그 날은 빼고 남의 날로만 배운다)
const LEADS = [['3일 전 저녁', -3 * 24 + 20], ['2일 전 저녁', -2 * 24 + 20], ['전날 낮 12시', -12], ['배치표 1시간 전', null]];
let _score = { sig: '', rows: [] };
function scoreTable(H) {
  if (_score.sig === H.sig) return _score.rows;
  const rows = [];
  for (const [ymd, t] of Object.entries(H.truth)) for (const p of ['1', '2']) {
    const v = t[p]; if (!v) continue;
    for (const [lbl, h] of LEADS) {
      const T = h == null ? v.boardAt - 3600e3 : dayStart(ymd) + h * 3600e3;
      if (T > v.boardAt) continue;
      const e = bookedAt(H.series, ymd, T); if (!e) continue;
      rows.push({ ymd, p, lbl, booked: e.c[p], board: v.board, wk: wkType(ymd) });
    }
  }
  const acc = {};
  for (const r of rows) {
    const peers = rows.filter((x) => x.p === r.p && x.lbl === r.lbl && x.ymd !== r.ymd && x.wk === r.wk);
    if (peers.length < 4) continue;
    const err = Math.abs(r.booked + quant(peers.map((x) => x.board - x.booked), 0.5) - r.board);
    const o = acc[`${r.lbl}|${r.p}`] || (acc[`${r.lbl}|${r.p}`] = { n: 0, sum: 0, w2: 0 });
    o.n++; o.sum += err; if (err <= 2) o.w2++;
  }
  const out = LEADS.map(([lbl]) => {
    const row = { lbl };
    for (const p of ['1', '2']) { const o = acc[`${lbl}|${p}`]; row[p] = o ? { n: o.n, mae: +(o.sum / o.n).toFixed(1), within2: Math.round(o.w2 / o.n * 100) } : null; }
    return row;
  });
  _score = { sig: H.sig, rows: out };
  return out;
}

// ── 배치표 칸 읽기: "A(B)" = A 자리에 B가 나온다(대바), "A(조출)" = A의 근무 표시 ─────────
const TAG_RE = /^(찾근|조출|후출|정출|선발|당번|프리|벌당|배치|콜|정근|휴무|휴가|병가|연차|반차|월차|격리|마감|54|\d\s*,\s*\d|[123]\s*부)$/;
export function readCell(cell) {
  const s = String(cell || '').trim();
  const m = s.match(/^([^()]*)\(([^)]*)\)\s*$/);
  if (!m) return { occ: s, holder: '', tag: '' };
  const a = m[1].trim(), b = m[2].trim();
  if (TAG_RE.test(b)) return { occ: a, holder: '', tag: b.replace(/\s/g, '') };
  return { occ: b, holder: a, tag: '' };
}

// 오늘 배치표의 근무표(휴무·휴가·병가·조출·찾근·당번…) — 판독 기억에서 꺼낸다(같은 날짜일 때만)
function applications(boardISO, views) {
  const groups = new Map();
  const add = (k, name, note = '') => { if (!name) return; const g = groups.get(k) || []; if (!g.some((x) => x.name === name)) g.push({ name, note }); groups.set(k, g); };
  let entry = null;
  try { const j = loadJSON('board-incremental.json', null); entry = Array.isArray(j) ? j[0] : j; } catch { /* 없으면 표만 */ }
  const entryISO = entry && entry.dateLabel ? (() => { const m = String(entry.dateLabel).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; })() : '';
  const fresh = !!(entry && entryISO && entryISO === boardISO);
  if (fresh) for (const o of entry.offList || []) add(String(o.reason || '휴무'), String(o.name || ''));
  for (const v of views) for (const c of v.roster) { const r = readCell(c); if (r.tag && !/^\d|부$/.test(r.tag)) add(r.tag, r.occ, `${v.part}부`); }
  if (fresh) {
    for (const d of entry.dutyList || []) add(String(d.kind || '당번'), String(d.name || ''), d.part ? `${d.part}부` : '');
    for (const r of entry.roleList || []) add(String(r.role || ''), String(r.name || ''));
  }
  const ORDER = ['휴무', '휴가', '연차', '병가', '격리', '조출', '후출', '찾근', '정출', '선발', '프리', '당번', '벌당', '배치'];
  const KIND = (k) => (/휴무|휴가|연차|병가|격리|월차|반차/.test(k) ? 'off' : /조출|후출|찾근|정출/.test(k) ? 'early' : /선발|프리/.test(k) ? 'lead' : 'duty');
  const list = [...groups.entries()].map(([k, names]) => ({ kind: k, cls: KIND(k), names }));
  list.sort((a, b) => ((ORDER.indexOf(a.kind) + 1) || 99) - ((ORDER.indexOf(b.kind) + 1) || 99));
  return { list, fromBoardMemory: fresh, headcount: fresh ? (entry.headcount || null) : null };
}

export function buildForecast({ labelToISO = () => '', me = '', now = Date.now() } = {}) {
  const H = history();
  const views = buildBoardsView({ labelToISO });
  const boardISO = views.map((v) => v.targetISO).filter(Boolean).sort().pop() || '';
  const grow = growthAfterBoard(H);
  const probOf = (p, k) => { const g = grow[p] || []; if (!g.length) return null; return g.filter((x) => x.grow >= k).length / g.length; };

  // 부별 줄
  const parts = [];
  for (const p of ['1', '2', '3']) {
    const v = views.find((x) => x.part === p);
    if (!v) { parts.push({ part: p, open: false, why: boardISO && isPartClosed(boardISO, p) ? '휴장' : '배치표에 없음' }); continue; }
    const cut = Number(v.cut) || Number(v.teamCount) || 0;
    const tees = Array.isArray(v.teeGrid) ? v.teeGrid : [];
    const teeAt = (pos) => { const t = tees.find((x) => Number(x && x.pos) === pos) || tees[pos - 1]; return t && t.time ? `${t.time}${t.course ? ' ' + String(t.course).toUpperCase() : ''}` : ''; };
    const rows = v.roster.map((c, i) => {
      const no = i + 1, r = readCell(c);
      const row = { no, occ: r.occ, holder: r.holder, tag: r.tag };
      if (no <= cut) { row.work = true; row.tee = teeAt(no); }
      else if (p !== '3') { const k = no - cut; row.ahead = k - 1; const pr = probOf(p, k); row.prob = pr == null ? null : +(pr * 100).toFixed(1); }
      return row;
    });
    parts.push({ part: p, open: true, cut, teams: Number(v.teamCount) || cut, cutoffName: v.cutoffName, rows,
      probDays: p === '3' ? 0 : (grow[p] || []).length, noProb: p === '3' });
  }

  // 내 자리
  let mine = null;
  if (me) for (const pt of parts) for (const r of pt.rows || []) if (r.occ === me && !mine) mine = { part: pt.part, ...r, cut: pt.cut, noProb: pt.noProb };

  // 대바(자리 주인과 나오는 사람이 다른 칸)
  const daba = [];
  for (const pt of parts) for (const r of pt.rows || []) if (r.holder) daba.push({ part: pt.part, no: r.no, holder: r.holder, occ: r.occ });

  // 앞으로 며칠 — 부별 예상 팀 수
  const days = [];
  const todayYmd = ymdOfISO(isoOfMs(now));
  for (let i = 0; i < 8; i++) {
    const ymd = ymdOfISO(isoOfMs(now + i * 86400e3));
    const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const snap = loadSnapshot(ymd);
    const d = { ymd, iso, label: `${Number(ymd.slice(4, 6))}/${Number(ymd.slice(6, 8))}(${WEEK[new Date(dayStart(ymd) + KST).getUTCDay()]})`, parts: {} };
    if (!snap) { d.none = true; days.push(d); continue; }
    d.seenAt = snap.at || 0;
    // ★고정 시간표 밖 칸이 판매중이면 그날 티오프 틀이 바뀐 날이다 — 찬 칸 숫자가 통째로 거짓이 된다.
    const unknown = (snap.unknown || []).length;
    if (unknown) d.shifted = unknown;
    const cur = bookedAt(H.series, ymd, now);
    const leadH = (now - dayStart(ymd)) / 3600e3;
    for (const p of ['1', '2']) {
      const onBoard = boardISO === iso ? views.find((x) => x.part === p) : null;
      if (onBoard) { d.parts[p] = { board: Number(onBoard.cut) || Number(onBoard.teamCount) || 0 }; continue; }
      if (boardISO === iso && !views.find((x) => x.part === p)) { d.parts[p] = { closed: true }; continue; }
      if (unknown || !cur) { d.parts[p] = { skip: true }; continue; }
      const offs = offsetsAtLead(H, p, leadH, { wk: wkType(ymd) });
      if (offs.length < 4) { d.parts[p] = { booked: cur.c[p], thin: true }; continue; }
      const o = offs.map((x) => x.off);
      d.parts[p] = { booked: cur.c[p], pred: cur.c[p] + quant(o, 0.5), lo: cur.c[p] + quant(o, 0.25), hi: cur.c[p] + quant(o, 0.75), n: offs.length };
      Object.defineProperty(d.parts[p], 'raw', { value: o.map((x) => cur.c[p] + x), enumerable: false });
    }
    if (ymd < todayYmd) continue;
    days.push(d);
  }

  const apps = applications(boardISO, views);
  const ahead = myDaysAhead({ parts, days, me, apps, boardISO });

  const h = teeHealth() || {};
  const g = (p) => { const a = (grow[p] || []).map((x) => x.grow); return { n: a.length, max: a.length ? Math.max(...a) : 0, atLeast: [1, 2, 3, 4, 6].map((k) => ({ k, days: a.filter((x) => x >= k).length })) }; };
  return {
    ok: true, at: now, boardISO, me,
    parts, mine, daba,
    apps,
    days, ahead,
    growth: { 1: g('1'), 2: g('2') },
    score: scoreTable(H),
    truthDays: Object.keys(H.truth).length,
    source: { name: '티스캐너', lastOk: h.lastOk || 0, streak: h.streak || 0, lastErr: h.lastErr || '' },
    names: [...new Set(parts.flatMap((pt) => (pt.rows || []).map((r) => r.occ)).filter(Boolean))],
  };
}

// ══ 앞으로 며칠, 내 순번 ═══════════════════════════════════════════════════════
//  ★규칙(사용자 9/1 확인 + 11/21→22·11/22→23 배치표 두 번 재현):
//   줄은 조 차례대로 돈다. 다음 날 줄은 '오늘 그 줄에서 일 못 한 첫 사람'부터 시작한다
//   (11/21 2부 44번 배문숙까지 근무 → 11/22는 45번 김태리부터 / 11/22 43번 강민순까지 → 이지은 휴무라 김민찬부터).
//  그래서 내일 내 차례 = 오늘 확정선 다음 사람부터 나까지 몇 명인가. 대바는 그날만의 맞바꿈이라 원래 자리(주인)로 센다.
//  ★배지 붙은 칸(54·2,3·조출·당번…)은 경기과가 그날 사정 보고 놓는다 — 차례 셈에서 뺀다.
//  모르는 것: 내일 휴무 신청(앞사람이 쉬면 당겨진다), 경기과 손조정. 그래서 '예상'이고, 매일 맞았는지 적어 둔다.
const CHECK_FILE = 'forecast-check.json';
function myDaysAhead({ parts, days, me, apps, boardISO }) {
  if (!me || !boardISO) return null;
  // 내가 주인인 칸 → 없으면 내가 나오는 칸
  let pt = null, idx = -1;
  for (const x of parts) { if (!x.open) continue; const i = x.rows.findIndex((r) => (r.holder || r.occ) === me); if (i >= 0) { pt = x; idx = i; break; } }
  if (!pt) for (const x of parts) { if (!x.open) continue; const i = x.rows.findIndex((r) => r.occ === me); if (i >= 0) { pt = x; idx = i; break; } }
  if (!pt) return { why: '오늘 배치표 줄에 이름이 없어 셀 수 없습니다' };
  const rows = pt.rows;
  if (rows[idx].tag) return { part: pt.part, why: `오늘 '${rows[idx].tag}' 배지라 차례 셈 밖입니다(경기과가 그날 정함)` };
  const ringRows = rows.filter((r) => !r.tag);             // 차례대로 도는 사람들(오늘 줄)
  const nm = (r) => r.holder || r.occ;
  const cutR = ringRows.filter((r) => r.no <= pt.cut).length;   // 오늘 일한 사람 수(차례 줄 기준)
  const startRow = ringRows[cutR] || ringRows[0];
  // ★오늘 쉰 사람(휴무)은 내일 제 자리로 돌아온다 — 줄 끝이 아니라 조 차례 속 자기 자리다.
  //  그 자리는 예전 배치표 줄에서 '바로 앞에 섰던 사람'으로 찾는다. 휴가·병가는 며칠 이어지기 쉬워 내일 셈에 안 넣는다.
  const today = ringRows.map(nm);
  rememberRing(boardISO, pt.part, today);
  const back = [];
  for (const g of apps.list || []) if (g.kind === '휴무') for (const x of g.names) if (!today.includes(x.name)) back.push(x.name);
  const ring = placeReturning(today, back, pt.part, boardISO);
  const meName = nm(rows[idx]);
  const meR = ring.indexOf(meName);
  const startR = ring.indexOf(nm(startRow));
  const worked = new Set(ringRows.filter((r) => r.no <= pt.cut).map(nm));
  const L = ring.length;
  // 내일 줄에서 나까지 몇 번째인가 — 시작점부터 둥글게 센다(오늘 일한 사람은 이미 줄 끝으로 갔다).
  const order = [];
  for (let k = 0; k < L; k++) { const n = ring[(startR + k) % L]; if (!worked.has(n)) order.push(n); }
  for (const n of ringRows.map(nm)) if (worked.has(n)) order.push(n);
  const rank0 = order.indexOf(meName) + 1;
  const tagged = rows.filter((r) => r.tag).length;         // 배지 칸은 팀을 먹되 차례는 안 쓴다
  const ahead = order.slice(0, Math.max(0, rank0 - 1));
  const out = { part: pt.part, start: nm(startRow), startNo: startRow ? startRow.no : 0,
    workedToday: worked.has(meName), tagged, ringLen: L, rank: rank0, returning: back.filter((n) => ahead.includes(n)), list: [] };
  // ★날마다 팀 수가 흔들리는 걸 다음 날로 끌고 간다 — 지난 날들의 팀 수 중 하나를 날마다 뽑아 1000번 돌린다.
  //  (하루 앞만 보고 0%/100%로 못 박으면, 이틀 뒤부터는 그 흔들림이 다 사라진 거짓 확신이 된다.)
  const fut = days.filter((d) => d.iso > boardISO);
  const N = 1000;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let ranks = new Array(N).fill(rank0);
  for (const d of fut) {
    const x = d.parts && d.parts[pt.part];
    const row = { label: d.label, iso: d.iso, tagged0: tagged };
    if (pt.part === '3') row.why = '3부 팀 수는 계산 안 함';
    else if (d.none) row.why = '예약 관측 없음';
    else if (d.shifted) row.why = '시간표 바뀐 날';
    else if (!x || x.pred == null) row.why = x && x.thin ? '비교할 날 부족' : '예상 팀 수 없음';
    const sorted = ranks.slice().sort((a, b) => a - b);
    row.rank = sorted[Math.floor(N / 2)]; row.rankLo = sorted[Math.floor(N * 0.25)]; row.rankHi = sorted[Math.floor(N * 0.75)];
    if (!row.why) {
      row.pred = x.pred; row.lo = x.lo; row.hi = x.hi;
      let work = 0;
      const next = new Array(N);
      for (let i = 0; i < N; i++) {
        const teams = x.raw[Math.floor(rnd() * x.raw.length)];
        const used = Math.max(0, teams - tagged);          // 배지 칸이 먼저 팀을 먹는다
        if (ranks[i] <= used) { work++; next[i] = ranks[i] + L - used; } else next[i] = ranks[i] - used;
      }
      ranks = next;
      row.prob = Math.round(work / N * 100);
      row.verdict = row.prob >= 70 ? '근무 유력' : row.prob >= 30 ? '반반' : '스페어 유력';
    }
    out.list.push(row);
    if (row.why) break;   // 팀 수를 모르는 날을 지나면 그 뒤 순번은 지어낸 것이 된다 — 거기서 멈춘다
  }
  out.check = selfCheck(boardISO, pt, ringRows, out);
  return out;
}

// 날마다의 차례 줄을 기억한다 — 쉬어서 오늘 줄에 없는 사람이 어디로 돌아올지 찾는 데 쓴다.
const RING_FILE = 'forecast-rings.json';
function rememberRing(iso, part, names) {
  if (!iso || !names.length) return;
  let st = {};
  try { st = loadJSON(RING_FILE, {}) || {}; } catch { st = {}; }
  const k = `${iso}|${part}`;
  if (JSON.stringify(st[k]) === JSON.stringify(names)) return;
  st[k] = names;
  const keys = Object.keys(st).sort();
  while (keys.length > 40) delete st[keys.shift()];
  try { saveJSON(RING_FILE, st); } catch { /* 기억 실패는 화면을 막지 않는다 */ }
}
function placeReturning(today, back, part, iso) {
  const ring = today.slice();
  if (!back.length) return ring;
  let st = {};
  try { st = loadJSON(RING_FILE, {}) || {}; } catch { st = {}; }
  const past = Object.keys(st).filter((k) => k.endsWith(`|${part}`) && k < `${iso}|`).sort().reverse().map((k) => st[k]);
  for (const n of back) {
    let at = -1;
    for (const pl of past) {
      const i = pl.indexOf(n); if (i < 0) continue;
      // 그 줄에서 n 바로 앞에 섰던 사람 중 오늘 줄에 있는 사람 뒤에 끼운다
      for (let j = i - 1; j >= 0 && at < 0; j--) { const q = ring.indexOf(pl[j]); if (q >= 0) at = q + 1; }
      if (at >= 0) break;
    }
    if (at >= 0) ring.splice(at, 0, n); else ring.push(n);   // 어디였는지 모르면 줄 끝에 둔다(화면에 "돌아오는 사람" 수로 드러난다)
  }
  return ring;
}

// 어제 이 화면이 '내일 줄은 누구부터'라고 했는지 적어 두고, 새 배치표가 오면 맞았는지 본다.
function selfCheck(boardISO, pt, ring, out) {
  let st = {};
  try { st = loadJSON(CHECK_FILE, {}) || {}; } catch { st = {}; }
  const nextISO = (out.list[0] && out.list[0].iso) || '';
  let dirty = false;
  if (nextISO && out.start && !st[nextISO]) { st[nextISO] = { part: pt.part, start: out.start, from: boardISO, at: Date.now() }; dirty = true; }
  const mine = st[boardISO];
  let res = null;
  if (mine) {
    const first = ring[0] ? (ring[0].holder || ring[0].occ) : '';
    res = { predicted: mine.start, actual: first, hit: mine.start === first, part: mine.part };
    if (mine.actual !== first) { mine.actual = first; mine.hit = res.hit; dirty = true; }
  }
  const hist = Object.entries(st).filter(([, v]) => v && v.actual).map(([k, v]) => ({ iso: k, hit: !!v.hit }));
  if (dirty) {
    const keys = Object.keys(st).sort();
    while (keys.length > 60) delete st[keys.shift()];
    try { saveJSON(CHECK_FILE, st); } catch { /* 기록 실패는 화면을 막지 않는다 */ }
  }
  return { today: res, days: hist.length, hits: hist.filter((x) => x.hit).length };
}
