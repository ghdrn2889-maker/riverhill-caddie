// Gemini 키가 실제로 작동하는지 간단히 확인한다.
import { loadEnv } from '../src/env.mjs';
loadEnv();

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!key) { console.error('❌ .env 에 GEMINI_API_KEY 가 비어 있습니다.'); process.exit(1); }
console.log(`키 앞부분: ${key.slice(0, 6)}...  / 모델: ${model}\n`);

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contents: [{ parts: [{ text: '한국어로 "정상" 이라고만 답해줘.' }] }] }),
});

console.log('HTTP', res.status);
const text = await res.text();
if (res.ok) {
  try {
    const d = JSON.parse(text);
    console.log('✅ 응답:', d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim());
    console.log('\n🎉 Gemini 키 정상 작동!');
  } catch { console.log(text.slice(0, 400)); }
} else {
  console.log('❌ 실패 응답:', text.slice(0, 500));
  console.log('\n→ 키가 잘못됐을 수 있어요. https://aistudio.google.com/apikey 에서');
  console.log('  "Create API key" 로 만든 AIza... 형식 키를 다시 복사해 주세요.');
}
