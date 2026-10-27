// 새 배치 소식 — 관리자 알림이 어떻게 찍히는지, 같은 글로 두 번 울리지 않는지 본다.
//  ★보내지는 않는다. 글을 짓는 것(compose)과 울릴지 정하는 것(shouldAlert)만 본다.
import { compose, shouldAlert } from '../src/boardnews.mjs';

let bad = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { bad++; console.log('  X   ' + m); } };
const show = (m) => console.log('       ┌ ' + m.title + '\n       └ ' + m.body.replace(/\n/g, '\n         '));

const board = { id: 28601, subject: '3부 25팀', writer: '정용만', images: ['x.jpg'] };
const text = { id: 28602, subject: '3부 16팀, 곽호완님까지 근무됩니다.', writer: '허웅진', images: [] };
const sum = { date: '10월 28일', lines: ['1부 커트 21번 · 06:44~08:50', '3부 커트 16번 임태희 · 15:40~17:28'] };

console.log('① 배치표를 읽었다');
let m = compose(board, { rawVerdict: {} }, 'new', sum); show(m);
ok(m.title === '새 배치표 — 10월 28일', '제목에 날짜');
ok(m.body.includes('3부 커트 16번 임태희 · 15:40~17:28'), '앱이 읽은 커트·티오프가 그대로 적힌다');
ok(m.body.includes('정용만 「3부 25팀」'), '누가 올린 어느 글인지');

console.log('② 같은 글 사진이 바뀌었다');
m = compose(board, { rawVerdict: {} }, 'revised', sum); show(m);
ok(m.title.startsWith('배치표 수정'), '수정으로 알린다');

console.log('③ 읽다가 막혔다');
m = compose(board, { boardReadFailed: true, boardReadReason: '티오프표를 못 읽음' }, 'new', sum); show(m);
ok(/아직 못 읽었습니다/.test(m.title) && /다시 시도/.test(m.body), '못 읽었다고, 다시 시도 중이라고');
ok(!m.body.includes('커트'), '못 읽은 글에 남의 판 숫자를 섞지 않는다');

console.log('④ 글로만 온 소식');
m = compose(text, { rawVerdict: {} }, 'new', { date: '', lines: [] }); show(m);
ok(m.title === '새 배치 소식' && m.body.includes('곽호완님까지'), '제목이 곧 내용');

console.log('⑤ 판독을 꺼 둔 상태');
m = compose(board, {}, 'new', { date: '', lines: [] }); show(m);
ok(/판독 꺼짐/.test(m.body), '앱이 안 읽었다고 솔직하게');

console.log('⑥ 한 글에 한 번');
const seen = {};
let d = shouldAlert(seen, 'new:1', { rawVerdict: {} });
ok(d.go && d.state === 'ok', '처음 보는 글 → 울린다');
seen['new:1'] = { state: 'ok', at: Date.now() };
ok(!shouldAlert(seen, 'new:1', { rawVerdict: {} }).go, '두 번째 → 안 울린다');

console.log('⑦ 못 읽었다가 읽어 내면 한 번 더');
d = shouldAlert(seen, 'new:2', { boardReadFailed: true });
ok(d.go && d.state === 'fail', '처음 실패 → 울린다');
seen['new:2'] = { state: 'fail', at: Date.now() };
ok(!shouldAlert(seen, 'new:2', { boardReadFailed: true }).go, '또 실패 → 안 울린다(크롤러가 몇 번 다시 시도한다)');
ok(shouldAlert(seen, 'new:2', { rawVerdict: {} }).go, '이번엔 읽었다 → 한 번 더 울린다');

console.log('⑧ 안 울릴 글');
ok(!shouldAlert({}, 'new:3', { relevant: false }).go, '앱이 잡담이라고 본 글');
ok(!shouldAlert({}, 'new:4', { adminOnly: true }).go, '\'못 읽은 글\' 알림이 이미 간 글(두 번 안 울림)');

console.log(bad ? `\n✗ ${bad}군데 어긋났습니다` : '\n✓ 모두 맞습니다');
process.exit(bad ? 1 : 0);
