// Carte hors ligne : renouvellement des tuiles anciennes et extension aux nouvelles parcelles (chantier A6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AUTO_RENEW_AGE_MS, TILE_REFRESH_AGE_MS, autoRenewDue, fitPlan, planCoverageGap, plannedUrls, tileNeedsRefresh} from './offline-map.js';

const DAY=24*3600*1000,NOW=Date.UTC(2026,10,12,8);
const sq=(x,y,d=0.004)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d*0.7],[x,y+d*0.7],[x,y]]]});
const farm=[{id:'p1',geometry:sq(5.13,46.34)},{id:'p2',geometry:sq(5.136,46.34)}];
const added={id:'p3',geometry:sq(5.2,46.3)};

test('tileNeedsRefresh : en-tête absent, récent, ancien',()=>{
  assert.equal(tileNeedsRefresh(new Headers(),NOW),true,'âge inconnu : traitée comme ancienne');
  assert.equal(tileNeedsRefresh({},NOW),true);
  assert.equal(tileNeedsRefresh(new Headers({'x-parcelles-cached-at':'abc'}),NOW),true);
  assert.equal(tileNeedsRefresh(new Headers({'x-parcelles-cached-at':String(NOW-5*DAY)}),NOW),false);
  assert.equal(tileNeedsRefresh({'x-parcelles-cached-at':String(NOW-29*DAY)},NOW),false);
  assert.equal(tileNeedsRefresh(new Headers({'x-parcelles-cached-at':String(NOW-31*DAY)}),NOW),true);
  assert.equal(tileNeedsRefresh(new Headers({'x-parcelles-cached-at':String(NOW-31*DAY)}),NOW,60*DAY),false);
  assert.equal(TILE_REFRESH_AGE_MS,30*DAY);
});

test('autoRenewDue : au-delà de 90 jours seulement',()=>{
  assert.equal(AUTO_RENEW_AGE_MS,90*DAY);
  assert.equal(autoRenewDue(null,NOW),false);
  assert.equal(autoRenewDue({at:NOW-10*DAY},NOW),false);
  assert.equal(autoRenewDue({at:NOW-91*DAY},NOW),true);
  assert.equal(autoRenewDue({at:NOW-91*DAY},NOW,{maxAgeMs:120*DAY}),false);
});

test('planCoverageGap : une parcelle ajoutée donne des tuiles manquantes',()=>{
  const before=plannedUrls(fitPlan(farm),{layer:'ign-photo'});
  assert.deepEqual(planCoverageGap(before,new Set(before)),[]);
  assert.deepEqual(planCoverageGap(before,before),[]);
  const after=plannedUrls(fitPlan([...farm,added]),{layer:'ign-photo'});
  const gap=planCoverageGap(after,new Set(before));
  assert.ok(gap.length>0&&gap.length<after.length);
  assert.ok(gap.every(url=>!before.includes(url)));
  assert.deepEqual(planCoverageGap(null,new Set()),[]);
});

test('sw.js applique la même règle que offline-map.js',()=>{
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  const body=sw.slice(sw.indexOf('function tileNeedsRefresh('),sw.indexOf('async function refreshTile('));
  const swRule=new Function('TILE_REFRESH_MS',`${body};return tileNeedsRefresh;`)(30*DAY);
  for(const headers of [new Headers(),new Headers({'x-parcelles-cached-at':String(NOW-5*DAY)}),new Headers({'x-parcelles-cached-at':String(NOW-31*DAY)}),{'x-parcelles-cached-at':''}])
    assert.equal(swRule(headers,NOW),tileNeedsRefresh(headers,NOW));
  assert.match(sw,/event\.respondWith\(tileResponse\(req,event\)\)/);
  assert.match(sw,/const TILES=`\$\{PREFIX\}tiles-v1`;/);
});

// ---------- Service worker : tileResponse avec faux caches/fetch ----------
function fakeCache(){
  const store=new Map();
  return {store,async match(url){return store.get(typeof url==='string'?url:url.url)?.clone()||undefined;},async put(url,response){store.set(typeof url==='string'?url:url.url,response);},async keys(){return [...store.keys()].map(url=>({url}));},async delete(url){return store.delete(url);}};
}
const tile=(at,body='old')=>new Response(body,{status:200,headers:{'content-type':'image/jpeg','x-parcelles-cached-at':String(at),'x-parcelles-size':String(body.length)}});
function loadSw({cache,fetchImpl,onLine=true}){
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  const code=sw.slice(sw.indexOf('const TILE_REFRESH_MS='),sw.indexOf('async function coreAssetResponse('));
  const self={navigator:{onLine}};
  return new Function('caches','fetch','self','TILES',`${code};return {tileResponse};`)({open:async()=>cache},fetchImpl,self,'tiles-v1');
}

test('sw tileResponse : tuile ancienne servie puis renouvelée en tâche de fond',async()=>{
  const cache=fakeCache(),url='https://data.geopf.fr/wmts?REQUEST=GetTile&TILEMATRIX=15';
  await cache.put(url,tile(Date.now()-40*DAY));
  const calls=[];const {tileResponse}=loadSw({cache,fetchImpl:async u=>{calls.push(u);return new Response('neuve',{status:200,headers:{'content-type':'image/jpeg'}});}});
  const waits=[];const response=await tileResponse({url},{waitUntil:p=>waits.push(p)});
  assert.equal(await response.text(),'old','le cache est servi tout de suite');
  assert.equal(waits.length,1);await Promise.all(waits);
  assert.deepEqual(calls,[url]);
  const stored=await cache.match(url);assert.equal(await stored.text(),'neuve');
  assert.ok(Date.now()-Number(stored.headers.get('x-parcelles-cached-at'))<5000);
  assert.equal(stored.headers.get('x-parcelles-size'),'5');
});

test('sw tileResponse : tuile récente, hors ligne ou échec réseau, l’ancienne tuile reste',async()=>{
  const url='https://data.geopf.fr/wmts?REQUEST=GetTile&TILEMATRIX=16';
  // Récente : aucun fetch.
  let cache=fakeCache();await cache.put(url,tile(Date.now()-2*DAY));
  let calls=0,waits=[];let sw=loadSw({cache,fetchImpl:async()=>{calls++;return new Response('x');}});
  await sw.tileResponse({url},{waitUntil:p=>waits.push(p)});assert.equal(calls,0);assert.equal(waits.length,0);
  // Hors ligne : aucun fetch.
  cache=fakeCache();await cache.put(url,tile(Date.now()-40*DAY));
  sw=loadSw({cache,onLine:false,fetchImpl:async()=>{calls++;return new Response('x');}});
  await sw.tileResponse({url},{waitUntil:p=>waits.push(p)});assert.equal(calls,0);
  // Échec réseau puis HTTP 500 : l'ancienne tuile est conservée.
  for(const fetchImpl of [async()=>{throw new Error('réseau');},async()=>new Response('err',{status:500})]){
    waits=[];sw=loadSw({cache,fetchImpl});
    await sw.tileResponse({url},{waitUntil:p=>waits.push(p)});await Promise.all(waits);
    assert.equal(await (await cache.match(url)).text(),'old');
  }
});

// ---------- offline-map-ui.js : maybeAutoRenew avec faux navigateur ----------
const store=new Map();
globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.document={querySelector:()=>null,getElementById:()=>null};
globalThis.location={href:'https://exemple.test/Parcelles/'};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true,writable:true});
const uiCache=fakeCache();
globalThis.caches={open:async()=>uiCache,delete:async()=>true};
let fetched=[],hold=null;
globalThis.fetch=async url=>{fetched.push(url);if(hold)await hold;return new Response('tuile',{status:200,headers:{'content-type':'image/jpeg'}});};
const {createOfflineMapUI}=await import('./offline-map-ui.js');

let parcelList=[...farm];const toasts=[];
const ui=createOfflineMapUI({state:()=>({preferences:{}}),active:()=>parcelList,modal(){},toast:(...args)=>toasts.push(args)});
const META='parcelles:offline-map',AUTO='parcelles:offline-map:auto';
function seed({metaAge,tileAge,parcels=farm}){
  uiCache.store.clear();store.clear();fetched=[];toasts.length=0;
  const urls=plannedUrls(fitPlan(parcels,{layer:'ign-plan'}),{layer:'ign-plan'});
  for(const url of urls)uiCache.store.set(url,tile(Date.now()-tileAge,'ancienne'));
  localStorage.setItem(META,JSON.stringify({at:Date.now()-metaAge,layer:'ign-plan',cadastre:false,tiles:urls.length,total:urls.length,bytes:urls.length*8,complete:true}));
  return urls;
}

test('maybeAutoRenew : gardes (pas de méta, saveData, cellular, hors ligne)',async()=>{
  store.clear();
  assert.equal((await ui.maybeAutoRenew({connection:{type:'wifi'}})).reason,'no-meta');
  seed({metaAge:100*DAY,tileAge:100*DAY});
  assert.equal((await ui.maybeAutoRenew({connection:{saveData:true}})).reason,'save-data');
  assert.equal((await ui.maybeAutoRenew({connection:{type:'cellular'}})).reason,'cellular');
  assert.equal((await ui.maybeAutoRenew({connection:{type:'wifi'},online:false})).reason,'offline');
  assert.equal(fetched.length,0);
});

test('maybeAutoRenew : un téléchargement en cours bloque le renouvellement',async()=>{
  seed({metaAge:100*DAY,tileAge:100*DAY});
  let release;hold=new Promise(resolve=>{release=resolve;});
  const running=ui.download({refresh:true,silent:true,layer:'ign-plan',cadastre:false});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ui.isBusy(),true);
  assert.equal((await ui.maybeAutoRenew({connection:{type:'wifi'}})).reason,'busy');
  hold=null;release();await running;
  assert.equal(ui.isBusy(),false);
});

test('maybeAutoRenew : carte de plus de 90 jours, retéléchargement silencieux des tuiles anciennes',async()=>{
  const urls=seed({metaAge:100*DAY,tileAge:100*DAY});
  const result=await ui.maybeAutoRenew({connection:{type:'wifi'}});
  assert.equal(result.started,true);assert.equal(result.trigger,'age');
  assert.equal(fetched.length,urls.length,'toutes les tuiles de plus de 30 jours sont retéléchargées');
  assert.equal(result.fresh,urls.length);assert.equal(result.failed,0);
  assert.equal(toasts.length,0,'aucun toast en mode silencieux');
  const meta=JSON.parse(localStorage.getItem(META));assert.ok(Date.now()-meta.at<5000);assert.equal(meta.layer,'ign-plan');assert.equal(meta.complete,true);
  assert.equal(await (await uiCache.match(urls[0])).text(),'tuile');
  // Au plus une tentative par jour.
  fetched=[];assert.equal((await ui.maybeAutoRenew({connection:{type:'wifi'}})).reason,'recent');assert.equal(fetched.length,0);
});

test('maybeAutoRenew : une parcelle ajoutée étend la carte, sans retélécharger les tuiles récentes',async()=>{
  const before=seed({metaAge:5*DAY,tileAge:5*DAY});
  parcelList=[...farm];
  assert.equal((await ui.maybeAutoRenew({connection:{type:'wifi'}})).reason,'up-to-date');
  store.delete(AUTO);
  const after=[...farm,added];
  const gap=planCoverageGap(plannedUrls(fitPlan(after,{layer:'ign-plan'}),{layer:'ign-plan'}),new Set(before));
  const result=await ui.maybeAutoRenew({parcels:after,connection:{}});
  assert.equal(result.trigger,'gap');
  assert.deepEqual([...fetched].sort(),[...gap].sort(),'seules les tuiles manquantes sont demandées');
  assert.equal(toasts.length,0);
});

test('download refresh : un échec garde l’ancienne tuile et ne compte pas comme indisponible',async()=>{
  const urls=seed({metaAge:100*DAY,tileAge:100*DAY});
  const saved=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('réseau');};
  try{
    const result=await ui.download({refresh:true,silent:true,layer:'ign-plan',cadastre:false});
    assert.equal(result.failed,0);assert.equal(result.fresh,0);
    assert.equal(await (await uiCache.match(urls[0])).text(),'ancienne');
  }finally{globalThis.fetch=saved;}
});

// ---------- Revue adverse A6 : un test par bug corrigé ----------
test('revue : refresh raté, la carte garde sa date (pas faussement « à jour »)',async()=>{
  seed({metaAge:100*DAY,tileAge:100*DAY});
  const before=JSON.parse(localStorage.getItem(META)).at;
  const saved=globalThis.fetch;globalThis.fetch=async()=>new Response('err',{status:503});
  try{
    const result=await ui.download({refresh:true,silent:true,layer:'ign-plan',cadastre:false});
    assert.ok(result.stale>0);
    assert.equal(JSON.parse(localStorage.getItem(META)).at,before,'la date de la carte ne doit pas être remise à aujourd’hui');
  }finally{globalThis.fetch=saved;}
  // Refresh réussi : la date avance.
  await ui.download({refresh:true,silent:true,layer:'ign-plan',cadastre:false});
  assert.ok(Date.now()-JSON.parse(localStorage.getItem(META)).at<5000);
});

test('revue : horloge reculée, la garde de 24 h ne bloque pas indéfiniment',async()=>{
  seed({metaAge:100*DAY,tileAge:100*DAY});
  localStorage.setItem(AUTO,String(Date.now()+30*DAY));
  const result=await ui.maybeAutoRenew({connection:{type:'wifi'}});
  assert.equal(result.started,true);assert.equal(result.trigger,'age');
});

test('revue : sw sert la tuile en cache même si waitUntil échoue',async()=>{
  const cache=fakeCache(),url='https://data.geopf.fr/wmts?REQUEST=GetTile&TILEMATRIX=14';
  await cache.put(url,tile(Date.now()-40*DAY));
  let network=0;const {tileResponse}=loadSw({cache,fetchImpl:async()=>{network++;return new Response('neuve');}});
  const response=await tileResponse({url},{waitUntil(){throw new Error('InvalidStateError');}});
  assert.equal(await response.text(),'old');
});
