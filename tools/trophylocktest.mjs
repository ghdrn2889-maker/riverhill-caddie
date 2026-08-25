// 업적(성장 공간) 잠금 — 켜는 쪽이 명시적인가, 그리고 문이 하나라도 열려 있지 않은가.
//  판정이 여러 군데서 틀린다는 지적을 받고 다시 잠갔다. 잠긴 동안 틀린 축하가 회원 폰까지 가면 안 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRV = R('src/server.mjs'), APP = R('public/app.js'), IDX = R('public/index.html');

let pass = 0, fail = 0;
const ok = (c, what, why = '') => { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  X   ' + what + (why ? ' — ' + why : '')); } };

console.log('\n── 기본값은 잠김이다 ──');
{
  delete process.env.TROPHY_ON;
  const { trophyOn } = await import('../src/trophy.mjs');
  ok(trophyOn() === false, '★아무 설정이 없으면 잠겨 있다', '기본이 열림이면 새 서버·새 배포가 조용히 열린다');
  for (const v of ['0', 'false', 'no', '', 'on', 'yes please']) {
    process.env.TROPHY_ON = v;
    if (trophyOn() !== false) ok(false, `TROPHY_ON="${v}" 인데 열렸다`);
  }
  ok(true, "애매한 값('on'·'0'·빈값)은 전부 잠김으로 친다");
  for (const v of ['1', 'true', 'yes', 'TRUE', 'Yes']) {
    process.env.TROPHY_ON = v;
    if (trophyOn() !== true) ok(false, `TROPHY_ON="${v}" 인데 안 열렸다`);
  }
  ok(true, "명시적으로 켤 때만 열린다(1·true·yes, 대소문자 무관)");
  delete process.env.TROPHY_ON;
}

console.log('\n── 서버의 문이 전부 잠겨 있다 ──');
{
  ok(/if \(!trophy\.trophyOn\(\)\) return res\.json\(\{ ok: true, locked: true, new: \[\] \}\);/.test(SRV),
    '★진열장 조회는 판정을 아예 돌리지 않는다', '빈 결과를 계산해 내려주면 틀린 판정이 그대로 도는 것이다');
  ok(/if \(!trophy\.trophyOn\(\)\) return res\.json\(\{ ok: true, cleared: 0, locked: true \}\);/.test(SRV),
    '축하 확인(ack)도 잠겨 있다');
  ok(/if \(!trophy\.trophyOn\(\)\) return \{ checked: 0, notified: 0, locked: true \};/.test(SRV),
    '★주기 판정(sweep)이 멈춘다 — 알림이 안 나가는 게 아니라 판정 자체를 안 한다',
    '판정만 돌려두면 다음에 켤 때 그동안의 틀린 결과가 한꺼번에 쏟아진다');
  const iSweep = SRV.indexOf('async function sweepTrophies');
  const iGate = SRV.indexOf('if (!trophy.trophyOn()) return { checked: 0, notified: 0, locked: true };');
  const iBusy = SRV.indexOf('if (_trophyBusy) return { checked: 0, notified: 0 };', iSweep);
  ok(iGate > iSweep && iGate < iBusy, '잠금 검사가 함수 맨 앞이다(다른 검사보다 먼저)');
  ok(/trophyOn: trophy\.trophyOn\(\)/.test(SRV), '★화면이 물어볼 수 있게 /api/me가 상태를 내려준다');
  ok(/try \{ trophy\.markFirst\(req\.user\.id, 'app'\); \}/.test(SRV),
    "★'처음 열어본 날'은 잠겨도 계속 적는다", '그건 판정이 아니라 사실이고, 지금 안 적으면 영영 잃는다');
}

console.log('\n── 화면 어디에도 들어갈 구멍이 없다 ──');
{
  ok(/function trophyLocked\(\) \{ return !\(meState && meState\.trophyOn\); \}/.test(APP),
    '★잠금 판정은 한 자리 — 서버가 준 값만 본다', '화면이 스스로 정하면 서버와 갈라진다');
  ok(/if \(trophyLocked\(\)\) \{ t\.hidden = true;/.test(APP), '홈 타일이 사라진다');
  ok(/tl\.classList\.add\('tl2'\)/.test(APP) && /\.tl\.tl2 \{ grid-template-columns:repeat\(2,1fr\); \}/.test(IDX),
    '★타일이 셋에서 둘로 — 3칸 격자에 두 개만 남겨 빈 칸이 생기지 않게');
  ok(/if \(!trophyLocked\(\)\) setTimeout\(\(\) => \{ gwBootCheck\(\); \}/.test(APP),
    '★앱을 열 때 뜨던 축하 팝업이 안 뜬다', '이게 남으면 화면은 잠겼는데 축하만 튀어나온다');
  ok(/\(x\.k === 'trophy' && trophyLocked\(\)\) \? '' :/.test(APP), '전체 메뉴 바로가기에서도 빠진다');
  ok(/data-i="\$\{i\}"/.test(APP),
    '★메뉴에서 빼도 나머지 항목의 번호가 안 밀린다', '번호가 밀리면 보험을 눌렀는데 수칙이 열린다');
  ok(/if \(trophyLocked\(\)\) return;\s+\/\/ ★잠김 — 어느 경로로 불려도 열리지 않는다/.test(APP),
    '★여는 함수 자체가 막혀 있다 — 옛 링크·뒤로가기로도 안 열린다');
}

console.log(`\n${fail ? 'X' : 'ok'}  ${pass}건 통과${fail ? ` · ${fail}건 실패` : ''}`);
process.exit(fail ? 1 : 0);
