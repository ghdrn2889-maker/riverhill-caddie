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
import { getPartBoundaries, readPartWithClaude, readColumnRoster, getRosterColumns, readSummaryCounts, readOffList, getCrewColumns, readCrewColumn, claudeBudgetLeft, claudeTimeouts, readPart3Holistic, readRosterVerbatim, readDutyBox, readTeeRows, readHeadcountBox, readHeaderDate } from './claudereader.mjs';
import { snapStrong, snapName, confirmedCaddies, officialNearCandidates } from './roster.mjs';
import { DATA_DIR, appendJSONL, loadJSON, saveJSON } from './store.mjs';
import { raiseBoardIssue } from './boardalert.mjs';
import { fixedSlots, flexSlots } from './kakaogolf.mjs';
import { partExtras } from './dayframe.mjs';

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
const _SUB_TAGWORDS = new Set(['조출', '후출', '찾근', '조퇴', '반차', '오전', '오후', '대기', '스페어', '정출', '선발', '당번', '프리', '벌당', '배치', '콜', '정근', '휴무', '휴가', '병가', '연차', '월차', '격리', '마감', '대리', '주임', '마샬']);
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
    const CONF = new Set(confirmedCaddies());
    let n = 0, sn = 0;
    for (const it of vb) {
      const pos = Number(it.pos) || 0; if (pos < 1 || pos > out.length) continue;
      const vbRaw = String(it.name || '').trim();
      const hol = String(out[pos - 1] || '').trim();
      if (!hol) continue;                                    // 홀리스틱이 안 읽은 자리는 안 건드림(구조 보존)

      // ★성(姓) 복원(두 번째 눈) — 홀리스틱이 성을 흘려 '이름 2글자'만 읽은 자리를, 같은 verbatim 판독으로 메운다.
      //  실증 2026-08-17: 33명 중 '진수'·'하늘' 둘만 성이 빠졌다(둘 다 신입이라 정본 명단에 없었다).
      //  정본 대조 복원(restoreSurname)은 이 둘을 못 고친다 —
      //   '진수'는 후보가 0개(명단에 없음), '하늘'은 후보가 2개가 된다(이하늘이 같은 배치표 8번에 이미 있다).
      //  그래서 사전이 아니라 '두 번째 판독'으로 푼다. 받아들이는 조건은 하나뿐이다:
      //   verbatim이 읽은 3글자의 끝 2글자가 홀리스틱이 읽은 2글자와 정확히 같을 것.
      //   서로 다른 두 판독이 이름에 합의했고 한쪽만 성을 더 봤다는 뜻이라, 새 사람을 지어내지 않는다.
      const holBare = hol.replace(/\([^)]*\)/g, '').trim();
      if (/^[가-힣]{2}$/.test(holBare) && !CONF.has(holBare)) {
        const vbBare = vbRaw.replace(/\([^)]*\)/g, '').trim();
        if (/^[가-힣]{3}$/.test(vbBare) && vbBare.slice(1) === holBare) {
          out[pos - 1] = vbRaw; sn += 1;
          console.log(`[boardreader] 성 복원: ${pos}번 "${hol}" → "${vbRaw}" (명단전용 재판독 일치)`);
          continue;
        }
      }

      const { owner, sub } = _ownerSubOf(vbRaw);
      if (!sub) continue;                                    // verbatim에도 대체자 없으면 스킵
      const holOwner = (hol.match(/^([가-힣]{2,4})/) || [])[1] || '';
      if (owner && holOwner && owner === holOwner && vbRaw !== hol) { out[pos - 1] = vbRaw; n += 1; }
    }
    if (n) console.log(`[boardreader] 대바 복구: ${n}건 오버레이(명단 전용 재판독)`);
    if (sn) console.log(`[boardreader] 성 복원 ${sn}건 — 추가 호출 0(대바 복구와 같은 판독 재사용)`);
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

// ★명단 열 크롭의 세로 한계 — 부 크롭(y1=0.73)은 '공지영역 배제'가 목적이라 명단이 긴 부(2부 50명 2열)에선
//  표 아랫부분을 통째로 잘라먹는다(실측 8/13 #27261: 25행 중 하단 7행 = 19~25·44~46 증발, 두 열 대칭으로 잘림).
//  3부만 홀리스틱 전용 크롭(y1=0.98)이라 멀쩡했고 1·2부는 이 절단을 그대로 맞았다.
//  열 크롭은 '명단 열'만 좁게 따므로 아래로 늘려도 티오프표를 안 물고, COLUMN_PROMPT가 '순번 없는 텍스트
//  (공지·범례)는 무시'하므로 표 아래 공지가 섞여도 안전하다. → 열분할만 전체 높이로 읽는다.
//  ★1.0(전체) — 명단 마지막 줄은 이미지 맨 아래 끝에 붙어 있다(실측 #27261: 순번25 정이슬 y≈0.979/571x1196).
//   0.95·0.98 둘 다 그 줄을 반으로 잘라 못 읽었다. 열 크롭은 '순번+이름' 열만 좁게 따고 COLUMN_PROMPT가
//   순번 없는 텍스트를 무시하므로 끝까지 읽어도 공지·범례가 섞이지 않는다. 잘라야 할 이유가 없다.
const ROSTER_COL_Y1 = 1.0;

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

// ── 격자 밖 티오프 — 팀이 끼워진 신호 ────────────────────────────────
//  ★7분 배수는 원칙이지 법이 아니다. 예약팀은 팀을 하나 더 받으려고 격자 사이에 칸을 끼운다.
//   실측 2026-08-18 3부: 순번 10이 17:35 → 17:30으로 앞당겨졌고 11번은 17:35를 그대로 받았다.
//   그날 그 칸은 대조판 격자에도 없고(행이 없다) 카카오 여집합에도 없다(기준틀 밖이라 판정 안 함).
//   팀이 하나 더 있는데 두 경로 모두 몰랐고, 사람이 손으로 일지를 고쳐야 했다.
//  ★고칠 수는 없다 — 골프장이 정하는 일이다. 그러나 '알아채는 것'은 우리 몫이다.
//   판독이 격자에 없는 시각을 봤다면 그건 오독이거나 끼워진 칸이고, 둘 다 사람이 봐야 한다.
//  ★이미 관리자가 '＋칸'으로 넣어둔 칸은 아는 칸이므로 다시 안 알린다.
function _offGridTees(tees, part, dateKey = '') {
  const ok = new Set([...fixedSlots(), ...flexSlots()]
    .filter((f) => String(f.part) === String(part)).map((f) => f.time));
  for (const k of partExtras(dateKey, part)) ok.add(String(k).split('|')[0]);
  const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const out = new Set();
  for (const t of (tees || [])) {
    const m = String((t && t.time) || t || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) continue;
    const norm = hm(+m[1] * 60 + +m[2]);          // "6:23"과 "06:23"을 같은 것으로 본다
    if (!ok.has(norm)) out.add(norm);
  }
  return [...out].sort();
}

// ── ★티오프 사다리 — 줄 단위 판독을 순번↔시각으로 조립하고 '기계적으로' 검증한다 ──
//  기존 검사(_teeConflicts)는 한 시각에 3명 이상일 때만 잡는다. 그런데 실제 손해의 대부분인
//  '통째 밀림'은 각 시각에 OUT 1·IN 1을 유지하므로 그 그물을 그대로 빠져나간다.
//  여기서는 표 자체의 성질로 검증한다 — 티오프는 일정 간격(리버힐 7분)으로 인쇄되므로,
//  줄 간격이 그 배수가 아니면 줄을 빠뜨린 것이고, 같은 순번이 두 번 나오면 번호를 잘못 붙인 것이다.
const _mins = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; };
//  cut을 주면 '커트 안 순번은 모두 티오프가 있어야 한다'까지 본다. 줄을 통째로 빠뜨린 판독은
//  간격이 여전히 cadence의 배수라 간격 검사로는 안 걸리고, 대신 그 줄의 순번이 통째로 사라진다.
export function teeLadderFromRows(rows, cut = 0) {
  const issues = [];
  const list = (rows || []).map((r) => ({ ...r, m: _mins(r.time) })).filter((r) => r.m != null);
  if (list.length < 2) return { tee: [], cadence: 0, issues: ['줄이 너무 적음'] };
  // 간격(cadence) = 연속한 줄 시각차 중 가장 흔한 값. 판독이 아니라 표의 성질에서 얻는다.
  const gaps = [];
  for (let i = 1; i < list.length; i++) { const d = list[i].m - list[i - 1].m; if (d > 0) gaps.push(d); }
  const freq = {};
  for (const g of gaps) freq[g] = (freq[g] || 0) + 1;
  const cadence = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]) || 0;
  // 시각이 거꾸로 가거나, 간격이 cadence의 배수가 아니면 줄을 잘못 읽은 것.
  for (let i = 1; i < list.length; i++) {
    const d = list[i].m - list[i - 1].m;
    if (d <= 0) { issues.push(`시각 역행 ${list[i - 1].time}→${list[i].time}`); continue; }
    if (cadence > 0 && d % cadence !== 0) issues.push(`간격 어긋남 ${list[i - 1].time}→${list[i].time}(${d}분)`);
  }
  const tee = [];
  const seen = new Map();
  for (const r of list) {
    for (const [k, course] of [['out', 'OUT'], ['in', 'IN']]) {
      const p = Number(r[k]); if (!(p > 0)) continue;
      if (seen.has(p)) issues.push(`순번 ${p} 중복(${seen.get(p)}·${r.time})`);
      else seen.set(p, r.time);
      tee.push({ pos: p, time: r.time, course });
    }
  }
  // 커트 안인데 티오프가 없는 순번 = 그 줄을 못 읽었다는 뜻(줄 누락의 유일한 확실한 신호).
  const n = Number(cut) || 0;
  if (n > 0) {
    const miss = [];
    for (let p = 1; p <= n; p++) if (!seen.has(p)) miss.push(p);
    if (miss.length) issues.push(`티오프 없는 순번 ${miss.slice(0, 12).join(',')}${miss.length > 12 ? '…' : ''}(${miss.length}개)`);
  }
  return { tee, cadence, issues };
}
// 티오프 표만 잘라 줄 단위로 다시 읽고, 기존 판독과 대조해 기록만 남긴다(교체는 결과를 보고).
//  crop: 이 부의 이미지. rcols: 명단 열 경계(이 이미지 기준) — 티오프 표는 그 오른쪽이다.
//  ★예산 보호: 남은 호출이 빠듯하면 건너뛴다. 섀도우 때문에 본 판독이 굶으면 본말전도다.
const TEE_SHADOW_MIN_BUDGET = 12;
async function teeShadow(crop, rcols, part, oldTee, cut) {
  if (String(process.env.TEE_SHADOW || '1') === '0') return;
  try {
    if (!crop || !fs.existsSync(crop)) return;
    if (!Array.isArray(rcols) || !rcols.length) return;            // 표 위치를 모르면 자를 수 없다
    if (claudeBudgetLeft() < TEE_SHADOW_MIN_BUDGET) { console.log(`·  [티오프 섀도우] 예산 부족(${claudeBudgetLeft()}) — 건너뜀`); return; }
    const x0 = Math.min(0.97, Math.max(...rcols.map((c) => Number(c.x1) || 0)) + 0.005);
    if (!(x0 > 0 && x0 < 0.97)) return;
    const p = path.join(TMP, `teerows_${part}_${Date.now()}.png`);
    try { await runPy({ image: crop, crop_only: p, slice: { x0, x1: 1, y0: 0, y1: 1, lmargin: 0 }, scale: 3 }, 30000); }
    catch (e) { console.error('[티오프 섀도우] 크롭 실패:', e.message); return; }
    const rows = await readTeeRows(p);
    try { fs.unlinkSync(p); } catch { /* noop */ }
    if (!rows) return;
    const { tee, cadence, issues } = teeLadderFromRows(rows, cut);
    const d = teeDiff(oldTee, tee);
    const rec = { at: Date.now(), part: Number(part), cut: Number(cut) || 0, cadence,
      rows: rows.length, oldN: (oldTee || []).length, newN: tee.length,
      same: d.same, diffN: d.diff.length, diff: d.diff.slice(0, 20),
      onlyOld: d.onlyOld, onlyNew: d.onlyNew, issues: issues.slice(0, 8) };
    appendJSONL('tee-shadow.jsonl', rec);
    console.log(`·  [티오프 섀도우] 부${part} 줄${rows.length}·간격${cadence}분 | 일치 ${d.same} · 불일치 ${d.diff.length}`
      + `${d.diff.length ? ' (' + d.diff.slice(0, 4).join(', ') + ')' : ''}`
      + `${issues.length ? ' | 새 판독 자체 이상: ' + issues.slice(0, 2).join(', ') : ''}`);
  } catch (e) { console.error('[티오프 섀도우] 오류:', e.message); }
}

// 티오프 구제 — 가운데 부의 티오프 표가 '다음 부 시작점'에 잘렸을 때만 부 크롭을 넓혀 다시 읽는다.
//  ★2부는 티오프 표가 명단 오른쪽 끝(=3부 바로 앞)에 있다. 위 크롭이 여유 0으로 next.x0에서 끊으므로
//    경계 추정이 조금만 왼쪽으로 빗나가면 IN 열이 통째로 사라진다.
//    실측 8/20 #27438: 컷 16인데 티오프 10개가 전부 OUT, 빠진 2,3,5,7,11,16이 정확히 IN 열이었다.
//  ★열 경계(rcols)에 기대지 않는다 — 실측해 보니 rcols 오른끝이 OUT 열을 삼켜서, 그걸 기준으로 자르면
//    구제 크롭에 OUT이 안 들어온다. 부 크롭 자체를 오른쪽으로 조금 넓혀 같은 부 판독을 한 번 더 돌린다.
//  ★넓힌 크롭에서 '명단은 버리고 티오프만' 가져온다 — 옆 부 이름이 섞여 들어와도 쓰지 않으므로
//    교차 부 오염이 구조적으로 불가능하다(과거 사고의 재발 경로를 원천 차단).
//  ★그리고 '빈 자리만' 채운다 — 넓힌 판독은 기존 칸을 틀리게 읽을 수 있다(8/20 실측: 16칸을 다 찾았지만
//    기존 10칸 중 3개의 시각이 틀렸다). 통째로 갈아끼우면 멀쩡한 값이 망가진다.
//  ★증거가 있을 때만(컷 안에 빈 순번이 있을 때만) 돈다. 멀쩡하면 호출을 안 태운다.
const TEE_RESCUE_SPILL = 0.02;            // 다음 부 시작점 너머로 더 보는 폭
async function rescueTee({ img, tee, bx0, next, part, cut }) {
  try {
    if (String(process.env.TEE_RESCUE || '1') === '0') return tee;
    if (!next || !(Number(cut) > 0)) return tee;             // 마지막 부는 이미 우측 여유(margin)가 있다
    const have = new Set((tee || []).map((t) => Number(t.pos)).filter((n) => n > 0));
    const miss = [];
    for (let n = 1; n <= cut; n++) if (!have.has(n)) miss.push(n);
    if (!miss.length) return tee;                            // 빈 자리가 없으면 손대지 않는다
    if (claudeBudgetLeft() < TEE_SHADOW_MIN_BUDGET) { console.log(`·  [티오프 구제] 부${part} 예산 부족(${claudeBudgetLeft()}) — 건너뜀`); return tee; }
    const x1 = Math.min(1, (Number(next.x0) || 0) + TEE_RESCUE_SPILL);
    if (!(x1 > Number(bx0))) return tee;
    const tmp = path.join(TMP, `teerescue_${part}_${Date.now()}.png`);
    try { await runPy({ image: img, crop_only: tmp, slice: { x0: bx0, x1, margin: 0, y1: 0.73 }, scale: 6 }, 30000); }
    catch (e) { console.error('[티오프 구제] 크롭 실패:', e.message); return tee; }
    const wide = await readPartWithClaude(tmp);              // ★명단은 안 쓴다 — tee만 꺼낸다
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    if (!wide || !Array.isArray(wide.tee)) return tee;
    // ★덮어쓰지 않는다 — 빈 자리만 채운다.
    //   실측 8/20: 넓힌 판독이 16칸을 다 찾았지만 기존 순번 3개의 시각을 틀리게 읽었다(원래 10개가 정답).
    //   통째로 갈아끼우면 멀쩡한 값이 망가진다. 원래 값은 그대로 두고 없는 순번만 더한다.
    const d = teeDiff(tee, wide.tee);
    // ★정렬 증거 — 기존 순번의 시각을 크게 어기면 줄이 밀린 판독이다. 그런 판독의 여분도 못 믿는다.
    const misaligned = d.diff.length > Math.floor(have.size * 0.4);
    // ★간격(cadence)은 '믿는 쪽'(원래 판독)에서 얻는다 — 채워 넣을 시각이 같은 사다리 위에 있어야 한다.
    const mins = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const base = (tee || []).map((t) => mins(t.time)).filter((n) => n != null).sort((a, b) => a - b);
    const gaps = {};
    for (let n = 1; n < base.length; n++) { const g = base[n] - base[n - 1]; if (g > 0) gaps[g] = (gaps[g] || 0) + 1; }
    const cadence = Number(Object.keys(gaps).sort((a, b) => gaps[b] - gaps[a])[0]) || 0;
    const onLadder = (t) => { const m = mins(t); if (m == null || !base.length) return false; return cadence > 0 ? (m - base[0]) % cadence === 0 : true; };
    const want = new Set(miss);
    const add = []; const dropped = []; const taken = new Set();
    for (const t of wide.tee) {
      const n = Number(t.pos);
      if (!(n > 0) || !want.has(n) || taken.has(n)) continue;   // 빈 자리만 · 한 번만
      if (!onLadder(t.time)) { dropped.push(`${n}번 ${t.time}(사다리 밖)`); continue; }
      taken.add(n);
      add.push({ pos: n, time: String(t.time), course: String(t.course) === 'IN' ? 'IN' : 'OUT' });
    }
    const ok = !misaligned && add.length > 0;
    console.log(`·  [티오프 구제] 부${part} 컷${cut} · 빈 순번 ${miss.join(',')} → ${ok ? `${add.length}칸 채움(${have.size}→${have.size + add.length}, 기존 값은 안 건드림)` : '채움 없음'}`
      + `${misaligned ? ` | 줄 밀림 의심(기존 ${have.size}칸 중 ${d.diff.length}개 시각 어긋남) — 여분도 안 씀` : ''}`
      + `${dropped.length ? ' | 버림 ' + dropped.slice(0, 4).join(', ') : ''}`);
    appendJSONL('tee-rescue.jsonl', { at: Date.now(), part: Number(part), cut, missBefore: miss, before: have.size,
      added: add.map((t) => `${t.pos}:${t.time}${t.course}`), adopted: ok, misaligned, diffN: d.diff.length,
      cadence, dropped: dropped.slice(0, 8), x0: bx0, x1 });
    if (!ok) return tee;
    return tee.concat(add).sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
  } catch (e) { console.error('[티오프 구제] 오류:', e.message); return tee; }
}

// 두 사다리 비교 — 같은 순번에 붙은 시각이 다른 곳을 센다(섀도우 판정의 근거).
export function teeDiff(a, b) {
  const A = new Map((a || []).filter((x) => Number(x.pos) > 0).map((x) => [Number(x.pos), String(x.time || '')]));
  const B = new Map((b || []).filter((x) => Number(x.pos) > 0).map((x) => [Number(x.pos), String(x.time || '')]));
  const diff = [];
  let same = 0;
  for (const [p, ta] of A) { if (!B.has(p)) continue; const tb = B.get(p); if (ta === tb) same++; else diff.push(`${p}번 ${ta}→${tb}`); }
  return { same, diff, onlyOld: [...A.keys()].filter((p) => !B.has(p)).length, onlyNew: [...B.keys()].filter((p) => !A.has(p)).length };
}

// ★명단 구멍 — 채워진 마지막 순번 이전의 빈 자리들. 3부의 '티오프 누락 자가검증'과 같은 원리를 명단에 적용한다.
//  두 열 명단에서 한 열 하단이 잘리면 열 사이에 구멍이 남는다(실측: 1~18 읽고 19~25 비고 26~43 읽음 → 구멍 19~25).
//  꼬리 절단(마지막 열의 아랫부분)은 구멍으로 안 보이므로 별도로 잡을 수 없다 — 그건 크롭 높이(ROSTER_COL_Y1)로 해결.
function _rosterHoles(roster) {
  const arr = roster || [];
  let last = -1;
  for (let i = arr.length - 1; i >= 0; i--) if (_bare(arr[i])) { last = i; break; }
  const holes = [];
  for (let i = 0; i < last; i++) if (!_bare(arr[i])) holes.push(i + 1);
  return holes;
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
      return valid.length >= 2 ? valid : [];   // 명단 열 아님(티오프 등)이면 빈 배열. ★{pos,name} 유지
    } catch (e) { console.error(`[boardreader] 부${part} 열${k} 오류:`, e.message); return []; }
  }));
  const flat = perCol.flat();
  if (!flat.length) return null;
  // ★순번(pos) 기준 위치배치 — 이어붙이기(flat)는 중간 한 줄만 못 읽어도 그 뒤가 통째로 한 칸씩 밀린다.
  //  (3부 홀리스틱은 names[pos-1]이라 안전했고, 1·2부만 이 밀림 위험을 안고 있었다.)
  //  COLUMN_PROMPT가 '인쇄된 순번'을 pos로 주므로 전역 위치로 그대로 쓴다 — 열이 몇 개든 좌→우 순서에 의존하지 않는다.
  //  pos가 부실한(0·비정상) 열이 섞이면 위치배치를 못 믿으니 종전처럼 순차 이어붙이기로 폴백.
  const posOK = flat.filter((r) => r.pos > 0 && r.pos <= 80).length >= Math.ceil(flat.length * 0.8);
  if (posOK) {
    const maxPos = flat.reduce((mx, r) => Math.max(mx, (r.pos > 0 && r.pos <= 80) ? r.pos : 0), 0);
    const names = new Array(maxPos).fill('');
    for (const r of flat) if (r.pos > 0 && r.pos <= maxPos) names[r.pos - 1] = r.name;
    return names.filter(Boolean).length ? names : null;
  }
  const names = flat.map((r) => r.name);   // 폴백: 열 순서 유지(위→아래 누적 순서 그대로)
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

// ★역할 태그(당번·벌당·배치·프리) — 그날의 보직. 순번 근무와 별개로 배치표가 따로 세는 것들이다.
//  조편성표는 이미 전원의 근무칸을 읽고 있는데(실측 8/21: 83명 전원, 역할 2건 정확), 그걸 티브레이크에만
//  쓰고 버려서 당번·배치가 어디에도 안 잡혔다(채점표 '당번 0/1 · 배치 0/1'). Claude 호출 0회로 메운다.
//
//  ★근무부 태그(3부·1,3·54)는 일부러 안 가져온다. 그건 '순번표에 있어야 할 사람'이라는 뜻이라,
//   역할로 인정해 버리면 명단을 못 읽어 사라진 사람을 '설명됨'으로 덮어 채점이 거짓말을 한다.
//   여기 넣는 넷은 배치표 요약 상자가 직접 세는 항목이라, 상자와 대조해 맞는지 확인할 수 있다.
const ROLE_TAG_RE = /^(당번|벌당|배치|프리)$/;
export function rolesFromCrew(crew) {
  const out = []; const seen = new Set();
  for (const c of (crew || [])) {
    const duty = String(c?.duty || '').replace(/\s/g, '').trim();
    if (!ROLE_TAG_RE.test(duty)) continue;
    const name = snapOfficial(c.name) || String(c.name || '').replace(/\s/g, '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name); out.push({ name, role: duty });
  }
  return out;
}

// 한 세트의 경계로 부별 크롭+판독 1회. { '1':{roster,tee,cut,x0,x1}, ... }.
// issues: 이번 '시도'에서만 알 수 있는 손상(3부 홀리스틱의 grid_short)을 담아 호출자에게 돌려준다.
//  ★알림은 여기서 쏘지 않는다 — 판독은 최대 3회 재시도하고 그중 하나만 채택된다. 버려질 시도의 손상까지
//   알리면 오경보다(실측 8/15 22:15: 3부 구멍[1~20]이 떴지만 최종 채택본은 34명 멀쩡했다).
//   명단 구멍·티오프 충돌은 채택이 끝난 뒤 '최종본으로 다시 세서' 쏜다(raiseAdoptedBoardIssues).
async function readPartsOnce(img, sorted, cuts, issues = [], attempt = 0, reusable = {}) {
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
    // ★안 바뀐 부는 건너뛴다 — 이 부의 화면 구역이 직전 배치표와 픽셀 하나까지 같다는 게 증명된 경우뿐이다.
    const cached = reusable && reusable[b.part];
    if (cached) {
      parts[b.part] = cached;
      console.log(`[증분] ${b.part}부 그대로 → 판독 건너뜀(명단 ${(cached.roster || []).filter(Boolean).length}명·티 ${(cached.tee || []).length})`);
      continue;
    }
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
              // ★시각까지 읽힌 칸만 '있다'로 센다 — 순번만 있고 시각이 빈 칸은 회원에게 줄 게 없다.
              const gaps = teeGaps(h.tees || [], cut);
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
                    const still = teeGaps(h.tees, cut);
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
              //  ★'가장 큰 순번'이 아니라 '실제로 찬 칸'을 본다. 꼬리가 닿아도 가운데가 비면 그 사람은 티오프가 없다
              //   (gridMax만 보면 1~9번과 14번만 읽어도 14≥14라 그냥 통과했다).
              const _adoptGaps = teeGaps(h.tees || [], cut);
              if (_adoptGaps.length) {
                appendJSONL('dayboard-anomaly.jsonl', { at: Date.now(), kind: 'grid_short', part: 3, teeMax: gridMax, cut, miss: _adoptGaps.slice(0, 20), articleHint: '3부 홀리스틱', note: '티오프 누락 — 꼬리 재판독 후에도 컷 이내 빈 순번(사람 확인 필요)' });
                issues.push({ kind: 'grid_short', part: 3, teeMax: gridMax, cut, miss: _adoptGaps.slice(0, 20) });
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
      const cx0 = Number(meta?.x0), cx1 = Number(meta?.x1);
      if (rcols && rcols.length && Number.isFinite(cx0) && Number.isFinite(cx1) && cx1 > cx0) {
        // ★세로는 부 크롭(0.73)이 아니라 ROSTER_COL_Y1(전체) — '하단 누락 해결'하라고 만든 열분할이
        //  정작 잘린 크롭 높이를 그대로 물려받아 같은 범위만 다시 읽던 근본 버그(하단은 영원히 복구 불가).
        const colRoster = await readColumnsAssemble(img, rcols, cx0, cx1, ROSTER_COL_Y1, b.part);
        const base = r.roster.filter(Boolean).length;
        const gain = (colRoster || []).filter(Boolean).length;   // ★위치배치 후엔 length에 구멍이 섞이니 '채워진 수'로 비교
        // ★접두 일치 가드 — 단일판독과 앞자리가 어긋나면(밀림·옆부 침범) 채택 거부(유령/과대판독 방지).
        if (colRoster && gain >= base && colRoster.length <= 60 && _prefixAgrees(colRoster, r.roster)) {
          console.log(`[boardreader] 부${b.part} 열분할 채택: ${gain}명/순번${colRoster.length}(${rcols.length}열, 단일 대비 +${gain - base})`);
          roster = colRoster;
        }
      }
      // ★대바 복구 — 부 프롬프트가 버린 마젠타 '주인(태그)대체자' 셀을 명단전용 재판독으로 순번별 오버레이.
      roster = await recoverSubstitutes(cropPath, roster);
      // ★티오프 줄판독 섀도우 — 새 방식을 나란히 돌려 결과만 기록한다(아직 교체 안 함).
      //  손해의 63%가 티오프였고 그중 98.9%가 '줄 밀림'이었다. 바꾸기 전에 새 방식이 정말 나은지
      //  같은 배치표에서 숫자로 확인한다("고쳐봤습니다"로 끝내지 않기 위한 장치).
      if (attempt === 0) await teeShadow(cropPath, rcols, b.part, r.tee, cut);   // ★첫 시도에만 — 재시도마다 따라 돌면 호출만 태운다
      try { fs.unlinkSync(cropPath); } catch { /* noop */ }
      // ★티오프 구제 — 컷 안에 빈 순번이 있으면(=표가 잘렸다는 신호) 시각표만 넓게 다시 잘라 읽는다.
      r.tee = await rescueTee({ img, tee: r.tee, bx0: b.x0, next, part: b.part, cut });
      // ★자가검증(3부 교정 원리 이식) — 1·2부는 그동안 어떤 완전성 검사도 없이 조용히 통과했다.
      //  고치지는 못해도(고치려면 재판독=비용) '이상하다'를 남겨 모니터·사람이 잡게 한다. 3부의 grid_short와 같은 취지.
      const holes = _rosterHoles(roster);
      if (holes.length) {
        console.warn(`[boardreader] 부${b.part} 명단 구멍 ${holes.length}칸(순번 ${holes.slice(0, 12).join(',')}${holes.length > 12 ? '…' : ''}) — 열 하단 절단/누락 의심`);
        appendJSONL('dayboard-anomaly.jsonl', { at: Date.now(), kind: 'roster_holes', part: Number(b.part), holes: holes.slice(0, 30), rosterLen: roster.length, cut, note: '명단 중간 빈 순번 — 열 하단 절단 또는 판독 누락(사람 확인 필요)' });
        // ★알림은 여기가 아니라 채택 확정 후(raiseAdoptedBoardIssues) — 그때 최종 명단으로 다시 세서 쏜다.
      }
      const tconf = _teeConflicts(r.tee);
      if (tconf.length) {
        console.warn(`[boardreader] 부${b.part} 티오프 충돌(${tconf.join(',')}) — 순번↔시각 밀림 의심`);
        appendJSONL('dayboard-anomaly.jsonl', { at: Date.now(), kind: 'tee_conflict', part: Number(b.part), times: tconf, note: '한 시각 3명↑ 또는 코스 중복 — 순번↔시각 사다리 밀림(사람 확인 필요)' });
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
        raiseBoardIssue({ kind: 'cross_part_contamination', part: Number(a), purged: hits.length, names: detail });
      }
    }
  } catch (e) { console.error('[교차오염 정리 오류]', e.message); }
  return parts;
}

// 조편성 근무칸이 '근무'인가(근태 아님) — 애매이름 티브레이크의 '오늘 근무자' 판정.
// ★벌당 추가 — 빠져 있어 벌당 근무자가 '오늘 근무자 집합'에서 통째로 누락됐다(애매이름 티브레이크 근거 손실).
const _WORK_DUTY_RE = /1부|2부|3부|1,3|2,3|54|조출|후출|찾근|정출|선발|당번|벌당|배치|마감|대리|주임|마샬|프리|콜|정근/;

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

// ★부 태그 교차 티브레이크 — 애매한 이름을 '그 사람이 반드시 있어야 할 다른 부'가 가려낸다.
//  (1,3)이 붙은 사람은 정의상 1부와 3부 명단에 둘 다 있다. 그러니 3부에서 이름이 흐려도
//  1부 명단이 정답을 들고 있다. 실측 2026-08-21 3부: '강예영(1,3)'·'김수원(1,3)'.
//   · 강예영 → 정본 후보 강혜영·천예영 둘 → 스냅은 '유일하지 않다'며 포기. 1부엔 강혜영만 있다 → 확정.
//   · 김수원 → 후보 최수원·김수룡·김수안·김예원 넷 → 포기. 1부엔 김수룡만 있다 → 확정.
//  기존 티브레이크(disambiguateByWorking)는 근태·조편성 크롭에서 '오늘 근무자'를 얻는데,
//  카톡 캡처는 부분 크롭이라 그 영역이 안 들어온다(로그: '근태 판독: 0명'). 재료가 없어 한 번도 안 돌았다.
//  이건 재료가 명단 안에 있다 — 다른 부의 명단이다.
// nearOf를 갈아끼울 수 있게 둔다 — 검사에서 진짜 사전을 건드리지 않고 이 판단만 시험하려고.
export function disambiguateByCrossPart(parts, nearOf = officialNearCandidates) {
  const PARTS_OF = (tag) => {
    const t = String(tag || '').replace(/\s/g, '');
    if (t === '54') return ['1', '2', '3'];
    const m = t.match(/^([123])[,、]([123])$/);
    return m ? [m[1], m[2]] : [];
  };
  const bareOf = (p2) => new Set((parts[p2]?.roster || []).map(_bare).filter(Boolean));
  const bareCache = {};
  const bareIn = (p2) => (bareCache[p2] ||= bareOf(p2));
  let fixed = 0;
  for (const p2 of Object.keys(parts)) {
    const roster = parts[p2].roster || [];
    const present = new Set(roster.map(_bare).filter(Boolean));
    for (let i = 0; i < roster.length; i++) {
      const cell = String(roster[i] || ''); if (!cell) continue;
      const tag = _tag(cell);
      const others = PARTS_OF(tag).filter((x) => x !== p2 && parts[x]);
      if (!others.length) continue;                       // 부 태그가 없으면 교차할 상대가 없다
      const bare = _bare(cell);
      if (!/^[가-힣]{2,4}$/.test(bare)) continue;
      const cands = nearOf(bare);
      if (cands.length < 2) continue;                     // 유일하면 스냅이 이미 처리했다
      const hit = cands.filter((c) => !present.has(c) && others.some((x) => bareIn(x).has(c)));
      if (hit.length !== 1) continue;
      const repl = `${hit[0]}(${tag})`;
      console.log(`[boardreader] 부태그 티브레이크: ${p2}부 순번${i + 1} '${cell}'→'${repl}' (${others.join('·')}부 명단에 유일)`);
      roster[i] = repl; present.add(hit[0]); bareCache[p2] = null; delete bareCache[p2];
      fixed++;
    }
  }
  if (fixed) console.log(`[boardreader] 부태그 티브레이크 ${fixed}건`);
  return fixed;
}

// ★오늘 이 캐디가 몇 부를 뛰는가 — 단일인가 중복인가 당겨온 것인가.
//  이 판정이 흩어져 있으면 정산(부 조합 = 캐디피)·일지(두 탕)·알림이 각자 다른 답을 낸다.
//  그래서 여기서 한 번만 정한다.
//
//  리버힐 규칙(관리자 확인 2026-08-21)
//   · 태그(54·1,3·2,3)가 붙은 사람 = 중복 근무자. 태그가 뛰는 부를 말한다.
//   · 태그 없는 사람 = 원번 근무자(한 부만).
//   · ★당겨오기 — 어느 부의 가용 캐디가 팀 수보다 모자라도 예약은 계속 받는다. 옆 부에서 당겨오면 되니까.
//     당길 수 있는 사람은 시간이 자유로운 원번 근무자뿐이다. 중복 근무자는 이미 두 부에 묶여 못 당긴다.
//     ★당겨오기는 '추가'가 아니라 '이동'이다 — 원래 부에서 빠져 받는 부로 간다.
//      그래서 당겨진 사람은 오늘도 여전히 '단일 근무'다. 부만 바뀐 것이다.
//      이걸 중복으로 세면 캐디피가 두 부로 잡히고 일지엔 두 탕이 찍힌다 — 하루가 통째로 틀어진다.
//     당겨온 사람은 받는 부 명단의 '맨 끝'에 얹힌다(원래 순번이 없으니 뒤에 붙일 수밖에 없다).
export function resolveWorkParts(parts) {
  const PARTS_OF = (tag) => {
    const t = String(tag || '').replace(/\s/g, '');
    if (t === '54') return ['1', '2', '3'];
    const m = t.match(/^([123])[,、]([123])$/);
    return m ? [m[1], m[2]] : [];
  };
  const seat = {};
  for (const p2 of Object.keys(parts || {})) {
    const pd = parts[p2] || {};
    const roster = pd.roster || [];
    const cut = Number(pd.cut) || 0;
    roster.forEach((cell, i) => {
      const nm = _bare(cell); if (!nm) return;
      (seat[nm] ||= []).push({ part: p2, pos: i + 1, tag: _tag(cell), working: cut > 0 && (i + 1) <= cut, last: i + 1 === roster.length });
    });
  }
  const out = {};
  for (const [nm, rows] of Object.entries(seat)) {
    const work = rows.filter((r) => r.working).map((r) => r.part);
    const spare = rows.filter((r) => !r.working).map((r) => r.part);
    const tags = [...new Set(rows.map((r) => r.tag).filter(Boolean))];
    if (tags.length) {
      const allowed = [...new Set(rows.flatMap((r) => PARTS_OF(r.tag)))];
      const extra = work.filter((x) => !allowed.includes(x));
      out[nm] = { name: nm, kind: 'multi', tag: tags[0], parts: work.slice().sort(), spare, rows,
        problem: extra.length ? `당길 수 없는 중복 근무자가 ${extra.join('·')}부에 있음` : '' };
      continue;
    }
    if (work.length <= 1) { out[nm] = { name: nm, kind: 'single', tag: '', parts: work.slice(), spare, rows, problem: '' }; continue; }
    // 태그 없이 두 부 이상 근무 — 당겨오기로 설명되는가.
    const tail = rows.filter((r) => r.working && r.last);
    if (tail.length === 1 && work.length === 2) {
      const to = tail[0].part;
      const from = work.find((x) => x !== to) || '';
      out[nm] = { name: nm, kind: 'pulled', tag: '', parts: [to], from, spare, rows,
        // 이동이므로 원래 부에 이름이 남아 있으면 그 뒤 순번이 한 칸 밀려 있을 수 있다.
        problem: `${from}부 명단에 이름이 남아 있음(당겨오기는 이동이다)` };
      continue;
    }
    out[nm] = { name: nm, kind: 'conflict', tag: '', parts: work.slice().sort(), spare, rows,
      problem: '표시도 없고 당겨온 자리도 아님' };
  }
  return out;
}

// ★명단 자체의 앞뒤가 맞는가 — 고치지 않고 '이상하다'고만 말한다.
//  실측 2026-08-21에 어떤 검사에도 안 걸린 것들:
//   · 3부에 '김예원'이 17번과 37번, 두 번. 스냅은 '고치다가 중복 만들기'만 막지 판독이 처음부터
//     같은 이름을 두 번 뱉으면 그대로 통과한다.
//   · 1부에 '강경순'이 잘못 들어갔다(2부 4번에도 근무자로 있다). 티오프 칸도 하나 같이 늘어
//     13명/13칸으로 '짝이 맞아' 기존 검사(teeGaps)를 전부 통과했다 — 짝이 맞는 건 옳다는 뜻이 아니다.
//  ★부 태그 없이 두 부에 있는 것 자체는 정상이다(한 부는 스페어일 수 있다).
//   이상한 건 '태그 없이 두 부 모두에서 근무자(순번 ≤ 커트)'인 경우다.
export function rosterSanity(parts) {
  const out = [];
  const cutOf = (pd) => Number(pd?.cut) || 0;
  const seat = {};                      // 이름 → [{part, pos, tagged, working}]
  for (const p2 of Object.keys(parts || {})) {
    const pd = parts[p2] || {};
    const roster = pd.roster || [];
    const cut = cutOf(pd);
    const dup = new Map();
    roster.forEach((cell, i) => {
      const nm = _bare(cell); if (!nm) return;
      dup.set(nm, (dup.get(nm) || 0) + 1);
      (seat[nm] ||= []).push({ part: p2, pos: i + 1, tag: _tag(cell), working: cut > 0 && (i + 1) <= cut });
    });
    const twice = [...dup.entries()].filter(([, n]) => n > 1).map(([nm, n]) => `${nm}×${n}`);
    if (twice.length) out.push({ kind: 'dup_name', part: Number(p2), names: twice.slice(0, 10) });
    if (cut > roster.length) out.push({ kind: 'cut_overflow', part: Number(p2), cut, rosterLen: roster.length });
  }
  // 태그가 가리키는 부에 그 사람이 없다 — (1,3)이면 1부와 3부 명단에 둘 다 있어야 한다.
  const PARTS_OF = (tag) => {
    const t = String(tag || '').replace(/\s/g, '');
    if (t === '54') return ['1', '2', '3'];
    const m = t.match(/^([123])[,、]([123])$/);
    return m ? [m[1], m[2]] : [];
  };
  const missing = [], ghosts = [], forbidden = [], pulled = [];
  const who = resolveWorkParts(parts);   // ★근무 부 판정은 한 자리(resolveWorkParts)에서만 한다
  for (const [nm, rows] of Object.entries(seat)) {
    for (const r of rows) {
      const want = PARTS_OF(r.tag).filter((x) => x !== r.part && parts[x] && (parts[x].roster || []).length);
      for (const x of want) if (!rows.some((y) => y.part === x)) missing.push(`${nm}(${r.tag}) — ${x}부 명단에 없음`);
    }
    const work = rows.filter((r) => r.working);
    if (work.length < 2) continue;
    // ★리버힐 당겨오기 규칙(관리자 확인 2026-08-21)
    //  어느 부의 가용 캐디가 팀 수보다 모자라도 예약은 계속 받는다 — 옆 부에서 당겨오면 되기 때문이다.
    //  단 ①중복 근무자(54·1,3·2,3)는 이미 두 부에 묶여 있어 절대 못 당긴다.
    //     ②당길 수 있는 사람은 시간이 자유로운 '원번 근무자'(한 부만 뛰는 사람)다.
    //  실측 8/21: 1부는 13팀인데 가용 12명 → 2부만 뛰던 강경순을 1부로 당겨 13번에 붙였다.
    //  당겨온 사람은 '받는 부 명단의 맨 끝'에 붙는다 — 원래 순번이 없으니 뒤에 얹는 수밖에 없다.
    //  그래서 맨 끝이면 당겨오기로 읽고, 아니면 이름이 잘못 들어간 것으로 본다.
    const w = who[nm] || {};
    if (w.kind === 'multi') {
      if (w.problem) forbidden.push(`${nm}(${w.tag}) — ${work.map((r) => `${r.part}부 ${r.pos}번`).join(' · ')}`);
      continue;
    }
    if (w.kind === 'pulled') {
      pulled.push(`${nm} — ${w.from}부에서 ${w.parts[0]}부로 당겨옴(오늘 ${w.parts[0]}부 단일 근무)`);
      continue;
    }
    ghosts.push(`${nm} — ${work.map((r) => `${r.part}부 ${r.pos}번`).join(' · ')}`);
  }
  if (pulled.length) console.log(`[boardreader] 당겨오기: ${pulled.join(' / ')}`);
  if (missing.length) out.push({ kind: 'tag_no_counterpart', names: [...new Set(missing)].slice(0, 10) });
  if (ghosts.length) out.push({ kind: 'cross_untagged', names: [...new Set(ghosts)].slice(0, 10) });
  if (forbidden.length) out.push({ kind: 'pull_forbidden', names: [...new Set(forbidden)].slice(0, 10) });
  return out;
}

// 커트 안인데 티오프가 없는 순번 — '표가 잘렸다'의 유일하게 확실한 신호.
//  ★3부는 grid_short로 오래전부터 잡아왔는데 1·2부는 아무 검사도 없었다. 그래서 2부 IN 열이
//    통째로 빠진 날들이 기록 한 줄 없이 지나갔다(8/20 실측: 컷 16에 티오프 10칸 — 알림도 로그도 없음).
//  ★'칸이 있다'와 '시각을 읽었다'는 다른 말이다. 순번만 세면, 시각이 빈 채로 들어온 칸도
//    '있다'로 세어 구멍이 없는 것처럼 보인다. 정작 그 칸은 회원에게 티오프를 못 준다.
export function teeGaps(tee, cut) {
  const n = Number(cut) || 0;
  if (!(n > 0)) return [];
  const have = new Set((tee || [])
    .filter((t) => /^\d{1,2}:\d{2}$/.test(String(t && t.time || '')))
    .map((t) => Number(t.pos)).filter((x) => x > 0));
  const miss = [];
  for (let i = 1; i <= n; i++) if (!have.has(i)) miss.push(i);
  return miss;
}

// ── 채택 확정본의 손상만 관리자에게 알린다 ──
//  재시도 중간 판독이 아니라 '실제로 저장·표시될' 명단을 다시 세기 때문에, 재시도로 스스로 나은 손상은
//  알리지 않고(오경보 0) 끝까지 남은 손상만 사람에게 간다. 8/16 2부 21~25번은 여기서 잡힌다.
export function raiseAdoptedBoardIssues(parts, attemptIssues = []) {
  try {
    for (const p of Object.keys(parts || {})) {
      const pd = parts[p] || {};
      const holes = _rosterHoles(pd.roster || []);
      if (holes.length) raiseBoardIssue({ kind: 'roster_holes', part: Number(p), holes: holes.slice(0, 30), rosterLen: (pd.roster || []).length, cut: pd.cut || 0 });
      const tconf = _teeConflicts(pd.tee || []);
      if (tconf.length) raiseBoardIssue({ kind: 'tee_conflict', part: Number(p), times: tconf });
      const off = _offGridTees(pd.tee || [], p, pd.dateKey || '');
      if (off.length) raiseBoardIssue({ kind: 'offgrid_tee', part: Number(p), times: off });
      // ★티오프 짧음 — 구제(rescueTee)가 못 채운 것만 여기 남는다. 부를 가리지 않고 본다.
      const gaps = teeGaps(pd.tee || [], pd.cut || 0);
      if (gaps.length) raiseBoardIssue({ kind: 'grid_short', part: Number(p), teeMax: (pd.tee || []).length, cut: pd.cut || 0, miss: gaps.slice(0, 20) });
    }
    // ★명단 자체의 앞뒤 — 부를 가로질러 봐야 보이는 것들이라 부별 루프 밖에서 한 번에 본다.
    for (const it of rosterSanity(parts || {})) raiseBoardIssue(it);
    // 시도 단위로만 알 수 있는 손상(3부 홀리스틱 티오프 하단 누락) — 그 시도가 채택됐을 때만 전달됨.
    for (const it of attemptIssues) raiseBoardIssue(it);
  } catch (e) { console.error('[판독손상] 채택본 점검 오류:', e.message); }
}

// ── 증분 판독: 바뀐 구역만 다시 읽는다 ────────────────────────────────────────
//  배치표가 바뀔 땐 통째로 바뀌지 않는다 — 이름 하나, 티오프 하나다. 그런데 지금까지는 수정본이 올 때마다
//  1·2·3부와 조편성·당번을 처음부터 전부 다시 읽어 한 장에 ~30콜을 태웠다. 그 낭비가 일일 캡을 넘겨,
//  정작 저녁 정본 배치표가 '예산 부족 → 열경계 스킵'으로 반쪽 판독되게 만들었다(8/16 실측).
//
//  ★판정 규칙은 '단 한 픽셀도 안 바뀐 구역만 건너뛴다'. 임계값을 추측하지 않는다.
//   실측 근거(8/14 14:41→14:56 수정본): 좌 0 · 중 0 · 우 931픽셀 — 3분의 2가 비트까지 동일했다.
//   반대로 JPEG 사진(화면을 찍은 것)은 재압축 잡음으로 전 구역이 수십만 픽셀 달라진다 → 전부 다시 읽는다.
//   즉 애매하면 무조건 읽는 쪽으로 기운다. 건너뛴 구역은 '바뀌지 않았음이 증명된' 구역뿐이다.
//
//  롤백: BOARD_INCREMENTAL=0
const INCR_FILE = 'board-incremental.json';
const INCR_DIR = path.join(DATA_DIR, 'board-prev');
const INCR_KEEP = 3;                       // 캡처 파이프라인이 여러 개(카톡 자동캡처·업로드·카페) — 최근 3장을 후보로
const INCR_TTL = 30 * 3600 * 1000;
const incrOn = () => String(process.env.BOARD_INCREMENTAL || '1') !== '0';

function incrLoad() {
  const list = loadJSON(INCR_FILE, []) || [];
  const cut = Date.now() - INCR_TTL;
  const live = list.filter((e) => e && (e.at || 0) > cut && e.img && fs.existsSync(e.img));
  for (const e of list) if (!live.includes(e) && e && e.img) { try { fs.unlinkSync(e.img); } catch { /* noop */ } }
  if (live.length !== list.length) saveJSON(INCR_FILE, live);
  return live;
}

// 부 크롭과 '같은 기하'로 구역을 잡는다 — 크롭보다 좁으면 바뀐 걸 놓칠 수 있으니 절대 좁히지 않는다.
function incrBands(bounds) {
  const bands = [{ key: 'sum', x0: 0, x1: 1, y0: 0, y1: 0.07 },
    { key: 'crew', x0: 0.62, x1: 1, y0: 0, y1: 0.93 },
    { key: 'duty', x0: 0.26, x1: 0.76, y0: 0.75, y1: 1 },
    // ★인원 요약 상자 전용 띠 — duty는 x1=0.76에서 끊겨 '가용' 숫자를 못 본다.
    //  채점표를 묵은 띠로 재사용하면 가용이 바뀐 날 어제 점수를 그대로 물려받는다.
    //  ★x1=1까지 넓게: 여백 없는 캡처(1555폭)에선 상자가 오른쪽 끝(x 0.81~1.0)에 붙는다.
    { key: 'hc', x0: 0.60, x1: 1, y0: 0.80, y1: 1 }];
  const sorted = (bounds || []).slice().sort((a, b) => a.x0 - b.x0);
  sorted.forEach((b, i) => {
    const next = sorted[i + 1];
    bands.push({ key: `p${b.part}`, x0: Math.max(0, b.x0 - 0.03),
      x1: Math.min(1, (next ? next.x0 : b.x1) + (next ? 0.0 : 0.06)), y0: 0, y1: 0.99 });
  });
  return bands;
}

// 직전 배치표들과 견줘 '안 바뀐 구역'을 찾는다. Claude 호출 0회(파이썬 픽셀 비교, 실측 ~20ms).
//  export는 검증용 — 이 판단이 틀리면 멀쩡한 부를 안 읽고 넘어가므로 실이미지로 따로 돌려볼 수 있어야 한다.
export async function incrPlan(img) {
  for (const e of incrLoad()) {
    let d;
    try { d = await runPy({ image: img, diff_bands: e.img, bands: incrBands(e.bounds) }, 20000); }
    catch (err) { console.warn('[증분] 픽셀 비교 실패 → 전체 판독:', err.message); return null; }
    if (!d || !d.compatible) continue;                       // 크기가 다름 = 다른 캡처 파이프라인 → 다음 후보
    const unchanged = new Set((d.bands || []).filter((b) => b.changed === 0).map((b) => b.key));
    if (!unchanged.size) {                                   // 전부 바뀜(새 날짜 배치표·사진) → 전체 판독
      console.log(`[증분] 직전 배치표와 전 구역이 달라짐 → 전체 판독(${(d.bands || []).map((b) => `${b.key}:${b.changed}`).join(' ')})`);
      return null;
    }
    const changed = (d.bands || []).filter((b) => b.changed > 0);
    console.log(`[증분] 직전 판독(${Math.round((Date.now() - e.at) / 60000)}분 전)과 비교 — 그대로: ${[...unchanged].join(',')}`
      + (changed.length ? ` / 바뀜: ${changed.map((b) => `${b.key}(${b.changed}px)`).join(' ')}` : ' / 바뀐 곳 없음'));
    return { entry: e, unchanged, diff: d };
  }
  return null;
}

// 이번 판독 결과를 다음 비교의 기준으로 남긴다. ★결함 있는 판독(_fault)은 재사용 금지 — 오독을 대물림한다.
function incrRemember(img, { bounds, cuts, parts, offList, roleList, dutyList, headcount, dateLabel, clean }) {
  if (!incrOn() || !clean || !bounds || !bounds.length) return;
  try {
    fs.mkdirSync(INCR_DIR, { recursive: true });
    const dst = path.join(INCR_DIR, `prev_${Date.now()}${path.extname(img) || '.png'}`);
    fs.copyFileSync(img, dst);
    const prev = incrLoad();   // ★한 번만 읽는다 — 두 번 읽으면 객체가 달라져 '남길 것'까지 지운다
    const list = [{ img: dst, at: Date.now(), bounds, cuts: cuts || {}, parts: parts || {},
      offList: offList || null, roleList: roleList || [], dutyList: dutyList === undefined ? null : dutyList,
      headcount: headcount || null, dateLabel: dateLabel || '' }, ...prev].slice(0, INCR_KEEP);
    const keepImgs = new Set(list.map((e) => e.img));
    for (const e of prev) if (!keepImgs.has(e.img)) { try { fs.unlinkSync(e.img); } catch { /* noop */ } }
    saveJSON(INCR_FILE, list);
  } catch (e) { console.error('[증분] 기준 저장 실패:', e.message); }
}

// ── 합본 배치표: Claude 경계 → 부별 크롭 → Claude 부 판독. 경계 흔들림 대비 검증+재시도(최대 3회). ──
//  반환 { boundaries, parts: { '1': {roster,tee,cut}, ... }, _claudeCalls }
export async function readBoardByClaude(imageOrUrl, { known = confirmedCaddies(), summaryCuts = {}, maxTries = 3 } = {}) {
  const img = await ensureLocal(imageOrUrl);
  if (!img) return null;
  const startBudget = claudeBudgetLeft();
  let cuts = { ...summaryCuts };
  let best = null, bestBounds = null, bestScore = -1, lastFault = '';
  let bestIssues = [];   // ★채택된 시도의 손상만 관리자에게 알린다(버려진 시도의 손상은 오경보).
  // ★증분 판독 계획 — 직전 배치표와 픽셀로 견줘 '안 바뀐 구역'을 찾는다(Claude 호출 0회).
  const plan = incrOn() ? await incrPlan(img) : null;
  const keep = (k) => !!(plan && plan.unchanged.has(k));
  // 안 바뀐 부는 직전 판독 결과를 그대로 쓴다. 비트까지 같은 그림이라 다시 읽어도 같은 답이거나 새 오독이거나 둘 중 하나다.
  const reusableParts = {};
  if (plan) for (const [p, v] of Object.entries(plan.entry.parts || {})) if (keep(`p${p}`) && v) reusableParts[p] = v;
  if (keep('sum') && plan.entry.cuts && Object.keys(plan.entry.cuts).length && !Object.keys(cuts).length) {
    cuts = { ...plan.entry.cuts };
    console.log(`[증분] 상단 요약 그대로 → 커트 재사용: ${Object.entries(cuts).map(([p, n]) => `${p}부 ${n}`).join(', ')}`);
  }
  for (let attempt = 0; attempt < maxTries; attempt++) {
    if (claudeBudgetLeft() <= 0) break;
    const toBefore = claudeTimeouts();
    // 경계는 '레이아웃' 속성 — 안 바뀐 구역이 하나라도 있으면 그림이 직전과 정렬돼 있다는 뜻이라 그대로 쓴다.
    //  단 재시도(attempt>0)는 경계 흔들림을 의심해 다시 도는 것이므로, 그때는 반드시 새로 추정한다.
    const bounds = (attempt === 0 && plan) ? plan.entry.bounds : await getPartBoundaries(img);
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
    const issues = [];
    const parts = await readPartsOnce(img, sorted, cuts, issues, attempt, reusableParts);
    const fault = boardReadFault(parts, cuts);
    if (!fault) { best = parts; bestBounds = bounds; bestIssues = issues; lastFault = ''; break; }   // 깨끗 → 채택
    lastFault = fault;
    const score = Object.values(parts).reduce((s, p) => s + (p.roster || []).filter(Boolean).length, 0);
    if (score > bestScore) { best = parts; bestBounds = bounds; bestIssues = issues; bestScore = score; }   // 불량이어도 가장 완전한 판독 보관
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
  raiseAdoptedBoardIssues(best, bestIssues);   // ★채택 확정본 기준으로 손상 재확인 → 관리자 알림
  // ★근태(휴무/병가/휴가) 판독 — 근태는 배치표 오른쪽 '조편성표' 근무칸(색태그)에 있다. 부 크롭엔 없어 전용 판독.
  //  ★조 열분할 우선: 통짜 크루 크롭은 다열이 빽빽해 이름을 다른 유효이름으로 뭉갠다(박시윤→박신훈, 스냅으로도 못 잡음).
  //   조별 단일 크롭(8배)이면 이름·근태 안정(실측 박시윤·서동명 정확). 조 경계 실패 시 통짜 크루 크롭(6배)으로 폴백.
  //   ★로컬 VLM은 이 판독에 못 씀(qwen2.5vl 실측 2명만 뱉음) → Claude로만.
  let offList = [];
  // ★offOk — '근태를 실제로 읽었나'. 판독 실패·예산부족도 offList는 []라, 이 구분이 없으면 '아무도 근태 아님'을
  //  다음 배치표의 기준으로 물려주게 된다(빈 근태가 조용히 전파). []는 진짜 0명일 때만 기준이 될 수 있다.
  let offOk = false;
  // 그날의 역할(당번·벌당·배치·프리) — 같은 조편성표 판독에서 함께 건진다. 추가 호출 0.
  let roleList = [];
  // ★조편성표 구역이 직전과 픽셀까지 같으면 근태도 그대로다 — 이 판독만 조 열분할까지 ~6콜이라 절약이 크다.
  const crewCached = keep('crew') && Array.isArray(plan.entry.offList) ? plan.entry.offList : null;
  if (crewCached) {
    offList = crewCached; offOk = true;
    roleList = Array.isArray(plan.entry.roleList) ? plan.entry.roleList : [];
    console.log(`[증분] 조편성표 그대로 → 근태 판독 건너뜀(근태 ${offList.length}명 · 역할 ${roleList.length}명)`);
  } else if (claudeBudgetLeft() > 0) {
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
      offOk = true;
      // ★같은 판독에서 역할(당번·벌당·배치·프리)도 건진다 — 추가 호출 0.
      roleList = rolesFromCrew((raw && raw.crew) || []);
      if (roleList.length) console.log(`[boardreader] 역할 판독: ${roleList.map((r) => `${r.name}(${r.role})`).join(', ')}`);
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
  // ★근태 크롭이 없어도 돈다 — 재료가 명단 안에 있기 때문이다.
  try { disambiguateByCrossPart(best); } catch (e) { console.error('[boardreader] 부태그 티브레이크 실패:', e.message); }
  // ★당번·벌당 배정표(하단 주황 박스) — 순번 근무와 별개인 '그날의 역할'.
  //  조편성 근태칸에도 '당번' 태그는 찍히지만 거기엔 '몇 부'가 없어 시각을 못 정한다. 그래서 이 박스를 따로 읽는다.
  //  실패해도 판독 전체를 망치지 않게 완전 격리(당번만 비고 나머지는 정상).
  let dutyList = null;   // ★기본 null(반영 안 함) — 캡 초과로 판독을 아예 못 했을 때 '배정 0명'으로 오해하지 않게.
  if (keep('duty') && plan.entry.dutyList !== undefined && plan.entry.dutyList !== null) {
    dutyList = plan.entry.dutyList;
    console.log(`[증분] 당번·벌당 박스 그대로 → 판독 건너뜀(${dutyList.length}명)`);
  } else if (claudeBudgetLeft() > 0) {
    try {
      const dPath = path.join(TMP, `duty_${Date.now()}.png`);
      // 하단 좌~중앙 띠: 공지사항 오른쪽의 주황 박스가 여기 있다. 우측 요약표(x>0.72)는 제외.
      await runPy({ image: img, crop_only: dPath, slice: { x0: 0.28, x1: 0.74, y0: 0.76, y1: 1.0, lmargin: 0 }, scale: 5 }, 30000);
      const rows = await readDutyBox(dPath);
      try { fs.unlinkSync(dPath); } catch { /* noop */ }
      // ★null(표 없음 — 부분 크롭 등)과 []( 표는 있는데 배정 0명)는 의미가 다르다. null이면 반영을 건너뛴다.
      dutyList = rows ? rows.map((r) => ({ ...r, name: snapOfficial(r.name) || r.name })) : null;
      if (dutyList === null) console.log('[boardreader] 당번·벌당: 이 이미지엔 배정표 없음(부분 크롭) → 기존 유지');
      else if (dutyList.length) console.log(`[boardreader] 당번·벌당 판독: ${dutyList.map((d) => `${d.name}(${d.part}부 ${d.kind})`).join(', ')}`);
      else console.log('[boardreader] 당번·벌당 판독: 배정표 있음 · 오늘 배정 0명');
    } catch (e) { console.error('[boardreader] 당번·벌당 판독 실패:', e.message); }
  }
  // ★인원 요약 상자(오른쪽 아래) — 총원·가용·제외인원이 인쇄돼 있다. 그날의 정답지다.
  //  판독을 고치는 게 아니라 채점하려고 읽는다 — 명단은 손대지 않는다.
  //  작은 띠 하나라 1콜이면 충분하고, 부분 크롭이면 상자가 없어 null이 돌아온다(당번표와 같은 규칙).
  let headcount = null;
  if (keep('hc') && plan.entry.headcount) {
    headcount = plan.entry.headcount;
    console.log(`[증분] 인원 요약 그대로 → 판독 건너뜀(총원 ${headcount.total} · 가용 ${headcount.available})`);
  } else if (claudeBudgetLeft() > 0) {
    try {
      const hPath = path.join(TMP, `hc_${Date.now()}.png`);
      // ★trim — 검은 여백을 떼고 '내용' 기준으로 자른다. 같은 배치표가 2520x945(좌우 검은 띠)와
      //  1555x933(여백 없음) 두 가지로 들어오는데, 전체 폭 비율로 자르면 상자가 한쪽은 x 0.65, 다른 쪽은
      //  x 0.81에 있어 한 값으로 둘 다 못 맞춘다. 여백을 떼면 내용 폭이 같아져 하나의 비율로 수렴한다.
      await runPy({ image: img, crop_only: hPath, trim: true, slice: { x0: 0.68, x1: 1.0, y0: 0.85, y1: 1.0, lmargin: 0 }, scale: 5 }, 30000);
      headcount = await readHeadcountBox(hPath);
      try { fs.unlinkSync(hPath); } catch { /* noop */ }
      if (!headcount) console.log('[boardreader] 인원 요약: 이 이미지엔 상자 없음(부분 크롭) → 채점 생략');
      else console.log(`[boardreader] 인원 요약 판독: 총원 ${headcount.total} · 가용 ${headcount.available} · 제외 ${headcount.excluded}`
        + (Object.keys(headcount.breakdown).length ? ` (${Object.entries(headcount.breakdown).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ') || '상세 전부 0'})` : ''));
    } catch (e) { console.error('[boardreader] 인원 요약 판독 실패:', e.message); }
  }
  const used = startBudget - claudeBudgetLeft();
  // 다음 배치표가 왔을 때 견줄 기준으로 남긴다(결함 있는 판독은 안 남긴다 — 오독 대물림 방지).
  // ── 머리말 날짜 ── 그림이 스스로 적어둔 근무일. 글 제목보다 이걸 믿는다.
  //  ★제목은 사람이 손으로 적어 틀린다. 2026-08-25에 실제로 그랬다 — 26일 배치표 제목이 '8월25일'이라
  //   시스템이 어제 근무일로 알았고, "같은 근무일에 이미 판독본 있음 = 수정본"으로 접혀 1·2부를 통째로 건너뛰었다.
  //   날짜 하나가 틀리면 그 뒤의 모든 판단이 조용히 어긋난다.
  let dateLabel = '';
  if (keep('sum') && plan.entry.dateLabel) {
    dateLabel = plan.entry.dateLabel;
    console.log(`[증분] 머리말 그대로 → 날짜 판독 건너뜀(${dateLabel})`);
  } else if (claudeBudgetLeft() > 0) {
    try {
      const dPath = path.join(TMP, `hdr_${Date.now()}.png`);
      await runPy({ image: img, crop_only: dPath, trim: true, slice: { x0: 0, x1: 1, y0: 0, y1: 0.07 }, scale: 4 }, 30000);
      const hd = await readHeaderDate(dPath);
      try { fs.unlinkSync(dPath); } catch { /* noop */ }
      if (hd) { dateLabel = hd.label; console.log(`[boardreader] 머리말 날짜 판독: ${dateLabel}`); }
      else console.log('[boardreader] 머리말에서 날짜를 못 읽음 — 글 제목의 날짜를 씁니다');
    } catch (e) { console.error('[boardreader] 머리말 날짜 판독 실패:', e.message); }
  }

  incrRemember(img, { bounds: bestBounds, cuts, parts: best, offList: offOk ? offList : null, roleList, dutyList, headcount, dateLabel, clean: !lastFault });
  if (plan) {
    console.log(`[증분] 이번 판독 ${used}콜 — 그대로 쓴 구역: ${[...plan.unchanged].join(',') || '없음'}`);
    appendJSONL('board-incremental.jsonl', { at: Date.now(), calls: used, unchanged: [...plan.unchanged],
      bands: (plan.diff.bands || []).map((b) => ({ k: b.key, px: b.changed })), fault: lastFault || '' });
  } else {
    appendJSONL('board-incremental.jsonl', { at: Date.now(), calls: used, unchanged: [], full: true, fault: lastFault || '' });
  }
  return { boundaries: bestBounds, parts: best, offList, roleList, dutyList, headcount, dateLabel, _claudeCalls: used, _fault: lastFault };
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
  if (/^(찾근|조출|후출|정출|선발|당번|프리|벌당|배치|콜|정근|휴무|휴가|병가|연차|반차|월차|격리)$/.test(inner)) return { name: base, holder: base.replace(/\s/g, ''), duty: inner, cross: false };
  return { name: inner || base, holder: (inner || base).replace(/\s/g, ''), duty: '', cross: false };
}

// 부별 Claude 판독({roster,tee,cut}) → judge()가 쓰는 verdict 형식. localvlm.readBoardLocalVerdict와 동일 계약 +
//  괄호 태그에서 crewDuty·guaranteedWork(54/찾근)·crossPartNames를 파생(3부 54·1,3 근무판정 게이트 근거).
function verdictFromPart(article, member, pd, allParts, offList = [], roleList = [], boardDate = '') {
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
  // ★역할(당번·벌당·배치·프리) 주입 — 조편성표 근무칸에서 건진 그날의 보직.
  //  순번 셀 괄호 태그가 이미 있으면 그쪽이 이긴다(그 부에 대해 더 구체적이다). 없는 사람만 채운다.
  //  ★배치·당번은 순번표에 아예 안 올라가는 경우가 많아, 이 주입이 없으면 어디에도 안 잡힌다.
  for (const r of (roleList || [])) { if (r && r.name && !crewDuty[r.name]) crewDuty[r.name] = r.role; }
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
    // ★Claude 판독은 노란 칸(인턴)을 보지 않는다 — 여기는 언제나 0이다.
    //  인턴은 judge.mjs의 전용 판독(analyzeInterns)이 따로 채운다. 이 값을 '판독했는데 없더라'로
    //  읽으면 안 된다 — '아직 안 봤다'는 뜻이다.
    internCount: 0, internTees: [],
    // ★그림 머리말의 날짜가 이긴다. 글 제목은 사람이 적는 것이라 틀린다(2026-08-25 사고).
    dateLabel: boardDate || (dm ? dm[0].trim() : ''),
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

// ★판독 결과는 셋이다 — 성공 / 이 부 없음(정상) / 고장.
//  지금까지 셋 다 null 하나였다. 그 뭉뚱그림이 2026-08-16 하루를 통째로 날렸다:
//   캡이 막아 아무것도 못 읽은 상태가 "이 부 판독 없음 → 스킵(기존 유지)"으로 찍혔고,
//   로그는 정상처럼 보였고, 옆에 켜져 있던 공짜 로컬 VLM으로 내려가지도 않았다.
//   '이 크롭에 3부 표가 없다'와 '판독기가 죽었다'는 대응이 정반대인데 같은 값이었다.
//  그래서 고장은 이미지별로 따로 기록해 호출부가 물어볼 수 있게 한다(반환형은 그대로 — 회귀 0).
const _readFaults = new Map();      // img → { reason, at }
function _noteReadFault(img, reason) {
  if (!img) return;
  _readFaults.set(img, { reason, at: Date.now() });
  if (_readFaults.size > 8) { const k = _readFaults.keys().next().value; _readFaults.delete(k); }
}
function _clearReadFault(img) { if (img) _readFaults.delete(img); }
// '' 이면 고장이 아니다(성공했거나, 이 배치표에 그 부가 없는 정상 상황).
export function claudeReadFault(article) {
  const img = article?.images?.[0] || article?.image || '';
  return (img && _readFaults.get(img)?.reason) || '';
}

// judge() 진입점 — article(회원 기준) → 그 회원 부(部) verdict. 합본은 캐시로 1회 판독 후 해당 부만 변환.
//  해당 부가 판독에 없으면(예: 다른 부만 잘라 올린 변동) null → judge가 로컬/Gemini 폴백.
export async function readBoardClaudeVerdict(article, member) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img) return null;                                   // 읽을 그림이 없다 — 고장이 아니다
  const budgetBefore = claudeBudgetLeft();
  const toBefore = claudeTimeouts();
  let board;
  try { board = await readBoardByClaudeCached(img); }
  catch (e) {
    console.error('[claude] board 판독 오류:', e.message);
    _noteReadFault(img, `판독 오류(${String(e.message || '').slice(0, 60)})`);
    return null;
  }
  if (!board || !board.parts) {
    // 왜 못 읽었는지까지 남긴다 — 사람이 로그만 보고 '캡을 풀까/기다릴까'를 정할 수 있어야 한다.
    const why = budgetBefore <= 0 ? '일일 캡 소진'
      : claudeTimeouts() > toBefore ? '판독 타임아웃'
        : claudeBudgetLeft() <= 0 ? '판독 중 캡 소진' : '판독 실패';
    console.error(`[claude] 배치표를 못 읽었습니다 — ${why}`);
    _noteReadFault(img, why);
    return null;
  }
  const part = String(member?.part || '3').replace(/\D/g, '') || '3';
  const pd = board.parts[part];
  // ★여기부터가 '정상'이다 — 판독은 됐고 이 배치표에 그 부가 없을 뿐. 고장 기록을 지운다.
  if (!pd || !Array.isArray(pd.roster) || !pd.roster.length) { _clearReadFault(img); return null; }
  // ★안전 게이트: 이 부 명단이 커트를 '심각' 미달(순번열 누락)이면 회원 발송에 쓰지 않는다 → null로 폴백.
  //  경계 흔들림 잔여가 회원에게 잘못된 '근무 없음' 알림을 내는 것을 차단. (인턴발 1~3 부족은 정상 허용.)
  const cut = Number(pd.cut) || 0;
  const rl = pd.roster.filter(Boolean).length;
  if (cut > 0 && rl < _rosterFloor(cut)) {
    console.warn(`[claude] ${part}부 명단 심각부족(${rl}<${_rosterFloor(cut)}, 커트 ${cut}) — 발송용 판독 보류(폴백)`);
    _noteReadFault(img, `${part}부 명단 심각부족(${rl}/${cut})`);   // 이건 고장이다 — 폴백이 반드시 붙어야 한다
    return null;
  }
  _clearReadFault(img);
  return verdictFromPart(article, member, pd, Object.keys(board.parts), board.offList, board.roleList, board.dateLabel || '');
}

// ★이 배치표에 실제로 실린 부(部) 목록 — 이미 캐시된 whole-board 판독에서 꺼낸다(추가 Claude 호출 0).
//  왜 필요한가: 그동안 '어떤 부가 있나'를 주회원(3부) verdict의 boardTables로만 알았다.
//  그래서 3부가 없는 날엔 그 verdict가 null이 되고, 배치표에 멀쩡히 있는 1·2부까지
//  "이 배치표엔 N부 표 없음"으로 건너뛰었다(2026-08-25 청송 군수배 샷건날 — 3부 없이 1부 13팀·2부 44팀).
//  판독기는 이미 부별로 다 읽어 놓았다. 물어보기만 하면 된다.
export async function claudeBoardParts(article) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img || !_boardCache.has(img)) return null;          // 아직 안 읽음 — 모른다(빈 배열과 구분)
  try {
    const b = await _boardCache.get(img);
    if (!b || !b.parts) return null;
    return Object.keys(b.parts)
      .filter((p) => Array.isArray(b.parts[p]?.roster) && b.parts[p].roster.filter(Boolean).length)
      .sort();
  } catch { return null; }
}

// ★당번·벌당 배정 — 이미 캐시된 whole-board 판독에서 꺼낸다(추가 Claude 호출 0).
//  캐시에 없으면 null(판독 안 켜졌거나 아직 안 읽음) → 호출부는 아무것도 하지 않는다.
export async function claudeDutyList(article) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img || !_boardCache.has(img)) return null;
  try { const b = await _boardCache.get(img); return Array.isArray(b?.dutyList) ? b.dutyList : null; }
  catch { return null; }
}

// ★인원 요약(총원·가용·제외인원) — 이미 캐시된 whole-board 판독에서 꺼낸다(추가 Claude 호출 0).
//  캐시에 없거나 상자가 없는 그림이면 null → 호출부는 채점을 건너뛴다(틀린 점수를 남기느니 안 남긴다).
export async function claudeHeadcount(article) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img || !_boardCache.has(img)) return null;
  try { const b = await _boardCache.get(img); return b?.headcount || null; }
  catch { return null; }
}

// 모니터(board-parts-store) 채움용 — 이미 캐시된 whole-board 판독에서 지정 부들을 뽑아 setBoardPart payload로.
//  ★추가 Claude 호출 0(캐시 히트만). 캐시에 없으면 null(판독 안 켜졌거나 아직 안 읽음).
// 판독된 '그림 머리말의 날짜'. 캐시만 본다(추가 호출 0). 아직 안 읽었거나 못 읽었으면 ''.
export async function claudeBoardDate(article) {
  const img = article?.images?.[0] || article?.image || '';
  if (!img || !_boardCache.has(img)) return '';
  try { const b = await _boardCache.get(img); return String(b?.dateLabel || ''); }
  catch { return ''; }
}

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
    const v = verdictFromPart(article, { name: '', part: p }, pd, Object.keys(board.parts), board.offList, board.roleList, board.dateLabel || '');
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
