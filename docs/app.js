// PWA(GitHub Pages 정적판): 구독 후 구독정보를 화면에 띄워 GitHub Secret 에 등록하게 한다.
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

  const reg = await navigator.serviceWorker.register('sw.js');
  const existing = await reg.pushManager.getSubscription();
  if (existing) showSubscription(existing);

  $('enableBtn').onclick = async () => {
    try {
      $('enableBtn').disabled = true;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus('알림 권한이 거부됐어요. 브라우저 설정에서 허용해주세요.', false);
        $('enableBtn').disabled = false;
        return;
      }
      const { vapidPublicKey } = await (await fetch('config.json')).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      showSubscription(sub);
    } catch (e) {
      setStatus('알림 켜기 실패: ' + e.message, false);
      $('enableBtn').disabled = false;
    }
  };

  $('copyBtn').onclick = async () => {
    $('subJson').select();
    try { await navigator.clipboard.writeText($('subJson').value); $('copyBtn').textContent = '✅ 복사됨!'; }
    catch { document.execCommand('copy'); $('copyBtn').textContent = '✅ 복사됨!'; }
    setTimeout(() => ($('copyBtn').textContent = '구독 정보 복사'), 2000);
  };

  loadRecent();
  setInterval(loadRecent, 60000);
}

function showSubscription(sub) {
  setStatus('✅ 알림 켜짐! 아래 구독 정보를 GitHub에 한 번만 등록하면 완료돼요.', true);
  $('enableBtn').textContent = '알림 켜짐';
  $('enableBtn').disabled = true;
  $('subJson').value = JSON.stringify(sub);
  $('subBox').style.display = 'block';
}

function setStatus(msg, on) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (on ? ' on' : '');
}

async function loadRecent() {
  try {
    const list = await (await fetch('recent.json?_=' + Date.now())).json();
    const box = $('recent');
    if (!list.length) { box.innerHTML = '<div class="empty">아직 감지된 소식이 없어요.</div>'; return; }
    box.innerHTML = list.map((a) => {
      const badge = a.status === 'your_turn' ? '<span class="badge">지금 차례</span>'
        : a.status === 'near' ? '<span class="badge">곧 차례</span>'
        : a.status === 'assigned' ? '<span class="badge med">배정됨</span>' : '';
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
