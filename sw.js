const CACHE_NAME = 'chamariz-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/edit_remove.html',
  '/manifest.json',
  '/icons/app-icon.png',
  '/icons/app-icon-large.png',
  '/icons/Jacu.jpeg',
  '/icons/Arancuan.jpeg',
  '/icons/Lambu Sururina.jpg',
  '/icons/Lambu Preta.jpeg',
  '/icons/Galega.jpg',
  '/icons/Juriti.jpg',
  '/Audios/Jacu.m4a',
  '/Audios/Arancuan.m4a',
  '/Audios/Lambu Sururina.m4a',
  '/Audios/Lambu Preta.m4a',
  '/Audios/Galega.m4a',
  '/Audios/Juriti.m4a'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return response;
          });
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
}); 