import {filterGrazingSessions} from './grazing.js';
// One ordering for the home recommendation and the work filters.
const closedStatuses=new Set(['Terminé','Terminée','Annulé','Annulée']);
export function agendaDate(item,kind='work'){
  const value=String(kind==='task'?item.dueDate||'':item.plannedDate||item.date||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';
}
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
  const date=agendaDate(item),pending=isPending(item);
  if(tab==='today')return date===today&&!['Annulé','Annulée'].includes(item.status);
  if(tab==='overdue')return pending&&Boolean(date)&&date<today;
  if(tab==='upcoming')return pending&&(!date||date>today);
  if(tab==='history')return !pending;
  return true;
}
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
export function localDay(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
const number=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
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
export function parcelSituation(data,id,today=localDay()){
  const works=(data.interventions||[]).filter(w=>w.parcelId===id&&!w.deletedAt);
  const tasks=(data.tasks||[]).filter(t=>t.parcelId===id);
  const context=getParcelWorkContext(works,today,tasks);
  const observations=(data.observations||[]).filter(o=>o.parcelId===id&&!o.deletedAt&&o.status!=='Résolu');
  const grazing=filterGrazingSessions(data.grazingSessions,{parcelId:id,date:today});
  const dueToday=works.some(w=>isPending(w)&&agendaDate(w)===today);
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
  if(!hourly?.time?.length||!Number.isFinite(age)||age<0||age>6*3600000)return {stale:true,window:null,risk:null};
  // The existing rain preference is daily, so never compare it to hourly rain.
  const wind=number(preferences.weatherWindThreshold),rain=0.2;
  if(!(wind>0))return {stale:false,window:null,risk:null};
  let start=null,end=null,risk=null,best=null;
  hourly.time.forEach((time,i)=>{
    const date=new Date(time),speed=number(hourly.wind_gusts_10m?.[i]??hourly.wind_speed_10m?.[i]),wet=number(hourly.precipitation?.[i]);
    if(date<now||localDay(date)!==localDay(now))return;
    if(speed===null||wet===null){start=end=null;return;}
    const good=speed<wind&&wet<rain;
    if(!good&&!risk)risk={time,reason:wet>=rain?'Pluie':'Vent'};
    if(good){if(!start||date-new Date(end)>3600000)start=time;end=time;if(!best||new Date(end)-new Date(start)>new Date(best.end)-new Date(best.start))best={start,end};}
    else start=end=null;
  });
  return {stale:false,risk,window:best&&best.end!==best.start?best:null};
}

export function grazingWatch(data,today=localDay(),threshold=7){
  if(!(Number(threshold)>0))return [];
  const parcels=new Map((data.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,p]));
  return filterGrazingSessions(data.grazingSessions,{date:today}).filter(s=>s.startDate).flatMap(s=>{
    const days=Math.floor((new Date(`${today}T12:00:00Z`)-new Date(`${s.startDate}T12:00:00Z`))/86400000);
    return days>=Number(threshold)?[{id:s.id,parcelId:s.parcelId,days,label:`${parcels.get(s.parcelId)?.nom||'Parcelle'} · animaux présents depuis ${days} jours`}]:[];
  });
}

export function maintenanceRemaining(machine){
  const due=number(machine.maintenanceDue),current=number(machine.currentMeter);
  return due===null||current===null?null:due-current;
}
export function isLowStock(item){
  const threshold=number(item.alertBelow),quantity=number(item.quantity);
  return threshold!==null&&quantity!==null&&quantity<=threshold;
}
