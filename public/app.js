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

  loadToday();
  loadRecent();
  setInterval(() => { loadToday(); loadRecent(); }, 30000);
}

// ── 오늘 내 상황판 + heartbeat ──────────────────────────
async function loadToday() {
  try {
    const [t, h] = await Promise.all([
      fetch('/api/today').then((r) => r.json()).catch(() => null),
      fetch('/api/health').then((r) => r.json()).catch(() => null),
    ]);
    renderToday(t);
    renderHeartbeat(h);
  } catch {}
}

function renderToday(t) {
  const card = $('todayCard');
  if (!t || t.empty || !t.state) { card.style.display = 'none'; return; }
  const s = t.state, st = s.status;
  const work = (st === 'assigned' || st === 'work' || st === 'your_turn');
  const cls = st === 'your_turn' ? 'turn' : work ? 'work' : st === 'off' ? 'off'
    : (st === 'spare' || st === 'waiting' || st === 'near') ? 'spare' : '';
  card.className = 'card today ' + cls;

  const label = st === 'your_turn' ? '🚨 지금 출근 순번!' : work ? '✅ 오늘 근무' : st === 'off' ? '😴 오늘 휴무'
    : (st === 'spare' || st === 'waiting' || st === 'near') ? '🏌️ 스페어 대기' : '🏌️ 대기 중';
  $('tStatus').textContent = label;

  const detail = [];
  if (s.myPosition) detail.push(`순번 ${s.myPosition}번`);
  if (work && s.teeTime) detail.push(`티오프 ${s.teeTime}${s.course ? ` (${s.course}코스)` : ''}`);
  if (!work && st !== 'off') {
    if (s.cutoffName && s.cutoffPosition != null && s.myPosition != null) {
      const rem = s.myPosition - s.cutoffPosition - 1;
      detail.push(rem <= 0 ? '곧 차례!' : `${s.cutoffName}님까지 확정 · 앞으로 ${rem}명`);
    } else detail.push('아직 근무 확정 전');
  }
  $('tDetail').textContent = detail.join(' · ');

  const go = $('tGo');
  if (work && t.commute) {
    go.style.display = 'inline-block';
    go.textContent = `🏠 집에서 ${t.commute.leave} 출발 · ${t.commute.arrive} 도착`;
  } else go.style.display = 'none';

  $('tWhen').textContent = `${s.date || ''}${s.updatedAt ? ` · ${timeAgo(s.updatedAt)} 갱신` : ''}`;
  card.style.display = 'block';
}

function renderHeartbeat(h) {
  const el = $('heartbeat');
  if (!h) { el.textContent = ''; return; }
  if (h.alive) {
    el.className = 'heartbeat';
    el.innerHTML = `<b>🟢 감시 중</b> · ${h.ageSec != null ? (h.ageSec < 60 ? '방금' : Math.floor(h.ageSec / 60) + '분 전') : ''} 확인`;
  } else {
    el.className = 'heartbeat dead';
    const why = h.failStreak >= 2 ? '카페 접속 오류(쿠키 확인)' : (h.ageSec != null ? `${Math.floor(h.ageSec / 60)}분째 응답 없음` : '상태 불명');
    el.innerHTML = `<b>🔴 감시 멈춤</b> · ${why}`;
  }
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
        : a.status === 'assigned' || a.status === 'work' ? '<span class="badge med">근무</span>'
        : a.status === 'spare' ? '<span class="badge med">스페어</span>'
        : a.status === 'off' ? '<span class="badge med">근무없음</span>'
        : (a.relevant && a.priority === 'high') ? '<span class="badge med">일정</span>' : '';
      // 무관(피드에만 남긴) 글은 흐리게 + 분류 태그.
      const dim = a.relevant === false ? ' dim' : '';
      const cat = a.category ? `<span class="cat">${escapeHtml(a.category)}</span>` : '';
      const headline = a.aiMessage || a.subject;
      const sub = a.aiMessage ? a.subject : '';
      const when = timeAgo(ts) || a.writeDate || '';

      const parts = [];
      if (when) parts.push(`<span class="time">${escapeHtml(when)}</span>`);
      const rest = [sub, a.writer, a.menuName].filter(Boolean).join(' · ');
      if (rest) parts.push(escapeHtml(rest));
      const metaLine = parts.join(' · ');

      return `<a class="item${isNew ? ' new' : ''}${dim}" href="${a.url}" target="_blank" rel="noopener">
        <div class="subj">${cat}${badge}${escapeHtml(headline)}</div>
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
