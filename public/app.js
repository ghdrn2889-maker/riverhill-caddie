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

  loadRecent();
  setInterval(loadRecent, 30000);
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
    if (!list.length) { box.innerHTML = '<div class="empty">아직 감지된 소식이 없어요.</div>'; return; }
    box.innerHTML = list.map((a) => {
      const badge = a.status === 'your_turn' ? '<span class="badge">지금 차례</span>'
        : a.status === 'near' ? '<span class="badge">곧 차례</span>'
        : a.status === 'assigned' ? '<span class="badge med">배정됨</span>'
        : a.priority === 'high' ? '<span class="badge med">일정</span>' : '';
      const headline = a.aiMessage || a.subject;
      const sub = a.aiMessage ? a.subject : '';
      const meta = [sub, a.menuName, a.writeDate].filter(Boolean).join(' · ');
      return `<a class="item" href="${a.url}" target="_blank" rel="noopener">
        <div class="subj">${badge}${escapeHtml(headline)}</div>
        ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}</a>`;
    }).join('');
  } catch {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();
