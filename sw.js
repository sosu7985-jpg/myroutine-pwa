// Retire the previous GitHub Pages root-scoped MyRoutine service worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('myroutine-')).map((name) => caches.delete(name)));
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
