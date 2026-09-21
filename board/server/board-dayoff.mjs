// ══════════════════════════════════════════════════════════════
//  휴무 신청 — 경기과가 받아서 보는 곳
//
//  ★왜 장부가 배치표 서버에 있나.
//   보는 사람이 여기 있기 때문이다. 경기과는 내일 판을 이 프로그램에서 짠다.
//   신청을 보려고 딴 창을 또 열어야 하면 안 본다 — 그러면 카톡으로 돌아간다.
//
//  ★왜 '경기과가 대신 넣기'가 처음부터 있나.
//   지금 리버힐에는 휴무 신청 절차 자체가 없다(사람마다 다르게 한다).
//   그러니 이 기능은 있던 것을 대체하는 게 아니라 처음으로 절차를 세우는 것이고,
//   한동안은 카톡·구두와 같이 굴러간다. 앱을 안 쓰는 분이 손해를 보면 안 되고,
//   경기과가 두 군데를 봐야 하면 결국 아무 데도 안 본다 —
//   그래서 어느 길로 들어온 신청이든 이 한 장에 모이게 한다.
//   덤으로, 앱이 아직 없어도 이 페이지 혼자 쓸모가 있다.
//
//  ★승인이 곧 배지는 아직 아니다(2026-09-18).
//   앞날은 저장본이 아직 없을 때가 많아 여기서 배지를 붙일 데가 없다.
//   그래서 여기서는 '됐다'까지만 못 박고, 배치표 화면이 그 날을 열 때
//   승인된 휴무를 읽어 붙이게 한다 — 되돌리기가 듣는 자리에서 붙여야 한다.
// ══════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { return d; } };
const wr = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), 'utf-8'); fs.renameSync(t, f); };

const okKey = (s) => /^\d{8}$/.test(String(s || ''));
const todayKey = () => {
  const d = new Date();
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
};
// '20260924' → '9월 24일 (목)'
const WD = '일월화수목금토';
function dayText(k) {
  if (!okKey(k)) return k;
  const y = +k.slice(0, 4), m = +k.slice(4, 6), d = +k.slice(6);
  const w = new Date(y, m - 1, d).getDay();
  return `${m}월 ${d}일 (${WD[w]})`;
}
// 오늘로부터 며칠 뒤인가 — 급한 것이 위로 오게 쓴다
function daysAway(k) {
  if (!okKey(k)) return 9999;
  const t = todayKey();
  const a = new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6));
  const b = new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6));
  return Math.round((a - b) / 86400000);
}
// ★적어 둘 때는 협정시(toISOString)로 적고, 보여 줄 때 한국 시각으로 읽는다.
//   여태는 적어 둔 글자를 그대로 잘라 써서 아홉 시간이 어긋났다 — 13:20에 낸 것이
//   04:20으로 떴다. '누가 먼저 냈나'가 순서를 정하는 재료라 이게 틀리면 안 된다
const whenText = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ── 신청 종류 ──────────────────────────────────────────
// ★네 가지를 한 장에 모은다.
//  휴무·휴가·병가는 '그날 자리를 비우겠다'이고, 중복 근무는 '그날 자리를 더 받겠다'다.
//  정반대로 보이지만 같은 날 저울의 양쪽이다 — 사람이 모자라는 날에는 중복 근무를 받고
//  휴무를 막는다. 따로 두 장에 갈라 놓으면 그 저울을 못 본다.
//  다만 한 칸 안에서는 갈라 보여 준다. 섞어 세우면 어느 쪽이 몇인지 안 읽힌다.
//  색은 배치표 배지 그대로다 — 휴무 노랑 · 휴가 연녹 · 병가 녹차 · 중복 하늘
//  ★더 서겠다는 신청은 '중복 근무' 한 덩어리로 받지 않는다.
//   배치표에는 54 · 1,3 · 2,3 이 저마다 다른 배지로 서 있다 — 뜻도 자리도 다르다.
//   '중복 근무 2명'이라고만 적으면 경기과는 그 둘이 어느 부를 서겠다는 건지 모른 채
//   눌러야 한다. 캐디는 제가 어느 부를 설 수 있는지 알고 낸다 — 그대로 받는다.
//   적는 꼴도 배치표 배지 그대로다('1,3'). 여기서만 '1·3'이라 적으면 두 화면이 딴말을 한다
// ★열 가지, 세 갈래다. 가름은 '그날 근무를 하느냐'다.
//  rest 안 함 · work 함 · free 본인이 정함.
//  조출·후출·찾근은 나가는 때와 순번이 다를 뿐 그날 일하는 것은 같다 — work 다.
//  프리만 어느 쪽도 아니다. 하든 안 하든 본인이 정하는 것이라 따로 세운다.
// ★mat 은 옆에 놓을 잣대다. '이 달 며칠 쉼'(rest)이나 '몇 번 더 섬'(dup)이나,
//  둘 다 아니면 빈 값 — 조출·후출·찾근·프리는 저장된 판에서 셀 수 있는 잣대가 없다.
//  없는 잣대를 0으로 적으면 '한 번도 안 했다'는 거짓말이 된다.
// ★pool 은 사람 수를 세는 장부 이름이다. 쉼 셋과 일 셋은 각각 한 장부에 모아 센다 —
//  그날 몇이 빠지고 몇이 더 서느냐가 궁금한 것이지 휴무인지 병가인지는 셈에 상관없다.
//  나머지 넷은 따로 센다. 조출과 후출은 방향이 반대라 합쳐 세면 뜻이 없다.
// ★적는 꼴은 배치표 배지 그대로다('1,3'). 앱 화면만 '1·3'으로 곱게 적는다.
export const KINDS = [
  { k: '휴무',  cls: 'r',   grp: 'rest', mat: 'rest', pool: 'rest', away: true,  tx: '휴무' },
  { k: '휴가',  cls: 'v',   grp: 'rest', mat: 'rest', pool: 'rest', away: true,  tx: '휴가' },
  { k: '병가',  cls: 's',   grp: 'rest', mat: 'rest', pool: 'rest', away: true,  tx: '병가' },
  { k: '54',   cls: 'd54', grp: 'work', mat: 'dup',  pool: 'more', away: false, tx: '54',   sub: '1 · 2 · 3부 다' },
  { k: '1,3',  cls: 'd13', grp: 'work', mat: 'dup',  pool: 'more', away: false, tx: '1,3',  sub: '1부와 3부' },
  { k: '2,3',  cls: 'd23', grp: 'work', mat: 'dup',  pool: 'more', away: false, tx: '2,3',  sub: '2부와 3부' },
  { k: '조출',  cls: 'jo',  grp: 'work', mat: '',     pool: '조출', away: false, tx: '조출', sub: '앞으로 당겨 일찍' },
  { k: '후출',  cls: 'hu',  grp: 'work', mat: '',     pool: '후출', away: false, tx: '후출', sub: '뒤로 미뤄 늦게' },
  { k: '찾근',  cls: 'cg',  grp: 'work', mat: '',     pool: '찾근', away: false, tx: '찾근', sub: '순번을 직접 고름' },
  { k: '프리',  cls: 'pr',  grp: 'free', mat: '',     pool: '프리', away: false, tx: '프리', sub: '순번에 안 섬' },
];
const KIND = {};
KINDS.forEach((x) => { KIND[x.k] = x; });
// 옛 신청에는 종류가 없다 — 그때는 휴무뿐이었다
const normKind = (v) => (KIND[String(v || '').trim()] ? String(v).trim() : '휴무');
const kindOf = (r) => KIND[normKind(r.kind)];
// 받침이 있으면 '을', 없으면 '를'. '을(를)'이라 적어 두면 사람이 쓴 글로 안 읽힌다
function eul(w) {
  const c = String(w || '').trim().slice(-1).charCodeAt(0);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return '를';
  return ((c - 0xac00) % 28) ? '을' : '를';
}

// ── 장부 ──────────────────────────────────────────────
function file(DATA) { return path.join(DATA, 'dayoff.json'); }
export function readBook(DATA) {
  const o = rd(file(DATA), null);
  return (o && Array.isArray(o.list)) ? o : { seq: 0, list: [] };
}
function writeBook(DATA, o) { wr(file(DATA), o); }

// 신청 하나를 넣는다.
// ★같은 사람이 같은 날에 또 내면 안 받는다 — 종류가 달라도 안 받는다.
//  쉬겠다와 더 서겠다를 같은 날에 같이 내면 둘이 서로를 부정한다.
//  마음이 바뀌었으면 낸 것을 물리고 새로 내야 한다(경기과가 지워 준다)
export function addRequest(DATA, { name, date, why, by, kind }) {
  const nm = String(name || '').trim().slice(0, 20);
  const dt = String(date || '').trim();
  if (!nm) return { ok: false, error: '이름을 적으십시오' };
  if (!okKey(dt)) return { ok: false, error: '날짜가 이상합니다' };
  const kd = normKind(kind);
  const book = readBook(DATA);
  const dup = book.list.find((x) => x.name === nm && x.date === dt && x.state !== 'no');
  if (dup) {
    const was = KIND[normKind(dup.kind)].tx;
    // ★뒷말은 부르는 쪽에 맞춘다 — 경기과 화면엔 '지우기' 단추가 있고 앱엔 '무르기'가 있다.
    //  없는 단추 이름을 대면 사람은 그 단추를 찾다가 못 찾는다.
    const undo = String(by || '').startsWith('앱') ? '무르세요' : '지우십시오';
    return { ok: false, error: `${nm} 님은 ${dayText(dt)}에 이미 ${was}${eul(was)} 내셨습니다`
      + (normKind(dup.kind) === kd ? '' : ` — 바꾸시려면 낸 것을 먼저 ${undo}`) };
  }
  const rec = {
    id: ++book.seq, name: nm, date: dt, kind: kd,
    why: String(why || '').trim().slice(0, 60),
    at: new Date().toISOString(), by: String(by || '앱'),
    state: 'wait', doneAt: '', doneBy: '', note: '',
  };
  book.list.push(rec);
  writeBook(DATA, book);
  return { ok: true, rec };
}

// 됐다 / 안 된다를 못 박는다. 까닭 없는 반려는 받지 않는다 —
// 말없이 '안 됨'만 뜨면 사람이 상한다
export function decide(DATA, id, state, note, whoName) {
  if (state !== 'ok' && state !== 'no' && state !== 'wait') return { ok: false, error: '알 수 없는 답입니다' };
  const book = readBook(DATA);
  const rec = book.list.find((x) => String(x.id) === String(id));
  if (!rec) return { ok: false, error: '그런 신청이 없습니다' };
  const why = String(note || '').trim().slice(0, 60);
  if (state === 'no' && !why) return { ok: false, error: '안 되는 까닭을 한 줄 적어 주십시오' };
  rec.state = state;
  rec.note = (state === 'wait') ? '' : why;
  rec.doneAt = (state === 'wait') ? '' : new Date().toISOString();
  rec.doneBy = (state === 'wait') ? '' : String(whoName || '');
  writeBook(DATA, book);
  return { ok: true, rec };
}

export function delRequest(DATA, id) {
  const book = readBook(DATA);
  const i = book.list.findIndex((x) => String(x.id) === String(id));
  if (i < 0) return { ok: false, error: '그런 신청이 없습니다' };
  const [gone] = book.list.splice(i, 1);
  writeBook(DATA, book);
  return { ok: true, rec: gone };
}

// ══ 앱이 묻는 문 ════════════════════════════════════════════
//  ★앱에는 그 사람 것만 나간다. 장부를 통째로 넘기면 남의 병가 까닭까지 폰에 실린다.
//   이름은 앱 서버가 로그인에서 꺼내 붙인다 — 폰이 제 이름을 말하게 두면
//   아무 이름이나 적어 남의 휴무를 낼 수 있다.
export function mineOf(DATA, name) {
  const nm = String(name || '').trim();
  if (!nm) return [];
  return readBook(DATA).list
    .filter((x) => x.name === nm)
    .map((x) => ({
      id: x.id, date: x.date, kind: normKind(x.kind), why: x.why,
      at: x.at, state: x.state, note: x.note || '', doneAt: x.doneAt || '',
    }))
    // ★차례는 '다가오는 것부터'다. 날짜 내림차순으로 두면 두 달 뒤 휴가가 맨 위에 서고
    //  당장 모레 일이 밑으로 밀린다. 앞날은 가까운 것부터, 지난 것은 최근 것부터.
    .sort((a, b) => {
      const t = todayKey();
      const fa = a.date >= t, fb = b.date >= t;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? (a.date < b.date ? -1 : 1) : (a.date > b.date ? -1 : 1);
    });
}

// 낸 사람이 무른다 — 제 것만, 아직 안 정해진 것만.
// ★정해진 것까지 앱에서 지우게 두면 경기과 장부와 앱이 서로 다른 말을 하게 된다.
//  경기과가 '됐습니다' 해 놓고 배치표를 그렇게 짰는데 그 자리가 소리 없이 사라진다.
export function cancelOwn(DATA, id, name) {
  const nm = String(name || '').trim();
  const book = readBook(DATA);
  const i = book.list.findIndex((x) => String(x.id) === String(id));
  if (i < 0) return { ok: false, error: '그런 신청이 없습니다' };
  const r = book.list[i];
  if (r.name !== nm) return { ok: false, error: '남의 신청은 무를 수 없습니다' };
  if (r.state !== 'wait') return { ok: false, error: '이미 정해진 신청은 무를 수 없습니다' };
  const [gone] = book.list.splice(i, 1);
  writeBook(DATA, book);
  return { ok: true, rec: gone };
}

// 그 사람의 이 달 재료 — 경기과가 정할 때 보는 것과 똑같은 숫자를 앱에도 준다.
// ★보여 줄지 말지는 화면이 정한다. 여기서는 숨기지 않는다 —
//  경기과만 아는 잣대로 정해지면, 안 된 사람은 왜 안 됐는지 영영 모른다.
export function matOf(DATA, name, month) {
  const c = counts(DATA, month);
  const nm = String(name || '').trim();
  return { rest: c.rest[nm] || 0, dup: c.dup[nm] || 0, days: c.days };
}

// 그 달, 날마다 갈래별로 몇 건이 들어와 있나 — 앱 달력의 칸 밑 숫자가 이것이다.
// ★'남이 낸 수'를 준다(제 이름은 뺀다). 내 것은 앱이 제 장부로 이미 알고 있어서
//  여기서 같이 세어 주면 한 사람이 두 번 세어진다.
// ★기다리는 것(wait)과 된 것(ok)을 같이 센다 — 둘 다 '그날 그러겠다고 낸 것'이다.
//  안 된 것(no)만 뺀다. 그건 그날 아무 자리도 차지하지 않는다.
export function tallyOf(DATA, month, exceptName) {
  const nm = String(exceptName || '').trim();
  const mo = String(month || '').trim();
  const out = {};
  for (const x of readBook(DATA).list) {
    if (x.state === 'no') continue;
    if (nm && x.name === nm) continue;
    if (mo && String(x.date).slice(0, 6) !== mo) continue;
    const p = KIND[normKind(x.kind)].pool;
    if (!out[x.date]) out[x.date] = {};
    out[x.date][p] = (out[x.date][p] || 0) + 1;
  }
  return out;
}

// 배치표 화면이 묻는다 — "이 날 무엇이 됐습니까"
// ★이름만 주면 안 된다. 배치표가 붙일 배지가 종류마다 다르다 —
//  휴무는 자리를 비우고, 중복 근무는 자리를 더 준다. 정반대로 움직인다
export function approvedOn(DATA, date) {
  return readBook(DATA).list
    .filter((x) => x.date === date && x.state === 'ok')
    .map((x) => ({ name: x.name, kind: normKind(x.kind) }));
}

// ── 경기과가 정할 때 쓸 재료 ─────────────────────────────
// ★같은 날에 여럿이 내면 누구를 받을지 경기과가 골라야 한다.
//  먼저 누른 사람이 가져가는 구조로 두면 앱을 자주 보는 사람이 유리해진다 —
//  그건 공정한 게 아니다. 그래서 '이번 달에 몇 번 쉬었나'를 옆에 놓는다.
//  저장된 날에서 세는 값이라, 프로그램을 쓰기 시작한 뒤부터만 센다 —
//  몇 일치로 센 값인지를 같이 내보내 화면이 정직하게 적게 한다
//  ★재료가 둘이다. 쉬겠다는 신청에는 '이 달 며칠 쉬었나'를, 더 서겠다는 신청에는
//   '이 달 몇 번 더 섰나'를 놓는다. 둘 다 '덜 받은 사람'을 찾는 데 쓰는 같은 잣대다 —
//   덜 쉰 사람에게 휴무를, 덜 번 사람에게 중복 근무를 주면 그게 공평한 것이다
export function counts(DATA, month) {
  const dir = path.join(DATA, 'days');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (e) { return { rest: {}, dup: {}, days: 0 }; }
  const keys = files.map((f) => f.slice(0, -5)).filter((k) => okKey(k) && k.slice(0, 6) === month);
  const rest = {}, dup = {};
  for (const k of keys) {
    const rec = rd(path.join(dir, k + '.json'), null);
    if (!rec || typeof rec.s !== 'string') continue;
    let st = null;
    try { st = JSON.parse(rec.s); } catch (e) { continue; }
    const tag = (st && st.tag) || {};
    for (const nm of Object.keys(tag)) {
      if (tag[nm] === '휴무' || tag[nm] === '휴가' || tag[nm] === '병가') rest[nm] = (rest[nm] || 0) + 1;
    }
    // 그날 두 부 이상에 이름이 서 있으면 중복 근무를 한 것이다.
    // 인턴 줄은 빼고 센다 — 인턴은 순번을 쓰지 않는다
    const seen = {};
    for (const p of (st && st.day) || []) {
      const mine = {};
      for (const r of (p && p.roster) || []) if (r && r.n && !r.itn) mine[r.n] = 1;
      for (const nm of Object.keys(mine)) seen[nm] = (seen[nm] || 0) + 1;
    }
    for (const nm of Object.keys(seen)) if (seen[nm] >= 2) dup[nm] = (dup[nm] || 0) + 1;
  }
  return { rest, dup, days: keys.length };
}

// 명부와 조 — 설정에 들어 있다. 없으면 빈 손으로 돌아간다(페이지는 그래도 돈다)
export function rosterOf(DATA) {
  const c = rd(path.join(DATA, 'cfg.json'), null);
  if (!c || typeof c.s !== 'string') return { names: [], jo: {}, label: [] };
  let o = null;
  try { o = JSON.parse(c.s); } catch (e) { return { names: [], jo: {}, label: [] }; }
  return { names: o.jonames || [], jo: o.jomap || {}, label: o.jolab || [] };
}

// ── 화면 ──────────────────────────────────────────────
// ★배치표와 한 벌로 보인다. 색·글꼴·부품을 배치표에서 그대로 가져온다.
//
// ★종류마다 제 페이지를 가진다(2026-09-18).
//  한 장에 여섯 칸을 세워도 봤는데, 한 종류를 들여다볼 때 딴 종류가 계속 끼어든다.
//  휴무를 정하는 일과 54를 정하는 일은 보는 것도 정하는 잣대도 다르다 —
//  그래서 종류마다 제 페이지를 주고, 그 페이지 안에 그 종류의 모든 것을 담는다:
//  기다리는 신청 · 그 종류로 대신 넣기 · 그 종류로 정해진 것.
//  ★'전체'는 남긴다. 페이지를 갈라 놓으면 '지금 안 보이는 데 뭐가 있나'를 사람이
//   확신하지 못한다 — 여섯을 한눈에 보는 자리가 하나는 있어야 그 의심이 없다
const CSS = `
:root{
  --paper:#dfe3e8; --card:#fff; --ink:#111820; --sub:#4d5966; --dim:#7d8894;
  --line:#c9d1da; --line2:#e4e9ee;
  --go:#14549c; --go-d:#0f4680; --goSoft:#e8f0fa;
  --no:#a33b3b; --noSoft:#fbecec;
  --cut:#a2540b; --cutSoft:#fdf2e2;
  --cru:#ffe066; --crui:#5a4200;
  --tjo:#e0f3e6; --tjoi:#106b3f;
  --cbg:#d9e8c3; --cbgi:#3d5a1f;
  --c54:#ddf2b4; --c54i:#3d640f;
  --c13:#ff4fc1; --c13i:#4d0026;
  --c23:#cbeafd; --c23i:#0c4a73;
  /* 조출·후출·찾근·프리 — 배치표(tpl6_head.html)의 --cjo/--chu/--ccg/--cpr 과 같은 값.
     한 벌로 두어야 배치표와 이 화면이 같은 색으로 같은 말을 한다 */
  --cjo:#ffcb9a; --cjoi:#8f3f00;
  --chu:#9ed8ff; --chui:#03446e;
  --ccg:#d2da55; --ccgi:#3d4708;
  --cpr:#d8e13f; --cpri:#3b4300;
  --cet:#eaeef2; --ceti:#5a6874;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;
  -webkit-font-smoothing:antialiased;font-size:16px;line-height:1.45}
button,input{font-family:inherit}
.num{font-variant-numeric:tabular-nums;letter-spacing:-.01em}
a{color:var(--go)}

.hd{background:#eef2f6;border-bottom:1.5px solid #b9c3ce;position:sticky;top:0;z-index:5}
.hd .top{display:flex;align-items:center;gap:8px 10px;padding:8px 16px;flex-wrap:wrap}
.hd .d b{font-size:16.5px;font-weight:900;letter-spacing:-.045em;display:block;line-height:1.2}
.hd .d span{font-size:10.5px;font-weight:820;color:var(--dim)}
.hd .rt{margin-left:auto;display:flex;gap:6px;align-items:center}
.hbtn{border:1px solid #b9c3ce;background:#fff;border-radius:8px;padding:8px 12px;font-size:12.5px;
  font-weight:870;color:var(--sub);cursor:pointer;letter-spacing:-.03em;text-decoration:none;
  display:inline-block}
.hbtn:hover{border-color:var(--go);color:var(--go)}
.hd .who{font-size:10.5px;font-weight:840;color:var(--dim)}

/* ── 페이지 넘기개 — 종류마다 제 페이지다 ── */
.tabs{display:flex;gap:0;padding:0 16px;background:#eef2f6;overflow-x:auto;white-space:nowrap}
.tabs a{position:relative;display:flex;align-items:center;gap:6px;padding:9px 14px 8px;
  font-size:12.5px;font-weight:870;color:var(--sub);text-decoration:none;letter-spacing:-.03em;
  border:1px solid transparent;border-bottom:0;border-radius:9px 9px 0 0;top:1.5px}
.tabs a .n{font-size:10.5px;font-weight:900;border-radius:9px;padding:1px 6px;
  background:#dde4ea;color:var(--sub);font-variant-numeric:tabular-nums}
.tabs a .n.hot{background:var(--cut);color:#fff}
.tabs a:hover{color:var(--go)}
.tabs a.on{background:var(--paper);border-color:#b9c3ce;color:var(--ink);
  border-bottom:1.5px solid var(--paper)}
.tabs a .dot{width:9px;height:9px;border-radius:3px;flex:0 0 auto}
.dot.r{background:var(--cru)} .dot.v{background:var(--tjo)} .dot.s{background:var(--cbg)}
.dot.d54{background:var(--c54)} .dot.d13{background:var(--c13)} .dot.d23{background:var(--c23)}
/* 조출·후출·찾근·프리 — 배치표 배지 색 그대로다 */
.dot.jo{background:var(--cjo)} .dot.hu{background:var(--chu)}
.dot.cg{background:var(--ccg)} .dot.pr{background:var(--cpr)}

.wrap{max-width:1680px;margin:0 auto;padding:14px 16px 40px}
.note{margin:0 0 12px;padding:9px 12px;border-radius:9px;font-size:12.5px;font-weight:840;
  letter-spacing:-.03em}
.note.ok{background:var(--goSoft);border:1px solid #b9cfe8;color:var(--go)}
.note.bad{background:var(--noSoft);border:1px solid #e2bcbc;color:var(--no)}
.say{margin:0 0 12px;font-size:12px;font-weight:790;color:var(--dim);line-height:1.65}
.say b{color:var(--sub)}

/* ── 그 종류의 큰 머리 ── */
.khero{display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);
  border-left:5px solid var(--line);border-radius:11px;padding:12px 15px;margin:0 0 12px}
.khero .tag{font-size:17px;font-weight:900;border-radius:8px;padding:5px 13px;letter-spacing:-.03em}
.khero .tt b{display:block;font-size:13px;font-weight:880;letter-spacing:-.04em}
.khero .tt span{font-size:11px;font-weight:800;color:var(--dim)}
.khero .n{margin-left:auto;text-align:right}
.khero .n i{font-style:normal;display:block;font-size:20px;font-weight:900;
  font-variant-numeric:tabular-nums;line-height:1.1}
.khero .n em{font-style:normal;font-size:10.5px;font-weight:840;color:var(--dim)}
.k-r .khero{border-left-color:#d9b93c}  .khero .tag.r{background:var(--cru);color:var(--crui)}
.k-v .khero{border-left-color:#9ccfaf}  .khero .tag.v{background:var(--tjo);color:var(--tjoi)}
.k-s .khero{border-left-color:#a9c48a}  .khero .tag.s{background:var(--cbg);color:var(--cbgi)}
.k-d54 .khero{border-left-color:#a9cf6e} .khero .tag.d54{background:var(--c54);color:var(--c54i)}
.k-d13 .khero{border-left-color:#ff4fc1} .khero .tag.d13{background:var(--c13);color:#fff}
.k-d23 .khero{border-left-color:#8cc6e8} .khero .tag.d23{background:var(--c23);color:var(--c23i)}
.k-jo .khero{border-left-color:#e8a86a} .khero .tag.jo{background:var(--cjo);color:var(--cjoi)}
.k-hu .khero{border-left-color:#6fbdf0} .khero .tag.hu{background:var(--chu);color:var(--chui)}
.k-cg .khero{border-left-color:#b6bf3c} .khero .tag.cg{background:var(--ccg);color:var(--ccgi)}
.k-pr .khero{border-left-color:#bcc622} .khero .tag.pr{background:var(--cpr);color:var(--cpri)}

/* 한 종류 페이지 — 왼쪽은 정할 것, 오른쪽은 넣기와 지난 답 */
.two{display:grid;grid-template-columns:minmax(0,2.1fr) minmax(0,1fr);gap:14px;align-items:start}
@media(max-width:1080px){.two{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden}
.ph{display:flex;align-items:center;gap:7px;padding:8px 12px;background:#e6ecf2;
  border-bottom:1px solid #b9c3ce}
.ph b{font-size:12.5px;font-weight:900;letter-spacing:-.04em}
.ph .n{margin-left:auto;font-size:10.5px;font-weight:860;color:var(--sub)}
.pbody{padding:11px 12px}
.pnone{padding:20px 14px;text-align:center;font-size:12px;font-weight:820;color:var(--dim)}

/* 날짜 줄 */
.dh{display:flex;align-items:center;gap:7px;padding:6px 12px;background:#eef2f6;
  border-bottom:1px solid var(--line2);border-top:1px solid var(--line2)}
.dh:first-child{border-top:0}
.dh b{font-size:12px;font-weight:880;letter-spacing:-.04em}
.dh .away{font-size:10px;font-weight:860;color:#fff;background:var(--go);border-radius:5px;padding:1px 6px}
.dh .away.soon{background:var(--cut)}
.dh .away.past{background:var(--dim)}
.dh .cnt{margin-left:auto;font-size:10px;font-weight:850;color:var(--dim)}

.wrow{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line2);
  flex-wrap:wrap}
.wrow:last-child{border-bottom:0}
.wrow .nm{font-size:14px;font-weight:880;letter-spacing:-.04em;flex:0 0 auto}
.jo{font-size:10px;font-weight:850;color:var(--ceti);background:var(--cet);border-radius:4px;
  padding:1px 5px;flex:0 0 auto}
.rest{font-size:10.5px;font-weight:860;border-radius:5px;padding:2px 7px;flex:0 0 auto;
  background:var(--cet);color:var(--ceti)}
.rest.few{background:#e0f3e6;color:#106b3f}
.rest.many{background:var(--cutSoft);color:var(--cut)}
.why{flex:1 1 90px;min-width:0;font-size:12.5px;font-weight:800;color:var(--sub);letter-spacing:-.03em}
.why i{font-style:normal;color:#aab3bd}
.came{font-size:10.5px;font-weight:820;color:var(--dim);flex:0 0 auto;text-align:right;
  font-variant-numeric:tabular-nums}
.came em{font-style:normal;display:block;font-size:9.5px}
.act{flex:0 0 auto;display:flex;align-items:center;gap:5px}
.wrow .act form{display:contents}
.byes{background:var(--go);color:#fff;border:0;border-radius:8px;padding:8px 13px;
  font-size:12.5px;font-weight:870;letter-spacing:-.03em;cursor:pointer}
.byes:hover{background:var(--go-d)}
.nod{flex:0 0 auto}
.nod summary{list-style:none;border:1px solid #ddbcbc;background:#fff;color:var(--no);
  border-radius:8px;padding:8px 13px;font-size:12.5px;font-weight:870;letter-spacing:-.03em;
  cursor:pointer;user-select:none}
.nod summary::-webkit-details-marker{display:none}
.nod summary:hover{background:var(--noSoft)}
.nod[open] summary{background:var(--no);color:#fff;border-color:var(--no)}
.nofm{display:flex;gap:5px;flex-basis:100%;margin-top:8px;width:100%}
.nofm input{flex:1;min-width:0;padding:8px 10px;border:1.5px solid #ddbcbc;border-radius:8px;
  font-size:13px;font-weight:840;letter-spacing:-.03em;background:#fff;color:var(--ink)}
.nofm input:focus{outline:0;border-color:var(--no);background:var(--noSoft)}
.nofm button{background:var(--no);color:#fff;border:0;border-radius:8px;padding:8px 13px;
  font-size:12.5px;font-weight:870;cursor:pointer;flex:0 0 auto}

/* 넣기 — 한 종류 페이지에서는 세로로 선다 */
.addv{display:flex;flex-direction:column;gap:6px}
.addv input{padding:9px 10px;border:1.5px solid #c9d1da;border-radius:8px;font-size:13.5px;
  font-weight:850;background:#fff;letter-spacing:-.03em;color:var(--ink);width:100%}
.addv input:focus{outline:0;border-color:var(--go);background:var(--goSoft)}
.addv button{background:var(--go);color:#fff;border:0;border-radius:8px;padding:10px;
  font-size:13px;font-weight:870;cursor:pointer;margin-top:2px}
.hint{margin:7px 0 0;font-size:10.5px;font-weight:790;color:var(--dim);line-height:1.6}

/* 지난 답 — 한 종류 페이지의 옆 기둥 */
.drow{display:flex;align-items:center;gap:7px;padding:8px 12px;border-bottom:1px solid var(--line2);
  font-size:12px;font-weight:820}
.drow:last-child{border-bottom:0}
.drow .dt{font-variant-numeric:tabular-nums;color:var(--sub);flex:0 0 auto}
.drow .nm2{font-weight:880;flex:0 0 auto}
.drow .rs{margin-left:auto;flex:0 0 auto}
.drow .nt{flex:1 1 100%;font-size:10.5px;font-weight:790;color:var(--dim);margin-top:-2px}
.drow form{flex:0 0 auto}
.pill{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10.5px;font-weight:880}
.pill.ok{background:var(--goSoft);color:var(--go)}
.pill.no{background:var(--noSoft);color:var(--no);box-shadow:inset 0 0 0 1px #e2bcbc}
.undo{background:#fff;border:1px solid #b9c3ce;border-radius:7px;padding:4px 8px;
  font-size:10.5px;font-weight:850;color:var(--sub);cursor:pointer}
.undo:hover{border-color:var(--go);color:var(--go)}

/* ── 전체 보기 ── */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
/* 세 갈래가 된 뒤의 전체 보기. 좁은 창에서는 포개지 말고 줄을 바꾼다 */
.cols3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start}
@media (max-width:1100px){.cols3{grid-template-columns:1fr 1fr}}
@media (max-width:760px){.cols3{grid-template-columns:1fr}}
@media(max-width:1080px){.cols{grid-template-columns:1fr}}
.side{min-width:0}
.sidehd{display:flex;align-items:center;gap:7px;padding:6px 11px;margin:0 0 8px;
  border-radius:8px;border:1px solid var(--line);background:#eef2f6}
.sidehd b{font-size:12.5px;font-weight:900;letter-spacing:-.04em}
.sidehd .bar{width:3px;height:12px;border-radius:2px;background:var(--cru)}
.side.work .sidehd .bar{background:#4aa3d8}
.side.free .sidehd .bar{background:var(--cpr)}
.sidehd .n{margin-left:auto;font-size:10.5px;font-weight:870;color:var(--sub)}
.kbox{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden;
  margin:0 0 10px}
.kbox.none{background:#f7f9fb}
.kh{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);
  border-left:4px solid var(--line);text-decoration:none;color:inherit}
.kh:hover{background:var(--goSoft)}
.kh .tag{font-size:12.5px;font-weight:900;border-radius:6px;padding:3px 9px;letter-spacing:-.03em}
.kh .sub2{font-size:10.5px;font-weight:820;color:var(--dim)}
.kh .n{margin-left:auto;font-size:10.5px;font-weight:870;color:var(--sub)}
.kh .go2{font-size:10.5px;font-weight:860;color:var(--go)}
.kbox.none .kh{border-bottom-color:transparent}
.kbox.k-r .kh{border-left-color:#d9b93c}  .kh .tag.r{background:var(--cru);color:var(--crui)}
.kbox.k-v .kh{border-left-color:#9ccfaf}  .kh .tag.v{background:var(--tjo);color:var(--tjoi)}
.kbox.k-s .kh{border-left-color:#a9c48a}  .kh .tag.s{background:var(--cbg);color:var(--cbgi)}
.kbox.k-d54 .kh{border-left-color:#a9cf6e} .kh .tag.d54{background:var(--c54);color:var(--c54i)}
.kbox.k-d13 .kh{border-left-color:#ff4fc1} .kh .tag.d13{background:var(--c13);color:#fff}
.kbox.k-d23 .kh{border-left-color:#8cc6e8} .kh .tag.d23{background:var(--c23);color:var(--c23i)}
.kbox.k-jo .kh{border-left-color:#e8a86a} .kh .tag.jo{background:var(--cjo);color:var(--cjoi)}
.kbox.k-hu .kh{border-left-color:#6fbdf0} .kh .tag.hu{background:var(--chu);color:var(--chui)}
.kbox.k-cg .kh{border-left-color:#b6bf3c} .kh .tag.cg{background:var(--ccg);color:var(--ccgi)}
.kbox.k-pr .kh{border-left-color:#bcc622} .kh .tag.pr{background:var(--cpr);color:var(--cpri)}
.kempty{padding:11px 14px;font-size:11.5px;font-weight:800;color:var(--dim)}
.foot{margin:22px 0 0;color:var(--dim);font-size:11px;font-weight:780;line-height:1.7}
`;

const JS = `
/* 까닭 칸은 '안 됩니다'를 눌렀을 때만 나온다. 열면 바로 글칸에 손이 가 있게 한다 */
document.addEventListener('toggle', function(e){
  var d = e.target;
  if (!d.classList || !d.classList.contains('nod')) return;
  var row = d.closest('.wrow'), fm = row && row.querySelector('.nofm');
  if (!fm) return;
  fm.hidden = !d.open;
  if (d.open) { var i = fm.querySelector('input[name=note]'); if (i) i.focus(); }
}, true);
`;

export function dayoffPage(DATA, me, msg, bad, showDone, esc, BASE, only) {
  const book = readBook(DATA);
  const { names, jo, label } = rosterOf(DATA);
  const cnt = counts(DATA, todayKey().slice(0, 6));
  const byCls = {};
  KINDS.forEach((x) => { byCls[x.cls] = x; });
  const kd = byCls[String(only || '').trim()] || null;      // 없으면 전체 보기
  const joText = (nm) => {
    const g = jo[nm];
    return (g === undefined || g === null || g < 0) ? '' : (label[g] || (g + 1) + '조');
  };
  const url = (c) => `${BASE}/dayoff${c ? '?k=' + c : ''}`;

  const wait = book.list.filter((x) => x.state === 'wait');
  const nOf = (k) => wait.filter((x) => normKind(x.kind) === k).length;
  const byDate = (a, b) => {
    const da = daysAway(a.date), db = daysAway(b.date);
    if ((da < 0) !== (db < 0)) return da < 0 ? 1 : -1;
    return da !== db ? da - db : String(a.at).localeCompare(String(b.at));
  };

  const matChip = (r) => {
    // ★잣대가 없는 종류에는 아무것도 안 붙인다. 조출·후출·찾근·프리는 저장된 판에서
    //  셀 수 있는 값이 없다 — 0을 적으면 '한 번도 안 했다'는 거짓말이 된다.
    const m = kindOf(r).mat;
    if (!cnt.days || !m) return '';
    const n = (m === 'rest' ? cnt.rest[r.name] : cnt.dup[r.name]) || 0;
    const tx = m === 'rest' ? `이 달 ${n}일 쉼` : `이 달 ${n}번 더 섬`;
    return `<span class="rest${n === 0 ? ' few' : (n >= 4 ? ' many' : '')}">${tx}</span>`;
  };

  const row = (r) => `<div class="wrow">
  <span class="nm">${esc(r.name)}</span>
  ${joText(r.name) ? `<span class="jo">${esc(joText(r.name))}</span>` : ''}
  ${matChip(r)}
  <span class="why">${r.why ? esc(r.why) : '<i>까닭 안 적음</i>'}</span>
  <span class="came num">${esc(whenText(r.at))}<em>${esc(r.by)}</em></span>
  <span class="act">
    <form method="POST"><input type="hidden" name="act" value="ok"><input type="hidden" name="id" value="${r.id}">
      <button class="byes">됩니다</button></form>
    <details class="nod"><summary>안 됩니다</summary></details>
  </span>
  <form method="POST" class="nofm" hidden>
    <input type="hidden" name="act" value="no"><input type="hidden" name="id" value="${r.id}">
    <input name="note" placeholder="안 되는 까닭을 한 줄 — 신청하신 분께 그대로 갑니다" required autocomplete="off" maxlength="60">
    <button type="submit">이 까닭으로 알리기</button>
  </form>
</div>`;

  // 날짜로 묶어 세운다
  const dated = (rows) => {
    const gs = [];
    rows.slice().sort(byDate).forEach((r) => {
      const last = gs[gs.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else gs.push({ date: r.date, rows: [r] });
    });
    return gs.map((g) => {
      const a = daysAway(g.date);
      const when = a < 0 ? '지난 날' : a === 0 ? '오늘' : a === 1 ? '내일' : `${a}일 뒤`;
      const c = a < 0 ? 'past' : (a <= 2 ? 'soon' : '');
      return `<div class="dh"><b>${esc(dayText(g.date))}</b><span class="away ${c}">${esc(when)}</span>
        <span class="cnt">${g.rows.length}명</span></div>${g.rows.map(row).join('')}`;
    }).join('');
  };

  // 페이지 넘기개
  const tabs = `<nav class="tabs">
  <a class="${kd ? '' : 'on'}" href="${url('')}">전체
    <span class="n${wait.length ? ' hot' : ''}">${wait.length}</span></a>
  ${KINDS.map((x) => {
    const n = nOf(x.k);
    return `<a class="${kd && kd.k === x.k ? 'on' : ''}" href="${url(x.cls)}">
      <span class="dot ${x.cls}"></span>${esc(x.tx)}
      <span class="n${n ? ' hot' : ''}">${n}</span></a>`;
  }).join('')}
</nav>`;

  const head = (sub) => `<div class="hd">
  <div class="top">
    <div class="d"><b>캐디 신청</b><span>${esc(sub)}</span></div>
    <div class="rt"><span class="who">${esc(me.name)} 님으로 보는 중</span>
      <a class="hbtn" href="${BASE}/">배치표로</a></div>
  </div>
  ${tabs}
</div>`;

  const notes = `${msg ? `<div class="note ok">${esc(msg)}</div>` : ''}${bad ? `<div class="note bad">${esc(bad)}</div>` : ''}`;
  const shell = (title, inner) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 경기과</title><style>${CSS}</style></head><body>${inner}
<script>${JS}</script></body></html>`;

  // ══ 한 종류의 제 페이지 ═══════════════════════════════
  if (kd) {
    const mine = wait.filter((x) => normKind(x.kind) === kd.k);
    const mineDone = book.list.filter((x) => x.state !== 'wait' && normKind(x.kind) === kd.k)
      .sort((a, b) => String(b.doneAt || b.at).localeCompare(String(a.doneAt || a.at)));
    const soon = mine.slice().sort(byDate)[0];
    const what = kd.grp === 'rest' ? '그날 자리를 비웁니다'
      : kd.grp === 'free' ? '그날 순번에 서지 않습니다'
      : kd.pool === 'more' ? '그날 자리를 더 받습니다' : '그날 순번을 본인이 정합니다';
    const mat = kd.mat === 'rest' ? '이 달 덜 쉰 분' : kd.mat === 'dup' ? '이 달 덜 번 분' : '';

    const dr = (r) => `<div class="drow">
      <span class="dt">${esc(dayText(r.date))}</span><span class="nm2">${esc(r.name)}</span>
      <span class="rs">${r.state === 'ok' ? '<span class="pill ok">됐습니다</span>' : '<span class="pill no">안 됨</span>'}</span>
      <form method="POST"><input type="hidden" name="act" value="wait"><input type="hidden" name="id" value="${r.id}">
        <button class="undo">되돌림</button></form>
      ${r.note ? `<span class="nt">${esc(r.note)}</span>` : ''}</div>`;

    return shell(kd.tx + ' 신청', `${head(kd.tx + ' — ' + what)}
<div class="wrap k-${kd.cls}">
${notes}
<div class="khero">
  <span class="tag ${kd.cls}">${esc(kd.tx)}</span>
  <span class="tt"><b>${esc(kd.sub || what)}</b><span>${esc(kd.sub ? what : '신청을 받아 여기서 정합니다')}</span></span>
  <span class="n"><i>${mine.length}</i><em>${mine.length ? '건 기다리는 중' : '기다리는 것 없음'}</em></span>
</div>
<div class="two">
  <section class="panel">
    <div class="ph"><b>정할 것</b>
      <span class="n">${soon ? `가장 급한 날 ${esc(dayText(soon.date))}` : ''}</span></div>
    ${mine.length ? dated(mine)
      : `<div class="pnone"><b>${esc(kd.tx)}로 들어온 신청이 없습니다.</b><br>
         오른쪽에서 대신 적어 넣으실 수 있습니다.</div>`}
  </section>
  <aside>
    <section class="panel" style="margin-bottom:12px">
      <div class="ph"><b>${esc(kd.tx)} 대신 적어 넣기</b></div>
      <div class="pbody">
        <form method="POST" class="addv">
          <input type="hidden" name="act" value="add">
          <input type="hidden" name="kind" value="${esc(kd.k)}">
          <input type="text" name="name" list="rosterNames" placeholder="이름" autocomplete="off" required>
          <input type="date" name="date" required>
          <input type="text" name="why" placeholder="까닭 (안 적어도 됩니다)" autocomplete="off" maxlength="60">
          <button class="add">${esc(kd.tx)}로 넣기</button>
        </form>
        <p class="hint">카톡이나 말로 받으신 것을 넣으면 한자리에 모입니다.
        앱을 안 쓰시는 분도 똑같이 셈에 듭니다.</p>
      </div>
    </section>
    <section class="panel">
      <div class="ph"><b>정해진 ${esc(kd.tx)}</b><span class="n">${mineDone.length}건</span></div>
      ${mineDone.length ? mineDone.slice(0, 40).map(dr).join('')
        : '<div class="pnone">아직 정한 것이 없습니다.</div>'}
    </section>
    <p class="hint">${!mat
      ? '이 종류에는 옆에 붙일 잣대가 없습니다 — 저장된 판에서 셀 수 있는 값이 아닙니다. 낸 차례와 까닭을 보고 정하십시오.'
      : (cnt.days
        ? `옆에 붙은 ‘${esc(mat)}’은 저장된 ${cnt.days}일치에서 센 값입니다. 같은 날 여럿이 냈을 때 ${esc(mat)}께 드리시라고 놓았습니다.`
        : `‘이 달’ 셈은 저장된 판이 쌓이면 채워집니다. 같은 날 여럿이 냈을 때 ${esc(mat)}께 드리시라고 놓으려는 것입니다.`)}</p>
  </aside>
</div>
<datalist id="rosterNames">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
</div>`);
  }

  // ══ 전체 보기 — 감춘 것이 없음을 보는 자리 ═════════════
  const nGrp = (g) => wait.filter((x) => kindOf(x).grp === g).length;
  const kbox = (x) => {
    const mine = wait.filter((y) => normKind(y.kind) === x.k);
    const h = `<a class="kh" href="${url(x.cls)}"><span class="tag ${x.cls}">${esc(x.tx)}</span>
      ${x.sub ? `<span class="sub2">${esc(x.sub)}</span>` : ''}
      <span class="n">${mine.length ? `${mine.length}건 기다리는 중` : '기다리는 것 없음'}</span>
      <span class="go2">열기 →</span></a>`;
    if (!mine.length) return `<div class="kbox none k-${x.cls}">${h}
      <div class="kempty">이 종류로 들어온 신청이 없습니다.</div></div>`;
    return `<div class="kbox k-${x.cls}">${h}${dated(mine)}</div>`;
  };

  // ★세 갈래로 세운다 — 가름은 '그날 근무를 하느냐'다.
  //  프리는 어느 쪽도 아니다. 하든 안 하든 본인이 정하는 것이라 제 칸을 준다
  const side = (g, cls, ttl) => `<section class="side ${cls}">
    <div class="sidehd"><span class="bar"></span><b>${ttl}</b>
      <span class="n">${nGrp(g)}건 기다리는 중</span></div>
    ${KINDS.filter((x) => x.grp === g).map(kbox).join('')}
  </section>`;

  return shell('캐디 신청', `${head('휴무 · 휴가 · 병가 · 54 · 1,3 · 2,3 · 조출 · 후출 · 찾근 · 프리 — 받아서 정하는 곳')}
<div class="wrap">
${notes}
<p class="say">열 가지가 저마다 제 페이지를 가집니다. 위에서 눌러 넘기십시오.
<b>이 ‘전체’ 자리에는 열이 다 서 있습니다</b> — 비어 있는 것도 빈 채로 보여 줍니다. 감춘 것은 없습니다.</p>
<div class="cols3">
  ${side('rest', 'rest', '그날 근무를 안 하겠다는 분')}
  ${side('work', 'work', '그날 근무를 하겠다는 분')}
  ${side('free', 'free', '본인이 정하겠다는 분')}
</div>
<p class="foot">${cnt.days
  ? `‘이 달 며칠 쉼 · 몇 번 더 섬’은 저장된 ${cnt.days}일치에서 센 값입니다 — 쓰기 시작한 뒤부터만 셉니다.`
  : '‘이 달 며칠 쉼 · 몇 번 더 섬’은 저장된 판이 쌓이면 채워집니다.'}
<br>대신 적어 넣기와 지난 답은 종류마다 제 페이지에 있습니다.</p>
</div>`);
}

