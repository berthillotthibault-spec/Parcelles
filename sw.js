const CACHE = 'parcelles-2-v4';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./icons/parcelles.svg','./css/base.css','./css/components.css','./css/map.css','./css/responsive.css','./js/app.js','./js/utils.js','./js/storage.js','./js/state.js','./js/import-export.js','./js/map.js','./js/sync.js'];
const OPTIONAL_RUNTIME = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css','https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js','https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(async cache => { await cache.addAll(APP_SHELL); await Promise.allSettled(OPTIONAL_RUNTIME.map(asset => cache.add(asset))); }).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(cache => cache.put(event.request,response.clone()));
    return response;
  }).catch(() => cached || new Response('Hors connexion', {status:503,statusText:'Hors connexion'}))));
});
