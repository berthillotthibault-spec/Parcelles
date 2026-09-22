import {clone,uid} from './utils.js';
import {normalizeEntity} from './state.js';

export const TP_STATUSES=['Planifié','En cours','En pause','Terminé','Annulé'];
export const isPublicWorks=record=>record?.kind==='tp';
const projectFields=new Set(['type','clientId','address','plannedDate','status','equipmentId','operator','parcelId','note']);
const logFields=new Set(['date','equipmentId','operator','hours','volumeM3','tonnage','note']);
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const active=rows=>(Array.isArray(rows)?rows:[]).filter(row=>row&&!row.deletedAt);

function requireWrite(store,id){
  if(store.writeGuard&&!store.writeGuard({entity:'chantiers',action:id?'update':'create',entityId:id}))throw new Error('Votre rôle ne permet pas cette modification.');
}
function inputRecord(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Les informations du chantier sont invalides.');
  for(const key of Object.keys(value))if(!fields.has(key))throw new Error(`Le champ ${key} ne peut pas être modifié ici.`);
}
function text(value,label,max=200){
  if(typeof value!=='string')throw new Error(`${label} doit être du texte.`);
  const result=value.trim();if(result.length>max)throw new Error(`${label} : ${max} caractères maximum.`);return result;
}
function date(value,required=false){
  if(!value&&!required)return '';
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T12:00:00Z`))||new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)!==value)throw new Error('Renseignez une date valide.');
  return value;
}
function quantity(value,label){
  if(value===null||value===undefined||value==='')return null;
  const str=typeof value==='string'?value.trim().replace(',','.'):null;
  if(str==='')return null;
  if(typeof value!=='number'&&(str===null||!/^\d+(?:\.\d+)?$/.test(str)))throw new Error(`${label} : utilisez un nombre positif ou zéro.`);
  const n=typeof value==='number'?value:Number(str);
  if(!Number.isFinite(n)||n<0||n>1e9)throw new Error(`${label} : renseignez une valeur entre 0 et 1 000 000 000.`);
  return n;
}
function reference(store,type,value,label){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string')throw new Error(`${label} invalide.`);
  const id=value.trim();if(!id)return null;
  if(active(store.state[type]).filter(row=>row.id===id).length!==1)throw new Error(`${label} introuvable ou supprimé.`);
  return id;
}
function project(store,id){
  const rows=(store.state.chantiers||[]).filter(row=>row.id===id);
  if(rows.length!==1||rows[0].deletedAt||!isPublicWorks(rows[0]))throw new Error('Ce chantier TP est introuvable ou supprimé.');
  return rows[0];
}
async function persistProject(store,record,current,label){
  const saved=normalizeEntity('chantiers',record,current);
  await store._mutate(label,state=>{
    if(current)state.chantiers[state.chantiers.findIndex(row=>row.id===saved.id)]=saved;
    else state.chantiers.push(saved);
  },{entity:'chantiers',entityId:saved.id,action:current?'update':'create',payload:saved});
  return clone(saved);
}

export function savePublicWorksProject(store,input,{id=null}={}){
  const values=clone(input);
  return store.enqueueWrite(async()=>{
    requireWrite(store,id);inputRecord(values,projectFields);
    const current=id?project(store,id):null,patch={kind:'tp'};
    for(const key of ['type','address','operator','note'])if(has(values,key))patch[key]=text(values[key],{type:'Le nom',address:'L’adresse',operator:'L’opérateur',note:'La note'}[key],key==='note'?4000:key==='address'?500:200);
    if(!(patch.type??current?.type))throw new Error('Renseignez le nom du chantier.');
    if(has(values,'plannedDate'))patch.plannedDate=date(values.plannedDate);
    if(has(values,'status')){if(!TP_STATUSES.includes(values.status))throw new Error('Choisissez un état de chantier valide.');patch.status=values.status;}
    for(const [key,type,label] of [['clientId','clients','Le client'],['equipmentId','materiels','L’engin']])if(has(values,key))patch[key]=reference(store,type,values[key],label);
    if(has(values,'parcelId')){const id=reference(store,'parcelles',values.parcelId,'La parcelle');patch.parcelIds=id?[id]:[];}
    const record={type:'',address:'',plannedDate:'',status:'Planifié',clientId:null,equipmentId:null,operator:'',parcelIds:[],note:'',tpLogs:[],...current,...patch};
    return persistProject(store,record,current,`Chantier TP ${current?'modifié':'créé'} : ${record.type}`);
  });
}

export function savePublicWorksLog(store,chantierId,input,{id=null}={}){
  const values=clone(input);
  return store.enqueueWrite(async()=>{
    requireWrite(store,chantierId);inputRecord(values,logFields);
    const current=project(store,chantierId),logs=Array.isArray(current.tpLogs)?clone(current.tpLogs):[];
    const matches=id?logs.filter(row=>row.id===id):[];
    if(id&&(matches.length!==1||matches[0].deletedAt))throw new Error('Cette ligne du journal est introuvable ou supprimée.');
    const previous=matches[0]||{},patch={};
    for(const key of ['operator','note'])if(has(values,key))patch[key]=text(values[key],key==='note'?'La note':'L’opérateur',key==='note'?4000:200);
    if(has(values,'date'))patch.date=date(values.date,true);
    if(!date(patch.date??previous.date,true))throw new Error('Renseignez la date de réalisation.');
    for(const key of ['hours','volumeM3','tonnage'])if(has(values,key))patch[key]=quantity(values[key],{hours:'Heures',volumeM3:'Volume',tonnage:'Tonnage'}[key]);
    if(has(values,'equipmentId'))patch.equipmentId=reference(store,'materiels',values.equipmentId,'L’engin');
    const timestamp=Date.now(),log={hours:null,volumeM3:null,tonnage:null,equipmentId:null,operator:'',note:'',...previous,...patch,id:id||uid('tplog'),createdAt:previous.createdAt||timestamp,updatedAt:timestamp,deletedAt:null};
    if(!['hours','volumeM3','tonnage'].some(key=>log[key]!==null&&log[key]!==undefined)&&!log.note)throw new Error('Renseignez des heures, une quantité ou une note de réalisation.');
    if(id)logs[logs.findIndex(row=>row.id===id)]=log;else logs.push(log);
    return persistProject(store,{...current,tpLogs:logs},current,`Journal TP enregistré : ${current.type}`);
  });
}

export function deletePublicWorksLog(store,chantierId,id){
  return store.enqueueWrite(async()=>{
    requireWrite(store,chantierId);const current=project(store,chantierId),logs=Array.isArray(current.tpLogs)?clone(current.tpLogs):[];
    const matches=logs.filter(row=>row.id===id);
    if(matches.length!==1||matches[0].deletedAt)throw new Error('Cette ligne du journal est introuvable ou supprimée.');
    matches[0].deletedAt=Date.now();matches[0].updatedAt=Date.now();
    return persistProject(store,{...current,tpLogs:logs},current,`Ligne du journal TP supprimée : ${current.type}`);
  });
}

export function publicWorksTotals(record){
  const logs=active(record?.tpLogs),result={entries:logs.length,hours:0,volumeM3:0,tonnage:0};
  for(const log of logs)for(const key of ['hours','volumeM3','tonnage']){const value=log[key];if(value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0)result[key]+=Number(value);}
  for(const key of ['hours','volumeM3','tonnage'])result[key]=Math.round((result[key]+Number.EPSILON)*1000)/1000;
  return result;
}

export function filterPublicWorksProjects(rows,{status='',clientId='',equipmentId='',query=''}={}){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const search=normalize(query).trim();
  return active(rows).filter(row=>isPublicWorks(row)&&(!status||row.status===status)&&(!clientId||row.clientId===clientId)&&(!equipmentId||row.equipmentId===equipmentId||active(row.tpLogs).some(log=>log.equipmentId===equipmentId))&&(!search||normalize(`${row.type} ${row.address||''} ${row.operator||''} ${row.note||''}`).includes(search))).sort((a,b)=>String(b.plannedDate||'').localeCompare(String(a.plannedDate||''))||String(a.type||'').localeCompare(String(b.type||''),'fr'));
}
