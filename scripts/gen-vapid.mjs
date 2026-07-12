// 웹푸시용 VAPID 키(공개/비밀) 한 쌍을 생성해 .env 에 추가한다.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { loadEnv, ROOT_DIR } from '../src/env.mjs';

loadEnv();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  console.log('ℹ️  이미 VAPID 키가 .env 에 있습니다. 새로 만들지 않습니다.');
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();
const envPath = path.join(ROOT_DIR, '.env');
let txt = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (!txt.endsWith('\n')) txt += '\n';
txt += `\n# ── 웹푸시 VAPID 키 (자동 생성, 공유 금지) ──\n`;
txt += `VAPID_PUBLIC_KEY=${keys.publicKey}\n`;
txt += `VAPID_PRIVATE_KEY=${keys.privateKey}\n`;
fs.writeFileSync(envPath, txt);

console.log('✅ VAPID 키를 생성해 .env 에 추가했습니다.');
