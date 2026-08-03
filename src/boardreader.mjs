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
import { getPartBoundaries, readPartWithClaude, readColumnRoster, getRosterColumns, readSummaryCounts, claudeBudgetLeft } from './claudereader.mjs';
import { snapStrong, confirmedCaddies } from './roster.mjs';
import { DATA_DIR } from './store.mjs';

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

// 판독 명단에 명단 최근접 스냅 적용(장미화→장미희 등 1글자 오독 교정). 괄호 점유자도 각각.
function snapRoster(roster) {
  const snap1 = (x) => snapStrong(String(x || '').trim());
  return (roster || []).map((cell) => {
    const s = String(cell || '').trim();
    const m = s.match(/^(.+?)\(([^)]+)\)\s*$/);
    if (m) return `${snap1(m[1].trim())}(${m[2].trim()})`;   // 태그(54·조출 등)는 스냅 안 함
    return snap1(s) || s;
  });
}

// 이름처럼 보이는가(2~4 한글, 괄호태그 허용) — 열분할에서 티오프 열 오검출을 거른다.
const _looksName = (nm) => /^[가-힣]{2,4}$/.test(String(nm || '').replace(/\([^)]*\).*/, '').replace(/\s/g, ''));

// ★열분할 판독 — 밀집 다열 명단은 열별로 따로 크롭해 '단일열'로 읽어야 하단·정렬이 정확(2부 50명).
//  rosterCols(크롭 fraction) → 원본 fraction 역매핑 → 각 열 단일 크롭 판독 → 열 순서로 이어붙여 위치정렬.
async function readColumnsAssemble(img, rosterCols, cropX0, cropX1, y1, part) {
  const cw = cropX1 - cropX0;
  const cols = rosterCols
    .map((rc) => ({ x0: Math.max(0, cropX0 + rc.x0 * cw - 0.006), x1: Math.min(1, cropX0 + rc.x1 * cw + 0.006) }))
    .filter((c) => c.x1 > c.x0)
    .sort((a, b) => a.x0 - b.x0);
  const names = [];
  for (let k = 0; k < cols.length; k++) {
    const c = cols[k];
    const colPath = path.join(TMP, `col_${part}_${Date.now()}_${k}.png`);
    let rows = null;
    try {
      await runPy({ image: img, crop_only: colPath, slice: { x0: c.x0, x1: c.x1, y1, lmargin: 0, margin: 0 }, scale: 6 }, 30000);
      rows = await readColumnRoster(colPath);
      try { fs.unlinkSync(colPath); } catch { /* noop */ }
    } catch (e) { console.error(`[boardreader] 부${part} 열${k} 오류:`, e.message); }
    if (!rows || !rows.length) continue;
    const valid = rows.filter((r) => _looksName(r.name));
    if (valid.length < 2) continue;   // 명단 열 아님(티오프 등) → 스킵
    for (const r of valid) names.push(r.name);   // 열 안은 위→아래 읽은 순서 그대로 누적
  }
  return names.length ? names : null;
}

// 한 세트의 경계로 부별 크롭+판독 1회. { '1':{roster,tee,cut,x0,x1}, ... }.
async function readPartsOnce(img, sorted, cuts) {
  const parts = {};
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    try {
      // ★가운데 부는 '다음 부 경계'까지만(번짐 방지). 마지막 부만 우측 여유(margin)로 티오프 안 잘리게.
      const next = sorted[i + 1];
      const x1 = next ? next.x0 : b.x1;
      const margin = next ? 0.0 : 0.05;
      const cropPath = path.join(TMP, `part_${b.part}_${Date.now()}_${i}.png`);
      // ★y1=0.73 — 명단 세로 전체 포착(공지영역 위까지). crop_only가 실제 사용 경계(x0/x1/y1)를 함께 반환.
      const meta = await runPy({ image: img, crop_only: cropPath, slice: { x0: b.x0, x1, margin, y1: 0.73 }, scale: 6 }, 30000);
      const r = await readPartWithClaude(cropPath);
      // ★열 경계 — part 판독의 rosterCols가 있으면 쓰고, 없으면(들쭉날쭉) 전용 호출로 확실히 잡는다.
      let rcols = (r && Array.isArray(r.rosterCols) && r.rosterCols.length) ? r.rosterCols : null;
      if (!rcols) { try { rcols = await getRosterColumns(cropPath); } catch { /* noop */ } }
      try { fs.unlinkSync(cropPath); } catch { /* noop */ }
      if (!r) continue;
      const cut = Number(cuts[b.part]) || r.cut || 0;   // 요약숫자 우선(더 신뢰), 없으면 per-part cut
      // ★열분할: 판독한 열 경계로 각 열을 단일 크롭 재판독 → 더 완전하면 채택(2부 다열 하단 누락·밀림 해결).
      let roster = r.roster;
      const cx0 = Number(meta?.x0), cx1 = Number(meta?.x1), cy1 = Number(meta?.y1) || 0.73;
      if (rcols && rcols.length && Number.isFinite(cx0) && Number.isFinite(cx1) && cx1 > cx0) {
        const colRoster = await readColumnsAssemble(img, rcols, cx0, cx1, cy1, b.part);
        const base = r.roster.filter(Boolean).length;
        if (colRoster && colRoster.length >= base && colRoster.length <= 60) {
          console.log(`[boardreader] 부${b.part} 열분할 채택: ${colRoster.length}명(${rcols.length}열, 단일 대비 +${colRoster.length - base})`);
          roster = colRoster;
        }
      }
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
  }
  return '';
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
    console.warn(`[boardreader] 시도 ${attempt + 1}/${maxTries} 불량(${fault}) → 경계 재추정 재시도`);
  }
  if (!best) return null;
  if (lastFault) console.warn(`[boardreader] 재시도 소진 — 최선 판독 채택(마지막 불량: ${lastFault})`);
  return { boundaries: bestBounds, parts: best, _claudeCalls: startBudget - claudeBudgetLeft(), _fault: lastFault };
}

// ★즉시 토글(재시작 불필요) — data/use-claude-reader 파일 있으면 배치표 판독을 서버 Claude로. 롤백=rm 파일.
//  (env CLAUDE_READER=1 도 허용.) 판독 시점마다 확인 → touch/rm 즉시 반영. 실패·캡초과면 judge가 로컬/Gemini 폴백.
export function useClaudeReader() {
  if (['1', 'true', 'yes'].includes(String(process.env.CLAUDE_READER || '').toLowerCase())) return true;
  try { return fs.existsSync(path.join(DATA_DIR, 'use-claude-reader')); } catch { return false; }
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
  if (/^(찾근|조출|정출|선발|당번|프리|벌당|배치|콜|정근)$/.test(inner)) return { name: base, holder: base.replace(/\s/g, ''), duty: inner, cross: false };
  return { name: inner || base, holder: (inner || base).replace(/\s/g, ''), duty: '', cross: false };
}

// 부별 Claude 판독({roster,tee,cut}) → judge()가 쓰는 verdict 형식. localvlm.readBoardLocalVerdict와 동일 계약 +
//  괄호 태그에서 crewDuty·guaranteedWork(54/찾근)·crossPartNames를 파생(3부 54·1,3 근무판정 게이트 근거).
function verdictFromPart(article, member, pd, allParts) {
  const roster = Array.isArray(pd?.roster) ? pd.roster.slice() : [];
  if (!roster.length) return null;
  const part = String(member?.part || '3').replace(/\D/g, '') || '3';
  const teeGrid = (pd.tee || [])
    .map((t) => ({ pos: Number(t.pos), time: String(t.time || ''), course: String(t.course || '').toUpperCase() }))
    .filter((t) => t.pos > 0 && /^\d{1,2}:\d{2}$/.test(t.time));
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
  const myStatus = myPos > 0 ? (cut && myPos <= cut ? 'assigned' : 'spare') : 'off';
  const tee = myPos > 0 ? teeGrid.find((t) => t.pos === myPos) : null;
  return {
    part, category: '배치표', relevant: true, rosterReliable: true,
    part3Roster: roster,
    teeGrid,
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
  const pr = readBoardByClaude(img, opts).catch((e) => { _boardCache.delete(img); throw e; });
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
  return verdictFromPart(article, member, pd, Object.keys(board.parts));
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
    const v = verdictFromPart(article, { name: '', part: p }, pd, Object.keys(board.parts));
    out[String(p)] = {
      roster: v.part3Roster.slice(), teeGrid: v.teeGrid, teamCount: Number(v.teamCount) || 0,
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
  return { roster: snapRoster(r.roster), tee: r.tee, cut: cut || r.cut || 0 };
}
