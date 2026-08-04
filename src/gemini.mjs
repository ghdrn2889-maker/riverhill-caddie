// 무료 Gemini(비전)로 카페 이미지를 읽어 '김홍구님 기준' 으로 번역한다.
//  - analyzeTurn:     '당일 변동사항' → 순번 계산 (앞으로 몇 명 남았는지)
//  - analyzeSchedule: '배치표'        → 오늘/내일 내가 근무인지 스페어인지
// 키(GEMINI_API_KEY)가 없거나 실패하면 null 을 돌려주고, 서버는 제목 알림으로 폴백한다.

// 문자열 리터럴 안의 '이스케이프 안 된 제어문자'(생 줄바꿈·탭 등)를 정식 이스케이프로 바꾼다.
//  Gemini가 "summary":"1줄<생줄바꿈>2줄" 처럼 내놓으면 JSON.parse가 "Bad control character"로 실패 → 이걸 교정.
function escapeControlChars(s) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') { out += c; inStr = false; continue; }
      const code = c.charCodeAt(0);
      if (code < 0x20) { // 생 제어문자 → 이스케이프
        out += c === '\n' ? '\\n' : c === '\t' ? '\\t' : c === '\r' ? '\\r'
          : '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += c;
    } else {
      out += c;
      if (c === '"') inStr = true;
    }
  }
  return out;
}

// Gemini가 JSON 앞뒤에 코드펜스나 잡텍스트를 붙여도 첫 번째 완전한 {…} 만 뽑아 파싱.
//  ★깨끗한 파싱을 먼저 시도하고(무변화), 실패 시에만 제어문자 교정본으로 재시도(관용).
function parseJSONLoose(txt) {
  let s = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const tryParse = (str) => { try { return { v: JSON.parse(str) }; } catch { return null; } };
  let r = tryParse(s) || tryParse(escapeControlChars(s));
  if (r) return r.v;
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
    else if (c === '}' && --depth === 0) {
      const slice = s.slice(start, i + 1);
      const p = tryParse(slice) || tryParse(escapeControlChars(slice));
      if (p) return p.v;
      break;
    }
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

// 프롬프트(+선택 이미지) → Gemini 호출 → JSON 파싱 (2회 재시도). 실패 시 null.
// imageUrl 이 없으면 텍스트-only 로 호출한다(제목/본문만 있는 글도 판단 가능).
// ★전역 킬스위치 — Gemini 비활성(기본)이면 어떤 경로도 실제 호출을 안 한다. 크레딧 고갈 상태에서
//  잔재 호출들이 429/타임아웃으로 시간을 잡아먹거나 그 기능을 멈추게 하던 문제 원천 차단.
//  되살리려면(크레딧 충전 후) .env 에 GEMINI_ENABLED=1. 그때까진 모든 callGeminiJSON 이 즉시 null.
export const geminiEnabled = () => ['1', 'true', 'yes'].includes(String(process.env.GEMINI_ENABLED || '').toLowerCase());

export async function callGeminiJSON(promptText, imageUrl = null, modelOverride = null, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !geminiEnabled()) return null;   // 키 없음 또는 전역 비활성 → 호출 안 함(429·멈춤 방지)

  const model = modelOverride || process.env.GEMINI_MODEL || 'gemini-flash-latest';

  let img = null;
  if (opts.inlineImage && opts.inlineImage.data) {
    img = { data: opts.inlineImage.data, mime: opts.inlineImage.mime || 'image/jpeg' }; // 앱 업로드(base64) 직접 사용
  } else if (imageUrl) {
    try {
      img = await fetchImageBase64(imageUrl);
    } catch (e) {
      console.error('[gemini] 이미지 로드 실패(텍스트로 계속):', e.message);
      img = null;
    }
  }

  const parts = [{ text: promptText }];
  if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });

  const body = {
    contents: [{ parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: opts.temperature ?? 0, ...(opts.topP != null ? { topP: opts.topP } : {}) },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const ATTEMPTS = 2;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS ?? 60000)),   // 기본 60초(무거운 배치표 판독 완주용). 넘으면 중단 후 재시도
      });
      if (!res.ok) {
        console.error(`[gemini] HTTP ${res.status} (시도 ${attempt})`, (await res.text()).slice(0, 200));
        // 429(할당량)·403(권한)은 즉시 재시도해도 또 실패 → 재시도 말고 종료(할당량 추가 소모 방지).
        if (res.status === 429 || res.status === 403) return null;
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

// ── 영수증 판독 — 사진에서 날짜·금액·상호·항목 자동 추출(정산 지출 입력 보조) ──
//  input: data URL(앱 업로드 압축본) 또는 이미지 URL. 실패 시 null(사용자 수동 입력으로 폴백).
export async function analyzeReceipt(input) {
  let inlineImage = null, imageUrl = null;
  const m = String(input || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) inlineImage = { mime: m[1], data: m[2] };
  else if (input) imageUrl = input;
  else return null;
  const prompt = `당신은 영수증(주유·통행료·식대 등)을 판독하는 도우미입니다.
첨부한 영수증 사진의 실제 인쇄된 값만 읽어 JSON "하나만" 출력하세요(설명 금지, 값을 지어내지 말 것).
- date: 영수증의 거래일시/승인일시에 적힌 날짜를 "YYYY-MM-DD"로. 반드시 사진에 보이는 날짜 그대로. 없으면 null.
- amount: 실제 승인된 총 결제금액(숫자만, 콤마 제거). 취소(마이너스) 금액은 제외. 없으면 null.
- vendor: 상호/사용처(주유소·휴게소·업체명). 없으면 "".
- category: "주유"|"톨비"|"식대"|"기타" 중 추정(기름/주유소=주유, 통행료/하이패스/톨게이트=톨비).
- method: "카드"|"현금"|"현금영수증"|"" 중 추정.
형식(값은 예시 아님, 실제 값으로 채울 것): {"date":"YYYY-MM-DD","amount":0,"vendor":"","category":"기타","method":""}`;
  const model = process.env.GEMINI_ROSTER_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const out = await callGeminiJSON(prompt, imageUrl, model, { inlineImage });
  if (!out || typeof out !== 'object') return null;
  return {
    date: (typeof out.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out.date)) ? out.date : null,
    amount: Number.isFinite(Number(out.amount)) ? Math.round(Number(out.amount)) : null,
    vendor: String(out.vendor || '').slice(0, 40),
    category: ['주유', '톨비', '식대', '기타'].includes(out.category) ? out.category : '기타',
    method: ['카드', '현금', '현금영수증'].includes(out.method) ? out.method : '',
  };
}

// ── 판독 메모 캐시(크레딧 절약의 핵심) ─────────────────────────────
//  같은 배치표 이미지를 judge·crossPartWorkMap·모니터·재폴링이 제각각 다시 판독해 Gemini 호출이
//  이미지 1장당 십수 회씩 났다. (함수+부+이미지지문) 키로 '성공한 판독'을 캐시해 중복 호출을 제거한다.
//  · 성공(비어있지 않음)만 캐시 — 빈값/실패는 재시도 허용. · opts.fresh=true면 캐시 우회 + 성공 시 캐시 갱신
//    (judge의 '내 이름 없음' 의도적 재판독이 캐시에 막히지 않게). · 최근 이미지 몇 장만 유지(메모리 보호).
const _readMemo = new Map();               // key → { at, value }
const _READ_MEMO_MAX = 48;
function imgFp(article) { return String(article?.images?.[0] || '').split('?')[0]; }
function memoGet(key) { const e = _readMemo.get(key); return e ? e.value : undefined; }
function memoSet(key, value) {
  _readMemo.set(key, { at: Date.now(), value });
  if (_readMemo.size > _READ_MEMO_MAX) {
    let oldestK = null, oldestAt = Infinity;
    for (const [k, e] of _readMemo) if (e.at < oldestAt) { oldestAt = e.at; oldestK = k; }
    if (oldestK) _readMemo.delete(oldestK);
  }
  return value;
}
// 캐시 래퍼: 성공(truthy·비어있지 않음)만 저장. producer는 판독 Promise를 반환하는 함수.
async function memoRead(key, producer, opts = {}) {
  if (!opts.fresh) { const c = memoGet(key); if (c !== undefined) return c; }
  const v = await producer();
  const ok = Array.isArray(v) ? v.length > 0 : (v && (typeof v !== 'object' || Object.keys(v).length > 0));
  if (ok) memoSet(key, v);
  return v;
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

★ 순번 교환 규칙 (매우 중요, 괄호 우선):
이름 칸이 'A(B)' 형태이고 괄호 안 B가 '사람 이름'이면, A와 B가 순번을 맞바꾼 것입니다.
이 경우 그 자리의 '진짜 대기자'는 괄호 안의 B 입니다. (예: "박수현(${name})" 자리엔 실제로 ${name}이 있음)
- "${name}"의 진짜 순번(myPosition)은 '괄호 안에 ${name}이 있는 자리'(예: "박수현(${name})")로 판단하세요.
- "${name}(다른사람)" 자리는 원래 ${name} 자리였지만 지금은 다른 사람 자리이므로 ${name}의 순번이 아닙니다.
- 커트라인 등 다른 사람의 위치도 마찬가지로, 괄호가 있으면 '괄호 안 이름'을 그 자리 대기자로 보세요.
- 단, 괄호 안이 "54"나 "2,3" 같은 근무구분이면 교환이 아니라 근무유형 표시이니 무시하세요.
- 괄호가 없으면 적힌 이름 그대로가 그 자리 대기자입니다.

★ 티오프 시간/코스 (출근이 '확정'된 경우에만):
번호표에는 "OUT ${part}부 IN" 형태의 시간표가 있습니다. 가운데 열이 '티오프 시간(HH:MM)',
왼쪽이 'OUT 코스', 오른쪽이 'IN 코스'이며, 확정된 순번이 그 티오프 칸(OUT 또는 IN)에 등록됩니다.
"${name}"이 이미 배정(흰색이거나 커트라인을 통과)됐다면, "${name}"의 순번이 등록된
티오프 시간(HH:MM)과 코스(OUT 또는 IN)를 찾아 teeTime, course 에 적으세요.
- 순번 교환이 있으면 '${name}'의 진짜 자리(괄호 안에 ${name}이 있는 자리) 기준으로 티오프/코스를 읽으세요.
- 아직 대기(회색)여서 티오프가 등록 안 됐으면 teeTime=null, course="".

이미지와 제목을 함께 보고 아래를 계산해, 반드시 JSON "하나만" 출력하세요(설명 금지):
{
  "found": true 또는 false,
  "myPosition": 정수 또는 null,
  "cutoffName": "문자열 또는 빈칸",
  "cutoffPosition": 정수 또는 null,
  "remaining": 정수 또는 null,
  "status": "assigned|your_turn|near|waiting|unknown",
  "teeTime": "HH:MM 또는 null (확정 시 ${name}의 티오프 시간)",
  "course": "OUT 또는 IN 또는 빈칸 (확정 시 ${name}의 코스)",
  "note": "제목·본문에 '시간이 바뀔 수 있음/취소/캔슬/시간조정/변동가능' 등 주의할 안내가 있으면 ${name}님께 알릴 한 문장(예: '티오프 시간이 바뀔 수 있으니 다시 확인하세요'), 없으면 빈칸",
  "nameList": ["번호표에 적힌 이름을 순번(위→아래) 순서대로 전부, 괄호도 있으면 그대로(예: 박수현(김홍구))", "..."],
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

// ── 3) 본배치표에서 'N부 순번/이름 목록'만 집중 판독 ─────────────
//  통합 판독은 한 번에 너무 많은 걸 읽어 명단을 자주 놓친다(타임아웃·부분). 명단만 따로 뽑으면
//  또렷한 인쇄 글씨라 순번 순서대로 안정적으로 읽힌다 → 스페어 대시보드의 '순번별 이름'의 근거.
// 부(部)별 티오프표 특징 — 배경색 + 티오프 시각대(창). 이 두 축으로 '어느 부 표'인지 특정한다.
//  (리버힐: 1부=분홍 아침, 2부=하늘색 낮, 3부=보라 저녁. 창은 judge.mjs partWindow와 일치.)
function partGridInfo(part) {
  const p = String(part);
  return p === '1' ? { color: '연분홍(분홍)', win: '이른 아침(대략 05~10시, 예: 06:23·07:33)', min: 5, max: 10 }
    : p === '2' ? { color: '하늘색', win: '낮(대략 10~16시, 예: 11:57·13:07)', min: 10, max: 16 }
    : { color: '보라', win: '저녁(대략 16~24시, 예: 17:00·18:45)', min: 16, max: 24 };
}
function partColorName(part) { return partGridInfo(part).color; }

// ★배치표 가로 배열은 [1부명단][OUT1부IN표][2부명단][OUT2부IN표][3부명단][OUT3부IN표][조배치표] 순으로
//  '명단→자기 부 티오프표'가 반복된다(명단은 '자기 부 표의 바로 왼쪽'). 그래서 각 부 명단은 두 티오프표 사이에 낀다.
//  한쪽만("왼쪽") 지시하면 모델이 좌/우를 헷갈려 이웃 부 명단을 집는다(2부→3부명단 오독 실증). → 양쪽 표로 샌드위치 앵커링.
function buildRosterPrompt(part) {
  const p = String(part);
  const me = partGridInfo(p);
  const left = p === '2' ? { n: '1', ...partGridInfo('1') } : p === '3' ? { n: '2', ...partGridInfo('2') } : null;
  const hasRight = p !== '3';
  let anchor;
  if (p === '1') {
    anchor = `1부 명단은 배치표에서 **가장 왼쪽**에 있는 순번+이름 세로칸입니다. 그 오른쪽에 "OUT 1부 IN"(${me.color}, 티오프 ${me.win}) 표가 붙어 있습니다.`;
  } else {
    anchor = `${p}부 명단은 **두 티오프표 사이에 끼어 있는** 순번+이름 세로칸입니다:
   · 그 명단의 **왼쪽**엔 "OUT ${left.n}부 IN"(${left.color}, 티오프 ${left.win}) 표,
   · 그 명단의 **오른쪽**엔 "OUT ${p}부 IN"(${me.color}, 티오프 ${me.win}) 표가 있습니다.
   즉 ${p}부 명단은 "OUT ${p}부 IN" 표의 **바로 왼쪽** 칸입니다.${hasRight ? ` "OUT ${p}부 IN" 표의 **오른쪽**에 있는 명단은 다음 부의 것이니 절대 읽지 마세요.` : ''}`;
  }
  return `당신은 골프장 배치표 이미지를 정확히 옮겨적는 도우미입니다. "${p}부 순번/이름 목록"만 읽으세요.

[배치표 가로 배열 — 매우 중요]
이 배치표는 왼→오른쪽으로 [1부 명단]→[OUT 1부 IN 표]→[2부 명단]→[OUT 2부 IN 표]→[3부 명단]→[OUT 3부 IN 표]→[조 배치표(1·2·3·4조)] 순서로 '명단→그 부 티오프표'가 반복됩니다. 각 부 명단은 '자기 부 티오프표의 바로 왼쪽'에 있습니다.

[${p}부 명단 위치]
${anchor}

[스스로 검증] 올바른 ${p}부 명단이면 그 오른쪽에 붙은 "OUT ${p}부 IN" 표의 티오프 시각이 ${me.win}대여야 합니다. 만약 고른 명단 오른쪽 표 시각이 이 시간대가 아니면 잘못 고른 것 — 다시 왼쪽/오른쪽을 확인하세요.

[읽기 규칙]
- 순번 1번부터 실제 인쇄된 마지막 번호까지 한 명도 빠짐없이, 이름 왼쪽의 숫자를 pos로(임의로 매기지 말 것). 근무·스페어 모두.
- 이름 옆 괄호((54),(1,3),(2,3) 등)는 그대로 붙여 적으세요.
- 명단이 두 세로단이면(왼단 1~25, 오른단 26~50) 두 단 모두 맨 아래 마지막 줄까지. ★${p}부 명단은 앞부분 이름(순번 2~12)이 뒷순번(41~50)에 '다시' 인쇄되기도 합니다 — 같은 이름이라도 순번(pos)이 다르면 각각 실제 항목이니 그대로 전부 넣으세요(겹친다고 빼거나 멈추지 말 것).
- 인쇄 안 된 순번은 지어내지 말고 마지막 인쇄 순번에서 멈추세요.
${p === '1' ? `
[★1부 배정 유형 — 각 이름 칸의 '배경색'으로 구분(리버힐 규칙, 매우 중요)]
1부 명단에서 이름 칸의 배경색이 그 사람의 1부 배정 유형입니다. 이름마다 "assign"을 아래 중 하나로:
- 배경 녹색(green) → "54"      (1·2·3부 전부 근무)
- 배경 진한분홍/핫핑크(hot·vivid pink, 채도 높은 강렬한 분홍) → "1,3"  (1부·3부 근무)
- 배경 흰색/무색(white·none) → "only1"   (원래 1부로 배정된, 1부만 하는 캐디)
- 배경 연분홍(연한·옅은 분홍, 핫핑크보다 훨씬 채도 낮고 밝음) → "chulgn"  (조출 — 신청해서 1부 뜀)
- 이름 뒤 괄호 "(찾근)" → "찾근"  (찾아서근무 신청 — 색과 무관, 괄호 텍스트가 근거)
★핫핑크(강렬)와 연분홍(옅음)을 반드시 채도·명도로 구분하세요(둘 다 분홍이지만 전혀 다른 유형).
★이름 옆 괄호 텍스트가 있으면 그것을 우선 근거로: "(54)"→"54", "(1,3)"·"(1/3)"→"1,3", "(2,3)"→"2,3", "(찾근)"→"찾근". 괄호가 없으면 배경색으로만 판단.
` : ''}
반드시 JSON "하나만"(설명 금지):
{ "part": ${p}, "gridFirstTime": "고른 명단 오른쪽 'OUT ${p}부 IN' 표의 가장 이른 티오프 시각 HH:MM", "roster": [ ${p === '1' ? '{"pos":1,"name":"정유경(54)","assign":"54"}' : '{"pos":1,"name":"정유경(54)"}'} ] }
${p}부 목록을 못 찾으면 {"part":${p},"gridFirstTime":"","roster":[]}.`;
}
// 1부 배정유형 정규화: 괄호텍스트/유형값/배경색 판독값 → '54'|'1,3'|'only1'|'chulgn'|null.
//  모델이 유형('54'/'chulgn' 등) 또는 색이름('green'/'hotpink'/'lightpink'/'white')을 줄 수 있어 둘 다 수용.
function normAssign(a, name) {
  const s = String(a || '').replace(/\s/g, '').toLowerCase();
  const paren = String(name || '').match(/\(([^)]*)\)/)?.[1]?.replace(/\s/g, '') || '';
  // 괄호 텍스트가 가장 강한 근거.
  if (/54/.test(paren)) return '54';
  if (/1[,/·]3/.test(paren)) return '1,3';
  if (/2[,/·]3/.test(paren)) return '2,3';
  if (/찾근/.test(paren)) return '찾근';        // (찾근) = 찾아서근무 신청
  // 유형/색 문자열.
  if (/^54$|녹색|green/.test(s)) return '54';
  if (/2[,/·]?3/.test(s)) return '2,3';
  if (/1[,/·]?3|hot|vivid|진한|핫핑크/.test(s)) return '1,3';   // 진한분홍/핫핑크 = 1·3 (연분홍보다 먼저 매칭)
  if (/찾근|chatg/.test(s)) return '찾근';
  if (/chulgn|조출|연분홍|연한|pale|light/.test(s)) return 'chulgn';  // 연분홍 = 조출
  if (/only1|흰|white|무색|none|1부전용|1부만/.test(s)) return 'only1';
  return null;
}
// 배정유형 → 그 사람이 뛰는 부 집합. ('54'=1·2·3, '1,3'=1·3, '2,3'=2·3, 조출/찾근/1부전용=해당 부)
export function assignToParts(assign) {
  const a = String(assign || '');
  if (a === '54') return new Set(['1', '2', '3']);
  if (a === '1,3') return new Set(['1', '3']);
  if (a === '2,3') return new Set(['2', '3']);
  if (a === 'only1' || a === 'chulgn' || a === '찾근') return new Set(['1']);
  return new Set();
}

// gemini 응답 → [{pos,name}] 정리(순번 오름차순, pos 기준 dedup) + gridFirstTime의 '시(hour)'.
function cleanRosterOut(out) {
  const cleaned = (Array.isArray(out?.roster) ? out.roster : [])
    .map((r) => {
      const name = String(r?.name || '').trim();
      const assign = normAssign(r?.assign, name);   // 1부만 채워짐(2·3부는 assign 미요청→null)
      return assign ? { pos: Number(r?.pos), name, assign } : { pos: Number(r?.pos), name };
    })
    .filter((r) => Number.isFinite(r.pos) && r.pos >= 1 && r.name)
    .sort((a, b) => a.pos - b.pos);
  // ★중복 제거는 '순번(pos)' 기준 — 같은 pos가 두 번이면 첫 것만.
  //  이름 중복은 허용: 2부 명단은 앞부분 이름(순번 2~12)이 뒤 순번(41~50)에 실제로 다시 인쇄되므로
  //  이름으로 지우면 뒷순번(41~50)이 통째로 날아간다(홍아름=13·신철=28 등 앞은 맞아도 50까지 못 채움).
  const seen = new Set();
  const deduped = [];
  for (const r of cleaned) { if (seen.has(r.pos)) continue; seen.add(r.pos); deduped.push(r); }
  const hm = String(out?.gridFirstTime || '').match(/(\d{1,2}):/);
  return { rows: deduped, hour: hm ? Number(hm[1]) : null };
}

// 반환: [{pos:number, name:string(, assign)}] (순번 오름차순, 유효행만) — 실패/미검출이면 [].
//  ★이미지별 캐시(memoRead): judge·crossPartWorkMap·모니터가 같은 부 명단을 재판독하지 않는다.
//   opts.fresh=true면 캐시 우회(judge의 '내 이름 없음' 의도적 재판독 전용) + 성공 시 캐시 갱신.
export async function analyzeRoster(article, part = '3', opts = {}) {
  if (!article.images?.length) return [];
  return memoRead(`roster:${part}:${imgFp(article)}`, async () => {
    // ★명단은 '구조화 JSON 리스트'라 flash가 더 안정적(pro는 긴 40행 명단에서 JSON 파싱 실패 잦음).
    //  괄호 교환("정진영(조하빈)")도 flash가 또렷이 포착 → 점유자 해석은 코드(normRosterName)가 결정적으로.
    const model = process.env.GEMINI_ROSTER_MODEL || 'gemini-flash-latest';
    const { min, max } = partGridInfo(part);
    let parsed = cleanRosterOut(await callGeminiJSON(buildRosterPrompt(part), article.images[0], model));
    // ★검증: 모델이 보고한 앵커 표 시각이 이 부의 창(min~max) 밖이면 엉뚱한 부 표에 붙은 명단을 집은 것 → 1회 재판독.
    if (parsed.hour != null && (parsed.hour < min || parsed.hour >= max)) {
      console.log(`↻ [roster] ${part}부 명단 앵커시각 ${parsed.hour}시가 창(${min}~${max}) 밖 → 재판독`);
      const retry = cleanRosterOut(await callGeminiJSON(buildRosterPrompt(part), article.images[0], model));
      if (retry.hour == null || (retry.hour >= min && retry.hour < max)) parsed = retry;
    }
    return parsed.rows;
  }, opts);
}

// ── 3.2) 상단 제목의 부별 '팀 수'만 집중 판독 ──────────────────
//  "1부 14  2부 7  3부 24  총:45팀". ★조 배치표 "1조 21명"의 인원수와 혼동 금지(오른쪽, 최상단 아님).
//  교차확인(두 탕)에서 각 부 근무 상한(순번 ≤ 팀수)의 근거. 헤더 전용 판독이 flash로 안정(3/3 검증).
function buildPartTeamsPrompt() {
  return `골프장 배치표 '최상단 제목 줄'에는 "1부 14   2부 7   3부 24   총: 45팀" 형식으로 각 부 예약 '팀 수'가 적혀 있습니다. 그 숫자만 읽으세요.
- ★오른쪽 '조 배치표'의 "1조 21명 / 2조 22명" 같은 '조별 인원수'와 절대 혼동 금지 — 그건 팀수가 아닙니다. 오직 최상단 "N부 M" 제목 숫자만.
- 특정 부가 없으면 그 값은 0.
반드시 JSON 하나만: {"part1":정수,"part2":정수,"part3":정수,"total":정수}`;
}
// 반환: {1:n,2:n,3:n} — 실패 시 {}. (이미지별 캐시: crossPartWorkMap·모니터 중복 판독 제거)
export async function analyzePartTeams(article) {
  if (!article.images?.length) return {};
  return memoRead(`teams:${imgFp(article)}`, async () => {
    const model = process.env.GEMINI_ROSTER_MODEL || 'gemini-flash-latest';
    const out = await callGeminiJSON(buildPartTeamsPrompt(), article.images[0], model);
    if (!out) return {};
    const g = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    return { 1: g(out.part1), 2: g(out.part2), 3: g(out.part3), total: g(out.total) };
  });
}

// ── 3.5) 인턴 캐디(티오프표 노란칸) 전용 판독 ─────────────────
//  통합 판독은 인턴 감지가 흔들려(오탐) → 노란칸만 집중해서 또렷이 센다(flash 안정).
function buildInternPrompt(part = '3') {
  const p = String(part);
  return `당신은 골프장 배치표의 '${p}부 티오프 매칭표'(헤더 [OUT | ${p}부 | IN])를 정확히 보는 도우미입니다.
각 시간 행의 OUT칸·IN칸은 셋 중 하나입니다: (1)순번 숫자가 인쇄됨, (2)빈칸, (3)★숫자 없이 '노란색'으로만 채워진 칸.
(3)의 '노란색 칸'만 골라 배열로 옮기세요. 이건 그날 섭외된 '인턴 캐디' 팀입니다(정규 순번 아님).
- 노란색이 아닌 칸(숫자 있음/빈칸)은 절대 넣지 마세요. 색을 지어내지 말고 실제 노란 칸만.
반드시 JSON "하나만"(설명 금지):
{ "internTees": [ {"time":"HH:MM","course":"OUT 또는 IN"} ], "internCount": 노란칸 개수 }
노란 칸이 없으면 {"internTees": [], "internCount": 0}.`;
}
// 반환: {internTees:[{time,course}], internCount} — 실패 시 null. (이미지·부별 캐시)
export async function analyzeInterns(article, part = '3') {
  if (!article.images?.length) return null;
  return memoRead(`interns:${part}:${imgFp(article)}`, async () => {
    const model = process.env.GEMINI_ROSTER_MODEL || 'gemini-flash-latest';
    const out = await callGeminiJSON(buildInternPrompt(part), article.images[0], model);
    if (!out) return null;
    const tees = (Array.isArray(out.internTees) ? out.internTees : [])
      .map((g) => ({ time: (String(g?.time || '').match(/\d{1,2}:\d{2}/) || [''])[0], course: /IN/i.test(String(g?.course)) ? 'IN' : 'OUT' }))
      .filter((g) => g.time);
    return { internTees: tees, internCount: Number.isFinite(Number(out.internCount)) ? Number(out.internCount) : tees.length };
  });
}

// ── 3.7) 대바(대기바꿈) 댓글 → 순번 재배치 op (텍스트 전용, 저렴) ────
//  실제 대바 댓글은 형식이 제각각·오타 많음("2부7번 조예린", "김동윤 2부 25번", "홍준쵸 24번",
//  "A님 B님 바꿈")이라 정규식으론 대부분 놓친다. 모델이 '현재 명단 + 댓글'을 보고 최종 이동 순번을 낸다.
//  비전 토큰 없는 텍스트 판독이라 저렴. 결과 op는 코드(applySwapAssignments)가 결정적으로 명단에 적용.
function buildDaebaPrompt(part, roster, comments) {
  const p = String(part);
  const other = p === '3' ? '1·2부' : p === '2' ? '1·3부' : '2·3부';
  const N = roster.length;
  return `골프장 '대기바꿈(대바)' 댓글을 반영해 ${p}부 최종 대기순번 명단을 내는 도우미입니다.
[현재 ${p}부 명단] (순번:이름)
${roster.map((n, i) => `${i + 1}:${daebaBaseName(n)}`).join('  ')}

[캐디 댓글]
${comments.map((c, i) => `(${i + 1}) ${String(c?.content ?? c ?? '').replace(/\s+/g, ' ').trim()}`).join('\n')}

규칙:
- ★오직 ${p}부에 대한 항목만 반영. 다른 부(${other}) 언급 항목은 완전히 무시.
- 다양한 형식 모두 처리: "${p}부7번 조예린"=조예린을 7번으로 / "김동윤 ${p}부 25번"=김동윤을 25번으로 / "홍준쵸 24번"=명단의 실제 이름(오타 교정)을 24번으로 / "A님 B님 바꿈"=A와 B의 순번 맞교환.
- 이름 오타는 위 [현재 명단]의 실제 이름으로 교정. ★[현재 명단]에 없는 이름은 무시(다른 부 사람). 명단 인원(${N}명)은 그대로, 순서만 바뀜.
- 바뀐 사람만 자리 이동, 나머지는 현재 순번 그대로.
★반드시 대바 반영 '후' ${p}부 ${N}명 전체를 순번 1~${N} 순서대로 출력(JSON 하나만):
{"roster":[{"pos":1,"name":"홍길동"},{"pos":2,"name":"김철수"}]}`;
}
// 이름에서 듀티태그/공백 제거 → 본명(대바 이름 매칭용). "정유경(54)"→"정유경", "A(B)"→"A".
function daebaBaseName(s) { return String(s || '').replace(/\s*\([^)]*\).*/, '').replace(/\s/g, ''); }
// 반환: [{name, pos}] — ${part}부 명단에 적용할 재배치 op. 실패/무관이면 [].
export async function parseDaebaByModel(roster, comments, part = '3') {
  if (!Array.isArray(roster) || !roster.length || !Array.isArray(comments) || !comments.length) return [];
  const model = process.env.GEMINI_ROSTER_MODEL || 'gemini-flash-latest';   // ★flash(안정) — lite는 출력형식이 흔들림
  const out = await callGeminiJSON(buildDaebaPrompt(part, roster, comments), null, model);
  // ★모델이 형식을 흔든다(ops/list/roster 키, 델타 vs 전체명단). 내용은 정확하니 모든 형식 수용.
  let rows = out?.ops || out?.list || out?.roster || out?.changes || (Array.isArray(out) ? out : []);
  if (!Array.isArray(rows)) return [];
  rows = rows
    .map((r) => ({ name: daebaBaseName(r?.name), pos: Number(r?.pos) }))
    .filter((r) => r.name.length >= 2 && Number.isFinite(r.pos) && r.pos >= 1 && r.pos <= 60);
  // 전체 명단을 통째로 냈으면(길이 ≈ 원본) 원본과 대조해 '바뀐 자리만' op로 뽑는다(불필요한 무변화 op 제거).
  if (rows.length >= Math.max(8, Math.floor(roster.length * 0.6))) {
    const orig = roster.map((n) => daebaBaseName(n));
    const ops = [];
    for (const r of rows) { const i = r.pos - 1; if (i >= 0 && i < orig.length && orig[i] !== r.name) ops.push(r); }
    return ops;
  }
  return rows;   // 델타 ops
}

// ── 4) 오른쪽 '조 배치표'(전체 캐디 명부) 판독 ────────────────
//  1~4조 × (이름·근무·카트) = 그날 소속 캐디 전원(총원). 이름 사전(오탈자 보정용) + 부·신분 태그의 원천.
function buildCrewsPrompt() {
  return `당신은 골프장 배치표 이미지를 정확히 옮겨적는 도우미입니다.
이미지 오른쪽에 "1조 2조 3조 4조" 로 나뉜 '조 배치표'(그날 전체 캐디 명부)가 있습니다.
각 조 블록은 세 열: 이름 | 근무 | 카트 입니다.
- 네 개 조(1~4조) 각각을 위에서 아래로, 이름이 적힌 '모든 줄'을 빠짐없이 옮기세요.
- 각 사람마다: name(이름 그대로), duty(근무 열 값 — 예: "3부","2,3","1,3","54h","휴무","휴가","벌당","선발","프리","배치","당번"; 비었으면 ""), jo(조 번호 1~4 정수).
- 카트 번호 열은 무시하세요.
- 이름칸이 비어있는 줄은 건너뛰세요. 이름을 지어내지 마세요.

반드시 JSON "하나만"(설명 금지):
{ "crews": [ {"jo":1,"name":"김홍구","duty":"3부"}, {"jo":1,"name":"김상미","duty":""} ] }`;
}

// 반환: [{jo:number, name:string, duty:string}] — 실패/미검출이면 []. (이미지별 캐시)
export async function analyzeCrews(article) {
  if (!article.images?.length) return [];
  return memoRead(`crews:${imgFp(article)}`, async () => {
    const model = process.env.GEMINI_ROSTER_MODEL || 'gemini-flash-latest';
    const out = await callGeminiJSON(buildCrewsPrompt(), article.images[0], model);
    const rows = Array.isArray(out?.crews) ? out.crews : [];
    return rows
      .map((r) => ({ jo: Number(r?.jo) || 0, name: String(r?.name || '').trim(), duty: String(r?.duty || '').trim() }))
      .filter((r) => r.name);
  });
}
