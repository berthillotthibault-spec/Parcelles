import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,stateStamp} from './state.js';
import {createTabCoordinator} from './tab-coordinator.js';

// Stockage partagé entre deux « onglets » : même sémantique que StorageService (copie à chaque lecture,
// écriture conditionnelle atomique).
function sharedStorage(){
  const data=new Map(),writes=[];
  const read=key=>data.has(key)?structuredClone(data.get(key)):null;
  return {
    data,writes,
    async init(){},
    async get(key){return read(key);},
    async getStored(key){return read(key);},
    async set(key,value){writes.push(key);data.set(key,structuredClone(value));},
    async setIfCurrent(key,value,isCurrent){if(!isCurrent(read(key))){const error=new Error('stale');error.name='StaleStateError';throw error;}writes.push(key);data.set(key,structuredClone(value));},
    async backupPut(){},async pruneBackups(){},async blobDelete(){}
  };
}
const titles=state=>state.tasks.filter(t=>!t.deletedAt).map(t=>t.title).sort();

test('deux onglets : une saisie dans B n’efface plus celle de A (révision vérifiée à l’écriture)',async()=>{
  const storage=sharedStorage(),a=new Store(storage),b=new Store(storage);
  await a.init();await b.init();
  await a.upsert('tasks',{title:'Saisie A'});
  // B n’a pas rechargé : son état en mémoire ignore la saisie de A.
  assert.deepEqual(titles(b.state),[]);
  await b.upsert('tasks',{title:'Saisie B'});
  assert.deepEqual(titles(storage.data.get('state')),['Saisie A','Saisie B']);
  assert.deepEqual(titles(b.state),['Saisie A','Saisie B']);
  // A reprend à son tour la version de B avant d’écrire.
  await a.mutate('Préférence',state=>{state.preferences.theme='dark';},{queue:false,entity:'preferences'});
  const stored=storage.data.get('state');
  assert.deepEqual(titles(stored),['Saisie A','Saisie B']);
  assert.equal(stored.preferences.theme,'dark');
});

test('saisie groupée concurrente : rejouée une fois sur la version la plus récente',async()=>{
  const storage=sharedStorage(),a=new Store(storage),b=new Store(storage);
  await a.init();await b.init();
  await a.upsert('tasks',{title:'A1'});
  await b.upsertMany('tasks',[{title:'B1'},{title:'B2'}],{label:'Tâches'});
  assert.deepEqual(titles(storage.data.get('state')),['A1','B1','B2']);
});

test('restauration concurrente : refusée avec un message clair, l’état affiché est rechargé',async()=>{
  const storage=sharedStorage(),a=new Store(storage),b=new Store(storage);
  await a.init();await b.init();
  await a.upsert('tasks',{title:'Saisie A'});
  const events=[];b.subscribe((_,event)=>events.push(event.kind));
  await assert.rejects(b.replaceState({...b.snapshot(),tasks:[]},'Restauration'),error=>error.name==='StaleStateError'&&/autre fenêtre/.test(error.message));
  assert.deepEqual(titles(storage.data.get('state')),['Saisie A']);
  assert.deepEqual(titles(b.state),['Saisie A']);
  assert.ok(events.includes('external-reload'));
});

test('lecture seule d’onglet : aucune écriture, même pour la synchronisation',async()=>{
  const storage=sharedStorage(),store=new Store(storage);await store.init();
  const before=storage.writes.length,state=JSON.stringify(store.state);
  store.setTabReadOnly(true);
  await assert.rejects(store.upsert('tasks',{title:'Bloquée'}),error=>error.name==='TabReadOnlyError'&&/Utiliser ici/.test(error.message));
  await assert.rejects(store.mutate('Sync',s=>{s.metadata.lastSyncAt=1;},{bypassPermissions:true,queue:false}),{name:'TabReadOnlyError'});
  await assert.rejects(store.upsertMany('tasks',[{title:'X'}]),{name:'TabReadOnlyError'});
  await assert.rejects(store.replaceState(store.snapshot()),{name:'TabReadOnlyError'});
  await assert.rejects(store.switchWorkspace('autre'),{name:'TabReadOnlyError'});
  assert.equal(storage.writes.length,before);
  assert.equal(JSON.stringify(store.state),state);
  store.setTabReadOnly(null);
  await store.upsert('tasks',{title:'Autorisée'});
  assert.deepEqual(titles(storage.data.get('state')),['Autorisée']);
});

test('rechargement depuis une autre fenêtre : seulement si l’empreinte a changé',async()=>{
  const storage=sharedStorage(),a=new Store(storage),b=new Store(storage);
  await a.init();await b.init();
  const events=[];b.subscribe((_,event)=>events.push(event));
  assert.equal(await b.reloadFromStorage(),false);
  await a.upsert('tasks',{title:'Nouvelle'});
  assert.equal(await b.reloadFromStorage(),true);
  assert.deepEqual(titles(b.state),['Nouvelle']);
  assert.equal(events.at(-1).entity,'state');
  assert.equal(b.persistedStamp,stateStamp(storage.data.get('state')));
  assert.equal(await b.reloadFromStorage(),false);
});

test('ancien stockage sans écriture conditionnelle : comportement inchangé',async()=>{
  const storage=sharedStorage();delete storage.setIfCurrent;delete storage.getStored;
  const store=new Store(storage);await store.init();
  await store.upsert('tasks',{title:'OK'});
  assert.deepEqual(titles(storage.data.get('state')),['OK']);
  const announced=[];store.onPersisted=info=>announced.push(info);
  await store.upsert('tasks',{title:'OK 2'});
  assert.equal(announced.length,1);assert.equal(announced[0].storageKey,'state');
});

test('stamp : null sans données, stable pour d’anciennes sauvegardes sans métadonnées',()=>{
  assert.equal(stateStamp(null),null);
  assert.equal(stateStamp({}),'0:');
  assert.equal(stateStamp({metadata:{revision:'4',updatedAt:12}}),'4:12');
});

// Gestionnaire de verrous minimal (ifAvailable, steal, signal) pour simuler plusieurs onglets.
function fakeLocks(){
  let holder=null;const queue=[];
  const abort=()=>Object.assign(new Error('aborted'),{name:'AbortError'});
  function grant(entry){
    holder=entry;
    Promise.resolve().then(()=>entry.cb({name:'parcelles-writer'})).then(value=>{if(holder===entry){holder=null;entry.resolve(value);const next=queue.shift();if(next)grant(next);}},error=>{if(holder===entry){holder=null;entry.reject(error);}});
  }
  return {request(name,options,cb){return new Promise((resolve,reject)=>{
    const entry={cb,resolve,reject};
    if(options.steal){if(holder){const old=holder;holder=null;old.reject(abort());}grant(entry);return;}
    if(options.ifAvailable&&(holder||queue.length)){Promise.resolve(cb(null)).then(resolve,reject);return;}
    if(options.signal)options.signal.addEventListener('abort',()=>{const i=queue.indexOf(entry);if(i>=0){queue.splice(i,1);reject(abort());}});
    if(holder)queue.push(entry);else grant(entry);
  });}};
}
function fakeChannels(){
  const members=new Map();
  return class{constructor(name){this.name=name;if(!members.has(name))members.set(name,new Set());members.get(name).add(this);}
    postMessage(data){for(const other of members.get(this.name))if(other!==this)queueMicrotask(()=>other.onmessage?.({data:structuredClone(data)}));}
    close(){members.get(this.name).delete(this);}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));

test('verrou d’écriture : un seul onglet écrivain, « Utiliser ici » et reprise à la fermeture',async()=>{
  const locks=fakeLocks(),Channel=fakeChannels(),roles={a:[],b:[]},messages={a:[],b:[]};
  const a=createTabCoordinator({locks,BroadcastChannelImpl:Channel,tabId:'a',onRoleChange:r=>roles.a.push(r),onMessage:m=>messages.a.push(m)});
  const b=createTabCoordinator({locks,BroadcastChannelImpl:Channel,tabId:'b',onRoleChange:r=>roles.b.push(r),onMessage:m=>messages.b.push(m)});
  assert.equal(await a.start(),'writer');
  assert.equal(await b.start(),'reader');
  a.post({type:'persisted',storageKey:'state',revision:3});await tick();
  assert.equal(messages.b.length,1);assert.equal(messages.b[0].revision,3);assert.equal(messages.a.length,0);
  await b.takeOver();await tick();
  assert.equal(b.role,'writer');assert.equal(a.role,'reader');
  assert.equal(messages.a.at(-1).type,'takeover');
  // B se ferme : A, qui attendait, redevient écrivain seul.
  b.close();await tick();
  assert.equal(a.role,'writer');
  assert.deepEqual(roles.a,['writer','reader','writer']);
  assert.deepEqual(roles.b,['reader','writer']);
  a.close();
});

test('repli : sans Web Locks (ou verrous en erreur), chaque onglet reste écrivain',async()=>{
  const plain=createTabCoordinator({locks:null,BroadcastChannelImpl:null});
  assert.equal(await plain.start(),'writer');assert.equal(plain.lockSupported,false);assert.equal(plain.post({type:'x'}),false);
  const broken=createTabCoordinator({locks:{request:()=>Promise.reject(Object.assign(new Error('refusé'),{name:'SecurityError'}))},BroadcastChannelImpl:null});
  const warn=console.warn;console.warn=()=>{};
  try{assert.equal(await broken.start(),'writer');}finally{console.warn=warn;}
  assert.equal(broken.lockSupported,false);
});
