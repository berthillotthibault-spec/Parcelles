import {APP_VERSION, ENTITY_TYPES, campaignFor, clone, now, toNumber, uid, validateIntervention, validateParcel} from './utils.js';

export function emptyState(){
  const timestamp = now();
  return {
    version: APP_VERSION,
    exploitation: {id:'farm_local',nom:'Mon exploitation',commune:'',latitude:null,longitude:null,createdAt:timestamp,updatedAt:timestamp},
    campagnes: [], parcelles: [], interventions: [], rotations: [], materiels: [], documents: [], photos: [], points: [],
    preferences: {mapLayer:'osm',theme:'system',gpsConsent:false,notifications:false,autoBackup:true},
    metadata: {createdAt:timestamp,updatedAt:timestamp,lastImportAt:null,lastSyncAt:null,revision:0},
    queue: [], journal: []
  };
}

function normalizeEntity(type, entity, existing = null){
  const timestamp = now();
  const base = existing || {};
  return {...base,...clone(entity),id:entity.id || base.id || uid(type.slice(0,-1)),createdAt:base.createdAt || entity.createdAt || timestamp,updatedAt:timestamp,deletedAt:null,source:entity.source || base.source || 'local',sourceId:entity.sourceId || base.sourceId || null,version:(base.version || entity.version || 0) + (existing ? 1 : 0)};
}

export function migrateData(input){
  let data = clone(input || {});
  if (!data.version) {
    data = {...emptyState(),...data,version:1};
    if (Array.isArray(data.parcelles)) data.parcelles = data.parcelles.map(parcel => ({...parcel,nom:parcel.nom || parcel.name || parcel.Nom || 'Sans nom',surfaceHa:toNumber(parcel.surfaceHa ?? parcel.surface ?? 0)}));
  }
  if (data.version < 2) {
    const legacyInterventions = Array.isArray(data.interventions) && data.interventions.length ? data.interventions : (data.manualInterventions || []);
    data.interventions = legacyInterventions.map(item => ({...item,parcelId:item.parcelId || item.parcelleId || item.parcel_id,date:item.date || new Date().toISOString(),type:item.type || item.operation || 'Intervention'}));
    data.version = 2;
  }
  if (data.version < 3) {
    const base = emptyState();
    data = {...base,...data,metadata:{...base.metadata,...data.metadata},preferences:{...base.preferences,...data.preferences},queue:data.queue || [],journal:data.journal || []};
    ENTITY_TYPES.forEach(type => { data[type] = Array.isArray(data[type]) ? data[type].map(entity => normalizeEntity(type,entity)) : []; });
    data.interventions.forEach(item => { item.campaignId = item.campaignId || campaignFor(item.date); });
    data.version = 3;
  }
  const base = emptyState();
  data = {...base,...data,exploitation:{...base.exploitation,...data.exploitation},preferences:{...base.preferences,...data.preferences},metadata:{...base.metadata,...data.metadata}};
  ENTITY_TYPES.forEach(type => { if (!Array.isArray(data[type])) data[type] = []; });
  return data;
}

export class Store {
  constructor(storage){ this.storage = storage; this.state = emptyState(); this.listeners = new Set(); this.pendingSave = null; }
  async init(){
    await this.storage.init();
    const saved = await this.storage.get('state');
    this.state = migrateData(saved || emptyState());
    if (saved?.version !== this.state.version) this.log('migration','Données mises à jour vers le format v3.');
    await this.persist();
    return this.state;
  }
  snapshot(){ return clone(this.state); }
  subscribe(listener){ this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(event){ for(const listener of this.listeners) listener(this.snapshot(),event); }
  async persist(){
    this.state.metadata.updatedAt = now();
    await this.storage.set('state',this.state);
    if (this.state.preferences.autoBackup) {
      const day = new Date().toISOString().slice(0,10);
      if (this.state.metadata.lastAutoBackupDay !== day) {
        this.state.metadata.lastAutoBackupDay = day;
        await this.storage.backupPut({id:`auto_${day}`,createdAt:now(),state:clone(this.state)});
      }
    }
  }
  async mutate(label, fn, options = {}){
    const previous = this.snapshot();
    try {
      const result = await fn(this.state);
      this.state.metadata.revision += 1;
      if (options.log !== false) this.log(options.kind || 'modification',label,options.details);
      if (options.queue !== false) this.queue({entity:options.entity || 'state',entityId:options.entityId || 'state',action:options.action || 'update',payload:options.payload || null});
      await this.persist(); this.notify({label,...options}); return result;
    } catch(error) { this.state = previous; throw error; }
  }
  log(type,message,details = null){
    this.state.journal.unshift({id:uid('log'),type,message,details,createdAt:now()});
    this.state.journal = this.state.journal.slice(0,500);
  }
  queue(operation){
    this.state.queue.push({id:uid('op'),entity:operation.entity,entityId:operation.entityId,action:operation.action,payload:operation.payload,createdAt:now(),status:'pending'});
  }
  get(type,id,{includeDeleted=false} = {}){ return (this.state[type] || []).find(item => item.id === id && (includeDeleted || !item.deletedAt)); }
  list(type,{includeDeleted=false} = {}){ return (this.state[type] || []).filter(item => includeDeleted || !item.deletedAt); }
  async upsert(type,entity,{label,queue=true} = {}){
    if (!ENTITY_TYPES.includes(type)) throw new Error(`Type inconnu : ${type}`);
    const existing = entity.id ? this.get(type,entity.id,{includeDeleted:true}) : null;
    const normalized = normalizeEntity(type,entity,existing);
    const errors = type === 'parcelles' ? validateParcel(normalized) : type === 'interventions' ? validateIntervention(normalized) : [];
    if (errors.length) throw new Error(errors.join(' — '));
    await this.mutate(label || `${existing ? 'Modification' : 'Création'} ${type}`, state => {
      const index = state[type].findIndex(item => item.id === normalized.id);
      if (index >= 0) state[type][index] = normalized; else state[type].push(normalized);
      if (type === 'interventions') normalized.campaignId = normalized.campaignId || campaignFor(normalized.date);
    },{entity:type,entityId:normalized.id,action:existing ? 'update' : 'create',payload:normalized,queue});
    return normalized;
  }
  async remove(type,id){
    const found = this.get(type,id);
    if (!found) throw new Error('Élément introuvable.');
    await this.mutate(`${type.slice(0,-1)} placé dans la corbeille.`, state => {
      const item = state[type].find(value => value.id === id); item.deletedAt = now(); item.updatedAt = now(); item.version += 1;
    },{entity:type,entityId:id,action:'delete',payload:{id,deletedAt:now()}});
  }
  async restore(type,id){
    const found = this.get(type,id,{includeDeleted:true});
    if (!found?.deletedAt) throw new Error('Élément introuvable dans la corbeille.');
    await this.mutate(`${type.slice(0,-1)} restauré.`, state => { const item = state[type].find(value => value.id===id); item.deletedAt=null; item.updatedAt=now(); item.version+=1; },{entity:type,entityId:id,action:'update',payload:{id,deletedAt:null}});
  }
  async setPreferences(patch){ return this.mutate('Préférences mises à jour.',state => Object.assign(state.preferences,patch),{queue:false,kind:'settings'}); }
  async setExploitation(patch){ return this.mutate('Informations de l’exploitation mises à jour.',state => Object.assign(state.exploitation,patch,{updatedAt:now()}),{queue:false,kind:'settings'}); }
  async replaceState(next,label='Restauration de sauvegarde'){ const migrated = migrateData(next); await this.mutate(label,() => {this.state=migrated;},{queue:false,kind:'restore'}); }
}
