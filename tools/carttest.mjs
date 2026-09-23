// 카트 점검 — 칸이 여럿인 날이 제대로 도는지 본다.
//  ★무엇을 못 박나
//   ① 옛 기록(cartNo 한 칸)이 목록으로 그대로 흡수된다
//   ② 칸을 늘리면 앞 카트가 '내놓음'이 된다
//   ③ 사진은 칸마다 따로 쌓이고, 첫 칸은 옛 이름(intake/exit) 그대로다
//   ④ 칸을 지우면 그 칸 사진이 사라지고 뒤 칸이 한 자리 당겨진다
//   ⑤ 도장을 막는 것은 번호와 장비 4종뿐이다 — 사진은 안 막는다
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import * as cc from '../src/cartcheck.mjs';

const UID = 990001;                       // 시험 전용 회원 — 끝나면 통째로 지운다
const D = '2026-09-23';
const dir = path.join(DATA_DIR, 'users', String(UID));
fs.rmSync(dir, { recursive: true, force: true });

let bad = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { bad++; console.log('  X   ' + m); } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

console.log('① 옛 기록 흡수');
cc.setCartNo(D, '12', UID);
let d = cc.getDay(D, UID);
ok(d.carts.length === 1 && d.carts[0].no === '12', '한 칸에 12번');
ok(d.cartNo === '12', '옛 이름(cartNo)도 거울로 남는다');

console.log('② 칸 늘리기');
d = cc.addCart(D, UID);
ok(d.carts.length === 2, '두 칸이 됐다');
ok(!!d.carts[0].outAt, '앞 카트는 내놓은 것이 됐다');
ok(d.carts[1].no === '', '새 칸은 번호가 비어 있다');

console.log('③ 사진은 칸마다 따로');
cc.savePhoto(D, 'intake', png, UID);
cc.savePhoto(D, 'exit', png, UID);
d = cc.savePhoto(D, 'intake#2', png, UID);
ok((d.photos.intake || []).length === 1, '첫 칸은 옛 이름 그대로(intake)');
ok((d.photos['intake#2'] || []).length === 1, '두 번째 칸은 intake#2');
ok(d.returnStatus.cartShots[0].before === 1 && d.returnStatus.cartShots[1].before === 1, '칸마다 따로 센다');
ok(cc.savePhoto(D, 'intake#9', png, UID) === null, '없는 칸 이름은 안 받는다');

console.log('④ 막는 것은 번호와 장비뿐');
let st = cc.getDay(D, UID).returnStatus;
ok(st.nums.need.length === 1 && st.nums.need[0] === 1, '두 번째 칸 번호가 비었다고 짚는다');
ok(!st.allDone, '번호가 비면 도장이 안 찍힌다');
ok(cc.setStamp(D, true, UID).stampError === 'incomplete', '도장이 거절된다');
cc.setCart(D, 1, { no: '27' }, UID);
for (const k of ['battery', 'tablet', 'radio', 'guidekey']) cc.toggleReturn(D, k, true, UID);
d = cc.getDay(D, UID);
ok(d.returnStatus.allDone, '번호 둘 + 장비 넷이면 다 됐다');
ok(d.returnStatus.total === 5, '칸은 다섯이다(번호 하나 + 장비 넷)');
ok(!!cc.setStamp(D, true, UID).stampedAt, '도장이 찍힌다');

console.log('⑤ 사진은 도장을 안 막는다');
d = cc.getDay(D, UID);
ok(!!d.stampedAt && d.returnStatus.clubShots[0].before === 0, '클럽 사진이 한 장도 없는데 도장은 찍혀 있다');

console.log('⑥ 칸을 지우면 뒤 칸이 당겨진다');
cc.setStamp(D, false, UID);
cc.savePhoto(D, 'exit#2', png, UID);
const before2 = cc.getDay(D, UID).photos['intake#2'][0];
d = cc.removeCart(D, 0, UID);
ok(d.carts.length === 1 && d.carts[0].no === '27', '앞 칸이 지워지고 27번만 남았다');
ok((d.photos.intake || [])[0] === before2, '두 번째 칸 사진이 첫 칸으로 당겨졌다');
ok(!d.photos['intake#2'] || !d.photos['intake#2'].length, '빈 칸 이름은 걷혔다');
ok(d.cartNo === '27', '거울도 따라 바뀐다');

console.log('⑦ 충전은 꽂은 시각만');
d = cc.setCart(D, 0, { chg: true }, UID);
ok(d.carts[0].chg && d.carts[0].chgAt > 0, '꽂은 시각이 찍힌다');
const at = d.carts[0].chgAt;
d = cc.setCart(D, 0, { no: '28' }, UID);
ok(d.carts[0].chgAt === at, '딴 것을 고쳐도 꽂은 시각은 안 바뀐다');
d = cc.setCart(D, 0, { chg: false }, UID);
ok(!d.carts[0].chg && !d.carts[0].chgAt, '뽑으면 시각도 지워진다');

console.log('⑧ 분실물 — 경기과에 갔는지 자국');
d = cc.addLostItem(D, '검정 지갑', null, UID);
const lid = d.lostItems[0].id;
ok(!d.lostItems[0].sentAt, '처음에는 아직 안 갔다');
d = cc.markLostSent(D, lid, true, UID);
ok(!!d.lostItems[0].sentAt && !d.lostItems[0].sendFail, '갔다고 적힌다');
d = cc.markLostSent(D, lid, false, UID);
ok(!d.lostItems[0].sentAt && d.lostItems[0].sendFail, '못 갔으면 못 갔다고 적힌다');

console.log('⑨ 45일 지난 날은 사진까지 걷는다');
const files = () => fs.readdirSync(path.join(dir, 'photos')).length;
const n = files();
ok(n === 2, `사진 파일 ${n}장이 남아 있다`);   // 앞 칸을 지울 때 그 칸 두 장은 이미 걷혔다
const r = cc.pruneOld(UID, '2026-12-01');
ok(r.days === 1 && files() === 0, `날 ${r.days}개와 사진 ${r.files}장이 함께 걷혔다`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n✗ ${bad}군데 어긋났습니다` : '\n✓ 모두 맞습니다');
process.exit(bad ? 1 : 0);
