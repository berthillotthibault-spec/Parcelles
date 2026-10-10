import {BUILD_ID} from './utils.js';

const REQUIRED_ASSETS = [
 /* v6c */'./activity-modules.js','./activity-modules-ui.js','./getting-started.js','./getting-started-ui.js','./whats-new.js','./whats-new-ui.js','./whatsnew.json','./friendly-errors.js','./friendly-errors-ui.js','./help.js','./help-ui.js','./theme.js','./theme-ui.js','./count-up.js','./count-up-ui.js',
 './geometry-ops.js','./contour-edit.js','./contour-edit-ui.js','./snap.js','./snap-ui.js','./walk-measure.js','./walk-measure-ui.js','./parcel-split.js','./parcel-split-ui.js','./approach.js','./approach-ui.js', // v6a
  './machine-export.js','./application-coverage.js','./spatial-analysis.js','./spatial-ui.js','./work-effects.js','./work-effects-ui.js','./farm-context.js','./weather-decision.js','./work-weather.js','./day-route-ui.js','./qr.js','./qr-labels.js','./equipment-qr-ui.js','./farm-memory.js','./farm-planner.js','./farm-ui.js','./farm-extension-ui.js','./management-zones.js','./prescriptions.js','./farm-records.js','./advanced-economics.js','./connections.js','./scanner.js','./precision-ui.js','./application-map.js','./application-ui.js','./operations-ui.js','./connections-ui.js','./farm-agent.js','./economic-ui.js','./harvest-traceability.js','./harvest-ui.js','./yield.js','./yield-ui.js','./satellite.js','./satellite-ui.js','./motion.css','./motion.js','./home-priorities.js','./personalization.js','./personalization-ui.js','./personalization.css','./design-v3.css',
  './index.html',
  './tokens.css','./base.css','./components.css','./map.css','./shell.css','./screens.css','./responsive.css','./accessibility.css','./assistant-launcher.css','./grazing.css','./public-works.css',
  './app.js','./ui.js','./platform.js','./integrations.js','./intelligence.js','./security.js','./diagnostics.js','./state.js','./storage.js','./map.js','./import-export.js',
  './shapefile-fallback.js','./zip-lite.js','./tab-coordinator.js','./sync.js','./permissions.js','./utils.js','./runtime.js','./performance.js','./field-ops.js','./traceability.js','./native.js','./automations.js','./insights.js','./notifications.js','./reports.js','./statistics.js','./pilotage.js','./remote-ai.js',
  './text-encoding.js','./text-repair.js','./rpg.js','./map-records.js','./basemaps.js','./field-tracker.js','./field-tracker-ui.js','./voice-notes.js','./voice-notes-ui.js','./form-chips.js','./form-chips-ui.js','./work-subviews.js','./work-subviews-ui.js','./query-engine.js','./query-engine-ui.js','./week-planner.js','./week-planner-ui.js','./charts.js','./charts-ui.js','./view-transitions.js','./view-transitions-ui.js','./offline-map.js','./offline-map-ui.js','./map-modes.js','./sync-status.js','./sync-status-ui.js','./sync-conflict.js','./sync-conflict-ui.js','./sync-merge.js','./restore-preview.js','./restore-ui.js','./open-export.js','./render-scheduler.js','./vendor-loader.js','./install-prompt.js','./install-ui.js','./costs.js','./costs-ui.js','./sales.js','./sales-ui.js','./dossier.js','./dossier-ui.js','./invoices.js','./invoices-ui.js','./invoice-pdf.js','./pdf-lite.js','./grazing.js','./grazing-ui.js','./history.js','./history-ui.js','./form-drafts.js','./grazing-records.js','./celebration.js','./celebration-ui.js','./quick-entry.js','./quick-entry-ui.js','./soil-water.js','./soil-water-ui.js','./team-work.js','./team-work-ui.js','./team-roles.js','./team-roles-ui.js','./home-story.js','./home-story-ui.js','./rpg-onboarding.js','./rpg-onboarding-ui.js','./compliance.js','./compliance-ui.js','./phyto.js','./phyto-ui.js','./phyto-catalog.js','./phyto-catalog-ui.js','./ift.js','./ift-ui.js','./spray-window.js','./nitrogen.js','./nitrogen-ui.js','./herd-health.js','./herd-health-ui.js','./margin-ui.js','./campaign-card.js','./campaign-card-ui.js','./simulator.js','./simulator-ui.js','./pac.js','./pac-ui.js','./covers.js','./covers-ui.js','./public-works.js','./public-works-ui.js','./wide-layout.js','./wide-layout-ui.js','./ics.js','./ics-ui.js','./sw-reminders.js','./map-labels.js','./map-legend.js','./parcel-formats.js','./parcel-formats-ui.js','./shortcuts.js','./shortcut-field-96.png','./shortcut-work-96.png','./shortcut-photo-96.png','./shortcut-voice-96.png',
  './manifest.webmanifest','./parcelles.svg','./config.js'
  ,'./leaflet.min.css','./leaflet.min.js','./xlsx.full.min.js','./shp.min.js'
];

function sameOriginUrl(path){return new URL(path, location.href).href;}
function sessionGet(key,fallback=''){try{return sessionStorage.getItem(key)??fallback;}catch{return fallback;}}
function sessionSet(key,value){try{sessionStorage.setItem(key,String(value));return true;}catch{return false;}}
function sessionRemove(key){try{sessionStorage.removeItem(key);return true;}catch{return false;}}
function timeoutSignal(ms){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return {signal:controller.signal,cancel:()=>clearTimeout(timer)};
}

export async function verifyDeployment({timeoutMs=7000,parallel=6}={}){
  const queue=[...REQUIRED_ASSETS],results=[];
  async function worker(){
    while(queue.length){
      const path=queue.shift();if(!path)break;
      const {signal,cancel}=timeoutSignal(timeoutMs);
      const started=performance.now();
      try{
        const response=await fetch(sameOriginUrl(path),{cache:'no-store',signal});
        const type=response.headers.get('content-type')||'';
        results.push({path,ok:response.ok,status:response.status,type,durationMs:Math.round(performance.now()-started)});
      }catch(error){results.push({path,ok:false,status:0,error:error?.name==='AbortError'?'Délai dépassé':error?.message||String(error),durationMs:Math.round(performance.now()-started)});}
      finally{cancel();}
    }
  }
  await Promise.all(Array.from({length:Math.max(1,Math.min(parallel,REQUIRED_ASSETS.length))},()=>worker()));
  results.sort((a,b)=>REQUIRED_ASSETS.indexOf(a.path)-REQUIRED_ASSETS.indexOf(b.path));
  return {buildId:BUILD_ID,ok:results.every(x=>x.ok),results,failed:results.filter(x=>!x.ok),slow:results.filter(x=>x.durationMs>1500),checkedAt:Date.now()};
}

export function installBootWatchdog({timeoutMs=9000,onTimeout}={}){
  const timer=setTimeout(()=>{
    if(document.documentElement.dataset.appReady==='1')return;
    onTimeout?.();
  },timeoutMs);
  return ()=>clearTimeout(timer);
}

export function markAppReady(){
  document.documentElement.dataset.appReady='1';
  const bootError=document.querySelector('#boot-error');
  if(bootError){bootError.className='sr-only';bootError.textContent='';}
  window.dispatchEvent(new CustomEvent('parcelles:ready',{detail:{buildId:BUILD_ID}}));
}

export async function registerAppServiceWorker({onUpdate,onMessage}={}){
  if(!('serviceWorker'in navigator))return {supported:false};
  const hadController=Boolean(navigator.serviceWorker.controller);
  let reloading=false,activationRequested=false;
  // Observe before registration/update: a fast cached install can activate immediately.
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloading||(!hadController&&!activationRequested))return;
    reloading=true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message',event=>onMessage?.(event.data));
  const registration=await navigator.serviceWorker.register(`./sw.js?build=${encodeURIComponent(BUILD_ID)}`,{updateViaCache:'none'});

  const announceWaiting=worker=>{
    if(!worker)return;
    onUpdate?.({registration,worker,buildId:BUILD_ID,activate:()=>{activationRequested=true;worker.postMessage({type:'SKIP_WAITING'});}});
  };
  const observeInstalling=()=>{
    const worker=registration.installing;
    if(!worker)return;
    worker.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&navigator.serviceWorker.controller)announceWaiting(worker);
    });
  };
  registration.addEventListener('updatefound',observeInstalling);
  observeInstalling();
  if(registration.waiting)announceWaiting(registration.waiting);
  // Checking for an update must not delay readiness or lose updatefound events.
  registration.update().catch(()=>{});
  return {supported:true,registration};
}

export async function serviceWorkerStatus(){
  if(!('serviceWorker'in navigator))return {supported:false};
  const registration=await navigator.serviceWorker.getRegistration();
  if(!registration)return {supported:true,registered:false};
  const worker=registration.active||registration.waiting||registration.installing;
  let reported=null;
  if(worker&&'MessageChannel'in window){
    reported=await new Promise(resolve=>{
      const channel=new MessageChannel();
      const timer=setTimeout(()=>resolve(null),1000);
      channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data||null);};
      try{worker.postMessage({type:'GET_STATUS'},[channel.port2]);}catch{clearTimeout(timer);resolve(null);}
    });
  }
  return {supported:true,registered:true,scope:registration.scope,controller:Boolean(navigator.serviceWorker.controller),state:worker?.state||null,reported};
}

export async function clearAppCaches(){
  if(!('caches'in window))return [];
  const keys=await caches.keys();
  const prefix=`parcelles-${encodeURIComponent(new URL('./',location.href).pathname)}-`;
  const targets=keys.filter(key=>key.startsWith(prefix)||/^parcelles-(static|runtime)-/.test(key));
  await Promise.all(targets.map(key=>caches.delete(key)));
  return targets;
}

export async function resetRuntimeAndReload(){
  await clearAppCaches().catch(()=>[]);
  if('serviceWorker'in navigator){
    const registrations=await navigator.serviceWorker.getRegistrations().catch(()=>[]);
    const appScope=new URL('./',location.href).href;
    await Promise.all(registrations.filter(r=>r.scope===appScope).map(r=>r.unregister().catch(()=>false)));
  }
  sessionRemove('parcelles:sw-reloading');
  location.reload();
}

export async function storageHealth(){
  const estimate=await navigator.storage?.estimate?.().catch?.(()=>null) || null;
  const persisted=await navigator.storage?.persisted?.().catch?.(()=>false) || false;
  return {estimate,persisted};
}

export async function requestPersistentStorage(){
  if(!navigator.storage?.persist)return false;
  try{return await navigator.storage.persist();}catch{return false;}
}

export async function emergencyReadState(){
  if(!('indexedDB'in window))return null;
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;resolve(value);};
    try{
      const request=indexedDB.open('parcelles-app');
      request.onerror=()=>finish(null);
      request.onsuccess=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('app')){db.close();finish(null);return;}
        const tx=db.transaction('app','readonly'),store=tx.objectStore('app');
        const keysReq=store.getAllKeys(),valuesReq=store.getAll();let keys=null,values=null;
        const resolveState=()=>{if(!keys||!values)return;const map=new Map(keys.map((key,index)=>[String(key),values[index]]));const active=map.get('active-workspace');const id=String(active?.id||'local');const key=id&&id!=='local'?`state:workspace:${id.replace(/[^a-zA-Z0-9_-]/g,'_')}`:'state';const value=map.get(key)||map.get('state')||null;db.close();finish(value);};
        keysReq.onsuccess=()=>{keys=keysReq.result||[];resolveState();};valuesReq.onsuccess=()=>{values=valuesReq.result||[];resolveState();};
        keysReq.onerror=valuesReq.onerror=()=>{db.close();finish(null);};
      };
      setTimeout(()=>finish(null),2500);
    }catch{finish(null);}
  });
}

export async function downloadEmergencyState(){
  const data=await emergencyReadState();
  if(!data)throw new Error('Aucune donnée locale récupérable.');
  const blob=new Blob([JSON.stringify({format:'parcelles-emergency-state',buildId:BUILD_ID,createdAt:Date.now(),data},null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`parcelles-secours-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  return true;
}

// n° 117 : installation sur l’écran d’accueil. L’invite Android (beforeinstallprompt) est mise
// de côté dès le chargement du module pour être proposée au bon moment.
let deferredInstallPrompt=null;
const installListeners=new Set();
function notifyInstall(){for(const listener of installListeners){try{listener(detectInstallState());}catch{}}}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;notifyInstall();});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;notifyInstall();});
}
export function onInstallStateChange(listener){installListeners.add(listener);return()=>installListeners.delete(listener);}

// « standalone » (déjà installé), « installable » (invite Android disponible),
// « ios-safari » (Partager › Sur l’écran d’accueil) ou « unsupported ».
export function detectInstallState({nav=globalThis.navigator,media=globalThis.matchMedia,prompt=deferredInstallPrompt}={}){
  try{
    if(nav?.standalone===true)return 'standalone';
    if(typeof media==='function'&&['standalone','fullscreen','minimal-ui'].some(mode=>media.call(globalThis,`(display-mode: ${mode})`)?.matches))return 'standalone';
  }catch{}
  if(prompt)return 'installable';
  const ua=String(nav?.userAgent||''),ios=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&Number(nav?.maxTouchPoints)>1);
  if(ios&&/Safari\//.test(ua)&&!/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua))return 'ios-safari';
  return 'unsupported';
}

// Affiche l’invite native mise de côté ; renvoie « accepted », « dismissed » ou « unavailable ».
export async function promptInstall(){
  const event=deferredInstallPrompt;if(!event?.prompt)return 'unavailable';
  deferredInstallPrompt=null;
  try{await event.prompt();const choice=await event.userChoice;notifyInstall();return choice?.outcome==='accepted'?'accepted':'dismissed';}
  catch{notifyInstall();return 'unavailable';}
}

export {REQUIRED_ASSETS};
