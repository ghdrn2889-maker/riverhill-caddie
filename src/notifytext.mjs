// 알림 문구 카탈로그 — 회원에게 갈 말을 한 곳에서 짓는다.
//
//  ★왜: 문구가 여섯 파일 쉰두 군데로 갈라져 있었다. 그래서 같은 뜻이 두 벌씩 돌았다 —
//   '휴무'와 '3부 휴무', '티오프 시간 변경!'과 '3부 티오프 변경'. 부가 붙는 것과 안 붙는 것,
//   느낌표가 있는 것과 없는 것이 같은 종류 안에서 갈렸다. 읽는 사람은 그걸 '다른 알림'으로 읽는다.
//
//  ★규칙(여기서만 지키면 전부 지켜진다):
//   · 이모지를 쓰지 않는다.
//   · 부(部)는 제목 맨 앞에 온다 — 회원이 폰에서 제일 먼저 봐야 하는 게 그것이다.
//   · 느낌표를 쓰지 않는다. 알림은 그 자체로 이미 다급하다.
//   · 존댓말 서술형으로 끝낸다(…입니다 / …됐습니다). 명사형·명령형을 섞지 않는다.
//   · 날짜에서 연도는 뺀다 — 오늘내일 이야기에 '2026년'은 자리만 차지한다.
//
//  ★이 파일은 '무엇을 보낼지'를 정하지 않는다. 문구만 짓는다.

// 관리자가 고를 수 있는 종류. 순서는 실제로 자주 쓰는 순.
export const KINDS = [
  { key: 'state', label: '지금 상태 그대로', hint: '그 회원의 현재 배치를 읽어 알맞은 문구를 고릅니다' },
  { key: 'work', label: '근무 배정' },
  { key: 'tee', label: '티오프 변경' },
  { key: 'spare', label: '스페어 전환' },
  { key: 'off', label: '휴무' },
  { key: 'board', label: '배치표 수정' },
  { key: 'free', label: '자유 문구', hint: '제목·내용을 직접 씁니다' },
];
export const KIND_KEYS = KINDS.map((k) => k.key);

// '2026년 8월 20일 목요일' → '8월 20일 목요일'
const dayText = (d) => String(d || '').replace(/^\s*\d{4}\s*년\s*/, '').trim();
export const partLabel = (part) => (String(part) === '1' ? '1부(조출)' : `${part}부`);

// 회원 한 명의 오늘 상태 → 문구를 지을 재료.
//  extra: { teeFrom } — 티오프가 '무엇에서' 바뀌었는지. 아는 날엔 말해주는 게 훨씬 낫다.
export function contextOf(part, name, today = {}, extra = {}) {
  const course = /IN/i.test(today.course || '') ? 'IN' : (today.course ? 'OUT' : '');
  return {
    teeFrom: String(extra.teeFrom || ''),
    part: String(part), pl: partLabel(part), name: String(name || ''),
    day: dayText(today.date),
    pos: Number(today.myPosition) || 0,
    tee: String(today.teeTime || ''),
    course,
    cut: Number(today.cutLine || today.cutoffPosition) || 0,
    status: String(today.status || ''),
  };
}

// 자리 설명 — '3부 9번 · 17:07 OUT' / 티오프가 없으면 '3부 9번'
const seat = (c) => [`${c.pl} ${c.pos ? `${c.pos}번` : ''}`.trim(), c.tee ? `${c.tee}${c.course ? ` ${c.course}` : ''}` : '']
  .filter(Boolean).join(' · ');
const cutTail = (c) => (c.cut ? ` 커트 ${c.cut}번까지 근무입니다.` : '');
const head = (c) => (c.day ? `${c.day} ` : '');

// 현재 상태에서 종류를 고른다 — 관리자가 '지금 상태 그대로'를 골랐을 때 쓴다.
export function kindFromState(ctx) {
  if (ctx.status === 'off') return 'off';
  if (ctx.status === 'assigned' || ctx.status === 'work') return ctx.tee ? 'work' : 'board';
  if (ctx.status === 'spare' || ctx.status === 'waiting' || ctx.status === 'near') return 'spare';
  return 'board';
}

// 상태(status) → 제목. 회원의 '부'를 받아 붙인다.
//  ★이게 두 벌이었다: judge.mjs의 titleFor와 server.mjs의 titleForStatus. 서로 달랐고
//   (near가 한쪽은 '스페어 상위 — 곧 차례!', 다른 쪽은 '곧 출근 순번!'), 게다가 '3부'가 글자로
//   박혀 있어 1·2부 회원에게도 "3부 대기 현황"이라고 갔다. 한 곳으로 모으고 부를 인자로 받는다.
export function statusTitle(status, part) {
  const pl = partLabel(part);
  switch (String(status)) {
    case 'your_turn': return `${pl} 지금 출근 순번`;
    case 'near':      return `${pl} 곧 출근 순번`;
    case 'assigned':
    case 'work':      return `${pl} 근무 배정`;
    case 'waiting':
    case 'spare':     return `${pl} 스페어 전환`;
    case 'off':       return `${pl} 휴무`;
    default:          return `${pl} 소식`;
  }
}

// 종류 + 재료 → { title, body }. 재료가 모자라면 아는 만큼만 말한다(지어내지 않는다).
// ── 업적 달성 ──────────────────────────────────────────────
//  ★한 번에 여러 개를 달성해도 알림은 한 통이다. 트로피 하나마다 울리면
//   축하가 아니라 성가심이 된다(방금 걷어낸 '중구난방'으로 되돌아가는 길).
//  ★급한 알림이 아니다 — 조용시간이면 아침 대기열로 간다(부르는 쪽에서 bypassQuiet:false).
// 받침을 보고 을/를을 고른다 — 트로피 이름이 늘어나므로 손으로 쓰면 언젠가 틀린다.
const eul = (w) => {
  const c = String(w || '').trim().slice(-1).charCodeAt(0);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return '를';        // 한글이 아니면 무난한 쪽으로
  return (c - 0xac00) % 28 ? '을' : '를';
};
export function trophyNotice(list = []) {
  const arr = [...list].filter(Boolean);
  if (!arr.length) return null;
  const head = arr[0];                       // 대표 = 이미 등급·최신순으로 정렬돼 온다
  const rest = arr.length - 1;
  const tier = { bronze: '브론즈', silver: '실버', gold: '골드', hidden: '히든', platinum: '플래티넘' }[head.tier] || '';
  return {
    title: rest ? `업적 달성 — ${head.name} 외 ${rest}개` : `업적 달성 — ${head.name}`,
    body: rest
      ? `${tier} ${head.name}${eul(head.name)} 비롯해 ${arr.length}개가 열렸습니다. 성장 공간에 새 트로피가 놓였습니다.`
      : `${tier} 트로피입니다. ${String(head.short || '').replace(/[.!?]+$/, '')} — 성장 공간에 새 트로피가 놓였습니다.`,
    url: '/',
    level: 'normal',
  };
}

export function compose(kind, ctx) {
  const k = KIND_KEYS.includes(String(kind)) ? String(kind) : 'state';
  if (k === 'free') return { title: '', body: '' };
  if (k === 'state') return compose(kindFromState(ctx), ctx);
  if (k === 'work') {
    return { title: `${ctx.pl} 근무 배정`, body: `${head(ctx)}${seat(ctx)} 입니다.${cutTail(ctx)}` };
  }
  if (k === 'tee') {
    // 무엇에서 무엇으로 바뀌었는지 아는 날엔 그걸 말한다 — '바뀌었습니다'만으로는 앱을 열어야 안다.
    if (ctx.tee && ctx.teeFrom) {
      return { title: `${ctx.pl} 티오프 변경`,
        body: `${head(ctx)}${ctx.pl} 티오프가 ${ctx.teeFrom} → ${ctx.tee}${ctx.course ? ` ${ctx.course}` : ''}(으)로 바뀌었습니다.` };
    }
    return { title: `${ctx.pl} 티오프 변경`, body: ctx.tee
      ? `${head(ctx)}${seat(ctx)}으로 바뀌었습니다.`
      : `${head(ctx)}${ctx.pl} 티오프가 바뀌었습니다.` };
  }
  if (k === 'spare') {
    return { title: `${ctx.pl} 스페어 전환`, body: `${head(ctx)}${ctx.pl}${ctx.pos ? ` ${ctx.pos}번` : ''} · 대기입니다.`
      + (ctx.cut ? ` 커트 ${ctx.cut}번까지라 오늘은 스페어입니다.` : '') };
  }
  if (k === 'off') {
    return { title: `${ctx.pl} 휴무`, body: `${head(ctx)}${ctx.pl} 휴무로 확인됩니다.` };
  }
  // board
  return { title: `${ctx.pl} 배치표 수정`, body: `${head(ctx)}${ctx.pl} 배치표가 수정됐습니다.` };
}
