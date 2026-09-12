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
function page(title, inner) {
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
</style></head><body><div class="box">${inner}</div></body></html>`;
}
const gatePage = (bad) => page('경기과 배치표', `<h1>경기과 배치표</h1>
<p class="sub">입장 코드를 넣으십시오.
캐디분들 실명이 들어 있어 문을 걸어 두었습니다.</p>
<form method="POST" action="${BASE}/gate">
 <input name="code" placeholder="RH-XXXX-XXXX" autocomplete="off" autocapitalize="characters" autofocus>
 <button type="submit">들어가기</button>
</form>${bad ? `<p class="bad">${bad}</p>` : ''}`);
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
    const me = OPEN ? { name: '경기과', role: 'ops', code: '' } : sessWho(cookieOf(req, 'bpass'));
    if (!me) {
      if (p.indexOf('/api/') >= 0) return sendJSON(res, 401, { ok: false, error: '입장 코드가 필요합니다' });
      return send(res, 401, gatePage(''), 'text/html; charset=utf-8');
    }
    const who = me.name;
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
