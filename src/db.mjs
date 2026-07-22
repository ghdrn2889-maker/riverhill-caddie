// 회원제 저장소 — Node 내장 SQLite(node:sqlite). 네이티브 의존성/빌드 단계 없음.
//  회원(users)·세션(sessions)·프로필(profiles)을 담는다. data/app.db 는 gitignore(개인정보).
//  ★기존 기능(오늘상황·근무일지·카트)은 아직 JSON 파일 그대로 — 회원별 이관은 다음 단계에서.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.mjs';

let _db = null;

export function db() {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'app.db');
  _db = new DatabaseSync(file);
  _db.exec('PRAGMA journal_mode = WAL;');   // 동시 읽기 안정성(다중 회원)
  _db.exec('PRAGMA foreign_keys = ON;');
  migrate(_db);
  return _db;
}

// 스키마 생성(idempotent). 컬럼 추가는 hasColumn 가드로 안전하게.
function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      naver_id    TEXT UNIQUE,               -- 네이버 OAuth 고유 id(없으면 로컬/시드 회원)
      created_at  INTEGER NOT NULL,
      last_login  INTEGER,
      role        TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'admin'
      status      TEXT NOT NULL DEFAULT 'active'   -- 'active' | 'disabled'
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      board_name    TEXT NOT NULL DEFAULT '',   -- ★배치표에 뜨는 실명(판독의 핵심)
      part          TEXT NOT NULL DEFAULT '3',  -- 부(1/2/3)
      home_km       REAL NOT NULL DEFAULT 30,   -- 집→골프장 편도(km)
      car_no        TEXT NOT NULL DEFAULT '',
      workplace     TEXT NOT NULL DEFAULT '리버힐CC',
      km_per_l      REAL NOT NULL DEFAULT 12,   -- 연비(유류비 어림용)
      station_id    TEXT NOT NULL DEFAULT '',   -- 오피넷 주유소 고유번호(유류비 자동화용, 나중)
      fuel_enabled  INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,          -- 랜덤 세션 토큰(쿠키에 저장)
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      ua          TEXT                       -- 참고용 user-agent
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- OAuth CSRF 방지용 state(단명). 콜백에서 확인 후 삭제.
    CREATE TABLE IF NOT EXISTS oauth_states (
      state       TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL
    );

    -- 웹푸시 구독을 회원별로. (기존 subscriptions.json 은 다음 단계에서 이관)
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint    TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sub_json    TEXT NOT NULL,             -- 전체 구독 객체(JSON)
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
  `);
}

// 편의 래퍼
export function run(sql, ...params) { return db().prepare(sql).run(...params); }
export function get(sql, ...params) { return db().prepare(sql).get(...params); }
export function all(sql, ...params) { return db().prepare(sql).all(...params); }
