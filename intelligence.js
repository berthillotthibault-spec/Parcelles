import {campaignFor, isoDate, normalize, toNumber} from './utils.js';

const active=(state,type)=>(state?.[type]||[]).filter(item=>!item?.deletedAt);
const fmt=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(value)||0);
const euro=value=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(value)||0);
const norm=value=>normalize(value||'');
const workDate=work=>work?.plannedDate||work?.date||'';

function dayRange(nowMs=Date.now(),offset=0){
  const d=new Date(nowMs);d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);const day=isoDate(d);
  return{start:day,end:day,label:offset===0?'aujourd’hui':offset===-1?'hier':offset===1?'demain':day};
}
function weekRange(nowMs=Date.now()){
  const d=new Date(nowMs);d.setHours(12,0,0,0);const shift=(d.getDay()+6)%7;d.setDate(d.getDate()-shift);const start=isoDate(d);d.setDate(d.getDate()+6);return{start,end:isoDate(d),label:'cette semaine'};
}
function inRange(value,range){const day=isoDate(value);return Boolean(day&&day>=range.start&&day<=range.end);}
function parcelMap(state){return new Map(active(state,'parcelles').map(parcel=>[parcel.id,parcel]));}
function parcelName(state,id){return parcelMap(state).get(id)?.nom||'Parcelle';}
function totalWorkCost(work){
  if(Number.isFinite(Number(work?.cost))&&Number(work.cost)!==0)return Number(work.cost);
  return ['machineCost','inputCost','operatorCost','otherCost'].reduce((sum,key)=>sum+toNumber(work?.[key]),0);
}

export function findParcelFromQuestion(question,state,{currentParcelId=null}={}){
  const parcels=active(state,'parcelles');const q=norm(question);
  if(/\b(cette|la) parcelle\b/.test(q)&&currentParcelId)return parcels.find(p=>p.id===currentParcelId)||null;
  return [...parcels].filter(p=>norm(p.nom).length>1&&q.includes(norm(p.nom))).sort((a,b)=>norm(b.nom).length-norm(a.nom).length)[0]||null;
}

function parseNumber(value){const n=Number(String(value||'').replace(',','.'));return Number.isFinite(n)?n:null;}

export function filterParcelsStructured(question,state){
  const parcels=active(state,'parcelles');const raw=String(question||'');const q=norm(raw);let rows=[...parcels];const applied=[];
  const cultureMatch=raw.match(/(?:^|\s)culture\s*:\s*([^<>:=]+?)(?=\s+(?:surface|commune|nom)\s*[:<>]|$)/i);
  const communeMatch=raw.match(/(?:^|\s)commune\s*:\s*([^<>:=]+?)(?=\s+(?:surface|culture|nom)\s*[:<>]|$)/i);
  const nameMatch=raw.match(/(?:^|\s)nom\s*:\s*([^<>:=]+?)(?=\s+(?:surface|culture|commune)\s*[:<>]|$)/i);
  const surfaceMatch=raw.match(/surface\s*(>=|<=|>|<|=|:)\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if(cultureMatch){const value=norm(cultureMatch[1]);rows=rows.filter(p=>norm(p.culture).includes(value));applied.push(`culture:${cultureMatch[1].trim()}`);}
  if(communeMatch){const value=norm(communeMatch[1]);rows=rows.filter(p=>norm(p.commune).includes(value));applied.push(`commune:${communeMatch[1].trim()}`);}
  if(nameMatch){const value=norm(nameMatch[1]);rows=rows.filter(p=>norm(p.nom).includes(value));applied.push(`nom:${nameMatch[1].trim()}`);}
  if(surfaceMatch){const op=surfaceMatch[1],n=parseNumber(surfaceMatch[2]);if(n!==null){rows=rows.filter(p=>{const v=toNumber(p.surfaceHa);if(op==='>')return v>n;if(op==='<')return v<n;if(op==='>=')return v>=n;if(op==='<=')return v<=n;return Math.abs(v-n)<1e-9;});applied.push(`surface${op}${surfaceMatch[2]}`);}}
  if(/\bsans culture\b/.test(q)){rows=rows.filter(p=>!String(p.culture||'').trim());applied.push('sans culture');}
  return{recognized:applied.length>0,rows,applied};
}

function cultureFromQuestion(question,state){
  const q=norm(question),cultures=[...new Set(active(state,'parcelles').map(p=>String(p.culture||'').trim()).filter(Boolean))];
  return cultures.sort((a,b)=>norm(b).length-norm(a).length).find(c=>q.includes(norm(c)))||null;
}

function worksForRange(state,range){return active(state,'interventions').filter(work=>inRange(workDate(work),range));}

export function buildActivityBrief(state,{period='today',now=Date.now()}={}){
  const range=period==='week'?weekRange(now):period==='yesterday'?dayRange(now,-1):dayRange(now,0);
  const works=worksForRange(state,range),done=works.filter(w=>w.status==='Terminé'),planned=works.filter(w=>!['Terminé','Annulé'].includes(w.status));
  const area=works.reduce((sum,w)=>sum+toNumber(w.surfaceWorked),0),cost=works.reduce((sum,w)=>sum+totalWorkCost(w),0);
  const today=isoDate(now),tasks=active(state,'tasks').filter(t=>t.status!=='Terminé'&&t.dueDate&&t.dueDate<=today),urgentObs=active(state,'observations').filter(o=>o.status!=='Résolu'&&norm(o.severity)==='urgent');
  const lowStock=active(state,'stockItems').filter(item=>item.alertBelow!==null&&item.alertBelow!==undefined&&Number(item.quantity)<=Number(item.alertBelow));
  const maintenance=active(state,'materiels').filter(m=>Number.isFinite(Number(m.currentMeter))&&Number.isFinite(Number(m.maintenanceDue))&&(Number(m.maintenanceDue)-Number(m.currentMeter))<=20);
  const bits=[`${works.length} travail${works.length!==1?'aux':''} ${range.label}`,`${done.length} terminé${done.length!==1?'s':''}`,`${planned.length} à faire`];
  if(area>0)bits.push(`${fmt(area)} ha saisis`);if(cost>0)bits.push(`${euro(cost)} de coûts saisis`);
  const alerts=[];if(tasks.length)alerts.push(`${tasks.length} tâche${tasks.length!==1?'s':''} à traiter`);if(urgentObs.length)alerts.push(`${urgentObs.length} observation${urgentObs.length!==1?'s':''} urgente${urgentObs.length!==1?'s':''}`);if(lowStock.length)alerts.push(`${lowStock.length} stock${lowStock.length!==1?'s':''} faible${lowStock.length!==1?'s':''}`);if(maintenance.length)alerts.push(`${maintenance.length} entretien${maintenance.length!==1?'s':''} proche${maintenance.length!==1?'s':''}`);
  const actions=[];for(const work of works.slice(0,4))actions.push({type:'open_work',label:`Ouvrir · ${work.type||'Travail'}`,payload:{workId:work.id}});
  return{range,works,done,planned,area,cost,tasks,urgentObs,lowStock,maintenance,answer:`${bits.join(' · ')}.${alerts.length?` À surveiller : ${alerts.join(', ')}.`:''}`,actions};
}

function assolementAnswer(state){
  const rows=new Map();for(const p of active(state,'parcelles')){const c=p.culture||'Sans culture';const item=rows.get(c)||{count:0,area:0};item.count++;item.area+=toNumber(p.surfaceHa);rows.set(c,item);}
  const sorted=[...rows.entries()].sort((a,b)=>b[1].area-a[1].area);if(!sorted.length)return'Aucune parcelle active.';
  return `Assolement ${campaignFor()} : ${sorted.slice(0,8).map(([culture,x])=>`${culture} ${fmt(x.area)} ha (${x.count})`).join(' · ')}.`;
}

function maintenanceAnswer(state){
  const rows=active(state,'materiels').map(m=>({...m,remaining:Number(m.maintenanceDue)-Number(m.currentMeter)})).filter(m=>Number.isFinite(m.remaining)&&m.remaining<=20).sort((a,b)=>a.remaining-b.remaining);
  if(!rows.length)return{answer:'Aucun entretien matériel n’est à moins de 20 h selon les compteurs renseignés.',actions:[]};
  return{answer:`${rows.length} matériel${rows.length!==1?'s':''} à surveiller : ${rows.slice(0,6).map(m=>`${m.nom||'Matériel'} ${m.remaining<=0?`${Math.abs(Math.round(m.remaining))} h dépassées`:`dans ${Math.round(m.remaining)} h`}`).join(' · ')}.`,actions:rows.slice(0,4).map(m=>({type:'open_equipment',label:`Ouvrir · ${m.nom||'Matériel'}`,payload:{equipmentId:m.id}}))};
}

function stockAnswer(state){
  const rows=active(state,'stockItems').filter(item=>item.alertBelow!==null&&item.alertBelow!==undefined&&Number(item.quantity)<=Number(item.alertBelow)).sort((a,b)=>Number(a.quantity)-Number(b.quantity));
  if(!rows.length)return{answer:'Aucun stock n’est sous son seuil d’alerte.',actions:[]};
  return{answer:`${rows.length} stock${rows.length!==1?'s':''} sous seuil : ${rows.slice(0,8).map(x=>`${x.name||'Article'} ${fmt(x.quantity)} ${x.unit||''}`.trim()).join(' · ')}.`,actions:rows.slice(0,4).map(x=>({type:'open_stock',label:`Ouvrir · ${x.name||'Stock'}`,payload:{stockId:x.id}}))};
}

function observationsAnswer(state){
  const rows=active(state,'observations').filter(o=>o.status!=='Résolu'&&norm(o.severity)==='urgent');
  if(!rows.length)return{answer:'Aucune observation terrain urgente non résolue.',actions:[]};
  return{answer:`${rows.length} observation${rows.length!==1?'s':''} urgente${rows.length!==1?'s':''} : ${rows.slice(0,8).map(o=>`${o.title||o.type||'Observation'}${o.parcelId?` — ${parcelName(state,o.parcelId)}`:''}`).join(' · ')}.`,actions:rows.slice(0,4).map(o=>({type:'open_observation',label:`Ouvrir · ${o.title||o.type||'Observation'}`,payload:{observationId:o.id}}))};
}

function tasksAnswer(state){
  const today=isoDate(Date.now()),rows=active(state,'tasks').filter(t=>t.status!=='Terminé'&&t.dueDate&&t.dueDate<today).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
  if(!rows.length)return{answer:'Aucune tâche en retard.',actions:[]};
  return{answer:`${rows.length} tâche${rows.length!==1?'s':''} en retard : ${rows.slice(0,8).map(t=>t.title||'Tâche').join(' · ')}.`,actions:rows.slice(0,4).map(t=>({type:'open_task',label:`Ouvrir · ${t.title||'Tâche'}`,payload:{taskId:t.id}}))};
}

function chantierAnswer(state){
  const rows=active(state,'chantiers').filter(c=>!['Terminé','Annulé'].includes(c.status));if(!rows.length)return{answer:'Aucun chantier actif ou planifié.',actions:[]};
  return{answer:`${rows.length} chantier${rows.length!==1?'s':''} actif${rows.length!==1?'s':''}/planifié${rows.length!==1?'s':''} : ${rows.slice(0,6).map(c=>`${c.type||'Chantier'} (${c.status||'Planifié'})`).join(' · ')}.`,actions:rows.slice(0,4).map(c=>({type:'open_chantier',label:`Ouvrir · ${c.type||'Chantier'}`,payload:{chantierId:c.id}}))};
}


function alertBrief(state){
  const task=tasksAnswer(state),obs=observationsAnswer(state),stock=stockAnswer(state),maint=maintenanceAnswer(state);
  const today=isoDate(Date.now());
  const taskRows=active(state,'tasks').filter(t=>t.status!=='Terminé'&&t.dueDate&&t.dueDate<today);
  const obsRows=active(state,'observations').filter(o=>o.status!=='Résolu'&&norm(o.severity)==='urgent');
  const stockRows=active(state,'stockItems').filter(item=>item.alertBelow!==null&&item.alertBelow!==undefined&&Number(item.quantity)<=Number(item.alertBelow));
  const maintRows=active(state,'materiels').filter(m=>Number.isFinite(Number(m.currentMeter))&&Number.isFinite(Number(m.maintenanceDue))&&(Number(m.maintenanceDue)-Number(m.currentMeter))<=20);
  const total=taskRows.length+obsRows.length+stockRows.length+maintRows.length;
  if(!total)return{answer:'Aucune alerte terrain prioritaire : pas de tâche en retard, observation urgente, stock sous seuil ni entretien à moins de 20 h.',actions:[]};
  const parts=[];if(taskRows.length)parts.push(`${taskRows.length} tâche${taskRows.length>1?'s':''} en retard`);if(obsRows.length)parts.push(`${obsRows.length} observation${obsRows.length>1?'s':''} urgente${obsRows.length>1?'s':''}`);if(stockRows.length)parts.push(`${stockRows.length} stock${stockRows.length>1?'s':''} sous seuil`);if(maintRows.length)parts.push(`${maintRows.length} entretien${maintRows.length>1?'s':''} proche${maintRows.length>1?'s':''}`);
  return{answer:`Alertes terrain : ${parts.join(' · ')}.`,actions:[...task.actions,...obs.actions,...stock.actions,...maint.actions].slice(0,6)};
}

function extractWorkType(question,parcel){
  let type=String(question||'');const verbs=/\b(ajoute|ajouter|cree|creer|planifie|planifier|enregistre|enregistrer|demarre|demarrer)\b/i;const hit=type.match(verbs);if(hit)type=type.slice((hit.index||0)+hit[0].length);
  type=type.replace(/^\s*(un|une|le|la|du|de la|des)?\s*/i,'');
  if(parcel){const escaped=parcel.nom.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');type=type.replace(new RegExp(`\\s+(sur|dans|pour)\\s+(la\\s+parcelle\\s+)?${escaped}.*$`,'i'),'');}
  type=type.replace(/\b(aujourd’hui|aujourd'hui|demain|maintenant)\b/ig,'').trim();return type||'Travail';
}

export function assistantActionRequiresConfirmation(action){return ['create_work','create_task','create_observation','finish_work','resolve_observation'].includes(action?.type);}

export function answerLocalIntelligence(question,state,context={}){
  const raw=String(question||'').trim(),q=norm(raw),parcels=active(state,'parcelles'),works=active(state,'interventions');
  if(!q)return{recognized:false,answer:'',actions:[],intent:'empty'};
  const parcel=findParcelFromQuestion(raw,state,context);
  const writeVerb=/\b(ajoute|ajouter|cree|creer|planifie|planifier|enregistre|enregistrer|demarre|demarrer)\b/.test(q);
  if(writeVerb&&/\b(tache|rappel)\b/.test(q)){
    const title=raw.replace(/^.*?\b(?:tâche|tache|rappel)\b\s*/i,'').replace(/\b(aujourd’hui|aujourd'hui|demain)\b/ig,'').trim()||'Tâche';
    const dueDate=/\bdemain\b/.test(q)?isoDate(Date.now()+86400000):isoDate(Date.now());
    return{recognized:true,intent:'create_task',answer:`Je peux préparer la tâche « ${title} ». Je ne l’enregistrerai qu’après confirmation.`,actions:[{type:'create_task',label:'Vérifier et créer la tâche',requiresConfirmation:true,payload:{title,dueDate,parcelId:parcel?.id||''}}]};
  }
  if(writeVerb&&parcel){
    const type=extractWorkType(raw,parcel),tomorrow=/\bdemain\b/.test(q),date=tomorrow?isoDate(Date.now()+86400000):isoDate(Date.now()),status=/\b(planifie|planifier|demain)\b/.test(q)?'À faire':'Terminé';
    return{recognized:true,intent:'create_work',answer:`Je peux préparer « ${type} » sur ${parcel.nom}. Je ne modifierai rien avant votre confirmation.`,actions:[{type:'create_work',label:`Vérifier · ${type}`,requiresConfirmation:true,payload:{parcelId:parcel.id,type,date,status}}]};
  }
  if(/\b(resume|résume|bilan)\b/.test(raw.toLowerCase())&&/\b(semaine|hebdo)\b/.test(q)){const brief=buildActivityBrief(state,{period:'week'});return{recognized:true,intent:'weekly_brief',answer:brief.answer,actions:brief.actions,metrics:brief};}
  if(/\b(resume|résume|bilan|journee|journée)\b/.test(raw.toLowerCase())&&/\b(aujourd|journee|journée|jour)\b/.test(raw.toLowerCase())){const brief=buildActivityBrief(state,{period:'today'});return{recognized:true,intent:'daily_brief',answer:brief.answer,actions:brief.actions,metrics:brief};}
  if(/\b(travaux?|interventions?)\b/.test(q)&&/\baujourd/.test(q)){const list=worksForRange(state,dayRange());return{recognized:true,intent:'works_today',answer:`${list.length} travail${list.length!==1?'aux':''} aujourd’hui${list.length?` : ${list.slice(0,8).map(w=>`${w.type||'Travail'} — ${parcelName(state,w.parcelId)}`).join(' · ')}`:''}.`,actions:list.slice(0,4).map(w=>({type:'open_work',label:`Ouvrir · ${w.type||'Travail'}`,payload:{workId:w.id}}))};}
  if(/\b(travaux?|interventions?)\b/.test(q)&&/\bhier\b/.test(q)){const list=worksForRange(state,dayRange(Date.now(),-1));return{recognized:true,intent:'works_yesterday',answer:`${list.length} travail${list.length!==1?'aux':''} hier${list.length?` : ${list.slice(0,8).map(w=>`${w.type||'Travail'} — ${parcelName(state,w.parcelId)}`).join(' · ')}`:''}.`,actions:list.slice(0,4).map(w=>({type:'open_work',label:`Ouvrir · ${w.type||'Travail'}`,payload:{workId:w.id}}))};}
  if(/\b(alerte|alertes|surveiller|priorite|priorités|priorites)\b/.test(q)||([/\bstock/.test(q),/\bobservation/.test(q),/\btache/.test(q),/\b(entretien|maintenance)/.test(q)].filter(Boolean).length>=2)){const x=alertBrief(state);return{recognized:true,intent:'terrain_alerts',...x};}
  if(/\b(entretien|maintenance|machines?|materiels?|matériels?)\b/.test(raw.toLowerCase())&&/\b(bientot|bientôt|proche|du|dû|entretien|maintenance)\b/.test(raw.toLowerCase())){const x=maintenanceAnswer(state);return{recognized:true,intent:'maintenance_due',...x};}
  if(/\b(stock|stocks|rupture|seuil)\b/.test(q)&&/\b(faible|bas|rupture|seuil|alerte|quels|quel)\b/.test(q)){const x=stockAnswer(state);return{recognized:true,intent:'low_stock',...x};}
  if(/\b(observation|observations|alerte terrain)\b/.test(q)&&/\b(urgent|urgente|urgentes|ouvert|surveiller)\b/.test(q)){const x=observationsAnswer(state);return{recognized:true,intent:'urgent_observations',...x};}
  if(/\b(tache|taches|tâche|tâches)\b/.test(raw.toLowerCase())&&/\b(retard|en retard)\b/.test(raw.toLowerCase())){const x=tasksAnswer(state);return{recognized:true,intent:'overdue_tasks',...x};}
  if(/\bchantier/.test(q)&&/\b(en cours|actif|planifie|planifié|quels|quel)\b/.test(raw.toLowerCase())){const x=chantierAnswer(state);return{recognized:true,intent:'chantiers',...x};}
  if(/\bassolement\b/.test(q))return{recognized:true,intent:'crop_plan',answer:assolementAnswer(state),actions:[]};

  const structured=filterParcelsStructured(raw,state);
  if(structured.recognized){const area=structured.rows.reduce((s,p)=>s+toNumber(p.surfaceHa),0);return{recognized:true,intent:'parcel_filter',answer:`${structured.rows.length} parcelle${structured.rows.length!==1?'s':''} correspondent (${fmt(area)} ha)${structured.rows.length?` : ${structured.rows.slice(0,8).map(p=>p.nom).join(', ')}`:''}.`,actions:structured.rows.slice(0,5).map(p=>({type:'open_parcel',label:`Ouvrir · ${p.nom}`,payload:{parcelId:p.id}})),matches:structured.rows.map(p=>p.id)};}
  if(/\bsans culture\b/.test(q)){const list=parcels.filter(p=>!String(p.culture||'').trim());return{recognized:true,intent:'missing_crop',answer:`${list.length} parcelle${list.length!==1?'s':''} sans culture${list.length?` : ${list.slice(0,8).map(p=>p.nom).join(', ')}`:''}.`,actions:list.slice(0,5).map(p=>({type:'open_parcel',label:`Ouvrir · ${p.nom}`,payload:{parcelId:p.id}}))};}
  if(/\b(combien|nombre)\b/.test(q)&&/\bparcelle/.test(q)){const own=parcels.filter(p=>(p.ownershipType||'own')==='own'),area=own.reduce((s,p)=>s+toNumber(p.surfaceHa),0);return{recognized:true,intent:'parcel_count',answer:`${parcels.length} parcelles actives, dont ${own.length} de l’exploitation pour ${fmt(area)} ha.`,actions:[]};}
  const culture=cultureFromQuestion(raw,state);
  if(culture&&/\b(surface|hectare|hectares|ha|combien)\b/.test(q)){const list=parcels.filter(p=>norm(p.culture)===norm(culture)),area=list.reduce((s,p)=>s+toNumber(p.surfaceHa),0);return{recognized:true,intent:'crop_area',answer:`${fmt(area)} ha en ${culture}, répartis sur ${list.length} parcelle${list.length!==1?'s':''}.`,actions:list.slice(0,5).map(p=>({type:'open_parcel',label:`Ouvrir · ${p.nom}`,payload:{parcelId:p.id}}))};}
  if(parcel){const list=works.filter(w=>w.parcelId===parcel.id).sort((a,b)=>String(workDate(b)).localeCompare(String(workDate(a))));const last=list[0];const openObs=active(state,'observations').filter(o=>o.parcelId===parcel.id&&o.status!=='Résolu').length;return{recognized:true,intent:'parcel_context',answer:`${parcel.nom} : ${fmt(parcel.surfaceHa)} ha · ${parcel.culture||'culture non renseignée'}${parcel.commune?` · ${parcel.commune}`:''}.${last?` Dernier travail : ${last.type||'Travail'} le ${new Intl.DateTimeFormat('fr-FR').format(new Date(workDate(last)))}.`:''}${openObs?` ${openObs} observation${openObs>1?'s':''} ouverte${openObs>1?'s':''}.`:''}`,actions:[{type:'open_parcel',label:`Ouvrir ${parcel.nom}`,payload:{parcelId:parcel.id}}]};}
  if(/\b(ouvre|ouvrir|montre|affiche)\b/.test(q)&&/\bcarte\b/.test(q))return{recognized:true,intent:'open_map',answer:'J’ouvre la carte.',actions:[{type:'open_map',label:'Ouvrir la carte',payload:{}}]};
  return{recognized:false,intent:'unknown',answer:'',actions:[]};
}

export function intelligenceCapabilities(){return{
  local:true,offline:true,writeConfirmation:true,
  intents:['daily_brief','weekly_brief','parcel_context','parcel_filter','crop_area','works_today','maintenance_due','low_stock','urgent_observations','overdue_tasks','chantiers','create_work','create_task']
};}
