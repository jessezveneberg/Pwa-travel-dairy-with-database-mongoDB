const CACHE_NAME = 'travel-diary-v5';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Функція для кешування ресурсів
const cacheResources = async () => {
    try {
        const cache = await caches.open(CACHE_NAME);
        console.log('Кешування ресурсів...');
        
        // Додаємо кожен ресурс окремо з обробкою помилок
        for (const url of ASSETS_TO_CACHE) {
            try {
                await cache.add(url);
                console.log('Закешовано:', url);
            } catch (error) {
                console.warn('Не вдалося закешувати:', url, error);
            }
        }
        
        console.log('Всі ресурси закешовано');
    } catch (error) {
        console.error('Помилка кешування:', error);
    }
};

// Обробник встановлення
self.addEventListener('install', (event) => {
    console.log('Service Worker: Встановлення v5');
    event.waitUntil(cacheResources());
    self.skipWaiting(); // Активуємо негайно
});

// Обробник активації
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Активація v5');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Видалення старого кешу:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker готовий до роботи');
            return self.clients.claim(); // Контролюємо всі сторінки
        })
    );
});

// Обробник запитів
self.addEventListener('fetch', (event) => {
    // Пропускаємо не-GET запити та зовнішні ресурси
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('nominatim.openstreetmap.org')) return;
    
    event.respondWith(
        (async () => {
            // Спочатку шукаємо в кеші
            const cachedResponse = await caches.match(event.request);
            
            if (cachedResponse) {
                console.log('З кешу:', event.request.url);
                return cachedResponse;
            }
            
            try {
                // Якщо немає в кеші - робимо мережевий запит
                const networkResponse = await fetch(event.request);
                
                // Кешуємо тільки успішні відповіді
                if (networkResponse.status === 200) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(event.request, networkResponse.clone());
                    console.log('Закешовано новий ресурс:', event.request.url);
                }
                
                return networkResponse;
            } catch (error) {
                console.log('Помилка мережі, спроба fallback:', error);
                
                // Fallback для HTML
                if (event.request.destination === 'document') {
                    const fallback = await caches.match('/index.html');
                    if (fallback) return fallback;
                }
                
                // Fallback для CSS
                if (event.request.url.endsWith('.css')) {
                    const cssFallback = await caches.match('/styles.css');
                    if (cssFallback) return cssFallback;
                }
                
                return new Response('Офлайн режим', { 
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
        })()
    );
});

// Push-сповіщення
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    
    const options = {
        body: data.body || 'Не забудьте додати нові враження про подорож!',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'travel-reminder'
    };

    event.waitUntil(
        self.registration.showNotification(
            data.title || '🌍 Щоденник подорожей', 
            options
        )
    );
});

// Клік на сповіщення
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            if (clientList.length > 0) {
                return clientList[0].focus();
            }
            return clients.openWindow('/');
        })
    );
});