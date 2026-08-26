// 티오프가 조용히 비는 길을 막았는가 — 2026-08-26 사고에서 나온 검사들.
//
//  그날 일어난 일: 3부 수정배치표를 판독기가 14칸·컷14로 정확히 읽었다. 그런데 어제 본배치표(컷 9)를
//   검수에서 고쳐둔 티오프 9칸이 그 위를 통째로 덮어써 10~14번이 빈칸이 됐다. 그 빈칸이 그대로
//   "근무 예정이에요. 티오프가 매칭되면 확정 알림 드릴게요"로 도대영·홍준표에게 세 번 나갔고,
//   사람이 손으로 채울 때까지 시스템은 스스로 회복하지 못했다.
//
//  그리고 검사 셋이 있었는데 셋 다 침묵했다. 각자 다른 이유로 같은 것을 못 봤다:
//   ① teeGaps      — 칸이 있나만 보고 시각이 들어왔나는 안 봤다.
//   ② auditTeeGrid — 구멍이 4개 이상이면 '그건 못 읽은 것'이라며 일부러 넘어갔다.
//   ③ grid_short   — '가장 큰 순번'만 보고 가운데가 비었는지는 안 봤다.
//   ④ 교정소급     — 표를 갈아끼우고도 아무도 다시 안 셌다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { teeGaps } from '../src/boardreader.mjs';
import { auditTeeGrid } from '../src/judge.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRV = fs.readFileSync(path.join(ROOT, 'src', 'server.mjs'), 'utf8');
const BRD = fs.readFileSync(path.join(ROOT, 'src', 'boardreader.mjs'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };
const eq = (a, b, what, why = '') => ok(JSON.stringify(a) === JSON.stringify(b), `${what} (${JSON.stringify(a)})`, why || `기대 ${JSON.stringify(b)}`);

const grid = (spec) => spec.map(([pos, time, course]) => ({ pos, time, course }));

console.log('\n── ① 칸이 있는 것과 시각을 읽은 것은 다른 말이다 ──');
{
  const full = grid([[1, '16:25', 'OUT'], [2, '16:32', 'OUT'], [3, '16:32', 'IN'], [4, '16:39', 'OUT']]);
  eq(teeGaps(full, 4), [], '다 찬 표는 구멍 없음');
  eq(teeGaps(full, 6), [5, 6], '근무선이 표보다 길면 그 뒤가 구멍');

  // ★핵심: 순번은 있는데 시각이 빈 칸. 옛 teeGaps는 이걸 '있다'로 세어 구멍이 없다고 답했다.
  const hollow = grid([[1, '16:25', 'OUT'], [2, '', 'OUT'], [3, '16:32', 'IN'], [4, '18:0', 'OUT']]);
  eq(teeGaps(hollow, 4), [2, 4], '시각이 비었거나 깨진 칸은 구멍으로 센다',
    '순번만 세면 회원에게 줄 티오프가 없는 칸도 채워진 것처럼 보인다');
  eq(teeGaps(null, 4), [1, 2, 3, 4], '표가 아예 없으면 전부 구멍');
  eq(teeGaps(full, 0), [], '근무선을 모르면 판정하지 않는다(지어낸 구멍 금지)');
}

console.log('\n── ② 구멍이 크면 더 위험하다 ──');
{
  // 2026-08-26 실측 모양: 근무선 14, 티오프는 9번까지만.
  const short = grid([[1, '16:25', 'OUT'], [2, '16:32', 'OUT'], [3, '16:32', 'IN'], [4, '16:39', 'OUT'],
    [5, '16:39', 'IN'], [6, '17:00', 'OUT'], [7, '17:00', 'IN'], [8, '17:21', 'OUT'], [9, '17:35', 'OUT'],
    [13, '18:31', 'IN'], [14, '18:38', 'OUT']]);
  const v = { teeGrid: short, cutoffPosition: 14 };
  const flaw = auditTeeGrid(v);
  ok(!!flaw && Array.isArray(flaw.holes), '근무선 14에 10~12번이 비면 흠으로 잡는다',
    '옛 코드는 구멍 4개 이상이면 일부러 넘어갔다 — 8/26에 5개라 그냥 통과했다');
  eq(flaw && flaw.holes, [10, 11, 12], '빈 순번을 그대로 짚는다');
  ok(/티오프가 없습니다/.test((flaw && flaw.text) || ''), '사람이 읽을 문장으로 남긴다');
  ok(!/undefined/.test((flaw && flaw.text) || ''), '문장에 undefined가 새지 않는다');

  // 구멍이 아주 많아도 문장이 터지지 않아야 한다(표시는 줄이되 판정은 그대로).
  const bare = grid([[1, '16:25', 'OUT'], [2, '16:32', 'OUT'], [3, '16:32', 'IN'], [30, '18:38', 'OUT']]);
  const f2 = auditTeeGrid({ teeGrid: bare, cutoffPosition: 30 });
  ok(!!f2 && f2.holes.length === 26, '구멍 26개도 전부 센다');
  ok((f2.text.match(/·/g) || []).length <= 8 && /외 \d+자리/.test(f2.text), '문장은 앞 8개만 보이고 나머지는 개수로');
}

console.log('\n── ③ 판독 채택은 최대 순번이 아니라 실제로 찬 칸으로 판정한다 ──');
{
  const i = BRD.indexOf('const _adoptGaps = teeGaps(h.tees || [], cut);');
  ok(i > 0, '★채택 직후 구멍 검사가 teeGaps를 쓴다', 'gridMax만 보면 1~9번과 14번만 읽어도 14≥14라 통과한다');
  ok(i > 0 && /if \(_adoptGaps\.length\) \{/.test(BRD.slice(i, i + 400)), '구멍이 하나라도 있으면 이상으로 남긴다');
  ok(!/if \(cut > 0 && gridMax < cut\) \{/.test(BRD), '옛 최대순번 판정은 남아 있지 않다');
}

console.log('\n── ④ 교정은 덜 읽은 판독만 구제한다 ──');
{
  const i = SRV.indexOf('const _corrTees = Array.isArray(_cv.teeGrid) ? _cv.teeGrid : [];');
  ok(i > 0, '★교정 티오프와 새 판독 티오프를 견준다');
  const blk = i > 0 ? SRV.slice(i, i + 500) : '';
  ok(/_corrTees\.length >= _newTees\.length\) out\.rawVerdict\.teeGrid = _corrTees\.slice\(\);/.test(blk),
    '교정본이 새 판독보다 짧지 않을 때만 덮는다',
    '어제 컷9 교정본이 오늘 컷14 판독을 덮어써 10~14번이 비었다');
  ok(/티오프는 안 덮음/.test(blk), '안 덮었으면 안 덮었다고 로그에 남긴다');

  const j = SRV.indexOf('const _corrRoster = Array.isArray(_cv.part3Roster) ? _cv.part3Roster : [];');
  ok(j > 0, '★명단도 같은 규칙으로 견준다');
  ok(j > 0 && /_corrRoster\.length >= _newRoster\.length\) out\.rawVerdict\.part3Roster = _corrRoster\.slice\(\);/.test(SRV.slice(j, j + 400)),
    '교정 명단이 더 짧으면 새 판독을 살린다',
    '길이가 같을 때는 그대로 덮는다 — 대바(사진에 안 찍히는 교체) 보호는 살아 있어야 한다');

  ok(!/if \(Array\.isArray\(_cv\.teeGrid\) && _cv\.teeGrid\.length\) out\.rawVerdict\.teeGrid = _cv\.teeGrid\.slice\(\);/.test(SRV),
    '옛 무조건 덮어쓰기는 남아 있지 않다');
}

console.log('\n── ⑤ 표를 갈아끼웠으면 다시 센다 ──');
{
  const i = SRV.indexOf('const _gapNow = teeGaps(out.rawVerdict.teeGrid || [], _cutNow);');
  ok(i > 0, '★교정소급 뒤에 티오프 구멍을 다시 센다',
    '판독 직후 검산(auditTeeGrid)은 소급보다 앞에서 끝난다 — 소급이 표를 바꾼 뒤엔 아무도 안 셌다');
  const blk = i > 0 ? SRV.slice(i, i + 700) : '';
  ok(/raiseBoardIssue\(\{ kind: 'grid_short'/.test(blk), '구멍이 남으면 관리자에게 알린다');
  ok(/articleId: full\.id/.test(blk), '알림 서명에 글 번호를 넣는다(다음 배치표 알림을 삼키지 않게)');
  ok(SRV.includes("claudeBoardParts, teeGaps } from './boardreader.mjs'"), 'teeGaps를 실제로 들여온다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}개 통과${fail ? ` · ${fail}개 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
