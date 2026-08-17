// 카카오골프 여집합 엔진 불변식 — 가짜 시계로 하루를 재생해 규칙만 본다.
//  실데이터도, 진짜 네트워크도 안 쓴다(fetch를 갈아끼운다).
//
//  ★왜 있나: 이 엔진의 사고는 전부 '시간'에서 났다.
//   ①티오프 1시간 전 판매 마감을 예약으로 오인(오후가 갈수록 하루 전체가 만석이 됐다)
//   ②시각이 지나면 판정 자격이 사라져 이미 확정한 칸이 화면에서 조용히 실종(오염으로 오인됐다)
//   ③하루 끝의 정상적인 0칸을 고장으로 보고 관측이 통째로 멈춤
//   셋 다 실제로 났고, 셋 다 '지금 몇 시냐'를 바꿔야만 재현된다. 그래서 시계를 가짜로 만든다.
//  실행: node tools/kakaotest.mjs
process.env.KAKAO_TODAY = '1';

const RealDate = Date;
const R = new RealDate();
const Y = `${R.getFullYear()}${String(R.getMonth() + 1).padStart(2, '0')}${String(R.getDate()).padStart(2, '0')}`;

// 인자 없는 new Date()만 오늘 특정 시각으로 고정한다(다른 용법은 그대로).
let NOW_MIN = 0;
globalThis.Date = class extends RealDate {
  constructor(...a) {
    if (!a.length) { const d = new RealDate(); d.setHours(Math.floor(NOW_MIN / 60), NOW_MIN % 60, 0, 0); return d; }
    return new RealDate(...a);
  }
  static now() { return RealDate.now(); }
};

const { bookedFor, fixedSlots } = await import('../src/kakaogolf.mjs');

let OPEN = [];
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({ list: OPEN.map((k) => {
    const [t, c] = k.split('|');
    return { bookTime: t.replace(':', ''), CourseName: c, digitTime: 1, greenFeeDP: 100000 };
  }) }),
});

const say = (s) => console.log(s);
let fail = 0;
const ok = (c, m) => { say(`${c ? ' OK ' : '★NG '} ${m}`); if (!c) fail++; };
const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

const ALL = fixedSlots().map((f) => `${f.time}|${f.course}`);
const P3 = fixedSlots().filter((f) => f.part === '3').map((f) => `${f.time}|${f.course}`);
if (!P3.length) { say('기준표에 3부가 없다 — 검증 불가'); process.exit(1); }
const FIRST = P3[0].split('|')[0];
const SECOND = P3.find((k) => k.split('|')[0] !== FIRST).split('|')[0];
const TARGET = P3.find((k) => k.split('|')[0] > SECOND);      // 진짜 예약으로 쓸 칸
say(`기준표 ${ALL.length}칸 · 3부 첫 칸 ${FIRST} / 둘째 ${SECOND} / 검증 대상 ${TARGET}\n`);

let snap;
const p3 = () => (snap.byPart['3'] || []).map((x) => `${x.time}|${x.course}`);

// ① 아침 — 전 칸 판매중인데 TARGET만 사라졌다 = 진짜 예약
NOW_MIN = 9 * 60;
OPEN = ALL.filter((k) => k !== TARGET);
snap = await bookedFor(Y, {});
say(`① 09:00 판정시작선 ${snap.judgeableFrom} · 3부 찬칸 [${p3().join(' ')}]`);
ok(p3().includes(TARGET), `진짜 예약(${TARGET})을 아침에 잡는다`);

// ② 첫 칸 티오프 40분 전 — 카카오가 첫·둘째 칸을 판매에서 내린다(예약 아님)
NOW_MIN = mins(FIRST) - 40;
OPEN = OPEN.filter((k) => !k.startsWith(`${FIRST}|`) && !k.startsWith(`${SECOND}|`));
snap = await bookedFor(Y, snap);
say(`② ${hm(NOW_MIN)} 판정시작선 ${snap.judgeableFrom} · 3부 찬칸 [${p3().join(' ')}]`);
ok(!p3().some((k) => k.startsWith(`${FIRST}|`) || k.startsWith(`${SECOND}|`)),
  `마감으로 내려간 ${FIRST}·${SECOND}을 예약으로 안 센다`);
ok(p3().includes(TARGET), '아침에 확정한 칸은 그대로 남는다');

// ③ 대상 티오프가 지난 뒤 — 확정한 칸은 유지된다(16:25 실종 사고 재발 방지)
NOW_MIN = mins(TARGET.split('|')[0]) + 45;
OPEN = OPEN.filter((k) => mins(k.split('|')[0]) > NOW_MIN + 60);
snap = await bookedFor(Y, snap);
say(`③ ${hm(NOW_MIN)} 판정시작선 ${snap.judgeableFrom} · 3부 찬칸 [${p3().join(' ')}]`);
ok(p3().includes(TARGET), '티오프 시각이 지나도 확정한 칸이 사라지지 않는다');
ok(!p3().some((k) => mins(k.split('|')[0]) > NOW_MIN && k !== TARGET),
  '마감으로 내려간 뒷 칸들은 여전히 예약이 아니다');

// ④ 취소 — 다시 판매중이 되면 확정이 풀린다
OPEN = [...OPEN, TARGET];
snap = await bookedFor(Y, snap);
say(`④ 취소 후 3부 찬칸 [${p3().join(' ') || '없음'}]`);
ok(!p3().includes(TARGET), '다시 팔리면(취소) 확정이 풀린다');

// ⑤ 내일치 — 전부 미래라 마감선과 무관하게 판정한다
const T = new RealDate(); T.setDate(T.getDate() + 1);
const Y2 = `${T.getFullYear()}${String(T.getMonth() + 1).padStart(2, '0')}${String(T.getDate()).padStart(2, '0')}`;
OPEN = ALL.filter((k) => k !== TARGET);
const s2 = await bookedFor(Y2, {});
say(`⑤ 내일(${Y2}) 판정시작선 ${s2.judgeableFrom} · 3부 찬칸 ${(s2.byPart['3'] || []).length}칸`);
ok((s2.byPart['3'] || []).some((x) => `${x.time}|${x.course}` === TARGET), '내일치는 마감선 영향 없이 판정한다');

// ⑥ 하루 끝 — 판매중 0칸은 정상이다(매일 저녁 관측이 멈추던 문제)
NOW_MIN = 23 * 60;
OPEN = [];
let s3 = null, err = '';
try { s3 = await bookedFor(Y, { ...snap, everOpenCount: ALL.length }); } catch (e) { err = e.message; }
say(`⑥ 23:00 판매중 0칸 → ${s3 ? `정상 (찬칸 ${s3.bookedCount})` : `던짐: ${err}`}`);
ok(!!s3, '하루가 끝난 뒤의 0칸은 고장이 아니다');

// ⑦ 반대로 한낮의 0칸은 여전히 고장으로 막는다 — 전 칸 만석 처리 금지
NOW_MIN = 10 * 60;
let s4 = null; err = '';
try { s4 = await bookedFor(Y, { ...snap, everOpenCount: ALL.length }); } catch (e) { err = e.message; }
say(`⑦ 10:00 판매중 0칸 → ${s4 ? '정상(★위험)' : `던짐 — ${err.slice(0, 44)}`}`);
ok(!s4, '한낮의 0칸은 여전히 고장으로 막는다(없는 팀을 만들지 않는다)');

say(fail ? `\n★ ${fail}개 실패` : '\n★ 전부 통과');
process.exit(fail ? 1 : 0);
