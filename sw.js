const BUILD='2026.09.14-deployfix.2';
const SHELL=`parcelles-shell-${BUILD}`;
const RUNTIME=`parcelles-runtime-${BUILD}`;
const APP_SHELL=[
  './','./index.html','./manifest.webmanifest','./parcelles.svg',
  './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png',
  './base.css','./components.css','./map.css','./responsive.css',
  './app.js','./state.js','./storage.js','./import-export.js','./map.js','./sync.js','./utils.js','./shapefile-fallback.js','./zip-lite.js'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('parcelles-')&&!([SHELL,RUNTIME].includes(k))).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request,fallback){
  const cache=await caches.open(RUNTIME);
  try{
    const response=await fetch(request,{cache:'no-cache'});
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(error){
    return (await cache.match(request))||(await caches.match(request))||(fallback?await caches.match(fallback):null)||Response.error();
  }
}
async function staleWhileRevalidate(request){
  const cache=await caches.open(RUNTIME);
  const cached=await cache.match(request);
  const network=fetch(request).then(response=>{if(response&&(response.ok||response.type==='opaque'))cache.put(request,response.clone());return response;}).catch(()=>null);
  return cached||(await network)||Response.error();
}

self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(req.mode==='navigate'){
    event.respondWith(networkFirst(req,'./index.html'));return;
  }
  if(url.origin===location.origin){
    if(/\.(?:js|css|html|webmanifest)$/i.test(url.pathname))event.respondWith(networkFirst(req));
    else event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // Runtime-cache CDN libraries after first successful online use, so subsequent
  // launches can still load the application when the network is unavailable.
  if(['cdnjs.cloudflare.com','unpkg.com'].includes(url.hostname))event.respondWith(staleWhileRevalidate(req));
});

self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING')self.skipWaiting();
});
