const DB_NAME='parcelles-app';
const DB_VERSION=2;

function requestAsPromise(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaction annulée'));});}

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
    const tx=this.db.transaction('backups','readwrite');tx.objectStore('backups').put(backup);await transactionDone(tx);
    // Retain latest 14 automatic snapshots.
    const all=await this.backupList();
    const automatic=all.filter(item=>String(item.id).startsWith('auto_')).sort((a,b)=>b.createdAt-a.createdAt);
    for(const extra of automatic.slice(14))await this.backupDelete(extra.id);
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
