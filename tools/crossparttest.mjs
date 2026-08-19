// 부 간 대바 — 회원 대시보드가 실제로 무엇을 보여주는가. 진짜 rounds 조립기(src/rounds.mjs)로 검증한다.
//
//  ★왜 있나: 대바로 3부에서 2부로 간 사람은 '3부 명단에서 빠진다'. 그런데 명단에서 빠졌다는 이유로
//   서버가 다시 계산하면 판독은 그 사람을 '휴무(off)'로 적는다. 그리고 3부가 휴무면 대시보드는
//   그 회원의 1·2부 카드까지 통째로 지운다(rounds.mjs primaryOff — "휴무=휴무").
//   즉 오늘 2부에 출근하는 사람의 화면이 '오늘 휴무'가 된다. 정확히 반대의 사실이다.
//   그래서 교정은 off가 아니라 unknown('이 부엔 없음')을 적는다. 이 파일은 그 둘의 차이를 못 박는다.
//
//  ★가짜 rounds 함수를 새로 만들지 않는다 — 앱이 쓰는 그 함수를 그대로 부른다.
//   흉내로 검증하면 흉내만 통과한다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/store.mjs';
import { resolvePrimary, buildMemberRounds } from '../src/rounds.mjs';

const UID = 990001;                                   // 실회원과 겹치지 않는 시험용 번호
const dir = path.join(DATA_DIR, 'users', String(UID));
const now = new Date();
const LABEL = `${now.getMonth() + 1}월 ${now.getDate()}일`;
const ISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

let fails = 0;
const chk = (ok, msg) => { if (!ok) { fails += 1; console.log('   ★NG ' + msg); } return ok; };

function seed(p3) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'today.json'), JSON.stringify({ ...p3, date: LABEL }));
  fs.writeFileSync(path.join(dir, 'today2.json'), JSON.stringify({
    date: LABEL, status: 'assigned', myPosition: 12, teeTime: '13:00', course: 'IN', cutLine: 20,
  }));
}
function rounds() {
  const { base, primaryPart, tISO } = resolvePrimary({ uid: UID, minorPartOn: true, todayISO: ISO });
  return buildMemberRounds({ uid: UID, primaryPart, base, minorPartOn: true, tISO, todayISO: ISO, commuteMin: 30 });
}

console.log('\n부 간 대바 — 떠난 부를 어떻게 적어야 하는가\n');

// ① 함정 자체가 실재하는가 — 3부를 휴무로 적으면 2부 근무 카드가 사라진다.
seed({ status: 'off', offType: 'rest', myPosition: 0, teeTime: '', course: '' });
const offRounds = rounds();
chk(!offRounds.some((r) => r.part === '2'),
  `전제가 틀렸다 — 3부 휴무인데 2부 카드가 남아 있다(${offRounds.map((r) => r.part + r.kind).join(',')})`);
console.log(`  3부를 '휴무'로 적으면 → 라운드 ${offRounds.length}개 [${offRounds.map((r) => `${r.part}부 ${r.status}`).join(' · ') || '없음'}]  ← 2부 근무가 지워진다`);

// ② 교정이 적는 값(unknown)이면 2부 근무가 살아 있는가.
seed({ status: 'unknown', myPosition: 0, teeTime: '', course: '', cutLine: null, _swappedOut: { to: '2' } });
const unkRounds = rounds();
const two = unkRounds.find((r) => r.part === '2');
chk(!!two, '대바로 2부에 간 사람의 2부 근무 카드가 안 보인다');
chk(!!two && two.kind === 'work' && two.teeTime === '13:00', `2부 카드가 근무·티오프 13:00이 아니다(${JSON.stringify(two)})`);
chk(!unkRounds.some((r) => r.part === '3'), '떠난 3부가 아직 카드로 남아 있다');
console.log(`  3부를 '없음(unknown)'으로 적으면 → 라운드 ${unkRounds.length}개 [${unkRounds.map((r) => `${r.part}부 ${r.status}`).join(' · ') || '없음'}]  ← 2부 근무가 그대로 산다`);

// ③ 교정이 쓴 상태에 근태 흔적이 남으면 안 된다 — offType이 남으면 화면이 '휴무'라고 읽을 수 있다.
const t3 = JSON.parse(fs.readFileSync(path.join(dir, 'today.json'), 'utf8'));
chk(t3.offType === undefined, "떠난 부에 offType이 남아 있다 — '휴무'로 읽힐 수 있다");
chk(Number(t3.myPosition || 0) === 0 && !t3.teeTime, '떠난 부에 순번·티오프가 남아 있다');

fs.rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(fails ? `★ 실패 ${fails}건` : '★ 전부 통과');
process.exit(fails ? 1 : 0);
