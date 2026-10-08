// Premier lancement « carte d’abord » : logique pure (testable sous Node) et écriture
// groupée des parcelles choisies sur la couche PAC/RPG. Aucune donnée nominative :
// le RPG publié par l’IGN est anonyme, c’est l’utilisateur qui désigne ses îlots.
import {clone,formatNumber,uid,validateParcel} from './utils.js';
import {normalizeEntity} from './state.js';
import {rpgFeatureId,rpgFeatureToParcel} from './rpg.js';

export const GEOCODE_URL='https://data.geopf.fr/geocodage/search';
export const RPG_FALLBACK_YEAR=2024;
export const ONBOARDING_RPG_RADIUS_KM=2.5;
export const BATCH_LIMIT=300;

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

// Millésime N-1 d’abord (dernière déclaration connue), puis 2024, déjà éprouvé par la carte.
export function onboardingRpgYears(now=new Date()){
  const previous=now.getFullYear()-1;
  return [...new Set([previous,RPG_FALLBACK_YEAR])].filter(year=>Number.isSafeInteger(year)&&year>=2015&&year<=previous);
}

export function geocodeUrl(commune){
  const query=String(commune??'').replace(/\s+/g,' ').trim();
  if(query.length<2)return null;
  const url=new URL(GEOCODE_URL);
  url.search=new URLSearchParams({q:query.slice(0,120),index:'address',type:'municipality',limit:'5'}).toString();
  return url.href;
}

// Réponse GeoJSON de la Géoplateforme → premières communes exploitables.
export function parseGeocode(data){
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))return[];
  return data.features.map(feature=>{
    const [longitude,latitude]=Array.isArray(feature?.geometry?.coordinates)?feature.geometry.coordinates:[];
    const p=feature?.properties||{};
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
    const name=String(p.city||p.name||p.label||'').trim();
    return name?{name,postcode:String(p.postcode||'').trim(),latitude,longitude}:null;
  }).filter(Boolean);
}

export function featureSurfaceHa(feature,year=RPG_FALLBACK_YEAR){
  try{return rpgFeatureToParcel(feature,{year}).surfaceHa||0;}catch{return 0;}
}

export function selectionSummary(features,year=RPG_FALLBACK_YEAR){
  const list=Array.isArray(features)?features:[];
  const surfaceHa=list.reduce((sum,feature)=>sum+featureSurfaceHa(feature,year),0);
  return{count:list.length,surfaceHa:Math.round(surfaceHa*100)/100};
}

// « 0 parcelle · 0 ha », « 1 parcelle · 4,2 ha », « 12 parcelles · 84,3 ha ».
export function countLabel(count,surfaceHa){
  const n=Number(count)||0;
  return `${formatNumber(n)} parcelle${n>1?'s':''} · ${formatNumber(Math.round((Number(surfaceHa)||0)*10)/10)} ha`;
}

// Noms provisoires : « Îlot 3 - P2 » quand le RPG fournit l’îlot, sinon « Parcelle PAC 4 ».
// La numérotation reprend après les noms déjà présents pour ne jamais créer d’homonyme.
function provisionalNamer(parcels){
  const used=new Map();let generic=0;
  for(const parcel of parcels||[]){
    const name=String(parcel?.nom||'');
    const pac=/^Parcelle PAC (\d+)$/.exec(name);if(pac){generic=Math.max(generic,Number(pac[1]));continue;}
    const ilot=/^Îlot (.+) - P(\d+)$/.exec(name);if(ilot)used.set(ilot[1],Math.max(used.get(ilot[1])||0,Number(ilot[2])));
  }
  return ilot=>{
    const key=String(ilot||'').trim();
    if(!key){generic+=1;return `Parcelle PAC ${generic}`;}
    const next=(used.get(key)||0)+1;used.set(key,next);return `Îlot ${key} - P${next}`;
  };
}

/** Conversion pure d’un lot : noms provisoires, culture lisible, doublons écartés. */
export function rpgBatchParcels(features,{year=RPG_FALLBACK_YEAR,existing=[]}={}){
  const known=new Set((existing||[]).map(parcel=>parcel?.sourceId).filter(Boolean));
  const parcels=[],skipped=[],nameFor=provisionalNamer(existing);
  for(const feature of features||[]){
    let base,sourceId;
    try{base=rpgFeatureToParcel(feature,{year});sourceId=rpgFeatureId(feature,{year});}
    catch{skipped.push({reason:'invalid'});continue;}
    if(known.has(sourceId)){skipped.push({reason:'duplicate',sourceId});continue;}
    known.add(sourceId);
    parcels.push({...base,sourceId,nom:nameFor(base.ilot),culture:rpgCultureLabel(base.rpgCodeCulture,base.culture),ownershipType:'own',clientId:null,status:'À jour'});
  }
  return{parcels,skipped};
}

export function farmSummary(parcels){
  const list=(parcels||[]).filter(parcel=>parcel&&!parcel.deletedAt);
  const surfaceHa=list.reduce((sum,parcel)=>sum+(Number(parcel.surfaceHa)||0),0);
  return{count:list.length,surfaceHa:Math.round(surfaceHa*10)/10};
}

export function farmSummaryLabel({count,surfaceHa}){
  return `${formatNumber(count)} parcelle${count>1?'s':''}, ${formatNumber(surfaceHa)} ha`;
}

/**
 * Écrit le lot en une seule mutation, après un point de restauration local :
 * l’import apparaît dans l’historique et s’annule via rollbackImportSession.
 */
export function addRpgParcelsBatch(store,features,{year=RPG_FALLBACK_YEAR}={}){
  const input=clone(features||[]);
  if(!input.length)return Promise.reject(new Error('Touchez au moins une parcelle sur la carte.'));
  if(input.length>BATCH_LIMIT)return Promise.reject(new Error(`Sélectionnez au plus ${BATCH_LIMIT} parcelles à la fois.`));
  return store.enqueueWrite(async()=>{
    if(store.writeGuard&&!store.writeGuard({entity:'parcelles',action:'create'}))throw new Error('Votre rôle ne permet pas cette modification.');
    const {parcels:rows,skipped}=rpgBatchParcels(input,{year,existing:store.state.parcelles});
    if(!rows.length)return{created:0,skipped:skipped.length,surfaceHa:0,sessionId:null,parcels:[]};
    const parcels=rows.map(row=>normalizeEntity('parcelles',row));
    for(const parcel of parcels){const errors=validateParcel(parcel);if(errors.length)throw new Error(`${parcel.nom} : ${errors.join(' — ')}`);}
    const timestamp=Date.now(),sessionId=uid('import_session'),rollbackBackupId=`preimport_${sessionId}`;
    await store.storage.backupPut({id:rollbackBackupId,period:'preimport',createdAt:timestamp,state:store.snapshot()});
    const surfaceHa=Math.round(parcels.reduce((sum,parcel)=>sum+(Number(parcel.surfaceHa)||0),0)*100)/100;
    const session=normalizeEntity('importSessions',{id:sessionId,fileNames:[`Carte PAC (RPG ${year})`],created:parcels.length,updated:0,skipped:skipped.length,interventions:0,surface:surfaceHa,strategy:'rpg-onboarding',rollbackBackupId,source:'local'});
    await store._mutate(`Parcelles PAC ajoutées : ${parcels.length}`,state=>{
      for(const parcel of parcels){state.parcelles.push(parcel);store.queue({entity:'parcelles',entityId:parcel.id,action:'create',payload:clone(parcel)});}
      state.importSessions.push(session);state.metadata.lastImportAt=timestamp;
    },{entity:'parcelles',action:'create',kind:'import',queue:false});
    return{created:parcels.length,skipped:skipped.length,surfaceHa,sessionId,parcels:clone(parcels)};
  });
}
