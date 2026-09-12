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

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOST = process.env.BOARD_HOST || '127.0.0.1';
const PORT = Number(process.env.BOARD_PORT || 3300);
const DATA = process.env.BOARD_DATA || path.join(ROOT, 'data');
const PAGE = process.env.BOARD_PAGE || path.join(ROOT, 'public', 'index.html');
const DAYS = path.join(DATA, 'days');
const TRASH = path.join(DATA, 'trash');       // ★지운 것도 한동안 둔다 — 실수는 되돌릴 수 있어야 한다
const PREV = path.join(DATA, 'prev');         // ★덮기 전의 옛 판 — 둘이 동시에 짜다 한쪽을 덮어도 되찾을 수 있게
const KEEPPREV = Number(process.env.BOARD_KEEPPREV || 10);

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

// ══ 문지기 ═══════════════════════════════════════════════════
// ★배치표는 앱 로그인을 '빌려' 쓴다. 앱과 합치지 않는다.
//   같은 주소 밑(…/board)에 서므로 앱 로그인 쿠키가 이쪽으로도 온다.
//   그 쿠키를 들고 앱에 "이 사람 누구요?" 한 줄만 묻는다. 앱 데이터는 안 본다.
//   앱이 안 서 있거나 열쇠가 안 맞으면 아무도 못 들어온다 — 열어 두느니 닫는다.
const APP = process.env.BOARD_APP || 'http://127.0.0.1:3000';
const BRIDGE = process.env.BOARD_BRIDGE_KEY || '';
const BASE = (process.env.BOARD_BASE || '').replace(/\/+$/, '');   // 밖에서 보이는 앞길 (예: /board)
const ALLOW = String(process.env.BOARD_ALLOW_ROLES || 'admin,ops').split(',').map((s) => s.trim()).filter(Boolean);
const OPEN = process.env.BOARD_OPEN === '1';        // ★집 안에서만 쓰던 때로 돌리는 비상 스위치
const seen = new Map();                             // 쿠키 → { at, who } 짧게 기억한다(앱에 매번 안 묻게)
const SEEN_MS = 30 * 1000;

function cookieOf(req) {
  const h = req.headers.cookie || '';
  const m = h.match(/(?:^|;\s*)rh_sess=([^;]+)/);
  return m ? m[1] : '';
}
function askApp(tok) {
  return new Promise((done) => {
    const now = Date.now(), had = seen.get(tok);
    if (had && now - had.at < SEEN_MS) return done(had.who);
    const r = http.request(APP + '/api/board/who', {
      method: 'GET', timeout: 4000,
      headers: { 'Cookie': 'rh_sess=' + tok, 'X-Board-Key': BRIDGE },
    }, (rs) => {
      let b = '';
      rs.on('data', (c) => { b += c; });
      rs.on('end', () => {
        let who = null;
        try { const o = JSON.parse(b); if (o && o.ok) who = o; } catch (e) { /* 앱이 이상한 답을 주면 못 들어온다 */ }
        seen.set(tok, { at: now, who });
        if (seen.size > 500) seen.clear();
        done(who);
      });
    });
    r.on('error', () => done(null));
    r.on('timeout', () => { r.destroy(); done(null); });
    r.end();
  });
}
function page(title, msg, btn) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
 :root{color-scheme:light dark}
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      font:16px/1.7 -apple-system,'Malgun Gothic',sans-serif;background:#f4f6f8;color:#1d2733}
 .box{max-width:420px;padding:34px 30px;background:#fff;border:1.5px solid #d4dbe3;border-radius:14px;text-align:center}
 h1{margin:0 0 14px;font-size:20px}
 p{margin:0 0 22px;color:#4d5c6b;white-space:pre-line}
 a.go{display:inline-block;padding:13px 30px;background:#2f6db5;color:#fff;text-decoration:none;border-radius:9px;font-weight:700}
 @media(prefers-color-scheme:dark){body{background:#161a1f;color:#e7edf3}
  .box{background:#1e242b;border-color:#39424d}p{color:#a9b6c3}}
</style></head><body><div class="box"><h1>${title}</h1><p>${msg}</p>${btn}</div></body></html>`;
}
const loginPage = (backTo) => page('경기과 배치표',
  '리버힐 계정으로 로그인하셔야 볼 수 있습니다.\n캐디분들 실명이 들어 있어 문을 걸어 두었습니다.',
  `<a class="go" href="/api/auth/google?back=${encodeURIComponent(backTo)}">로그인하기</a>`);
const denyPage = (r) => page('들어올 수 없습니다',
  `로그인은 되었는데 배치표를 볼 수 있는 등급이 아닙니다.\n(지금 등급: ${r || '없음'})\n경기과로 등록해 달라고 관리자에게 말씀하십시오.`,
  '<a class="go" href="/">앱으로</a>');
const downPage = () => page('잠시 뒤에 다시',
  '신분을 확인해 주는 앱이 지금 응답하지 않습니다.\n잠시 뒤 새로고침해 주십시오.', '');

// 들여보내도 되는 사람인가 — 안 되면 보여 줄 화면을 돌려준다
async function guard(req, res) {
  if (OPEN) return true;                                  // 집 안에서만 쓰던 때로 돌리는 스위치
  if (!BRIDGE) { send(res, 503, downPage(), 'text/html; charset=utf-8'); return false; }
  const tok = cookieOf(req);
  const backTo = (BASE || '') + '/';
  if (!tok) { send(res, 401, loginPage(backTo), 'text/html; charset=utf-8'); return false; }
  const who = await askApp(tok);
  if (!who) { send(res, 503, downPage(), 'text/html; charset=utf-8'); return false; }
  if (!who.authed) { send(res, 401, loginPage(backTo), 'text/html; charset=utf-8'); return false; }
  if (who.status !== 'active' || ALLOW.indexOf(who.role) < 0) {
    send(res, 403, denyPage(who.role), 'text/html; charset=utf-8'); return false;
  }
  req._who = who;
  return true;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  try {
    if (!(await guard(req, res))) return;     // ★여기를 못 지나면 아무것도 안 보인다
    const who = (req._who && ('회원 ' + req._who.id)) || '경기과';
    // ── 화면
    if (req.method === 'GET' && (p === '/' || p === '/board')) {
      let html;
      try { html = fs.readFileSync(PAGE); } catch (e) {
        return send(res, 503, '<h1>배치표 화면이 아직 안 올라왔습니다</h1>', 'text/html; charset=utf-8');
      }
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && p === '/ok') return sendJSON(res, 200, { ok: true, days: listDays().length });

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
