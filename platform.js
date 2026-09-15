import {BUILD_ID, clone, uid} from './utils.js';

export const PLATFORM_VERSION='7.0';
export const PLATFORM_JOB_TYPES={
  campaignReport:'Bilan de campagne',
  documentIndex:'Indexation documentaire',
  integrationDigest:'Synthèse des intégrations',
  automationRun:'Automatisation cloud',
  dataQuality:'Contrôle qualité étendu'
};

export function workspaceStorageKey(workspaceId='local'){
  const value=String(workspaceId||'local').trim();
  return value&&value!=='local'?`state:workspace:${value.replace(/[^a-zA-Z0-9_-]/g,'_')}`:'state';
}

export function normalizeApiEndpoint(value=''){
  const raw=String(value||'').trim().replace(/\/+$/,'');
  if(!raw)return '';
  try{
    const url=new URL(raw);
    if(!['https:','http:'].includes(url.protocol))return '';
    if(url.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname))return '';
    return url.href.replace(/\/$/,'');
  }catch{return '';}
}

export function platformCapabilities(state={}){
  const prefs=state.preferences||{};
  const endpoint=normalizeApiEndpoint(prefs.platformApiEndpoint||'');
  return {
    version:PLATFORM_VERSION,
    localFirst:true,
    workspaceIsolation:prefs.platformIsolation!==false,
    backendConfigured:Boolean(prefs.platformBackendEnabled&&endpoint),
    endpoint,
    cloudJobs:Boolean(prefs.platformBackendEnabled&&endpoint),
    secretsInClient:false,
    auth:'Firebase ID token when available',
    build:BUILD_ID
  };
}

export function platformSummary(state={},workspaceContext={id:'local',key:'state'}){
  const jobs=(state.platformJobs||[]).filter(x=>!x.deletedAt);
  const statusCount=jobs.reduce((acc,j)=>{const k=j.status||'local';acc[k]=(acc[k]||0)+1;return acc;},{});
  return {
    workspaceId:workspaceContext.id||'local',storageKey:workspaceContext.key||workspaceStorageKey(workspaceContext.id),
    jobs:jobs.length,pending:(statusCount.pending||0)+(statusCount.local||0),running:statusCount.running||0,
    done:statusCount.done||0,error:statusCount.error||0,
    lastHealthAt:state.metadata?.lastPlatformHealthAt||null,lastStatus:state.metadata?.lastPlatformStatus||null,
    capabilities:platformCapabilities(state)
  };
}

function timeoutSignal(ms=5000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
  return {signal:controller.signal,clear:()=>clearTimeout(timer)};
}

export class PlatformService{
  constructor(store,sync){this.store=store;this.sync=sync;this.lastHealth=null;}
  endpoint(){return normalizeApiEndpoint(this.store.snapshot().preferences.platformApiEndpoint||'');}
  enabled(){const p=this.store.snapshot().preferences;return Boolean(p.platformBackendEnabled&&this.endpoint());}
  async authHeaders(){
    const headers={'content-type':'application/json','x-parcelles-build':BUILD_ID};
    try{const token=await this.sync?.user?.getIdToken?.();if(token)headers.authorization=`Bearer ${token}`;}catch{}
    return headers;
  }
  async health({timeout=4500}={}){
    const endpoint=this.endpoint();
    if(!this.enabled())return {ok:false,configured:false,status:'Backend non configuré',endpoint};
    const timer=timeoutSignal(timeout);let result;
    try{
      const response=await fetch(`${endpoint}/health`,{headers:await this.authHeaders(),signal:timer.signal,cache:'no-store'});
      let body=null;try{body=await response.json();}catch{}
      result={ok:response.ok,configured:true,status:response.ok?'Backend disponible':`HTTP ${response.status}`,httpStatus:response.status,endpoint,body,at:Date.now()};
    }catch(error){result={ok:false,configured:true,status:error?.name==='AbortError'?'Délai dépassé':String(error?.message||error),endpoint,at:Date.now()};}
    finally{timer.clear();}
    this.lastHealth=result;
    await this.store.mutate('État de la plateforme mis à jour.',state=>{state.metadata.lastPlatformHealthAt=result.at||Date.now();state.metadata.lastPlatformStatus=result.status;},{queue:false,log:false,bypassPermissions:true});
    return result;
  }
  async enqueueJob(type,payload={},options={}){
    if(!PLATFORM_JOB_TYPES[type])throw new Error('Type de tâche plateforme inconnu.');
    const item={id:uid('job'),type,payload:clone(payload),status:this.enabled()?'pending':'local',attempts:0,requestedAt:Date.now(),workspaceId:this.store.workspaceContext?.().id||'local',requestedBy:this.sync?.user?.uid||'local',build:BUILD_ID};
    await this.store.upsert('platformJobs',item,{label:`Tâche plateforme créée : ${PLATFORM_JOB_TYPES[type]}`,queue:false});
    if(options.submit!==false&&this.enabled())return this.submitJob(item.id);
    return item;
  }
  async submitJob(id){
    const job=this.store.get('platformJobs',id);if(!job)throw new Error('Tâche plateforme introuvable.');
    if(!this.enabled())throw new Error('Configurez d’abord le backend Parcelles.');
    await this.store.upsert('platformJobs',{...job,status:'running',attempts:Number(job.attempts||0)+1,lastAttemptAt:Date.now()},{label:'Tâche plateforme envoyée.',queue:false});
    const endpoint=this.endpoint(),timer=timeoutSignal(12000);
    try{
      const response=await fetch(`${endpoint}/v1/jobs`,{method:'POST',headers:await this.authHeaders(),body:JSON.stringify({type:job.type,payload:job.payload,workspaceId:job.workspaceId,clientJobId:job.id,build:BUILD_ID}),signal:timer.signal});
      let body=null;try{body=await response.json();}catch{}
      if(!response.ok)throw new Error(body?.error||`HTTP ${response.status}`);
      const updated={...this.store.get('platformJobs',id),status:body?.status||'submitted',remoteJobId:body?.id||body?.jobId||null,response:body||null,submittedAt:Date.now(),lastError:null};
      await this.store.upsert('platformJobs',updated,{label:'Tâche plateforme acceptée.',queue:false});
      return updated;
    }catch(error){const updated={...this.store.get('platformJobs',id),status:'error',lastError:String(error?.message||error),failedAt:Date.now()};await this.store.upsert('platformJobs',updated,{label:'Échec de la tâche plateforme.',queue:false});throw error;}
    finally{timer.clear();}
  }
  async recordEvent(kind,message,details=null){
    return this.store.upsert('platformEvents',{id:uid('pevent'),kind,message,details:details?clone(details):null,workspaceId:this.store.workspaceContext?.().id||'local',build:BUILD_ID,occurredAt:Date.now()},{label:message||'Événement plateforme',queue:false});
  }
}
