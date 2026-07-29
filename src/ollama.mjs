// 로컬 비전 모델(Ollama)로 영수증 판독 — 홈서버 GPU/CPU에서 무료(크레딧 0).
//  실패/미기동 시 null → 호출부에서 (옵션) Gemini 폴백 또는 사용자 수동입력으로.
//  ★영수증만 로컬(글자 크고 값 몇 개라 7B로 충분). 배치표는 정확도 때문에 Gemini 유지.
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const RECEIPT_MODEL = process.env.OLLAMA_RECEIPT_MODEL || 'qwen2.5vl:7b';

// ★예시에 실제 날짜/금액을 넣으면 모델이 그대로 베낀다(검증 중 07-28→07-29 오답 발생) → 자리표시자만.
const RECEIPT_PROMPT = `당신은 영수증(주유·통행료·식대 등)을 판독하는 도우미입니다.
첨부한 영수증 사진의 실제 인쇄된 값만 읽어 JSON 하나만 출력하세요(설명 금지, 값을 지어내지 말 것).
- date: 영수증의 거래일시/승인일시에 적힌 날짜를 "YYYY-MM-DD"로. 반드시 사진에 보이는 날짜 그대로.
- amount: 실제 승인된 총 결제금액(숫자만, 콤마 제거). 취소(마이너스) 금액은 제외.
- vendor: 상호/사용처.
- category: "주유"|"톨비"|"식대"|"주차"|"기타" 중 하나.
- method: "카드"|"현금"|"현금영수증"|"" 중 하나.
형식(값은 예시 아님, 실제 값으로 채울 것): {"date":"YYYY-MM-DD","amount":0,"vendor":"","category":"기타","method":""}`;

function parseLoose(txt) {
  let s = String(txt || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* noop */ } }
  return null;
}

function normalize(o) {
  if (!o || typeof o !== 'object') return null;
  const amt = Math.round(Number(o.amount));
  return {
    date: (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) ? o.date : null,
    amount: (Number.isFinite(amt) && amt > 0) ? amt : null,
    vendor: String(o.vendor || '').slice(0, 40),
    category: ['주유', '톨비', '식대', '주차', '기타'].includes(o.category) ? o.category : '기타',
    method: ['카드', '현금', '현금영수증'].includes(o.method) ? o.method : '',
  };
}

// Ollama 기동 여부(빠른 헬스체크).
export async function ollamaReady() {
  try { const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }); return r.ok; }
  catch { return false; }
}

// 영수증 판독(로컬). input = data URL(앱 업로드 base64). 성공 시 {date,amount,vendor,category,method}, 실패 null.
export async function analyzeReceiptLocal(input) {
  const m = String(input || '').match(/^data:image\/\w+;base64,(.+)$/);
  if (!m) return null; // 로컬은 base64 업로드만(원격 URL 미지원)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: RECEIPT_MODEL, prompt: RECEIPT_PROMPT, images: [m[1]], stream: false, options: { temperature: 0, num_predict: 300 } }),
      signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000)), // 첫 호출은 모델 로드로 십수 초
    });
    if (!res.ok) { console.error('[ollama] 영수증 HTTP', res.status); return null; }
    const j = await res.json();
    return normalize(parseLoose(j.response));
  } catch (e) { console.error('[ollama] 영수증 판독 실패:', e.message); return null; }
}
