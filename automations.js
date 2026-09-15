import {isoDate,toNumber,uid} from './utils.js';

export const AUTOMATION_KINDS={
  task_overdue:{label:'Tâches en retard',description:'Alerter lorsqu’une tâche dépasse son échéance.'},
  work_today:{label:'Travaux du jour',description:'Alerter lorsqu’un travail planifié arrive aujourd’hui.'},
  stock_low:{label:'Stock faible',description:'Alerter lorsqu’un article atteint son seuil.'},
  maintenance_due:{label:'Entretien matériel',description:'Alerter lorsqu’un entretien est dû ou proche.'},
  urgent_observation:{label:'Observation urgente',description:'Alerter sur les observations terrain urgentes non résolues.'},
  backup_old:{label:'Sauvegarde ancienne',description:'Alerter si aucune sauvegarde récente n’est enregistrée.'},
  sync_pending:{label:'Synchronisation en attente',description:'Alerter si trop de modifications restent dans la file de synchronisation.'}
};

export function automationTemplates(){return [
  {kind:'task_overdue',name:'Tâches en retard',threshold:1,cooldownHours:12,action:'notify'},
  {kind:'stock_low',name:'Stocks faibles',threshold:1,cooldownHours:12,action:'notify'},
  {kind:'maintenance_due',name:'Entretien matériel',threshold:20,cooldownHours:24,action:'notify'},
  {kind:'urgent_observation',name:'Observations urgentes',threshold:1,cooldownHours:6,action:'notify'},
  {kind:'backup_old',name:'Sauvegarde à vérifier',threshold:3,cooldownHours:24,action:'notify'},
  {kind:'sync_pending',name:'Synchronisation en attente',threshold:20,cooldownHours:6,action:'notify'}
];}

const active=(state,type)=>(state[type]||[]).filter(x=>!x.deletedAt);
export function automationMatches(rule,state,nowMs=Date.now()){
  if(!rule?.enabled)return[];const today=isoDate(nowMs),threshold=toNumber(rule.threshold);
  if(rule.kind==='task_overdue')return active(state,'tasks').filter(x=>x.status!=='Terminé'&&x.dueDate&&x.dueDate<today).map(x=>({entity:'tasks',entityId:x.id,title:'Tâche en retard',message:x.title||'Tâche'}));
  if(rule.kind==='work_today')return active(state,'interventions').filter(x=>!['Terminé','Annulé'].includes(x.status)&&((x.plannedDate||x.date)===today)).map(x=>({entity:'interventions',entityId:x.id,title:'Travail prévu aujourd’hui',message:x.type||'Travail'}));
  if(rule.kind==='stock_low')return active(state,'stockItems').filter(x=>x.alertBelow!==null&&x.alertBelow!==undefined&&Number(x.quantity)<=Number(x.alertBelow)).map(x=>({entity:'stockItems',entityId:x.id,title:Number(x.quantity)<=0?'Stock épuisé':'Stock faible',message:`${x.name||'Article'} · ${x.quantity??0} ${x.unit||''}`}));
  if(rule.kind==='maintenance_due')return active(state,'materiels').filter(x=>Number.isFinite(Number(x.currentMeter))&&Number.isFinite(Number(x.maintenanceDue))&&(Number(x.maintenanceDue)-Number(x.currentMeter))<=threshold).map(x=>({entity:'materiels',entityId:x.id,title:'Entretien matériel',message:`${x.nom||'Matériel'} · ${Math.round(Number(x.maintenanceDue)-Number(x.currentMeter))} h restantes`}));
  if(rule.kind==='urgent_observation')return active(state,'observations').filter(x=>x.status!=='Résolu'&&x.severity==='urgent').map(x=>({entity:'observations',entityId:x.id,title:'Observation terrain urgente',message:x.title||x.type||'Observation'}));
  if(rule.kind==='backup_old'){const last=state.metadata?.lastAutoBackupDay;if(!last)return[{entity:'backup',entityId:'',title:'Sauvegarde à vérifier',message:'Aucune sauvegarde automatique datée.'}];const age=(nowMs-new Date(`${last}T12:00:00`).getTime())/86400000;return age>threshold?[{entity:'backup',entityId:'',title:'Sauvegarde ancienne',message:`Dernière sauvegarde il y a ${Math.floor(age)} jours.`}]:[];}
  if(rule.kind==='sync_pending'){const count=(state.queue||[]).filter(x=>x.status==='pending').length;return count>=threshold?[{entity:'sync',entityId:'',title:'Synchronisation en attente',message:`${count} modifications attendent la synchronisation.`}]:[];}
  return[];
}

export function automationDue(rule,nowMs=Date.now()){
  if(!rule?.enabled)return false;const cooldown=Math.max(0,toNumber(rule.cooldownHours))*3600000;return !rule.lastRunAt||nowMs-Number(rule.lastRunAt)>=cooldown;
}

export function evaluateAutomationRules(state,nowMs=Date.now()){
  const results=[];for(const rule of active(state,'automationRules')){if(!automationDue(rule,nowMs))continue;const matches=automationMatches(rule,state,nowMs);if(matches.length)results.push({rule,matches,runKey:`${rule.id}:${isoDate(nowMs)}:${Math.floor(nowMs/3600000)}`});}return results;
}

export function newAutomationFromTemplate(template){return{id:uid('automation'),name:template.name||AUTOMATION_KINDS[template.kind]?.label||'Automatisation',kind:template.kind,threshold:template.threshold??1,cooldownHours:template.cooldownHours??12,action:template.action||'notify',enabled:true,lastRunAt:null,lastResult:null};}
export function automationRuleLabel(rule){return rule?.name||AUTOMATION_KINDS[rule?.kind]?.label||'Automatisation';}
