// '판독 실패' 관리자 알림 — 실제로 실패했을 때만 울리는가.
//  글감은 지어내지 않았다. 8/20~8/23에 실제로 관리자 폰을 울린 다섯 건 그대로다.
import { decide, hardScheduleFact, scheduleHint, cheapRelevance } from '../src/judge.mjs';

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };
const ME = { name: '김홍구', part: '3', commuteMin: 30 };
const art = (t) => ({ subject: `[카톡 · 리버힐 주임님] ${t}`, text: t });
// 판독기가 안 돈 텍스트 글(코드가 물러나고 Gemini는 꺼짐) — 오늘 실서버와 같은 조건.
const noRead = (t) => decide(art(t), null, ME, { readerRan: false });
const ranAndFailed = (t) => decide(art(t), null, ME, { readerRan: true });

console.log('\n── 잡담에는 울리지 않는다(실제로 울렸던 것들) ──');
[
  ['3부순번은 마감때 바꿀께요', '8/23 16:18'],
  ['내일 하우스,3부 휴무 짤릴수있습니다.', '8/21 08:40'],
  ['추석연휴때 휴무신청하신분들~~~추석연휴기간으로 하우스,3부 모두신청받을거에요', '8/20 19:17'],
].forEach(([t, when]) => {
  const d = noRead(t);
  ok(!d.adminOnly, `${when} "${t.slice(0, 20)}…"`, '반영할 값이 없는 글이다 — 아무도 실패하지 않았다');
});

console.log('\n── 반영할 값이 있는데 못 읽었으면 울린다 ──');
{
  const t = '내일 3부에서 54지원많이도와주셨음에도 휴무는 천예영님까지 나갑니다.';
  ok(noRead(t).adminOnly === true, '8/22 "…휴무는 천예영님까지 나갑니다"', '"○○님까지"는 우리가 읽었어야 할 값이다');
}
[
  ['금일 3부 16팀입니다', '"N팀"'],
  ['3부 17:35 티오프 변경됐습니다', '티오프 시각'],
  ['3부 12번까지 근무입니다', '순번 지목'],
  ['스페어 1번 조하빈님', '스페어 앵커'],
  ['3부 당일추가 있습니다', '당일추가'],
].forEach(([t, why]) => ok(noRead(t).adminOnly === true, `${why} — "${t}"`));

console.log('\n── 판독기가 실제로 돌고 실패했으면, 잡담이어도 울린다 ──');
{
  // 배치표 이미지가 왔는데 판독기가 전부 실패한 경우 — 이건 진짜 실패다. 예전과 똑같이 알린다.
  const d = ranAndFailed('3부순번은 마감때 바꿀께요');
  ok(d.adminOnly === true, '판독기가 돌았으면 결과가 없어도 실패로 본다', '실패를 조용히 넘기면 배치표가 옛것에 얼어붙는다');
}

console.log('\n── 그물(scheduleHint)은 그대로 넓게, 체(hardScheduleFact)만 좁게 ──');
{
  ok(scheduleHint('3부순번은 마감때 바꿀께요') === true, '그물은 여전히 잡담도 건진다(놓침 방지)');
  ok(hardScheduleFact('3부순번은 마감때 바꿀께요') === false, '체는 반영할 값이 없으면 흘려보낸다');
  ok(hardScheduleFact('16팀 오동현님까지 근무됩니다') === true, '체는 값이 있으면 붙잡는다');
  ok(hardScheduleFact('번호표 작성했습니다') === false, '"번호"는 순번이 아니다', '\d번 정규식이 "번호"를 물면 매일 울린다');
  ok(hardScheduleFact('3부 회식 참석자 받습니다') === false, '"3부"만으로는 값이 아니다');
}

console.log('\n── 남의 부 글은 예전처럼 조용하다 ──');
{
  ok(!noRead('1부 휴무 신청 받습니다').adminOnly, '1부 글은 3부 회원과 무관');
  ok(cheapRelevance('1부 휴무 신청 받습니다', ME) === 'other', '값싼 사전판정이 먼저 걸러낸다');
}

console.log('\n── 걸러낸 글도 피드에는 남는다(데이터를 버리지 않는다) ──');
{
  const d = noRead('3부순번은 마감때 바꿀께요');
  ok(d.push === 'low', '푸시는 안 하고');
  ok(d.relevant === true, '피드에는 남긴다', '조용히 지워버리면 나중에 되짚을 수가 없다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
