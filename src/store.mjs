// data/ 폴더에 JSON 파일로 상태를 저장/로드 (본 글 id, 구독자, 최근 감지 목록)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './env.mjs';

export const DATA_DIR = path.join(ROOT_DIR, 'data');

export function loadJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function saveJSON(name, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2));
}
