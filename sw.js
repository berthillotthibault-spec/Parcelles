/* Parcelles 2.0 — Service Worker v8
   Objectif : ne plus bloquer les mises à jour JS/HTML derrière un cache ancien. */
const CACHE = 'parcelles-2-v8-geofolia';

// Le dépôt GitHub Pages actuel place les fichiers À LA RACINE.
// Les anciennes versions pointaient à tort vers ./js/ et ./css/.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './parcelles.svg',
  './base.css',
  './components.css',
  './map.css',
  './responsive.css',
  './app.js',
  './utils.js',
  './storage.js',
  './state.js',
  './import-export.js',
  './map.js',
  './sync.js'
];

const OPTIONAL_RUNTIME = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://unpkg.com/shpjs@6.2.0/dist/shp.min.js',
  'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // addAll rendait l'installation entière invalide si un seul chemin était faux.
    // Ici chaque ressource est indépendante.
    await Promise.allSettled(APP_SHELL.map(async url=>{
      const response=await fetch(url,{cache:'reload'});
      if(response.ok) await cache.put(url,response.clone());
    }));
    await Promise.allSettled(OPTIONAL_RUNTIME.map(async url=>{
      const response=await fetch(url,{cache:'reload'});
      if(response.ok) await cache.put(url,response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

function isCodeRequest(request,url){
  if(url.origin!==self.location.origin) return false;
  if(request.mode==='navigate') return true;
  return /\.(?:html|js|mjs|css)$/i.test(url.pathname);
}

self.addEventListener('fetch', event => {
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);

  // HTML/JS/CSS : réseau d'abord. Une nouvelle version publiée est donc prise
  // immédiatement ; le cache ne sert qu'en mode hors connexion.
  if(isCodeRequest(event.request,url)){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response.ok){
          const cache=await caches.open(CACHE);
          await cache.put(event.request,response.clone());
        }
        return response;
      }catch(error){
        return (await caches.match(event.request,{ignoreSearch:true})) ||
          (event.request.mode==='navigate' ? await caches.match('./index.html') : null) ||
          new Response('Hors connexion',{status:503,statusText:'Hors connexion'});
      }
    })());
    return;
  }

  // Images / bibliothèques : cache d'abord, réseau en secours.
  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    if(cached) return cached;
    try{
      const response=await fetch(event.request);
      if(response.ok && url.origin===self.location.origin){
        const cache=await caches.open(CACHE);
        await cache.put(event.request,response.clone());
      }
      return response;
    }catch(error){
      return new Response('Hors connexion',{status:503,statusText:'Hors connexion'});
    }
  })());
});
