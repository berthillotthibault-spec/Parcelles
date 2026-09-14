import {BUILD_ID} from './utils.js';

const REQUIRED_ASSETS = [
  './index.html',
  './base.css','./components.css','./map.css','./responsive.css',
  './app.js','./state.js','./storage.js','./map.js','./import-export.js',
  './shapefile-fallback.js','./zip-lite.js','./sync.js','./utils.js','./runtime.js','./insights.js','./notifications.js','./reports.js','./statistics.js','./remote-ai.js',
  './manifest.webmanifest','./parcelles.svg'
];

function sameOriginUrl(path){return new URL(path, location.href).href;}

export async function verifyDeployment({timeoutMs=7000}={}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  const results=[];
  try{
    for(const path of REQUIRED_ASSETS){
      try{
        const response=await fetch(sameOriginUrl(path),{cache:'no-store',signal:controller.signal});
        const type=response.headers.get('content-type')||'';
        results.push({path,ok:response.ok,status:response.status,type});
      }catch(error){results.push({path,ok:false,status:0,error:error?.message||String(error)});}
    }
  }finally{clearTimeout(timer);}
  return {buildId:BUILD_ID,ok:results.every(x=>x.ok),results,failed:results.filter(x=>!x.ok),checkedAt:Date.now()};
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
  window.dispatchEvent(new CustomEvent('parcelles:ready',{detail:{buildId:BUILD_ID}}));
}

export async function registerAppServiceWorker({onUpdate,onMessage}={}){
  if(!('serviceWorker'in navigator))return {supported:false};
  const registration=await navigator.serviceWorker.register(`./sw.js?build=${encodeURIComponent(BUILD_ID)}`,{updateViaCache:'none'});
  try{await registration.update();}catch{}

  const announceWaiting=worker=>{
    if(!worker)return;
    onUpdate?.({registration,worker,buildId:BUILD_ID,activate:()=>worker.postMessage({type:'SKIP_WAITING'})});
  };
  if(registration.waiting)announceWaiting(registration.waiting);
  registration.addEventListener('updatefound',()=>{
    const worker=registration.installing;
    if(!worker)return;
    worker.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&navigator.serviceWorker.controller)announceWaiting(worker);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(sessionStorage.getItem('parcelles:sw-reloading')==='1')return;
    sessionStorage.setItem('parcelles:sw-reloading','1');
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message',event=>onMessage?.(event.data));
  return {supported:true,registration};
}

export async function clearAppCaches(){
  if(!('caches'in window))return [];
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('parcelles-')).map(key=>caches.delete(key)));
  return keys;
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

export {REQUIRED_ASSETS};
