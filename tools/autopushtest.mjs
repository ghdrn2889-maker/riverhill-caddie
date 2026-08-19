// 자동 알림의 두 가지 '사실'을 시험한다. 회원 데이터도 진짜 발송도 건드리지 않는다.
//
//  ① 배치표가 성립하는가(boardIntegrity) — 8/18에 다섯 명을 화면에서 지운 그 세 가지.
//  ② 중복 차단 서명이 사진 경로와 '글자까지' 같은가 — 다르면 같은 알림이 두 번 나간다.
//    서명 규칙을 두 파일에 각각 적어둔 이상, 둘이 같은지는 시험이 지켜야 한다.
import fs from 'node:fs';
import { boardIntegrity, stateSig, currentStateMsg } from '../src/boardpush.mjs';

let fail = 0;
const ok = (c, m) => { console.log(`${c ? ' OK ' : '★NG '} ${m}`); if (!c) fail++; };

// ── ① 배치표 성립 검사 ──────────────────────────────────────────────
const good = [
  { pos: 1, name: '정유경', tee: '16:32', course: 'OUT' },
  { pos: 2, name: '김동우', tee: '16:39', course: 'OUT' },
  { pos: 3, name: '장성원', tee: '', course: '' },        // 스페어 — 티오프 없는 건 정상
];
ok(boardIntegrity(good, 2).length === 0, '멀쩡한 배치표는 통과한다(스페어는 티오프가 없어도 된다)');

const dup = good.concat([{ pos: 4, name: '조하빈', tee: '16:32', course: 'OUT' }]);
ok(boardIntegrity(dup, 3).some((x) => x.includes('같은 칸')), '같은 칸에 두 명이 앉으면 잡는다(8/18 17:35·17:56·18:03)');

const noName = good.concat([{ pos: 4, name: '', tee: '16:46', course: 'OUT' }]);
ok(boardIntegrity(noName, 3).some((x) => x.includes('이름이 없음')), '티오프는 있는데 이름이 없으면 잡는다');

ok(boardIntegrity(good, 9).some((x) => x.includes('명단')), '커트가 명단보다 크면 잡는다(8/18 커트 24 / 명단 21)');

// 같은 시각이라도 코스가 다르면 다른 칸이다 — 이걸 겹침으로 세면 정상 배치표가 막힌다.
const bothCourses = [
  { pos: 1, name: '가', tee: '16:32', course: 'OUT' },
  { pos: 2, name: '나', tee: '16:32', course: 'IN' },
];
ok(boardIntegrity(bothCourses, 2).length === 0, '같은 시각 OUT·IN은 겹침이 아니다');

// ── ② 서명 일치 ─────────────────────────────────────────────────────
//  server.mjs가 실제로 쓰는 식을 소스에서 뽑아 그대로 돌려본다(주석이 아니라 코드를 본다).
const src = fs.readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const grab = (marker) => {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const a = src.indexOf('`', i), b = src.indexOf('`', a + 1);
  return src.slice(a, b + 1);
};
const confirmedTpl = grab("? `${ns.status}|${ns.teeTime");
const spareTpl = grab("`${ns.status}|${ns.teeTime || ''}|${ns.course || ''}|${ns.cutLine");
ok(!!confirmedTpl && !!spareTpl, `server.mjs에서 서명 식을 찾았다`);
if (confirmedTpl && spareTpl) {
  const mk = (tpl) => new Function('ns', 'return ' + tpl.replace(/ns\./g, 'ns.'));
  const cases = [
    { status: 'assigned', teeTime: '17:35', course: 'OUT', cutLine: 19, myPosition: 10 },
    { status: 'work', teeTime: '', course: '', cutLine: 19, myPosition: 3 },
    { status: 'off', teeTime: '', course: '', cutLine: 0, myPosition: 0 },
    { status: 'spare', teeTime: '', course: '', cutLine: 19, myPosition: 21 },
    { status: 'waiting', teeTime: '', course: '', cutLine: 20, myPosition: 21 },
  ];
  for (const ns of cases) {
    const confirmed = ['assigned', 'work', 'your_turn', 'off'].includes(ns.status);
    const theirs = mk(confirmed ? confirmedTpl : spareTpl)(ns);
    const ours = stateSig(ns);
    ok(theirs === ours, `서명 일치 [${ns.status}] ${ours}${theirs === ours ? '' : ` ≠ server ${theirs}`}`);
  }
}

// ── ③ 문구 ─────────────────────────────────────────────────────────
ok(currentStateMsg('3부', '김홍구', { status: 'assigned', teeTime: '17:35', course: 'OUT', myPosition: 10 }).body.includes('17:35(OUT) · 순번 10번'),
  '근무 문구에 티오프·코스·순번이 다 들어간다');
ok(currentStateMsg('3부', '박신훈', { status: 'off', offType: 'vacation' }).body.includes('휴가'), '휴무 종류를 구분한다');
ok(currentStateMsg('1부(조출)', '연승준', { status: 'spare', myPosition: 21 }).body.includes('스페어'), '스페어 문구');

// ── ④ 격자 밖 티오프 감지 ───────────────────────────────────────────
//  8/18 3부 17:30 — 예약팀이 팀을 하나 더 받으려고 격자 사이에 끼운 칸. 판독이 봤을 때 알아채야 한다.
{
  const { reframeSlots } = await import('../src/dayframe.mjs');
  const { fixedSlots } = await import('../src/kakaogolf.mjs');
  const base = fixedSlots();
  const r = reframeSlots(base, { cadence: 7, courses: ['OUT', 'IN'], frame: { 3: { extra: ['17:30|OUT'] } } });
  const p3 = r.slots.filter((x) => x.part === '3' && x.course === 'OUT').map((x) => x.time);
  const i = p3.indexOf('17:30');
  ok(i > 0 && p3[i - 1] === '17:28' && p3[i + 1] === '17:35', `끼운 칸이 시각 자리에 들어간다 (…${p3[i - 1]} ${p3[i]} ${p3[i + 1]}…)`);
  ok(r.added.length === 1 && r.added[0].inserted, '끼운 칸은 하나만 늘고 표시가 남는다');
  ok(!r.slots.some((x) => x.part === '3' && x.time === '17:30' && x.course === 'IN'), '반대 코스는 지어내지 않는다(17:30 IN 없음)');
  const back = reframeSlots(base, { cadence: 7, courses: ['OUT', 'IN'], frame: { 3: { extra: [] } } });
  ok(back.slots.length === base.length, '칸을 빼면 원래 격자로 돌아온다');
}

// ── ⑤ 근태를 지우지 않는다 ─────────────────────────────────────────
//  ★판독은 배치표 근태칸을 스스로 읽는다. 수동 화면이 그걸 조용히 지우면, 사람은 자기가
//   뭘 망가뜨렸는지도 모른다. 8/19 시점 3부에 판독이 잡아둔 휴무가 17명 있었다.
{
  const { nkey } = await import('../src/boardcorrect.mjs');
  ok(nkey('표승완(54)') === '표승완', `키가 태그를 뗀다 — 판독(judge)과 같은 규칙 (${nkey('표승완(54)')})`);
  ok(nkey('문태익(1,3)') === nkey('문태익'), '태그가 있든 없든 같은 사람은 같은 키');
  ok(nkey('김 홍 구') === '김홍구', '공백도 뗀다');

  // correctPart3의 근태 분기를 그대로 흉내내 '항목 없음'과 '빈 값'이 다름을 확인한다.
  const apply = (crew, r) => {
    const key = nkey(String(r.name || '').trim());
    if (!(key && r.duty !== undefined)) return crew;
    const d = String(r.duty || '');
    if (/병가|휴무|휴가/.test(d)) crew[key] = d;
    else if (/휴무|휴가|병가|격리|연차|반차|월차/.test(String(crew[key] || ''))) crew[key] = '';
    return crew;
  };
  let crew = { 도대영: '휴무', '표승완': '54h' };
  apply(crew, { pos: 1, name: '도대영' });                       // duty 없음 = 안 만짐
  ok(crew.도대영 === '휴무', '근태를 안 보낸 행은 건드리지 않는다(판독이 잡은 휴무가 남는다)');
  apply(crew, { pos: 1, name: '도대영', duty: '' });             // 빈 값 = 해제하라
  ok(crew.도대영 === '', '빈 값으로 보내면 해제된다(관리자가 명시적으로 푼 경우)');
  crew = { 도대영: '휴무', 표승완: '54h' };
  apply(crew, { pos: 2, name: '표승완(54)', duty: '' });
  ok(crew.표승완 === '54h', '타부 근무 코드(54h)는 근태가 아니라 안 지워진다');
  apply(crew, { pos: 2, name: '표승완(54)', duty: '휴가' });
  ok(crew.표승완 === '휴가', '태그 달린 사람에게도 근태가 붙는다(전에는 다른 키로 새서 판독이 못 봤다)');
}

console.log(fail ? `\n★ ${fail}개 실패` : '\n★ 전부 통과');
process.exit(fail ? 1 : 0);
