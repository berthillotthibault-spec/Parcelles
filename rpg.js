import {geometryAreaHa} from './utils.js';

// Extrait de la nomenclature officielle des cultures PAC (CODE_CULTU). Un code absent
// de cette table est conservé tel quel : l’utilisateur pourra le renommer ensuite.
export const RPG_CULTURE_LABELS=Object.freeze({
  BTH:'Blé tendre d’hiver',BTP:'Blé tendre de printemps',BDH:'Blé dur d’hiver',BDP:'Blé dur de printemps',
  ORH:'Orge d’hiver',ORP:'Orge de printemps',AVH:'Avoine d’hiver',AVP:'Avoine de printemps',
  SGH:'Seigle d’hiver',TTH:'Triticale d’hiver',TTP:'Triticale de printemps',
  MIS:'Maïs',MIE:'Maïs ensilage',SOG:'Sorgho',
  CZH:'Colza d’hiver',CZP:'Colza de printemps',TRN:'Tournesol',SOJ:'Soja',LIH:'Lin non textile d’hiver',
  FVL:'Féverole',PHI:'Pois d’hiver',PPR:'Pois de printemps',LUZ:'Luzerne',
  BTN:'Betterave non fourragère',PTC:'Pomme de terre de consommation',
  PPH:'Prairie permanente',PTR:'Prairie temporaire',PRL:'Prairie en rotation longue',
  J5M:'Jachère de 5 ans ou moins',J6P:'Jachère de 6 ans ou plus',
  VRC:'Vigne (raisins de cuve)'
});

// Nomenclature à jour (rpg-culture-labels.js, data.gouv.fr) posée par l’intégration : elle complète
// la table embarquée sans la remplacer. Les cultures déjà enregistrées ne sont jamais renommées.
let cultureLabelOverrides=Object.freeze({});
export function setRpgCultureLabels(map){
  const out={};
  if(map&&typeof map==='object')for(const [code,label] of Object.entries(map)){
    const key=String(code??'').trim().toUpperCase(),text=typeof label==='string'?label.trim():'';
    if(key&&text)out[key]=text;
  }
  cultureLabelOverrides=Object.freeze(out);
  return Object.keys(out).length;
}
/** Surcharge à jour, puis table embarquée, puis libellé de la source, puis code brut. `year` est réservé. */
export function rpgCultureLabel(code,fallback='',year){
  const key=String(code??'').trim().toUpperCase();
  return cultureLabelOverrides[key]||RPG_CULTURE_LABELS[key]||String(fallback||key||'').trim();
}

// API Carto (apicarto.ign.fr) a fermé fin 2026 : le RPG est lu sur le WFS de la Géoplateforme,
// une couche par millésime (RPG.<année>:parcelles_graphiques). Un millésime pas encore publié
// répond « Unknown namespace » : il est mémorisé (30 jours, localStorage) et l’année précédente
// est essayée. Le dernier millésime publié est aussi servi sous l’alias RPG.LATEST.
export const RPG_WFS_URL='https://data.geopf.fr/wfs/ows';
const PAGE_SIZE=1000;
const MAX_PAGES=10000; // Fail explicitly if a broken server never reaches its end.
const REQUEST_TIMEOUT_MS=30000;
export const RPG_UNAVAILABLE_KEY='parcelles:rpg-unavailable';
export const RPG_UNAVAILABLE_TTL_MS=30*24*3600*1000;
export const RPG_OLDEST_YEAR=2015;
export function rpgTypeName(year){
  if(String(year).toLowerCase()==='latest')return 'RPG.LATEST:parcelles_graphiques';
  return `RPG.${checkedYear(year)}:parcelles_graphiques`;
}

// Années indisponibles : {years:{2026:checkedAt}}. Stockage injectable (tests) ; s’il lève,
// la liste reste en mémoire pour la session. Seule une réponse explicite du WFS marque une année.
let unavailableYears=null,yearStorage,yearClock=()=>Date.now();
function yearStore(){try{return yearStorage!==undefined?yearStorage:globalThis.localStorage??null;}catch{return null;}}
function loadUnavailable(){
  if(unavailableYears)return unavailableYears;
  unavailableYears=new Map();
  try{
    const raw=yearStore()?.getItem(RPG_UNAVAILABLE_KEY),data=raw?JSON.parse(raw):null;
    for(const [key,at] of Object.entries(data?.years||{})){const year=Number(key),time=Number(at);if(Number.isSafeInteger(year)&&Number.isFinite(time))unavailableYears.set(year,time);}
  }catch{}
  return unavailableYears;
}
function saveUnavailable(){
  try{
    const store=yearStore();if(!store)return;
    if(unavailableYears.size)store.setItem(RPG_UNAVAILABLE_KEY,JSON.stringify({years:Object.fromEntries(unavailableYears)}));
    else store.removeItem(RPG_UNAVAILABLE_KEY);
  }catch{}
}
/** Tests : stockage et horloge injectés ; recharge la liste depuis ce stockage. */
export function configureRpgYearCache({storage,now}={}){yearStorage=storage;yearClock=typeof now==='function'?now:()=>Date.now();unavailableYears=null;}
export function isRpgYearUnavailable(year){
  const map=loadUnavailable(),key=Number(year),at=map.get(key);
  if(at===undefined)return false;
  const age=yearClock()-at;
  if(age>RPG_UNAVAILABLE_TTL_MS||age<-RPG_UNAVAILABLE_TTL_MS){map.delete(key);saveUnavailable();return false;}
  return true;
}
export function markRpgYearUnavailable(year){
  const key=Number(year);if(!Number.isSafeInteger(key))return;
  loadUnavailable().set(key,yearClock());saveUnavailable();
}
export function resetRpgYearCache(){loadUnavailable().clear();saveUnavailable();unavailableYears=null;}

// Millésime réel de RPG.LATEST, posé par l’intégration (source rpgLatestSource ci-dessous).
// latestViaAlias : RPG.<latest> a répondu « inconnu » pendant cette session ; les chargements suivants
// passent directement par RPG.LATEST (une requête en échec de moins à chaque chargement). Gardé en
// mémoire seulement : à la session suivante RPG.<année> est réessayé, au cas où l’IGN l’aurait publié.
let latestYear=null,latestViaAlias=null;
export function setRpgLatestYear(year){
  const value=Number(year);
  latestYear=Number.isSafeInteger(value)&&value>=RPG_OLDEST_YEAR&&value<=9999?value:null;
  if(latestViaAlias!==latestYear)latestViaAlias=null;
  return latestYear;
}
export function getRpgLatestYear(){return latestYear;}
/** Emprise [ouest,sud,est,nord] d’une géométrie WGS84 (un point devient un carré d’environ 50 m). */
export function geometryBbox(geometry){
  let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;
  const visit=c=>{if(typeof c[0]==='number'){w=Math.min(w,c[0]);e=Math.max(e,c[0]);s=Math.min(s,c[1]);n=Math.max(n,c[1]);}else c.forEach(visit);};
  visit(geometry.coordinates);
  if(geometry.type==='Point'){const d=.00025;w-=d;e+=d;s-=d;n+=d;}
  return[w,s,e,n];
}
export function rpgPageUrl({year,bbox,start=0,count=PAGE_SIZE,typeName=rpgTypeName(year)}){
  const params=new URLSearchParams({SERVICE:'WFS',VERSION:'2.0.0',REQUEST:'GetFeature',TYPENAMES:typeName,OUTPUTFORMAT:'application/json',SRSNAME:'CRS:84',BBOX:`${bbox.map(v=>Number(v).toFixed(6)).join(',')},CRS:84`,COUNT:String(count),STARTINDEX:String(start)});
  return `${RPG_WFS_URL}?${params.toString()}`;
}

function checkedYear(value){
  const year=Number(value);
  if(!Number.isSafeInteger(year)||year<2015||year>9999)throw new Error('Millésime RPG v2 invalide : choisissez une année à partir de 2015.');
  return year;
}
function property(properties,...names){
  for(const name of names){const value=properties?.[name];if(value!==undefined&&value!==null&&String(value).trim()!=='')return value;}
  return null;
}
function identifier(value){
  return typeof value==='string'&&value.trim()?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):null;
}
function validPosition(position){
  return Array.isArray(position)&&position.length>=2&&position.every(Number.isFinite)&&Math.abs(position[0])<=180&&Math.abs(position[1])<=90;
}
function validRing(ring){
  if(!Array.isArray(ring)||ring.length<4||!ring.every(validPosition))return false;
  const first=ring[0],last=ring[ring.length-1];
  return first[0]===last[0]&&first[1]===last[1];
}
function validPolygon(polygon){return Array.isArray(polygon)&&polygon.length>0&&polygon.every(validRing);}
function validGeometry(geometry,{allowPoint=false}={}){
  if(!geometry||typeof geometry!=='object')return false;
  if(geometry.type==='Point')return allowPoint&&validPosition(geometry.coordinates);
  if(geometry.type==='Polygon')return validPolygon(geometry.coordinates);
  return geometry.type==='MultiPolygon'&&Array.isArray(geometry.coordinates)&&geometry.coordinates.length>0&&geometry.coordinates.every(validPolygon);
}

/**
 * Identifiant RPG d’une parcelle : id_parcel (millésimes jusqu’à 2024), sinon « îlot-parcelle »
 * (num_parcel n’est unique que dans son îlot depuis 2025, RPG.LATEST), sinon num_parcel seul.
 */
export function rpgParcelKey(properties){
  const parcelId=identifier(property(properties,'id_parcel','ID_PARCEL'));
  if(parcelId!==null)return parcelId;
  const num=identifier(property(properties,'num_parcel','NUM_PARCEL'));
  if(num===null)return null;
  const ilot=identifier(property(properties,'num_ilot','NUM_ILOT'));
  return ilot!==null?`${ilot}-${num}`:num;
}

/** Stable within one RPG year; IDs of different years never overwrite each other. */
export function rpgFeatureId(feature,{year=2024}={}){
  year=checkedYear(year);
  const parcelId=rpgParcelKey(feature?.properties);
  if(parcelId!==null)return `rpg:${year}:parcel:${encodeURIComponent(parcelId)}`;
  const featureId=identifier(feature?.id);
  if(featureId!==null)return `rpg:${year}:feature:${encodeURIComponent(featureId)}`;
  throw new Error('Parcelle RPG sans identifiant stable : le chargement est interrompu pour éviter les doublons.');
}

/** Pure conversion; callers choose the owner/client and create the local record atomically. */
export function rpgFeatureToParcel(feature,{year=2024}={}){
  year=checkedYear(year);
  if(feature?.type!=='Feature'||!validGeometry(feature.geometry))throw new Error('La parcelle RPG possède une géométrie invalide ou hors WGS84.');
  const p=feature.properties||{},sourceId=rpgFeatureId(feature,{year});
  const id=rpgParcelKey(p)??identifier(feature.id);
  const rawSurface=property(p,'surf_parc','SURF_PARC');
  const surface=typeof rawSurface==='number'?rawSurface:typeof rawSurface==='string'?Number(rawSurface.trim().replace(',','.')):NaN;
  const cultureCode=String(property(p,'code_cultu','CODE_CULTU')??'');
  return{
    source:'rpg',sourceId,nom:`RPG ${id}`,
    geometry:structuredClone(feature.geometry),surfaceHa:Number.isFinite(surface)&&surface>=0?surface:geometryAreaHa(feature.geometry),
    culture:rpgCultureLabel(cultureCode,property(p,'nom_cultu','NOM_CULTU','lib_cultu','LIB_CULTU')??cultureCode),
    commune:String(property(p,'lib_commune','LIB_COMMUNE','commune','COMMUNE')??''),
    ilot:String(property(p,'num_ilot','NUM_ILOT')??''),
    rpgYear:year,rpgId:id,rpgCodeCulture:cultureCode,rpgCodeGroup:String(property(p,'code_group','CODE_GROUP')??'')
  };
}

function throwIfAborted(signal){
  if(signal?.aborted){const error=new Error('Chargement RPG annulé.');error.name='AbortError';throw error;}
}
function numericCount(value,label){
  if(value===undefined||value===null||value==='unknown')return null;
  if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')throw new Error(`Réponse RPG invalide : ${label} est incorrect.`);
  const count=Number(value);
  if(!Number.isSafeInteger(count)||count<0)throw new Error(`Réponse RPG invalide : ${label} est incorrect.`);
  return count;
}
function pageTotal(data){
  const matched=numericCount(data.numberMatched,'numberMatched'),total=numericCount(data.totalFeatures,'totalFeatures');
  if(matched!==null&&total!==null&&matched!==total)throw new Error('Réponse RPG incohérente : les nombres de parcelles annoncés diffèrent.');
  return matched??total;
}
function progress(callback,values){if(typeof callback==='function')callback(values);}
function partialError(message,loaded,total){
  return new Error(`${message} Chargement incomplet (${loaded}${total===null?'':` sur ${total}`} parcelles) ; aucune nouvelle couche n’a été validée. Réessayez ou réduisez la zone.`);
}

async function requestPage(url,{fetchImpl,signal,timeoutMs}){
  const controller=new AbortController();
  let timer,onAbort,timedOut=false;
  const interrupted=new Promise((_,reject)=>{
    onAbort=()=>{
      const error=new Error('Chargement RPG annulé.');error.name='AbortError';
      reject(error);controller.abort();
    };
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){onAbort();return;}
    timer=setTimeout(()=>{
      timedOut=true;
      reject(new Error('Le service RPG met trop de temps à répondre.'));
      controller.abort();
    },timeoutMs);
  });
  try{
    // Include the body download in the timeout; an interrupted fetch implementation
    // may also ignore AbortSignal, so aborting alone cannot guarantee completion.
    return await Promise.race([interrupted,(async()=>{
      throwIfAborted(signal);
      const response=await fetchImpl(url,{headers:{accept:'application/json'},signal:controller.signal});
      if(!response?.ok){
        const code=response?.status;
        let body='';try{body=typeof response?.text==='function'?await response.text():'';}catch{}
        if(/Unknown namespace|Unknown feature ?type|does not exist/i.test(body)){const error=new Error('Ce millésime RPG n’est pas encore publié par l’IGN.');error.code='rpg-year-unavailable';throw error;}
        throw new Error(code===429?'Le service RPG reçoit trop de demandes (429).':`Le service RPG est indisponible${code?` (${code})`:''}.`);
      }
      return await response.json();
    })()]);
  }catch(error){
    if(timedOut)throw new Error('Le service RPG met trop de temps à répondre.');
    if(error?.name==='TypeError')throw new Error('Connexion impossible au service RPG (réseau indisponible).');
    if(error?.name==='SyntaxError')throw new Error('La réponse du service RPG est illisible.');
    throw error;
  }finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort',onAbort);
  }
}

/**
 * Download every page before returning. No existing application data is mutated.
 * onProgress({loaded,total,page,received,done}): loaded is the unique parcel count;
 * total is null if absent from the service; received includes duplicates.
 */
export async function fetchRpgFeatures({geometry,year=2024,signal,onProgress,fetchImpl=fetch,requestTimeoutMs=REQUEST_TIMEOUT_MS}={}){
  year=checkedYear(year);
  if(!validGeometry(geometry,{allowPoint:true}))throw new Error('Zone de recherche RPG invalide : fournissez une géométrie WGS84 fermée.');
  if(typeof fetchImpl!=='function')throw new Error('Le chargement RPG est indisponible dans ce navigateur.');
  if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<=0||requestTimeoutMs>2147483647)throw new Error('Délai maximal RPG invalide.');
  throwIfAborted(signal);
  const unique=new Map();let start=0,received=0,total=null,page=0,duplicates=0;
  // Dernier millésime connu : si RPG.<année> n’existe pas (encore) sur le WFS, l’alias RPG.LATEST
  // le sert. Les entités gardent l’année réelle, jamais « LATEST ».
  const isLatest=year===latestYear;
  let viaLatest=isLatest&&(latestViaAlias===year||isRpgYearUnavailable(year));
  if(!viaLatest&&isRpgYearUnavailable(year)){const error=new Error('Ce millésime RPG n’est pas encore publié par l’IGN.');error.code='rpg-year-unavailable';throw error;}
  const bbox=geometryBbox(geometry);
  progress(onProgress,{loaded:0,total:null,page:0,received:0,done:false});
  while(page<MAX_PAGES){
    throwIfAborted(signal);
    const url=rpgPageUrl({year,bbox,start,typeName:rpgTypeName(viaLatest?'latest':year)});
    let data;
    try{
      data=await requestPage(url,{fetchImpl,signal,timeoutMs:requestTimeoutMs});
      throwIfAborted(signal);
    }catch(error){
      if(signal?.aborted||error?.name==='AbortError'){throwIfAborted({aborted:true});}
      if(error?.code==='rpg-year-unavailable'){
        if(isLatest&&!viaLatest&&page===0){viaLatest=true;latestViaAlias=year;continue;}
        if(!viaLatest)markRpgYearUnavailable(year);
        throw error;
      }
      throw partialError(error?.message||'La réponse du service RPG est illisible.',unique.size,total);
    }
    if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw partialError('Réponse RPG inattendue.',unique.size,total);
    let announced,returned;
    try{announced=pageTotal(data);returned=numericCount(data.numberReturned,'numberReturned');}
    catch(error){throw partialError(error.message,unique.size,total);}
    if(returned!==null&&returned!==data.features.length)throw partialError('Réponse RPG tronquée : le nombre de géométries ne correspond pas.',unique.size,total);
    if(announced!==null){
      if(total!==null&&announced!==total)throw partialError('Le total RPG a changé pendant le téléchargement.',unique.size,total);
      total=announced;
    }
    const previousSize=unique.size;
    for(const feature of data.features){
      if(feature?.type!=='Feature'||!validGeometry(feature.geometry)||!feature.properties||typeof feature.properties!=='object'||Array.isArray(feature.properties))throw partialError('Une parcelle RPG est mal formée.',unique.size,total);
      let id;
      try{id=rpgFeatureId(feature,{year});}
      catch(error){throw partialError(error.message,unique.size,total);}
      if(unique.has(id))duplicates++;else unique.set(id,feature);
    }
    page++;received+=data.features.length;
    if(total!==null&&unique.size>total)throw partialError('Le service RPG a renvoyé plus de parcelles que son total annoncé.',unique.size,total);
    // Never follow a server-provided next link; rebuild the official HTTPS URL with STARTINDEX.
    const hasNext=Array.isArray(data.links)&&data.links.some(link=>link?.rel==='next');
    let done=total!==null?unique.size===total:(!hasNext&&data.features.length<PAGE_SIZE);
    if(done&&hasNext)throw partialError('La pagination RPG annonce encore une page après le total attendu.',unique.size,total);
    if(!done&&data.features.length===0)throw partialError('Le service RPG a renvoyé une page vide avant la fin.',unique.size,total);
    if(data.features.length>0&&unique.size===previousSize)throw partialError('La pagination RPG ne progresse plus (page répétée).',unique.size,total);
    progress(onProgress,{loaded:unique.size,total,page,received,done});
    throwIfAborted(signal);
    if(done)return{
      type:'FeatureCollection',features:[...unique.values()],totalFeatures:unique.size,numberMatched:unique.size,numberReturned:unique.size,
      rpg:{year,pages:page,received,duplicates,latest:viaLatest}
    };
    start+=data.features.length;
    if(!Number.isSafeInteger(start))throw partialError('La pagination RPG dépasse les capacités du navigateur.',unique.size,total);
  }
  throw partialError('Le service RPG n’a pas terminé sa pagination.',unique.size,total);
}

// --- Millésime réel de RPG.LATEST (source du registre auto-update.js, contrat W0) ---
// Le GetCapabilities complet pèse plus de 5 Mo : on ne lit que l’espace RPG.LATEST (environ 130 Ko).
export const RPG_LATEST_CAPABILITIES_URL=`${RPG_WFS_URL}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=2.0.0&NAMESPACE=RPG.LATEST`;
export const RPG_LATEST_MAX_BYTES=600*1024;

/** Année tirée du Title de RPG.LATEST:parcelles_graphiques (« … (RPG) 2025 : Parcelles graphiques »), sinon null. */
export function parseRpgLatestYear(xml){
  const text=String(xml??'');
  const blocks=text.match(/<(?:[\w.-]+:)?FeatureType\b[\s\S]*?<\/(?:[\w.-]+:)?FeatureType>/g)||[];
  const block=blocks.find(item=>/<(?:[\w.-]+:)?Name>\s*[^<]*parcelles_graphiques\s*<\//i.test(item));
  if(!block)return null;
  const title=/<(?:[\w.-]+:)?Title>([\s\S]*?)<\//.exec(block)?.[1]||'';
  const match=/RPG\)\s*(\d{4})\s*:/.exec(title);
  return match?Number(match[1]):null;
}

/** Lit le corps texte en s’arrêtant au-delà de maxBytes (erreur code 'too-large'). */
export async function readTextLimited(response,maxBytes){
  const tooLarge=()=>{const error=new Error('Réponse trop volumineuse.');error.code='too-large';return error;};
  const declared=Number(response?.headers?.get?.('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)throw tooLarge();
  const reader=response?.body?.getReader?.();
  if(!reader){
    const text=await response.text();
    if(new TextEncoder().encode(text).byteLength>maxBytes)throw tooLarge();
    return text;
  }
  const decoder=new TextDecoder();let size=0,out='';
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>maxBytes){try{await reader.cancel();}catch{}throw tooLarge();}
    out+=decoder.decode(value,{stream:true});
  }
  return out+decoder.decode();
}

export const rpgLatestSource=Object.freeze({
  id:'rpg-latest',label:'Registre parcellaire (RPG)',ttlMs:7*24*3600*1000,
  embedded:Object.freeze({value:Object.freeze({year:2024}),version:'2024',label:'millésime 2024'}),
  async check({fetch,signal}={}){
    const response=await fetch(RPG_LATEST_CAPABILITIES_URL,{signal,headers:{accept:'application/xml'}});
    if(!response?.ok)throw new Error(`Service RPG indisponible${response?.status?` (${response.status})`:''}.`);
    const year=parseRpgLatestYear(await readTextLimited(response,RPG_LATEST_MAX_BYTES));
    if(!year)throw new Error('Millésime RPG introuvable dans la réponse de l’IGN.');
    return{value:{year},version:String(year)};
  },
  validate(result){
    const year=result?.value?.year;
    return Number.isSafeInteger(year)&&year>=RPG_OLDEST_YEAR&&year<=new Date().getFullYear();
  }
});
