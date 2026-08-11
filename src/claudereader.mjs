// 서버 Claude Code(MAX 구독, 이미 로그인)를 '채점자'로 호출 — 부별 크롭을 업스케일해 독립 판독.
//  목적: 로컬 VLM(무료) 판독과 '교차검증'해 자신있는 오독·밀집부 누락을 잡는다(둘 다 틀리면 관리자 플래그).
//  ★사용량 억제: 부별 1회 + '하루 하드캡'(폭주 방지). 캡 초과 시 호출 스킵(VLM 단독으로 폴백).
//  전제: 서버에 `claude`(v2.x) 설치 + OAuth 로그인(ghdrn2889@gmail.com MAX). API 키 아님 = 종량제 과금 없음.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJSON, saveJSON } from './store.mjs';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 240000);
const DAILY_CAP = Number(process.env.CLAUDE_DAILY_CAP || 40);   // 하루 최대 호출(합본 4 + 변동들). 폭주 방지 상한.
const CAP_FILE = 'claude-calls.json';

// ── 하루 하드캡 ─────────────────────────────────────────────
function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function callsToday() { const s = loadJSON(CAP_FILE, {}); return s.date === today() ? (s.count || 0) : 0; }
function bumpCalls() {
  const s = loadJSON(CAP_FILE, {});
  const c = s.date === today() ? (s.count || 0) + 1 : 1;
  saveJSON(CAP_FILE, { date: today(), count: c });
  return c;
}
export function claudeBudgetLeft() { return Math.max(0, DAILY_CAP - callsToday()); }

// ── 홀리스틱 판독(감독관) — 한 부(部)의 명단·티오프·컷을 '한 번의 호출로 함께' 판독 ─────────────
//  기존 크롭-파이프라인은 명단(순번+이름)과 티오프 그리드를 '따로' 읽어 짝이 어긋나던(순번↔시각) 게 최대 오류원.
//  여기선 순번↔이름↔티오프를 한 이미지에서 통째로 대응시켜 어긋남을 원천 차단. 호출도 부당 1회.
const HOLISTIC_P3_PROMPT = (
  'Read the local image with the Read tool. It is the 3부(Part 3) section of a Korean golf caddie assignment board (배치표).\n'
  + 'LAYOUT:\n'
  + '- Left: one or two vertical [순번 이름] roster columns listing caddies in ascending 순번(number) order (e.g. "1 차은경(54)", "2 신지현(1,3)" ... continuing into a second column like "21 양태록"). Grey-shaded name rows mean 대기/spare (working but no tee assigned yet). Read each printed name EXACTLY as written and preserve parenthetical tags EXACTLY: (54)/(1,3)/(조출)/(찾근). Do NOT guess or add a name that is not printed.\n'
  + '- Right: a tee-time grid with three columns [OUT | time | IN]. Each row shows a tee time (e.g. 16:32). The OUT cell and/or the IN cell of a row may contain a 순번 number. That number identifies which caddie (by their 순번) tees off at that time on that course. A blank/yellow cell means no one on that course/row.\n'
  + 'TASK: Match 순번 -> name (from roster) and 순번 -> tee time+course (from the grid).\n'
  + '★★CRITICAL — scan the tee grid ALL THE WAY DOWN to its LAST time row. Do NOT stop early.\n'
  + '  The grid gets SPARSE near the bottom (many rows have a number in ONLY the OUT cell or ONLY the IN cell, and some rows are fully blank). Those single-side rows STILL count — read every one to the very last printed time (e.g. 18:17, 18:31, 18:38, 18:45).\n'
  + '  INVARIANT: the LARGEST 순번 that has a tee MUST reach the last working caddie — i.e. max(tees.pos) should equal teamCount (the number after "3부"). If your tees stop well short of teamCount, you missed the sparse bottom rows — go back and read them.\n'
  + 'Output STRICT JSON ONLY, no prose:\n'
  + '{"teamCount": <integer after "3부" in the header if visible, else null>,\n'
  + ' "roster": [{"pos":1,"name":"차은경(54)","spare":false}, ... EVERY numbered roster row in order ...],\n'
  + ' "tees": [{"pos":1,"time":"16:32","course":"OUT"}, ... ONE entry for EACH OUT/IN cell that contains a 순번, INCLUDING the sparse bottom rows, up to max(pos)=teamCount ...]}'
);

// 재판독 넛지 — 직전 판독이 티오프 하단을 놓쳤을 때 덧붙이는 교정 지시(꼬리 집중).
const HOLISTIC_TAIL_NUDGE = (
  '\n\n★RETRY: the previous read MISSED the bottom of the tee grid — its tees stopped short of teamCount. '
  + 'Look again at the LOWER part of the [OUT|time|IN] grid, below the last tee you found. '
  + 'Read EVERY remaining time row down to the very bottom, including rows where only the OUT cell or only the IN cell has a 순번. '
  + 'Return the FULL tees list so that max(tees.pos) reaches teamCount.'
);

// 재판독 넛지 — 컷 이내인데 티가 빈 특정 순번(중간 구멍)을 콕 집어 재확인. 단독행/더블행 뒤 흘림 교정.
const HOLISTIC_GAP_NUDGE = (positions) => (
  `\n\n★RETRY: your previous read left these 순번 with NO tee time: [${positions.join(', ')}]. `
  + 'They are within the working range, so most likely they DO have a tee in the [OUT|time|IN] grid — you probably skipped a single-side row (only OUT or only IN filled) or a row right after a double (OUT+IN) row. '
  + 'For EACH listed 순번, search the grid carefully for the OUT or IN cell containing that exact number and report its time+course. '
  + 'Omit a 순번 ONLY if it is genuinely absent from every grid cell (no tee assigned yet). '
  + 'Return the FULL tees list including any you recover.'
);

// 재판독 넛지 — 한 시각에 3명↑/같은코스 중복(사다리 밀림)을 콕 집어 순번↔시각↔코스 재대응 지시.
const HOLISTIC_SLIP_NUDGE = (times) => (
  '\n\n★RETRY: your previous read placed THREE OR MORE caddies at the same tee time, or TWO on the same course at one time — impossible: each time row has AT MOST one OUT number and one IN number. '
  + `Conflicting times: [${times.join(', ')}]. Re-read the [OUT|time|IN] grid CAREFULLY row by row, matching each 순번 to its EXACT printed time and course; do NOT shift numbers between adjacent time rows. Return the FULL corrected tees list.`
);

// 로컬 이미지(전체판 또는 3부 크롭) → { teamCount, roster:[{pos,name,spare}], tees:[{pos,time,course}] } 또는 null.
export async function readPart3Holistic(imagePath, opts = {}) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn(`[claude] 하루 하드캡(${DAILY_CAP}) 도달 — 홀리스틱 스킵`); return null; }
  const prompt = HOLISTIC_P3_PROMPT
    + (opts.tailRetry ? HOLISTIC_TAIL_NUDGE : '')
    + (Array.isArray(opts.gapPositions) && opts.gapPositions.length ? HOLISTIC_GAP_NUDGE(opts.gapPositions) : '')
    + (Array.isArray(opts.conflictTimes) && opts.conflictTimes.length ? HOLISTIC_SLIP_NUDGE(opts.conflictTimes) : '');
  let out;
  try { out = await runClaude(`${prompt}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 홀리스틱 호출 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const roster = Array.isArray(j.roster) ? j.roster
      .map((r) => ({ pos: Number(r.pos) || 0, name: String(r.name || '').trim(), spare: !!r.spare }))
      .filter((r) => r.pos > 0 && r.name) : [];
    const tees = Array.isArray(j.tees) ? j.tees
      .map((t) => ({ pos: Number(t.pos) || 0, time: (String(t.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: /IN/i.test(String(t.course)) ? 'IN' : 'OUT' }))
      .filter((t) => t.pos > 0 && t.time) : [];
    if (!roster.length) return null;
    return { teamCount: Number(j.teamCount) || null, roster, tees };
  } catch { return null; }
}

// 부별 판독 프롬프트 — 순번 순서 명단 JSON만. 괄호 태그(54·1,3·조출·찾근) 원문 보존.
const READ_PROMPT = (
  'Read the given local image with the Read tool. It is one section of a Korean golf caddie assignment board (배치표). '
  + 'The left side has [순번 이름] roster column(s) (one or two side by side). '
  + 'List ALL caddies strictly in 순번(number) order as a JSON array, reading each printed name EXACTLY as written and preserving parenthetical tags exactly like (54)/(1,3)/(조출)/(찾근). Do NOT guess or add a name that is not printed. '
  + 'Skip truly empty rows. Output ONLY strict JSON, no prose: {"roster":["name1","name2",...]}'
);

// 이미지 파일(크롭)을 업스케일 저장 — 작은 크롭은 그대로 주면 tiny 한글이 안 읽힌다(업스케일이 결정적 레버).
//  Pillow는 파이썬이라 여기선 이미 업스케일된 파일 경로를 받는 걸 기본으로 하고, 원본이면 호출부에서 키워 넘긴다.

// article 크롭 이미지(로컬 파일 경로) → Claude 판독 명단 배열 또는 null.
//  ★비용 가드: 하루 캡 초과면 null(스킵). Claude가 죽거나 파싱 실패해도 null(안전 폴백).
export async function readCropWithClaude(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) {
    console.warn(`[claude] 하루 하드캡(${DAILY_CAP}) 도달 — 호출 스킵(VLM 단독 폴백)`);
    return null;
  }
  let out;
  try {
    out = await runClaude(`${READ_PROMPT}\nImage path: ${imagePath}`);
  } catch (e) {
    console.error('[claude] 호출 오류:', e.message);
    return null;
  }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);   // 프롬프트 밖 잡담 제거, JSON 블록만
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const roster = Array.isArray(j.roster) ? j.roster.map((s) => String(s || '').trim()) : [];
    return roster.length ? roster : null;
  } catch { return null; }
}

// 합본 배치표 → 부별 x경계(0~1). Claude가 레이아웃을 이해해 대략 경계를 준다(슬라이서). 아침 합본당 1회.
//  실증(8/4): Claude 1부0~0.24·2부0.24~0.44·3부0.44~0.63 ≈ 실제. 슬라이서는 대략이면 충분(단일부 판독이 흡수).
const BOUNDS_PROMPT = (
  'Read the given local image with the Read tool. It is a Korean golf caddie board (배치표) with sections laid out '
  + 'LEFT to RIGHT: 1부 (roster + morning tee table), 2부 (roster + midday tee table), 3부 (roster + afternoon tee table), '
  + 'then 조편성표 (crew grid on the far right). For EACH 부 that is present, estimate the horizontal span of its '
  + '[roster + its tee table] as fractions of total width (left=0.0, right=1.0). Output ONLY JSON: '
  + '{"parts":[{"part":1,"x0":0.0,"x1":0.24},...]}'
);

export async function getPartBoundaries(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 경계 추정 스킵'); return null; }
  let out;
  try { out = await runClaude(`${BOUNDS_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 경계 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const parts = (Array.isArray(j.parts) ? j.parts : [])
      .map((p) => ({ part: Number(String(p.part).replace(/\D/g, '')), x0: Number(p.x0), x1: Number(p.x1) }))
      .filter((p) => p.part >= 1 && p.part <= 3 && p.x1 > p.x0 && p.x0 >= 0 && p.x1 <= 1);
    return parts.length ? parts : null;
  } catch { return null; }
}

// 부별 크롭(단일부) → 명단 + 티오프 + 커트를 '한 번에'. 슬라이스당 Claude 1회.
//  실증(8/4): 3부 명단 29 정확 + 티오프 16팀(IN 포함) + 커트16. VLM이 약했던 티오프까지 정확.
const PART_PROMPT = (
  'Read the given local image with the Read tool. It is ONE 부(section) of a Korean golf caddie board (배치표). '
  + 'LEFT: the roster has one or MORE separate vertical [순번 이름] columns placed side by side '
  + '(e.g. the first column holds 순번 1-25, then a SECOND column to its right continues 26-50). '
  + '★Treat each vertical column as its OWN independent list. Read column by column, left to right. '
  + 'Within EACH column, read every row from the very top to the very BOTTOM — the last 1-2 rows of a column are easy to miss, do NOT stop early. '
  + 'For every row read BOTH the printed 순번 number and the name as a pair, reading each name EXACTLY as written and preserving parenthetical tags exactly like (54)/(1,3)/(조출)/(찾근). Do NOT guess or add a name that is not printed. Skip a row only if it has no name. '
  + 'IGNORE any text that is NOT a numbered 순번 row — notice/공지 boxes, phone-number legends, "흡연실 당번" boxes, 조편성표 grids. Only rows with a printed 순번 number count. '
  + 'RIGHT: a tee-time table with columns [OUT팀번호][시간 HH:MM][IN팀번호] — a number on the left tees off OUT, on the right tees off IN, blank = none. '
  + 'Read this tee table from the very TOP row to the very BOTTOM row — do NOT stop early; rows newly added at the BOTTOM (spares just given a tee time) matter most. '
  + 'cut = the highest team number in the tee table (커트라인). '
  + 'ALSO give "times": EVERY printed 시간(HH:MM) in that 시간 column, top to bottom, in order, INCLUDING rows whose OUT and IN team numbers are both blank (an empty slot still counts as a time on the board). '
  + 'ALSO give "rosterCols": for EACH vertical roster column, its horizontal span as {x0,x1} fractions (0=left edge, 1=right edge OF THIS IMAGE), left-to-right, EXCLUDING the tee table. Each span should cover the 순번 number AND the name of that column. '
  + 'Output ONLY strict JSON, no prose. "roster" is a best-effort flat list in 순번 order (fallback): '
  + '{"rosterCols":[{"x0":0.02,"x1":0.20},{"x0":0.24,"x1":0.42}],"roster":[{"pos":1,"name":"차은경(54)"},...],"tee":[{"pos":n,"time":"HH:MM","course":"OUT|IN"}],"times":["06:30","06:37",...],"cut":N}'
);

// 평평한 명단(문자열 또는 {pos,name} 배열) → 순번 위치정렬 배열(index=pos-1, 빈 자리 ''). pos 없으면 순서대로.
function rosterFromFlat(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  let items;
  if (arr.length && typeof arr[0] === 'object') items = arr.map((r, i) => ({ pos: Number(r?.pos) || (i + 1), name: String(r?.name || '').trim() }));
  else items = arr.map((s, i) => ({ pos: i + 1, name: String(s || '').trim() }));
  const maxPos = items.reduce((mx, r) => Math.max(mx, r.pos || 0), 0);
  const out = new Array(maxPos).fill('');
  for (const r of items) if (r.pos >= 1 && r.name) out[r.pos - 1] = r.name;
  return out;
}

// 단일 열(순번 이름 한 줄) 크롭 판독 — 열 하나만 있으면 Claude가 맨 아래까지 100% 읽는다(1부 21/21 검증).
//  반환: [{pos, name}] (인쇄 순번). 실패/캡초과면 null.
const COLUMN_PROMPT = (
  'Read the given local image with the Read tool. It is a SINGLE vertical [순번 이름] roster column from a Korean golf caddie board (배치표). '
  + 'List EVERY row from the very top to the very BOTTOM — do NOT stop early, the last rows matter. '
  + 'For each row give the printed 순번 as "pos" and the name, reading each name EXACTLY as written and preserving tags exactly like (54)/(1,3)/(조출)/(찾근). Do NOT guess or add a name that is not printed. '
  + 'Skip a row only if it has no name. Ignore any text without a printed 순번 (notices, legends). '
  + 'Output ONLY strict JSON: {"roster":[{"pos":1,"name":"차은경(54)"},...]}'
);
// 부 크롭에서 '명단 열 x-경계'만 잡는 전용 호출(part 판독이 rosterCols를 들쭉날쭉 빠뜨려 별도로 확실히).
//  반환: [{x0,x1}] 크롭 fraction, 티오프표 제외. 실패/캡초과면 null.
const COLBOUNDS_PROMPT = (
  'Read the given local image with the Read tool. It is ONE 부 section of a Korean golf caddie board (배치표): '
  + 'on the LEFT there are one or more vertical [순번 이름] roster columns placed side by side; on the RIGHT is a tee-time table. '
  + 'For EACH roster column (the left group only, NOT the tee table on the right), give its horizontal span {x0,x1} '
  + 'as fractions (0 = left edge, 1 = right edge OF THIS IMAGE), left to right. Each span must cover BOTH the 순번 number and the name. '
  + 'Output ONLY strict JSON: {"cols":[{"x0":0.02,"x1":0.20},{"x0":0.24,"x1":0.42}]}'
);
export async function getRosterColumns(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 열경계 스킵'); return null; }
  let out;
  try { out = await runClaude(`${COLBOUNDS_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 열경계 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const cols = (Array.isArray(j.cols) ? j.cols : [])
      .map((c) => ({ x0: Number(c.x0), x1: Number(c.x1) }))
      .filter((c) => c.x1 > c.x0 && c.x0 >= 0 && c.x1 <= 1);
    return cols.length ? cols : null;
  } catch { return null; }
}

export async function readColumnRoster(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 열 판독 스킵'); return null; }
  let out;
  try { out = await runClaude(`${COLUMN_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 열 판독 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const raw = Array.isArray(j.roster) ? j.roster : [];
    const items = raw
      .map((r) => (typeof r === 'object' ? { pos: Number(r?.pos) || 0, name: String(r?.name || '').trim() } : { pos: 0, name: String(r || '').trim() }))
      .filter((r) => r.name);
    return items.length ? items : null;
  } catch { return null; }
}

// ── 대바(대체자) 전용 'verbatim 명단' 판독 ────────────────────────────
//  홀리스틱/부 프롬프트는 명단+티오프+커트를 한 번에 처리하느라 마젠타 '주인(태그)대체자' 셀의 두 번째 이름을
//  정규화로 버린다(실증 8/11: 무거운 프롬프트=대체자 누락, '명단만' 물으면 20/20·대바 5건 100% 판독).
//  그래서 명단만 얇게 다시 읽어 대체자를 회복한다. 반환: [{pos,name}] (대체자 포함 원문). 실패/캡초과=null.
const VERBATIM_ROSTER_PROMPT = (
  'Read the local image with the Read tool. It is a Korean golf caddie assignment board (배치표) section. '
  + 'Look ONLY at the [순번 이름] roster column(s) on the LEFT (there may be two columns side by side — read the left column fully top to bottom, then the right column). Ignore the tee-time table and any crew grid on the right. '
  + '★Some roster cells are MAGENTA and contain TWO names side by side: the ORIGINAL caddie with a tag such as 차은경(1,3), followed IMMEDIATELY by a SECOND black name — the 대바(substitute) — so the cell reads e.g. 차은경(1,3)구경은. Other cells show a substitute in PARENTHESES, e.g. 남재권(정민철). '
  + 'For EVERY numbered 순번 row, transcribe the cell EXACTLY as printed, keeping BOTH names whenever a cell has two. Preserve tags (54)/(1,3)/(조출)/(찾근) exactly. NEVER normalize a two-name cell down to one name, and never drop the substitute. '
  + 'Output STRICT JSON only, no prose: {"roster":[{"pos":1,"name":"우겸조(54)"},{"pos":4,"name":"차은경(1,3)구경은"},{"pos":15,"name":"남재권(정민철)"}, ... every numbered row ...]}'
);
export async function readRosterVerbatim(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 대바 verbatim 스킵'); return null; }
  let out;
  try { out = await runClaude(`${VERBATIM_ROSTER_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 대바 verbatim 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const items = (Array.isArray(j.roster) ? j.roster : [])
      .map((r) => ({ pos: Number(r?.pos) || 0, name: String(r?.name || '').trim() }))
      .filter((r) => r.pos > 0 && r.name);
    return items.length ? items : null;
  } catch { return null; }
}

export async function readPartWithClaude(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn(`[claude] 캡(${DAILY_CAP}) 도달 — 부 판독 스킵`); return null; }
  let out;
  try { out = await runClaude(`${PART_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 부 판독 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const roster = rosterFromFlat(j.roster);   // 폴백용 rough 명단(위치정렬)
    const rosterCols = (Array.isArray(j.rosterCols) ? j.rosterCols : [])
      .map((c) => ({ x0: Number(c.x0), x1: Number(c.x1) }))
      .filter((c) => c.x1 > c.x0 && c.x0 >= 0 && c.x1 <= 1);
    const tee = (Array.isArray(j.tee) ? j.tee : [])
      .map((t) => ({ pos: Number(t.pos), time: String(t.time || ''), course: /IN/i.test(String(t.course)) ? 'IN' : 'OUT' }))
      .filter((t) => t.pos > 0 && /^\d{1,2}:\d{2}$/.test(t.time));
    // ★티오프 칸 전체 시각(팀번호 유무 무관) — 검수에서 모든 시간대를 고를 수 있게. tee 시각도 합쳐 누락 방지.
    const times = [...new Set([
      ...(Array.isArray(j.times) ? j.times : []).map((t) => (String(t).match(/\d{1,2}:\d{2}/) || [''])[0]),
      ...tee.map((t) => t.time),
    ].filter(Boolean))].sort((a, b) => (Number(a.split(':')[0]) * 60 + Number(a.split(':')[1])) - (Number(b.split(':')[0]) * 60 + Number(b.split(':')[1])));
    const cut = Number(j.cut) || tee.reduce((mx, t) => Math.max(mx, t.pos), 0);
    return (roster.filter(Boolean).length || tee.length) ? { roster, tee, times, cut, rosterCols } : null;
  } catch { return null; }
}

// 상단 요약 스트립("1부 21  2부 4  3부 16  총 41팀") → 부별 팀수(=커트). ★큰 인쇄 숫자라 안정적.
//  부별 티오프 행을 세는 것(±2 흔들림)보다 훨씬 신뢰. 합본당 1회. 부별 크롭엔 없어 null(그땐 per-part cut 사용).
const SUMMARY_PROMPT = (
  'Read the given local image with the Read tool. It is the top summary strip of a Korean golf caddie board (배치표) '
  + 'showing per-부 team counts, e.g. "1부 21  2부 4  3부 16  총 41팀". '
  + 'Output ONLY strict JSON mapping each 부 number to its team count: {"counts":{"1":21,"2":4,"3":16}}'
);

export async function readSummaryCounts(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 요약 판독 스킵'); return null; }
  let out;
  try { out = await runClaude(`${SUMMARY_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 요약 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const src = j.counts || j;
    const cuts = {};
    for (const k of ['1', '2', '3']) { const n = Number(src[k]); if (n > 0 && n <= 40) cuts[k] = n; }
    return Object.keys(cuts).length ? cuts : null;
  } catch { return null; }
}

// 배치표의 '근태(휴무·병가·휴가…) 명단' 판독 — 부별 순번명단·티오프에는 없고 별도 근태 칸/목록에 인쇄된다.
//  ★Claude 부 판독기는 부 크롭만 봐서 근태를 통째로 놓친다(병가→휴무 강등, 오프 캐디가 스페어로 잔류).
//   전용 1회 판독으로 근태를 잡아 crewDuty에 주입 → 기존 오프 게이트(judge fixMemberPosByRoster)가 발화한다.
//  반환: [{name, reason}] reason∈{휴무,병가,휴가,연차,반차,월차,격리}. 근태 없음=[](빈 배열, 유효). 실패=null.
const OFF_PROMPT = (
  'This image is the 조편성표 (crew assignment grid) from the RIGHT side of a Korean golf caddie board (배치표). '
  + 'Several vertical blocks (조) are placed side by side; each block has columns [이름 | 근무 | 카트]. '
  + 'Read EVERY block, EVERY row from the very top to the very BOTTOM — do NOT stop early, the last rows matter. '
  + 'For each row whose 근무 cell is an ABSENCE status, output the 이름 and the status. '
  + 'Distinguish the status by BOTH the text AND its cell COLOR: 휴무 = YELLOW cell, 휴가 = GREEN cell, 병가 = light BLUE cell; 격리/연차/반차/월차 as written. '
  + 'IGNORE rows whose 근무 is a working tag (3부, 1,3, 54, 54h, 조출, 찾근, 선발, 당번, 배치, 정출, 마감, 대리, 주임, 마샬) or blank. '
  + 'If nobody is marked absent, return an empty list. '
  + 'Output ONLY strict JSON: {"off":[{"name":"이수련","reason":"휴무"},{"name":"김홍구","reason":"병가"}]}'
);

const OFF_REASONS = ['병가', '휴가', '연차', '반차', '월차', '격리', '휴무'];   // 구체(병가/휴가류) 우선, 일반 휴무 최후
export async function readOffList(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 근태 판독 스킵'); return null; }
  let out;
  try { out = await runClaude(`${OFF_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 근태 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const raw = Array.isArray(j.off) ? j.off : [];
    const list = raw.map((r) => {
      const name = String(r?.name || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim();
      const rtext = String(r?.reason || '');
      const reason = OFF_REASONS.find((k) => rtext.includes(k)) || '휴무';   // 신호 애매하면 일반 휴무
      return { name, reason };
    }).filter((r) => /^[가-힣]{2,4}$/.test(r.name));   // 이름만(잡텍스트·헤더 제거)
    return list;   // 빈 배열도 유효(그날 근태 없음). null은 판독 실패(폴백 판단용).
  } catch { return null; }
}

// ── 조편성표 '조 열분할' 판독 ──────────────────────────────
//  통짜 크루 크롭은 다열이 빽빽해 이름을 '다른 유효 이름'으로 뭉갠다(박시윤→박신훈: 스냅으로도 못 잡음).
//  조별로 따로 크롭해 단일열로 읽으면 해상도가 배로 올라 이름·근태가 안정(실측 8배에서 박시윤·서동명 또렷).
const CREW_COLS_PROMPT = (
  'Read the given local image with the Read tool. It is the 조편성표 (crew grid) of a Korean golf caddie board: '
  + 'several vertical 조 blocks placed side by side, each block having columns [이름 | 근무 | 카트]. '
  + 'For EACH 조 block, give its horizontal span {x0,x1} as fractions (0=left edge, 1=right edge OF THIS IMAGE), left to right. '
  + 'Each span must cover the whole block (이름+근무+카트). Output ONLY strict JSON: {"cols":[{"x0":0.0,"x1":0.24},{"x0":0.25,"x1":0.49}]}'
);
export async function getCrewColumns(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 조열경계 스킵'); return null; }
  let out;
  try { out = await runClaude(`${CREW_COLS_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 조열경계 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const cols = (Array.isArray(j.cols) ? j.cols : [])
      .map((c) => ({ x0: Number(c.x0), x1: Number(c.x1) }))
      .filter((c) => c.x1 > c.x0 && c.x0 >= 0 && c.x1 <= 1);
    return cols.length ? cols : null;
  } catch { return null; }
}

// 단일 조 블록 [이름|근무|카트] 판독 → [{name,duty}]. 근무칸(색태그)에서 근태·근무유형을 함께 뽑는다.
const CREW_COL_PROMPT = (
  'Read the given local image with the Read tool. It is a SINGLE 조 block from a Korean golf caddie crew grid, columns [이름 | 근무 | 카트]. '
  + 'Read EVERY row from the very top to the very BOTTOM — do NOT stop early, the last rows matter. '
  + 'For each row output the 이름 (name) and the 근무 cell value (a work/absence tag, or "" if blank). '
  + 'Read the 근무 status using BOTH the text AND its cell color: 휴무 = YELLOW cell, 휴가 = GREEN cell, 병가 = light BLUE cell; '
  + 'others (3부, 1,3, 54, 54h, 조출, 찾근, 선발, 당번, 배치, 정출, 마감, 격리, 연차, 반차, 월차) as written. '
  + 'Skip rows that have no name. Output ONLY strict JSON: {"rows":[{"name":"정진영","duty":"3부"},{"name":"이수련","duty":"휴무"}]}'
);
export async function readCrewColumn(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  if (claudeBudgetLeft() <= 0) { console.warn('[claude] 캡 도달 — 조 판독 스킵'); return null; }
  let out;
  try { out = await runClaude(`${CREW_COL_PROMPT}\nImage path: ${imagePath}`); }
  catch (e) { console.error('[claude] 조 판독 오류:', e.message); return null; }
  bumpCalls();
  const m = String(out || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const rows = (Array.isArray(j.rows) ? j.rows : [])
      .map((r) => ({ name: String(r?.name || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim(), duty: String(r?.duty || '').trim() }))
      .filter((r) => /^[가-힣]{2,4}$/.test(r.name));
    return rows;
  } catch { return null; }
}

// 텍스트-only 클로드 호출(구두 변동 해석 등). 하루 캡 공유 — 폭주 방지. 예산 없으면 null.
export async function runClaudeText(prompt) {
  if (claudeBudgetLeft() <= 0) { console.warn(`[claude] 하루 하드캡(${DAILY_CAP}) 도달 — 텍스트 호출 스킵`); return null; }
  bumpCalls();
  try { return await runClaude(prompt); }
  catch (e) { console.error('[claude] 텍스트 호출 오류:', e.message); return null; }
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // --allowedTools Read = 읽기 전용(파일 수정·실행 불가). 헤드리스 안전.
    const p = spawn(CLAUDE_BIN, ['-p', prompt, '--allowedTools', 'Read'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: os.tmpdir(),
    });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('타임아웃')); }, CLAUDE_TIMEOUT_MS);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
  });
}
