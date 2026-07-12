// 서비스워커: 앱이 꺼져 있어도 백그라운드에서 푸시를 받아 알림을 띄운다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: '리버힐 알림', body: '새 소식이 있습니다.', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      vibrate: [200, 100, 200],
      tag: 'riverhill',       // 같은 소식 중복 방지
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 카페 링크로 바로 튀지 않고, 항상 '앱(스코프 루트)'을 먼저 연다.
  // 원문은 앱 안의 피드에서 탭해서 열도록 함.
  const appUrl = self.registration.scope; // 예: https://xxx.ts.net/  → 설치된 PWA로 열림
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // 이미 앱 창이 열려 있으면 그 창을 앞으로 가져온다
      for (const w of wins) {
        if ('focus' in w) { w.navigate?.(appUrl); return w.focus(); }
      }
      return self.clients.openWindow(appUrl);
    })
  );
});
