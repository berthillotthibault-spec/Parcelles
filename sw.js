const BUILD='2026.09.22-v7.1.7';
// Separate installations on the same host must not evict each other's files.
const SCOPE=new URL(self.registration.scope).pathname;
const PREFIX=`parcelles-${encodeURIComponent(SCOPE)}-`;
const STATIC=`${PREFIX}static-${BUILD}`;
const RUNTIME=`${PREFIX}runtime-${BUILD}`;
const CORE=[
 './','./index.html','./manifest.webmanifest','./parcelles.svg','./config.js',
 './tokens.css','./base.css','./components.css','./map.css','./shell.css','./screens.css','./responsive.css','./accessibility.css','./assistant-launcher.css','./grazing.css','./public-works.css',
 './app.js','./ui.js','./platform.js','./integrations.js','./intelligence.js','./security.js','./diagnostics.js','./state.js','./storage.js','./map.js','./import-export.js','./sync.js','./permissions.js','./utils.js','./runtime.js','./performance.js','./field-ops.js','./traceability.js','./native.js','./automations.js','./insights.js','./notifications.js','./reports.js','./statistics.js','./pilotage.js','./remote-ai.js','./zip-lite.js','./shapefile-fallback.js',
 './text-encoding.js','./text-repair.js','./rpg.js','./map-records.js','./grazing.js','./grazing-ui.js','./grazing-records.js','./public-works.js','./public-works-ui.js',
 './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png',
 './leaflet.min.css','./leaflet.min.js','./marker-icon.png','./marker-icon-2x.png','./marker-shadow.png','./layers.png','./layers-2x.png','./xlsx.full.min.js','./shp.min.js'
];

async function fetchWithTimeout(request,ms=4500){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
 try{return await fetch(request,{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
}

async function warmCore(){
 const cache=await caches.open(STATIC);
 const results=await Promise.all(CORE.map(async path=>{
   try{const response=await fetchWithTimeout(new Request(new URL(path,self.registration.scope)),10000);if(!response.ok)throw new Error(`HTTP ${response.status}`);return {path,response};}
   catch(error){return {path,error:error?.message||String(error)};}
 }));
 const failures=results.filter(x=>x.error);if(failures.length)throw new Error(`Cache incomplet : ${failures.map(x=>x.path).join(', ')}`);
 await Promise.all(results.map(({path,response})=>cache.put(path,response.clone())));
}

self.addEventListener('install',event=>event.waitUntil(warmCore()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&!([STATIC,RUNTIME].includes(k))).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));

self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING'){self.skipWaiting();return;}
 if(event.data?.type==='GET_STATUS'){
   const reply={type:'STATUS',build:BUILD,staticCache:STATIC,runtimeCache:RUNTIME,at:Date.now()};
   if(event.ports?.[0])event.ports[0].postMessage(reply);else event.source?.postMessage?.(reply);
 }
});

async function navigationResponse(request){
 // HTML and modules must come from the same installed release. An update is
 // installed atomically and activated through the application's update button.
 const cache=await caches.open(STATIC);
 const installed=await cache.match('./index.html');
 if(installed)return installed;
 try{
   const network=await fetchWithTimeout(request,4500);
   if(network?.ok)return network;
 }catch{}
 return new Response('<h1>Parcelles hors connexion</h1><p>Le cache de l’application n’est pas disponible.</p>',{headers:{'content-type':'text/html;charset=utf-8'},status:503});
}

async function staleWhileRevalidate(request,event){
 const cache=await caches.open(RUNTIME);
 const cached=await cache.match(request);
 const refresh=fetch(request).then(async response=>{if(response?.ok)await cache.put(request,response.clone()).catch(()=>{});return response;}).catch(()=>null);
 event.waitUntil(refresh);
 return cached||await refresh||new Response('',{status:504,statusText:'Offline'});
}

async function coreAssetResponse(request){
 const cache=await caches.open(STATIC);
 const cached=await cache.match(request,{ignoreSearch:true});
 if(cached)return cached;
 const network=await fetch(request,{cache:'no-store'});
 if(network?.ok)await cache.put(request,network.clone()).catch(()=>{});
 return network;
}

self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET')return;
 if(req.mode==='navigate'){event.respondWith(navigationResponse(req));return;}
 if(url.origin===location.origin){
   const isCore=CORE.some(path=>url.pathname===new URL(path,self.registration.scope).pathname);
   event.respondWith(isCore?coreAssetResponse(req):staleWhileRevalidate(req,event));return;
 }
 const dependencyHost=['cdnjs.cloudflare.com','unpkg.com','www.gstatic.com'].includes(url.hostname);
 if(dependencyHost){event.respondWith(staleWhileRevalidate(req,event));return;}
 event.respondWith(fetch(req).catch(()=>caches.match(req)));
});
