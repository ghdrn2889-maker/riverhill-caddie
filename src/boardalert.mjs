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
import { broadcastOps } from './push.mjs';


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
    case 'grid_short': {
      // ★3부는 아래가 잘려서, 1·2부는 옆(부 경계)이 잘려서 짧아진다 — 어느 순번이 비었는지 같이 말해준다.
      const miss = (it.miss || []).join(',');
      return { title: `${p} 티오프 ${miss ? `빈 순번 ${miss}` : '누락'}`,
        body: miss
          ? `커트 ${it.cut || '-'}인데 ${(it.miss || []).length}칸이 비었습니다. 검수에서 채워주세요 — 원본에서 그 줄이 잘렸을 수 있습니다.`
          : `재판독 후에도 커트(${it.cut || '-'})에 못 미칩니다. 원본 아래쪽이 잘렸는지 확인해주세요.` };
    }
    // ★끝점 검사 — '배치표를 봤는데 반영이 안 됐다'. 원인은 몰라도 이 사실만으로 사람이 움직여야 한다.
    //  2026-08-16: 8/17 배치표가 6번 판독 실패하고 조용히 넘어갔고, 사흘을 아무도 몰랐다.
    // ★2026-08-21: 3부에 '김예원'이 두 번, 1부에 '강경순'이 잘못 — 둘 다 어떤 검사에도 안 걸렸다.
    case 'dup_name':
      return { title: `${p} 명단에 같은 이름이 두 번`,
        body: `${(it.names || []).join(', ')} — 한 사람이 두 순번을 먹고 있습니다. 원본과 대조해 검수에서 지워주세요.` };
    case 'cut_overflow':
      return { title: `${p} 커트가 명단보다 큽니다`,
        body: `커트 ${it.cut}인데 명단은 ${it.rosterLen}명입니다. 명단 아래가 잘렸을 수 있습니다.` };
    case 'tag_no_counterpart':
      return { title: '두 부 근무 표시와 명단이 어긋납니다',
        body: `${(it.names || []).join(' / ')} — 태그가 가리키는 부에 그 이름이 없습니다. 이름을 흘려 읽었을 수 있습니다.` };
    case 'cross_untagged':
      return { title: '두 부에서 근무인데 설명이 안 되는 사람',
        body: `${(it.names || []).join(' / ')} — 표시도 없고 당겨온 자리(명단 맨 끝)도 아닙니다. 한쪽은 잘못 들어간 이름일 수 있습니다.` };
    // ★중복 근무자는 당길 수 없다 — 이미 두 부에 묶여 있어 빼낼 시간이 없다(관리자 확인).
    case 'pull_forbidden':
      return { title: '중복 근무자가 표시에 없는 부에서 근무로 잡혔습니다',
        body: `${(it.names || []).join(' / ')} — 당겨올 수 있는 사람은 한 부만 뛰는 캐디입니다. 이름이나 부를 잘못 읽었을 수 있습니다.` };
    // ★근무자 수 = 팀 수. 팀 하나에 캐디 한 명이 붙는다 — 어긋나면 명단이나 커트 중 하나가 틀렸다.
    case 'part_count_mismatch':
      return { title: `${p} 근무자 수가 팀 수와 다릅니다`,
        body: `팀 ${it.cut}인데 근무자는 ${it.workers}명입니다. 명단이 잘렸거나 커트를 잘못 읽었습니다.` };
    // ★배치표엔 있는데 정본 명단에 없는 이름 — 오독이거나 미등록 신입, 둘 중 하나뿐이다.
    case 'unknown_names':
      return { title: '정본 명단에 없는 이름이 배치표에 있습니다',
        body: `${(it.names || []).join(', ')} — 이름을 흘려 읽었거나, 아직 정본에 없는 캐디입니다. 오독이면 그 자리 사람이 통째로 사라진 것입니다.` };
    // ★배치표가 스스로 적어둔 인원 요약과 우리가 센 수가 어긋남 — 그날 몇 명을 통째로 놓쳤다는 뜻이다.
    //  이건 추정이 아니라 채점이다. 배치표에 인쇄된 숫자가 정답이고 우리 수가 오답이다.
    case 'headcount_mismatch': {
      const miss = (it.misses || []).map((m) => `${m.key} ${m.counted}/${m.declared}`).join(' · ');
      const n = Math.abs(Number(it.gap) || 0);
      return { title: `배치표 인원 ${n}명을 못 찾았습니다`,
        body: `배치표 총원 ${it.declared}명 중 ${it.counted}명만 자리를 찾았습니다.`
          + (miss ? ` 어긋난 곳: ${miss}.` : '')
          + ' 명단을 못 읽은 자리가 있습니다 — 검수에서 확인해 주세요.' };
    }
    // ★인턴 지정을 버렸다 — 조용히 지우면 안 된다. 사람이 손으로 넣은 것이고,
    //  새 배치표에도 그 인턴이 그대로면 다시 넣어야 한다는 뜻이다(2026-08-26).
    case 'intern_reset':
      return { title: `${p} 인턴 지정을 새 배치표에 맞춰 비웠습니다`,
        body: `이전 배치표에서 지정한 ${(it.tees || []).join(' ')} ${(it.tees || []).length}칸을 비웠습니다. `
          + '새 배치표에도 인턴이 있으면 검수나 대조판에서 다시 지정해주세요.' };
    case 'board_not_reflected':
      return { title: '새 배치표가 아직 반영 안 됐습니다', body: String(it.note || '').slice(0, 200) };
    case 'kakao_down':
      return { title: '카카오골프 예약 관측 중단', body: String(it.note || '연속 실패 — 예약 현황이 갱신되지 않습니다.').slice(0, 200) };
    // ★두 판매처(카카오·티스캐너)는 같은 물량을 판다 — 어긋나면 그게 곧 고장 신호다.
    //  실측 8일 493칸이 한 칸도 안 어긋났기에, 어긋남 자체가 드물고 그래서 값어치가 있다.
    case 'source_mismatch':
      return { title: '예약 판매처 둘이 어긋납니다', body: String(it.note || '').slice(0, 200)
        + ' — 한쪽이 낡았거나 응답 형식이 바뀌었을 수 있습니다.' };
    case 'teescanner_auth':
      return { title: '티스캐너 로그인이 안 됩니다', body: String(it.note || '').slice(0, 200) };
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
        // 채점은 '몇 대 몇'이 서명이다 — 같은 어긋남이면 한 번만, 어긋남이 커지면 다시 알린다.
        : it.kind === 'headcount_mismatch' ? `${it.declared}-${it.counted}`
          : Array.isArray(it.names) ? it.names.join(',')
            : String(it.articleId || it.purged || it.cut || '');
    const sig = `${it.kind}|${it.part || ''}|${detail}`;
    if (seenRecently(sig, now)) return false;
    const { title, body } = describe(it);
    // ★운영 통로로 보낸다 — 회원 알림 장부·대기열과 섞이지 않는다.
    //  밤에도 통과시킨다: 3부 배치표는 밤에 올라오고, 판독이 깨진 걸 아침에 알면 이미 늦다.
    const r = await broadcastOps({ title: `판독 확인 필요 — ${title}`, body, url: '/', level: 'high', bypassQuiet: true });
    if (!r.admins) return false;
    appendJSONL('board-alert.jsonl', { at: now, sig, title, body, admins: r.admins, raw: it });
    return true;
  } catch (e) { console.error('[판독손상] 오류:', e.message); return false; }
}
