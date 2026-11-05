importScripts('./version.js');

const CACHE_VERSION = `3d-circuit-v${self.APP_VERSION.cache}`;
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './version.js',
    './main.js',
    './simulator.js',
    './simulator3d.js',
    './settings.ini',
    './manifest.webmanifest',
    './lib/three.min.js',
    './lib/OrbitControls.js',
    './icons/app-icon-192.png',
    './icons/app-icon-512.png',
    './icons/app-icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './manual/index.html',
    './manual/style.css'
];

self.addEventListener('install', event => {
    const freshRequests = APP_SHELL.map(url => new Request(url, { cache: 'reload' }));
    event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(freshRequests)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key.startsWith('3d-circuit-') && key !== CACHE_VERSION)
                .map(key => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) {
        event.respondWith(
            caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
                return response;
            }))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
            }
            return response;
        }).catch(() => {
            if (event.request.mode === 'navigate') return caches.match('./index.html');
            throw new Error('Offline and resource is not cached.');
        }))
    );
});
