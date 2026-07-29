// 통합 판단기(새 두뇌).
//  글 하나(제목+본문+이미지) + 내 프로필 + 오늘 기준표 → 구조화된 판정 '하나'.
//  흩어진 정규식 게이트(부·커트라인·시간·이름) 대신 여기 한 곳에서 의미로 판단한다.
//  원칙: Gemini는 '읽기'(위치/여부/티오프)만, 남은인원·출근시간 '산수'는 코드가(정확도).
import { callGeminiJSON, analyzeRoster, analyzeCrews, analyzeInterns } from './gemini.mjs';
import { labelToISO } from './worklog.mjs';
import { correctAndLearn, snapName, learnCrews, alreadyHarvested, markHarvested } from './roster.mjs';

// 배치표 날짜(dateLabel)가 오늘/내일/모레인지 말로. 저녁에 뜬 내일 배치표를 '오늘'로 말하지 않게.
function kstTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function dayWordFor(dateLabel) {
  const iso = labelToISO(dateLabel);
  if (!iso) return '오늘';
  const off = Math.round((Date.parse(iso) - Date.parse(kstTodayISO())) / 86400000);
  return off <= 0 ? '오늘' : off === 1 ? '내일' : off === 2 ? '모레' : String(dateLabel);
}

// 부(部)별 티오프 시간대 창(window). 3부는 env(TEE_MIN_HOUR, 기본 16)~자정 = 기존 동작 유지.
//  ★이 창으로 모든 '남의 부 시간' 가드를 매개변수화 → 2부(낮)도 같은 로직으로 판독 가능.
export function partWindow(part) {
  const p = String(part || '3').trim();
  if (p === '1') return { min: 5, max: 10 };   // 1부: 오전 이른 시간
  if (p === '2') return { min: 10, max: 16 };  // 2부: 낮(대략 10~15시대)
  return { min: Number(process.env.TEE_MIN_HOUR ?? 16), max: 24 }; // 3부(기본): 16시 이후
}
// 조 배치표 '근무표시'(duty) → 그 캐디가 오늘 뛰는 부(部) 집합.
//  "3부"→{3}, "2,3"→{2,3}, "1,3"→{1,3}, "54/54h"→{1,2,3}(전 부), "조출"→{1}.
//  ★부를 '명시적으로 특정'하는 표시만 해석. 애매(선발/정출/배치/당번/프리 등)하거나 비면 빈 집합
//   → 게이트가 개입하지 않고 기존 명단 기반 판단에 맡긴다(오차단 방지).
export function dutyToParts(duty) {
  const d = String(duty || '').replace(/\s/g, '');
  const parts = new Set();
  if (!d) return parts;
  if (/휴무|휴가|병가|격리|연차|반차|월차/.test(d)) return parts; // 근무 안 함 → 개별 판단
  if (/54|올라운드|오라운드/.test(d)) { parts.add('1'); parts.add('2'); parts.add('3'); return parts; }
  const nums = d.match(/[123]/g);
  if (/,|\./.test(d) && nums) { nums.forEach((x) => parts.add(x)); return parts; } // "2,3" "1,3"
  const m = d.match(/([123])부/);
  if (m) { parts.add(m[1]); return parts; }                     // "3부"
  if (/조출/.test(d)) { parts.add('1'); return parts; }          // 조출=1부 조기출근
  return parts;                                                  // 특정 불가
}

// 창을 벗어난(=남의 부) 시각인가. teeMin/teeMax 없으면 부로 유추.
function outOfWindow(hour, member) {
  if (hour == null || !Number.isFinite(Number(hour))) return false;
  const w = (member && member.teeMin != null) ? { min: member.teeMin, max: member.teeMax ?? 24 } : partWindow(member?.part);
  const h = Number(hour);
  return h < w.min || h >= w.max;
}

// 회원 컨텍스트(이름·부·티오프창). 미지정이면 .env(=1번 회원 김홍구) → 기존 동작 무변화.
//  ★judge()가 회원을 인자로 받아 buildPrompt/decide/applyRoster 등에 전달 → "누구 기준"만 바깥에서.
function memberFromEnv() {
  const part = (process.env.MY_PART || '3').trim();
  const w = partWindow(part);
  return {
    name: (process.env.MY_NAME || '김홍구').trim(),
    part,
    commuteMin: Number(process.env.COMMUTE_MIN ?? 60),
    teeMin: w.min, teeMax: w.max,
  };
}
// 프롬프트용 티오프 시간대 서술 (부별).
function partWindowDesc(member) {
  const w = (member && member.teeMin != null) ? { min: member.teeMin, max: member.teeMax ?? 24 } : partWindow(member?.part);
  if (w.min <= 10) return `오전 이른 시간(대략 ${w.min}~${w.max}시)`;
  if (w.min < 16) return `낮(대략 ${w.min}~${w.max}시)`;
  return `${w.min}시 이후(저녁까지)`;
}

// 일정 관련 '단서'가 있는 텍스트인가 (잡담/사진/광고 걸러내기 + Gemini 실패 시 스팸 방지용).
//  단서: 부/근무/티오프/순번/스페어/대기/추가/취소/변동/조정/모집/조출·후출/휴무/배치/커트라인 표현,
//        "○○명", "HH시"/"HH:MM", "○○님까지".
export function scheduleHint(text) {
  const t = String(text || '');
  if (/사진을 보냈습니다|이모티콘|삭제된 메시지|송금|채팅방에 들어왔|나갔습니다/.test(t)) return false; // 명백한 시스템/잡담
  return /부|근무|티오프|티업|순번|스페어|대기|추가|취소|변동|조정|모집|조출|후출|휴무|배치|당번|커트|까지|\d+\s*명|\d{1,2}\s*시|\d{1,2}:\d{2}|님/.test(t);
}

// 값싼 사전 판정: 명백히 '남의 일'이면 'other'(Gemini 생략·푸시 안 함), 아니면 'unknown'(Gemini/폴백에 맡김).
//  Gemini 할당량(429) 절약 + 판독 실패 시 남의 부·개인근태까지 알림 나가는 스팸 방지.
//  ★보수적으로: 내 이름/3부 언급이 있으면 절대 'other'로 버리지 않는다(놓침 방지).
export function cheapRelevance(text, member = memberFromEnv()) {
  const t = String(text || '');
  const { name, part } = member;
  if (name && t.includes(name)) return 'unknown';         // 내 이름 → 보류
  if (new RegExp(`${part}\\s*부`).test(t)) return 'unknown'; // 내 부(3부) 언급 → 보류
  // 명시적 다른 부(1·2부 등, 내 부 아님)
  if (/[124-9]\s*부/.test(t)) return 'other';
  // 개인 근태 신청 (내 이름 없음)
  if (/(휴무|조출|후출|연차|반차|월차|병가|휴가|조퇴).{0,6}(신청|올립니다|재신청|합니다|취소)/.test(t)) return 'other';
  // 티오프/시각이 있는데 전부 내 부 시간대 창 밖 → 다른 부
  const hours = [...t.matchAll(/(\d{1,2})\s*(?::\d{2}|시)/g)].map((m) => Number(m[1]));
  if (hours.length && hours.every((h) => outOfWindow(h, member))) return 'other';
  return 'unknown';
}

// ── 티오프(HH:MM) → 백대기·도착·집출발 시각 ─────────────
//  백대기 = 티오프 − BACK_WAIT_MIN(규정 50분).
//  도착(출근) = 백대기 − ARRIVE_BEFORE_MIN(10분) = 티오프 − 60분.
//  출발 = 도착 − 회원 출근소요시간(commuteMin). 출발~도착=이동(운전), 도착~백대기=대기(10분), 백대기~티오프=준비.
export function commuteInfo(teeTime, commuteMin) {
  const m = String(teeTime || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const backWait = Number(process.env.BACK_WAIT_MIN ?? 50);
  const arriveBefore = Number(process.env.ARRIVE_BEFORE_MIN ?? 10);
  const commute = Number.isFinite(Number(commuteMin)) ? Number(commuteMin) : Number(process.env.COMMUTE_MIN ?? 60);
  const tot = Number(m[1]) * 60 + Number(m[2]);
  const fmt = (x) => { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  const standby = tot - backWait;
  const arrive = standby - arriveBefore;
  return { tee: fmt(tot), standby: fmt(standby), arrive: fmt(arrive), leave: fmt(arrive - commute),
    backWaitMin: backWait, arriveBeforeMin: arriveBefore, commuteMin: commute };
}

function commuteLine(teeTime, course, commuteMin) {
  const c = commuteInfo(teeTime, commuteMin);
  if (!c) return '';
  const crs = course ? ` (${String(course).toUpperCase()}코스)` : '';
  return `\n⛳ 티오프 ${c.tee}${crs} · 백대기 ${c.standby} · 도착 ${c.arrive} · 집에서 ${c.leave} 출발`;
}

// ── Gemini 판정 프롬프트 (stateless: 이 글만 편견 없이 읽는다) ──
// 배치표 글에 달린 '대기 순번 교환(대기바꿈/대바)' 댓글만 골라 원문을 시간순으로 모은다.
//  이걸 판독 프롬프트에 함께 넣어, 명단(part3Roster)을 교환이 끝난 '현재' 순서로 출력하게 한다.
function collectSwapComments(article) {
  const cs = Array.isArray(article?.comments) ? article.comments : [];
  const kw = /바꿈|대바|순번/;
  return cs
    .map((c) => String(c?.content || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && kw.test(t))
    .slice(0, 15);
}

// ── 대바(대기바꿈) 결정적 적용 ─────────────────────────────────
//  모델은 '인쇄된 원본 순번'만 안정적으로 읽으면 되고(강한 모델로 안정화), 교환은 코드가 못박는다.
//  댓글 예: "당일대바합니다. 연승준 3순번 / 정진영님 20순번 / 서동환님 14순번" → [{연승준,3},{정진영,20},{서동환,14}].
//  의미: 각 사람이 그 순번 '자리'로 이동(그 자리에 있던 사람과 맞교환). 위→아래 순서대로 누적 적용.
export function parseSwapAssignments(comments) {
  const arr = Array.isArray(comments) ? comments : [];
  const ops = [];
  for (const c of arr) {
    const t = String(c?.content ?? c ?? '');
    if (!/대바|대기\s*바꿈|바꿈|순번/.test(t)) continue;   // 교환 댓글만 (잡담 오탐 방지)
    const re = /([가-힣]{2,4})\s*(?:님)?\s*(\d{1,2})\s*(?:순번|번)/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const name = m[1].replace(/님$/, '').trim();   // 이름 그룹이 '님'까지 흡수했으면 제거
      const pos = Number(m[2]);
      if (name.length >= 2 && pos >= 1 && pos <= 60) ops.push({ name, pos });
    }
  }
  return ops;
}

// 명단(순번순 배열, index=순번-1)에 대바 재배치를 적용. 각 op는 name↔그 pos 점유자 맞교환.
//  이름 매칭은 괄호 교환("A(B)")이면 실제 점유자 B 기준(normRosterName). 명단/순번 밖·미발견은 건너뜀(오손 방지).
//  반환: { roster:교환후배열, applied:["연승준→3", ...] }.
export function applySwapAssignments(roster, ops) {
  if (!Array.isArray(roster) || !roster.length || !Array.isArray(ops) || !ops.length) {
    return { roster: Array.isArray(roster) ? roster.slice() : [], applied: [] };
  }
  const arr = roster.slice();
  const key = (s) => normRosterName(s).name.replace(/\s/g, '');
  const applied = [];
  for (const op of ops) {
    const target = op.pos - 1;
    if (target < 0 || target >= arr.length) continue;
    const cur = arr.findIndex((c) => key(c) === op.name.replace(/\s/g, ''));
    if (cur < 0 || cur === target) continue;          // 명단에 없거나 이미 그 자리면 통과
    const tmp = arr[target]; arr[target] = arr[cur]; arr[cur] = tmp;   // 맞교환
    applied.push(`${op.name}→${op.pos}`);
  }
  return { roster: arr, applied };
}

// 교차검증된 명단으로 회원 본인 순번·상태를 최종 확정(명단 대조 우선). consensus·대바적용 두 곳에서 공용.
//  LLM이 자기 순번을 오독하거나 대바로 자리가 밀렸을 때, 명단에서 이름으로 순번을 확정하고
//  근무 상한(팀수/티오프표 최대순번/커트라인) 밖이면 구조적으로 스페어 확정(색·표결보다 우선).
// "○○님까지 근무" 커트라인 텍스트 파싱 — 괄호 점유자 우선("송민지님(박준서)까지" → 실제 컷 사람=박준서).
//  사용자 원칙: 괄호 안 이름이 그 자리의 실제 주인. display(표기 이름)와 holder(위치 기준 사람)를 분리.
//  괄호는 "이름(점유자)님까지"·"이름님(점유자)까지" 두 위치 다 허용 → holder(점유자) 우선.
const CUTOFF_RE = /(?:(\d{1,3})\s*번\s*)?([가-힣]{2,4})\s*(?:\(\s*([가-힣]{2,4})\s*\)\s*)?님\s*(?:\(\s*([가-힣]{2,4})\s*\)\s*)?까지\s*[^가-힣]*(?:근무|일\s*됩|일됩|나가|나감|콜|배정|출근)/;
function parseCutoffText(article) {
  const t = `${article?.subject || ''} ${article?.text || article?.contentText || article?.content || ''}`;
  const m = t.match(CUTOFF_RE);
  if (!m) return null;
  return { display: m[2], holder: m[4] || m[3] || m[2], pos: m[1] ? Number(m[1]) : null };
}

// 커트라인(근무 확정선) 위치를 '괄호 점유자' 기준으로 확정. 명단(교환 후) 우선, 없으면 저장 명단.
//  · 표기 이름은 그대로 두되(예: "송민지님까지" 문구), 위치는 실제 주인(박준서=18) 자리로.
function resolveCutoff(verdict, article, today = null) {
  if (!verdict) return;
  const roster = (Array.isArray(verdict.part3Roster) && verdict.part3Roster.length)
    ? verdict.part3Roster
    : (Array.isArray(today?.roster3) ? today.roster3 : []);
  const pc = parseCutoffText(article);
  if (pc) {
    verdict.cutoffAnnounced = true;
    verdict.cutoffName = pc.holder;                                 // 실제 그 자리 주인(괄호 점유자)으로 표기
    if (roster.length) {
      const cpos = rosterPosOf(roster, pc.holder);                  // 괄호 점유자 자리 = 진짜 컷
      if (cpos > 0) verdict.cutoffPosition = cpos;
      else if (pc.pos != null) verdict.cutoffPosition = pc.pos;
    } else if (pc.pos != null) verdict.cutoffPosition = pc.pos;
  } else if (verdict.cutoffAnnounced && verdict.cutoffName) {
    const holder = normRosterName(verdict.cutoffName).name;         // "연승준(서동환)" → 서동환
    verdict.cutoffName = holder;
    if (roster.length && !(Number(verdict.cutoffPosition) > 0)) {
      const cpos = rosterPosOf(roster, holder);
      if (cpos > 0) verdict.cutoffPosition = cpos;
    }
  }
}

function fixMemberPosByRoster(v, member = memberFromEnv()) {
  if (!v || !Array.isArray(v.part3Roster) || !v.part3Roster.length) return;
  const rp = rosterPosOf(v.part3Roster, member.name);
  if (rp <= 0) return;
  const prevPos = Number(v.myPosition) || 0;
  const gridMax = Array.isArray(v.teeGrid) ? v.teeGrid.reduce((mx, g) => Math.max(mx, Number(g?.pos) || 0), 0) : 0;
  const annCut = (v.cutoffAnnounced && Number(v.cutoffPosition) > 0) ? Number(v.cutoffPosition) : 0;
  const intern = Number(v.internCount) > 0 ? Number(v.internCount) : 0;
  const team = Number(v.teamCount) > 0 ? Number(v.teamCount) : 0;
  // 근무 상한(정규 캐디 근무선) 우선순위:
  //  1) 명시 커트라인("○○까지 근무") — 사람을 콕 집음, 최우선.
  //  2) 티오프표 번호 최대순번(gridMax) — '번호 매겨진' 정규 매칭만. 인턴(노란칸)은 번호가 없어 자동 제외 → 정확.
  //  3) 팀수("N팀") − 인턴수 — 최후 보루. "N팀"은 배치표마다 인턴 포함 여부가 달라 인턴수를 빼 정규만 남김.
  //  ★인턴 캐디는 정규 순번을 차지하지 않으므로 정규 스페어 계산에 영향 없음(gridMax가 인턴을 이미 배제).
  const workLimit = annCut > 0 ? annCut : (gridMax > 0 ? gridMax : Math.max(0, team - intern));
  if (rp !== prevPos) v._posFixed = `명단 대조: 순번 ${prevPos || '?'}→${rp}`;
  v.myPosition = rp;
  if (workLimit > 0 && rp > workLimit) {
    v.myStatus = 'spare'; v.teeTime = ''; v.course = '';
    v._teeSource = 'roster-beyond-cut';
    delete v._uncertain;
  } else if (rp !== prevPos) {
    resolveTeeByGrid(v, member); // 근무 범위 안 + 순번 교정 → 티오프표 재해석
  }
}

function buildPrompt(article, member = memberFromEnv()) {
  const { name, part } = member;
  const wdesc = partWindowDesc(member);   // 이 회원(부) 티오프 시간대 서술 — 3부면 "16시 이후(저녁까지)"
  const anchor = '';
  const hasImg = !!article.images?.length;
  const ts = Number(article.writeDate);
  const postedHour = Number.isFinite(ts) && ts > 1e12 ? new Date(ts).getHours() : null;
  const postedLine = postedHour != null
    ? `- 게시 시각: ${postedHour}시 (${postedHour >= 12 ? '정오 이후' : '정오 이전'})`
    : '';
  const swapCmts = hasImg ? collectSwapComments(article) : [];
  const swapBlock = swapCmts.length ? `

[★댓글 — 대기 순번 교환(대기바꿈/대바) — 반드시 명단에 반영]:
아래는 이 배치표에 달린 '대기 순번 교환' 댓글입니다(위=먼저, 시간순). part3Roster·myPosition 등 순번 판단에 이 교환을 **모두 적용**해, 교환이 끝난 '현재' 순번 순서로 명단을 출력하세요. 이미지의 원래 순서보다 이 댓글 교환이 우선입니다.
- "조하빈17번 최수원27번" = 조하빈을 17번 자리, 최수원을 27번 자리로(서로 맞바꿈).
- "A B 대기바꿈"·"A ㅡ B 바꿈" = A와 B의 대기 순번을 맞바꿈.
- "A(B)"(괄호 안 사람) = 그 자리 실제 주인은 괄호 안 B.
- "당일대바 A 3순번 B 20순번" = A를 3번, B를 20번 자리로.
- 위에서 아래로 순서대로 누적 적용. 이름이 "${name}"과 무관해도 순번이 밀리면 반영하세요.
${swapCmts.map((c, i) => `${i + 1}) ${c}`).join('\n')}` : '';
  const isKakao = /카톡|카카오/.test(article.menuName || '');
  const kakaoNote = isKakao ? `

★출처=캐디 단톡방 메시지입니다 (매우 중요):
- "${name}"(${part}부)이 속한 단톡방이라, 부(部) 표시가 없어도 근무 커트라인("○○까지 나갑니다/근무/입니다/콜"), 배치·추가·시간 변동 메시지는 **${part}부 관련으로 간주**하세요(relevant=true, part=${part}). 단톡방에선 후속·정정 메시지에 "${part}부"를 다시 안 붙이는 게 보통입니다.
- 예외: 메시지가 명시적으로 "1부"/"2부"로만 한정되면 그 부로(다른 부는 무관). 순수 잡담·인사·"사진을 보냈습니다"·개인 근태신청은 relevant=false.` : '';
  return `당신은 골프장 캐디 "${name}"(${part}부)의 개인 비서입니다.
아래 ${isKakao ? '캐디 단톡방 메시지' : '네이버 카페 글'}가 "${name}"님에게 어떤 의미인지 판단하세요.${anchor}

[글]
- 제목: ${article.subject || ''}
- 게시판: ${article.menuName || ''}
- 작성자: ${article.writer || ''}
${postedLine}
- 본문: ${(article.text || '').slice(0, 600)}
- 첨부 이미지: ${hasImg ? '있음 — 배치표/번호표(순번·이름 목록 + 티오프 시간표)일 수 있으니 반드시 읽으세요.' : '없음 — 제목/본문 텍스트로만 판단.'}${kakaoNote}${swapBlock}

[배경지식]
- 리버힐 캐디는 1·2·3부로 나뉘고 각 부는 완전 독립. "${name}"은 ${part}부만 관련(다른 부 내용은 무관).
- 부(部)별 티오프 시간대: 1부=오전 이른 시간(아웃/인 6~9시대), 2부=낮(대략 10~15시대), 3부=16시 이후(저녁까지). "${name}"은 ${part}부라 티오프 시간대가 **${wdesc}**입니다. **이 시간대 밖(다른 부 시간)만 있는 글은 "${name}"과 무관합니다.**
- 배치표/번호표: 각 부 "순번·이름" 목록과 "OUT n부 IN" 티오프표(가운데=티오프 시간, OUT/IN=코스). 순번이 티오프 칸에 등록되면 그 사람 근무 확정.
- 배경색: 회색=스페어(대기), 흰색/색칠됨=근무 확정. 이름 옆 "(2,3)"·"(54)" 같은 숫자표기는 그 사람이 여러 부에 걸쳐 일한다는 표시(부 중복)라, 이름만으론 어느 부 소식인지 모호합니다(→ 시간대로 판단).
- "○○님까지 일됩니다/근무/나갑니다" = 그 사람까지(포함) 순번 근무 확정. 표현은 작성자마다 불규칙("나가요","콜","다근무","까지만" 등)해도 '뜻'으로 파악.
- ★약어(캐디 은어, 오독 주의): **"당추"="당일추가"** — 그날 갑자기 팀이 더 생겨 근무 커트라인이 뒤로 밀린다(=더 많은 사람이 근무). "당직"과 절대 혼동 금지. "조출"=조기출근, "후출"=후발출근, "노쇼"=예약 불참.
- ★표기: **"인코스/아웃(코스) HHMM"**(네 자리 숫자)=코스(IN/OUT)+티오프 시각(예 "인코스 1722"→IN코스 17:22, "아웃 1735"→OUT 17:35). 이 티오프 시각이 ${part}부 시간대(${wdesc})면 부 표시가 없어도 ${part}부 글입니다.
- ★**"N번 ○○님까지"의 N(숫자+'번')은 대기 순번입니다(홀 번호·시각 아님).** 예: "당추 17번 조하빈님까지 근무입니다"=순번 17번 조하빈님까지 근무 확정 → cutoffName="조하빈", cutoffPosition=17, cutoffAnnounced=true, relevant=true. 이런 커트라인/당추 글은 "${name}"의 순번과 직접 관련되니 절대 무관(relevant=false)으로 버리지 마세요.
- ★당추(당일추가)로 **새 예약이 끼워진 티오프 시각**이 글에 있으면 addedTees 에 {time,course}로 넣으세요. 예 "인코스 1722 당추…" → addedTees=[{"time":"17:22","course":"IN"}], "아웃 1735 당추" → [{"time":"17:35","course":"OUT"}]. 여러 개면 모두. 당추로 삽입된 시각이 아니면 [].
- 순번 교환: 이름 옆에 (54)/(2,3)이 아닌 '다른 사람 이름'이 붙으면 두 사람이 자리를 맞바꾼 것. 그 자리의 진짜 대기자는 '바뀐 사람'. "${name}"의 진짜 순번은 "${name}"이 실제 들어간 자리로 판단.
- 스페어 = 대기(당일 근무로 바뀔 수 있음, 휴무 아님). "가배치/임시배치"는 참고용이니 relevant=false 로.

[판단 기준]
- "${name}"의 ${part}부 순번/근무/출근에 영향을 주거나 전체 공지면 relevant=true.
- 다른 부만의 내용, 남의 개인 근태신청(내 이름 없음)은 relevant=false.
- "${name}"이 근무 확정(흰색이거나 티오프 배정)이면 "${name}"의 티오프 시간(HH:MM)과 코스(OUT/IN)를 읽으세요(교환됐으면 바뀐 자리 기준).
- "${name}"의 순번(myPosition)은 항상 읽으세요(이미지의 그 사람 번호).
- ★★teeTime엔 오직 "${name}" 본인이 배정된 티오프만 넣으세요. 취소·추가·변동·노쇼 글에서 언급된 '남'의 시간(예: "인 13시35분 취소 박진수님까지"의 13:35는 박진수 관련 시간)은 "${name}"의 티오프가 절대 아니므로 teeTime=null. "${name}" 자리의 시간이 확실할 때만 채우세요.
- ★★${part}부 티오프 시간대는 ${wdesc}입니다. 이 시간대 밖 시각만 있는 글은 ${part}부가 아니라 다른 부이므로 "${name}"과 무관(relevant=false, part=해당 부).

★★★ "${name}"의 근무/스페어 판정 — **이름칸 '배경색'이 최우선 근거입니다** (이번 오류의 핵심):
1) 먼저 배치표에서 "${name}" 이름칸의 **배경색**을 확인해 myCellColor 에 넣으세요: **흰색/녹색/하늘색 등 색칠됨 = 근무 확정**, **회색 = 스페어(대기)**.
2) **색칠됨(특히 흰색) = 근무 확정.** 티오프 시간표에 "${name}" 순번이 아직 안 보여도 **근무 확정은 그대로 유지**하세요(팀·티오프는 나중에 매칭될 수 있음). → myStatus="assigned"(티오프도 보이면) 또는 "work"(색은 근무인데 티오프 아직 미매칭). **티오프가 없다는 이유로 절대 스페어로 강등하지 마세요.**
3) **회색 = 스페어(대기)** → myStatus="spare", teeTime=null.
4) 티오프(teeTime)는 오직 "OUT n부 IN" 시간표에서 "${name}" 순번이 그 시간 칸에 있을 때만 인정. 없으면 teeTime=null (단, 이름칸이 흰색이면 myStatus는 여전히 근무 확정).
5) 오른쪽 "조(組)" 목록이나 대기 명단에서 근처 줄에 보이는 시간을 "${name}"에게 붙이지 마세요(줄 맞춤일 뿐).
6) 배경색을 도저히 알 수 없을 때만(myCellColor="unknown") 티오프 유무로 판단(있으면 근무, 없으면 스페어).

★ ${part}부 티오프 표(teeGrid) 정확 추출 — ★★행에 순서대로 번호를 매기는 실수를 절대 하지 마세요:
- 표는 [OUT 순번칸 | 시간칸 | IN 순번칸] 3열 구조입니다. **대부분의 시간 행은 순번칸이 비어 있습니다**(시간만 있고 아무 숫자 없음).
- 각 시간 행에서 OUT칸에 **눈으로 실제 인쇄된 숫자**가 보이면 {"pos":그 숫자,"time":그 행 시간,"course":"OUT"}, IN칸에 숫자가 보이면 {"pos":그 숫자,"time":그 행 시간,"course":"IN"}. OUT·IN 둘 다 비어 있으면 그 행은 teeGrid에 넣지 마세요.
- ★절대 맨 위 행부터 1,2,3,4…로 순번을 지어내지 마세요. OUT 순번과 IN 순번은 **각각 별개의 띄엄띄엄한 수열**입니다(예: OUT=1,3,6,10,13 … / IN=2,7,9,11 …). 대부분 행은 순번이 없습니다.
- 시간은 위→아래로 일정 간격 증가(예: 16:32,16:39,16:46,16:53,17:00,17:07,17:14,17:21,17:28…). 순번이 인쇄된 행을 찾아 그 행의 시간과 정확히 짝지으세요.
- ${name}의 티오프는 코드가 이 표에서 ${name} 순번(myPosition)으로 찾습니다 — 표만 정확히 옮기고 myPosition만 정확히 읽으면 됩니다.
- ★★인턴 캐디(노란색 칸): OUT/IN칸이 **순번 숫자 없이 노란색으로 채워진 칸**은 '인턴 캐디'가 배정된 팀입니다(그날그날 섭외되는 임시 캐디, 정규 순번 아님). **이 노란 칸은 절대 teeGrid에 순번(pos)으로 넣지 마세요**(정규 순번 오염 방지). 대신 internTees 배열에 {"time":시간,"course":"OUT/IN"}로 따로 적고, internCount=노란 칸 개수. 노란 칸이 없으면 internTees=[], internCount=0.

★★ 배치표의 '부(部) 이중 표시' — 가장 확실한 근거 (환각 방지 이중검증):
- 각 부(部) 티오프 표에는 부를 알려주는 **두 가지 확실한 표시**가 있습니다: (1)맨 위 헤더 [OUT | N부 | IN]의 가운데 "N부" 글자, (2)표 전체의 **고유 배경색**(부마다 다름).
- boardTables 에 이미지에서 보이는 각 부 표를 [{part, color}] 배열로 넣으세요: part=헤더의 부 숫자, color=그 표의 대표 배경색 이름(한국어 그대로, 예 '보라'·'하늘색'·'분홍'). 3부 표 하나면 [{"part":3,"color":"보라"}], 전체 배치표라 1·2·3부 표가 다 있으면 세 개 모두. 배치표가 아니거나 표가 안 보이면 [].
- ★part도 color도 '눈에 실제로 보이는 것'만. 추측 금지. 이 헤더와 색이 part 판단의 최우선 근거입니다(둘이 서로 검증).

★ 부(部) 판단 (지어내기 금지 — 이번 오류의 핵심):
- part 에 이 글이 몇 부에 관한 것인지 넣으세요: **배치표 표(boardTables: 헤더+색)가 있으면 그게 최우선**, 없으면 제목/본문의 "1부/2부/3부" 명시, 그것도 없으면 티오프 시간대로 확실하면 그 숫자, 전혀 알 수 없으면 "unknown".
- **절대 기본값으로 ${part}부라고 가정하지 마세요.** ${part}부라는 근거(명시된 "${part}부" / "${name}" 이름·순번 / ${part}부 배치표 / ${part}부 시간대(오후·저녁) 티오프)가 하나도 없으면 part는 실제 부 숫자 또는 "unknown"으로.
- part 가 ${part}가 아닌 다른 부로 확인되면 relevant=false (다른 부는 "${name}"과 무관).
- ⏰게시 시각 참고: ${part}부 추가·변동 소식은 보통 정오(12시) 이후 올라옵니다. 정오 이전엔 헷갈리지 않게 글에 "${part}부"라고 명시하는 편입니다. 따라서 **부 표시가 없고 정오 이후에 올라온 일정 변동/추가 글은 ${part}부일 가능성이 높습니다.** (단, 티오프 시간대가 다른 부를 가리키면 그 부가 우선 — 예: 정오 이후 올라와도 '아웃 7시대' 티오프는 1부.)
- 우선순위: 명시된 "N부" > 티오프 시간대 > 게시 시각.

★ 본배치표 ${part}부 명단 추출 (이 글이 '그날 전체 배치표/번호표'라서 ${part}부 명단이 통째로 보일 때만):
- part3Roster: 이미지의 ${part}부 칸에 있는 모든 캐디 이름(스페어 포함)을 배열로. ${part}부 명단이 안 보이면 반드시 빈 배열 [].
- crossPartNames: 그 명단 중 이름 옆에 "(2,3)"·"(54)" 등 여러 부 표기가 붙은 사람(부 중복)만 배열로.
- 짧은 변동/추가/노쇼 글처럼 전체 명단이 아니면 part3Roster=[], crossPartNames=[] 로 두세요(추측 금지).
- subjectNames: 이 글이 '누구'에 관한 것인지 핵심 인물 이름 배열(예: "○○님까지"의 ○○, 노쇼·취소·추가 대상자). 특정 인물이 없으면 [].

★★ 커트라인 규칙 (매우 중요 — 지어내기 금지):
- cutoffName/cutoffPosition 은 **제목이나 본문 텍스트에 "○○님까지 일됩니다/근무/나갑니다" 처럼 명시적으로 적혀 있을 때만** 채우고, cutoffAnnounced=true 로 하세요.
- 그런 명시 문구가 **없으면**(예: 그냥 "현재 배치표"·"3부 시간표" 스냅샷) cutoffName="", cutoffPosition=null, cutoffAnnounced=false. **이미지의 색깔만 보고 커트라인을 절대 추측하지 마세요.**
- **회색(스페어)인 사람은 절대 커트라인이 아닙니다.** 커트라인은 반드시 근무 확정(흰색/녹색/하늘색/티오프배정)된 사람이어야 합니다.
- 확실하지 않으면 비워두세요. 틀린 이름을 넣는 것보다 비우는 게 낫습니다.

반드시 JSON "하나만" 출력(설명·코드펜스 금지):
{
  "relevant": true 또는 false,
  "part": "1|2|3|unknown (이 글이 몇 부인지, 모르면 unknown — ${part}부라 함부로 단정 금지)",
  "boardTables": [{ "part": 정수(헤더 OUT|N부|IN의 부), "color": "그 표 배경색 이름(예 보라/하늘색/분홍)" }],
  "part3Roster": ["${part}부 전체 명단 이름들 — 전체 배치표일 때만, 아니면 []"],
  "crossPartNames": ["명단 중 여러 부 중복 표기((2,3)/(54)) 붙은 이름들, 없으면 []"],
  "subjectNames": ["이 소식의 핵심 인물 이름들, 없으면 []"],
  "teeGrid": [{ "pos": 정수, "time": "HH:MM", "course": "OUT 또는 IN" }],
  "internTees": [{ "time": "HH:MM", "course": "OUT 또는 IN" }],
  "internCount": "노란색으로 채워진 티오프 칸(인턴 캐디 배정) 개수, 없으면 0",
  "category": "배치표|번호표|변동|추가|취소|시간조정|공지|개인근태|가배치|기타",
  "myCellColor": "white|colored|gray|unknown (${name} 이름칸 배경색 — 근무/스페어 판정 최우선 근거)",
  "myStatus": "work|assigned|your_turn|waiting|spare|off|unknown",
  "dateLabel": "예: 7월 14일 화요일 (모르면 빈칸)",
  "myPosition": 정수 또는 null,
  "cutoffAnnounced": true 또는 false (텍스트에 '○○까지' 명시 여부),
  "cutoffName": "명시된 커트라인 이름, 없으면 빈칸",
  "cutoffPosition": 정수 또는 null,
  "addedTees": [{ "time": "HH:MM", "course": "OUT 또는 IN" }],
  "teamCount": "현재 ${part}부 예약 팀 수 정수 (예: '현재 3부 16팀'·'3부 16팀 운영' → 16). = 순번 그 번호까지 근무 확정을 뜻함. 다른 부 수치이거나 팀 수 언급 없으면 null",
  "teeTime": "${name} 본인 배정 티오프 HH:MM(${wdesc}·본인 자리일 때만). 남의 시간이거나 시간대 밖이면 null",
  "course": "OUT 또는 IN 또는 빈칸",
  "note": "오직 '시간 변동 가능/취소/캔슬/시간조정' 같은 실제 주의사항만 한 문장. 스페어/근무/대기 등 상태 재언급은 금지. 해당 없으면 반드시 빈칸",
  "confidence": 0.0~1.0 실수,
  "summary": "${name}님 기준 한국어 한 문장 (커트라인이 명시 안 됐으면 남은 인원 언급 금지)"
}`;
}

// ── 최종 알림 문구/제목/푸시강도 결정 (산수는 코드가) ──────
function titleFor(status) {
  switch (status) {
    case 'your_turn': return '🚨 지금 출근 순번!';
    case 'near':      return '🔔 스페어 상위 — 곧 차례!';
    case 'assigned':  return '✅ 오늘 근무 배정됨';
    case 'work':      return '✅ 출근 확정!';
    case 'waiting':   return '🏌️ 3부 대기 현황';
    case 'spare':     return '🏌️ 스페어(대기)';
    case 'off':       return '😴 근무 없음';
    default:          return '🏌️ 3부 소식';
  }
}

// verdict(raw) → { relevant, push, title, body, status, verdict, computed }
//  push: 'high'(바로 알림) | 'low'(피드만) | 'check'(확인필요 알림)
export function decide(article, verdict, member = memberFromEnv()) {
  const { name, part: myPart } = member;
  if (!verdict) {
    // Gemini 실패(429/타임아웃 등) → 놓침 방지로 '확인필요' 알림. 단 잡담/광고/사진까지
    //  알림 보내면 스팸이므로, 일정 단서(부·근무·시간·순번·"○○까지" 등)가 있을 때만 푸시.
    const blob = `${article.subject || ''} ${article.text || ''}`;
    if (cheapRelevance(blob, member) !== 'other' && scheduleHint(blob)) {
      return { relevant: true, push: 'check', status: 'unknown', verdict: null,
        title: '🏌️ 새 일정글 — 직접 확인', body: `${article.subject || ''} (자동 판독 실패, 눌러서 확인)` };
    }
    // 일정 단서 없음(사진/광고/잡담) → 피드에만, 푸시 안 함.
    return { relevant: false, push: 'low', status: 'unknown', verdict: null,
      title: '', body: article.subject || '' };
  }
  if (verdict.category === '가배치') {
    return { relevant: false, push: 'low', status: 'unknown', verdict, title: '', body: article.subject || '' };
  }
  // 다른 부로 판명 → 내 일과 무관, 피드에만(푸시 금지).
  const vpart = (String(verdict.part || '').match(/[123]/) || [])[0] || 'unknown';
  if (vpart !== 'unknown' && vpart !== myPart) {
    return { relevant: false, push: 'low', status: 'unknown', verdict,
      title: '', body: verdict.summary || article.subject || '' };
  }
  if (!verdict.relevant) {
    // 나와 무관 → 피드에만 남김(데이터는 안 버림), 푸시 안 함.
    return { relevant: false, push: 'low', status: verdict.myStatus || 'unknown', verdict,
      title: '', body: verdict.summary || article.subject || '' };
  }
  // ★내 부(部)라는 '긍정적 근거'가 하나도 없으면 3부로 단정하지 않고 피드에만.
  //  (부 미표시 + 내 순번X + 내 이름X 인 3자 공지가 "3부 소식"으로 오발송되던 버그 차단)
  const nameHit = `${article.subject || ''} ${article.text || ''}`.includes(name);
  const hasAnchor = vpart === myPart || Number.isFinite(Number(verdict.myPosition)) || nameHit;
  if (!hasAnchor) {
    return { relevant: false, push: 'low', status: verdict.myStatus || 'unknown', verdict,
      title: '', body: verdict.summary || article.subject || '' };
  }

  // 관련 있음 → 상태별 문구 구성 (산수는 코드).
  let status = verdict.myStatus || 'unknown';
  let body = verdict.summary || article.subject || '';
  const teeRaw = verdict.teeTime && /\d{1,2}:\d{2}/.test(verdict.teeTime) ? verdict.teeTime : null;
  const teeHour = teeRaw ? Number(teeRaw.match(/(\d{1,2}):/)[1]) : null;
  // ★방어벽: 내 부 시간대 창 밖 티오프만 있는 글은 남의 부(취소·변동 등)를 잘못 읽은 것 → 내 근무 아님 → 피드만.
  //  ("인 13시35분 취소 박진수님까지"를 김홍구 티오프로 오판하던 버그 차단)
  if (teeRaw && teeHour != null && outOfWindow(teeHour, member)) {
    return { relevant: false, push: 'low', status: 'unknown', verdict,
      title: '', body: verdict.summary || article.subject || '' };
  }
  const tee = teeRaw; // 여기 도달하면 창 안(또는 티오프 없음)

  if (tee) {
    // 티오프 배정 = 근무 확정. 산수(남은인원) 무시, 출근/출발 안내.
    status = status === 'your_turn' ? 'your_turn' : (status === 'work' ? 'work' : 'assigned');
    body = `${name}님, ${dayWordFor(verdict.dateLabel)} 근무 배정됐어요!${commuteLine(tee, verdict.course, member.commuteMin)}`;
  } else if (status === 'work' || status === 'assigned' || status === 'your_turn') {
    // 근무 결론인데 티오프 시각이 아직 안 읽힘 → '확정'이 아니라 '예정'으로(티오프 매칭 = 확정 기준).
    status = status === 'your_turn' ? 'your_turn' : 'assigned';
    body = `${name}님, ${dayWordFor(verdict.dateLabel)} 근무 예정이에요. 티오프가 매칭되면 확정 알림 드릴게요.`;
  } else if (status === 'waiting' || status === 'near' || status === 'spare') {
    const mp = Number(verdict.myPosition), cp = Number(verdict.cutoffPosition);
    // 남은 인원은 '○○까지'가 텍스트에 명시됐을 때만 계산(지어낸 커트라인 방지).
    const announced = verdict.cutoffAnnounced && verdict.cutoffName
      && Number.isFinite(mp) && Number.isFinite(cp);
    if (announced) {
      const remaining = mp - cp - 1;
      if (remaining < 0) {
        // 내 순번이 커트라인 안 → 근무 순번에 듦. 아직 티오프 매칭 전이므로 '확정' 아니라 '예정'으로 구분.
        status = 'assigned';
        body = `${name}님, ${verdict.cutoffName}님까지 근무예요. 순번(${mp}번)이 그 안이라 ${dayWordFor(verdict.dateLabel)} 근무 예정이에요. 티오프가 매칭되면 확정 알림 드릴게요.`;
      } else if (remaining === 0) {
        // 커트라인 바로 다음 = 스페어 1번. '출근 확정'이 아니라 '언제든 나갈 수 있는 1순위'로 구분.
        status = 'near';
        body = `${name}님은 지금 스페어 1번이에요. 팀이 하나만 더 차면 바로 출근이니 준비해두세요.`;
      } else {
        // 뒤 순번 스페어 → 앞에 몇 명 남았는지로 대기감을 전달.
        status = remaining <= 2 ? 'near' : 'waiting';
        body = `${name}님은 스페어 ${remaining + 1}번, ${verdict.cutoffName}님까지 근무라 앞에 ${remaining}명 남았어요.`;
      }
    } else if (verdict.cutoffAnnounced && verdict.cutoffName) {
      // 커트라인 이름만 있고 순번(내·커트라인)을 몰라 남은 인원 계산 불가 → 내 근무여부 단정 금지, 정보만.
      status = 'spare';
      body = `${name}님, ${verdict.cutoffName}님까지 근무한다는 공지예요. 내 순번을 배치표와 비교해 확인해보세요.`;
    } else {
      // 명시 커트라인 없음 → 지어내지 않고 '스페어 대기'만 정직하게, 괄호 없이 자연스러운 한 문장으로.
      status = 'spare';
      body = Number.isFinite(mp)
        ? `${name}님, ${verdict.dateLabel || '오늘'} ${member.part}부 스페어 대기 순번은 ${mp}번입니다.`
        : `${name}님, ${verdict.dateLabel || '오늘'} ${member.part}부 스페어 대기입니다.`;
    }
  } else if (status === 'off') {
    body = `${name}님, ${verdict.dateLabel || '오늘'} 휴무입니다. 편히 쉬세요`;
  }

  if (verdict.note && String(verdict.note).trim()) body += `\n⚠️ ${String(verdict.note).trim()}`;

  // 확신도 낮거나 교차검증 불일치면 '확인필요'로 낮춤(틀린 단정 방지, 그래도 알림은 감).
  let push = (Number(verdict.confidence) || 0) < 0.4 ? 'check' : 'high';
  // ★불확실이면 '구체적인 이유'를 그대로 보여준다(막연한 "판독 불확실"보다 불안이 덜하고 행동이 명확).
  if (verdict._uncertain) { push = 'check'; body = `⚠️ ${verdict._uncertain}\n${body}`; }
  const title = push === 'check' ? '🏌️ 3부 소식 — 확인' : titleFor(status);
  return { relevant: true, push, status, verdict, title, body };
}

// ── 오늘 3부 명단(화이트리스트) 기반 정밀 필터 ──────────────
//  본배치표에서 뽑아둔 today.roster3(3부 이름들)로, 이후 짧은 소식을 이름으로 거른다.
//  · 부가 이미 판정된 글(part 1/2/3 명시·시간대)엔 개입하지 않음(모호할 때만 작동).
//  · 대상 인물이 3부 명단에 없으면 → 내 부 아님(피드만).
//  · 명단에 있으나 '부 중복'인 사람뿐이면 → 시간대(14시~ or 티오프 14시~)로 판정.
export function applyRoster(verdict, today, article, member = memberFromEnv()) {
  if (!verdict || !verdict.relevant) return;
  const vpart = (String(verdict.part || '').match(/[123]/) || [])[0] || 'unknown';
  if (vpart !== 'unknown') return;                       // 부가 이미 판정됨 → 그 판정 신뢰
  if (Array.isArray(verdict.part3Roster) && verdict.part3Roster.length) return; // 이 글이 본배치표면 제외
  const roster = today?.roster3;
  if (!Array.isArray(roster) || !roster.length) return;  // 명단 없음 → 시간/부 로직에 위임
  if (today?.date && verdict.dateLabel && today.date !== verdict.dateLabel) return; // 다른 날 명단이면 미적용
  const names = (verdict.subjectNames || []).filter(Boolean);
  if (!names.length) return;                             // 특정 인물 없는 공지는 통과

  const set = new Set(roster);
  const cross = new Set(today?.crossPart3 || []);
  const inRoster = names.filter((n) => set.has(n));
  if (!inRoster.length) {
    verdict.relevant = false;
    verdict._rosterDrop = `대상(${names.join(',')})이 ${member.part}부 명단에 없음`;
    return;
  }
  if (inRoster.every((n) => cross.has(n))) {             // 전원 부-중복 → 시간으로 판정
    const ts = Number(article.writeDate);
    const hour = Number.isFinite(ts) && ts > 1e12 ? new Date(ts).getHours() : null;
    const tm = String(verdict.teeTime || '').match(/(\d{1,2}):(\d{2})/);
    const teeH = tm ? Number(tm[1]) : null;
    const timeSaysMine = (teeH != null && !outOfWindow(teeH, member)) || (teeH == null && hour != null && hour >= 14);
    if (!timeSaysMine) {
      verdict.relevant = false;
      verdict._rosterDrop = `부-중복 인물 + ${member.part}부 시간대 아님`;
      return;
    }
  }
  verdict.part = member.part;    // 명단 확인 → 내 부로 확정
  verdict.rosterConfirmed = true;
}

// 글 → Gemini가 '편견 없이' 판정(stateless) → 최종 결정. { relevant, push, title, body, status, rawVerdict }
//  today 는 프롬프트에 넣지 않는다(이전 상태가 판독을 오염시키지 않게).
//  단, 텍스트만 있어 순번을 못 읽었으면 '같은 날 잠긴 순번'으로만 코드가 채운다(안전한 보완).

// ★코드가 3부 티오프 표(teeGrid)에서 김홍구 순번으로 티오프를 확정(모델의 눈대중 대신).
//  · 순번이 표에 있으면 → 그 시간이 김홍구 티오프(근무 배정).
//  · 순번이 표에 없으면 → 스페어(모델이 붙인 티오프 제거). 모델이 근무라 우겼으면 '확인 필요'.
// 표 판독이 '행 순서대로 번호 매기기' 실패인지 감지: 순번이 1,2,3,4…로 완전 순차이거나 코스가 전부 동일하면 의심.
// "현재 3부 N팀" → N 추출(내 부 한정). N = 순번 N번까지 근무 확정(실시간 확정선).
export function extractTeamCount(text, member = memberFromEnv()) {
  const t = String(text || '');
  const { part } = member;
  const p = String(part || '').replace(/[^0-9]/g, '');
  if (!p) return null;
  const re1 = new RegExp(`${p}\\s*부[^0-9]{0,8}(\\d{1,2})\\s*팀`);   // 3부 16팀
  const re2 = new RegExp(`(\\d{1,2})\\s*팀[^0-9]{0,8}${p}\\s*부`);   // 16팀 3부
  const m = t.match(re1) || t.match(re2);
  if (!m) return null;
  const n = Number(m[1]);
  return (n >= 1 && n <= 40) ? n : null;
}

// 부(部) 표기 없이 순수 'N팀'만 올라오는 실시간 확정팀수 — 3부 단톡/번호표 관례(정용만님이 '15팀','14팀'처럼 올림).
//  ★오검출 방지: (1)3부 문맥일 때만 (2)다른 부(1·2·4~9부) 언급 없을 때만 (3)제목이 'N팀…'으로 시작할 때만.
//  이 3중 가드로 '실시간 확정선' 메시지만 정확히 집는다(긴 잡담 속 'N팀'은 제외).
export function extractBareTeamCount(subject, text, member = memberFromEnv()) {
  if (String(member.part) !== '3') return null;              // 지금은 3부 문맥만(다부 일반화는 나중)
  const s = String(subject || '');
  if (/[124-9]\s*부/.test(`${s} ${text || ''}`)) return null; // 다른 부 언급 → 모호 → 포기(안전)
  const m = s.match(/^\s*(\d{1,2})\s*팀/);                    // 제목이 'N팀'으로 시작(확정팀수 관례)
  if (!m) return null;
  const n = Number(m[1]);
  return (n >= 1 && n <= 40) ? n : null;
}

function gridLooksRownumbered(grid) {
  if (!Array.isArray(grid) || grid.length < 4) return false;
  const pos = grid.map((g) => Number(g?.pos)).filter((n) => n > 0);
  if (pos.length < 4) return false;
  const courses = new Set(grid.map((g) => /IN/i.test(String(g?.course)) ? 'IN' : 'OUT'));
  const allSameCourse = courses.size === 1;                 // 실제 표는 OUT·IN 섞임
  let sequential = 0;
  for (let i = 1; i < pos.length; i++) if (pos[i] === pos[i - 1] + 1) sequential++;
  const mostlySequential = sequential >= pos.length - 2;    // 거의 1,2,3,4…
  return allSameCourse && mostlySequential;
}

function resolveTeeByGrid(verdict, member = memberFromEnv()) {
  if (!verdict) return;
  const grid = Array.isArray(verdict.teeGrid) ? verdict.teeGrid : [];
  const mp = Number(verdict.myPosition);
  if (!(mp > 0) || grid.length < 3) return; // 표를 제대로 못 옮겼으면 기존 판독 유지
  // ★표를 순서대로 번호 매긴 오독이면 티오프를 신뢰하지 않음(근무확정 색은 유지, 시간만 '확인 필요').
  if (gridLooksRownumbered(grid)) {
    const color0 = String(verdict.myCellColor || '').toLowerCase();
    const work0 = /white|흰|colored|색칠|녹|하늘|green|blue/.test(color0);
    verdict.teeTime = null;
    verdict.myStatus = work0 ? 'work' : (verdict.myStatus === 'spare' ? 'spare' : verdict.myStatus);
    verdict._uncertain = verdict._uncertain || `티오프 표 판독 불안정(행 번호매기기 의심) — 시각은 배치표에서 확인 필요`;
    verdict._teeSource = 'unreliable-grid';
    return;
  }
  const hit = grid.find((g) => Number(g?.pos) === mp && /\d{1,2}:\d{2}/.test(String(g?.time || '')));
  const color = String(verdict.myCellColor || '').toLowerCase();
  const isWorkColor = /white|흰|colored|색칠|녹|하늘|green|blue/.test(color);
  if (hit) {
    verdict.teeTime = String(hit.time).match(/\d{1,2}:\d{2}/)[0];
    if (hit.course) verdict.course = /IN/i.test(String(hit.course)) ? 'IN' : 'OUT';
    if (!['work', 'your_turn'].includes(verdict.myStatus)) verdict.myStatus = 'assigned';
    verdict._teeSource = 'grid';
  } else {
    // 순번이 표에 없음.
    const posList = grid.map((g) => Number(g?.pos)).filter((n) => n > 0);
    const maxTeePos = posList.length ? Math.max(...posList) : 0;
    const modelTee = (String(verdict.teeTime || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    const teeHour = modelTee ? Number(modelTee.split(':')[0]) : null;
    const plausible = modelTee && teeHour != null && !outOfWindow(teeHour, member);
    // ★배정된 티오프 최대 순번보다 확실히 뒤면(=아직 팀 안 참) 스페어(대기).
    //  이 경우 색 판독(흰/회색)이 어긋나도 구조적으로 대기가 맞다 — 회색을 흰색으로 오독해도 방어.
    //  (근무 확정은 김홍구 정의상 "임시라도 티오프 매칭된 상태"이므로, 티오프 없고 컷 밖이면 대기.)
    if (maxTeePos > 0 && mp > maxTeePos && !plausible) {
      verdict.teeTime = null;
      verdict.myStatus = 'spare';
      verdict._teeSource = 'beyond-cut';
      if (isWorkColor) verdict._uncertain = verdict._uncertain
        || `순번 ${mp}이 배정 티오프(최대 ${maxTeePos}번) 밖 → 스페어(대기)로 판단(색 판독보다 우선)`;
      return;
    }
    if (isWorkColor) {
      // 근무 확정. 모델이 본인 티오프를 직접 읽었고(≥16시) 그럴듯하면 유지하되 '확인 필요' 표시(표 누락 가능).
      if (plausible) {
        verdict.teeTime = modelTee;
        verdict.myStatus = ['your_turn'].includes(verdict.myStatus) ? 'your_turn' : 'assigned';
        verdict._uncertain = verdict._uncertain || `순번 ${mp} 티오프를 표에서 못 찾아 모델 판독(${modelTee}) 사용 — 확인 권장`;
        verdict._teeSource = 'model';
      } else {
        verdict.teeTime = null;
        if (!['work', 'your_turn', 'assigned'].includes(verdict.myStatus)) verdict.myStatus = 'work';
      }
    } else {
      // 회색(스페어) 또는 색 불명 → 티오프 지어내기 차단, 스페어.
      if (modelTee) verdict._uncertain = verdict._uncertain || `표에 순번 ${mp}이 없는데 모델이 티오프 ${modelTee} 제시(충돌)`;
      verdict.teeTime = null;
      if (['assigned', 'work', 'your_turn'].includes(verdict.myStatus)) verdict.myStatus = 'spare';
    }
  }
}

// ── board 합의 판독(표결) — 비전 판독 흔들림을 다수결로 잡고, 갈리면 정직하게 '확인 필요' ──
//  같은 배치표라도 Gemini는 읽을 때마다 순번·명단·색·티오프가 흔들린다. 그래서 배치표에 한해
//  같은 글을 여러 번 읽어 표결한다: 과반이 일치하면 그 값을 '확신'(신뢰도↑ = 회원 순번도 안정),
//  갈리면 _uncertain(확인 필요)로 정직하게 낮춘다. ★이 표결은 '공유 board 1건'에만 든다 —
//  회원 수와 무관(회원별 재호출은 여전히 0). 총 판독 횟수는 BOARD_READ_MAX(기본 3)로 상한.
function modeOf(arr) {
  const m = new Map();
  let best = null, bestN = 0;
  for (const x of arr) { const n = (m.get(x) || 0) + 1; m.set(x, n); if (n > bestN) { bestN = n; best = x; } }
  return { value: best, count: bestN };
}

// raw 판독 하나를 '주어진 순번' 기준으로 티오프까지 확정해 티오프 문자열만 얻는다(원본 불변).
function teeForPosition(raw, pos, member = memberFromEnv()) {
  if (!raw) return '';
  const v = { ...raw, myPosition: pos };
  resolveTeeByGrid(v, member);
  const th = (String(v.teeTime || '').match(/(\d{1,2}):/) || [])[1];
  if (th != null && outOfWindow(Number(th), member)) return '';
  return (String(v.teeTime || '').match(/\d{1,2}:\d{2}/) || [''])[0];
}

// 여러 읽기의 3부 명단 중 '가장 신뢰할' 하나 선택: 다른 읽기와 이름 겹침이 크고(교차 확인) 긴 것.
//  → 채택된 명단이 today.roster3 가 되어 회원 순번 조회의 근거가 되므로 신뢰도가 곧 회원 정확도.
function pickRoster(reads) {
  const cands = reads.map((r) => ({
    roster: (Array.isArray(r?.part3Roster) ? r.part3Roster : []).filter(Boolean),
    cross: (Array.isArray(r?.crossPartNames) ? r.crossPartNames : []).filter(Boolean),
  })).filter((x) => x.roster.length);
  if (!cands.length) return { roster: [], cross: [] };
  let best = cands[0], bestScore = -1;
  for (const cand of cands) {
    const set = new Set(cand.roster);
    let overlap = 0;
    for (const other of cands) { if (other !== cand) overlap += other.roster.filter((n) => set.has(n)).length; }
    const score = overlap * 10 + cand.roster.length; // 교차 확인 우선, 동률이면 더 긴 명단
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

// 교차검증된 명단(순번순)에서 회원 이름의 순번(1-based)을 찾는다. 못 찾으면 0.
//  ★대기명단=순번 순서이므로 index+1이 곧 순번. 괄호 교환("A(B)")이면 실제 점유자 B 기준.
function rosterPosOf(roster, name) {
  if (!Array.isArray(roster) || !name) return 0;
  const key = String(name).replace(/\s/g, '');
  for (let i = 0; i < roster.length; i++) {
    const cell = String(roster[i] || '').replace(/\s/g, '');
    if (!cell) continue;
    const m = cell.match(/\(([^)]+)\)/);
    const occupant = (m ? m[1] : cell.replace(/\(.*$/, '')).trim();
    if (occupant === key || cell === key) return i + 1;
  }
  return 0;
}

// 순수 표결: 여러 raw 읽기 → 합의 verdict 하나(불확실이면 _uncertain). I/O 없음(테스트 용이).
export function consensusFromReads(reads, member = memberFromEnv()) {
  const rs = (reads || []).filter(Boolean);
  if (!rs.length) return null;
  if (rs.length === 1) return rs[0]; // 1회만 성공 → 표결 불가, 단일 판독 그대로
  const posOf = (r) => (Number(r?.myPosition) > 0 ? Number(r.myPosition) : null);

  // ★각 읽기의 '결론'을 뽑는다 — 판단의 핵심은 순번 '숫자'가 아니라 "일하나/스페어냐, 근무면 몇 시냐".
  //  순번이 판독마다 조금 흔들려도 결론(스페어)이 같으면 확실한 것 → 불필요한 '불확실' 경보를 없앤다.
  const concl = rs.map((r) => {
    const c = { ...r };
    resolveTeeByGrid(c, member);             // 각 읽기를 자기 순번 기준으로 해석
    const tee = (String(c.teeTime || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    const th = tee ? Number(tee.split(':')[0]) : null;
    const teeOk = !!tee && th != null && !outOfWindow(th, member);
    const working = teeOk || ['work', 'assigned', 'your_turn'].includes(c.myStatus);
    const color = String(c.myCellColor || '').toLowerCase();
    const spare = !working && (['spare', 'waiting'].includes(c.myStatus) || /gray|회색/.test(color));
    return { working, spare, tee: teeOk ? tee : '', pos: posOf(r) };
  });
  const workVotes = concl.filter((c) => c.working).length;
  const spareVotes = concl.filter((c) => c.spare).length;
  const majority = Math.floor(rs.length / 2) + 1;

  // 순번(다수결) — 표시·'내 앞 N명' 계산용. ★불확실 판정 근거로는 쓰지 않는다.
  const posVotes = concl.map((c) => c.pos).filter(Boolean);
  const posMode = modeOf(posVotes);
  const pos = posMode.value || posOf(rs[0]);
  const roster = pickRoster(rs);

  // 합의 verdict: 채택 순번과 가장 잘 맞는 읽기를 뼈대로, 표결값을 덮어쓴다.
  const seed = rs.find((r) => posOf(r) === pos) || rs[0];
  const v = { ...seed };
  if (pos) v.myPosition = pos;
  if (roster.roster.length) { v.part3Roster = roster.roster; v.crossPartNames = roster.cross; }
  v.myCellColor = modeOf(rs.map((r) => String(r?.myCellColor || 'unknown'))).value;
  // 커트라인·팀수는 '텍스트' 근거라 흔들림이 적음 — 하나라도 명시됐으면 채택.
  const withCut = rs.find((r) => r?.cutoffAnnounced && r?.cutoffName);
  if (withCut) { v.cutoffAnnounced = true; v.cutoffName = withCut.cutoffName; v.cutoffPosition = withCut.cutoffPosition; }
  const withTeam = rs.find((r) => Number(r?.teamCount) > 0);
  if (withTeam) v.teamCount = withTeam.teamCount;
  // 인턴(노란칸) 수는 여러 판독의 다수결(구조적이라 안정적) — 정규 근무선 계산·표시에 사용.
  const internVotes = rs.map((r) => Number(r?.internCount)).filter((x) => Number.isFinite(x) && x >= 0);
  if (internVotes.length) v.internCount = modeOf(internVotes).value;
  const withInternTees = rs.find((r) => Array.isArray(r?.internTees) && r.internTees.length);
  if (withInternTees) v.internTees = withInternTees.internTees;
  // 부 표(boardTables: 헤더+색)는 구조적이라 안정적 — 표를 가장 많이(완전히) 읽은 판독 채택.
  const bt = rs.map((r) => (Array.isArray(r?.boardTables) ? r.boardTables : []))
    .reduce((best, cur) => (cur.length > best.length ? cur : best), []);
  if (bt.length) v.boardTables = bt;

  resolveTeeByGrid(v, member); // 합의 순번으로 티오프표 최종 해석
  delete v._uncertain;       // 구조적 잡음 초기화 — 아래에서 '결론' 기준으로만 다시 판정
  v._resolved = true;        // judge()가 다시 resolveTeeByGrid 하지 않도록 표식

  // ── 불확실 판정(결론 기준) ── 결정적인 건 '근무/스페어'와 '티오프 시각'뿐.
  if (workVotes >= majority) {
    // 다수가 '근무'. 티오프 시각이 갈리면(위험) 확인 필요, 아니면 확정.
    if (!v.teeTime && !['work', 'assigned', 'your_turn'].includes(v.myStatus)) v.myStatus = 'work';
    const teeVotes = concl.filter((c) => c.tee).map((c) => c.tee);
    const teeMode = teeVotes.length ? modeOf(teeVotes) : { value: '', count: 0 };
    if (teeVotes.length && teeMode.count < Math.floor(workVotes / 2) + 1) {
      v._uncertain = `티오프 시각이 판독마다 달라요(${[...new Set(teeVotes)].join('/')}) — 배치표에서 시각을 확인하세요`;
    }
  } else if (spareVotes >= majority) {
    // 다수가 '스페어' → 확정 스페어. 순번 숫자가 흔들려도 결론은 확실 → '불확실' 표시 안 함.
    v.myStatus = 'spare'; v.teeTime = ''; v.course = '';
  } else {
    // 근무/스페어가 갈리거나(결정적 충돌) 읽기 대부분이 부실 → 이때만 정직하게 확인 필요.
    v._uncertain = '근무인지 스페어인지 판독이 갈려요 — 배치표를 직접 확인하세요';
  }
  // ★배치표에서 내 행(순번)을 찾았거나 근무/스페어 결론이 섰으면 '나와 관련 있음'을 확정한다.
  //  (Gemini가 완료·마감 배치표를 relevant:false로 헷갈려, 순번·티오프는 잘 읽고도
  //   "구체적 순번·근무 상태 확인 불가" 같은 애매한 요약만 소식에 남기던 문제 차단)
  if (pos || workVotes >= majority || spareVotes >= majority) v.relevant = true;

  // ── ★본인 순번 최종 교정(명단 대조) ── LLM이 자기 순번 숫자를 오독(예: 12→3)하면 근무로 오승격되고
  //  남의 티오프가 매칭된다. 교차검증된 대기명단에서 이름으로 순번을 확정하고, 근무 상한(팀수/티오프표 최대순번)
  //  밖이면 구조적으로 스페어 확정 — 표결(오독 순번 기반)보다 구조를 우선한다.
  //  (사용자 원칙: "스페어면 매칭할 티오프 예약이 없다".) 다른 회원(interpretForMember)은 이미 명단 기반이라 무관.
  fixMemberPosByRoster(v, member);

  v._reads = rs.length;
  return v;
}

async function readBoardConsensus(article, member) {
  const img = article.images?.[0] || null;
  const boardModel = process.env.GEMINI_BOARD_MODEL || null; // 배치표는 강한 모델(정확도↑, 비용 소액)
  const MAX = Math.max(1, Math.min(5, Number(process.env.BOARD_READ_MAX ?? 3)));
  const posOf = (r) => (Number(r?.myPosition) > 0 ? Number(r.myPosition) : null);
  const reads = [];
  for (let i = 0; i < MAX; i++) {
    let r = await callGeminiJSON(buildPrompt(article, member), img, boardModel);
    if (!r && boardModel) r = await callGeminiJSON(buildPrompt(article, member), img, null); // 등급 강등 안전망
    if (r) reads.push(r);
    if (reads.length >= 2) { // 조기 종료: 최근 2개가 순번·티오프까지 일치하면 더 안 읽음(비용 절약)
      const a = reads[reads.length - 1], b = reads[reads.length - 2];
      const pa = posOf(a);
      if (pa && pa === posOf(b) && teeForPosition(a, pa, member) === teeForPosition(b, pa, member)) break;
    }
  }
  return consensusFromReads(reads, member);
}

// 명단 셀 이름 정규화. 괄호 처리:
//  · "(54)"·"(2,3)" 처럼 숫자/쉼표면 = 부·근무 구분 → 괄호 떼고 본명, 부-중복(cross)으로 표시.
//  · "(사람이름)" 이면 = 순번 교환 → 그 자리 실제 점유자는 괄호 안 사람.
function normRosterName(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);   // "이름(속)나머지" — 나머지(tail)까지 포착
  if (!m) return { name: s, cross: false };
  const base = m[1].trim(), inner = m[2].trim(), tail = m[3].trim();
  // "최수원(1,3)연승준" — 괄호 뒤에 이름이 더 있으면 그게 실제 점유자(괄호 속은 부/근무 태그).
  if (tail && /[가-힣]/.test(tail)) return { name: tail, cross: /^[\d,\s.]+$/.test(inner) };
  if (/^[\d,\s.]+$/.test(inner)) return { name: base, cross: true };  // "표승완(54)" 부/근무 구분
  return { name: inner || base, cross: false };                       // "정진영(조하빈)" 순번 교환 → 점유자
}

// 전용 명단 판독([{pos,name}]) → { roster:위치정렬(index=순번-1,빈칸=''), cross:[부중복 본명] }.
//  충분히 완전할 때만 반환, 아니면 null. (정확 우선) 맨 위(1~2번)부터 + 대부분 채움(≥70%) + 내 순번까지 덮을 때만.
function buildPositionalRoster(ordered, verdict) {
  if (!Array.isArray(ordered) || !ordered.length) return null;
  const byPos = new Map();
  for (const r of ordered) if (!byPos.has(r.pos)) byPos.set(r.pos, r.name);
  const positions = [...byPos.keys()];
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  const myPos = Number(verdict?.myPosition) || 0;
  if (minPos > 2) return null;                              // 목록 앞부분을 못 읽음
  if (byPos.size < Math.ceil(maxPos * 0.7)) return null;    // 중간이 너무 많이 빔
  if (myPos && maxPos < myPos) return null;                 // 내 순번을 못 덮음
  const arr = new Array(maxPos).fill('');
  const cross = [];
  for (const [pos, raw] of byPos) {
    if (pos < 1 || pos > maxPos) continue;
    const { name, cross: isCross } = normRosterName(raw);
    arr[pos - 1] = name;
    if (isCross && name) cross.push(name);
  }
  return { roster: arr, cross };
}

export async function judge(article, today = null, member = memberFromEnv()) {
  const img = article.images?.[0] || null;
  //  ★board(전체 명단 이미지) 판정 — 명단 harvest(괄호 교환 해석)를 태울지 결정.
  //   "배치표/번호표" 키워드뿐 아니라 "N팀"·"○○님까지 근무" 컷 공지도 전체 순번판이 붙어 오므로 포함.
  //   (이걸 놓치면 이미지의 괄호 교환 "정진영(조하빈)"이 해석 안 돼 회원에게 교환 전 순번이 나감.)
  const subj = article.subject || '';
  const isBoard = !!img && (
    /배치표|시간표|번호표/.test(subj)
    || /\d+\s*팀/.test(subj)                                   // "3부 17팀"
    || /[가-힣]{2,4}\s*님\s*(?:\([^)]*\)\s*)?까지\s*(?:근무|일)/.test(subj)  // "○○님(□□)까지 근무"
  );
  // ★배치표(이미지)는 여러 번 읽어 '표결'(신뢰도↑·정직한 불확실). 텍스트/카톡/일반 글은 1회(기본 모델).
  let verdict = isBoard
    ? await readBoardConsensus(article, member)
    : await callGeminiJSON(buildPrompt(article, member), img, null);
  // 합의 판독(_resolved)은 이미 표결 안에서 순번→티오프 확정 + 결론기준 불확실 판정을 마쳤다.
  //  그걸 다시 resolveTeeByGrid 하면 구조적 잡음(행번호매기기 등)이 '불확실'로 재주입되므로 건너뛴다.
  if (!verdict?._resolved) resolveTeeByGrid(verdict, member);
  // ★순번별 '이름' 명단 — 통합 판독이 자주 놓쳐서(타임아웃·부분) 전용 판독으로 다시 뽑아 위치정렬로 저장.
  //  신뢰할 만큼 완전할 때만 채택. 부실하면 []로 비워, today가 이전(마지막 정상) 명단을 보존하게 한다.
  if (isBoard && verdict) {
    try {
      // ★몰림 방지: 명단 판독과 조 배치표 판독을 '동시(Promise.all)'로 쏘던 것을 '순차'로 —
      //  무거운 board 판독이 겹쳐 429/타임아웃으로 명단이 빈값(0명) 오던 문제 완화.
      //  명단이 비거나 불완전(buildPositionalRoster가 null)하면 1회 재시도(일시 몰림 대비). 조 명부는 이미 수확한 이미지면 건너뜀.
      const imgKey = article.images?.[0] || '';
      const doCrew = !!imgKey && !alreadyHarvested(imgKey);
      // 대상 회원이 명단에 있어야 그 부(部) 명단이 맞다 — 없으면 다른 부 섹션을 오독한 것(공백 무시 부분일치).
      //  ★단, 메인 판독이 실제로 내 순번을 찾았을 때만(myPos>0) 이 검사를 건다 — 내가 그 부에 아예 없는 날(순번 없음)엔
      //   명단에 내가 없는 게 정상이라 헛 재시도(크레딧 낭비)를 피한다.
      const nameKey = String(member.name || '').replace(/\s/g, '');
      const myPos = Number(verdict?.myPosition) || 0;
      const hasMe = (b) => (b ? b.roster.some((n) => String(n).replace(/\s/g, '').includes(nameKey)) : false);
      let built = buildPositionalRoster(await analyzeRoster(article, member.part), verdict);
      // ★hasMe 재시도는 회원이 그 부 배치표에 '반드시 있는' 부(3부=김홍구 홈)에서만 유효.
      //  2부처럼 회원이 대개 명단에 없는 부에선 역효과(정상인데 재시도, 오히려 3부로 잘못 읽히면 이름이 있어 재시도 안 함) → 3부 한정.
      if (!built || (member.part === '3' && nameKey && myPos > 0 && !hasMe(built))) {   // 빈값·불완전·또는 (3부에서 순번 있는데 명단에 내가 없음=다른 부 오독) → 1회 재시도
        console.log(`↻ [roster] ${member.part}부 명단 재시도 (1차 내포함=${built ? hasMe(built) : 'null'})`);
        const built2 = buildPositionalRoster(await analyzeRoster(article, member.part), verdict);
        if (built2 && (hasMe(built2) || !built)) built = built2; // 재시도가 나를 포함하면 채택(다른 부 교정), 1차 실패면 재시도 사용
      }
      // ★인턴(노란칸) 전용 판독으로 통합판독의 오탐을 교정(표시 정확도). 실패하면 통합판독값 유지.
      const interns = await analyzeInterns(article, member.part);
      if (interns) { verdict.internCount = interns.internCount; verdict.internTees = interns.internTees; }
      const crews = doCrew ? await analyzeCrews(article) : [];
      // ★조 배치표 전원을 전역 캐디 사전에 축적(원본 그대로 — 새 캐디 발견). 이 사전이 오탈자 보정의 근거.
      if (crews.length) {
        const n = learnCrews(crews); markHarvested(imgKey);
        // ★오늘 이 배치표의 '이름→근무표시' 맵을 판독결과에 부착 → 부(部)별 알림 게이트의 authoritative 근거.
        //  (전역 사전 duties는 날짜 누적이라 '오늘의 부'엔 못 씀 — 이 배치표 crews만 사용.)
        verdict.crewDuty = {};
        for (const c of crews) { const k = String(c.name || '').replace(/\s/g, ''); if (k && !verdict.crewDuty[k]) verdict.crewDuty[k] = c.duty || ''; }
        if (n) console.log(`👥 조 배치표 ${n}명 수확`);
      }
      if (built) {
        // ★캐디 사전으로 순번 이름 후처리 보정 + 축적(오탈자 되돌림). 위치(빈칸)는 보존.
        verdict.part3Roster = correctAndLearn(built.roster);
        verdict.crossPartNames = built.cross.map((n) => snapName(n));
        verdict.rosterReliable = true;
      } else if (Array.isArray(verdict.part3Roster)) verdict.part3Roster = [];
    } catch (e) { console.error('[roster] 명단/조 판독 실패:', e.message); }
  }
  // ★티오프 창 가드: 내 부 시간대(3부=16시~) 밖 '티오프'는 무효(취소·남의 시간 오독) → 근무 배정 알림 방지.
  if (verdict) {
    const th = (String(verdict.teeTime || '').match(/(\d{1,2}):/) || [])[1];
    if (th != null && outOfWindow(Number(th), member)) {
      verdict.teeTime = ''; verdict.course = '';
      if (['assigned', 'work', 'your_turn'].includes(verdict.myStatus)) verdict.myStatus = 'spare';
    }
  }
  // ★순번(myPosition)의 권위는 '배치표 이미지'뿐. 텍스트 글에서 Gemini가 순번을 지어내면(환각)
  //  저장된(배치표에서 읽은) 순번으로 덮는다 — 텍스트엔 순번 정보가 없으니 저장값이 authoritative.
  //  배치표(isBoard)는 실제로 이미지를 봤으니 그 판독을 신뢰하되, 실패(0)했을 때만 저장값으로 보완.
  if (verdict && today && Number(today.myPosition) > 0
      && (!today.date || !verdict.dateLabel || today.date === verdict.dateLabel)) {
    if (!isBoard) verdict.myPosition = today.myPosition;                       // 텍스트: 저장 순번 고정(환각 차단)
    else if (!(Number(verdict.myPosition) > 0)) verdict.myPosition = today.myPosition; // 배치표: 실패 시만 보완
  }
  // ★"현재 3부 N팀" 팀 수 보정: Gemini가 놓쳤으면 코드가 추출(내 부 한정). = 실시간 확정선.
  //  1) 부 표기 있는 'N부 N팀'(엄격) → 2) 없으면 3부 문맥의 순수 'N팀'(정용만님 실시간 관례) 보정.
  if (verdict && !(Number(verdict.teamCount) > 0)) {
    const blob = `${article.subject || ''}\n${article.text || article.contentText || article.content || ''}`;
    let tc = extractTeamCount(blob, member);
    if (!tc) tc = extractBareTeamCount(article.subject, article.text || article.contentText || article.content, member);
    if (tc) { verdict.teamCount = tc; if (!verdict.relevant) verdict.relevant = true; }
  }
  // ★커트라인 위치 보완: '○○까지' 이름만 있고 번호를 모르면 저장된 3부 명단에서 그 사람 순번을 찾아 채운다.
  //  → '위치 모름'으로 애매하게 넘기지 않고, 내 순번과 비교해 정확히 남은 인원을 계산(사용자 요구).
  if (verdict && verdict.cutoffAnnounced && verdict.cutoffName
      && !(Number(verdict.cutoffPosition) > 0)
      && Array.isArray(today?.roster3) && today.roster3.length) {
    const idx = today.roster3.findIndex((n) => String(n).includes(verdict.cutoffName));
    if (idx >= 0) verdict.cutoffPosition = idx + 1;
  }
  // ★대바(대기바꿈) 결정적 반영 — 모델은 원본 순번만 읽고, 교환은 코드가 명단에 못박는다.
  //  · 배치표 글: 방금 하베스트한 '깨끗한 원본 명단'(rosterReliable)에 적용 → 매번 동일(멱등).
  //  · 당일변동 글(26750 등): 명단을 새로 안 읽으므로 저장된 today.roster3를 근거로 적용.
  //    같은 댓글이 재처리로 두 번 적용(자리 되돌림)되지 않도록 swapKey로 멱등 보장.
  if (verdict) {
    const ops = parseSwapAssignments(article.comments);
    if (ops.length) {
      const swapKey = `${article.id || ''}:${ops.map((o) => `${o.name}${o.pos}`).join('|')}`;
      const fresh = !!verdict.rosterReliable && Array.isArray(verdict.part3Roster) && verdict.part3Roster.length;
      const alreadyApplied = today?.swapKey && today.swapKey === swapKey;
      const base = fresh ? verdict.part3Roster
        : (Array.isArray(today?.roster3) && today.roster3.length ? today.roster3 : []);
      if (base.length) {
        if (fresh || !alreadyApplied) {
          const { roster: swapped, applied } = applySwapAssignments(base, ops);
          if (applied.length) {
            verdict.part3Roster = swapped;
            verdict.crossPartNames = Array.isArray(verdict.crossPartNames) && verdict.crossPartNames.length
              ? verdict.crossPartNames : (Array.isArray(today?.crossPart3) ? today.crossPart3 : []);
            verdict._swaps = applied;
            verdict._swapKey = swapKey;
          }
        } else {
          verdict.part3Roster = base.slice();   // 이미 반영된 저장 명단 그대로 사용(재적용 금지)
          verdict._swapKey = swapKey;
        }
      }
    }
  }
  // ★커트라인 위치를 (교환 후) 명단에서 괄호 점유자 기준으로 확정 → 본인 순번·근무/스페어 최종 재확정.
  //  명단이 있으면(배치표/대바) authoritative. 없으면 no-op(기존 판독 유지).
  if (verdict) {
    resolveCutoff(verdict, article, today);
    fixMemberPosByRoster(verdict, member);
  }
  applyBoardParts(verdict, member);                // ★표 헤더(OUT|N부|IN)로 부(部) 이중검증(환각 교정)
  applyRoster(verdict, today, article, member);    // 3부 명단 화이트리스트 정밀 필터
  return { ...decide(article, verdict, member), rawVerdict: verdict };
}

// 표 배경색 이름 → 부(部). 리버힐: 1부=연분홍, 2부=하늘색, 3부=보라.
const COLOR_PART = [
  [/분홍|핑크|pink|연분홍|살구|로즈|자홍|rose/i, '1'],
  [/하늘|스카이|sky|파랑|블루|blue|청록|시안|cyan|water/i, '2'],
  [/보라|퍼플|purple|violet|자주|라벤더|바이올렛|lavender/i, '3'],
];
export function colorToPart(color) {
  const c = String(color || '');
  for (const [re, p] of COLOR_PART) if (re.test(c)) return p;
  return '';
}

// ★배치표 티오프 표의 '헤더(OUT|N부|IN)' + '고유 배경색'으로 부(部)를 못박는 이중검증.
//  둘 다 지어낼 수 없는 구조적 근거 → Gemini의 '부 환각'을 교정. 텍스트에 부 표시 없어도 확정.
//  · 헤더·색 중 하나라도 내 부를 가리키면 내 부로 확정(관련). 어느 것도 안 가리키면 다른 부 → 무관.
//  · 헤더와 색이 서로 어긋나고(구조 신호 충돌) 내 부가 양쪽에서 확인되지 않으면 → 정직하게 확인 필요.
export function applyBoardParts(verdict, member = memberFromEnv()) {
  if (!verdict) return;
  const tables = Array.isArray(verdict.boardTables) ? verdict.boardTables : [];
  const headerParts = new Set((Array.isArray(verdict.boardParts) ? verdict.boardParts : [])
    .map((x) => (String(x).match(/[123]/) || [])[0]).filter(Boolean));           // 하위호환
  const colorParts = new Set();
  let conflict = null;
  for (const t of tables) {
    const hp = (String(t?.part).match(/[123]/) || [])[0];
    const cp = colorToPart(t?.color);
    if (hp) headerParts.add(hp);
    if (cp) colorParts.add(cp);
    if (hp && cp && hp !== cp) conflict = `헤더 ${hp}부 ↔ 색 ${cp}부(${t.color})`; // 같은 표인데 글자·색이 다른 부
  }
  const allParts = new Set([...headerParts, ...colorParts]);
  if (!allParts.size) return;                       // 배치표 아님/헤더·색 못읽음 → 기존 판단 유지
  const mp = String(member.part);
  const had = (String(verdict.part || '').match(/[123]/) || [])[0];
  if (allParts.has(mp)) {
    verdict.part = mp;                              // 헤더 또는 색이 내 부 → 내 부로 확정(환각 무시)
    verdict._partSource = (headerParts.has(mp) && colorParts.has(mp)) ? 'header+color'
      : (colorParts.has(mp) ? 'color' : 'header');
  } else {
    verdict.part = [...allParts][0];                // 내 부 없음 → 다른 부 표 → decide가 무관 처리
    verdict.relevant = false;
    verdict._partSource = 'grid';
  }
  const now = (String(verdict.part).match(/[123]/) || [])[0];
  if (had && had !== now) verdict._partFixed = `표(헤더/색)=${[...allParts].join(',')}부 → part ${had}→${now} 교정`;
  // 구조 신호(헤더·색) 충돌 + 내 부가 양쪽에서 확인되진 않음 → 정직하게 확인 필요.
  if (conflict && verdict.relevant && !(headerParts.has(mp) && colorParts.has(mp))) {
    verdict._uncertain = verdict._uncertain || `배치표 부(部) 신호 불일치(${conflict}) — 원문 확인`;
  }
}

// ── 회원별 재해석 (Gemini 재호출 없이) ─────────────────────────
//  이미 읽은 board 결과(shared rawVerdict)를 다른 회원 기준으로 코드만으로 다시 판단.
//  · 회원의 순번: 본배치표면 명단에서 이름으로 찾고(괄호 교환 반영), 아니면 그 회원의 저장된 순번.
//  · 회원의 색은 알 수 없으므로 myCellColor='unknown' → 구조(순번 vs 확정선/티오프표)로 판단.
//  · 커트라인·팀수·티오프표는 회원 무관(공유) → decide()가 회원 순번으로 남은인원 계산.
function memberPositionFromShared(shared, member, today) {
  const roster = Array.isArray(shared?.part3Roster) ? shared.part3Roster : [];
  if (roster.length) {
    for (let i = 0; i < roster.length; i++) {
      const cell = String(roster[i] || '');
      const m = cell.match(/\(([^)]+)\)/);         // "박수현(홍길동)" → 실제 점유자는 괄호 안
      const occupant = (m ? m[1] : cell).trim();
      if (occupant === member.name) return i + 1;   // 명단은 순번 순서 가정
    }
  }
  return Number(today?.myPosition) || null;
}

export function interpretForMember(article, shared, member, today = null) {
  if (!shared) return { ...decide(article, null, member), rawVerdict: null };
  // 다른 부(部)로 판명된 board면 이 회원과도 무관(같은 부만 공유 대상).
  const v = {
    relevant: shared.relevant,
    part: shared.part,
    boardParts: shared.boardParts,       // 하위호환
    boardTables: shared.boardTables,     // 부 표(헤더+색) — 회원 부 기준으로 아래서 재검증
    category: shared.category,
    dateLabel: shared.dateLabel,
    cutoffAnnounced: shared.cutoffAnnounced,
    cutoffName: shared.cutoffName,
    cutoffPosition: shared.cutoffPosition,
    addedTees: shared.addedTees,
    teamCount: shared.teamCount,
    teeGrid: shared.teeGrid,
    part3Roster: shared.part3Roster,
    crossPartNames: shared.crossPartNames,
    subjectNames: shared.subjectNames,
    note: shared.note,
    confidence: shared.confidence,
    myCellColor: 'unknown',              // 회원 본인 색은 모름 → 구조로 판단
    myStatus: 'unknown',
    teeTime: null, course: '',
    myPosition: memberPositionFromShared(shared, member, today),
  };
  // ★공유 board 판독이 표결에서 갈렸으면(shared._uncertain) 이 회원 순번도 그 흔들린 명단에서 뽑은 것 →
  //  이 회원에게도 정직하게 '확인 필요'를 전달(문구는 회원 본인 기준으로 일반화 — 1번 회원 시각·순번 노출 금지).
  if (shared._uncertain) v._uncertain = '배치표 판독이 불안정합니다 — 원문(배치표)을 직접 확인하세요';
  applyBoardParts(v, member);             // ★표 헤더로 이 회원 부(部) 재검증(다른 부 표면 무관 처리)
  resolveTeeByGrid(v, member);            // 순번→티오프(구조·beyond-cut 스페어 등)
  const th = (String(v.teeTime || '').match(/(\d{1,2}):/) || [])[1];
  if (th != null && outOfWindow(Number(th), member)) { v.teeTime = ''; v.course = ''; }
  applyRoster(v, today, article, member);
  return { ...decide(article, v, member), rawVerdict: v };
}
