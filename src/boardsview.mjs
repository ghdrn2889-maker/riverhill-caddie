// 앱 '배치표' 화면이 받는 값 — 한 곳에서만 만든다.
//
//  ★왜 라우트 밖으로 꺼냈나: 이 계산이 app.get() 안에만 있으면 눈으로 보는 것 말고는
//   확인할 방법이 없다. 실제로 여기서 '확정선 38번'과 '30팀 편성'이 한 화면에 같이 뜨는
//   모순을 오래 못 봤다. 함수로 있으면 매번 기계가 확인한다(correctPart3와 같은 이유).
import { loadJSON } from './store.mjs';
import { loadBoardPartsStore } from './boardparts.mjs';
import { internTeesFor } from './interns.mjs';

// 인턴 칸 — 티오프는 차지하되 순번은 안 쓰는 자리(배치표의 노란 칸).
//  ★모니터(검수)와 같은 함수로 뽑는다. 관리자가 손으로 지정한 게 있으면 그게 판독을 이긴다.
//   화면 셋(앱·검수·대조)이 같은 값을 봐야 "대조표엔 있는데 앱엔 없다"가 안 생긴다.
const internsFor = (boardInterns, iso, part) => {
  const auto = (Array.isArray(boardInterns) ? boardInterns : [])
    .map((x) => ({ time: (String(x && x.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: /IN/i.test(String(x && x.course)) ? 'IN' : 'OUT' }))
    .filter((x) => x.time);
  const key = String(iso || '').replace(/\D/g, '').slice(0, 8);
  if (!key) return auto;
  return internTeesFor(key, auto, String(part)).map((t) => ({ time: t.time, course: /IN/i.test(t.course) ? 'IN' : 'OUT' }));
};

// ★팀 수는 '확정선'을 먼저 본다.
//  teamCount는 처음 사진 헤더에서 읽은 숫자다. 당추가 들어오거나 관리자가 교정하면
//  근무선(cutLine)은 따라 올라가는데 헤더 숫자는 그 자리에 남는다 — 그래서 둘이 갈라진다.
//  확정선은 '사람이 확인한 지금의 근무선'이므로 이쪽이 이긴다.
export const teamsOf = (d) => Number(d.cutLine) || Number(d.teamCount) || Number(d.cutoffPosition) || 0;
export const cutOf = (d) => Number(d.cutLine) || Number(d.cutoffPosition) || Number(d.teamCount) || 0;

const isoToLabel = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : '';
};

// ★부마다 배치표 날짜가 엇갈릴 수 있다 — 그리고 지금까지는 아무도 몰랐다.
//  왜 엇갈리나(둘 다 실제로 일어난다):
//   ①저장 시점이 다르다 — 3부는 rememberBoard(server.mjs), 1·2부는 setBoardPart로 그 뒤에 저장된다.
//     사이에서 멈추면 한쪽만 새 날짜가 된다(8/18: 가배치 보류가 3부만 막고 1·2부는 낮 판독본 그대로).
//   ②단독 부-배치표(2부만 올라온 글)는 설계상 그 부만 갱신한다 — 이건 정상이지만 화면은 구분을 못 한다.
//  화면이 서로 다른 날짜를 아무 표시 없이 나란히 보여주면, 캐디는 어제 티오프를 보고 출근한다.
//  그래서 여기서 한 번 비교해 낡은 부에 도장을 찍는다. 고치지는 않는다 — 숨기는 게 더 나쁘다.
export function markStaleParts(list) {
  const days = list.map((b) => String(b.targetISO || '')).filter(Boolean);
  if (days.length < 2) return list;
  const newest = days.slice().sort().pop();
  for (const b of list) {
    const iso = String(b.targetISO || '');
    b.stale = !!(iso && iso < newest);
    if (b.stale) b.staleVs = newest;
  }
  return list;
}

export function buildBoardsView({ labelToISO = () => '' } = {}) {
  const out = [];
  const push = (part, roster, teeGrid, cut, cutoffName, teamCount, dateLabel, at, boardInterns) => {
    const r = Array.isArray(roster) ? roster.filter((x) => x != null).map(String) : [];
    if (!r.length) return;
    const targetISO = labelToISO(dateLabel || '') || '';
    out.push({
      part: String(part), roster: r,
      teeGrid: Array.isArray(teeGrid) ? teeGrid : [],
      interns: internsFor(boardInterns, targetISO, part),
      cut: Number(cut) || 0, cutoffName: String(cutoffName || ''),
      teamCount: Number(teamCount) || 0,
      dateLabel: String(dateLabel || ''), targetISO,
      at: Number(at) || 0,
    });
  };
  try {
    const s = loadBoardPartsStore();
    for (const p of ['1', '2']) {
      const d = s && s.parts && s.parts[p];
      if (!d) continue;
      // 부별 도장(_targetISO)이 있으면 그 근무일을, 없으면(옛 저장본) 저장소 날짜라벨을 쓴다.
      const label = d._targetISO ? isoToLabel(d._targetISO) : (s.dateLabel || '');
      push(p, d.roster, d.teeGrid, cutOf(d), d.cutoffName, teamsOf(d), label, d._at || s.at, d.internTees);
    }
  } catch (e) { console.error('[boards 1·2부 오류]', e.message); }
  try {
    const lb = loadJSON('lastboard.json', null);
    const v = (lb && lb.rawVerdict) || null;
    if (v) push('3', v.part3Roster, v.teeGrid, cutOf(v), v.cutoffName, teamsOf(v), lb.dateLabel || v.dateLabel || '', lb.at, v.internTees);
  } catch (e) { console.error('[boards 3부 오류]', e.message); }
  out.sort((a, b) => Number(a.part) - Number(b.part));
  markStaleParts(out);
  return out;
}
