// 분실물 — 앱이 두드리면 경기과 장부에 서는지, 화면에 뜨는지 본다.
//  배치표 서버를 시험용 자리에 잠깐 띄워 실제로 문을 두드려 본다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'losttest-'));
const PORT = 3391, KEY = 'test-door-key', B = `http://127.0.0.1:${PORT}`;
let bad = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { bad++; console.log('  X   ' + m); } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const srv = spawn(process.execPath, [path.join(ROOT, 'board', 'server', 'board-server.mjs')], {
  env: { ...process.env, BOARD_PORT: String(PORT), BOARD_DATA: DATA, BOARD_REQ_KEY: KEY, BOARD_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stderr.on('data', (d) => process.stderr.write('[서버] ' + d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const door = (body) => fetch(`${B}/api/app/req?name=${encodeURIComponent('김홍구')}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-board-req-key': KEY },
  body: JSON.stringify(body),
});

try {
  for (let i = 0; i < 40; i++) { try { await fetch(`${B}/ok`); break; } catch (e) { await wait(150); } }

  console.log('① 열쇠가 없으면 안 열린다');
  const noKey = await fetch(`${B}/api/app/req?name=김홍구`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ act: 'lost', name: '지갑' }) });
  ok(noKey.status === 401, '열쇠 없는 두드림은 401');

  console.log('② 앱이 한 건 올린다');
  let r = await (await door({ act: 'lost', appId: '1:2026-09-23:l1', name: '검정 지갑', cart: '12', part: '1부', image: png })).json();
  ok(r.ok && r.id === 1, '장부에 한 줄이 섰다');
  const book = JSON.parse(fs.readFileSync(path.join(DATA, 'lost.json'), 'utf-8'));
  ok(book.list[0].by === '김홍구', '이름은 앱 서버가 붙인 것으로 적힌다');
  ok(book.list[0].part === '1부' && book.list[0].cart === '12', '몇 부 몇 번 카트가 같이 왔다');
  ok(!!book.list[0].photo && fs.existsSync(path.join(DATA, 'lostphoto', book.list[0].photo)), '사진도 같이 저장됐다');
  ok(book.list[0].state === 'new', '아직 안 본 것으로 선다');

  console.log('③ 같은 건을 또 보내도 두 줄이 안 된다');
  r = await (await door({ act: 'lost', appId: '1:2026-09-23:l1', name: '검정 지갑' })).json();
  ok(r.ok && JSON.parse(fs.readFileSync(path.join(DATA, 'lost.json'), 'utf-8')).list.length === 1, '한 줄 그대로');

  console.log('④ 단추가 스스로 말한다');
  let peek = await (await fetch(`${B}/api/lost`)).json();
  ok(peek.ok && peek.wait === 1, '기다리는 건수 1');

  console.log('⑤ 경기과 화면에 뜬다');
  let html = await (await fetch(`${B}/lost`)).text();
  ok(html.includes('검정 지갑'), '물건 이름이 보인다');
  ok(html.includes('김홍구') && html.includes('1부 12번 카트'), '누가·어디서가 같이 보인다');
  ok(html.includes('새 신고'), '안 본 것에 딱지가 붙는다');

  console.log('⑥ 사진 한 장 — 장부에 적힌 이름만 내준다');
  const fn = book.list[0].photo;
  ok((await fetch(`${B}/lost/photo/${fn}`)).status === 200, '적힌 사진은 나온다');
  ok((await fetch(`${B}/lost/photo/none.jpg`)).status === 404, '없는 이름은 404');

  console.log('⑦ 경기과가 받아 둔다');
  const form = (o) => new URLSearchParams(o).toString();
  await fetch(`${B}/lost`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ act: 'keep', id: '1' }) });
  peek = await (await fetch(`${B}/api/lost`)).json();
  ok(peek.wait === 0, '받아 두면 단추가 식는다');

  console.log('⑧ 받아 둔 뒤에는 앱에서 물려도 장부가 안 지워진다');
  r = await (await door({ act: 'lost-cancel', appId: '1:2026-09-23:l1' })).json();
  ok(!r.ok && /받아/.test(r.error || ''), '까닭을 대며 거절한다');
  ok(JSON.parse(fs.readFileSync(path.join(DATA, 'lost.json'), 'utf-8')).list.length === 1, '줄은 그대로 남는다');

  console.log('⑨ 아직 안 본 것은 앱에서 무를 수 있다');
  await (await door({ act: 'lost', appId: '1:2026-09-23:l2', name: '선글라스', cart: '12', part: '1부' })).json();
  r = await (await door({ act: 'lost-cancel', appId: '1:2026-09-23:l2' })).json();
  ok(r.ok && JSON.parse(fs.readFileSync(path.join(DATA, 'lost.json'), 'utf-8')).list.length === 1, '안 본 것은 따라 지워진다');

  console.log('⑩ 주인에게 전달하면 처리할 것에서 빠진다');
  await fetch(`${B}/lost`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ act: 'done', id: '1' }) });
  html = await (await fetch(`${B}/lost`)).text();
  ok(!html.includes('검정 지갑'), '처리할 것에서 빠졌다');
  html = await (await fetch(`${B}/lost?all=1`)).text();
  ok(html.includes('검정 지갑') && html.includes('주인에게 전달함'), '전부 보기에는 남아 있다');

  console.log('⑪ 남의 이름으로는 못 무른다');
  await (await door({ act: 'lost', appId: '1:2026-09-23:l3', name: '모자' })).json();
  const other = await fetch(`${B}/api/app/req?name=${encodeURIComponent('강민순')}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-board-req-key': KEY },
    body: JSON.stringify({ act: 'lost-cancel', appId: '1:2026-09-23:l3' }) });
  ok(other.status === 400, '본인 것만 무를 수 있다');
} finally {
  srv.kill();
  await wait(200);
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(bad ? `\n✗ ${bad}군데 어긋났습니다` : '\n✓ 모두 맞습니다');
process.exit(bad ? 1 : 0);
