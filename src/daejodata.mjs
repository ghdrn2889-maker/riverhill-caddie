// 대조판 데이터 — 사진 판독(배치표) + 카카오 예약 스냅 + 고정 시간표를 한 덩어리로 모은다.
//
//  왜 따로 두나: 이걸 손으로 뽑은 JSON에 의존하게 두면 대조판은 영원히 '샘플'로 남는다.
//   실제로 그랬다 — 화면은 다 만들어졌는데 file://로 열려 있어서 저장 버튼이 아무 일도 안 했다.
//   모니터가 이 함수를 불러 그 자리에서 그리면, 보는 화면과 저장하는 화면이 같아진다.
import { loadJSON } from './store.mjs';
import { loadBoardPartsStore } from './boardparts.mjs';
import { effectivePart3Verdict } from './analytics.mjs';
import { loadSnapshot, kakaoHealth, fixedSlots } from './kakaogolf.mjs';
import { keyFromLabel } from './boardpending.mjs';
import { internTeesFor } from './interns.mjs';

const norm = (t) => (String(t || '').match(/\d{1,2}:\d{2}/) || [''])[0];

// 고정 시간표 원본 — 대조판은 cadence·parts.first/last로 격자를 다시 그린다.
//  fixedSlots()는 이미 펼쳐진 칸 목록이라, 여기서 부별 첫·끝을 되짚어 격자 정의를 복원한다.
function schedShape() {
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
  return { cadence: cad || 7, parts };
}

// 부별 배치표 — 3부는 lastboard, 1·2부는 board-parts-store.
function partsOf() {
  const out = {};
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
      };
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
        _autoInterns: (v.internTees || []).map((t) => ({ time: norm(t.time), course: /IN/i.test(t.course) ? 'IN' : 'OUT' })).filter((t) => t.time),
      };
      dateLabel = v.dateLabel || lb.dateLabel || dateLabel;
    }
  } catch { /* noop */ }
  return { parts: out, dateLabel };
}

// 대조판 한 장에 필요한 전부. date를 주면 그 날짜, 안 주면 배치표가 말하는 날짜.
export function buildDaejoData(date = '') {
  const { parts, dateLabel } = partsOf();
  const dateKey = String(date || '').replace(/\D/g, '').slice(0, 8) || keyFromLabel(dateLabel) || '';
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
  const snap = (dateKey && loadSnapshot(dateKey)) || {};
  return {
    dateKey,
    dateLabel: dateLabel || dateKey,
    parts,
    snap,
    sched: schedShape(),
    health: kakaoHealth() || {},
  };
}
