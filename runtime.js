import {BUILD_ID} from './utils.js';

const REQUIRED_ASSETS = [
  './index.html',
  './tokens.css','./base.css','./components.css','./map.css','./shell.css','./screens.css','./responsive.css','./accessibility.css',
  './app.js','./ui.js','./platform.js','./integrations.js','./intelligence.js','./security.js','./diagnostics.js','./state.js','./storage.js','./map.js','./import-export.js',
  './shapefile-fallback.js','./zip-lite.js','./sync.js','./permissions.js','./utils.js','./runtime.js','./performance.js','./field-ops.js','./traceability.js','./native.js','./automations.js','./insights.js','./notifications.js','./reports.js','./statistics.js','./pilotage.js','./remote-ai.js',
  './manifest.webmanifest','./parcelles.svg','./config.js'
  ,'./vendor/leaflet.min.css','./vendor/leaflet.min.js','./vendor/xlsx.full.min.js','./vendor/shp.min.js'
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

export {REQUIRED_ASSETS};
