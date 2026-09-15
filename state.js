import {APP_VERSION, ENTITY_TYPES, campaignFor, clone, isoDate, now, parseImportDate, toNumber, uid, validateIntervention, validateParcel} from './utils.js';

export function emptyState(){
  const timestamp=now();
  return {
    version:APP_VERSION,
    exploitation:{
      id:'farm_local',nom:'Mon exploitation',commune:'',latitude:null,longitude:null,
      createdAt:timestamp,updatedAt:timestamp
    },
    campagnes:[],
    parcelles:[],interventions:[],tasks:[],rotations:[],grazingSessions:[],materiels:[],products:[],clients:[],documents:[],photos:[],points:[],templates:[],importSessions:[],syncConflicts:[],notifications:[],observations:[],stockItems:[],stockMovements:[],maintenanceRecords:[],routeSessions:[],fieldSessions:[],chantiers:[],members:[],assistantMessages:[],devices:[],automationRules:[],automationRuns:[],gpsTracks:[],integrationImports:[],weatherStations:[],platformJobs:[],platformEvents:[],
    preferences:{
      mapLayer:'osm',mapColorMode:'culture',theme:'system',gpsConsent:false,
      autoBackup:true,syncEnabled:false,workspaceId:'',cloudRole:null,syncAttachments:true,syncWifiOnly:false,syncAttachmentsWifiOnly:false,syncRetryMax:5,syncRetryBaseSeconds:15,syncAutoMerge:true,weatherDays:7,
      routeProvider:'apple',highContrast:false,onboardingComplete:false,defaultOperator:'',fuelPrice:1.7,weatherWindThreshold:35,weatherRainThreshold:5,homeCards:['weather','today','tasks','alerts','recent'],notificationsEnabled:false,compactMode:false,remoteAiEnabled:false,remoteAiEndpoint:'',voiceEnabled:true,assistantHistory:true,assistantLocalFirst:true,assistantVoiceReplies:false,assistantTerrainContext:true,integrationAutoMatch:true,stationWeatherEnabled:false,platformBackendEnabled:false,platformApiEndpoint:'',platformAutoJobs:false,platformIsolation:true,fieldAutoDetect:true,fieldKeepAwake:false,automationEnabled:true,autoSync:true,autoSyncMinutes:5,nativeNotifications:true,nativeNotificationActions:true,nativeHaptics:true,nativeCameraEnabled:true,nativeStatusBar:true,biometricLock:false,biometricLockMinutes:5,automationEventTriggers:true,automationMaxActionsPerRun:25,securityAuditEnabled:true,encryptedExportIterations:250000
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

function ensureArrays(data){
  ENTITY_TYPES.forEach(type=>{if(!Array.isArray(data[type]))data[type]=[];});
  if(!Array.isArray(data.campagnes))data.campagnes=[];
  if(!Array.isArray(data.queue))data.queue=[];
  if(!Array.isArray(data.journal))data.journal=[];
}

export function migrateData(input){
  let data=clone(input||{});
  const base=emptyState();
  if(!data.version)data.version=1;

  if(data.version<2){
    if(Array.isArray(data.parcelles))data.parcelles=data.parcelles.map(parcel=>({...parcel,nom:parcel.nom||parcel.name||parcel.Nom||'Sans nom',surfaceHa:toNumber(parcel.surfaceHa??parcel.surface??0)}));
    const interventions=Array.isArray(data.interventions)&&data.interventions.length?data.interventions:(data.manualInterventions||[]);
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
    data.preferences.encryptedExportIterations=Math.min(1000000,Math.max(100000,Number(data.preferences.encryptedExportIterations??250000)||250000));
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

  data={...base,...data,
    version:APP_VERSION,
    exploitation:{...base.exploitation,...data.exploitation},
    preferences:{...base.preferences,...data.preferences},
    metadata:{...base.metadata,...data.metadata}
  };
  ensureArrays(data);
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

export class Store{
  constructor(storage){this.storage=storage;this.state=emptyState();this.listeners=new Set();this.writeGuard=null;this.workspaceId='local';this.storageKey='state';}

  setWriteGuard(fn){this.writeGuard=typeof fn==='function'?fn:null;}
  workspaceStorageKey(id='local'){const value=String(id||'local').trim();return value&&value!=='local'?`state:workspace:${value.replace(/[^a-zA-Z0-9_-]/g,'_')}`:'state';}
  workspaceContext(){return {id:this.workspaceId,key:this.storageKey,isLocal:this.workspaceId==='local'};}

  async init(){
    await this.storage.init();
    const active=await this.storage.get('active-workspace');
    this.workspaceId=String(active?.id||'local');
    this.storageKey=this.workspaceStorageKey(this.workspaceId);
    let saved=await this.storage.get(this.storageKey);
    // Compatibilité : les données historiques vivent dans `state`.
    if(!saved&&this.workspaceId==='local')saved=await this.storage.get('state');
    const savedVersion=saved?.version;
    this.state=migrateData(saved||emptyState());
    if(this.workspaceId!=='local')this.state.preferences.workspaceId=this.workspaceId;
    if(saved && savedVersion!==this.state.version)this.log('migration',`Données mises à jour vers le format v${this.state.version}.`,{from:savedVersion,to:this.state.version});
    await this.persist();
    return this.state;
  }

  async switchWorkspace(id,{seed=null,name=''}={}){
    const nextId=String(id||'local').trim()||'local';
    if(nextId===this.workspaceId)return this.state;
    await this.persist();
    const nextKey=this.workspaceStorageKey(nextId);
    let saved=await this.storage.get(nextKey);
    if(!saved&&seed){saved=clone(seed);saved.queue=[];saved.syncConflicts=[];saved.preferences={...(saved.preferences||{}),workspaceId:nextId,cloudRole:null,syncEnabled:true};saved.metadata={...(saved.metadata||{}),lastSyncAt:null,lastSyncError:null,syncFailureCount:0,syncBackoffUntil:null,syncCursors:{}};}
    this.workspaceId=nextId;this.storageKey=nextKey;
    this.state=migrateData(saved||emptyState());
    this.state.preferences.workspaceId=nextId==='local'?'':nextId;
    this.state.preferences.cloudRole=null;
    this.state.metadata.lastWorkspaceSwitchAt=now();
    if(name&&(!this.state.exploitation.nom||this.state.exploitation.nom==='Mon exploitation'))this.state.exploitation.nom=String(name);
    await this.storage.set('active-workspace',{id:nextId,updatedAt:now()});
    await this.persist();
    this.notify({label:'Espace de travail changé.',kind:'workspace-switch',entity:'state',workspaceId:nextId});
    return this.state;
  }

  snapshot(){return clone(this.state);}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  notify(event){for(const listener of this.listeners)listener(this.snapshot(),event);}

  async persist(){
    this.state.metadata.updatedAt=now();
    await this.storage.set(this.storageKey,this.state);
    if(this.state.preferences.autoBackup){
      const day=new Date().toISOString().slice(0,10);
      if(this.state.metadata.lastAutoBackupDay!==day){
        this.state.metadata.lastAutoBackupDay=day;
        const d=new Date(); const weekStart=new Date(d); weekStart.setDate(d.getDate()-((d.getDay()+6)%7));
        const week=weekStart.toISOString().slice(0,10); const month=day.slice(0,7);
        const snapshot=clone(this.state), createdAt=now();
        await this.storage.backupPut({id:`auto_daily_${this.workspaceId}_${day}`,workspaceId:this.workspaceId,period:'daily',createdAt,state:snapshot});
        await this.storage.backupPut({id:`auto_weekly_${this.workspaceId}_${week}`,workspaceId:this.workspaceId,period:'weekly',createdAt,state:snapshot});
        await this.storage.backupPut({id:`auto_monthly_${this.workspaceId}_${month}`,workspaceId:this.workspaceId,period:'monthly',createdAt,state:snapshot});
        await this.storage.pruneBackups?.({daily:7,weekly:4,monthly:3});
        await this.storage.set(this.storageKey,this.state);
      }
    }
  }

  log(type,message,details=null){
    this.state.journal.unshift({id:uid('log'),type,message,details,createdAt:now()});
    this.state.journal=this.state.journal.slice(0,500);
  }

  queue(operation){
    if(!this.state.preferences.syncEnabled)return;
    const existingIndex=this.state.queue.findIndex(item=>['pending','error','conflict'].includes(item.status)&&item.entity===operation.entity&&item.entityId===operation.entityId);
    const existing=existingIndex>=0?this.state.queue[existingIndex]:null;
    const next={id:existing?.id||uid('op'),entity:operation.entity,entityId:operation.entityId,action:operation.action,payload:operation.payload,createdAt:now(),firstQueuedAt:existing?.firstQueuedAt||existing?.createdAt||now(),status:'pending',attempts:Number(existing?.attempts||0),lastError:null,nextRetryAt:0};
    if(existingIndex>=0)this.state.queue[existingIndex]=next;else this.state.queue.push(next);
    if(this.state.queue.length>1000)this.state.queue=this.state.queue.slice(-1000);
  }

  async mutate(label,fn,options={}){
    if(!options.bypassPermissions&&this.writeGuard&&!this.writeGuard(options))throw new Error('Votre rôle ne permet pas cette modification.');
    const previous=this.snapshot();
    try{
      const result=await fn(this.state);
      this.state.metadata.revision+=1;
      if(options.log!==false)this.log(options.kind||'modification',label,options.details);
      if(options.queue!==false)this.queue({entity:options.entity||'state',entityId:options.entityId||'state',action:options.action||'update',payload:options.payload||null});
      await this.persist();
      this.notify({label,...options});
      return result;
    }catch(error){this.state=previous;throw error;}
  }

  get(type,id,{includeDeleted=false}={}){return(this.state[type]||[]).find(item=>item.id===id&&(includeDeleted||!item.deletedAt));}
  list(type,{includeDeleted=false}={}){return(this.state[type]||[]).filter(item=>includeDeleted||!item.deletedAt);}

  async upsert(type,entity,{label,queue=true}={}){
    if(!ENTITY_TYPES.includes(type))throw new Error(`Type inconnu : ${type}`);
    const existing=entity.id?this.get(type,entity.id,{includeDeleted:true}):null;
    const normalized=normalizeEntity(type,entity,existing);
    const errors=validate(type,normalized);if(errors.length)throw new Error(errors.join(' — '));
    if(type==='rotations'){
      const duplicate=this.state.rotations.find(item=>!item.deletedAt&&item.id!==normalized.id&&item.parcelId===normalized.parcelId&&item.campaignId===normalized.campaignId);
      if(duplicate)throw new Error('Une rotation existe déjà pour cette parcelle et cette campagne.');
    }
    await this.mutate(label||`${existing?'Modification':'Création'} ${type}`,state=>{
      const index=state[type].findIndex(item=>item.id===normalized.id);
      if(index>=0)state[type][index]=normalized;else state[type].push(normalized);
    },{entity:type,entityId:normalized.id,action:existing?'update':'create',payload:normalized,queue});
    return normalized;
  }

  async upsertMany(type,entities,{label='Mise à jour groupée'}={}){
    if(!ENTITY_TYPES.includes(type))throw new Error(`Type inconnu : ${type}`);
    if(this.writeGuard&&!this.writeGuard({entity:type,action:'update'}))throw new Error('Votre rôle ne permet pas cette modification.');
    const previous=this.snapshot();
    try{
      const normalized=entities.map(entity=>{const existing=entity.id?this.get(type,entity.id,{includeDeleted:true}):null;const value=normalizeEntity(type,entity,existing);const errors=validate(type,value);if(errors.length)throw new Error(errors.join(' — '));return{value,existing};});
      for(const {value,existing} of normalized){const index=this.state[type].findIndex(item=>item.id===value.id);if(index>=0)this.state[type][index]=value;else this.state[type].push(value);this.queue({entity:type,entityId:value.id,action:existing?'update':'create',payload:value});}
      this.state.metadata.revision+=1;this.log('modification',label,{count:normalized.length,type});await this.persist();this.notify({label,kind:'batch',entity:type,count:normalized.length});return normalized.map(x=>x.value);
    }catch(error){this.state=previous;throw error;}
  }

  async remove(type,id){
    const found=this.get(type,id);if(!found)throw new Error('Élément introuvable.');
    const deletedAt=now();
    await this.mutate(`${type.slice(0,-1)} placé dans la corbeille.`,state=>{
      const item=state[type].find(value=>value.id===id);item.deletedAt=deletedAt;item.updatedAt=deletedAt;item.version=(item.version||0)+1;
    },{entity:type,entityId:id,action:'delete',payload:{id,deletedAt}});
  }

  async restore(type,id){
    const found=this.get(type,id,{includeDeleted:true});if(!found?.deletedAt)throw new Error('Élément introuvable dans la corbeille.');
    await this.mutate(`${type.slice(0,-1)} restauré.`,state=>{const item=state[type].find(v=>v.id===id);item.deletedAt=null;item.updatedAt=now();item.version=(item.version||0)+1;},{entity:type,entityId:id,action:'update',payload:{id,deletedAt:null}});
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

  async applyRemote(type,entity){
    if(!ENTITY_TYPES.includes(type))throw new Error(`Type inconnu : ${type}`);
    const incoming=clone(entity);
    const errors=validate(type,incoming);if(errors.length&&!incoming.deletedAt)throw new Error(errors.join(' — '));
    await this.mutate(`Synchronisation distante : ${type}`,state=>{
      const index=state[type].findIndex(item=>item.id===incoming.id);
      if(index>=0)state[type][index]=incoming;else state[type].push(incoming);
    },{entity:type,entityId:incoming.id,action:'remote',queue:false,log:false,bypassPermissions:true});
    return incoming;
  }

  async setPreferences(patch){return this.mutate('Préférences mises à jour.',state=>Object.assign(state.preferences,patch),{queue:false,kind:'settings',entity:'preferences',action:'update'});}
  async setExploitation(patch){return this.mutate('Informations de l’exploitation mises à jour.',state=>Object.assign(state.exploitation,patch,{updatedAt:now()}),{queue:false,kind:'settings',entity:'exploitation',action:'update'});}

  async replaceState(next,label='Données remplacées',{kind='restore',log=true,bypassPermissions=false}={}){
    if(!bypassPermissions&&this.writeGuard&&!this.writeGuard({entity:'state',action:'restore'}))throw new Error('Votre rôle ne permet pas de restaurer les données.');
    const migrated=migrateData(next);
    const previous=this.snapshot();
    try{
      this.state=migrated;
      this.state.metadata.revision=(previous.metadata?.revision||0)+1;
      if(log)this.log(kind,label);
      await this.persist();
      this.notify({label,kind,queue:false});
    }catch(error){this.state=previous;throw error;}
  }
}
