// 인턴 — 부마다 따로, 자동으로 잡히고, 바뀌면 다시 센다.
//
//  인턴은 티오프 칸을 차지하되 정규 순번을 먹지 않는다(노란 칸). 하나 놓치면 그 뒤 전원이 한 칸씩 밀린다.
//  그리고 인턴은 그날그날 섭외돼 중간에 끼기 때문에, 밀림이 꼬리가 아니라 중간부터 시작된다.
//  세 가지가 어긋나 있었다.
//   ① 수동 지정 키가 날짜뿐이라 3부 인턴이 1·2부 계산에 실려 갔다(실측 2026-08-23).
//   ② Claude가 주 판독자가 된 뒤로 노란 칸 자동 판독이 아예 돌지 않았다(스킵 조건에 걸려서).
//   ③ 인턴을 고쳐도 회원 카드는 옛 인턴 수로 굳어 있었다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as I from '../src/interns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => {
  if (c) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const jud = read('src/judge.mjs');
const srv = read('src/server.mjs');
const brd = read('src/boardreader.mjs');
const K = (a) => (a || []).map((t) => `${t.time}${t.course[0]}`).join(' ') || '(없음)';

console.log('\n[★부마다 따로 — 3부 인턴이 1부에 새지 않는가]');
{
  ok(typeof I.partKey === 'function' && I.partKey('20990102', '2') === '20990102:2', '키가 날짜와 부로 만들어진다');
  ok(I.partKey('', '3') === '', '날짜가 없으면 키도 없다');
  // 실제로 넣어보고 부마다 갈리는지 본다(먼 미래 날짜 — 살아 있는 데이터를 만지지 않는다).
  const D = '20990102';
  I.setManual(D, [{ time: '17:14', course: 'OUT' }], { by: 'test', part: '3' });
  const p3 = I.internTeesFor(D, [], '3');
  const p1 = I.internTeesFor(D, [], '1');
  ok(K(p3) === '17:14O', `3부에 넣은 게 3부에 있다 (${K(p3)})`);
  ok(K(p1) === '(없음)', `★1부에는 없다 (${K(p1)})`,
    '예전엔 3부 17:14 OUT이 1부·2부 카카오 계산에 그대로 실려 갔다');
  I.setManual(D, [{ time: '06:30', course: 'IN' }], { by: 'test', part: '1' });
  ok(K(I.internTeesFor(D, [], '1')) === '06:30I' && K(I.internTeesFor(D, [], '3')) === '17:14O',
    '두 부가 서로를 덮지 않는다');
  ok(I.clearManual(D, 'test', '1') === true && K(I.internTeesFor(D, [], '3')) === '17:14O',
    '한 부를 지워도 다른 부는 남는다');
  // 자동 폴백도 부를 탄다
  ok(K(I.internTeesFor(D, [{ time: '07:00', course: 'OUT' }], '1')) === '07:00O',
    '수동이 없는 부는 자동을 따른다');
  ok(K(I.internTeesFor(D, [{ time: '07:00', course: 'OUT' }], '3')) === '17:14O',
    '★수동이 있으면 자동을 이긴다', '관리자는 원본을 보고 있다');
  I.clearManual(D, 'test', '3');
  ok(!I.manualFor(D, '3') && !I.manualFor(D, '1'), '검사가 쓴 것을 치웠다');
}

console.log('\n[옛 기록은 3부 것으로 옮겨지는가]');
{
  ok(read('src/interns.mjs').includes(".test(k)) continue;") && read('src/interns.mjs').includes('const nk = `${k}:3`;'),
    '날짜만인 옛 키를 찾아 옮긴다');
  ok(/all\[nk\] = \{ \.\.\.all\[k\], part: '3' \};/.test(read('src/interns.mjs')),
    '★옛 기록은 3부로 옮긴다', '그때는 3부만 인턴을 다뤘다 — 버리면 관리자가 손으로 넣은 것이 사라진다');
}

console.log('\n[★노란 칸 자동 판독이 실제로 도는가]');
{
  ok(!/!verdict\._local && !verdict\._claude && useGeminiFallback\(\)\) \{[\s\S]{0,400}analyzeInterns/.test(jud),
    '★인턴 판독이 "Claude면 건너뛰기" 블록 밖으로 나왔다',
    'Claude·로컬VLM 둘 다 internTees를 빈 배열로 박아둔다 — 채웠다는 전제가 틀렸다');
  ok(/if \(isBoard && verdict && useInternRead\(\)\) \{/.test(jud), '판독기와 무관한 자리에서 돈다');
  ok(/const useInternRead = \(\) => \{/.test(jud), '전용 스위치가 있다');
  ok(/return !!process\.env\.GEMINI_API_KEY;/.test(jud), '키가 있으면 기본으로 켠다');
  ok(/no-intern-read/.test(jud), '끄는 문도 있다');
  ok(!/useInternRead[\s\S]{0,300}GEMINI_FALLBACK \|\|/.test(jud.slice(jud.indexOf('const useInternRead'))),
    '★비싼 Gemini 폴백과 분리돼 있다',
    'GEMINI_FALLBACK을 켜면 배치표 통째 재판독까지 켜진다 — 그게 8/3 크레딧 급소진의 원인이었다');
  ok(/Claude 판독은 노란 칸\(인턴\)을 보지 않는다/.test(brd),
    '판독기 쪽 주석이 사실을 말한다', "0은 '없더라'가 아니라 '아직 안 봤다'는 뜻이다");
}

console.log('\n[★인턴이 바뀌면 회원 카드를 다시 세는가]');
{
  ok(/async function recomputeInternPart\(part, dateKey, effTees/.test(srv), '재계산 함수가 있다');
  const body = srv.slice(srv.indexOf('async function recomputeInternPart'));
  const end = body.indexOf('\n}\n');
  const fn = end < 0 ? body : body.slice(0, end + 2);
  ok(/interpretForMember\(pseudo/.test(fn) && /processForMember(Part)?\(/.test(fn), '회원별로 다시 판정한다');
  ok(/\{ noPush: true \}/.test(fn), '★알림은 보내지 않는다',
    '인턴 정정은 사람이 배치표를 다시 본 결과지 새 사건이 아니다');
  ok(/if \(!v \|\| keyFromLabel\(v\.dateLabel \|\| lb\.dateLabel \|\| ''\) !== dateKey\) return 0;/.test(fn),
    '다른 날 배치표는 손대지 않는다');
  ok(/if \(iso && iso !== dateKey\) return 0;/.test(fn), '1·2부도 날짜가 맞을 때만');
  ok(/if \(changed\) \{/.test(srv), '실제로 달라졌을 때만 재계산한다',
    '같은 값을 다시 저장하는데 회원 13명을 다시 도는 건 낭비다');
  ok(/const part = String\(req\.body\?\.part \|\| '3'\);/.test(srv) && /part는 1·2·3 중 하나/.test(srv),
    '인턴 API가 부를 받는다');
  ok(/function _autoInternTees\(dateKey, part = '3'\)/.test(srv) && /loadBoardPartsStore\(\)/.test(srv.slice(srv.indexOf('function _autoInternTees'), srv.indexOf('function _autoInternTees') + 900)),
    '★1·2부 자동값은 board-parts-store에서 읽는다', '예전엔 3부 lastboard만 봐서 1·2부는 언제나 빈 값이었다');
}

console.log('\n[카카오가 그 부의 인턴만 보는가]');
{
  ok(/internTees: internTeesFor\(dateISO, d\.internTees \|\| \[\], p\)/.test(srv),
    '★1·2부 관측이 그 부 인턴을 쓴다');
  ok(/internTees: internTeesFor\(dateISO, vp\.internTees \|\| \[\], part\)/.test(srv), '부별 보조도 그 부 인턴을 쓴다');
  ok(/internTees: internTeesFor\(dbISO, _v\.internTees \|\| \[\], '3'\)/.test(srv), '3부 경로는 3부를 명시한다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
