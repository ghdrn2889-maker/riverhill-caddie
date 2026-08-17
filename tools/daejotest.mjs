// 대조판 편집기 — 불변식 검증. 브라우저 없이 실제로 클릭을 먹이고 '깨지면 안 되는 것'을 매번 확인한다.
//
//  ★왜 이렇게 하나: 화면 버그를 눈으로만 보고 "됐습니다"라고 한 게 네 번 틀렸다
//   (인턴 색 안 바뀜 / 편집 먹통 / 캐디 사라짐 / 되돌리기 안 먹힘).
//   케이스를 하나씩 손으로 확인하는 방식은 매번 새 케이스에서 다시 깨진다.
//   그래서 케이스가 아니라 '불변식'을 건다 — 어떤 조작을 어떤 순서로 하든 이건 항상 참이어야 한다:
//     ① 명단에 있던 사람은 아무도 사라지지 않는다(티오프에 있든 스페어에 있든 어딘가엔 있다).
//     ② 순번↔이름은 맞바꾸기·이름고치기 말고는 안 바뀐다.
//     ③ 한 티오프 칸에 두 사람이 겹치지 않는다.
//     ④ 되돌리기는 직전 상태를 화면까지 정확히 되돌린다.
//     ⑤ 인턴 지정/해제는 서로의 역연산이다.
import fs from 'node:fs';
import { buildDaejoData } from '../src/daejodata.mjs';

// 입력은 서버가 실제로 쓰는 것과 같은 함수에서 나온다 — 손으로 뽑은 JSON에 매달리면
//  그 파일이 사라지는 순간 테스트가 통째로 못 돈다(실제로 그랬다). SRC를 주면 그 파일로 돈다.
const J = process.env.SRC ? JSON.parse(fs.readFileSync(process.env.SRC, 'utf8')) : buildDaejoData();

// ── 최소 DOM ──────────────────────────────────────────────────────────
class CL {
  constructor(el) { this.el = el; }
  get _s() { return new Set(String(this.el._cls || '').split(/\s+/).filter(Boolean)); }
  _w(s) { this.el._cls = [...s].join(' '); }
  add(...c) { const s = this._s; c.forEach((x) => s.add(x)); this._w(s); }
  remove(...c) { const s = this._s; c.forEach((x) => s.delete(x)); this._w(s); }
  contains(c) { return this._s.has(c); }
  toggle(c, on) { const s = this._s; if (on === undefined ? s.has(c) : !on) s.delete(c); else s.add(c); this._w(s); }
}
class El {
  constructor(tag) { this.tag = tag; this._cls = ''; this.dataset = {}; this.children = []; this.style = {}; this._text = ''; this.parent = null; this.hidden = false; }
  get classList() { return new CL(this); }
  get className() { return this._cls; } set className(v) { this._cls = v; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join(' ') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  set innerHTML(v) { this._text = String(v || '').replace(/<[^>]*>/g, ''); this.children = []; }
  get innerHTML() { return this._text; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  get firstChild() { return this.children[0] || null; }
  insertBefore(c, ref) { c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  querySelector(sel) {
    const cls = sel.replace(/^\./, '');
    for (const c of this.children) { if (c.classList.contains(cls) || c.tag === cls) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
  querySelectorAll() { return []; }
  closest() { return this; }
  addEventListener(t, fn) { (this._ev ||= {})[t] = fn; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
}
const all = [];
const doc = {
  body: new El('body'),
  createElement: (t) => new El(t),
  getElementById: (id) => doc._ids[id],
  querySelectorAll: (sel) => {
    const m = sel.match(/^td\.c\[data-p="(\d)"\]$/);
    if (m) return all.filter((e) => e.dataset.p === m[1]);
    if (sel === 'td.c') return all;
    if (sel === '.drop-to' || sel === 'td.drop-to') return all.filter((e) => e.classList.contains('drop-to'));
    if (sel.startsWith('.tools button')) return doc._modes;
    return [];
  },
  querySelector: (sel) => {
    const m = sel.match(/^\.spares\[data-p="(\d)"\]$/);
    return m ? doc._spares[m[1]] : null;
  },
  addEventListener: (t, fn) => { (doc._ev ||= {})[t] = fn; },
  // 끌어놓기는 좌표로 대상을 찾는다 — 흉내에서는 '지금 무엇 위에 있는지'를 직접 정해준다.
  elementFromPoint: () => doc._over,
  _over: null,
  _ids: {}, _spares: {},
};
for (const id of ['hint', 'state', 'saveBtn', 'undoBtn', 'resetBtn', 'applyBtn', 'vProj', 'vReal', 'viewNote', 'tools']) doc._ids[id] = new El('span');
doc._ids.tools.hidden = true;   // 실제 HTML과 동일하게 — 대조 보기에서 편집 도구는 숨어 있다
for (const p of ['1', '2', '3']) doc._spares[p] = new El('div');
doc._modes = ['team', 'intern', 'name', 'swap', 'move'].map((m) => { const b = new El('button'); b.dataset.mode = m; return b; });

const sched = J.sched;
const toMin = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 0; };
const pad = (n) => String(n).padStart(2, '0');
const toHM = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
for (const p of ['1', '2', '3']) {
  const sp = sched.parts[p];
  for (let t = toMin(sp.first); t <= toMin(sp.last); t += sched.cadence) {
    for (const c of ['OUT', 'IN']) {
      const td = new El('td'); td.className = 'c';
      td.dataset.t = toHM(t); td.dataset.c = c; td.dataset.p = p;
      all.push(td);
    }
  }
}
globalThis.document = doc;
// http: 라야 저장 경로가 실제로 돈다(file:이면 '샘플'로 빠진다) — 저장 후 상태도 검증 대상이다.
globalThis.location = { protocol: 'http:', search: '?k=test' };
// ★생성기와 '똑같은 모양'으로 넘긴다 — 여기가 다르면 하네스가 통과해도 실제 화면은 다르게 돈다.
const BOARD = Object.fromEntries(['1', '2', '3'].map((p) => [p, {
  ...(J.parts?.[p] || {}),
  kakaoSlots: (J.snap?.byPart?.[p] || []).map((x) => ({ time: x.time, course: x.course })),
}]));
globalThis.window = { __DAEJO_DATE: J.dateKey || '', __DAEJO_BOARD: BOARD, __DAEJO_SANDBOX: (J.sandbox && J.sandbox.edited) || [] };
globalThis.prompt = () => null;
globalThis.confirm = () => true;
// 보낸 몸통을 기록해둔다 — '무엇을 저장했는가'가 불변식이다(예상 격자가 새어나가면 안 된다).
globalThis.__SENT = [];
globalThis.fetch = async (url, opt) => {
  try { globalThis.__SENT.push({ url: String(url).split('?')[0], body: JSON.parse(opt.body) }); } catch { /* noop */ }
  return { ok: true, json: async () => ({ ok: true, effective: [] }) };
};
await import('../tools/daejo-client.js');

// ── 화면에서 상태 읽기 ────────────────────────────────────────────────
const bare = (x) => String(x || '').replace(/\([^)]*\)/g, '').trim();
const cellOf = (p, t, c) => all.find((e) => e.dataset.p === p && e.dataset.t === toHM(toMin(t)) && e.dataset.c === c);
function readGrid(p) {
  const out = [];
  for (const e of all.filter((x) => x.dataset.p === p)) {
    if (e.classList.contains('intern')) { out.push({ slot: e.dataset.t + ' ' + e.dataset.c, intern: true }); continue; }
    const pe = e.querySelector('.pos');
    if (!pe || !pe.textContent) continue;
    out.push({ pos: Number(pe.textContent), slot: e.dataset.t + ' ' + e.dataset.c, name: e.querySelector('.nm').textContent });
  }
  return out.sort((a, b) => toMin(a.slot) - toMin(b.slot) || (a.slot.endsWith('OUT') ? -1 : 1));
}
const readSpares = (p) => doc._spares[p].children.filter((c) => c.classList.contains('sp'))
  .map((c) => ({ pos: Number(c.dataset.pos), name: c.querySelector('.nm').textContent }));
const clickMode = (m) => doc._modes.find((b) => b.dataset.mode === m)._ev.click();
const clickCell = (td) => doc._ev.click({ target: td });
// ★끌어놓기 — 누르기와 다른 길이다. 여기를 안 눌러보면 '드래그는 되는데 저장이 안 된다' 같은
//  버그를 통째로 못 본다(실제로 그랬다). 손가락이 지나가는 경로까지 그대로 흉내낸다.
function dragTo(fromEl, toEl) {
  doc._over = fromEl;
  doc._ev.pointerdown({ target: fromEl, clientX: 0, clientY: 0, button: 0, pointerId: 1 });
  doc._over = toEl;
  doc._ev.pointermove({ clientX: 40, clientY: 40, pointerId: 1, preventDefault() {} });
  doc._ev.pointerup({ clientX: 40, clientY: 40, pointerId: 1 });
  // 브라우저는 끌어놓기 끝에 click을 한 번 더 흘려보낸다(누른 곳과 뗀 곳이 달라도 문서까지 온다).
  //  그걸 안 흘리면 '누르기 무시' 표시가 남아 다음 검사의 첫 탭이 먹힌다 — 실제 폰에서 나던 증상과 같다.
  doc._ev.click({ target: toEl });
  doc._over = null;
}
const allSlotCount = (p) => all.filter((e) => e.dataset.p === p).length;

// ── 불변식 ────────────────────────────────────────────────────────────
let fails = 0;
const chk = (ok, msg) => { if (!ok) { fails++; console.log('   ★NG ' + msg); } return ok; };
function invariants(p, label) {
  const g = readGrid(p).filter((x) => !x.intern);
  const sp = readSpares(p);
  const roster = (J.parts[p].roster || []).map(bare).filter(Boolean);
  const seen = new Set([...g.map((x) => x.name), ...sp.map((x) => x.name)].filter(Boolean));
  const missing = roster.filter((n) => !seen.has(n));
  chk(missing.length === 0, `${label} ① 사라진 사람: ${missing.slice(0, 5).join(', ')}`);
  const slots = g.map((x) => x.slot);
  chk(new Set(slots).size === slots.length, `${label} ③ 같은 티오프에 둘 이상`);
  const poss = g.map((x) => x.pos);
  chk(new Set(poss).size === poss.length, `${label} ③ 같은 순번이 두 칸에`);
  // 순번 순서 = 시각 순서여야 한다(옮기기를 안 했다면)
  return { g, sp };
}

// ── 두 보기 모두 편집 가능해야 한다(사용자 확정) ─────────────────────────
const HAS_KAKAO = ['1', '2', '3'].some((p) => (BOARD[p].kakaoSlots || []).length);
if (!HAS_KAKAO) console.log('  ⚠️ 카카오 스냅이 없습니다 — 대조(예상) 보기는 검증하지 못합니다. 서버(스냅이 있는 곳)에서 돌리세요.');
if (HAS_KAKAO) {
  chk(doc._ids.tools.hidden === false, '편집도구 — 대조(카카오 예상) 보기에서 도구가 숨겨져 있다');
  const p0 = '3';
  const g = readGrid(p0).filter((x) => !x.intern);
  // 인턴이 이미 지정돼 있으면 그만큼 정규 칸이 줄어 있다 — 그걸 빼고 비교한다.
  const kakaoN = (BOARD[p0].kakaoSlots || []).length;
  const internN = (BOARD[p0].internTees || []).length;
  chk(g.length === kakaoN - internN,
    `대조 보기 격자가 카카오 칸 수와 다르다(${g.length} vs ${kakaoN}-${internN})`);
  const snap0 = JSON.stringify(g);
  clickMode('intern');
  clickCell(cellOf(p0, g[1].slot.split(' ')[0], g[1].slot.split(' ')[1]));
  chk(JSON.stringify(readGrid(p0).filter((x) => !x.intern)) !== snap0, '대조 보기에서 인턴 지정이 안 먹는다');
  doc._ids.undoBtn._ev.click();
  chk(JSON.stringify(readGrid(p0).filter((x) => !x.intern)) === snap0, '대조 보기 되돌리기가 복구 못 함');
  clickMode('intern');
  console.log('  대조 보기 편집 확인');
}

// ── 시나리오 — 두 보기 모두 ────────────────────────────────────────────
console.log('\n불변식 검증 — 두 보기 × 각 부의 첫/중간/마지막 티오프\n');
for (const VIEW of (HAS_KAKAO ? ['real', 'proj'] : ['real'])) {
doc._ids[VIEW === 'real' ? 'vReal' : 'vProj']._ev.click();
console.log(' [' + (VIEW === 'real' ? '실제 배치표' : '카카오 예상') + ']');
for (const p of ['1', '2', '3']) {
  const grid0 = readGrid(p).filter((x) => !x.intern);
  if (!grid0.length) { console.log(`  ${p}부 — 이 보기에 칸이 없습니다(판독된 배치표 없음), 건너뜁니다`); continue; }
  const base = JSON.stringify(grid0);
  const spares0 = JSON.stringify(readSpares(p));
  const targets = [0, Math.floor(grid0.length / 2), grid0.length - 1].filter((i, k, a) => a.indexOf(i) === k);
  for (const idx of targets) {
    const s = grid0[idx];
    const [t, c] = s.slot.split(' ');
    const td = cellOf(p, t, c);
    clickMode('intern');
    clickCell(td);
    const after = readGrid(p).filter((x) => !x.intern);
    const { } = invariants(p, `${p}부 ${s.slot}(${s.pos}번 ${s.name}) 인턴`);
    // ★규칙(사용자 확정): 팀 수는 고정이다. 예약이 있는 티오프에만 팀이 있다.
    //  인턴이 한 팀을 맡으면 정규 자리가 정확히 하나 줄고, 뒤 사람들은 각자 다음 팀으로
    //  밀리다가 맨 뒤 한 명이 스페어로 내려간다. 그 사람은 스페어 줄에 보여야 한다.
    const spNow = readSpares(p).map((x) => x.name);
    const dropped = grid0.filter((x) => !after.some((a) => a.name === x.name)).map((x) => x.name);
    chk(dropped.length === 1, `${p}부 ${s.slot} 인턴 — 스페어로 내려간 사람이 ${dropped.length}명(1명이어야)`);
    chk(dropped.every((n) => spNow.includes(n)), `${p}부 ${s.slot} 인턴 — 내려간 ${dropped.join(',')}이(가) 스페어 줄에 없다`);
    chk(after.length === grid0.length - 1, `${p}부 ${s.slot} 인턴 — 근무선 ${grid0.length}→${after.length}(1만 줄어야)`);
    // 인턴보다 앞 순번은 티오프가 그대로여야 한다
    const keptOk = grid0.slice(0, idx).every((x, i) => after[i] && after[i].slot === x.slot && after[i].name === x.name);
    chk(keptOk, `${p}부 ${s.slot} 인턴 — 인턴보다 앞 순번의 티오프가 바뀌었다`);
    // 되돌리기
    doc._ids.undoBtn._ev.click();
    chk(JSON.stringify(readGrid(p).filter((x) => !x.intern)) === base, `${p}부 ${s.slot} — 되돌리기가 화면을 복구 못 함`);
    chk(JSON.stringify(readSpares(p)) === spares0, `${p}부 ${s.slot} — 되돌리기 후 스페어 줄이 다름`);
    clickMode('intern');   // 모드 끄기
  }
  console.log(`  ${p}부 ${targets.length}곳 검사 완료`);
}
}
// ── ⑨ 스페어를 근무로 올리는 건 어느 쪽을 먼저 눌러도 된다 ────────────────
//  순번 옮기기 모드에서 스페어를 먼저 누르면 안내문만 뜨고 아무것도 안 집혀서,
//  스페어 → 근무가 한 방향으로만 됐다(근무자를 먼저 눌렀을 때만).
{
  console.log('\n스페어 ↔ 근무 (순번 옮기기 모드)\n');
  doc._ids.vReal._ev.click();
  for (const first of ['spare', 'work']) {
    const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length && readSpares(x).length);
    if (!p) { console.log('  스페어가 있는 부가 없어 건너뜁니다'); break; }
    const g0 = readGrid(p).filter((x) => !x.intern);
    const sp0 = readSpares(p);
    const w = g0[Math.floor(g0.length / 2)];          // 근무 중인 사람
    const s = sp0[0];                                  // 스페어 첫 사람
    const wCell = () => cellOf(p, w.slot.split(' ')[0], w.slot.split(' ')[1]);
    const sChip = () => doc._spares[p].children.find((c) => Number(c.dataset.pos) === s.pos);
    clickMode('move');
    if (first === 'spare') { clickCell(sChip()); clickCell(wCell()); }
    else { clickCell(wCell()); clickCell(sChip()); }
    clickMode('move');
    const g1 = readGrid(p).filter((x) => !x.intern);
    const sp1 = readSpares(p).map((x) => x.name);
    const nowWorking = g1.find((x) => x.slot === w.slot);
    chk(nowWorking && nowWorking.name === s.name, `[${first} 먼저] 스페어 ${s.name}가 ${w.slot}에 안 들어갔다(지금 ${nowWorking ? nowWorking.name : '빈칸'})`);
    chk(sp1.includes(w.name), `[${first} 먼저] 자리를 내준 ${w.name}가 스페어 줄에 없다`);
    chk(g1.length === g0.length, `[${first} 먼저] 근무선이 ${g0.length}→${g1.length}로 바뀌었다(맞바꾸기는 팀 수를 안 바꾼다)`);
    console.log(`  [${first === 'spare' ? '스페어' : '근무자'} 먼저] ${s.name}(${s.pos}번) ↔ ${w.name}(${w.pos}번) — ${w.slot} 배치 확인`);
    doc._ids.undoBtn._ev.click();
  }
}

// ── ⑩ 끌어놓기 → 저장까지. 그리고 '화면과 저장 내용이 같아야 한다' ──────────
//  '드래그는 되는데 저장이 안 된다'의 정체: 되돌리기가 tee를 새 배열로 갈아끼워
//  화면이 보는 배치와 저장이 보는 배치가 갈라졌다(화면 15팀 / 저장 14팀).
//  그래서 조작 결과만 보지 않고 '무엇을 보냈는가'를 화면과 대조한다.
{
  console.log('\n끌어놓기 → 저장 (화면 = 보낸 내용)\n');
  doc._ids.vReal._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length && readSpares(x).length);
  if (p) {
    for (const md of ['move', 'swap']) {
      const g0 = readGrid(p).filter((x) => !x.intern);
      const s = readSpares(p)[0];
      const w = g0[Math.floor(g0.length / 2)];
      const chip = doc._spares[p].children.find((c) => Number(c.dataset.pos) === s.pos);
      clickMode(md);
      dragTo(chip, cellOf(p, w.slot.split(' ')[0], w.slot.split(' ')[1]));
      clickMode(md);
      const g1 = readGrid(p).filter((x) => !x.intern);
      const now = g1.find((x) => x.slot === w.slot);
      chk(now && now.name === s.name, `[${md}] 끌어놓기 — ${s.name}가 ${w.slot}에 안 들어갔다(지금 ${now ? now.name : '빈칸'})`);
      chk(g1.length === g0.length, `[${md}] 끌어놓기로 근무선이 ${g0.length}→${g1.length} (맞바꾸기는 팀 수를 안 바꾼다)`);
      chk(doc._ids.saveBtn.hidden === false, `[${md}] 끌어놓기로 바꿨는데 저장 버튼이 안 나온다`);
      globalThis.__SENT.length = 0;
      await doc._ids.saveBtn._ev.click();
      const sent = globalThis.__SENT.find((x) => x.url.endsWith('/api/daejo-save'));
      chk(!!sent, `[${md}] 끌어놓기 뒤 저장이 서버로 안 갔다`);
      const rp = sent?.body?.parts?.[p];
      chk(!!rp, `[${md}] 저장 몸통에 ${p}부가 없다`);
      if (rp) {
        // ★핵심 — 화면에 보이는 배치와 서버로 보낸 배치가 글자 하나까지 같아야 한다.
        const onScreen = g1.map((x) => `${x.slot.replace(' ', '')}=${x.name}`).join(' ');
        const inBody = (rp.teeGrid || []).map((g) => `${g.time}${g.course}=${bare(rp.roster[g.pos - 1])}`).join(' ');
        chk(onScreen === inBody, `[${md}] 화면과 보낸 내용이 다르다\n        화면: ${onScreen}\n        저장: ${inBody}`);
      }
      chk(doc._ids.saveBtn.hidden === true, `[${md}] 저장했는데 저장 버튼이 안 사라진다`);
      const g2 = readGrid(p).filter((x) => !x.intern);
      chk(g2.length === g1.length, `[${md}] 저장하고 나니 근무선이 ${g1.length}→${g2.length}로 줄었다`);
      console.log(`  [${md === 'move' ? '순번 옮기기' : '맞바꾸기'}] ${s.name} → ${w.slot} · 팀 ${g1.length} 유지 · 화면=저장 확인`);
    }
  } else console.log('  스페어가 있는 부가 없어 건너뜁니다');
}

// ── ⑪ 순번 옮기기 — 그 사람의 순번은 그대로, 티오프만 옮겨간다 ────────────────
//  사이 순번들의 티오프가 한 칸씩 따라 움직이고, 명단(순번↔이름)은 아무도 안 바뀐다.
//  그리고 그 결과가 저장까지 살아남아야 한다.
{
  console.log('\n순번 옮기기 (근무 → 근무)\n');
  doc._ids.vReal._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length >= 5);
  if (p) {
    const g0 = readGrid(p).filter((x) => !x.intern);
    // 순번→이름 지도로 비교한다. 화면 읽기는 시각 순이라, 옮기고 나면 줄 순서 자체가 달라진다
    //  — 줄 순서로 비교하면 명단이 안 바뀌었는데도 바뀐 것처럼 보인다.
    const nameAt0 = new Map(g0.map((x) => [x.pos, x.name]));
    const fromIdx = 1, toIdx = 4;                   // 2번째 사람을 5번째 티오프로
    const a = g0[fromIdx], b = g0[toIdx];
    clickMode('move');
    clickCell(cellOf(p, a.slot.split(' ')[0], a.slot.split(' ')[1]));
    clickCell(cellOf(p, b.slot.split(' ')[0], b.slot.split(' ')[1]));
    clickMode('move');
    const g1 = readGrid(p).filter((x) => !x.intern);
    const at = (pos) => (g1.find((x) => x.pos === pos) || {}).slot;
    console.log(`  ${a.pos}번 ${a.name}: ${a.slot} → ${at(a.pos)}  (목표 ${b.slot})`);
    chk(at(a.pos) === b.slot, `순번 옮기기 — ${a.pos}번이 ${b.slot}로 안 갔다(지금 ${at(a.pos)})`);
    const nameAt1 = new Map(g1.map((x) => [x.pos, x.name]));
    chk([...nameAt0].every(([k, v]) => nameAt1.get(k) === v), '순번 옮기기인데 명단(순번↔이름)이 바뀌었다');
    chk(g1.length === g0.length, `순번 옮기기로 근무선이 ${g0.length}→${g1.length}`);
    // ★사이 순번은 '앞사람 자리'를 물려받는다 — 뒤로 보낸 사람이 비운 칸부터 한 칸씩 당겨진다.
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      chk(at(g0[i].pos) === g0[i - 1].slot, `사이 순번 ${g0[i].pos}번이 ${g0[i - 1].slot}를 못 받았다(지금 ${at(g0[i].pos)})`);
    }
    // ★저장까지 살아남는가 — 저장하고 다시 그려도 그대로여야 한다
    globalThis.__SENT.length = 0;
    await doc._ids.saveBtn._ev.click();
    const rp = globalThis.__SENT.find((x) => x.url.endsWith('/api/daejo-save'))?.body?.parts?.[p];
    chk(!!rp, '순번 옮기기 뒤 저장이 안 갔다');
    if (rp) chk((rp.teeGrid.find((g) => g.pos === a.pos) || {}) && `${rp.teeGrid.find((g) => g.pos === a.pos)?.time} ${rp.teeGrid.find((g) => g.pos === a.pos)?.course}` === b.slot,
      `저장한 내용에서 ${a.pos}번이 ${b.slot}가 아니다`);
    const g2 = readGrid(p).filter((x) => !x.intern);
    const at2 = (pos) => (g2.find((x) => x.pos === pos) || {}).slot;
    chk(at2(a.pos) === b.slot, `저장하고 나니 ${a.pos}번이 ${b.slot}에서 ${at2(a.pos)}로 되돌아갔다`);
    console.log(`  저장 후: ${a.pos}번 ${at2(a.pos)}`);
  } else console.log('  근무 5명 이상인 부가 없어 건너뜁니다');
}

// ── ⑫ 기본 화면(카카오 예상)에서 한 편집도 저장돼야 한다 ─────────────────────
//  화면이 처음 열릴 때의 보기가 '카카오 예상'이다. 검사를 매번 '실제 배치표'로 바꿔서 하면
//  사용자가 실제로 쓰는 화면을 한 번도 안 눌러보게 된다 — 그래서 '옮겨는 지는데 저장 버튼이
//  아예 안 나오는' 상태를 오래 못 봤다(실브라우저 확인).
if (HAS_KAKAO) {
  console.log('\n기본 화면(카카오 예상)에서 편집 → 저장\n');
  doc._ids.vProj._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length >= 5);
  if (p) {
    const g0 = readGrid(p).filter((x) => !x.intern);
    const a = g0[1], b = g0[4];
    clickMode('move');
    clickCell(cellOf(p, a.slot.split(' ')[0], a.slot.split(' ')[1]));
    clickCell(cellOf(p, b.slot.split(' ')[0], b.slot.split(' ')[1]));
    clickMode('move');
    const at = (pos) => (readGrid(p).filter((x) => !x.intern).find((x) => x.pos === pos) || {}).slot;
    chk(at(a.pos) === b.slot, `[예상] ${a.pos}번이 ${b.slot}로 안 갔다(지금 ${at(a.pos)})`);
    chk(doc._ids.saveBtn.hidden === false, '[예상] 옮겼는데 저장 버튼이 안 나온다 — 저장할 방법이 없다');
    globalThis.__SENT.length = 0;
    await doc._ids.saveBtn._ev.click();
    const rp = globalThis.__SENT.find((x) => x.url.endsWith('/api/daejo-save'))?.body?.parts?.[p];
    chk(!!rp, '[예상] 저장이 서버로 안 갔다');
    if (rp) {
      const g = (rp.projGrid || []).find((x) => x.pos === a.pos);
      chk(g && `${g.time} ${g.course}` === b.slot, `[예상] 저장한 예상 배치에서 ${a.pos}번이 ${b.slot}가 아니다(${g ? g.time + ' ' + g.course : '없음'})`);
    }
    chk(at(a.pos) === b.slot, `[예상] 저장하고 나니 ${a.pos}번이 되돌아갔다(지금 ${at(a.pos)})`);
    chk(doc._ids.saveBtn.hidden === true, '[예상] 저장했는데 저장 버튼이 안 사라진다');
    console.log(`  ${a.pos}번 ${a.name}: ${a.slot} → ${b.slot} · 저장·유지 확인`);
  } else console.log('  근무 5명 이상인 부가 없어 건너뜁니다');
}

// ── ⑬ 티오프(팀) 추가·삭제 ───────────────────────────────────────────────
//  실시간 추적이 놓친 예약을 관리자가 손으로 살릴 수 있어야 한다.
//  추가 = 그 뒤가 한 칸씩 밀리고 스페어 맨 앞이 근무로. 삭제 = 그 역. 되돌리기로 원상복구.
{
  console.log('\n티오프 추가·삭제\n');
  doc._ids.vReal._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length && readSpares(x).length);
  if (p) {
    const g0 = readGrid(p).filter((x) => !x.intern);
    const sp0 = readSpares(p);
    const occupied = new Set(g0.map((x) => x.slot));
    // 표에 있는 칸 중 아무도 없는 칸 하나 — 그 시각엔 원래 팀이 없다
    const empty = doc.querySelectorAll('td.c[data-p="' + p + '"]')
      .map((td) => ({ td, slot: td.dataset.t + ' ' + td.dataset.c }))
      .find((x) => !occupied.has(x.slot) && !x.td._cls.includes('intern'));
    if (empty) {
      clickMode('team');
      clickCell(empty.td);
      const g1 = readGrid(p).filter((x) => !x.intern);
      chk(g1.some((x) => x.slot === empty.slot), `팀 추가 — ${empty.slot}에 아무도 안 섰다`);
      chk(g1.length === g0.length + 1, `팀 추가 — 근무선이 ${g0.length}→${g1.length} (1 늘어야)`);
      const promoted = g1.find((x) => !g0.some((y) => y.name === x.name));
      chk(promoted && promoted.name === sp0[0].name, `팀 추가 — 스페어 맨 앞(${sp0[0].name})이 아니라 ${promoted ? promoted.name : '아무도'} 올라왔다`);
      chk(!readSpares(p).some((s) => s.name === sp0[0].name), `팀 추가 — 올라온 ${sp0[0].name}가 스페어에 남아 있다`);
      console.log(`  추가  ${empty.slot} · 근무선 ${g0.length}→${g1.length} · ${sp0[0].name} 근무로`);
      // 삭제 = 역연산
      clickCell(empty.td);
      const g2 = readGrid(p).filter((x) => !x.intern);
      chk(g2.length === g0.length, `팀 삭제 — 근무선이 ${g0.length}로 안 돌아왔다(지금 ${g2.length})`);
      chk(g2.map((x) => x.pos + x.slot + x.name).join('|') === g0.map((x) => x.pos + x.slot + x.name).join('|'), '팀 삭제가 추가의 역연산이 아니다');
      console.log(`  삭제  ${empty.slot} · 근무선 ${g2.length} · 원상복구 확인`);
      // 되돌리기로도 복구되는가
      clickCell(empty.td);
      doc._ids.undoBtn._ev.click();
      const g3 = readGrid(p).filter((x) => !x.intern);
      chk(g3.length === g0.length && !g3.some((x) => x.slot === empty.slot), '팀 추가 뒤 되돌리기가 복구 못 함');
      console.log('  되돌리기 복구 확인');
      clickMode('team');
    } else console.log('  빈 칸이 없어 건너뜁니다');
  } else console.log('  스페어가 있는 부가 없어 건너뜁니다');
}

// ── ⑭ 앱에 반영 — 실제 배치표 축만 넘어간다 ─────────────────────────────
//  8/17 사고: 예상 격자가 본배치표로 새어 들어가 3부가 10팀→13팀, 커트 10→13이 됐다.
//  이제 반영은 버튼을 눌렀을 때만 일어나고, 그때도 넘어가는 건 실제 축뿐이어야 한다.
if (HAS_KAKAO) {
  console.log('\n앱에 반영 — 실제 축만\n');
  // 예상 보기에서 잔뜩 고쳐놓고 반영해도, 넘어가는 건 실제 배치표여야 한다.
  doc._ids.vProj._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length >= 5);
  if (p) {
    const g0 = readGrid(p).filter((x) => !x.intern);
    clickMode('move');
    clickCell(cellOf(p, g0[1].slot.split(' ')[0], g0[1].slot.split(' ')[1]));
    clickCell(cellOf(p, g0[4].slot.split(' ')[0], g0[4].slot.split(' ')[1]));
    clickMode('move');
    const projTeams = readGrid(p).filter((x) => !x.intern).length;
    doc._ids.vReal._ev.click();
    const realTeams = readGrid(p).filter((x) => !x.intern).length;
    globalThis.__SENT.length = 0;
    await doc._ids.applyBtn._ev.click();
    const sent = globalThis.__SENT.filter((x) => x.url.endsWith('/api/board-correct'));
    chk(sent.length > 0, '반영 버튼을 눌렀는데 board-correct를 안 불렀다');
    // ★손 안 댄 부는 보내면 안 된다 — 그 부 회원까지 다시 계산되고 잠금이 걸린다.
    //  '손댄 부' = 지금 이 시험이 고친 부 + 서버 테스트판이 이미 덮고 있던 부(그것도 관리자가 고쳐둔 것이다).
    const preEdited = (J.sandbox && J.sandbox.edited) || [];
    chk(sent.every((s) => s.body.part === p || preEdited.includes(s.body.part)),
      `손 안 댄 부까지 보냈다: ${sent.map((s) => s.body.part + '부').join(',')} (고친 건 ${p}부 + 테스트판 ${preEdited.join('·') || '없음'})`);
    for (const s of sent) {
      const teams = s.body.rows.filter((r) => r.tee).length;
      chk(teams !== projTeams || projTeams === realTeams, `${s.body.part}부 — 예상 팀 수(${projTeams})가 그대로 넘어갔다`);
      chk(s.body.cutLine === teams, `${s.body.part}부 — 커트(${s.body.cutLine})와 보낸 팀 수(${teams})가 다르다`);
      chk(s.body.notify === false, `${s.body.part}부 — 알림이 켜진 채로 넘어갔다`);
      const bd = (J.parts[s.body.part]?.teeGrid || []).length;
      chk(teams <= Math.max(bd, realTeams), `${s.body.part}부 — 실제 ${bd}팀인데 ${teams}팀을 보냈다`);
    }
    console.log(`  예상 ${projTeams}팀 / 실제 ${realTeams}팀 → 보낸 팀 ${sent[0]?.body.rows.filter((r) => r.tee).length} · 알림 ${sent[0]?.body.notify}`);
  } else console.log('  근무 5명 이상인 부가 없어 건너뜁니다');
}

// ── ⑮ 저장한 뒤에도 반영할 수 있어야 한다 ────────────────────────────────
//  실사고: 고치고 '테스트판에 저장'을 누르면 반영 버튼이 스스로 사라졌다.
//   저장이 기준선을 옮겨 changed()가 false가 되는데, '테스트판이 덮은 부' 목록은
//   페이지를 켤 때 값에서 얼어붙어 있었기 때문이다 — 저장은 됐는데 앱에 보낼 방법이 없었다.
{
  console.log('\n저장 → 반영 연결\n');
  doc._ids.vReal._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length >= 3);
  if (p) {
    const g0 = readGrid(p).filter((x) => !x.intern);
    clickMode('move');
    clickCell(cellOf(p, g0[0].slot.split(' ')[0], g0[0].slot.split(' ')[1]));
    clickCell(cellOf(p, g0[2].slot.split(' ')[0], g0[2].slot.split(' ')[1]));
    clickMode('move');
    globalThis.__SENT.length = 0;
    await doc._ids.saveBtn._ev.click();
    chk(globalThis.__SENT.some((x) => x.url.endsWith('/api/daejo-save')), '저장이 안 나갔다');
    chk(doc._ids.saveBtn.hidden === true, '저장했는데 저장 버튼이 남아 있다');
    chk(doc._ids.applyBtn.hidden === false, '저장했더니 반영 버튼이 사라졌다 — 앱에 보낼 방법이 없다');
    globalThis.__SENT.length = 0;
    await doc._ids.applyBtn._ev.click();
    const sent = globalThis.__SENT.filter((x) => x.url.endsWith('/api/board-correct'));
    chk(sent.length === 1 && sent[0].body.part === p, `저장 뒤 반영이 ${p}부를 안 보냈다(보낸 것: ${sent.map((s) => s.body.part + '부').join(',') || '없음'})`);
    chk(doc._ids.applyBtn.hidden === true, '반영했는데 반영 버튼이 그대로 — 또 보낼 수 있다');
    console.log(`  저장 → 반영 버튼 살아 있음 → ${p}부 ${sent[0]?.body.rows.filter((r) => r.tee).length}팀 전송 · 반영 뒤 버튼 사라짐`);
  } else console.log('  근무 3명 이상인 부가 없어 건너뜁니다');
}

// ── ⑧ 실제 배치표의 팀은 사진이 정한다 ────────────────────────────────────
//  카카오 예상 칸에만 찍은 인턴(예: 본배치표에 팀이 없는 17:07)이 실제 보기의 팀 수를 바꾸면 안 된다.
//  바뀌면 없는 팀이 유령으로 끼어 밀림이 어긋나고, 화면에선 '밀림'이 아니라 '교체'로 보인다.
{
  console.log('\n실제 배치표 팀 수 고정\n');
  doc._ids.vReal._ev.click();
  for (const p of ['1', '2', '3']) {
    const board = J.parts[p];
    if (!board || !(board.teeGrid || []).length) continue;
    const teams = (board.teeGrid || []).length + (board.boardInternTees || []).length;
    const work = readGrid(p).filter((x) => !x.intern).length;
    const ghost = (board.internTees || []).filter((t) => {
      const k = String(t.time).replace(/^(\d):/, '0$1:') + '|' + (/IN/i.test(t.course) ? 'IN' : 'OUT');
      return !(board.teeGrid || []).some((g) => (String(g.time).replace(/^(\d):/, '0$1:') + '|' + g.course) === k)
        && !(board.boardInternTees || []).some((b) => (String(b.time).replace(/^(\d):/, '0$1:') + '|' + b.course) === k);
    }).length;
    const boardInt = (board.internTees || []).length - ghost;   // 실제 팀을 맡은 인턴만 근무선을 깎는다
    chk(work === teams - boardInt, `${p}부 — 실제 근무선 ${work}, 팀 ${teams}−인턴 ${boardInt}=${teams - boardInt} (예상 전용 인턴 ${ghost}칸이 새어 들어갔다)`);
    console.log(`  ${p}부 — 팀 ${teams} · 배치표 인턴 ${boardInt} · 근무선 ${work}${ghost ? ` (예상 전용 인턴 ${ghost}칸은 무시됨 ✓)` : ''}`);
  }
}

// ── 확인용 ── PROBE=3:17:00:OUT 이면 그 칸을 인턴으로 찍었을 때의 전/후를 표로 찍는다.
//  '왜 이렇게 움직이냐'는 질문에 말로 답하지 않기 위해서다. 화면과 같은 코드가 답한다.
if (process.env.PROBE) {
  const [pp, hh, mm, cc] = String(process.env.PROBE).split(':');
  doc._ids.vReal._ev.click();
  const before = readGrid(pp).filter((x) => !x.intern);
  const sp0 = readSpares(pp).map((x) => x.name);
  clickMode('intern');
  clickCell(cellOf(pp, `${hh}:${mm}`, cc));
  clickMode('intern');
  const after = readGrid(pp).filter((x) => !x.intern);
  const sp1 = readSpares(pp).map((x) => x.name);
  console.log(`\n[확인] ${pp}부 실제 배치표 — ${hh}:${mm} ${cc}를 인턴으로\n`);
  const byName = new Map(after.map((x) => [x.name, x.slot]));
  for (const b of before) {
    const to = byName.get(b.name);
    console.log(`  ${String(b.pos).padStart(2)}번 ${b.name.padEnd(10)} ${b.slot.padEnd(10)} → ${to || '스페어로 내려감'}`);
  }
  const dropped = sp1.filter((n) => !sp0.includes(n));
  console.log(`  근무선 ${before.length} → ${after.length}${dropped.length ? ` · 스페어로: ${dropped.join(', ')}` : ''}`);
  doc._ids.undoBtn._ev.click();
}

// ── ⑦ 칸의 출처가 색으로 구분돼야 한다 ──────────────────────────────────
//  이 화면의 존재 이유가 '두 경로 대조'다. 그린 직후 paint()가 className을 밀어버려
//  사진이 읽은 칸과 카카오가 찼다고 본 칸이 똑같이 보이던 적이 있다.
if (HAS_KAKAO) {
  console.log('\n칸 출처 구분\n');
  const K2 = (t, c) => t.replace(/^(\d):/, '0$1:') + '|' + (/IN/i.test(c) ? 'IN' : 'OUT');
  for (const VIEW of ['proj', 'real']) {
    doc._ids[VIEW === 'real' ? 'vReal' : 'vProj']._ev.click();
    for (const p of ['1', '2', '3']) {
      const real = new Set((J.parts[p]?.teeGrid || []).map((g) => K2(g.time, g.course)));
      (J.parts[p]?.internTees || []).forEach((t) => real.add(K2(t.time, t.course)));
      if (!real.size) continue;
      let fresh = 0, boardOnly = 0, wrong = 0;
      for (const td of doc.querySelectorAll('td.c[data-p="' + p + '"]')) {
        const cls = String(td._cls || '');
        if (cls.includes('empty') || cls.includes('intern') || cls.includes('open') || cls.includes('idle')) continue;
        if (!cls.includes('ok') && !cls.includes('board-only')) continue;
        const inReal = real.has(K2(td.dataset.t, td.dataset.c));
        if (cls.includes('fresh')) { fresh++; if (inReal) wrong++; }
        else if (cls.includes('board-only')) { boardOnly++; }
        else if (!inReal) wrong++;      // 카카오만인데 fresh 표시가 없다 = 구분 안 됨
      }
      chk(wrong === 0, `[${VIEW}] ${p}부 — 출처 표시가 틀린 칸 ${wrong}개`);
      if (VIEW === 'real') chk(fresh === 0, `[${VIEW}] ${p}부 — 실제 배치표인데 '새로 찬 칸(＋)'이 ${fresh}개 남아 있다`);
      console.log(`  [${VIEW === 'real' ? '실제' : '예상'}] ${p}부 — 카카오만 ${fresh} · 배치표만 ${boardOnly}`);
    }
  }
}
function x_cls(td) { return td._cls || ''; }

// ── ⑥ 저장하면 '저장 버튼이 사라진다' ────────────────────────────────────
//  저장 버튼이 남아 있으면 관리자는 저장이 안 됐다고 읽는다. 실제로 예상 보기에서 저장하면
//  기준선이 실제 축과 어긋나 버튼이 계속 남았다 — 어느 보기에서 저장하든 사라져야 한다.
console.log('\n저장 후 상태\n');
for (const VIEW of (HAS_KAKAO ? ['real', 'proj'] : ['real'])) {
  doc._ids[VIEW === 'real' ? 'vReal' : 'vProj']._ev.click();
  const p = ['3', '2', '1'].find((x) => readGrid(x).filter((y) => !y.intern).length) || '3';
  const g = readGrid(p).filter((x) => !x.intern);
  const [t, c] = g[Math.floor(g.length / 2)].slot.split(' ');
  clickMode('intern');
  clickCell(cellOf(p, t, c));
  clickMode('intern');
  chk(doc._ids.saveBtn.hidden === false, `[${VIEW}] 바꿨는데 저장 버튼이 안 보인다`);
  globalThis.__SENT.length = 0;
  await doc._ids.saveBtn._ev.click();
  // ★카카오 예상은 따로 도는 엔진이다(사용자 확정). 예상 격자가 본배치표로 새어나가면
  //  카카오가 찼다고 본 칸이 '팀'이 되어 커트가 올라가고 앱이 없는 근무를 보여준다.
  //  저장한 팀 수는 어느 보기에서 눌렀든 '실제 배치표의 팀 수'여야 한다.
  // ★'테스트판에 저장'은 앱을 절대 안 만진다. 앱으로 넘기는 건 '앱에 반영' 버튼뿐이다.
  const LIVE_APIS = ['/api/board-correct', '/api/admin/intern-tees', '/api/board-notify', '/api/simulate'];
  for (const s of globalThis.__SENT) {
    chk(!LIVE_APIS.some((a) => s.url.endsWith(a)), `[${VIEW}] 저장이 앱 데이터를 만지는 ${s.url}을 불렀다`);
  }
  const sent = globalThis.__SENT.filter((x) => x.url.endsWith('/api/daejo-save'));
  chk(sent.length === 1, `[${VIEW}] 테스트판 저장이 ${sent.length}번 불렸다(1번이어야)`);
  const realTeams = (J.parts[p].teeGrid || []).length;   // 사진이 읽은 팀 수(인턴 지정 전)
  for (const s of sent) {
    for (const [pt, v] of Object.entries(s.body.parts || {})) {
      const teams = (v.teeGrid || []).length;
      if (pt === p) chk(teams <= realTeams, `[${VIEW}] ${pt}부 — 실제 ${realTeams}팀인데 ${teams}팀을 저장했다(예상 격자가 샜다)`);
      chk(v.cut === teams, `[${VIEW}] ${pt}부 — 커트(${v.cut})와 보낸 팀 수(${teams})가 다르다`);
    }
  }
  chk(doc._ids.saveBtn.hidden === true, `[${VIEW}] 저장했는데 저장 버튼이 안 사라진다`);
  chk(doc._ids.undoBtn.hidden === true, `[${VIEW}] 저장했는데 되돌리기 버튼이 남아 있다`);
  chk(/저장됐습니다/.test(doc._ids.state.textContent), `[${VIEW}] 저장 완료 문구가 안 뜬다`);
  console.log(`  [${VIEW === 'real' ? '실제 배치표' : '카카오 예상'}] 저장 → 버튼 사라짐 확인`);
}

console.log('');
console.log(fails ? `★ 실패 ${fails}건` : '★ 전부 통과');
process.exit(fails ? 1 : 0);
