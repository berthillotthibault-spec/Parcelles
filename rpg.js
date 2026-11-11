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

export function rpgCultureLabel(code,fallback=''){
  const key=String(code??'').trim().toUpperCase();
  return RPG_CULTURE_LABELS[key]||String(fallback||key||'').trim();
}

// API Carto (apicarto.ign.fr) a fermé fin 2026 : le RPG est lu sur le WFS de la Géoplateforme,
// une couche par millésime (RPG.<année>:parcelles_graphiques). Un millésime pas encore publié
// répond « Unknown namespace » : il est mémorisé et l’année précédente est essayée.
export const RPG_WFS_URL='https://data.geopf.fr/wfs/ows';
const PAGE_SIZE=1000;
const MAX_PAGES=10000; // Fail explicitly if a broken server never reaches its end.
const REQUEST_TIMEOUT_MS=30000;
const UNAVAILABLE_YEARS=new Set();
export function rpgTypeName(year){return `RPG.${checkedYear(year)}:parcelles_graphiques`;}
export function isRpgYearUnavailable(year){return UNAVAILABLE_YEARS.has(Number(year));}
export function markRpgYearUnavailable(year){UNAVAILABLE_YEARS.add(Number(year));}
export function resetRpgYearCache(){UNAVAILABLE_YEARS.clear();}
/** Emprise [ouest,sud,est,nord] d’une géométrie WGS84 (un point devient un carré d’environ 50 m). */
export function geometryBbox(geometry){
  let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;
  const visit=c=>{if(typeof c[0]==='number'){w=Math.min(w,c[0]);e=Math.max(e,c[0]);s=Math.min(s,c[1]);n=Math.max(n,c[1]);}else c.forEach(visit);};
  visit(geometry.coordinates);
  if(geometry.type==='Point'){const d=.00025;w-=d;e+=d;s-=d;n+=d;}
  return[w,s,e,n];
}
export function rpgPageUrl({year,bbox,start=0,count=PAGE_SIZE}){
  const params=new URLSearchParams({SERVICE:'WFS',VERSION:'2.0.0',REQUEST:'GetFeature',TYPENAMES:rpgTypeName(year),OUTPUTFORMAT:'application/json',SRSNAME:'CRS:84',BBOX:`${bbox.map(v=>Number(v).toFixed(6)).join(',')},CRS:84`,COUNT:String(count),STARTINDEX:String(start)});
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

/** Stable within one RPG year; IDs of different years never overwrite each other. */
export function rpgFeatureId(feature,{year=2024}={}){
  year=checkedYear(year);
  const parcelId=identifier(property(feature?.properties,'id_parcel','ID_PARCEL','num_parcel','NUM_PARCEL'));
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
  const id=identifier(property(p,'id_parcel','ID_PARCEL','num_parcel','NUM_PARCEL'))??identifier(feature.id);
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
  if(UNAVAILABLE_YEARS.has(year)){const error=new Error('Ce millésime RPG n’est pas encore publié par l’IGN.');error.code='rpg-year-unavailable';throw error;}
  const bbox=geometryBbox(geometry);
  progress(onProgress,{loaded:0,total:null,page:0,received:0,done:false});
  while(page<MAX_PAGES){
    throwIfAborted(signal);
    const url=rpgPageUrl({year,bbox,start});
    let data;
    try{
      data=await requestPage(url,{fetchImpl,signal,timeoutMs:requestTimeoutMs});
      throwIfAborted(signal);
    }catch(error){
      if(signal?.aborted||error?.name==='AbortError'){throwIfAborted({aborted:true});}
      if(error?.code==='rpg-year-unavailable'){UNAVAILABLE_YEARS.add(year);throw error;}
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
      rpg:{year,pages:page,received,duplicates}
    };
    start+=data.features.length;
    if(!Number.isSafeInteger(start))throw partialError('La pagination RPG dépasse les capacités du navigateur.',unique.size,total);
  }
  throw partialError('Le service RPG n’a pas terminé sa pagination.',unique.size,total);
}
