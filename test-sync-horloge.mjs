// Synchronisation fondée sur l’heure du serveur (serverUpdatedAt), avec un faux Firestore en mémoire :
// deux appareils dont les horloges divergent, transition depuis l’ancien curseur, conflits et fusion automatique.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './state.js';

const {SyncService}=await import(process.env.PARCELLES_SYNC_MODULE||'./sync.js');
const MIN=60000,WS='ws1',realNow=Date.now.bind(Date);
if(!navigator.onLine)Object.defineProperty(navigator,'onLine',{value:true,configurable:true});

// ---------- Faux Firestore (sous-ensemble utilisé par sync.js) ----------
class Ts{constructor(ms){this.ms=ms;}toMillis(){return this.ms;}static fromMillis(ms){return new Ts(ms);}}
const SERVER_TS={serverTimestamp:true};
const plain=value=>value instanceof Ts?value.ms:value;
const copy=value=>value instanceof Ts?new Ts(value.ms):Array.isArray(value)?value.map(copy):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])):value;
const resolve=(value,at)=>value===SERVER_TS?new Ts(at):Array.isArray(value)?value.map(v=>resolve(v,at)):value&&typeof value==='object'&&!(value instanceof Ts)?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,resolve(v,at)])):value;
function snapshot(id,data){return {id,exists:data!==undefined,data:()=>data===undefined?undefined:copy(data)};}
class FakeDb{
  constructor(){this.docs=new Map();this.reads=0;this.lastCommit=0;this.serverWrites=0;}
  // Heure du serveur : horloge réelle, strictement croissante d’une écriture à l’autre.
  commitTime(){const at=Math.max(realNow(),this.lastCommit+1);this.lastCommit=at;return at;}
  collection(name){return new FakeQuery(this,name);}
}
class FakeDocRef{
  constructor(db,path){this.db=db;this.path=path;this.id=path.split('/').pop();}
  collection(name){return new FakeQuery(this.db,`${this.path}/${name}`);}
  async get(){this.db.reads++;return snapshot(this.id,this.db.docs.get(this.path));}
  async set(data,{merge=false}={}){const at=this.db.commitTime(),value=resolve(data,at);if(Object.values(data).includes(SERVER_TS))this.db.serverWrites++;this.db.docs.set(this.path,merge?{...(this.db.docs.get(this.path)||{}),...value}:value);}
  async delete(){this.db.docs.delete(this.path);}
}
class FakeQuery{
  constructor(db,path,options={}){this.db=db;this.path=path;this.o={filters:[],order:null,limit:null,after:null,...options};}
  with(change){return new FakeQuery(this.db,this.path,{...this.o,...change});}
  doc(id=`auto${Math.random().toString(36).slice(2)}`){return new FakeDocRef(this.db,`${this.path}/${id}`);}
  async add(data){const ref=this.doc();await ref.set(data);return ref;}
  where(field,op,value){return this.with({filters:[...this.o.filters,{field,op,value}]});}
  orderBy(field,dir='asc'){return this.with({order:{field,dir}});}
  limit(n){return this.with({limit:n});}
  startAfter(snap){return this.with({after:snap});}
  async get(){
    const prefix=`${this.path}/`;
    let rows=[...this.db.docs.entries()].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,d])=>({id:p.slice(prefix.length),d}));
    for(const {field,op,value} of this.o.filters){if(op!=='>')throw new Error(`opérateur non simulé : ${op}`);rows=rows.filter(r=>r.d[field]!==undefined&&r.d[field]!==null&&plain(r.d[field])>plain(value));}
    const key=r=>this.o.order?plain(r.d[this.o.order.field]):r.id;
    if(this.o.order)rows=rows.filter(r=>r.d[this.o.order.field]!==undefined);
    rows.sort((a,b)=>(key(a)<key(b)?-1:key(a)>key(b)?1:a.id<b.id?-1:a.id>b.id?1:0)*(this.o.order?.dir==='desc'?-1:1));
    if(this.o.after){const k=this.o.order?plain(this.o.after.data()[this.o.order.field]):this.o.after.id,id=this.o.after.id;rows=rows.filter(r=>key(r)>k||(key(r)===k&&r.id>id));}
    if(this.o.limit)rows=rows.slice(0,this.o.limit);
    this.db.reads+=Math.max(1,rows.length);
    return {empty:rows.length===0,docs:rows.map(r=>snapshot(r.id,r.d))};
  }
}
const fakeFirebase={firestore:{FieldValue:{serverTimestamp:()=>SERVER_TS},Timestamp:Ts}};

// ---------- Appareils ----------
function memoryStorage(){const data=new Map();return {data,async init(){},async get(k){return data.has(k)?structuredClone(data.get(k)):null;},async getStored(k){return this.get(k);},async set(k,v){data.set(k,structuredClone(v));},async setIfCurrent(k,v){data.set(k,structuredClone(v));},async backupPut(){},async pruneBackups(){},async blobDelete(){},async blobGet(){return null;}};}
async function withClock(offset,fn){const previous=Date.now;Date.now=()=>realNow()+offset;try{return await fn();}finally{Date.now=previous;}}
function cloud(){
  const db=new FakeDb();
  db.docs.set(`workspaces/${WS}`,{name:'Ferme',ownerUid:'A'});
  db.docs.set(`workspaces/${WS}/members/A`,{uid:'A',role:'owner'});
  db.docs.set(`workspaces/${WS}/members/B`,{uid:'B',role:'editor'});
  return db;
}
async function device(db,name,offset=0){
  const store=new Store(memoryStorage());
  await withClock(offset,async()=>{await store.init();await store.setPreferences({syncEnabled:true,workspaceId:WS,syncAutoMerge:true});});
  const sync=new SyncService(store);
  Object.assign(sync,{db,firebase:fakeFirebase,user:{uid:name,email:`${name.toLowerCase()}@ex.fr`},deviceId:`dev-${name}`,status:{configured:true,connected:true,message:''}});
  return {name,store,sync,run:fn=>withClock(offset,fn),syncNow:()=>withClock(offset,()=>sync.sync({force:true}))};
}
const task=(dev,id)=>dev.store.get('tasks',id,{includeDeleted:true});
const remote=(db,id)=>db.docs.get(`workspaces/${WS}/data/tasks__${id}`);
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('écriture : serverUpdatedAt posé par le serveur, updatedAt reste la date de l’appareil',async()=>{
  const db=cloud(),b=await device(db,'B',-10*MIN);
  await b.run(()=>b.store.upsert('tasks',{id:'t1',title:'Clôture'}));
  await b.syncNow();
  const doc=remote(db,'t1');
  assert.ok(doc.serverUpdatedAt instanceof Ts);
  assert.ok(Math.abs(doc.serverUpdatedAt.ms-realNow())<5000,'heure serveur');
  assert.ok(realNow()-doc.updatedAt>9*MIN,'heure de l’appareil (en retard)');
});

test('appareil en retard de 10 min : sa nouvelle saisie et sa modification ne sont plus perdues',async()=>{
  const db=cloud(),a=await device(db,'A'),b=await device(db,'B',-10*MIN);
  await a.run(()=>a.store.upsert('tasks',{id:'t1',title:'Clôture',note:''}));
  await a.syncNow();await b.syncNow();
  assert.equal(task(b,'t1')?.title,'Clôture');
  await pause(5);
  // A synchronise encore : son ancien curseur (horloge de A) dépasse désormais tout ce que B datera.
  await a.syncNow();
  await pause(5);
  // B (horloge en retard) modifie t1 et crée t2 : leurs dates sont « dans le passé » pour A.
  await b.run(()=>b.store.upsert('tasks',{...task(b,'t1'),note:'Piquets changés'}));
  await b.run(()=>b.store.upsert('tasks',{id:'t2',title:'Abreuvoir'}));
  await b.syncNow();
  const datedBefore=remote(db,'t1').updatedAt<task(a,'t1').updatedAt;
  await a.syncNow();
  assert.equal(task(a,'t2')?.title,'Abreuvoir','nouvelle saisie de B récupérée');
  assert.equal(task(a,'t1')?.note,'Piquets changés','modification de B appliquée');
  assert.equal(a.store.list('syncConflicts').length,0);
  assert.ok(datedBefore,'la modification de B était bien datée avant la copie de A');
});

test('appareil en avance de 10 min : il ne peut plus écraser sans le voir une modification faite entre-temps',async()=>{
  const db=cloud(),a=await device(db,'A'),b=await device(db,'B',10*MIN);
  await a.run(()=>a.store.upsert('tasks',{id:'t1',title:'Clôture',note:'',parcelId:''}));
  await a.syncNow();await b.syncNow();
  await pause(5);
  // A modifie la note ; B (en avance, lastSyncAt dans le futur) modifie un autre champ sans avoir récupéré A.
  await a.run(()=>a.store.upsert('tasks',{...task(a,'t1'),note:'Urgent'}));
  await a.syncNow();
  await b.run(()=>b.store.upsert('tasks',{...task(b,'t1'),parcelId:'p1'}));
  await b.syncNow();
  const final=decodePayload(remote(db,'t1'));
  assert.equal(final.note,'Urgent','la modification de A est conservée');
  assert.equal(final.parcelId,'p1','celle de B aussi (fusion automatique)');
  await a.syncNow();
  assert.deepEqual([task(a,'t1').note,task(a,'t1').parcelId],['Urgent','p1']);
});
function decodePayload(doc){return doc.payload;}

test('vrai conflit (même champ) : toujours détecté, jamais écrasé en silence',async()=>{
  const db=cloud(),a=await device(db,'A'),b=await device(db,'B',10*MIN);
  await a.run(()=>a.store.upsert('tasks',{id:'t1',title:'Clôture'}));
  await a.syncNow();await b.syncNow();
  await pause(5);
  await a.run(()=>a.store.upsert('tasks',{...task(a,'t1'),title:'Clôture nord'}));
  await a.syncNow();
  await b.run(()=>b.store.upsert('tasks',{...task(b,'t1'),title:'Clôture sud'}));
  const result=await b.syncNow();
  assert.equal(result.conflicts,1);
  assert.equal(decodePayload(remote(db,'t1')).title,'Clôture nord','la version cloud de A n’est pas écrasée');
  assert.equal(b.store.list('syncConflicts').length,1);
});

test('ses propres écritures ne sont jamais prises pour des conflits',async()=>{
  const db=cloud(),a=await device(db,'A');
  await a.run(()=>a.store.upsert('tasks',{id:'t1',title:'Un'}));
  await a.syncNow();
  for(const title of ['Deux','Trois']){await a.run(()=>a.store.upsert('tasks',{...task(a,'t1'),title}));const r=await a.syncNow();assert.equal(r.conflicts,0);assert.equal(r.merged,0);}
  assert.equal(decodePayload(remote(db,'t1')).title,'Trois');
});

test('transition : documents sans serverUpdatedAt → pull complet une seule fois, puis curseur serveur',async()=>{
  const db=cloud(),a=await device(db,'A');
  // Documents écrits par une ancienne version (pas de serverUpdatedAt) ; t-old a été manqué autrefois (date trop ancienne).
  const legacy=(id,title,updatedAt)=>db.docs.set(`workspaces/${WS}/data/tasks__${id}`,{entityType:'tasks',entityId:id,payload:{id,title,status:'À faire',createdAt:updatedAt,updatedAt,version:1},payloadEncoding:'nested-arrays-v1',version:1,updatedAt,deletedAt:null,modifiedBy:'B',modifiedEmail:'',deviceId:'dev-old',build:'ancien',action:'create'});
  legacy('t-old','Manquée autrefois',realNow()-60*MIN);
  legacy('t-new','Récente',realNow()-1000);
  await a.run(()=>a.store.mutate('ancien curseur',state=>{state.metadata.syncCursors={[WS]:realNow()-30*MIN};state.metadata.lastSyncAt=realNow()-30*MIN;},{queue:false,bypassPermissions:true}));
  await a.syncNow();
  assert.equal(task(a,'t-old')?.title,'Manquée autrefois','rattrapée par le pull complet');
  assert.equal(task(a,'t-new')?.title,'Récente');
  const cursorAfterTransition=a.store.state.metadata.syncServerCursors[WS];
  assert.ok(cursorAfterTransition>=1);
  // Un appareil pas encore à jour écrit encore sans serverUpdatedAt : l’ancien curseur le récupère toujours.
  await pause(5);legacy('t-legacy','Ancienne version',realNow());
  const reads=db.reads;
  await a.syncNow();
  assert.equal(task(a,'t-legacy')?.title,'Ancienne version');
  assert.ok(db.reads-reads<10,`plus de pull complet (${db.reads-reads} lectures)`);
});

test('décalage d’horloge estimé et conservé pour le Diagnostic',async()=>{
  const db=cloud(),b=await device(db,'B',-10*MIN);
  await b.syncNow();
  const skew=b.store.state.metadata.clockSkew;
  assert.ok(skew,'mesure enregistrée');
  assert.ok(Math.abs(skew.deviceOffsetMs+10*MIN)<2000,`≈ −10 min (${skew.deviceOffsetMs} ms)`);
});

test('sans SDK serveur (ancien comportement) : curseur historique seul, aucune erreur',async()=>{
  const db=cloud(),a=await device(db,'A'),b=await device(db,'B');
  for(const dev of [a,b])dev.sync.firebase={firestore:{}};
  await a.run(()=>a.store.upsert('tasks',{id:'t1',title:'Sans heure serveur'}));
  await a.syncNow();await b.syncNow();
  assert.equal(remote(db,'t1').serverUpdatedAt,undefined);
  assert.equal(task(b,'t1')?.title,'Sans heure serveur');
});

test('rôle sans droit d’écriture sur ce type : la version du serveur est appliquée, sans écriture refusée ni échec',async()=>{
  const db=cloud();db.docs.set(`workspaces/${WS}/members/C`,{uid:'C',role:'operator'});
  const a=await device(db,'A'),c=await device(db,'C');
  await a.run(()=>a.store.upsert('parcelles',{id:'p1',nom:'Les Noues',surfaceHa:3}));
  await a.syncNow();await c.syncNow();await pause(5);await c.syncNow();
  // Version divergente arrivée au serveur, datée avant la copie de C et sans numéro de version supérieur.
  const doc=db.docs.get(`workspaces/${WS}/data/parcelles__p1`),local=c.store.get('parcelles','p1');
  await pause(5);
  db.docs.set(`workspaces/${WS}/data/parcelles__p1`,{...doc,payload:{...doc.payload,nom:'Les Noues (corrigé)',updatedAt:local.updatedAt-60000,version:local.version},updatedAt:local.updatedAt-60000,serverUpdatedAt:new Ts(db.commitTime()),modifiedBy:'A'});
  const result=await c.syncNow();
  assert.equal(c.store.get('parcelles','p1').nom,'Les Noues (corrigé)');
  assert.equal(db.docs.get(`workspaces/${WS}/data/parcelles__p1`).modifiedBy,'A','l’opérateur n’a rien réécrit');
  assert.equal(result.conflicts,0);
});

// n° 134 : avec une base mémorisée (store « syncBase »), deux champs différents modifiés sur deux appareils ne font plus de conflit.
function withSyncBase(dev){const bases=new Map();Object.assign(dev.store.storage,{async syncBaseGet(k){return bases.has(k)?structuredClone(bases.get(k)):null;},async syncBasePut(k,v){bases.set(k,structuredClone(v));}});dev.bases=bases;return dev;}
test('fusion à trois voies : champs différents → fusion ; même champ → conflit avec choix limité à ce champ',async()=>{
  const db=cloud(),a=withSyncBase(await device(db,'A')),b=withSyncBase(await device(db,'B'));
  await a.run(()=>a.store.upsert('tasks',{id:'t9',title:'Clôture',note:'Pré bas',priority:'Normale'}));
  await a.syncNow();await b.syncNow();
  assert.ok(b.bases.size>0,'base mémorisée au premier pull');
  await pause(5);await a.run(()=>a.store.upsert('tasks',{...task(a,'t9'),title:'Clôture électrique'}));await a.syncNow();
  await pause(5);await b.run(()=>b.store.upsert('tasks',{...task(b,'t9'),note:'Pré haut'}));
  const r=await b.syncNow();
  assert.equal(r.conflicts,0);
  assert.equal(task(b,'t9').title,'Clôture électrique');assert.equal(task(b,'t9').note,'Pré haut');
  await a.syncNow();assert.equal(task(a,'t9').note,'Pré haut');assert.equal(task(a,'t9').title,'Clôture électrique');
  // Même champ des deux côtés : conflit, en mode trois voies, sur ce seul champ.
  await pause(5);await a.run(()=>a.store.upsert('tasks',{...task(a,'t9'),priority:'Haute'}));await a.syncNow();
  await pause(5);await b.run(()=>b.store.upsert('tasks',{...task(b,'t9'),priority:'Basse',note:'Pré haut, côté route'}));
  const r2=await b.syncNow();assert.equal(r2.conflicts,1);
  const c=b.store.list('syncConflicts').find(x=>x.status==='open');
  assert.deepEqual(c.conflictFields,['priority']);assert.equal(c.mergeMode,'three-way');assert.equal(c.autoFields.note,'local');
  assert.equal(task(b,'t9').priority,'Basse','rien n’est écrasé en attendant le choix');
});
