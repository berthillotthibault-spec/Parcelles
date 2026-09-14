const DB_NAME = 'parcelles-2';
const DB_VERSION = 1;

function requestAsPromise(request){
  return new Promise((resolve,reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export class StorageService {
  constructor(){ this.db = null; this.memory = new Map(); this.usingFallback = false; }
  async init(){
    if (!('indexedDB' in window)){ this.usingFallback = true; return; }
    try {
      this.db = await new Promise((resolve,reject) => {
        const request = indexedDB.open(DB_NAME,DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('app')) db.createObjectStore('app');
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
          if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups',{keyPath:'id'});
        };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } catch(error) { console.warn('IndexedDB indisponible, repli local temporaire.',error); this.usingFallback = true; }
  }
  async get(key){
    if (this.usingFallback) return this.memory.get(key) ?? JSON.parse(localStorage.getItem(`parcelles:${key}`) || 'null');
    return requestAsPromise(this.db.transaction('app','readonly').objectStore('app').get(key));
  }
  async set(key,value){
    if (this.usingFallback){ this.memory.set(key,value); localStorage.setItem(`parcelles:${key}`,JSON.stringify(value)); return; }
    await requestAsPromise(this.db.transaction('app','readwrite').objectStore('app').put(value,key));
  }
  async blobPut(id,blob){
    if (this.usingFallback) throw new Error('Les pièces jointes demandent IndexedDB.');
    await requestAsPromise(this.db.transaction('blobs','readwrite').objectStore('blobs').put(blob,id));
  }
  async blobGet(id){
    if (this.usingFallback) return null;
    return requestAsPromise(this.db.transaction('blobs','readonly').objectStore('blobs').get(id));
  }
  async blobDelete(id){
    if (!this.usingFallback) await requestAsPromise(this.db.transaction('blobs','readwrite').objectStore('blobs').delete(id));
  }
  async backupPut(backup){
    if (this.usingFallback) return;
    await requestAsPromise(this.db.transaction('backups','readwrite').objectStore('backups').put(backup));
  }
}
