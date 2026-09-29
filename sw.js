/**
 * SERVICE WORKER - Chamariz
 * Cache-first para assets estáticos e mídias (áudio/imagens/Firebase Storage)
 * Suporte a modo 100% offline no celular
 */

const CACHE_NAME = 'chamariz-v3';
const RUNTIME_CACHE = 'chamariz-runtime-v3';

// Assets para cachear na instalação
const PRECACHE_URLS = [
    './index.html',
    './add.html',
    './edit_remove.html',
    './manifest.json',
    './firebase-config.js',
    './sync-manager.js',
    './css/all.min.css'
];

// ===== INSTALL EVENT =====
self.addEventListener('install', event => {
    console.log('🔧 Service Worker instalando (v3)...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✓ Cache precache criado');
                return cache.addAll(PRECACHE_URLS);
            })
            .catch(error => {
                console.warn('⚠ Erro ao cachear assets:', error);
            })
    );
    
    self.skipWaiting();
});

// ===== ACTIVATE EVENT =====
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker ativando...');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
                        console.log('🗑 Removendo cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    
    self.clients.claim();
});

// ===== FETCH EVENT =====
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignorar requisições não HTTP/HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
    }

    // 1. Estratégia Cache-First especial para Mídias e Firebase Storage (Áudios e Fotos)
    if (request.method === 'GET' && 
        (url.hostname.includes('firebasestorage.googleapis.com') ||
         url.hostname.includes('storage.googleapis.com') ||
         request.destination === 'image' || 
         request.destination === 'audio' ||
         url.pathname.includes('.mp3') ||
         url.pathname.includes('.m4a') ||
         url.pathname.includes('.png') ||
         url.pathname.includes('.jpg') ||
         url.pathname.includes('.webp'))) {
        
        event.respondWith(
            caches.match(request, { ignoreSearch: false }).then(cachedResponse => {
                if (cachedResponse) {
                    console.log('⚡ Mídia servida do Cache SW:', url.pathname);
                    return cachedResponse;
                }
                
                return fetch(request).then(networkResponse => {
                    // Salvar no cache se for resposta válida (200) ou resposta CORS opaca (status 0)
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        const responseToCache = networkResponse.clone();
                        caches.open(RUNTIME_CACHE).then(cache => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(err => {
                    console.warn('⚠ Dispositivo offline - buscando fallback para mídia:', url.pathname);
                    return caches.match(request, { ignoreSearch: true });
                });
            })
        );
        return;
    }

    // 2. Estratégia para arquivos estáticos (CSS, JS, Fontes)
    if (request.method === 'GET' && 
        (url.pathname.includes('.css') || 
         url.pathname.includes('.js') || 
         url.pathname.includes('.woff') ||
         url.pathname.includes('.woff2') ||
         url.pathname.includes('fontawesome'))) {
        
        event.respondWith(
            caches.match(request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    
                    return fetch(request).then(response => {
                        if (response && (response.status === 200 || response.type === 'opaque')) {
                            const responseToCache = response.clone();
                            caches.open(RUNTIME_CACHE).then(cache => {
                                cache.put(request, responseToCache);
                            });
                        }
                        return response;
                    }).catch(error => {
                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }

    // 3. Estratégia Network-First para páginas HTML (Tenta rede, fallback para cache offline)
    if (request.method === 'GET' && (url.pathname.endsWith('.html') || url.pathname === '/')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(RUNTIME_CACHE).then(cache => {
                            cache.put(request, responseToCache);
                        });
                        return response;
                    }
                    return response;
                })
                .catch(error => {
                    return caches.match(request).then(response => {
                        if (response) {
                            return response;
                        }
                        return caches.match('./index.html');
                    });
                })
        );
        return;
    }

    // 4. Para outras requisições GET
    if (request.method === 'GET') {
        event.respondWith(
            caches.match(request).then(response => {
                if (response) return response;
                return fetch(request).then(res => {
                    if (res && (res.status === 200 || res.type === 'opaque')) {
                        const resCache = res.clone();
                        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, resCache));
                    }
                    return res;
                });
            })
        );
        return;
    }

    event.respondWith(fetch(request));
});

// ===== MESSAGE EVENT =====
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
