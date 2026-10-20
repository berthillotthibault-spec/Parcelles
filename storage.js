import {APP_VERSION} from './utils.js';

const DB_NAME='parcelles-app';
// v3 : ajout de l’object store « history » (historique des fiches, hors de l’état synchronisé).
// v4 : ajout de l’object store « syncBase » (dernière version synchronisée de chaque fiche, fusion à trois voies).
const DB_VERSION=4;

function requestAsPromise(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaction annulée'));});}
function safeLocalGet(key){try{return localStorage.getItem(key);}catch(error){console.warn(`[Parcelles] localStorage inaccessible : ${key}`,error);return null;}}
function safeLocalSet(key,value){try{localStorage.setItem(key,value);return true;}catch(error){console.warn(`[Parcelles] écriture localStorage impossible : ${key}`,error);return false;}}
function storageBusyError(message){const error=new Error(message);error.name='StorageBusyError';return error;}
// Une autre fenêtre a enregistré l’état depuis sa dernière lecture ici : l’écriture est refusée plutôt que d’effacer ses saisies.
export function staleStateError(){const error=new Error('Parcelles a été modifié dans une autre fenêtre. Les données affichées ont été rechargées : recommencez votre dernière action.');error.name='StaleStateError';return error;}

// n° 137 (étape 2) : état rangé par collection dans le store « app ».
// - <base>/meta : {format,keys,version,metadata:{revision,updatedAt},savedAt} (révision lisible sans tout relire) ;
// - <base>/c/<nom> : une entrée par clé de premier niveau de l’état (parcelles, interventions, preferences…).
// <base> seul (« state », « state:workspace:<id> ») est l’ancienne forme : lue en repli tant que la méta manque,
// remplacée par un témoin dans la transaction qui écrit pour la première fois la nouvelle forme (jamais avant).
export const STATE_FORMAT='parcelles-collections-v1';
export function stateMetaKey(base){return `${base}/meta`;}
export function stateCollectionKey(base,name){return `${base}/c/${name}`;}
export function isStateMeta(value){return Boolean(value&&typeof value==='object'&&value.format===STATE_FORMAT&&Array.isArray(value.keys));}
// Témoin laissé sous l’ancienne clé après la conversion : un build antérieur (qui ne lit que cette clé) y voit des
// données d’une version plus récente et se verrouille en lecture seule, au lieu d’afficher une exploitation vide puis
// d’écrire par-dessus. Ce build ne le lit jamais comme des données.
export function isStateMarker(value){return Boolean(value&&typeof value==='object'&&value.storageMarker===STATE_FORMAT);}
export function stateMarkerFor(state){const meta=state?.metadata||{};return {storageMarker:STATE_FORMAT,version:Math.max(APP_VERSION,Math.floor(Number(state?.version))||0)+1,metadata:{revision:meta.revision??0,updatedAt:meta.updatedAt??null},savedAt:Date.now()};}
function legacyValue(value){return value===undefined||isStateMarker(value)?null:value;}
export function stateMetaFor(state,keys=Object.keys(state||{})){const meta=state?.metadata||{};return {format:STATE_FORMAT,keys:[...keys],version:state?.version??null,metadata:{revision:meta.revision??0,updatedAt:meta.updatedAt??null},savedAt:Date.now()};}
// Toutes les entrées de la nouvelle forme d’un espace (« state/… » n’inclut jamais « state:workspace:… »).
function stateRange(base){return IDBKeyRange.bound(`${base}/`,`${base}/￿`);}
// Recompose l’état complet à partir d’entrées déjà lues (secours, rappels du service worker).
export function assembleStateEntries(base,read){
  const meta=read(stateMetaKey(base));
  if(!isStateMeta(meta))return legacyValue(read(base));
  const value={};
  for(const name of meta.keys){const part=read(stateCollectionKey(base,name));if(part!==undefined)value[name]=part;}
  return value;
}

async function jsonChecksum(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

export class StorageService{
  constructor({openTimeoutMs=8000}={}){this.db=null;this.memory=new Map();this.usingFallback=false;this.openTimeoutMs=openTimeoutMs;}

  async init(){
    if(!('indexedDB'in window)){this.usingFallback=true;return;}
    try{
      this.db=await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(error,db)=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);if(error)reject(error);else resolve(db);};
        const timer=setTimeout(()=>finish(storageBusyError('Le stockage local ne répond pas. Fermez les autres onglets Parcelles puis rechargez l’application.')),this.openTimeoutMs);
        let request;try{request=indexedDB.open(DB_NAME,DB_VERSION);}catch(error){finish(error);return;}
        request.onupgradeneeded=()=>{
          if(settled){request.transaction?.abort();return;}
          const db=request.result;
          if(!db.objectStoreNames.contains('app'))db.createObjectStore('app');
          if(!db.objectStoreNames.contains('blobs'))db.createObjectStore('blobs');
          if(!db.objectStoreNames.contains('backups'))db.createObjectStore('backups',{keyPath:'id'});
          // Ajout seulement : les stores existants (app, blobs, backups) ne sont jamais vidés ni recréés.
          const history=db.objectStoreNames.contains('history')?request.transaction.objectStore('history'):db.createObjectStore('history',{keyPath:'id'});
          if(!history.indexNames.contains('key'))history.createIndex('key','key');
          if(!history.indexNames.contains('at'))history.createIndex('at','at');
          if(!db.objectStoreNames.contains('syncBase'))db.createObjectStore('syncBase',{keyPath:'key'});
        };
        request.onsuccess=()=>finish(null,request.result);
        request.onerror=()=>finish(request.error||new Error('Stockage local indisponible.'));
        request.onblocked=()=>finish(storageBusyError('Une autre fenêtre bloque la mise à jour du stockage local. Fermez les autres onglets Parcelles puis rechargez l’application.'));
      });
      this.db.onversionchange=()=>{this.db?.close();this.db=null;};
    }catch(error){
      // A busy or damaged existing database must never be replaced by an empty
      // fallback workspace: ask for a reload while leaving its data untouched.
      if(!['SecurityError','NotSupportedError'].includes(error?.name))throw error;
      console.warn('[Parcelles] IndexedDB indisponible, repli local temporaire.',error);this.usingFallback=true;
    }
  }

  transaction(store,mode){if(!this.db)throw storageBusyError('Le stockage a été mis à jour dans une autre fenêtre. Rechargez l’application.');return this.db.transaction(store,mode);}

  async get(key){
    if(this.usingFallback){
      if(this.memory.has(key))return structuredClone(this.memory.get(key));
      try{return JSON.parse(safeLocalGet(`parcelles:${key}`)||'null');}
      catch(error){console.warn(`[Parcelles] donnée locale corrompue ignorée : ${key}`,error);return null;}
    }
    return requestAsPromise(this.transaction('app','readonly').objectStore('app').get(key));
  }
  async set(key,value){
    if(this.usingFallback){const copy=structuredClone(value),serialized=JSON.stringify(copy);if(!safeLocalSet(`parcelles:${key}`,serialized))throw new Error('Enregistrement impossible : le stockage local est plein ou désactivé.');this.memory.set(key,copy);return;}
    const tx=this.transaction('app','readwrite');tx.objectStore('app').put(value,key);await transactionDone(tx);
  }
  // Retire une entrée (espace de démonstration vidé à la sortie, n° 118).
  async delete(key){
    if(this.usingFallback){this.memory.delete(key);try{localStorage.removeItem(`parcelles:${key}`);}catch(error){console.warn(`[Parcelles] suppression localStorage impossible : ${key}`,error);}return;}
    const tx=this.transaction('app','readwrite');tx.objectStore('app').delete(key);await transactionDone(tx);
  }
  // Lecture qui ignore la copie mémoire du repli localStorage, partagée par les autres onglets.
  async getStored(key){
    if(this.usingFallback){
      try{const raw=safeLocalGet(`parcelles:${key}`);if(raw!==null)return JSON.parse(raw);}catch(error){console.warn(`[Parcelles] donnée locale corrompue ignorée : ${key}`,error);}
      return this.memory.has(key)?structuredClone(this.memory.get(key)):null;
    }
    return this.get(key);
  }
  // Écrit seulement si la valeur stockée est toujours celle que cet onglet connaît.
  // Lecture et écriture partagent la même transaction readwrite : aucun autre onglet ne peut s’intercaler.
  async setIfCurrent(key,value,isCurrent){
    if(this.usingFallback){if(!isCurrent(await this.getStored(key)))throw staleStateError();return this.set(key,value);}
    const tx=this.transaction('app','readwrite'),objectStore=tx.objectStore('app');let stale=false;
    const request=objectStore.get(key);
    request.onsuccess=()=>{let current=false;try{current=Boolean(isCurrent(request.result));}catch(error){console.warn('[Parcelles] vérification de révision impossible.',error);}if(!current){stale=true;tx.abort();return;}objectStore.put(value,key);};
    try{await transactionDone(tx);}catch(error){if(stale)throw staleStateError();throw error;}
  }
  async appKeys(){
    if(this.usingFallback){
      const keys=new Set(this.memory.keys());
      try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('parcelles:'))keys.add(k.slice('parcelles:'.length));}}catch(error){console.warn('[Parcelles] liste localStorage inaccessible.',error);}
      return [...keys];
    }
    return requestAsPromise(this.transaction('app','readonly').objectStore('app').getAllKeys());
  }

  // n° 137 (étape 2) : lecture cohérente de l’état d’un espace, en UNE transaction (aucune écriture ne s’intercale).
  // Résultat : {value,format,unchanged,legacy}
  // - format : 'collections' (nouvelle forme), 'legacy' (ancienne clé seule) ou null (rien d’enregistré) ;
  // - unchanged : vrai si unchanged(méta ou ancienne valeur) l’a confirmé, sans relire les collections ;
  // - legacy : ancienne clé encore présente à côté de la nouvelle forme (écrite par une version antérieure après un retour arrière).
  async readState(base,{unchanged=null}={}){
    if(this.usingFallback){
      const value=await this.getStored(base);
      if(value&&unchanged?.(value))return {value:null,format:'legacy',unchanged:true,legacy:null};
      return {value:value??null,format:value?'legacy':null,unchanged:false,legacy:null};
    }
    const tx=this.transaction('app','readonly'),store=tx.objectStore('app'),result={value:null,format:null,unchanged:false,legacy:null};
    let legacy=null;
    const metaRequest=store.get(stateMetaKey(base)),legacyRequest=store.get(base);
    metaRequest.onsuccess=()=>{
      const meta=metaRequest.result;
      if(!isStateMeta(meta))return;
      result.format='collections';
      if(unchanged?.(meta)){result.unchanged=true;return;}
      // Les réponses arrivent dans l’ordre des demandes : l’ordre des clés de l’état est conservé.
      const value={};result.value=value;
      for(const name of meta.keys){const request=store.get(stateCollectionKey(base,name));request.onsuccess=()=>{if(request.result!==undefined)value[name]=request.result;};}
    };
    legacyRequest.onsuccess=()=>{legacy=legacyValue(legacyRequest.result);};
    await transactionDone(tx);
    if(result.format==='collections'){result.legacy=legacy;return result;}
    if(!legacy)return result;
    result.format='legacy';
    if(unchanged?.(legacy)){result.unchanged=true;return result;}
    result.value=legacy;return result;
  }
  // Écriture atomique de l’état : vérification de révision (sur la méta, ou l’ancienne clé avant conversion), collections
  // modifiées, méta, témoin à la place de l’ancienne clé, retrait des collections disparues, le tout dans UNE transaction readwrite.
  // Un refus (StaleStateError) ou une erreur (quota, valeur non clonable…) annule l’ensemble : rien n’est écrit.
  // collect({format}) est appelé dans la transaction, juste avant les écritures, et renvoie {state,keys,changed} :
  // changed liste les collections à écrire, ou vaut null pour une écriture complète (conversion, autre espace…).
  async writeState(base,collect,{isCurrent=null}={}){
    if(this.usingFallback){
      // Repli localStorage : l’état reste un seul objet (aucune transaction à plusieurs clés).
      const current=await this.getStored(base);
      if(isCurrent&&!isCurrent(current))throw staleStateError();
      const {state}=collect({format:current?'legacy':null});
      return this.set(base,state);
    }
    const tx=this.transaction('app','readwrite'),store=tx.objectStore('app');let stale=false,failure=null;
    const abort=error=>{failure=error;try{tx.abort();}catch{}};
    const proceed=(stored,format,meta,marked)=>{
      if(isCurrent){let current=false;try{current=Boolean(isCurrent(stored));}catch(error){console.warn('[Parcelles] vérification de révision impossible.',error);}if(!current){stale=true;tx.abort();return;}}
      try{
        const {state,keys=Object.keys(state),changed=null}=collect({format});
        const full=changed===null||!meta;
        // Écriture complète : toutes les anciennes entrées de cet espace sont retirées d’abord (collections disparues comprises).
        if(full)store.delete(stateRange(base));
        else for(const name of meta.keys)if(!keys.includes(name))store.delete(stateCollectionKey(base,name));
        for(const name of full?keys:changed)store.put(state[name],stateCollectionKey(base,name));
        store.put(stateMetaFor(state,keys),stateMetaKey(base));
        // Témoin posé une fois (conversion, ou ancienne clé réécrite par une version antérieure) : rien de plus à chaque saisie.
        if(!marked)store.put(stateMarkerFor(state),base);
      }catch(error){abort(error);}
    };
    // Les réponses arrivent dans l’ordre des demandes : méta et ancienne clé sont connues ensemble.
    const metaRequest=store.get(stateMetaKey(base)),legacyRequest=store.get(base);
    legacyRequest.onsuccess=()=>{
      const meta=isStateMeta(metaRequest.result)?metaRequest.result:null,marked=isStateMarker(legacyRequest.result);
      if(meta||!isCurrent){proceed(meta,meta?'collections':null,meta,marked);return;}
      // Avant conversion seulement : la révision est celle de l’ancienne clé.
      const legacy=legacyValue(legacyRequest.result);proceed(legacy,legacy?'legacy':null,null,marked);
    };
    try{await transactionDone(tx);}catch(error){if(stale)throw staleStateError();throw failure||error;}
  }
  // Retire toutes les formes de l’état d’un espace (démonstration quittée, n° 118).
  async deleteState(base){
    if(this.usingFallback)return this.delete(base);
    const tx=this.transaction('app','readwrite'),store=tx.objectStore('app');store.delete(stateRange(base));store.delete(base);await transactionDone(tx);
  }


  async blobPut(id,blob){
    if(this.usingFallback)throw new Error('Les pièces jointes demandent IndexedDB.');
    const tx=this.transaction('blobs','readwrite');tx.objectStore('blobs').put(blob,id);await transactionDone(tx);
  }
  async blobGet(id){
    if(this.usingFallback)return null;
    return requestAsPromise(this.transaction('blobs','readonly').objectStore('blobs').get(id));
  }
  async blobDelete(id){
    if(this.usingFallback)return;
    const tx=this.transaction('blobs','readwrite');tx.objectStore('blobs').delete(id);await transactionDone(tx);
  }
  async blobKeys(){
    if(this.usingFallback)return[];
    return requestAsPromise(this.transaction('blobs','readonly').objectStore('blobs').getAllKeys());
  }
  async blobEntries(){
    if(this.usingFallback)return[];
    const keys=await this.blobKeys();
    const values=await Promise.all(keys.map(key=>this.blobGet(key)));
    return keys.map((key,index)=>({id:String(key),blob:values[index]}));
  }

  // Historique des fiches : jamais bloquant. Sans IndexedDB ou sans store (ancienne base ouverte ailleurs), rien n’est conservé.
  hasHistory(){return Boolean(!this.usingFallback&&this.db?.objectStoreNames?.contains('history'));}
  async historyAdd(rows,{maxPerEntity=50}={}){
    if(!this.hasHistory()||!rows?.length)return;
    const tx=this.transaction('history','readwrite'),store=tx.objectStore('history'),index=store.index('key');
    for(const row of rows)store.put(row);
    for(const key of new Set(rows.map(row=>row.key))){
      // Plafond par fiche : les versions les plus anciennes au-delà de la limite sont retirées.
      const request=index.getAll(key);
      request.onsuccess=()=>{const extra=(request.result||[]).sort((a,b)=>((b.at||0)-(a.at||0))||((b.seq||0)-(a.seq||0))).slice(maxPerEntity);for(const row of extra)store.delete(row.id);};
    }
    await transactionDone(tx);
  }
  async historyList(key){
    if(!this.hasHistory())return[];
    const rows=await requestAsPromise(this.transaction('history','readonly').objectStore('history').index('key').getAll(key));
    return (rows||[]).sort((a,b)=>((b.at||0)-(a.at||0))||((b.seq||0)-(a.seq||0)));
  }
  async historyPrune(cutoff){
    if(!this.hasHistory())return 0;
    const tx=this.transaction('history','readwrite'),request=tx.objectStore('history').index('at').openCursor(IDBKeyRange.upperBound(cutoff,true));let count=0;
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;cursor.delete();count+=1;cursor.continue();};
    await transactionDone(tx);return count;
  }

  // Base de fusion (n° 134) : jamais bloquante. Sans store (ancienne base ouverte ailleurs), la fusion à deux voies reste utilisée.
  hasSyncBase(){return Boolean(!this.usingFallback&&this.db?.objectStoreNames?.contains('syncBase'));}
  async syncBaseGet(key){
    if(!this.hasSyncBase())return null;
    const row=await requestAsPromise(this.transaction('syncBase','readonly').objectStore('syncBase').get(key));
    return row?.value??null;
  }
  async syncBasePut(key,value){
    if(!this.hasSyncBase())return;
    const tx=this.transaction('syncBase','readwrite');tx.objectStore('syncBase').put({key,value,at:Date.now()});await transactionDone(tx);
  }
  async syncBaseDelete(key){
    if(!this.hasSyncBase())return;
    const tx=this.transaction('syncBase','readwrite');tx.objectStore('syncBase').delete(key);await transactionDone(tx);
  }

  async backupPut(backup){
    if(this.usingFallback)return;
    const row={...backup};
    if(row.state&&!row.checksum)row.checksum=await jsonChecksum(row.state);
    if(row.state&&row.checksum){const current=await jsonChecksum(row.state);row.verified=current===row.checksum;row.verifiedAt=row.verified?Date.now():null;}
    const tx=this.transaction('backups','readwrite');tx.objectStore('backups').put(row);await transactionDone(tx);
    return row;
  }
  async backupList(workspaceId=null){
    if(this.usingFallback)return[];
    let rows=await requestAsPromise(this.transaction('backups','readonly').objectStore('backups').getAll());
    if(workspaceId!==null)rows=rows.filter(row=>String(row.workspaceId||'local')===String(workspaceId||'local'));
    return rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }
  async backupGet(id){
    if(this.usingFallback)return null;
    return requestAsPromise(this.transaction('backups','readonly').objectStore('backups').get(id));
  }
  async backupDelete(id){
    if(this.usingFallback)return;
    const tx=this.transaction('backups','readwrite');tx.objectStore('backups').delete(id);await transactionDone(tx);
  }
  async backupVerify(id){
    const row=await this.backupGet(id);if(!row?.state)return {ok:false,reason:'Sauvegarde introuvable'};
    const current=await jsonChecksum(row.state),expected=row.checksum||current,ok=current===expected;
    if(!this.usingFallback){const updated={...row,checksum:expected,verified:ok,verifiedAt:ok?Date.now():null};const tx=this.transaction('backups','readwrite');tx.objectStore('backups').put(updated);await transactionDone(tx);}
    return {ok,id,checksum:expected,verifiedAt:ok?Date.now():null};
  }
  async backupVerifyAll(workspaceId=null){
    const rows=await this.backupList(workspaceId),results=[];
    for(const row of rows)results.push(await this.backupVerify(row.id));
    return results;
  }

  async breakdown(){
    if(this.usingFallback)return {fallback:true,appEntries:0,blobCount:0,blobBytes:0,backupCount:0,backupBytes:0};
    const [blobs,backups,appKeys]=await Promise.all([this.blobEntries(),this.backupList(),this.appKeys()]);
    const blobBytes=blobs.reduce((sum,item)=>sum+(item.blob?.size||0),0);
    const backupBytes=backups.reduce((sum,item)=>sum+new Blob([JSON.stringify(item.state||{})]).size,0);
    return {fallback:false,appEntries:appKeys.length,workspaceEntries:new Set(appKeys.map(k=>String(k)).filter(k=>k.startsWith('state:workspace:')).map(k=>k.split('/')[0])).size,blobCount:blobs.length,blobBytes,backupCount:backups.length,backupBytes};
  }


  async pruneBackups(policy={daily:7,weekly:4,monthly:3}){
    const all=await this.backupList();
    const workspaces=[...new Set(all.map(item=>String(item.workspaceId||'local')))];
    for(const workspaceId of workspaces){
      const scoped=all.filter(item=>String(item.workspaceId||'local')===workspaceId);
      for(const [period,limit] of Object.entries(policy)){
        const rows=scoped.filter(item=>item.period===period).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        for(const extra of rows.slice(limit))await this.backupDelete(extra.id);
      }
      const legacy=scoped.filter(item=>String(item.id).match(/^auto_\d{4}-\d{2}-\d{2}$/)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      for(const extra of legacy.slice(3))await this.backupDelete(extra.id);
    }
  }

  async clearRuntimeCaches(){
    if('caches'in window){const keys=await caches.keys();await Promise.all(keys.map(key=>caches.delete(key)));}
  }
  async estimate(){
    if(navigator.storage?.estimate){
      const e=await navigator.storage.estimate();
      return{usage:e.usage||0,quota:e.quota||0};
    }
    return{usage:0,quota:0};
  }
}
