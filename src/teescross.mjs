// 카카오 ↔ 티스캐너 대조 — 두 판매처가 같은 칸을 보는지 5분마다 확인한다.
//
//  ★처음 8일 실측(2026-08-25)에선 493칸이 한 칸도 안 어긋났다. 둘은 같은 물량을 받아 파는
//   판매처라, 골프장이 안 내놓은 칸은 양쪽 다 못 본다. 그래서 이건 '카카오가 놓친 칸을 줍는' 장치가 아니다.
//
//  그럼 왜 돌리나 — 지금 어긋남이 0이라는 걸 알기 때문에, **어긋나는 순간이 곧 신호**다.
//   ①카카오 응답 형식이 바뀌었거나 ②골프장이 한쪽에만 물량을 내기 시작했거나
//   ③둘 중 하나가 낡은 값을 주고 있다. 셋 다 지금은 아무도 못 잡는 고장이다.
//   같아야 할 둘이 달라지는 걸 지켜보는 게, 하나만 보며 맞기를 바라는 것보다 낫다.
//
//  ★카카오를 다시 두드리지 않는다 — 방금 남긴 스냅샷(openKeys)을 읽는다.
import { appendJSONL, loadJSON, saveJSON } from './store.mjs';
import { loadSnapshot } from './kakaogolf.mjs';
import { fetchOpen, teescannerOn, teeHealth, TeeAuthError } from './teescanner.mjs';
import { raiseBoardIssue } from './boardalert.mjs';

const STATE_FILE = 'teescanner-cross.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export const teeCrossState = () => loadJSON(STATE_FILE, null);

// 어긋남을 매 틱 알리지 않는다 — 5분마다 같은 말을 하면 그건 배경음이 된다.
//  날짜+어긋난 칸 묶음이 그대로면 하루에 한 번만 알린다.
function shouldTell(date, sig) {
  const st = loadJSON(STATE_FILE, {}) || {};
  const prev = st[date];
  if (prev && prev.sig === sig && Date.now() - prev.at < 24 * 3600 * 1000) return false;
  st[date] = { sig, at: Date.now() };
  for (const k of Object.keys(st)) if (Date.now() - (st[k]?.at || 0) > 7 * 86400000) delete st[k];
  saveJSON(STATE_FILE, st);
  return true;
}

export async function crossTick({ days = 2 } = {}) {
  if (!teescannerOn()) return null;
  // ★인증이 계속 거절되면 5분마다 다시 두드리지 않는다 — 그게 계정을 잠그는 길이다.
  const h = teeHealth();
  if (h?.authCooldownUntil && Date.now() < h.authCooldownUntil) return null;

  const today = new Date();
  let checked = 0, gaps = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const date = ymd(d);
    const snap = loadSnapshot(date);
    if (!snap || !Array.isArray(snap.openKeys)) continue;   // 카카오가 아직 안 본 날은 견줄 게 없다
    let tee;
    try {
      tee = await fetchOpen(date);
    } catch (e) {
      if (e instanceof TeeAuthError) {
        console.error('[티스캐너] 인증 실패 —', e.message);
        raiseBoardIssue({ kind: 'teescanner_auth', part: 3,
          note: `티스캐너 로그인 실패 — 6시간 쉬었다 다시 시도합니다. ${e.message}`.slice(0, 90) });
        return null;         // 남은 날짜도 건너뛴다
      }
      console.error(`[티스캐너] ${date} 조회 실패:`, e.message);
      continue;
    }
    checked++;
    const K = new Set(snap.openKeys);
    const T = new Set(tee.map((x) => `${x.time}|${x.course}`));
    const onlyTee = [...T].filter((k) => !K.has(k)).sort();   // 카카오가 '찼다'고 볼 칸인데 티스캐너는 판다
    const onlyKk = [...K].filter((k) => !T.has(k)).sort();
    if (!onlyTee.length && !onlyKk.length) continue;          // 같으면 조용히 — 이게 정상이다

    gaps += onlyTee.length + onlyKk.length;
    const sig = `${onlyTee.join(',')}|${onlyKk.join(',')}`;
    appendJSONL('teescanner-cross.jsonl', { at: Date.now(), date, kakao: K.size, tee: T.size, onlyTee, onlyKk });
    const say = `${date} 두 판매처가 어긋납니다 — 카카오 ${K.size}칸 · 티스캐너 ${T.size}칸`
      + (onlyTee.length ? ` · 티스캐너에만 ${onlyTee.length}칸(${onlyTee.slice(0, 5).join(' ')})` : '')
      + (onlyKk.length ? ` · 카카오에만 ${onlyKk.length}칸(${onlyKk.slice(0, 5).join(' ')})` : '');
    console.warn(`⚠️ [티스캐너] ${say}`);
    if (shouldTell(date, sig)) {
      raiseBoardIssue({ kind: 'source_mismatch', part: 3, note: say.slice(0, 110) });
    }
    await sleep(1200);   // 남의 서버다
  }
  return { checked, gaps };
}
