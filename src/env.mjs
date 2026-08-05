// .env 파일을 읽어 process.env 에 채운다 (외부 라이브러리 없이).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const p = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ★import 시점 자동 로드(근본) — 다른 모듈이 '모듈 로드 시점'에 process.env를 읽는 상수(예: DAILY_CAP,
//  QUIET_END_HOUR)를 정의하는데, server.mjs 본문의 loadEnv()는 그 import들보다 '늦게' 실행돼 .env가
//  무시되던 클래스 버그가 있었다(CLAUDE_DAILY_CAP=150이 40으로, QUIET_END=8이 7로 동작). env.mjs는
//  대개 첫 import라, 여기서 즉시 로드하면 이후 어떤 모듈의 모듈-로드 상수도 .env 값을 본다. 멱등(위 가드).
loadEnv();
