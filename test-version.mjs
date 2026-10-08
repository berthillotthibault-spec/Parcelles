import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,emptyState,PRE_MIGRATION_BACKUP_LIMIT} from './state.js';
import {StorageService} from './storage.js';
import {APP_VERSION} from './utils.js';
import {makeBackup,validateBackup} from './import-export.js';

// Stockage en mémoire : mêmes copies que IndexedDB, élagage des sauvegardes réel (StorageService.pruneBackups).
function memoryStorage(initial={}){
  const data=new Map(Object.entries(initial).map(([k,v])=>[k,structuredClone(v)])),backups=new Map(),writes=[];
  const read=key=>data.has(key)?structuredClone(data.get(key)):null;
  const storage={
    data,backups,writes,
    async init(){},
    async get(key){return read(key);},
    async getStored(key){return read(key);},
    async set(key,value){writes.push(key);data.set(key,structuredClone(value));},
    async setIfCurrent(key,value){writes.push(key);data.set(key,structuredClone(value));},
    async backupPut(row){backups.set(row.id,structuredClone(row));return row;},
    async backupList(){return [...backups.values()].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));},
    async backupDelete(id){backups.delete(id);},
    async blobDelete(){}
  };
  storage.pruneBackups=StorageService.prototype.pruneBackups.bind(storage);
  return storage;
}
function olderState(version){const state=emptyState();state.version=version;state.tasks=[{id:'t1',title:'Semis',status:'À faire',createdAt:1,updatedAt:1,version:1}];return state;}
function newerState(){const state=emptyState();state.version=APP_VERSION+1;state.futureField={kept:true};state.tasks=[{id:'t1',title:'Semis',status:'À faire',createdAt:1,updatedAt:1,version:1}];return state;}

test('données plus récentes : ni migration ni écriture, lecture seule explicite',async()=>{
  const stored=newerState(),storage=memoryStorage({state:stored}),store=new Store(storage);
  await store.init();
  assert.equal(storage.writes.length,0,'aucune écriture au démarrage');
  assert.deepEqual(storage.data.get('state'),stored,'les données stockées sont intactes');
  assert.equal(store.schemaLock?.storedVersion,APP_VERSION+1);
  assert.equal(store.state.version,APP_VERSION+1,'la version d’origine reste visible (export reconnu comme plus récent)');
  assert.equal(store.state.tasks[0].title,'Semis','les données restent consultables');
  await assert.rejects(store.upsert('tasks',{title:'Nouvelle'}),{name:'SchemaVersionError'});
  await assert.rejects(store.setPreferences({theme:'dark'}),{name:'SchemaVersionError'});
  await assert.rejects(store.replaceState(olderState(APP_VERSION)),{name:'SchemaVersionError'});
  await assert.rejects(store.applyRemote('tasks',{id:'t2',title:'Distante',status:'À faire'}),{name:'SchemaVersionError'});
  assert.equal(storage.writes.length,0);
  assert.equal(storage.backups.size,0,'aucune sauvegarde de migration pour des données plus récentes');
  // On peut quitter l’espace verrouillé sans le réécrire.
  await store.switchWorkspace('ferme-b');
  assert.equal(store.schemaLock,null);
  assert.deepEqual(storage.data.get('state'),stored);
  await store.upsert('tasks',{title:'Ailleurs'});
});

test('restauration d’une sauvegarde plus récente : refusée sans rien modifier',async()=>{
  const storage=memoryStorage({state:olderState(APP_VERSION)}),store=new Store(storage);
  await store.init();
  const before=structuredClone(storage.data.get('state'));
  const raw=await makeBackup(newerState());
  await assert.rejects(validateBackup(raw),{name:'SchemaVersionError'});
  await assert.rejects(store.replaceState(newerState()),{name:'SchemaVersionError'});
  assert.deepEqual(storage.data.get('state'),before);
});

test('un autre onglet enregistre un format plus récent : cet onglet passe en lecture seule sans l’écraser',async()=>{
  const storage=memoryStorage({state:olderState(APP_VERSION)}),store=new Store(storage);
  await store.init();
  const events=[];store.subscribe((_,event)=>events.push(event.kind));
  const stored=newerState();stored.metadata.revision=99;stored.metadata.updatedAt=123;storage.data.set('state',structuredClone(stored));
  await store.reloadFromStorage();
  assert.ok(store.schemaLock);
  assert.ok(events.includes('schema-lock'));
  await assert.rejects(store.upsert('tasks',{title:'X'}),{name:'SchemaVersionError'});
  assert.deepEqual(storage.data.get('state'),stored);
});

test('migration montante : instantané conservé avant, hors élagage quotidien, 2 au plus',async()=>{
  const storage=memoryStorage({state:olderState(APP_VERSION-1)}),store=new Store(storage);
  await store.init();
  const migration=[...storage.backups.values()].filter(row=>row.period==='migration');
  assert.equal(migration.length,1);
  assert.equal(migration[0].fromVersion,APP_VERSION-1);
  assert.equal(migration[0].state.version,APP_VERSION-1,'l’instantané est l’état d’avant migration');
  assert.equal(migration[0].state.tasks[0].title,'Semis');
  assert.equal(storage.data.get('state').version,APP_VERSION,'puis les données sont migrées');
  assert.ok(store.state.journal.some(entry=>entry.type==='migration'&&entry.details?.backupId===migration[0].id));
  // L’élagage quotidien ne touche pas aux instantanés de migration.
  await storage.pruneBackups({daily:0,weekly:0,monthly:0});
  assert.equal([...storage.backups.values()].filter(row=>row.period==='migration').length,1);
  // Au-delà de deux, les plus anciens sont élagués.
  for(const version of [APP_VERSION-3,APP_VERSION-2,1]){
    storage.data.set('state',olderState(version));
    await new Promise(resolve=>setTimeout(resolve,2));
    await new Store(storage).init();
  }
  const kept=[...storage.backups.values()].filter(row=>row.period==='migration');
  assert.equal(kept.length,PRE_MIGRATION_BACKUP_LIMIT);
  // Données à jour : pas d’instantané supplémentaire.
  const count=storage.backups.size;await new Store(storage).init();
  assert.equal(storage.backups.size,count);
});

test('sauvegardes anciennes (v1 à v'+APP_VERSION+') : restaurées et migrées',async()=>{
  for(let version=1;version<=APP_VERSION;version++){
    const {data}=await validateBackup(await makeBackup(olderState(version)));
    assert.equal(data.version,APP_VERSION);
    assert.equal(data.tasks[0].title,'Semis');
  }
});
