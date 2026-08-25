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
// ★같은 순간을 견뎌야 한다. 카카오 스냅샷이 낡았으면 어긋나는 게 당연하고, 그건 고장이 아니다.
//  실제로 첫 틱에서 이걸로 헛경보가 났다: 오늘 카카오가 '판매중 0칸'을 받고 고장을 의심해
//  저장을 거부하는 바람에 파일엔 몇 시간 전 값이 남아 있었고, 방금 받은 티스캐너와 견주니 14칸이 어긋났다.
//  낡은 스냅샷은 '두 판매처가 다르다'가 아니라 '카카오가 멈췄다'는 뜻이다 — 그건 kakao_down이 알린다.
const FRESH_MS = Number(process.env.TEESCANNER_FRESH_MS || 15 * 60 * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export const teeCrossState = () => loadJSON(STATE_FILE, null);

// ★한 틱만 어긋난 건 알리지 않는다 — 두 판매처의 갱신 시차다.
//  실측(2026-08-25 20:0x): 8/27 18:03|IN 한 칸이 어긋나 보였는데, 30초 뒤 세 번을 다시 보니
//  72칸 대 72칸으로 똑같았고 그 칸은 양쪽에서 사라져 있었다 — 마침 그 순간 예약이 들어간 것이다.
//  예약이 들어갈 때마다 알리면 알림이 예약 알림이 된다. 같은 어긋남이 두 틱(≈5분) 이어질 때만 알린다.
//  그리고 같은 어긋남은 하루 한 번까지 — 5분마다 같은 말을 하면 그건 배경음이 된다.
function shouldTell(date, sig) {
  const st = loadJSON(STATE_FILE, {}) || {};
  const prev = st[date];
  const now = Date.now();
  for (const k of Object.keys(st)) if (now - (st[k]?.at || 0) > 7 * 86400000) delete st[k];
  if (!prev || prev.sig !== sig) {           // 처음 본 어긋남 — 다음 틱까지 기다린다
    st[date] = { sig, at: now, seen: 1, told: 0 };
    saveJSON(STATE_FILE, st);
    return false;
  }
  const seen = (prev.seen || 1) + 1;
  const told = prev.told || 0;
  const tell = seen >= 2 && (!told || now - told > 24 * 3600 * 1000);
  st[date] = { sig, at: now, seen, told: tell ? now : told };
  saveJSON(STATE_FILE, st);
  return tell;
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
    // ★그 스냅샷을 티스캐너가 채웠으면 견줄 게 없다 — 자기 자신과 비교해 '일치'로 읽으면
    //  카카오가 멈춘 걸 '두 판매처가 잘 맞는다'로 덮어버린다. 감시기가 사고를 가리는 모양이 된다.
    if (snap.source && snap.source !== '카카오골프') {
      console.log(`[티스캐너] ${date} 대조 건너뜀 — 이 스냅샷은 티스캐너가 채운 것입니다(카카오가 멈춘 날)`);
      continue;
    }
    const age = Date.now() - Number(snap.at || 0);
    if (age > FRESH_MS) {
      console.log(`[티스캐너] ${date} 대조 건너뜀 — 카카오 스냅샷이 ${Math.round(age / 60000)}분 전 것입니다(같은 순간이 아님)`);
      continue;
    }
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
    if (shouldTell(date, sig)) {
      console.warn(`⚠️ [티스캐너] ${say}`);
      raiseBoardIssue({ kind: 'source_mismatch', part: 3, note: say.slice(0, 110) });
    } else {
      // 아직 한 번만 봤다 — 예약이 막 들어간 순간일 수 있다. 기록만 남기고 다음 틱을 본다.
      console.log(`[티스캐너] ${say} (한 틱만 — 다음 틱에도 그대로면 알립니다)`);
    }
    await sleep(1200);   // 남의 서버다
  }
  return { checked, gaps };
}
