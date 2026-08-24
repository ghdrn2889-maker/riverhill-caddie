// 샷건처럼 '그날 그 부만' 시간표가 다른 날 — 앱이 티오프 역산을 버리고 고정 시간표를 따르는가.
//  기준은 2026-08-25 청송 군수배: 2부 배치표 티오프 칸(11:50~14:17)은 근무 인원을 줄세운 것뿐이고
//  실제로는 전원 10:40 출근 · 10:50 출석 확인 · 12:30 동시 티오프.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayPlanFor, setDayPlan, listDayPlans, planCommute } from '../src/dayplan.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRV = R('src/server.mjs'), RND = R('src/rounds.mjs'), APP = R('public/app.js'), MON = R('src/monitor.mjs');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };
const threw = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

const D = '2099-12-31';   // ★실데이터를 안 건드리는 버림 날짜. 끝에서 반드시 지운다.
const before = JSON.stringify(listDayPlans());

console.log('\n── 고정 시간표를 못박고 되찾는다 ──');
{
  const saved = setDayPlan(D, '2', { arrive: '10:40', standby: '10:50', tee: '12:30', kind: 'shotgun', note: '청송 군수배' }, '테스트');
  ok(saved && saved.arrive === '10:40' && saved.standby === '10:50' && saved.tee === '12:30', '출근·출석·티오프가 그대로 저장된다');
  const got = dayPlanFor(D, '2');
  ok(got && got.kind === 'shotgun' && got.note === '청송 군수배', '날짜+부로 다시 찾아진다');
  ok(dayPlanFor(D, '1') === null, '★같은 날 다른 부는 영향이 없다', '1부까지 끌려가면 새벽 조출이 10:40으로 밀린다');
  ok(dayPlanFor('2099-12-30', '2') === null, '다른 날짜는 영향이 없다');
  ok(dayPlanFor('', '2') === null && dayPlanFor(D, '') === null, '빈 값이면 조용히 null(평소대로 역산)');
}

console.log('\n── 지어낸 값은 들어오지 못한다 ──');
{
  ok(/시각은 HH:MM/.test(threw(() => setDayPlan(D, '2', { arrive: '10시40분' }))), '시각 형식이 아니면 거부한다');
  ok(/시각은 HH:MM/.test(threw(() => setDayPlan(D, '2', { arrive: '25:00' }))), '없는 시각(25:00)은 거부한다');
  ok(/날짜는 YYYY-MM-DD/.test(threw(() => setDayPlan('내일', '2', { arrive: '10:40' }))), '날짜 형식이 아니면 거부한다');
  ok(/부는 1/.test(threw(() => setDayPlan(D, '9', { arrive: '10:40' }))), '없는 부는 거부한다');
  ok(/순서가 어긋납니다/.test(threw(() => setDayPlan(D, '3', { arrive: '12:30', standby: '10:50', tee: '10:40' }))),
    '★출근 → 출석 → 티오프 순서가 어긋나면 거부한다', '거꾸로 저장되면 히어로 게이지가 뒤로 흐른다');
  ok(dayPlanFor(D, '2').arrive === '10:40', '거부된 시도가 이미 있던 값을 망가뜨리지 않았다');
}

console.log('\n── commuteInfo와 같은 모양으로 나온다(쓰는 쪽은 아무것도 몰라도 된다) ──');
{
  const c = planCommute(dayPlanFor(D, '2'), 60);
  ok(c.arrive === '10:40' && c.standby === '10:50' && c.tee === '12:30', '도착·출석·티오프가 고정값 그대로');
  ok(c.leave === '09:40', '★출발만 회원별로 계산한다(10:40 − 출근소요 60분)', '집이 다 다르니 이것만 사람마다 다르다');
  ok(planCommute(dayPlanFor(D, '2'), 25).leave === '10:15', '출근소요 25분인 회원은 10:15 출발');
  ok(c.fixed === true, "★fixed 표식이 붙는다 — 화면·푸시가 '백대기'와 '출석 확인'을 가른다");
  for (const k of ['tee', 'standby', 'arrive', 'leave', 'backWaitMin', 'arriveBeforeMin', 'commuteMin']) {
    if (!(k in c)) { ok(false, `commuteInfo의 ${k} 자리가 비었다`); }
  }
  ok(['tee', 'standby', 'arrive', 'leave'].every((k) => /^\d{2}:\d{2}$/.test(c[k])), 'HH:MM 네 자리 모두 채워진다');
}

console.log('\n── 해제하면 평소대로 돌아간다 ──');
{
  setDayPlan(D, '2', null);
  ok(dayPlanFor(D, '2') === null, '해제되면 null — 그날 그 부는 다시 티오프 역산');
  ok(JSON.stringify(listDayPlans()) === before, '★테스트가 실데이터를 남기지 않았다', '남으면 그날 진짜 근무가 틀어진다');
}

console.log('\n── 앱·모니터·푸시가 같은 시간표를 본다 ──');
{
  ok(/import \{ dayPlanFor, planCommute \} from '\.\/dayplan\.mjs';/.test(SRV), '서버가 고정 시간표를 읽는다');
  ok(/import \{ dayPlanFor, planCommute \} from '\.\/dayplan\.mjs';/.test(RND), '라운드 조립도 같은 문에서 읽는다');
  ok(/const pc = \(isWork && plan\) \? planCommute\(plan, commuteMin\) : null;/.test(RND),
    '★근무일 때만 적용된다', '스페어에 티오프를 붙이면 대기 중인 사람에게 없는 시각을 단언한다');
  ok(/teeTime: pc \? pc\.tee : \(tp\.teeTime \|\| ''\)/.test(RND),
    '★카드의 티오프가 고정값으로 바뀐다', "배치표 칸(11:57)이 남으면 '내 티오프는 11:57'로 읽힌다");
  ok(SRV.includes("const plan = dayPlanFor(tISO || todayISO, prefix ?") && SRV.includes(": '3');"),
    '★자동 푸시도 같은 시간표를 쓴다',
    "화면만 고치면 폰은 여전히 '지금 출발하세요'라고 틀린 시각에 울린다 — 이게 원래 사고였다");
  ok(/const c = plan \? planCommute\(plan, mem\.commute_min\) : commuteInfo\(t\.teeTime, mem\.commute_min\);/.test(SRV),
    '리마인더가 고정 시간표를 우선한다');
  ok(/const midKo = c\.fixed \? '출석 확인' : '백대기';/.test(SRV) && /const midKo = c\.fixed \? '출석 확인' : '백대기';/.test(APP),
    "★푸시 문구와 화면 문구가 같은 말을 쓴다('출석 확인')");
  const iFetch = SRV.indexOf('const primaryPlan = dayPlanFor(tISO, primaryPart);');
  const iUse = SRV.indexOf('const tv = pc ?');
  ok(iFetch > 0 && iUse > iFetch, '대표부도 고정 시간표를 먼저 구한 뒤 쓴다');
  ok(/state: tv,/.test(SRV), "★응답의 state가 덧씌운 값(tv) — 원본 today는 안 건드린다");
  ok(!/state: t,/.test(SRV), '원본 t가 그대로 나가는 자리가 남아있지 않다');
  ok(/app\.post\('\/api\/dayplan', gate/.test(MON), '관리자가 모니터에서 등록·해제할 문이 있다');
  ok(/setDayPlan\(date, part, remove \? null : /.test(MON), '해제(remove)도 같은 문으로');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
