// 본배치표가 그날의 정답인가 — 사장님이 못박은 기준(2026-08-25)이 코드에 박혀 있는지.
//
//  기준: 새 본배치표가 올라오면 그게 그날 모든 근무의 출발점이다. 리버힐이 카페에 올리는 공식 표다.
//   카카오·티스캐너가 다르게 말하면 틀린 건 예약처다 — 예약 취소·노쇼를 못 보기 때문이다.
//   그 뒤의 수정은 3부는 기존 시스템, 1·2부는 카카오/티스캐너가 맡는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frozenBy } from '../src/minorfreeze.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRV = fs.readFileSync(path.join(ROOT, 'src', 'server.mjs'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 본배치표는 제목이 아니라 실린 표로 가른다 ──');
{
  ok(/const isFullBoard = \/전체\|전부\/\.test\(full\.subject \|\| ''\)\s*\n\s*\|\| boardTables\.length >= 2 \|\| \(readParts \|\| \[\]\)\.length >= 2;/.test(SRV),
    '★부 표가 둘 이상 실렸으면 본배치표다',
    "제목만 보면 '전체'가 안 붙은 정식 배치표를 수정본으로 오해한다 — 8/25에 그렇게 1·2부가 통째로 멈췄다");
  const iTables = SRV.indexOf('const boardTables = Array.isArray(out.rawVerdict?.boardTables)');
  const iFull = SRV.indexOf("const isFullBoard = /전체|전부/.test(full.subject || '')");
  ok(iTables > 0 && iFull > iTables, '★근거(실린 표)를 구한 뒤에 판정한다', '순서가 뒤집히면 언제나 제목만 보게 된다');
}

console.log('\n── 본배치표는 수정배치표 잠금을 지나가지 않는다 ──');
{
  ok(/const _wouldFreeze = minorReadFrozen\(/.test(SRV), '잠금 판정을 한 번만 구한다');
  ok(/if \(_wouldFreeze && isFullBoard\) \{/.test(SRV) && /본배치표 — 수정배치표 잠금을 지나갑니다/.test(SRV),
    '★본배치표면 잠금을 지나가고, 지나갔다고 로그에 남긴다',
    '조용히 지나가면 관리자가 왜 덮였는지 못 되짚는다');
  ok(/if \(_wouldFreeze && !isFullBoard\) \{/.test(SRV),
    '★잠금은 부분 수정본에만 걸린다',
    '잠금의 원래 목적은 "2부 8팀 시간표입니다"가 본배치표를 덮는 걸 막는 것이었다');
}

console.log('\n── 본배치표를 읽었으면 예약처를 얹지 않는다 ──');
{
  ok(/const _mainBoardWins = _isBoardImg && _isFullBoard && !_boardReadFailed;/.test(SRV),
    '★본배치표를 제대로 읽었을 때만 성립한다');
  ok(/if \(\(full\.images \|\| \[\]\)\.length && !_mainBoardWins\) \{/.test(SRV),
    '★그 판독에는 카카오·티스캐너 보조가 안 걸린다',
    '예약처가 본배치표를 고치면 취소·노쇼가 없는 팀으로 되살아난다');
  ok(/보조\] 본배치표가 기준입니다/.test(SRV), '얹지 않았다는 사실을 로그에 남긴다');
  ok(/!_boardReadFailed/.test(SRV),
    '★본배치표 판독이 실패했을 때는 예약처가 대신 선다', '그때는 비어 있는 것보다 낫다');
}

console.log('\n── 잠금 판정 자체는 그대로다(순수 함수) ──');
{
  const pd = { roster: ['가', '나'], _targetISO: '2026-08-26' };
  ok(frozenBy({ part: '3', pd, newISO: '2026-08-26', todayISO: '2026-08-25', on: false }) === false,
    '3부는 이 문을 안 지난다');
  ok(frozenBy({ part: '2', pd, newISO: '2026-08-26', todayISO: '2026-08-25', on: false }) === true,
    '같은 근무일 + 이미 판독본 = 수정본');
  ok(frozenBy({ part: '2', pd, newISO: '2026-08-27', todayISO: '2026-08-25', on: false }) === false,
    '★새 근무일이면 잠기지 않는다 — 날짜가 이 판정의 축이다');
  ok(frozenBy({ part: '2', pd: { roster: [], _targetISO: '2026-08-26' }, newISO: '2026-08-26', todayISO: '2026-08-25', on: false }) === false,
    '아직 첫 판독 전이면 읽는다');
  ok(frozenBy({ part: '2', pd, newISO: '2026-08-26', todayISO: '2026-08-27', on: false }) === false,
    '지난 근무일 저장본은 낡음 — 새로 읽는다');
  ok(frozenBy({ part: '2', pd, newISO: '2026-08-26', todayISO: '2026-08-25', on: false, override: true }) === false,
    '관리자가 일부러 다시 읽히면 지나간다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
