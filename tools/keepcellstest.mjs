// 교정 보존 — 사람이 고친 칸만 지킨다. 새 사실을 막지 않는다.
//
//  2026-08-23 #27554 실사고: 15:06에 관리자가 3부를 교정했다. 15:35에 새 배치표가 왔고
//  거기엔 대바가 있었다 — 10번 조하빈 자리에 오동현, 16번 오동현 자리에 조하빈.
//  그런데 '명단 길이가 같다'는 이유로 새 판독의 명단이 통째로 버려지고 15:06 명단이 되쓰였다.
//  대조판은 대바를 보여주는데 앱은 옛 이름 그대로였고, 커트인 16번은 티오프조차 없었다.
//  '오독으로부터 교정을 지킨다'와 '새 사실을 막는다'는 다르다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, what, why = '') => {
  if (c) { pass++; console.log('  OK ' + what); }
  else { fail++; console.log('  X  ' + what + (why ? '  — ' + why : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const srv = read('src/server.mjs'), bc = read('src/boardcorrect.mjs'), mon = read('src/monitor.mjs');

console.log('\n[★고친 칸을 적어 두는가]');
{
  ok(/for \(const c of cellDiffs\) if \(c\.field === 'name' && Number\(c\.pos\) > 0\) keptNames\[c\.pos\] = c\.admin;/.test(bc),
    '3부 교정이 고친 이름 칸을 적는다');
  ok(/v\._adminCorrected = \{ at: Date\.now\(\), by, names: keptNames \};/.test(bc), '표식에 목록을 싣는다');
  ok(/\{ \.\.\.\(\(v\._adminCorrected && v\._adminCorrected\.names\) \|\| \{\}\) \}/.test(bc),
    '★이전 목록과 합친다', '1차에서 고치고 2차에서 안 건드린 칸도 지켜야 한다');
  ok(/pd\._adminCorrected = \{ at: Date\.now\(\), by: 'admin', names: keptNames \};/.test(mon),
    '1·2부 교정도 같은 규칙');
}

console.log('\n[★보존이 칸 단위인가]');
{
  const i = srv.indexOf('const kept = (pv._adminCorrected && pv._adminCorrected.names) || null;');
  ok(i > 0, '보존 자리에서 목록을 읽는다');
  const seg = srv.slice(i, i + 1400);
  ok(/for \(const \[posStr, nm\] of Object\.entries\(kept\)\)/.test(seg), '적힌 칸만 되돌린다');
  ok(/if \(String\(v\.part3Roster\[i\] \|\| ''\) === String\(nm \|\| ''\)\) continue;/.test(seg),
    '이미 같은 칸은 손대지 않는다');
  ok(/\[교정보존\] 사람이 고친 \$\{hit\.length\}칸만 지킴/.test(seg),
    '무엇을 지켰는지 남긴다', '조용히 되돌리면 왜 안 바뀌었는지 알 수 없다');
  // 명단 통째 되쓰기는 '옛 교정본' 폴백에만 남아야 한다
  const whole = (seg.match(/v\.part3Roster = pv\.part3Roster\.slice\(\);/g) || []).length;
  ok(whole === 1, `★명단 통째 되쓰기는 한 곳(옛 교정본 폴백)만 남았다 (${whole}곳)`,
    '두 곳이면 새 경로에도 통째 되쓰기가 살아 있다는 뜻이다');
  {   // ★빈 목록은 「지킬 게 없다」이지 「전부 지켜라」가 아니다.
    //  빈 목록을 「전부 지켜라」로 읽으면, 아무것도 안 고친 교정 한 번이 그날 새 배치표를 통째로 막는다.
    const at2 = seg.indexOf('const kept =');
    const cond = seg.slice(at2, at2 + 200).replace(/\s+/g, ' ');   // 공백·줄바꿈을 한 번에 하나로
    ok(/\|\| null; if \(kept\) \{/.test(cond),
      '★빈 목록도 목록으로 읽는다(전부 지키기로 넘어가지 않는다)',
      'Object.keys(kept).length 로 걸러버리면 빈 목록이 옛 교정본과 구분되지 않는다');
  }
  ok(/옛 교정본/.test(seg) && /다음 교정부터 칸 단위/.test(seg),
    '옛 교정본은 종전대로 두되 그렇다고 말한다', '업그레이드 당일에 보호가 사라지면 안 된다');
}

console.log('\n[그날 그 상황을 재현한다]');
{
  // 보존 규칙만 떼어내 재현 — 서버를 띄우지 않는다.
  const keep = (newRoster, kept) => {
    const out = newRoster.slice();
    for (const [p, nm] of Object.entries(kept || {})) {
      const i = Number(p) - 1;
      if (i < 0 || i >= out.length) continue;
      if (String(out[i] || '') === String(nm || '')) continue;
      out[i] = nm;
    }
    return out;
  };
  // 15:35 새 판독(대바가 들어 있다)
  const fresh = ['박진수', '박선하', '이하늘', '김서현', '김민찬', '문태익', '우겸조', '정용호',
    '김동우', '오동현', '강혜영', '박준서', '류곤', '최재영', '박수현', '조하빈'];
  // 15:06 교정에서 관리자가 실제로 고친 칸(예: 3번 이름 오독 교정)
  const kept = { 3: '이하늘(54)' };
  const merged = keep(fresh, kept);
  ok(merged[9] === '오동현' && merged[15] === '조하빈',
    '★대바(10번 오동현 · 16번 조하빈)가 살아서 들어온다',
    '예전엔 여기서 조하빈/오동현이 옛 자리로 되돌아갔다');
  ok(merged[2] === '이하늘(54)', '관리자가 고친 3번은 그대로 지켜진다');
  ok(merged.length === fresh.length, '명단 길이는 그대로');
  // 고친 칸이 새 판독과 이미 같으면 아무 일도 없다
  const same = keep(fresh, { 10: '오동현' });
  ok(same.join('|') === fresh.join('|'), '이미 같은 칸은 손대지 않는다');
}

console.log(`\n${fail ? 'X' : 'OK'}  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
