const DB_NAME='parcelles-app';
const DB_VERSION=2;

function requestAsPromise(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaction annulée'));});}

async function jsonChecksum(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

export class StorageService{
  constructor(){this.db=null;this.memory=new Map();this.usingFallback=false;}

  async init(){
    if(!('indexedDB'in window)){this.usingFallback=true;return;}
    try{
      this.db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open(DB_NAME,DB_VERSION);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('app'))db.createObjectStore('app');
          if(!db.objectStoreNames.contains('blobs'))db.createObjectStore('blobs');
          if(!db.objectStoreNames.contains('backups'))db.createObjectStore('backups',{keyPath:'id'});
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
    }catch(error){console.warn('[Parcelles] IndexedDB indisponible, repli local temporaire.',error);this.usingFallback=true;}
  }

  async get(key){
    if(this.usingFallback)return this.memory.get(key)??JSON.parse(localStorage.getItem(`parcelles:${key}`)||'null');
    return requestAsPromise(this.db.transaction('app','readonly').objectStore('app').get(key));
  }
  async set(key,value){
    if(this.usingFallback){this.memory.set(key,value);localStorage.setItem(`parcelles:${key}`,JSON.stringify(value));return;}
    const tx=this.db.transaction('app','readwrite');tx.objectStore('app').put(value,key);await transactionDone(tx);
  }

  async blobPut(id,blob){
    if(this.usingFallback)throw new Error('Les pièces jointes demandent IndexedDB.');
    const tx=this.db.transaction('blobs','readwrite');tx.objectStore('blobs').put(blob,id);await transactionDone(tx);
  }
  async blobGet(id){
    if(this.usingFallback)return null;
    return requestAsPromise(this.db.transaction('blobs','readonly').objectStore('blobs').get(id));
  }
  async blobDelete(id){
    if(this.usingFallback)return;
    const tx=this.db.transaction('blobs','readwrite');tx.objectStore('blobs').delete(id);await transactionDone(tx);
  }
  async blobKeys(){
    if(this.usingFallback)return[];
    return requestAsPromise(this.db.transaction('blobs','readonly').objectStore('blobs').getAllKeys());
  }
  async blobEntries(){
    if(this.usingFallback)return[];
    const keys=await this.blobKeys();
    const values=await Promise.all(keys.map(key=>this.blobGet(key)));
    return keys.map((key,index)=>({id:String(key),blob:values[index]}));
  }

  async backupPut(backup){
    if(this.usingFallback)return;
    const row={...backup};
    if(row.state&&!row.checksum)row.checksum=await jsonChecksum(row.state);
    if(row.state&&row.checksum){const current=await jsonChecksum(row.state);row.verified=current===row.checksum;row.verifiedAt=row.verified?Date.now():null;}
    const tx=this.db.transaction('backups','readwrite');tx.objectStore('backups').put(row);await transactionDone(tx);
    return row;
  }
  async backupList(){
    if(this.usingFallback)return[];
    const rows=await requestAsPromise(this.db.transaction('backups','readonly').objectStore('backups').getAll());
    return rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }
  async backupGet(id){
    if(this.usingFallback)return null;
    return requestAsPromise(this.db.transaction('backups','readonly').objectStore('backups').get(id));
  }
  async backupDelete(id){
    if(this.usingFallback)return;
    const tx=this.db.transaction('backups','readwrite');tx.objectStore('backups').delete(id);await transactionDone(tx);
  }
  async backupVerify(id){
    const row=await this.backupGet(id);if(!row?.state)return {ok:false,reason:'Sauvegarde introuvable'};
    const current=await jsonChecksum(row.state),expected=row.checksum||current,ok=current===expected;
    if(!this.usingFallback){const updated={...row,checksum:expected,verified:ok,verifiedAt:ok?Date.now():null};const tx=this.db.transaction('backups','readwrite');tx.objectStore('backups').put(updated);await transactionDone(tx);}
    return {ok,id,checksum:expected,verifiedAt:ok?Date.now():null};
  }
  async backupVerifyAll(){
    const rows=await this.backupList(),results=[];
    for(const row of rows)results.push(await this.backupVerify(row.id));
    return results;
  }

  async breakdown(){
    if(this.usingFallback)return {fallback:true,appEntries:0,blobCount:0,blobBytes:0,backupCount:0,backupBytes:0};
    const [blobs,backups]=await Promise.all([this.blobEntries(),this.backupList()]);
    const blobBytes=blobs.reduce((sum,item)=>sum+(item.blob?.size||0),0);
    const backupBytes=backups.reduce((sum,item)=>sum+new Blob([JSON.stringify(item.state||{})]).size,0);
    return {fallback:false,appEntries:1,blobCount:blobs.length,blobBytes,backupCount:backups.length,backupBytes};
  }


  async pruneBackups(policy={daily:7,weekly:4,monthly:3}){
    const all=await this.backupList();
    for(const [period,limit] of Object.entries(policy)){
      const rows=all.filter(item=>item.period===period||String(item.id).startsWith(`auto_${period}_`)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      for(const extra of rows.slice(limit))await this.backupDelete(extra.id);
    }
    const legacy=all.filter(item=>String(item.id).match(/^auto_\d{4}-\d{2}-\d{2}$/)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    for(const extra of legacy.slice(3))await this.backupDelete(extra.id);
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
