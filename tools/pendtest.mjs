// 끝점 검사 검증 — '봤는데 반영 안 됐다'가 정말 사람에게 가는가.
//  실행: DATA_DIR=<임시> node tools/pendtest.mjs   (푸시는 안 나간다 — 관리자 계정이 없는 임시 DATA_DIR)
import fs from 'node:fs';
import path from 'node:path';
const P = await import('../src/boardpending.mjs');
const { DATA_DIR } = await import('../src/store.mjs');

const cases = [
  ['2026년 08월 17일 월요일', '20260817'],
  ['2026년 8월 17일 월요일 배치표입니다.', '20260817'],
  ['8월 17일 배치표', '20260817'],
  ['제목에 날짜 없음', ''],
];
let ok = 0;
for (const [label, want] of cases) {
  const got = P.keyFromLabel(label, new Date('2026-08-16T19:00:00').getTime());
  const pass = got === want;
  ok += pass ? 1 : 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  "${label}" → ${got || '(빈값)'}${pass ? '' : ` (기대 ${want})`}`);
}
console.log(`날짜 판별 ${ok}/${cases.length}\n`);

P.notePending({ articleId: '27356', subject: '8월 17일 배치표입니다.', dateKey: '20260817', reason: '티오프표를 못 읽음' });
P.notePending({ articleId: '27356', subject: '8월 17일 배치표입니다.', dateKey: '20260817', reason: '티오프표를 못 읽음' });
console.log('대기표:', JSON.stringify(P.allPending()));

let r = await P.checkPending([]);
console.log(`① 방금 실패        → 알림 ${r.alerted}건  (기대 0 — 아직 판독 중일 수 있다)`);
r = await P.checkPending(['20260817']);
console.log(`② 반영 확인        → 남은 ${r.pending}건·알림 ${r.alerted}건  (기대 0·0)`);

P.notePending({ articleId: '27357', subject: '8월 17일 배치표', dateKey: '20260817', reason: '캡 소진' });
const f = path.join(DATA_DIR, 'board-pending.json');
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
j['27357'].firstAt = Date.now() - 20 * 60 * 1000;
fs.writeFileSync(f, JSON.stringify(j));
r = await P.checkPending([]);
console.log(`③ 20분째 미반영    → 알림 ${r.alerted}건  (기대 1)`);
r = await P.checkPending([]);
console.log(`④ 다시 확인        → 알림 ${r.alerted}건  (기대 0 — 폭풍 방지)`);
P.clearPending('27357', '테스트 정리');
