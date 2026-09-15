import {BUILD_ID, clone} from './utils.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function bytesToBase64(bytes){
  let binary='';
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  for(let i=0;i<view.length;i+=0x8000)binary+=String.fromCharCode(...view.subarray(i,i+0x8000));
  return btoa(binary);
}
function base64ToBytes(value){
  const binary=atob(String(value||''));
  const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
}
function cryptoApi(){
  if(!globalThis.crypto?.subtle)throw new Error('Le chiffrement sécurisé Web Crypto n’est pas disponible sur cet appareil.');
  return globalThis.crypto;
}

export function passwordStrength(password){
  const value=String(password||'');
  let score=0;
  if(value.length>=12)score++;
  if(value.length>=16)score++;
  if(/[a-z]/.test(value)&&/[A-Z]/.test(value))score++;
  if(/\d/.test(value))score++;
  if(/[^A-Za-z0-9]/.test(value))score++;
  return {score,ok:value.length>=12&&score>=3,label:score>=5?'Très bon':score>=4?'Bon':score>=3?'Correct':'Insuffisant'};
}

async function deriveKey(password,salt,iterations,usage){
  const crypto=cryptoApi();
  const material=await crypto.subtle.importKey('raw',encoder.encode(String(password)),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);
}

export async function encryptJsonPayload(payload,password,{iterations=250000}={}){
  const quality=passwordStrength(password);
  if(!quality.ok)throw new Error('Utilisez un mot de passe d’au moins 12 caractères, avec plusieurs types de caractères.');
  const crypto=cryptoApi(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password,salt,iterations,['encrypt']);
  const plaintext=encoder.encode(JSON.stringify(payload));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);
  return {
    format:'parcelles-encrypted-v1',
    build:BUILD_ID,
    algorithm:'AES-GCM-256',
    kdf:'PBKDF2-SHA256',
    iterations,
    salt:bytesToBase64(salt),
    iv:bytesToBase64(iv),
    ciphertext:bytesToBase64(new Uint8Array(encrypted)),
    createdAt:Date.now()
  };
}

export async function decryptJsonPayload(container,password){
  if(!container||container.format!=='parcelles-encrypted-v1')throw new Error('Format de sauvegarde chiffrée non reconnu.');
  const crypto=cryptoApi(),salt=base64ToBytes(container.salt),iv=base64ToBytes(container.iv),ciphertext=base64ToBytes(container.ciphertext);
  const key=await deriveKey(password,salt,Number(container.iterations||250000),['decrypt']);
  try{
    const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext);
    return JSON.parse(decoder.decode(decrypted));
  }catch{
    throw new Error('Mot de passe incorrect ou sauvegarde chiffrée altérée.');
  }
}

export function syncRetryDelay(attempt,baseSeconds=15,maxSeconds=3600){
  const n=Math.max(1,Number(attempt)||1),base=Math.max(1,Number(baseSeconds)||15),max=Math.max(base,Number(maxSeconds)||3600);
  return Math.min(max,base*Math.pow(2,n-1))*1000;
}

export function queueStats(queue=[]){
  const now=Date.now();
  const rows=Array.isArray(queue)?queue:[];
  return {
    total:rows.length,
    pending:rows.filter(x=>x.status==='pending').length,
    error:rows.filter(x=>x.status==='error').length,
    conflict:rows.filter(x=>x.status==='conflict').length,
    waiting:rows.filter(x=>x.status==='pending'&&Number(x.nextRetryAt||0)>now).length,
    ready:rows.filter(x=>x.status==='pending'&&Number(x.nextRetryAt||0)<=now).length,
    maxAttempts:rows.reduce((m,x)=>Math.max(m,Number(x.attempts||0)),0)
  };
}

const ignoredMergeKeys=new Set(['updatedAt','version','cloudSyncedAt','modifiedBy','modifiedEmail','deviceId']);
const empty=value=>value===null||value===undefined||value===''||(Array.isArray(value)&&!value.length);
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);

export function safeMergeEntity(local,remote){
  const a=clone(local||{}),b=clone(remote||{}),merged={...a};
  const conflicts=[];
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);
  for(const key of keys){
    if(ignoredMergeKeys.has(key))continue;
    const av=a[key],bv=b[key];
    if(same(av,bv)){merged[key]=clone(av);continue;}
    if(key==='deletedAt'){conflicts.push(key);continue;}
    if(empty(av)&&!empty(bv)){merged[key]=clone(bv);continue;}
    if(empty(bv)&&!empty(av)){merged[key]=clone(av);continue;}
    conflicts.push(key);
  }
  merged.id=a.id||b.id;
  merged.createdAt=Math.min(Number(a.createdAt||Infinity),Number(b.createdAt||Infinity));
  if(!Number.isFinite(merged.createdAt))merged.createdAt=a.createdAt||b.createdAt||Date.now();
  merged.updatedAt=Math.max(Number(a.updatedAt||0),Number(b.updatedAt||0),Date.now());
  merged.version=Math.max(Number(a.version||0),Number(b.version||0))+1;
  return {canMerge:conflicts.length===0,merged,conflicts};
}

export function sanitizeCloudError(error){
  const raw=String(error?.message||error||'Erreur inconnue');
  return raw.replace(/AIza[0-9A-Za-z_-]{20,}/g,'[clé masquée]').replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g,'[jeton masqué]').slice(0,300);
}

export function securitySummary({preferences={},metadata={},queue=[]}={}){
  const stats=queueStats(queue);
  return {
    syncEnabled:Boolean(preferences.syncEnabled),
    attachments:Boolean(preferences.syncAttachments),
    wifiOnly:Boolean(preferences.syncWifiOnly),
    attachmentWifiOnly:Boolean(preferences.syncAttachmentsWifiOnly),
    autoMerge:preferences.syncAutoMerge!==false,
    pending:stats.pending,
    errors:stats.error,
    lastSyncAt:metadata.lastSyncAt||null,
    lastSyncError:metadata.lastSyncError||null,
    syncFailureCount:Number(metadata.syncFailureCount||0)
  };
}
