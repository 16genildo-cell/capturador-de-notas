const CACHE_NAME = 'captura-total-cache-v3';
const PRECACHE_URLS = [
  '/static/css/app.css?v=2.2',
  '/static/img/logo-32.png',
  '/static/img/logo-192.png',
  '/static/img/logo-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Ignora requisições que não sejam GET (POST, PUT, DELETE, etc.)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Para CSS e scripts estáticos: Network-first com fallback para cache
  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Para imagens e outros estáticos: Cache-first com fallback para rede
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        });
      }),
    );
    return;
  }

  // Para páginas e API, sempre tenta a rede primeiro
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request)),
  );
});
