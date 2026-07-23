// 통합 판단기(새 두뇌).
//  글 하나(제목+본문+이미지) + 내 프로필 + 오늘 기준표 → 구조화된 판정 '하나'.
//  흩어진 정규식 게이트(부·커트라인·시간·이름) 대신 여기 한 곳에서 의미로 판단한다.
//  원칙: Gemini는 '읽기'(위치/여부/티오프)만, 남은인원·출근시간 '산수'는 코드가(정확도).
import { callGeminiJSON } from './gemini.mjs';

// 회원 컨텍스트(이름·부). 미지정이면 .env(=1번 회원 김홍구) → 기존 동작 무변화.
//  ★judge()가 회원을 인자로 받아 buildPrompt/decide/applyRoster 등에 전달 → "누구 기준"만 바깥에서.
function memberFromEnv() {
  return {
    name: (process.env.MY_NAME || '김홍구').trim(),
    part: (process.env.MY_PART || '3').trim(),
  };
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
  // 티오프/시각이 있는데 전부 내 부 시간대(기본 16시) 이전 → 다른 부(오전·낮)
  const TEE_MIN = Number(process.env.TEE_MIN_HOUR ?? 16);
  const hours = [...t.matchAll(/(\d{1,2})\s*(?::\d{2}|시)/g)].map((m) => Number(m[1]));
  if (hours.length && hours.every((h) => h < TEE_MIN)) return 'other';
  return 'unknown';
}

// ── 티오프(HH:MM) → 도착(−준비)·집출발(−이동) ─────────────
export function commuteInfo(teeTime) {
  const m = String(teeTime || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const prep = Number(process.env.PREP_MIN ?? 60);
  const commute = Number(process.env.COMMUTE_MIN ?? 60);
  const tot = Number(m[1]) * 60 + Number(m[2]);
  const fmt = (x) => { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  return { tee: fmt(tot), arrive: fmt(tot - prep), leave: fmt(tot - prep - commute) };
}

function commuteLine(teeTime, course) {
  const c = commuteInfo(teeTime);
  if (!c) return '';
  const crs = course ? ` (${String(course).toUpperCase()}코스)` : '';
  return `\n⛳ 티오프 ${c.tee}${crs} · ${c.arrive} 도착 · 집에서 ${c.leave} 출발`;
}

// ── Gemini 판정 프롬프트 (stateless: 이 글만 편견 없이 읽는다) ──
function buildPrompt(article, member = memberFromEnv()) {
  const { name, part } = member;
  const anchor = '';
  const hasImg = !!article.images?.length;
  const ts = Number(article.writeDate);
  const postedHour = Number.isFinite(ts) && ts > 1e12 ? new Date(ts).getHours() : null;
  const postedLine = postedHour != null
    ? `- 게시 시각: ${postedHour}시 (${postedHour >= 12 ? '정오 이후' : '정오 이전'})`
    : '';
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
- 첨부 이미지: ${hasImg ? '있음 — 배치표/번호표(순번·이름 목록 + 티오프 시간표)일 수 있으니 반드시 읽으세요.' : '없음 — 제목/본문 텍스트로만 판단.'}${kakaoNote}

[배경지식]
- 리버힐 캐디는 1·2·3부로 나뉘고 각 부는 완전 독립. "${name}"은 ${part}부만 관련(다른 부 내용은 무관).
- 부(部)별 티오프 시간대가 다름: 1부=오전 이른 시간(아웃/인 6~9시대), 2부=낮(대략 10~15시), ${part}부=티오프 **16시 이후**(저녁까지). 예) "아웃 7시33분"(오전)은 1부, "인 13시35분"(오후 1시대)은 2부이며 ${part}부 아님. **16시 이전 티오프는 절대 ${part}부가 아닙니다.**
- 배치표/번호표: 각 부 "순번·이름" 목록과 "OUT n부 IN" 티오프표(가운데=티오프 시간, OUT/IN=코스). 순번이 티오프 칸에 등록되면 그 사람 근무 확정.
- 배경색: 회색=스페어(대기), 흰색/색칠됨=근무 확정. 이름 옆 "(2,3)"·"(54)" 같은 숫자표기는 그 사람이 여러 부에 걸쳐 일한다는 표시(부 중복)라, 이름만으론 어느 부 소식인지 모호합니다(→ 시간대로 판단).
- "○○님까지 일됩니다/근무/나갑니다" = 그 사람까지(포함) 순번 근무 확정. 표현은 작성자마다 불규칙("나가요","콜","다근무","까지만" 등)해도 '뜻'으로 파악.
- 순번 교환: 이름 옆에 (54)/(2,3)이 아닌 '다른 사람 이름'이 붙으면 두 사람이 자리를 맞바꾼 것. 그 자리의 진짜 대기자는 '바뀐 사람'. "${name}"의 진짜 순번은 "${name}"이 실제 들어간 자리로 판단.
- 스페어 = 대기(당일 근무로 바뀔 수 있음, 휴무 아님). "가배치/임시배치"는 참고용이니 relevant=false 로.

[판단 기준]
- "${name}"의 ${part}부 순번/근무/출근에 영향을 주거나 전체 공지면 relevant=true.
- 다른 부만의 내용, 남의 개인 근태신청(내 이름 없음)은 relevant=false.
- "${name}"이 근무 확정(흰색이거나 티오프 배정)이면 "${name}"의 티오프 시간(HH:MM)과 코스(OUT/IN)를 읽으세요(교환됐으면 바뀐 자리 기준).
- "${name}"의 순번(myPosition)은 항상 읽으세요(이미지의 그 사람 번호).
- ★★teeTime엔 오직 "${name}" 본인이 배정된 티오프만 넣으세요. 취소·추가·변동·노쇼 글에서 언급된 '남'의 시간(예: "인 13시35분 취소 박진수님까지"의 13:35는 박진수 관련 시간)은 "${name}"의 티오프가 절대 아니므로 teeTime=null. "${name}" 자리의 시간이 확실할 때만 채우세요.
- ★★${part}부 티오프는 16시 이후입니다. 16시 이전 시간(예: 13:35)만 있는 글은 ${part}부가 아니라 다른 부이므로 "${name}"과 무관(relevant=false, part=해당 부/1·2).

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

★ 부(部) 판단 (지어내기 금지 — 이번 오류의 핵심):
- part 에 이 글이 몇 부에 관한 것인지 넣으세요: 제목/본문에 "1부/2부/3부" 명시가 있으면 그 숫자, 배치표 이미지나 티오프 시간대로 확실하면 그 숫자, 전혀 알 수 없으면 "unknown".
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
  "part3Roster": ["${part}부 전체 명단 이름들 — 전체 배치표일 때만, 아니면 []"],
  "crossPartNames": ["명단 중 여러 부 중복 표기((2,3)/(54)) 붙은 이름들, 없으면 []"],
  "subjectNames": ["이 소식의 핵심 인물 이름들, 없으면 []"],
  "teeGrid": [{ "pos": 정수, "time": "HH:MM", "course": "OUT 또는 IN" }],
  "category": "배치표|번호표|변동|추가|취소|시간조정|공지|개인근태|가배치|기타",
  "myCellColor": "white|colored|gray|unknown (${name} 이름칸 배경색 — 근무/스페어 판정 최우선 근거)",
  "myStatus": "work|assigned|your_turn|waiting|spare|off|unknown",
  "dateLabel": "예: 7월 14일 화요일 (모르면 빈칸)",
  "myPosition": 정수 또는 null,
  "cutoffAnnounced": true 또는 false (텍스트에 '○○까지' 명시 여부),
  "cutoffName": "명시된 커트라인 이름, 없으면 빈칸",
  "cutoffPosition": 정수 또는 null,
  "teamCount": "현재 ${part}부 예약 팀 수 정수 (예: '현재 3부 16팀'·'3부 16팀 운영' → 16). = 순번 그 번호까지 근무 확정을 뜻함. 다른 부 수치이거나 팀 수 언급 없으면 null",
  "teeTime": "김홍구 본인 배정 티오프 HH:MM(16시 이후·본인 자리일 때만). 남의 시간이거나 16시 이전이면 null",
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
    case 'near':      return '🔔 곧 출근 순번!';
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
  const TEE_MIN = Number(process.env.TEE_MIN_HOUR ?? 16); // 3부 티오프 하한(그 이전 시간은 3부 아님)
  // ★방어벽: 16시 이전 티오프만 있는 글은 남의 부(취소·변동 등)를 잘못 읽은 것 → 내 근무 아님 → 피드만.
  //  ("인 13시35분 취소 박진수님까지"를 김홍구 티오프로 오판하던 버그 차단)
  if (teeRaw && teeHour != null && teeHour < TEE_MIN) {
    return { relevant: false, push: 'low', status: 'unknown', verdict,
      title: '', body: verdict.summary || article.subject || '' };
  }
  const tee = teeRaw; // 여기 도달하면 16시 이후(또는 티오프 없음)

  if (tee) {
    // 티오프 배정 = 근무 확정. 산수(남은인원) 무시, 출근/출발 안내.
    status = status === 'your_turn' ? 'your_turn' : (status === 'work' ? 'work' : 'assigned');
    body = `${name}님, 오늘 근무 배정됐어요!${commuteLine(tee, verdict.course)}`;
  } else if (status === 'waiting' || status === 'near' || status === 'spare') {
    const mp = Number(verdict.myPosition), cp = Number(verdict.cutoffPosition);
    // 남은 인원은 '○○까지'가 텍스트에 명시됐을 때만 계산(지어낸 커트라인 방지).
    const announced = verdict.cutoffAnnounced && verdict.cutoffName
      && Number.isFinite(mp) && Number.isFinite(cp);
    if (announced) {
      const remaining = mp - cp - 1;
      const cut = ` (${verdict.cutoffName}님까지 근무)`;
      if (remaining < 0) { status = 'assigned'; body = `${name}님, 오늘 근무 배정됐어요!${cut}`; }
      else if (remaining === 0) { status = 'your_turn'; body = `${name}님, 지금 출근하실 차례예요!${cut}`; }
      else { status = remaining <= 2 ? 'near' : 'waiting'; body = `${name}님, 앞으로 ${remaining}명 남았어요${cut}`; }
    } else if (verdict.cutoffAnnounced && verdict.cutoffName) {
      // 커트라인 이름은 명시됐지만 위치를 몰라(텍스트만) 정확한 N명 계산 불가 → 공지는 전달.
      status = 'spare';
      const pos = Number.isFinite(mp) ? ` (내 순번 ${mp}번)` : '';
      body = `${verdict.cutoffName}님까지 근무 확정 소식이에요${pos}. 내 차례 근접 여부 확인해보세요`;
    } else {
      // 명시 커트라인 없음 → 지어내지 않고 '스페어 대기'만 정직하게 알림.
      status = 'spare';
      const pos = Number.isFinite(mp) ? ` (순번 ${mp}번)` : '';
      body = `${name}님, ${verdict.dateLabel || '오늘'} ${member.part}부 스페어 대기${pos}입니다.`;
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
    const teeMin = Number(process.env.TEE_MIN_HOUR ?? 16);
    const timeSays3 = (teeH != null && teeH >= teeMin) || (teeH == null && hour != null && hour >= 14);
    if (!timeSays3) {
      verdict.relevant = false;
      verdict._rosterDrop = '부-중복 인물 + 3부 시간대(14시~) 아님';
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

function resolveTeeByGrid(verdict) {
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
    const plausible = modelTee && teeHour != null && teeHour >= Number(process.env.TEE_MIN_HOUR ?? 16);
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
function teeForPosition(raw, pos) {
  if (!raw) return '';
  const v = { ...raw, myPosition: pos };
  resolveTeeByGrid(v);
  const th = (String(v.teeTime || '').match(/(\d{1,2}):/) || [])[1];
  if (th != null && Number(th) < Number(process.env.TEE_MIN_HOUR ?? 16)) return '';
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

// 순수 표결: 여러 raw 읽기 → 합의 verdict 하나(불확실이면 _uncertain). I/O 없음(테스트 용이).
export function consensusFromReads(reads) {
  const rs = (reads || []).filter(Boolean);
  if (!rs.length) return null;
  if (rs.length === 1) return rs[0]; // 1회만 성공 → 표결 불가, 단일 판독 그대로
  const posOf = (r) => (Number(r?.myPosition) > 0 ? Number(r.myPosition) : null);

  const TEE_MIN = Number(process.env.TEE_MIN_HOUR ?? 16);
  // ★각 읽기의 '결론'을 뽑는다 — 판단의 핵심은 순번 '숫자'가 아니라 "일하나/스페어냐, 근무면 몇 시냐".
  //  순번이 판독마다 조금 흔들려도 결론(스페어)이 같으면 확실한 것 → 불필요한 '불확실' 경보를 없앤다.
  const concl = rs.map((r) => {
    const c = { ...r };
    resolveTeeByGrid(c);                     // 각 읽기를 자기 순번 기준으로 해석
    const tee = (String(c.teeTime || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    const th = tee ? Number(tee.split(':')[0]) : null;
    const teeOk = !!tee && th != null && th >= TEE_MIN;
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

  resolveTeeByGrid(v);       // 합의 순번으로 티오프표 최종 해석
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
      if (pa && pa === posOf(b) && teeForPosition(a, pa) === teeForPosition(b, pa)) break;
    }
  }
  return consensusFromReads(reads);
}

export async function judge(article, today = null, member = memberFromEnv()) {
  const img = article.images?.[0] || null;
  const isBoard = !!img && /배치표|시간표|번호표/.test(article.subject || '');
  // ★배치표(이미지)는 여러 번 읽어 '표결'(신뢰도↑·정직한 불확실). 텍스트/카톡/일반 글은 1회(기본 모델).
  let verdict = isBoard
    ? await readBoardConsensus(article, member)
    : await callGeminiJSON(buildPrompt(article, member), img, null);
  // 합의 판독(_resolved)은 이미 표결 안에서 순번→티오프 확정 + 결론기준 불확실 판정을 마쳤다.
  //  그걸 다시 resolveTeeByGrid 하면 구조적 잡음(행번호매기기 등)이 '불확실'로 재주입되므로 건너뛴다.
  if (!verdict?._resolved) resolveTeeByGrid(verdict);
  // ★3부 티오프 하한 가드: 16시 미만 '티오프'는 무효(취소·남의 시간 오독) → 근무 배정 알림 방지.
  if (verdict) {
    const th = (String(verdict.teeTime || '').match(/(\d{1,2}):/) || [])[1];
    if (th != null && Number(th) < Number(process.env.TEE_MIN_HOUR ?? 16)) {
      verdict.teeTime = ''; verdict.course = '';
      if (['assigned', 'work', 'your_turn'].includes(verdict.myStatus)) verdict.myStatus = 'spare';
    }
  }
  if (verdict && !(Number(verdict.myPosition) > 0)
      && today && today.myPosition
      && today.date && verdict.dateLabel && today.date === verdict.dateLabel) {
    verdict.myPosition = today.myPosition; // 잠긴 순번 보완(0·실패값이면 오늘 순번으로)
  }
  // ★"현재 3부 N팀" 팀 수 보정: Gemini가 놓쳤으면 코드가 추출(내 부 한정). = 실시간 확정선.
  //  1) 부 표기 있는 'N부 N팀'(엄격) → 2) 없으면 3부 문맥의 순수 'N팀'(정용만님 실시간 관례) 보정.
  if (verdict && !(Number(verdict.teamCount) > 0)) {
    const blob = `${article.subject || ''}\n${article.text || article.contentText || article.content || ''}`;
    let tc = extractTeamCount(blob, member);
    if (!tc) tc = extractBareTeamCount(article.subject, article.text || article.contentText || article.content, member);
    if (tc) { verdict.teamCount = tc; if (!verdict.relevant) verdict.relevant = true; }
  }
  applyRoster(verdict, today, article, member);    // 3부 명단 화이트리스트 정밀 필터
  return { ...decide(article, verdict, member), rawVerdict: verdict };
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
    category: shared.category,
    dateLabel: shared.dateLabel,
    cutoffAnnounced: shared.cutoffAnnounced,
    cutoffName: shared.cutoffName,
    cutoffPosition: shared.cutoffPosition,
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
  resolveTeeByGrid(v);                    // 순번→티오프(구조·beyond-cut 스페어 등)
  const th = (String(v.teeTime || '').match(/(\d{1,2}):/) || [])[1];
  if (th != null && Number(th) < Number(process.env.TEE_MIN_HOUR ?? 16)) { v.teeTime = ''; v.course = ''; }
  applyRoster(v, today, article, member);
  return { ...decide(article, v, member), rawVerdict: v };
}
