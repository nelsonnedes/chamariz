/**
 * SERVICE WORKER - Chamariz
 * Cache-first strategy para assets estáticos
 * Network-first para dados dinâmicos
 */

const CACHE_NAME = 'chamariz-v1';
const RUNTIME_CACHE = 'chamariz-runtime-v1';

// Assets para cachear na instalação
const PRECACHE_URLS = [
    './index.html',
    './add.html',
    './edit_remove.html',
    './manifest.json',
    './sync-manager.js',
    './css/all.min.css'
];

// ===== INSTALL EVENT =====
self.addEventListener('install', event => {
    console.log('🔧 Service Worker instalando...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✓ Cache precache criado');
                return cache.addAll(PRECACHE_URLS);
            })
            .catch(error => {
                console.warn('⚠ Erro ao cachear assets:', error);
                // Continuar mesmo se falhar
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

    // Ignorar requisições de extensões do navegador
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
    }

    // Estratégia para arquivos estáticos (CSS, JS, Font)
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
                        if (!response || response.status !== 200) {
                            return response;
                        }
                        
                        const responseToCache = response.clone();
                        caches.open(RUNTIME_CACHE)
                            .then(cache => {
                                cache.put(request, responseToCache);
                            });
                        
                        return response;
                    }).catch(error => {
                        console.warn('⚠ Erro ao buscar:', url.pathname, error);
                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }

    // Estratégia Network-First para HTML (sempre tentar rede primeiro)
    if (request.method === 'GET' && url.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(RUNTIME_CACHE)
                            .then(cache => {
                                cache.put(request, responseToCache);
                            });
                        return response;
                    }
                    return response;
                })
                .catch(error => {
                    // Se falhar, tentar cache
                    return caches.match(request)
                        .then(response => {
                            if (response) {
                                return response;
                            }
                            return new Response('Offline', { status: 503 });
                        });
                })
        );
        return;
    }

    // Para outras requisições GET, Cache-First com fallback para network
    if (request.method === 'GET') {
        event.respondWith(
            caches.match(request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    
                    return fetch(request)
                        .then(response => {
                            if (!response || response.status !== 200) {
                                return response;
                            }
                            
                            const responseToCache = response.clone();
                            caches.open(RUNTIME_CACHE)
                                .then(cache => {
                                    cache.put(request, responseToCache);
                                });
                            
                            return response;
                        })
                        .catch(error => {
                            console.warn('⚠ Erro offline:', url.pathname);
                            // Retornar placeholders para diferentes tipos
                            if (request.destination === 'image') {
                                return new Response(
                                    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="50" fill="#ddd"/></svg>',
                                    { 
                                        headers: { 'Content-Type': 'image/svg+xml' },
                                        status: 200
                                    }
                                );
                            }
                            if (request.destination === 'audio') {
                                return new Response(null, { status: 204 });
                            }
                            return new Response('Offline', { status: 503 });
                        });
                })
        );
        return;
    }

    // Para outras requisições, deixar passar
    event.respondWith(fetch(request));
});

// ===== MESSAGE EVENT (para comunicação com páginas) =====
self.addEventListener('message', event => {
    console.log('📨 Mensagem recebida no SW:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
