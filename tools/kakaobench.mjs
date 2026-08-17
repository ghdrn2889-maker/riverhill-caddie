// 카카오 대 사람 경로 — 일주일 대조표.
//   node tools/kakaobench.mjs            최근 7일
//   node tools/kakaobench.mjs 14         최근 14일
//   node tools/kakaobench.mjs 20260817   그 하루
import { reportDay, reportRange } from '../src/kakaobench.mjs';

const a = String(process.argv[2] || '');
console.log('');
console.log(/^\d{8}$/.test(a) ? reportDay(a) : reportRange(Number(a) || 7));
console.log('');
