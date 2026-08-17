// 앱 '배치표' 화면이 받는 값 — 한 곳에서만 만든다.
//
//  ★왜 라우트 밖으로 꺼냈나: 이 계산이 app.get() 안에만 있으면 눈으로 보는 것 말고는
//   확인할 방법이 없다. 실제로 여기서 '확정선 38번'과 '30팀 편성'이 한 화면에 같이 뜨는
//   모순을 오래 못 봤다. 함수로 있으면 매번 기계가 확인한다(correctPart3와 같은 이유).
import { loadJSON } from './store.mjs';
import { loadBoardPartsStore } from './boardparts.mjs';

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

export function buildBoardsView({ labelToISO = () => '' } = {}) {
  const out = [];
  const push = (part, roster, teeGrid, cut, cutoffName, teamCount, dateLabel, at) => {
    const r = Array.isArray(roster) ? roster.filter((x) => x != null).map(String) : [];
    if (!r.length) return;
    out.push({
      part: String(part), roster: r,
      teeGrid: Array.isArray(teeGrid) ? teeGrid : [],
      cut: Number(cut) || 0, cutoffName: String(cutoffName || ''),
      teamCount: Number(teamCount) || 0,
      dateLabel: String(dateLabel || ''), targetISO: labelToISO(dateLabel || '') || '',
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
      push(p, d.roster, d.teeGrid, cutOf(d), d.cutoffName, teamsOf(d), label, d._at || s.at);
    }
  } catch (e) { console.error('[boards 1·2부 오류]', e.message); }
  try {
    const lb = loadJSON('lastboard.json', null);
    const v = (lb && lb.rawVerdict) || null;
    if (v) push('3', v.part3Roster, v.teeGrid, cutOf(v), v.cutoffName, teamsOf(v), lb.dateLabel || v.dateLabel || '', lb.at);
  } catch (e) { console.error('[boards 3부 오류]', e.message); }
  out.sort((a, b) => Number(a.part) - Number(b.part));
  return out;
}
