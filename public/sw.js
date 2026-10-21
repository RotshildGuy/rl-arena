/*
 * RL Arena's service worker. Two jobs, and deliberately nothing else:
 *
 *  - make the site installable ("add to home screen"), which is also what
 *    iPhones require before they will deliver a notification at all;
 *  - show the race reminders that arrive by push while the site is closed.
 *
 * No caching. A worker that caches pages is a worker that serves yesterday's
 * build after a deploy, and this app has no offline mode worth that risk.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { notification: { body: event.data ? event.data.text() : '' } };
  }
  // Firebase Cloud Messaging nests the visible part under `notification`;
  // anything sent as plain data is read the same way.
  const n = payload.notification || payload.data || {};
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(n.title || 'RL Arena', {
      body: n.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      lang: 'he',
      dir: 'rtl',
      tag: data.tag || 'rl-arena',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          // Already open: bring it forward and tell it where the tap was
          // meant to go (a reply opens the feedback page).
          w.postMessage({ type: 'open', url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
