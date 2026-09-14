const BUILD='2026.09.14-v5.0.0';
const STATIC=`parcelles-static-${BUILD}`;
const RUNTIME=`parcelles-runtime-${BUILD}`;
const CORE=[
 './','./index.html','./manifest.webmanifest','./parcelles.svg',
 './base.css','./components.css','./map.css','./responsive.css',
 './app.js','./diagnostics.js','./state.js','./storage.js','./map.js','./import-export.js','./sync.js','./permissions.js','./utils.js','./runtime.js','./insights.js','./notifications.js','./reports.js','./statistics.js','./pilotage.js','./remote-ai.js','./zip-lite.js','./shapefile-fallback.js',
 './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png'
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
   if(url.pathname.endsWith('/config.js')){event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));return;}
   event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const c=r.clone();caches.open(RUNTIME).then(x=>x.put(req,c));}return r;})));return;
 }
 const dependencyHost=['cdnjs.cloudflare.com','unpkg.com','www.gstatic.com'].includes(url.hostname);
 if(dependencyHost){event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const c=r.clone();caches.open(RUNTIME).then(x=>x.put(req,c));}return r;}).catch(()=>caches.match(req))));return;}
 event.respondWith(fetch(req).catch(()=>caches.match(req)));
});
