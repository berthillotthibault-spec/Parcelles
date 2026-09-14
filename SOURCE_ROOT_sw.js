const BUILD='2026.09.14-v4.0.0';
const STATIC=`parcelles-static-${BUILD}`;
const RUNTIME=`parcelles-runtime-${BUILD}`;
const CORE=[
 './','./index.html','./manifest.webmanifest','./parcelles.svg',
 './css/base.css','./css/components.css','./css/map.css','./css/responsive.css',
 './js/app.js','./js/state.js','./js/storage.js','./js/map.js','./js/import-export.js','./js/sync.js','./js/utils.js','./js/runtime.js','./js/insights.js','./js/notifications.js','./js/reports.js','./js/statistics.js','./js/remote-ai.js','./js/zip-lite.js','./js/shapefile-fallback.js',
 './icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(STATIC).then(cache=>cache.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('parcelles-')&&!([STATIC,RUNTIME].includes(k))).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET')return;
 if(req.mode==='navigate'){
   event.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open(RUNTIME).then(x=>x.put('./index.html',c));return r;}).catch(()=>caches.match('./index.html')));return;
 }
 if(url.origin===location.origin){
   event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const c=r.clone();caches.open(RUNTIME).then(x=>x.put(req,c));}return r;})));return;
 }
 const dependencyHost=['cdnjs.cloudflare.com','unpkg.com'].includes(url.hostname);
 if(dependencyHost){event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const c=r.clone();caches.open(RUNTIME).then(x=>x.put(req,c));}return r;}).catch(()=>caches.match(req))));return;}
 event.respondWith(fetch(req).catch(()=>caches.match(req)));
});
