// PWA 프론트: 서비스워커 등록 → 알림 권한 → 푸시 구독 → 서버에 등록.
const $ = (id) => document.getElementById(id);

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function main() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setStatus('이 브라우저는 웹푸시를 지원하지 않아요. (안드로이드 크롬 권장)', false);
    $('enableBtn').disabled = true;
    return;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.getSubscription();
  if (sub) setEnabled();

  $('enableBtn').onclick = async () => {
    try {
      $('enableBtn').disabled = true;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus('알림 권한이 거부됐어요. 브라우저 설정에서 허용해주세요.', false);
        $('enableBtn').disabled = false;
        return;
      }
      const { vapidPublicKey } = await (await fetch('/api/config')).json();
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      setEnabled();
    } catch (e) {
      setStatus('알림 켜기 실패: ' + e.message, false);
      $('enableBtn').disabled = false;
    }
  };

  $('testBtn').onclick = async () => {
    await fetch('/api/test', { method: 'POST' });
  };

  $('readAll').onclick = () => {
    setLastRead(Number($('readAll').dataset.newest) || Date.now());
    loadRecent();
  };

  loadRecent();
  setInterval(loadRecent, 30000);
}

const LAST_READ_KEY = 'riverhill_lastReadTs';
function getLastRead() { return Number(localStorage.getItem(LAST_READ_KEY) || 0); }
function setLastRead(ts) { localStorage.setItem(LAST_READ_KEY, String(ts || 0)); }

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}

function updateUnread(count, newest) {
  const c = $('unread'), btn = $('readAll');
  if (count > 0) { c.textContent = count; c.style.display = 'inline-block'; btn.style.display = 'inline-block'; }
  else { c.style.display = 'none'; btn.style.display = 'none'; }
  btn.dataset.newest = String(newest || 0);
}

function setStatus(msg, on) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (on ? ' on' : '');
}
function setEnabled() {
  setStatus('✅ 알림이 켜져 있어요. 소식이 오면 폰으로 알려드립니다.', true);
  $('enableBtn').textContent = '알림 켜짐';
  $('enableBtn').disabled = true;
  $('testBtn').style.display = 'block';
}

async function loadRecent() {
  try {
    const list = await (await fetch('/api/recent')).json();
    const box = $('recent');
    if (!list.length) { box.innerHTML = '<div class="empty">아직 감지된 소식이 없어요.</div>'; updateUnread(0, 0); return; }

    const lastRead = getLastRead();
    let unread = 0, newest = 0;

    box.innerHTML = list.map((a) => {
      const ts = a.detectedAt || 0;
      if (ts > newest) newest = ts;
      const isNew = ts > lastRead;
      if (isNew) unread++;

      const badge = a.status === 'your_turn' ? '<span class="badge">지금 차례</span>'
        : a.status === 'near' ? '<span class="badge">곧 차례</span>'
        : a.status === 'assigned' ? '<span class="badge med">배정됨</span>'
        : a.priority === 'high' ? '<span class="badge med">일정</span>' : '';
      const headline = a.aiMessage || a.subject;
      const sub = a.aiMessage ? a.subject : '';
      const when = timeAgo(ts) || a.writeDate || '';

      const parts = [];
      if (when) parts.push(`<span class="time">${escapeHtml(when)}</span>`);
      const rest = [sub, a.writer, a.menuName, a.writeDate].filter(Boolean).join(' · ');
      if (rest) parts.push(escapeHtml(rest));
      const metaLine = parts.join(' · ');

      return `<a class="item${isNew ? ' new' : ''}" href="${a.url}" target="_blank" rel="noopener">
        <div class="subj">${badge}${escapeHtml(headline)}</div>
        ${metaLine ? `<div class="meta">${metaLine}</div>` : ''}</a>`;
    }).join('');

    updateUnread(unread, newest);
  } catch {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();
