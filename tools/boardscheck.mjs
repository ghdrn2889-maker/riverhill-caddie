// 앱 '배치표' 화면이 받는 값이 스스로 모순되지 않는가.
//
//  ★왜 있나: 2부가 '확정선 38번'과 '30팀 편성'을 한 화면에 같이 띄웠다. 두 숫자가 같은 것을
//   가리키는데 출처가 달랐고(확정선=근무선, 팀 편성=처음 사진 헤더), 한쪽만 갱신됐다.
//   눈으로 보는 것 말고는 이걸 알아챌 방법이 없었다. 이제 매번 여기서 걸린다.
import { buildBoardsView } from '../src/boardsview.mjs';

let fails = 0;
const chk = (ok, msg) => { if (!ok) { fails++; console.log('   ★NG ' + msg); } return ok; };

const parts = buildBoardsView();
if (!parts.length) { console.log('배치표가 아직 없습니다 — 검사할 게 없어요.'); process.exit(0); }

console.log('\n앱 배치표 — 스스로 모순되지 않는가\n');
// ⑤부끼리 같은 날짜인가 — 3부는 lastboard, 1·2부는 board-parts-store로 저장 시점이 달라
//  한쪽만 갱신될 수 있다(8/18 실사고). 서로 다른 날짜를 나란히 띄우면 캐디가 어제 티오프를 보고 출근한다.
{
  const days = [...new Set(parts.map((b) => b.targetISO).filter(Boolean))];
  console.log(`  근무일 — ${parts.map((b) => `${b.part}부 ${b.targetISO || '?'}${b.stale ? '(낡음★)' : ''}`).join(' · ')}`);
  chk(days.length <= 1, `부끼리 배치표 날짜가 다르다: ${days.sort().join(' vs ')} — 한쪽만 갱신됐다`);
}
console.log('');
for (const b of parts) {
  const maxPos = Math.max(0, ...b.teeGrid.map((g) => Number(g.pos) || 0));
  console.log(`  ${b.part}부 — 팀 편성 ${b.teamCount} · 확정선 ${b.cut}번${b.cutoffName ? ' ' + b.cutoffName : ''}`
    + ` · 티오프 ${b.teeGrid.length}칸(맨 뒤 ${maxPos}번) · 명단 ${b.roster.length}명`);
  // ①팀 수와 근무선은 같은 것을 가리킨다 — 한쪽만 갱신되면 화면이 스스로를 부정한다.
  chk(b.teamCount === b.cut, `${b.part}부 — 팀 편성(${b.teamCount})과 확정선(${b.cut})이 다르다`);
  // ②근무선 밖의 사람에게 티오프를 줄 수는 없다.
  chk(maxPos <= b.cut, `${b.part}부 — 확정선 ${b.cut}번 밖인 ${maxPos}번에 티오프가 있다`);
  // ③명단에 없는 순번이 근무할 수는 없다.
  chk(b.cut <= b.roster.length, `${b.part}부 — 확정선 ${b.cut}번인데 명단은 ${b.roster.length}명뿐이다`);
  // ④근무선까지는 티오프가 다 차 있어야 한다(인턴이 맡은 칸만큼은 빌 수 있다).
  const withTee = new Set(b.teeGrid.map((g) => Number(g.pos)));
  const holes = [];
  for (let i = 1; i <= b.cut; i++) if (!withTee.has(i)) holes.push(i);
  if (holes.length) console.log(`     · 티오프 없는 근무 순번 ${holes.length}개: ${holes.slice(0, 8).join(',')}${holes.length > 8 ? '…' : ''} (인턴 칸이면 정상)`);
}
console.log(fails ? `\n★ 실패 ${fails}건` : '\n★ 전부 통과');
process.exit(fails ? 1 : 0);
