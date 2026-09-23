// ══ 분실물 — 캐디가 올리면 경기과 배치표 프로그램으로 간다 ══════════════
//  ★장부는 여기 없다. 휴무 신청과 같다 — 보는 사람이 경기과에 있다.
//   앱에도 한 벌 적어 두지만 그건 '내가 올렸다'는 내 쪽 자국일 뿐이고,
//   손님에게 물건을 돌려주는 일은 경기과 장부에서 돈다.
//
//  ★못 닿아도 앱은 안 멈춘다. 캐디 화면에는 올린 것이 그대로 남고
//   '경기과에 아직 못 알림'으로 뜬다. 앱이 경기과 프로그램에 매여 있으면 안 된다.
//
//  ★어느 카트, 몇 부인지는 캐디가 안 적는다. 앱이 이미 알고 있는 것을 붙여 보낸다.
//   적으라고 하면 안 적고, 안 적으면 경기과가 어느 라운드 손님 것인지 모른다.
import { knock } from './dayoffreq.mjs';

// 앱 쪽 한 건을 경기과 장부의 한 줄과 묶는 번호.
//  ★같은 번호로 두 번 보내도 두 줄이 되지 않는다(경기과 쪽에서 막는다).
export const lostKey = (userId, dateISO, id) => `${userId}:${dateISO}:${id}`;

// 한 건 올리기. image 는 data:image/... 한 장(없어도 된다).
export const sendLost = (name, { appId, what, cart, part, image }) =>
  knock('POST', name, { body: { act: 'lost', appId, name: what, cart, part, image } });

// 무르기 — 경기과가 아직 안 본 것만 지워진다(받아 둔 뒤엔 경기과에 말해야 한다).
export const dropLost = (name, appId) =>
  knock('POST', name, { body: { act: 'lost-cancel', appId } });
