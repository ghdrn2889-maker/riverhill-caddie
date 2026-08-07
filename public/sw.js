// 서비스워커: (1)백그라운드 푸시 알림 (2)network-first로 항상 최신 앱 서빙 + 자동 갱신.
//  ★버전 문자열을 바꾸면 브라우저가 이 파일의 변경을 감지해 새 SW를 설치→활성화한다.
const SW_VERSION = 'v4-netfirst-2026-08-07';
const SHELL_CACHE = 'rh-shell-v3';

// ★첫 설치(첫 방문)인지 '기존 SW 교체(업데이트)'인지 구분 — 첫 설치엔 창을 새로고침하지 않는다.
//  (첫 방문마다 activate가 강제 새로고침해 '이중 로딩'으로 느려지던 문제. 시크릿 창·팀장 첫 진입에서 특히 체감.)
let isUpdate = false;
self.addEventListener('install', (e) => e.waitUntil((async () => {
  isUpdate = !!self.registration.active;   // 이미 active가 있으면 = 업데이트, 없으면 = 첫 설치
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // 옛 셸 캐시 정리.
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
  } catch {}
  await self.clients.claim();
  // ★'업데이트'일 때만 열린 창을 새로고침해 최신 코드를 즉시 반영(설치형 PWA가 옛 화면을 물고 있던 문제 해소).
  //  첫 설치에는 이미 방금 로드된 최신 페이지가 떠 있으므로 새로고침하지 않는다(불필요한 이중 로딩 제거).
  if (isUpdate) {
    try {
      const wins = await self.clients.matchAll({ type: 'window' });
      for (const w of wins) {
        try { if (!new URL(w.url).pathname.startsWith('/api/')) w.navigate(w.url); } catch {}
      }
    } catch {}
  }
})()));

// network-first: 문서(HTML)·스크립트·스타일은 항상 서버에서 최신을 받는다(캐시 무시).
//  네트워크 실패 시에만 마지막으로 받은 셸 캐시로 폴백(오프라인 최소 동작).
//  /api/* 는 SW가 관여하지 않는다(OAuth 리다이렉트·로그인 흐름을 그대로 통과).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== location.origin) return;         // 외부(구글 OAuth 등)는 그대로
  if (url.pathname.startsWith('/api/')) return;        // API는 관여 안 함
  const isDoc = req.mode === 'navigate';
  const isAsset = /\.(js|css|webmanifest)$/.test(url.pathname);
  if (!isDoc && !isAsset) return;                      // 이미지 등은 브라우저 기본 처리
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        try { const clone = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, clone)).catch(() => {}); } catch {}
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// 알림 중요도별 진동 패턴 — 카톡처럼 중요한 알림은 길고 세게 울린다.
const VIBRATE = {
  high:   [600, 150, 600, 150, 900],
  check:  [400, 150, 400],
  normal: [300, 150, 300],
};

self.addEventListener('push', (event) => {
  let data = { title: '리버힐 알림', body: '새 소식이 있습니다.', url: '/', level: 'normal', badge: '/badge-flag.png' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  const level = data.level || 'normal';
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: data.badge || '/badge-flag.png',
      data: { url: data.url },
      vibrate: VIBRATE[level] || VIBRATE.normal,
      requireInteraction: level === 'high',
      tag: data.tag || 'riverhill',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const appUrl = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate?.(appUrl); return w.focus(); }
      }
      return self.clients.openWindow(appUrl);
    })
  );
});
