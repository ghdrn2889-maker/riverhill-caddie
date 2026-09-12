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
  // ★말하지 않는 것과 '풀어라'는 다르다. 그래서 경기과 명부에 있는 사람은 모두 싣는다 —
  //   근태가 붙은 사람은 그 근태를, 나머지는 빈 값(=풀어라)을.
  //   말 안 하고 두면 붙일 때만 닿고 뗄 때는 안 닿는다. 실측: 병가를 찍었다 풀었는데
  //   앱에 병가가 그대로 남은 사람이 열둘 중 일곱이었다 — 명단에도 안 서 있어 아무도 말해 주지 않았다.
  //   경기과 명부 밖 사람은 여전히 안 싣는다(경기과가 모르는 사람의 근태를 지우면 안 된다).
  //
  // ★자리가 근태를 이긴다. 배지는 남아 있는데 자리에 서 있는 사람이 실제로 나온다 —
  //  경기과 프로그램의 근무표도 그렇게 읽는다(자리가 있으면 '근무'). 배지만 보고 휴무로 보내면
  //  티오프를 받아 든 사람이 앱에서 '오늘 쉽니다'가 된다. 정확히 반대의 사실이다.
  // ★그리고 근태는 하루 단위지 부 단위가 아니다 — 1부에 선 사람을 3부에서 휴무라 할 수 없다.
  //  그래서 한 장을 만들어 세 부에 똑같이 보낸다.
  const onBoard = new Set();
  for (const pd of Object.values(out.parts)) for (const n of pd.seated) onBoard.add(n);
  const tagOf = {};
  for (const [n, t] of Object.entries(TAG)) { const b = bare(n); if (b) tagOf[b] = t; }
  const known = new Set([...(o.jonames || []).map(bare), ...Object.keys(tagOf), ...onBoard].filter(Boolean));
  const dutySet = {};
  for (const n of known) {
    const t = tagOf[n] || '';
    dutySet[n] = (!onBoard.has(n) && ABSTYPES.includes(t)) ? t : '';
  }
  for (const pd of Object.values(out.parts)) { pd.dutySet = dutySet; delete pd.seated; }
  out.duties = readDuties(o);
  return out;
}

// ── 당번 ───────────────────────────────────────────────────
// ★당번은 순번 근무와 별개 축이다. 경기과는 두 자리에서 정한다:
//   ① 당번 상자(duty) — '당번'·'벌당'·'흡연실 당번'… 칸마다 이름과 시각을 적는다.
//      경기과가 칸 자체를 새로 만들 수도 있다(골프장마다 다르다). 부는 안 적는다.
//   ② 배치표 칸의 역할(role) — 그 사람 자리에서 바로 지정한다. 이쪽은 어느 부인지가 분명하다.
//  ★시각은 경기과가 정한 것을 그대로 들고 간다.
//   앱에는 '3부 당번은 15시' 같은 고정 시간표가 있는데, 그건 아무도 안 알려 줄 때 쓰는 값이다.
//   경기과가 7시라고 적어 놓았는데 표가 15시라고 우기면 그 사람은 여덟 시간 늦는다.
function readDuties(o) {
  const box = o.duty || {};
  const def = o.ddef || {};
  const keys = (o.dkeys && o.dkeys.length) ? o.dkeys : Object.keys(box);
  const defOf = (k) => { const d = def[k]; return (d && typeof d === 'object') ? d : { t: (typeof d === 'string' ? d : ''), h: 0 }; };
  const out = [];
  const put = (name, kind, part, start, hours) => {
    const nm = bare(name), kd = String(kind || '').trim();
    if (!nm || !kd) return;
    const at = out.findIndex((x) => x.name === nm && x.kind === kd);
    const rec = { name: nm, kind: kd, part: String(part || ''), start: String(start || ''), hours: Number(hours) || 0 };
    // 같은 사람 같은 당번이 두 자리에서 나오면 부를 아는 쪽을 남긴다 — 그쪽이 더 많이 말한다
    if (at < 0) out.push(rec); else if (!out[at].part && rec.part) out[at] = rec;
  };
  for (const k of keys) {
    const d0 = defOf(k);
    for (const x of (box[k] || [])) put(x && x.n, k, '', (x && x.t) || d0.t, (x && x.h) || d0.h);
  }
  for (const p of (o.day || [])) {
    for (const r of (p.roster || [])) {
      if (!r || !r.role || r.off) continue;
      const d0 = defOf(r.role);
      put(r.n, r.role, p.key, d0.t, d0.h);
    }
  }
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

// ── 지금 앱이 그 날 그 부에 대해 들고 있는 명단(없거나 딴 날 것이면 빈 것) ──
export function currentRoster(part, dateISO) {
  try {
    if (String(part) === '3') {
      const lb = loadJSON('lastboard.json', null);
      if (!lb || !lb.rawVerdict) return [];
      if (labelToISO(lb.rawVerdict.dateLabel || lb.dateLabel || '') !== dateISO) return [];
      return (lb.rawVerdict.part3Roster || []).filter(Boolean);
    }
    const pd = getBoardPart(part);
    if (!pd || String(pd._targetISO || '') !== dateISO) return [];
    return (pd.roster || []).filter(Boolean);
  } catch (e) { return []; }
}

// ★쪼그라들면 받지 않는다.
//  실제로 있었던 일: 경기과가 프로그램을 연습하느라 1부에 한 사람만 세워 두었다.
//  그 날 앱에는 사진으로 읽은 진짜 1부 43명이 서 있었다. 그대로 받았으면 마흔셋이 하나가 됐다.
//  팀이 취소돼 사람이 빠지는 일은 있어도, 절반 밑으로 꺼지는 배치표는 없다 —
//  그건 '줄었다'가 아니라 '아직 안 짰다'는 뜻이다. 그런 것은 정본을 못 덮는다.
export function tooSmall(part, dateISO, rows) {
  const now = currentRoster(part, dateISO).length;
  const next = rows.filter((r) => r.name).length;
  if (!now || next * 2 >= now) return null;
  return `지금 앱에 선 ${now}명의 절반도 안 되는 ${next}명이라 받지 않았습니다`
    + ` — 아직 다 안 짠 배치표로 보입니다(경기과 프로그램에는 그대로 저장돼 있습니다).`;
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
