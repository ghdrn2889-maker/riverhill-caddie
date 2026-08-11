// 서비스워커: (1)백그라운드 푸시 알림 (2)network-first로 항상 최신 앱 서빙 + 자동 갱신.
//  ★버전 문자열을 바꾸면 브라우저가 이 파일의 변경을 감지해 새 SW를 설치→활성화한다.
const SW_VERSION = 'v9-netfirst-2026-08-11-icon';
const SHELL_CACHE = 'rh-shell-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // 옛 셸 캐시 정리.
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
  } catch {}
  await self.clients.claim();
  // ★강제 새로고침(w.navigate) 제거 — network-first라 앱을 열 때마다(콜드 스타트) 이미 최신 코드를 받으므로
  //  불필요했고, 오히려 '로그인 화면 → 곧바로 재로딩'의 이중 로딩을 유발했다(테스터 링크 포함 모든 진입).
  //  열려 있던 PWA는 다음에 다시 열 때 network-first로 자연히 최신 코드로 갱신된다.
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
