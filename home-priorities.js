// @ts-check
import {filterGrazingSessions} from './grazing.js';
// One ordering for the home recommendation and the work filters.
const closedStatuses=new Set(['Terminé','Terminée','Annulé','Annulée']);
/** @param {import('parcelles/types').Intervention|import('parcelles/types').Task} item @param {'work'|'task'} [kind] @returns {string} */
export function agendaDate(item,kind='work'){
  const value=String(kind==='task'?item.dueDate||'':item.plannedDate||item.date||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';
}
/** @param {import('parcelles/types').Intervention|import('parcelles/types').Task} item @param {'work'|'task'} [kind] */
export function isPending(item,kind='work'){
  return !item.deletedAt&&!closedStatuses.has(item.status||(kind==='work'?'Terminé':'À faire'));
}
export function getParcelWorkContext(works,today,tasks=[]){
  const next=getHomeAgenda({interventions:works,tasks},today).next;
  const last=works.filter(item=>!item.deletedAt&&['Terminé','Terminée'].includes(item.status||'Terminé'))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]||null;
  return {next,last};
}
export function matchesWorkTab(item,tab,today){
  if(item.deletedAt)return false;
  const pending=isPending(item),done=String(item.date||'').slice(0,10);
  // Un travail clos se range à sa date de réalisation, un travail à faire à son échéance.
  const date=!pending&&/^\d{4}-\d{2}-\d{2}$/.test(done)?done:agendaDate(item);
  if(tab==='today')return date===today&&!['Annulé','Annulée'].includes(item.status);
  if(tab==='overdue')return pending&&Boolean(date)&&date<today;
  if(tab==='upcoming')return pending&&(!date||date>today);
  // Un travail terminé aujourd’hui reste visible (barré) dans « Aujourd’hui » ; il passe dans l’historique le lendemain.
  if(tab==='history')return !pending&&date!==today;
  return true;
}
/** @param {Partial<import('parcelles/types').AppState>} data @param {string} today Jour AAAA-MM-JJ. */
export function getHomeAgenda(data,today){
  const candidates=[
    ...(data.interventions||[]).filter(item=>isPending(item)).map(item=>({item,kind:'work',date:agendaDate(item)})),
    ...(data.tasks||[]).filter(item=>isPending(item,'task')).map(item=>({item,kind:'task',date:agendaDate(item,'task')}))
  ].map(entry=>({...entry,overdue:Boolean(entry.date)&&entry.date<today}));
  // Ongoing work first, then missed deadlines, today's work, undated items and future work.
  const rank=entry=>entry.item.status==='En cours'?0:entry.overdue?1:entry.date===today?2:!entry.date?3:4;
  candidates.sort((a,b)=>rank(a)-rank(b)||a.date.localeCompare(b.date)||String(a.item.startTime||'99:99').localeCompare(String(b.item.startTime||'99:99'))||String(a.item.id).localeCompare(String(b.item.id)));
  return {entries:candidates,next:candidates[0]||null,overdueCount:candidates.filter(entry=>entry.overdue).length,overdueWorks:candidates.filter(entry=>entry.kind==='work'&&entry.overdue).length};
}

// Pure, read-only V8 projections. No persisted state or schema change.
/** @param {Date} [date] @returns {string} Jour local AAAA-MM-JJ. */
export function localDay(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
const number=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
/** @param {Partial<import('parcelles/types').AppState>} data @param {string} [today] */
export function dailySituation(data,today=localDay()){
  const agenda=getHomeAgenda(data,today);
  const works=(data.interventions||[]).filter(w=>!w.deletedAt&&!['Annulé','Annulée'].includes(w.status));
  const planned=works.filter(w=>isPending(w)&&agendaDate(w)===today);
  // Completion uses the actual work date, never a displaced planned date.
  const done=works.filter(w=>!isPending(w)&&String(w.date||'').slice(0,10)===today);
  const parcels=new Map((data.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,p]));
  const pending=agenda.entries;
  return {...agenda,planned,done,actions:pending.filter(e=>e.overdue||!e.date||e.date===today||e.item.status==='En cours'),
    tasks:(data.tasks||[]).filter(t=>isPending(t,'task')&&agendaDate(t,'task')===today),
    plannedArea:planned.reduce((sum,w)=>sum+Math.max(0,number(w.surfaceWorked)??number(parcels.get(w.parcelId)?.surfaceHa)??0),0),
    doneArea:done.reduce((sum,w)=>sum+Math.max(0,number(w.surfaceWorked)??0),0),
    equipmentHours:done.filter(w=>w.equipmentId).reduce((sum,w)=>sum+Math.max(0,number(w.duration)??0),0),
    grazingMoves:(data.grazingSessions||[]).filter(s=>!s.deletedAt&&s.startDate===today).length};
}
/** @param {Partial<import('parcelles/types').AppState>} data @param {string} id @param {string} [today] */
export function parcelSituation(data,id,today=localDay()){
  const works=(data.interventions||[]).filter(w=>w.parcelId===id&&!w.deletedAt);
  const tasks=(data.tasks||[]).filter(t=>t.parcelId===id);
  const context=getParcelWorkContext(works,today,tasks);
  const observations=(data.observations||[]).filter(o=>o.parcelId===id&&!o.deletedAt&&o.status!=='Résolu');
  const grazing=filterGrazingSessions(data.grazingSessions,{parcelId:id,date:today});
  const dueToday=works.some(w=>isPending(w)&&agendaDate(w)===today)||tasks.some(t=>isPending(t,'task')&&agendaDate(t,'task')===today);
  const late=getHomeAgenda({interventions:works,tasks},today).overdueCount>0;
  const soon=context.next?.date&&context.next.date<=localDay(addDays(today,7));
  const status=late||observations.some(o=>o.severity==='urgent')?['attention','Attention / retard','#c33b36','!']:
    dueToday?['today','Travail prévu aujourd’hui','#8056b3','◆']:grazing.length?['animals','Animaux présents','#3178c6','●']:
    soon||observations.length?['soon','À surveiller / intervention prochaine','#bc7915','!']:['clear','Rien d’urgent signalé','#2f8054','✓'];
  return {...context,works,observations,grazing,status:{key:status[0],label:status[1],color:status[2],icon:status[3]}};
}
function addDays(day,count){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+count);return d;}
export function weatherOpportunity(weather,preferences={},now=new Date()){
  const hourly=weather?.hourly,age=now.getTime()-Number(weather?.loadedAt);
  // n° 110 : why[] et missing[] expliquent la fenêtre affichée sur la carte météo de l’accueil.
  if(!hourly?.time?.length||!Number.isFinite(age)||age<0||age>6*3600000)return {stale:true,window:null,risk:null,why:['Fenêtre calculée seulement sur des prévisions de moins de 6 h.'],missing:[hourly?.time?.length?'Prévisions de plus de 6 h : à actualiser':'Prévisions horaires absentes']};
  // The existing rain preference is daily, so never compare it to hourly rain.
  const wind=number(preferences.weatherWindThreshold),rain=0.2;
  if(!(wind>0))return {stale:false,window:null,risk:null,why:[],missing:['Seuil de vent non réglé dans les paramètres']};
  /** @type {any} */
  let start=null,end=null;
  /** @type {{time:string, reason:string}|null} */
  let risk=null;
  /** @type {{start:string, end:string}|null} */
  let best=null,unknown=0;
  hourly.time.forEach((time,i)=>{
    const date=new Date(time),speed=number(hourly.wind_gusts_10m?.[i]??hourly.wind_speed_10m?.[i]),wet=number(hourly.precipitation?.[i]);
    if(date<now||localDay(date)!==localDay(now))return;
    if(speed===null||wet===null){unknown++;start=end=null;return;}
    const good=speed<wind&&wet<rain;
    if(!good&&!risk)risk={time,reason:wet>=rain?'Pluie':'Vent'};
    if(good){if(!start||date.getTime()-new Date(end).getTime()>3600000)start=time;end=time;if(!best||new Date(end).getTime()-new Date(start).getTime()>new Date(best.end).getTime()-new Date(best.start).getTime())best={start,end};}
    else start=end=null;
  });
  const window=best&&best.end!==best.start?best:null,clock=t=>`${new Date(t).getHours()} h`;
  const why=[`Heures restantes d’aujourd’hui avec ${hourly.wind_gusts_10m?'rafales':'vent'} sous ${wind} km/h (seuil des paramètres)`,`Pluie sous ${String(rain).replace('.',',')} mm/h`,'Au moins deux heures consécutives ; la plus longue fenêtre est retenue'];
  if(window)why.unshift(`Fenêtre de ${clock(window.start)} à ${clock(window.end)}`);else why.unshift('Aucune fenêtre d’au moins deux heures aujourd’hui');
  if(risk)why.push(`Première heure défavorable : ${clock(risk.time)} (${risk.reason.toLowerCase()})`);
  return {stale:false,risk,window,why,missing:unknown?[`${unknown} heure${unknown>1?'s':''} sans vent ou pluie prévus : exclue${unknown>1?'s':''}`]:[]};
}

/** @param {Partial<import('parcelles/types').AppState>} data @param {string} [today] @param {number} [threshold] */
export function grazingWatch(data,today=localDay(),threshold=7){
  if(!(Number(threshold)>0))return [];
  const parcels=new Map((data.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,p]));
  return filterGrazingSessions(data.grazingSessions,{date:today}).filter(s=>s.startDate).flatMap(s=>{
    const days=Math.floor((new Date(`${today}T12:00:00Z`).getTime()-new Date(`${s.startDate}T12:00:00Z`).getTime())/86400000);
    return days>=Number(threshold)?[{id:s.id,parcelId:s.parcelId,days,label:`${parcels.get(s.parcelId)?.nom||'Parcelle'} · animaux présents depuis ${days} jours`}]:[];
  });
}

/** @param {import('parcelles/types').Equipment} machine */
export function maintenanceRemaining(machine){
  const due=number(machine.maintenanceDue),current=number(machine.currentMeter);
  return due===null||current===null?null:due-current;
}
export function isLowStock(item){
  const threshold=number(item.alertBelow),quantity=number(item.quantity);
  return threshold!==null&&quantity!==null&&quantity<=threshold;
}

// n° 79 — Troupeau : projections lues par l'accueil, le calendrier et la conformité (aucune écriture).
// La logique complète (validation, vêlage, import) est dans herd.js, chargé à l'ouverture du Troupeau.
export const GESTATION_DAYS=283,BDNI_DAYS=7,BDNI_REMINDER_DAYS=5;
const SERVICE_KINDS=new Set(['insemination','mating']);
/** @param {string} day AAAA-MM-JJ @param {number} count @returns {string} */
export function addIsoDays(day,count){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'').slice(0,10)))return '';
  const d=new Date(`${String(day).slice(0,10)}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);
}
/** Vêlage prévu : date de l'insémination ou de la saillie + 283 jours. @param {string} day */
export const expectedCalvingDate=day=>addIsoDays(day,GESTATION_DAYS);
/** Date limite de notification d'une naissance à l'EDE / BDNI (7 jours). @param {string} birth */
export const bdniDeadline=birth=>addIsoDays(birth,BDNI_DAYS);
/** @param {any} animal */
export const animalLabel=animal=>[animal?.name,animal?.nationalId?`n° ${String(animal.nationalId).slice(-4)}`:''].filter(Boolean).join(' · ')||'Animal sans numéro';
/** @param {any} animal @param {string} today */
const present=(animal,today)=>!animal.deletedAt&&!(animal.exitDate&&String(animal.exitDate).slice(0,10)<=today);
/**
 * Vêlages attendus : dernière insémination ou saillie d'une femelle présente, sans vêlage enregistré depuis.
 * @param {Partial<import('parcelles/types').AppState>} data
 * @param {{today?:string, horizon?:number, past?:number}} [options] horizon / past en jours autour d'aujourd'hui.
 */
export function expectedCalvings(data,{today=localDay(),horizon=45,past=30}={}){
  const animals=new Map((data.animals||[]).filter(a=>present(a,today)&&a.sex!=='M').map(a=>[a.id,a]));
  /** @type {Map<string,any[]>} */
  const byAnimal=new Map();
  for(const e of data.animalEvents||[]){if(e.deletedAt||!animals.has(e.animalId))continue;const list=byAnimal.get(e.animalId)||[];list.push(e);byAnimal.set(e.animalId,list);}
  const from=addIsoDays(today,-past),to=addIsoDays(today,horizon),rows=[];
  for(const [id,events] of byAnimal){
    const service=events.filter(e=>SERVICE_KINDS.has(e.kind)&&e.date).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    if(!service||events.some(e=>e.kind==='calving'&&String(e.date)>=String(service.date)))continue;
    const date=service.expectedCalvingDate||expectedCalvingDate(service.date);
    if(!date||date<from||date>to)continue;
    const animal=animals.get(id),days=Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/864e5);
    rows.push({animal,event:service,date,days,label:animalLabel(animal)});
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.animal.id).localeCompare(String(b.animal.id)));
}
/**
 * Naissances à notifier à l'EDE / BDNI : vêlage sans case « notifié » ni tâche close.
 * status : 'pending' (avant J+5), 'remind' (de J+5 à J+7), 'late' (après J+7).
 * @param {Partial<import('parcelles/types').AppState>} data @param {string} [today]
 */
export function pendingBdni(data,today=localDay()){
  const tasks=new Map((data.tasks||[]).map(t=>[t.id,t])),animals=new Map((data.animals||[]).map(a=>[a.id,a]));
  return (data.animalEvents||[]).filter(e=>!e.deletedAt&&e.kind==='calving'&&e.date&&!e.bdniNotifiedAt).flatMap(e=>{
    const task=e.bdniTaskId?tasks.get(e.bdniTaskId):null;
    if(task&&!task.deletedAt&&!isPending(task,'task'))return [];
    const mother=animals.get(e.animalId);if(!mother||mother.deletedAt)return [];
    const calf=e.calfId?animals.get(e.calfId)||null:null,deadline=e.bdniDeadline||bdniDeadline(e.date),remindOn=addIsoDays(e.date,BDNI_REMINDER_DAYS);
    const status=today>deadline?'late':today>=remindOn?'remind':'pending';
    return [{event:e,mother,calf,task:task||null,deadline,remindOn,status}];
  }).sort((a,b)=>a.deadline.localeCompare(b.deadline));
}
/**
 * n° 129 : préconisations et commentaires de parcelle écrits par d'autres et pas encore lus sur cet appareil
 * (preferences.parcelCommentsSeen : identifiants des commentaires déjà affichés ici, avec l'heure de lecture).
 * La lecture se note par commentaire et non par date : un commentaire écrit hors ligne avant la dernière ouverture
 * de la parcelle, mais reçu après, reste nouveau (son createdAt vient de l'appareil de l'auteur).
 * Sans compte cloud (uid vide), tout est écrit ici : rien de nouveau. Les commentaires de plus de maxDays jours
 * ne sont pas signalés.
 * @param {Partial<import('parcelles/types').AppState>} data
 * @param {{uid?:string, now?:number, maxDays?:number}} [options]
 */
export function newParcelComments(data,{uid='',now=Date.now(),maxDays=30}={}){
  if(!uid)return {count:0,precos:0,comments:[],parcelIds:[]};
  /** @type {Record<string,number>} */
  const seen=/** @type {any} */(data.preferences||{}).parcelCommentsSeen||{};
  const parcels=new Set((data.parcelles||[]).filter(p=>!p.deletedAt).map(p=>p.id)),since=now-maxDays*864e5;
  const comments=(data.parcelComments||[]).filter(c=>!c.deletedAt&&parcels.has(c.parcelId)&&c.authorUid&&c.authorUid!==uid
    &&Number(c.createdAt||0)>since&&!seen[c.id])
    .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
  return {count:comments.length,precos:comments.filter(c=>c.kind==='preco').length,comments,parcelIds:[...new Set(comments.map(c=>c.parcelId))]};
}
