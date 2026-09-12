// ══════════════════════════════════════════════════════════════
//  입장 코드 발급·회수 — 관리자가 쓴다.
//    node server/board-pass.mjs list
//    node server/board-pass.mjs add "박주임"
//    node server/board-pass.mjs off  RH-7K2M-94PX
//  ★코드는 사람마다 하나씩 준다. 그래야 누가 고쳤는지 남고, 한 사람만 거둘 수 있다.
// ══════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.BOARD_DATA || '/home/ada/riverhill-board/data';
const PASSF = path.join(DATA, 'passes.json');
const SESSF = path.join(DATA, 'sessions.json');
const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // 0 O 1 I 는 뺀다 — 받아 적는 코드다

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { return d; } };
const wr = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), 'utf-8'); fs.renameSync(t, f); };
const norm = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const pick = (n) => Array.from(crypto.randomBytes(n)).map((b) => ABC[b % ABC.length]).join('');
const when = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');

fs.mkdirSync(DATA, { recursive: true });
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'add') {
  const name = rest.join(' ').trim();
  if (!name) { console.log('  쓰는 법: board-pass.mjs add "박주임"'); process.exit(1); }
  const list = rd(PASSF, []);
  const rec = { code: 'RH-' + pick(4) + '-' + pick(4), name, role: 'ops',
                made: new Date().toISOString(), seen: '', uses: 0, off: false };
  list.push(rec); wr(PASSF, list);
  console.log('');
  console.log('  ' + rec.name + ' 님 입장 코드');
  console.log('  ┌────────────────┐');
  console.log('  │  ' + rec.code + '  │');
  console.log('  └────────────────┘');
  console.log('  이 코드를 그 분에게만 알려 주십시오. 한 번 넣으면 그 기기가 기억합니다.');
  console.log('');
} else if (cmd === 'off') {
  const want = norm(rest[0]);
  const list = rd(PASSF, []);
  const hit = list.filter((x) => norm(x.code) === want);
  if (!hit.length) { console.log('  그런 코드가 없습니다'); process.exit(1); }
  hit.forEach((x) => { x.off = true; });
  wr(PASSF, list);
  const ss = rd(SESSF, {}); let n = 0;
  for (const k of Object.keys(ss)) if (norm(ss[k].code) === want) { delete ss[k]; n++; }
  wr(SESSF, ss);
  console.log('  ' + hit[0].name + ' 님 코드를 거뒀습니다 · 쓰던 기기 ' + n + '대도 같이 나갔습니다');
} else {
  const list = rd(PASSF, []);
  const ss = rd(SESSF, {});
  if (!list.length) { console.log('  아직 발급한 코드가 없습니다'); process.exit(0); }
  console.log('  코드            이름        상태   마지막 들어온 때   쓰는 기기');
  for (const x of list) {
    const dev = Object.values(ss).filter((v) => norm(v.code) === norm(x.code)).length;
    console.log('  ' + x.code.padEnd(15) + String(x.name).padEnd(11)
      + (x.off ? '거둠 ' : '살아있음').padEnd(6) + ' ' + when(x.seen).padEnd(18) + dev + '대');
  }
}
