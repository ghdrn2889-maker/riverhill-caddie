// 전원 대조 — 정본 명단 전원을 세우고 각자 오늘 상태를 하나씩 요구한다.
//
//  ★왜 필요한가: 지금까지 시스템은 '읽힌 사람'만 셌다. 안 읽힌 사람은 침묵한다.
//   그래서 판독이 스무 명을 놓쳐도 남은 명단은 여전히 그럴듯해 보인다(8/19 2부 31명 → 8명).
//   전원을 세우면 침묵이 사라진다 — 87명 중 설명이 안 되는 사람 수가 곧 그날의 오차다.
//
//  ★이건 '고치는' 코드가 아니라 '재는' 코드다. 아무것도 바꾸지 않는다.
//   재는 자가 있어야 다음에 무엇을 고쳤을 때 몇 %p 올랐는지 알 수 있다.
//   (근태 캡처 복구·판독 다수결·정본 보강 — 셋 다 이 숫자로 효과를 확인할 수 있다.)
import { loadJSON, saveJSON } from './store.mjs';
import { loadBoardPartsStore } from './boardparts.mjs';
import { effectivePart3Verdict } from './analytics.mjs';
import { resolveWorkParts } from './boardreader.mjs';
import { OFFICIAL_ROSTER } from './roster-official.mjs';
import { keyFromLabel } from './boardpending.mjs';
import { scoreHeadcount, scoreLine, saveHeadcount, loadHeadcount } from './headcount.mjs';

const FILE = 'rollcall.json';
const KEEP_DAYS = 60;
const OFF_RE = /휴무|휴가|병가|격리|연차|반차|월차/;
const bare = (c) => String(c || '').replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim();

// 지금 저장돼 있는 배치표(회원이 실제로 보는 그것)에서 부별 명단·근태를 모은다.
export function currentBoard() {
  const parts = {}; const duty = {};
  let dateLabel = '';
  try {
    const bp = loadBoardPartsStore();
    for (const p of ['1', '2']) {
      const d = bp?.parts?.[p];
      if (!d || !Array.isArray(d.roster)) continue;
      parts[p] = { roster: d.roster.slice(), cut: Number(d.cutLine || d.cutoffPosition) || 0 };
      Object.assign(duty, d.crewDuty || {});
      dateLabel = dateLabel || d.dateLabel || bp.dateLabel || '';
    }
  } catch { /* 1·2부가 없을 수 있다 */ }
  try {
    const lb = loadJSON('lastboard.json', null);
    const v = lb && lb.rawVerdict ? effectivePart3Verdict(lb) : null;
    if (v && Array.isArray(v.part3Roster)) {
      parts['3'] = { roster: v.part3Roster.slice(), cut: Number(v.cutoffPosition) || 0 };
      Object.assign(duty, v.crewDuty || {});
      dateLabel = v.dateLabel || lb.dateLabel || dateLabel;
    }
  } catch { /* noop */ }
  return { parts, duty, dateLabel };
}

// 한 사람의 오늘 상태 — 정확히 하나여야 한다.
//  근무 > 스페어 > 불가용(근태) > 역할(당번·벌당 등) > 설명안됨.
//  ★근무가 근태보다 앞이다: 당번인 사람도 가용이 모자라면 나가서 뛴다. 뛰었으면 근무다.
export function stateOf(name, who, dutyCode) {
  const w = who[name];
  const d = String(dutyCode || '');
  if (w && w.parts.length) {
    return { state: '근무', why: `${w.parts.join('·')}부${w.kind === 'pulled' ? `(${w.from}부에서 당겨옴)` : ''}`, parts: w.parts.slice() };
  }
  if (w && w.spare.length) return { state: '스페어', why: `${w.spare.join('·')}부 대기`, parts: [] };
  if (OFF_RE.test(d)) return { state: '불가용', why: d, parts: [] };
  if (d) return { state: '역할', why: d, parts: [] };
  return { state: '설명안됨', why: '어느 부 명단에도 없고 근태도 없음', parts: [] };
}

// 전원 대조 한 장.
export function buildRollCall(board = currentBoard(), roster = OFFICIAL_ROSTER) {
  const { parts, duty, dateLabel } = board;
  const who = resolveWorkParts(parts);
  const rows = roster.map((nm) => ({ name: nm, ...stateOf(nm, who, duty[nm]) }));
  const states = {};
  for (const r of rows) states[r.state] = (states[r.state] || 0) + 1;
  const unexplained = rows.filter((r) => r.state === '설명안됨').map((r) => r.name);

  // ★배치표엔 있는데 정본에 없는 이름 — 오독이거나 미등록 신입, 둘 중 하나뿐이다.
  //  둘 다 사람이 봐야 한다. 오독이면 그 자리 사람이 통째로 사라진 것이고, 신입이면 정본에 넣어야 한다.
  const known = new Set(roster);
  const strangers = [...new Set(Object.keys(who))].filter((n) => n && !known.has(n));

  // ★근무자 수 = 팀 수. 깨질 수 없는 불변식이다 — 팀 하나에 캐디 한 명이 붙는다.
  const partCheck = [];
  for (const p of ['1', '2', '3']) {
    if (!parts[p]) continue;
    const workers = Object.values(who).filter((w) => w.parts.includes(p)).length;
    const cut = Number(parts[p].cut) || 0;
    partCheck.push({ part: p, cut, workers, ok: cut > 0 && workers === cut });
  }
  const rate = roster.length ? Math.round((1 - unexplained.length / roster.length) * 1000) / 10 : 0;
  return { dateLabel, total: roster.length, states, rate, unexplained, strangers, partCheck, rows };
}

// 날짜별 기록 — 고친 것이 실제로 효과가 있었는지 이 추이로만 알 수 있다.
//  ★declared — 배치표가 스스로 적어둔 인원 요약(총원·가용·제외인원). 있으면 채점해 같이 남긴다.
//   안 넘기면 그날 이미 읽어둔 것을 꺼낸다 — '변동' 글처럼 상자가 없는 그림으로 다시 돌아도 점수를 잃지 않게.
export function recordRollCall(board = currentBoard(), declared = null) {
  const rc = buildRollCall(board);
  const key = keyFromLabel(rc.dateLabel) || '';
  if (!key) return rc;
  if (declared) saveHeadcount(key, declared);
  const hc = declared || loadHeadcount(key);
  rc.declared = hc || null;
  rc.score = hc ? scoreHeadcount(hc, rc) : null;
  const all = loadJSON(FILE, {}) || {};
  all[key] = {
    at: Date.now(), rate: rc.rate, states: rc.states,
    unexplained: rc.unexplained, strangers: rc.strangers,
    partCheck: rc.partCheck.map((x) => ({ part: x.part, cut: x.cut, workers: x.workers })),
    declared: hc ? { total: hc.total, available: hc.available, excluded: hc.excluded } : null,
    score: rc.score ? { rate: rc.score.rate, gap: rc.score.gap, usable: rc.score.usable,
      misses: rc.score.misses.map((l) => ({ key: l.key, declared: l.declared, counted: l.counted })) } : null,
  };
  const keys = Object.keys(all).sort();
  while (keys.length > KEEP_DAYS) delete all[keys.shift()];
  saveJSON(FILE, all);
  const bad = rc.partCheck.filter((x) => !x.ok).map((x) => `${x.part}부 팀 ${x.cut}≠근무 ${x.workers}`);
  console.log(`🧮 [전원대조] ${key} 설명률 ${rc.rate}% — `
    + Object.entries(rc.states).map(([k, n]) => `${k} ${n}`).join(' · ')
    + (rc.strangers.length ? ` · 정본 밖 이름 ${rc.strangers.join(',')}` : '')
    + (bad.length ? ` · ★${bad.join(' ')}` : ''));
  // ★채점 — 배치표가 말한 수와 우리가 센 수. 이 한 줄이 그날 판독의 성적표다.
  if (rc.score) console.log(`🧾 [인원채점] ${key} ${scoreLine(rc.score)}`);
  return rc;
}

export function listRollCall(n = 14) {
  const all = loadJSON(FILE, {}) || {};
  return Object.entries(all).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, n)
    .map(([date, v]) => ({ date, ...v }));
}
