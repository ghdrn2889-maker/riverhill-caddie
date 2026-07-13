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

function roleKorean(role) {
  return role === 'spare' ? '스페어(대기)'
    : role === 'work' ? '출근 확정(근무)'
    : role === 'off' ? '휴무/미포함' : '미상';
}

// ── 1) 당일 변동사항 → 순번 계산 ─────────────────────────────
function buildTurnPrompt(article, name, part, baseline) {
  const anchor = (baseline && (baseline.role || baseline.part)) ? `
[오늘 배치표 기준 참고 — 이걸 앵커로 삼으세요]
- "${name}"은 ${baseline.part || `${part}부`} 소속이고, 오늘 배치표상 상태는 "${roleKorean(baseline.role)}"입니다.
- 따라서 이 번호표에서 반드시 "${name}"을 찾아 순번을 판단하세요. 이미지에 "${name}"이 없으면 found=false.
` : '';
  return `당신은 골프장 캐디 근무 배정을 분석하는 도우미입니다.
대상 캐디: 이름 "${name}", ${part}부 소속.
${anchor}
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
  "nameList": ["번호표에 적힌 이름을 순번(위→아래) 순서대로 전부", "..."],
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
// baseline: 오늘 배치표에서 뽑아둔 {name, part, role, date} (있으면 앵커로 사용)
export async function analyzeTurn(article, baseline = null) {
  if (!article.images?.length) return null;
  const { name, part } = nameAndPart();
  return callGeminiJSON(buildTurnPrompt(article, name, part, baseline), article.images[0]);
}

// ── 2) 배치표 → 김홍구 상태 확인 + 3부 스페어 명단(순서) 추출 ──
function buildSchedulePrompt(article, name, part) {
  return `당신은 골프장 캐디 배치표를 읽는 도우미입니다. 대상 캐디: "${name}", ${part}부.
글 제목: "${article.subject}"

[배치표 구조]
- 오른쪽에 "1조 2조 3조 4조" 조 배치표가 있고, 각 사람 이름 옆에 근무표시가 붙습니다
  (예: "${part}부", "휴무", "휴가", "병가", "54", "2,3", "당번", "선발", "조출", "정출", "배치").
- 각 부(1부/2부/3부)마다 "OUT n부 IN" 시간표가 있고, 그 '왼쪽'에 그 부의 "순번/이름" 목록이 있습니다.

[1단계] 조 배치표(1~4조)에서 "${name}"을 찾아 옆의 근무표시를 읽으세요 → dayStatus.
- "휴무/휴가/병가" → role="off" (오늘 쉼)
- "54" → role="work" (1·2·3부 모두 근무)
- "${part}부" 또는 "2,3" 등 ${part}부 포함 → ${part}부 관련 → 2단계로.
- 조 배치표에서 "${name}"을 못 찾으면 found=false, role="off".

[2단계] "${part}부 순번 목록"("OUT ${part}부 IN" 시간표 '왼쪽'의 순번/이름 목록)을 위에서부터 읽으세요.
★ 배경색 = 신분:
- 녹색(보통 "54") / 하늘색(보통 "2,3") / 흰색 = '근무 확정'
- 회색 = '스페어(대기)'. 회색은 목록 맨 뒤에 연속으로 몰려 있습니다.
"${name}"을 이 목록에서 찾아 배경색 확인:
- 회색이면 role="spare". 회색(스페어) 사람들을 '위에서 아래로' 순서대로 모두 나열(spareList)하고,
  그 안에서 "${name}"이 몇 번째인지(myIndex, 1부터) 세세요.
- 근무색(녹/하늘/흰)이면 role="work".

반드시 JSON "하나만" 출력(설명 금지):
{
  "found": true 또는 false,
  "dayStatus": "조 배치표에서 ${name} 옆 표시(예: 3부/휴무/54)",
  "role": "work|spare|off|unknown",
  "part": "${part}부",
  "spareList": ["회색(스페어) 이름들을 순서대로", "..."],
  "myIndex": 정수 또는 null,
  "dateLabel": "제목/이미지의 날짜 그대로 (예: 7월 13일 월요일)",
  "status": "role 과 동일 값",
  "message": "${name}님 기준 한국어 한 문장"
}
(spareList/myIndex 는 role=spare 일 때만 채우세요. myIndex 는 spareList 에서 ${name} 위치(1부터).)
message 예:
- off:   "${name}님, 7월 13일 휴무입니다. 편히 쉬세요"
- work:  "${name}님, 7월 13일 ${part}부 근무(출근 확정)입니다"
- spare: "${name}님, 7월 13일 ${part}부 스페어 대기 N번입니다" (N=myIndex)`;
}

// 반환: {found, dayStatus, role, part, spareList, myIndex, dateLabel, status, message} 또는 null
export async function analyzeSchedule(article) {
  if (!article.images?.length) return null;
  const { name, part } = nameAndPart();
  return callGeminiJSON(buildSchedulePrompt(article, name, part), article.images[0]);
}
