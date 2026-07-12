// 무료 Gemini(비전)로 카페 이미지를 읽어 '김홍구님 기준' 으로 번역한다.
//  - analyzeTurn:     '당일 변동사항' → 순번 계산 (앞으로 몇 명 남았는지)
//  - analyzeSchedule: '배치표'        → 오늘/내일 내가 근무인지 스페어인지
// 키(GEMINI_API_KEY)가 없거나 실패하면 null 을 돌려주고, 서버는 제목 알림으로 폴백한다.

// Gemini가 JSON 앞뒤에 코드펜스나 잡텍스트를 붙여도 첫 번째 완전한 {…} 만 뽑아 파싱.
function parseJSONLoose(txt) {
  let s = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{');
  if (start === -1) throw new Error('JSON 객체를 찾지 못함');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('JSON 괄호가 안 맞음');
}

async function fetchImageBase64(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://cafe.naver.com/',
    },
    signal: AbortSignal.timeout(15000),   // 15초 넘으면 중단 (무한 대기 방지)
  });
  if (!res.ok) throw new Error(`이미지 다운로드 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'image/png';
  return { data: buf.toString('base64'), mime };
}

// 프롬프트 + 이미지 → Gemini 호출 → JSON 파싱 (2회 재시도). 실패 시 null.
async function callGeminiJSON(promptText, imageUrl) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!imageUrl) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  let img;
  try {
    img = await fetchImageBase64(imageUrl);
  } catch (e) {
    console.error('[gemini] 이미지 로드 실패:', e.message);
    return null;
  }

  const body = {
    contents: [{
      parts: [
        { text: promptText },
        { inline_data: { mime_type: img.mime, data: img.data } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const ATTEMPTS = 2;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),   // 30초 넘으면 중단 후 재시도
      });
      if (!res.ok) {
        console.error(`[gemini] HTTP ${res.status} (시도 ${attempt})`, (await res.text()).slice(0, 200));
        continue;
      }
      const data = await res.json();
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) { console.error(`[gemini] 빈 응답 (시도 ${attempt})`); continue; }
      return parseJSONLoose(txt);
    } catch (e) {
      console.error(`[gemini] 실패 (시도 ${attempt}):`, e.message);
    }
  }
  return null;
}

function nameAndPart() {
  return {
    name: (process.env.MY_NAME || '김홍구').trim(),
    part: (process.env.MY_PART || '3').trim(),
  };
}

// ── 1) 당일 변동사항 → 순번 계산 ─────────────────────────────
function buildTurnPrompt(article, name, part) {
  return `당신은 골프장 캐디 근무 배정을 분석하는 도우미입니다.
대상 캐디: 이름 "${name}", ${part}부 소속.

아래는 오늘 '당일 변동사항' 게시글입니다.
- 글 제목: "${article.subject}"
- 첨부 이미지: ${part}부 캐디 "대기 순번" 목록(위에서 아래로 순서)일 가능성이 높습니다.

배경 지식: 제목의 "○○님까지 일됩니다"는 순번상 그 사람까지 근무가 배정됐다는 뜻입니다.
대기 순번에서 배정 커트라인이 "${name}"에 도달하거나 지나면 "${name}"도 근무하러 나가야 합니다.

★ 배경색 규칙 — 각 사람 이름 칸의 배경색:
- '흰색(white)' = 번호표를 받아 이미 '출근 확정(근무 배정)'된 사람.
- '회색(gray)'  = 아직 배정 안 된 '스페어(대기)' 사람.
"${name}" 칸이 흰색이면 이미 배정된 것이고(status "assigned"), 회색이면 아직 대기 중입니다.
회색이라면 커트라인(마지막 흰색)에서 "${name}"까지 남은 인원을 세어 remaining 을 구하세요.

이미지와 제목을 함께 보고 아래를 계산해, 반드시 JSON "하나만" 출력하세요(설명 금지):
{
  "found": true 또는 false,
  "myPosition": 정수 또는 null,
  "cutoffName": "문자열 또는 빈칸",
  "cutoffPosition": 정수 또는 null,
  "remaining": 정수 또는 null,
  "status": "assigned|your_turn|near|waiting|unknown",
  "message": "${name}님 기준 한국어 한 문장 요약"
}
status 기준:
- 커트라인이 ${name}을 이미 지남(배정됨) → "assigned"
- ${name}이 바로 다음 차례(remaining 0) → "your_turn"
- remaining 1~2 → "near"
- remaining 3 이상 → "waiting"
- 못 찾음 → "unknown"
message 예: "${name}님, 앞으로 2명 남았어요 (도대영님까지 배정됨)" / "${name}님, 출근 순번으로 변동됐어요" / "${name}님 지금 나가실 차례예요".`;
}

// 반환: {found, myPosition, cutoffName, cutoffPosition, remaining, status, message} 또는 null
export async function analyzeTurn(article) {
  if (!article.images?.length) return null;
  const { name, part } = nameAndPart();
  return callGeminiJSON(buildTurnPrompt(article, name, part), article.images[0]);
}

// ── 2) 배치표 → 내가 근무인지 스페어인지 (정확한 순번은 계산하지 않음) ──
function buildSchedulePrompt(article, name, part) {
  return `당신은 골프장 캐디 배치표(배치 시간표)를 읽는 도우미입니다.
대상 캐디: 이름 "${name}", ${part}부 소속.

아래는 특정 날짜의 '배치표' 게시글입니다.
- 글 제목: "${article.subject}"
- 첨부 이미지: 1~3부 시간표와 조 배치가 함께 담긴 표입니다. "${name}"은 보통 조 배치표 안에
  이름과 함께 근무 표시(예: "${part}부", "휴무", "당번" 등)로 나타납니다.

목표는 딱 하나 — 그 날 "${name}"이 (1) 근무 배정인지 (2) 스페어(대기)인지 (3) 없는지 판단하는 것.
정확한 대기 '순번'은 계산하지 마세요(이 표로는 부정확함). 근무 여부만 판단하면 됩니다.

판별 기준:
- 이름 옆/칸에 "${part}부" 같은 대기 표시가 있고 특정 팀/시간에 배정돼 있지 않다 → "spare"(스페어/대기)
- 특정 조·팀·티오프 시간에 배정되어 실제 라운드를 도는 것으로 보인다 → "work"(근무)
- "휴무"로 표시되거나 표에서 "${name}"을 찾을 수 없다 → "off"

반드시 JSON "하나만" 출력하세요(설명 금지):
{
  "found": true 또는 false,
  "role": "work|spare|off|unknown",
  "part": "문자열 또는 빈칸",
  "team": "문자열 또는 빈칸",
  "teeTime": "문자열 또는 빈칸",
  "dateLabel": "문자열 또는 빈칸",
  "status": "work|spare|off|unknown",
  "message": "${name}님 기준 한국어 한 문장(순번 숫자는 넣지 말 것)"
}
(role 과 status 는 같은 값으로 채우세요.)
dateLabel 은 제목/이미지의 날짜를 그대로 (예: "7월 13일 월요일").
message 에는 순번 숫자를 넣지 마세요. (정확한 순번은 당일 번호표에서 따로 계산함)
message 예:
- work:  "${name}님, 7월 13일 ${part}부 근무(출근 확정)입니다"
- spare: "${name}님, 7월 13일 ${part}부 스페어(대기)입니다"
- off:   "${name}님, 7월 13일 배치표에 근무가 없어요(휴무/미포함)"`;
}

// 반환: {found, role, part, team, teeTime, spareOrder, dateLabel, status, message} 또는 null
export async function analyzeSchedule(article) {
  if (!article.images?.length) return null;
  const { name, part } = nameAndPart();
  return callGeminiJSON(buildSchedulePrompt(article, name, part), article.images[0]);
}
