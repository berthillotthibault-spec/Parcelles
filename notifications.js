import {localDate} from './utils.js';
import {agendaDate,isPending,localDay,grazingWatch,maintenanceRemaining,isLowStock,newParcelComments} from './home-priorities.js';
import {longOpenLots} from './grazing.js';
import {deadlineNotifications} from './regulated-ops.js'; // v8a n° 72
import {missedHabits,learnHabits,calendarDue} from './habits.js'; // n° 102
import {farmAdvice,overdueLevel} from './conseils.js'; // I2 : conseils du jour
import {filterHiddenAdvice} from './learning.js'; // conseils jugés « pas utiles » deux fois : masqués pour la campagne

export function computeNotifications(state,{uid='',now=Date.now(),today=localDay()}={}){
  const rows=[];
  const active=t=>(state[t]||[]).filter(x=>!x.deletedAt);
  for(const task of active('tasks')){
    const date=agendaDate(task,'task');
    if(!isPending(task,'task')||!date)continue;
    if(date<today)rows.push({id:`task-overdue-${task.id}`,level:'urgent',title:'Tâche en retard',message:task.title,entity:'tasks',entityId:task.id,kind:task.kind||'',date});
    else if(date===today)rows.push({id:`task-today-${task.id}`,level:'warning',title:'Tâche prévue aujourd’hui',message:task.title,entity:'tasks',entityId:task.id,kind:task.kind||'',date});
    // n° 79 : rappel avant l’échéance (remindOn, par exemple notification BDNI à J+5 pour une échéance à J+7).
    else if(task.remindOn&&String(task.remindOn).slice(0,10)<=today)rows.push({id:`task-remind-${task.id}`,level:'warning',title:'Rappel',message:task.title,entity:'tasks',entityId:task.id,kind:task.kind||'',date});
  }
  for(const work of active('interventions')){
    const date=agendaDate(work);
    if(!isPending(work)||!date)continue;
    // I2 (R8) : l’identifiant reste work-overdue-<id> ; seuls le niveau et why[] viennent d’overdueLevel.
    if(date<today){let graded={level:'urgent',why:[]};try{graded=overdueLevel(state,work,{today});}catch{}rows.push({id:`work-overdue-${work.id}`,level:graded.level,title:'Travail en retard',message:work.type,entity:'interventions',entityId:work.id,date,why:graded.why});}
    else if(date===today)rows.push({id:`work-today-${work.id}`,level:'info',title:'Travail prévu aujourd’hui',message:work.type,entity:'interventions',entityId:work.id,date});
  }
  for(const m of active('materiels')){
    const remaining=maintenanceRemaining(m);
    if(remaining!==null){
      if(remaining<=0)rows.push({id:`maintenance-${m.id}`,level:'urgent',title:'Entretien matériel dépassé',message:`${m.nom} · ${Math.abs(Math.round(remaining))} h dépassées`,entity:'materiels',entityId:m.id});
      else if(remaining<=20)rows.push({id:`maintenance-${m.id}`,level:'warning',title:'Entretien matériel bientôt dû',message:`${m.nom} · dans ${Math.round(remaining)} h`,entity:'materiels',entityId:m.id});
    }
  }
  for(const item of active('stockItems')){
    if(item.alertBelow===null||item.alertBelow===undefined)continue;
    const quantity=Number(item.quantity), threshold=Number(item.alertBelow);
    if(isLowStock(item))rows.push({id:`stock-${item.id}`,level:quantity<=0?'urgent':'warning',title:quantity<=0?'Stock épuisé':'Stock faible',message:`${item.name||'Produit'} · ${quantity} ${item.unit||''}`,entity:'stockItems',entityId:item.id});
  }
  for(const obs of active('observations')){
    if(obs.severity==='urgent'&&obs.status!=='Résolu')rows.push({id:`observation-${obs.id}`,level:'urgent',title:'Observation terrain urgente',message:obs.title||obs.type||'Observation',entity:'observations',entityId:obs.id,date:obs.date});
  }
  // n° 129 : « 2 nouvelles préconisations » écrites par d'autres membres (conseiller, collègues) depuis la dernière lecture.
  const fresh=newParcelComments(state,{uid,now});
  if(fresh.count){const precos=fresh.precos===fresh.count,n=fresh.count;rows.push({id:'parcel-comments-new',level:'info',title:'Parcelles',message:`${n} ${precos?`nouvelle${n>1?'s':''} préconisation${n>1?'s':''}`:`nouveau${n>1?'x':''} commentaire${n>1?'s':''}`}`,entity:'parcelComments',entityId:fresh.comments[0].id});}
  rows.push(...deadlineNotifications(state,{today})); // v8a n° 72 : Certiphyto, contrôle, assurance, conseil stratégique
  // n° 102 : travail habituel non fait à la période attendue (désactivable : preferences.habitReminders).
  if(state.preferences?.habitReminders!==false){const habits=learnHabits(state,{now});for(const h of missedHabits(state,{now,habits}))rows.push({id:h.id,level:'info',title:'Travail habituel non fait',message:`${h.label} : ${h.message}`,entity:'interventions',entityId:h.afterId,date:h.expected});
    // Travail de saison (premier semis, première fauche…) attendu d'après les campagnes passées, sans travail prévu.
    for(const h of calendarDue(state,{now,habits}))rows.push({id:h.id,level:h.late?'warning':'info',title:`${h.type} de saison ${h.late?'en retard':'à prévoir'} · ${h.culture}`,message:h.message,entity:'habitCalendar',entityId:h.id,ha:h.ha,date:h.to,why:[h.message,'Rappel tiré de vos campagnes passées ; désactivable dans Réglages › « Rappeler un travail habituel non fait ».'],action:{type:'plan-habit-work',label:'Planifier',id:'',payload:{parcelIds:h.parcelIds,type:h.type,date:h.from<today?today:h.from}}});}
  const grazingThresholds=active('automationRules').filter(r=>r.enabled&&r.kind==='grazing_duration'&&Number(r.threshold)>0).map(r=>Number(r.threshold));
  if(grazingThresholds.length)for(const row of grazingWatch(state,today,Math.min(...grazingThresholds)))rows.push({id:`grazing-${row.id}`,level:'warning',title:'Pâturage à surveiller',message:row.label,entity:'grazingSessions',entityId:row.id});
  for(const row of longOpenLots(state,{date:today}))rows.push({id:`grazing-open-${row.id}`,level:'warning',title:'Lot encore ouvert ?',message:row.label,entity:'grazingSessions',entityId:row.id});
  const pending=(state.queue||[]).filter(x=>x.status==='pending').length;
  if(state.preferences?.syncEnabled&&pending>20)rows.push({id:'sync-queue',level:'warning',title:'Synchronisation en attente',message:`${pending} modifications attendent une synchronisation.`,entity:'sync'});
  const meta=state.metadata||{};
  if(state.preferences?.autoBackup&&meta.lastAutoBackupDay){const age=(Date.now()-new Date(`${meta.lastAutoBackupDay}T12:00:00`).getTime())/86400000;if(age>3)rows.push({id:'backup-old',level:'warning',title:'Sauvegarde locale ancienne',message:`Dernière sauvegarde : ${localDate(meta.lastAutoBackupDay)}`,entity:'backup'});}
  // I2 : conseils du jour (DAR, azote, successions, vêlages, délais d’attente), sans doublon d’identifiant.
  // Un apport en période d’interdiction (R3B) est toujours aussi un travail en retard : son conseil complète la ligne work-overdue-<id> au lieu d’en ajouter une seconde.
  try{const ids=new Set(rows.map(r=>r.id));const parcelOf=new Map((state.interventions||[]).map(w=>[w?.id,w?.parcelId]));const advices=farmAdvice(state,{today}).map(a=>a.parcelId||a.entity!=='interventions'?a:{...a,parcelId:parcelOf.get(a.entityId)||''});for(const a of filterHiddenAdvice(state,advices,{today})){const late=a.rule==='R3B'&&rows.find(r=>r.id===`work-overdue-${a.entityId}`);if(late){late.level='urgent';late.why=[a.message,...(late.why||[]).filter(x=>x!==a.message)];continue;}if(!ids.has(a.id)){ids.add(a.id);rows.push({id:a.id,level:a.level,title:a.title,message:a.message,entity:a.entity,entityId:a.entityId,why:a.why,action:a.action,rule:a.rule||'',parcelId:a.parcelId||''});}}}catch{}
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
