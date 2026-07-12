// 이 키로 사용 가능한 Gemini 모델 목록(생성 지원)만 추려 출력한다.
import { loadEnv } from '../src/env.mjs';
loadEnv();
const key = process.env.GEMINI_API_KEY;
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
console.log('HTTP', res.status);
const data = await res.json();
if (!res.ok) { console.log(JSON.stringify(data).slice(0, 500)); process.exit(1); }
const models = (data.models || [])
  .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
  .map((m) => m.name.replace('models/', ''));
console.log(`\n생성 가능한 모델 ${models.length}개:\n`);
for (const m of models) console.log('  ' + m);
