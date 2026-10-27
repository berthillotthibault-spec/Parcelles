import {campaignFor, toNumber, normalize} from './utils.js';
import {grazingStatus, grazingTotal, grazingType, grazingDate} from './grazing.js';
import {farmRecords} from './farm-records.js';
import {validateExtraction, EXTRACT_MODE} from './stock-capture.js';

// n° 104 : create_observation, stock_movement, grazing_exit et plan_works écrivent après une fiche de
// confirmation (assistant-actions.js) ; n° 111 : show_on_map surligne des parcelles sur la carte.
export const WRITE_ACTIONS=Object.freeze(['create_work','create_task','create_observation','stock_movement','grazing_exit','plan_works']);
const ALLOWED_ACTIONS=new Set([
  ...WRITE_ACTIONS,'open_parcel','open_work','open_task','open_equipment',
  'open_farm','open_stock','open_observation','open_chantier','open_map','show_on_map','search'
]);

export function sanitizeAction(action){
  if(!action||!ALLOWED_ACTIONS.has(action.type))return null;
  const payload=action.payload&&typeof action.payload==='object'&&!Array.isArray(action.payload)?action.payload:{};
  if(action.type==='open_farm'&&!['plan','memory','observations','results','zones','economics','decisions','team','machines','sensors','progress','weather'].includes(payload.section))return null;
  let clean;try{clean=JSON.parse(JSON.stringify(payload));}catch{return null;}
  if(action.type==='show_on_map'){const ids=Array.isArray(clean.parcelIds)?clean.parcelIds.filter(id=>typeof id==='string'&&id).slice(0,500):[];if(!ids.length)return null;clean={parcelIds:ids};}
  if(action.type==='plan_works'&&(!Array.isArray(clean.works)||!clean.works.length))return null;
  return{type:action.type,label:String(action.label||'Action proposée').slice(0,120),payload:clean,requiresConfirmation:WRITE_ACTIONS.includes(action.type)};
}

// n° 104 — Mode « anonymiser les noms » : parcelles, personnes, clients et nom de l'exploitation sont
// remplacés par des alias stables (« Parcelle #3 ») dans la question et le contexte envoyés ; la réponse
// et les actions reçues sont retraduites sur l'appareil. L'ordre des alias suit la date de création.
const ALIAS_KINDS={parcel:'Parcelle',person:'Personne',client:'Client',farm:'Exploitation'};
const byCreation=(a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0)||String(a.id||'').localeCompare(String(b.id||''));
export function buildAliases(state={}){
  const live=t=>(state[t]||[]).filter(x=>x&&!x.deletedAt).sort(byCreation);
  const map=new Map(),seen=new Set(),counts={};
  const add=(kind,name)=>{const label=String(name||'').trim(),key=normalize(label);if(label.length<3||seen.has(key))return;seen.add(key);counts[kind]=(counts[kind]||0)+1;map.set(`${ALIAS_KINDS[kind]} #${counts[kind]}`,label);};
  if(state.exploitation?.nom)add('farm',state.exploitation.nom);
  for(const p of live('parcelles'))add('parcel',p.nom);
  for(const c of live('clients'))add('client',c.name||c.nom||c.company);
  const contacts=live('integrationImports').filter(x=>['contact','client'].includes(x.farmKind));
  for(const c of contacts)add(c.farmKind==='client'?'client':'person',c.name||c.nom);
  const people=[...live('members').map(m=>m.displayName||m.name),state.preferences?.defaultOperator,...live('interventions').map(w=>w.operator),...live('tasks').map(t=>t.assignee||t.assignedTo)];
  for(const name of [...new Set(people.map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')))add('person',name);
  return map;
}
const escapeRe=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function replacer(pairs){
  // Les plus longs d'abord (« Grand Pré du Bas » avant « Grand Pré »), sans couper un mot.
  const list=[...pairs].filter(([from])=>from).sort((a,b)=>b[0].length-a[0].length);
  if(!list.length)return value=>value;
  const index=new Map(list.map(([from,to])=>[from.toLocaleLowerCase('fr'),to]));
  const re=new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(([from])=>escapeRe(from)).join('|')})(?![\\p{L}\\p{N}])`,'giu');
  return value=>String(value).replace(re,hit=>index.get(hit.toLocaleLowerCase('fr'))??hit);
}
const deep=(value,fn)=>typeof value==='string'?fn(value):Array.isArray(value)?value.map(v=>deep(v,fn)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,deep(v,fn)])):value;
export function anonymizeValue(value,aliases){const fn=replacer([...aliases].map(([alias,real])=>[real,alias]));return deep(value,fn);}
export function deanonymizeValue(value,aliases){const fn=replacer([...aliases]);return deep(value,fn);}

// Corps exact de la requête envoyée au service (aussi affiché par l'aperçu « Ce que j'envoie »).
export function buildRemoteRequest({question,state,context={},stream=false,anonymize=false}={}){
  const q=String(question||'').slice(0,1200);
  const body={question:q,context:buildAssistantContext(state,{...context,question:String(question||'')}),client:'Parcelles',mode:'assistant-v7.0',stream,allowedActions:[...ALLOWED_ACTIONS]};
  if(!anonymize)return{body,aliases:null};
  const aliases=buildAliases(state);
  return{body:{...anonymizeValue(body,aliases),anonymized:true},aliases};
}

// Résumé météo : seulement un cache de moins de 72 h, jours à venir limités à 3 (72 h).
// « today » en heure locale : daily.time d'Open-Meteo est en heure locale (timezone=auto).
export function weatherSummary(cache,{now=Date.now(),today=grazingDate(new Date(now)),maxAgeMs=72*3600e3}={}){
  const loadedAt=Number(cache?.loadedAt),d=cache?.daily;
  if(!Number.isFinite(loadedAt)||now-loadedAt>maxAgeMs||loadedAt-now>3600e3||!Array.isArray(d?.time))return null;
  const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
  const days=d.time.map((date,i)=>({date,tMin:num(d.temperature_2m_min?.[i]),tMax:num(d.temperature_2m_max?.[i]),rainMm:num(d.precipitation_sum?.[i]),rainProbability:num(d.precipitation_probability_max?.[i]),windKmh:num(d.wind_speed_10m_max?.[i]),gustKmh:num(d.wind_gusts_10m_max?.[i])})).filter(x=>typeof x.date==='string'&&x.date>=today).slice(0,3);
  if(!days.length)return null;
  return{loadedAt:new Date(loadedAt).toISOString(),current:{temperature:num(cache.current?.temperature_2m),windKmh:num(cache.current?.wind_speed_10m)},days};
}

export function buildAssistantContext(state,context={}){
  const q=normalize(context.question||'');
  if(q){
    const parcels=(state.parcelles||[]).filter(p=>!p.deletedAt),named=parcels.filter(p=>normalize(p.nom)&&q.includes(normalize(p.nom)));
    const ids=new Set(named.map(p=>p.id));if(!ids.size&&/cette parcelle/.test(q)&&context.currentParcelId)ids.add(context.currentParcelId);
    const byParcel=rows=>(rows||[]).filter(row=>!ids.size||ids.has(row.parcelId));
    const needWorks=/trav|intervention|sem|fait|historique|bilan/.test(q),needTasks=/tache|retard|aujourd/.test(q),needParcels=ids.size||needWorks||/parcelle|culture|hectare|surface/.test(q);
    state={...state,parcelles:needParcels?(ids.size?parcels.filter(p=>ids.has(p.id)):parcels):[],
      interventions:needWorks?byParcel(state.interventions):[],tasks:needTasks?byParcel(state.tasks):[],
      materiels:/materiel|machine|tracteur|entretien|maintenance/.test(q)?state.materiels:[],
      observations:/observation|anomalie|alerte/.test(q)?byParcel(state.observations):[],
      stockItems:/stock|produit|intrant|seuil|rupture/.test(q)?state.stockItems:[],chantiers:/chantier|\btp\b|travaux publics|terrassement/.test(q)?state.chantiers:[],assistantMessages:[],
      grazingSessions:/pature|paturage|\bpre\b|\blots?\b|animal|betail|troupeau|vache|brebis/.test(q)?byParcel(state.grazingSessions):[],
      integrationImports:/recolte|rendement|moisson|\blots?\b/.test(q)?byParcel(state.integrationImports):[]};
    if(!/meteo|pluie|vent|temps|traite|pulveris|semer|semis|gel|orage|chaleur/.test(q))context={...context,weather:null};
  }
  const active=t=>(state[t]||[]).filter(x=>!x.deletedAt),limit=(rows,n)=>rows.slice(Math.max(0,rows.length-n));
  const parcels=active('parcelles').map(p=>({id:p.id,name:p.nom,culture:p.culture||'',surfaceHa:toNumber(p.surfaceHa),commune:p.commune||'',ownershipType:p.ownershipType||'own'}));
  const parcelNames=new Map(parcels.map(p=>[p.id,p.name]));
  const works=limit(active('interventions'),300).map(w=>({id:w.id,parcelId:w.parcelId,parcel:parcelNames.get(w.parcelId)||'',type:w.type||'',date:w.date||'',plannedDate:w.plannedDate||'',status:w.status||'',product:w.product||'',dose:w.dose??null,doseUnit:w.doseUnit||'',surfaceWorked:toNumber(w.surfaceWorked),cost:toNumber(w.cost)}));
  const tasks=limit(active('tasks'),120).map(t=>({id:t.id,title:t.title,dueDate:t.dueDate,status:t.status,priority:t.priority||'',parcelId:t.parcelId||''}));
  const equipment=active('materiels').slice(0,120).map(m=>({id:m.id,name:m.nom,currentMeter:m.currentMeter,maintenanceDue:m.maintenanceDue,status:m.status||''}));
  const observations=limit(active('observations'),120).map(o=>({id:o.id,title:o.title||o.type||'',parcelId:o.parcelId||'',status:o.status||'',severity:o.severity||'',date:o.date||''}));
  const stocks=active('stockItems').slice(0,120).map(x=>({id:x.id,name:x.name||'',quantity:toNumber(x.quantity),unit:x.unit||'',alertBelow:x.alertBelow??null,category:x.category||''}));
  const chantiers=limit(active('chantiers'),80).map(c=>({id:c.id,type:c.type||'',status:c.status||'',plannedDate:c.plannedDate||'',parcelIds:Array.isArray(c.parcelIds)?c.parcelIds.slice(0,80):[]}));
  // n° 104 : contexte élargi (lots au pré, récoltes de la campagne, chantiers TP, stocks sous le seuil, météo en cache).
  const now=context.now??Date.now(),campaign=campaignFor(now),today=grazingDate(new Date(now));
  const grazing=active('grazingSessions').filter(s=>grazingStatus(s,{date:new Date(context.now??Date.now())})==='current').slice(0,60).map(s=>({id:s.id,parcelId:s.parcelId||'',parcel:parcelNames.get(s.parcelId)||'',type:grazingType(s)||'',animals:grazingTotal(s)??null,startDate:s.startDate||''}));
  const harvests=farmRecords(state,'harvest').filter(l=>campaignFor(l.date)===campaign).slice(-120).map(l=>({id:l.id,code:l.code||'',parcelId:l.parcelId||'',parcel:parcelNames.get(l.parcelId)||'',culture:String(l.crop||l.culture||'').trim(),date:l.date||'',quantity:toNumber(l.quantity),unit:l.unit||'',humidity:l.humidity??null}));
  const publicWorks=active('chantiers').filter(c=>c.kind==='tp'&&!['Terminé','Annulé'].includes(c.status)).slice(-40).map(c=>({id:c.id,name:c.type||'',status:c.status||'',plannedDate:c.plannedDate||'',address:String(c.address||'').slice(0,200),logs:Array.isArray(c.tpLogs)?c.tpLogs.filter(x=>!x?.deletedAt).length:0}));
  const lowStocks=stocks.filter(x=>x.alertBelow!==null&&x.alertBelow!==''&&Number.isFinite(Number(x.alertBelow))&&x.quantity<=Number(x.alertBelow)).slice(0,60);
  const weather=weatherSummary(context.weather,{now:context.now??Date.now(),today});
  const conversation=limit(active('assistantMessages'),12).map(m=>({role:m.role,text:String(m.text||'').slice(0,1200)}));
  const currentParcel=context.currentParcelId?parcels.find(p=>p.id===context.currentParcelId)||null:null;
  return{
    farm:{name:state.exploitation?.nom||'',commune:state.exploitation?.commune||''},campaign,
    current:{parcel:currentParcel,view:context.view||'',fieldMode:Boolean(context.fieldModeOpen),gpsAccuracy:context.lastGps?.accuracy??null},
    parcels,works,tasks,equipment,observations,stocks,chantiers,conversation,
    grazing,harvests,publicWorks,lowStocks,weather,
    farmSignals:/satellite|ndvi|anomal|visiter|aller voir|surveiller/.test(q)?(context.farmSignals||[]).slice(0,12):[],
    policy:{localFirst:true,writeActionsRequireConfirmation:true,noAgronomicRecommendationWithoutExplicitSource:true}
  };
}

// n° 104 — Réponse en flux : texte brut progressif, NDJSON (un objet JSON par ligne) ou SSE (lignes « data: »).
// Chaque événement JSON peut porter {delta} (texte à ajouter), {answer} (texte complet), {actions} ou {error}.
// Un événement non JSON est du texte ajouté tel quel ; « [DONE] » est ignoré.
export function streamFormat(contentType=''){
  const type=String(contentType).toLowerCase();
  if(type.includes('text/event-stream'))return 'sse';
  if(type.includes('ndjson')||type.includes('jsonl')||type.includes('json-seq'))return 'ndjson';
  if(type.includes('application/json'))return 'json';
  return 'text';
}

export function createStreamParser(format='text',{maxLength=6000}={}){
  // En mode texte, raw garde le corps complet (non tronqué) pour le repli JSON d'un service mal étiqueté.
  let buffer='',answer='',actions=[],error='',sseData=[],raw='';
  const looksJson=()=>/^\s*[{[]/.test(raw);
  const add=text=>{const before=answer.length;answer=(answer+text).slice(0,maxLength);return answer.length!==before;};
  const event=raw=>{
    const value=String(raw);if(!value.trim()||value.trim()==='[DONE]')return false;
    let data;try{data=JSON.parse(value);}catch{return add(value);}
    if(typeof data==='string')return add(data);
    if(!data||typeof data!=='object')return false;
    if(data.error)error=String(data.error.message||data.error).slice(0,300);
    if(Array.isArray(data.actions))actions=data.actions;
    const delta=typeof data.delta==='string'?data.delta:typeof data.delta?.text==='string'?data.delta.text:null;
    if(delta!==null)return add(delta);
    const full=data.answer??data.text??data.response;
    if(typeof full==='string'){const before=answer;answer=full.slice(0,maxLength);return answer!==before;}
    return false;
  };
  const line=raw=>{
    const text=raw.endsWith('\r')?raw.slice(0,-1):raw;
    if(format==='ndjson')return event(text);
    if(text===''){if(!sseData.length)return false;const data=sseData.join('\n');sseData=[];return event(data);}
    if(text.startsWith(':'))return false;
    if(text.startsWith('data:'))sseData.push(text.slice(5).replace(/^ /,''));
    return false;
  };
  const drain=final=>{
    let changed=false,index;
    while((index=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,index);buffer=buffer.slice(index+1);changed=line(raw)||changed;}
    if(final){if(buffer)changed=line(buffer)||changed;buffer='';if(format==='sse')changed=line('')||changed;}
    return changed;
  };
  return{
    push(chunk){if(format==='text'){raw+=String(chunk);return looksJson()?false:add(String(chunk));}buffer+=String(chunk);return drain(false);},
    end(){if(format!=='text')drain(true);else if(looksJson()){let data=null;try{data=JSON.parse(raw);}catch{}if(data&&typeof data==='object'){answer='';event(raw);}else answer=raw.slice(0,maxLength);}if(error)throw new Error(`Service IA : ${error}`);return{answer,actions};},
    get text(){return answer;}
  };
}

async function readStream(response,format,{onDelta,onChunk}={}){
  const parser=createStreamParser(format),reader=response.body.getReader(),decoder=new TextDecoder();
  for(;;){
    const {done,value}=await reader.read();if(done)break;onChunk?.();
    if(parser.push(decoder.decode(value,{stream:true})))onDelta?.(parser.text);
  }
  if(parser.push(decoder.decode()))onDelta?.(parser.text);
  return parser.end();
}

function finalAnswer(data){
  const answer=data?.answer||data?.text||data?.response;
  if(!String(answer||'').trim())throw new Error('Le service IA n’a retourné aucune réponse.');
  return{answer:String(answer).slice(0,6000),actions:(Array.isArray(data.actions)?data.actions:[]).map(sanitizeAction).filter(Boolean).slice(0,6)};
}

export async function askRemoteAssistant({endpoint,question,state,context={},timeoutMs=15000,onDelta=null,anonymize=false,fetchImpl=(...a)=>fetch(...a)}={}){
  if(!endpoint)throw new Error('Aucun endpoint IA configuré.');
  const url=new URL(endpoint,location.href);if(!/^https:$/.test(url.protocol)&&url.hostname!=='localhost')throw new Error('L’endpoint IA doit utiliser HTTPS.');
  const controller=new AbortController();let timer=setTimeout(()=>controller.abort(),timeoutMs);
  // En flux, le délai s'applique entre deux morceaux reçus, pas à la réponse entière.
  const rearm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),timeoutMs);};
  const stream=typeof onDelta==='function',{body,aliases}=buildRemoteRequest({question,state,context,stream,anonymize});
  // Mode anonyme : le texte reçu en flux et la réponse finale sont retraduits avant affichage.
  const local=value=>aliases?deanonymizeValue(value,aliases):value,delta=stream?text=>onDelta(local(text)):null;
  try{
    const response=await fetchImpl(url.href,{method:'POST',headers:{'content-type':'application/json',accept:stream?'text/event-stream, application/x-ndjson, application/json;q=0.9':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok)throw new Error(`Service IA ${response.status}`);
    const format=streamFormat(response.headers?.get?.('content-type'));
    // Repli : réponse JSON complète (comportement historique) si le service ne diffuse pas en flux.
    if(!stream||format==='json'||typeof response.body?.getReader!=='function')return local(finalAnswer(await response.json()));
    return local(finalAnswer(await readStream(response,format,{onDelta:delta,onChunk:rearm})));
  }finally{clearTimeout(timer);}
}

// Bulle « Assistant » mise à jour au fil de l'eau (textContent uniquement : aucun HTML interprété).
// Pas de région live sur la bulle provisoire (aria-busy) : la réponse finale est annoncée une fois par #assistant-thread.
export function liveAnswer(thread){
  let box=null,para=null;
  return{
    update(text){
      if(!thread)return;
      if(!box){box=thread.ownerDocument.createElement('div');box.className='assistant-answer is-streaming';box.setAttribute('aria-busy','true');const title=thread.ownerDocument.createElement('strong');title.textContent='Assistant';para=thread.ownerDocument.createElement('p');box.append(title,para);thread.append(box);}
      para.textContent=String(text||'');thread.scrollTop=thread.scrollHeight;
    },
    remove(){box?.remove();box=null;}
  };
}

// n° 106 — Extraction d'une facture ou d'une étiquette par le même endpoint IA (mode 'extract-document').
// L'appelant a recueilli le consentement explicite ; aucune clé n'est envoyée par le client.
export async function extractDocument({endpoint,file,fetchImpl=(...a)=>fetch(...a),timeoutMs=30000}={}){
  if(!endpoint)throw new Error('Aucun endpoint IA configuré.');
  const url=new URL(endpoint,location.href);if(!/^https:$/.test(url.protocol)&&url.hostname!=='localhost')throw new Error('L’endpoint IA doit utiliser HTTPS.');
  if(!file||!/^image\/|^application\/pdf$/.test(file.type||''))throw new Error('Image ou PDF attendu.');
  if(file.size>8*1024*1024)throw new Error('Fichier trop lourd (8 Mo au plus).');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:EXTRACT_MODE,client:'Parcelles',document:{name:String(file.name||'document').slice(0,120),mimeType:file.type,dataBase64:btoa(binary)},expected:{lignes:[{produit:'',quantité:0,unité:'',prix:0,AMM:'',lot:''}]}}),signal:controller.signal});
    if(!response.ok)throw new Error(`Service IA ${response.status}`);
    return validateExtraction(await response.json());
  }finally{clearTimeout(timer);}
}
