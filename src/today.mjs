// 오늘의 상황판(running state).
//  하루 동안 "김홍구"의 상황을 하나의 살아있는 그림으로 유지한다.
//  각 새 글을 이 그림에 '비추어' 병합하고, 바뀐 점(번복)을 감지해 알린다.
//  원칙: 원본 판독은 피드(recent.json)에 그대로 보존 → 상황판은 언제든 재생성 가능.
import fs from 'node:fs';
import path from 'node:path';
import { loadUserJSON, saveUserJSON, userDataDir } from './store.mjs';

const FILE = 'today.json';

// 부(部)별 상황판 파일. 3부(기본)=today.json, 2부=today2.json, 1부=today1.json.
//  ★part 인자 없으면 기존 그대로 today.json → 기존 호출부 무변화.
function fileFor(part) {
  const p = String(part);
  return p === '1' ? 'today1.json' : p === '2' ? 'today2.json' : FILE;
}

// ★userId 미지정이면 1번 회원(김홍구) — 기존 호출부 무변화. part='2'면 2부 슬롯.
export function loadToday(userId = 1, part = '3') { return loadUserJSON(userId, fileFor(part), null); }
export function saveToday(s, userId = 1, part = '3') { saveUserJSON(userId, fileFor(part), s); }

// 부별 슬롯 삭제 — 옛 날짜 잔재(예: 1,3 근무자의 지난주 2부 today2) 정리용.
//  ★1·2부 슬롯만 정리한다(3부 기본 today.json은 '스테일 표시' 기능 보존 위해 삭제하지 않음).
export function clearTodayPart(userId, part) {
  const p = String(part);
  if (p !== '1' && p !== '2') return false;
  try { fs.rmSync(path.join(userDataDir(userId), fileFor(p)), { force: true }); return true; }
  catch { return false; }
}

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

// 날짜 라벨을 '월-일'로 정규화(같은 날인지 판단용). "7월 28일 화요일"·"2026년 7월 28일 화요일" 모두 "07-28".
//  ★판독마다 라벨 형식이 달라도(연도 유무 등) 같은 날을 '새 날'로 오인해 상황판을 리셋하지 않게.
function dayKey(label) {
  const m = String(label || '').match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : String(label || '').trim();
}

// ── 관리자 수동 교정 잠금(override) ──
//  관리자가 고친 값(status/teeTime/course/cutLine/myPosition)은 자동 판독이 덮지 않는다.
//  lock = { dk:'MM-DD', articleId?, fields:{status:1,...}, by, at }
//   · articleId 없음(회원별 교정: 휴무 등) → 그날 내내 유효(배치표가 바뀌어도 유지).
//   · articleId 있음(배치표 검수 교정) → 같은 배치표(글) 재판독만 덮지 않고, '새 배치표(다른 글)'가 오면 해제.
//  날짜가 바뀌면 무조건 만료(그날만 유효).
export function applyAdminLock(next, prev) {
  if (!next) return next;
  const lock = prev && prev._adminLock;
  delete next._adminLock;                                   // 캐리된 옛 잠금 제거(아래서 유효하면 다시 설정)
  if (!lock || !lock.fields) return next;
  if (dayKey(next.date) !== lock.dk) return next;           // 다른 날 → 만료
  if (lock.articleId && String(next.articleId) !== String(lock.articleId)) return next; // 새 배치표 → 배치표잠금 해제
  for (const f of Object.keys(lock.fields)) if (lock.fields[f]) next[f] = prev[f];
  next._adminLock = lock;
  return next;
}
export { dayKey };

// 티오프표를 '시각 오름차순(동시각이면 OUT→IN)'으로 정렬해 순번 1..N 재부여.
//  ★당추(당일추가)로 예약이 중간에 끼면, 전체를 다시 시각순으로 세우고 순번을 다시 매긴다
//   → 뒤 순번은 한 칸씩 이른 시간으로 당겨지고, 새 막차가 마지막 슬롯을 받는다(리버힐 운영 규칙).
//   course(OUT/IN)는 슬롯마다 보존(사용자 티오프 코스 표기용).
// 당추(당일추가) 글 텍스트에서 '새로 끼워진 예약'의 티오프 시각을 결정적으로 파싱.
//  예 "인코스 1722 당추 …" → [{time:'17:22',course:'IN'}], "아웃 1735 당추" → [{time:'17:35',course:'OUT'}].
//  ★'당추/당일추가' 키워드가 있을 때만(오탐 방지). LLM 추출(verdict.addedTees)이 놓쳐도 이걸로 보완.
function parseAddedTees(article) {
  const t = `${article?.subject || ''} ${article?.text || ''}`;
  if (!/당추|당일\s*추가/.test(t)) return [];
  const out = [];
  const re = /(인코스|아웃코스|인|아웃|out|in)\s*(\d{1,2}):?(\d{2})\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const c = /in|인/i.test(m[1]) ? 'IN' : 'OUT';
    const h = Number(m[2]), mi = Number(m[3]);
    if (h < 24 && mi < 60) out.push({ time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, course: c });
  }
  return out;
}

// "N번 ○○님까지 근무/일/나갑니다" 커트라인을 텍스트에서 결정적으로 파싱(모델이 cutoff 필드를 놓쳐도 보완).
//  반환 {name, pos|null} 또는 null. '까지' 뒤에 근무 확정 표현이 있어야 인정(취소·대기·질문 오탐 방지).
function parseCutoff(article) {
  const t = `${article?.subject || ''} ${article?.text || ''}`;
  // 이름(2~4자 한글) + (님) 까지 … 근무/일됩니다/나갑니다/콜/배정/출근. 이름 앞 "N번"이 있으면 순번으로.
  //  ★'님' 필수 — "오늘까지 근무" 같은 비인명 오탐 방지(마샬 글은 항상 "○○님까지").
  //  ★"송민지님(박준서)까지" = 괄호 안 점유자(박준서)가 그 자리 실제 주인 → 위치는 holder 기준.
  const m = t.match(/(?:(\d{1,3})\s*번\s*)?([가-힣]{2,4})\s*님\s*(?:\(\s*([가-힣]{2,4})\s*\)\s*)?까지\s*[^가-힣]*(?:근무|일\s*됩|일됩|나가|나감|콜|배정|출근)/);
  if (!m) return null;
  return { name: m[2], holder: m[3] || m[2], pos: m[1] ? Number(m[1]) : null };
}

// 휴가(연차·반차·월차·병가) 자동 판별 — 글/댓글에 '내 이름'이 휴가류 표현과 가까이 있으면 vacation.
//  배치표 이미지의 '휴가' 표기까지는 못 읽으므로(그건 off로 뭉뚱그려짐) 텍스트 신호 기반 best-effort.
//  정확도는 수동 보정으로 보완(사용자가 일지에서 직접 휴무↔휴가 변경).
const SICK_RE = /병가/;                       // 병가는 별도 상태(sick)
const VAC_RE = /(휴가|연차|반차|월차)/;        // 휴가류(병가 제외)
// off 세부 유형 판별 — 이름 주변 ±14자에 병가 신호면 'sick', 휴가류면 'vacation', 없으면 null.
function detectOffType(article, name) {
  if (!name) return null;
  const nk = String(name).replace(/\s/g, '');
  const t = `${article?.subject || ''} ${article?.text || ''} ${(Array.isArray(article?.comments) ? article.comments : []).map((c) => c?.content || '').join(' ')}`.replace(/\s+/g, ' ');
  const i = t.indexOf(nk);
  if (i < 0) return null;
  const around = t.slice(Math.max(0, i - 14), i + nk.length + 14);
  if (SICK_RE.test(around)) return 'sick';
  if (VAC_RE.test(around)) return 'vacation';
  return null;
}

function renumberGrid(slots) {
  const clean = (slots || [])
    .map((s) => ({ time: (String(s?.time || '').match(/\d{1,2}:\d{2}/) || [''])[0], course: /IN/i.test(s?.course) ? 'IN' : 'OUT' }))
    .filter((s) => s.time);
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  clean.sort((a, b) => toMin(a.time) - toMin(b.time) || (a.course === b.course ? 0 : a.course === 'OUT' ? -1 : 1));
  return clean.map((s, i) => ({ pos: i + 1, time: s.time, course: s.course }));
}

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
export function applyVerdict(prev, verdict, article, opts = {}) {
  const d = verdict.dateLabel || (prev && prev.date) || '';
  // 날짜가 바뀌면(=다음 날 배치표) 상황판을 새로 시작.
  let cur = prev;
  if (!cur) cur = blank(d);
  else if (d && cur.date && dayKey(d) !== dayKey(cur.date)) cur = blank(d);  // ★'월-일' 정규화 비교(형식차로 인한 오리셋 방지)
  else if (!cur.date && d) cur = { ...cur, date: d };

  const next = { ...cur, timeline: [...(cur.timeline || [])] };
  // ★회원 이름/부는 opts로 주입(다중회원). blank() 기본값(MY_NAME=1번회원)이 남의 today.json에
  //  새어나가 모든 회원 이름이 '김홍구'로 찍히던 레거시 1인용 잔재를 차단.
  if (opts.name) next.name = opts.name;
  if (opts.part) next.part = /부$/.test(String(opts.part)) ? String(opts.part) : `${opts.part}부`;
  const changes = [];
  // ★순번 제외(off:removed) — 이전엔 배치표에 있었는데 최신 신뢰 판독에서 사라짐(사유 미상).
  //  이 경우 아래 팀수·커트라인 재분류(스페어 승강)를 건너뛰어 'off' 결론을 지킨다.
  const removed = verdict._offReason === 'removed';
  // ★오프 판정(휴무/휴가/병가·근태칸 확정)은 authoritative — 아래 팀수·커트라인 재분류가
  //  이전(stale) 순번으로 근무를 되살리지 못하게 막는다. (도대영·조하빈 off→assigned 복원 사고 차단)
  const offVerdict = verdict.myStatus === 'off';

  // ★커트라인 텍스트 보완: 모델이 "N번 ○○님까지 근무"를 cutoff 필드에 못 담아도(불안정) 정규식으로 채운다.
  //  순번 숫자가 없으면 저장된 명단(roster3)에서 그 이름의 순번을 찾아 보완.
  if (!verdict.cutoffAnnounced) {
    const pc = parseCutoff(article);
    if (pc) {
      const hk = String(pc.holder).replace(/\s/g, '');
      const posFromRoster = (cur.roster3 || []).findIndex((n) => {
        const cell = String(n).replace(/\s/g, '');
        const mm = cell.match(/\(([^)]+)\)/);
        const occ = mm ? mm[1] : cell.replace(/\(.*$/, ''); // 셀도 괄호 점유자 기준
        return occ === hk || cell === hk;
      }) + 1;
      verdict = { ...verdict, cutoffAnnounced: true, cutoffName: pc.name,
        cutoffPosition: pc.pos != null ? pc.pos : (posFromRoster || null) };
    }
  }

  // ── 순번(lock): 새로 확실히 읽었으면 갱신(교환 등), 아니면 유지 ──
  //  0·음수는 판독 실패값이므로 무시(상황판 오염 방지).
  const mp = Number(verdict.myPosition);
  if (Number.isFinite(mp) && mp > 0) {
    if (cur.myPosition != null && Number(cur.myPosition) !== mp)
      changes.push({ field: 'position', from: cur.myPosition, to: mp, reversal: false, msg: `순번 ${cur.myPosition}→${mp}번` });
    next.myPosition = mp;
  }
  // ★_absent = 최신 신뢰 판독에서 이 회원이 명단에 없음(오독 의심 포함). 스테일 순번(cur)을 0으로 비워
  //  아래 팀수·커트라인 재분류가 '옛 순번으로 근무 되살리기'를 못 하게 한다. (서동환 순번7 오알림 재발 방지)
  if (verdict._absent) next.myPosition = 0;

  // ── 티오프: 새 확정 / 변경(번복) 감지 ──
  //  ★내 부 티오프 창 밖은 무효(남의 시간/취소·오독 방지). 창은 opts로 주입(3부 기본 16~24).
  //   예: "[당일취소] 인 13시35분 취소" 를 김홍구(3부) 배정으로 오독하던 문제 차단.
  const teeRaw = verdict.teeTime && /\d{1,2}:\d{2}/.test(verdict.teeTime) ? verdict.teeTime : '';
  const teeHour = teeRaw ? Number(teeRaw.split(':')[0]) : null;
  const TEE_MIN = Number(opts.teeMin ?? (process.env.TEE_MIN_HOUR ?? 16));
  const TEE_MAX = Number(opts.teeMax ?? 24);
  const tee = (teeRaw && teeHour != null && teeHour >= TEE_MIN && teeHour < TEE_MAX) ? teeRaw : '';
  if (tee) {
    if (cur.teeTime && cur.teeTime !== tee)
      changes.push({ field: 'tee', from: cur.teeTime, to: tee, reversal: true, msg: `티오프 ${cur.teeTime}→${tee}` });
    else if (!cur.teeTime)
      changes.push({ field: 'tee_new', to: tee, reversal: false, msg: `티오프 ${tee} 배정` });
    next.teeTime = tee;
    next.course = verdict.course || cur.course || '';
  }

  // ── 상태: 스페어↔근무확정 등 번복 감지 ──
  //  ★unknown(판독 실패)은 기존 확정 상태를 절대 덮어쓰지 않음(상황판 오염 방지).
  let ns = verdict.myStatus || cur.status;
  if (tee) ns = ns === 'your_turn' ? 'your_turn' : 'assigned'; // 티오프 있으면 확정
  else if (teeRaw && isWork(ns)) ns = 'spare'; // 무효 티오프(16시 미만·취소)로 붙은 가짜 근무 → 스페어 강등
  if (ns && ns !== 'unknown') {
    if (ns !== cur.status) {
      const reversal = (isWait(cur.status) && isWork(ns)) // 대기→근무
        || (isWork(cur.status) && (ns === 'off' || isWait(ns))); // 근무→취소/대기
      changes.push({ field: 'status', from: cur.status, to: ns, reversal, msg: `${statusKo(cur.status)} → ${statusKo(ns)}` });
    }
    next.status = ns;
  }
  // ns가 unknown이면 next.status는 기존값(cur) 유지 — 확정 상태 보존.

  // ── 커트라인: 명시된(cutoffAnnounced) 것만 반영 ──
  if (verdict.cutoffAnnounced && verdict.cutoffName) {
    next.cutoffName = verdict.cutoffName;
    if (Number.isFinite(Number(verdict.cutoffPosition))) next.cutoffPosition = Number(verdict.cutoffPosition);
  }

  // ── 확정선(현재 근무 확정된 마지막 순번) 추적 — 스페어 대시보드 '내 앞 N명' 계산용 ──
  //  배치표: 티오프표에 배정된 최대 순번. 텍스트 커트라인: cutoffPosition. 그 외엔 기존값 유지.
  const gridMax = Array.isArray(verdict.teeGrid) && verdict.teeGrid.length
    ? verdict.teeGrid.reduce((m, g) => Math.max(m, Number(g?.pos) || 0), 0) : 0;
  const annCut = (verdict.cutoffAnnounced && Number.isFinite(Number(verdict.cutoffPosition))) ? Number(verdict.cutoffPosition) : 0;
  if (gridMax > 0) next.cutLine = Math.max(gridMax, annCut);                     // 배치표 기준(이번 표)
  else if (annCut > 0) next.cutLine = Math.max(annCut, Number(cur.cutLine) || 0); // 텍스트 커트라인

  // ── ★프레임 보호: 약한 변동 크롭이 정본(전체 배치표) 명단 프레임을 '더 짧게' 덮지 않게 ──
  //  당추 변동은 부분 크롭이라 명단을 덜 읽어(예: 정본29→크롭27) 전원 순번이 밀린다(곽호완 22→20 등).
  //  그러면 절대순번·팀수가 어긋난다. 컷은 프레임과 무관한 공지 앵커(스페어N번·N팀·○○까지)로 결정되므로
  //  프레임(명단·티오프표)은 정본 판독만 갱신하고, 약한 짧은 크롭은 기존 프레임을 얼려 유지한다.
  //  판정: lastboard '정본' 기준과 동일(rosterReliable+날짜+팀수/컷+최소순번). 새 날·기존없음은 정상 갱신.
  const _newRoster = Array.isArray(verdict.part3Roster) ? verdict.part3Roster : [];
  const _curRoster = Array.isArray(cur.roster3) ? cur.roster3 : [];
  const _dayChanged = cur.date && verdict.dateLabel && dayKey(cur.date) !== dayKey(verdict.dateLabel);
  const _authoritative = verdict.rosterReliable === true && !!String(verdict.dateLabel || '').trim()
    && (Number(verdict.teamCount) > 0 || Number(verdict.cutoffPosition) > 0) && _newRoster.length >= 9;
  //  ★차단 대상 = '더 짧게' 덮는 약한 크롭만(같은 길이=대바 교환 등은 통과, 회귀 최소화).
  const _wouldShrink = _curRoster.length > 0 && !_authoritative && !_dayChanged && _newRoster.length > 0 && _newRoster.length < _curRoster.length;
  if (_wouldShrink) console.log(`·  [프레임보호] 약한 변동(명단 ${_newRoster.length} < 정본 ${_curRoster.length})이 명단·티오프표 프레임을 덮지 않음 — 컷은 공지 앵커로 반영`);

  // ── 3부 명단(화이트리스트): 본배치표에서 통째로 읽혔을 때만 저장/갱신 ──
  //  (짧은 소식은 part3Roster=[] 이므로 기존 명단을 그대로 유지) — 이후 이름 기반 필터의 근거.
  if (Array.isArray(verdict.part3Roster) && verdict.part3Roster.length && !_wouldShrink) {
    next.roster3 = verdict.part3Roster.slice();   // ★위치정렬 보존(빈칸 유지) — 순번 = index+1
    next.crossPart3 = (verdict.crossPartNames || []).filter(Boolean);
    next.rosterAt = Date.now();
    // ★대바(대기바꿈) 멱등키 — 이 명단에 반영된 교환 서명. 같은 댓글 재처리 시 자리 되돌림(이중적용) 방지.
    //  새 명단엔 이 판독의 swapKey만 따라간다(교환 없이 새로 읽힌 명단이면 '' 로 리셋).
    next.swapKey = verdict._swapKey || '';
  }

  // ── 티오프표(순번→시각) 저장 — 스페어 대시보드에서 확정자 티오프를 이름 옆에 표기하기 위함 ──
  //  (배치표 판독일 때만 채워짐. 텍스트 소식은 teeGrid 없음 → 기존 유지)
  //  ★프레임보호: 짧은 크롭의 티오프표(어긋난 프레임)가 정본 순번↔시각을 덮지 않게(_wouldShrink면 스킵).
  if (Array.isArray(verdict.teeGrid) && verdict.teeGrid.length && !_wouldShrink) {
    next.teeGrid = verdict.teeGrid
      .filter((g) => Number(g?.pos) > 0 && /\d{1,2}:\d{2}/.test(String(g?.time || '')))
      .map((g) => ({ pos: Number(g.pos), time: String(g.time), course: g.course || '' }));
  }

  // ── 인턴 캐디(노란칸) — 그날그날 섭외되는 임시 캐디. 정규 순번엔 없지만 팀수엔 포함되기도 함 ──
  //  (배치표 판독일 때만 갱신. 텍스트 소식엔 없음 → 기존 유지)
  if (Number.isFinite(Number(verdict.internCount))) {
    next.internCount = Number(verdict.internCount) || 0;
    if (Array.isArray(verdict.internTees)) {
      next.internTees = verdict.internTees
        .filter((g) => /\d{1,2}:\d{2}/.test(String(g?.time || '')))
        .map((g) => ({ time: (String(g.time).match(/\d{1,2}:\d{2}/) || [''])[0], course: g.course || '' }));
    }
  }

  // ── ★당추(당일추가) 티오프 삽입 → 순번↔시각 전체 재매칭 ──
  //  텍스트 당추 글("인코스 1722 당추…")은 배치표 이미지가 없어 grid를 못 갱신한다.
  //  기존 티오프표(next.teeGrid)에 당추 시각을 시각순 삽입 후 순번 1..N 을 다시 매긴다.
  //  ★배치표 이미지가 이번에 새로 온 경우(verdict.teeGrid 있음)엔 그게 이미 최신이라 건드리지 않는다.
  const freshGrid = Array.isArray(verdict.teeGrid) && verdict.teeGrid.length;
  //  당추 시각 = LLM 추출(verdict.addedTees) + 텍스트 정규식 파싱, 합쳐서 중복 제거(정규식이 더 확실).
  const addedRaw = [
    ...(Array.isArray(verdict.addedTees) ? verdict.addedTees : []),
    ...parseAddedTees(article),
  ];
  const addedSeen = new Set();
  const addedTees = addedRaw
    .map((a) => ({ time: (String(a?.time || '').match(/\d{1,2}:\d{2}/) || [''])[0], course: /IN/i.test(a?.course) ? 'IN' : 'OUT' }))
    .filter((a) => {
      if (!a.time) return false;
      const h = Number(a.time.split(':')[0]);
      if (!(h >= TEE_MIN && h < TEE_MAX)) return false;
      const k = `${a.time}|${a.course}`;
      if (addedSeen.has(k)) return false;
      addedSeen.add(k);
      return true;
    });
  if (!freshGrid && addedTees.length && Array.isArray(next.teeGrid) && next.teeGrid.length) {
    const base = next.teeGrid.map((g) => ({ time: g.time, course: g.course || 'OUT' }));
    let inserted = 0;
    // ★시각은 분으로 환산해 비교한다 — 글자로 맞추면 "6:23"과 "06:23"이 다른 자리가 된다.
    //  실측 2026-08-17: 1부 판독은 앞자리 0 없이("6:23"), 카카오·텍스트는 붙여서("06:23") 쓴다.
    //  대조판에서 1부 42칸이 통째로 '안 맞는다'고 나온 게 이 한 글자 때문이었다.
    //  여기서 어긋나면 같은 티오프가 두 번 들어가 그 뒤 순번이 통째로 한 칸씩 밀린다.
    const _tm = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : NaN; };
    for (const a of addedTees) {
      // 같은 (시각·코스) 슬롯이 이미 있으면 중복 삽입 금지(재처리 멱등).
      if (!base.some((b) => _tm(b.time) === _tm(a.time) && b.course === a.course)) { base.push(a); inserted++; }
    }
    if (inserted) next.teeGrid = renumberGrid(base);
  }

  // ── ★"현재 3부 N팀" → 확정선 즉시 갱신 + 내 순번과 비교해 근무↔스페어 재계산 ──
  //  N팀 = 순번 N번까지 근무 (거의) 확정. 내 순번이 N 안에 들면 근무 준비, 벗어나면 스페어.
  //  예약이 늘면(스페어→근무 "준비 시작"), 취소로 줄면(근무→스페어 "대기 전환") 양방향 반영.
  const tc = Number(verdict.teamCount);
  const myp = Number(next.myPosition);
  if (!removed && !offVerdict && Number.isFinite(tc) && tc > 0 && myp > 0) {
    // ★'○○님까지 근무'라고 사람을 콕 집었으면 그게 확정선이다 — 위로도 아래로도 팀수가 못 뒤집는다.
    //  팀수(N팀)는 순번 단위와 어긋난다. 인턴·캐디 없는 팀이 섞여 순번보다 크기도 작기도 하다.
    //   · 작은 쪽으로 어긋난 예(2026-08-17): "팀수 23인데 확정선 34번" — 팀수를 쓰면 확정 근무자를
    //     스페어로 내리고 티오프를 지운다.
    //   · 큰 쪽으로 어긋난 예(2026-08-21 #27495): "금일 3부 27팀, 장성원님까지 근무됩니다."
    //     장성원은 26번이다. 큰 쪽(27)을 쓰면 27번 조하빈이 근무로 올라간다 — 검수·대조표는 스페어인데
    //     앱에서만 근무로 보였다. 사람 이름이 적힌 문장이 팀수보다 언제나 정확하다.
    //  그래서 max가 아니라 '이름이 있으면 이름'이다. 팀수는 이름이 없을 때만 쓴다.
    const annCut = (verdict.cutoffAnnounced && Number(verdict.cutoffPosition) > 0) ? Number(verdict.cutoffPosition) : 0;
    const effCut = annCut > 0 ? annCut : tc;
    // 회원에게 '무엇을 근거로 바뀌었는지'를 그대로 말한다 — 쓰지도 않은 팀수를 근거로 대면 납득이 안 된다.
    const cutTxt = annCut > 0
      ? `${cur.part || '3부'} ${verdict.cutoffName ? `${verdict.cutoffName}님` : `${annCut}번`}까지 근무`
      : `현재 ${cur.part || '3부'} ${tc}팀`;
    next.cutLine = effCut; // 실효 확정선 → 티오프표 스냅샷보다 우선
    const nowWork = myp <= effCut;
    const newStatus = nowWork ? (next.teeTime ? 'assigned' : 'work') : 'spare';
    if (newStatus !== next.status) {
      const reversal = (isWait(next.status) && isWork(newStatus)) || (isWork(next.status) && isWait(newStatus));
      changes.push({ field: 'teamcount', from: next.status, to: newStatus, reversal,
        msg: nowWork
          ? `${cutTxt} — 순번 ${myp}번 근무 거의 확정(준비 시작)`
          : `${cutTxt} — 순번 ${myp}번 스페어로 전환(내 앞 ${Math.max(0, myp - effCut - 1)}명)` });
      next.status = newStatus;
      if (!nowWork) { next.teeTime = ''; next.course = ''; } // 스페어로 내려가면 임시 티오프 해제
    }
  }

  // ── ★텍스트 커트라인/당추 → cutLine 기준 근무·스페어 승격 + 티오프 재매칭 ──
  //  배치표 색을 못 읽는 텍스트 글이라도, 명시된 커트라인 안에 내 순번이 들면 근무권으로 올린다.
  //  (커트라인에 딱 걸린 회원이 스페어 대시보드에 머무는 문제 해결 + 당추로 밀린 티오프 반영.)
  //  teamCount(현재 N팀) 블록이 이미 처리한 경우엔 건너뛴다(그쪽이 더 권위 있음).
  if (!removed && !offVerdict && !(Number.isFinite(tc) && tc > 0) && verdict.cutoffAnnounced && myp > 0) {
    const cut = Number(next.cutLine) || 0;
    if (cut > 0) {
      const slot = Array.isArray(next.teeGrid) ? next.teeGrid.find((g) => Number(g.pos) === myp) : null;
      const slotTee = slot ? (String(slot.time).match(/\d{1,2}:\d{2}/) || [''])[0] : '';
      const slotHr = slotTee ? Number(slotTee.split(':')[0]) : null;
      const slotOk = slotTee && slotHr != null && slotHr >= TEE_MIN && slotHr < TEE_MAX;
      const nowWork = myp <= cut;
      const newStatus = nowWork ? (slotOk ? 'assigned' : 'work') : 'spare';
      // 당추로 순번↔시각이 밀려 티오프가 바뀔 수 있음 — 변경/신규 배정 감지(출발·리마인더 갱신용).
      if (nowWork && slotOk) {
        if (next.teeTime && next.teeTime !== slotTee)
          changes.push({ field: 'tee', from: next.teeTime, to: slotTee, reversal: true, msg: `티오프 ${next.teeTime}→${slotTee}` });
        else if (!next.teeTime)
          changes.push({ field: 'tee_new', to: slotTee, reversal: false, msg: `티오프 ${slotTee}(${slot.course}) 배정` });
        next.teeTime = slotTee; next.course = slot.course || next.course || '';
      }
      if (newStatus !== next.status) {
        const reversal = (isWait(next.status) && isWork(newStatus)) || (isWork(next.status) && isWait(newStatus));
        changes.push({ field: 'cutline', from: next.status, to: newStatus, reversal,
          msg: nowWork ? `순번 ${myp}번 근무권 진입(커트라인 ${cut}번)` : `순번 ${myp}번 스페어(커트라인 ${cut}번)` });
        next.status = newStatus;
        if (!nowWork) { next.teeTime = ''; next.course = ''; }
      }
    }
  }

  // 스페어/대기/오프 상태엔 티오프가 없어야 함 — 잔여·오독 티오프 정리(상황판·저널 일관성).
  //  ★off 포함: 휴무/휴가/병가 확정인데 이전 근무 판독의 티오프가 남아 리마인더가 울리던 문제 차단.
  if (['spare', 'waiting', 'off'].includes(next.status)) { next.teeTime = ''; next.course = ''; }
  if (next.status === 'off' && !removed && offVerdict) next.myPosition = 0; // 휴무/휴가/병가 = 순번 점유 안 함(잔여 순번 정리)

  // ★순번 제외(off:removed) 표식 — 대시보드가 평소 휴무(시적 쉼)와 구분해 '담백한 안내' 화면을 띄우게.
  //  removed가 아닌 어떤 결론이든(근무·스페어·평소 휴무) 이전 removed 표식은 깨끗이 제거(오래 남지 않게).
  // ★확정 병가·휴가(sick/vacation)는 부분사진 부재로 '순번 제외'로 강등하지 않는다 — offType을 지우면
  //  홈/배치표/알림이 병가→휴무로 오표기된다(사용자 지적). 이 경우 아래 else가 offType을 보존한다.
  if (removed && next.status === 'off' && cur.offType !== 'sick' && cur.offType !== 'vacation') {
    next.offReason = 'removed';
    next.prevPosition = Number(verdict._prevPosition) || Number(cur.myPosition) || null;
    next.teeTime = ''; next.course = '';   // 빠짐=근무 아님 → 잔여 티오프 정리
    delete next.offType;                    // 순번 제외는 휴무/휴가와 별개 표식
  } else {
    if (next.offReason) delete next.offReason;
    if (next.prevPosition) delete next.prevPosition;
    // ★휴무 vs 휴가 vs 병가 자동 구분: off인데 병가 신호면 sick, 휴가류면 vacation.
    //  ★신호 없으면 '이전에 확정된 sick/vacation'을 보존 — 같은 날 침묵 재판독이 병가→휴무로 강등하지 못하게.
    //   (날짜 바뀌면 위에서 blank로 초기화되므로 하루 단위로만 유지. journal.mjs와 동일한 보존 원칙.)
    if (next.status === 'off') {
      const sig = detectOffType(article, cur.name || verdict.name);
      const signalled = (verdict.offType === 'sick' || sig === 'sick') ? 'sick'
        : (verdict.offType === 'vacation' || sig === 'vacation') ? 'vacation' : null;
      next.offType = signalled
        || ((cur.offType === 'sick' || cur.offType === 'vacation') ? cur.offType : 'off');
    } else if (next.offType) delete next.offType;
  }

  next.timeline.push({ id: article.id, at: Date.now(), category: verdict.category || '', summary: verdict.summary || '' });
  if (next.timeline.length > 40) next.timeline = next.timeline.slice(-40);
  next.updatedAt = Date.now();
  next.articleId = article.id;

  applyAdminLock(next, prev); // ★관리자 수동 교정값은 그날 자동 판독이 덮지 않음

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
