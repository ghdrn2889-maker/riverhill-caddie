// ══════════════════════════════════════════════════════════════
//  분실물 — 캐디가 앱에서 올리면 경기과가 여기서 본다.
//
//  ★왜 장부가 배치표 서버에 있나.
//   휴무 신청과 같은 까닭이다. 보는 사람이 여기 있다. 손님이 "아까 두고 간 게
//   있는데요" 하고 전화하면 경기과가 그 자리에서 찾아봐야 한다. 딴 창을 또
//   열어야 하면 안 본다 — 그러면 다시 무전과 카톡으로 돌아간다.
//
//  ★한 건에 무엇이 붙나.
//   물건 이름 · 올린 캐디 · 올린 시각 · 몇 부 몇 번 카트 · 사진(있으면).
//   부와 카트 번호는 캐디가 따로 안 적는다 — 앱이 이미 알고 있어서 같이 온다.
//   손님이 "2부 때 잃어버렸다"고 하면 그 줄만 보면 된다.
//
//  ★세 걸음뿐이다. 들어옴(new) → 받아 둠(keep) → 주인에게 감(done).
//   더 쪼개면 경기과가 단추를 고르느라 멈춘다.
// ══════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { return d; } };
const wr = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), 'utf-8'); fs.renameSync(t, f); };

const file = (DATA) => path.join(DATA, 'lost.json');
export const lostPhotoDir = (DATA) => path.join(DATA, 'lostphoto');
export const okPhoto = (f) => /^[\w.-]+\.(jpg|png)$/.test(String(f || ''));

export function readBook(DATA) {
  const o = rd(file(DATA), null);
  return (o && Array.isArray(o.list)) ? o : { seq: 0, list: [] };
}
function writeBook(DATA, o) { wr(file(DATA), o); }

const todayKey = () => {
  const d = new Date();
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
};
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const WD = '일월화수목금토';
function dayText(k) {
  if (!/^\d{8}$/.test(String(k || ''))) return String(k || '');
  const y = +k.slice(0, 4), m = +k.slice(4, 6), d = +k.slice(6);
  return `${m}월 ${d}일 (${WD[new Date(y, m - 1, d).getDay()]})`;
}

// ── 앱이 한 건 올린다 ────────────────────────────────────────
//  ★이름은 앱 서버가 로그인에서 꺼내 붙인 것이다(옆문 열쇠가 그 보증이다).
//   사진은 있으면 받고, 없으면 없는 대로 받는다 — 사진 때문에 신고를 미루게 두지 않는다.
export function addLost(DATA, { name, by, cart, part, image, appId }) {
  const nm = String(name || '').trim().slice(0, 60);
  const who = String(by || '').trim().slice(0, 20);
  if (!nm) return { ok: false, error: '무엇을 찾으셨는지가 없습니다' };
  if (!who) return { ok: false, error: '누가 올린 것인지가 없습니다' };
  const book = readBook(DATA);
  // ★앱이 쥔 번호(appId)가 같으면 같은 건이다 — 앱이 다시 보내도 두 줄이 되지 않게.
  const aid = String(appId || '').slice(0, 40);
  if (aid) {
    const dup = book.list.find((x) => x.appId === aid);
    if (dup) return { ok: true, rec: dup, dup: true };
  }
  let photo = null;
  const m = String(image || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (m) {
    try {
      const dir = lostPhotoDir(DATA);
      fs.mkdirSync(dir, { recursive: true });
      photo = `lost_${Date.now()}_${book.seq + 1}.${m[1] === 'png' ? 'png' : 'jpg'}`;
      fs.writeFileSync(path.join(dir, photo), Buffer.from(m[2], 'base64'));
    } catch (e) { photo = null; }   // 사진이 안 붙어도 신고는 남는다
  }
  const rec = {
    id: ++book.seq, appId: aid, name: nm, by: who,
    cart: String(cart || '').replace(/[^0-9]/g, '').slice(0, 4),
    part: String(part || '').slice(0, 6),
    photo, day: todayKey(), at: new Date().toISOString(),
    state: 'new', seenAt: null, doneAt: null, note: '',
  };
  book.list.push(rec);
  writeBook(DATA, book);
  return { ok: true, rec };
}

// 캐디가 앱에서 지웠다 — 경기과가 아직 안 본 것만 따라 지운다.
//  ★이미 받아 둔 것은 안 지운다. 물건은 경기과 손에 있는데 장부만 사라지면 못 찾는다.
export function cancelLost(DATA, appId, by) {
  const book = readBook(DATA);
  const i = book.list.findIndex((x) => x.appId && x.appId === String(appId || ''));
  if (i < 0) return { ok: false, error: '그런 신고가 없습니다' };
  const rec = book.list[i];
  if (rec.by !== String(by || '').trim()) return { ok: false, error: '본인이 올린 것만 무를 수 있습니다' };
  if (rec.state !== 'new') return { ok: false, error: '경기과가 이미 받아 두었습니다 — 경기과에 말씀하십시오' };
  book.list.splice(i, 1);
  writeBook(DATA, book);
  if (rec.photo && okPhoto(rec.photo)) { try { fs.unlinkSync(path.join(lostPhotoDir(DATA), rec.photo)); } catch (e) { /* 이미 없음 */ } }
  return { ok: true, rec };
}

// 경기과가 한 걸음 옮긴다 — keep(받아 둠) · done(주인에게 감) · back(도로 물림) · del(지움)
export function move(DATA, id, act, note) {
  const book = readBook(DATA);
  const rec = book.list.find((x) => String(x.id) === String(id));
  if (!rec) return { ok: false, error: '그런 신고가 없습니다' };
  if (act === 'del') {
    book.list = book.list.filter((x) => x !== rec);
    writeBook(DATA, book);
    if (rec.photo && okPhoto(rec.photo)) { try { fs.unlinkSync(path.join(lostPhotoDir(DATA), rec.photo)); } catch (e) { /* 이미 없음 */ } }
    return { ok: true, rec, gone: true };
  }
  if (act === 'keep') { rec.state = 'keep'; rec.seenAt = rec.seenAt || new Date().toISOString(); rec.doneAt = null; }
  else if (act === 'done') { rec.state = 'done'; rec.seenAt = rec.seenAt || new Date().toISOString(); rec.doneAt = new Date().toISOString(); rec.note = String(note || '').trim().slice(0, 60); }
  else if (act === 'back') { rec.state = 'keep'; rec.doneAt = null; rec.note = ''; }
  else return { ok: false, error: '알 수 없는 단추입니다' };
  writeBook(DATA, book);
  return { ok: true, rec };
}

// 아직 안 본 건수 — 배치표 위쪽 단추가 이걸로 달아오른다
export const waitingCount = (DATA) => readBook(DATA).list.filter((x) => x.state === 'new').length;

// ── 화면 ──────────────────────────────────────────────────────
const CSS = `
:root{--paper:#dfe3e8;--card:#fff;--ink:#111820;--sub:#4d5966;--dim:#7d8894;
 --line:#c9d1da;--line2:#e4e9ee;--go:#14549c;--go-d:#0f4680;--goSoft:#e8f0fa;
 --edit:#1d6fd0;--duty:#0f6b47;--warn:#b3541e}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
 font:14px/1.5 -apple-system,BlinkMacSystemFont,"Malgun Gothic","맑은 고딕",sans-serif;
 -webkit-font-smoothing:antialiased}
.hd{background:var(--card);border-bottom:1px solid var(--line)}
.hd .top{max-width:1180px;margin:0 auto;padding:13px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.hd .d b{display:block;font-size:17px;font-weight:900;letter-spacing:-.045em;line-height:1.2}
.hd .d span{font-size:11px;font-weight:820;color:var(--dim)}
.hd .rt{margin-left:auto;display:flex;align-items:center;gap:11px}
.hd .who{font-size:11.5px;font-weight:800;color:var(--dim)}
.hbtn{display:inline-block;border:1px solid #b9c3ce;background:#fff;border-radius:8px;padding:8px 12px;
 font-size:12.5px;font-weight:780;color:var(--sub);text-decoration:none;cursor:pointer;font-family:inherit}
.hbtn:hover{border-color:var(--go);color:var(--go)}
.wrap{max-width:1180px;margin:0 auto;padding:18px 20px 70px}
.note{border-radius:10px;padding:11px 14px;font-size:13px;font-weight:820;margin-bottom:14px}
.note.ok{background:#e9f4ec;border:1px solid #bcdcc6;color:#1d6a3c}
.note.bad{background:#fdecea;border:1px solid #f2c3bc;color:#a1382a}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.ph{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line2)}
.ph .t{font-size:14px;font-weight:900;letter-spacing:-.035em}
.ph .n{font-size:11.5px;font-weight:850;color:var(--dim)}
.ph .n.hot{color:var(--warn)}
.ph .sp{flex:1 1 auto}
.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg a{font-size:12px;font-weight:850;letter-spacing:-.03em;background:#fff;color:var(--sub);
 padding:7px 13px;text-decoration:none}
.seg a+a{border-left:1px solid var(--line)}
.seg a.on{background:var(--goSoft);color:var(--go)}
.row{display:flex;align-items:center;gap:14px;padding:13px 16px;position:relative}
.row+.row{border-top:1px solid var(--line2)}
.row.fresh{background:#f2f8ff}
.row.fresh::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--edit)}
.row.done{opacity:.62}
.th{flex:none;width:52px;height:52px;border-radius:9px;background:#eef1f5;border:1px solid var(--line2);
 display:flex;align-items:center;justify-content:center;color:#a5aeb8;font-size:10px;font-weight:850;
 background-size:cover;background-position:center;overflow:hidden;text-decoration:none}
.th.has{border-color:#b9c3ce}
.it{flex:1 1 auto;min-width:0}
.it .nm{font-size:14.5px;font-weight:900;letter-spacing:-.035em;display:flex;align-items:center;gap:7px}
.it .new{font-size:10px;font-weight:900;color:#fff;background:var(--edit);border-radius:20px;padding:2px 7px}
.it .mt{font-size:11.5px;font-weight:820;color:var(--dim);margin-top:5px}
.it .mt b{color:var(--sub);font-weight:900}
.it .nt{font-size:11.5px;font-weight:800;color:var(--duty);margin-top:4px}
.acts{flex:none;display:flex;align-items:center;gap:7px}
.acts form{margin:0}
.acts button{font:inherit;font-size:12px;font-weight:870;letter-spacing:-.03em;cursor:pointer;
 border:1px solid var(--line);background:#fff;color:var(--sub);border-radius:8px;padding:8px 13px}
.acts button:hover{border-color:var(--go);color:var(--go)}
.acts button.go{background:var(--go);border-color:var(--go);color:#fff}
.acts button.go:hover{background:var(--go-d);color:#fff}
.acts button.x{border-color:transparent;color:#aab3bd;padding:8px 9px}
.acts button.x:hover{color:#b3541e;border-color:#e6c8b6}
.state{flex:none;font-size:11.5px;font-weight:870;color:var(--duty);white-space:nowrap}
.state.keep{color:var(--warn)}
.empty{padding:46px 16px;text-align:center;font-size:13px;font-weight:820;color:var(--dim)}
.empty span{display:block;margin-top:6px;font-size:11.5px;font-weight:750;color:#9aa4ae}
.dh{display:flex;align-items:center;gap:9px;padding:9px 16px;background:#f5f7f9;
 border-top:1px solid var(--line2);font-size:11.5px;font-weight:850;color:var(--dim)}
.dh b{color:var(--sub);font-size:12px}
.hint{max-width:1180px;margin:14px auto 0;font-size:11.5px;line-height:1.65;font-weight:750;color:#6c7884}
@media (max-width:820px){
 .wrap{padding:14px 12px 60px}
 .row{flex-wrap:wrap}
 .acts{width:100%;justify-content:flex-end}
}
`;

export function lostPage(DATA, me, msg, bad, showAll, esc, BASE) {
  const book = readBook(DATA);
  const list = book.list.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const nNew = list.filter((x) => x.state === 'new').length;
  const show = showAll ? list : list.filter((x) => x.state !== 'done');
  const url = (all) => `${BASE}/lost${all ? '?all=1' : ''}`;

  const row = (r) => {
    const fresh = r.state === 'new';
    const th = r.photo
      ? `<a class="th has" href="${BASE}/lost/photo/${esc(r.photo)}" target="_blank" rel="noreferrer"
           style="background-image:url('${BASE}/lost/photo/${esc(r.photo)}')" title="크게 보기"></a>`
      : '<span class="th">사진 없음</span>';
    const where = [r.part, r.cart ? r.cart + '번 카트' : ''].filter(Boolean).join(' ');
    return `<div class="row ${fresh ? 'fresh' : ''} ${r.state === 'done' ? 'done' : ''}">
  ${th}
  <div class="it">
    <div class="nm">${esc(r.name)}${fresh ? '<span class="new">새 신고</span>' : ''}</div>
    <div class="mt"><b>${esc(r.by)}</b> 캐디 · ${esc(hhmm(r.at))}${where ? ' · ' + esc(where) : ''}</div>
    ${r.state === 'done' && r.note ? `<div class="nt">${esc(r.note)}</div>` : ''}
  </div>
  ${r.state === 'done'
    ? `<span class="state">주인에게 전달함 ${esc(hhmm(r.doneAt))}</span>
       <span class="acts"><form method="POST"><input type="hidden" name="act" value="back">
         <input type="hidden" name="id" value="${r.id}"><button>되돌림</button></form></span>`
    : `${fresh ? '' : '<span class="state keep">보관 중</span>'}
       <span class="acts">
         ${fresh ? `<form method="POST"><input type="hidden" name="act" value="keep">
           <input type="hidden" name="id" value="${r.id}"><button>확인 · 보관</button></form>` : ''}
         <form method="POST"><input type="hidden" name="act" value="done">
           <input type="hidden" name="id" value="${r.id}">
           <input type="hidden" name="note" value="">
           <button class="go">주인에게 전달</button></form>
         <form method="POST" onsubmit="return confirm('이 신고를 지웁니다. 사진도 같이 사라집니다.')">
           <input type="hidden" name="act" value="del"><input type="hidden" name="id" value="${r.id}">
           <button class="x" title="지우기">✕</button></form>
       </span>`}
</div>`;
  };

  // 날짜로 묶는다 — 오늘 것이 맨 위에 서고, 어제 것은 어제 것으로 보인다
  const groups = [];
  show.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.day === r.day) last.rows.push(r);
    else groups.push({ day: r.day, rows: [r] });
  });
  const today = todayKey();
  const body = groups.length
    ? groups.map((g, i) => (i === 0 && g.day === today ? '' :
        `<div class="dh"><b>${esc(dayText(g.day))}</b><span>${g.day === today ? '오늘' : ''}</span>
         <span>${g.rows.length}건</span></div>`) + g.rows.map(row).join('')).join('')
    : `<div class="empty">${showAll ? '아직 들어온 분실물이 없습니다.' : '처리할 분실물이 없습니다.'}
       <span>캐디가 앱에서 올리면 이 자리에 바로 뜹니다.</span></div>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>분실물 · 경기과</title><style>${CSS}</style></head><body>
<div class="hd"><div class="top">
  <div class="d"><b>분실물</b><span>캐디가 앱에서 올린 것이 여기로 옵니다</span></div>
  <div class="rt"><span class="who">${esc(me.name)} 님으로 보는 중</span>
    <a class="hbtn" href="${BASE}/">배치표로</a></div>
</div></div>
<div class="wrap">
${msg ? `<div class="note ok">${esc(msg)}</div>` : ''}${bad ? `<div class="note bad">${esc(bad)}</div>` : ''}
<div class="panel">
  <div class="ph">
    <span class="t">분실물</span>
    <span class="n${nNew ? ' hot' : ''}">${nNew ? '아직 안 본 것 ' + nNew + '건' : '안 본 것 없음'}</span>
    <span class="sp"></span>
    <span class="seg">
      <a class="${showAll ? '' : 'on'}" href="${url(false)}">처리할 것</a>
      <a class="${showAll ? 'on' : ''}" href="${url(true)}">전부 보기</a>
    </span>
  </div>
  ${body}
</div>
<p class="hint">한 건마다 <b>누가 · 언제 · 몇 부 몇 번 카트</b>가 같이 옵니다 —
캐디가 따로 안 적어도 앱이 알고 있는 것을 붙여 보냅니다.
손님이 “몇 부 때 두고 갔다”고 하시면 그 줄만 보시면 됩니다.<br>
<b>확인 · 보관</b>을 누르면 올린 캐디 쪽에서도 경기과가 받았다는 것이 보입니다.</p>
</div></body></html>`;
}
