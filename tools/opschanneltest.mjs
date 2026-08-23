// 운영 알림 통로 검사 — '시스템 사정' 알림이 회원 알림 장부·대기열로 되돌아가지 않게 못을 박는다.
//  이 검사가 지키는 것은 '누가 받느냐'가 아니다(그건 원래도 관리자뿐이었다). 지키는 건 두 가지다:
//   · 장부: 운영 잡음이 sent-push.jsonl에 섞이면 모니터의 회원 피드와 관문의 '오늘 N건'이 오염된다.
//   · 대기열: 밤에 온 운영 알림이 회원 정정 대기열에 쌓이면 아침에 회원 알림과 함께 쏟아진다.
//  소스를 직접 읽어 검사한다 — 코드가 바뀌면 검사도 같이 틀어져야 하니까.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ★줄바꿈은 CRLF를 벗기고, 주석은 지우고 읽는다.
//  · CR이 남으면 함수 경계를 못 찾아 함수 하나를 통째로 지나친 채 엉뚱한 곳을 검사한다.
//  · 주석을 남기면 '스위치는 deliver가 본다' 같은 설명글이 코드로 오인돼 헛경보가 난다.
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^[ \t]*\/\/.*$/gm, '');

let bad = 0;
const ok = (cond, label, why = '') => {
  console.log(`  ${cond ? 'OK ' : 'X  '} ${label}${cond || !why ? '' : `\n       ${why}`}`);
  if (!cond) bad++;
};

const push = read('src/push.mjs');

console.log('\n[장부를 나눈다]');
ok(/export async function broadcastOps\(/.test(push), 'push.mjs가 운영 통로를 내보낸다');
{
  const body = push.slice(push.indexOf('export async function broadcastOps('));
  const end = body.indexOf('\n}\n');
  const fn = body.slice(0, end);
  ok(/deliver\([^)]*'sent-ops\.jsonl'\)/.test(fn), '운영 알림은 sent-ops.jsonl에 적는다');
  ok(!/sent-push\.jsonl/.test(fn), '운영 알림이 회원 장부를 건드리지 않는다');
  ok(/adminUserIds\(\)/.test(fn), '받는 사람은 관리자뿐이다');
}
{
  const i = push.indexOf('export async function broadcast({');
  const fn = push.slice(i, push.indexOf('\n}\n', i));
  ok(/deliver\([^)]*'sent-push\.jsonl'\)/.test(fn), '회원 알림은 sent-push.jsonl에 적는다');
  ok(/enqueueDeferred\(/.test(fn), '회원 알림의 조용시간은 회원 대기열로 간다');
}

console.log('\n[대기열을 나눈다]');
ok(/deferred-ops\.json/.test(push), '운영 대기열 파일이 따로 있다');
{
  const i = push.indexOf('export async function flushDeferred()');
  const fn = push.slice(i, push.indexOf('\n}\n', i));
  const opsAt = fn.indexOf('loadOpsDeferred()');
  const memAt = fn.indexOf('loadDeferred()');
  ok(opsAt > -1 && memAt > -1 && opsAt < memAt, '아침 flush는 운영 대기열을 먼저 비운다',
    '관리자가 상황부터 알아야 회원 알림을 판단할 수 있다');
  ok(/saveOpsDeferred\(\{\}\)/.test(fn), '보내기 전에 비운다(재진입·중복 방지)');
}

console.log('\n[비발송 스위치는 둘 다 지킨다]');
{
  const i = push.indexOf('async function deliver(');
  const fn = push.slice(i, push.indexOf('\n}\n', i));
  ok(/PUSH_DISABLED/.test(fn) && /push-disabled/.test(fn), '스위치가 실제 전송 지점에 있다',
    '회원 경로에만 있으면 두 서버가 관리자 폰에 진단 알림을 두 번 쏜다');
  const bi = push.indexOf('export async function broadcast({');
  const bfn = push.slice(bi, push.indexOf('\n}\n', bi));
  ok(!/PUSH_DISABLED/.test(bfn), '회원 경로에 스위치가 중복으로 남아있지 않다');
}

console.log('\n[운영 알림이 회원 통로로 되돌아가지 않는다]');
const OPS_TITLES = [
  ['src/boardalert.mjs', '판독 확인 필요'],
  ['src/monitor.mjs', '시스템 진단'],
  ['src/server.mjs', '네이버 쿠키 만료'],
  ['src/server.mjs', '새 캐디 가입'],
  ['src/server.mjs', '못 읽은 글 — 확인 필요'],   // 옛 이름은 '판독 실패' — 판독기가 안 돈 글까지 실패라 불러 잡담에 알림이 갔다(2026-08-23)
  ['src/server.mjs', '테스트 알림'],
];
for (const [file, title] of OPS_TITLES) {
  const s = read(file);
  const i = s.indexOf(`'${title}`) >= 0 ? s.indexOf(`'${title}`) : s.indexOf(`\`${title}`);
  ok(i > -1, `${title} — 문구가 아직 있다`);
  if (i < 0) continue;
  // 이 문구를 감싼 호출이 회원 통로(broadcast)인지 운영 통로(broadcastOps/broadcastAdmins)인지 본다.
  const before = s.slice(Math.max(0, i - 400), i);
  const call = [...before.matchAll(/\b(broadcastOps|broadcastAdmins|broadcast)\s*\(/g)].pop();
  ok(call && call[1] !== 'broadcast', `${title} — 운영 통로로 나간다`,
    call ? `지금은 ${call[1]}(...) 로 나간다` : '감싼 호출을 못 찾음');
}
ok(/const broadcastAdmins = \(msg\) => broadcastOps\(msg\);/.test(read('src/server.mjs')),
  'broadcastAdmins는 운영 통로의 다른 이름일 뿐이다');

console.log('\n[볼 자리가 있다]');
ok(/sent-ops\.jsonl/.test(read('src/analytics.mjs')), '모니터가 운영 장부를 읽는다');
{
  const html = read('monitor/index.html');
  ok(/id="opsTbl"/.test(html) && /id="opsRange"/.test(html), '모니터에 운영 알림 패널이 있다',
    '회원 피드에서 뺐는데 볼 자리가 없으면 분리가 아니라 실종이다');
  ok(/s\.ops/.test(html), '패널이 실제로 ops 데이터를 그린다');
}

console.log(bad ? `\n${bad}건 실패\n` : '\n전부 통과\n');
process.exit(bad ? 1 : 0);
