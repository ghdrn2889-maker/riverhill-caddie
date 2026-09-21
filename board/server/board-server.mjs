// ══════════════════════════════════════════════════════════════
//  배치표 서버 — 경기과가 쓰는 방.
//  ★캐디 총무 앱과 따로 도는 별개 프로그램이다.
//    앱 코드를 안 부르고, 앱 데이터도 안 본다. 앱에는 "이 사람 누구요?"만 묻는다.
//  ★바깥 부품을 안 쓴다 — 노드에 원래 있는 것만으로 돈다. 그래야 어디서든 선다.
//
//  하는 일은 둘뿐이다.
//    ① 배치표 화면(한 장짜리 HTML)을 내준다
//    ② 짜 놓은 배치표를 파일로 받아 두고 돌려준다  ← 여태 브라우저 안에만 있던 것
// ══════════════════════════════════════════════════════════════
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// 휴무 신청 — 장부와 화면은 따로 산다. 이 파일은 길만 이어 준다
import { dayoffPage, addRequest, decide, delRequest, readBook, approvedOn,
  mineOf, cancelOwn, matOf, tallyOf, KINDS } from './board-dayoff.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOST = process.env.BOARD_HOST || '127.0.0.1';
const PORT = Number(process.env.BOARD_PORT || 3300);
const DATA = process.env.BOARD_DATA || path.join(ROOT, 'data');
const PAGE = process.env.BOARD_PAGE || path.join(ROOT, 'public', 'index.html');
const DAYS = path.join(DATA, 'days');
const TRASH = path.join(DATA, 'trash');       // ★지운 것도 한동안 둔다 — 실수는 되돌릴 수 있어야 한다
const PREV = path.join(DATA, 'prev');         // ★덮기 전의 옛 판 — 둘이 동시에 짜다 한쪽을 덮어도 되찾을 수 있게
const KEEPPREV = Number(process.env.BOARD_KEEPPREV || 10);
const BASE = (process.env.BOARD_BASE || '').replace(/\/+$/, '');   // 밖에서 보이는 앞길 (예: /board)

for (const d of [DATA, DAYS, TRASH, PREV]) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
// ★날짜는 숫자 여덟 자리로만 주고받는다(20260912).
//   주소에 한글을 넣으면 글자 인코딩이 어긋나는 순간 통째로 깨진다 — 실제로 깨졌다.
//   사람이 읽는 '2026년 09월 12일' 은 글 안에 label 로 같이 담아 둔다
const okKey = (s) => /^[0-9]{8}$/.test(s);
const sig = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const sendJSON = (res, code, o) => send(res, code, JSON.stringify(o));

// ── 하루치 한 칸 = 파일 한 장
const dayFile = (k) => path.join(DAYS, k + '.json');
function readDay(d) {
  try { return JSON.parse(fs.readFileSync(dayFile(d), 'utf-8')); } catch (e) { return null; }
}
// ★덮기 전에 옛 판을 한 장 남긴다. 몇 장만 두고 오래된 것은 걷는다
function keepPrev(k, old) {
  if (!old || !old.s) return;
  try {
    fs.writeFileSync(path.join(PREV, k + '.' + Date.now() + '.json'), JSON.stringify(old), 'utf-8');
    const mine = fs.readdirSync(PREV).filter((f) => f.startsWith(k + '.')).sort();
    for (const f of mine.slice(0, Math.max(0, mine.length - KEEPPREV))) {
      fs.unlinkSync(path.join(PREV, f));
    }
  } catch (e) { log('옛 판 보관 실패', k, e.message); }
}
// ★적다 만 파일이 남지 않게 — 임시로 쓰고 한 번에 갈아 끼운다
function writeDay(d, rec) {
  const f = dayFile(d), t = f + '.tmp';
  fs.writeFileSync(t, JSON.stringify(rec), 'utf-8');
  fs.renameSync(t, f);
}
function listDays() {
  return fs.readdirSync(DAYS).filter((f) => /^[0-9]{8}\.json$/.test(f)).map((f) => {
    const key = f.slice(0, -5);
    let at = '', by = '', sv = 0, label = '';
    try {
      const o = JSON.parse(fs.readFileSync(path.join(DAYS, f), 'utf-8'));
      at = o.at || ''; by = o.by || ''; sv = o.sv || 0; label = o.label || '';
    } catch (e) { /* 깨진 글은 목록에만 남기고 건너뛴다 */ }
    return { key, label, at, by, sv };
  }).sort((a, b) => (a.key < b.key ? 1 : -1));
}

const cfgFile = path.join(DATA, 'cfg.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf-8')); } catch (e) { return null; } };
function writeCfg(o) {
  const t = cfgFile + '.tmp';
  fs.writeFileSync(t, JSON.stringify(o), 'utf-8'); fs.renameSync(t, cfgFile);
}

function body(req) {
  return new Promise((ok, no) => {
    let s = '', n = 0;
    req.on('data', (c) => { n += c.length; if (n > 8e6) { no(new Error('너무 큽니다')); req.destroy(); } s += c; });
    req.on('end', () => ok(s));
    req.on('error', no);
  });
}

// ══ 앱에 알리기 ═══════════════════════════════════════════════
// ★경기과가 저장을 누르면 캐디 총무 앱도 그대로 따라간다.
//   여태 앱은 카톡에 올라온 배치표 '사진'을 읽어서 알았다. 이제는 만든 곳에서 바로 받는다.
//
//  ★여기서 지키는 세 가지.
//   ① 저장을 막지 않는다 — 앱이 느리거나 꺼져 있어도 경기과 화면은 그대로 돈다.
//   ② 모아서 한 번만 보낸다 — 경기과는 짜다 저장하고 고쳐 또 저장한다.
//      누를 때마다 보내면 앱이 회원 여든 명을 그때마다 다시 계산한다.
//      마지막으로 누른 뒤 조용해지면 그때 한 번 보낸다.
//   ③ 실패하면 몇 번 더 해 본다 — 그러고도 안 되면 자국을 남긴다.
//      자국은 /ok 에서 볼 수 있다. 조용히 안 가고 있는 것이 제일 나쁘다.
const APPURL  = process.env.BOARD_APP_URL || '';                 // 비어 있으면 안 보낸다(지금까지와 똑같이 돈다)
const APPKEY  = process.env.BOARD_APP_TOKEN || '';
const APPWAIT = Math.max(1, Number(process.env.BOARD_APP_WAIT || 20)) * 1000;   // 조용해지길 기다리는 시간
const APPTRY  = 3;                                               // 실패했을 때 더 해 보는 횟수
const APPQ = new Map();                                          // 날짜 → 기다리는 중인 알림
let APPLAST = null;                                              // 마지막 결과 — 눈으로 볼 자국

const kstKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');

function tellApp(k) {
  if (!APPURL) return;
  if (k < kstKey()) return;                 // 지난 날은 안 보낸다 — 앱에서 쓸 일이 없다
  const t = APPQ.get(k);
  if (t) clearTimeout(t.timer);
  APPQ.set(k, { timer: setTimeout(() => { APPQ.delete(k); sendApp(k, 1); }, APPWAIT) });
}

async function sendApp(k, n) {
  const rec = readDay(k);
  if (!rec || !rec.s) return;
  // ★자국은 늘 '지금 어떤가'를 말해야 한다. 옛 성공을 붙들고 있으면
  //   안 가고 있는 동안에도 잘 가는 것처럼 보인다 — 조용히 안 가는 것이 제일 나쁘다.
  const mark = (ok, note, again) => {
    APPLAST = { at: new Date().toISOString(), day: k, ok, note, tries: n, ...(again ? { again: true } : {}) };
    log(ok ? '앱에 보냄' : (again ? '앱에 다시 해 봅니다' : '★앱에 못 보냄'), k, note);
  };
  try {
    const r = await fetch(APPURL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-monitor-token': APPKEY },
      body: JSON.stringify({ s: rec.s, by: rec.by || '', label: rec.label || '' }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      const brief = (j.parts || []).filter((x) => x.updated !== undefined)
        .map((x) => `${x.part}부 ${x.rows}명(회원 ${x.updated})`).join(' / ') || '반영된 부 없음';
      return mark(true, `${j.dateLabel || ''} ${brief}`);
    }
    // 날짜가 지났다는 식의 '되돌려보냄'은 다시 시도해도 같다 — 그냥 적어 둔다
    if (r.status === 400) return mark(false, j.error || '앱이 받지 않았습니다');
    throw new Error(`앱이 ${r.status}`);
  } catch (e) {
    if (n < APPTRY) {
      mark(false, `${n}/${APPTRY} — ${e.message}`, true);
      setTimeout(() => sendApp(k, n + 1), 30000 * n);
      return;
    }
    mark(false, e.message);
  }
}

// ══ 문 — 리버힐 전용 입장 코드 ═══════════════════════════════
// ★배치표는 제 문을 가진다. 앱 로그인을 안 빌린다 — 앱과 이 프로그램은 따로다.
//   경기과 분들은 캐디가 아니다. 캐디 앱 회원으로 만들 까닭이 없다.
//
//   관리자가 사람마다 다른 코드를 하나씩 발급한다. 한 번 넣으면 그 기기가 기억한다.
//   코드마다 이름표가 붙어서, 배치표에 '누가 저장했는지'가 남는다.
//   그만두거나 잃어버리면 그 사람 코드만 거둔다 — 남은 사람은 그대로 쓴다.
const PASSF = path.join(DATA, 'passes.json');     // 발급한 코드들
const SESSF = path.join(DATA, 'sessions.json');   // 들어와 있는 기기들
const SESS_DAYS = Number(process.env.BOARD_SESS_DAYS || 60);
const OPEN = process.env.BOARD_OPEN === '1';      // 문을 걷어 두는 비상 스위치(집 안에서만 쓸 때)
// ★앱이 들어오는 옆문. 사람이 쓰는 문(입장 코드)과 아주 따로다.
//   같은 기계 안에서 앱 서버만 두드린다 — 폰은 이 열쇠를 모르고, 알 까닭도 없다.
//   열쇠가 비어 있으면 옆문은 아예 없는 것과 같다(연습할 때 그렇게 둔다).
//   ★옆문은 신청 장부 한 곳에만 열린다. 배치표도 명부도 코드 관리도 이 열쇠로는 못 본다.
const REQKEY = process.env.BOARD_REQ_KEY || '';
const FAIL = new Map();                           // 어디서 몇 번 틀렸나 — 찍어 맞히기 막기

const readJSON = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { return dflt; } };
function writeJSON(f, o) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), 'utf-8'); fs.renameSync(t, f); }
const passes = () => readJSON(PASSF, []);
const sessions = () => readJSON(SESSF, {});

// 헷갈리는 글자(0 O 1 I)는 뺀다 — 사람이 받아 적는 코드다
const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n)).map((b) => ABC[b % ABC.length]).join('');
  return 'RH-' + pick(4) + '-' + pick(4);
}
const normCode = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// ── 코드 발급·회수 (관리자가 명령으로 쓴다)
function passAdd(name, role) {
  const list = passes();
  const rec = { code: newCode(), name: String(name || '이름없음'), role: role || 'ops',
                made: new Date().toISOString(), seen: '', uses: 0, off: false };
  list.push(rec); writeJSON(PASSF, list);
  return rec;
}
function passOff(code) {
  const list = passes(), c = normCode(code);
  let hit = null;
  for (const p of list) if (normCode(p.code) === c) { p.off = true; hit = p; }
  if (hit) {
    writeJSON(PASSF, list);
    const ss = sessions(); let n = 0;                  // ★거두면 그 사람 기기도 같이 나간다
    for (const k of Object.keys(ss)) if (normCode(ss[k].code) === c) { delete ss[k]; n++; }
    writeJSON(SESSF, ss);
    hit._kicked = n;
  }
  return hit;
}

// ── 들어와 있는 기기
function sessNew(pass, ua) {
  const ss = sessions(), tok = crypto.randomBytes(24).toString('base64url');
  ss[tok] = { code: pass.code, name: pass.name, role: pass.role,
              at: new Date().toISOString(), ua: String(ua || '').slice(0, 120) };
  for (const k of Object.keys(ss)) {                   // 오래된 것은 걷는다
    const age = Date.now() - new Date(ss[k].at).getTime();
    if (!(age < SESS_DAYS * 864e5)) delete ss[k];
  }
  writeJSON(SESSF, ss);
  return tok;
}
function sessWho(tok) {
  if (!tok) return null;
  const ss = sessions(), r = ss[tok];
  if (!r) return null;
  const live = passes().find((p) => normCode(p.code) === normCode(r.code) && !p.off);
  if (!live) return null;                              // 코드가 거둬졌으면 그 기기도 끝이다
  return { name: live.name, role: live.role, code: live.code };
}
const cookieOf = (req, k) => {
  const h = req.headers.cookie || '';
  const m = h.match(new RegExp('(?:^|;\s*)' + k + '=([^;]+)'));
  return m ? m[1] : '';
};

// ── 화면
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function page(title, inner, more) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
 :root{color-scheme:light dark}
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      font:16px/1.7 -apple-system,'Malgun Gothic',sans-serif;background:#eef1f5;color:#1d2733}
 .box{width:min(94vw,400px);padding:32px 28px;background:#fff;border:1.5px solid #d4dbe3;border-radius:14px;text-align:center}
 h1{margin:0 0 8px;font-size:20px}
 .sub{margin:0 0 22px;color:#5d6b7a;font-size:14px;white-space:pre-line}
 input{width:100%;box-sizing:border-box;padding:14px;font:700 20px/1.2 ui-monospace,Consolas,monospace;
       text-align:center;letter-spacing:2px;border:1.5px solid #c3ccd6;border-radius:9px;background:#fbfcfd;color:inherit}
 button{margin-top:14px;width:100%;padding:14px;background:#2f6db5;color:#fff;border:0;border-radius:9px;
        font:700 16px/1 inherit;cursor:pointer}
 .bad{margin:14px 0 0;color:#b3261e;font-size:14px;white-space:pre-line}
 @media(prefers-color-scheme:dark){body{background:#161a1f;color:#e7edf3}
  .box{background:#1e242b;border-color:#39424d}.sub{color:#a9b6c3}
  input{background:#171c22;border-color:#414b57}}
${more || ''}
</style></head><body><div class="box">${inner}</div></body></html>`;
}
const gatePage = (bad) => page('경기과 배치표', `<h1>경기과 배치표</h1>
<p class="sub">입장 코드를 넣으십시오.
캐디분들 실명이 들어 있어 문을 걸어 두었습니다.</p>
<form method="POST" action="${BASE}/gate">
 <input name="code" placeholder="RH-XXXX-XXXX" autocomplete="off" autocapitalize="characters" autofocus>
 <button type="submit">들어가기</button>
</form>${bad ? `<p class="bad">${bad}</p>` : ''}`);
// ── 코드 관리 화면 — 관리자 코드로만 보인다
//   ★코드가 새면 급하다. 그때 나(만든 사람)를 찾아야만 막을 수 있으면 막을 수 없는 것과 같다.
//   그래서 경기과 관리자가 스스로 거두고 다시 뽑을 수 있어야 한다.
function keysPage(me, msg, fresh) {
  const list = passes(), ss = sessions();
  const row = (x) => {
    const dev = Object.values(ss).filter((v) => normCode(v.code) === normCode(x.code)).length;
    const on = !x.off;
    return `<tr class="${on ? '' : 'off'}">
      <td class="c">${esc(x.code)}</td>
      <td>${esc(x.name)}${x.role === 'admin' ? ' <span class="tag">관리</span>' : ''}</td>
      <td class="n">${on ? (dev + '대') : '거둠'}</td>
      <td class="n">${x.seen ? esc(String(x.seen).slice(5, 16).replace('T', ' ')) : '—'}</td>
      <td class="a">${on ? `
        <form method="POST"><input type="hidden" name="act" value="renew"><input type="hidden" name="code" value="${esc(x.code)}">
          <button class="b2" onclick="return confirm('${esc(x.name)} 님 코드를 새로 뽑습니다.\n옛 코드는 그 자리에서 못 쓰게 됩니다.')">다시 뽑기</button></form>
        <form method="POST"><input type="hidden" name="act" value="off"><input type="hidden" name="code" value="${esc(x.code)}">
          <button class="b3" onclick="return confirm('${esc(x.name)} 님 코드를 거둡니다.\n쓰던 기기도 같이 나갑니다.')">거두기</button></form>` : ''}</td></tr>`;
  };
  return page('입장 코드 관리', `<h1 style="margin-bottom:6px">입장 코드</h1>
<p class="sub">코드가 새거나 잃어버렸으면 <b>다시 뽑기</b>를 누르십시오.
옛 코드는 그 자리에서 못 쓰게 되고, 쓰던 기기도 나갑니다.</p>
${fresh ? `<div class="fresh"><div class="fn">${esc(fresh.name)} 님 새 코드</div><div class="fc">${esc(fresh.code)}</div>
  <div class="fw">이 화면을 벗어나면 다시 안 보여 줍니다. 그 분에게만 알려 주십시오.</div></div>` : ''}
${msg ? `<p class="ok">${esc(msg)}</p>` : ''}
<table><tr><th>코드</th><th>이름</th><th>기기</th><th>마지막</th><th></th></tr>
${list.map(row).join('')}</table>
<form method="POST" class="add">
  <input name="name" placeholder="새로 줄 사람 이름" autocomplete="off">
  <input type="hidden" name="act" value="add">
  <button class="b1">코드 만들기</button>
</form>
<form method="POST" style="margin-top:18px">
  <input type="hidden" name="act" value="kickall">
  <button class="b3" onclick="return confirm('지금 들어와 있는 기기를 모두 내보냅니다.\n코드는 그대로라 다시 넣으면 들어옵니다.')">기기 모두 내보내기</button>
</form>
<p class="sub" style="margin:18px 0 0">지금 ${esc(me.name)} 님으로 보고 있습니다 · <a href="${BASE}/">배치표로</a></p>`, `
 .box{width:min(96vw,720px);text-align:left}
 table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:14px}
 th{text-align:left;padding:8px 6px;border-bottom:1.5px solid #d4dbe3;color:#5d6b7a;font-size:12px}
 td{padding:9px 6px;border-bottom:1px solid #e7ebf0;vertical-align:middle}
 td.c{font:700 15px ui-monospace,Consolas,monospace;letter-spacing:.5px}
 td.n{color:#5d6b7a;white-space:nowrap}
 td.a{white-space:nowrap;text-align:right}
 tr.off td{opacity:.42;text-decoration:line-through}
 .tag{font-size:11px;background:#e3ecf7;color:#2f6db5;padding:1px 6px;border-radius:20px;text-decoration:none}
 form{display:inline-block;margin:0}
 button{width:auto;margin:0 0 0 5px;padding:7px 12px;font-size:13px}
 .b2{background:#5b6b7d}.b3{background:#a33}.b1{background:#2f6db5}
 .add{display:flex;gap:8px;width:100%}
 .add input{flex:1;text-align:left;letter-spacing:0;font:15px inherit;padding:11px}
 .add button{margin:0;padding:11px 18px;font-size:15px}
 .fresh{margin:6px 0 16px;padding:16px;background:#eef6ff;border:1.5px solid #9cc4ec;border-radius:11px;text-align:center}
 .fn{font-size:13px;color:#2f6db5}
 .fc{font:800 26px/1.4 ui-monospace,Consolas,monospace;letter-spacing:2px}
 .fw{font-size:12px;color:#5d6b7a}
 .ok{margin:0 0 12px;color:#1d6b3f;font-size:14px}
 a{color:#2f6db5}
 @media(prefers-color-scheme:dark){th{border-color:#39424d;color:#a9b6c3}td{border-color:#2a323b}
  .fresh{background:#17293d;border-color:#2f5f92}.tag{background:#22364d}}`);
}

const downPage = (m) => page('잠시 뒤에 다시', `<h1>잠시 뒤에 다시</h1><p class="sub">${m}</p>`);

// ── 찍어 맞히기 막기
function failNote(ip) {
  const r = FAIL.get(ip) || { n: 0, till: 0 };
  //  ★처음 세 번은 봐준다 — 손으로 받아 적는 코드라 오타가 난다.
  //    그리고 밖으로 난 길을 타고 오면 여러 사람이 한 주소로 보일 수 있다.
  //    그 뒤로만 점점 느려진다(1초 4초 9초 …), 아무리 길어도 2분
  r.n++;
  const over = Math.max(0, r.n - 3);
  r.till = Date.now() + Math.min(120e3, over * over * 1000);
  FAIL.set(ip, r);
  if (FAIL.size > 2000) FAIL.clear();
  return r;
}
function failLeft(ip) {
  const r = FAIL.get(ip); if (!r) return 0;
  const left = r.till - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || req.socket.remoteAddress || '?';

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  try {
    // ── 문: 코드 넣는 화면
    if (p === BASE + '/gate' || p === '/gate') {
      if (req.method === 'GET') return send(res, 200, gatePage(''), 'text/html; charset=utf-8');
      if (req.method === 'POST') {
        const ip = ipOf(req);
        const wait = failLeft(ip);
        if (wait) return send(res, 429, gatePage(`너무 여러 번 틀렸습니다.\n${wait}초 뒤에 다시 해 주십시오.`), 'text/html; charset=utf-8');
        const raw = await body(req);
        const got = normCode(new URLSearchParams(raw).get('code') || '');
        const hit = passes().find((x) => normCode(x.code) === got && !x.off);
        if (!got || !hit) { failNote(ip); return send(res, 401, gatePage('그런 코드가 없습니다.'), 'text/html; charset=utf-8'); }
        FAIL.delete(ip);
        const list = passes();
        for (const x of list) if (normCode(x.code) === got) { x.uses = (x.uses || 0) + 1; x.seen = new Date().toISOString(); }
        writeJSON(PASSF, list);
        const tok = sessNew(hit, req.headers['user-agent']);
        log('들어옴', hit.name, hit.code, ip);
        res.writeHead(302, {
          'Set-Cookie': `bpass=${tok}; Path=${BASE || '/'}; Max-Age=${SESS_DAYS * 86400}; HttpOnly; SameSite=Lax`
            + (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''),
          'Location': (BASE || '') + '/',
        });
        return res.end();
      }
    }
    // ── 나가기
    if (p === BASE + '/out' || p === '/out') {
      const tok = cookieOf(req, 'bpass');
      if (tok) { const ss = sessions(); delete ss[tok]; writeJSON(SESSF, ss); }
      res.writeHead(302, { 'Set-Cookie': `bpass=; Path=${BASE || '/'}; Max-Age=0`, 'Location': (BASE || '') + '/gate' });
      return res.end();
    }

    // ── ★여기를 못 지나면 아무것도 안 보인다
    // 옆문은 /api/app/* 한 가지에만 열린다 — 길을 여기서 못 박아 둔다
    const appDoor = p === '/api/app/req' || p === BASE + '/api/app/req';
    const appIn = !!REQKEY && appDoor && req.headers['x-board-req-key'] === REQKEY;
    const me = appIn ? { name: '앱', role: 'app', code: '' }
      : OPEN ? { name: '경기과', role: 'ops', code: '' }
      : sessWho(cookieOf(req, 'bpass'));
    if (!me) {
      if (p.indexOf('/api/') >= 0) return sendJSON(res, 401, { ok: false, error: '입장 코드가 필요합니다' });
      return send(res, 401, gatePage(''), 'text/html; charset=utf-8');
    }
    const who = me.name;

    // ── 코드 관리 — 관리자 코드로만
    if (p === BASE + '/keys' || p === '/keys') {
      if (me.role !== 'admin') return send(res, 403, page('관리자만',
        '<h1>관리자만</h1><p class="sub">입장 코드를 관리할 수 있는 코드가 아닙니다.</p>'),
        'text/html; charset=utf-8');
      if (req.method === 'GET') return send(res, 200, keysPage(me, '', null), 'text/html; charset=utf-8');
      if (req.method === 'POST') {
        const f = new URLSearchParams(await body(req));
        const act = f.get('act'), code = normCode(f.get('code') || '');
        let msg = '', fresh = null;
        if (act === 'add') {
          const nm = String(f.get('name') || '').trim().slice(0, 20);
          if (!nm) msg = '이름을 적으십시오';
          else { fresh = passAdd(nm, 'ops'); log('코드 발급', nm, fresh.code, '(' + me.name + ')'); }
        } else if (act === 'off') {
          const gone = passOff(code);
          if (gone) { msg = gone.name + ' 님 코드를 거뒀습니다 · 쓰던 기기 ' + (gone._kicked || 0) + '대도 나갔습니다';
            log('코드 거둠', gone.name, code, '(' + me.name + ')'); }
        } else if (act === 'renew') {
          // ★다시 뽑기 = 옛 것을 거두고 같은 이름으로 새로 준다.
          //   코드를 사람이 정하게 두지 않는다 — 생일·전화번호를 넣게 되고 그건 찍어 맞힌다
          const old = passes().find((x) => normCode(x.code) === code);
          if (old) {
            const gone = passOff(code);
            fresh = passAdd(old.name, old.role);
            msg = old.name + ' 님 코드를 새로 뽑았습니다 · 옛 코드로 쓰던 기기 ' + ((gone && gone._kicked) || 0) + '대는 나갔습니다';
            log('코드 다시 뽑음', old.name, code, '→', fresh.code, '(' + me.name + ')');
          }
        } else if (act === 'kickall') {
          const n = Object.keys(sessions()).length;
          writeJSON(SESSF, {});
          msg = '들어와 있던 기기 ' + n + '대를 모두 내보냈습니다 · 코드는 그대로입니다';
          log('기기 모두 내보냄', n, '(' + me.name + ')');
        }
        return send(res, 200, keysPage(me, msg, fresh), 'text/html; charset=utf-8');
      }
    }
    // ── 휴무 신청 — 입장 코드가 있는 경기과 분이면 누구나 본다.
    //  ★관리자 전용으로 막지 않는다. 내일 판을 짜는 사람이 그 자리에서 정해야 하는 일이고,
    //    관리자 한 사람을 거쳐야 하면 결국 카톡이 더 빨라진다
    if (p === BASE + '/dayoff' || p === '/dayoff') {
      const showDone = u.searchParams.get('done') === '1';
      // ★종류마다 제 페이지다 — k 는 영문 한 글자(r·v·s·d54·d13·d23).
      //   주소에 한글을 넣으면 인코딩이 한 번만 어긋나도 통째로 안 걸린다.
      //   k 가 없으면 여섯이 다 서는 '전체' 자리다
      const only = u.searchParams.get('k') || '';
      const draw = (msg, bad) => send(res, 200,
        dayoffPage(DATA, me, msg, bad, showDone, esc, BASE, only), 'text/html; charset=utf-8');
      if (req.method === 'GET') return draw('', '');
      if (req.method === 'POST') {
        const f = new URLSearchParams(await body(req));
        const act = f.get('act'), id = f.get('id');
        let r = null, msg = '';
        if (act === 'add') {
          // 달력 칸은 '2026-09-24'로 준다 — 장부는 숫자 여덟 자리로 쥔다
          const dt = String(f.get('date') || '').replace(/-/g, '');
          r = addRequest(DATA, { name: f.get('name'), date: dt, why: f.get('why'),
            kind: f.get('kind'), by: '경기과(' + who + ')' });
          if (r.ok) { msg = `${r.rec.name} 님 ${r.rec.kind} 신청을 넣었습니다`;
            log('신청 대신 넣음', r.rec.kind, r.rec.name, r.rec.date, who); }
        } else if (act === 'ok' || act === 'no' || act === 'wait') {
          r = decide(DATA, id, act, f.get('note'), who);
          if (r.ok) {
            const kd = r.rec.kind || '휴무';
            msg = act === 'ok' ? `${r.rec.name} 님 ${kd} — 됐습니다`
                : act === 'no' ? `${r.rec.name} 님 ${kd} — 안 된다고 알립니다`
                : `${r.rec.name} 님 신청을 도로 기다림으로 두었습니다`;
            log('신청', act, kd, r.rec.name, r.rec.date, who);
          }
        } else if (act === 'del') {
          r = delRequest(DATA, id);
          if (r.ok) { msg = `${r.rec.name} 님 신청을 지웠습니다`; log('휴무 신청 지움', r.rec.name, who); }
        } else {
          r = { ok: false, error: '알 수 없는 단추입니다' };
        }
        return draw(r.ok ? msg : '', r.ok ? '' : r.error);
      }
    }
    // ── 휴무 신청 — 기계가 묻는 문.
    //  배치표 화면은 '이 날 승인된 휴무가 누구냐'를 묻고, 앱은 신청을 밀어 넣는다
    if (req.method === 'GET' && p === '/api/dayoff') {
      const d = u.searchParams.get('date') || '';
      if (d) return sendJSON(res, 200, { ok: true, date: d, names: approvedOn(DATA, d) });
      return sendJSON(res, 200, { ok: true, ...readBook(DATA) });
    }
    if (req.method === 'POST' && p === '/api/dayoff') {
      const inb = JSON.parse(await body(req) || '{}');
      const r = addRequest(DATA, { name: inb.name, date: inb.date, why: inb.why,
        kind: inb.kind, by: inb.by || '앱' });
      if (!r.ok) return sendJSON(res, 400, r);
      log('신청 들어옴', r.rec.kind, r.rec.name, r.rec.date, r.rec.by);
      return sendJSON(res, 200, r);
    }

    // ── 앱이 드나드는 옆문 — 그 사람 것만 오간다.
    //  ★이름은 앱 서버가 로그인에서 꺼내 붙인 것이다. 폰이 적어 보낸 게 아니다.
    //   그래서 여기서는 이름을 그대로 믿는다 — 옆문 열쇠가 곧 그 보증이다.
    if (appDoor) {
      if (!appIn) return sendJSON(res, 401, { ok: false, error: '앱 열쇠가 아닙니다' });
      const nm = String(u.searchParams.get('name') || '').trim();
      if (!nm) return sendJSON(res, 400, { ok: false, error: '누구인지 없이는 아무것도 못 합니다' });
      if (req.method === 'GET') {
        const now = new Date();                       // 서버는 한국 시각으로 돈다
        const mon = u.searchParams.get('month')
          || String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
        return sendJSON(res, 200, { ok: true, name: nm,
          list: mineOf(DATA, nm), mat: matOf(DATA, nm, mon),
          // 그 달 날마다 갈래별 건수 — 앱 달력의 칸 밑 숫자이고 그날 판의 여섯 줄이다.
          // 제 이름은 빠져 있다(앱이 제 장부로 이미 알고 있다)
          tally: tallyOf(DATA, mon, nm),
          kinds: KINDS.map((k) => ({ k: k.k, cls: k.cls, grp: k.grp, pool: k.pool,
            away: k.away, sub: k.sub || '' })) });
      }
      if (req.method === 'POST') {
        let inb = {};
        try { inb = JSON.parse(await body(req) || '{}'); } catch (e) { inb = {}; }
        if (inb.act === 'cancel') {
          const r = cancelOwn(DATA, inb.id, nm);
          if (r.ok) log('신청 무름', r.rec.kind, nm, r.rec.date);
          return sendJSON(res, r.ok ? 200 : 400, r);
        }
        // ★한 번에 여러 날을 받는다. 담아 두고 한꺼번에 내는 화면이라 그렇다.
        //  장부에는 날마다 한 건씩 따로 들어간다 — 경기과가 25일은 되고 26일은
        //  안 된다고 따로 정할 수 있어야 하기 때문이다. 까닭은 한 번 적어 모두에 붙는다.
        //  ★하나가 막혀도 나머지는 넣는다. 이미 낸 날이 하나 껴 있다고 나머지 이틀까지
        //   되돌리면, 사람은 무엇이 들어갔고 무엇이 안 들어갔는지 알 길이 없다.
        const many = Array.isArray(inb.items) ? inb.items.slice(0, 31)
          : [{ date: inb.date, kind: inb.kind }];
        const done = [], failed = [];
        for (const it of many) {
          const r = addRequest(DATA, { name: nm, date: it && it.date, why: inb.why,
            kind: it && it.kind, by: '앱' });
          if (r.ok) { done.push(r.rec); log('신청 들어옴', r.rec.kind, nm, r.rec.date, '앱'); }
          else failed.push(r.error);
        }
        if (!done.length) return sendJSON(res, 400, { ok: false, error: failed[0] || '넣지 못했습니다' });
        return sendJSON(res, 200, { ok: true, recs: done, rec: done[0],
          failed, n: done.length });
      }
      return sendJSON(res, 405, { ok: false, error: '그런 방법은 없습니다' });
    }

    // ── 화면
    if (req.method === 'GET' && (p === '/' || p === '/board')) {
      let html;
      try { html = fs.readFileSync(PAGE); } catch (e) {
        return send(res, 503, '<h1>배치표 화면이 아직 안 올라왔습니다</h1>', 'text/html; charset=utf-8');
      }
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    // ★화면의 '앱 반영' 단추가 이걸 읽어 '갔나 안 갔나'를 보여 준다.
    //   기다리는 시간(wait)도 같이 준다 — 화면이 '몇 초 뒤에 갑니다'를 제 입으로 못 지어내게
    if (req.method === 'GET' && p === '/ok') return sendJSON(res, 200, { ok: true, days: listDays().length,
      wait: Math.round(APPWAIT / 1000), app: APPURL ? (APPLAST || { note: '아직 보낸 적 없습니다' }) : null });

    // ── 저장된 날 목록
    if (req.method === 'GET' && p === '/api/days') return sendJSON(res, 200, { ok: true, days: listDays() });

    // ── 하루치 읽기
    if (req.method === 'GET' && p.startsWith('/api/day/')) {
      const d = p.slice(9);
      if (!okKey(d)) return sendJSON(res, 400, { ok: false, error: '날짜는 숫자 여덟 자리입니다' });
      const rec = readDay(d);
      if (!rec) return sendJSON(res, 404, { ok: false, error: '그 날 저장본이 없습니다' });
      return sendJSON(res, 200, { ok: true, ...rec, sig: sig(rec.s || '') });
    }

    // ── 하루치 저장
    //  ★판본 검사: 내가 읽어 간 뒤에 딴 사람이 고쳤으면 덮지 않는다.
    //    경기과 두 사람이 각자 짜다가 한쪽이 통째로 지워지는 일을 막는다.
    if (req.method === 'PUT' && p.startsWith('/api/day/')) {
      const d = p.slice(9);
      if (!okKey(d)) return sendJSON(res, 400, { ok: false, error: '날짜는 숫자 여덟 자리입니다' });
      const inb = JSON.parse(await body(req) || '{}');
      if (typeof inb.s !== 'string' || !inb.s) return sendJSON(res, 400, { ok: false, error: '저장할 내용이 없습니다' });
      const old = readDay(d);
      if (old && inb.base !== undefined && inb.base !== sig(old.s || '')) {
        return sendJSON(res, 409, {
          ok: false, error: '그새 딴 자리에서 고쳤습니다',
          at: old.at, by: old.by, sig: sig(old.s || ''),
        });
      }
      const rec = {
        v: String(inb.v || ''), sv: Number(inb.sv || 1), s: inb.s,
        label: String(inb.label || ''),          // 사람이 읽는 날짜 — '2026년 09월 12일'
        at: new Date().toISOString(), by: who,
      };
      if (old && old.s !== rec.s) keepPrev(d, old);   // ★덮는 순간 옛 판을 남긴다
      writeDay(d, rec);
      tellApp(d);              // ★앱에도 알린다 — 저장을 막지 않는다
      log('저장', d, (inb.s.length / 1024).toFixed(0) + 'KB', who);
      return sendJSON(res, 200, { ok: true, at: rec.at, sig: sig(rec.s) });
    }

    // ── 하루치 지우기 — 버리지 않고 옮겨 둔다
    if (req.method === 'DELETE' && p.startsWith('/api/day/')) {
      const d = p.slice(9);
      if (!okKey(d)) return sendJSON(res, 400, { ok: false, error: '날짜는 숫자 여덟 자리입니다' });
      if (!readDay(d)) return sendJSON(res, 404, { ok: false, error: '그 날 저장본이 없습니다' });
      const to = path.join(TRASH, d + '.' + Date.now() + '.json');
      fs.renameSync(dayFile(d), to);
      log('지움(치워 둠)', d);
      return sendJSON(res, 200, { ok: true });
    }

    // ── 설정 (명부·조·코스·격자)
    if (req.method === 'GET' && p === '/api/cfg') {
      const o = readCfg();
      return o ? sendJSON(res, 200, { ok: true, ...o }) : sendJSON(res, 404, { ok: false, error: '설정이 아직 없습니다' });
    }
    if (req.method === 'PUT' && p === '/api/cfg') {
      const inb = JSON.parse(await body(req) || '{}');
      if (typeof inb.s !== 'string' || !inb.s) return sendJSON(res, 400, { ok: false, error: '저장할 내용이 없습니다' });
      writeCfg({ sv: Number(inb.sv || 1), s: inb.s, at: new Date().toISOString(), by: who });
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { ok: false, error: '그런 길은 없습니다' });
  } catch (e) {
    log('★터짐', req.method, p, e.message);
    return sendJSON(res, 500, { ok: false, error: '서버 안에서 잘못됐습니다' });
  }
});

server.listen(PORT, HOST, () => {
  log(`배치표 서버 — http://${HOST}:${PORT}`);
  log(`  저장 자리 : ${DATA}  (지금 ${listDays().length}일치)`);
  log(`  화면 파일 : ${PAGE}`);
});
