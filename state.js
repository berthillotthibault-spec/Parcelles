// @ts-check
import {PERSONALIZATION_DEFAULTS,normalizePersonalization} from './personalization.js';
import {HISTORY_MAX_AGE_DAYS,HISTORY_MAX_PER_ENTITY,buildHistoryEntry,isMeaningfulEntry,shouldRecordHistory} from './history.js';
import {APP_VERSION, ENTITY_TYPES, campaignFor, clone, isoDate, now, parseImportDate, toNumber, uid, validateIntervention, validateParcel} from './utils.js';

/** @returns {import('parcelles/types').AppState} État vierge au format APP_VERSION. */
export function emptyState(){
  const timestamp=now();
  return {
    version:APP_VERSION,
    exploitation:{
      id:'farm_local',nom:'Mon exploitation',commune:'',latitude:null,longitude:null,
      createdAt:timestamp,updatedAt:timestamp
    },
    campagnes:[],
    parcelles:[],interventions:[],tasks:[],rotations:[],grazingSessions:[],materiels:[],products:[],clients:[],documents:[],photos:[],points:[],templates:[],importSessions:[],syncConflicts:[],notifications:[],observations:[],stockItems:[],stockMovements:[],maintenanceRecords:[],routeSessions:[],fieldSessions:[],chantiers:[],members:[],assistantMessages:[],devices:[],automationRules:[],automationRuns:[],gpsTracks:[],integrationImports:[],weatherStations:[],platformJobs:[],platformEvents:[],vetTreatments:[],
    preferences:{
      ...PERSONALIZATION_DEFAULTS,mapLayer:'osm',mapColorMode:'culture',theme:'system',gpsConsent:false,
      autoBackup:true,syncEnabled:false,workspaceId:'',cloudRole:null,syncAttachments:true,syncWifiOnly:false,syncAttachmentsWifiOnly:false,syncRetryMax:5,syncRetryBaseSeconds:15,syncAutoMerge:true,weatherDays:7,
      routeProvider:'apple',highContrast:false,onboardingComplete:false,defaultOperator:'',fuelPrice:1.7,weatherWindThreshold:35,weatherRainThreshold:5,homeCards:['weather','today','tasks','alerts','recent','campaign'],notificationsEnabled:false,compactMode:false,remoteAiEnabled:false,remoteAiEndpoint:'',voiceEnabled:true,assistantHistory:true,assistantLocalFirst:true,assistantVoiceReplies:false,assistantTerrainContext:true,integrationAutoMatch:true,stationWeatherEnabled:false,platformBackendEnabled:false,platformApiEndpoint:'',platformAutoJobs:false,platformIsolation:true,fieldAutoDetect:true,fieldKeepAwake:false,automationEnabled:true,autoSync:true,autoSyncMinutes:5,nativeNotifications:true,nativeNotificationActions:true,nativeHaptics:true,nativeCameraEnabled:true,nativeStatusBar:true,biometricLock:false,biometricLockMinutes:5,automationEventTriggers:true,automationMaxActionsPerRun:25,securityAuditEnabled:true,encryptedExportIterations:600000
    },
    metadata:{
      createdAt:timestamp,updatedAt:timestamp,lastImportAt:null,lastSyncAt:null,lastWeatherAt:null,
      revision:0,lastAutoBackupDay:null,lastBuildId:null,syncCursors:{},automationLastRunAt:null,nativeLastUnlockAt:null,nativeLastBackgroundAt:null,nativeLastPlatform:null,automationLastEventAt:null,lastSyncError:null,syncFailureCount:0,syncBackoffUntil:null,lastSecurityReviewAt:null,assistantLastIntent:null,assistantLastLocalAt:null,lastIntegrationAt:null,lastStationImportAt:null,lastPlatformHealthAt:null,lastPlatformStatus:null,lastWorkspaceSwitchAt:null
    },
    queue:[],journal:[]
  };
}

export function normalizeEntity(type,entity,existing=null,{preserveDeleted=false}={}){
  const timestamp=now();
  const base=existing||{};
  const normalized={
    ...base,
    ...clone(entity),
    id:entity.id||base.id||uid(type.slice(0,-1)),
    createdAt:base.createdAt||entity.createdAt||timestamp,
    updatedAt:timestamp,
    deletedAt:preserveDeleted ? (entity.deletedAt ?? base.deletedAt ?? null) : null,
    source:entity.source||base.source||'local',
    sourceId:entity.sourceId??base.sourceId??null,
    version:(base.version||entity.version||0)+(existing?1:0)
  };
  if(type==='interventions'){
    normalized.date=parseImportDate(normalized.date)||normalized.date;
    normalized.campaignId=normalized.campaignId||campaignFor(normalized.date);
    normalized.status=normalized.status||'Terminé';
  }
  if(type==='tasks')normalized.status=normalized.status||'À faire';
  if(type==='parcelles'){
    normalized.ownershipType=normalized.ownershipType||'own';
    normalized.favorite=Boolean(normalized.favorite);
    normalized.notes=normalized.notes||'';
  }
  if(type==='documents'||type==='photos'){
    normalized.category=normalized.category||(type==='photos'?'Photo / constat':'Autre');
    normalized.tags=Array.isArray(normalized.tags)?normalized.tags.map(tag=>String(tag||'').trim()).filter(Boolean).slice(0,20):String(normalized.tags||'').split(/[;,]/).map(tag=>tag.trim()).filter(Boolean).slice(0,20);
    normalized.documentDate=parseImportDate(normalized.documentDate)||isoDate(normalized.capturedAt||normalized.createdAt||timestamp);
    for(const key of ['parcelId','interventionId','equipmentId','clientId','chantierId'])normalized[key]=normalized[key]||null;
  }
  return normalized;
}


function stringArray(value){
  if(Array.isArray(value))return value.map(item=>String(item??'').trim()).filter(Boolean);
  if(value===null||value===undefined||value==='')return[];
  return String(value).split(/[;,\n]/).map(item=>item.trim()).filter(Boolean);
}

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function sanitizeCurrentShape(data){
  // Harden nested collections even when the stored state already reports the current schema version.
  // This prevents malformed/legacy restored data from crashing secondary modules.
  data.routeSessions=data.routeSessions.map(item=>({...item,parcelIds:stringArray(item.parcelIds),completedParcelIds:stringArray(item.completedParcelIds)}));
  data.chantiers=data.chantiers.map(item=>({...item,parcelIds:stringArray(item.parcelIds)}));
  data.documents=data.documents.map(item=>({...item,tags:stringArray(item.tags)}));
  data.photos=data.photos.map(item=>({...item,tags:stringArray(item.tags)}));
  data.automationRules=data.automationRules.map(item=>({...item,conditions:Array.isArray(item.conditions)?item.conditions:[],actions:Array.isArray(item.actions)?item.actions:[]}));
  data.automationRuns=data.automationRuns.map(item=>({...item,actions:Array.isArray(item.actions)?item.actions:[]}));
  data.gpsTracks=data.gpsTracks.map(item=>({...item,points:Array.isArray(item.points)?item.points:[],matchedParcels:Array.isArray(item.matchedParcels)?item.matchedParcels:[]}));
  data.weatherStations=data.weatherStations.map(item=>({...item,readings:Array.isArray(item.readings)?item.readings:[]}));
  Object.assign(data.preferences,normalizePersonalization(data.preferences));
  if(!isRecord(data.metadata.syncCursors))data.metadata.syncCursors={};
  data.metadata.revision=Math.max(0,Number(data.metadata.revision)||0);
  return data;
}

function ensureArrays(data){
  ENTITY_TYPES.forEach(type=>{data[type]=Array.isArray(data[type])?data[type].filter(isRecord):[];});
  if(!Array.isArray(data.campagnes))data.campagnes=[];
  data.queue=Array.isArray(data.queue)?data.queue.filter(isRecord):[];
  data.journal=Array.isArray(data.journal)?data.journal.filter(isRecord):[];
}

export function migrateData(input){
  let data=clone(isRecord(input)?input:{});
  const base=emptyState();
  ensureArrays(data);
  for(const key of ['preferences','metadata','exploitation'])if(!isRecord(data[key]))data[key]={};
  // Normalize before merging defaults so old 2.2 s defaults migrate only once.
  Object.assign(data.preferences,normalizePersonalization(data.preferences));
  if(!data.version)data.version=1;

  if(data.version<2){
    if(Array.isArray(data.parcelles))data.parcelles=data.parcelles.map(parcel=>({...parcel,nom:parcel.nom||parcel.name||parcel.Nom||'Sans nom',surfaceHa:toNumber(parcel.surfaceHa??parcel.surface??0)}));
    const interventions=data.interventions.length?data.interventions:(Array.isArray(data.manualInterventions)?data.manualInterventions.filter(isRecord):[]);
    data.interventions=interventions.map(item=>({...item,parcelId:item.parcelId||item.parcelleId||item.parcel_id,date:item.date||new Date().toISOString(),type:item.type||item.operation||'Travail'}));
    data.version=2;
  }
  if(data.version<3){
    data={...base,...data,metadata:{...base.metadata,...data.metadata},preferences:{...base.preferences,...data.preferences},queue:data.queue||[],journal:data.journal||[]};
    ensureArrays(data);
    ENTITY_TYPES.filter(type=>Array.isArray(data[type])).forEach(type=>{data[type]=data[type].map(entity=>normalizeEntity(type,entity,null,{preserveDeleted:true}));});
    data.version=3;
  }
  if(data.version<4){
    data={...base,...data,
      exploitation:{...base.exploitation,...data.exploitation},
      preferences:{...base.preferences,...data.preferences},
      metadata:{...base.metadata,...data.metadata}
    };
    ensureArrays(data);
    data.parcelles=data.parcelles.map(parcel=>normalizeEntity('parcelles',{
      ownershipType:'own',clientId:null,exploitant:'',notes:'',favorite:false,agronomic:{},economics:{},fieldOverrides:{},
      ...parcel
    },null,{preserveDeleted:true}));
    data.interventions=data.interventions.map(item=>normalizeEntity('interventions',{
      status:item.status||'Terminé',plannedDate:item.plannedDate||null,doseUnit:item.doseUnit||'',productUnitPrice:item.productUnitPrice??null,
      machineCost:item.machineCost??0,inputCost:item.inputCost??0,operatorCost:item.operatorCost??0,otherCost:item.otherCost??0,
      ...item
    },null,{preserveDeleted:true}));
    data.version=4;
  }


  if(data.version<5){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.version=5;
  }

  if(data.version<6){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.stockItems=data.stockItems.map(item=>normalizeEntity('stockItems',{category:'Intrant',unitPrice:null,...item},null,{preserveDeleted:true}));
    data.parcelles=data.parcelles.map(parcel=>({...parcel,economicsByCampaign:parcel.economicsByCampaign||((parcel.economics&&Object.keys(parcel.economics).length)?{[campaignFor()]:clone(parcel.economics)}:{})}));
    data.version=6;
  }


  if(data.version<7){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.version=7;
  }

  if(data.version<8){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.observations=data.observations.map(item=>normalizeEntity('observations',{status:item.resolvedAt?'Résolu':'À surveiller',latitude:null,longitude:null,...item},null,{preserveDeleted:true}));
    data.version=8;
  }

  if(data.version<9){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.documents=data.documents.map(item=>normalizeEntity('documents',{category:item.category||'Autre',tags:item.tags||[],documentDate:item.documentDate||isoDate(item.capturedAt||item.createdAt),equipmentId:item.equipmentId||null,clientId:item.clientId||null,chantierId:item.chantierId||null,...item},null,{preserveDeleted:true}));
    data.photos=data.photos.map(item=>normalizeEntity('photos',{category:item.category||'Photo / constat',tags:item.tags||[],documentDate:item.documentDate||isoDate(item.capturedAt||item.createdAt),equipmentId:item.equipmentId||null,clientId:item.clientId||null,chantierId:item.chantierId||null,...item},null,{preserveDeleted:true}));
    data.version=9;
  }

  if(data.version<10){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.automationRules=(data.automationRules||[]).map(item=>normalizeEntity('automationRules',{enabled:true,action:'notify',cooldownHours:12,threshold:1,lastRunAt:null,lastResult:null,...item},null,{preserveDeleted:true}));
    data.automationRuns=(data.automationRuns||[]).map(item=>normalizeEntity('automationRuns',item,null,{preserveDeleted:true}));
    data.version=10;
  }

  if(data.version<11){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.preferences.nativeNotifications=data.preferences.nativeNotifications!==false;
    data.preferences.nativeNotificationActions=data.preferences.nativeNotificationActions!==false;
    data.preferences.nativeHaptics=data.preferences.nativeHaptics!==false;
    data.preferences.nativeCameraEnabled=data.preferences.nativeCameraEnabled!==false;
    data.preferences.nativeStatusBar=data.preferences.nativeStatusBar!==false;
    data.preferences.biometricLock=Boolean(data.preferences.biometricLock);
    data.preferences.biometricLockMinutes=Math.max(0,Number(data.preferences.biometricLockMinutes??5)||0);
    data.metadata.nativeLastBackgroundAt=data.metadata.nativeLastBackgroundAt||null;
    data.metadata.nativeLastPlatform=data.metadata.nativeLastPlatform||null;
    data.version=11;
  }


  if(data.version<12){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.preferences.automationEventTriggers=data.preferences.automationEventTriggers!==false;
    data.preferences.automationMaxActionsPerRun=Math.min(100,Math.max(1,Number(data.preferences.automationMaxActionsPerRun??25)||25));
    data.automationRules=(data.automationRules||[]).map(item=>normalizeEntity('automationRules',{
      kind:item.kind||'custom',target:item.target||null,trigger:item.trigger||'interval',triggerEntity:item.triggerEntity||item.target||null,
      matchMode:item.matchMode==='any'?'any':'all',conditions:Array.isArray(item.conditions)?item.conditions:[],
      actions:Array.isArray(item.actions)&&item.actions.length?item.actions:[{type:item.action||'notify'}],
      maxMatches:Math.min(200,Math.max(1,Number(item.maxMatches??50)||50)),enabled:item.enabled!==false,
      cooldownHours:Number(item.cooldownHours??12)||0,lastRunAt:item.lastRunAt||null,lastResult:item.lastResult||null,...item
    },null,{preserveDeleted:true}));
    data.automationRuns=(data.automationRuns||[]).map(item=>normalizeEntity('automationRuns',item,null,{preserveDeleted:true}));
    data.metadata.automationLastEventAt=data.metadata.automationLastEventAt||null;
    data.version=12;
  }

  if(data.version<13){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.preferences.syncWifiOnly=Boolean(data.preferences.syncWifiOnly);
    data.preferences.syncAttachmentsWifiOnly=Boolean(data.preferences.syncAttachmentsWifiOnly);
    data.preferences.syncRetryMax=Math.min(12,Math.max(1,Number(data.preferences.syncRetryMax??5)||5));
    data.preferences.syncRetryBaseSeconds=Math.min(300,Math.max(5,Number(data.preferences.syncRetryBaseSeconds??15)||15));
    data.preferences.syncAutoMerge=data.preferences.syncAutoMerge!==false;
    data.preferences.securityAuditEnabled=data.preferences.securityAuditEnabled!==false;
    data.preferences.encryptedExportIterations=Math.min(1000000,Math.max(100000,Number(data.preferences.encryptedExportIterations??600000)||600000));
    data.metadata.lastSyncError=data.metadata.lastSyncError||null;
    data.metadata.syncFailureCount=Number(data.metadata.syncFailureCount||0);
    data.metadata.syncBackoffUntil=data.metadata.syncBackoffUntil||null;
    data.metadata.lastSecurityReviewAt=data.metadata.lastSecurityReviewAt||null;
    data.queue=(data.queue||[]).map(item=>({...item,attempts:Number(item.attempts||0),lastError:item.lastError||null,nextRetryAt:Number(item.nextRetryAt||0),firstQueuedAt:Number(item.firstQueuedAt||item.createdAt||Date.now())}));
    data.version=13;
  }

  if(data.version<14){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.preferences.assistantLocalFirst=data.preferences.assistantLocalFirst!==false;
    data.preferences.assistantVoiceReplies=Boolean(data.preferences.assistantVoiceReplies);
    data.preferences.assistantTerrainContext=data.preferences.assistantTerrainContext!==false;
    data.metadata.assistantLastIntent=data.metadata.assistantLastIntent||null;
    data.metadata.assistantLastLocalAt=data.metadata.assistantLastLocalAt||null;
    data.version=14;
  }

  if(data.version<15){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.preferences.integrationAutoMatch=data.preferences.integrationAutoMatch!==false;
    data.preferences.stationWeatherEnabled=Boolean(data.preferences.stationWeatherEnabled);
    data.gpsTracks=(data.gpsTracks||[]).map(item=>normalizeEntity('gpsTracks',{format:item.format||'GPS',points:Array.isArray(item.points)?item.points:[],matchedParcels:Array.isArray(item.matchedParcels)?item.matchedParcels:[],...item},null,{preserveDeleted:true}));
    data.integrationImports=(data.integrationImports||[]).map(item=>normalizeEntity('integrationImports',item,null,{preserveDeleted:true}));
    data.weatherStations=(data.weatherStations||[]).map(item=>normalizeEntity('weatherStations',{readings:Array.isArray(item.readings)?item.readings:[],...item},null,{preserveDeleted:true}));
    data.metadata.lastIntegrationAt=data.metadata.lastIntegrationAt||null;
    data.metadata.lastStationImportAt=data.metadata.lastStationImportAt||null;
    data.version=15;
  }


  if(data.version<16){
    data={...base,...data,preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
    ensureArrays(data);
    data.preferences.platformBackendEnabled=Boolean(data.preferences.platformBackendEnabled);
    data.preferences.platformApiEndpoint=String(data.preferences.platformApiEndpoint||'').trim();
    data.preferences.platformAutoJobs=Boolean(data.preferences.platformAutoJobs);
    data.preferences.platformIsolation=data.preferences.platformIsolation!==false;
    data.platformJobs=(data.platformJobs||[]).map(item=>normalizeEntity('platformJobs',{status:item.status||'local',type:item.type||'generic',attempts:Number(item.attempts||0),...item},null,{preserveDeleted:true}));
    data.platformEvents=(data.platformEvents||[]).map(item=>normalizeEntity('platformEvents',item,null,{preserveDeleted:true}));
    data.metadata.lastPlatformHealthAt=data.metadata.lastPlatformHealthAt||null;
    data.metadata.lastPlatformStatus=data.metadata.lastPlatformStatus||null;
    data.metadata.lastWorkspaceSwitchAt=data.metadata.lastWorkspaceSwitchAt||null;
    data.version=16;
  }
  if(data.version<17){
    // v17 : carnet sanitaire (n° 76), nouvelle collection vetTreatments.
    if(!Array.isArray(data.vetTreatments))data.vetTreatments=[];
    data.version=17;
  }

  data={...base,...data,
    version:APP_VERSION,
    exploitation:{...base.exploitation,...data.exploitation},
    preferences:{...base.preferences,...data.preferences},
    metadata:{...base.metadata,...data.metadata}
  };
  // v6b n° 76 — carnet sanitaire : collection absente des anciennes sauvegardes.
  if(!Array.isArray(data.vetTreatments))data.vetTreatments=[];
  ensureArrays(data);
  sanitizeCurrentShape(data);
  return data;
}

function validate(type,entity){
  if(type==='parcelles')return validateParcel(entity);
  if(type==='interventions')return validateIntervention(entity);
  if(type==='rotations'){
    const errors=[];
    if(!entity.parcelId)errors.push('Parcelle obligatoire');
    if(!entity.campaignId)errors.push('Campagne obligatoire');
    if(!String(entity.culture||'').trim())errors.push('Culture obligatoire');
    return errors;
  }
  return [];
}

// Empreinte de la dernière écriture d’un état (révision + horodatage) : sert à détecter
// qu’un autre onglet a enregistré entre-temps. null quand rien n’est stocké.
export function stateStamp(value){if(!value||typeof value!=='object')return null;const meta=value.metadata||{};return `${Math.max(0,Number(meta.revision)||0)}:${meta.updatedAt??''}`;}
// n° 118 : exploitation de démonstration, espace séparé jamais synchronisé ni sauvegardé.
export const DEMO_WORKSPACE_ID='demo';
export const isDemoState=data=>Boolean(data?.metadata?.demo);
export const TAB_READ_ONLY_MESSAGE='Parcelles est ouvert dans une autre fenêtre : celle-ci est en lecture seule. Touchez « Utiliser ici » pour y travailler.';
function concurrentWriteError(cause){const error=new Error('Parcelles a été modifié dans une autre fenêtre. Les données affichées ont été rechargées : recommencez votre dernière action.');error.name='StaleStateError';error.cause=cause;return error;}
function tabReadOnlyError(message){const error=new Error(message||TAB_READ_ONLY_MESSAGE);error.name='TabReadOnlyError';return error;}

// Garde de version du schéma : des données écrites par une version plus récente de Parcelles
// ne sont ni migrées ni réécrites par ce build (elles seraient rétrogradées sans avertissement).
export function storedSchemaVersion(value){const version=Number(value?.version);return Number.isFinite(version)&&version>0?Math.floor(version):null;}
export function isNewerSchema(value){const version=storedSchemaVersion(value);return version!==null&&version>APP_VERSION;}
export const NEWER_SCHEMA_MESSAGE='Vos données viennent d’une version plus récente de Parcelles. Mettez à jour l’application pour les modifier : rien n’est enregistré ici en attendant.';
export function newerSchemaError(version,message=NEWER_SCHEMA_MESSAGE){const error=/** @type {Error & {storedVersion?:number|null, appVersion?:number}} */(new Error(message));error.name='SchemaVersionError';error.storedVersion=version??null;error.appVersion=APP_VERSION;return error;}
// Instantanés pris avant une migration montante : jamais élagués par la rotation quotidienne, 2 au plus par espace.
export const PRE_MIGRATION_BACKUP_LIMIT=2;

// n° 137 (étape 2) : stockage par collection. Empreinte JSON de chaque clé de premier niveau de l’état ; comparée à celle
// de la dernière lecture ou écriture, elle désigne les seules collections à réécrire. L’état est du JSON (sauvegardes,
// synchronisation) : cette empreinte voit toute modification utile, y compris une fiche modifiée sur place.
export function collectionFingerprints(state){const map=new Map();for(const name of Object.keys(state||{}))map.set(name,JSON.stringify(state[name])??'undefined');return map;}
// Plan d’écriture : changed=null (tout écrire) sans empreintes de référence, sinon la liste des collections modifiées.
export function planCollections(state,previous=null){
  const keys=Object.keys(state),fingerprints=new Map(),reference=previous?.size?previous:null,changed=reference?[]:null;
  for(const name of keys){const json=JSON.stringify(state[name])??'undefined';fingerprints.set(name,json);if(changed&&reference.get(name)!==json)changed.push(name);}
  return {state,keys,changed,fingerprints};
}

// Sauvegarde hors de l’appareil (export ZIP ou JSON) : rappel au-delà de 14 jours, masquable 7 jours.
// Sans aucun export, le délai court depuis la première donnée saisie (pas de rappel le premier jour).
export const EXTERNAL_BACKUP_REMINDER_DAYS=14;
export const EXTERNAL_BACKUP_SNOOZE_DAYS=7;
export function externalBackupStatus(data,at=now()){
  const meta=data?.metadata||{},day=86400000,last=Number(meta.lastExternalBackupAt)||null;
  // Démonstration : rien à sauvegarder, aucun rappel.
  if(isDemoState(data))return {lastAt:last,never:!last,days:0,due:false,hidden:true,demo:true};
  let since=last;
  if(!since)for(const type of ENTITY_TYPES)for(const item of Array.isArray(data?.[type])?data[type]:[]){const created=Number(item?.createdAt)||0;if(!item?.deletedAt&&created>0&&(!since||created<since))since=created;}
  const elapsed=since?Math.max(0,at-since):0;
  return {lastAt:last,never:!last,days:Math.floor(elapsed/day),due:Boolean(since)&&elapsed>EXTERNAL_BACKUP_REMINDER_DAYS*day,hidden:(Number(meta.externalBackupReminderHiddenUntil)||0)>at};
}

export class Store{
  constructor(storage){this.storage=storage;this.state=emptyState();this.listeners=new Set();this.writeGuard=null;this.workspaceId='local';this.storageKey='state';this.writePromise=/** @type {Promise<any>} */(Promise.resolve());this.backupRetryAt=0;this.persistedStamp=null;this.tabReadOnly=null;this.onPersisted=null;this.schemaLock=null;this.historyActor=null;this.recentChanges=[];this.historySeq=0;this.historyPruned=false;this.persistedCollections=new Map();this.legacyOnlyKeys=new Set();}

  // A failed write must not restore a snapshot taken before another edit.
  /** @template T @param {() => T|PromiseLike<T>} operation @returns {Promise<T>} */
  enqueueWrite(operation){const result=this.writePromise.then(operation);this.writePromise=result.catch(()=>{});return result;}

  setWriteGuard(fn){this.writeGuard=typeof fn==='function'?fn:null;}
  // Lecture seule imposée quand une autre fenêtre détient le verrou d’écriture (y compris pour la synchronisation).
  setTabReadOnly(message){this.tabReadOnly=message?String(message===true?TAB_READ_ONLY_MESSAGE:message):null;}
  assertTabWritable(){if(this.tabReadOnly)throw tabReadOnlyError(this.tabReadOnly);this.assertSchemaWritable();}
  // Données d’une version plus récente : lecture seule tant que l’application n’est pas mise à jour.
  assertSchemaWritable(){if(this.schemaLock)throw newerSchemaError(this.schemaLock.storedVersion);}
  // Charge un état enregistré sans jamais le rétrograder : une version plus récente est affichée telle quelle, en lecture seule.
  _loadSaved(saved){
    if(saved&&isNewerSchema(saved)){
      const storedVersion=storedSchemaVersion(saved),view=migrateData(saved);
      // Version d’origine conservée en mémoire : un export ou une restauration ultérieure reste reconnu comme plus récent.
      view.version=storedVersion;
      this.schemaLock={storedVersion,appVersion:APP_VERSION,storageKey:this.storageKey,detectedAt:now()};
      return view;
    }
    this.schemaLock=null;
    return migrateData(saved||emptyState());
  }
  // Instantané de l’état tel qu’il est stocké, pris avant toute migration montante.
  async _backupBeforeMigration(saved,workspaceId=this.workspaceId){
    const from=storedSchemaVersion(saved)||1;
    if(!saved||from>=APP_VERSION||workspaceId===DEMO_WORKSPACE_ID||isDemoState(saved))return null;
    const createdAt=now(),id=`pre_migration_v${from}_${createdAt}`;
    try{
      await this.storage.backupPut({id,workspaceId,period:'migration',fromVersion:from,toVersion:APP_VERSION,createdAt,state:clone(saved)});
      await this.storage.pruneBackups?.({migration:PRE_MIGRATION_BACKUP_LIMIT});
      return id;
    }catch(error){
      // Sans espace disponible, la migration se fait quand même : bloquer l’ouverture serait pire.
      console.warn('[Parcelles] instantané avant migration impossible.',error);
      return null;
    }
  }
  // n° 137 (étape 2) : lecture de l’état d’un espace, par collection si le stockage le permet (sinon un seul objet).
  // Résultat : {value,format,unchanged,legacy} (voir StorageService.readState).
  async _readStored(key,{fresh=false,unchanged=null}={}){
    if(typeof this.storage.readState==='function')return this.storage.readState(key,{unchanged});
    const value=fresh&&typeof this.storage.getStored==='function'?await this.storage.getStored(key):await this.storage.get(key);
    if(value&&unchanged?.(value))return {value:null,format:'legacy',unchanged:true,legacy:null};
    return {value:value??null,format:value?'legacy':null,unchanged:false,legacy:null};
  }
  // Empreintes de ce qui est réellement stocké (avant toute migration) : rien n’est connu pour l’ancienne forme,
  // la prochaine écriture sera donc complète (conversion).
  _adoptStored(result){this.persistedCollections=result?.format==='collections'&&result.value?collectionFingerprints(result.value):new Map();if(result?.format==='collections')this.legacyOnlyKeys.clear();}
  // Écriture complète inconditionnelle (autre espace, démonstration) ; renvoie les empreintes écrites.
  async _writeFull(key,state){
    if(typeof this.storage.writeState!=='function'){await this.storage.set(key,state);return new Map();}
    let fingerprints=new Map();
    await this.storage.writeState(key,()=>{const plan=planCollections(state,null);fingerprints=plan.fingerprints;return plan;});
    // Nouvelle forme écrite : les enregistrements suivants de cet espace passent par writeState (plus par l’ancienne clé).
    this.legacyOnlyKeys.delete(key);
    return fingerprints;
  }
  // Instantané de l’ancienne forme avant sa conversion (ou d’une ancienne clé réécrite par une version antérieure) :
  // un retour arrière garde ainsi une restauration complète possible. Jamais pour la démonstration ; jamais bloquant.
  async _backupStoredForm(saved,reason,workspaceId=this.workspaceId){
    if(!saved||typeof this.storage.writeState!=='function'||this.storage.usingFallback||workspaceId===DEMO_WORKSPACE_ID||isDemoState(saved))return null;
    const createdAt=now(),version=storedSchemaVersion(saved),id=`pre_${reason}_${createdAt}`;
    try{
      await this.storage.backupPut({id,workspaceId,period:'migration',fromVersion:version,toVersion:version,storageFormat:reason,createdAt,state:clone(saved)});
      await this.storage.pruneBackups?.({migration:PRE_MIGRATION_BACKUP_LIMIT});
      return id;
    }catch(error){console.warn('[Parcelles] instantané avant changement de stockage impossible.',error);return null;}
  }
  workspaceStorageKey(id='local'){const value=String(id||'local').trim();return value&&value!=='local'?`state:workspace:${value.replace(/[^a-zA-Z0-9_-]/g,'_')}`:'state';}
  workspaceContext(){return {id:this.workspaceId,key:this.storageKey,isLocal:this.workspaceId==='local',demo:this.isDemo};}
  get isDemo(){return this.workspaceId===DEMO_WORKSPACE_ID;}

  // n° 118 : entrée en démonstration. Les données réelles ne sont ni relues ni réécrites : seul le pointeur
  // d’espace actif change, et l’espace démo (toujours neuf) mémorise l’espace où revenir.
  enterDemo(demoState){return this.enqueueWrite(()=>this._enterDemo(demoState));}
  async _enterDemo(demoState){
    if(this.isDemo)return false;
    if(this.tabReadOnly)throw tabReadOnlyError(this.tabReadOnly);
    const returnTo=this.workspaceId||'local',key=this.workspaceStorageKey(DEMO_WORKSPACE_ID);
    const next=migrateData(demoState);
    next.preferences={...next.preferences,workspaceId:DEMO_WORKSPACE_ID,cloudRole:null,syncEnabled:false,autoSync:false,autoBackup:false,platformBackendEnabled:false,remoteAiEnabled:false};
    next.metadata={...next.metadata,demo:true,demoReturnWorkspace:returnTo,lastWorkspaceSwitchAt:now()};
    next.queue=[];next.syncConflicts=[];
    const previous={workspaceId:this.workspaceId,storageKey:this.storageKey,state:this.state,persistedStamp:this.persistedStamp,persistedCollections:this.persistedCollections,schemaLock:this.schemaLock};
    try{
      const fingerprints=await this._writeFull(key,next);
      await this.storage.set('active-workspace',{id:DEMO_WORKSPACE_ID,updatedAt:now()});
      this.workspaceId=DEMO_WORKSPACE_ID;this.storageKey=key;this.state=next;this.persistedStamp=stateStamp(next);this.persistedCollections=fingerprints;this.schemaLock=null;this.backupRetryAt=0;this.recentChanges=[];
    }catch(error){Object.assign(this,previous);throw error;}
    this.notify({label:'Mode démonstration.',kind:'workspace-switch',entity:'state',workspaceId:DEMO_WORKSPACE_ID,queue:false});
    return true;
  }
  // Sortie : retour à l’espace mémorisé (relu tel quel, sans écriture), puis l’espace démo est vidé.
  exitDemo(){return this.enqueueWrite(()=>this._exitDemo());}
  async _exitDemo(){
    if(!this.isDemo)return false;
    if(this.tabReadOnly)throw tabReadOnlyError(this.tabReadOnly);
    const wanted=String(this.state.metadata?.demoReturnWorkspace||'local').trim()||'local',back=wanted===DEMO_WORKSPACE_ID?'local':wanted;
    const demoKey=this.storageKey,backKey=this.workspaceStorageKey(back);
    let stored=await this._readStored(backKey);if(!stored.value&&back==='local'&&backKey!=='state')stored=await this._readStored('state');
    const saved=stored.value;
    await this.storage.set('active-workspace',{id:back,updatedAt:now()});
    this.workspaceId=back;this.storageKey=backKey;this.persistedStamp=stateStamp(saved);this.recentChanges=[];this._adoptStored(stored);
    this.state=this._loadSaved(saved);if(back!=='local')this.state.preferences.workspaceId=back;
    await this._purgeDemo(demoKey);
    this.notify({label:'Retour à votre exploitation.',kind:'workspace-switch',entity:'state',workspaceId:back,queue:false});
    return true;
  }
  // Vide l’espace démo et les instantanés qui en proviendraient (import annulable, réparation de texte…).
  async _purgeDemo(key=this.workspaceStorageKey(DEMO_WORKSPACE_ID)){
    try{if(typeof this.storage.deleteState==='function')await this.storage.deleteState(key);else if(typeof this.storage.delete==='function')await this.storage.delete(key);else await this.storage.set(key,null);}
    catch(error){console.warn('[Parcelles] espace de démonstration non vidé.',error);}
    try{
      for(const row of await this.storage.backupList?.()||[])if(String(row.workspaceId||'')===DEMO_WORKSPACE_ID||isDemoState(row.state))await this.storage.backupDelete(row.id);
    }catch(error){console.warn('[Parcelles] instantanés de démonstration non retirés.',error);}
  }

  async init(){
    await this.storage.init();
    const active=await this.storage.get('active-workspace');
    this.workspaceId=String(active?.id||'local');
    this.storageKey=this.workspaceStorageKey(this.workspaceId);
    let stored=await this._readStored(this.storageKey);
    // Compatibilité : les données historiques vivent dans `state`.
    if(!stored.value&&this.workspaceId==='local'&&this.storageKey!=='state')stored=await this._readStored('state');
    const saved=stored.value,savedVersion=saved?.version;
    this.persistedStamp=stateStamp(saved);
    this._adoptStored(stored);
    this.state=this._loadSaved(saved);
    if(this.workspaceId!=='local')this.state.preferences.workspaceId=this.workspaceId;
    // Données plus récentes que ce build : ni migration ni écriture.
    if(this.schemaLock)return this.state;
    const backupId=saved?await this._backupBeforeMigration(saved):null;
    // n° 137 : l’ancienne forme est convertie par l’enregistrement ci-dessous (instantané d’abord, pour un retour arrière) ;
    // une ancienne clé réécrite par une version antérieure à côté de la nouvelle forme est conservée en instantané.
    if(!backupId&&stored.format==='legacy')await this._backupStoredForm(saved,'collections');
    if(stored.legacy)await this._backupStoredForm(stored.legacy,'legacy');
    if(saved && savedVersion!==this.state.version)this.log('migration',`Données mises à jour vers le format v${this.state.version}.`,{from:savedVersion,to:this.state.version,backupId});
    // Une autre fenêtre a écrit pendant l’ouverture : on reprend sa version plutôt que de l’écraser.
    try{await this.persist();}catch(error){if(error?.name!=='StaleStateError')throw error;await this._reloadFromStorage({notify:false});}
    return this.state;
  }

  switchWorkspace(id,options={}){return this.enqueueWrite(()=>this._switchWorkspace(id,options));}
  async _switchWorkspace(id,{seed=null,name=''}={}){
    const nextId=String(id||'local').trim()||'local';
    if(nextId===this.workspaceId)return this.state;
    if(this.tabReadOnly)throw tabReadOnlyError(this.tabReadOnly);
    // Tout est déjà enregistré après chaque modification : si une autre fenêtre a écrit depuis, sa version est conservée.
    // Un espace verrouillé (version plus récente) n’est jamais réécrit : on peut seulement le quitter.
    if(!this.schemaLock){try{await this.persist();}catch(error){if(error?.name!=='StaleStateError')throw error;}}
    const nextKey=this.workspaceStorageKey(nextId);
    const stored=await this._readStored(nextKey);let saved=stored.value;const savedFromStorage=Boolean(saved);
    if(!saved&&seed){saved=clone(seed);saved.queue=[];saved.syncConflicts=[];saved.preferences={...(saved.preferences||{}),workspaceId:nextId,cloudRole:null,syncEnabled:true};saved.metadata={...(saved.metadata||{}),lastSyncAt:null,lastSyncError:null,syncFailureCount:0,syncBackoffUntil:null,syncCursors:{},syncServerCursors:{}};}
    const previous={workspaceId:this.workspaceId,storageKey:this.storageKey,state:this.state,persistedStamp:this.persistedStamp,persistedCollections:this.persistedCollections,schemaLock:this.schemaLock};
    if(saved&&isNewerSchema(saved)){
      // Destination écrite par une version plus récente : affichée en lecture seule, jamais réécrite.
      try{
        await this.storage.set('active-workspace',{id:nextId,updatedAt:now()});
        this.workspaceId=nextId;this.storageKey=nextKey;this.backupRetryAt=0;this.persistedStamp=stateStamp(saved);this._adoptStored(stored);
        this.state=this._loadSaved(saved);this.state.preferences.workspaceId=nextId==='local'?'':nextId;
      }catch(error){Object.assign(this,previous);throw error;}
      this.notify({label:'Espace de travail changé.',kind:'workspace-switch',entity:'state',workspaceId:nextId});
      return this.state;
    }
    const migrationBackupId=savedFromStorage?await this._backupBeforeMigration(saved,nextId):null;
    // n° 137 : mêmes instantanés qu’à l’ouverture avant que _writeFull ne remplace l’ancienne clé de la destination.
    if(!migrationBackupId&&stored.format==='legacy')await this._backupStoredForm(saved,'collections',nextId);
    if(stored.legacy)await this._backupStoredForm(stored.legacy,'legacy',nextId);
    const next=migrateData(saved||emptyState());
    next.preferences.workspaceId=nextId==='local'?'':nextId;
    next.preferences.cloudRole=null;
    // Horodatage renouvelé : une autre fenêtre ouverte sur cet espace voit l’écriture (empreinte changée) et recharge.
    next.metadata.lastWorkspaceSwitchAt=now();next.metadata.updatedAt=now();
    if(name&&(!next.exploitation.nom||next.exploitation.nom==='Mon exploitation'))next.exploitation.nom=String(name);
    try{
      // Persist the destination before changing the startup pointer.
      const fingerprints=await this._writeFull(nextKey,next);
      await this.storage.set('active-workspace',{id:nextId,updatedAt:now()});
      this.workspaceId=nextId;this.storageKey=nextKey;this.state=next;this.backupRetryAt=0;this.persistedStamp=stateStamp(next);this.persistedCollections=fingerprints;this.schemaLock=null;
    }catch(error){Object.assign(this,previous);throw error;}
    if(migrationBackupId)this.log('migration','Instantané conservé avant la mise à jour du format des données.',{backupId:migrationBackupId});
    this.notify({label:'Espace de travail changé.',kind:'workspace-switch',entity:'state',workspaceId:nextId});
    return this.state;
  }

  snapshot(){return clone(this.state);}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  // n° 137 : une seule copie par notification, partagée par tous les abonnés et gelée en surface (lecture seule).
  notify(event){const data=this.listeners.size?Object.freeze(this.snapshot()):null;for(const listener of this.listeners){try{const result=listener(data,event);if(result?.catch)result.catch(error=>console.error('[Parcelles] Mise à jour de l’affichage impossible.',error));}catch(error){console.error('[Parcelles] Mise à jour de l’affichage impossible.',error);}}}

  // Écrit l’état seulement si personne d’autre ne l’a enregistré depuis la dernière lecture ou écriture de cet onglet.
  async _writeState(){
    // Dernier rempart : des données plus récentes ne sont jamais écrasées par ce build.
    this.assertSchemaWritable();
    const expected=this.persistedStamp;
    if(typeof this.storage.writeState==='function'&&!this.legacyOnlyKeys.has(this.storageKey)){
      // n° 137 : seules les collections modifiées, la méta et la vérification de révision, en une transaction atomique.
      // Le plan est calculé dans la transaction, juste avant les écritures : empreintes et contenu écrit concordent.
      let fingerprints=null,stamp=null,converting=false;
      try{
        await this.storage.writeState(this.storageKey,({format})=>{
          converting=format!=='collections';
          const plan=planCollections(this.state,converting?null:this.persistedCollections);
          fingerprints=plan.fingerprints;stamp=stateStamp(this.state);return plan;
        },{isCurrent:stored=>stateStamp(stored)===expected});
        this.persistedCollections=fingerprints;this.persistedStamp=stamp;return;
      }catch(error){
        // Conversion impossible (quota presque plein…) : rien n’a été écrit, l’ancienne clé est intacte. On reste sur
        // l’ancienne forme pour cette session plutôt que de bloquer l’enregistrement ; nouvel essai au prochain lancement.
        if(!converting||error?.name==='StaleStateError'||typeof this.storage.setIfCurrent!=='function'||this.storage.usingFallback)throw error;
        console.warn('[Parcelles] stockage par collection différé ; enregistrement sous l’ancienne forme.',error);
        this.legacyOnlyKeys.add(this.storageKey);this.persistedCollections=new Map();
      }
    }
    if(typeof this.storage.setIfCurrent==='function')await this.storage.setIfCurrent(this.storageKey,this.state,stored=>stateStamp(stored)===expected);
    else await this.storage.set(this.storageKey,this.state);
    this.persistedStamp=stateStamp(this.state);
  }

  async persist(){
    this.state.metadata.updatedAt=now();
    await this._writeState();
    this._announcePersisted();
    // Démonstration : aucune sauvegarde automatique.
    if(!this.isDemo&&this.state.preferences.autoBackup&&now()>=this.backupRetryAt){
      const day=new Date().toISOString().slice(0,10);
      if(this.state.metadata.lastAutoBackupDay!==day){
        const d=new Date(); const weekStart=new Date(d); weekStart.setDate(d.getDate()-((d.getDay()+6)%7));
        const week=weekStart.toISOString().slice(0,10); const month=day.slice(0,7);
        const snapshot=clone(this.state), createdAt=now();
        try{
          await this.storage.backupPut({id:`auto_daily_${this.workspaceId}_${day}`,workspaceId:this.workspaceId,period:'daily',createdAt,state:snapshot});
          await this.storage.backupPut({id:`auto_weekly_${this.workspaceId}_${week}`,workspaceId:this.workspaceId,period:'weekly',createdAt,state:snapshot});
          await this.storage.backupPut({id:`auto_monthly_${this.workspaceId}_${month}`,workspaceId:this.workspaceId,period:'monthly',createdAt,state:snapshot});
          await this.storage.pruneBackups?.({daily:7,weekly:4,monthly:3});
          this.state.metadata.lastAutoBackupDay=day;
          this.state.metadata.lastAutoBackupError=null;
          await this._writeState();
        }catch(error){
          // The primary write above already succeeded. A secondary backup failure
          // must neither block startup nor roll back that saved change in memory.
          this.backupRetryAt=now()+5*60*1000;
          this.state.metadata.lastAutoBackupError=String(error?.message||error);
          console.warn('[Parcelles] Sauvegarde automatique différée ; les données sont enregistrées.',error);
        }
      }
    }
  }

  _announcePersisted(){try{this.onPersisted?.({storageKey:this.storageKey,workspaceId:this.workspaceId,revision:Number(this.state.metadata?.revision)||0,stamp:this.persistedStamp});}catch(error){console.warn('[Parcelles] annonce d’enregistrement impossible.',error);}}

  // Recharge l’état enregistré par une autre fenêtre. Sans changement d’empreinte, rien n’est fait.
  reloadFromStorage(options={}){return this.enqueueWrite(()=>this._reloadFromStorage(options));}
  async _reloadFromStorage({notify=true}={}){
    // Empreinte inchangée : seule la méta est lue, les collections ne sont pas relues.
    const expected=this.persistedStamp;
    const stored=await this._readStored(this.storageKey,{fresh:true,unchanged:value=>stateStamp(value)===expected});
    const saved=stored.value;
    if(stored.unchanged||!saved)return false;
    const stamp=stateStamp(saved);
    if(stamp===this.persistedStamp)return false;
    // Une fenêtre plus récente a enregistré un format plus récent : on l’affiche sans jamais le réécrire.
    const wasLocked=Boolean(this.schemaLock);
    if(!isNewerSchema(saved))await this._backupBeforeMigration(saved);
    const fingerprints=stored.format==='collections'?collectionFingerprints(saved):new Map();
    const next=this._loadSaved(saved);
    if(this.workspaceId!=='local')next.preferences.workspaceId=this.workspaceId;
    this.state=next;this.persistedStamp=stamp;this.persistedCollections=fingerprints;if(stored.format==='collections')this.legacyOnlyKeys.delete(this.storageKey);
    if(notify&&this.schemaLock&&!wasLocked)this.notify({label:NEWER_SCHEMA_MESSAGE,kind:'schema-lock',entity:'state',queue:false});
    else if(notify)this.notify({label:'Données mises à jour depuis une autre fenêtre.',kind:'external-reload',entity:'state',queue:false});
    return true;
  }
  // Après un refus pour cause d’écriture concurrente : recharger, puis signaler l’échec si le rechargement échoue aussi.
  async _recoverStale(previous){try{await this._reloadFromStorage();}catch(reloadError){console.warn('[Parcelles] rechargement après écriture concurrente impossible.',reloadError);this.state=previous;}}

  log(type,message,details=null){
    // n° 139 : auteur (si connu) pour le journal d’activité unifié.
    let by='';try{by=String(this.historyActor?.()||'');}catch{}
    this.state.journal.unshift({id:uid('log'),type,message,details,createdAt:now(),...(by?{by}:{})});
    this.state.journal=this.state.journal.slice(0,500);
  }

  queue(operation){
    // Démonstration : aucune file d’envoi, quel que soit le réglage.
    if(this.isDemo||!this.state.preferences.syncEnabled)return;
    const existingIndex=this.state.queue.findIndex(item=>['pending','error','conflict'].includes(item.status)&&item.entity===operation.entity&&item.entityId===operation.entityId);
    const existing=existingIndex>=0?this.state.queue[existingIndex]:null;
    const next={id:uid('op'),entity:operation.entity,entityId:operation.entityId,action:operation.action,payload:operation.payload,createdAt:now(),firstQueuedAt:existing?.firstQueuedAt||existing?.createdAt||now(),status:'pending',attempts:0,lastError:null,nextRetryAt:0};
    // n° 20 (vague 12) : écriture limitée à quelques champs (relevé de compteur de l'opérateur terrain).
    // Une écriture complète déjà en attente reste complète ; deux écritures limitées réunissent leurs champs.
    if(Array.isArray(operation.fields)&&operation.fields.length&&(!existing||Array.isArray(existing.fields)))next.fields=[...new Set([...(existing?.fields||[]),...operation.fields])];
    if(existingIndex>=0)this.state.queue[existingIndex]=next;else this.state.queue.push(next);
    if(this.state.queue.length>1000)this.state.queue=this.state.queue.filter(item=>item.status!=='done');
  }

  mutate(label,fn,options={}){return this.enqueueWrite(()=>this._mutate(label,fn,options));}
  async _mutate(label,fn,options={}){
    this.assertTabWritable();
    if(!options.bypassPermissions&&this.writeGuard&&!this.writeGuard(options))throw new Error('Votre rôle ne permet pas cette modification.');
    const previous=this.snapshot();
    try{
      const result=await fn(this.state);
      this.state.metadata.revision+=1;
      if(options.log!==false)this.log(options.kind||'modification',label,options.entity&&options.entity!=='state'&&options.entityId?{...(options.details||{}),entityType:options.entity,entityId:options.entityId,action:options.action||'update'}:options.details);
      if(options.queue!==false)this.queue({entity:options.entity||'state',entityId:options.entityId||'state',action:options.action||'update',payload:options.payload||null});
      await this.persist();
      this.notify({label,...options});
      return result;
    }catch(error){
      // Une autre fenêtre a enregistré entre-temps : on repart de sa version et on rejoue la modification une fois.
      if(error?.name==='StaleStateError'&&!options.staleRetry){
        try{await this._reloadFromStorage();}catch(reloadError){this.state=previous;console.warn('[Parcelles] rechargement après écriture concurrente impossible.',reloadError);throw error;}
        return this._mutate(label,fn,{...options,staleRetry:true});
      }
      if(error?.name==='StaleStateError'){await this._recoverStale(previous);throw concurrentWriteError(error);}
      this.state=previous;throw error;
    }
  }

  // Historique des fiches (n° 130) : écrit seulement APRÈS un enregistrement réussi, donc jamais en lecture seule
  // ni sous verrou de version. Un échec (quota, base ancienne) n’annule jamais la modification déjà enregistrée.
  async _recordHistory(changes,{label='',action=null}={}){
    try{
      const remote=action==='remote',by=remote?'remote':String((typeof this.historyActor==='function'?this.historyActor():this.historyActor)||''),at=now(),entries=[];
      for(const change of changes){
        if(!shouldRecordHistory(change.type))continue;
        const seq=++this.historySeq,entry=buildHistoryEntry({workspaceId:this.workspaceId,type:change.type,before:change.before,after:change.after,action:action||change.action||'update',by,label,at,seq});
        if(!isMeaningfulEntry(entry))continue;
        entries.push(entry);
        // Copie complète (géométrie comprise) gardée en mémoire seulement, pour « Annuler » et Ctrl+Z.
        if(!remote)this.recentChanges.push({seq,id:entry.id,type:change.type,entityId:entry.entityId,before:change.before?clone(change.before):null,at,label,action:entry.action,workspaceId:this.workspaceId,undone:false});
      }
      if(this.recentChanges.length>HISTORY_MAX_PER_ENTITY)this.recentChanges=this.recentChanges.slice(-HISTORY_MAX_PER_ENTITY);
      // Démonstration : « Annuler » reste possible en mémoire, rien n’est écrit dans l’historique durable.
      if(entries.length&&!this.isDemo&&typeof this.storage.historyAdd==='function'){
        await this.storage.historyAdd(entries,{maxPerEntity:HISTORY_MAX_PER_ENTITY});
        if(!this.historyPruned&&typeof this.storage.historyPrune==='function'){this.historyPruned=true;await this.storage.historyPrune(at-HISTORY_MAX_AGE_DAYS*86400000);}
      }
      return entries;
    }catch(error){console.warn('[Parcelles] historique non conservé ; la modification est bien enregistrée.',error);return[];}
  }

  get(type,id,{includeDeleted=false}={}){return(this.state[type]||[]).find(item=>item.id===id&&(includeDeleted||!item.deletedAt));}
  list(type,{includeDeleted=false}={}){return(this.state[type]||[]).filter(item=>includeDeleted||!item.deletedAt);}

  upsert(type,entity,options={}){return this.enqueueWrite(()=>this._upsert(type,entity,options));}
  /** @param {string} type @param {object} entity @param {{label?:string, queue?:boolean, historyAction?:string|null}} [options] */
  async _upsert(type,entity,{label,queue=true,historyAction=null}={}){
    if(!ENTITY_TYPES.includes(type))throw new Error(`Type inconnu : ${type}`);
    const existing=entity.id?this.get(type,entity.id,{includeDeleted:true}):null;
    const normalized=normalizeEntity(type,entity,existing);
    const errors=validate(type,normalized);if(errors.length)throw new Error(errors.join(' — '));
    if(type==='rotations'){
      const duplicate=this.state.rotations.find(item=>!item.deletedAt&&item.id!==normalized.id&&item.parcelId===normalized.parcelId&&item.campaignId===normalized.campaignId);
      if(duplicate)throw new Error('Une rotation existe déjà pour cette parcelle et cette campagne.');
    }
    let before=null;const mutationLabel=label||`${existing?'Modification':'Création'} ${type}`;
    await this._mutate(mutationLabel,state=>{
      const index=state[type].findIndex(item=>item.id===normalized.id);
      before=index>=0?clone(state[type][index]):null;
      if(index>=0)state[type][index]=normalized;else state[type].push(normalized);
    },{entity:type,entityId:normalized.id,action:existing?'update':'create',payload:normalized,queue});
    await this._recordHistory([{type,before,after:normalized}],{label:mutationLabel,action:historyAction});
    return normalized;
  }

  upsertMany(type,entities,options={}){return this.enqueueWrite(()=>this._upsertMany(type,entities,options));}
  async _upsertMany(type,entities,options={}){
    const {label='Mise à jour groupée'}=options;
    if(!ENTITY_TYPES.includes(type))throw new Error(`Type inconnu : ${type}`);
    this.assertTabWritable();
    if(this.writeGuard&&!this.writeGuard({entity:type,action:'update'}))throw new Error('Votre rôle ne permet pas cette modification.');
    const previous=this.snapshot();
    try{
      const normalized=entities.map(entity=>{const existing=entity.id?this.get(type,entity.id,{includeDeleted:true}):null;const value=normalizeEntity(type,entity,existing);const errors=validate(type,value);if(errors.length)throw new Error(errors.join(' — '));return{value,existing};});
      const changes=[];
      for(const {value,existing} of normalized){const index=this.state[type].findIndex(item=>item.id===value.id);changes.push({type,before:index>=0?clone(this.state[type][index]):null,after:value});if(index>=0)this.state[type][index]=value;else this.state[type].push(value);this.queue({entity:type,entityId:value.id,action:existing?'update':'create',payload:value});}
      this.state.metadata.revision+=1;this.log('modification',label,{count:normalized.length,type,entityType:type,...(normalized.length===1?{entityId:normalized[0].value.id}:{})});await this.persist();this.notify({label,kind:'batch',entity:type,count:normalized.length});
      await this._recordHistory(changes,{label});
      return normalized.map(x=>x.value);
    }catch(error){
      if(error?.name==='StaleStateError'&&!options.staleRetry){
        // Recharge la version de l’autre fenêtre puis rejoue la saisie groupée une seule fois.
        try{await this._reloadFromStorage();}catch(reloadError){this.state=previous;console.warn('[Parcelles] rechargement après écriture concurrente impossible.',reloadError);throw error;}
        return this._upsertMany(type,entities,{...options,staleRetry:true});
      }
      if(error?.name==='StaleStateError'){await this._recoverStale(previous);throw concurrentWriteError(error);}
      this.state=previous;throw error;
    }
  }

  async remove(type,id){
    const found=this.get(type,id);if(!found)throw new Error('Élément introuvable.');
    const deletedAt=now(),label=`${type.slice(0,-1)} placé dans la corbeille.`;let before=null,after=null;
    await this.mutate(label,state=>{
      const item=state[type].find(value=>value.id===id);before=clone(item);item.deletedAt=deletedAt;item.updatedAt=deletedAt;item.version=(item.version||0)+1;after=clone(item);
    },{entity:type,entityId:id,action:'delete',payload:{id,deletedAt}});
    await this._recordHistory([{type,before,after,action:'delete'}],{label});
  }

  async restore(type,id){
    const found=this.get(type,id,{includeDeleted:true});if(!found?.deletedAt)throw new Error('Élément introuvable dans la corbeille.');
    const label=`${type.slice(0,-1)} restauré.`;let before=null,after=null;
    await this.mutate(label,state=>{const item=state[type].find(v=>v.id===id);before=clone(item);item.deletedAt=null;item.updatedAt=now();item.version=(item.version||0)+1;after=clone(item);},{entity:type,entityId:id,action:'update',payload:{id,deletedAt:null}});
    await this._recordHistory([{type,before,after,action:'restore'}],{label});
  }

  async purge(type,id){
    const found=this.get(type,id,{includeDeleted:true});if(!found)throw new Error('Élément introuvable.');
    await this.mutate(`${type.slice(0,-1)} supprimé définitivement.`,state=>{state[type]=state[type].filter(v=>v.id!==id);},{queue:false,kind:'purge',entity:type,entityId:id,action:'purge'});
    if((type==='photos'||type==='documents'))await this.storage.blobDelete(id);
  }

  async recordStockMovement(movement){
    const item=this.get('stockItems',movement.stockItemId);if(!item)throw new Error('Stock introuvable.');
    const normalized=normalizeEntity('stockMovements',movement,null);
    const quantity=toNumber(movement.quantity);if(quantity<0)throw new Error('Quantité invalide.');
    await this.mutate(`Mouvement de stock : ${item.name||'Produit'}`,state=>{
      const stock=state.stockItems.find(x=>x.id===item.id);const current=toNumber(stock.quantity);
      let next=current,delta=0;
      if(movement.type==='Entrée'){delta=quantity;next=current+quantity;}
      else if(movement.type==='Sortie'){delta=-quantity;next=Math.max(0,current-quantity);if(quantity>current)throw new Error('Stock insuffisant pour cette sortie.');}
      else {next=quantity;delta=next-current;}
      const enteredPrice=movement.unitPrice!==null&&movement.unitPrice!==undefined&&String(movement.unitPrice).trim()!==''?toNumber(movement.unitPrice):null;
      if(movement.type==='Entrée'&&enteredPrice!==null&&next>0){const oldValue=current*toNumber(stock.unitPrice),newValue=quantity*enteredPrice;stock.unitPrice=(oldValue+newValue)/next;}
      else if(movement.type==='Ajustement'&&enteredPrice!==null)stock.unitPrice=enteredPrice;
      normalized.delta=delta;normalized.balanceAfter=next;normalized.unitPrice=enteredPrice;
      state.stockMovements.push(normalized);stock.quantity=next;stock.updatedAt=now();stock.version=(stock.version||0)+1;
    },{entity:'stockMovements',entityId:normalized.id,action:'create',payload:normalized});
    return normalized;
  }

  /** @param {string} type @param {object} entity @param {{expectedQueueId?:string|null}} [options] */
  async applyRemote(type,entity,{expectedQueueId}={}){
    if(!ENTITY_TYPES.includes(type))throw new Error(`Type inconnu : ${type}`);
    const incoming=clone(entity);
    const errors=validate(type,incoming);if(errors.length&&!incoming.deletedAt)throw new Error(errors.join(' — '));
    let before=null;
    const applied=await this.mutate(`Synchronisation distante : ${type}`,state=>{
      if(expectedQueueId!==undefined){
        const pending=state.queue.find(item=>item.entity===type&&item.entityId===incoming.id&&['pending','error','conflict'].includes(item.status));
        if((pending?.id||null)!==expectedQueueId)return false;
      }
      const index=state[type].findIndex(item=>item.id===incoming.id);
      before=index>=0?clone(state[type][index]):null;
      if(index>=0)state[type][index]=incoming;else state[type].push(incoming);
      return true;
    },{entity:type,entityId:incoming.id,action:'remote',queue:false,log:false,bypassPermissions:true});
    if(applied)await this._recordHistory([{type,before,after:incoming}],{label:'Synchronisation',action:'remote'});
    return applied?incoming:null;
  }

  // n° 137 : application groupée de documents distants, un seul enregistrement et une seule notification par lot.
  // Chaque élément garde sa vérification expectedQueueId ; un élément invalide est écarté et signalé dans le résultat
  // ({applied:false,error}) sans bloquer les autres. Résultats dans l’ordre des éléments : {applied,entity,error}.
  applyRemoteMany(items){return this.enqueueWrite(()=>this._applyRemoteMany(items));}
  async _applyRemoteMany(items=[]){
    const prepared=(items||[]).map(({type,entity,expectedQueueId})=>{
      if(!ENTITY_TYPES.includes(type))return{error:new Error(`Type inconnu : ${type}`)};
      const incoming=clone(entity);const errors=validate(type,incoming);
      if(errors.length&&!incoming.deletedAt)return{error:new Error(errors.join(' — '))};
      return{type,incoming,expectedQueueId};
    });
    const ready=prepared.filter(item=>!item.error);
    let flags=[],changes=[];
    if(ready.length){
      const types=[...new Set(ready.map(item=>item.type))];
      flags=await this._mutate(`Synchronisation distante : ${types.join(', ')}`,state=>{
        changes=[];
        return ready.map(({type,incoming,expectedQueueId})=>{
          if(expectedQueueId!==undefined){
            const pending=state.queue.find(item=>item.entity===type&&item.entityId===incoming.id&&['pending','error','conflict'].includes(item.status));
            if((pending?.id||null)!==expectedQueueId)return false;
          }
          const index=state[type].findIndex(item=>item.id===incoming.id);
          changes.push({type,before:index>=0?clone(state[type][index]):null,after:incoming});
          if(index>=0)state[type][index]=incoming;else state[type].push(incoming);
          return true;
        });
      },{entity:types.length===1?types[0]:'state',...(ready.length===1?{entityId:ready[0].incoming.id}:{}),action:'remote',count:ready.length,queue:false,log:false,bypassPermissions:true});
      if(changes.length)await this._recordHistory(changes,{label:'Synchronisation',action:'remote'});
    }
    let cursor=0;
    return prepared.map(item=>{if(item.error)return{applied:false,entity:null,error:item.error};const applied=Boolean(flags[cursor++]);return{applied,entity:applied?item.incoming:null,error:null};});
  }

  // Export ZIP/JSON réussi : date conservée localement (non synchronisée), quel que soit le rôle.
  recordExternalBackup(kind='zip'){return this.mutate('Sauvegarde hors de l’appareil effectuée.',state=>{state.metadata.lastExternalBackupAt=now();state.metadata.lastExternalBackupKind=String(kind||'zip');state.metadata.externalBackupReminderHiddenUntil=null;},{queue:false,kind:'backup',entity:'preferences',action:'update',bypassPermissions:true});}
  snoozeExternalBackupReminder(days=EXTERNAL_BACKUP_SNOOZE_DAYS){return this.mutate('Rappel de sauvegarde masqué.',state=>{state.metadata.externalBackupReminderHiddenUntil=now()+Math.max(1,Number(days)||EXTERNAL_BACKUP_SNOOZE_DAYS)*86400000;},{queue:false,log:false,kind:'settings',entity:'preferences',action:'update',bypassPermissions:true});}
  async setPreferences(patch){return this.mutate('Préférences mises à jour.',state=>Object.assign(state.preferences,patch),{queue:false,kind:'settings',entity:'preferences',action:'update'});}
  async setExploitation(patch){return this.mutate('Informations de l’exploitation mises à jour.',state=>Object.assign(state.exploitation,patch,{updatedAt:now()}),{queue:false,kind:'settings',entity:'exploitation',action:'update'});}

  replaceState(next,label='Données remplacées',options={}){return this.enqueueWrite(()=>this._replaceState(next,label,options));}
  async _replaceState(next,label='Données remplacées',{kind='restore',log=true,bypassPermissions=false}={}){
    this.assertTabWritable();
    if(!bypassPermissions&&this.writeGuard&&!this.writeGuard({entity:'state',action:'restore'}))throw new Error('Votre rôle ne permet pas de restaurer les données.');
    // Une sauvegarde d’une version plus récente serait rétrogradée : refus, rien n’est modifié.
    if(isNewerSchema(next))throw newerSchemaError(storedSchemaVersion(next),'Cette sauvegarde vient d’une version plus récente de Parcelles. Mettez à jour l’application avant de la restaurer.');
    const migrated=migrateData(next);
    const previous=this.snapshot();
    try{
      this.state=migrated;
      this.state.metadata.revision=(previous.metadata?.revision||0)+1;
      if(log)this.log(kind,label);
      await this.persist();
      this.notify({label,kind,queue:false});
    }catch(error){
      // Une restauration n’est jamais rejouée en silence : on affiche la version de l’autre fenêtre et on demande de recommencer.
      if(error?.name==='StaleStateError'){await this._recoverStale(previous);throw concurrentWriteError(error);}
      this.state=previous;throw error;
    }
  }
}
