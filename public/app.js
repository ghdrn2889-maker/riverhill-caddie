// 리버힐 캐디 PWA — 확정 시안(행동 진행 보드)에 실데이터를 물린다.
// 화면/스타일은 sandbox/hybrid-prototypes.html(HYBRID 02)을 그대로 이식한 index.html을 따른다.
const $ = (id) => document.getElementById(id);
const WD = ['일', '월', '화', '수', '목', '금', '토'];

let swReg = null;
let lastToday = null;
let todayOk = false;

/* ── 시간 유틸(폰 로컬시각 = KST) ── */
const toMin = (hhmm) => { const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = (min) => { const v = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
const gap = (m) => m <= 0 ? '지금' : m < 60 ? `${m}분 남음` : (m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분 남음` : `${Math.floor(m / 60)}시간 남음`);
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const postJSON = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

/* ── 헤더 날짜·시각 ── */
function tickDate() {
  const d = new Date();
  $('date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일 · ${hhmm(d.getHours() * 60 + d.getMinutes())}`;
}

/* ── 하단 내비 / 뷰 전환 ── */
const VIEWS = ['today', 'news', 'cart', 'worklog', 'settle'];
let curView = 'today';
const _boxFxDone = new Set();   // 박스 스태거는 뷰별 최초 1회만(이후엔 가벼운 방향 슬라이드)
function showView(name) {
  if (!VIEWS.includes(name)) name = 'today';
  // 탭 순서 기준 방향성 슬라이드: 오른쪽 탭으로 가면 오른쪽에서, 왼쪽 탭이면 왼쪽에서 들어옴.
  const from = VIEWS.indexOf(curView), to = VIEWS.indexOf(name);
  // 잔류 애니 클래스는 매 전환마다 전부 제거 → 뷰 재표시(hidden→display) 때 애니가 재시작되는 걸 원천 차단.
  VIEWS.forEach((v) => {
    const vw = $('view-' + v);
    vw.hidden = v !== name;
    vw.classList.remove('slide-l', 'slide-r', 'boxfx');
    $('tab-' + v).setAttribute('aria-selected', String(v === name));
  });
  if (name !== curView && from >= 0 && to >= 0) {
    const el = $('view-' + name);
    void el.offsetWidth;                       // 리플로우 → 애니메이션 재생 보장
    if ((name === 'worklog' || name === 'settle') && !_boxFxDone.has(name)) {
      _boxFxDone.add(name);
      boxFx(el);                               // 최초 진입 1회: 카드 박스들이 순서대로 부드럽게 올라옴
    } else {
      el.classList.add(to > from ? 'slide-r' : 'slide-l');   // 재방문·기타 탭: 가벼운 방향 슬라이드
    }
  }
  curView = name;
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'worklog') { loadJournal(); loadWorklog(); }
  if (name === 'cart') loadCartCheck();
  if (name === 'settle') { lgPage = -1; loadLedger(); }
  if (name === 'news') markAllRead();
  window.scrollTo(0, 0);
}
// 근무 기록·정산: 상단 카드 블록들이 순서대로(스태거) 부드럽게 올라오는 등장 모션(뷰별 최초 1회).
//  잔류 클래스 제거는 showView가 매 전환마다 처리 → 여기선 부여만.
function boxFx(view) {
  const items = view.querySelectorAll(':scope > .sect, :scope > .hero, :scope > .lg-seg, :scope > .lg-pager, :scope > #lgList');
  items.forEach((el, i) => el.style.setProperty('--bi', i));
  view.classList.add('boxfx');
}
function initNav() {
  document.querySelectorAll('nav.nav button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  $('toNews').onclick = () => showView('news');
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || 'today');
}

/* ── 플랫폼 감지 + 설치 안내(iOS 사파리 전용 / 안드로이드 설치버튼) ── */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function iosInfo() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
  return { isIOS, isSafari };
}
// iOS 공유 아이콘(네모+위화살표) 인라인 SVG — 사파리 안내 문구에 그대로 삽입.
const SHARE_SVG = '<span class="ib-share"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg></span>';
// ── 이모지 대체용 인라인 SVG(스트로크·currentColor). 크기는 .eic 등 CSS로. ──
const svgIc = (p, sw = 2) => `<svg class="eic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const BELL_SVG = svgIc('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>');
const CLOCK_SVG = svgIc('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>');
const CHECK_SVG = svgIc('<polyline points="4 12 10 18 20 6"/>', 3);
const WARN_SVG = svgIc('<path d="M12 3.2 1.8 20.8h20.4z"/><path d="M12 9.5v5"/><path d="M12 17.6h.01"/>');
const CAM_SVG = svgIc('<path d="M4 8.5h3l1.3-1.8h7.4L17 8.5h3v9.5H4z"/><circle cx="12" cy="13" r="3"/>', 1.9);
const FLAG_SVG = svgIc('<path d="M6 21V4"/><path d="M6 5h11l-2.2 3.1L17 11.4H6"/>');
const HOUSE_SVG = svgIc('<path d="M4 11 12 4l8 7"/><path d="M6 10.2V19h12v-8.8"/>');
const PIN_SVG = svgIc('<path d="M12 21s-6.3-5.7-6.3-10.4a6.3 6.3 0 0 1 12.6 0C18.3 15.3 12 21 12 21z"/><circle cx="12" cy="10.4" r="2.2"/>');
const COFFEE_SVG = svgIc('<path d="M4 9h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M17 10h2.4a2.4 2.4 0 0 1 0 4.8H17"/><path d="M8 3v2.4M12 3v2.4"/>');
const REFRESH_SVG = svgIc('<path d="M20.5 12a8.5 8.5 0 1 1-2.4-6"/><path d="M20.5 4v5h-5"/>');
let deferredInstall = null;
function initInstallPrompt() {
  const bar = $('installBar'), txt = $('installText'), cta = $('installCta'), x = $('installClose');
  if (!bar || isStandalone()) return;                           // 이미 설치돼 실행 중이면 안내 불필요
  if (sessionStorage.getItem('installDismissed')) return;       // 이번 세션에 닫았으면 조용히
  const show = () => { bar.hidden = false; document.body.style.paddingTop = bar.offsetHeight + 'px'; };
  x.onclick = () => { bar.hidden = true; document.body.style.paddingTop = ''; sessionStorage.setItem('installDismissed', '1'); };

  const { isIOS, isSafari } = iosInfo();
  if (isIOS && !isSafari) {
    txt.innerHTML = '아이폰은 <b>사파리(Safari)</b>로 열어야 앱 설치·알림이 됩니다. 이 주소를 사파리로 열어주세요.';
    cta.hidden = true; show(); return;
  }
  if (isIOS && isSafari) {
    txt.innerHTML = `앱으로 설치하고 <b>알림</b>을 받으려면: 아래 <b>공유</b> ${SHARE_SVG} 를 누르고 <b>‘홈 화면에 추가’</b>. 알림은 설치 후에만 옵니다.`;
    cta.hidden = true; show(); return;
  }
  // 안드로이드/데스크톱 크롬: beforeinstallprompt 가 뜨면 '설치' 버튼 노출.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredInstall = e;
    txt.innerHTML = '홈 화면에 <b>앱으로 설치</b>하면 더 편하고 알림도 잘 와요.';
    cta.hidden = false; show();
  });
  cta.onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch {}
    deferredInstall = null; bar.hidden = true; document.body.style.paddingTop = '';
  };
  window.addEventListener('appinstalled', () => { bar.hidden = true; document.body.style.paddingTop = ''; });
}

/* ── 서비스워커 + 알림 구독(자가복구) ── */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    try { await swReg.update(); } catch {}   // 접속할 때마다 SW 최신화 — 오래된 SW로 인한 알림 오류(중복 tag·구 badge) 방지
  } catch { swReg = null; }
  return swReg;
}
async function healSubscription() {
  try {
    if (!swReg) return;
    const sub = await swReg.pushManager.getSubscription();
    if (sub) await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
  } catch {}
}
// 알림 구독 켜기 — 계정 팝업의 버튼 또는 '첫 방문 자동 요청'에서 호출. (msg/btn 없어도 안전)
async function enableNotifications(btnId, msgId) {
  const btn = $(btnId || 'ovEnableBtn'), msg = $(msgId || 'ovEnableMsg');
  try {
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = '';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      const { isIOS } = iosInfo();
      if (msg) msg.textContent = (isIOS && !isStandalone())
        ? '아이폰은 홈 화면에 설치한 뒤, 설치된 앱에서 알림을 켜주세요.'
        : '이 브라우저는 웹푸시를 지원하지 않아요(안드로이드 크롬 권장).';
      if (btn) btn.disabled = false; return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (msg) msg.textContent = '알림이 꺼져 있어요. 기기 설정에서 이 앱 알림을 허용할 수 있어요.'; await updateNotifyButton(); return; }
    if (!swReg) await registerSW();
    const { vapidPublicKey } = await (await fetch('/api/config')).json();
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
    await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    await refreshPushHealth();
    if (msg) msg.textContent = '알림이 켜졌어요. 승인되면 바로 알려드릴게요.';
    if (btn) { btn.disabled = true; btn.className = 'ov-notify on'; btn.textContent = '알림 켜짐'; }
  } catch (e) { if (msg) msg.textContent = '알림 켜기 실패: ' + e.message; if (btn) btn.disabled = false; }
}

// 계정 팝업의 알림 버튼 상태 갱신(켜기 / 켜짐 / 차단됨 / 설치필요).
async function updateNotifyButton() {
  const btn = $('ovEnableBtn'), msg = $('ovEnableMsg');
  if (!btn) return;
  if (msg && Notification.permission !== 'denied') msg.textContent = '';
  const supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  const { isIOS } = iosInfo();
  if (!supported) {
    if (isIOS && !isStandalone()) { btn.hidden = false; btn.disabled = true; btn.className = 'ov-notify on'; btn.textContent = '설치 후 알림 가능'; }
    else { btn.hidden = true; }
    return;
  }
  if (Notification.permission === 'denied') {
    btn.hidden = false; btn.disabled = true; btn.className = 'ov-notify on'; btn.textContent = '알림 차단됨';
    if (msg) msg.textContent = '기기 설정에서 이 앱 알림을 허용해주세요.'; return;
  }
  let sub = null; try { sub = swReg && await swReg.pushManager.getSubscription(); } catch {}
  if (Notification.permission === 'granted' && sub) { btn.hidden = false; btn.disabled = true; btn.className = 'ov-notify on'; btn.textContent = '알림 켜짐'; }
  else { btn.hidden = false; btn.disabled = false; btn.className = 'ov-notify'; btn.textContent = '알림 켜기'; }
}

let pushSubscribed = false;   // 이 기기 구독 여부(캐시) — 알림유도 카드·텔레메트리에서 사용
async function refreshPushHealth() {
  const el = $('hPush');
  const set = (cls, txt) => { el.className = cls; el.textContent = txt; };
  const supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  const { isIOS } = iosInfo();
  pushSubscribed = false;
  if (!supported) { set(isIOS && !isStandalone() ? 'warn' : 'bad', isIOS && !isStandalone() ? '● 설치하면 알림 가능' : '● 알림 미지원'); }
  else if (Notification.permission === 'denied') { set('bad', '● 알림 권한 꺼짐'); }
  else {
    let sub = null;
    try { sub = swReg && await swReg.pushManager.getSubscription(); } catch {}
    pushSubscribed = !!sub;
    if (Notification.permission === 'granted' && sub) { set('', ''); healSubscription(); }
    else set('warn', '● 이 폰 알림 꺼짐');
  }
  await updateNotifyButton();
  syncHealthVisibility();
  renderNotifyNudge();
  sendTelemetry();
}

// 오늘 화면 상단 알림 유도 카드 — 알림 미설정 회원에게 기기별 안내로 켜기를 유도(리텐션 핵심).
function renderNotifyNudge() {
  const el = $('notifyNudge'); if (!el) return;
  if (!(meState && meState.authed) || meState.needsOnboarding) { el.hidden = true; return; }
  const supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  const permGranted = ('Notification' in window) && Notification.permission === 'granted';
  if (permGranted && pushSubscribed) { el.hidden = true; return; }         // 이미 켜짐 → 숨김
  if (sessionStorage.getItem('nudgeDismissed')) { el.hidden = true; return; }
  const { isIOS } = iosInfo();
  let title, body, cta = '';
  if (isIOS && !isStandalone()) {
    title = '아이폰은 설치해야 알림이 와요';
    body = `사파리 아래 <b>공유</b> ${SHARE_SVG} → <b>‘홈 화면에 추가’</b> 로 설치하면, 설치된 앱에서 알림을 켤 수 있어요.`;
  } else if (!supported) {
    title = '이 브라우저는 알림 미지원';
    body = '안드로이드 <b>크롬</b>으로 열면 알림을 받을 수 있어요.';
  } else if (Notification.permission === 'denied') {
    title = '알림이 차단돼 있어요';
    body = '기기 <b>설정 &gt; 이 앱 알림</b>을 허용하면 배정·차례 소식을 받아요.';
  } else {
    title = '알림을 켜야 소식을 받아요';
    body = '근무 배정·내 차례·티오프 변경을 <b>폰으로 바로</b> 알려드려요. 이 앱의 핵심이에요.';
    cta = '알림 켜기';
  }
  el.innerHTML = `<div class="nudge-x" id="nudgeX" role="button" aria-label="닫기">✕</div>`
    + `<div class="nudge-ic">${BELL_SVG}</div>`
    + `<div class="nudge-tx"><b>${title}</b><span>${body}</span></div>`
    + (cta ? `<button class="nudge-cta" id="nudgeCta">${cta}</button>` : '');
  el.hidden = false;
  $('nudgeX').onclick = () => { el.hidden = true; sessionStorage.setItem('nudgeDismissed', '1'); };
  if (cta) $('nudgeCta').onclick = async () => { await enableNotifications(); await refreshPushHealth(); };
}

// 기기·알림 상태 텔레메트리 — iOS/안드 비율·설치·권한·구독 추적(상태 변할 때만 전송).
let _telemetrySig = '';
async function sendTelemetry() {
  try {
    if (!(meState && meState.authed)) return;
    const { isIOS, isSafari } = iosInfo();
    const platform = isIOS ? 'ios' : (/Android/i.test(navigator.userAgent) ? 'android' : 'desktop');
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    const sig = `${platform}|${isStandalone() ? 1 : 0}|${perm}|${pushSubscribed ? 1 : 0}`;
    if (sig === _telemetrySig) return;      // 변화 없으면 재전송 안 함
    _telemetrySig = sig;
    await fetch('/api/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, standalone: isStandalone(), perm, subscribed: pushSubscribed, browser: isSafari ? 'safari' : '', ua: (navigator.userAgent || '').slice(0, 180) }) });
  } catch { /* 무시 */ }
}

// 설치 후 첫 실행 시 자동으로 알림 허용 요청(1회).
//  · 안드로이드 크롬 등: 앱을 열자마자 즉시 프롬프트를 띄운다.
//  · iOS 등 사용자 제스처가 필요한 환경: 즉시 시도는 조용히 무시되므로 '첫 탭'에 자동 재시도.
function maybeAutoAskNotifications() {
  try {
    if (localStorage.getItem('autoAskedPush')) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;         // 이미 허용/거부면 안 물음
    const { isIOS } = iosInfo();
    if (isIOS && !isStandalone()) return;                       // iOS는 설치된 앱에서만

    let done = false;
    const finish = () => {
      if (done) return true;
      done = true;
      document.removeEventListener('pointerdown', arm, true);
      localStorage.setItem('autoAskedPush', '1');
      return false;
    };
    const arm = () => { if (finish()) return; enableNotifications(); };   // 첫 탭 폴백
    document.addEventListener('pointerdown', arm, true);

    // 즉시 시도: 프롬프트가 바로 뜨는 환경이면 여기서 끝. 제스처가 필요하면 리스너가 첫 탭을 잡는다.
    (async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'default') return;                         // 제스처 필요 → 첫 탭 폴백 유지
        if (finish()) return;
        if (perm === 'granted') await enableNotifications();
      } catch { /* 제스처 필요 → 첫 탭 폴백 유지 */ }
    })();
  } catch {}
}

// 감시·알림 표시가 모두 '정상(빈 값)'이면 상태 바 자체를 숨김 — 문제가 있을 때만 노출.
function syncHealthVisibility() {
  const box = $('health'), w = $('hWatch'), p = $('hPush');
  if (!box) return;
  const empty = (!w || !w.textContent.trim()) && (!p || !p.textContent.trim());
  box.style.display = empty ? 'none' : '';
}

/* ── 감시 상태 ── */
async function loadWatchHealth() {
  const el = $('hWatch');
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.alive) { el.className = ''; el.textContent = ''; } // 정상이면 표시 숨김(사용자용) — 문제일 때만 노출
    else { el.className = 'bad'; el.textContent = h.failStreak >= 2 ? '● 감시 오류(쿠키 확인)' : '● 감시 지연'; }
  } catch { el.className = 'warn'; el.textContent = '● 상태 확인 실패'; }
  syncHealthVisibility();
}

/* ── 오늘: 상황판 히어로 + 행동 보드 ── */
async function loadToday() {
  try { const t = await (await fetch('/api/today')).json(); lastToday = t; todayOk = true; renderToday(t); }
  catch { if (!todayOk) { $('heroTitle').textContent = '일정을 확인하지 못했어요'; $('heroSub').textContent = '잠시 후 다시 시도합니다.'; } }
  loadWeather();
  loadCheer();
}
// WMO 코드 → 배경 카테고리 / 한글 설명.
function wmoCategory(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'cloud';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}
function wmoDesc(code) {
  const M = { 0: '맑음', 1: '대체로 맑음', 2: '구름 많음', 3: '흐림', 45: '안개', 48: '안개',
    51: '이슬비', 53: '이슬비', 55: '이슬비', 56: '어는 이슬비', 57: '어는 이슬비',
    61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '어는 비',
    71: '약한 눈', 73: '눈', 75: '많은 눈', 77: '싸락눈',
    80: '소나기', 81: '소나기', 82: '강한 소나기', 85: '소나기눈', 86: '소나기눈',
    95: '뇌우', 96: '우박 뇌우', 99: '우박 뇌우' };
  return M[code] || '흐림';
}
// 맑은 밤 하늘: 크레이터 보름달 + 반짝이는 별(달 우상단과 안 겹치게 좌·하단 위주).
function moonStarsHTML() {
  const pts = [[10, 18], [22, 34], [14, 52], [30, 14], [38, 44], [26, 62], [44, 26], [52, 58], [46, 72], [60, 40], [64, 66], [35, 80], [18, 72]];
  let s = '<div class="moon"></div>';
  for (const [x, y] of pts) {
    const dl = (Math.random() * 3).toFixed(2), sz = (2 + Math.random() * 1.8).toFixed(1);
    s += `<span class="star" style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-delay:${dl}s"></span>`;
  }
  return s;
}
// 배경 효과 파티클 HTML(비·눈은 무작위 생성). mode: 'day'|'dusk'|'night'.
//  ★노을(dusk): 맑음=흐릿한 해만, 흐림/비/눈/뇌우=떠다니는 구름(c1/c2)+강수(해 없음).
function wxFxHTML(cat, mode) {
  const dusk = mode === 'dusk', day = mode === 'day', dawn = mode === 'dawn';
  const soft = dusk || dawn;   // 노을·일출: 흐릿한 해 + 떠다니는 구름(같은 fx 패턴)
  if (cat === 'clear') {
    if (soft) return '<div class="sun"></div>';                          // 흐릿한 노을·새벽 해(우측 상단)
    return day ? '<div class="rays"></div><div class="sun"></div>' : moonStarsHTML();
  }
  if (cat === 'cloud') return '<div class="cloud c1"></div><div class="cloud c2"></div>';
  let s = '';
  if (cat === 'rain' || cat === 'storm') {
    const clouds = soft ? '<div class="cloud c1"></div><div class="cloud c2"></div>' : '<div class="cloud rc"></div>';
    s += (cat === 'storm' ? '<div class="flash"></div>' : '') + clouds;
    for (let i = 0; i < 42; i++) { const l = Math.random() * 100, d = (0.5 + Math.random() * 0.5).toFixed(2), dl = Math.random().toFixed(2);
      s += `<span class="drop" style="left:${l}%;animation-duration:${d}s;animation-delay:${dl}s"></span>`; }
    return s;
  }
  if (cat === 'snow') {
    if (soft) s += '<div class="cloud c1"></div><div class="cloud c2"></div>';          // 노을·새벽 눈엔 구름 추가(더 흐릿하게)
    for (let i = 0; i < 26; i++) { const l = Math.random() * 100, sz = (8 + Math.random() * 10).toFixed(0), d = (3 + Math.random() * 3).toFixed(2), dl = (Math.random() * 4).toFixed(2);
      s += `<span class="flake" style="left:${l}%;font-size:${sz}px;animation-duration:${d}s;animation-delay:${dl}s"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M12 5.5 9.6 3.9M12 5.5l2.4-1.6M12 18.5l-2.4 1.6M12 18.5l2.4 1.6M4.6 8.7 4.9 5.9M4.6 8.7 1.9 8.4M19.4 15.3l.3 2.8M19.4 15.3l2.7.3"/></svg></span>`; }
    return s;
  }
  return '';
}
// ★하늘 모드는 '시각' 기준: 밤 19~05시 · 일출(새벽) 05~07시 · 낮 07~18시 · 노을 18~19시.
function skyModeNow() {
  const h = new Date().getHours();
  if (h >= 19 || h < 5) return 'night';
  if (h < 7) return 'dawn';          // 일출(새벽) 05~07시 — 1부 조출 시간대
  if (h >= 18) return 'dusk';
  return 'day';
}
let lastWxCat = null, lastSkyMode = '';
// 하늘 모드(낮/노을/밤)+날씨를 히어로에 적용. 배경이 바뀌면 부드럽게 크로스페이드.
function applySky(cat, mode) {
  const hero = $('todayHero'), fx = $('wxFx');
  if (!hero || !cat) return;
  const CATS = ['w-clear', 'w-cloud', 'w-rain', 'w-snow', 'w-storm'];
  const changed = (cat !== lastWxCat) || (mode !== lastSkyMode);
  const swap = () => {
    hero.classList.remove(...CATS);
    hero.classList.add('has-wx', 'w-' + cat);
    hero.classList.toggle('wx-night', mode === 'night');
    hero.classList.toggle('wx-dusk', mode === 'dusk');
    hero.classList.toggle('wx-dawn', mode === 'dawn');
    if (fx) fx.innerHTML = wxFxHTML(cat, mode);
  };
  if (changed && lastWxCat) crossfadeSky(hero, swap); else swap();
  lastWxCat = cat; lastSkyMode = mode;
}
// 현재 배경을 스냅샷한 오버레이를 덮고 새 배경으로 바꾼 뒤 오버레이를 페이드아웃 → 시간대·날씨 전환이 자연스럽게.
function crossfadeSky(hero, swap) {
  let prevBg = 'none';
  try { prevBg = getComputedStyle(hero).backgroundImage; } catch { /* 무해 */ }
  swap();                                              // 새 배경·효과로 교체(오버레이 아래에서 준비)
  if (!prevBg || prevBg === 'none') return;
  const ov = document.createElement('div');
  ov.className = 'sky-xfade';
  ov.style.backgroundImage = prevBg;                   // 옛 배경 스냅샷
  hero.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.opacity = '0'; }));
  setTimeout(() => ov.remove(), 1000);
}
// 앱을 켜둔 채로도 정시 경계에서 낮→노을→밤이 바뀌게(날씨 재요청 없이 모드만 재적용).
function refreshSky() {
  if (!lastWxCat) return;
  const m = skyModeNow();
  if (m !== lastSkyMode) applySky(lastWxCat, m);
}
// 오늘 화면 히어로 대시보드 배경을 '현재 날씨+시각'으로 칠하고, 좌상단에 현재 날씨를 참고 표기.
async function loadWeather() {
  const hero = $('todayHero'), fx = $('wxFx'), ref = $('wxRef');
  if (!hero) return;
  const CATS = ['w-clear', 'w-cloud', 'w-rain', 'w-snow', 'w-storm'];
  try {
    const w = await (await fetch('/api/weather')).json();
    const cur = w && w.ok && w.current;
    if (!cur) { hero.classList.remove('has-wx', 'wx-night', 'wx-dusk', 'wx-dawn', ...CATS); if (fx) fx.innerHTML = ''; if (ref) ref.hidden = true; lastWxCat = null; return; }
    const cat = wmoCategory(cur.code);
    applySky(cat, skyModeNow());
    if (ref) { ref.innerHTML = `<b>${cur.temp}°</b><em>${esc(wmoDesc(cur.code))}</em><small>강수 ${cur.pop}%</small>`; ref.hidden = false; }
  } catch { /* 실패 시 기존 배경 유지 */ }
}

// ── 응원 한 줄(수호천사 아이/걱정 많은 엄마 · 존댓말) — 히어로 하단 ──
//  서버가 '장면(scene)'별로 문구 풀을 캐시. 여기선 그 풀에서 최근 것 제외하고 하나만 표시.
//  30초 폴링에도 안 깜빡이게: 풀(key)이 바뀔 때만 새로 뽑고, 앱을 다시 열 때(가시성 복귀)만 새 문구로 교체.
const CHEER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.8 H20 a2.2 2.2 0 0 1 2.2 2.2 V14 a2.2 2.2 0 0 1-2.2 2.2 H10.5 L6 20 V16.2 H4 a2.2 2.2 0 0 1-2.2-2.2 V7 A2.2 2.2 0 0 1 4 4.8 Z" fill="#8ac6a1"/><path d="M12 8.6 C11.3 7.6, 9.5 7.7, 9.5 9.2 C9.5 10.4, 12 11.9, 12 11.9 C12 11.9, 14.5 10.4, 14.5 9.2 C14.5 7.7, 12.7 7.6, 12 8.6 Z" fill="#fff"/></svg>';
let cheerPool = [], cheerKey = null, cheerShown = false;
async function loadCheer(forcePick = false) {
  const el = $('heroCheer'); if (!el) return;
  let key = null, lines = [];
  try { const r = await (await fetch('/api/cheer')).json(); if (r && r.ok) { key = r.key; lines = Array.isArray(r.lines) ? r.lines : []; } } catch { /* 무시 */ }
  const changed = key !== cheerKey;
  cheerPool = lines; cheerKey = key;
  if (!lines.length) { el.hidden = true; el.innerHTML = ''; cheerShown = false; return; }
  if (changed || forcePick || !cheerShown) pickCheer();
}
function pickCheer() {
  const el = $('heroCheer'); if (!el || !cheerPool.length) return;
  const last = localStorage.getItem('cheerLast') || '';
  let pool = cheerPool.filter((l) => l !== last);
  if (!pool.length) pool = cheerPool;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  localStorage.setItem('cheerLast', pick);
  el.innerHTML = `<span class="ic">${CHEER_ICON}</span><span>${esc(pick)}</span>`;
  el.hidden = false; cheerShown = true;
}
// 앱을 다시 볼 때마다 새 한마디(보는 도중엔 유지).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  loadCheer(true);
  if (offTitleActive) setOffTitle(nextOffTitle(), true); // 재진입 시 휴무 제목도 새로
});

// 오늘 휴무일 때 히어로 제목 — 10문구 랜덤, 진입/재진입/일정시간마다 아래→위 슬라이드로 교체.
const OFF_TITLES = [
  '오늘은 온전히 당신의 하루예요',
  '잘 달려온 당신에게 주는 쉼표',
  '오늘 코스는 잠시 내려놓아도 돼요',
  '오늘은 페어웨이 대신 쉼표 하나',
  '푹 쉬어요, 그게 오늘 할 일이에요',
  '오늘은 걸음을 멈춰도 되는 날',
  '내일을 위해 잠시 숨 고르는 날',
  '오늘만큼은 당신을 먼저 챙겨요',
  '카트도 캐디백도 오늘은 쉬어가요',
  '수고한 당신, 오늘은 마음껏 쉬어요',
];
const OFF_ROTATE_MS = 300000;  // 5분마다 교체(보는 도중)
let offTitleActive = false, offTitleTimer = null, offTitleCur = '';
function nextOffTitle() {
  const last = offTitleCur || localStorage.getItem('offTitleLast') || '';
  let pool = OFF_TITLES.filter((tt) => tt !== last);
  if (!pool.length) pool = OFF_TITLES;
  return pool[Math.floor(Math.random() * pool.length)];
}
function setOffTitle(text, animate) {
  const el = $('heroTitle'); if (!el) return;
  offTitleCur = text;
  try { localStorage.setItem('offTitleLast', text); } catch (_) {}
  if (!animate || !el.querySelector('.tt')) {
    el.innerHTML = `<span class="tt">${esc(text)}</span>`; return;
  }
  // ★이전 전환이 안 끝나 남은 스트래글러 제거 — 가장 최근 것만 out으로 남긴다(문구가 쌓이던 버그 방지).
  const spans = el.querySelectorAll('.tt');
  for (let i = 0; i < spans.length - 1; i++) spans[i].remove();
  const out = el.querySelector('.tt');
  const inc = document.createElement('span');
  inc.className = 'tt enter';
  inc.textContent = text;
  el.appendChild(inc);
  void inc.offsetWidth;                 // 시작 상태 확정
  out.classList.add('leave');           // 기존 문구: 위로 빠짐
  inc.classList.remove('enter');        // 새 문구: 아래→제자리
  setTimeout(() => { if (out.parentNode) out.remove(); }, 520);
}
function startOffTitle() {
  if (!offTitleActive) { offTitleActive = true; setOffTitle(nextOffTitle(), false); }
  if (!offTitleTimer) {
    offTitleTimer = setInterval(() => {
      if (!document.hidden && offTitleActive) setOffTitle(nextOffTitle(), true);
    }, OFF_ROTATE_MS);
  }
}
function stopOffTitle() {
  offTitleActive = false;
  if (offTitleTimer) { clearInterval(offTitleTimer); offTitleTimer = null; }
}

// 휴무 코스 일러스트 — 카드 바닥까지 꽉 차는 언덕(풀블리드) + 깃발. 하늘은 기존 날씨 배경 재사용.
//  ★깃발: 폴대 쪽(왼쪽)은 고정, 자유단(오른쪽)이 물결치는 SMIL 부드러운 모프(펄럭). 자연스럽고 끊김 없음.
//   '한 사이클 후 정지' 버그는 renderBoard가 이미 뜬 off-course를 다시 안 꽂게 해 해결(SVG를 안 갈아치움 → SMIL 지속).
// 진행파 나부낌 — 폴대(x9) 고정, S자 주름이 폴대→자유단으로 흘러가며 끝단이 뒤늦게 펄럭.
//  전체가 한꺼번에 늘었다 줄었다(고무 느낌) 대신 물결이 지나가도록 24위상을 등속 보간(선형)으로 재생.
//  offwavegen.cjs 산출(XS 9..33, cloth y8~18, 진폭 3.1, 위상 1.9π).
const OFF_WAVE = [
  'M9 8C9.66 8.06 11.66 8.2 12.98 8.33C14.31 8.46 15.59 8.82 16.93 8.8C18.26 8.78 19.67 8.59 20.97 8.22C22.27 7.84 23.49 7 24.73 6.55C25.97 6.11 27.1 5.49 28.43 5.57C29.77 5.65 32.02 6.8 32.73 7.04L32.73 17.04C32.02 16.8 29.77 15.65 28.43 15.57C27.1 15.49 25.97 16.11 24.73 16.55C23.49 17 22.27 17.84 20.97 18.22C19.67 18.59 18.26 18.78 16.93 18.8C15.59 18.82 14.31 18.46 12.98 18.33C11.66 18.2 9.66 18.06 9 18Z',
  'M9 8C9.66 8.04 11.67 8.12 12.99 8.26C14.31 8.41 15.6 8.81 16.92 8.87C18.24 8.92 19.61 8.89 20.92 8.57C22.23 8.25 23.55 7.45 24.8 6.94C26.05 6.43 27.13 5.59 28.41 5.49C29.7 5.38 31.84 6.17 32.53 6.31L32.53 16.31C31.84 16.17 29.7 15.38 28.41 15.49C27.13 15.59 26.05 16.43 24.8 16.94C23.55 17.45 22.23 18.25 20.92 18.57C19.61 18.89 18.24 18.92 16.92 18.87C15.6 18.81 14.31 18.41 12.99 18.26C11.67 18.12 9.66 18.04 9 18Z',
  'M9 8C9.67 8.03 11.67 8.03 12.99 8.18C14.31 8.32 15.6 8.75 16.92 8.87C18.23 8.99 19.55 9.12 20.88 8.88C22.21 8.63 23.63 7.95 24.89 7.4C26.15 6.85 27.19 5.86 28.43 5.57C29.68 5.29 31.7 5.68 32.35 5.7L32.35 15.7C31.7 15.68 29.68 15.29 28.43 15.57C27.19 15.86 26.15 16.85 24.89 17.4C23.63 17.95 22.21 18.63 20.88 18.88C19.55 19.12 18.23 18.99 16.92 18.87C15.6 18.75 14.31 18.32 12.99 18.18C11.67 18.03 9.67 18.03 9 18Z',
  'M9 8C9.67 8.01 11.68 7.95 13 8.08C14.32 8.22 15.62 8.64 16.92 8.82C18.23 8.99 19.5 9.28 20.84 9.13C22.18 8.98 23.71 8.45 24.98 7.9C26.26 7.35 27.28 6.27 28.49 5.82C29.7 5.38 31.6 5.34 32.23 5.24L32.23 15.24C31.6 15.34 29.7 15.38 28.49 15.82C27.28 16.27 26.26 17.35 24.98 17.9C23.71 18.45 22.18 18.98 20.84 19.13C19.5 19.28 18.23 18.99 16.92 18.82C15.62 18.64 14.32 18.22 13 18.08C11.68 17.95 9.67 18.01 9 18Z',
  'M9 8C9.67 8 11.68 7.86 13 7.98C14.32 8.1 15.63 8.49 16.93 8.71C18.24 8.93 19.49 9.35 20.82 9.3C22.15 9.25 23.63 8.92 24.92 8.4C26.22 7.89 27.38 6.8 28.59 6.22C29.79 5.65 31.56 5.18 32.15 4.97L32.15 14.97C31.56 15.18 29.79 15.65 28.59 16.22C27.38 16.8 26.22 17.89 24.92 18.4C23.63 18.92 22.15 19.25 20.82 19.3C19.49 19.35 18.24 18.93 16.93 18.71C15.63 18.49 14.32 18.1 13 17.98C11.68 17.86 9.67 18 9 18Z',
  'M9 8C9.67 7.98 11.67 7.79 12.99 7.88C14.32 7.97 15.65 8.3 16.95 8.55C18.25 8.8 19.49 9.33 20.81 9.39C22.12 9.44 23.52 9.32 24.84 8.88C26.15 8.44 27.49 7.41 28.71 6.74C29.92 6.08 31.56 5.21 32.13 4.9L32.13 14.9C31.56 15.21 29.92 16.08 28.71 16.74C27.49 17.41 26.15 18.44 24.84 18.88C23.52 19.32 22.12 19.44 20.81 19.39C19.49 19.33 18.25 18.8 16.95 18.55C15.65 18.3 14.32 17.97 12.99 17.88C11.67 17.79 9.67 17.98 9 18Z',
  'M9 8C9.66 7.96 11.66 7.73 12.99 7.78C14.32 7.84 15.66 8.09 16.97 8.36C18.27 8.62 19.51 9.22 20.81 9.38C22.11 9.54 23.42 9.64 24.76 9.3C26.1 8.96 27.61 8.06 28.85 7.35C30.08 6.64 31.62 5.43 32.17 5.05L32.17 15.05C31.62 15.43 30.08 16.64 28.85 17.35C27.61 18.06 26.1 18.96 24.76 19.3C23.42 19.64 22.11 19.54 20.81 19.38C19.51 19.22 18.27 18.62 16.97 18.36C15.66 18.09 14.32 17.84 12.99 17.78C11.66 17.73 9.66 17.96 9 18Z',
  'M9 8C9.66 7.95 11.66 7.68 12.99 7.71C14.32 7.73 15.68 7.88 16.99 8.14C18.29 8.4 19.54 9.03 20.82 9.28C22.11 9.53 23.33 9.84 24.7 9.63C26.06 9.42 27.74 8.71 29 8C30.26 7.29 31.73 5.83 32.27 5.4L32.27 15.4C31.73 15.83 30.26 17.29 29 18C27.74 18.71 26.06 19.42 24.7 19.63C23.33 19.84 22.11 19.53 20.82 19.28C19.54 19.03 18.29 18.4 16.99 18.14C15.68 17.88 14.32 17.73 12.99 17.71C11.66 17.68 9.66 17.95 9 18Z',
  'M9 8C9.66 7.94 11.65 7.66 12.98 7.65C14.32 7.63 15.68 7.67 16.99 7.91C18.3 8.15 19.57 8.76 20.85 9.09C22.13 9.41 23.32 9.92 24.65 9.85C25.99 9.78 27.55 9.3 28.85 8.65C30.14 8 31.82 6.38 32.42 5.93L32.42 15.93C31.82 16.38 30.14 18 28.85 18.65C27.55 19.3 25.99 19.78 24.65 19.85C23.32 19.92 22.13 19.41 20.85 19.09C19.57 18.76 18.3 18.15 16.99 17.91C15.68 17.67 14.32 17.63 12.98 17.65C11.65 17.66 9.66 17.94 9 18Z',
  'M9 8C9.66 7.94 11.65 7.67 12.98 7.61C14.31 7.56 15.65 7.48 16.97 7.69C18.29 7.89 19.61 8.45 20.89 8.82C22.16 9.2 23.33 9.87 24.64 9.94C25.94 10.01 27.38 9.82 28.71 9.26C30.03 8.7 31.96 7.04 32.61 6.59L32.61 16.59C31.96 17.04 30.03 18.7 28.71 19.26C27.38 19.82 25.94 20.01 24.64 19.94C23.33 19.87 22.16 19.2 20.89 18.82C19.61 18.45 18.29 17.89 16.97 17.69C15.65 17.48 14.31 17.56 12.98 17.61C11.65 17.67 9.66 17.94 9 18Z',
  'M9 8C9.66 7.93 11.66 7.69 12.98 7.61C14.31 7.52 15.63 7.34 16.95 7.48C18.28 7.63 19.65 8.1 20.93 8.5C22.21 8.9 23.37 9.69 24.64 9.9C25.92 10.12 27.22 10.2 28.59 9.78C29.95 9.35 32.11 7.76 32.82 7.36L32.82 17.36C32.11 17.76 29.95 19.35 28.59 19.78C27.22 20.2 25.92 20.12 24.64 19.9C23.37 19.69 22.21 18.9 20.93 18.5C19.65 18.1 18.28 17.63 16.95 17.48C15.63 17.34 14.31 17.52 12.98 17.61C11.66 17.69 9.66 17.93 9 18Z',
  'M9 8C9.66 7.94 11.66 7.74 12.98 7.62C14.31 7.51 15.6 7.23 16.94 7.32C18.27 7.41 19.69 7.74 20.98 8.15C22.27 8.55 23.42 9.39 24.68 9.73C25.93 10.07 27.11 10.44 28.49 10.18C29.87 9.92 32.21 8.5 32.95 8.16L32.95 18.16C32.21 18.5 29.87 19.92 28.49 20.18C27.11 20.44 25.93 20.07 24.68 19.73C23.42 19.39 22.27 18.55 20.98 18.15C19.69 17.74 18.27 17.41 16.94 17.32C15.6 17.23 14.31 17.51 12.98 17.62C11.66 17.74 9.66 17.94 9 18Z',
  'M9 8C9.66 7.94 11.66 7.8 12.98 7.67C14.31 7.54 15.59 7.18 16.93 7.2C18.26 7.22 19.67 7.41 20.97 7.78C22.27 8.16 23.49 9 24.73 9.45C25.97 9.89 27.1 10.51 28.43 10.43C29.77 10.35 32.02 9.2 32.73 8.96L32.73 18.96C32.02 19.2 29.77 20.35 28.43 20.43C27.1 20.51 25.97 19.89 24.73 19.45C23.49 19 22.27 18.16 20.97 17.78C19.67 17.41 18.26 17.22 16.93 17.2C15.59 17.18 14.31 17.54 12.98 17.67C11.66 17.8 9.66 17.94 9 18Z',
  'M9 8C9.66 7.96 11.67 7.88 12.99 7.74C14.31 7.59 15.6 7.19 16.92 7.13C18.24 7.08 19.61 7.11 20.92 7.43C22.23 7.75 23.55 8.55 24.8 9.06C26.05 9.57 27.13 10.41 28.41 10.51C29.7 10.62 31.84 9.83 32.53 9.69L32.53 19.69C31.84 19.83 29.7 20.62 28.41 20.51C27.13 20.41 26.05 19.57 24.8 19.06C23.55 18.55 22.23 17.75 20.92 17.43C19.61 17.11 18.24 17.08 16.92 17.13C15.6 17.19 14.31 17.59 12.99 17.74C11.67 17.88 9.66 17.96 9 18Z',
  'M9 8C9.67 7.97 11.67 7.97 12.99 7.82C14.31 7.68 15.6 7.25 16.92 7.13C18.23 7.01 19.55 6.88 20.88 7.12C22.21 7.37 23.63 8.05 24.89 8.6C26.15 9.15 27.19 10.14 28.43 10.43C29.68 10.71 31.7 10.32 32.35 10.3L32.35 20.3C31.7 20.32 29.68 20.71 28.43 20.43C27.19 20.14 26.15 19.15 24.89 18.6C23.63 18.05 22.21 17.37 20.88 17.12C19.55 16.88 18.23 17.01 16.92 17.13C15.6 17.25 14.31 17.68 12.99 17.82C11.67 17.97 9.67 17.97 9 18Z',
  'M9 8C9.67 7.99 11.68 8.05 13 7.92C14.32 7.78 15.62 7.36 16.92 7.18C18.23 7.01 19.5 6.72 20.84 6.87C22.18 7.02 23.71 7.55 24.98 8.1C26.26 8.65 27.28 9.73 28.49 10.18C29.7 10.62 31.6 10.66 32.23 10.76L32.23 20.76C31.6 20.66 29.7 20.62 28.49 20.18C27.28 19.73 26.26 18.65 24.98 18.1C23.71 17.55 22.18 17.02 20.84 16.87C19.5 16.72 18.23 17.01 16.92 17.18C15.62 17.36 14.32 17.78 13 17.92C11.68 18.05 9.67 17.99 9 18Z',
  'M9 8C9.67 8 11.68 8.14 13 8.02C14.32 7.9 15.63 7.51 16.93 7.29C18.24 7.07 19.49 6.65 20.82 6.7C22.15 6.75 23.63 7.08 24.92 7.6C26.22 8.11 27.38 9.2 28.59 9.78C29.79 10.35 31.56 10.82 32.15 11.03L32.15 21.03C31.56 20.82 29.79 20.35 28.59 19.78C27.38 19.2 26.22 18.11 24.92 17.6C23.63 17.08 22.15 16.75 20.82 16.7C19.49 16.65 18.24 17.07 16.93 17.29C15.63 17.51 14.32 17.9 13 18.02C11.68 18.14 9.67 18 9 18Z',
  'M9 8C9.67 8.02 11.67 8.21 12.99 8.12C14.32 8.03 15.65 7.7 16.95 7.45C18.25 7.2 19.49 6.67 20.81 6.61C22.12 6.56 23.52 6.68 24.84 7.12C26.15 7.56 27.49 8.59 28.71 9.26C29.92 9.92 31.56 10.79 32.13 11.1L32.13 21.1C31.56 20.79 29.92 19.92 28.71 19.26C27.49 18.59 26.15 17.56 24.84 17.12C23.52 16.68 22.12 16.56 20.81 16.61C19.49 16.67 18.25 17.2 16.95 17.45C15.65 17.7 14.32 18.03 12.99 18.12C11.67 18.21 9.67 18.02 9 18Z',
  'M9 8C9.66 8.04 11.66 8.27 12.99 8.22C14.32 8.16 15.66 7.91 16.97 7.64C18.27 7.38 19.51 6.78 20.81 6.62C22.11 6.46 23.42 6.36 24.76 6.7C26.1 7.04 27.61 7.94 28.85 8.65C30.08 9.36 31.62 10.57 32.17 10.95L32.17 20.95C31.62 20.57 30.08 19.36 28.85 18.65C27.61 17.94 26.1 17.04 24.76 16.7C23.42 16.36 22.11 16.46 20.81 16.62C19.51 16.78 18.27 17.38 16.97 17.64C15.66 17.91 14.32 18.16 12.99 18.22C11.66 18.27 9.66 18.04 9 18Z',
  'M9 8C9.66 8.05 11.66 8.32 12.99 8.29C14.32 8.27 15.68 8.12 16.99 7.86C18.29 7.6 19.54 6.97 20.82 6.72C22.11 6.47 23.33 6.16 24.7 6.37C26.06 6.58 27.74 7.29 29 8C30.26 8.71 31.73 10.17 32.27 10.6L32.27 20.6C31.73 20.17 30.26 18.71 29 18C27.74 17.29 26.06 16.58 24.7 16.37C23.33 16.16 22.11 16.47 20.82 16.72C19.54 16.97 18.29 17.6 16.99 17.86C15.68 18.12 14.32 18.27 12.99 18.29C11.66 18.32 9.66 18.05 9 18Z',
  'M9 8C9.66 8.06 11.65 8.34 12.98 8.35C14.32 8.37 15.68 8.33 16.99 8.09C18.3 7.85 19.57 7.24 20.85 6.91C22.13 6.59 23.32 6.08 24.65 6.15C25.99 6.22 27.55 6.7 28.85 7.35C30.14 8 31.82 9.62 32.42 10.07L32.42 20.07C31.82 19.62 30.14 18 28.85 17.35C27.55 16.7 25.99 16.22 24.65 16.15C23.32 16.08 22.13 16.59 20.85 16.91C19.57 17.24 18.3 17.85 16.99 18.09C15.68 18.33 14.32 18.37 12.98 18.35C11.65 18.34 9.66 18.06 9 18Z',
  'M9 8C9.66 8.06 11.65 8.33 12.98 8.39C14.31 8.44 15.65 8.52 16.97 8.31C18.29 8.11 19.61 7.55 20.89 7.18C22.16 6.8 23.33 6.13 24.64 6.06C25.94 5.99 27.38 6.18 28.71 6.74C30.03 7.3 31.96 8.96 32.61 9.41L32.61 19.41C31.96 18.96 30.03 17.3 28.71 16.74C27.38 16.18 25.94 15.99 24.64 16.06C23.33 16.13 22.16 16.8 20.89 17.18C19.61 17.55 18.29 18.11 16.97 18.31C15.65 18.52 14.31 18.44 12.98 18.39C11.65 18.33 9.66 18.06 9 18Z',
  'M9 8C9.66 8.07 11.66 8.31 12.98 8.39C14.31 8.48 15.63 8.66 16.95 8.52C18.28 8.37 19.65 7.9 20.93 7.5C22.21 7.1 23.37 6.31 24.64 6.1C25.92 5.88 27.22 5.8 28.59 6.22C29.95 6.65 32.11 8.24 32.82 8.64L32.82 18.64C32.11 18.24 29.95 16.65 28.59 16.22C27.22 15.8 25.92 15.88 24.64 16.1C23.37 16.31 22.21 17.1 20.93 17.5C19.65 17.9 18.28 18.37 16.95 18.52C15.63 18.66 14.31 18.48 12.98 18.39C11.66 18.31 9.66 18.07 9 18Z',
  'M9 8C9.66 8.06 11.66 8.26 12.98 8.38C14.31 8.49 15.6 8.77 16.94 8.68C18.27 8.59 19.69 8.26 20.98 7.85C22.27 7.45 23.42 6.61 24.68 6.27C25.93 5.93 27.11 5.56 28.49 5.82C29.87 6.08 32.21 7.5 32.95 7.84L32.95 17.84C32.21 17.5 29.87 16.08 28.49 15.82C27.11 15.56 25.93 15.93 24.68 16.27C23.42 16.61 22.27 17.45 20.98 17.85C19.69 18.26 18.27 18.59 16.94 18.68C15.6 18.77 14.31 18.49 12.98 18.38C11.66 18.26 9.66 18.06 9 18Z',
];
OFF_WAVE.push(OFF_WAVE[0]);  // 마지막→처음 위상까지 이어 재생해 루프 이음매 제거(끊김 방지)
const OFF_WAVE_KEYTIMES = OFF_WAVE.map((_, i) => (i / (OFF_WAVE.length - 1)).toFixed(4)).join(';');
// ── 미니 골프 카트 레이어 — 병가·휴무 보드의 언덕 능선(far-hill 상단선)을 따라 지나가는 카트. ──
//  낮/밤 두 벌을 함께 넣고 CSS(.hero.wx-night)로 토글. prefers-reduced-motion이면 CSS로 숨김.
//  경로=능선과 동일 곡선(양끝 접선 연속). 오르막 감속·내리막 가속(keyPoints/keyTimes), 살짝 통통(bounce), 능선 접선 회전(rotate=auto).
const CART_MOTION = '<animateMotion dur="15s" repeatCount="indefinite" rotate="auto" calcMode="linear"'
  + ' keyPoints="0;0.0851;0.1489;0.2128;0.2766;0.3404;0.4043;0.4681;0.5319;0.5957;0.6596;0.7234;0.7872;0.8511;0.9149;1"'
  + ' keyTimes="0;0.0818;0.1568;0.2281;0.2959;0.3604;0.4218;0.4803;0.536;0.5914;0.6493;0.71;0.7743;0.8433;0.9182;1"'
  + ' path="M-40 76.2 L0 66 Q110 38 210 54 Q310 70 390 48 L430 37"/>';
const CART_BOUNCE = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.3;0 .2;0 -.9;0 0" dur=".5s" repeatCount="indefinite" additive="sum"/>';
const CART_DAY = '<rect x="-25" y="-23" width="6.6" height="14.6" rx="2.4" fill="#2f7d55"/><rect x="-24.2" y="-16" width="4.6" height="3.6" rx="1" fill="#256444"/>'
  + '<g stroke="#c2a86e" stroke-width="1" stroke-linecap="round"><line x1="-23.6" y1="-22" x2="-24.6" y2="-31"/><line x1="-21.8" y1="-22.4" x2="-21.8" y2="-32"/><line x1="-20" y1="-22" x2="-19" y2="-30.6"/></g>'
  + '<circle cx="-24.6" cy="-31" r="1.1" fill="#e2e7ea"/><circle cx="-21.8" cy="-32" r="1.1" fill="#e2e7ea"/><circle cx="-19" cy="-30.6" r="1.1" fill="#e2e7ea"/>'
  + '<rect x="-17" y="-30.4" width="39" height="3.6" rx="1.8" fill="#4fae7f"/><path d="M21 -30 L24.5 -29.2 L24.5 -27.4 L21 -26.6 Z" fill="#4fae7f"/>'
  + '<rect x="-15.6" y="-28" width="1.9" height="12.2" rx=".95" fill="#d7e4db"/><rect x="17.6" y="-28" width="1.9" height="10.5" rx=".95" fill="#d7e4db"/>'
  + '<path d="M-18 -8 L-18 -14 Q-18 -17 -15 -17 L14 -17 Q17 -17 18.6 -14.6 L24 -12 Q25.6 -11.2 25.6 -9.5 L25.6 -8.4 Q25.6 -7 24 -7 L-16.4 -7 Q-18 -7 -18 -8 Z" fill="#fbfdfb"/>'
  + '<rect x="-18" y="-9.3" width="43.6" height="1.8" rx=".9" fill="#3f9e73"/>'
  + '<rect x="-16" y="-25.6" width="3.7" height="9.7" rx="1.6" fill="#e7d9bd"/><rect x="-14.6" y="-18.6" width="15.2" height="3.5" rx="1.4" fill="#e7d9bd"/><rect x="-14.6" y="-16.4" width="15.2" height="1" rx=".5" fill="#d8c39f"/>'
  + '<line x1="11.5" y1="-16.5" x2="15.5" y2="-20.8" stroke="#cfd8d0" stroke-width="1.1" stroke-linecap="round"/><circle cx="16" cy="-21.2" r="1.7" fill="none" stroke="#cfd8d0" stroke-width="1"/>'
  + '<circle cx="24.7" cy="-10.4" r="1.1" fill="#ffdf86"/>'
  + '<circle cx="-11" cy="-5.1" r="5.1" fill="#374a41"/><circle cx="-11" cy="-5.1" r="2.5" fill="#cfe0d5"/><circle cx="-11" cy="-5.1" r=".9" fill="#374a41"/>'
  + '<circle cx="16" cy="-5.1" r="5.1" fill="#374a41"/><circle cx="16" cy="-5.1" r="2.5" fill="#cfe0d5"/><circle cx="16" cy="-5.1" r=".9" fill="#374a41"/>';
const CART_NIGHT = '<defs><radialGradient id="gcBeam" cx=".5" cy=".5" r=".5" fx=".2" fy=".5"><stop offset="0" stop-color="#fff1b6" stop-opacity=".8"/><stop offset=".4" stop-color="#ffe38f" stop-opacity=".34"/><stop offset="1" stop-color="#ffdf86" stop-opacity="0"/></radialGradient>'
  + '<filter id="gcBeamBlur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.7"/></filter>'
  + '<radialGradient id="gcHl"><stop offset="0" stop-color="#fff6cc" stop-opacity=".95"/><stop offset="1" stop-color="#fff6cc" stop-opacity="0"/></radialGradient></defs>'
  + '<g filter="url(#gcBeamBlur)" transform="rotate(7 24.7 -10.4)"><ellipse cx="42" cy="-9.6" rx="25" ry="6.4" fill="url(#gcBeam)"/><ellipse cx="33" cy="-9.8" rx="12" ry="3.6" fill="#fff2b8" opacity=".42"/></g>'
  + '<rect x="-25" y="-23" width="6.6" height="14.6" rx="2.4" fill="#2f7d55"/><rect x="-24.2" y="-16" width="4.6" height="3.6" rx="1" fill="#215c3e"/>'
  + '<g stroke="#c2a86e" stroke-width="1" stroke-linecap="round"><line x1="-23.6" y1="-22" x2="-24.6" y2="-31"/><line x1="-21.8" y1="-22.4" x2="-21.8" y2="-32"/><line x1="-20" y1="-22" x2="-19" y2="-30.6"/></g>'
  + '<circle cx="-24.6" cy="-31" r="1.1" fill="#cdd6dc"/><circle cx="-21.8" cy="-32" r="1.1" fill="#cdd6dc"/><circle cx="-19" cy="-30.6" r="1.1" fill="#cdd6dc"/>'
  + '<rect x="-17" y="-30.4" width="39" height="3.6" rx="1.8" fill="#57b98a"/><path d="M21 -30 L24.5 -29.2 L24.5 -27.4 L21 -26.6 Z" fill="#57b98a"/>'
  + '<rect x="-15.6" y="-28" width="1.9" height="12.2" rx=".95" fill="#7f9f8f"/><rect x="17.6" y="-28" width="1.9" height="10.5" rx=".95" fill="#7f9f8f"/>'
  + '<path d="M-18 -8 L-18 -14 Q-18 -17 -15 -17 L14 -17 Q17 -17 18.6 -14.6 L24 -12 Q25.6 -11.2 25.6 -9.5 L25.6 -8.4 Q25.6 -7 24 -7 L-16.4 -7 Q-18 -7 -18 -8 Z" fill="#e9f2ea"/>'
  + '<rect x="-18" y="-9.3" width="43.6" height="1.8" rx=".9" fill="#4fae7f"/>'
  + '<rect x="-16" y="-25.6" width="3.7" height="9.7" rx="1.6" fill="#d6c8aa"/><rect x="-14.6" y="-18.6" width="15.2" height="3.5" rx="1.4" fill="#d6c8aa"/><rect x="-14.6" y="-16.4" width="15.2" height="1" rx=".5" fill="#c0af8e"/>'
  + '<line x1="11.5" y1="-16.5" x2="15.5" y2="-20.8" stroke="#9fb0a4" stroke-width="1.1" stroke-linecap="round"/><circle cx="16" cy="-21.2" r="1.7" fill="none" stroke="#9fb0a4" stroke-width="1"/>'
  + '<circle cx="-11" cy="-5.1" r="5.1" fill="#22322b"/><circle cx="-11" cy="-5.1" r="2.5" fill="#bcd3c4"/><circle cx="-11" cy="-5.1" r=".9" fill="#22322b"/>'
  + '<circle cx="16" cy="-5.1" r="5.1" fill="#22322b"/><circle cx="16" cy="-5.1" r="2.5" fill="#bcd3c4"/><circle cx="16" cy="-5.1" r=".9" fill="#22322b"/>'
  + '<circle cx="24.7" cy="-10.4" r="3.6" fill="url(#gcHl)"/><circle cx="24.7" cy="-10.4" r="1.5" fill="#fff4c2"/>';
function cartLayerSVG() {
  const wrap = (cls, shapes) => `<g class="${cls}">${CART_MOTION}<g transform="scale(0.5) translate(0,1.3)"><g>${CART_BOUNCE}${shapes}</g></g></g>`;
  return wrap('gc-day', CART_DAY) + wrap('gc-night', CART_NIGHT);
}

function offCourseHTML() {
  const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wave = rm ? '' : `<animate attributeName="d" dur="3.4s" repeatCount="indefinite" calcMode="linear"
      keyTimes="${OFF_WAVE_KEYTIMES}" values="${OFF_WAVE.join(';')}"/>`;
  return `<div class="off-course">
    <svg class="oc-hills" viewBox="0 0 390 200" preserveAspectRatio="none" aria-hidden="true">
      <path class="hill-far" d="M0 66 Q110 38 210 54 T390 48 V200 H0 Z"/>
      <path class="hill-near" d="M0 104 Q140 72 260 90 T390 84 V200 H0 Z"/>
      ${cartLayerSVG()}
    </svg>
    <svg class="oc-flag" viewBox="0 0 44 60" aria-hidden="true">
      <ellipse class="ftuft" cx="9" cy="55" rx="12" ry="3.4"/>
      <line class="fp" x1="9" y1="8" x2="9" y2="55" stroke-width="2.6" stroke-linecap="round"/>
      <circle class="fpc" cx="9" cy="9.5" r="1.8"/>
      <path class="fcloth" fill="#c85449" d="${OFF_WAVE[0]}">${wave}</path>
    </svg>
  </div>`;
}

// 병가 — 앱의 언덕·깃발 장면(off-course)을 그대로 쓰되 깃발을 '초록 십자(케어 깃발)'로 바꾼 보드.
//  언덕·깃발은 공용 클래스(.oc-hills/.oc-flag)를 재사용 → 날씨 배경·밤(어두운 언덕·밝은 깃발)·노을/새벽(지면 숨김) 규칙이 그대로 적용됨.
function sickBoardHTML() {
  return `<div class="off-sick">
    <svg class="oc-hills" viewBox="0 0 390 200" preserveAspectRatio="none" aria-hidden="true">
      <path class="hill-far" d="M0 66 Q110 38 210 54 T390 48 V200 H0 Z"/>
      <path class="hill-near" d="M0 104 Q140 72 260 90 T390 84 V200 H0 Z"/>
      ${cartLayerSVG()}
    </svg>
    <svg class="sick-flag" viewBox="0 0 70 84" aria-hidden="true">
      <line class="fp" x1="35" y1="40" x2="35" y2="80" stroke-width="2.8" stroke-linecap="round"/>
      <circle class="sign-ring" cx="35" cy="22" r="18"/>
      <circle class="sign-face" cx="35" cy="22" r="13"/>
      <rect class="sign-cross" x="31.5" y="13" width="7" height="18" rx="2"/>
      <rect class="sign-cross" x="25" y="19" width="20" height="7" rx="2"/>
    </svg>
  </div>`;
}

// 순번 제외(off:removed) — 이전엔 배치표에 있었는데 최신 판에서 이름이 사라짐(사유 미상).
//  쉼·사유를 단정하지 않고 '사실만'. 날씨 배경 위 글래스 카드 + 은은한 언덕 스트립(노을/새벽엔 CSS로 숨김).
function removedBoardHTML(s) {
  const prev = Number(s.prevPosition) || 0;
  const line = prev > 0
    ? `<span class="rm-chip">순번 ${prev}번</span><span class="rm-arrow">→</span>최신 배치표에서 제외`
    : '최신 배치표에서 순번이 빠졌어요';
  return `<div class="rm-scene">
    <svg class="oc-hills" viewBox="0 0 390 132" preserveAspectRatio="none" aria-hidden="true">
      <path class="hill-far" d="M0 54 Q100 30 200 44 T390 40 V132 H0 Z"/>
      <path class="hill-near" d="M0 80 Q130 58 250 72 T390 66 V132 H0 Z"/>
    </svg>
    <div class="rm-card">
      <div class="rm-h">오늘 배치에서 빠졌어요 <span class="rm-tag">근무 없음</span></div>
      <div class="rm-line">${line}</div>
      <div class="rm-foot"><span class="rm-fi">${REFRESH_SVG}</span><span>배치표에 이름이 다시 오르면 근무 화면으로 바로 돌아와요.</span></div>
    </div>
  </div>`;
}

// 대기(스플래시) 화면 감추기 — 준비되면 페이드아웃. 여러 곳에서 불려도 무해(idempotent).
function hideSplash() { const s = document.getElementById('splash'); if (s) s.classList.add('hide'); }
let _heroEntered = false;   // 실행 등장 모션은 첫 렌더(히어로가 실제 콘텐츠로 채워질 때) 1회만.
let _holdHomeAnim = false;  // ★가입완료 흐름: 오버레이 뒤에서 등장 모션을 낭비하지 않게 보류 → 아이리스 후 수동 재생.
function renderToday(t) {
  if (_holdHomeAnim) { hideSplash(); }   // 스플래시만 내리고 등장 모션은 보류(홈 오브젝트는 home-prep로 숨겨둠)
  else if (!_heroEntered) {
    _heroEntered = true; hideSplash(); document.body.classList.add('anim-play');
    // 실행 등장 모션(reveal·아이리스)은 1회만 — 등장이 끝나면 클래스를 떼서 탭 복귀 때 재생되지 않게 고정.
    setTimeout(() => document.body.classList.remove('anim-play'), 1500);
  }
  if (!t || t.empty || !t.state) {
    if (t && t.stale) {
      $('heroTitle').textContent = '오늘 배치표 확인 중';
      $('heroSub').textContent = t.message || '아직 오늘 배치표를 확보하지 못했어요. 확인되면 바로 갱신됩니다.';
    } else {
      $('heroTitle').textContent = '아직 오늘 정보가 없어요';
      $('heroSub').textContent = '배치표나 3부 소식이 올라오면 여기에 표시됩니다.';
    }
    $('boardSlot').innerHTML = ''; renderRoundsStack(null); return;
  }
  // ── focus(현재 활성 라운드)가 히어로+실시간 게이지를 이끈다 — 부별 동일 수준. ──
  //  3부 단독일: focus=3부=대표 → 실제 t.state/t.commute 그대로(기존과 100% 동일, 회귀 0).
  //  다중 라운드: 아침 1부→저녁 3부로 게이지·제목이 자동 이동. 1·2부 단독일도 같은 리치 게이지.
  const off = Number(t.dayOffset) || 0;
  const rounds = (Array.isArray(t.rounds) ? t.rounds.slice() : []).sort((a, b) => roundOrd(a) - roundOrd(b));
  const focus = pickFocus(t, rounds, off >= 1);
  const s = focus ? focus.state : t.state, st = s.status;
  const commuteV = focus ? focus.commute : t.commute;
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const isSpare = st === 'spare' || st === 'waiting' || st === 'near';
  const posTxt = s.myPosition ? ` · ${s.myPosition}번째` : '';
  // 히어로가 담당하는 부 — focus 라운드의 부(보통 저녁 3부, 아침엔 1·2부).
  const focusPart = focus ? String(focus.part) : String((t.primaryPart) || (s.part ? String(s.part).replace('부', '') : '3'));
  const heroPart = `${focusPart}부`;
  // ★1부 '단독' 근무가 조출이면 '1부(조출)'로 표기(사용자 규칙). 복수 라운드면 그냥 '1부'.
  const soloChulgn = focusPart === '1' && s.assign === 'chulgn' && rounds.length <= 1;
  const heroPfx = soloChulgn ? '1부(조출) ' : (focusPart !== '3') ? `${heroPart} ` : ''; // 비3부 focus면 제목에 부 표기
  const dayW = off <= 0 ? '오늘' : off === 1 ? '내일' : off === 2 ? '모레' : (t.date || `${off}일 뒤`);
  $('heroLabel').textContent = `${dayW} 내 상황`;
  // 근무 '확정'은 티오프가 실제 매칭됐을 때만. 그 전(순번상 근무권)은 '근무 예정'으로 스페어와 구분.
  const isConfirmed = isWork && s.teeTime;
  // ★순번 제외(off:removed) — 이전엔 배치표에 있었는데 최신 판에서 사라짐(사유 미상). 평소 휴무의 시적 쉼 문구 대신 사실만.
  const offRemoved = st === 'off' && s.offReason === 'removed';
  const offSick = st === 'off' && s.offType === 'sick';
  const offVac = st === 'off' && s.offType === 'vacation';
  const offToday = st === 'off' && off < 1 && !offRemoved && !offSick && !offVac;   // 평소 휴무만 랜덤 쉼 문구 로테이션
  if (offToday) {
    startOffTitle();                    // 랜덤 문구 + 슬라이드 로테이션 시작
  } else {
    stopOffTitle();
    $('heroTitle').textContent = st === 'your_turn' ? '지금 출근 차례!'
      : isConfirmed ? `${dayW} ${heroPfx}근무 확정`
      : isWork ? `${dayW} ${heroPfx}근무 예정`
      : offRemoved ? '오늘은 근무가 없어요'
      : offSick ? `${dayW} 병가예요`
      : offVac ? `${dayW} 휴가예요`
      : st === 'off' ? `${dayW} 휴무예요`
      : isSpare ? `${dayW} ${heroPart} 스페어${posTxt}` : '대기 중';
  }
  $('heroSub').textContent = st === 'your_turn' ? '앞 순번이 모두 찼어요. 지금 바로 출근 준비하세요.'
    : (isWork && !s.teeTime) ? '순번상 근무권에 들었어요. 티오프가 매칭되면 시간을 알려드릴게요.'
    : (isWork && off >= 1) ? `${dayW} 근무예요. 아직 여유 있으니 출발 시각을 확인해두세요.`
    : isWork ? '아래 시간에 맞춰 움직이면 됩니다.'
    : offRemoved ? '최신 배치표에서 순번이 빠졌어요.'
    : offSick ? '무리하지 말고 몸부터 잘 회복해요.'
    : offVac ? (off >= 1 ? `${dayW}은 휴가예요. 잘 보내요.` : '오늘은 휴가예요. 잘 보내요.')
    : st === 'off' ? (off >= 1 ? `${dayW}은 예정된 근무가 없어요. 미리 푹 쉬어요.` : '예정된 근무가 없어요. 오늘은 푹 쉬어요.')
    : isSpare ? '아래에서 대기 순번과 확정선을 확인하세요.'
    : '아직 상황이 확정되지 않았어요.';
  // ★부별 동일 수준: focus 라운드의 리치 보드(근무 게이지 or 스페어 순번리스트)를 항상 그린다.
  //  3부 단독일은 focus=대표 → 기존과 동일. 1·2부 단독/다중 라운드도 같은 수준의 보드를 받는다.
  renderBoard({ state: s, commute: commuteV, dayOffset: off, date: (s.date || t.date), part: focusPart });
  renderRoundsStack(t);
}
// ── 하루 흐름(다중 라운드) — 미니맵 + 라운드 사이(현장/자유) + 비대표 라운드 카드 ──
//  ★대표 라운드(히어로)는 위 실시간 게이지가 담당 → 카드는 비대표만(중복 방지). 미니맵엔 전체 라운드.
//   라운드가 하나(단독일)면 숨김 → 히어로만, 기존과 100% 동일(회귀 0).
const PART_KO = { '1': '1부', '2': '2부', '3': '3부' };
const durKo = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), mi = m % 60; return (h ? `${h}시간 ` : '') + (mi || !h ? `${mi}분` : ''); };
const roundOrd = (r) => { const m = toMin(r.teeTime); return m != null ? m : ({ '1': 360, '2': 700, '3': 1027 }[r.part] || 1200); };
const roundEnd = (r) => roundOrd(r) + 150;   // 티오프 + ~2.5h = 종료 근사
// ── focus(현재 활성 라운드) — 히어로·실시간 게이지가 담당할 라운드. 아침엔 1부, 저녁엔 3부로 자동 이동. ──
//  아직 안 끝난 첫 라운드(=지금 향하는 곳). 전부 종료면 마지막 라운드(막 라운드/근무 중 잔상).
function focusIdx(rounds, future) {
  const d = new Date(); const now = d.getHours() * 60 + d.getMinutes();
  let i = rounds.findIndex((r) => future || now < roundEnd(r));
  if (i < 0) i = rounds.length - 1;
  return i;
}
// 라운드 1장 → 대표 상태(state)로 재구성. 비대표 focus 라운드를 대표부처럼 리치 렌더하기 위함.
//  ★대표부 focus는 재구성하지 않고 실제 t.state를 그대로 씀(회귀 0) — pickFocus 참고.
function roundState(r) {
  return {
    part: `${r.part}부`, status: r.status, teeTime: r.teeTime || '', course: r.course || '',
    myPosition: r.myPosition || null, cutLine: r.cutLine || null, cutoffName: r.cutoffName || '',
    roster3: Array.isArray(r.roster3) ? r.roster3 : [], teeGrid: Array.isArray(r.teeGrid) ? r.teeGrid : [],
    assign: r.assign || '', date: r.date || '',
  };
}
// 히어로·게이지가 담당할 focus 라운드 선택. { part, state, commute } 또는 null(라운드 없음=휴무/미상).
//  ★focus가 대표부면 실제 t.state/t.commute를 그대로(기존 3부 경로 100% 보존). 비대표만 재구성.
function pickFocus(t, rounds, future) {
  if (!rounds.length) return null;
  const primary = String((t && t.primaryPart) || '3');
  // ★대표가 휴무(off)면 그날은 쉬는 날 — 비대표 라운드(잘못 잡힌 2부 스페어 등)가 히어로를 뺏지 못하게
  //  실제 근무(work)로 확정된 라운드가 아니면 focus를 포기하고 t.state(휴무)를 그대로 쓴다.
  if (t && t.state && t.state.status === 'off') {
    const w = rounds.find((r) => r.kind === 'work' && r.teeTime);
    if (!w) return null;
    if (String(w.part) === primary) return { part: primary, state: t.state, commute: t.commute };
    return { part: String(w.part), state: roundState(w), commute: w.commute };
  }
  const i = focusIdx(rounds, future);
  const r = rounds[i]; if (!r) return null;
  if (String(r.part) === primary) return { part: String(r.part), state: t.state, commute: t.commute };
  return { part: String(r.part), state: roundState(r), commute: r.commute };
}
function renderRoundsStack(t) {
  const el = $('round2Slot');
  if (!el) return;
  const rounds = (Array.isArray(t && t.rounds) ? t.rounds.slice() : []).sort((a, b) => roundOrd(a) - roundOrd(b));
  if (rounds.length <= 1) { el.hidden = true; el.innerHTML = ''; return; }   // 단독일 → 히어로만(기존 동일)
  const off = Number(t && t.dayOffset) || 0;
  const dayW = off <= 0 ? '오늘' : off === 1 ? '내일' : off === 2 ? '모레' : '';
  const future = off >= 1;
  const d = new Date(); const now = d.getHours() * 60 + d.getMinutes();
  let curIdx = rounds.findIndex((r) => future || now < roundEnd(r));
  if (curIdx < 0) curIdx = rounds.length;   // 전부 종료
  // 히어로 게이지가 담당하는 focus 라운드(= 카드에서 제외해 중복 방지). active 없으면 마지막.
  const focusPart = String((rounds[curIdx] || rounds[rounds.length - 1] || {}).part || (t && t.primaryPart) || '3');

  // 요약(라운드 수·홀) — '탕' 표현 금지
  const works = rounds.filter((r) => r.kind === 'work').length;
  const summary = works >= 2 ? `${dayW} · <b>${works}라운드 · ${works * 18}홀</b>` : `${dayW} 라운드`;

  // 미니맵
  let mini = '<div class="df-map">';
  rounds.forEach((r, i) => {
    const done = !future && now >= roundEnd(r);
    const cur = i === curIdx;
    const sp = r.kind === 'spare';
    const tee = sp ? '대기' : (r.teeTime || '미정');
    mini += `<div class="df-node${done ? ' done' : ''}${cur ? ' cur' : ''}${sp ? ' sp' : ''}"><span class="df-dot">${done ? CHECK_SVG : (i + 1)}</span><span class="df-lbl"><span class="pc${r.part}">${PART_KO[r.part] || ''}</span> ${esc(tee)}</span></div>`;
    if (i < rounds.length - 1) {
      const gm = roundOrd(rounds[i + 1]) - roundEnd(r);
      mini += `<span class="df-link${done ? ' done' : ''}${gm >= 180 ? ' free' : ' onsite'}"></span>`;
    }
  });
  mini += '</div>';

  // 라운드 사이(현재 이전 끝 ~ 다음 시작 전) — 붙음=현장대기 / 뜸=자유시간
  let between = '';
  if (!future && curIdx > 0 && curIdx < rounds.length) {
    const cur = rounds[curIdx], prev = rounds[curIdx - 1];
    const c = cur.commute; const eng = c ? (toMin(c.standby) ?? toMin(c.leave)) : roundOrd(cur);
    if (eng != null && now >= roundEnd(prev) && now < eng) {
      const gm = roundOrd(cur) - roundEnd(prev), free = gm >= 180, left = eng - now;
      between = free
        ? `<div class="df-gap free"><span class="df-gi">${COFFEE_SVG}</span><div class="df-gt"><b>자유시간 · 공백 ${durKo(gm)}</b><span>집에 다녀오거나 근처에서 볼 일 보세요 · 복귀 목표 ${esc(hhmm(eng))}</span></div><div class="df-gc">복귀까지<b>${durKo(left)}</b></div></div>`
        : `<div class="df-gap onsite"><span class="df-gi">${FLAG_SVG}</span><div class="df-gt"><b>골프장에서 백대기하며 대기</b><span>${PART_KO[prev.part]} 끝 · 바로 이어서 ${PART_KO[cur.part]} · 공백 ${durKo(gm)}</span></div><div class="df-gc">백대기까지<b>${durKo(left)}</b></div></div>`;
    }
  }

  const cards = rounds.filter((r) => String(r.part) !== focusPart).map(roundCard).join('');
  el.innerHTML = `<div class="df-wrap"><div class="df-sum">${summary}</div>${mini}${between}${cards}</div>`;
  el.hidden = false;
}
// 라운드 1장 카드 — 근무면 티오프·집/도착/백대기, 스페어면 순번·앞에 N명. 부별 색(1부 분홍·2부 하늘·3부 보라).
//  ★복수 근무 표시라 1부는 배정유형 무관하게 그냥 '1부'(조출 접미사 없음 — 사용자 규칙).
function roundCard(r) {
  const partHtml = `<span class="pc${r.part} df-pp">${PART_KO[r.part] || ''}</span>`;
  const isWork = r.kind === 'work';
  if (isWork) {
    const c = r.commute || null;
    const crsKo = r.course === 'IN' ? '인' : r.course === 'OUT' ? '아웃' : '';
    const crs = crsKo ? `<span class="df-crs">${crsKo}코스</span>` : '';
    const legs = (r.teeTime && c) ? `<div class="df-legs"><span>${HOUSE_SVG} ${esc(c.leave)}</span><span>${PIN_SVG} ${esc(c.arrive)}</span><span>${FLAG_SVG} ${esc(c.standby)}</span></div>` : '';
    return `<div class="df-card"><div class="df-ch">${partHtml}<span class="df-tag work">근무</span></div><div class="df-tee">티오프 <b>${esc(r.teeTime || '미정')}</b> ${crs}</div>${legs}</div>`;
  }
  const pos = Number(r.myPosition) || 0, cut = Number(r.cutLine) || 0;
  const sparePos = (cut && pos > cut) ? (pos - cut) : pos;
  const ahead = (cut && pos > cut) ? Math.max(0, pos - cut - 1) : Math.max(0, pos - 1);
  const posTxt = pos ? `스페어 ${sparePos}번 · 앞에 ${ahead}명` : '대기';
  return `<div class="df-card sp"><div class="df-ch">${partHtml}<span class="df-tag spare">스페어</span></div><div class="df-note">${posTxt} — 팀이 차면 알려드릴게요.</div></div>`;
}
// 오른쪽(백대기 방향)을 향한 자동차 SVG. driving=true면 바퀴 회전·배기 연기·바람 라인 모션.
function carSVG(driving) {
  const spin = driving ? '<animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 0 0" to="360 0 0" dur="0.55s" repeatCount="indefinite"/>' : '';
  const wheel = (cx) => `<g transform="translate(${cx} 17.9)"><circle r="3.3" fill="#242a26"/><circle r="1.2" fill="#93998f"/><g stroke="#c9cec7" stroke-width=".7">${spin}<line x1="-2.9" x2="2.9"/><line y1="-2.9" y2="2.9"/><line x1="-2" y1="-2" x2="2" y2="2"/><line x1="-2" y1="2" x2="2" y2="-2"/></g></g>`;
  const puff = (begin) => `<circle cx="7" cy="16.5" r="1"><animate attributeName="opacity" values="0;.6;0" dur="1.3s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="cy" values="16.5;11" dur="1.3s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="cx" values="7;2" dur="1.3s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="r" values=".7;2.3" dur="1.3s" begin="${begin}" repeatCount="indefinite"/></circle>`;
  const line = (y, begin) => `<line x1="2" y1="${y}" x2="6" y2="${y}"><animate attributeName="opacity" values=".7;0" dur="0.6s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="x1" values="6;-1" dur="0.6s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="x2" values="10;3" dur="0.6s" begin="${begin}" repeatCount="indefinite"/></line>`;
  const smoke = driving ? `<g fill="#aeb9b0">${puff('0s')}${puff('0.65s')}</g>` : '';
  const speed = driving ? `<g stroke="#c98b8b" stroke-width="1.2" stroke-linecap="round">${line(8, '0s')}${line(12, '0.3s')}</g>` : '';
  return `<svg class="carsvg${driving ? ' drv' : ''}" viewBox="0 0 44 24" width="42" height="23" aria-hidden="true">
    ${speed}${smoke}
    <path d="M6 16.4 L6 14.6 Q6 13.2 7.6 13.1 L12 12.9 Q14.6 9 19.4 8.9 L26.5 8.9 Q30.6 9.1 32.6 12.7 L36.2 13 Q38.8 13.3 38.8 15.2 L38.8 16.6 Q38.8 17.7 37.4 17.7 L7.4 17.7 Q6 17.7 6 16.4 Z" fill="#c0392b"/>
    <path d="M14 12.6 Q15.9 9.9 19.5 9.8 L22.8 9.8 L22.8 12.6 Z M24.1 9.8 L26.2 9.9 Q29.2 10.1 30.8 12.6 L24.1 12.6 Z" fill="#e8eef0"/>
    <circle cx="37.4" cy="15.5" r="1" fill="#ffe08a"/>
    ${wheel(14.5)}${wheel(31)}
  </svg>`;
}

// 골프백 SVG — 백대기(도착·준비) 단계 아이콘. 클럽이 위로 삐죽, 초록 백·황토 클럽헤드.
function golfBagSVG() {
  return `<svg class="bagsvg" viewBox="0 0 24 30" width="19" height="24" aria-hidden="true">
    <defs><linearGradient id="mtl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef1f3"/><stop offset=".5" stop-color="#bcc2c7"/><stop offset="1" stop-color="#8f979d"/>
    </linearGradient></defs>
    <g stroke="#8a7350" stroke-width="1.5" stroke-linecap="round">
      <line x1="9" y1="9" x2="7.4" y2="2.2"/><line x1="12" y1="8.6" x2="12" y2="1.3"/><line x1="15" y1="9" x2="16.6" y2="2.6"/>
    </g>
    <circle cx="7.2" cy="2.1" r="1.6" fill="url(#mtl)"/><circle cx="12" cy="1.3" r="1.6" fill="url(#mtl)"/><circle cx="16.8" cy="2.6" r="1.6" fill="url(#mtl)"/>
    <rect x="6.4" y="8.6" width="11.2" height="19.2" rx="5.6" fill="#26292b"/>
    <ellipse cx="12" cy="9.1" rx="5.6" ry="1.9" fill="#111315"/>
    <rect x="8.4" y="15.5" width="7.2" height="6.2" rx="2.2" fill="#3a3f42"/>
    <path d="M7 11.5 Q2.6 18 7.6 25.5" stroke="#c3c8c4" stroke-width="1.3" fill="none"/>
  </svg>`;
}

// 집 SVG — 출발 전(집에 있음) 상태 아이콘. 초록 지붕·크림 벽·문·창·굴뚝.
function homeSVG() {
  return `<svg class="homesvg" viewBox="0 0 28 26" width="22" height="20" aria-hidden="true">
    <rect x="19.4" y="5" width="2.4" height="5.6" fill="#7a4a3a"/>
    <path d="M1.6 13.4 L14 3 L26.4 13.4 Z" fill="#c0392b" stroke="#96271d" stroke-width=".6" stroke-linejoin="round"/>
    <rect x="6" y="12.6" width="16" height="11.4" rx="1.3" fill="#f4ecda" stroke="#b79b6e" stroke-width=".9"/>
    <rect x="7.8" y="15" width="3.8" height="3.8" rx=".5" fill="#bcd6e0" stroke="#9fb9c4" stroke-width=".4"/>
    <rect x="12.6" y="16.6" width="5.2" height="7.4" rx=".8" fill="#8a5a2b"/>
    <circle cx="16.6" cy="20.3" r=".65" fill="#e8c877"/>
  </svg>`;
}

// bd = { state, commute, dayOffset, date, part } — focus(활성) 라운드 뷰. 어느 부든 동일 수준으로 렌더.
function renderBoard(bd) {
  const slot = $('boardSlot'); if (!slot) return;
  const s = bd.state, st = s.status;
  const partLabel = `${bd.part || '3'}부`;
  // 휴무=코스 일러스트 모드. 단, 순번 제외(removed)는 시적 쉼 모드가 아니라 담백한 글래스 안내 → hero-off 끔.
  const heroEl = $('todayHero'); if (heroEl) heroEl.classList.toggle('hero-off', st === 'off' && s.offReason !== 'removed');
  const isWork = st === 'assigned' || st === 'work' || st === 'your_turn';
  const c = bd.commute;

  if (isWork && c && toMin(c.leave) != null && toMin(c.arrive) != null && toMin(c.standby) != null && toMin(c.tee) != null) {
    // 초 단위까지 반영해 실시간으로 게이지·아이콘이 함께 채워지며 이동하도록.
    const d = new Date();
    const nowS = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    const L = toMin(c.leave) * 60;    // 출발(집)
    const A = toMin(c.arrive) * 60;   // 도착(백대기 10분 전)
    const B = toMin(c.standby) * 60;  // 백대기(티오프 50분 전)
    const T = toMin(c.tee) * 60;      // 티오프
    const nowMinNow = Math.floor(nowS / 60);
    const off = Number(bd.dayOffset) || 0;
    const dayW = off <= 0 ? '오늘' : off === 1 ? '내일' : off === 2 ? '모레' : (bd.date || `${off}일 뒤`);
    // 5단계: 0 출발전 / 1 이동중(집→도착) / 2 도착(백대기 대기 10분) / 3 백대기중(→티오프) / 4 근무중
    //  ★가운데 지점은 '도착'(도착 전) ↔ '백대기'(도착 이후)로 라벨·시각이 전환된다.
    //  ★미래 근무일(off>=1)은 아직 시작 전 → '출발 전' 고정(게이지 0).
    let phase;
    if (off >= 1)      phase = 0;
    else if (nowS < L) phase = 0;
    else if (nowS < A) phase = 1;
    else if (nowS < B) phase = 2;
    else if (nowS < T) phase = 3;
    else               phase = 4;
    // 가운데 지점 morph: 도착 전이면 '도착'(=출근시각), 도착 이후면 '백대기'
    const midLabel = phase <= 1 ? '도착' : '백대기';
    const midTime  = phase <= 1 ? c.arrive : c.standby;
    // 게이지·타깃(초 단위 실시간 이동). animate=true인 구간만 실시간 채움.
    let big, cap, pct, targetPct, targetS, animate;
    if (phase === 0)      { big = c.leave;   cap = off >= 1 ? `${dayW} ${c.leave} 출발` : `출발까지 ${gap(Math.round((L - nowS) / 60))}`; pct = 0;  targetPct = 0;   targetS = L; animate = false; }
    else if (phase === 1) { big = c.arrive;  cap = `도착까지 ${gap(Math.round((A - nowS) / 60))}`;   pct = 50 * (nowS - L) / Math.max(1, A - L); targetPct = 50;  targetS = A; animate = true; }
    else if (phase === 2) { big = c.standby; cap = `백대기까지 ${gap(Math.round((B - nowS) / 60))}`; pct = 50;                                   targetPct = 50;  targetS = B; animate = false; }
    else if (phase === 3) { big = c.tee;     cap = `티오프까지 ${gap(Math.round((T - nowS) / 60))}`; pct = 50 + 50 * (nowS - B) / Math.max(1, T - B); targetPct = 100; targetS = T; animate = true; }
    else                  { big = c.tee;     cap = '근무 중';                                        pct = 100; targetPct = 100; targetS = T; animate = false; }
    pct = Math.max(0, Math.min(100, pct));
    const act = off >= 1 ? `${dayW} 출발 준비`
      : ['집에서 출발 준비', '골프장으로 이동 중', '도착 · 백대기 대기', '백대기 · 티오프 준비', '근무 중'][phase];
    const crs = s.course ? ` ${esc(s.course)}` : '';
    // 지점 상태(done=지남·노랑, next=다음 목표·글로우)
    const pStart = phase === 0 ? 'next' : 'done';
    const pMid   = (phase === 1 || phase === 2) ? 'next' : (phase >= 3 ? 'done' : '');
    const pEnd   = phase === 3 ? 'next' : (phase >= 4 ? 'done' : '');
    // 🏠 출발전(0) / 🚗 이동(1) / 골프백 백대기(2·3) / 🏌️ 근무중(4)
    const homeHtml = phase === 0 ? `<span class="ricon home" style="left:0%">${homeSVG()}</span>` : '';
    const carHtml = phase === 1 ? `<span class="ricon car" style="left:${pct}%">${carSVG(true)}</span>` : '';
    const bagHtml = (phase === 2 || phase === 3) ? `<span class="ricon prep" style="left:${phase === 2 ? 50 : pct}%">${golfBagSVG()}</span>` : '';
    const golferHtml = phase === 4 ? `<span class="ricon golfer" style="left:100%">${golfBagSVG()}</span>` : '';
    const filling = animate ? ' filling' : '';
    const alert = phase === 0 ? [`${off >= 1 ? dayW + ' ' : ''}${hhmm(Math.round(L / 60) - 10)}에 출발 알림을 보내드릴게요`, off >= 1 ? '출발 전' : '10분 전']
      : phase === 1 ? [`곧 골프장 도착 예정(${c.arrive})`, '이동 중']
      : phase === 2 ? [`백대기 시간(${c.standby})까지 잠시 대기`, '도착']
      : phase === 3 ? [`티오프(${c.tee}) 준비 시간이에요`, '백대기 중']
      : ['좋은 라운드 되세요!', '근무 중'];
    slot.innerHTML = `<div class="actionboard">
      <div class="actiontop"><b>다음 행동 · ${act}</b><span class="clock">현재 ${hhmm(nowMinNow)}</span></div>
      <div class="nextline"><strong>${esc(big)}</strong><span>${cap}</span></div>
      <div class="rail2">
        <i class="track"></i><i class="fill${filling}" style="width:${pct}%"></i>
        ${bagHtml}${carHtml}${homeHtml}${golferHtml}
        <i class="rp ${pStart}" style="left:0"></i>
        <i class="rp ${pMid}" style="left:50%"></i>
        <i class="rp ${pEnd}" style="left:100%"></i>
      </div>
      <div class="railtext3">
        <div class="rt l ${phase >= 1 ? 'done' : (phase === 0 ? 'next' : '')}"><b>출발</b><time>${esc(c.leave)}</time></div>
        <div class="rt c ${phase >= 3 ? 'done' : ((phase === 1 || phase === 2) ? 'next' : '')}"><b>${midLabel}</b><time>${esc(midTime)}</time></div>
        <div class="rt r ${phase >= 4 ? 'done' : (phase === 3 ? 'next' : '')}"><b>티오프</b><time>${esc(c.tee)}</time></div>
      </div>
      <div class="alert"><span>${alert[0]}</span><b>${alert[1]}</b></div>
      <div class="minirow">
        <div class="mini"><span>백대기 <small>티오프 ${c.backWaitMin || 50}분 전</small></span><b>${esc(c.standby)}</b></div>
        <div class="mini"><span>티오프</span><b>${esc(c.tee)}<small>${crs}</small></b></div>
      </div>
    </div>`;
    // ★실시간 진행: 현재 위치에서 다음 지점까지 남은 시간 동안 게이지·아이콘을 선형으로 이동.
    if (animate) {
      const remMs = Math.max(0, (targetS - nowS) * 1000);
      const fillEl = slot.querySelector('.fill');
      const iconEl = slot.querySelector(phase === 1 ? '.ricon.car' : '.ricon.prep');
      if (fillEl && remMs > 0) {
        fillEl.style.transition = 'none'; fillEl.style.width = pct + '%';
        if (iconEl) { iconEl.style.transition = 'none'; iconEl.style.left = pct + '%'; }
        void fillEl.offsetWidth; // reflow — 시작점 고정 후 목표로 선형 이동
        fillEl.style.transition = `width ${remMs}ms linear`; fillEl.style.width = targetPct + '%';
        if (iconEl) { iconEl.style.transition = `left ${remMs}ms linear`; iconEl.style.left = targetPct + '%'; }
      }
    }
    return;
  }
  // 티오프 미배정(스페어/휴무/미상) — 시간 지어내지 않음.
  //  ★순번 제외(removed)는 평소 휴무(시적 일러스트)와 달리 사실만 담은 글래스 안내 카드.
  //  ★휴무 일러스트는 이미 떠 있으면 다시 안 꽂는다 — 깃발 SMIL이 폴링마다 리셋/정지되지 않게(끊김 없는 펄럭).
  if (st === 'off') {
    if (s.offReason === 'removed') slot.innerHTML = removedBoardHTML(s);
    else if (s.offType === 'sick') { if (!slot.querySelector('.off-sick')) slot.innerHTML = sickBoardHTML(); }
    else if (!slot.querySelector('.off-course')) slot.innerHTML = offCourseHTML();
  }
  else if (st === 'spare' || st === 'waiting' || st === 'near') slot.innerHTML = renderSpareBoard(s, partLabel);
  else if (st === 'your_turn') slot.innerHTML = `<div class="board-plain"><b style="color:#bd312d">지금 바로 출근 준비하세요.</b> 티오프가 올라오면 시간 안내로 바뀝니다.</div>`;
  else slot.innerHTML = '';
}

// 이름 느슨한 일치 — 판독 글자변형(예: 김홍구↔김흥구) 허용. 공백 제거 후 완전일치 또는 같은 길이 1글자 차.
function nameLooseEq(a, b) {
  const na = String(a || '').replace(/\s/g, ''), nb = String(b || '').replace(/\s/g, '');
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length !== nb.length) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i++) if (na[i] !== nb[i]) diff++;
  return diff <= 1;
}

// 스페어(대기) 대시보드 — '대기 순번 리스트'(깔끔 리스트 확정안). 실데이터로 그림.
//  ★partLabel(1부/2부/3부) — focus 라운드의 부에 맞춰 헤더 라벨을 표기(부별 동일 수준).
function renderSpareBoard(s, partLabel = '3부') {
  const roster = Array.isArray(s.roster3) ? s.roster3 : [];
  const nameAt = (p) => (typeof p === 'number' && p >= 1 && roster[p - 1]) ? roster[p - 1] : '';
  // 티오프표(순번→시각) — 확정된 사람 이름 옆에 매칭 티오프 시간을 함께 보여준다.
  const grid = Array.isArray(s.teeGrid) ? s.teeGrid : [];
  const teeAt = (p) => { const g = grid.find((x) => Number(x.pos) === p); return g && g.time ? g.time : ''; };
  const cut = Number(s.cutLine) || 0;

  // ★명단에서 내 이름을 직접 찾아 순번을 확정한다(정확·자기일관 우선).
  //  서버가 잠가둔 myPosition과 최신 명단이 한 칸 어긋나도, '표시 이름'과 '내 위치'가
  //  같은 배열(roster)에서 나오므로 순번 리스트가 간헐적으로 숨겨지던 문제를 없앤다.
  const myName = (meState && meState.profile && meState.profile.boardName || '').trim();
  const norm = (x) => String(x || '').replace(/\s/g, '');
  const mn = norm(myName);
  let myIdx = mn ? roster.findIndex((nm) => norm(nm) === mn) : -1;   // 정확 일치 우선
  if (myIdx < 0 && mn) myIdx = roster.findIndex((nm) => nameLooseEq(nm, myName)); // 없으면 1글자 오차 허용
  // 아직 내 이름(프로필)을 못 받았지만 서버 순번이 명단 안이면, 서버 순번을 임시로 신뢰해 리스트를 그린다.
  //  (프로필 로드되면 loadMe가 재렌더 → 이름 기준으로 정밀화). 부팅 레이스로 폴백 뜨던 문제 방지.
  const serverPos = Number(s.myPosition) || 0;
  const trustByPos = myIdx < 0 && !mn && serverPos >= 1 && roster.length >= serverPos;
  const myPos = myIdx >= 0 ? myIdx + 1 : serverPos;

  const rowHTML = (p, kind) => {
    const nm = nameAt(p);
    const tee = teeAt(p);
    let st, badge;
    if (kind === 'done') { st = nm || '확정'; badge = '<span class="sp-badge sp-b-work">근무</span>'; }
    else if (kind === 'me') { st = nm || myName || '나'; badge = '<span class="sp-badge sp-b-me">나</span>'; }
    else { st = nm || '대기'; badge = '<span class="sp-badge sp-b-wait">스페어</span>'; }
    const teeHtml = tee ? `<span class="sp-tee">${esc(tee)}</span>` : '';
    return `<div class="sp-row ${kind}"><span class="no">${p}</span><span class="st">${esc(st)}</span>${teeHtml}${badge}</div>`;
  };

  // 명단에서 내 이름을 못 찾고(정확 우선 미충족), 서버 순번으로도 신뢰 못하면 → 숫자 요약 폴백.
  if (myIdx < 0 && !trustByPos) {
    const mp = Number(s.myPosition) || 0;
    if (!mp) return `<div class="sp-board"><div class="sp-foot" style="border-top:0"><span class="sp-fi">${CLOCK_SVG}</span><span>대기 정보를 불러오는 중이에요. 배치표 소식이 오면 순번을 표시할게요.</span></div></div>`;
    const ahead = (cut && mp > cut) ? Math.max(0, mp - cut - 1) : 0;
    if (!cut || mp <= cut) {
      return `<div class="sp-board"><div class="sp-foot" style="border-top:0"><span class="sp-fi">${CLOCK_SVG}</span>` +
        `<span>아직 <b>근무 확정 전</b>이에요 · 순번 <b>${mp}번</b>. 확정선 소식이 오면 앞으로 몇 명 남았는지 계산해 알려드릴게요.</span></div></div>`;
    }
    return `<div class="sp-board">
      <div class="sp-head">
        <div><div class="lbl">${partLabel} 대기 순번</div><div class="sp-cutinfo">현재 확정선 ${cut}번</div></div>
        <div class="sp-ahead"><b>${ahead}</b><span>내 앞</span></div>
      </div>
      <div class="sp-foot" style="border-top:0"><span class="sp-fi">${CLOCK_SVG}</span><span>내 순번 <b>${mp}번</b> · 확정선 <b>${cut}번</b> · 앞으로 <b>${ahead}명</b> 남았어요. 배치표 이름이 또렷이 읽히면 순번별로 표시할게요.</span></div>
    </div>`;
  }

  // ── 여기부터 명단 신뢰 O: 순번별 이름 리스트를 그린다 ──
  const hasCut = cut >= 1 && cut < myPos;
  const rows = [];
  if (hasCut) {
    const ahead = Math.max(0, myPos - cut - 1);
    // 확정 구간(커트라인 직전 2행)
    if (cut - 1 >= 1) rows.push(rowHTML(cut - 1, 'done'));
    rows.push(rowHTML(cut, 'done'));
    rows.push(`<div class="sp-cut"><i></i><b>확정선 · 여기까지 근무</b><i></i></div>`);
    // 대기 구간(길면 가운데 ⋯로 접기)
    const waitStart = cut + 1;
    if (myPos - 1 - waitStart <= 2) {
      for (let p = waitStart; p <= myPos - 1; p++) rows.push(rowHTML(p, 'wait'));
    } else {
      rows.push(rowHTML(waitStart, 'wait'));
      rows.push(`<div class="sp-row"><span class="no">⋯</span><span class="st">대기</span><span class="sp-badge sp-b-wait">스페어</span></div>`);
      rows.push(rowHTML(myPos - 1, 'wait'));
    }
    rows.push(rowHTML(myPos, 'me'));
    if (myPos + 1 <= roster.length) rows.push(rowHTML(myPos + 1, 'wait')); // 내가 마지막이면 뒤 행 없음
    return `<div class="sp-board">
      <div class="sp-head">
        <div><div class="lbl">${partLabel} 대기 순번</div><div class="sp-cutinfo">현재 확정선 ${cut}번</div></div>
        <div class="sp-ahead"><b>${ahead}</b><span>내 앞</span></div>
      </div>
      <div class="sp-list">${rows.join('')}</div>
    </div>`;
  }

  // 확정선 미정 — 순번은 아는데 확정선 소식이 아직. 내 주변 순번을 창(window)으로 보여준다.
  const start = Math.max(1, myPos - 3);
  for (let p = start; p < myPos; p++) rows.push(rowHTML(p, 'wait'));
  rows.push(rowHTML(myPos, 'me'));
  if (myPos + 1 <= roster.length) rows.push(rowHTML(myPos + 1, 'wait'));
  return `<div class="sp-board">
    <div class="sp-head">
      <div><div class="lbl">${partLabel} 대기 순번</div><div class="sp-cutinfo">확정선 소식 대기 중</div></div>
      <div class="sp-ahead"><b>${myPos}</b><span>내 순번</span></div>
    </div>
    <div class="sp-list">${rows.join('')}</div>
    <div class="sp-foot"><span class="sp-fi">${CLOCK_SVG}</span><span>확정선(“○○님까지”) 소식이 오면 앞으로 몇 명 남았는지 계산해 알려드릴게요.</span></div>
  </div>`;
}

/* ── 소식 피드 ── */
const LAST_READ_KEY = 'riverhill_lastReadTs';
const getLastRead = () => Number(localStorage.getItem(LAST_READ_KEY) || 0);
const setLastRead = (ts) => localStorage.setItem(LAST_READ_KEY, String(ts || 0));
function newsHTML(a) {
  const ts = a.detectedAt || 0;
  const isNew = ts > getLastRead();
  const tag = a.status === 'your_turn' ? '<span class="tag red">지금 차례</span>'
    : a.status === 'near' ? '<span class="tag red">곧 차례</span>'
    : (a.status === 'assigned' || a.status === 'work') ? '<span class="tag amb">근무</span>'
    : a.status === 'spare' ? '<span class="tag amb">스페어</span>'
    : (a.relevant && a.priority === 'high') ? '<span class="tag amb">일정</span>' : '';
  const cat = a.category ? `<span class="tag cat">${esc(a.category)}</span>` : '';
  const dot = isNew ? '<span class="red">● </span>' : '';
  const head = a.aiMessage || a.subject;
  const when = timeAgo(ts) || a.writeDate || '';
  const rest = [a.aiMessage ? a.subject : '', a.writer, a.menuName].filter(Boolean).join(' · ');
  return `<a class="news${isNew ? ' newitem' : ''}${a.relevant === false ? ' dim' : ''}" href="${a.url}" target="_blank" rel="noopener">
    <b>${dot}${cat}${tag}${esc(head)}</b><small>${[when, rest].filter(Boolean).map(esc).join(' · ')}</small></a>`;
}
async function loadRecent() {
  let raw; try { raw = await (await fetch('/api/recent')).json(); } catch { return; }
  // 관련 있는 소식만 표시(무관한 건 서버가 애초에 안 남김 — 사용자 요청). 옛 무관 항목 대비 방어 필터.
  const all = (raw || []).filter((a) => a.relevant !== false);
  const lastRead = getLastRead(); let unread = 0, newest = 0;
  all.forEach((a) => { const ts = a.detectedAt || 0; if (ts > newest) newest = ts; if (ts > lastRead) unread++; });
  const u = $('unread'), r = $('readAll');
  if (unread > 0) { u.textContent = unread; u.hidden = false; r.hidden = false; } else { u.hidden = true; r.hidden = true; }
  r.dataset.newest = String(newest);

  $('todayNews').innerHTML = all.length ? all.slice(0, 3).map(newsHTML).join('') : '<div class="empty">관련 소식이 아직 없어요.</div>';
  $('recent').innerHTML = all.length ? all.map(newsHTML).join('') : '<div class="empty">아직 감지된 소식이 없어요.</div>';
}
function markAllRead() { setLastRead(Number($('readAll').dataset.newest) || Date.now()); loadRecent(); }

/* ── 일일 근무 일지 = 달력(통합): 날짜 탭 → 근무/부 기록·수정, 정산 자동 연동 ── */
let jCache = { year: null, days: [] };
let jMap = {};                     // 'YYYY-MM-DD' -> day
let jViewY = null, jViewM = null;  // 표시 중인 월
let jSelDate = null;               // 편집 중 날짜(하나만)
let jEdit = null;                  // { kind, parts }
const WDX = ['일', '월', '화', '수', '목', '금', '토'];

async function loadJournal(year) {
  const now = new Date();
  if (jViewY == null) { jViewY = now.getFullYear(); jViewM = now.getMonth() + 1; }
  const y = year || jViewY;
  try {
    const r = await (await fetch(`/api/journal?year=${y}`)).json();
    jCache = { year: y, days: r.days || [] };
    jMap = {}; jCache.days.forEach((d) => { jMap[d.date] = d; });
  } catch { if ($('jTitle')) $('jTitle').textContent = '불러오기 실패'; return; }
  renderJournalCal();
}

// 부 조합 → 배지 색 클래스(1부 연분홍·2부 하늘·3부 보라·1·3 핫핑크·2·3 하늘·54 연두).
function jComboClass(parts) {
  if (!parts || !parts.length) return 'jc-p3';
  const k = parts.length >= 3 ? '54' : parts.slice().sort().join('');
  return { '1': 'jc-p1', '2': 'jc-p2', '3': 'jc-p3', '13': 'jc-13', '23': 'jc-23', '12': 'jc-12', '54': 'jc-54' }[k] || 'jc-p3';
}
// 부 조합 라벨: 3부↑=54, 2개=1·3/2·3, 1개=3부. (탕 표현 안 씀)
function jCombo(parts) { if (!parts || !parts.length) return ''; if (parts.length >= 3) return '54'; if (parts.length === 2) return parts.slice().sort().join('·'); return parts[0] + '부'; }

// 하루 → [배지 색클래스, 라벨]. 기록 없으면 null.
function jDayBadge(d) {
  if (!d) return null;
  if (d.excluded) return ['removed', '제외'];   // 셀은 좁아 짧게(편집기 칩은 '순번 제외' 그대로)
  if (d.kind === 'off') return d.offType === 'sick' ? ['sick', '병가'] : d.offType === 'vacation' ? ['vac', '휴가'] : ['off', '휴무'];
  if (d.kind === 'spare') return ['spare', '스페어'];
  if (d.kind === 'work') { const eff = (d.effParts && d.effParts.length) ? d.effParts : ['3']; return [jComboClass(eff), jCombo(eff)]; }
  return null;
}
// 하루 → 편집기 초기 상태.
function jDayToEdit(d) {
  if (!d) return { kind: 'work', parts: ['3'] };
  if (d.excluded) return { kind: 'removed', parts: [] };
  if (d.kind === 'off') return { kind: d.offType === 'sick' ? 'sick' : d.offType === 'vacation' ? 'vacation' : 'off', parts: [] };
  if (d.kind === 'spare') return { kind: 'spare', parts: [] };
  if (d.kind === 'work') return { kind: 'work', parts: ((d.effParts && d.effParts.length) ? d.effParts : ['3']).slice() };
  return { kind: 'work', parts: ['3'] };
}

async function renderJournalCal() {
  if (!$('jCal')) return;
  if (jCache.year !== jViewY) { await loadJournal(jViewY); return; }  // 연도 바뀌면 로드
  if ($('jPrev')) $('jPrev').onclick = () => jMonthShift(-1);
  if ($('jNext')) $('jNext').onclick = () => jMonthShift(1);
  $('jTitle').textContent = `${jViewY}년 ${jViewM}월`;

  const pre = `${jViewY}-${String(jViewM).padStart(2, '0')}`;
  const md = jCache.days.filter((d) => d.date.startsWith(pre));
  const cnt = (f) => md.filter(f).length;
  const sub = [`근무 ${cnt((d) => d.kind === 'work' && !d.excluded)}`, `스페어 ${cnt((d) => d.kind === 'spare')}`, `휴무 ${cnt((d) => d.kind === 'off' && !d.excluded && d.offType !== 'vacation' && d.offType !== 'sick')}`];
  const vac = cnt((d) => d.kind === 'off' && !d.excluded && d.offType === 'vacation');
  const sick = cnt((d) => d.kind === 'off' && !d.excluded && d.offType === 'sick');
  const rem = cnt((d) => d.excluded);
  if (vac) sub.push(`휴가 ${vac}`);
  if (sick) sub.push(`병가 ${sick}`);
  if (rem) sub.push(`순번제외 ${rem}`);
  $('jSub').textContent = sub.join('일 · ') + '일';

  const first = new Date(jViewY, jViewM - 1, 1).getDay();
  const ndays = new Date(jViewY, jViewM, 0).getDate();
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let h = WDX.map((w, i) => `<div class="jcal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('');
  for (let i = 0; i < first; i++) h += '<div class="jcell empty"></div>';
  for (let d = 1; d <= ndays; d++) {
    const key = `${pre}-${String(d).padStart(2, '0')}`;
    const b = jDayBadge(jMap[key]);
    const bd = b ? `<span class="jcbd ${b[0]}">${esc(b[1])}</span>` : '';
    h += `<div class="jcell${jMap[key] ? '' : ' none'}${jSelDate === key ? ' sel' : ''}${key === todayISO ? ' today' : ''}" data-d="${key}"><span class="jcn">${d}</span>${bd}</div>`;
  }
  const cal = $('jCal');
  cal.innerHTML = h;
  cal.querySelectorAll('.jcell[data-d]').forEach((c) => { c.onclick = () => openDayEditor(c.dataset.d); });
  // 달 넘김 슬라이드(탭·스와이프 공통): 다음달=오른쪽에서, 이전달=왼쪽에서 들어옴.
  if (jSlideDir) { cal.classList.remove('slide-l', 'slide-r'); void cal.offsetWidth; cal.classList.add(jSlideDir > 0 ? 'slide-r' : 'slide-l'); jSlideDir = 0; }
  // 좌우 스와이프로 달 넘기기(왼쪽으로 밀면 다음달, 오른쪽으로 밀면 이전달).
  let sx = 0, sy = 0, tracking = false;
  cal.ontouchstart = (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = true; };
  cal.ontouchmove = (e) => { if (!tracking) return; const t = e.touches[0]; if (Math.abs(t.clientX - sx) > Math.abs(t.clientY - sy) && Math.abs(t.clientX - sx) > 12) e.preventDefault(); };
  cal.ontouchend = (e) => {
    if (!tracking) return; tracking = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) jMonthShift(dx < 0 ? 1 : -1);
  };

  if (jSelDate && jSelDate.startsWith(pre)) drawDayEditor();
  else { jSelDate = null; if ($('jEditor')) $('jEditor').hidden = true; if ($('jHint')) $('jHint').hidden = false; }
}

let jSlideDir = 0;   // 다음 렌더에서 달력에 적용할 슬라이드 방향(+1 다음달 / -1 이전달)
function jMonthShift(delta) {
  jViewM += delta;
  if (jViewM < 1) { jViewM = 12; jViewY--; } else if (jViewM > 12) { jViewM = 1; jViewY++; }
  jSelDate = null; jEdit = null; jSlideDir = delta > 0 ? 1 : -1;
  renderJournalCal();
}

function openDayEditor(key) {
  if (jSelDate === key) { jSelDate = null; jEdit = null; renderJournalCal(); return; }  // 같은 날 → 닫기
  jSelDate = key; jEdit = jDayToEdit(jMap[key]);
  renderJournalCal();
  if ($('jEditor')) $('jEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function drawDayEditor() {
  const key = jSelDate, ed = $('jEditor'); if (!ed || !jEdit) return;
  const dow = WDX[new Date(key + 'T00:00:00').getDay()];
  const mdL = `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}(${dow})`;
  const isWork = jEdit.kind === 'work';
  const exists = !!jMap[key];
  const KINDS = [['work', '근무', 'work'], ['spare', '스페어', 'spare'], ['off', '휴무', 'off'], ['vacation', '휴가', 'vac'], ['sick', '병가', 'sick'], ['removed', '순번 제외', 'removed']];
  const res = jEdit.kind === 'del' ? '이 날 기록을 지웁니다'
    : isWork ? `${jCombo(jEdit.parts) || '부 선택'} · 캐디피 정산 자동 반영`
    : ({ spare: '스페어', off: '휴무', vacation: '휴가', sick: '병가', removed: '순번 제외' })[jEdit.kind];
  ed.innerHTML = `<div class="jed-h">${mdL} <b>· 이 날 기록</b></div>
    <div class="jkinds">${KINDS.map(([k, lab, c]) => `<button class="jkbtn ${c}${jEdit.kind === k ? ' on' : ''}" data-k="${k}">${lab}</button>`).join('')}${exists ? `<button class="jkbtn jdel${jEdit.kind === 'del' ? ' on' : ''}" data-k="del">지우기</button>` : ''}</div>
    ${isWork ? `<div class="jparts"><span class="jplabel">부</span>${['1', '2', '3'].map((p) => `<button class="jpchip${jEdit.parts.includes(p) ? ' on' : ''}" data-p="${p}">${p}부</button>`).join('')}<div class="jphint">그날 뛴 부를 다 누르세요 · 여러 개 = 복수 근무(2·3부·54)</div></div>` : ''}
    <div class="jed-res${isWork && !jEdit.parts.length ? ' muted' : ''}">→ ${res}</div>
    <button class="jed-save">${exists ? '저장' : '추가'}</button>`;
  ed.hidden = false; if ($('jHint')) $('jHint').hidden = true;
  ed.querySelectorAll('.jkbtn[data-k]').forEach((b) => { b.onclick = () => { jEdit.kind = b.dataset.k; if (jEdit.kind === 'work' && !jEdit.parts.length) jEdit.parts = ['3']; drawDayEditor(); }; });
  ed.querySelectorAll('.jpchip[data-p]').forEach((b) => { b.onclick = () => { const p = b.dataset.p, i = jEdit.parts.indexOf(p); if (i >= 0) jEdit.parts.splice(i, 1); else jEdit.parts.push(p); if (!jEdit.parts.length) jEdit.parts = [p]; drawDayEditor(); }; });
  ed.querySelector('.jed-save').onclick = () => saveDayEditor();
}

async function saveDayEditor() {
  const date = jSelDate, e = jEdit; if (!date || !e) return;
  try {
    if (e.kind === 'del') { await postJSON('/api/journal/remove', { date }); }
    else if (e.kind === 'work') { await postJSON('/api/journal/kind', { date, kind: 'work' }); await postJSON('/api/ledger/dayparts', { date, parts: e.parts.slice().sort() }); }
    else { await postJSON('/api/journal/kind', { date, kind: e.kind }); await postJSON('/api/ledger/dayparts', { date, parts: [] }); }
  } catch { /* noop */ }
  jSelDate = null; jEdit = null;
  await loadJournal(jViewY);
}

/* ── 근무·세무 기록 (월 단위 · 요약 카드 · 정리 필터) ── */
let wlYear = null, wlMonth = null, wlFilter = 'all', wlFuelOn = false, wlOpenDate = null;
let wlCache = { year: null, days: [], settings: {} }; // 연 단위로 한 번만 로드 → 월 이동은 재요청 없이

const wlIsAsk = (d) => d.worked == null;
const wlIsBlank = (d) => d.worked === true
  && !(d.photos && Object.keys(d.photos).length) && !(d.odo && Object.keys(d.odo).length);
function wlDayKm(d, roundKm) {
  const o = d.odo || {};
  if (o.start != null && o.home != null && o.home >= o.start) return o.home - o.start;
  return roundKm;
}

async function loadWorklog() {
  const now = new Date();
  if (wlYear == null) { wlYear = now.getFullYear(); wlMonth = now.getMonth() + 1; }
  if (wlCache.year !== wlYear) {
    try {
      const r = await (await fetch(`/api/worklog?year=${wlYear}`)).json();
      wlCache = { year: wlYear, days: r.days || [], settings: r.settings || {} };
    } catch { $('wlMLabel').textContent = '불러오기 실패'; return; }
  }
  renderWorklog();
}
function reloadWorklog() { wlCache.year = null; return loadWorklog(); } // 변경 후 강제 새로고침

function renderWorklog() {
  const now = new Date(), realY = now.getFullYear(), realM = now.getMonth() + 1;
  const s = wlCache.settings || {};
  const roundKm = (Number(s.homeGolfKmOneway) || 30) * 2;
  const kmPerL = Number(s.kmPerL) || 12, price = Number(s.fuelPrice) || 1700;

  // 설정 입력칸(포커스 중 아니면 갱신)
  if (document.activeElement !== $('wlKm')) $('wlKm').value = s.homeGolfKmOneway ?? 30;
  if (document.activeElement !== $('wlName')) $('wlName').value = s.driverName || '';
  if (document.activeElement !== $('wlCar')) $('wlCar').value = s.carNo || '';

  // 월 라벨·네비
  $('wlMLabel').textContent = `${wlYear}년 ${wlMonth}월`;
  const isNow = wlYear === realY && wlMonth === realM;
  $('wlMSub').textContent = isNow ? '이번 달' : '지난 기록';
  $('wlMSub').style.opacity = isNow ? '.72' : '.5';
  $('wlThisMo').hidden = isNow;
  $('wlNext').disabled = (wlYear > realY) || (wlYear === realY && wlMonth >= realM);
  $('wlSc1').textContent = $('wlSc2').textContent = `${wlMonth}월`;

  const yearDays = wlCache.days;
  const monthDays = yearDays.filter((d) => Number(d.date.slice(5, 7)) === wlMonth);

  // 연 누적
  const yWorked = yearDays.filter((d) => d.worked === true);
  $('wlYrY').textContent = `${wlYear}년`;
  $('wlYrDays').textContent = yWorked.length;
  $('wlYrKm').textContent = yWorked.reduce((a, d) => a + wlDayKm(d, roundKm), 0).toLocaleString();

  // 월 통계
  const mWorked = monthDays.filter((d) => d.worked === true);
  const mKm = mWorked.reduce((a, d) => a + wlDayKm(d, roundKm), 0);
  $('wlSDays').textContent = mWorked.length;
  $('wlSKm').textContent = mKm.toLocaleString();

  // 세 번째 칸: 기본 '증빙 사진 있는 날', 켜면 '예상 유류비 어림값'
  if (wlFuelOn) {
    const fuel = Math.round(mKm / kmPerL * price);
    $('wlS3k').innerHTML = `예상 유류비 <span class="tg">어림값</span>`;
    $('wlS3v').innerHTML = fuel >= 10000 ? `${(fuel / 10000).toFixed(1)}<small>만</small>` : fuel.toLocaleString();
    $('wlS3u').textContent = '원';
    $('wlAssume').hidden = false;
    $('wlAssume').innerHTML = `※ 유류비는 <b>주행거리 ÷ 연비(${kmPerL}km/L) × 평균유가(${price.toLocaleString()}원)</b> 로 낸 <b>어림값</b>이에요. 기름값은 매일·주유소마다 달라 정확할 수 없고, <b>실제 공제는 주유 영수증 기준</b>입니다.`;
    $('wlFuelToggle').textContent = '예상 유류비 어림값 끄기';
  } else {
    $('wlS3k').textContent = '증빙 사진';
    $('wlS3v').textContent = mWorked.filter((d) => d.photos && Object.keys(d.photos).length).length;
    $('wlS3u').textContent = `/ ${mWorked.length}일`;
    $('wlAssume').hidden = true;
    $('wlFuelToggle').textContent = '예상 유류비 어림값 켜기';
  }

  // 정리 상태 + 세그먼트 카운트
  const nAsk = monthDays.filter(wlIsAsk).length, nPhoto = monthDays.filter(wlIsBlank).length;
  $('wlCAll').textContent = monthDays.length; $('wlCAsk').textContent = nAsk; $('wlCPhoto').textContent = nPhoto;
  const tidy = $('wlTidy');
  if (nAsk + nPhoto === 0) {
    tidy.className = 'wl-tidy ok'; tidy.querySelector('.ic').innerHTML = CHECK_SVG;
    $('wlTidyTxt').textContent = '모두 정리됐어요';
  } else {
    tidy.className = 'wl-tidy warn'; tidy.querySelector('.ic').innerHTML = WARN_SVG;
    const parts = []; if (nAsk) parts.push(`확인 대기 ${nAsk}일`); if (nPhoto) parts.push(`사진 미입력 ${nPhoto}일`);
    $('wlTidyTxt').innerHTML = parts.join(' · ') + `<span class="go">아래에서 정리 ↓</span>`;
  }

  // 목록(필터 적용)
  let list = monthDays;
  if (wlFilter === 'ask') list = monthDays.filter(wlIsAsk);
  else if (wlFilter === 'photo') list = monthDays.filter(wlIsBlank);
  $('wlDays').innerHTML = list.length ? list.map((d) => wlCard(d, roundKm)).join('')
    : `<div class="empty">${wlFilter === 'all' ? '이 달 기록이 아직 없어요.' : '해당 항목이 없어요.'}</div>`;
  wlBind();
}

const WL_LEG = [['start', '집출발'], ['work', '직장도착'], ['home', '집복귀']];
function wlCard(d, roundKm) {
  const dt = new Date(d.date + 'T00:00:00'), day = Number(d.date.slice(8, 10)), dow = dt.getDay();
  const wc = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
  const attn = wlIsAsk(d) || wlIsBlank(d);
  const nPhoto = d.photos ? Object.keys(d.photos).length : 0;
  let right, meta;
  if (d.excluded) {
    right = `<div class="wl-right"><span class="wl-chip x">순번 제외</span><button class="wl-change" data-d="${d.date}">변경</button></div>`;
    meta = `<span>배치표 순번에서 빠져 근무 없음</span>`;
  } else if (d.worked == null) {
    right = `<div class="wl-right"><button class="wl-btn wl-yes" data-w="1" data-d="${d.date}">예</button><button class="wl-btn wl-no" data-w="0" data-d="${d.date}">아니오</button></div>`;
    meta = `<span>근무 확정 감지 · 근무하셨나요?</span>`;
  } else if (d.worked === false) {
    right = `<div class="wl-right"><span class="wl-chip x">안 함</span><button class="wl-change" data-d="${d.date}">변경</button></div>`; meta = `<span>근무 안 한 날</span>`;
  } else {
    right = `<div class="wl-right"><span class="wl-chip ok">근무</span><button class="wl-change" data-d="${d.date}">변경</button></div>`;
    const ph = nPhoto > 0 ? `<span class="ph">사진 ${nPhoto}장</span>` : `<span class="ph miss">사진 미입력</span>`;
    const odo = d.odo && Object.keys(d.odo).length ? `<span>· 계기판 입력됨</span>` : '';
    meta = `${ph}${odo}`;
  }
  const teeLegs = (!d.excluded && d.twoRounds && d.rounds) ? ['1', '2', '3'].filter((p) => d.rounds[p] && d.rounds[p].teeTime) : [];
  const tripBadge = (d.tripsManual ?? d.trips ?? 1) >= 2 ? ' · 왕복 2회' : '';
  const tee = d.excluded
    ? (d.prevPosition ? `순번 ${d.prevPosition}번 → 배치표에서 제외` : '순번 제외 · 근무 없음')
    : teeLegs.length
      ? teeLegs.map((p) => `${p}부 ${d.rounds[p].teeTime}`).join(' · ') + tripBadge
      : d.teeTime ? `${d.teeTime}${d.course ? ' ' + d.course : ''}` : (d.worked === false ? '—' : (d.source === 'manual' ? '수동 입력' : ''));
  const expandable = d.worked !== false && !d.excluded;
  let panel = '';
  if (expandable) {
    const odo = d.odo || {};
    const slots = WL_LEG.map(([leg, lab]) => {
      const has = d.photos && d.photos[leg];
      const inner = has ? `<img src="/api/worklog/photo/${d.photos[leg]}?t=${d.confirmedAt || 0}">` : '<svg class="wl-camic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h3l1.3-1.8h7.4L17 8.5h3v9.5H4z"/><circle cx="12" cy="13" r="3"/></svg>';
      return `<label class="wl-slot"><span class="box${has ? ' done' : ''}">${inner}</span><span class="lab">${lab}</span>
        <input type="file" accept="image/*" data-d="${d.date}" data-leg="${leg}" hidden></label>`;
    }).join('');
    panel = `<div class="wl-panel">
      <div class="wl-slots">${slots}</div>
      <div class="wl-odo">계기판 km(선택):
        <input type="number" inputmode="numeric" placeholder="출발" data-odo="${d.date}" data-leg="start" value="${odo.start ?? ''}">
        <input type="number" inputmode="numeric" placeholder="복귀" data-odo="${d.date}" data-leg="home" value="${odo.home ?? ''}">
        <button class="wl-btn wl-no" data-odosave="${d.date}">저장</button>
      </div><div class="wl-up" id="up-${d.date}"></div></div>`;
  }
  const open = d.date === wlOpenDate ? ' open' : '';
  return `<div class="wl-card${attn ? ' attn' : ''}${open}" data-card="${d.date}">
    <div class="wl-crow">
      <div class="wl-badge"><div class="dd">${day}</div><div class="ww ${wc}">${WD[dow]}</div></div>
      <div class="wl-cmid"><div class="tee">${esc(tee)}</div><div class="meta">${meta}</div></div>
      ${right}
      ${expandable ? `<span class="wl-caret">▾</span>` : ''}
    </div>${panel}</div>`;
}

// 예/아니오 선택 배선 — 최초 카드와 '변경' 후 재선택 모두에 공용. 취소는 원래 확정값으로 복원.
function wlBindChoice(scope) {
  scope.querySelectorAll('button[data-w]').forEach((b) => {
    b.onclick = async (e) => { e.stopPropagation(); await postJSON('/api/worklog/confirm', { date: b.dataset.d, worked: b.dataset.w === '1' }); reloadWorklog(); };
  });
  scope.querySelectorAll('.wl-cancel').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); reloadWorklog(); };
  });
}
function wlBind() {
  // 카드 펼침/접힘(버튼 클릭은 제외)
  $('wlDays').querySelectorAll('.wl-card').forEach((el) => {
    const row = el.querySelector('.wl-crow');
    if (!el.querySelector('.wl-caret')) return;
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      const d = el.dataset.card;
      wlOpenDate = el.classList.contains('open') ? null : d;
      el.classList.toggle('open');
    };
  });
  // 예/아니오 (최초 선택 + 재선택 공용)
  wlBindChoice($('wlDays'));
  // 확정 후 '변경' → 그 자리에서 예/아니오 다시 고르기(취소하면 원래대로 복원)
  $('wlDays').querySelectorAll('.wl-change').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const box = b.closest('.wl-right'); if (!box) return;
      box.innerHTML = `<button class="wl-btn wl-yes" data-w="1" data-d="${b.dataset.d}">예</button><button class="wl-btn wl-no" data-w="0" data-d="${b.dataset.d}">아니오</button><button class="wl-cancel" data-d="${b.dataset.d}">취소</button>`;
      wlBindChoice(box);
    };
  });
  // 계기판 사진 업로드
  $('wlDays').querySelectorAll('input[type=file][data-leg]').forEach((inp) => {
    inp.onchange = async () => {
      if (!inp.files || !inp.files[0]) return;
      const dt = inp.dataset.d, up = $('up-' + dt); if (up) up.textContent = '업로드 중…';
      wlOpenDate = dt;
      try { const image = await compressImage(inp.files[0]); await postJSON('/api/worklog/photo', { date: dt, leg: inp.dataset.leg, image }); await reloadWorklog(); }
      catch (e) { if (up) up.textContent = '업로드 실패: ' + e.message; }
    };
  });
  // 계기판 숫자 저장
  $('wlDays').querySelectorAll('button[data-odosave]').forEach((b) => {
    b.onclick = async () => {
      const dt = b.dataset.odosave, odo = {};
      $('wlDays').querySelectorAll(`input[data-odo="${dt}"]`).forEach((i) => { if (i.value !== '') odo[i.dataset.leg] = Number(i.value); });
      wlOpenDate = dt;
      await postJSON('/api/worklog/odo', { date: dt, odo }); await reloadWorklog();
    };
  });
}
function compressImage(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { let w = img.width, h = img.height; if (Math.max(w, h) > maxSide) { const r = maxSide / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); } const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h); resolve(cv.toDataURL('image/jpeg', quality)); };
    img.onerror = reject;
    const fr = new FileReader(); fr.onload = () => { img.src = fr.result; }; fr.onerror = reject; fr.readAsDataURL(file);
  });
}
function initWorklogButtons() {
  $('wlSave').onclick = async () => { await postJSON('/api/worklog/settings', { homeGolfKmOneway: Number($('wlKm').value) || 0, driverName: $('wlName').value.trim(), carNo: $('wlCar').value.trim() }); reloadWorklog(); };
  // 월 이동 (연 경계 넘으면 자동으로 연도도 이동 → 필요 시 재요청)
  $('wlPrev').onclick = () => { wlMonth--; if (wlMonth < 1) { wlMonth = 12; wlYear--; } wlOpenDate = null; loadWorklog(); };
  $('wlNext').onclick = () => { if ($('wlNext').disabled) return; wlMonth++; if (wlMonth > 12) { wlMonth = 1; wlYear++; } wlOpenDate = null; loadWorklog(); };
  $('wlJump').onclick = () => { const n = new Date(); wlYear = n.getFullYear(); wlMonth = n.getMonth() + 1; wlOpenDate = null; loadWorklog(); };
  $('wlFuelToggle').onclick = () => { wlFuelOn = !wlFuelOn; renderWorklog(); };
  $('wlSeg').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { wlFilter = b.dataset.f; $('wlSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderWorklog(); };
  });
  // 내보내기 — 지금 보는 그 달 기준
  $('wlExport').onclick = () => window.open(`/api/worklog/export.csv?year=${wlYear}&month=${wlMonth}`, '_blank');
  $('wlReport').onclick = () => window.open(`/api/worklog/report.html?year=${wlYear}&month=${wlMonth}`, '_blank');
}

/* ── 정산 (수익·팁·지출·수익계산서) ── */
let lgYear = null, lgMonth = null, lgData = null, lgProfile = { name: '', workplace: '리버힐CC' };
let lgOpenDate = null;    // 펼쳐진 날짜 단락
let lgExpForm = null;     // 지출 입력 폼 { id?, date, category, amount, vendor, method, photoData?, scanned?, _scanned? }
let lgPage = -1;          // 7일 페이지네이션(오름차순). -1 = 첫 표시 → 가장 최근 페이지로 스냅
let lgFilter = 'all';     // 날짜별 정산 필터: 'all'(그 달 전체 날짜) | 'rec'(근무·지출 있는 날만)
let lgDocPeriod = 'month'; // 문서 대상: 'month' | 'year'
let lgDocCtx = null;      // 미리보기/문서 컨텍스트
let lgDayList = [];       // 이 달 날짜 목록(근무 or 지출) — 최신순
const lgTipDirty = new Set();
const LG_PAGE = 7;
const wonKo = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const manKo = (n) => { const v = Number(n) || 0; return v >= 10000 ? `${(v / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만` : v.toLocaleString('ko-KR'); };
const lgFEES = () => (lgData && lgData.fees) || { 1: 140000, 2: 140000, 3: 150000 };
const lgDow = (iso) => WD[new Date(iso + 'T00:00:00').getDay()];
const lgMD = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const lgTang = (parts) => parts.length >= 3 ? '54(1·2·3부)' : (parts.length ? parts.map((p) => p + '부').join('·') : '근무없음');
const lgExpSumOf = (d) => d.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
const lgNetOf = (d) => (Number(d.revenue) || 0) + (Number(d.tip) || 0) - lgExpSumOf(d);

async function loadLedger() {
  const now = new Date();
  if (lgYear == null) { lgYear = now.getFullYear(); lgMonth = now.getMonth() + 1; }
  try {
    const r = await (await fetch(`/api/ledger?year=${lgYear}&month=${lgMonth}`)).json();
    lgData = r.summary; lgProfile = r.profile || { name: '', workplace: '리버힐CC' };
  } catch { $('lgMLabel').textContent = '불러오기 실패'; return; }
  renderLedger();
}
async function lgFlushTips() {
  if (!lgTipDirty.size) return;
  const dates = [...lgTipDirty]; lgTipDirty.clear();
  await Promise.all(dates.map((dt) => { const d = lgDayList.find((x) => x.date === dt); return postJSON('/api/ledger/tip', { date: dt, amount: d ? d.tip : 0 }); }));
}
async function lgReload() { await lgFlushTips(); await loadLedger(); }

// 근무 rows + 지출을 날짜별로 합침
function lgBuildDays() {
  const map = new Map();
  (lgData.rows || []).forEach((r) => map.set(r.date, { date: r.date, parts: r.parts.slice(), revenue: r.revenue, tip: r.tip || 0, worked: true, expenses: [] }));
  (lgData.expenses || []).forEach((e) => {
    let d = map.get(e.date);
    if (!d) { d = { date: e.date, parts: [], revenue: 0, tip: 0, worked: false, expenses: [] }; map.set(e.date, d); }
    d.expenses.push(e);
  });
  // '전체' 필터: 근무 안 한 날에도 지출을 기록할 수 있도록 그 달의 모든 날짜(오늘까지)를 빈 칸으로 채움.
  if (lgFilter === 'all') {
    const now = new Date();
    const isCur = lgYear === now.getFullYear() && lgMonth === now.getMonth() + 1;
    const last = new Date(lgYear, lgMonth, 0).getDate();
    const cap = isCur ? Math.min(last, now.getDate()) : last;
    for (let day = 1; day <= cap; day++) {
      const iso = `${lgYear}-${String(lgMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!map.has(iso)) map.set(iso, { date: iso, parts: [], revenue: 0, tip: 0, worked: false, expenses: [] });
    }
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function renderLedger() {
  if (!lgData) return;
  lgDayList = lgBuildDays();
  const now = new Date(), realY = now.getFullYear(), realM = now.getMonth() + 1;
  $('lgMLabel').textContent = `${lgYear}년 ${lgMonth}월`;
  const isNow = lgYear === realY && lgMonth === realM;
  $('lgMSub').textContent = isNow ? '이번 달' : '지난 기록';
  $('lgThisMo').hidden = isNow;
  $('lgNext').disabled = (lgYear > realY) || (lgYear === realY && lgMonth >= realM);
  refreshLgTotals();
  renderLgList();
  updateDocDesc();
}

function refreshLgTotals() {
  const workRev = lgDayList.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
  const tipSum = lgDayList.reduce((s, d) => s + (Number(d.tip) || 0), 0);
  const expSum = lgDayList.reduce((s, d) => s + lgExpSumOf(d), 0);
  $('lgNet').textContent = wonKo(workRev + tipSum - expSum);
  $('lgInc').textContent = wonKo(workRev + tipSum);
  $('lgExpSum').textContent = wonKo(expSum);
  $('lgWorkRev').textContent = manKo(workRev);
  $('lgTipSum').textContent = manKo(tipSum);
  $('lgExp').textContent = manKo(expSum);
  const F = lgFEES(), byPart = { 1: { days: 0, amt: 0 }, 2: { days: 0, amt: 0 }, 3: { days: 0, amt: 0 } };
  lgDayList.forEach((d) => d.parts.forEach((p) => { if (byPart[p]) { byPart[p].days++; byPart[p].amt += F[p]; } }));
  $('lgParts').innerHTML = ['3', '2', '1'].filter((p) => byPart[p].days).map((p) => `<span class="lg-pill">${p}부 ${byPart[p].days}일 · ${manKo(byPart[p].amt)}</span>`).join('')
    || '<span class="lg-pill none">이 달 확정 근무가 아직 없어요</span>';
  const pend = lgData.pendingDays || 0;
  $('lgPend').hidden = !pend;
  if (pend) $('lgPend').innerHTML = `확인 대기 ${pend}일 (예상 ${manKo(lgData.pendingRevenue || 0)}) — 근무 기록에서 '예'로 확정하면 합산돼요.`;
}

function lgBrkText(d) { return `${lgTang(d.parts)} 캐디피 ${manKo(d.revenue)} · 팁 ${manKo(d.tip)} · 지출 ${manKo(lgExpSumOf(d))}`; }

function renderLgList() {
  const pages = Math.max(1, Math.ceil(lgDayList.length / LG_PAGE));
  if (lgPage < 0) lgPage = pages - 1;        // 첫 표시 → 가장 최근(마지막) 페이지
  if (lgPage > pages - 1) lgPage = pages - 1;
  const shown = lgDayList.slice(lgPage * LG_PAGE, lgPage * LG_PAGE + LG_PAGE);
  $('lgList').innerHTML = shown.length ? shown.map(lgAccHTML).join('') : '<div class="lg-listempty">이 달 근무·지출 기록이 없어요.</div>';
  shown.forEach((d) => { if (d._saved) delete d._saved; });
  const first = shown[0], last = shown[shown.length - 1];
  const range = first ? `${lgMD(first.date)}(${lgDow(first.date)}) ~ ${lgMD(last.date)}(${lgDow(last.date)})` : '기록 없음';
  $('lgPager').innerHTML = `<button data-pg="prev" ${lgPage <= 0 ? 'disabled' : ''}>‹ 이전 7일</button>
    <div class="pinfo">${lgPage + 1} / ${pages}<span>${range}</span></div>
    <button data-pg="next" ${lgPage >= pages - 1 ? 'disabled' : ''}>다음 7일 ›</button>`;
  bindLg();
}

function lgAccHTML(d) {
  const open = d.date === lgOpenDate;
  const empty = !d.worked && !d.expenses.length;
  const net = empty ? '기록 없음' : '순수입 ' + wonKo(lgNetOf(d));
  const brk = empty ? '' : lgBrkText(d);
  return `<div class="lg-acc${open ? ' open' : ''}${d._saved ? ' saved' : ''}${empty ? ' noday' : ''}" id="lgAcc-${d.date}">
    <div class="lg-ahead" data-tog="${d.date}">
      <div class="lg-cal"><span class="md">${lgMD(d.date)}</span><span class="dw">${lgDow(d.date)}</span></div>
      <div class="lg-amid"><div class="lg-anet" id="lgNetR-${d.date}">${net}</div>
        <div class="lg-abrk" id="lgBrk-${d.date}">${brk}</div></div>
      <div class="lg-chev"><span class="lg-hint">${open ? '닫기' : (empty ? '지출 추가' : '수정')}</span><span class="lg-car">▾</span></div>
    </div>${open ? lgBodyHTML(d) : ''}</div>`;
}

function lgBodyHTML(d) {
  const F = lgFEES();
  let head;
  if (d.worked) {
    const chips = ['1', '2', '3'].map((p) => `<span class="lg-pchip${d.parts.includes(p) ? ' on' : ''}" data-part="${d.date}|${p}">${p}부</span>`).join('');
    const calc = d.parts.length ? d.parts.map((p) => `${p}부 ${manKo(F[p])}`).join(' + ') + ` = <b>${manKo(d.revenue)}</b>` : '부를 하나 이상 선택하세요';
    head = `<div class="lg-asub">근무 · 캐디피 <span class="dim">(고정단가 · 자동합산)</span></div>
      <div class="lg-arow"><span class="lbl">부 조합</span>${chips}<span class="lg-val" id="lgRevR-${d.date}">${wonKo(d.revenue)}</span>
        <div class="lg-calc">${calc} <span style="color:#9aa49c;">· 1·2부 14만 / 3부 15만 고정</span></div></div>
      <div class="lg-asub">팁 <span class="dim">(만원 단위 · 입력 즉시 반영)</span></div>
      <div class="lg-arow"><span class="lbl">받은 팁</span>
        <span class="lg-tipin"><input id="lgTipI-${d.date}" inputmode="decimal" placeholder="0" value="${d.tip ? d.tip / 10000 : ''}"><span class="u">만원</span></span></div>`;
  } else {
    head = `<div class="lg-daynote">이 날은 근무 확정이 없어요 — 지출만 기록됩니다. (근무는 '근무 기록'에서 확정)</div>`;
  }
  const exps = d.expenses.length ? d.expenses.map((e) => lgExpRow(e, d.date)).join('') : '<div class="lg-empty">이 날 지출이 아직 없어요.</div>';
  const showForm = lgExpForm && lgExpForm.date === d.date;
  const msg = showForm && lgExpForm._scanned ? `<div class="lg-scanmsg">사진 자동 스캔 완료 · 로컬 판독(크레딧 0) — 이 날짜(${lgMD(d.date)})로 자동 기록. 값이 틀리면 고치세요.</div>` : '';
  const addBtns = showForm ? '' : `<div class="lg-expadd">
      <label class="lg-scan" id="lgScanLbl-${d.date}"><svg class="lg-ico"><use href="#ic-cam"/></svg> 사진 자료 자동 스캔<input type="file" accept="image/*" id="lgScanIn-${d.date}" hidden></label>
      <button class="lg-manual" data-manual="${d.date}">＋ 사진 없이 직접 입력 <small>(스캔 대신 수동)</small></button>
    </div>`;
  return `<div class="lg-abody">
    ${head}
    <div class="lg-asub">지출 · 영수증</div>
    ${exps}${msg}${addBtns}${showForm ? lgFormHTML(d) : ''}
    <div class="lg-savebar"><button class="lg-savebtn" data-save="${d.date}">저장하고 닫기</button>
      <div class="lg-savehint">저장하면 이 칸이 접히고 위 합계에 바로 반영돼요.</div></div>
  </div>`;
}

function lgExpRow(e, date) {
  const sub = [e.vendor, e.method].filter(Boolean).join(' · ');
  const photo = e.photo ? `<img class="ephoto" src="/api/ledger/photo/${e.photo}?t=${e.at || 0}" alt="영수증">` : '';
  return `<div class="lg-exp"><span class="ec">${esc(e.category)}</span>
    <div class="einfo"><div class="et">${wonKo(e.amount)}</div>${sub ? `<div class="es">${esc(sub)}</div>` : ''}</div>
    ${photo}
    <button class="edit-e" data-ee="${date}|${e.id}" style="font-size:11px;background:none;border:0;color:#5a8;cursor:pointer;">수정</button>
    <button class="edel" data-del="${e.id}">✕</button></div>`;
}

function lgFormHTML(d) {
  const f = lgExpForm;
  const cats = ['주유', '톨비', '식대', '주차', '기타'].map((c) => `<span class="cat${f.category === c ? ' on' : ''}" data-cat="${c}">${c}</span>`).join('');
  const methods = ['', '카드', '현금영수증', '현금', '세금계산서', '간이영수증'].map((m) => `<option value="${m}"${f.method === m ? ' selected' : ''}>${m || '결제수단'}</option>`).join('');
  return `<div class="lg-eform">
    <div class="eh">${f._scanned ? '스캔 결과 — 확인 후 추가' : (f.id ? '지출 수정' : '지출 직접 입력')}</div>
    <div class="cats">${cats}</div>
    <div class="r"><input class="amt" id="lgeAmt" inputmode="numeric" placeholder="금액" value="${f.amount || ''}"><span style="font-size:11px;color:#9aa49c;">원</span>
      <input class="vd" id="lgeVendor" placeholder="사용처(선택)" value="${esc(f.vendor || '')}"></div>
    <div class="r"><select id="lgeMethod" style="flex:1;">${methods}</select></div>
    ${(f.photoData || f.photo) ? `<div style="font-size:11px;color:#2c6b45;">사진 첨부됨 · ${lgMD(d.date)}(${lgDow(d.date)})로 기록</div>` : ''}
    <div class="foot"><button class="cx" data-efcx>취소</button><button class="ok" data-efok="${d.date}">${f.id ? '저장' : '추가'}</button></div>
  </div>`;
}

function lgPatchDay(date) {
  const d = lgDayList.find((x) => x.date === date); if (!d) return;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('lgNetR-' + date, '순수입 ' + wonKo(lgNetOf(d)));
  set('lgBrk-' + date, lgBrkText(d));
  set('lgRevR-' + date, wonKo(d.revenue));
}
function lgCommitTip(date) {
  const el = document.getElementById('lgTipI-' + date), d = lgDayList.find((x) => x.date === date);
  if (el && d) { d.tip = Math.max(0, Math.round((parseFloat(String(el.value).replace(/[^\d.]/g, '')) || 0) * 10000)); lgTipDirty.add(date); }
}
function lgSyncForm() {
  if (!lgExpForm) return;
  const a = document.getElementById('lgeAmt'), v = document.getElementById('lgeVendor'), m = document.getElementById('lgeMethod');
  if (a) lgExpForm.amount = a.value; if (v) lgExpForm.vendor = v.value; if (m) lgExpForm.method = m.value;
}

async function lgScan(inp) {
  if (!inp.files || !inp.files[0]) return;
  const date = inp.id.replace('lgScanIn-', '');
  const lbl = document.getElementById('lgScanLbl-' + date);
  if (lbl) { lbl.classList.add('busy'); lbl.innerHTML = '<svg class="lg-ico"><use href="#ic-cam"/></svg> 스캔 중…'; }
  try {
    const image = await compressImage(inp.files[0], 1400, 0.75);
    const r = await postJSON('/api/ledger/scan', { image });
    if (r.ok && r.parsed) lgExpForm = { date, category: r.parsed.category || '기타', amount: r.parsed.amount || '', vendor: r.parsed.vendor || '', method: r.parsed.method || '', photoData: image, scanned: true, _scanned: true };
    else lgExpForm = { date, category: '기타', amount: '', vendor: '', method: '', photoData: image };
  } catch { lgExpForm = { date, category: '기타', amount: '', vendor: '', method: '' }; }
  inp.value = '';
  renderLgList();
}

async function lgSaveExpense(date) {
  lgSyncForm();
  const amt = Math.max(0, Number(String(lgExpForm.amount).replace(/[^\d]/g, '')) || 0);
  if (!amt) { alert('금액을 입력하세요.'); return; }
  const body = { date, category: lgExpForm.category || '기타', amount: amt, vendor: lgExpForm.vendor || '', method: lgExpForm.method || '', scanned: !!lgExpForm.scanned };
  let id = lgExpForm.id;
  if (id) await postJSON('/api/ledger/expense/' + id, body);
  else { const r = await postJSON('/api/ledger/expense', body); id = r.expense && r.expense.id; }
  if (id && lgExpForm.photoData) await postJSON('/api/ledger/expense/' + id + '/photo', { image: lgExpForm.photoData });
  lgExpForm = null;
  lgReload();
}

function bindLg() {
  // 단락 열고 닫기
  document.querySelectorAll('#lgList [data-tog]').forEach((h) => h.onclick = async () => {
    const date = h.dataset.tog;
    if (lgOpenDate && lgOpenDate !== date) lgCommitTip(lgOpenDate);
    lgOpenDate = lgOpenDate === date ? null : date; lgExpForm = null;
    renderLgList(); refreshLgTotals(); await lgFlushTips();
  });
  // 부 조합 토글(낙관적 반영 후 저장)
  document.querySelectorAll('#lgList [data-part]').forEach((c) => c.onclick = () => {
    const [date, p] = c.dataset.part.split('|'), d = lgDayList.find((x) => x.date === date); if (!d) return;
    const set = new Set(d.parts); set.has(p) ? set.delete(p) : set.add(p);
    if (set.size === 0) return;
    d.parts = [...set].sort();
    const F = lgFEES(); d.revenue = d.parts.reduce((s, q) => s + F[q], 0);
    renderLgList(); refreshLgTotals();
    postJSON('/api/ledger/dayparts', { date, parts: d.parts });
  });
  // 팁 실시간 반영(포커스 유지)
  const tipEl = lgOpenDate && document.getElementById('lgTipI-' + lgOpenDate);
  if (tipEl) {
    tipEl.oninput = () => {
      const d = lgDayList.find((x) => x.date === lgOpenDate); if (!d) return;
      d.tip = Math.max(0, Math.round((parseFloat(String(tipEl.value).replace(/[^\d.]/g, '')) || 0) * 10000));
      lgTipDirty.add(lgOpenDate); lgPatchDay(lgOpenDate); refreshLgTotals();
    };
    tipEl.onblur = () => { lgCommitTip(lgOpenDate); lgFlushTips(); };
  }
  // 지출 스캔 / 직접입력
  document.querySelectorAll('#lgList [id^="lgScanIn-"]').forEach((inp) => inp.onchange = () => lgScan(inp));
  document.querySelectorAll('#lgList [data-manual]').forEach((b) => b.onclick = () => { lgExpForm = { date: b.dataset.manual, category: '기타', amount: '', vendor: '', method: '' }; renderLgList(); });
  document.querySelectorAll('#lgList [data-cat]').forEach((c) => c.onclick = () => { lgSyncForm(); lgExpForm.category = c.dataset.cat; renderLgList(); });
  document.querySelectorAll('#lgList [data-efcx]').forEach((b) => b.onclick = () => { lgExpForm = null; renderLgList(); });
  document.querySelectorAll('#lgList [data-efok]').forEach((b) => b.onclick = () => lgSaveExpense(b.dataset.efok));
  document.querySelectorAll('#lgList [data-ee]').forEach((b) => b.onclick = () => {
    const [date, id] = b.dataset.ee.split('|'), d = lgDayList.find((x) => x.date === date), e = d && d.expenses.find((x) => String(x.id) === id);
    if (e) { lgExpForm = { id: e.id, date, category: e.category, amount: e.amount, vendor: e.vendor || '', method: e.method || '' }; renderLgList(); }
  });
  document.querySelectorAll('#lgList [data-del]').forEach((b) => b.onclick = async () => { if (!confirm('이 지출을 삭제할까요?')) return; await fetch('/api/ledger/expense/' + b.dataset.del, { method: 'DELETE' }); lgReload(); });
  // 저장하고 닫기
  document.querySelectorAll('#lgList [data-save]').forEach((b) => b.onclick = async () => {
    lgCommitTip(b.dataset.save); await lgFlushTips();
    const d = lgDayList.find((x) => x.date === b.dataset.save); if (d) d._saved = true;
    lgOpenDate = null; lgExpForm = null; renderLgList(); refreshLgTotals();
  });
  // 페이지네이션
  $('lgPager').querySelectorAll('[data-pg]').forEach((b) => b.onclick = async () => {
    if (b.disabled) return;
    if (lgOpenDate) lgCommitTip(lgOpenDate); await lgFlushTips();
    lgPage += b.dataset.pg === 'next' ? 1 : -1; lgOpenDate = null; lgExpForm = null;
    renderLgList();
  });
  // 필터(전체 날짜 / 근무·지출일만)
  $('lgFilter').querySelectorAll('[data-flt]').forEach((b) => {
    b.classList.toggle('on', b.dataset.flt === lgFilter);
    b.onclick = async () => {
      if (lgFilter === b.dataset.flt) return;
      if (lgOpenDate) lgCommitTip(lgOpenDate); await lgFlushTips();
      lgFilter = b.dataset.flt; lgOpenDate = null; lgExpForm = null; lgPage = -1;
      lgDayList = lgBuildDays(); renderLgList();
    };
  });
}

/* ── 수익계산서 문서 ── */
function lgDocOpts() { return { rev: $('lgORev').checked, tip: $('lgOTip').checked, exp: $('lgOExp').checked }; }
function updateDocDesc() {
  const o = lgDocOpts();
  let name = o.rev && o.exp ? '수입·지출 정산서(순이익 포함)' : o.rev ? '수입 정산서' : o.exp ? '지출 정산서' : '(항목을 하나 이상 선택)';
  const bits = []; if (o.rev) bits.push('부별 수익' + (o.tip ? '+팁' : '')); if (o.exp) bits.push('지출 내역');
  $('lgDocDesc').textContent = name + (bits.length ? ' — ' + bits.join(' · ') : '');
  $('lgDocScope').textContent = lgDocPeriod === 'year' ? `${lgYear}년 전체(월별 요약)` : `${lgYear}년 ${lgMonth}월`;
}

// 문서 본문(head/style 제외) — 미리보기·PDF·Word 공용
function lgReportInner(o, S, opts) {
  const rows = (S.rows || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const period = opts.period, isYear = opts.isYear, profile = opts.profile || { name: '', workplace: '리버힐CC' };
  const title = o.rev && o.exp ? '수입·지출 정산서' : o.rev ? '수입 정산서' : '지출 정산서';
  const F = S.fees || { 1: 140000, 2: 140000, 3: 150000 };
  const byPart = { 1: { days: 0, amt: 0, fee: F[1] }, 2: { days: 0, amt: 0, fee: F[2] }, 3: { days: 0, amt: 0, fee: F[3] } };
  rows.forEach((r) => r.parts.forEach((p) => { if (byPart[p]) { byPart[p].days++; byPart[p].amt += F[p]; } }));
  const workRev = rows.reduce((s, r) => s + r.revenue, 0), tipTot = rows.reduce((s, r) => s + (r.tip || 0), 0);
  const w = (n) => wonKo(n), tk = (parts) => parts.length >= 3 ? '54(1·2·3부)' : parts.map((p) => p + '부').join('·');

  let revBlock = '';
  if (o.rev) {
    let detTitle, detHead, detBody;
    if (isYear) {
      const bm = {}; rows.forEach((r) => { const mk = r.date.slice(0, 7); (bm[mk] = bm[mk] || { days: 0, rev: 0, tip: 0 }); bm[mk].days++; bm[mk].rev += r.revenue; bm[mk].tip += (r.tip || 0); });
      const keys = Object.keys(bm).sort();
      detTitle = '월별 요약';
      detHead = `<tr><th>월</th><th>근무일</th><th>캐디피</th>${o.tip ? '<th>팁</th>' : ''}</tr>`;
      detBody = keys.length ? keys.map((k) => `<tr><td>${Number(k.slice(5, 7))}월</td><td class="num">${bm[k].days}일</td><td class="num st">${w(bm[k].rev)}</td>${o.tip ? `<td class="num">${bm[k].tip ? w(bm[k].tip) : '-'}</td>` : ''}</tr>`).join('') : `<tr><td colspan="${o.tip ? 4 : 3}" class="mid">확정된 근무가 없습니다.</td></tr>`;
    } else {
      detTitle = '근무일별 내역';
      detHead = `<tr><th>No</th><th>근무일</th><th>근무(부)</th><th>캐디피</th>${o.tip ? '<th>팁</th>' : ''}</tr>`;
      detBody = rows.length ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.date}(${lgDow(r.date)})</td><td>${tk(r.parts)}</td><td class="num st">${w(r.revenue)}</td>${o.tip ? `<td class="num">${r.tip ? w(r.tip) : '-'}</td>` : ''}</tr>`).join('') : `<tr><td colspan="${o.tip ? 5 : 4}" class="mid">확정된 근무가 없습니다.</td></tr>`;
    }
    const partRows = ['1', '2', '3'].filter((p) => byPart[p].days).map((p) => `<tr><td>${p}부</td><td class="num">${byPart[p].days}일</td><td class="num">${w(byPart[p].fee)}</td><td class="num st">${w(byPart[p].amt)}</td></tr>`).join('') || `<tr><td colspan="4" class="mid">-</td></tr>`;
    const totalRev = o.tip ? workRev + tipTot : workRev;
    revBlock = `<h2>1. 수입</h2><h3>${detTitle}</h3>
      <table class="log"><thead>${detHead}</thead><tbody>${detBody}</tbody></table>
      <h3>부별 요약</h3>
      <table class="log"><thead><tr><th>구분</th><th>근무일</th><th>캐디피(1회)</th><th>금액</th></tr></thead><tbody>${partRows}</tbody>
      <tfoot><tr class="sub"><td colspan="3">근무 수입 소계</td><td class="num st">${w(workRev)}</td></tr>
      ${o.tip ? `<tr class="sub"><td colspan="3">팁 합계</td><td class="num st">${w(tipTot)}</td></tr>` : ''}
      <tr class="tot"><td colspan="3">수입 합계</td><td class="num">${w(totalRev)}</td></tr></tfoot></table>`;
  }
  let expBlock = '';
  if (o.exp) {
    const exps = (S.expenses || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const byCat = {}; exps.forEach((e) => { const c = e.category || '기타'; byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0); });
    const expTot = exps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const catRows = Object.keys(byCat).length ? Object.entries(byCat).map(([c, a]) => `<tr><td>${esc(c)}</td><td class="num st">${w(a)}</td></tr>`).join('') : `<tr><td colspan="2" class="mid">등록된 지출이 없습니다.</td></tr>`;
    const detRows = exps.length ? exps.map((e, i) => `<tr><td>${i + 1}</td><td>${e.date}(${lgDow(e.date)})</td><td>${esc(e.category)}</td><td>${esc(e.vendor || '')}</td><td>${esc(e.method || '')}</td><td class="num st">${w(e.amount)}</td></tr>`).join('') : `<tr><td colspan="6" class="mid">—</td></tr>`;
    // 지출 내역이 있을 때만 '지출 상세(증빙)' 표를 넣는다(없으면 빈 표가 페이지를 넘겨 순이익이 다음 장으로 밀림).
    const detailTable = exps.length ? `<h3>지출 상세(증빙)</h3>
      <table class="log"><thead><tr><th>No</th><th>일자</th><th>항목</th><th>사용처</th><th>결제</th><th>금액</th></tr></thead><tbody>${detRows}</tbody></table>` : '';
    expBlock = `<h2${o.rev ? ' class="pb-before"' : ''}>${o.rev ? '2' : '1'}. 지출(업무 경비)</h2>
      <table class="log half"><thead><tr><th>항목</th><th>금액</th></tr></thead><tbody>${catRows}</tbody><tfoot><tr class="tot"><td>지출 합계</td><td class="num">${w(expTot)}</td></tr></tfoot></table>
      ${detailTable}`;
  }
  let netBlock = '';
  // 순이익 표 — 수입·지출 둘 다 선택 시 항상(지출 페이지에 함께 표시).
  if (o.rev && o.exp) {
    const inc = o.tip ? workRev + tipTot : workRev, expTot = (S.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    netBlock = `<table class="net"><tbody><tr><td>수입 합계</td><td class="num">${w(inc)}</td></tr><tr><td>지출 합계</td><td class="num">− ${w(expTot)}</td></tr><tr class="tot"><td>순이익</td><td class="num">${w(inc - expTot)}</td></tr></tbody></table>`;
  }
  return `<h1>${title}</h1><div class="sub">대상 기간: ${period} · 사업소득(캐디) 종합소득세 참고자료</div>
    <table class="meta"><tr><td class="k">성명</td><td>${esc(profile.name || '(설정에서 입력)')}</td><td class="k">사업장</td><td>${esc(profile.workplace || '리버힐CC')}</td></tr>
    <tr><td class="k">확정 근무</td><td>${rows.length}일</td><td class="k">작성 구분</td><td>${title}</td></tr></table>
    ${revBlock}${expBlock}${netBlock}
    <div class="note">※ ${o.rev ? '수입은 확정 근무일 × 부별 캐디피(1·2부 14만원, 3부 15만원) 자동 합산입니다. ' : ''}${o.exp ? '지출의 실제 증빙은 영수증·카드매출전표·현금영수증(지출증빙용)·세금계산서이며, 본 문서는 이를 정리한 소명자료입니다. 세무사 상담을 권장합니다.' : ''}</div>`;
}

const LG_WORD_CSS = `body{font-family:-apple-system,"Malgun Gothic",sans-serif;color:#1a201d;margin:0;padding:24px;background:#fff;font-size:12.5px;}
h1{font-size:21px;margin:0 0 3px;} .sub{color:#666;font-size:12px;margin-bottom:16px;}
h2{font-size:15px;border-top:2px solid #0b5d34;padding-top:11px;margin:20px 0 8px;} h3{font-size:12.5px;color:#0b5d34;margin:13px 0 6px;}
table{width:100%;border-collapse:collapse;margin-bottom:8px;}
table.meta td{border:1px solid #ccc;padding:6px 9px;font-size:12px;} table.meta .k{background:#f4f6f5;font-weight:700;width:84px;}
table.log{font-size:12px;} table.log.half{width:64%;}
table.log th,table.log td{border:1px solid #bbb;padding:5px 8px;text-align:left;} table.log th{background:#0b5d34;color:#fff;font-size:11.5px;}
td.num{text-align:right;} td.st{font-weight:700;} td.mid{text-align:center;color:#999;}
table.log tfoot td{background:#eef2f0;font-weight:700;} table.log tfoot tr.tot td{background:#0b5d34;color:#fff;font-size:13px;}
table.net{width:64%;} table.net td{border:1px solid #bbb;padding:8px 10px;font-size:13px;} table.net td.num{text-align:right;font-weight:700;} table.net tr.tot td{background:#0b5d34;color:#fff;font-size:14px;}
.note{font-size:10.5px;color:#777;margin-top:14px;line-height:1.65;}
.pb-before{page-break-before:always;break-before:page;}
.bar{position:sticky;top:0;background:#0b5d34;padding:10px;text-align:center;margin:-24px -24px 18px;} .bar button{font-size:14px;font-weight:700;padding:9px 18px;border:0;border-radius:8px;background:#fff;color:#0b5d34;}
@media print{.bar{display:none;}}`;

function lgFullDoc(forWord) {
  const { o, S, period, isYear, profile } = lgDocCtx;
  const title = o.rev && o.exp ? '수입·지출 정산서' : o.rev ? '수입 정산서' : '지출 정산서';
  const mso = forWord ? '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' : '';
  const bar = forWord ? '' : '<div class="bar"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title} ${period}</title>${mso}<style>${LG_WORD_CSS}</style></head><body>${bar}${lgReportInner(o, S, { period, isYear, profile })}</body></html>`;
}

async function lgOpenDoc(kind) {
  const o = lgDocOpts();
  if (!o.rev && !o.exp) { alert('수익 또는 지출 중 하나는 선택하세요.'); return; }
  let S = lgData, period = `${lgYear}년 ${lgMonth}월`, isYear = false, profile = lgProfile;
  if (lgDocPeriod === 'year') {
    try { const r = await (await fetch(`/api/ledger?year=${lgYear}`)).json(); S = r.summary; profile = r.profile || lgProfile; }
    catch { alert('연 자료를 불러오지 못했어요.'); return; }
    period = `${lgYear}년 전체`; isYear = true;
  }
  lgDocCtx = { o, S, period, isYear, profile, kind };
  // ★미리보기 = 출력(WYSIWYG): PDF 캡처와 동일한 A4 문서 폭(760px)으로 렌더한 뒤 화면 폭에 맞게 축소.
  //  (예전엔 .lgdoc가 폰 좁은 폭에 눌려 표가 세로로 쭈그러들어 실제 PDF와 딴판이었음)
  $('lgMFrame').innerHTML = '<div class="lgdoc-wrap"><div class="lgdoc" id="lgDocEl" style="width:760px;max-width:none;margin:0;padding:24px;box-sizing:border-box;">' + lgReportInner(o, S, { period, isYear, profile }) + '</div></div>';
  $('lgMTitle').textContent = (kind === 'pdf' ? 'PDF 미리보기 · ' : 'Word 미리보기 · ') + period;
  $('lgMNote').textContent = '인쇄 = 등록 프린터로 출력(그 창에서 "PDF로 저장"도 가능). 저장·공유 = 파일로 저장하거나 카톡 등으로 공유.';
  $('lgMSaveLbl').textContent = kind === 'word' ? 'Word(.doc) 저장·공유' : 'PDF 저장·공유';
  $('lgMSave').onclick = kind === 'word' ? lgSaveWord : lgSavePdf;
  $('lgModal').hidden = false;
  $('lgMFrame').scrollTop = 0;
  requestAnimationFrame(lgScalePreview);   // 모달 표시 후 프레임 폭이 잡히면 축소 계산
}

// 미리보기 = 출력: 760px 문서를 프레임 폭에 맞춰 transform:scale로 축소(비율 유지 → PDF와 동일 모습).
function lgScalePreview() {
  const frame = $('lgMFrame'), docEl = $('lgDocEl');
  if (!frame || !docEl) return;
  const wrap = frame.querySelector('.lgdoc-wrap'); if (!wrap) return;
  const avail = Math.max(120, frame.clientWidth - 24);   // 프레임 좌우 패딩(12*2) 제외
  const scale = Math.min(1, avail / 760);
  docEl.style.transformOrigin = 'top left';
  docEl.style.transform = `scale(${scale})`;
  wrap.style.width = (760 * scale) + 'px';
  wrap.style.height = (docEl.offsetHeight * scale) + 'px';   // 축소분만큼 래퍼 높이 축소(빈공간 방지)
  wrap.style.margin = '0 auto';
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { if (!$('lgModal')?.hidden) lgScalePreview(); });
}

function lgPrintDoc() {
  const html = lgFullDoc(false);
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const doc = f.contentWindow.document; doc.open(); doc.write(html); doc.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* noop */ } setTimeout(() => f.remove(), 2000); }, 350);
}

async function lgDeliver(blob, name, mime) {
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { /* 취소/미지원 → 다운로드 */ }
  try {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
  } catch (e) { alert('이 환경에선 저장이 지원되지 않아요.'); }
}
function lgDocName(ext) { return `정산서_${lgDocCtx.isYear ? lgYear : (lgYear + '-' + String(lgMonth).padStart(2, '0'))}.${ext}`; }
async function lgSaveWord() {
  const blob = new Blob(['﻿' + lgFullDoc(true)], { type: 'application/msword' });
  await lgDeliver(blob, lgDocName('doc'), 'application/msword');
}
async function lgSavePdf() {
  const name = lgDocName('pdf');
  if (typeof html2pdf === 'undefined') { lgPrintDoc(); return; }
  // ★캡처 컨테이너 = 0×0 overflow:hidden(fixed·left0·top0)로 감싸 화면엔 전혀 안 보이게 한다.
  //  - 760px 문서가 화면 밖으로 삐져나와 '뒤 배경이 확대돼 보이던' 현상 제거(0×0가 클리핑).
  //  - left:0/top:0 + html2canvas scrollX/scrollY:0 → x 치우침·상단 여백(스크롤 오프셋) 둘 다 방지.
  const { o, S, period, isYear, profile } = lgDocCtx;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1;';
  holder.innerHTML = '<div class="lgdoc" style="width:760px;max-width:none;margin:0;box-shadow:none;padding:24px;box-sizing:border-box;background:#fff;">' + lgReportInner(o, S, { period, isYear, profile }) + '</div>';
  document.body.appendChild(holder);
  const el = holder.querySelector('.lgdoc');
  const opt = {
    margin: 10, filename: name, image: { type: 'jpeg', quality: 0.96 },   // 균일 여백 → 좌우 대칭
    html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'], before: '.pb-before' },   // 행 잘림 방지 + 지출은 새 페이지로
  };
  let blob = null;
  try { blob = await html2pdf().set(opt).from(el).outputPdf('blob'); } catch (e) { /* 실패 → 아래 폴백 */ }
  holder.remove();   // ★공유(share) 시트가 뜨기 '전에' 반드시 제거 — 뒤에 컨테이너가 비치지 않게
  if (blob) await lgDeliver(blob, name, 'application/pdf');
  else lgPrintDoc();
}

function initLedgerButtons() {
  $('lgPrev').onclick = async () => { await lgFlushTips(); lgMonth--; if (lgMonth < 1) { lgMonth = 12; lgYear--; } lgOpenDate = null; lgExpForm = null; lgPage = -1; loadLedger(); };
  $('lgNext').onclick = async () => { if ($('lgNext').disabled) return; await lgFlushTips(); lgMonth++; if (lgMonth > 12) { lgMonth = 1; lgYear++; } lgOpenDate = null; lgExpForm = null; lgPage = -1; loadLedger(); };
  $('lgJump').onclick = async () => { await lgFlushTips(); const n = new Date(); lgYear = n.getFullYear(); lgMonth = n.getMonth() + 1; lgOpenDate = null; lgExpForm = null; lgPage = -1; loadLedger(); };
  $('lgSeg').querySelectorAll('button').forEach((b) => b.onclick = () => { lgDocPeriod = b.dataset.per; $('lgSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); updateDocDesc(); });
  ['lgORev', 'lgOTip', 'lgOExp'].forEach((id) => $(id).addEventListener('change', updateDocDesc));
  $('lgPdf').onclick = () => lgOpenDoc('pdf');
  $('lgWord').onclick = () => lgOpenDoc('word');
  $('lgMPrint').onclick = lgPrintDoc;
  $('lgMClose').onclick = () => { $('lgModal').hidden = true; };
  $('lgModal').onclick = (e) => { if (e.target.id === 'lgModal') $('lgModal').hidden = true; };
}

/* ── 카트 점검 ── */
let ccDate = null;
let ccEditMode = false;
const ccCounts = { intake: 0, exit: 0, club_pre: 0, club_post: 0 }; // 각 구간 저장 사진 수 — 다중 업로드 10장 상한
const CC_LABELS = {
  intake:    { box: 'ccIntakeThumbs', lbl: 'ccIntakeLbl', alt: '카트 상태', idle: '사진 올리기', add: '사진 추가' },
  exit:      { box: 'ccExitThumbs',   lbl: 'ccExitLbl',   alt: '빈 카트',   idle: "'비운 카트' 사진", add: '사진 추가' },
  club_pre:  { box: 'clPreThumbs',    lbl: 'clPreLbl',    alt: '라운드 전 클럽', idle: '라운드 전 사진', add: '사진 추가' },
  club_post: { box: 'clPostThumbs',   lbl: 'clPostLbl',   alt: '라운드 후 클럽', idle: '라운드 후 사진', add: '사진 추가' },
};
// 카트 상태(intake)·빈 카트(exit) — 공통: 여러 장 썸네일 + 각 삭제 버튼. 갤러리에서 여러 장 추가됨.
function ccRenderThumbs(leg, list) {
  const cfg = CC_LABELS[leg];
  const box = $(cfg.box), lbl = $(cfg.lbl);
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  ccCounts[leg] = arr.length;
  box.innerHTML = arr.map((f) => `<span class="cc-thumbwrap"><img class="cc-thumb" src="/api/cartcheck/photo/${f}?t=${Date.now()}" alt="${cfg.alt}"><button class="cc-thumbdel" data-f="${f}" aria-label="삭제">✕</button></span>`).join('');
  box.querySelectorAll('button[data-f]').forEach((b) => {
    b.onclick = async () => { await postJSON('/api/cartcheck/photo/remove', { date: ccDate, leg, fname: b.dataset.f }); loadCartCheck(ccDate); };
  });
  // 썸네일 탭 → 확대 보기(같은 구간 사진끼리 좌우로 넘김)
  box.querySelectorAll('.cc-thumb').forEach((img) => {
    img.onclick = () => {
      const group = img.closest('.cc-thumbs') || document;
      const all = Array.from(group.querySelectorAll('.cc-thumb'));
      openCcLightbox(all.map((im) => im.getAttribute('src')), all.indexOf(img));
    };
  });
  lbl.classList.toggle('has', arr.length > 0);
  if (lbl.firstChild) lbl.firstChild.textContent = arr.length ? `${cfg.add} (${arr.length}장)` : cfg.idle;
}
// 상단 날짜 선택바 — 유예기간(최근 N일)만 롤링으로 보여주고, 누르면 그날 점검을 연다.
//  (사진이 30일 뒤 자동 삭제되므로 그 이전 날은 열람 대상이 아니라 표시하지 않음)
const RC_WD = ['일', '월', '화', '수', '목', '금', '토'];
async function loadRcStrip() {
  const strip = $('rcDayStrip'); if (!strip) return;
  let recDays = new Map(), todayISO = new Date().toISOString().slice(0, 10), retain = 30;
  try {
    const r = await (await fetch('/api/cartcheck/recent')).json();
    recDays = new Map((r.days || []).map((d) => [d.date, d]));
    if (r.today) todayISO = r.today;
    if (r.retainDays) retain = r.retainDays;
  } catch { /* 네트워크 실패 시 빈 스트립 */ }
  const title = $('rcBarTitle'); if (title) title.textContent = `최근 ${retain}일`;
  const [ty, tm, td] = todayISO.split('-').map(Number);
  const base = new Date(Date.UTC(ty, tm - 1, td));
  let html = '';
  for (let i = retain - 1; i >= 0; i--) {          // 오래된→오늘 순 (오늘이 맨 오른쪽)
    const dt = new Date(base); dt.setUTCDate(dt.getUTCDate() - i);
    const date = dt.toISOString().slice(0, 10);
    const dow = dt.getUTCDay();
    const rec = recDays.get(date);
    const md = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
    const mark = rec ? (rec.done ? CHECK_SVG : (rec.nPhoto ? CAM_SVG : '·')) : '';
    const cls = [dow === 0 ? 'sun' : (dow === 6 ? 'sat' : ''), date === ccDate ? 'sel' : '', date === todayISO ? 'today' : ''].filter(Boolean).join(' ');
    html += `<button class="rc-day ${cls}" data-date="${date}"><span class="dn">${md}</span><span class="dw">${RC_WD[dow]}</span><span class="dm">${mark}</span></button>`;
  }
  strip.innerHTML = html;
  strip.querySelectorAll('button[data-date]').forEach((b) => { b.onclick = () => loadCartCheck(b.dataset.date); });
  const selEl = strip.querySelector('.rc-day.sel') || strip.querySelector('.rc-day.today');
  if (selEl) selEl.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function ccRenderList(items, checklist, progress) {
  const list = $('ccList'), prog = $('ccProg'), editBtn = $('ccEdit');
  if (ccEditMode) {
    editBtn.textContent = '편집 완료';
    prog.textContent = '항목 편집 중'; prog.classList.remove('done');
    list.innerHTML =
      items.map((it) => `<div class="cc-edit-item"><input value="${esc(it.label)}" data-key="${it.key}" aria-label="항목 이름"><button class="cc-del" data-del="${it.key}" title="삭제">✕</button></div>`).join('') +
      `<div class="cc-add-row"><input id="ccNewItem" placeholder="새 점검 항목 입력" aria-label="새 항목"><button id="ccAddItem" class="wl-btn wl-yes">추가</button></div>` +
      `<div class="cc-edit-foot"><button id="ccResetItems" class="wl-btn wl-no">항목 추천 받기</button><span class="cc-hint">추천 항목을 목록에 더해줘요(기존 항목은 그대로).</span></div>`;
    list.querySelectorAll('.cc-edit-item input').forEach((inp) => {
      inp.onchange = async () => { const v = inp.value.trim(); if (v) await postJSON('/api/cartcheck/items/rename', { key: inp.dataset.key, label: v }); };
    });
    list.querySelectorAll('button[data-del]').forEach((b) => {
      b.onclick = async () => { await postJSON('/api/cartcheck/items/remove', { key: b.dataset.del }); loadCartCheck(ccDate); };
    });
    $('ccAddItem').onclick = async () => { const v = $('ccNewItem').value.trim(); if (!v) return; await postJSON('/api/cartcheck/items/add', { label: v }); loadCartCheck(ccDate); };
    $('ccNewItem').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('ccAddItem').click(); } };
    $('ccResetItems').onclick = async () => { await postJSON('/api/cartcheck/items/recommend', {}); loadCartCheck(ccDate); };
  } else {
    editBtn.textContent = '항목 편집';
    list.innerHTML = items.length
      ? items.map((it) => { const on = !!checklist[it.key]; return `<div class="cc-item ${on ? 'on' : ''}" data-key="${it.key}"><span class="box">${on ? CHECK_SVG : ''}</span><span>${esc(it.label)}</span></div>`; }).join('')
      : `<div class="wl-sub">항목이 없어요. ‘항목 편집’에서 추가하세요.</div>`;
    list.querySelectorAll('.cc-item').forEach((el) => {
      el.onclick = async () => { const on = el.classList.contains('on'); await postJSON('/api/cartcheck/check', { date: ccDate, key: el.dataset.key, done: !on }); loadCartCheck(ccDate); };
    });
    prog.textContent = `${progress.checked}/${progress.total}${progress.done ? ' 완료' : ''}`;
    prog.classList.toggle('done', !!progress.done);
  }
}
async function loadCartCheck(date) {
  try {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    const r = await (await fetch('/api/cartcheck' + q)).json();
    ccDate = r.date;
    const day = r.day || {}, work = r.work || {}, items = r.items || [];
    const md = `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`;
    if (work.isWorkToday) {
      $('ccHead').textContent = `오늘(${md}) 근무 · 카트 정리 점검`;
      $('ccSub').textContent = work.teeTime ? `티오프 ${work.teeTime}${work.course ? `(${work.course})` : ''} · 반납 전 아래를 하나씩 훑으세요.` : '반납 전 아래를 하나씩 훑으세요.';
    } else {
      $('ccHead').textContent = `${md} 카트 점검`;
      $('ccSub').textContent = '지난 기록도 아래 날짜를 눌러 열어볼 수 있어요.';
    }
    $('ccCart').value = day.cartNo || work.cartNo || '';
    ccRenderThumbs('intake', day.photos && day.photos.intake);
    ccRenderThumbs('exit', day.photos && day.photos.exit);
    ccRenderThumbs('club_pre', day.photos && day.photos.club_pre);
    ccRenderThumbs('club_post', day.photos && day.photos.club_post);
    ccRenderList(items, day.checklist || {}, day.progress || { checked: 0, total: items.length, done: false });
    await loadRcStrip();
  } catch { $('ccHead').textContent = '불러오기 실패'; $('ccSub').textContent = '잠시 후 다시 시도해주세요.'; }
}
// intake·exit 공통 다중 업로드(갤러리에서 여러 장). 각 구간 최대 10장.
async function ccUpload(leg, inp) {
  if (!inp.files || !inp.files[0]) return;
  const files = Array.from(inp.files);
  const CAP = 10;
  const room = Math.max(0, CAP - (ccCounts[leg] || 0));
  let pick = files.filter((f) => /^image\//.test(f.type));
  if (pick.length > room) { alert(`사진은 최대 ${CAP}장까지예요. 앞에서 ${room}장만 올릴게요.`); pick = pick.slice(0, room); }
  const lbl = $(CC_LABELS[leg].lbl);
  const orig = lbl.firstChild ? lbl.firstChild.textContent : '';
  try {
    for (let i = 0; i < pick.length; i++) {
      if (lbl.firstChild) lbl.firstChild.textContent = `올리는 중 ${i + 1}/${pick.length}`;
      const image = await compressImage(pick[i]);
      await postJSON('/api/cartcheck/photo', { date: ccDate, leg, image });
    }
  } finally { if (lbl.firstChild) lbl.firstChild.textContent = orig; inp.value = ''; loadCartCheck(ccDate); }
}
function initCartButtons() {
  $('ccEdit').onclick = () => { ccEditMode = !ccEditMode; loadCartCheck(ccDate); };
  $('ccCartSave').onclick = async () => { await postJSON('/api/cartcheck/cart', { date: ccDate, cartNo: $('ccCart').value.trim() }); };
  $('ccIntake').onchange = (e) => ccUpload('intake', e.target);
  $('ccExit').onchange = (e) => ccUpload('exit', e.target);
  $('clPre').onchange = (e) => ccUpload('club_pre', e.target);
  $('clPost').onchange = (e) => ccUpload('club_post', e.target);
  $('rcToday').onclick = () => loadCartCheck();  // 오늘로
  initCcLightbox();
}

/* ── 사진 확대 보기(라이트박스) — 카트 점검 사진 탭 시 전체화면, 좌우로 넘김 ── */
let ccLb = { srcs: [], i: 0 };
function openCcLightbox(srcs, i) {
  if (!srcs || !srcs.length) return;
  ccLb = { srcs, i: Math.max(0, i) };
  ccLbShow();
  const lb = $('ccLightbox'); if (lb) { lb.hidden = false; document.body.style.overflow = 'hidden'; }
}
function ccLbShow() {
  const img = $('ccLbImg'); if (img) img.src = ccLb.srcs[ccLb.i] || '';
  const cnt = $('ccLbCount'); if (cnt) cnt.textContent = `${ccLb.i + 1} / ${ccLb.srcs.length}`;
  const multi = ccLb.srcs.length > 1;
  document.querySelectorAll('#ccLightbox .cc-lb-nav').forEach((b) => { b.style.display = multi ? '' : 'none'; });
}
function ccLbMove(d) { if (!ccLb.srcs.length) return; ccLb.i = (ccLb.i + d + ccLb.srcs.length) % ccLb.srcs.length; ccLbShow(); }
function closeCcLightbox() { const lb = $('ccLightbox'); if (lb) lb.hidden = true; const img = $('ccLbImg'); if (img) img.src = ''; document.body.style.overflow = ''; }
function initCcLightbox() {
  const lb = $('ccLightbox'); if (!lb || lb.dataset.bound) return;
  lb.dataset.bound = '1';
  $('ccLbClose').onclick = closeCcLightbox;
  $('ccLbPrev').onclick = (e) => { e.stopPropagation(); ccLbMove(-1); };
  $('ccLbNext').onclick = (e) => { e.stopPropagation(); ccLbMove(1); };
  lb.onclick = (e) => { if (e.target === lb) closeCcLightbox(); }; // 배경(사진 바깥) 탭 → 닫기
  document.addEventListener('keydown', (e) => {
    if (!lb || lb.hidden) return;
    if (e.key === 'Escape') closeCcLightbox();
    else if (e.key === 'ArrowLeft') ccLbMove(-1);
    else if (e.key === 'ArrowRight') ccLbMove(1);
  });
  // 모바일 스와이프로 넘기기
  let tx = 0;
  lb.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 40) ccLbMove(dx < 0 ? 1 : -1); });
}

/* ── 계정 · 가입(온보딩) ── */
let meState = null;
async function loadMe() {
  try { meState = await (await fetch('/api/me')).json(); } catch { meState = null; }
  // 회원제 모드에서 비로그인이면 로그인 게이트, 로그인했으면 앱 사용.
  if (meState && !meState.authed) { showLogin(); renderAccount(); return; }
  hideLogin();
  // ★차단(disabled): '승인 대기'가 아니라 별도 '차단됨' 화면 + 사유 + 관리자 문의 안내.
  if (meState && meState.status === 'disabled') { hidePending(); renderAccount(); showBlocked(meState.blockReason); return; }
  // ★가입 승인 대기(pending): 이름부터 입력(온보딩) → 이후엔 '승인 대기' 화면. 앱 데이터는 게이트에서 잠김.
  if (meState && meState.pending) {
    renderAccount();
    if (meState.needsOnboarding) { hidePending(); await enterOnboarding(); }
    else showPending();
    return;
  }
  hidePending();
  renderAccount();
  if (lastToday) renderToday(lastToday); // 내 이름(profile)이 늦게 로드돼도 보드를 다시 그려 순번 리스트가 뜨게(레이스 방지)
  renderNotifyNudge();               // 알림 미설정이면 유도 카드 노출
  sendTelemetry();                   // 기기·알림 상태 기록
  if (meState && meState.authed && meState.needsOnboarding) await enterOnboarding();
  else if (meState && meState.authed) maybeAutoAskNotifications();  // 온보딩 끝난 회원 → 첫 탭에 알림 요청
}
// '방금 로그인함' 판별 — 콜백의 ?new 마커(부팅 때 캡처) 또는 이번 세션 플래그.
//  새로고침엔 세션 플래그가 남아 폼 유지, 앱을 완전히 닫으면 sessionStorage가 비워져 자동 로그아웃된다.
let _freshLogin = false;
function isFreshLogin() {
  try { return _freshLogin || sessionStorage.getItem('rhFresh') === '1'; }
  catch { return true; }   // 저장소가 막혀 있으면 안전하게 폼을 보여줌(로그아웃 루프 방지)
}
// 미완료 가입(이름 미제출) 진입 — 방금 로그인이면 신청서, 아니면(닫았다 다시 엶) 자동 로그아웃→로그인 화면.
async function enterOnboarding() {
  if (!isFreshLogin()) {
    try { await postJSON('/api/logout', {}); } catch { /* 무해 */ }
    location.reload();     // 쿠키 지워진 뒤 재부팅 → /api/me 비로그인 → 로그인 화면
    return;
  }
  try { sessionStorage.setItem('rhFresh', '1'); } catch { /* 무해 */ }
  openOnboarding();
}
let _pendTimer = null;
function showPending() {
  hideSplash();
  $('pendName').textContent = (meState.profile && meState.profile.boardName) || '회원';
  $('pendingOv').hidden = false;
  // ★승인되면 자동 전환 — 대기 중 주기적으로 /api/me 재확인(승인 알림을 안 눌러도 넘어가게).
  if (!_pendTimer) _pendTimer = setInterval(async () => {
    try {
      const me = await (await fetch('/api/me')).json();
      if (me && me.authed && !me.pending && me.status === 'active') { clearInterval(_pendTimer); _pendTimer = null; location.reload(); }
    } catch (_) { /* 무해 — 다음 폴링 재시도 */ }
  }, 8000);
}
function hidePending() { $('pendingOv').hidden = true; if (_pendTimer) { clearInterval(_pendTimer); _pendTimer = null; } }
// 차단됨 화면 — 사유(명부없음/기타) + 관리자 문의 안내.
function showBlocked(reason) {
  hideSplash();
  const txt = reason === 'roster'
    ? '리버힐 캐디 명부에 없는 이름으로 확인되었습니다.'
    : '관리자에 의해 이용이 제한되었습니다.';
  $('blockedReason').textContent = '사유 · ' + txt;
  $('blockedOv').hidden = false;
}
// ── 회원 관리 → 관리자 모니터(:3100 · 승인 탭)로 이관됨. ──
//  실시간 승인신청·명부대조·승인 즉시 알림 발송은 모두 모니터에서 처리한다(앱에서는 제거).
// 계정 오버레이(#ov) 닫기 제어 — 계정 화면은 닫기 가능, 가입(온보딩) 화면은 닫기 금지.
let ovDismissable = false;
function ovIsOpen() { return !$('ov').hidden; }
// 오버레이를 열 때 히스토리에 한 칸 쌓아, 폰 뒤로가기가 '앱 종료'가 아니라 '팝업 닫기'가 되게 한다.
function pushOvHistory() { if (!(history.state && history.state.ov)) history.pushState({ ov: 1 }, ''); }
function closeOv() {
  $('ov').hidden = true;
  ovDismissable = false;
  if (history.state && history.state.ov) history.back(); // 쌓아둔 히스토리 정리
}
// 폰 뒤로가기: 오버레이가 열려 있으면 앱을 나가지 않고 팝업만 닫는다.
window.addEventListener('popstate', () => {
  if (ovIsOpen() && ovDismissable) { $('ov').hidden = true; ovDismissable = false; }
});
function showLogin() {
  hideSplash();
  $('googleLoginBtn').style.display = meState.googleEnabled ? 'flex' : 'none';
  $('loginErr').textContent = !meState.googleEnabled ? '구글 로그인 준비 중입니다. 잠시만요.' : '';
  const lo = $('loginOv');
  lo.hidden = false;
  lo.classList.remove('dl-play'); void lo.offsetWidth; lo.classList.add('dl-play'); // 진입 모션 재생(태양·땅)
}
// 구글 버튼은 <a href="/api/auth/google"> 그대로 → 일반 리다이렉트 로그인(자연스러운 흐름). 팝업·핸드오프 없음.
function hideLogin() { $('loginOv').hidden = true; }
function renderAccount() {
  const btn = $('acctBtn');
  if (!meState || !meState.authed) { btn.hidden = true; return; }
  btn.hidden = false;
  $('acctName').textContent = (meState.profile && meState.profile.boardName) || '회원';
}
// ── 캐디 구분 토글(하우스/3부) 공용 헬퍼 ──
function bindToggle(id) {
  const c = $(id); if (!c) return;
  c.querySelectorAll('button[data-t]').forEach((b) => {
    b.onclick = () => { c.querySelectorAll('button[data-t]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
  });
}
function setToggle(id, val) { const c = $(id); if (c) c.querySelectorAll('button[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === val)); }
function toggleVal(id) { const on = $(id) && $(id).querySelector('button.on'); return on ? on.dataset.t : 'part3'; }
const caddieTypeOf = (p) => p.caddieType || (String(p.part) === '3' ? 'part3' : 'house');

function fillProfileForm() {
  const p = (meState && meState.profile) || {};
  $('obName').value = p.boardName || '';
  setToggle('acType', caddieTypeOf(p));
  $('obCommute').value = p.commuteMin != null && p.commuteMin !== 0 ? p.commuteMin : '';
  $('obKm').value = p.homeKm != null && p.homeKm !== 0 ? p.homeKm : '';
  $('obCar').value = p.carNo || '';
}
// ── 가입(온보딩) · 가입 신청서 출력 연출 ─────────────────────────────────
//  샘플 e6c82dd0 그대로 이식: 프린터에서 신청서가 밑쪽부터 출력 → 가입 신청 시
//  명부 매칭이면 '완료!' 도장 + 백지가 화면을 채우며 '어서오세요' → 진짜 앱 홈,
//  미매칭이면 '대기' 도장 + 대기 안내문(관리자 김홍구) + 이름 다시 기재하기.
//  ★백엔드 /api/profile 응답의 approved 플래그로만 완료/대기를 분기.
const OB_DUR = 1600;
let obSeq = 0;
const obSleep = (ms) => new Promise((r) => setTimeout(r, ms));
function obReqFields() {
  return [...$('obFeed').querySelectorAll('.sc-fld')].filter((f) => f.querySelector('input'));
}
// ── 오디오(웹오디오 합성) ──
let obAc;
function obActx() {
  if (!obAc) { try { obAc = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (obAc.state === 'suspended') obAc.resume();
  return obAc;
}
function obTick(c, at) {
  const d = 0.02, buf = c.createBuffer(1, Math.max(1, c.sampleRate * d), c.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const s = c.createBufferSource(); s.buffer = buf; const g = c.createGain(); g.gain.value = 0.05; s.connect(g); g.connect(c.destination); s.start(at);
}
function obSound(dur) {                                      // 프린터 인쇄음
  const c = obActx(); if (!c) return;
  const t0 = c.currentTime, d = (dur || OB_DUR) / 1000;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = 'square'; osc.frequency.value = 112; osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + d + 0.05);
  const step = 0.072;
  for (let x = 0; x < d; x += step) { g.gain.setValueAtTime(0.05, t0 + x); g.gain.setValueAtTime(0.0, t0 + x + step * 0.5); obTick(c, t0 + x); }
  g.gain.setValueAtTime(0.0, t0 + d);
}
function obThunk() {                                         // 도장 '쿵'
  const c = obActx(); if (!c) return;
  const t0 = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(190, t0); o.frequency.exponentialRampToValueAtTime(58, t0 + .12);
  g.gain.setValueAtTime(.2, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .19);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + .22);
  const b = c.createBuffer(1, Math.max(1, c.sampleRate * .03), c.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const s = c.createBufferSource(); s.buffer = b; const ng = c.createGain(); ng.gain.value = .12; s.connect(ng); ng.connect(c.destination); s.start(t0);
}
function obEjectSound() {                                    // 영수증 뽑는 '쫙' — 뜯기는 결의 그레인
  const c = obActx(); if (!c) return;
  const t0 = c.currentTime, dur = .4, N = Math.floor(c.sampleRate * dur);
  const b = c.createBuffer(1, N, c.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < N; i++) {
    const e = i / N;
    const buzz = (Math.sin(2 * Math.PI * e * 95) > -0.25) ? 1 : 0.28;
    const env = Math.pow(1 - e, 1.35) * (e < 0.035 ? e / 0.035 : 1);
    ch[i] = (Math.random() * 2 - 1) * buzz * env;
  }
  const s = c.createBufferSource(); s.buffer = b;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(1200, t0); hp.frequency.linearRampToValueAtTime(2300, t0 + dur);
  const g = c.createGain(); g.gain.value = .34;
  s.connect(hp); hp.connect(g); g.connect(c.destination); s.start(t0); s.stop(t0 + dur + .02);
}
// 가입 완료 인트로 음악 — '포근한 종'(벨 상승 아르페지오 → 메이저7 화음 해소 → 반짝). 전부 웹오디오 합성.
function obWelcomeMusic() {
  const c = obActx(); if (!c) return;
  const t0 = c.currentTime;
  const bus = c.createGain(); bus.gain.value = 0.9; bus.connect(c.destination);
  // 은은한 공간감(피드백 딜레이)
  const dl = c.createDelay(); dl.delayTime.value = 0.16;
  const fb = c.createGain(); fb.gain.value = 0.26;
  const wet = c.createGain(); wet.gain.value = 0.22;
  bus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(c.destination);
  const HZ = { C3: 130.81, C4: 261.63, E4: 329.63, G4: 392.0, B4: 493.88, C5: 523.25, C6: 1046.5 };
  const tone = (note, t, dur, gain, type, atk, rel) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'triangle'; o.frequency.value = HZ[note];
    o.connect(g); g.connect(bus);
    const s = t0 + t, a = atk == null ? 0.005 : atk, r = rel == null ? 0.3 : rel;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(gain, s + a);
    g.gain.setValueAtTime(gain, s + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.start(s); o.stop(s + dur + 0.05);
  };
  ['C4', 'E4', 'G4', 'B4', 'C5'].forEach((n, i) => tone(n, 0.05 + i * 0.2, 1.2, 0.15, 'triangle', 0.004, 0.9)); // 상승 벨
  tone('C3', 0.2, 3.0, 0.10, 'sine', 0.8, 1.0);                                                                 // 저음 드론
  ['C4', 'E4', 'G4', 'B4'].forEach((n) => tone(n, 1.35, 2.1, 0.07, 'sine', 0.7, 0.9));                          // 메이저7 해소
  tone('C6', 2.5, 1.1, 0.07, 'sine', 0.02, 0.9);                                                                // 반짝 상단
}
// 프린터 출력음(연속 루프, 페이드아웃 가능) — 가입완료 출력~확대 내내 지속하다 화면 가득 차면 서서히 꺼짐.
let obPrLoop = null;
function obPrinterLoopStart(maxSec) {
  const c = obActx(); if (!c) return;
  const t0 = c.currentTime, secs = maxSec || 8;
  const master = c.createGain(); master.gain.value = 1; master.connect(c.destination);
  const inner = c.createGain(); inner.connect(master);
  const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = 112; osc.connect(inner); osc.start(t0);
  const step = 0.072, N = Math.ceil(secs / step);
  for (let i = 0; i < N; i++) {
    const t = t0 + i * step;
    inner.gain.setValueAtTime(0.05, t); inner.gain.setValueAtTime(0.0, t + step * 0.5);
    const dn = 0.02, buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dn)), c.sampleRate), ch = buf.getChannelData(0);
    for (let k = 0; k < ch.length; k++) ch[k] = (Math.random() * 2 - 1) * (1 - k / ch.length);
    const sn = c.createBufferSource(); sn.buffer = buf; const ng = c.createGain(); ng.gain.value = 0.05; sn.connect(ng); ng.connect(master); sn.start(t);
  }
  osc.stop(t0 + secs + 0.2);
  obPrLoop = { master, osc };
}
function obPrinterLoopFade(dur) {
  const c = obActx(); if (!c || !obPrLoop) return;
  const d = dur || 1.5, t = c.currentTime, g = obPrLoop.master;
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value || 1, t);
  g.gain.linearRampToValueAtTime(0.0001, t + d);
  try { obPrLoop.osc.stop(t + d + 0.1); } catch (e) { /* 이미 정지 */ }
  obPrLoop = null;
}
// ── 출력 유틸 ──
let obPrTimer;
function obPrinterRun(ms) { const p = $('obPrinter'); p.classList.add('run'); clearTimeout(obPrTimer); obPrTimer = setTimeout(() => p.classList.remove('run'), ms + 60); }
// 용지가 슬롯에서 아래로 밀려나옴 — 처음엔 슬롯 위(숨김)에 있다가 밑쪽부터 드러나며 전체가 나옴
function obPrintOut(feedEl, dur) {
  const p = feedEl.firstElementChild;
  feedEl.style.display = ''; feedEl.style.transition = 'none'; feedEl.style.transform = ''; feedEl.style.transformOrigin = '';
  p.style.transition = 'none';
  const H = p.scrollHeight + 6; p.style.transform = 'translateY(-' + H + 'px)';
  void p.offsetWidth;
  requestAnimationFrame(() => { p.style.transition = 'transform ' + (dur || OB_DUR) + 'ms steps(22)'; p.style.transform = 'translateY(0)'; });
}
// 출력물을 왼쪽부터 비스듬히 뜯어 자연스럽게 배출
function obEjectFeed(feedEl) {
  obEjectSound();
  feedEl.style.transformOrigin = 'left top';
  feedEl.style.transition = 'transform .8s cubic-bezier(.42,.03,.58,1)';
  requestAnimationFrame(() => { feedEl.style.transform = 'translate(-52px, calc(100vh + 560px)) rotate(7.5deg)'; });
}
// ── 시나리오 ──
async function obRunFlow(name, approved, isTest) {
  const my = ++obSeq;
  const stamp = $('obStamp'), paper = $('obFeed').firstElementChild, cta = $('sgSubmit');
  stamp.textContent = approved ? '완료!' : '대기';
  stamp.classList.toggle('pending', !approved);
  stamp.classList.remove('stamped'); void stamp.offsetWidth; stamp.classList.add('stamped');
  setTimeout(() => { if (obSeq !== my) return; paper.classList.add('thump'); obThunk(); setTimeout(() => paper.classList.remove('thump'), 320); }, 205);
  cta.textContent = approved ? '승인 완료' : '가입 대기'; cta.disabled = true;
  await obSleep(1000); if (obSeq !== my) return;
  obEjectFeed($('obFeed'));                                  // 신청서 배출(왼쪽부터 비스듬히 뜯김)
  await obSleep(860); if (obSeq !== my) return;
  $('obFeed').style.display = 'none';
  if (approved) await obWelcomeFlow(name, my, isTest); else await obPendingFlow(name, my);
}
async function obWelcomeFlow(name, my, isTest) {
  const scene = $('obWelScene'), wel = $('obWelcome'), welP = $('obWelPrinter'), welT = $('obWelText'), ov = $('obOv');
  const irisMode = !isTest && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  $('obWelName').textContent = name;
  $('obPrinter').style.display = 'none';                 // 폼 프린터 숨기고 전용 scene(프린터+백지) 표시(같은 위치라 이음새 없음)
  scene.style.display = 'block'; scene.style.transition = 'none'; scene.style.transform = 'scale(1)';
  wel.style.display = 'block'; wel.style.transition = 'none';
  wel.style.height = '0'; wel.style.transform = 'none'; wel.style.opacity = '1';
  welT.classList.remove('show'); welT.style.display = 'flex';
  void wel.offsetWidth;
  // 1) 백지가 프린터 슬롯에 붙은 채 '계속' 출력 — 76vh까지 길게 + 출력음 지속
  welP.classList.add('run'); obPrinterLoopStart(7.5);
  wel.style.transition = 'height 1.9s steps(30)';
  requestAnimationFrame(() => { wel.style.height = '120vh'; });   // 프레임 아래로 계속 출력(바닥에서 안 멈추고 밑으로 넘어감)
  await obSleep(1300); if (obSeq !== my) return;         // 확대 시작을 앞으로 당김(출력 중반부터 확대)
  // 2) 프린터+백지 한 덩어리로 아래축(≈54vh) 아주 완만하게 확대 — 화면을 가득 채움(느리게)
  const pw = wel.offsetWidth || 360, ph = window.innerHeight * 1.2;   // 최종 높이 기준(프레임 초과)
  const cover = Math.max(window.innerWidth / pw, window.innerHeight / ph) * 1.5;
  scene.style.transition = 'none';
  const expT0 = performance.now();
  await new Promise((res) => {
    (function step() {
      if (obSeq !== my) { res(); return; }
      const p = Math.min(1, (performance.now() - expT0) / 4200);
      scene.style.transform = 'scale(' + (1 + (cover - 1) * Math.pow(p, 1.8)) + ')';  // 프린터+백지 함께
      if (p < 1) requestAnimationFrame(step); else res();
    })();
  });
  if (obSeq !== my) return;
  // 3) 화면 가득(도착) → 출력음 1.5초 페이드 → (1초 뒤) 종소리 → (0.2초 뒤) '어서오세요'
  welP.classList.remove('run');
  obPrinterLoopFade(1.5);
  // 진짜 홈을 백지 뒤에서 미리 준비. ★테스트캐디는 프로필이 비어 loadMe가 온보딩을 재트리거(연출 취소)하므로 건너뜀.
  //  ★아이리스 모드: 등장 모션을 보류(_holdHomeAnim)하고 오브젝트를 숨긴 채(home-prep) 렌더 → 아이리스로 배경만 연 뒤 재생.
  if (irisMode) { _holdHomeAnim = true; document.body.classList.add('home-prep'); }
  if (!isTest) { try { await loadMe(); loadToday(); } catch { /* 무해 */ } }
  await obSleep(2500); if (obSeq !== my) return;   // 페이드 1.5s + 여운 1s
  obWelcomeMusic();                                 // 종소리(포근한 종)
  await obSleep(200); if (obSeq !== my) return;      // 종소리 0.2초 뒤(문구 0.3초 앞당김)
  welT.classList.add('show');
  await obSleep(2600); if (obSeq !== my) return;             // 문구 유지
  // 5) 문구 디졸브 아웃
  welT.classList.remove('show');
  await obSleep(680); if (obSeq !== my) return;
  welT.style.display = 'none';
  // 6) 홈 진입 — 아이리스로 홈 '배경만' 열고 → 앱 홈 오브젝트 등장 모션(anim-play) 그대로 재생
  if (irisMode) {
    await obIrisReveal(my); if (obSeq !== my) return;
    document.body.classList.remove('home-prep'); _holdHomeAnim = false; _heroEntered = true;
    document.body.classList.add('anim-play');
    setTimeout(() => document.body.classList.remove('anim-play'), 1500);
  } else {
    ov.style.transition = 'opacity .55s ease'; ov.style.opacity = '0';
    await obSleep(580); if (obSeq !== my) return;
  }
  ov.hidden = true; ov.style.opacity = ''; ov.style.transition = ''; ov.style.webkitMask = ''; ov.style.mask = '';
  scene.style.display = 'none'; scene.style.transform = ''; wel.style.display = 'none';
  $('obPrinter').style.display = '';                    // 폼 프린터 원복(재실행 대비)
  if (isTest) openOnboarding();                         // 테스트캐디: 홈이 없으므로 가입 화면으로 리셋(반복 재생)
}
// 원형 아이리스로 가입 오버레이를 걷어 홈 '배경만' 드러냄(중앙에서 확장) — 마스크 구멍을 rAF로 키움.
async function obIrisReveal(my) {
  const ov = $('obOv');
  const cx = window.innerWidth * 0.5, cy = window.innerHeight * 0.46;
  const maxR = Math.hypot(window.innerWidth, window.innerHeight) * 0.62;
  const DUR = 900, t0 = performance.now();
  await new Promise((res) => {
    (function step() {
      if (obSeq !== my) { res(); return; }
      const p = Math.min(1, (performance.now() - t0) / DUR);
      const e = p * p * (3 - 2 * p);                       // smoothstep
      const r = Math.max(0.001, e * maxR);
      const m = 'radial-gradient(circle ' + r + 'px at ' + cx + 'px ' + cy + 'px, transparent 0, transparent ' + Math.max(0, r - 2) + 'px, #000 ' + r + 'px)';
      ov.style.webkitMask = m; ov.style.mask = m;
      if (p < 1) requestAnimationFrame(step); else res();
    })();
  });
}
async function obPendingFlow(name, my) {
  $('obNoticeName').textContent = name;
  obPrinterRun(OB_DUR); obSound();                           // 대기 안내문 출력
  obPrintOut($('obNoticeFeed'), OB_DUR);                     // 슬롯에서 아래로 밀려나옴
  await obSleep(OB_DUR + 200);
}
// 신청서(또는 대기 안내문) 재출력 — 모든 상태 초기화 후 신청서 다시 출력
function obPrintCard(withSound) {
  obSeq++;                                                   // 진행 중 시나리오 취소
  const wel = $('obWelcome'), welT = $('obWelText');
  wel.style.display = 'none'; wel.style.transition = 'none'; wel.style.opacity = '1'; wel.style.transform = 'none'; wel.style.height = '0';
  welT.classList.remove('show'); welT.style.display = 'none';
  const nf = $('obNoticeFeed');
  nf.style.display = 'none'; nf.style.transition = 'none'; nf.style.transform = ''; nf.style.transformOrigin = '';
  nf.firstElementChild.style.transition = 'none'; nf.firstElementChild.style.transform = '';
  $('obStamp').classList.remove('stamped', 'pending');
  $('obWarn').classList.remove('show'); obReqFields().forEach((f) => f.classList.remove('miss'));
  const cta = $('sgSubmit'); cta.textContent = '가입 신청'; cta.disabled = false;
  $('obPrinter').classList.remove('run');
  if (withSound) obSound();
  obPrinterRun(OB_DUR);
  obPrintOut($('obFeed'), OB_DUR);                           // 슬롯에서 아래로 밀려나오는 출력
}
// 가입 신청 클릭 — 미기재 검증 → /api/profile → approved 로 완료/대기 분기
async function obSubmitClick() {
  const cta = $('sgSubmit'); if (cta.disabled) return;
  obActx();   // ★탭 순간(동기) 오디오 잠금 해제 — 이후 await 뒤의 배출·도장·환영 소리가 나도록(모바일 자동재생 정책)
  const reqFields = obReqFields();
  let missing = false;
  reqFields.forEach((f) => { const inp = f.querySelector('input'); if (!inp.value.trim()) { f.classList.add('miss'); missing = true; } else f.classList.remove('miss'); });
  const warn = $('obWarn');
  if (missing) {
    warn.classList.add('show'); warn.style.animation = 'none'; void warn.offsetWidth; warn.style.animation = '';
    const first = reqFields.find((f) => f.classList.contains('miss')); if (first) first.querySelector('input').focus();
    return;
  }
  warn.classList.remove('show'); $('sgErr').textContent = '';
  const boardName = $('sgName').value.trim();
  const body = { boardName, caddieType: toggleVal('sgType'), commuteMin: Number($('sgCommute').value) || 0 };
  cta.disabled = true;
  let r;
  try { r = await postJSON('/api/profile', body); }
  catch (e) { cta.disabled = false; $('sgErr').textContent = (e && e.message) || '저장 실패'; return; }
  if (!r || !r.ok) { cta.disabled = false; $('sgErr').textContent = (r && r.error) || '저장 실패'; return; }
  obRunFlow(boardName, !!r.approved, !!r.test);
}
// 대기 안내문 → 안내문을 뜯어 배출한 뒤 폼으로 복귀(이름 다시 기재)
async function obNoticeRetryClick() {
  const my = ++obSeq;
  obEjectFeed($('obNoticeFeed'));                            // 안내문 배출 애니메이션
  await obSleep(840); if (obSeq !== my) return;
  $('obNoticeFeed').style.display = 'none';
  obPrintCard(true); $('sgName').value = '';                // 폼 다시 출력 + 이름 비움
  setTimeout(() => $('sgName').focus(), OB_DUR + 80);
}
function openOnboarding() {
  hideSplash();
  $('ov').hidden = true;             // 계정 오버레이는 닫고 가입 화면만
  const p = (meState && meState.profile) || {};
  $('sgName').value = p.boardName || '';
  setToggle('sgType', p.caddieType || 'part3');
  $('sgCommute').value = p.commuteMin != null && p.commuteMin !== 0 ? p.commuteMin : '';
  $('sgErr').textContent = '';
  ovDismissable = false;             // 가입 화면: 배경/뒤로가기로 닫히지 않게
  $('obOv').style.opacity = ''; $('obOv').style.transition = '';
  $('obOv').hidden = false;
  obPromptTap();                     // 프린터만 띄우고 '눌러서 출력' 유도 → 탭 시 소리와 함께 출력
}
// 로그인 직후 — 폼을 바로 뽑지 않고 프린터만 + 탭 유도. 사용자가 출력기를 누르면(제스처)
//  오디오가 잠금 해제되면서 신청서가 소리와 함께 출력된다(모바일 autoplay 정책 우회).
function obPromptTap() {
  obSeq++;                           // 진행 중 시나리오 취소
  $('obFeed').style.display = 'none';
  const nf = $('obNoticeFeed'); nf.style.display = 'none'; nf.style.transition = 'none'; nf.style.transform = ''; nf.firstElementChild.style.transform = '';
  const wel = $('obWelcome'); wel.style.display = 'none'; wel.style.transition = 'none'; wel.style.height = '0'; wel.style.transform = 'none';
  const wsc = $('obWelScene'); wsc.style.display = 'none'; wsc.style.transform = 'scale(1)';   // 가입완료 무대 초기화
  document.body.classList.remove('home-prep', 'anim-play'); _holdHomeAnim = false;             // 홈 등장 보류 상태 원복
  $('obPrinter').style.display = '';                 // 폼 프린터 복원(중단된 완료 연출 대비)
  $('obWelText').classList.remove('show'); $('obWelText').style.display = 'none';
  $('obStamp').classList.remove('stamped', 'pending');
  $('obWarn').classList.remove('show'); obReqFields().forEach((f) => f.classList.remove('miss'));
  const cta = $('sgSubmit'); cta.textContent = '가입 신청'; cta.disabled = false;
  const printer = $('obPrinter');
  printer.classList.remove('run'); printer.classList.add('await');
  $('obTapHint').hidden = false;
  const onTap = () => {
    printer.removeEventListener('click', onTap);
    printer.classList.remove('await');
    $('obTapHint').hidden = true;
    obActx();                        // 탭 제스처 → 오디오 잠금 해제
    obPrintCard(true);               // 소리와 함께 신청서 출력
  };
  printer.addEventListener('click', onTap);
}
function openAccount() {
  $('obOv').hidden = true;           // 가입 화면과 겹치지 않게
  $('ovTitle').textContent = '내 계정 · 프로필';
  const p = (meState && meState.profile) || {};
  const label = caddieTypeOf(p) === 'house' ? '하우스 캐디' : '3부 캐디';
  const who = p.boardName ? `${p.boardName} · ${label}` : '회원';
  $('ovDesc').innerHTML = `현재 <b>${esc(who)}</b>로 로그인됨. 정보를 수정할 수 있어요.`;
  $('obSubmit').textContent = '저장';
  fillProfileForm();
  $('ovActions').hidden = false;
  $('obSwitch').hidden = true;       // '다른 계정으로 로그인' 미노출(프로필 팝업에서 제거)
  updateNotifyButton();              // 계정 팝업 열 때 알림 버튼 상태(켜기/켜짐/차단) 갱신
  $('ovErr').textContent = '';
  ovDismissable = true;              // 계정 화면: 배경 클릭·뒤로가기로 닫힘
  $('ov').hidden = false;
  pushOvHistory();
}
async function submitProfile() {
  const boardName = $('obName').value.trim();
  if (!boardName) { $('ovErr').textContent = '배치표에 뜨는 실명을 입력해주세요.'; return; }
  const body = { boardName, caddieType: toggleVal('acType'), commuteMin: Number($('obCommute').value) || 0, homeKm: Number($('obKm').value) || 0, carNo: $('obCar').value.trim() };
  $('obSubmit').disabled = true;
  try {
    const r = await postJSON('/api/profile', body);
    if (!r || !r.ok) throw new Error((r && r.error) || '저장 실패');
    if (ovDismissable) closeOv(); else $('ov').hidden = true; // 가입완료 직후엔 히스토리 없음
    await loadMe();
    loadToday();
  } catch (e) { $('ovErr').textContent = e.message || '저장 실패'; }
  finally { $('obSubmit').disabled = false; }
}
function initAccount() {
  $('acctBtn').onclick = openAccount;
  $('obSubmit').onclick = submitProfile;
  bindToggle('acType'); bindToggle('sgType');
  $('sgSubmit').onclick = obSubmitClick;
  $('obNoticeRetry').onclick = obNoticeRetryClick;
  // 입력하면 미기재 표시 해제(모두 채워지면 경고도 숨김)
  obReqFields().forEach((f) => {
    const inp = f.querySelector('input');
    inp.addEventListener('input', () => {
      $('sgErr').textContent = '';   // 다시 입력하면 이전 경고(중복 이름 등) 지움
      if (inp.value.trim()) { f.classList.remove('miss'); if (!obReqFields().some((x) => x.classList.contains('miss'))) $('obWarn').classList.remove('show'); }
    });
  });
  $('ovEnableBtn').onclick = enableNotifications;
  $('obClose').onclick = () => closeOv();
  // 카드 바깥(어두운 배경) 클릭 시 닫기 — 계정 화면에서만(가입 화면은 무시).
  $('ov').addEventListener('click', (e) => { if (e.target === $('ov') && ovDismissable) closeOv(); });
  $('obLogout').onclick = async () => { try { await postJSON('/api/logout', {}); } catch {} location.reload(); };
  $('pendReload').onclick = () => location.reload();
  $('pendEnableBtn').onclick = () => enableNotifications('pendEnableBtn', 'pendEnableMsg');
  $('pendLogout').onclick = async () => { try { await postJSON('/api/logout', {}); } catch {} location.reload(); };
  $('blockedLogout').onclick = async () => { try { await postJSON('/api/logout', {}); } catch {} location.reload(); };
}

/* ── 부팅 ── */
async function main() {
  // 로그인 콜백의 '방금 로그인함' 마커(?new) 캡처 후 URL에서 제거(주소창 깔끔 + 이후 판별은 sessionStorage로).
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('new')) { _freshLogin = true; q.delete('new'); const s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); }
  } catch { /* 무해 */ }
  tickDate(); initNav(); initWorklogButtons(); initLedgerButtons(); initCartButtons(); initAccount();
  initInstallPrompt();
  $('readAll').onclick = markAllRead;
  await registerSW();
  await refreshPushHealth();
  loadMe();
  loadToday(); loadWatchHealth(); loadRecent();
  setTimeout(hideSplash, 3500);   // 안전장치: 어떤 이유로든 3.5초 뒤엔 대기화면 해제(무한 대기 방지)
  setInterval(() => { loadToday(); loadWatchHealth(); loadRecent(); refreshPushHealth(); }, 30000);
  setInterval(() => { tickDate(); refreshSky(); if (lastToday) renderBoard(lastToday); }, 20000);
  startHeartbeat();
}

// 접속 하트비트 — 앱이 화면에 떠 있는 동안 30초마다 핑(운영 모니터의 접속중/나감 표시).
//  앱을 닫거나 화면을 가리면 즉시 '나감' 신호(sendBeacon)를 보내 실시간 반영.
function startHeartbeat() {
  const alive = () => { if (!document.hidden) fetch('/api/ping', { method: 'POST', keepalive: true }).catch(() => {}); };
  const leave = () => { try { (navigator.sendBeacon && navigator.sendBeacon('/api/ping?leave=1')) || fetch('/api/ping?leave=1', { method: 'POST', keepalive: true }).catch(() => {}); } catch (e) {} };
  alive();
  setInterval(alive, 30000);
  document.addEventListener('visibilitychange', () => (document.hidden ? leave() : alive()));
  window.addEventListener('pagehide', leave);
}
main();
