// 무료 Gemini(비전)로 '당일 변동사항' 이미지를 읽어 김홍구님 순번을 계산한다.
// 키(GEMINI_API_KEY)가 없으면 null 을 돌려주고, 서버는 제목 알림으로 폴백한다.

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

function buildPrompt(article, name, part) {
  return `당신은 골프장 캐디 근무 배정을 분석하는 도우미입니다.
대상 캐디: 이름 "${name}", ${part}부 소속.

아래는 오늘 '당일 변동사항' 게시글입니다.
- 글 제목: "${article.subject}"
- 첨부 이미지: ${part}부 캐디 "대기 순번" 목록(위에서 아래로 순서)일 가능성이 높습니다.

배경 지식: 제목의 "○○님까지 일됩니다"는 순번상 그 사람까지 근무가 배정됐다는 뜻입니다.
대기 순번에서 배정 커트라인이 "${name}"에 도달하거나 지나면 "${name}"도 근무하러 나가야 합니다.

이미지와 제목을 함께 보고 아래를 계산해, 반드시 JSON "하나만" 출력하세요(설명 금지):
{
  "found": true 또는 false,            // 이미지/글에서 ${name}을 찾았는지
  "myPosition": 정수 또는 null,         // ${name}의 순번(위에서 몇 번째)
  "cutoffName": "문자열 또는 빈칸",     // 근무 배정 커트라인 이름(제목의 ○○)
  "cutoffPosition": 정수 또는 null,     // 커트라인의 순번
  "remaining": 정수 또는 null,          // ${name}까지 남은 인원(커트라인 다음~${name} 직전). 이미 배정됐으면 0 또는 음수
  "status": "assigned|your_turn|near|waiting|unknown",
  "message": "${name}님 기준 한국어 한 문장 요약"
}
status 기준:
- 커트라인이 ${name}을 이미 지남(배정됨) → "assigned"
- ${name}이 바로 다음 차례(remaining 0) → "your_turn"
- remaining 1~2 → "near"
- remaining 3 이상 → "waiting"
- 못 찾음 → "unknown"
message 예: "${name}님, 앞으로 2명 남았어요 (도대영님까지 배정됨)" / "${name}님, 오늘 근무 배정됐어요" / "${name}님 지금 나가실 차례예요".`;
}

// 반환: {found, myPosition, cutoffName, cutoffPosition, remaining, status, message} 또는 null
export async function analyzeTurn(article) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!article.images || article.images.length === 0) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const name = (process.env.MY_NAME || '김홍구').trim();
  const part = (process.env.MY_PART || '3').trim();

  let img;
  try {
    img = await fetchImageBase64(article.images[0]);
  } catch (e) {
    console.error('[gemini] 이미지 로드 실패:', e.message);
    return null;
  }

  const body = {
    contents: [{
      parts: [
        { text: buildPrompt(article, name, part) },
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
        continue; // 재시도
      }
      const data = await res.json();
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) { console.error(`[gemini] 빈 응답 (시도 ${attempt})`); continue; }
      return JSON.parse(txt);
    } catch (e) {
      console.error(`[gemini] 실패 (시도 ${attempt}):`, e.message);
    }
  }
  return null; // 모두 실패 → 서버는 제목 알림으로 폴백
}
