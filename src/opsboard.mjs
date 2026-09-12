// ══════════════════════════════════════════════════════════════
//  경기과 배치표 프로그램 → 앱  옮기개
//
//  ★왜 옮기개가 따로 있나.
//   앱은 여태 '사진을 읽어서 세운 배치표'만 알았다. 경기과 프로그램은 사진이 없다 —
//   경기과가 손으로 만드는 곳이고, 그게 곧 본배치표다. 그래서 앱의 배치표 문
//   (monitor /api/board-correct)은 "읽어 둔 배치표가 없다"며 되돌려보냈다.
//   그 문을 고치는 대신, 문 앞에 이 옮기개를 세운다 —
//   ① 경기과 말을 앱 말로 바꾸고 ② 받을 자리가 없으면 빈 자리를 세운다.
//   회원별 다시 계산은 여태 쓰던 그 길을 그대로 탄다. 사본을 만들지 않는다 —
//   사본이 생기면 둘이 조용히 갈라진다(이 저장소가 여러 번 겪은 일이다).
//
//  ★두 프로그램이 사람 세는 방식은 이미 같다.
//   경기과: 명단 i번째 사람이 티오프표 i번째 칸에 앉는다. 인턴은 번호를 안 쓴다.
//   앱:     순번 i번 = teeGrid의 pos i. 인턴은 internTees로 따로 센다.
//   그래서 줄이 밀릴 일이 없다 — 이게 이 연결이 성립하는 까닭이다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadJSON, saveJSON } from './store.mjs';
import { labelToISO } from './worklog.mjs';
import { loadBoardPartsStore, saveBoardPartsStore, getBoardPart } from './boardparts.mjs';

export const ABSTYPES = ['휴무', '휴가', '병가'];          // 경기과 프로그램과 같은 말을 쓴다
const PARTS = ['1', '2', '3'];                             // 앱이 아는 부. 4부는 아직 받을 자리가 없다
const bare = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim();   // '김동우(54)' → '김동우'

// ── 경기과 프로그램이 저장한 하루치(state) → 앱이 아는 모양 ──────────────
// 들어오는 것: 배치표 프로그램의 저장 글 한 장(글자열 또는 이미 푼 것)
// 나가는 것: { dateLabel, parts: { '3': { rows, interns, allInterns, cutLine, dutySet } } }
export function translateOps(state) {
  const o = (typeof state === 'string') ? JSON.parse(state) : state;
  if (!o || !Array.isArray(o.day)) throw new Error('경기과 배치표를 읽을 수 없습니다');
  const dateLabel = String(o.date || '').trim();
  if (!labelToISO(dateLabel)) throw new Error(`날짜를 읽을 수 없습니다 — '${dateLabel}'`);
  const TAG = o.tag || {};
  const out = { dateLabel, dateISO: labelToISO(dateLabel), parts: {}, skipped: [] };

  for (const p of o.day) {
    const key = String(p && p.key || '');
    if (!PARTS.includes(key)) { if (key) out.skipped.push(key); continue; }
    const seats = (p.roster || []).filter((r) => r && !r.off);   // 자리를 비운 사람은 줄에서 빠진다
    const tees = p.tees || [];
    const rows = [], interns = [], allInterns = [], seated = [];
    let pos = 0, cutLine = 0;
    seats.forEach((r, i) => {
      const t = tees[i] || null;
      // ★취소된 칸(cx)은 티오프가 없는 것과 같다 — 그 사람은 오늘 안 나간다.
      const live = t && !t.cx;
      const time = live ? (String(t.time || '').match(/\d{1,2}:\d{2}/) || [''])[0] : '';
      const course = /IN/i.test(String(t && t.course || '')) ? 'IN' : 'OUT';
      if (r.itn) {
        // 인턴은 칸은 차지하되 순번을 안 쓴다 — 앱도 똑같이 따로 센다
        allInterns.push({ time: time || '', course });
        if (time) interns.push({ time, course });
        return;
      }
      pos += 1;
      const name = bare(r.n);            // 빈 칸이면 ''. 칸 자체는 남긴다 — 번호에 구멍을 내면 문이 되돌려보낸다
      rows.push({ pos, name, tee: time, course: time ? course : '' });
      if (time) cutLine = pos;           // 티오프가 붙은 마지막 순번 = 근무선
      if (name) seated.push(name);
    });

    out.parts[key] = { rows, interns, allInterns, cutLine, seated,
      teamCount: interns.length + rows.filter((r) => r.tee).length };
  }

  // ── 근태 한 장 ── (세 부를 다 보고 나서 만든다)
  // ★말하지 않는 것과 '풀어라'는 다르다. 그래서 두 가지만 싣는다:
  //   ① 경기과가 근태를 붙였고 오늘 어느 부에도 안 선 사람 → 그 근태
  //   ② 오늘 어느 부든 자리에 선 사람 → 빈 값(=풀어라)
  //   그 밖의 사람은 아예 안 싣는다 — 경기과 프로그램이 모르는 사람의 근태를 지우면 안 된다.
  //
  // ★자리가 근태를 이긴다. 배지는 남아 있는데 자리에 서 있는 사람이 실제로 나온다 —
  //  경기과 프로그램의 근무표도 그렇게 읽는다(자리가 있으면 '근무'). 배지만 보고 휴무로 보내면
  //  티오프를 받아 든 사람이 앱에서 '오늘 쉽니다'가 된다. 정확히 반대의 사실이다.
  // ★그리고 근태는 하루 단위지 부 단위가 아니다 — 1부에 선 사람을 3부에서 휴무라 할 수 없다.
  //  그래서 한 장을 만들어 세 부에 똑같이 보낸다.
  const onBoard = new Set();
  for (const pd of Object.values(out.parts)) for (const n of pd.seated) onBoard.add(n);
  const dutySet = {};
  for (const [n, t] of Object.entries(TAG)) { const b = bare(n); if (ABSTYPES.includes(t) && !onBoard.has(b)) dutySet[b] = t; }
  for (const n of onBoard) dutySet[n] = '';
  for (const pd of Object.values(out.parts)) { pd.dutySet = dutySet; delete pd.seated; }
  return out;
}

// ══ 받을 자리 세우기 ═══════════════════════════════════════════
// ★앱의 배치표 문은 '고치는 문'이다 — 고칠 것이 있어야 연다.
//  경기과가 짠 날에 아직 아무것도 읽어 둔 게 없으면 빈 자리를 하나 세워 준다.
//  이미 그날 것이 서 있으면 손대지 않는다 — 사진으로 읽어 둔 근태 같은 것을 지우지 않기 위해서다.
export const opsArticleId = (dateISO) => `ops-${String(dateISO).replace(/-/g, '')}`;
const opsArticle = (dateLabel, dateISO) => ({
  id: opsArticleId(dateISO), subject: `${dateLabel} 배치표 (경기과)`,
  writer: '경기과', url: '', images: [], comments: [], writeDate: new Date().toISOString(),
});

function emptyVerdict(dateLabel, part) {
  return { part: String(part), category: '배치표', relevant: true, rosterReliable: true,
    part3Roster: [], teeGrid: [], teeTimes: [], teamCount: 0,
    cutoffPosition: null, cutoffName: '', cutoffAnnounced: false,
    internCount: 0, internTees: [], dateLabel, crewDuty: {},
    boardTables: [{ part: String(part) }], guaranteedWork: [], crossPartNames: [],
    _ops: true };
}

// 3부 자리 — lastboard.json
function seedPart3(dateLabel, dateISO) {
  const lb = loadJSON('lastboard.json', null);
  const same = lb && lb.rawVerdict && labelToISO(lb.rawVerdict.dateLabel || lb.dateLabel || '') === dateISO;
  if (same) return 'kept';
  saveJSON('lastboard.json', {
    id: opsArticleId(dateISO), dateLabel, article: opsArticle(dateLabel, dateISO),
    rawVerdict: emptyVerdict(dateLabel, 3), at: Date.now(),
    latestImage: '', latestImageId: '', latestImageAt: 0,
  });
  return 'seeded';
}

// 1·2부 자리 — board-parts-store.json
function seedPart12(part, dateLabel, dateISO) {
  const p = String(part);
  const cur = getBoardPart(p);
  if (cur && String(cur._targetISO || '') === dateISO) return 'kept';
  let s = loadBoardPartsStore();
  const fresh = !s || !s.parts || labelToISO(s.dateLabel || '') !== dateISO;
  if (fresh) {
    s = { articleId: opsArticleId(dateISO), at: Date.now(), targetISO: dateISO, dateLabel,
      subject: `${dateLabel} 배치표 (경기과)`, image: '', url: '',
      article: opsArticle(dateLabel, dateISO), parts: {} };
  }
  s.parts[p] = { roster: [], teeGrid: [], crewDuty: {}, teamCount: 0,
    internTees: [], internCount: 0, cutoffPosition: null, cutoffName: '',
    rosterReliable: true, dateLabel, _at: Date.now(), _targetISO: dateISO, _ops: true };
  saveBoardPartsStore(s);
  return 'seeded';
}

export function seedPart(part, dateLabel, dateISO) {
  return String(part) === '3' ? seedPart3(dateLabel, dateISO) : seedPart12(part, dateLabel, dateISO);
}

// ── 자국 — 경기과가 마지막으로 보낸 것이 무엇이고 언제였나(화면·점검용) ──
const MARKF = 'ops-board-last.json';
export function markOps(rec) { try { saveJSON(MARKF, rec); } catch (e) { /* 자국은 없어도 된다 */ } }
export function lastOps() { return loadJSON(MARKF, null); }

// ── 온 것을 그대로 한 줄 남긴다. 뭔가 어긋났을 때 되짚을 근거가 된다 ──
export function logOps(line) {
  try { fs.appendFileSync(path.join(DATA_DIR, 'ops-board.jsonl'), JSON.stringify(line) + '\n'); }
  catch (e) { console.error('[경기과] 기록 실패:', e.message); }
}
