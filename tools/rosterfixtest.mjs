// 명단 판독 보강 검사 — 2026-08-21 실데이터를 그대로 놓고 본다.
//  그날 3부 명단은 이랬다: 강예영(1,3) · 김수원(1,3) · 김예원이 두 번.
//  1부엔 강경순이 잘못 들어갔고 티오프 칸도 하나 같이 늘어 '13명/13칸'으로 짝이 맞아버렸다.
//  아래는 그 셋을 각각 어떻게 잡는지에 대한 검사다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { disambiguateByCrossPart, rosterSanity } from '../src/boardreader.mjs';
import { isNameShape } from '../src/roster.mjs';
import { OFFICIAL_ROSTER } from '../src/roster-official.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, what, why = '') => {
  if (cond) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// 진짜 사전을 건드리지 않고 '정본 1글자 차 후보'만 흉내낸다.
const hamming1 = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++d > 1) return false; }
  return d === 1;
};
const OFF = new Set(OFFICIAL_ROSTER);
const nearOf = (n) => (OFF.has(n) ? [] : OFFICIAL_ROSTER.filter((o) => hamming1(n, o)));

// ── 2026-08-21 실데이터(판독 원본) ──
const P1 = ['이하늘(54)', '연승준(54)', '신지현(54)', '표승완(1,3)', '강혜영(1,3)', '문태익(1,3)',
  '김수룡(1,3)', '이지은(1,3)', '서동명(1,3)', '조예린(1,3)', '정유경(1,3)', '최수아', '강경순'];
const P2 = ['이하늘(54)', '연승준(54)', '신지현(54)', '강경순', '정민철', '박진수(2,3)', '김서현(2,3)',
  '김기선(2,3)', '김예원(2,3)', '박수현(2,3)', '오동현(2,3)', '서동환(2,3)', '남재권(2,3)', '양태록(2,3)',
  '우정민', '김상미', '전형준', '성지현', '안준우', '이은지', '박신훈', '장소희', '김주희', '홍아름',
  '김희용', '박선하', '고창민', '김수안', '정용만', '배문숙', '장미화', '권미영', '정이슬', '천예영',
  '전호성', '박태영', '최수아'];
const P3 = ['이하늘(54)', '연승준(54)', '신지현(54)', '표승완(1,3)', '강예영(1,3)', '문태익(1,3)',
  '김수원(1,3)', '이지은(1,3)', '서동명(1,3)', '조예린(1,3)', '정유경(1,3)', '박시윤', '김동윤',
  '박진수(2,3)', '김서현(2,3)', '김기선(2,3)', '김예원(2,3)', '박수현(2,3)', '오동현(2,3)', '서동환(2,3)',
  '남재권(2,3)', '양태록(2, 3)', '한지홍', '박준서', '김동우', '장성원', '조하빈', '류곤', '최재영',
  '김홍구', '홍준표', '송민지', '정진영', '최수원', '임태희', '박하늘', '김예원', '이수련'];
const board = () => ({
  1: { roster: P1.slice(), cut: 13 },
  2: { roster: P2.slice(), cut: 20 },
  3: { roster: P3.slice(), cut: 23 },
});

console.log('\n[부 태그 교차 티브레이크 — 다른 부의 명단이 답을 들고 있다]');
{
  const b = board();
  const n = disambiguateByCrossPart(b, nearOf);
  ok(n === 2, `애매한 이름 2개를 확정했다 — 지금 ${n}개`);
  ok(b[3].roster[4] === '강혜영(1,3)', "3부 5번 '강예영(1,3)' → '강혜영(1,3)'",
    '정본 후보가 강혜영·천예영 둘이라 스냅은 포기했지만, 1부엔 강혜영만 있다');
  ok(b[3].roster[6] === '김수룡(1,3)', "3부 7번 '김수원(1,3)' → '김수룡(1,3)'",
    '후보 넷(최수원·김수룡·김수안·김예원) 중 1부에 있는 건 김수룡뿐이다');
  ok(b[3].roster[21] === '양태록(2, 3)' || b[3].roster[21].startsWith('양태록'), '맞게 읽힌 이름은 안 건드린다');
  ok(b[1].roster.join() === P1.join(), '1부는 손대지 않았다');
}
{
  // 안전: 후보가 여럿 다 다른 부에 있으면 손대지 않는다. 헷갈릴 땐 가만히 있는 게 낫다.
  const b = { 1: { roster: ['강혜영(1,3)', '천예영(1,3)'], cut: 2 }, 3: { roster: ['강예영(1,3)'], cut: 1 } };
  disambiguateByCrossPart(b, nearOf);
  ok(b[3].roster[0] === '강예영(1,3)', '후보 둘 다 상대 부에 있으면 고르지 않는다',
    '둘 중 하나를 찍으면 그건 판독이 아니라 도박이다');
}
{
  // 안전: 부 태그가 없으면 교차할 상대가 없다 — 스페어까지 끌어다 고치지 않는다.
  const b = { 1: { roster: ['강혜영'], cut: 1 }, 3: { roster: ['강예영'], cut: 1 } };
  disambiguateByCrossPart(b, nearOf);
  ok(b[3].roster[0] === '강예영', '태그 없는 이름은 교차로 고치지 않는다');
}
{
  // 안전: 이미 그 부에 있는 이름으로는 바꾸지 않는다(두 사람을 하나로 뭉개는 짓).
  const b = { 1: { roster: ['강혜영(1,3)'], cut: 1 }, 3: { roster: ['강혜영(1,3)', '강예영(1,3)'], cut: 2 } };
  disambiguateByCrossPart(b, nearOf);
  ok(b[3].roster[1] === '강예영(1,3)', '이미 있는 이름으로 스냅해 중복을 만들지 않는다');
}

console.log('\n[명단 앞뒤 검사 — 짝이 맞는다고 옳은 게 아니다]');
{
  const issues = rosterSanity(board());
  const kinds = issues.map((i) => i.kind);
  const of = (k) => issues.find((i) => i.kind === k);

  ok(kinds.includes('dup_name'), '같은 이름이 두 번인 것을 잡는다');
  const d = of('dup_name');
  ok(d && d.part === 3 && d.names.join().includes('김예원'), `3부 김예원 두 번 — ${d ? d.names.join(' ') : '못 잡음'}`,
    '스냅은 고치다 생기는 중복만 막는다. 처음부터 두 번 읽힌 건 그대로 통과했다');

  // ★당겨오기(관리자 확인 2026-08-21): 1부는 13팀인데 가용 12명이었고, 2부만 뛰던 강경순을
  //  1부 맨 끝(13번)으로 당겨왔다. 팀이 모자라다고 예약을 안 받는 게 아니라 옆 부에서 당겨온다.
  ok(!kinds.includes('cross_untagged'), '당겨온 사람은 알리지 않는다',
    '강경순은 1부 명단 맨 끝(13번)에 얹혔다 — 원번 근무자를 당겨온 정상 배치다');

  ok(kinds.includes('tag_no_counterpart'), '태그가 가리키는 부에 없는 이름을 잡는다');
  const t = of('tag_no_counterpart');
  ok(t && t.names.join().includes('강예영'), `강예영(1,3)인데 1부에 없다 — ${t ? t.names.join(' / ') : '못 잡음'}`);
}
{
  // 티브레이크가 먼저 돌면 그 신호는 사라져야 한다 — 고쳐놓고 또 알리면 알림이 거짓말이 된다.
  const b = board();
  disambiguateByCrossPart(b, nearOf);
  const names = (rosterSanity(b).find((i) => i.kind === 'tag_no_counterpart') || {}).names || [];
  ok(!names.join().includes('강예영') && !names.join().includes('김수원'),
    '교차로 고친 이름은 더 이상 알리지 않는다');
}
{
  // 당겨오기가 아닌 진짜 중복 — 맨 끝이 아니라 명단 한가운데에 같은 사람이 있다.
  const b = { 1: { roster: ['가나다', '강경순', '라마바'], cut: 3 }, 2: { roster: ['강경순', '사아자'], cut: 2 } };
  const k = rosterSanity(b).map((i) => i.kind);
  ok(k.includes('cross_untagged'), '맨 끝이 아니면 잡는다 — 당겨오기로 설명되지 않는다');
}
{
  // ★중복 근무자는 당길 수 없다 — 이미 두 부에 묶여 있다.
  const b = {
    1: { roster: ['가나다', '박진수(2,3)'], cut: 2 },
    2: { roster: ['박진수(2,3)'], cut: 1 },
    3: { roster: ['박진수(2,3)'], cut: 1 },
  };
  const it = rosterSanity(b).find((i) => i.kind === 'pull_forbidden');
  ok(!!it, '중복 근무자가 표시 밖 부에서 근무면 잡는다');
  ok(it && it.names.join().includes('1부'), `박진수(2,3)가 1부에 — ${it ? it.names.join(' / ') : '못 잡음'}`,
    '당길 수 있는 건 한 부만 뛰는 캐디다');
}
{
  const issues = rosterSanity({ 3: { roster: ['가나다', '라마바'], cut: 5 } });
  ok(issues.some((i) => i.kind === 'cut_overflow'), '커트가 명단보다 크면 잡는다');
  ok(rosterSanity({}).length === 0 && rosterSanity({ 1: {} }).length === 0, '빈 입력도 안전하다');
}

console.log('\n[사전 입구 — 이름 아닌 것은 안 배운다]');
{
  for (const junk of ['찾근', '조출', '후출', '당번', '신 철', '서동환(정진영)', '박선하정용호', '테스트캐디', '12번']) {
    ok(!isNameShape(junk), `'${junk}'는 이름이 아니다`);
  }
  for (const good of ['김홍구', '신철', '이하늘', '박진수']) ok(isNameShape(good), `'${good}'는 이름이다`);
}

console.log('\n[사전 — 정본 코앞의 오독은 확정하지 않는다]');
{
  const src = read('src/roster.mjs').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(/function isConfirmed\(/.test(src), '확정 판정이 한 곳에 모여 있다');
  ok(/nearOfficial\(db, name\)/.test(src), '정본과 1글자 차이면 확정하지 않는다',
    "'김수륭'이 확정으로 굳어 '김수원'의 후보를 5개로 불렸다 — 오염이 오염을 낳는다");
  ok(/if \(!isNameShape\(n\)\) return;/.test(src), '이름 모양이 아니면 아예 안 배운다');
  ok(!/\(db\[s\]\?\.n \|\| 0\) >= CONFIRM_MIN\) return \[\]/.test(src), '근접후보도 같은 확정 기준을 쓴다');
  ok(/실존 캐디면 정본 명단에 넣어주세요/.test(read('src/roster.mjs')), '진짜 새 캐디면 알려준다',
    '조용히 막으면 새 캐디가 영영 확정되지 않는다');
}

console.log('\n[알림 — 사람이 무엇을 해야 하는지 말한다]');
{
  const src = read('src/boardalert.mjs');
  for (const k of ['dup_name', 'cut_overflow', 'tag_no_counterpart', 'cross_untagged', 'pull_forbidden']) {
    ok(new RegExp(`case '${k}':`).test(src), `${k} 문구가 있다`);
  }
  ok(/Array\.isArray\(it\.names\)/.test(src), '서명에 이름을 섞는다 — 다른 이름이면 다시 알린다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
