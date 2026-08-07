// 테스터 킷 계정에 '가상' 정산·일지 샘플을 채운다(약 2.5개월치 근무·캐디피·팁·지출).
//  ★전부 합성값(실제 캐디 데이터 아님). 이미 데이터가 있으면(테스터가 편집한 흔적) 건너뛴다 → 편집 보존.
//  앱의 실제 기록 함수(worklog/journal/ledger)를 그대로 재사용해 형식 오류 0.
import * as worklog from './worklog.mjs';
import * as journal from './journal.mjs';
import { setTip, setDayParts, addExpense } from './ledger.mjs';
import { loadUserJSON } from './store.mjs';

const COURSES = ['East', 'West', 'South'];
const TEE3 = ['12:20', '12:44', '13:08', '13:32', '13:56'];

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seedTesterData(userId, { force = false } = {}) {
  const existing = loadUserJSON(userId, 'journal.json', {});
  if (!force && existing && Object.keys(existing).length) return { seeded: false, reason: 'exists' };

  const today = new Date();
  let workdays = 0;
  for (let back = 78; back >= 1; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const dateISO = iso(d);
    const dow = d.getDay();
    if (dow === 0 || (dow === 3 && back % 2 === 0) || back % 11 === 0) continue; // 쉬는 날·간헐 결근
    if (back % 19 === 0) { // 가끔 휴무/휴가
      journal.recordDayStatus(dateISO, { status: 'off', part: '3', offType: back % 38 === 0 ? 'vacation' : 'off' }, userId);
      continue;
    }
    const r = back % 10;
    const parts = r === 0 ? ['1', '2', '3'] : (r <= 2 ? ['2', '3'] : ['3']); // 대부분 3부, 가끔 2·3부, 드물게 54
    const course = COURSES[back % COURSES.length];
    for (const p of parts) {
      const tee = p === '3' ? TEE3[back % TEE3.length] : (p === '1' ? '06:36' : '11:04');
      worklog.recordWorkDay(dateISO, { teeTime: tee, course, articleId: 'seed', part: p }, userId);
      journal.recordDayStatus(dateISO, { status: 'work', teeTime: tee, course, myPosition: (back % 7) + 4, part: p }, userId);
    }
    if (parts.length >= 2) setDayParts(dateISO, parts, userId);
    if (back % 3 === 0) setTip(dateISO, 10000 + (back % 4) * 5000, userId);
    workdays++;
  }
  // 지출 샘플 몇 건
  const ex = [[6, '주유소', 62000], [21, '기사식당', 11000], [44, '골프용품(장갑)', 24000]];
  for (const [back, vendor, amount] of ex) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    addExpense({ date: iso(d), amount, vendor, memo: '테스터 샘플' }, userId);
  }
  return { seeded: true, workdays };
}
