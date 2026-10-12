const BUILD='2026.10.12-v10.15.0';
// Separate installations on the same host must not evict each other's files.
const SCOPE=new URL(self.registration.scope).pathname;
const PREFIX=`parcelles-${encodeURIComponent(SCOPE)}-`;
const STATIC=`${PREFIX}static-${BUILD}`;
const RUNTIME=`${PREFIX}runtime-${BUILD}`;
// Carte hors connexion : cache des tuiles IGN indépendant de BUILD (une mise à jour ne le vide pas),
// rempli par la page (offline-map-ui.js) et jamais listé dans CORE.
const TILES=`${PREFIX}tiles-v1`;
// Rappels en arrière-plan (n° 17) : une erreur de chargement ne doit jamais empêcher le cache de fonctionner.
try{importScripts('./sw-reminders.js');}catch(error){console.warn('[Parcelles] rappels en arrière-plan indisponibles.',error);}
const CORE=[
 /* v7c */'./habits.js','./habits-ui.js','./agro-weather.js','./phenology.js','./phenology-ui.js','./agro-assistant.js','./agro-risk.js','./agro-risk-ui.js','./sowing.js','./sowing-ui.js','./rotation-advice.js','./rotation-advice-ui.js','./stock-capture.js','./stock-capture-ui.js','./share-target.js','./share-target-ui.js',
 /* v6c */'./activity-modules.js','./activity-modules-ui.js','./getting-started.js','./getting-started-ui.js','./whats-new.js','./whats-new-ui.js','./whatsnew.json','./friendly-errors.js','./friendly-errors-ui.js','./help.js','./help-ui.js','./theme.js','./theme-ui.js','./count-up.js','./count-up-ui.js',
 './geometry-ops.js','./contour-edit.js','./contour-edit-ui.js','./snap.js','./snap-ui.js','./walk-measure.js','./walk-measure-ui.js','./parcel-split.js','./parcel-split-ui.js','./approach.js','./approach-ui.js', // v6a
 './machine-export.js','./application-coverage.js','./spatial-analysis.js','./spatial-ui.js','./work-effects.js','./work-effects-ui.js','./costs.js','./costs-ui.js','./sales.js','./sales-ui.js','./dossier.js','./dossier-ui.js','./invoices.js','./invoices-ui.js','./invoice-pdf.js','./pdf-lite.js','./farm-context.js','./weather-decision.js','./work-weather.js','./day-route-ui.js','./qr.js','./qr-labels.js','./equipment-qr-ui.js','./farm-memory.js','./farm-planner.js','./farm-ui.js','./farm-extension-ui.js','./management-zones.js','./prescriptions.js','./farm-records.js','./advanced-economics.js','./connections.js','./scanner.js','./precision-ui.js','./application-map.js','./application-ui.js','./operations-ui.js','./connections-ui.js','./farm-agent.js','./economic-ui.js','./harvest-traceability.js','./harvest-ui.js','./yield.js','./yield-ui.js','./satellite.js','./satellite-ui.js','./motion.css','./motion.js','./home-priorities.js','./personalization.js','./personalization-ui.js','./personalization.css','./design-v3.css',
 './','./index.html','./manifest.webmanifest','./parcelles.svg','./config.js',
 './tokens.css','./base.css','./components.css','./map.css','./shell.css','./screens.css','./responsive.css','./accessibility.css','./assistant-launcher.css','./grazing.css','./public-works.css',
 './app.js','./ui.js','./platform.js','./integrations.js','./intelligence.js','./security.js','./diagnostics.js','./state.js','./storage.js','./map.js','./import-export.js','./sync.js','./permissions.js','./utils.js','./runtime.js','./performance.js','./field-ops.js','./traceability.js','./native.js','./automations.js','./insights.js','./notifications.js','./reports.js','./statistics.js','./pilotage.js','./remote-ai.js','./zip-lite.js','./shapefile-fallback.js','./tab-coordinator.js',
 './text-encoding.js','./text-repair.js','./rpg.js','./map-records.js','./basemaps.js','./field-tracker.js','./field-tracker-ui.js','./field-coverage.js','./field-coverage-ui.js','./photo-geo.js','./photo-geo-ui.js','./neighbors.js','./neighbors-ui.js','./parcel-silhouette.js','./parcel-hero-ui.js','./work-list.js','./work-swipe-ui.js','./voice-notes.js','./voice-notes-ui.js','./form-chips.js','./form-chips-ui.js','./work-subviews.js','./work-subviews-ui.js','./query-engine.js','./query-engine-ui.js','./week-planner.js','./week-planner-ui.js','./charts.js','./charts-ui.js','./view-transitions.js','./view-transitions-ui.js','./offline-map.js','./offline-map-ui.js','./map-modes.js','./sync-status.js','./sync-status-ui.js','./sync-conflict.js','./sync-conflict-ui.js','./sync-merge.js','./restore-preview.js','./restore-ui.js','./open-export.js','./render-scheduler.js','./vendor-loader.js','./install-prompt.js','./install-ui.js','./grazing.js','./grazing-ui.js','./history.js','./history-ui.js','./form-drafts.js','./grazing-records.js','./celebration.js','./celebration-ui.js','./quick-entry.js','./quick-entry-ui.js','./soil-water.js','./soil-water-ui.js','./team-work.js','./team-work-ui.js','./team-roles.js','./team-roles-ui.js','./home-story.js','./home-story-ui.js','./rpg-onboarding.js','./rpg-onboarding-ui.js','./compliance.js','./compliance-ui.js','./phyto.js','./phyto-ui.js','./phyto-catalog.js','./phyto-catalog-ui.js','./ift.js','./ift-ui.js','./spray-window.js','./nitrogen.js','./nitrogen-ui.js','./herd-health.js','./herd-health-ui.js','./margin-ui.js','./campaign-card.js','./campaign-card-ui.js','./simulator.js','./simulator-ui.js','./pac.js','./pac-ui.js','./covers.js','./covers-ui.js','./public-works.js','./public-works-ui.js','./wide-layout.js','./wide-layout-ui.js','./ics.js','./ics-ui.js','./sw-reminders.js','./map-labels.js','./map-legend.js','./parcel-formats.js','./parcel-formats-ui.js','./shortcuts.js','./shortcut-field-96.png','./shortcut-work-96.png','./shortcut-photo-96.png','./shortcut-voice-96.png',
 './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png',
 './leaflet.min.css','./leaflet.min.js','./marker-icon.png','./marker-icon-2x.png','./marker-shadow.png','./layers.png','./layers-2x.png','./xlsx.full.min.js','./shp.min.js',
 './instrument-sans-latin.woff2','./instrument-sans-latin-ext.woff2','./instrument-serif-latin.woff2','./instrument-serif-latin-ext.woff2','./safe-html.js','./live-sync.js','./live-sync-ui.js','./activity.js','./activity-ui.js','./app-lock.js','./app-lock-ui.js','./trash.js','./trash-ui.js'
 ,'./crop-margins.js','./crop-margins-ui.js','./grain-stock.js','./grain-stock-ui.js','./stock-lots.js','./stock-lots-ui.js','./herd-economics.js','./herd-economics-ui.js','./land.js','./land-ui.js','./claims.js','./claims-ui.js','./fuel.js','./fuel-ui.js' // v7b
];

async function fetchWithTimeout(request,ms=4500){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
 try{return await fetch(request,{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
}

async function warmCore(){
 const cache=await caches.open(STATIC);
 const results=await Promise.all(CORE.map(async path=>{
   // Lire le corps aussitôt : en HTTP/1.1, des réponses non lues gardent les 6 connexions
   // et bloquent les autres requêtes jusqu'au délai. L'écriture reste tout ou rien.
   try{const fetched=await fetchWithTimeout(new Request(new URL(path,self.registration.scope)),20000);if(!fetched.ok)throw new Error(`HTTP ${fetched.status}`);const body=await fetched.blob();return {path,response:new Response(body,{status:fetched.status,statusText:fetched.statusText,headers:fetched.headers})};}
   catch(error){return {path,error:error?.message||String(error)};}
 }));
 const failures=results.filter(x=>x.error);if(failures.length)throw new Error(`Cache incomplet : ${failures.map(x=>x.path).join(', ')}`);
 await Promise.all(results.map(({path,response})=>cache.put(path,response.clone())));
}

self.addEventListener('install',event=>event.waitUntil(warmCore()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&!([STATIC,RUNTIME,TILES].includes(k))).map(k=>caches.delete(k)));
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

async function tileResponse(request){
 try{const cached=await (await caches.open(TILES)).match(request.url);if(cached)return cached;}catch{}
 return fetch(request).catch(()=>new Response('',{status:504,statusText:'Offline'}));
}

async function coreAssetResponse(request){
 const cache=await caches.open(STATIC);
 const cached=await cache.match(request,{ignoreSearch:true});
 if(cached)return cached;
 const network=await fetch(request,{cache:'no-store'});
 if(network?.ok)await cache.put(request,network.clone()).catch(()=>{});
 return network;
}

// n° 121 — Partage depuis une autre application (Android/Chrome) : fichiers validés puis mis en
// IndexedDB ; app.js les ouvre ensuite dans le tri « C'est quoi ? ». Listes identiques à share-target.js.
const SHARE_EXTENSIONS=['zip','shp','kml','kmz','gpx','xml','pdf','jpg','jpeg'],SHARE_MAX_BYTES=25*1024*1024,SHARE_MAX_FILES=10;
function inboxDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('parcelles-inbox',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function receiveShare(req){
  let stored=0,rejected=0;
  try{
    const form=await req.formData(),files=form.getAll('files').filter(f=>f&&typeof f==='object'&&'size' in f);
    const db=await inboxDb(),receivedAt=Date.now();
    const rows=[];for(const f of files){const ext=(/\.([a-z0-9]+)$/i.exec(f.name||'')||[])[1]?.toLowerCase()||'';if(!SHARE_EXTENSIONS.includes(ext)||!(f.size>0)||f.size>SHARE_MAX_BYTES||rows.length>=SHARE_MAX_FILES){rejected++;continue;}rows.push({id:`share_${receivedAt}_${rows.length}`,name:f.name,type:f.type||'',size:f.size,blob:f,receivedAt});}
    await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');for(const row of rows)tx.objectStore('files').put(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    stored=rows.length;db.close();
  }catch(error){console.warn('[Parcelles] partage reçu',error);}
  return Response.redirect(new URL(`./?inbox=1&n=${stored}&rejected=${rejected}`,self.registration.scope).href,303);
}
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method==='POST'&&url.origin===location.origin&&url.pathname===new URL('./share-target',self.registration.scope).pathname){event.respondWith(receiveShare(req));return;}
 if(req.method!=='GET')return;
 if(req.mode==='navigate'){event.respondWith(navigationResponse(req));return;}
 if(url.origin===location.origin){
   const isCore=CORE.some(path=>url.pathname===new URL(path,self.registration.scope).pathname);
   event.respondWith(isCore?coreAssetResponse(req):staleWhileRevalidate(req,event));return;
 }
 if(url.hostname==='data.geopf.fr'&&url.pathname==='/wmts'&&url.searchParams.get('REQUEST')==='GetTile'){event.respondWith(tileResponse(req));return;}
 const dependencyHost=['cdnjs.cloudflare.com','unpkg.com','www.gstatic.com'].includes(url.hostname);
 if(dependencyHost){event.respondWith(staleWhileRevalidate(req,event));return;}
 event.respondWith(fetch(req).catch(()=>caches.match(req)));
});

// Periodic Background Sync (Android, application installée) : rappel des travaux et tâches du jour.
self.addEventListener('periodicsync',event=>{
 if(event.tag!=='parcelles-rappels'||!self.ParcellesReminders)return;
 event.waitUntil(self.ParcellesReminders.notifyReminders(self.registration).catch(error=>console.warn('[Parcelles] rappel impossible.',error)));
});
self.addEventListener('notificationclick',event=>{
 const target=new URL(event.notification?.data?.url||'./index.html#today',self.registration.scope).href;event.notification.close();
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const open=windows.find(c=>c.url.startsWith(self.registration.scope));if(open){await open.focus();if('navigate'in open)await open.navigate(target).catch(()=>{});return;}await self.clients.openWindow(target);})());
});
