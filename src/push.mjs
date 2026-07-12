// 웹푸시(Web Push) 발송 — 구독한 모든 기기(폰)로 알림을 보낸다.
import webpush from 'web-push';
import { loadJSON, saveJSON } from './store.mjs';

const SUBS_FILE = 'subscriptions.json';

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
}

export function getSubscriptions() {
  return loadJSON(SUBS_FILE, []);
}

export function addSubscription(sub) {
  const subs = getSubscriptions();
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    saveJSON(SUBS_FILE, subs);
    console.log(`📱 구독 기기 추가됨 (총 ${subs.length}대)`);
  }
}

export async function broadcast({ title, body, url }) {
  const subs = getSubscriptions();
  if (!subs.length) { console.log('(구독 기기 없음 — 폰에서 알림 켜기 필요)'); return; }
  const payload = JSON.stringify({ title, body, url });
  const alive = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, payload);
      alive.push(s);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        console.log('만료된 구독 제거');       // 기기가 구독 해지됨
      } else {
        alive.push(s);
        console.error('푸시 실패:', e.statusCode || e.message);
      }
    }
  }
  if (alive.length !== subs.length) saveJSON(SUBS_FILE, alive);
}
