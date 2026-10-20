// n° 137 (étape 2) : stockage de l’état par collection dans IndexedDB.
// Doublure IndexedDB en mémoire (fake-indexeddb n’est pas installé) : transactions sérialisées, copie à l’écriture
// et à la lecture, validation à la fin seulement (abandon = rien d’écrit), échec injectable au milieu d’une transaction.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Store,emptyState,stateStamp,planCollections,collectionFingerprints,DEMO_WORKSPACE_ID} from './state.js';
import {StorageService,STATE_FORMAT,stateMetaKey,stateCollectionKey,assembleStateEntries,isStateMarker} from './storage.js';
import {APP_VERSION} from './utils.js';

const compare=(a,b)=>a<b?-1:a>b?1:0;
class FakeKeyRange{
  constructor(lower,upper,lowerOpen=false,upperOpen=false){Object.assign(this,{lower,upper,lowerOpen,upperOpen});}
  static bound(lower,upper,lowerOpen,upperOpen){return new FakeKeyRange(lower,upper,lowerOpen,upperOpen);}
  static upperBound(upper,open){return new FakeKeyRange(undefined,upper,false,open);}
  includes(key){
    if(this.lower!==undefined){const c=compare(key,this.lower);if(c<0||(c===0&&this.lowerOpen))return false;}
    if(this.upper!==undefined){const c=compare(key,this.upper);if(c>0||(c===0&&this.upperOpen))return false;}
    return true;
  }
}
const matches=(query,key)=>query instanceof FakeKeyRange?query.includes(key):compare(query,key)===0;
const sortedKeys=(map,query)=>[...map.keys()].filter(key=>query===undefined||query===null||matches(query,key)).sort(compare);

class FakeTransaction{
  constructor(db,names,mode){
    Object.assign(this,{db,names,mode,queue:[],started:false,finished:false,aborted:false,error:null,oncomplete:null,onerror:null,onabort:null});
    const previous=db.tail;db.tail=new Promise(resolve=>{this.release=resolve;});
    previous.then(()=>setTimeout(()=>this.start(),0));
  }
  objectStore(name){if(!this.names.includes(name))throw new Error(`NotFoundError: ${name}`);return new FakeObjectStore(this,name);}
  request(op){const request={result:undefined,error:null,onsuccess:null,onerror:null};this.queue.push({request,op});return request;}
  start(){
    if(this.aborted){this.release();return;}
    this.started=true;this.staged=new Map(this.names.map(name=>{const live=this.db.stores.get(name).data;return [name,this.mode==='readwrite'?new Map(live):live];}));
    this.pump();
  }
  pump(){
    if(this.aborted)return;
    const next=this.queue.shift();
    if(!next){this.commit();return;}
    setTimeout(()=>{
      if(this.aborted)return;
      try{next.request.result=next.op(this.staged);}
      catch(error){next.request.error=error;next.request.onerror?.({target:next.request,preventDefault(){}});this.error=error;this.abort();return;}
      next.request.onsuccess?.({target:next.request});
      this.pump();
    },0);
  }
  commit(){
    this.finished=true;
    if(this.mode==='readwrite'){for(const [name,data] of this.staged)this.db.stores.get(name).data=data;this.db.commits.push(this.writes||[]);}
    setTimeout(()=>{this.oncomplete?.();this.release();},0);
  }
  abort(){
    if(this.finished||this.aborted)return;
    this.aborted=true;this.staged=null;
    setTimeout(()=>{this.onabort?.();this.release();},0);
  }
}
class FakeObjectStore{
  constructor(tx,name){this.tx=tx;this.name=name;this.keyPath=tx.db.stores.get(name).keyPath;}
  data(staged){return staged.get(this.name);}
  get(key){return this.tx.request(staged=>{const value=this.data(staged).get(key);return value===undefined?undefined:structuredClone(value);});}
  getAll(query){return this.tx.request(staged=>{const data=this.data(staged);return sortedKeys(data,query).map(key=>structuredClone(data.get(key)));});}
  getAllKeys(query){return this.tx.request(staged=>sortedKeys(this.data(staged),query));}
  put(value,key){
    // Copie synchrone, comme IndexedDB (DataCloneError levée tout de suite).
    const copy=structuredClone(value),id=this.keyPath?value[this.keyPath]:key,db=this.tx.db;
    return this.tx.request(staged=>{
      const failure=db.failPut?.(id,this.name);if(failure)throw failure;
      (this.tx.writes||=[]).push(id);this.data(staged).set(id,copy);return id;
    });
  }
  delete(query){return this.tx.request(staged=>{const data=this.data(staged);for(const key of sortedKeys(data,query))data.delete(key);});}
}
function fakeIndexedDB(){
  const databases=new Map();
  return {
    databases,
    open(name,version){
      const request={result:null,error:null,transaction:null};
      setTimeout(()=>{
        let db=databases.get(name);
        if(!db){db={version:0,stores:new Map(),tail:Promise.resolve(),commits:[],failPut:null};databases.set(name,db);}
        const connection={
          objectStoreNames:{contains:store=>db.stores.has(store)},
          createObjectStore(store,{keyPath=null}={}){db.stores.set(store,{data:new Map(),keyPath,indexes:new Set()});return upgradeStore(store);},
          transaction(names,mode='readonly'){return new FakeTransaction(db,Array.isArray(names)?names:[names],mode);},
          close(){},onversionchange:null
        };
        const upgradeStore=store=>{const meta=db.stores.get(store);return {indexNames:{contains:index=>meta.indexes.has(index)},createIndex(index){meta.indexes.add(index);}};};
        request.result=connection;
        if((version||1)>db.version){db.version=version||1;request.transaction={objectStore:upgradeStore,abort(){}};request.onupgradeneeded?.();}
        request.onsuccess?.();
      },0);
      return request;
    }
  };
}

globalThis.window??=globalThis;
globalThis.IDBKeyRange=FakeKeyRange;

// Un « onglet » : son propre StorageService sur la base partagée. Historique et base de fusion hors sujet ici.
async function openTab(idb,{autoBackup=false}={}){
  globalThis.indexedDB=idb;
  const storage=new StorageService();
  storage.hasHistory=()=>false;storage.hasSyncBase=()=>false;
  const store=new Store(storage);
  await store.init();
  if(store.state.preferences.autoBackup!==autoBackup)await store.setPreferences({autoBackup});
  return {storage,store};
}
const appData=idb=>idb.databases.get('parcelles-app').stores.get('app').data;
const dbOf=idb=>idb.databases.get('parcelles-app');
const assembled=(idb,base='state')=>{const data=appData(idb);return assembleStateEntries(base,key=>data.get(key));};
const lastCommit=idb=>dbOf(idb).commits.at(-1)||[];
function realisticState(parcels=60){
  const state=emptyState(),t=Date.now();
  state.preferences.autoBackup=false;
  for(let i=0;i<parcels;i++){
    const ring=[];for(let k=0;k<40;k++){const a=k/40*Math.PI*2;ring.push([4.5+i*0.01+Math.cos(a)*0.003,46.2+Math.sin(a)*0.002]);}ring.push(ring[0]);
    state.parcelles.push({id:`p${i}`,nom:`Parcelle ${i}`,surfaceHa:3+i%7,culture:'Blé tendre',geometry:{type:'Polygon',coordinates:[ring]},createdAt:t,updatedAt:t,version:1});
  }
  state.tasks.push({id:'t0',title:'Clôture',status:'À faire',createdAt:t,updatedAt:t,version:1});
  return state;
}
// Prépare une base contenant l’ancienne forme (un seul objet sous « state »), comme avant cette version.
async function legacyDatabase(state,key='state'){
  const idb=fakeIndexedDB();globalThis.indexedDB=idb;
  const storage=new StorageService();await storage.init();await storage.set(key,state);
  return idb;
}
const titles=state=>(state?.tasks||[]).filter(t=>!t.deletedAt).map(t=>t.title).sort();

test('plan d’écriture : tout sans référence, sinon seulement les collections modifiées (même modifiées sur place)',()=>{
  const state=realisticState(3),full=planCollections(state,null);
  assert.equal(full.changed,null);assert.deepEqual(full.keys,Object.keys(state));
  const reference=collectionFingerprints(state);
  assert.deepEqual(planCollections(state,reference).changed,[]);
  state.parcelles[1].nom='Renommée';state.metadata.updatedAt=1;
  assert.deepEqual(planCollections(state,reference).changed,['parcelles','metadata']);
  assert.equal(planCollections(state,new Map()).changed,null,'référence vide : écriture complète');
});

test('migration de l’ancienne forme : lecture en repli, conversion atomique, ancienne clé retirée, instantané conservé',async()=>{
  const legacy=realisticState(),idb=await legacyDatabase(legacy);
  const before=structuredClone(appData(idb).get('state'));
  const {store,storage}=await openTab(idb);
  assert.equal(store.state.parcelles.length,legacy.parcelles.length);
  assert.deepEqual(store.state.parcelles[5].geometry,legacy.parcelles[5].geometry);
  const data=appData(idb);
  assert.ok(isStateMarker(data.get('state')),'ancienne clé remplacée par un témoin après l’écriture réussie de la nouvelle forme');
  const meta=data.get(stateMetaKey('state'));
  assert.equal(meta.format,STATE_FORMAT);assert.deepEqual(meta.keys,Object.keys(store.state));
  assert.equal(stateStamp(meta),store.persistedStamp);
  assert.equal(JSON.stringify(assembled(idb)),JSON.stringify(store.state),'la nouvelle forme recompose exactement l’état');
  // Retour arrière : l’ancienne forme complète reste restaurable depuis les sauvegardes.
  const backups=await storage.backupList('local'),snapshot=backups.find(row=>row.id.startsWith('pre_collections_'));
  assert.ok(snapshot,'instantané avant conversion');assert.equal(snapshot.period,'migration');
  assert.deepEqual(snapshot.state,before);assert.equal(snapshot.verified,true);
  // Relance : lecture directe de la nouvelle forme, pas de nouvel instantané.
  const second=await openTab(idb);
  assert.equal(JSON.stringify(second.store.state.parcelles),JSON.stringify(store.state.parcelles));
  assert.equal((await storage.backupList('local')).filter(row=>row.id.startsWith('pre_collections_')).length,1);
});

test('conversion impossible (quota) : l’ancienne clé reste intacte et l’application continue sous l’ancienne forme',async()=>{
  const legacy=realisticState(),idb=await legacyDatabase(legacy);
  const quota=Object.assign(new Error('Quota dépassé'),{name:'QuotaExceededError'});
  dbOf(idb).failPut=(key,storeName)=>storeName==='app'&&String(key).startsWith('state/c/')?quota:null;
  const {store}=await openTab(idb);
  assert.ok(appData(idb).has('state'),'ancienne clé conservée');
  assert.equal([...appData(idb).keys()].some(key=>String(key).startsWith('state/')),false,'aucune entrée partielle de la nouvelle forme');
  await store.upsert('tasks',{title:'Pendant le quota'});
  assert.deepEqual(titles(appData(idb).get('state')),['Clôture','Pendant le quota']);
  // Lancement suivant, espace libéré : conversion réussie, rien de perdu.
  dbOf(idb).failPut=null;
  const next=await openTab(idb);
  assert.deepEqual(titles(next.store.state),['Clôture','Pendant le quota']);
  assert.ok(isStateMarker(appData(idb).get('state')));
  assert.deepEqual(titles(assembled(idb)),['Clôture','Pendant le quota']);
});

test('écriture partielle : seules les collections modifiées et la méta sont écrites, dans une seule transaction',async()=>{
  const idb=fakeIndexedDB(),{store}=await openTab(idb);
  await store.replaceState(realisticState(),'Import',{log:false});
  await store.upsert('tasks',{title:'Semis'});
  const written=lastCommit(idb);
  assert.ok(written.includes(stateCollectionKey('state','tasks')));
  assert.ok(written.includes(stateMetaKey('state')));
  assert.ok(!written.includes(stateCollectionKey('state','parcelles')),'les parcelles (géométries) ne sont pas réécrites');
  assert.ok(written.length<=6,`peu d’entrées écrites : ${written.join(', ')}`);
  // Modification sur place d’une fiche existante : détectée.
  await store.mutate('Renommer',state=>{state.parcelles[2].nom='Grand Champ';},{entity:'parcelles',entityId:'p2',queue:false});
  assert.ok(lastCommit(idb).includes(stateCollectionKey('state','parcelles')));
  assert.equal(assembled(idb).parcelles[2].nom,'Grand Champ');
  // Clé de premier niveau disparue : retirée du stockage et de la méta.
  await store.mutate('Nettoyage',state=>{delete state.vetTreatments;},{queue:false});
  assert.equal(appData(idb).has(stateCollectionKey('state','vetTreatments')),false);
  assert.ok(!appData(idb).get(stateMetaKey('state')).keys.includes('vetTreatments'));
  assert.equal(JSON.stringify(assembled(idb)),JSON.stringify(store.state));
});

test('conflit entre onglets : la révision porte sur toutes les collections, la saisie est rejouée sur la version la plus récente',async()=>{
  const idb=fakeIndexedDB(),a=await openTab(idb),b=await openTab(idb);
  await a.store.upsert('tasks',{title:'Saisie A'});
  await a.store.mutate('Parcelle',state=>{state.parcelles.push({id:'pA',nom:'Parcelle A',createdAt:1,updatedAt:1,version:1});},{queue:false});
  // B n’a pas rechargé : sa saisie (autre collection) est refusée puis rejouée sur la version de A.
  await b.store.upsert('interventions',{type:'Semis',date:'2026-04-01',parcelId:'pA',status:'Terminé'});
  const stored=assembled(idb);
  assert.deepEqual(titles(stored),['Saisie A']);
  assert.deepEqual(stored.parcelles.map(p=>p.id),['pA']);
  assert.equal(stored.interventions.length,1);
  assert.equal(JSON.stringify(stored),JSON.stringify(b.store.state),'B a rechargé avant d’écrire');
  // A est maintenant en retard : sa restauration est refusée sans rien écrire.
  const snapshot=structuredClone([...appData(idb)]);
  await assert.rejects(a.store.replaceState({...a.store.snapshot(),tasks:[]},'Restauration'),error=>error.name==='StaleStateError');
  assert.deepEqual([...appData(idb)],snapshot,'aucune collection écrite par l’écriture refusée');
  assert.equal(JSON.stringify(a.store.state),JSON.stringify(stored),'A affiche la version enregistrée');
  // Rechargement : rien à faire tant que l’empreinte ne change pas (seule la méta est lue).
  assert.equal(await a.store.reloadFromStorage(),false);
  await b.store.setPreferences({theme:'dark'});
  assert.equal(await a.store.reloadFromStorage(),true);
  assert.equal(a.store.state.preferences.theme,'dark');
  // Après rechargement, A n’écrit que ce qu’il modifie et rien n’est perdu.
  await a.store.upsert('tasks',{title:'Saisie A2'});
  assert.ok(!lastCommit(idb).includes(stateCollectionKey('state','preferences')));
  assert.equal(assembled(idb).preferences.theme,'dark');
  assert.deepEqual(titles(assembled(idb)),['Saisie A','Saisie A2']);
});

test('échec au milieu de la transaction : rien n’est écrit, l’état en mémoire est rétabli et la suite reste exacte',async()=>{
  const idb=fakeIndexedDB(),{store}=await openTab(idb);
  await store.replaceState(realisticState(),'Import',{log:false});
  const snapshot=structuredClone([...appData(idb)]),stamp=store.persistedStamp;
  // Deuxième écriture de la transaction en échec (la première, la collection tasks, est déjà passée).
  let seen=0;const quota=Object.assign(new Error('Quota dépassé'),{name:'QuotaExceededError'});
  dbOf(idb).failPut=(key,storeName)=>storeName==='app'&&String(key).startsWith('state/')&&++seen===2?quota:null;
  await assert.rejects(store.upsert('tasks',{title:'Perdue ?'}),{name:'QuotaExceededError'});
  assert.deepEqual([...appData(idb)],snapshot,'transaction annulée en entier');
  assert.equal(store.persistedStamp,stamp);
  assert.deepEqual(titles(store.state),['Clôture'],'modification annulée en mémoire');
  dbOf(idb).failPut=null;
  await store.mutate('Parcelle',state=>{state.parcelles[0].nom='Après échec';},{queue:false});
  assert.equal(JSON.stringify(assembled(idb)),JSON.stringify(store.state),'stockage et mémoire identiques après l’échec');
  // Valeur non clonable dans une collection modifiée : refus synchrone, rien d’écrit non plus.
  const before=structuredClone([...appData(idb)]);
  await assert.rejects(store.mutate('Invalide',state=>{state.tasks[0].title='Modifiée';state.tasks[0].fn=()=>1;},{queue:false}),{name:'DataCloneError'});
  assert.deepEqual([...appData(idb)],before);
});

test('espaces de travail : clés séparées, ancienne forme d’un espace migrée, démonstration vidée à la sortie',async()=>{
  const legacyFarm=realisticState(4);legacyFarm.exploitation.nom='Ferme cloud';
  const idb=await legacyDatabase(legacyFarm,'state:workspace:ferme-1');
  const {store,storage}=await openTab(idb);
  await store.upsert('tasks',{title:'Local'});
  await store.switchWorkspace('ferme-1');
  assert.equal(store.storageKey,'state:workspace:ferme-1');
  assert.equal(store.state.exploitation.nom,'Ferme cloud');
  const data=appData(idb);
  assert.ok(isStateMarker(data.get('state:workspace:ferme-1')),'ancienne forme de l’espace convertie');
  assert.ok(data.get(stateMetaKey('state:workspace:ferme-1')));
  await store.upsert('tasks',{title:'Cloud'});
  assert.ok(lastCommit(idb).every(key=>String(key).startsWith('state:workspace:ferme-1/')));
  assert.deepEqual(titles(assembled(idb)),['Local'],'l’espace local est intact');
  assert.deepEqual(titles(assembled(idb,'state:workspace:ferme-1')),['Cloud','Clôture']);
  assert.equal((await storage.breakdown()).workspaceEntries,1);
  // Démonstration : écrite à part, jamais sauvegardée, entièrement retirée à la sortie.
  await store.enterDemo({...emptyState(),tasks:[{id:'d1',title:'Démo',status:'À faire',createdAt:1,updatedAt:1,version:1}],metadata:{...emptyState().metadata,demo:true}});
  assert.equal(store.workspaceId,DEMO_WORKSPACE_ID);
  await store.setPreferences({autoBackup:true});
  await store.upsert('tasks',{title:'Démo 2'});
  assert.ok([...appData(idb).keys()].some(key=>String(key).startsWith('state:workspace:demo/')));
  await store.exitDemo();
  assert.equal(store.workspaceId,'ferme-1');
  assert.equal([...appData(idb).keys()].some(key=>String(key).startsWith('state:workspace:demo')),false,'démonstration vidée');
  assert.equal((await storage.backupList()).some(row=>row.workspaceId===DEMO_WORKSPACE_ID),false);
  assert.deepEqual(titles(store.state),['Cloud','Clôture']);
  await store.upsert('tasks',{title:'Cloud 2'});
  assert.deepEqual(titles(assembled(idb,'state:workspace:ferme-1')),['Cloud','Cloud 2','Clôture']);
});

test('sauvegardes automatiques : toujours l’objet d’état complet',async()=>{
  const idb=fakeIndexedDB(),{store,storage}=await openTab(idb,{autoBackup:true});
  await store.upsert('tasks',{title:'Avec sauvegarde'});
  const rows=await storage.backupList('local');
  assert.deepEqual(rows.map(row=>row.period).sort(),['daily','monthly','weekly']);
  for(const row of rows){assert.deepEqual(Object.keys(row.state).sort(),Object.keys(store.state).sort());assert.equal(row.verified,true);}
  assert.equal(stateStamp(appData(idb).get(stateMetaKey('state'))),store.persistedStamp,'la date de sauvegarde est enregistrée');
});

test('ancienne clé réécrite par une version antérieure (retour arrière) : conservée en instantané puis retirée',async()=>{
  const idb=fakeIndexedDB(),{store,storage}=await openTab(idb);
  await store.upsert('tasks',{title:'Version récente'});
  const older=realisticState(2);older.tasks=[{id:'o1',title:'Saisie de l’ancienne version',status:'À faire',createdAt:1,updatedAt:1,version:1}];
  await storage.set('state',older);
  const next=await openTab(idb);
  assert.deepEqual(titles(next.store.state),['Version récente'],'la nouvelle forme reste la référence');
  assert.ok(isStateMarker(appData(idb).get('state')));
  const shadow=(await storage.backupList('local')).find(row=>row.id.startsWith('pre_legacy_'));
  assert.deepEqual(titles(shadow?.state),['Saisie de l’ancienne version'],'rien de perdu : restaurable');
});

test('retour arrière vers un build antérieur : le témoin sous l’ancienne clé le verrouille en lecture seule',async()=>{
  const idb=await legacyDatabase(realisticState(3)),{store}=await openTab(idb);
  await store.upsert('tasks',{title:'Version récente'});
  const marker=appData(idb).get('state');
  assert.ok(isStateMarker(marker));assert.ok(marker.version>APP_VERSION,'vu comme une version plus récente');
  // Build antérieur : il ne lit que l’ancienne clé (ni readState ni writeState).
  const storage=new StorageService();await storage.init();
  const older=new Store({init:()=>storage.init(),get:key=>storage.get(key),getStored:key=>storage.getStored(key),set:(key,value)=>storage.set(key,value),setIfCurrent:(key,value,isCurrent)=>storage.setIfCurrent(key,value,isCurrent),backupPut:()=>{throw new Error('aucun instantané attendu');},backupList:()=>storage.backupList(),pruneBackups:()=>storage.pruneBackups()});
  await older.init();
  assert.ok(older.schemaLock,'lecture seule au lieu d’une exploitation vide modifiable');
  await assert.rejects(older.upsert('tasks',{title:'Ancien build'}),{name:'SchemaVersionError'});
  assert.deepEqual(appData(idb).get('state'),marker,'témoin jamais réécrit');
  // Ce build ignore le témoin : la nouvelle forme reste la référence, sans instantané parasite.
  const next=await openTab(idb);
  assert.deepEqual(titles(next.store.state),['Clôture','Version récente']);
  assert.equal((await next.storage.backupList('local')).some(row=>row.id.startsWith('pre_legacy_')),false);
});

test('changement d’espace : instantanés de l’ancienne forme et enregistrement suivant par collection',async()=>{
  const farm=realisticState(2);farm.tasks=[{id:'f1',title:'Ferme',status:'À faire',createdAt:1,updatedAt:1,version:1}];
  const idb=await legacyDatabase(farm,'state:workspace:ferme-1'),{store,storage}=await openTab(idb);
  // Ancienne clé réécrite par une version antérieure à côté de la nouvelle forme, sur l’espace non actif.
  await store.switchWorkspace('ferme-1');await store.switchWorkspace('local');
  const older=realisticState(1);older.tasks=[{id:'o1',title:'Saisie de l’ancienne version',status:'À faire',createdAt:1,updatedAt:1,version:1}];
  await storage.set('state:workspace:ferme-1',older);
  await store.switchWorkspace('ferme-1');
  const rows=await storage.backupList('ferme-1');
  assert.ok(rows.some(row=>row.id.startsWith('pre_collections_')),'ancienne forme sauvegardée avant sa conversion');
  assert.deepEqual(titles(rows.find(row=>row.id.startsWith('pre_legacy_'))?.state),['Saisie de l’ancienne version'],'ancienne clé réécrite conservée');
  assert.deepEqual(titles(store.state),['Ferme']);
  // Conversion différée (quota) au lancement, puis réussie au retour sur l’espace : plus d’écriture sous l’ancienne clé.
  const quota=Object.assign(new Error('Quota dépassé'),{name:'QuotaExceededError'});
  const idb2=await legacyDatabase(realisticState(2));
  dbOf(idb2).failPut=(key,storeName)=>storeName==='app'&&String(key).startsWith('state/c/')?quota:null;
  const tab=await openTab(idb2);
  assert.ok(tab.store.legacyOnlyKeys.has('state'));
  dbOf(idb2).failPut=null;
  await tab.store.switchWorkspace('ferme-2');await tab.store.switchWorkspace('local');
  assert.equal(tab.store.legacyOnlyKeys.has('state'),false);
  let reloaded=false;tab.store.subscribe((_,event)=>{if(event?.kind==='external-reload')reloaded=true;});
  await tab.store.upsert('tasks',{title:'Après conversion'});
  assert.equal(reloaded,false);
  assert.deepEqual(titles(assembled(idb2)),['Après conversion','Clôture']);
  assert.ok(isStateMarker(appData(idb2).get('state')));
});

test('repli localStorage : un seul objet, écriture conditionnelle inchangée',async()=>{
  const saved={window:globalThis.window,localStorage:globalThis.localStorage};
  const memory=new Map();
  globalThis.window={};
  globalThis.localStorage={getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key),key:index=>[...memory.keys()][index]??null,get length(){return memory.size;}};
  try{
    const storage=new StorageService(),store=new Store(storage);await store.init();
    assert.equal(storage.usingFallback,true);
    await store.upsert('tasks',{title:'Repli'});
    assert.deepEqual(titles(JSON.parse(memory.get('parcelles:state'))),['Repli']);
    assert.equal([...memory.keys()].some(key=>key.includes('/')),false);
    const other=new Store(new StorageService());await other.init();
    await store.upsert('tasks',{title:'Repli 2'});
    await other.upsert('tasks',{title:'Autre'});
    assert.deepEqual(titles(JSON.parse(memory.get('parcelles:state'))),['Autre','Repli','Repli 2']);
  }finally{globalThis.window=saved.window;globalThis.localStorage=saved.localStorage;}
});

test('rappels du service worker : état recomposé depuis la nouvelle forme',async()=>{
  const idb=fakeIndexedDB(),{store}=await openTab(idb);
  await store.upsert('tasks',{title:'Rappel',dueDate:'2026-10-08'});
  const context={indexedDB:idb};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('./sw-reminders.js',import.meta.url),'utf8'),context);
  const state=await context.ParcellesReminders.readState();
  assert.deepEqual(titles(state),['Rappel']);
  assert.equal(JSON.stringify(state),JSON.stringify(store.state));
});
