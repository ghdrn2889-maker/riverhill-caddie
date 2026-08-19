// 웹푸시(Web Push) 발송 — 회원별로 구독 기기를 관리(SQLite)하고, 그 회원의 폰들에만 보낸다.
//  ★userId 미지정이면 1번 회원(김홍구). 기존 subscriptions.json 은 부팅 시 1번 회원으로 1회 이관.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { run, get, all } from './db.mjs';
import { adminUserIds } from './users.mjs';
import { DATA_DIR, appendJSONL } from './store.mjs';

export function initPush() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    throw new Error('VAPID 키가 없습니다. 먼저 `npm run gen-vapid` 를 실행하세요.');
  }
  webpush.setVapidDetails(
    'mailto:' + (process.env.CONTACT_EMAIL || 'admin@example.com'),
    pub, priv,
  );
  migrateLegacySubscriptions();
}

// 기존 data/subscriptions.json → push_subscriptions(SQLite), 1번 회원 소유로 1회 이관.
function migrateLegacySubscriptions() {
  const file = path.join(DATA_DIR, 'subscriptions.json');
  if (!fs.existsSync(file)) return;
  try {
    const subs = JSON.parse(fs.readFileSync(file, 'utf8'));
    let n = 0;
    for (const s of subs || []) { if (s && s.endpoint) { upsertSub(1, s); n++; } }
    fs.renameSync(file, file + '.migrated'); // 재이관 방지
    console.log(`📦 구독 ${n}개 → SQLite(1번 회원) 이관 완료`);
  } catch (e) { console.error('구독 이관 오류:', e.message); }
}

function upsertSub(userId, sub) {
  run(`INSERT INTO push_subscriptions (endpoint, user_id, sub_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, sub_json = excluded.sub_json`,
    sub.endpoint, userId, JSON.stringify(sub), Date.now());
}

export function getSubscriptions(userId = 1) {
  return all('SELECT sub_json FROM push_subscriptions WHERE user_id = ?', userId)
    .map((r) => { try { return JSON.parse(r.sub_json); } catch { return null; } })
    .filter(Boolean);
}

export function addSubscription(sub, userId = 1) {
  if (!sub || !sub.endpoint) return;
  const existed = get('SELECT endpoint FROM push_subscriptions WHERE endpoint = ?', sub.endpoint);
  upsertSub(userId, sub);
  if (!existed) {
    const n = get('SELECT COUNT(*) c FROM push_subscriptions WHERE user_id = ?', userId).c;
    console.log(`📱 구독 기기 추가됨 (회원 ${userId} · 총 ${n}대)`);
  }
}

function removeSubscription(endpoint) { run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint); }

// ── 조용 시간대(취침) ── 기본 22시~08시엔 회원 알림을 즉시 보내지 않고 대기열에 쌓아 아침에 보낸다.
//  예외(bypassQuiet:true): 당일 조출(1부) 출발·티오프 같은 '근무에 늦으면 안 되는' 알림만 통과.
//  ★env는 함수 안에서 지연 읽기 — 모듈 import가 loadEnv()보다 먼저 평가돼 .env 값이 무시되던 문제 방지.
const quietStart = () => Number(process.env.QUIET_START_HOUR ?? 22); // 22시부터
const quietEnd = () => Number(process.env.QUIET_END_HOUR ?? 8);      // 08시까지 무음(아침 flush 시각과 정렬)
export function inQuietHours(h = new Date().getHours()) {
  const s = quietStart(), e = quietEnd();
  return s <= e ? (h >= s && h < e) : (h >= s || h < e);
}

// ── 조용시간 정정 대기열 ── 밤(22~QUIET_END시)에 발생한 회원 정정 알림은 '드롭'하지 않고 여기 쌓았다가
//  아침(QUIET_END시)에 flushDeferred()로 한꺼번에 보낸다. 회원별·제목별 최신 1건만 유지(새벽 스팸 방지).
//  키=`uid|title` → 같은 종류(티오프변경 등) 정정이 밤새 여러 번이면 마지막 상태만 아침에 전달.
const DEFERRED_FILE = () => path.join(DATA_DIR, 'deferred-push.json');
function loadDeferred() { try { return JSON.parse(fs.readFileSync(DEFERRED_FILE(), 'utf8')); } catch { return {}; } }
function saveDeferred(m) { try { fs.writeFileSync(DEFERRED_FILE(), JSON.stringify(m)); } catch { /* noop */ } }
function enqueueDeferred(userId, { title, body, url, level }) {
  const m = loadDeferred();
  m[`${userId}|${title}`] = { userId: Number(userId), title, body, url, level: level || 'normal', at: Date.now() };
  saveDeferred(m);
}
// 아침 flush — 대기열을 비우며 각 항목을 조용시간 예외로 즉시 발송. (같은 상태 재발 방지: 업스트림 pushlog가 이미 dedup)
export async function flushDeferred() {
  // 운영 대기열 먼저 — 관리자가 아침에 상황부터 알아야 회원 알림을 판단할 수 있다.
  const om = loadOpsDeferred();
  const oitems = Object.values(om);
  if (oitems.length) {
    saveOpsDeferred({});
    for (const it of oitems) {
      try { await broadcastOps({ title: it.title, body: it.body, url: it.url, level: it.level, bypassQuiet: true }); }
      catch (e) { console.error('운영 대기열 발송 오류:', e.message); }
    }
    console.log(`🌅 아침 운영 대기열 발송: ${oitems.length}건`);
  }
  const m = loadDeferred();
  const items = Object.values(m);
  if (!items.length) return { sent: 0, ops: oitems.length };
  saveDeferred({});   // 먼저 비워 재진입·중복 방지
  let sent = 0;
  for (const it of items) {
    try { await broadcast({ title: it.title, body: it.body, url: it.url, level: it.level, bypassQuiet: true }, it.userId); sent++; }
    catch (e) { console.error('정정 대기열 발송 오류:', e.message); }
  }
  console.log(`🌅 아침 정정 대기열 발송: ${sent}건`);
  return { sent, ops: oitems.length };
}

// 발송한 알림을 한 줄씩 로그로 남긴다(운영 모니터의 '최근 발송 알림' 피드용). append-only.
//  ★file을 받는다 — 회원 알림은 sent-push.jsonl, 운영 알림은 sent-ops.jsonl.
//   한 장부에 섞으면 모니터의 '회원별 발송 알림'에 운영 잡음이 끼고, 발송 관문의
//   '오늘 이미 N건 보냄'도 그 숫자를 세서, 관리자가 자기가 회원으로서 무엇을 받았는지 못 본다.
function logSentPush(userId, { title, body, level }, sent, devices, file = 'sent-push.jsonl') {
  appendJSONL(file, {
    at: Date.now(), uid: Number(userId),
    title: String(title || '').slice(0, 90),
    body: String(body || '').replace(/\s+/g, ' ').slice(0, 180),
    level: level || 'normal', sent, devices,
  });
}

// ── 운영 알림 통로 ──────────────────────────────────────────────
//  '시스템 사정'을 관리자에게 알리는 길(네이버 쿠키 만료·시스템 진단·판독 확인 필요).
//  ★회원 알림과 나누는 이유는 '누가 받느냐'가 아니다 — 그건 원래도 관리자뿐이었다.
//   나누는 건 장부와 대기열이다:
//    · 장부: 회원 알림 장부(sent-push.jsonl)에 섞이면 모니터의 회원 피드가 운영 잡음으로 덮인다.
//    · 대기열: 밤에 온 운영 알림이 회원 정정 대기열에 쌓여 아침에 회원 알림과 함께 쏟아진다.
//  ★급한 운영 알림(배치표 판독 손상 등)은 밤에도 통과시킨다 — 3부 배치표는 밤에 올라온다.
//   급하지 않은 것(쿠키 만료)은 운영 대기열에 두었다가 아침에 보낸다.
export async function broadcastOps({ title, body, url = '/', level = 'high', bypassQuiet = true } = {}) {
  const ids = adminUserIds();
  if (!ids.length) { console.warn(`[운영알림] 관리자 계정이 없어 생략 — ${title}`); return { sent: 0, admins: 0 }; }
  if (!bypassQuiet && inQuietHours()) {
    const m = loadOpsDeferred();
    m[title] = { title, body, url, level, at: Date.now() };   // 같은 제목은 최신 1건만(밤새 반복 방지)
    saveOpsDeferred(m);
    console.log(`🔕 [운영알림] 조용시간 — 아침 대기열 적재: ${title}`);
    return { sent: 0, admins: ids.length, deferred: true };
  }
  let sent = 0;
  for (const id of ids) sent += await deliver(id, { title, body, url, level }, 'sent-ops.jsonl');
  console.log(`🛠 [운영알림] 관리자 ${ids.length}명 — ${title}`);
  return { sent, admins: ids.length };
}
const OPS_DEFERRED_FILE = () => path.join(DATA_DIR, 'deferred-ops.json');
function loadOpsDeferred() { try { return JSON.parse(fs.readFileSync(OPS_DEFERRED_FILE(), 'utf8')); } catch { return {}; } }
function saveOpsDeferred(m) { try { fs.writeFileSync(OPS_DEFERRED_FILE(), JSON.stringify(m)); } catch { /* noop */ } }

export async function broadcast({ title, body, url, level, bypassQuiet }, userId = 1) {
  // 회원 알림 — 조용시간이면 아침 대기열로, 아니면 바로 전송.
  //  ★비발송 스위치(PUSH_DISABLED · data/push-disabled)는 deliver()가 본다 — 운영 알림도 같이 지키라고 내려놨다.
  if (!bypassQuiet && inQuietHours()) {
    enqueueDeferred(userId, { title, body, url, level });
    console.log(`🔕 조용시간(${quietStart()}~${quietEnd()}시) — 아침 발송 대기열 적재: [회원${userId}] ${title}`);
    return;
  }
  return deliver(userId, { title, body, url, level }, 'sent-push.jsonl');
}

// 실제 전송 — 구독 기기에 쏘고 장부에 적는다. 회원 알림과 운영 알림이 같은 길을 쓰되 장부만 다르다.
async function deliver(userId, { title, body, url, level }, logFile) {
  // ★알림 비발송 스위치 — 이 서버는 푸시를 '보내지 않는다'(크롤링·웹·대시보드·모니터는 정상 동작).
  //  두 서버가 같은 구독으로 같은 폰에 쏘던 중복을 '한 서버만 발송'하게. 켜는 법: data/push-disabled 파일 생성
  //  (또는 env PUSH_DISABLED=1). 파일 방식은 재시작 없이 즉시 토글·복구 — touch로 켜고 rm으로 끈다.
  //  ★운영 알림도 같은 규칙을 받는다 — 안 그러면 두 서버가 관리자 폰에 진단 알림을 두 번씩 쏜다.
  const envOff = ['1', 'true', 'yes'].includes(String(process.env.PUSH_DISABLED || '').toLowerCase());
  const fileOff = (() => { try { return fs.existsSync(path.join(DATA_DIR, 'push-disabled')); } catch { return false; } })();
  if (envOff || fileOff) {
    console.log(`🚫 알림 비발송(${fileOff ? 'push-disabled 파일' : 'PUSH_DISABLED'}): [회원${userId}] ${title}`);
    return 0;
  }
  const subs = getSubscriptions(userId);
  if (!subs.length) {
    console.log(`(회원 ${userId} 구독 기기 없음 — 폰에서 알림 켜기 필요)`);
    logSentPush(userId, { title, body, level }, 0, 0, logFile); // 기기 없어 미전달 — 그래도 시도는 기록
    return 0;
  }
  // level: 'high'(근무확정·곧차례) | 'check'(확인필요) | 그 외(리마인더 등).
  //  서비스워커가 이 값으로 진동 세기·화면 유지 여부를 정한다.
  const payload = JSON.stringify({ title, body, url, level: level || 'normal' });
  let ok = 0, dead = 0, fail = 0;
  for (const s of subs) {
    const tag = String(s.endpoint || '').slice(-12);
    try {
      const r = await webpush.sendNotification(s, payload);
      ok++;
      console.log(`  ↳ 푸시 OK [${r.statusCode}] …${tag}`);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        removeSubscription(s.endpoint); dead++;
        console.log(`  ↳ 만료된 구독 제거 [${e.statusCode}] …${tag}`);
      } else {
        fail++;
        console.error(`  ↳ 푸시 실패 [${e.statusCode || e.message}] …${tag}`);
      }
    }
  }
  console.log(`📤 발송결과(회원 ${userId}): 성공 ${ok} / 실패 ${fail} / 만료제거 ${dead} (총 ${subs.length})`);
  logSentPush(userId, { title, body, level }, ok, subs.length, logFile);
  return ok;
}
