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

// ── Gemini 판정 프롬프트 ─────────────────────────────────
function buildPrompt(article, baseline) {
  const { name, part } = profile();
  const anchor = baseline && (baseline.role || baseline.part)
    ? `\n[오늘 기준표 참고] "${name}"은 ${baseline.part || part + '부'} 소속, 오늘 상태 "${baseline.role || '미상'}"(${baseline.date || ''}). 이 글에서도 "${name}"을 찾아 판단하세요.`
    : '';
  const hasImg = !!article.images?.length;
  return `당신은 골프장 캐디 "${name}"(${part}부)의 개인 비서입니다.
아래 네이버 카페 글이 "${name}"님에게 어떤 의미인지 판단하세요.${anchor}

[글]
- 제목: ${article.subject || ''}
- 게시판: ${article.menuName || ''}
- 작성자: ${article.writer || ''}
- 본문: ${(article.text || '').slice(0, 600)}
- 첨부 이미지: ${hasImg ? '있음 — 배치표/번호표(순번·이름 목록 + 티오프 시간표)일 수 있으니 반드시 읽으세요.' : '없음 — 제목/본문 텍스트로만 판단.'}

[배경지식]
- 리버힐 캐디는 1·2·3부로 나뉘고 각 부는 완전 독립. "${name}"은 ${part}부만 관련(다른 부 내용은 무관).
- 배치표/번호표: 각 부 "순번·이름" 목록과 "OUT n부 IN" 티오프표(가운데=티오프 시간, OUT/IN=코스). 순번이 티오프 칸에 등록되면 그 사람 근무 확정.
- 배경색: 회색=스페어(대기), 흰색/녹색(54)/하늘색(2,3)=근무 확정.
- "○○님까지 일됩니다/근무/나갑니다" = 그 사람까지(포함) 순번 근무 확정. 표현은 작성자마다 불규칙("나가요","콜","다근무","까지만" 등)해도 '뜻'으로 파악.
- 순번 교환: 이름 옆에 (54)/(2,3)이 아닌 '다른 사람 이름'이 붙으면 두 사람이 자리를 맞바꾼 것. 그 자리의 진짜 대기자는 '바뀐 사람'. "${name}"의 진짜 순번은 "${name}"이 실제 들어간 자리로 판단.
- 스페어 = 대기(당일 근무로 바뀔 수 있음, 휴무 아님). "가배치/임시배치"는 참고용이니 relevant=false 로.

[판단 기준]
- "${name}"의 ${part}부 순번/근무/출근에 영향을 주거나 전체 공지면 relevant=true.
- 다른 부만의 내용, 남의 개인 근태신청(내 이름 없음)은 relevant=false.
- "${name}"이 근무 확정(흰색이거나 티오프 배정)이면 "${name}"의 티오프 시간(HH:MM)과 코스(OUT/IN)를 읽으세요(교환됐으면 바뀐 자리 기준).
- "${name}"이 대기(회색)면 myPosition 과 커트라인(마지막 근무확정)의 cutoffName/cutoffPosition 을 읽으세요(남은 인원 계산은 시스템이 함).

반드시 JSON "하나만" 출력(설명·코드펜스 금지):
{
  "relevant": true 또는 false,
  "category": "배치표|번호표|변동|추가|취소|시간조정|공지|개인근태|가배치|기타",
  "myStatus": "work|assigned|your_turn|waiting|spare|off|unknown",
  "dateLabel": "예: 7월 14일 화요일 (모르면 빈칸)",
  "myPosition": 정수 또는 null,
  "cutoffName": "커트라인 사람 이름 또는 빈칸",
  "cutoffPosition": 정수 또는 null,
  "teeTime": "HH:MM 또는 null",
  "course": "OUT 또는 IN 또는 빈칸",
  "note": "시간 변동 가능/취소/조정 등 주의사항 한 문장, 없으면 빈칸",
  "confidence": 0.0~1.0 실수,
  "summary": "${name}님 기준 한국어 한 문장"
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
  const { name } = profile();
  if (!verdict) {
    // Gemini 실패 → 일정글이면 '확인필요' 알림(놓침 방지), 아니면 피드만.
    return { relevant: true, push: 'check', status: 'unknown', verdict: null,
      title: '🏌️ 새 일정글 — 직접 확인', body: `${article.subject || ''} (자동 판독 실패, 눌러서 확인)` };
  }
  if (verdict.category === '가배치') {
    return { relevant: false, push: 'low', status: 'unknown', verdict, title: '', body: article.subject || '' };
  }
  if (!verdict.relevant) {
    // 나와 무관 → 피드에만 남김(데이터는 안 버림), 푸시 안 함.
    return { relevant: false, push: 'low', status: verdict.myStatus || 'unknown', verdict,
      title: '', body: verdict.summary || article.subject || '' };
  }

  // 관련 있음 → 상태별 문구 구성 (산수는 코드).
  let status = verdict.myStatus || 'unknown';
  let body = verdict.summary || article.subject || '';
  const tee = verdict.teeTime && /\d{1,2}:\d{2}/.test(verdict.teeTime) ? verdict.teeTime : null;

  if (tee) {
    // 티오프 배정 = 근무 확정. 산수(남은인원) 무시, 출근/출발 안내.
    status = status === 'your_turn' ? 'your_turn' : (status === 'work' ? 'work' : 'assigned');
    body = `${name}님, 오늘 근무 배정됐어요!${commuteLine(tee, verdict.course)}`;
  } else if (status === 'waiting' || status === 'near' || status === 'spare') {
    const mp = Number(verdict.myPosition), cp = Number(verdict.cutoffPosition);
    if (Number.isFinite(mp) && Number.isFinite(cp)) {
      const remaining = mp - cp - 1;
      const cut = verdict.cutoffName ? ` (${verdict.cutoffName}님까지 근무)` : '';
      if (remaining < 0) { status = 'assigned'; body = `${name}님, 오늘 근무 배정됐어요!${cut}`; }
      else if (remaining === 0) { status = 'your_turn'; body = `${name}님, 지금 출근하실 차례예요!${cut}`; }
      else { status = remaining <= 2 ? 'near' : 'waiting'; body = `${name}님, 앞으로 ${remaining}명 남았어요${cut}`; }
    } else if (status === 'spare') {
      body = `${name}님, ${verdict.dateLabel || '오늘'} ${profile().part}부 스페어(대기)입니다. 순번 오면 바로 알려드릴게요`;
    }
  } else if (status === 'off') {
    body = `${name}님, ${verdict.dateLabel || '오늘'} 휴무입니다. 편히 쉬세요`;
  }

  if (verdict.note && String(verdict.note).trim()) body += `\n⚠️ ${String(verdict.note).trim()}`;

  // 확신도 낮으면 '확인필요'로 낮춤(틀린 단정 방지, 그래도 알림은 감).
  const push = (Number(verdict.confidence) || 0) < 0.4 ? 'check' : 'high';
  const title = push === 'check' ? '🏌️ 3부 소식 — 확인' : titleFor(status);
  return { relevant: true, push, status, verdict, title, body };
}

// 글 → Gemini 판정 → 최종 결정. { relevant, push, title, body, status, verdict }
export async function judge(article, baseline = null) {
  const img = article.images?.[0] || null;
  const verdict = await callGeminiJSON(buildPrompt(article, baseline), img);
  return { ...decide(article, verdict), rawVerdict: verdict };
}
