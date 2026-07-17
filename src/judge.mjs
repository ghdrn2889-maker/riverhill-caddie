// 통합 판단기(새 두뇌).
//  글 하나(제목+본문+이미지) + 내 프로필 + 오늘 기준표 → 구조화된 판정 '하나'.
//  흩어진 정규식 게이트(부·커트라인·시간·이름) 대신 여기 한 곳에서 의미로 판단한다.
//  원칙: Gemini는 '읽기'(위치/여부/티오프)만, 남은인원·출근시간 '산수'는 코드가(정확도).
import { callGeminiJSON } from './gemini.mjs';

function profile() {
  return {
    name: (process.env.MY_NAME || '김홍구').trim(),
    part: (process.env.MY_PART || '3').trim(),
  };
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
function buildPrompt(article) {
  const { name, part } = profile();
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
export function decide(article, verdict) {
  const { name, part: myPart } = profile();
  if (!verdict) {
    // Gemini 실패 → 일정글이면 '확인필요' 알림(놓침 방지), 아니면 피드만.
    return { relevant: true, push: 'check', status: 'unknown', verdict: null,
      title: '🏌️ 새 일정글 — 직접 확인', body: `${article.subject || ''} (자동 판독 실패, 눌러서 확인)` };
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
      body = `${name}님, ${verdict.dateLabel || '오늘'} ${profile().part}부 스페어 대기${pos}입니다. 아직 근무 확정 전 — 확정되면 바로 알려드릴게요`;
    }
  } else if (status === 'off') {
    body = `${name}님, ${verdict.dateLabel || '오늘'} 휴무입니다. 편히 쉬세요`;
  }

  if (verdict.note && String(verdict.note).trim()) body += `\n⚠️ ${String(verdict.note).trim()}`;

  // 확신도 낮거나 교차검증 불일치면 '확인필요'로 낮춤(틀린 단정 방지, 그래도 알림은 감).
  let push = (Number(verdict.confidence) || 0) < 0.4 ? 'check' : 'high';
  if (verdict._uncertain) { push = 'check'; body = `⚠️ 판독이 불확실합니다 — 원문을 꼭 확인하세요.\n${body}`; }
  const title = push === 'check' ? '🏌️ 3부 소식 — 확인' : titleFor(status);
  return { relevant: true, push, status, verdict, title, body };
}

// ── 오늘 3부 명단(화이트리스트) 기반 정밀 필터 ──────────────
//  본배치표에서 뽑아둔 today.roster3(3부 이름들)로, 이후 짧은 소식을 이름으로 거른다.
//  · 부가 이미 판정된 글(part 1/2/3 명시·시간대)엔 개입하지 않음(모호할 때만 작동).
//  · 대상 인물이 3부 명단에 없으면 → 내 부 아님(피드만).
//  · 명단에 있으나 '부 중복'인 사람뿐이면 → 시간대(14시~ or 티오프 14시~)로 판정.
export function applyRoster(verdict, today, article) {
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
    verdict._rosterDrop = `대상(${names.join(',')})이 ${(process.env.MY_PART || '3').trim()}부 명단에 없음`;
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
  verdict.part = (process.env.MY_PART || '3').trim();    // 명단 확인 → 내 부로 확정
  verdict.rosterConfirmed = true;
}

// 글 → Gemini가 '편견 없이' 판정(stateless) → 최종 결정. { relevant, push, title, body, status, rawVerdict }
//  today 는 프롬프트에 넣지 않는다(이전 상태가 판독을 오염시키지 않게).
//  단, 텍스트만 있어 순번을 못 읽었으면 '같은 날 잠긴 순번'으로만 코드가 채운다(안전한 보완).
// 배치표 이미지인데 순번도 티오프도 못 읽으면 '부실 판독'(비전 불안정) → 재시도 대상.
function weakBoardRead(v) {
  if (!v) return true;
  const posOk = Number(v.myPosition) > 0;
  const teeOk = v.teeTime && /\d{1,2}:\d{2}/.test(v.teeTime);
  return !posOk && !teeOk;
}

// ★코드가 3부 티오프 표(teeGrid)에서 김홍구 순번으로 티오프를 확정(모델의 눈대중 대신).
//  · 순번이 표에 있으면 → 그 시간이 김홍구 티오프(근무 배정).
//  · 순번이 표에 없으면 → 스페어(모델이 붙인 티오프 제거). 모델이 근무라 우겼으면 '확인 필요'.
// 표 판독이 '행 순서대로 번호 매기기' 실패인지 감지: 순번이 1,2,3,4…로 완전 순차이거나 코스가 전부 동일하면 의심.
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
    // 순번이 표에 없음. ★배경색이 근무(흰색/색칠)면 스페어로 강등하지 않는다(티오프 매칭 대기 or 표 누락).
    const modelTee = (String(verdict.teeTime || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    const teeHour = modelTee ? Number(modelTee.split(':')[0]) : null;
    const plausible = modelTee && teeHour != null && teeHour >= Number(process.env.TEE_MIN_HOUR ?? 16);
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

export async function judge(article, today = null) {
  const img = article.images?.[0] || null;
  const isBoard = !!img && /배치표|시간표|번호표/.test(article.subject || '');
  // ★배치표(이미지) 판독만 강한 모델(GEMINI_BOARD_MODEL) 사용 — 조밀한 티오프 표 정확도↑, 비용은 소액.
  //  텍스트/카톡/일반 글은 기본 모델(flash-lite) 유지.
  const boardModel = isBoard ? (process.env.GEMINI_BOARD_MODEL || null) : null;
  let verdict = await callGeminiJSON(buildPrompt(article), img, boardModel);
  // ★배치표 판독이 부실하면(순번·티오프 실패) 최대 2회 재시도 — 비전 불안정으로
  //  최신 배치표를 놓치거나 pos=0 같은 실패값이 나오던 문제 완화.
  for (let tries = 0; isBoard && weakBoardRead(verdict) && tries < 2; tries++) {
    const retry = await callGeminiJSON(buildPrompt(article), img, boardModel);
    if (retry) verdict = retry;
    if (retry && !weakBoardRead(retry)) break;
  }
  resolveTeeByGrid(verdict); // 코드가 순번→티오프 확정(눈대중 오독 차단)

  // ★티오프(근무 배정)가 읽힌 배치표는 교차검증: 한 번 더 읽어(표 기준) 티오프·순번이 다르면 '확인 필요'.
  //  (17:56을 17:46으로 확신에 차서 보내던 오답 방지 — 가장 위험한 '시간 단정'만 이중확인)
  const teeOf = (v) => (String(v?.teeTime || '').match(/\d{1,2}:\d{2}/) || [''])[0];
  if (isBoard && teeOf(verdict)) {
    const v2 = await callGeminiJSON(buildPrompt(article), img, boardModel);
    if (v2) {
      resolveTeeByGrid(v2);
      const posOf = (v) => (Number(v?.myPosition) > 0 ? Number(v.myPosition) : '');
      if (teeOf(v2) !== teeOf(verdict) || posOf(v2) !== posOf(verdict)) {
        verdict._uncertain = `판독 불일치(1차 순번${posOf(verdict) || '-'}/티오프${teeOf(verdict) || '-'} ↔ 2차 순번${posOf(v2) || '-'}/티오프${teeOf(v2) || '-'})`;
      }
    }
  }
  if (verdict && !(Number(verdict.myPosition) > 0)
      && today && today.myPosition
      && today.date && verdict.dateLabel && today.date === verdict.dateLabel) {
    verdict.myPosition = today.myPosition; // 잠긴 순번 보완(0·실패값이면 오늘 순번으로)
  }
  applyRoster(verdict, today, article);    // 3부 명단 화이트리스트 정밀 필터
  return { ...decide(article, verdict), rawVerdict: verdict };
}
