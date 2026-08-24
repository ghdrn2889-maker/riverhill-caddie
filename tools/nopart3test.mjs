// 3부가 없는 배치표(샷건 대회날)를 '판독 실패'로 세지 않고, 1·2부는 살리는가.
//  기준은 2026-08-25 청송 군수배 — 1부 13팀 · 2부 44팀 · 3부 없음.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRV = fs.readFileSync(path.join(ROOT, 'src', 'server.mjs'), 'utf8');
const RDR = fs.readFileSync(path.join(ROOT, 'src', 'boardreader.mjs'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 판독기에게 부 목록을 물을 수 있다 ──');
{
  ok(/export async function claudeBoardParts\(article\)/.test(RDR), '캐시에서 부 목록을 꺼내는 문이 있다');
  ok(/if \(!img \|\| !_boardCache\.has\(img\)\) return null;/.test(RDR),
    '★아직 안 읽었으면 null — 「부가 하나도 없다」와 구분한다',
    '빈 배열로 돌려주면 안 읽은 배치표가 「전 부 없음」이 되어 전부 건너뛴다');
  ok(/roster\.filter\(Boolean\)\.length\)/.test(RDR), '명단이 실제로 찬 부만 센다(빈 껍데기 제외)');
  const fn = RDR.slice(RDR.indexOf('export async function claudeBoardParts'), RDR.indexOf('export async function claudeDutyList'));
  ok(!/readBoardByClaude\(|runPy\(/.test(fn), '★새로 판독하지 않는다 — 캐시만 본다(추가 비용 0)');
}

console.log('\n── 3부가 없는 날을 실패로 세지 않는다 ──');
{
  ok(/const _noPart3 = _isBoardImg && Array\.isArray\(readParts\) && readParts\.length > 0 && !readParts\.includes\('3'\);/.test(SRV),
    '실린 부를 실제로 읽어냈고 그 안에 3부가 없을 때만 성립한다');
  ok(/primaryRet\.boardReadFailed = _boardReadFailed && !_noPart3;/.test(SRV),
    '★3부 없는 날은 재시도·대기표로 가지 않는다',
    '예전엔 6번 재시도하고 대기표에 쌓이고 관리자 폰을 울렸다 — 실패한 건 없었는데');
  ok(/if \(_boardReadFailed && !_noPart3\) \{/.test(SRV), '실패 사유도 붙이지 않는다');
  // ★못 읽은 경우(readParts=null)엔 예전 그대로 실패로 남아야 한다.
  ok(/Array\.isArray\(readParts\) && readParts\.length > 0/.test(SRV),
    '★진짜로 못 읽었을 땐(null) 예전처럼 실패다',
    '이걸 놓치면 판독 고장이 조용해져 배치표가 옛것에 얼어붙는다');
}

console.log('\n── 3부가 없어도 1·2부는 반영된다 ──');
{
  ok(/const hasTable = boardTables\.some\(\(t\) => String\(t\?\.part\) === p\) \|\| \(readParts \|\| \[\]\)\.includes\(p\);/.test(SRV),
    '★판독기가 읽어낸 부도 「표 있음」의 근거가 된다',
    '예전엔 주회원(3부) verdict의 boardTables만 봤다 — 3부가 없으면 그게 통째로 null이라 1·2부까지 건너뛰었다');
  ok(/\(readParts \|\| \[\]\)/.test(SRV), '부 목록을 못 구했으면 예전 동작 그대로(빈 배열 취급)');
}

console.log('\n── 부 목록은 한 번만 구한다 ──');
{
  const n = (SRV.match(/await claudeBoardParts\(full\)/g) || []).length;
  ok(n === 1, `조회는 한 자리에서만(지금 ${n}곳)`, '두 번 부르면 캐시 미스 때 서로 다른 답을 들 수 있다');
  const iFetch = SRV.indexOf('await claudeBoardParts(full)');
  const iUse = SRV.indexOf('(readParts || []).includes(p)');
  ok(iFetch > 0 && iUse > iFetch, '★구한 뒤에 쓴다', '쓰는 자리가 위면 언제나 null이라 고친 게 무효가 된다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
