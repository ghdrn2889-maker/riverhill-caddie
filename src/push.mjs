// 웹푸시(Web Push) 발송 — 회원별로 구독 기기를 관리(SQLite)하고, 그 회원의 폰들에만 보낸다.
//  ★userId 미지정이면 1번 회원(김홍구). 기존 subscriptions.json 은 부팅 시 1번 회원으로 1회 이관.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { run, get, all } from './db.mjs';
import { DATA_DIR } from './store.mjs';

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

export async function broadcast({ title, body, url, level }, userId = 1) {
  const subs = getSubscriptions(userId);
  if (!subs.length) { console.log(`(회원 ${userId} 구독 기기 없음 — 폰에서 알림 켜기 필요)`); return; }
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
}
