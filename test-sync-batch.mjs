// n° 137 étape 1 : écritures moins coûteuses pendant une synchronisation.
// Statuts de file appliqués par lot, documents reçus appliqués par lot, notification partagée en lecture seule.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './state.js';
import {SyncService,SYNC_WRITE_BATCH} from './sync.js';

const WS='ws1',realNow=Date.now.bind(Date);
if(!navigator.onLine)Object.defineProperty(navigator,'onLine',{value:true,configurable:true});

// ---------- Faux Firestore minimal (même principe que test-sync-horloge.mjs) ----------
class Ts{constructor(ms){this.ms=ms;}toMillis(){return this.ms;}static fromMillis(ms){return new Ts(ms);}}
const SERVER_TS={serverTimestamp:true};
const plain=value=>value instanceof Ts?value.ms:value;
const copy=value=>value instanceof Ts?new Ts(value.ms):Array.isArray(value)?value.map(copy):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])):value;
const resolve=(value,at)=>value===SERVER_TS?new Ts(at):Array.isArray(value)?value.map(v=>resolve(v,at)):value&&typeof value==='object'&&!(value instanceof Ts)?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,resolve(v,at)])):value;
const snap=(id,data)=>({id,exists:data!==undefined,data:()=>data===undefined?undefined:copy(data)});
class FakeDb{constructor(){this.docs=new Map();this.lastCommit=0;this.failWrites=new Set();}commitTime(){const at=Math.max(realNow(),this.lastCommit+1);this.lastCommit=at;return at;}collection(name){return new FakeQuery(this,name);}}
class FakeDocRef{
  constructor(db,path){this.db=db;this.path=path;this.id=path.split('/').pop();}
  collection(name){return new FakeQuery(this.db,`${this.path}/${name}`);}
  async get(){return snap(this.id,this.db.docs.get(this.path));}
  async set(data,{merge=false}={}){if(this.db.failWrites.has(this.id))throw new Error('réseau indisponible');const value=resolve(data,this.db.commitTime());this.db.docs.set(this.path,merge?{...(this.db.docs.get(this.path)||{}),...value}:value);}
}
class FakeQuery{
  constructor(db,path,o={}){this.db=db;this.path=path;this.o={filters:[],order:null,limit:null,after:null,...o};}
  with(c){return new FakeQuery(this.db,this.path,{...this.o,...c});}
  doc(id=`auto${Math.random().toString(36).slice(2)}`){return new FakeDocRef(this.db,`${this.path}/${id}`);}
  async add(data){const ref=this.doc();await ref.set(data);return ref;}
  where(field,op,value){return this.with({filters:[...this.o.filters,{field,op,value}]});}
  orderBy(field,dir='asc'){return this.with({order:{field,dir}});}
  limit(n){return this.with({limit:n});}
  startAfter(s){return this.with({after:s});}
  async get(){
    const prefix=`${this.path}/`;
    let rows=[...this.db.docs.entries()].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,d])=>({id:p.slice(prefix.length),d}));
    for(const {field,value} of this.o.filters)rows=rows.filter(r=>r.d[field]!==undefined&&r.d[field]!==null&&plain(r.d[field])>plain(value));
    const key=r=>this.o.order?plain(r.d[this.o.order.field]):r.id;
    rows.sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:a.id<b.id?-1:a.id>b.id?1:0);
    if(this.o.after){const k=plain(this.o.after.data()[this.o.order.field]),id=this.o.after.id;rows=rows.filter(r=>key(r)>k||(key(r)===k&&r.id>id));}
    if(this.o.limit)rows=rows.slice(0,this.o.limit);
    return {empty:rows.length===0,docs:rows.map(r=>snap(r.id,r.d))};
  }
}
const fakeFirebase={firestore:{FieldValue:{serverTimestamp:()=>SERVER_TS},Timestamp:Ts}};

// Stockage en mémoire qui compte les enregistrements complets de l’état et peut en refuser un.
function memoryStorage(){
  const data=new Map();
  return {data,writes:0,failNext:0,async init(){},async get(k){return data.has(k)?structuredClone(data.get(k)):null;},async getStored(k){return this.get(k);},
    async set(k,v){data.set(k,structuredClone(v));},
    async setIfCurrent(k,v){if(this.failNext>0){this.failNext--;throw new Error('disque plein');}this.writes++;data.set(k,structuredClone(v));},
    async backupPut(){},async pruneBackups(){},async blobDelete(){},async blobGet(){return null;}};
}
function cloud(){const db=new FakeDb();db.docs.set(`workspaces/${WS}`,{name:'Ferme',ownerUid:'A'});db.docs.set(`workspaces/${WS}/members/A`,{uid:'A',role:'owner'});db.docs.set(`workspaces/${WS}/members/B`,{uid:'B',role:'owner'});return db;}
async function device(db,name,prefs={}){
  const storage=memoryStorage(),store=new Store(storage);
  await store.init();await store.setPreferences({syncEnabled:true,workspaceId:WS,syncAutoMerge:true,autoBackup:false,securityAuditEnabled:false,...prefs});
  const sync=new SyncService(store);
  Object.assign(sync,{db,firebase:fakeFirebase,user:{uid:name,email:`${name.toLowerCase()}@ex.fr`},member:{role:'owner'},deviceId:`dev-${name}`,status:{configured:true,connected:true,message:''}});
  let notifications=0;store.subscribe(()=>{notifications++;});
  return {store,storage,sync,notifications:()=>notifications};
}
const tasks=n=>Array.from({length:n},(_,i)=>({id:`t${String(i).padStart(2,'0')}`,title:`Tâche ${i}`,status:'À faire'}));
const opFor=(store,id)=>store.snapshot().queue.find(q=>q.entityId===id);

test('60 opérations poussées : au plus 3 enregistrements et 3 notifications, toutes marquées envoyées',async()=>{
  const a=await device(cloud(),'A');
  await a.store.upsertMany('tasks',tasks(60));
  assert.equal(a.store.snapshot().queue.filter(q=>q.status==='pending').length,60);
  const writes=a.storage.writes,notes=a.notifications();
  const result=await a.sync.pushPending();
  assert.equal(result.sent,60);assert.equal(result.errors,0);
  assert.ok(a.storage.writes-writes<=3,`enregistrements : ${a.storage.writes-writes}`);
  assert.ok(a.notifications()-notes<=3,`notifications : ${a.notifications()-notes}`);
  assert.equal(SYNC_WRITE_BATCH,25);
  assert.ok(a.store.snapshot().queue.every(q=>q.status==='done'),'tout est envoyé');
  assert.equal(a.sync.queueStatusBuffer,null,'tampon libéré');
});

test('mélange envoyé / conflit / échec : statuts corrects, échec au milieu d’un lot sans perte des autres',async()=>{
  const db=cloud(),a=await device(db,'A',{syncAutoMerge:false});
  await a.store.upsertMany('tasks',tasks(30));
  // t05 modifié à distance depuis le dernier pull : conflit ; t12 et t20 : écriture refusée par le réseau.
  db.docs.set(`workspaces/${WS}/data/tasks__t05`,{entityType:'tasks',entityId:'t05',payload:{id:'t05',title:'Version distante',status:'À faire',updatedAt:realNow()+1000,version:4},version:4,updatedAt:realNow()+1000,deletedAt:null,modifiedBy:'B',deviceId:'dev-B'});
  db.failWrites.add('tasks__t12');db.failWrites.add('tasks__t20');
  const result=await a.sync.pushPending();
  assert.deepEqual({sent:result.sent,conflicts:result.conflicts,errors:result.errors},{sent:27,conflicts:1,errors:2});
  assert.equal(opFor(a.store,'t05').status,'conflict');
  assert.equal(a.store.list('syncConflicts').filter(c=>c.entityId==='t05'&&c.status==='open').length,1);
  for(const id of ['t12','t20']){const op=opFor(a.store,id);assert.equal(op.status,'pending');assert.equal(op.attempts,1);assert.match(op.lastError,/réseau indisponible/);assert.ok(op.nextRetryAt>realNow());}
  for(const id of ['t00','t11','t13','t29'])assert.equal(opFor(a.store,id).status,'done',id);
  // Nouvelle tentative : seul l’échec repasse, sans toucher aux autres.
  db.failWrites.clear();
  for(const id of ['t12','t20']){const op=opFor(a.store,id);await a.store.mutate('test',state=>{state.queue.find(q=>q.id===op.id).nextRetryAt=0;},{queue:false,log:false});}
  const again=await a.sync.pushPending();
  assert.equal(again.sent,2);assert.equal(opFor(a.store,'t12').status,'done');assert.equal(opFor(a.store,'t05').status,'conflict');
});

test('échec d’enregistrement au milieu d’un lot : statuts retentés en fin de boucle, rien de perdu',async()=>{
  const a=await device(cloud(),'A');
  await a.store.upsertMany('tasks',tasks(60));
  a.storage.failNext=1; // le premier lot de 25 n’est pas enregistré (retour arrière de l’état en mémoire)
  await assert.rejects(a.sync.pushPending(),/disque plein/);
  const queue=a.store.snapshot().queue;
  assert.equal(queue.length,60,'aucune opération perdue');
  assert.equal(queue.filter(q=>q.status==='done').length,25,'le lot refusé est réenregistré en fin de boucle');
  assert.equal(queue.filter(q=>q.status==='pending').length,35,'le reste attend le prochain envoi');
  assert.equal(a.sync.queueStatusBuffer,null);
  const stored=a.storage.data.get('state');assert.equal(stored.queue.filter(q=>q.status==='done').length,25,'statuts bien enregistrés');
  const next=await a.sync.pushPending();
  assert.equal(next.sent,35);assert.ok(a.store.snapshot().queue.every(q=>q.status==='done'));
});

test('pull de 60 documents : application groupée par lots, modification locale en attente protégée',async()=>{
  const db=cloud(),b=await device(db,'B'),a=await device(db,'A',{syncAutoMerge:false});
  await b.store.upsertMany('tasks',tasks(60));
  await b.sync.pushPending();
  // A modifie t07 localement avant d’avoir reçu la version distante : conflit, jamais écrasé.
  await a.store.upsert('tasks',{id:'t07',title:'Version locale',status:'À faire'});
  const writes=a.storage.writes,notes=a.notifications();
  const result=await a.sync.pullRemote();
  assert.equal(result.pulled,59);assert.equal(result.conflicts,1);
  assert.equal(result.changes.length,59);
  // 3 lots (25+25+9) et la fiche de conflit : 4 enregistrements au plus, au lieu de 60.
  assert.ok(a.storage.writes-writes<=4,`enregistrements : ${a.storage.writes-writes}`);
  assert.ok(a.notifications()-notes<=4,`notifications : ${a.notifications()-notes}`);
  assert.equal(a.store.list('tasks').length,60);
  assert.equal(a.store.get('tasks','t07').title,'Version locale');
  assert.equal(a.store.get('tasks','t42').title,'Tâche 42');
  assert.equal(opFor(a.store,'t07').status,'pending');
});

test('applyRemoteMany : expectedQueueId vérifié par élément, élément invalide écarté sans bloquer le lot',async()=>{
  const a=await device(cloud(),'A');
  await a.store.upsert('tasks',{id:'x1',title:'Locale',status:'À faire'});
  const op=opFor(a.store,'x1');
  const results=await a.store.applyRemoteMany([
    {type:'tasks',entity:{id:'x1',title:'Distante',status:'À faire'},expectedQueueId:'autre'},
    {type:'tasks',entity:{id:'x2',title:'Nouvelle',status:'À faire'},expectedQueueId:null},
    {type:'inconnu',entity:{id:'z'}},
  ]);
  assert.deepEqual(results.map(r=>r.applied),[false,true,false]);
  assert.match(results[2].error.message,/Type inconnu/);
  assert.equal(a.store.get('tasks','x1').title,'Locale');assert.equal(a.store.get('tasks','x2').title,'Nouvelle');
  const ok=await a.store.applyRemoteMany([{type:'tasks',entity:{id:'x1',title:'Distante',status:'À faire'},expectedQueueId:op.id}]);
  assert.equal(ok[0].applied,true);assert.equal(a.store.get('tasks','x1').title,'Distante');
});

test('notify : une seule copie partagée, gelée en surface, distincte de l’état interne',async()=>{
  const a=await device(cloud(),'A');
  const seen=[];a.store.subscribe(data=>seen.push(data));a.store.subscribe(data=>seen.push(data));
  await a.store.upsert('tasks',{id:'n1',title:'Une',status:'À faire'});
  assert.equal(seen.length,2);assert.equal(seen[0],seen[1],'même objet pour tous les abonnés');
  assert.ok(Object.isFrozen(seen[0]));assert.notEqual(seen[0],a.store.state);
  assert.throws(()=>{'use strict';seen[0].tasks=[];},TypeError);
  assert.equal(seen[0].tasks.find(t=>t.id==='n1').title,'Une');
});
