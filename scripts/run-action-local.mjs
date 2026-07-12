// action/watch.mjs 를 로컬에서 점검용으로 실행 (.env + 기존 구독 사용).
import fs from 'node:fs';
import { loadEnv } from '../src/env.mjs';
loadEnv();
if (!process.env.PUSH_SUBSCRIPTION) {
  try { process.env.PUSH_SUBSCRIPTION = fs.readFileSync('data/subscriptions.json', 'utf8'); } catch {}
}
await import('../action/watch.mjs');
