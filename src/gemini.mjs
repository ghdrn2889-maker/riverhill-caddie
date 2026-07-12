// 무료 Gemini(비전)로 카페 이미지를 읽어 '김홍구님 기준' 으로 번역한다.
//  - analyzeTurn:     '당일 변동사항' → 순번 계산 (앞으로 몇 명 남았는지)
//  - analyzeSchedule: '배치표'        → 오늘/내일 내가 근무인지 스페어인지
// 키(GEMINI_API_KEY)가 없거나 실패하면 null 을 돌려주고, 서버는 제목 알림으로 폴백한다.

async function fetchImageBase64(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://cafe.naver.com/',
    },
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
      });
      if (!res.ok) {
        console.error(`[gemini] HTTP ${res.status} (시도 ${attempt})`, (await res.text()).slice(0, 200));
        continue;
      }
      const data = await res.json();
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) { console.error(`[gemini] 빈 응답 (시도 ${attempt})`); continue; }
      return JSON.parse(txt);
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

// ── 2) 배치표 → 내가 근무인지 스페어인지 ─────────────────────
function buildSchedulePrompt(article, name, part) {
  return `당신은 골프장 캐디 배치표(배치 시간표)를 읽는 도우미입니다.
대상 캐디: 이름 "${name}", ${part}부 소속.

아래는 특정 날짜의 '배치표' 게시글입니다.
- 글 제목: "${article.subject}"
- 첨부 이미지: 그 날짜의 캐디 배치표입니다. 보통 부(部)/팀(조)/티오프 시간별로 근무 캐디가 적혀 있고,
  스페어(대기) 캐디는 '스페어' 또는 '대기' 칸에 따로 순서대로 적혀 있습니다.

이미지에서 "${name}"을 찾아, 그 날 "${name}"의 상태를 판단해 JSON "하나만" 출력하세요(설명 금지):
{
  "found": true 또는 false,
  "role": "work|spare|off|unknown",
  "part": "문자열 또는 빈칸",
  "team": "문자열 또는 빈칸",
  "teeTime": "문자열 또는 빈칸",
  "spareOrder": 정수 또는 null,
  "dateLabel": "문자열 또는 빈칸",
  "status": "work|spare|off|unknown",
  "message": "${name}님 기준 한국어 한 문장"
}
role/status 기준:
- 팀/시간에 배정되어 근무 → "work"
- 스페어(대기) 목록에 있음 → "spare"
- 배치표에 근무도 스페어도 없음(휴무 등) → "off"
- 못 찾음 → "unknown"
(role 과 status 는 같은 값으로 채우세요.)
dateLabel 은 제목/이미지의 날짜를 그대로 (예: "7월 13일 월요일").
message 예:
- work:  "${name}님, 7월 13일 3부 5팀 07:20 근무입니다"
- spare: "${name}님, 7월 13일 스페어(대기) 2번입니다"
- off:   "${name}님, 7월 13일 배치표에 근무가 없어요"`;
}

// 반환: {found, role, part, team, teeTime, spareOrder, dateLabel, status, message} 또는 null
export async function analyzeSchedule(article) {
  if (!article.images?.length) return null;
  const { name, part } = nameAndPart();
  return callGeminiJSON(buildSchedulePrompt(article, name, part), article.images[0]);
}
