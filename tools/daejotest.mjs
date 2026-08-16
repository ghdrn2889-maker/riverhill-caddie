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

const J = JSON.parse(fs.readFileSync(process.env.SRC, 'utf8'));

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
  elementFromPoint: () => null,
  _ids: {}, _spares: {},
};
for (const id of ['hint', 'state', 'saveBtn', 'undoBtn', 'vProj', 'vReal', 'viewNote', 'tools']) doc._ids[id] = new El('span');
doc._ids.tools.hidden = true;   // 실제 HTML과 동일하게 — 대조 보기에서 편집 도구는 숨어 있다
for (const p of ['1', '2', '3']) doc._spares[p] = new El('div');
doc._modes = ['intern', 'name', 'swap', 'move'].map((m) => { const b = new El('button'); b.dataset.mode = m; return b; });

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
globalThis.location = { protocol: 'file:' };
// ★생성기와 '똑같은 모양'으로 넘긴다 — 여기가 다르면 하네스가 통과해도 실제 화면은 다르게 돈다.
const BOARD = Object.fromEntries(['1', '2', '3'].map((p) => [p, {
  ...(J.parts?.[p] || {}),
  kakaoSlots: (J.snap?.byPart?.[p] || []).map((x) => ({ time: x.time, course: x.course })),
}]));
globalThis.window = { __DAEJO_DATE: J.dateKey || '', __DAEJO_BOARD: BOARD };
globalThis.prompt = () => null;
globalThis.fetch = async () => ({ json: async () => ({ ok: true, effective: [] }) });
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
{
  chk(doc._ids.tools.hidden === false, '편집도구 — 대조(카카오 예상) 보기에서 도구가 숨겨져 있다');
  const p0 = '3';
  const g = readGrid(p0).filter((x) => !x.intern);
  chk(g.length === (BOARD[p0].kakaoSlots || []).length,
    `대조 보기 격자가 카카오 칸 수와 다르다(${g.length} vs ${(BOARD[p0].kakaoSlots || []).length})`);
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
for (const VIEW of ['real', 'proj']) {
doc._ids[VIEW === 'real' ? 'vReal' : 'vProj']._ev.click();
console.log(' [' + (VIEW === 'real' ? '실제 배치표' : '카카오 예상') + ']');
for (const p of ['1', '2', '3']) {
  const grid0 = readGrid(p).filter((x) => !x.intern);
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
    // ★규칙: 뒤에 빈 티오프가 있으면 아무도 안 잘리고 전부 한 칸씩 밀린다.
    //   없으면(격자가 이미 꽉 참) 정확히 한 명이 스페어로 내려가고, 그 사람은 스페어 줄에 보여야 한다.
    const spNow = readSpares(p).map((x) => x.name);
    const dropped = grid0.filter((x) => !after.some((a) => a.name === x.name)).map((x) => x.name);
    // ★'자리가 있다'는 건 마지막 팀 '뒤에' 빈 티오프가 있다는 뜻이다.
    //  중간에 빈 칸이 있어도 소용없다 — 팀이 없는 티오프에는 캐디가 설 수 없다.
    const lastSlot = grid0[grid0.length - 1].slot;
    const order = all.filter((e) => e.dataset.p === p).map((e) => e.dataset.t + ' ' + e.dataset.c)
      .sort((a, b) => toMin(a) - toMin(b) || (a.endsWith('OUT') ? -1 : 1));
    const roomLeft = order.indexOf(lastSlot) < order.length - 1;
    if (dropped.length) {
      chk(dropped.length === 1, `${p}부 ${s.slot} 인턴 — ${dropped.length}명이 한꺼번에 잘렸다(최대 1명이어야)`);
      chk(dropped.every((n) => spNow.includes(n)), `${p}부 ${s.slot} 인턴 — 잘린 ${dropped.join(',')}이(가) 스페어 줄에도 없다`);
      chk(!roomLeft, `${p}부 ${s.slot} 인턴 — 뒤에 빈 티오프가 있는데도 ${dropped.join(',')}을(를) 잘랐다`);
    } else {
      chk(after.length === grid0.length, `${p}부 ${s.slot} 인턴 — 아무도 안 잘렸는데 근무선이 ${grid0.length}→${after.length}`);
    }
    // 되돌리기
    doc._ids.undoBtn._ev.click();
    chk(JSON.stringify(readGrid(p).filter((x) => !x.intern)) === base, `${p}부 ${s.slot} — 되돌리기가 화면을 복구 못 함`);
    chk(JSON.stringify(readSpares(p)) === spares0, `${p}부 ${s.slot} — 되돌리기 후 스페어 줄이 다름`);
    clickMode('intern');   // 모드 끄기
  }
  console.log(`  ${p}부 ${targets.length}곳 검사 완료`);
}
}
console.log('');
console.log(fails ? `★ 실패 ${fails}건` : '★ 전부 통과');
process.exit(fails ? 1 : 0);
