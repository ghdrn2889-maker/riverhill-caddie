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
      google_id   TEXT,                      -- 구글 OAuth 고유 id(sub). UNIQUE는 인덱스로(ALTER 호환)
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
      commute_min   INTEGER NOT NULL DEFAULT 60, -- 집→골프장 출근 소요시간(분) — 백대기/출발 산정
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

    -- 설치형 PWA 로그인 핸드오프: 앱이 nonce 발급 → 브라우저에서 OAuth 완료 → 콜백이 done 표시 →
    --  앱이 폴링으로 감지 후 nonce로 교환(앱 컨텍스트에서 세션 쿠키 심기). 단명(10분), 1회용.
    CREATE TABLE IF NOT EXISTS login_handoff (
      nonce       TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done'
      user_id     INTEGER,
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
  // 기존 DB(김홍구 등)에 새 컬럼 안전 추가 — 없을 때만 ALTER.
  addColumn(d, 'profiles', 'commute_min', 'INTEGER NOT NULL DEFAULT 60');
  // ★캐디 구분(하우스/3부). 기존 회원은 part로 자동 변환: 1·2부 → house, 3부 → part3. (본인이 수정 가능)
  addColumn(d, 'profiles', 'caddie_type', "TEXT NOT NULL DEFAULT ''");
  d.exec("UPDATE profiles SET caddie_type = CASE WHEN part = '3' THEN 'part3' ELSE 'house' END WHERE caddie_type = '' OR caddie_type IS NULL");
  addColumn(d, 'oauth_states', 'handoff', 'TEXT');   // ★PWA 로그인 핸드오프 nonce를 state에 연결(설치형 앱 로그인)
  addColumn(d, 'users', 'google_id', 'TEXT');
  addColumn(d, 'users', 'block_reason', 'TEXT');   // 차단 사유(roster|other) — disabled일 때만 채움
  addColumn(d, 'users', 'last_seen', 'INTEGER');   // 마지막 활동(하트비트) — 접속중/나감 판별용(운영 모니터)
  addColumn(d, 'users', 'left_at', 'INTEGER');     // 앱을 닫은/가린 시각 — '나감' 즉시 반영(last_seen보다 뒤면 오프라인)
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id);'); // NULL은 서로 중복 허용
  // ── 바깥 앱에 내주는 읽기 전용 열쇠 ──────────────────────────────
  //  ★세션 쿠키를 쓰지 않는 이유: 쿠키가 SameSite=Lax라 다른 출처(정적 웹앱)에서는 애초에 안 실린다.
  //   실리게 하려면 SameSite=None으로 내려야 하는데, 그건 이 앱 전체의 CSRF 방어를 낮추는 일이다.
  //   창구 하나 열자고 문 전체를 헐 수는 없다. 그래서 그 창구에만 쓰는 열쇠를 따로 판다.
  //  ★열쇠는 회원 한 명 · 용도 하나에 묶인다(scope). 관리자 권한도, 쓰기 권한도 없다.
  //   원문은 저장하지 않는다 — DB가 새도 남의 앱 열쇠가 그대로 나가지 않게 해시만 둔다.
  d.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      token_hash  TEXT PRIMARY KEY,          -- sha256(원문). 원문은 발급 순간에만 존재한다
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope       TEXT NOT NULL,             -- 'work-income' 등 용도 하나
      note        TEXT,                      -- 사람이 알아볼 이름(예: '회계 앱')
      created_at  INTEGER NOT NULL,
      last_used   INTEGER,
      revoked_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id, scope);
  `);
}

// 컬럼이 없을 때만 추가(idempotent). SQLite ALTER는 DEFAULT로 기존 행을 채운다.
function addColumn(d, table, col, decl) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    console.log(`🧱 스키마 갱신: ${table}.${col} 추가`);
  }
}

// 편의 래퍼
export function run(sql, ...params) { return db().prepare(sql).run(...params); }
export function get(sql, ...params) { return db().prepare(sql).get(...params); }
export function all(sql, ...params) { return db().prepare(sql).all(...params); }
