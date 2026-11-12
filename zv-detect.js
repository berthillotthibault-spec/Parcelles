// A5 — Zones vulnérables nitrates détectées automatiquement par parcelle.
// Source : WFS Sandre (couche sa:ZoneVuln_designation_FXX), appel direct depuis le navigateur (CORS *).
// On ne demande JAMAIS la géométrie (une seule entité pèse 13 Mo) : seulement les attributs, dans une
// boîte minuscule autour du centre de la parcelle. Réponse en GML (le JSON est refusé par le service).
// Cache local hors state (non synchronisé) : localStorage 'parcelles:zv-auto:v1'.
import {geometryCentroid} from './utils.js';

export const ZV_WFS_URL='https://services.sandre.eaufrance.fr/geo/zon';
export const ZV_TYPENAME='sa:ZoneVuln_designation_FXX';
export const ZV_PROPERTIES=['NomZoneVuln','CdBassinDCE','NumTexteReglem','DatePubliTexteReglem','DateMajZoneVuln'];
export const ZV_CACHE_KEY='parcelles:zv-auto:v1';
export const ZV_TTL_MS=30*24*3600*1000;
export const ZV_BATCH_MAX=10;
export const ZV_SOURCE_ID='zones-vulnerables';
const MAX_BYTES=200000;

const coord=v=>String(Number(v.toFixed(6)));

/** URL GetFeature sans géométrie ; BBOX en EPSG:4326 dans l’ordre lat,lon (axes de l’URN OGC). */
export function zvRequestUrl(centroid,{eps=0.0005}={}){
  const lat=Number(centroid?.latitude),lon=Number(centroid?.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('Centre de parcelle inconnu.');
  const bbox=[lat-eps,lon-eps,lat+eps,lon+eps].map(coord).join(',');
  const params=[['SERVICE','WFS'],['VERSION','2.0.0'],['REQUEST','GetFeature'],['TYPENAMES',ZV_TYPENAME],['COUNT','5'],['SRSNAME','EPSG:4326'],
    ['BBOX',`${bbox},urn:ogc:def:crs:EPSG::4326`],['PROPERTYNAME',ZV_PROPERTIES.join(',')]];
  return `${ZV_WFS_URL}?${params.map(([k,v])=>`${k}=${v}`).join('&')}`;
}

// Entités numériques (&#233; / &#xE9;) décodées aussi : le repli sans DOMParser garde les accents.
const fromCode=(n,radix)=>{const c=parseInt(n,radix);try{return Number.isFinite(c)?String.fromCodePoint(c):'';}catch{return '';}};
const decode=t=>String(t||'').replace(/<[^>]*>/g,'').replace(/&#x([0-9a-f]+);/gi,(_,h)=>fromCode(h,16)).replace(/&#(\d+);/g,(_,d)=>fromCode(d,10)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,'\'').replace(/&amp;/g,'&').trim();
const zoneFrom=get=>({nom:get('NomZoneVuln'),bassin:get('CdBassinDCE'),arrete:get('NumTexteReglem'),datePubli:get('DatePubliTexteReglem'),dateMaj:get('DateMajZoneVuln')});

function exceptionText(xml){
  const m=/<(?:\w+:)?ExceptionText\b[^>]*>([\s\S]*?)<\/(?:\w+:)?ExceptionText>/.exec(xml);
  return m?decode(m[1]).slice(0,200):'erreur du service';
}

function parseWithRegex(xml){
  const zones=[],member=/<(?:\w+:)?member\b[^>]*>([\s\S]*?)<\/(?:\w+:)?member>/g;let m;
  while((m=member.exec(xml))){
    const body=m[1];
    zones.push(zoneFrom(name=>{const f=new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(body);return f?decode(f[1]):'';}));
  }
  return zones;
}

function parseWithDom(xml,Parser){
  const doc=new Parser().parseFromString(xml,'application/xml');
  if(!doc||doc.getElementsByTagName('parsererror').length)throw new Error('Réponse Sandre illisible.');
  const members=[...doc.getElementsByTagNameNS('*','member')];
  return members.map(node=>zoneFrom(name=>{const el=node.getElementsByTagNameNS('*',name)[0];return el?String(el.textContent||'').trim():'';}));
}

/**
 * Lit la réponse GML. {inZone, zones:[{nom,bassin,arrete,datePubli,dateMaj}]}.
 * Un ExceptionReport lève une erreur. DOMParser injecté (absent sous node : repli par expressions régulières).
 */
export function parseZvGml(xmlText,DOMParserImpl=globalThis.DOMParser){
  const xml=String(xmlText||'');
  if(/<(?:\w+:)?ExceptionReport\b/.test(xml))throw new Error(`Sandre : ${exceptionText(xml)}`);
  if(!/<(?:\w+:)?FeatureCollection\b/.test(xml))throw new Error('Réponse Sandre inattendue.');
  const zones=typeof DOMParserImpl==='function'?parseWithDom(xml,DOMParserImpl):parseWithRegex(xml);
  return{inZone:zones.length>0,zones};
}

/** Cache {clé: détection} en localStorage, chaque accès sous try/catch ; repli en mémoire. */
export function createZvCache(storageArg){
  let data=null,storage=storageArg;
  // L’accès à globalThis.localStorage peut lever (stockage bloqué) : résolu ici, sous try/catch.
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  const load=()=>{
    if(data)return data;
    data={};
    try{const raw=storage?.getItem?.(ZV_CACHE_KEY);const parsed=raw?JSON.parse(raw):null;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed;}catch{/* stockage indisponible : mémoire seule */}
    return data;
  };
  const save=()=>{try{storage?.setItem?.(ZV_CACHE_KEY,JSON.stringify(data));}catch{/* quota ou stockage bloqué */}};
  return{
    get:key=>load()[key]||null,
    set(key,value){
      // Le centre « lat,lon » ne contient pas de « : » : on coupe au dernier, l’id peut en contenir.
      const k0=String(key),all=load(),prefix=k0.slice(0,k0.lastIndexOf(':')+1);
      // Une seule entrée par parcelle : un nouveau contour remplace l’ancienne détection.
      for(const k of Object.keys(all))if(k!==key&&prefix&&k.slice(0,k.lastIndexOf(':')+1)===prefix)delete all[k];
      all[key]=value;save();
    },
    entries:()=>Object.entries(load())
  };
}

/** Clé `${id}:${lat},${lon}` avec centre arrondi à 1e-4 ; null sans géométrie exploitable. */
export function zvCacheKey(parcel){
  const c=parcel?.geometry?geometryCentroid(parcel.geometry):null;
  if(!parcel?.id||!c||!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude))return null;
  return `${parcel.id}:${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
}

/** Détection en cache pour le contour actuel de la parcelle (null si inconnue ou contour modifié depuis). */
export function zvAutoFor(parcel,cache){
  const key=zvCacheKey(parcel);if(!key||!cache)return null;
  const hit=cache.get(key);
  return hit&&(hit.inZone===true||hit.inZone===false)?hit:null;
}

/** Résolveur parcelId => détection, à passer en zvAuto à nitrogen.js, compliance.js et nitrogen-ui.js. */
export function zvAutoResolver(cache,getParcel){
  return id=>{try{return zvAutoFor(getParcel(id),cache);}catch{return null;}};
}

const isFresh=(hit,now)=>Boolean(hit&&(hit.inZone===true||hit.inZone===false)&&Number.isFinite(hit.checkedAt)&&now-hit.checkedAt<ZV_TTL_MS);

async function fetchGml(fetchImpl,url,timeoutMs,outer){
  const ctrl=typeof AbortController==='function'?new AbortController():null;let timer,onAbort;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{ctrl?.abort();reject(new Error('délai dépassé'));},timeoutMs);
    // Signal externe (délai du registre A0) : la requête en cours est abandonnée aussi, pas seulement la suivante.
    onAbort=()=>{ctrl?.abort();reject(new Error('vérification interrompue'));};
    if(outer?.aborted)onAbort();else outer?.addEventListener?.('abort',onAbort,{once:true});
  });
  try{
    const run=(async()=>{
      const r=await fetchImpl(url,{signal:ctrl?.signal});
      if(!r?.ok)throw new Error(`Sandre HTTP ${r?.status??'?'}`);
      const text=await r.text();
      if(text.length>MAX_BYTES)throw new Error('Réponse Sandre trop volumineuse.');
      return text;
    })();
    return await Promise.race([run,timeout]);
  }finally{clearTimeout(timer);outer?.removeEventListener?.('abort',onAbort);}
}

/**
 * Détecte une parcelle. Renvoie {inZone:true|false|null, zones, checkedAt, origin:'cache'|'reseau'|'aucun', error?}.
 * En cas d’erreur ou hors ligne, la valeur en cache est conservée : jamais de passage à « hors zone » sur une erreur.
 */
export async function detectZvForParcel({parcel,fetch:fetchImpl=globalThis.fetch,cache,now=()=>Date.now(),timeoutMs=10000,force=false,online=()=>globalThis.navigator?.onLine!==false,DOMParser:Parser=globalThis.DOMParser,signal}={}){
  const key=zvCacheKey(parcel),hit=key?cache?.get(key):null;
  const unknown=error=>({inZone:null,zones:[],checkedAt:null,origin:'aucun',error});
  if(!key)return unknown('Parcelle sans contour exploitable.');
  if(!force&&isFresh(hit,now()))return{...hit,origin:'cache'};
  const keep=error=>{
    if(hit&&(hit.inZone===true||hit.inZone===false)){
      const kept={...hit,error,errorAt:now()};cache?.set(key,kept);return{...kept,origin:'cache'};
    }
    return unknown(error);
  };
  if(!online())return keep('Hors ligne.');
  if(typeof fetchImpl!=='function')return keep('Réseau indisponible.');
  try{
    const c=geometryCentroid(parcel.geometry);
    const result=parseZvGml(await fetchGml(fetchImpl,zvRequestUrl(c),timeoutMs,signal),Parser);
    const entry={inZone:result.inZone,zones:result.zones,checkedAt:now()};
    cache?.set(key,entry);
    return{...entry,origin:'reseau'};
  }catch(error){
    return keep(String(error?.message||error||'erreur'));
  }
}

/**
 * Lot séquentiel : au plus `max` parcelles à (re)vérifier par passage, jamais vues d’abord puis les plus anciennes.
 * Renvoie {checked, inZone, known, errors, remaining}.
 */
export async function detectZvBatch(parcels,{fetch:fetchImpl=globalThis.fetch,cache,now=()=>Date.now(),timeoutMs=10000,max=ZV_BATCH_MAX,online=()=>globalThis.navigator?.onLine!==false,DOMParser:Parser=globalThis.DOMParser,signal}={}){
  const list=(parcels||[]).filter(p=>p&&!p.deletedAt&&zvCacheKey(p));
  const due=list.filter(p=>!isFresh(cache?.get(zvCacheKey(p)),now()))
    .sort((a,b)=>(cache?.get(zvCacheKey(a))?.checkedAt||0)-(cache?.get(zvCacheKey(b))?.checkedAt||0));
  const batch=due.slice(0,Math.max(0,max));
  let checked=0,errors=0;
  for(const parcel of batch){
    if(signal?.aborted||!online())break;
    const r=await detectZvForParcel({parcel,fetch:fetchImpl,cache,now,timeoutMs,force:true,online,DOMParser:Parser,signal});
    if(r.origin==='reseau')checked++;else errors++;
  }
  const known=list.map(p=>zvAutoFor(p,cache)).filter(Boolean);
  return{checked,errors,inZone:known.filter(k=>k.inZone).length,known:known.length,remaining:Math.max(0,due.length-checked)};
}

/**
 * Source agrégée pour le registre auto-update.js (contrat A0) : check() lance un lot et renvoie un résumé.
 * getParcels : () => parcelles actives ; when : garde facultative (onglet écrivain, saveData…).
 */
export const ZV_PENDING_TTL_MS=10*60*1000;
export function zvUpdaterSource({getParcels,cache,when,ttlMs=12*3600*1000,now=()=>Date.now()}={}){
  // Durée relue par le registre à chaque contrôle : tant qu’une parcelle n’a pas de résultat frais (profil vide
  // au premier passage puis import, lot partiel, nouvelle parcelle), la source redevient à vérifier après 10 min
  // au lieu d’attendre 12 h derrière un « à jour » obtenu sur 0 parcelle.
  const pending=()=>{try{return(getParcels?.()||[]).some(p=>{const k=p&&!p.deletedAt?zvCacheKey(p):null;return k&&!isFresh(cache?.get(k),now());});}catch{return false;}};
  return{
    id:ZV_SOURCE_ID,label:'Zones vulnérables (Sandre)',get ttlMs(){return pending()?Math.min(ttlMs,ZV_PENDING_TTL_MS):ttlMs;},timeoutMs:120000,
    embedded:{value:null,version:'saisie',label:'saisie manuelle'},
    when,
    validate:r=>Boolean(r&&r.value&&Number.isFinite(r.value.checked)),
    async check({fetch:fetchImpl,now,signal}={}){
      // signal : délai du registre dépassé, le lot s’arrête à la parcelle suivante.
      const r=await detectZvBatch(getParcels?.()||[],{fetch:fetchImpl,cache,signal,now:typeof now==='function'?now:Number.isFinite(now)?()=>now:undefined});
      if(r.errors&&!r.checked)throw new Error(`Sandre injoignable (${r.errors} parcelle${r.errors>1?'s':''} en échec).`);
      return{value:r,version:`${r.inZone}/${r.known}`,note:`${r.inZone} parcelle${r.inZone>1?'s':''} en zone vulnérable sur ${r.known} vérifiée${r.known>1?'s':''}${r.remaining?`, ${r.remaining} restante${r.remaining>1?'s':''}`:''}.`};
    }
  };
}
