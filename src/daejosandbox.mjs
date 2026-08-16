// 대조판 테스트판(샌드박스) — 관리자가 만지는 값이 회원 앱에 닿지 않게 담아두는 자리.
//
//  ★왜 필요한가: 대조판의 '실제 배치표'는 아직 기능이 덜 여물었다. 그런데 저장이 곧바로
//   board-correct로 가서 lastboard와 회원 today를 다시 계산했다 — 실제로 8/17 3부가
//   카카오 예상 격자로 덮여 커트가 10→13이 됐다. 덜 여문 화면이 살아 있는 데이터를
//   직접 만지는 구조 자체가 문제였다.
//
//  그래서 여기서는 '따로 적어두기만' 한다. 이 파일을 읽는 곳은 대조판뿐이다 —
//  회원 앱도, 알림도, 카카오 엔진도 이 값을 보지 않는다.
//  실제 배치표에 반영하는 건 나중에 기능이 여물었을 때 별도의 명시적 단계로 만든다.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';

const FILE = 'daejo-sandbox.json';
const TTL_MS = 45 * 24 * 3600 * 1000;    // 45일 롤링

export const dateKey = (d) => String(d || '').replace(/\D/g, '').slice(0, 8);

function load() {
  const all = loadJSON(FILE, {}) || {};
  const cut = Date.now() - TTL_MS;
  let dirty = false;
  for (const [k, v] of Object.entries(all)) if (!v || (v.at || 0) < cut) { delete all[k]; dirty = true; }
  if (dirty) saveJSON(FILE, all);
  return all;
}

export function loadSandbox(date) {
  const k = dateKey(date);
  return k ? (load()[k] || null) : null;
}

// parts: { '1'|'2'|'3': { roster[], teeGrid[], boardInternTees[], internTees[], cut } }
//  부 단위로 덮어쓴다 — 보내지 않은 부는 그대로 둔다(1부만 만졌는데 3부가 날아가면 안 된다).
export function saveSandbox(date, parts, { by = '관리자' } = {}) {
  const k = dateKey(date);
  if (!k) throw new Error('날짜가 필요합니다(YYYYMMDD)');
  const all = load();
  const cur = all[k] || { date: k, parts: {} };
  for (const [p, v] of Object.entries(parts || {})) {
    if (!['1', '2', '3'].includes(String(p)) || !v) continue;
    cur.parts[p] = {
      roster: (v.roster || []).map((x) => String(x || '')),
      teeGrid: (v.teeGrid || []).map((g) => ({ pos: Number(g.pos), time: String(g.time || ''), course: /IN/i.test(g.course) ? 'IN' : 'OUT' })).filter((g) => g.pos && g.time),
      // 예상 보기의 배치 — 실제 배치표와 별개 축이고 여기(테스트판) 안에서만 산다.
      projGrid: (v.projGrid || []).map((g) => ({ pos: Number(g.pos), time: String(g.time || ''), course: /IN/i.test(g.course) ? 'IN' : 'OUT' })).filter((g) => g.pos && g.time),
      boardInternTees: (v.boardInternTees || []).map((t) => ({ time: String(t.time || ''), course: /IN/i.test(t.course) ? 'IN' : 'OUT' })).filter((t) => t.time),
      internTees: (v.internTees || []).map((t) => ({ time: String(t.time || ''), course: /IN/i.test(t.course) ? 'IN' : 'OUT' })).filter((t) => t.time),
      cut: Number(v.cut) || 0,
      at: Date.now(),
    };
  }
  cur.at = Date.now(); cur.by = String(by).slice(0, 40);
  all[k] = cur;
  saveJSON(FILE, all);
  const touched = Object.keys(parts || {}).join('·');
  console.log(`🧪 [대조판 테스트] ${k} ${touched}부 저장 — 앱에는 반영되지 않습니다`);
  appendJSONL('daejo-sandbox.jsonl', { at: Date.now(), date: k, parts: Object.keys(parts || {}), by });
  return cur;
}

// 실제 판독으로 되돌리기(테스트판 버리기). 부를 주면 그 부만.
export function clearSandbox(date, part = '') {
  const k = dateKey(date);
  const all = load();
  if (!all[k]) return false;
  if (part) { delete all[k].parts[String(part)]; if (!Object.keys(all[k].parts).length) delete all[k]; }
  else delete all[k];
  saveJSON(FILE, all);
  console.log(`🧪 [대조판 테스트] ${k}${part ? ` ${part}부` : ''} 초기화 — 실제 판독으로 되돌림`);
  appendJSONL('daejo-sandbox.jsonl', { at: Date.now(), date: k, kind: 'clear', part: part || 'all' });
  return true;
}

// 실제 판독 위에 테스트판을 덮어씌운다. 어느 부가 덮였는지도 함께 알려준다.
export function applySandbox(parts, date) {
  const sb = loadSandbox(date);
  const edited = [];
  if (!sb) return { parts, edited, at: 0 };
  for (const [p, v] of Object.entries(sb.parts || {})) {
    if (!parts[p]) continue;                     // 판독이 없는 부는 테스트판도 의미가 없다
    parts[p] = { ...parts[p], roster: v.roster, teeGrid: v.teeGrid, projGrid: v.projGrid || [], boardInternTees: v.boardInternTees, internTees: v.internTees, cut: v.cut || parts[p].cut };
    edited.push(p);
  }
  return { parts, edited, at: sb.at || 0, by: sb.by || '' };
}
