const CACHE_NAME = 'chamariz-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/edit_remove.html',
  '/add.html',
  '/manifest.json',
  '/icons/app-icon.png',
  '/icons/app-icon-large.png',
  '/icons/Jacu.jpeg',
  '/icons/Arancuan.jpeg',
  '/icons/Lambu Sururina.jpg',
  '/icons/Lambu Preta.jpeg',
  '/icons/Galega.jpg',
  '/icons/Juriti.jpg',
  '/icons/cutia.jpeg',
  '/icons/Marreca.jpg',
  '/icons/Pato.jpeg',
  '/Audios/Jacu.m4a',
  '/Audios/Arancuan.m4a',
  '/Audios/Lambu Sururina.m4a',
  '/Audios/Lambu Preta.m4a',
  '/Audios/Galega.m4a',
  '/Audios/Juriti.m4a',
  '/Audios/Cutia.m4a',
  '/Audios/Marreca.m4a',
  '/Audios/Pato.m4a'
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Erro ao cachear recursos:', error);
      })
  );
});

// Interceptação de requisições
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - retorna a resposta do cache
        if (response) {
          return response;
        }

        // Clone da requisição
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest)
          .then(response => {
            // Verifica se a resposta é válida
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone da resposta
            const responseToCache = response.clone();

            // Adiciona a resposta ao cache
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Se falhar ao buscar online, tenta retornar uma versão offline
            if (event.request.headers.get('accept').includes('audio')) {
              return new Response('', {
                status: 404,
                statusText: 'Áudio não disponível offline'
              });
            }
          });
      })
  );
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
}); 