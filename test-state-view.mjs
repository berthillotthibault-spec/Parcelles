// Instantané partagé (Store.view) : une copie tant que l'état ne change pas, refaite à chaque modification.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,deepFreeze} from './state.js';

function memoryStorage() { const data = new Map(); return {async init() {}, async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; }, async getStored(k) { return this.get(k); }, async set(k, v) { data.set(k, structuredClone(v)); }, async setIfCurrent(k, v) { data.set(k, structuredClone(v)); }, async backupPut() {}, async pruneBackups() {}, async blobDelete() {}, async blobGet() { return null; }}; }
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));

test('même copie dans la tâche, distincte de l’état réel', async()=>{
  const store=new Store(memoryStorage());await store.init();
  const a=store.view(),b=store.view();
  assert.equal(a,b);assert.notEqual(a,store.state);assert.deepEqual(a,store.state);
  await tick();
  assert.notEqual(store.view(),a,'expire à la tâche suivante');
});

test('refaite après une écriture, le journal ou un changement d’espace', async()=>{
  const store=new Store(memoryStorage());await store.init();
  const before=store.view();
  await store.upsert('parcelles',{nom:'Les Noues'});
  const after=store.view();
  assert.notEqual(after,before);assert.equal(after.parcelles.length,1);
  store.log('test','sans changement de révision');
  assert.equal(store.view().journal[0].message,'sans changement de révision');
  const v=store.view();store.state={...store.state};
  assert.notEqual(store.view(),v,'nouvel objet d’état');
});

test('les écouteurs reçoivent un objet gelé en surface, l’état réel reste modifiable', async()=>{
  const store=new Store(memoryStorage());await store.init();
  let received=null;store.subscribe(data=>{received=data;});
  await store.upsert('parcelles',{nom:'A'});
  assert.ok(Object.isFrozen(received));
  assert.equal(received.parcelles.length,1);
  assert.ok(!Object.isFrozen(store.state));
});

test('gel profond de débogage : toute écriture dans la copie partagée lève une erreur', async()=>{
  const store=new Store(memoryStorage());await store.init();await store.upsert('parcelles',{nom:'A'});
  globalThis.__PARCELLES_FREEZE_VIEWS=true;
  try{
    store.invalidateView();
    const v=store.view();
    assert.throws(()=>{v.parcelles[0].nom='B';},TypeError);
    assert.throws(()=>{v.parcelles.push({});},TypeError);
  }finally{delete globalThis.__PARCELLES_FREEZE_VIEWS;store.invalidateView();}
  assert.equal(deepFreeze(null),null);
});
