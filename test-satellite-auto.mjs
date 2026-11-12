// Actualisation automatique quotidienne des indices NDVI (satellite-ui.js, autoRefresh).
// Aucun réseau réel : fetch, navigator, window et document sont simulés.
import test from 'node:test';
import assert from 'node:assert/strict';

const nav={onLine:true,connection:{saveData:false}};
Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true,writable:true});
const listeners={};
globalThis.window={addEventListener:(type,fn)=>{(listeners[type]||=[]).push(fn);}};
const fakeEl=()=>({hidden:false,innerHTML:'',before(){},isConnected:false});
globalThis.document={querySelector:()=>null,createElement:fakeEl,addEventListener(){}};
globalThis.PARCELLES_SATELLITE_ENDPOINT='https://satellite.example.test';

const {createSatelliteUI}=await import('./satellite-ui.js');
const {NDVI_REFRESH_KEY,NDVI_CONCURRENCY}=await import('./ndvi-map.js');

const square={type:'Polygon',coordinates:[[[4.80,45.70],[4.81,45.70],[4.81,45.71],[4.80,45.71],[4.80,45.70]]]};

function setup({preferences={},writable=true,user={uid:'u1',getIdToken:async()=>'jeton'},parcels=1,status=200,stamps={}}={}){
  nav.onLine=true;nav.connection={saveData:false};
  const calls=[],toasts=[],idles=[],kv=new Map([[NDVI_REFRESH_KEY,stamps]]);
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return{ok:status===200,status,headers:{get:()=>null},json:async()=>({series:[]})};};
  const data={preferences,parcelles:Array.from({length:parcels},(_,i)=>({id:'p'+i,nom:'Parcelle '+i,geometry:square}))};
  const subs=[];const store={snapshot:()=>data,subscribe:fn=>subs.push(fn),workspaceContext:()=>({key:'local'}),storage:{get:async k=>kv.get(k),set:async(k,v)=>{kv.set(k,v);}},tabReadOnly:writable?null:'lecture seule'};
  const sync={user};
  const ui=createSatelliteUI({store,sync,map:{setNdviData(){},clearSatelliteOverlay(){}},openParcel(){},showMap(){},observe(){},modal(){},closeModal(){},
    toast:(message,type)=>toasts.push({message,type}),writable:()=>writable,idle:fn=>idles.push(fn)});
  return{ui,calls,toasts,idles,kv,data,sync,notify:()=>subs.forEach(fn=>fn()),setWritable:v=>{writable=v;store.tabReadOnly=v?null:'lecture seule';}};
}
// Attend la fin de service.init() puis exécute les tâches différées (autoRefresh au démarrage).
async function boot(env){
  for(let i=0;i<20&&!env.idles.length;i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(env.idles.length,'autoRefresh planifié via idle à la fin de init');
  const pending=env.idles.splice(0);for(const fn of pending)await fn();
}

test('un seul appel quand toutes les conditions sont réunies, sans toast de succès', async()=>{
  const env=setup();await boot(env);
  assert.equal(env.calls.length,1);
  assert.deepEqual(env.toasts,[]);
  assert.ok(env.kv.get(NDVI_REFRESH_KEY)[JSON.stringify(['local','u1'])],'tampon du jour enregistré');
  assert.equal(await env.ui.autoRefresh(),null,'pas de seconde tentative le même jour');
  assert.equal(env.calls.length,1);
});

test('aucun appel en mode économie de données', async()=>{
  const env=setup();nav.connection={saveData:true};await boot(env);
  assert.equal(env.calls.length,0);assert.equal(env.ui.autoBlocker(),'save-data');
});

test('aucun appel hors ligne', async()=>{
  const env=setup();nav.onLine=false;await boot(env);
  assert.equal(env.calls.length,0);assert.equal(env.ui.autoBlocker(),'blocked');
});

test('aucun appel si la préférence ndviAutoRefresh vaut false (absente = vrai)', async()=>{
  const env=setup({preferences:{ndviAutoRefresh:false}});await boot(env);
  assert.equal(env.calls.length,0);assert.equal(env.ui.autoBlocker(),'preference');
});

test('aucun appel dans un onglet en lecture seule', async()=>{
  const env=setup({writable:false});await boot(env);
  assert.equal(env.calls.length,0);assert.equal(env.ui.autoBlocker(),'read-only');
});

test('onglet redevenu écrivain (« Utiliser ici ») : actualisation retentée sans attendre la reconnexion', async()=>{
  const env=setup({writable:false});await boot(env);
  assert.equal(env.calls.length,0);
  env.notify();assert.equal(env.idles.length,0,'toujours lecture seule : rien de planifié');
  env.setWritable(true);env.notify();
  assert.equal(env.idles.length,1,'autoRefresh planifié');
  for(const fn of env.idles.splice(0))await fn();
  assert.equal(env.calls.length,1);
  env.notify();assert.equal(env.idles.length,0,'pas de nouvelle planification sans changement de rôle');
});

test('aucun appel si le rafraîchissement global a déjà eu lieu aujourd’hui', async()=>{
  const env=setup({stamps:{[JSON.stringify(['local','u1'])]:Date.now()}});await boot(env);
  assert.equal(env.calls.length,0);assert.equal(env.ui.autoBlocker(),'blocked');
});

test('aucun appel sans parcelle ni sans compte cloud ; la connexion cloud relance', async()=>{
  const none=setup({parcels:0});await boot(none);
  assert.equal(none.calls.length,0);assert.equal(none.ui.autoBlocker(),'no-parcel');
  const env=setup({user:null});await boot(env);
  assert.equal(env.calls.length,0);
  env.sync.user={uid:'u1',getIdToken:async()=>'jeton'};
  await env.ui.autoRefresh();
  assert.equal(env.calls.length,1);
});

test('retour du réseau : relance planifiée sur window online', async()=>{
  const env=setup();nav.onLine=false;await boot(env);
  assert.equal(env.calls.length,0);
  nav.onLine=true;for(const fn of listeners.online||[])fn();
  for(const fn of env.idles.splice(0))await fn();
  assert.equal(env.calls.length,1);
});

test('refus d’autorisation : un toast d’erreur, pas de boucle', async()=>{
  const env=setup({status:403,parcels:NDVI_CONCURRENCY+3});await boot(env);
  const first=env.calls.length;
  assert.ok(first>=1&&first<=NDVI_CONCURRENCY,'la file s’arrête au premier refus');
  assert.equal(env.toasts.length,1);assert.equal(env.toasts[0].type,'error');
  assert.match(env.toasts[0].message,/autoris/);
  assert.equal(await env.ui.autoRefresh(),null);
  assert.equal(env.calls.length,first,'pas de nouvelle tentative le même jour');
});

test('refreshAll manuel garde son toast de succès, silent le supprime', async()=>{
  const manual=setup({preferences:{ndviAutoRefresh:false}});await boot(manual);
  await manual.ui.refreshAll();
  assert.equal(manual.toasts.length,1);assert.equal(manual.toasts[0].type,'success');
  const quiet=setup({preferences:{ndviAutoRefresh:false}});await boot(quiet);
  await quiet.ui.refreshAll({silent:true});
  assert.equal(quiet.calls.length,1);assert.deepEqual(quiet.toasts,[]);
});

test('connexion cloud détectée au changement d’état (sync.user devenu non nul)', async()=>{
  const env=setup({user:null});await boot(env);
  assert.equal(env.calls.length,0);
  env.sync.user={uid:'u2',getIdToken:async()=>'jeton'};env.notify();
  assert.equal(env.idles.length,1,'autoRefresh planifié');
  for(const fn of env.idles.splice(0))await fn();
  assert.equal(env.calls.length,1);
  env.notify();assert.equal(env.idles.length,0,'pas de relance sans changement de compte');
});

test('aucun appel en mode démonstration (parcelles fictives)', async()=>{
  const env=setup();env.data.metadata={demo:true};await boot(env);
  assert.equal(env.calls.length,0);assert.equal(env.ui.autoBlocker(),'demo');
});

test('tampon écrit par un autre onglet depuis le chargement : pas de nouvel appel', async()=>{
  const env=setup();nav.onLine=false;await boot(env);
  env.kv.set(NDVI_REFRESH_KEY,{[JSON.stringify(['local','u1'])]:Date.now()});
  nav.onLine=true;
  assert.equal(await env.ui.autoRefresh(),null);
  assert.equal(env.calls.length,0);
});
