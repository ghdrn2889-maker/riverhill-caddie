// 오늘의 상황판(running state).
//  하루 동안 "김홍구"의 상황을 하나의 살아있는 그림으로 유지한다.
//  각 새 글을 이 그림에 '비추어' 병합하고, 바뀐 점(번복)을 감지해 알린다.
//  원칙: 원본 판독은 피드(recent.json)에 그대로 보존 → 상황판은 언제든 재생성 가능.
import { loadJSON, saveJSON } from './store.mjs';

const FILE = 'today.json';

export function loadToday() { return loadJSON(FILE, null); }
export function saveToday(s) { saveJSON(FILE, s); }

export function statusKo(s) {
  return (s === 'assigned' || s === 'work') ? '근무 확정'
    : s === 'your_turn' ? '지금 출근 차례'
    : s === 'near' ? '출근 임박'
    : s === 'waiting' ? '대기'
    : s === 'spare' ? '스페어(대기)'
    : s === 'off' ? '휴무' : '미상';
}

function blank(date) {
  return {
    date: date || '',
    name: (process.env.MY_NAME || '').trim(),
    part: `${(process.env.MY_PART || '').trim()}부`,
    myPosition: null, status: 'unknown', teeTime: '', course: '',
    cutoffName: '', cutoffPosition: null,
    timeline: [], updatedAt: null, articleId: null,
  };
}

const isWork = (s) => ['assigned', 'work', 'your_turn'].includes(s);
const isWait = (s) => ['spare', 'waiting', 'near', 'unknown'].includes(s);

// judge 에게 넘길 '오늘 지금까지 상황' 한 단락 (맥락 주입 → 이 글이 뭘 바꾸는지 판단).
export function todayContext(today) {
  if (!today) return '';
  const meaningful = today.myPosition || today.teeTime || (today.status && today.status !== 'unknown');
  if (!meaningful) return '';
  const p = [];
  if (today.myPosition) p.push(`순번 ${today.myPosition}번`);
  p.push(`상태 ${statusKo(today.status)}`);
  if (today.teeTime) p.push(`티오프 ${today.teeTime}${today.course ? `(${today.course})` : ''}`);
  if (today.cutoffName) p.push(`확정 커트라인 ${today.cutoffName}(${today.cutoffPosition ?? '?'}번)까지`);
  return `\n[오늘(${today.date || ''}) 지금까지 파악된 "${today.name}" 상황] ${p.join(', ')}.
이 글이 위 상황을 어떻게 바꾸는지(또는 그대로인지) 반영해 판단하세요. 순번은 이미 파악됐으면 그대로 쓰고, 이 글에서 더 확실히 보이면 갱신하세요.`;
}

// 새 판정(verdict)을 상황판에 병합. { next, change } 반환.
//  change = { changes:[{field,from,to,reversal,msg}], reversal, material, message }
export function applyVerdict(prev, verdict, article) {
  const d = verdict.dateLabel || (prev && prev.date) || '';
  // 날짜가 바뀌면(=다음 날 배치표) 상황판을 새로 시작.
  let cur = prev;
  if (!cur) cur = blank(d);
  else if (d && cur.date && d !== cur.date) cur = blank(d);
  else if (!cur.date && d) cur = { ...cur, date: d };

  const next = { ...cur, timeline: [...(cur.timeline || [])] };
  const changes = [];

  // ── 순번(lock): 새로 확실히 읽었으면 갱신(교환 등), 아니면 유지 ──
  const mp = Number(verdict.myPosition);
  if (Number.isFinite(mp)) {
    if (cur.myPosition != null && Number(cur.myPosition) !== mp)
      changes.push({ field: 'position', from: cur.myPosition, to: mp, reversal: false, msg: `순번 ${cur.myPosition}→${mp}번` });
    next.myPosition = mp;
  }

  // ── 티오프: 새 확정 / 변경(번복) 감지 ──
  const tee = verdict.teeTime && /\d{1,2}:\d{2}/.test(verdict.teeTime) ? verdict.teeTime : '';
  if (tee) {
    if (cur.teeTime && cur.teeTime !== tee)
      changes.push({ field: 'tee', from: cur.teeTime, to: tee, reversal: true, msg: `티오프 ${cur.teeTime}→${tee}` });
    else if (!cur.teeTime)
      changes.push({ field: 'tee_new', to: tee, reversal: false, msg: `티오프 ${tee} 배정` });
    next.teeTime = tee;
    next.course = verdict.course || cur.course || '';
  }

  // ── 상태: 스페어↔근무확정 등 번복 감지 ──
  let ns = verdict.myStatus || cur.status;
  if (tee) ns = ns === 'your_turn' ? 'your_turn' : 'assigned'; // 티오프 있으면 확정
  if (ns && ns !== 'unknown' && ns !== cur.status) {
    const reversal = (isWait(cur.status) && isWork(ns)) // 대기→근무
      || (isWork(cur.status) && (ns === 'off' || isWait(ns))); // 근무→취소/대기
    changes.push({ field: 'status', from: cur.status, to: ns, reversal, msg: `${statusKo(cur.status)} → ${statusKo(ns)}` });
    next.status = ns;
  } else if (ns) {
    next.status = ns;
  }

  // ── 커트라인: 명시된(cutoffAnnounced) 것만 반영 ──
  if (verdict.cutoffAnnounced && verdict.cutoffName) {
    next.cutoffName = verdict.cutoffName;
    if (Number.isFinite(Number(verdict.cutoffPosition))) next.cutoffPosition = Number(verdict.cutoffPosition);
  }

  next.timeline.push({ id: article.id, at: Date.now(), category: verdict.category || '', summary: verdict.summary || '' });
  if (next.timeline.length > 40) next.timeline = next.timeline.slice(-40);
  next.updatedAt = Date.now();
  next.articleId = article.id;

  return {
    next,
    change: {
      changes,
      reversal: changes.some((c) => c.reversal),
      material: changes.length > 0,
      message: changes.map((c) => c.msg).join(', '),
    },
  };
}
