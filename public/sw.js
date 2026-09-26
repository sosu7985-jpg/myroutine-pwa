// Network-only service worker: enables reliable PWA installation without
// caching application data or providing offline behavior.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method === 'GET' && requestUrl.origin === self.location.origin) {
    event.respondWith(fetch(event.request));
  }
});
