import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from './state.js';
import {compareHistoryDesc,buildHistoryEntry,describeEntry,diffEntities,historyKey,historyRowsToPrune,revertEntity,stripHeavy} from './history.js';

function memoryStorage({failHistory=false}={}){
  const data=new Map(),history=[];
  const read=key=>data.has(key)?structuredClone(data.get(key)):null;
  return {
    data,history,
    async init(){},async get(key){return read(key);},async getStored(key){return read(key);},
    async set(key,value){data.set(key,structuredClone(value));},
    async setIfCurrent(key,value,isCurrent){if(!isCurrent(read(key))){const e=new Error('stale');e.name='StaleStateError';throw e;}data.set(key,structuredClone(value));},
    async backupPut(){},async pruneBackups(){},async blobDelete(){},
    async historyAdd(rows){if(failHistory)throw new Error('QuotaExceededError');history.push(...structuredClone(rows));},
    async historyList(key){return history.filter(r=>r.key===key).sort(compareHistoryDesc);},
    async historyPrune(){return 0;},
  };
}

test('différences : « Dose 120 → 140 L/ha », champs techniques ignorés',()=>{
  const before={id:'w1',type:'Désherbage',dose:120,doseUnit:'L/ha',updatedAt:1,version:1};
  const after={...before,dose:140,updatedAt:2,version:2};
  assert.deepEqual(diffEntities(before,after),[{field:'dose',from:120,to:140}]);
  const entry=buildHistoryEntry({type:'interventions',before,after,by:'paul@ferme.fr',at:Date.UTC(2026,8,12)});
  assert.equal(describeEntry(entry,after),'Dose 120 L/ha → 140 L/ha');
  assert.equal(entry.key,historyKey('local','interventions','w1'));
  assert.equal(buildHistoryEntry({type:'interventions',before:null,after}).action,'create');
});

test('géométrie jamais copiée en entier : seulement signalée comme modifiée',()=>{
  const ring=Array.from({length:500},(_,i)=>[5+i/1e4,46]);
  const before={id:'p1',nom:'Les Noues',surfaceHa:11.3,geometry:{type:'Polygon',coordinates:[ring]}};
  const after={...before,surfaceHa:11.5,geometry:{type:'Polygon',coordinates:[[...ring,[6,47]]]}};
  const entry=buildHistoryEntry({type:'parcelles',before,after});
  assert.equal('geometry' in entry.before,false);
  assert.deepEqual(entry.omitted,['geometry']);
  assert.deepEqual(entry.diff.find(c=>c.field==='geometry'),{field:'geometry',changed:true});
  assert.ok(JSON.stringify(entry).length<2000);
  assert.equal(stripHeavy({id:'x',photo:'a'.repeat(5000)}).omitted[0],'photo');
});

test('retour à une version : champs ajoutés depuis vidés, géométrie actuelle conservée',()=>{
  const current={id:'p1',nom:'Nouveau',product:'X',geometry:{type:'Point',coordinates:[1,2]},version:4,updatedAt:9};
  const target={id:'p1',nom:'Ancien',version:2};
  const next=revertEntity(current,target,['geometry']);
  assert.equal(next.nom,'Ancien');assert.equal(next.product,null);
  assert.deepEqual(next.geometry,current.geometry);
  assert.equal('version' in next,false);
});

test('plafonds : 50 versions par fiche et 90 jours',()=>{
  const at=Date.now(),rows=Array.from({length:60},(_,i)=>({id:`h${i}`,at:at-i*1000}));
  rows.push({id:'old',at:at-91*86400000});
  const pruned=historyRowsToPrune(rows,{at});
  assert.equal(pruned.length,11);assert.ok(pruned.includes('old'));assert.ok(!pruned.includes('h0'));
});

test('Store : création, modification, corbeille et restauration historisées avec la valeur d’avant',async()=>{
  const storage=memoryStorage(),store=new Store(storage);await store.init();store.historyActor=()=>'paul@ferme.fr';
  const w=await store.upsert('interventions',{parcelId:'p',type:'Désherbage',date:'2026-09-12',status:'Terminé',dose:120,doseUnit:'L/ha'});
  await store.upsert('interventions',{...w,dose:140});
  await store.upsert('interventions',{...store.get('interventions',w.id)}); // réenregistrement identique : rien de neuf
  await store.remove('interventions',w.id);await store.restore('interventions',w.id);
  const rows=await storage.historyList(historyKey('local','interventions',w.id));
  assert.deepEqual(rows.map(r=>r.action).reverse(),['create','update','delete','restore']);
  const update=rows.find(r=>r.action==='update');
  assert.equal(update.before.dose,120);assert.equal(update.by,'paul@ferme.fr');
  assert.equal(store.recentChanges.length,4);
  // L’historique reste hors de l’état synchronisé.
  assert.equal(JSON.stringify(storage.data.get('state')).includes('"history"'),false);
});

test('Store : un historique en échec ne casse jamais l’enregistrement',async()=>{
  const storage=memoryStorage({failHistory:true}),store=new Store(storage);await store.init();
  const warn=console.warn;console.warn=()=>{};
  try{const t=await store.upsert('tasks',{title:'Clôture'});assert.equal(storage.data.get('state').tasks[0].id,t.id);}
  finally{console.warn=warn;}
});

test('Store : lecture seule (autre fenêtre) → ni écriture ni historique',async()=>{
  const storage=memoryStorage(),store=new Store(storage);await store.init();
  store.setTabReadOnly(true);
  await assert.rejects(store.upsert('tasks',{title:'Interdit'}),{name:'TabReadOnlyError'});
  assert.equal(storage.history.length,0);assert.equal(store.recentChanges.length,0);
});

test('Store : version plus récente verrouillée → aucun historique écrit',async()=>{
  const storage=memoryStorage();storage.data.set('state',{version:999,parcelles:[],tasks:[],metadata:{revision:3}});
  const store=new Store(storage);await store.init();
  await assert.rejects(store.upsert('tasks',{title:'Interdit'}),{name:'SchemaVersionError'});
  assert.equal(storage.history.length,0);
});

test('Store : modification distante historisée « Synchronisation », sans entrer dans Ctrl+Z',async()=>{
  const storage=memoryStorage(),store=new Store(storage);await store.init();
  const t=await store.upsert('tasks',{title:'A'});
  await store.applyRemote('tasks',{...store.get('tasks',t.id),title:'B',updatedAt:Date.now()+5});
  const rows=await storage.historyList(historyKey('local','tasks',t.id));
  assert.equal(rows[0].by,'remote');assert.equal(rows[0].before.title,'A');
  assert.equal(store.recentChanges.length,1);
});

test('Annuler : revient à la version d’avant via upsert, ou met une création à la corbeille',async()=>{
  globalThis.document??={addEventListener(){},querySelector(){return null;}};
  const {createHistoryUI}=await import('./history-ui.js');
  const storage=memoryStorage(),store=new Store(storage);await store.init();
  const messages=[],ui=createHistoryUI({store,state:()=>store.state,toast:(m,type,action)=>messages.push({m,action})});
  const w=await store.upsert('interventions',{parcelId:'p',type:'Semis',date:'2026-09-12',status:'Terminé',dose:120});
  ui.savedToast('Travail enregistré.');
  await store.upsert('interventions',{...w,dose:140,product:'Ajouté'});
  ui.savedToast('Travail enregistré.',{label:'Ouvrir',run(){}});
  const last=messages.at(-1);assert.deepEqual(last.action.map(a=>a.label),['Annuler','Ouvrir']);
  await last.action[0].run();
  assert.equal(store.get('interventions',w.id).dose,120);assert.equal(store.get('interventions',w.id).product,null);
  // L’annulation est elle-même synchronisée (file d’attente) et historisée, mais pas reproposée par Ctrl+Z.
  assert.equal((await storage.historyList(historyKey('local','interventions',w.id)))[0].action,'revert');
  await ui.undoLast(); // annule la création
  assert.ok(store.get('interventions',w.id,{includeDeleted:true}).deletedAt);
});

test('fichiers servis : history.js et history-ui.js en cache hors connexion',()=>{
  for(const file of ['sw.js','runtime.js'])for(const name of ['./history.js','./history-ui.js'])assert.ok(readFileSync(new URL(file,import.meta.url),'utf8').includes(`'${name}'`),`${name} absent de ${file}`);
  assert.ok(Number(/const DB_VERSION=(\d+);/.exec(readFileSync(new URL('storage.js',import.meta.url),'utf8'))?.[1])>=3);
});
