import {campaignFor, normalize, toNumber} from './utils.js';

export function buildAssistantContext(state){
  const active=t=>(state[t]||[]).filter(x=>!x.deletedAt);
  const parcels=active('parcelles').map(p=>({id:p.id,name:p.nom,culture:p.culture||'',surfaceHa:toNumber(p.surfaceHa),commune:p.commune||'',ownershipType:p.ownershipType||'own'}));
  const parcelNames=new Map(parcels.map(p=>[p.id,p.name]));
  const works=active('interventions').slice(-300).map(w=>({id:w.id,parcelId:w.parcelId,parcel:parcelNames.get(w.parcelId)||'',type:w.type||'',date:w.date||'',plannedDate:w.plannedDate||'',status:w.status||'',product:w.product||'',surfaceWorked:toNumber(w.surfaceWorked),cost:toNumber(w.cost)}));
  return{farm:{name:state.exploitation?.nom||'',commune:state.exploitation?.commune||''},campaign:campaignFor(),parcels,works,tasks:active('tasks').map(t=>({id:t.id,title:t.title,dueDate:t.dueDate,status:t.status,parcelId:t.parcelId||''})),equipment:active('materiels').map(m=>({id:m.id,name:m.nom,currentMeter:m.currentMeter,maintenanceDue:m.maintenanceDue}))};
}

export async function askRemoteAssistant({endpoint,question,state,timeoutMs=15000}){
  if(!endpoint)throw new Error('Aucun endpoint IA configuré.');
  const url=new URL(endpoint,location.href);if(!/^https:$/.test(url.protocol)&&url.hostname!=='localhost')throw new Error('L’endpoint IA doit utiliser HTTPS.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:String(question).slice(0,1200),context:buildAssistantContext(state),client:'Parcelles',mode:'assistant'}),signal:controller.signal});
    if(!response.ok)throw new Error(`Service IA ${response.status}`);
    const data=await response.json();const answer=data.answer||data.text||data.response;
    if(!String(answer||'').trim())throw new Error('Le service IA n’a retourné aucune réponse.');
    return{answer:String(answer).slice(0,6000),actions:Array.isArray(data.actions)?data.actions:[]};
  }finally{clearTimeout(timer);}
}
