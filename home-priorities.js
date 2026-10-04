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
    .sort((a,b)=>agendaDate(b).localeCompare(agendaDate(a)))[0]||null;
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
  candidates.sort((a,b)=>rank(a)-rank(b)||a.date.localeCompare(b.date)||String(a.item.id).localeCompare(String(b.item.id)));
  return {next:candidates[0]||null,overdueCount:candidates.filter(entry=>entry.overdue).length,overdueWorks:candidates.filter(entry=>entry.kind==='work'&&entry.overdue).length};
}
