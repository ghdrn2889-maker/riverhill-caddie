// 업적 판정 검사 — 규칙이 아니라 '원칙'을 지키는 게 이 검사의 일이다.
//
// ★가장 중요한 것: 비착취 원칙(사용자가 캐디 당사자로서 못박음).
//   출근율·개근·연속 스트릭·감점은 만들지 않는다. 휴무·휴가·병가는 권리이고,
//   캐디는 출근일도 시간도 랜덤이라 '꾸준함'을 세는 순간 그건 압박 장치가 된다.
//   그래서 소스에 그 개념이 되살아나는지까지 본다 — 함수 하나 추가로 원칙이 뚫리는 걸 막는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, TIER_XP, rankFor, seasonOf } from '../src/trophy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const ok = (cond, label, why = '') => {
  console.log(`  ${cond ? 'OK ' : 'X  '} ${label}${cond || !why ? '' : `\n       ${why}`}`);
  if (!cond) bad++;
};
const byKey = (k) => CATALOG.find((t) => t.key === k);

// 판정에 넣을 '가짜 회원' 한 명을 손으로 짓는다. 날짜만 있으면 되므로 파일은 건드리지 않는다.
const dow = (iso) => new Date(`${iso}T00:00:00`).getDay();
function wk(iso) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const day = (date, parts = ['3'], sides = []) => ({
  date, parts, sides, courses: [],
  weekend: dow(date) === 0 || dow(date) === 6,
  season: seasonOf(date), year: Number(date.slice(0, 4)), ym: date.slice(0, 7), week: wk(date),
});
const ctx = (o = {}) => ({ userId: 0, days: [], notes: [], tips: [], expenses: [], goals: [], firsts: {}, cart: {}, ...o });
const at = (key, c) => byKey(key).at(c);

console.log('\n[하루 1일 — 54라고 세 번 치지 않는다]');
{
  // 같은 날 1·2·3부를 다 뛰어도 근무 1일. 다섯 걸음은 다섯 '날'이 필요하다.
  const one54 = [day('2026-03-02', ['1', '2', '3'])];
  ok(at('days-5', ctx({ days: one54 })) === '', '54 하루로는 다섯 걸음이 안 열린다',
    '물량을 근무 일수로 바꿔 세면 "더 일해라"가 된다');
  ok(at('first-54', ctx({ days: one54 })) === '2026-03-02', '대신 첫 54가 열린다');
  const five = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].map((d) => day(d));
  ok(at('days-5', ctx({ days: five })) === '2026-03-06', '다섯 번째 날에 열린다(그날 날짜로)');
}

console.log('\n[되짚기 — 트로피 날짜는 그 일이 있었던 날이다]');
{
  const days = ['2026-01-05', '2026-02-10', '2026-06-20'].map((d) => day(d));
  ok(at('first-work', ctx({ days })) === '2026-01-05', '첫 출근은 첫 근무일',
    '오늘 날짜로 찍히면 진열장이 거짓말을 한다');
  const today = new Date().toISOString().slice(0, 10);
  ok(at('first-work', ctx({ days })) !== today || days[0].date === today, '오늘로 밀려나지 않는다');
}

console.log('\n[한 주 다섯 번 — 연속이 아니라 한 주 안의 다섯 날]');
{
  // 월·화·수·목·금(같은 주). 붙어 있든 떨어져 있든 '연속'을 요구하지 않는다.
  const mon = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].map((d) => day(d));
  ok(at('week-5', ctx({ days: mon })) === '2026-03-06', '한 주 다섯 날이면 열린다');
  // 주를 걸쳐 다섯 날이면 안 열린다(같은 주가 아니므로).
  const across = ['2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11'].map((d) => day(d));
  ok(at('week-5', ctx({ days: across })) === '', '주를 걸치면 안 열린다(주 단위가 맞다)');
}

console.log('\n[부·계절·주말]');
{
  const days = [day('2026-01-10', ['3']), day('2026-04-14', ['2']), day('2026-07-01', ['1', '3'])];
  ok(at('first-p3', ctx({ days })) === '2026-01-10', '첫 3부');
  ok(at('first-p2', ctx({ days })) === '2026-04-14', '첫 2부');
  ok(at('first-p1', ctx({ days })) === '2026-07-01', '첫 1부는 그 부를 실제로 뛴 날');
  ok(at('season-spring', ctx({ days })) === '2026-04-14', '봄 첫 근무');
  ok(at('season-winter', ctx({ days })) === '2026-01-10', '1월은 겨울이다');
  ok(at('weekend-1', ctx({ days })) === '2026-01-10', '토요일 근무 = 주말의 그린');
  ok(at('double-1', ctx({ days })) === '2026-07-01', '하루 두 부 = 투의 첫날');
}

console.log('\n[인·아웃 — 별도 필드가 아니라 코스에 들어 있다]');
{
  const only = [day('2026-05-01', ['3'], ['OUT']), day('2026-05-02', ['3'], ['OUT'])];
  ok(at('in-and-out', ctx({ days: only })) === '', '한쪽만 돌면 안 열린다');
  const both = [...only, day('2026-05-03', ['3'], ['IN'])];
  ok(at('in-and-out', ctx({ days: both })) === '2026-05-03', '둘 다 돈 그날 열린다');
}

console.log('\n[정산 — 팁·지출·영수증]');
{
  const c = ctx({
    tips: [{ date: '2026-02-01' }, { date: '2026-02-09' }],
    expenses: [{ date: '2026-03-01', scanned: false }, { date: '2026-03-08', scanned: true }],
  });
  ok(at('tip-1', c) === '2026-02-01', '첫 팁');
  ok(at('tip-10', c) === '', '팁 두 건으로는 열 건이 안 된다');
  ok(at('exp-1', c) === '2026-03-01', '첫 지출');
  ok(at('exp-scan', c) === '2026-03-08', 'AI 영수증은 scanned가 켜진 첫 건');
}

console.log('\n[점검 사진 — 빈 배열은 사진이 아니다]');
{
  ok(at('cart-1', ctx({ cart: { '2026-04-01': { photos: { intake: [] } } } })) === '', '빈 배열이면 안 열린다',
    '[]도 참이라 그냥 두면 사진 없는 날이 첫 점검으로 잡힌다');
  ok(at('cart-1', ctx({ cart: { '2026-04-01': { photos: { intake: ['a.jpg'] } } } })) === '2026-04-01', '사진이 있으면 열린다');
  ok(at('club-1', ctx({ cart: { '2026-04-01': { photos: { intake: ['a.jpg'] } } } })) === '', '카트 사진으로 클럽 업적이 열리지 않는다');
}

console.log('\n[수익계산서 — 달과 근무일수를 본다]');
{
  const few = ctx({ firsts: { reports: [{ at: '2026-03-31', ym: '2026-03', days: 6 }] } });
  ok(at('report-1', few) === '', '근무 6일짜리 계산서로는 돌아보기가 안 열린다');
  const enough = ctx({ firsts: { reports: [{ at: '2026-03-31', ym: '2026-03', days: 6 }, { at: '2026-04-30', ym: '2026-04', days: 12 }] } });
  ok(at('report-1', enough) === '2026-04-30', '10일 이상인 그 계산서에서 열린다');
  const six = ctx({ firsts: { reports: ['01', '02', '03', '04', '05', '06'].map((m) => ({ at: `2026-${m}-28`, ym: `2026-${m}`, days: 12 })) } });
  ok(at('report-6', six) === '2026-06-28', '여섯 달이면 반년의 장부');
  const sameMonth = ctx({ firsts: { reports: Array.from({ length: 6 }, (_, i) => ({ at: `2026-03-0${i + 1}`, ym: '2026-03', days: 12 })) } });
  ok(at('report-6', sameMonth) === '', '같은 달을 여섯 번 뽑는 걸로는 안 열린다');
}

console.log('\n[등급 — 정점은 XP만으로 오르지 않는다]');
{
  const r = rankFor(5200, { hasPlatinum: false, name: '홍길동' });
  ok(!r.apex, 'XP가 넘쳐도 플래티넘이 없으면 정점이 아니다');
  ok(r.next && r.next.locked, '다음 자리가 잠겨 있다고 알려준다');
  const a = rankFor(5200, { hasPlatinum: true, name: '홍길동' });
  ok(a.apex && a.name === '홍길동 캐디', '플래티넘이 있으면 정점 — 이름이 등급이 된다');
  ok(rankFor(0).name === '위성 캐디' && rankFor(300).name === '행성 캐디', '사다리 첫 두 칸');
  ok(rankFor(-50).pct >= 0, '음수 XP가 들어와도 비율이 음수가 되지 않는다');
}

console.log('\n[목록 자체]');
{
  const keys = CATALOG.map((t) => t.key);
  ok(new Set(keys).size === keys.length, 'key가 겹치지 않는다', '겹치면 한 트로피가 다른 트로피를 덮어쓴다');
  ok(CATALOG.every((t) => TIER_XP[t.tier] != null), '등급이 모두 XP 표에 있다');
  ok(CATALOG.every((t) => typeof t.at === 'function'), '모든 항목에 판정 함수가 있다');
  const pending = CATALOG.filter((t) => t.need === null);
  ok(pending.length === 4, `기준 준비 중은 4개(플래티넘 3 + 히든 1) — 지금 ${pending.length}개`);
  ok(pending.every((t) => t.at() === ''), '기준 미정인 것은 절대 저절로 열리지 않는다');
  ok(CATALOG.filter((t) => t.need !== null).every((t) => t.cond && t.cond.trim()), '판정하는 업적은 조건 문구가 있다',
    '조건 없이 잠가두면 회원은 "내가 못 딴 것"으로 오해한다');
}

console.log('\n[★비착취 원칙이 코드에 되살아나지 않았다]');
{
  const src = fs.readFileSync(path.join(ROOT, 'src/trophy.mjs'), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, '');            // 주석은 뺀다 — 원칙을 '설명'한 글까지 잡히면 안 된다
  const FORBIDDEN = [
    [/streak/i, '연속(streak) 세기'],
    [/출근율|근태율|attendance/i, '출근율'],
    [/개근/, '개근'],
    [/결근|absent(?!Reason)/i, '결근'],
    [/consecutive/i, '연속 판정'],
    [/xp\s*-=|xp\s*=\s*[^;]*-\s*penalt|penalt/i, '감점'],
  ];
  for (const [re, what] of FORBIDDEN) {
    ok(!re.test(src), `${what} 개념이 없다`,
      '휴무·휴가·병가는 권리다. 이걸 세는 순간 업적이 압박 장치가 된다.');
  }
  // 근무 일수를 세는 곳이 '하루 1일'을 지키는지 — parts를 길이로 더하면 54가 3일이 된다.
  ok(!/days\.reduce\([^)]*parts\.length/.test(src), '근무 일수에 부 개수를 더하지 않는다');
}

console.log('\n[부팅 순서 — 앱이 로딩 화면에서 멈추지 않게]');
{
  // ★2026-08-20 사고: 성장 공간 블록을 main() '뒤'에 붙였더니 앱이 통째로 안 떴다.
  //  main() → initNav() → showView() → gwSeen()이 아직 초기화 안 된 const를 건드려 ReferenceError.
  //  그 예외가 main()을 끊어 hideSplash 안전장치까지 못 돌았고, 화면은 '일정 불러오는 중'에 얼어붙었다.
  //  node --check로는 안 잡힌다 — 문법은 멀쩡하고 실행 순서만 틀렸기 때문이다.
  const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
  const call = app.lastIndexOf('\nmain();');
  const blk = app.indexOf('══ 성장 공간(업적)');
  ok(call > -1, 'app.js가 main()을 부른다');
  ok(blk > -1 && blk < call, '성장 공간 정의가 main() 앞에 있다',
    'const/let은 선언줄을 지나야 산다 — 뒤에 있으면 부팅 중 ReferenceError로 앱이 멈춘다');
  ok(app.slice(call + 8).trim() === '', 'main()이 파일의 마지막이다',
    '뒤에 무언가를 더 붙이는 순간 같은 사고가 반복된다');

  // ★성장 공간이 부르는 '앱 도우미'가 진짜로 있는지 본다.
  //  없는 이름(getJSON)을 부르다 진열장이 빈 채로 떴다 — try/catch가 삼켜서 화면은 멀쩡해 보였다.
  //  미리보기 하네스가 그 이름을 스텁으로 만들어 둬서 샘플로도 못 잡았다.
  const blkSrc = app.slice(blk, call);
  const before = app.slice(0, blk);
  for (const fn of ['$', 'postJSON']) {
    const name = fn.replace('$', '\\$');                       // '$'는 정규식에서 '끝'을 뜻한다 — 글자로 쓰려면 escape
    if (!new RegExp(name + '\\s*\\(').test(blkSrc)) continue;   // 이 블록이 쓰지도 않으면 볼 것 없다
    //  끝 경계로 \b를 쓰면 안 된다 — '$'는 단어 문자가 아니라 '$ ='에서 경계가 성립하지 않는다.
    ok(new RegExp('(const|let|var|function)\\s+' + name + '(?![\\w$])').test(before),
      `성장 공간이 쓰는 ${fn}가 앱에 실제로 있다`, '없는 이름을 부르면 조용히 빈 화면이 된다');
  }
  ok(!/\bgetJSON\s*\(/.test(blkSrc), '없는 getJSON을 다시 부르지 않는다');
  ok(/gwFail\(/.test(blkSrc), '못 불러오면 화면이 그 사실을 말한다',
    '빈 진열장은 "아직 못 땄나 보다"로 읽혀 고장을 숨긴다');

  const idx = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  ok(idx.indexOf('id="growOv"') < idx.indexOf('script src="/app.js"'), '성장 공간 마크업이 script보다 앞에 있다',
    'app.js는 문서 중간에서 바로 실행된다 — 뒤에 있으면 initGrowth가 화면을 못 찾는다');
}

console.log(bad ? `\n${bad}건 실패\n` : '\n전부 통과\n');
process.exit(bad ? 1 : 0);
