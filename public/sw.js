// 서비스워커: 앱이 꺼져 있어도 백그라운드에서 푸시를 받아 알림을 띄운다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// 알림 중요도별 진동 패턴 — 카톡처럼 중요한 알림은 길고 세게 울린다.
//  (기종/안드로이드 버전에 따라 OS 알림채널 설정이 우선할 수 있음 → 되는 기기에서만 적용)
const VIBRATE = {
  high:   [600, 150, 600, 150, 900], // 근무확정·곧차례: 길게 3번, 마지막은 더 길게
  check:  [400, 150, 400],           // 확인필요: 중간
  normal: [300, 150, 300],           // 리마인더 등
};

self.addEventListener('push', (event) => {
  let data = { title: '리버힐 알림', body: '새 소식이 있습니다.', url: '/', level: 'normal' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  const level = data.level || 'normal';
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      vibrate: VIBRATE[level] || VIBRATE.normal,
      requireInteraction: level === 'high', // 중요 알림은 탭할 때까지 화면에 유지(자동으로 안 사라짐)
      tag: 'riverhill',       // 같은 소식 중복 방지
      renotify: true,         // 같은 tag라도 다시 울림
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
