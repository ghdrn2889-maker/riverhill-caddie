// 대조판 데이터 — 사진 판독(배치표) + 카카오 예약 스냅 + 고정 시간표를 한 덩어리로 모은다.
//
//  왜 따로 두나: 이걸 손으로 뽑은 JSON에 의존하게 두면 대조판은 영원히 '샘플'로 남는다.
//   실제로 그랬다 — 화면은 다 만들어졌는데 file://로 열려 있어서 저장 버튼이 아무 일도 안 했다.
//   모니터가 이 함수를 불러 그 자리에서 그리면, 보는 화면과 저장하는 화면이 같아진다.
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, DATA_DIR } from './store.mjs';
import { loadBoardPartsStore } from './boardparts.mjs';
import { effectivePart3Verdict } from './analytics.mjs';
import { loadSnapshot, kakaoHealth, fixedSlots } from './kakaogolf.mjs';
import { keyFromLabel } from './boardpending.mjs';
import { internTeesFor } from './interns.mjs';
import { applySandbox } from './daejosandbox.mjs';
import { dayFrameParts } from './dayframe.mjs';
import { OFFICIAL_ROSTER } from './roster-official.mjs';

const norm = (t) => (String(t || '').match(/\d{1,2}:\d{2}/) || [''])[0];

// 고정 시간표 원본 — 대조판은 cadence·parts.first/last로 격자를 다시 그린다.
//  fixedSlots()는 이미 펼쳐진 칸 목록이라, 여기서 부별 첫·끝을 되짚어 격자 정의를 복원한다.
//  ★날짜를 받는다 — 그날의 운영 선언(원웨이·앞뒤 늘리기)이 격자에 그대로 보여야 한다.
//   엔진이 판정하는 틀과 화면이 그리는 격자가 갈라지면, 관리자는 자기가 무엇을 고쳤는지 알 수 없다.
function schedShape(dateKey = '') {
  const slots = fixedSlots();
  if (!slots.length) return {};
  const parts = {};
  const mins = new Set();
  for (const s of slots) {
    mins.add(s.mins);
    const p = (parts[s.part] ||= { first: s.time, last: s.time, _a: s.mins, _b: s.mins });
    if (s.mins < p._a) { p._a = s.mins; p.first = s.time; }
    if (s.mins > p._b) { p._b = s.mins; p.last = s.time; }
  }
  for (const p of Object.values(parts)) { delete p._a; delete p._b; }
  // 간격 = 서로 다른 시각들의 최소 차이(예외 칸이 있어도 격자 간격 자체는 안 변한다).
  const sorted = [...mins].sort((a, b) => a - b);
  let cad = 7;
  for (let i = 1; i < sorted.length; i++) cad = Math.min(cad, sorted[i] - sorted[i - 1]);
  // 기본틀을 그대로 남겨둔다 — 버튼이 '기본으로 되돌리기'를 하려면 기준이 무엇이었는지 알아야 한다.
  const base = Object.fromEntries(Object.entries(parts).map(([p, v]) => [p, { first: v.first, last: v.last }]));
  const declared = dayFrameParts(dateKey);
  for (const [p, d] of Object.entries(declared)) {
    if (!parts[p]) continue;
    if (d.first) parts[p].first = d.first;
    if (d.last) parts[p].last = d.last;
  }
  return { cadence: cad || 7, parts, base, declared };
}

// 부별 배치표 — 3부는 lastboard, 1·2부는 board-parts-store.
//  freshAt: 그 부의 실제 배치표가 마지막으로 갱신된 시각(판독 또는 검수 교정) — 테스트판 신선도 판정용.
function partsOf() {
  const out = {};
  const freshAt = {};
  let dateLabel = '';
  try {
    const bp = loadBoardPartsStore();
    for (const p of ['1', '2']) {
      const d = bp?.parts?.[p];
      if (!d || !Array.isArray(d.roster)) continue;
      out[p] = {
        roster: d.roster.slice(),
        cut: Number(d.cutLine || d.cutoffPosition) || 0,
        teeGrid: (d.teeGrid || []).map((g) => ({ pos: Number(g.pos), time: norm(g.time), course: /IN/i.test(g.course) ? 'IN' : 'OUT' })).filter((g) => g.pos && g.time),
        internTees: (d.internTees || []).map((t) => ({ time: norm(t.time), course: /IN/i.test(t.course) ? 'IN' : 'OUT' })).filter((t) => t.time),
        // ★근태(휴무·휴가·병가) — 배치표의 별개 축이다. 이름은 명단에 있는데 그날 안 나오는 사람이 있다.
        //  이걸 안 실으면 대조판은 그 사람을 스페어로 보여주고, 반영하면 근태가 통째로 지워진다.
        crewDuty: { ...(d.crewDuty || {}) },
      };
      // ★판본 서명 — board-review가 검수 탭에 주는 것과 같은 식이라야 한다.
      //  이걸 반영 요청에 실어 보내면 서버가 '그 사이 바뀌었는지'를 대신 세어준다.
      out[p].syncSig = `${bp.at || ''}|${(d._adminCorrected && d._adminCorrected.at) || ''}`;
      freshAt[p] = Math.max(Number(d._adminCorrected?.at) || 0, Number(d._at) || 0, Number(bp.at) || 0);
      dateLabel = dateLabel || d.dateLabel || bp.dateLabel || '';
    }
  } catch { /* 1·2부가 아직 없을 수 있다 — 3부만으로도 대조는 성립한다 */ }
  try {
    const lb = loadJSON('lastboard.json', null);
    const v = lb && lb.rawVerdict ? effectivePart3Verdict(lb) : null;
    if (v && Array.isArray(v.part3Roster)) {
      out['3'] = {
        roster: v.part3Roster.slice(),
        cut: Number(v.cutoffPosition) || 0,
        teeGrid: (v.teeGrid || []).map((g) => ({ pos: Number(g.pos), time: norm(g.time), course: /IN/i.test(g.course) ? 'IN' : 'OUT' })).filter((g) => g.pos && g.time),
        internTees: [],   // 아래에서 수동 지정을 얹는다
        crewDuty: { ...(v.crewDuty || {}) },
        _autoInterns: (v.internTees || []).map((t) => ({ time: norm(t.time), course: /IN/i.test(t.course) ? 'IN' : 'OUT' })).filter((t) => t.time),
      };
      out['3'].syncSig = `${v._t1Sig || ''}|${(v._adminCorrected && v._adminCorrected.at) || ''}`;
      freshAt['3'] = Math.max(Number(v._adminCorrected?.at) || 0, Number(lb.at) || 0);
      dateLabel = v.dateLabel || lb.dateLabel || dateLabel;
    }
  } catch { /* noop */ }
  return { parts: out, dateLabel, freshAt };
}

// 스냅샷이 있는 날짜들 — 대조판 날짜 이동에 쓴다.
export function snapshotDates() {
  try {
    return fs.readdirSync(path.join(DATA_DIR, 'kakao-board'))
      .map((f) => f.replace(/\.json$/, '')).filter((d) => /^\d{8}$/.test(d)).sort();
  } catch { return []; }
}

// 대조판 한 장에 필요한 전부. date를 주면 그 날짜, 안 주면 배치표가 말하는 날짜.
export function buildDaejoData(date = '') {
  const { parts, dateLabel, freshAt } = partsOf();
  const boardKey = keyFromLabel(dateLabel) || '';
  const dateKey = String(date || '').replace(/\D/g, '').slice(0, 8) || boardKey || '';
  // ★다른 날짜를 볼 때는 배치표를 붙이지 않는다. 8/17 배치표 위에 8/18 예약을 겹치면
  //  둘 다 그럴듯한데 통째로 거짓이 된다 — 없는 건 없다고 말하는 게 낫다.
  const boardMissing = !!boardKey && dateKey !== boardKey;
  if (boardMissing) for (const p of Object.keys(parts)) delete parts[p];
  // ★인턴은 수동이 자동을 이긴다(interns.mjs) — 화면에도 실제로 쓰는 값이 그려져야 한다.
  //  ★단, 사진이 읽은 인턴 칸(boardInternTees)은 따로 남긴다 — 그게 '실제 배치표의 팀'이다.
  //   수동 인턴은 카카오 예상 칸에 찍힐 수도 있는데(17:07처럼 본배치표엔 팀이 없는 시각),
  //   그걸 실제 팀 목록에 더하면 없는 팀이 유령으로 생겨 밀림이 통째로 어긋난다.
  if (parts['3']) {
    parts['3'].boardInternTees = (parts['3']._autoInterns || []).map((t) => ({ time: t.time, course: t.course }));
    parts['3'].internTees = internTeesFor(dateKey, parts['3']._autoInterns || []).map((t) => ({ time: t.time, course: t.course }));
    delete parts['3']._autoInterns;
  }
  for (const p of ['1', '2']) if (parts[p]) parts[p].boardInternTees = parts[p].internTees.slice();
  // ★관리자 테스트판을 마지막에 덮는다 — 이 값은 대조판 밖으로 나가지 않는다(회원 앱·알림·엔진 무관).
  const sb = applySandbox(parts, dateKey, freshAt);
  const sched = schedShape(dateKey);
  // ★원웨이 선언은 즉시 화면에 보여야 한다 — 엔진은 5분마다 돌지만 관리자는 지금 눌렀다.
  //  (판정 자체는 엔진이 같은 선언을 읽어서 한다. 여긴 그 결과를 기다리지 않고 그릴 뿐이다.)
  const rawSnap = (dateKey && loadSnapshot(dateKey)) || {};
  const idle = new Set(rawSnap.idle || []);
  for (const [p, d] of Object.entries(sched.declared || {})) {
    if (!d.oneway) continue;
    for (const c of ['OUT', 'IN']) if (c !== d.oneway) idle.add(`${p}|${c}`);
  }
  // ★선언한 코스의 '찬 칸'은 그 자리에서 걷어낸다. 안 걷어내면 다음 엔진 틱까지(최대 5분)
  //  화면은 여전히 허위 팀을 순번으로 매겨 그린다 — 관리자는 버튼이 안 먹었다고 본다.
  const mn = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; };
  const inDeclared = (p, x) => {
    const d = (sched.declared || {})[p]; if (!d) return true;
    if (d.oneway && x.course !== d.oneway) return false;
    const t = mn(x.time), a = mn(d.first), b = mn(d.last);
    if (t == null) return true;
    return !((a != null && t < a) || (b != null && t > b));
  };
  const sieve = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([p, arr]) => [p, (arr || []).filter((x) => inDeclared(p, x))]));
  const snap = { ...rawSnap, idle: [...idle], byPart: sieve(rawSnap.byPart), peakByPart: sieve(rawSnap.peakByPart) };
  const ymd = (k) => (k.length === 8 ? `${+k.slice(4, 6)}월 ${+k.slice(6, 8)}일` : k);
  return {
    dateKey,
    dateLabel: boardMissing ? ymd(dateKey) : (dateLabel || dateKey),
    boardKey,
    boardMissing,
    dates: snapshotDates(),
    // 당일은 판정하지 않는다(카카오가 지나간 티오프를 목록에서 빼므로 '안 뜸 = 찼다'가 성립하지 않는다).
    judgeNote: snap.judgeableFrom || '',
    parts: sb.parts,
    // ★정본 캐디 명단 — 오늘 어느 부에도 안 잡힌 사람을 대조판이 골라 보여줄 수 있게.
    //  판독이 명단을 크게 놓치는 날(8/19 2부: 31명 → 8명), 관리자가 이름을 하나씩 쳐 넣는 건
    //  스무 명이 넘어가면 사람이 할 일이 아니다. 있는 명단에서 끌어다 놓게 한다.
    officialRoster: OFFICIAL_ROSTER.slice(),
    // ★stale = 테스트판이 있는데 실제 배치표가 더 새것이라 덮지 않은 부. 화면이 이 사실을 말해야
    //  관리자가 '검수가 왜 안 보이지'로 헤매지 않는다.
    sandbox: { edited: sb.edited, stale: sb.stale || [], at: sb.at, by: sb.by || '' },
    snap,
    sched,
    health: kakaoHealth() || {},
  };
}
