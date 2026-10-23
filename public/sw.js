/*
 * RL Arena's service worker. One job, and deliberately nothing else: make the
 * site installable ("add to home screen").
 *
 * No caching. A worker that caches pages is a worker that serves yesterday's
 * build after a deploy, and this app has no offline mode worth that risk.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
