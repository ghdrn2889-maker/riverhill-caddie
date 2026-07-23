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

// 한 줄씩 누적 기록(JSONL). 진단 로그용(예: 판독 불확실 사유) — 나중에 패턴 분석·근본원인 대응.
export function appendJSONL(name, obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, name), JSON.stringify(obj) + '\n');
  } catch (e) { console.error('appendJSONL 오류:', e.message); }
}

// ── 회원별 저장소 (data/users/{userId}/) ──────────────────
//  회원마다 today·worklog·cartcheck·journal·baseline·pushlog·recent·photos 를 분리 보관.
//  ★userId 미지정이면 1번 회원(김홍구) — 기존 호출부는 그대로 1번으로 동작(무변화).
export function userDataDir(userId = 1) { return path.join(DATA_DIR, 'users', String(userId || 1)); }
export function userPhotoDir(userId = 1) { return path.join(userDataDir(userId), 'photos'); }

export function loadUserJSON(userId, name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userDataDir(userId), name), 'utf8'));
  } catch {
    return fallback;
  }
}
export function saveUserJSON(userId, name, obj) {
  const dir = userDataDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
}

// 회원제 이전의 전역 데이터 파일을 1번 회원 폴더로 1회 이관(멱등). 부팅 시 crawler 시작 전 호출.
//  ★사용자에게 회원별로 보여줄 데이터만 이관: today·worklog·cartcheck·journal + photos.
//   recent(피드)·pushlog(중복차단)·baseline 은 아직 단일 notify 경로(1번 회원)가 쓰므로 전역 유지 →
//   회원별 판독 단계에서 함께 회원별로 전환. health.json(하트비트)도 전역. subscriptions 는 push.mjs 가 SQLite 이관.
const PRIMARY_FILES = ['today.json', 'worklog.json', 'cartcheck.json', 'journal.json'];
export function migratePrimaryToUserStore() {
  const dir = userDataDir(1);
  if (fs.existsSync(dir)) return false; // 이미 이관됨
  fs.mkdirSync(dir, { recursive: true });
  let moved = 0;
  for (const f of PRIMARY_FILES) {
    const src = path.join(DATA_DIR, f);
    if (fs.existsSync(src)) { fs.renameSync(src, path.join(dir, f)); moved++; }
  }
  const photoSrc = path.join(DATA_DIR, 'photos');
  if (fs.existsSync(photoSrc)) { fs.renameSync(photoSrc, path.join(dir, 'photos')); moved++; }
  console.log(`📦 1번 회원 데이터 이관 완료 → data/users/1/ (${moved}개 항목)`);
  return true;
}
