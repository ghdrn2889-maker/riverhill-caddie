// 1·2부 수정배치표 잠금 — 언제 읽고 언제 안 읽는가. 표로 세워 못 박는다.
//
//  ★이 기능은 '안 하는 것'이 일이라서 조용히 틀린다. 너무 많이 막으면 내일 본배치표를 못 읽고,
//   너무 적게 막으면 관리자가 멈추라고 한 그 과정이 계속 돈다. 둘 다 화면만 봐서는 안 보인다.
//   그래서 판정을 파일도 시계도 안 읽는 순수 함수로 떼어놓고(frozenBy), 여기서 전부 세운다.
import { frozenBy, minorUpdateOn } from '../src/minorfreeze.mjs';

const TODAY = '2026-08-19';
const P31 = { roster: Array.from({ length: 31 }, (_, i) => `캐디${i + 1}`), _targetISO: TODAY };
const EMPTY = { roster: [], _targetISO: TODAY };
const YESTERDAY = { ...P31, _targetISO: '2026-08-18' };
const NODATE = { ...P31, _targetISO: '' };

let fails = 0;
const chk = (got, want, msg) => { if (got !== want) { fails += 1; console.log(`   ★NG ${msg} — ${want ? '막아야' : '읽어야'} 하는데 ${got ? '막았' : '읽었'}다`); } };
const F = (o) => frozenBy({ on: false, todayISO: TODAY, ...o });   // on:false = 잠금 켜짐(MINOR_PART_UPDATE=0)

console.log('\n1·2부 수정배치표 잠금 — 무엇을 막고 무엇을 통과시키나\n');

// ── 막아야 하는 것: 같은 근무일에 두 번째로 오는 배치표 ──
chk(F({ part: '2', pd: P31, newISO: TODAY }), true, '같은 근무일 수정배치표(2부)');
chk(F({ part: '1', pd: P31, newISO: TODAY }), true, '같은 근무일 수정배치표(1부)');
chk(F({ part: '2', pd: P31, newISO: '' }), true, "날짜를 못 읽은 수정본('2부 8팀 시간표입니다')");
console.log('  막는다 — 같은 근무일 두 번째 글 · 날짜 없는 단독 수정본');

// ── 읽어야 하는 것 ──
chk(F({ part: '3', pd: P31, newISO: TODAY }), false, '3부는 이 문을 안 지난다');
chk(F({ part: '2', pd: null, newISO: TODAY }), false, '아직 첫 판독 전(저장본 없음)');
chk(F({ part: '2', pd: EMPTY, newISO: TODAY }), false, '저장본이 비었음(명단 0명)');
chk(F({ part: '2', pd: YESTERDAY, newISO: TODAY }), false, '어제 근무일 저장본 → 오늘 본배치표');
chk(F({ part: '2', pd: P31, newISO: '2026-08-20' }), false, '내일 근무일 본배치표(전날 저녁에 올라온다)');
chk(F({ part: '2', pd: NODATE, newISO: TODAY }), false, '근무일 미상 저장본 → 첫 판독으로 본다');
chk(F({ part: '2', pd: P31, newISO: TODAY, override: true }), false, '관리자가 일부러 다시 읽힘(/api/simulate?minor=1)');
chk(F({ part: '2', pd: P31, newISO: TODAY, on: true }), false, '잠금이 꺼져 있음(기본값)');
console.log('  읽는다 — 3부 · 첫 판독 · 지난 근무일 · 내일 본배치표 · 관리자 재판독 · 잠금 꺼짐');

// ── ★가장 중요한 것: 내일 본배치표를 막으면 안 된다 ──
//  전날 저녁에 내일 배치표가 올라온다. 이걸 막으면 1·2부가 하루 통째로 비어버린다.
chk(F({ part: '1', pd: { ...P31, _targetISO: TODAY }, newISO: '2026-08-20' }), false, '★내일 본배치표(1부)');
chk(F({ part: '2', pd: { ...P31, _targetISO: TODAY }, newISO: '2026-08-20' }), false, '★내일 본배치표(2부)');

// ── 스위치 자체 ──
chk(minorUpdateOn({}), true, '(스위치) 기본값은 켜짐');
chk(minorUpdateOn({ MINOR_PART_UPDATE: '1' }), true, '(스위치) =1 켜짐');
chk(minorUpdateOn({ MINOR_PART_UPDATE: '0' }), false, '(스위치) =0 꺼짐');
chk(minorUpdateOn({ MINOR_PART_UPDATE: 'off' }), false, '(스위치) =off 꺼짐');
console.log('  스위치 — 없으면 켜짐(기존 동작 불변) · 0/off면 잠금');

console.log('');
console.log(fails ? `★ 실패 ${fails}건` : '★ 전부 통과');
process.exit(fails ? 1 : 0);
