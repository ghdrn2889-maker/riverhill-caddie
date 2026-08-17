// 카카오 엔진 대 사람 경로 — 누가 더 빠르고 더 맞는가를 매일 자동으로 재둔다.
//
//  ★왜 이렇게 재나: 사람이 올린 글을 해석해서 비교하려 들면, 글 해석이 틀렸을 때
//   비교 자체가 틀린다(그리고 그 사실을 알 방법이 없다). 그래서 글은 안 본다.
//   양쪽의 '결과물'만 본다 — 카카오가 찼다고 본 칸 vs 우리 배치표가 실제로 갖게 된 칸.
//   어느 경로로 들어왔든(사진 판독·글 판독·관리자 교정) 배치표가 그 칸을 가진 시각이 답이다.
//
//  ★판정에 쓸 두 가지만 잰다:
//     빠르기 — 같은 칸을 카카오가 몇 분 먼저 봤나(당일 추가된 칸만. 아침부터 있던 건 비교 대상이 아니다)
//     맞기   — 하루가 끝났을 때 한쪽에만 있는 칸이 몇 개인가(카카오만 = 헛것, 배치표만 = 놓친 것)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadJSON, saveJSON, appendJSONL } from './store.mjs';
import { buildBoardsView } from './boardsview.mjs';

const SAMPLES = 'board-samples.jsonl';
const STATE = 'board-samples-state.json';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; };
const toHM = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
// 카카오는 "06:23", 1부 판독은 "6:23"을 쓴다 — 분으로 환산해 재조립해야 같은 칸이 같은 키가 된다.
export const slotKey = (t, c) => { const m = toMin(t); return m == null ? null : toHM(m) + '|' + (/IN/i.test(c) ? 'IN' : 'OUT'); };
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

function readJSONL(file) {
  try {
    return fs.readFileSync(path.join(DATA_DIR, file), 'utf8').trim().split('\n')
      .map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── 배치표 표본 ────────────────────────────────────────────────────────
//  ★한 곳에서만 본다 — 앱이 받는 그 값(buildBoardsView)을 그대로 표본으로 삼는다.
//   파이프라인·글 판독·관리자 교정 어느 쪽이 썼든 여기로 모이므로 하나만 걸면 전부 잡힌다.
export function sampleBoards({ labelToISO = () => '' } = {}) {
  const st = loadJSON(STATE, {}) || {};
  let dirty = false;
  for (const b of buildBoardsView({ labelToISO })) {
    const date = String(b.targetISO || '').replace(/\D/g, '').slice(0, 8);
    if (!date || !b.teeGrid.length) continue;
    const k = `${date}|${b.part}`;
    const now = b.teeGrid.map((g) => slotKey(g.time, g.course)).filter(Boolean).sort();
    const prev = st[k] && Array.isArray(st[k].slots) ? st[k].slots : null;
    if (prev && prev.join(',') === now.join(',')) continue;
    const ps = new Set(prev || []);
    const added = prev ? now.filter((x) => !ps.has(x)) : [];
    const removed = prev ? prev.filter((x) => !now.includes(x)) : [];
    // 처음 보는 부는 'base' — 그 전에 뭐가 있었는지 모르므로 빠르기 비교에 쓰지 않는다.
    appendJSONL(SAMPLES, prev
      ? { at: Date.now(), date, part: b.part, added, removed, teams: b.teamCount }
      : { at: Date.now(), date, part: b.part, kind: 'base', slots: now, teams: b.teamCount });
    st[k] = { slots: now, at: Date.now() };
    dirty = true;
  }
  // 오래된 날짜는 버린다(45일 롤링).
  const cut = Date.now() - 45 * 24 * 3600 * 1000;
  for (const [k, v] of Object.entries(st)) if ((v.at || 0) < cut) { delete st[k]; dirty = true; }
  if (dirty) saveJSON(STATE, st);
}

// ── 대조 ────────────────────────────────────────────────────────────────
const PART_OF = (key) => { const m = toMin(key.split('|')[0]); if (m == null) return ''; return m < 630 ? '1' : (m < 900 ? '2' : '3'); };

export function compareDay(date) {
  const d = String(date).replace(/\D/g, '').slice(0, 8);
  // 카카오 — 그 칸을 '찼다'고 처음 본 시각(빠르기용). 델타 기록에서만 나온다.
  const kFirst = new Map();
  for (const r of readJSONL('kakao-golf.jsonl').filter((x) => String(x.date) === d).sort((a, b) => a.at - b.at)) {
    for (const s of (r.newBooked || [])) if (!kFirst.has(s)) kFirst.set(s, r.at);
  }
  // ★맞기는 델타를 누적해서 세지 않는다 — 마지막 스냅샷이 정본이다.
  //  실사고: 당일 판정이 꺼져 있던 아침엔 전 칸이 한 번에 '풀림'으로 기록됐고,
  //  그걸 누적해서 빼자 카카오가 멀쩡히 보고 있던 2·3부까지 '못 봤다'로 집계됐다(배치표만 90칸).
  const snap = loadJSON(`kakao-board/${d}.json`, null);
  const kNow = new Map();                                  // 부 → Set(칸)
  for (const [p, arr] of Object.entries((snap && snap.byPart) || {})) {
    kNow.set(String(p), new Set((arr || []).map((x) => slotKey(x.time, x.course)).filter(Boolean)));
  }
  // 배치표 — 그 칸을 실제로 갖게 된 시각. base(처음 본 상태)는 따로 표시한다.
  const bFirst = new Map(), bBase = new Set(), byPart = new Map();
  for (const r of readJSONL(SAMPLES).filter((x) => String(x.date) === d).sort((a, b) => a.at - b.at)) {
    byPart.set(String(r.part), Number(r.teams) || byPart.get(String(r.part)) || 0);
    const pt = String(r.part);
    if (r.kind === 'base') { for (const s of (r.slots || [])) { if (!bFirst.has(s)) { bFirst.set(s, { at: r.at, part: pt }); bBase.add(s); } } continue; }
    for (const s of (r.added || [])) if (!bFirst.has(s)) bFirst.set(s, { at: r.at, part: pt });
    for (const s of (r.removed || [])) bFirst.delete(s);
  }
  const rows = [];
  for (const [s, b] of bFirst) {
    if (bBase.has(s)) continue;                       // 아침부터 있던 칸 — 누가 빨랐는지 알 수 없다
    const kAt = kFirst.get(s);
    rows.push({ slot: s, part: b.part, kakaoAt: kAt || 0, boardAt: b.at, lead: kAt ? Math.round((b.at - kAt) / 60000) : null });
  }
  rows.sort((a, b) => a.boardAt - b.boardAt);
  // 하루가 끝났을 때 한쪽에만 있는 칸 — 이게 '맞기'다. 부마다 따로 센다.
  //  ★카카오가 그 부를 아예 못 본 날은 '틀렸다'가 아니라 '못 봤다'로 적는다.
  //   (관측 시작 전에 완판된 부는 한 번도 판매중인 걸 못 봐서 판정에서 통째로 빠진다 —
  //    이걸 오차로 세면 사람 경로가 이긴 것처럼 보인다. 그건 다른 종류의 실패다.)
  const acc = [];
  for (const p of [...byPart.keys()].sort()) {
    const bSet = new Set([...bFirst].filter(([, v]) => v.part === p).map(([s]) => s));
    const kSet = kNow.get(p);
    if (!kSet || !kSet.size) { acc.push({ part: p, blind: true, board: bSet.size }); continue; }
    acc.push({ part: p, blind: false, board: bSet.size, kakao: kSet.size,
      kakaoOnly: [...kSet].filter((s) => !bSet.has(s)), boardOnly: [...bSet].filter((s) => !kSet.has(s)) });
  }
  return { date: d, rows, acc, parts: [...byPart.keys()].sort() };
}

export function reportDay(date) {
  const c = compareDay(date);
  const L = [];
  const withLead = c.rows.filter((r) => r.lead != null);
  const won = withLead.filter((r) => r.lead > 0);
  L.push(`${c.date.slice(4, 6)}/${c.date.slice(6, 8)} — 당일 추가된 칸 ${c.rows.length}개` + (c.parts.length ? ` (판독된 부 ${c.parts.join('·')})` : ''));
  for (const r of c.rows) {
    L.push(`  ${r.part}부 ${r.slot.replace('|', ' ').padEnd(10)}`
      + (r.kakaoAt ? `카카오 ${hhmm(r.kakaoAt)} · 배치표 ${hhmm(r.boardAt)}  → ${r.lead > 0 ? `카카오가 ${r.lead}분 빨랐다` : (r.lead < 0 ? `배치표가 ${-r.lead}분 빨랐다` : '동시')}`
        : `배치표 ${hhmm(r.boardAt)}  → 카카오는 이 칸을 못 봤다`));
  }
  if (withLead.length) {
    const avg = Math.round(withLead.reduce((s, r) => s + r.lead, 0) / withLead.length);
    L.push(`  빠르기 — 카카오가 먼저 ${won.length}/${withLead.length}칸 · 평균 ${avg}분`);
  }
  L.push(`  맞기 — 카카오만 ${c.kakaoOnly.length}칸${c.kakaoOnly.length ? ` (${c.kakaoOnly.slice(0, 6).map((s) => s.replace('|', ' ')).join(', ')})` : ''}`
    + ` · 배치표만 ${c.boardOnly.length}칸${c.boardOnly.length ? ` (${c.boardOnly.slice(0, 6).map((s) => s.replace('|', ' ')).join(', ')})` : ''}`);
  return L.join('\n');
}

// 여러 날 묶음 — 일주일 뒤 이걸 보고 정한다.
export function reportRange(days = 7) {
  const out = [], acc = { rows: 0, lead: [], won: 0, kOnly: 0, bOnly: 0, missed: 0 };
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const c = compareDay(key);
    if (!c.rows.length && !c.kakaoOnly.length && !c.boardOnly.length) continue;
    out.push(reportDay(key));
    acc.rows += c.rows.length; acc.kOnly += c.kakaoOnly.length; acc.bOnly += c.boardOnly.length;
    acc.missed += c.rows.filter((r) => r.lead == null).length;
    for (const r of c.rows) if (r.lead != null) { acc.lead.push(r.lead); if (r.lead > 0) acc.won++; }
  }
  const avg = acc.lead.length ? Math.round(acc.lead.reduce((s, x) => s + x, 0) / acc.lead.length) : 0;
  out.push('\n── 합계 ──');
  out.push(`  당일 추가 ${acc.rows}칸 중 카카오가 먼저 본 것 ${acc.won}칸 · 평균 ${avg}분 빠름`);
  out.push(`  카카오가 못 본 추가 ${acc.missed}칸 · 헛것(카카오만) ${acc.kOnly}칸 · 놓침(배치표만) ${acc.bOnly}칸`);
  return out.join('\n');
}
