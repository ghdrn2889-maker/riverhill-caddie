// 구두/카톡 메시지 → 구조화된 '변경셋' 추출(범용).
//  정규식(judge codetext)이 이미 잘 잡는 컷/팀수 외에, 정규식-per-케이스로는 끝없이 놓치는
//  순번교환(대바)·당추·휴무/취소·개인 티오프변경을 '어떤 표현이든' 클로드가 구조화한다.
//  ★설계: 섀도우 우선(로그만) → 모니터 대조로 검증 → 칠판 이벤트로 스위치. 회원 경로 무영향.
//  ★비용: 클로드는 MAX 구독 정액(종량제 아님) + 하루 캡. 관련 메시지에만 1회 호출(잡담은 호출 안 함).
import { runClaudeText } from './claudereader.mjs';

// 클로드 응답 텍스트에서 첫 JSON 객체를 관대하게 파싱(코드펜스·설명 섞여도).
function parseJsonLoose(s) {
  const t = String(s || '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const normTime = (t) => {
  const m = String(t || '').match(/(\d{1,2})\s*[:：]?\s*(\d{2})/);
  if (!m) return '';
  return `${String(Math.min(23, Number(m[1]))).padStart(2, '0')}:${m[2]}`;
};
const normCourse = (c) => {
  const t = String(c || '').toUpperCase();
  if (t.includes('IN') || t.includes('인')) return 'IN';
  if (t.includes('OUT') || t.includes('아웃')) return 'OUT';
  return '';
};
const normName = (n) => String(n || '').replace(/\([^)]*\)/g, '').replace(/[\s0-9]/g, '').trim();

function buildPrompt(text, roster) {
  const names = (Array.isArray(roster) ? roster : []).map(normName).filter((x) => x.length >= 2);
  const rosterHint = names.length ? `\n오늘 3부 명단(이름 표준화 참고): ${names.join(', ')}` : '';
  return `골프장 캐디 배치표의 '구두 변동' 메시지를 구조화하는 파서입니다.
아래 메시지에서 배치표 변경만 뽑아 JSON 하나로만 출력하세요(설명·코드펜스 금지). 해당 없으면 0/빈배열.
규칙:
- cut: "N팀"·"N번까지 근무" = 근무확정선(정수). 없으면 0.
- tees: 특정 이름의 티오프 지정/변경. time="HH:MM", course="OUT"|"IN"|"".
- swaps: 순번 맞교환("A랑 B 바꿔"/"A B 순번 교환"). a,b=이름.
- adds: 당일추가(당추) 새 티오프 삽입. time,course.
- duties: 근태/취소. type="휴무"|"휴가"|"병가"|"취소"|"조출"|"후출".
- part: 몇 부(1|2|3), 불명확하면 null.
스키마:
{"part":null,"cut":0,"tees":[],"swaps":[],"adds":[],"duties":[]}${rosterHint}
메시지: """${String(text).slice(0, 500)}"""`;
}

// 관련 메시지에서 변경셋 추출. 실패·비관련이면 null(절대 throw 안 함).
export async function extractChangeSet(text, { roster = [] } = {}) {
  try {
    const raw = await runClaudeText(buildPrompt(text, roster));
    if (!raw) return null;
    const j = parseJsonLoose(raw);
    if (!j) return null;
    const cs = {
      part: [1, 2, 3].includes(Number(j.part)) ? Number(j.part) : null,
      cut: Number(j.cut) > 0 ? Number(j.cut) : 0,
      tees: (Array.isArray(j.tees) ? j.tees : []).map((x) => ({ name: normName(x.name), time: normTime(x.time), course: normCourse(x.course) })).filter((x) => x.name && x.time),
      swaps: (Array.isArray(j.swaps) ? j.swaps : []).map((x) => ({ a: normName(x.a), b: normName(x.b) })).filter((x) => x.a && x.b),
      adds: (Array.isArray(j.adds) ? j.adds : []).map((x) => ({ time: normTime(x.time), course: normCourse(x.course) })).filter((x) => x.time),
      duties: (Array.isArray(j.duties) ? j.duties : []).map((x) => ({ name: normName(x.name), type: String(x.type || '').trim() })).filter((x) => x.name && x.type),
    };
    const empty = !cs.cut && !cs.tees.length && !cs.swaps.length && !cs.adds.length && !cs.duties.length;
    return empty ? { ...cs, _empty: true } : cs;
  } catch (e) { console.error('[changeset] 추출 오류:', e.message); return null; }
}

// 변경셋이 '뭐라도 담고 있나'(비어있지 않나).
export function changeSetHasContent(cs) {
  return !!(cs && !cs._empty && (cs.cut || cs.tees?.length || cs.swaps?.length || cs.adds?.length || cs.duties?.length));
}
