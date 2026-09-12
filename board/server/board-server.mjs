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

for (const d of [DATA, DAYS, TRASH]) fs.mkdirSync(d, { recursive: true });

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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  const who = '경기과';                      // ★신분 확인은 다음 단계에서 앱 창구로 잇는다

  try {
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
