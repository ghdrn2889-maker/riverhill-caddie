// ── 배치표 판독 손상 알림 — '의견'이 필요 없는 사실만 관리자에게 곧장 보낸다. ──
//  ★왜 감시 클로드(watchdog)를 안 거치는가 (2026-08-16 사고의 교훈):
//   그날 2부 명단 21~25번이 통째로 비었고, 시스템은 22:23에 그걸 정확히 감지해 로그에 남겼다.
//   그런데 관리자는 몰랐다. 신호가 사람에게 닿으려면 관문을 셋이나 통과해야 했기 때문이다.
//     ① 클로드 진단을 받아야 한다 → 그날은 일일 캡(150)이 소진돼 진단 자체가 못 돌았다.
//     ② 진단이 isRealBug && severity∈{med,high}로 나와야 한다 → 모델의 판단에 달렸다.
//     ③ WATCHDOG_PUSH=1이어야 한다 → 기본값은 억제(운영 잡음을 관리자 폰에 안 섞는 설계).
//   "명단에 구멍이 5칸"은 추론이 아니라 계수(計數)다. 판단자가 낄 자리가 없고, 낄수록 놓친다.
//   그래서 이 경로는 클로드·캡·플래그와 무관하게 감지 즉시 발송한다. 애매한 신호는 그대로 watchdog 담당.
//
//  조용시간(22~07시) 예외: 배치표는 전날 밤에 뜬다. 손상은 그날 밤에 고쳐야 아침 근무가 산다.
//   여기서 안 울리면 다음 기회는 사람들이 이미 출근한 뒤다 — 그래서 bypassQuiet.
import { loadJSON, saveJSON, appendJSONL } from './store.mjs';
import { broadcast } from './push.mjs';
import { adminUserIds } from './users.mjs';

const STATE = 'board-alert-state.json';
// 같은 손상으로 다시 안 울리는 창. 배치표는 재시도·시뮬레이트로 여러 번 판독되므로 이게 없으면 알림 폭풍.
const DEDUPE_MS = 6 * 3600 * 1000;

// 손상 종류 → 사람이 읽는 한 줄. 관리자가 알림만 보고 '뭘 해야 하는지' 알 수 있어야 한다.
function describe(it) {
  const p = it.part ? `${it.part}부` : '배치표';
  switch (it.kind) {
    case 'roster_holes': {
      const h = Array.isArray(it.holes) ? it.holes : [];
      const rng = h.length > 3 ? `${h[0]}~${h[h.length - 1]}번` : h.map((x) => `${x}번`).join('·');
      return { title: `${p} 명단 ${h.length}칸 비었습니다`, body: `순번 ${rng}을 읽지 못했습니다. 원본과 대조해 검수에서 채워주세요.` };
    }
    case 'tee_conflict':
      return { title: `${p} 티오프 충돌`, body: `${(it.times || []).slice(0, 4).join(', ')} — 순번과 시각이 밀렸을 수 있습니다. 검수에서 확인해주세요.` };
    case 'cross_part_contamination':
      return { title: `${p}에 옆 부 명단 유입`, body: `${it.purged || 0}명을 제거했습니다. 이 부 명단이 불완전할 수 있으니 검수해주세요.` };
    // ★7분 배수가 깨진 칸 — 예약팀이 팀을 하나 더 받으려고 격자 사이에 칸을 끼운 날이다(실측 8/18 3부 17:30).
    //  이 칸은 대조판 격자에도 없고 카카오 여집합에도 없다 — 팀이 하나 더 있는데 두 경로 모두 모른다.
    //  누가 말해주기 전엔 아무도 모르므로, 판독이 본 순간 곧바로 알린다.
    // ★시간표 글이 명단을 덮으려 한 순간 — 막았지만 사람이 확인해야 한다(8/19 2부 31명 → 8명).
    case 'roster_shrink':
      return { title: `${p} 명단이 ${it.was}명 → ${it.now}명으로 줄어 보입니다`,
        body: String(it.note || '').slice(0, 200) };
    case 'offgrid_tee':
      return { title: `${p} 격자 밖 티오프 ${(it.times || []).join(' ')}`,
        body: `7분 간격에서 벗어난 칸이 ${(it.times || []).length}개 있습니다 — 팀이 끼워진 것 같아요. `
          + `대조판 ${p} 줄의 ‘＋칸’으로 넣어두면 격자와 카카오 예상이 같이 맞습니다.` };
    case 'grid_short':
      return { title: `${p} 티오프 하단 누락`, body: `재판독 후에도 커트(${it.cut || '-'})에 못 미칩니다. 원본 아래쪽이 잘렸는지 확인해주세요.` };
    // ★끝점 검사 — '배치표를 봤는데 반영이 안 됐다'. 원인은 몰라도 이 사실만으로 사람이 움직여야 한다.
    //  2026-08-16: 8/17 배치표가 6번 판독 실패하고 조용히 넘어갔고, 사흘을 아무도 몰랐다.
    case 'board_not_reflected':
      return { title: '새 배치표가 아직 반영 안 됐습니다', body: String(it.note || '').slice(0, 200) };
    case 'kakao_down':
      return { title: '카카오골프 예약 관측 중단', body: String(it.note || '연속 실패 — 예약 현황이 갱신되지 않습니다.').slice(0, 200) };
    default:
      return { title: `${p} 판독 이상`, body: String(it.note || it.kind || '').slice(0, 120) };
  }
}

// 이 손상을 방금 알렸는가. 재판독마다 같은 알림이 가는 걸 막는다(창 밖이면 다시 알림 — 안 고쳐졌다는 뜻).
function seenRecently(sig, now) {
  const st = loadJSON(STATE, {}) || {};
  const last = Number(st[sig] || 0);
  if (last && now - last < DEDUPE_MS) return true;
  // 오래된 항목 정리 — 상태 파일이 무한히 자라지 않게.
  for (const k of Object.keys(st)) if (now - Number(st[k] || 0) > 3 * DEDUPE_MS) delete st[k];
  st[sig] = now;
  saveJSON(STATE, st);
  return false;
}

// 판독 손상 1건 → 관리자 폰. 절대 던지지 않는다(판독 파이프라인이 알림 때문에 죽으면 안 됨).
export async function raiseBoardIssue(it) {
  try {
    // 비상 차단 스위치 — 알림이 과하면 재배포 없이 BOARD_ALERT=0 으로 끈다(감지·로그는 그대로).
    if (String(process.env.BOARD_ALERT || '') === '0') return false;
    const now = Date.now();
    // 서명: 종류+부+구체값. 같은 구멍이면 같은 서명, 구멍이 늘면 새 서명(=다시 알림).
    // ★서명에 글 번호를 반드시 섞는다 — 안 그러면 첫 배치표 알림 하나가 6시간 동안 다음 배치표
    //  알림까지 삼킨다(중복차단은 '같은 손상'을 막으려는 것이지 '다음 사고'를 막으려는 게 아니다).
    const detail = it.kind === 'roster_holes' ? (it.holes || []).join(',')
      : it.kind === 'tee_conflict' ? (it.times || []).join(',')
        : String(it.articleId || it.purged || it.cut || '');
    const sig = `${it.kind}|${it.part || ''}|${detail}`;
    if (seenRecently(sig, now)) return false;
    const { title, body } = describe(it);
    const ids = adminUserIds();
    if (!ids.length) { console.warn('[판독손상] 관리자 계정이 없어 알림 생략 —', title); return false; }
    for (const id of ids) {
      try { await broadcast({ title: `판독 확인 필요 — ${title}`, body, url: '/', level: 'high', bypassQuiet: true }, id); }
      catch (e) { console.error('[판독손상] 알림 실패:', e.message); }
    }
    console.log(`[판독손상] 관리자 ${ids.length}명에게 알림: ${title} — ${body}`);
    appendJSONL('board-alert.jsonl', { at: now, sig, title, body, admins: ids.length, raw: it });
    return true;
  } catch (e) { console.error('[판독손상] 오류:', e.message); return false; }
}
