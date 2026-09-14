import {campaignFor, toNumber} from './utils.js';

const ALLOWED_ACTIONS=new Set(['create_work','create_task','open_parcel','search']);

function sanitizeAction(action){
  if(!action||!ALLOWED_ACTIONS.has(action.type))return null;
  const payload=action.payload&&typeof action.payload==='object'?action.payload:{};
  return{type:action.type,label:String(action.label||'Action proposée').slice(0,120),payload:JSON.parse(JSON.stringify(payload))};
}

export function buildAssistantContext(state){
  const active=t=>(state[t]||[]).filter(x=>!x.deletedAt);
  const parcels=active('parcelles').map(p=>({id:p.id,name:p.nom,culture:p.culture||'',surfaceHa:toNumber(p.surfaceHa),commune:p.commune||'',ownershipType:p.ownershipType||'own'}));
  const parcelNames=new Map(parcels.map(p=>[p.id,p.name]));
  const works=active('interventions').slice(-300).map(w=>({id:w.id,parcelId:w.parcelId,parcel:parcelNames.get(w.parcelId)||'',type:w.type||'',date:w.date||'',plannedDate:w.plannedDate||'',status:w.status||'',product:w.product||'',surfaceWorked:toNumber(w.surfaceWorked),cost:toNumber(w.cost)}));
  const conversation=active('assistantMessages').slice(-12).map(m=>({role:m.role,text:String(m.text||'').slice(0,1200)}));
  return{farm:{name:state.exploitation?.nom||'',commune:state.exploitation?.commune||''},campaign:campaignFor(),parcels,works,tasks:active('tasks').map(t=>({id:t.id,title:t.title,dueDate:t.dueDate,status:t.status,parcelId:t.parcelId||''})),equipment:active('materiels').map(m=>({id:m.id,name:m.nom,currentMeter:m.currentMeter,maintenanceDue:m.maintenanceDue})),conversation};
}

export async function askRemoteAssistant({endpoint,question,state,timeoutMs=15000}={}){
  if(!endpoint)throw new Error('Aucun endpoint IA configuré.');
  const url=new URL(endpoint,location.href);if(!/^https:$/.test(url.protocol)&&url.hostname!=='localhost')throw new Error('L’endpoint IA doit utiliser HTTPS.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:String(question).slice(0,1200),context:buildAssistantContext(state),client:'Parcelles',mode:'assistant-v5',allowedActions:[...ALLOWED_ACTIONS]}),signal:controller.signal});
    if(!response.ok)throw new Error(`Service IA ${response.status}`);
    const data=await response.json(),answer=data.answer||data.text||data.response;
    if(!String(answer||'').trim())throw new Error('Le service IA n’a retourné aucune réponse.');
    return{answer:String(answer).slice(0,6000),actions:(Array.isArray(data.actions)?data.actions:[]).map(sanitizeAction).filter(Boolean).slice(0,4)};
  }finally{clearTimeout(timer);}
}
