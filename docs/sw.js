// 서비스워커: 앱이 꺼져 있어도 백그라운드에서 푸시를 받아 알림을 띄운다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: '리버힐 알림', body: '새 소식이 있습니다.', url: './' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url },
      vibrate: [200, 100, 200],
      tag: 'riverhill',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) { w.navigate?.(url); return w.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
