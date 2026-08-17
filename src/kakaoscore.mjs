// 카카오 예상 vs 실제 배치표 — 매일 자동 채점.
//
//  ★왜 있나: 오늘(2026-08-17) 내가 '안 파는 칸' 규칙을 넣어 정확도를 100%→88.9%로 떨어뜨렸는데,
//   사용자가 예약팀장 답변을 가져오기 전까지 아무도 몰랐다. 손으로 재는 동안은 언제나 그렇게 된다.
//   파라미터를 넣는 게 무서운 이유는 파라미터가 많아서가 아니라, 나빠진 걸 늦게 알아서다.
//   매일 재면 다음 날 아침에 숫자로 드러난다. 그러면 넣고, 재고, 나쁘면 되돌리면 된다.
//
//  ★설정 스냅샷을 같이 남긴다 — 그래야 "이 파라미터를 넣은 뒤로 나빠졌다"를 나중에도 되짚을 수 있다.
//
//  정답지는 사람이 만든다. 관리자가 배치표를 검수하며 고친 것이 그대로 라벨이 된다
//  (admin-corrections.jsonl · intern-history.jsonl). 따로 적어줄 필요가 없다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, appendJSONL, loadJSON } from './store.mjs';
import { buildBoardsView } from './boardsview.mjs';
import { loadSnapshot, holdSlots, flexSlots, fixedSlots } from './kakaogolf.mjs';

const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
// ★시각 키는 분으로 환산해 재조립한다 — 1부 판독은 "6:23", 카카오는 "06:23"을 쓴다.
//  글자로 맞추면 1부 42칸이 통째로 '안 맞는다'고 나온다(실측 8/17).
const K = (time, course) => { const m = toMin(time); return m == null ? '' : `${toHM(m)}|${/IN/i.test(String(course)) ? 'IN' : 'OUT'}`; };
const isoOf = (d) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`;

// 카카오가 그 칸을 '찼다'고 처음 말한 시각 — 사람보다 얼마나 빨랐나를 재는 근거.
function firstBookedAt(date) {
  const first = new Map();
  try {
    const lines = fs.readFileSync(path.join(DATA_DIR, 'kakao-golf.jsonl'), 'utf8').trim().split('\n');
    for (const ln of lines) {
      let r; try { r = JSON.parse(ln); } catch { continue; }
      if (r.date !== String(date)) continue;
      for (const k of (r.newBooked || [])) if (!first.has(k)) first.set(k, r.at);
    }
  } catch { /* 기록이 없으면 속도는 못 잰다 — 정확도 채점은 그대로 한다 */ }
  return first;
}

// 관리자가 그날 손으로 고친 티오프 — 이게 정답지다.
function adminTeeFixes(dateISO) {
  const out = [];
  try {
    const lines = fs.readFileSync(path.join(DATA_DIR, 'admin-corrections.jsonl'), 'utf8').trim().split('\n');
    for (const ln of lines) {
      let r; try { r = JSON.parse(ln); } catch { continue; }
      const iso = String(r.date || '').replace(/\D/g, '');
      if (!iso || `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}` !== dateISO) continue;
      for (const c of (r.changes || [])) if (c.field === 'tee' && c.admin) out.push({ at: r.at, pos: c.pos, from: c.model || '', to: c.admin });
    }
  } catch { /* noop */ }
  return out;
}

export function scoreDay(dateYYYYMMDD, { labelToISO = () => '' } = {}) {
  const date = String(dateYYYYMMDD);
  const iso = isoOf(date);
  const snap = loadSnapshot(date);
  if (!snap) return { date, ok: false, why: '카카오 관측 없음' };
  const boards = buildBoardsView({ labelToISO }).filter((b) => b.targetISO === iso);
  if (!boards.length) return { date, ok: false, why: '그 날짜 배치표 없음(아직 안 올라왔거나 지난 날)' };

  const held = new Set([...holdSlots(), ...flexSlots()].map((f) => K(f.time, f.course)))
  ;[...(snap.frameExtra || [])].forEach((k) => held.delete(k));   // 그날 살아난 칸은 비움이 아니다
  const first = firstBookedAt(date);
  const internTees = new Set(((loadJSON('intern-tees.json', {}) || {})[date]?.tees || []).map((t) => K(t.time, t.course)));

  const parts = {};
  let T = 0, H = 0, P = 0, MH = 0, MU = 0;
  for (const b of boards) {
    const bd = new Set((b.teeGrid || []).map((g) => K(g.time, g.course)).filter(Boolean));
    const kk = new Set((snap.byPart?.[b.part] || []).map((x) => K(x.time, x.course)).filter(Boolean));
    const hit = [...bd].filter((k) => kk.has(k));
    const phantom = [...kk].filter((k) => !bd.has(k)).sort();          // 카카오만 — 없는 팀이거나 배치표 뒤 당추
    const miss = [...bd].filter((k) => !kk.has(k)).sort();            // 배치표만 — 카카오가 못 본 팀
    const missHeld = miss.filter((k) => held.has(k));                 // 비워두기로 한 칸이라 못 본 것(설계대로)
    const missOther = miss.filter((k) => !held.has(k));               // ★설명 안 되는 누락 — 이게 늘면 위험하다
    // ★배치표가 올라온 뒤에 찬 칸은 허위가 아니라 '당추를 먼저 본 것'이다(8/18 17:35 실증).
    const late = phantom.filter((k) => first.has(k) && first.get(k) > Number(b.at || 0));
    parts[b.part] = { board: bd.size, kakao: kk.size, hit: hit.length,
      phantom: phantom.filter((k) => !late.includes(k)), lateBooked: late,
      missHeld, missOther, boardAt: Number(b.at || 0) };
    T += bd.size; H += hit.length; P += phantom.length - late.length; MH += missHeld.length; MU += missOther.length;
  }

  // 속도 — 카카오가 배치표보다 몇 분 빨랐나(관측 시작 전에 이미 찬 칸은 하한이라 따로 센다).
  const leads = [];
  for (const b of boards) {
    const at = Number(b.at || 0);
    for (const g of (b.teeGrid || [])) {
      const k = K(g.time, g.course);
      if (!k || !first.has(k) || !at) continue;
      leads.push({ k, part: b.part, min: Math.round((at - first.get(k)) / 60000) });
    }
  }
  const ms = leads.map((x) => x.min).sort((a, b) => a - b);
  const median = ms.length ? ms[Math.floor(ms.length / 2)] : null;

  // 인턴 — 카카오는 찼다는데 배치표 순번표엔 없고, 배치표가 나오기 '전에' 찬 칸 = 인턴 후보.
  //  (배치표 뒤에 찬 것은 당추다. 시각이 둘을 가른다.)
  const cand = [];
  for (const [p, r] of Object.entries(parts)) for (const k of r.phantom) if (!r.lateBooked.includes(k)) cand.push(`${p}|${k}`);
  const candKeys = new Set(cand.map((x) => x.split('|').slice(1).join('|')));
  const internHit = [...internTees].filter((k) => candKeys.has(k));

  return { date, ok: true, at: Date.now(), parts,
    totals: { board: T, hit: H, phantom: P, missHeld: MH, missOther: MU,
      rate: T ? Number((H / T * 100).toFixed(1)) : null },
    lead: { n: leads.length, medianMin: median, minMin: ms[0] ?? null, maxMin: ms[ms.length - 1] ?? null },
    intern: { designated: [...internTees], candidates: [...candKeys], hit: internHit.length },
    adminFixes: adminTeeFixes(iso).length,
    // ★어떤 설정으로 잰 것인지 — 이게 없으면 나중에 '언제부터 나빠졌나'를 못 되짚는다.
    config: { closeLead: Number(process.env.KAKAO_SALE_CLOSE_LEAD || 70),
      blindOn: ['1', 'true', 'yes'].includes(String(process.env.KAKAO_BLIND || '').toLowerCase()),
      hold: holdSlots().map((f) => K(f.time, f.course)), flex: flexSlots().map((f) => K(f.time, f.course)),
      frame: fixedSlots().length, snapSeen: Number(snap.seenCount || 0) } };
}

// 하루치를 채점해 남긴다. 같은 날을 여러 번 불러도 마지막 것이 최신이다(추가만 한다 — 기록은 안 지운다).
export function recordDay(dateYYYYMMDD, opts = {}) {
  const r = scoreDay(dateYYYYMMDD, opts);
  if (!r.ok) return r;
  try { appendJSONL('kakao-score.jsonl', r); } catch (e) { console.error('[카카오채점] 저장 실패:', e.message); }
  const t = r.totals;
  console.log(`📊 [카카오채점] ${r.date} — 정답 ${t.board}팀 · 맞음 ${t.hit}(${t.rate}%) · 허위 ${t.phantom}`
    + ` · 누락 ${t.missHeld + t.missOther}(비움 ${t.missHeld}·설명안됨 ${t.missOther})`
    + (r.lead.medianMin != null ? ` · 배치표보다 중간값 ${r.lead.medianMin}분 빠름` : '')
    + (r.intern.designated.length ? ` · 인턴 ${r.intern.designated.length}칸 중 후보로 맞힌 것 ${r.intern.hit}` : ''));
  const lateAll = Object.values(r.parts).flatMap((p) => p.lateBooked);
  if (lateAll.length) console.log(`·  [카카오채점] ${r.date} 배치표 뒤 당추를 먼저 본 칸 ${lateAll.length}: ${lateAll.join(' ')}`);
  if (t.missOther) console.warn(`⚠️ [카카오채점] ${r.date} 설명 안 되는 누락 ${t.missOther}칸 — 규칙이 팀을 지우고 있는지 확인 필요`);
  return r;
}

export function readScores(limit = 30) {
  try {
    return fs.readFileSync(path.join(DATA_DIR, 'kakao-score.jsonl'), 'utf8').trim().split('\n')
      .map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean).slice(-limit);
  } catch { return []; }
}
