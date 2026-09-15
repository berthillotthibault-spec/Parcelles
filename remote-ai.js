import {campaignFor, toNumber} from './utils.js';

const ALLOWED_ACTIONS=new Set([
  'create_work','create_task','open_parcel','open_work','open_task','open_equipment',
  'open_stock','open_observation','open_chantier','open_map','search'
]);

function sanitizeAction(action){
  if(!action||!ALLOWED_ACTIONS.has(action.type))return null;
  const payload=action.payload&&typeof action.payload==='object'?action.payload:{};
  return{type:action.type,label:String(action.label||'Action proposée').slice(0,120),payload:JSON.parse(JSON.stringify(payload)),requiresConfirmation:['create_work','create_task'].includes(action.type)};
}

export function buildAssistantContext(state,context={}){
  const active=t=>(state[t]||[]).filter(x=>!x.deletedAt),limit=(rows,n)=>rows.slice(Math.max(0,rows.length-n));
  const parcels=active('parcelles').map(p=>({id:p.id,name:p.nom,culture:p.culture||'',surfaceHa:toNumber(p.surfaceHa),commune:p.commune||'',ownershipType:p.ownershipType||'own'}));
  const parcelNames=new Map(parcels.map(p=>[p.id,p.name]));
  const works=limit(active('interventions'),300).map(w=>({id:w.id,parcelId:w.parcelId,parcel:parcelNames.get(w.parcelId)||'',type:w.type||'',date:w.date||'',plannedDate:w.plannedDate||'',status:w.status||'',product:w.product||'',dose:w.dose??null,doseUnit:w.doseUnit||'',surfaceWorked:toNumber(w.surfaceWorked),cost:toNumber(w.cost)}));
  const tasks=limit(active('tasks'),120).map(t=>({id:t.id,title:t.title,dueDate:t.dueDate,status:t.status,priority:t.priority||'',parcelId:t.parcelId||''}));
  const equipment=active('materiels').slice(0,120).map(m=>({id:m.id,name:m.nom,currentMeter:m.currentMeter,maintenanceDue:m.maintenanceDue,status:m.status||''}));
  const observations=limit(active('observations'),120).map(o=>({id:o.id,title:o.title||o.type||'',parcelId:o.parcelId||'',status:o.status||'',severity:o.severity||'',date:o.date||''}));
  const stocks=active('stockItems').slice(0,120).map(x=>({id:x.id,name:x.name||'',quantity:toNumber(x.quantity),unit:x.unit||'',alertBelow:x.alertBelow??null,category:x.category||''}));
  const chantiers=limit(active('chantiers'),80).map(c=>({id:c.id,type:c.type||'',status:c.status||'',plannedDate:c.plannedDate||'',parcelIds:Array.isArray(c.parcelIds)?c.parcelIds.slice(0,80):[]}));
  const conversation=limit(active('assistantMessages'),12).map(m=>({role:m.role,text:String(m.text||'').slice(0,1200)}));
  const currentParcel=context.currentParcelId?parcels.find(p=>p.id===context.currentParcelId)||null:null;
  return{
    farm:{name:state.exploitation?.nom||'',commune:state.exploitation?.commune||''},campaign:campaignFor(),
    current:{parcel:currentParcel,view:context.view||'',fieldMode:Boolean(context.fieldModeOpen),gpsAccuracy:context.lastGps?.accuracy??null},
    parcels,works,tasks,equipment,observations,stocks,chantiers,conversation,
    policy:{localFirst:true,writeActionsRequireConfirmation:true,noAgronomicRecommendationWithoutExplicitSource:true}
  };
}

export async function askRemoteAssistant({endpoint,question,state,context={},timeoutMs=15000}={}){
  if(!endpoint)throw new Error('Aucun endpoint IA configuré.');
  const url=new URL(endpoint,location.href);if(!/^https:$/.test(url.protocol)&&url.hostname!=='localhost')throw new Error('L’endpoint IA doit utiliser HTTPS.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:String(question).slice(0,1200),context:buildAssistantContext(state,context),client:'Parcelles',mode:'assistant-v7.0',allowedActions:[...ALLOWED_ACTIONS]}),signal:controller.signal});
    if(!response.ok)throw new Error(`Service IA ${response.status}`);
    const data=await response.json(),answer=data.answer||data.text||data.response;
    if(!String(answer||'').trim())throw new Error('Le service IA n’a retourné aucune réponse.');
    return{answer:String(answer).slice(0,6000),actions:(Array.isArray(data.actions)?data.actions:[]).map(sanitizeAction).filter(Boolean).slice(0,6)};
  }finally{clearTimeout(timer);}
}
