import {toNumber, localDate} from './utils.js';

export function computeNotifications(state){
  const today=new Date().toISOString().slice(0,10); const rows=[];
  const active=t=>(state[t]||[]).filter(x=>!x.deletedAt);
  for(const task of active('tasks')){
    if(task.status==='Terminé'||!task.dueDate)continue;
    if(task.dueDate<today)rows.push({id:`task-overdue-${task.id}`,level:'urgent',title:'Tâche en retard',message:task.title,entity:'tasks',entityId:task.id,date:task.dueDate});
    else if(task.dueDate===today)rows.push({id:`task-today-${task.id}`,level:'warning',title:'Tâche prévue aujourd’hui',message:task.title,entity:'tasks',entityId:task.id,date:task.dueDate});
  }
  for(const work of active('interventions')){
    const date=work.plannedDate||work.date;
    if(['Terminé','Annulé'].includes(work.status)||!date)continue;
    if(date<today)rows.push({id:`work-overdue-${work.id}`,level:'urgent',title:'Travail en retard',message:work.type,entity:'interventions',entityId:work.id,date});
    else if(date===today)rows.push({id:`work-today-${work.id}`,level:'info',title:'Travail prévu aujourd’hui',message:work.type,entity:'interventions',entityId:work.id,date});
  }
  for(const m of active('materiels')){
    const current=Number(m.currentMeter), due=Number(m.maintenanceDue);
    if(Number.isFinite(current)&&Number.isFinite(due)){
      const remaining=due-current;
      if(remaining<=0)rows.push({id:`maintenance-${m.id}`,level:'urgent',title:'Entretien matériel dépassé',message:`${m.nom} · ${Math.abs(Math.round(remaining))} h dépassées`,entity:'materiels',entityId:m.id});
      else if(remaining<=20)rows.push({id:`maintenance-${m.id}`,level:'warning',title:'Entretien matériel bientôt dû',message:`${m.nom} · dans ${Math.round(remaining)} h`,entity:'materiels',entityId:m.id});
    }
  }
  for(const item of active('stockItems')){
    if(item.alertBelow===null||item.alertBelow===undefined)continue;
    const quantity=Number(item.quantity), threshold=Number(item.alertBelow);
    if(Number.isFinite(quantity)&&Number.isFinite(threshold)&&quantity<=threshold)rows.push({id:`stock-${item.id}`,level:quantity<=0?'urgent':'warning',title:quantity<=0?'Stock épuisé':'Stock faible',message:`${item.name||'Produit'} · ${quantity} ${item.unit||''}`,entity:'stockItems',entityId:item.id});
  }
  for(const obs of active('observations')){
    if(obs.severity==='urgent')rows.push({id:`observation-${obs.id}`,level:'urgent',title:'Observation terrain urgente',message:obs.title||obs.type||'Observation',entity:'observations',entityId:obs.id,date:obs.date});
  }
  const pending=(state.queue||[]).filter(x=>x.status==='pending').length;
  if(state.preferences?.syncEnabled&&pending>20)rows.push({id:'sync-queue',level:'warning',title:'Synchronisation en attente',message:`${pending} modifications attendent une synchronisation.`});
  const meta=state.metadata||{};
  if(meta.lastAutoBackupDay){const age=(Date.now()-new Date(`${meta.lastAutoBackupDay}T12:00:00`).getTime())/86400000;if(age>3)rows.push({id:'backup-old',level:'warning',title:'Sauvegarde locale ancienne',message:`Dernière sauvegarde : ${localDate(meta.lastAutoBackupDay)}`});}
  const order={urgent:0,warning:1,info:2};
  return rows.sort((a,b)=>(order[a.level]??9)-(order[b.level]??9));
}

export async function requestNotificationPermission(){
  if(!('Notification'in window))return 'unsupported';
  if(Notification.permission==='granted')return 'granted';
  try{return await Notification.requestPermission();}catch{return Notification.permission;}
}

export function showBrowserNotification(title,options={}){
  if(!('Notification'in window)||Notification.permission!=='granted')return false;
  try{new Notification(title,{icon:'./icon-192.png',badge:'./icon-192.png',...options});return true;}catch{return false;}
}
