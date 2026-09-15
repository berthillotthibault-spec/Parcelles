import {isoDate,normalize,toNumber,uid} from './utils.js';

export const AUTOMATION_KINDS={
  task_overdue:{label:'Tâches en retard',description:'Alerter lorsqu’une tâche dépasse son échéance.'},
  work_today:{label:'Travaux du jour',description:'Alerter lorsqu’un travail planifié arrive aujourd’hui.'},
  stock_low:{label:'Stock faible',description:'Alerter lorsqu’un article atteint son seuil.'},
  maintenance_due:{label:'Entretien matériel',description:'Alerter lorsqu’un entretien est dû ou proche.'},
  urgent_observation:{label:'Observation urgente',description:'Alerter sur les observations terrain urgentes non résolues.'},
  backup_old:{label:'Sauvegarde ancienne',description:'Alerter si aucune sauvegarde récente n’est enregistrée.'},
  sync_pending:{label:'Synchronisation en attente',description:'Alerter si trop de modifications restent dans la file de synchronisation.'},
  custom:{label:'Règle personnalisée',description:'Combiner plusieurs conditions et plusieurs actions.'}
};

export const AUTOMATION_TRIGGERS={
  interval:{label:'Périodique',description:'Évaluée régulièrement lorsque Parcelles est ouverte.'},
  daily:{label:'Une fois par jour',description:'Évaluée au maximum une fois par jour.'},
  entity_change:{label:'Lors d’une modification',description:'Évaluée lorsqu’une donnée ciblée est modifiée.'},
  manual:{label:'Manuel uniquement',description:'Exécutée uniquement avec le bouton Tester / Exécuter.'}
};

export const AUTOMATION_TARGETS={
  tasks:{label:'Tâches',defaultLabelField:'title'},
  interventions:{label:'Travaux',defaultLabelField:'type'},
  stockItems:{label:'Stocks',defaultLabelField:'name'},
  materiels:{label:'Matériels',defaultLabelField:'nom'},
  observations:{label:'Observations',defaultLabelField:'title'},
  parcelles:{label:'Parcelles',defaultLabelField:'nom'},
  documents:{label:'Documents',defaultLabelField:'name'}
};

export const AUTOMATION_OPERATORS={
  eq:'est égal à',neq:'est différent de',contains:'contient',not_contains:'ne contient pas',
  gt:'est supérieur à',gte:'est supérieur ou égal à',lt:'est inférieur à',lte:'est inférieur ou égal à',
  empty:'est vide',not_empty:'n’est pas vide',before_today:'est avant aujourd’hui',on_today:'est aujourd’hui',after_today:'est après aujourd’hui',
  truthy:'est vrai',falsy:'est faux'
};

export const AUTOMATION_ACTIONS={
  notify:{label:'Envoyer une notification'},
  create_task:{label:'Créer une tâche'},
  journal:{label:'Ajouter au journal'}
};

export const AUTOMATION_FIELDS={
  tasks:[['title','Titre'],['status','Statut'],['dueDate','Échéance'],['priority','Priorité'],['parcelId','Parcelle']],
  interventions:[['type','Type'],['status','Statut'],['date','Date'],['plannedDate','Date prévue'],['parcelId','Parcelle'],['cost','Coût']],
  stockItems:[['name','Nom'],['category','Catégorie'],['quantity','Quantité'],['alertBelow','Seuil d’alerte'],['unit','Unité']],
  materiels:[['nom','Nom'],['currentMeter','Compteur actuel'],['maintenanceDue','Prochain entretien'],['category','Catégorie'],['status','Statut']],
  observations:[['title','Titre'],['type','Type'],['status','Statut'],['severity','Gravité'],['parcelId','Parcelle']],
  parcelles:[['nom','Nom'],['culture','Culture'],['surfaceHa','Surface (ha)'],['commune','Commune'],['favorite','Favori']],
  documents:[['name','Nom'],['category','Catégorie'],['documentDate','Date'],['parcelId','Parcelle'],['clientId','Client']]
};

export function automationTemplates(){return [
  {kind:'task_overdue',name:'Tâches en retard',threshold:1,cooldownHours:12,trigger:'interval',actions:[{type:'notify'}]},
  {kind:'stock_low',name:'Stocks faibles',threshold:1,cooldownHours:12,trigger:'entity_change',triggerEntity:'stockItems',actions:[{type:'notify'}]},
  {kind:'maintenance_due',name:'Entretien matériel',threshold:20,cooldownHours:24,trigger:'interval',actions:[{type:'notify'}]},
  {kind:'urgent_observation',name:'Observations urgentes',threshold:1,cooldownHours:6,trigger:'entity_change',triggerEntity:'observations',actions:[{type:'notify'}]},
  {kind:'backup_old',name:'Sauvegarde à vérifier',threshold:3,cooldownHours:24,trigger:'daily',actions:[{type:'notify'}]},
  {kind:'sync_pending',name:'Synchronisation en attente',threshold:20,cooldownHours:6,trigger:'interval',actions:[{type:'notify'}]},
  {kind:'custom',name:'Travail planifié aujourd’hui → tâche',target:'interventions',trigger:'entity_change',triggerEntity:'interventions',matchMode:'all',conditions:[{field:'status',operator:'neq',value:'Terminé'},{field:'plannedDate',operator:'on_today',value:''}],actions:[{type:'notify'},{type:'create_task',titleTemplate:'À réaliser : {label}',dueOffsetDays:0}],cooldownHours:1,maxMatches:20}
];}

const active=(state,type)=>(state[type]||[]).filter(x=>!x.deletedAt);
const valueAt=(object,path)=>String(path||'').split('.').filter(Boolean).reduce((value,key)=>value==null?undefined:value[key],object);
const text=value=>normalize(value??'');
const number=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};

export function evaluateCondition(item,condition,nowMs=Date.now()){
  if(!condition?.field)return true;
  const actual=valueAt(item,condition.field),operator=condition.operator||'eq';
  const expected=condition.valueField?valueAt(item,condition.valueField):condition.value;
  if(operator==='empty')return actual===null||actual===undefined||String(actual).trim()==='';
  if(operator==='not_empty')return !(actual===null||actual===undefined||String(actual).trim()==='');
  if(operator==='truthy')return Boolean(actual);
  if(operator==='falsy')return !actual;
  if(operator==='contains')return text(actual).includes(text(expected));
  if(operator==='not_contains')return !text(actual).includes(text(expected));
  if(operator==='eq')return text(actual)===text(expected);
  if(operator==='neq')return text(actual)!==text(expected);
  if(['gt','gte','lt','lte'].includes(operator)){
    const a=number(actual),b=number(expected);if(a===null||b===null)return false;
    if(operator==='gt')return a>b;if(operator==='gte')return a>=b;if(operator==='lt')return a<b;return a<=b;
  }
  if(['before_today','on_today','after_today'].includes(operator)){
    const actualDate=isoDate(actual),today=isoDate(nowMs);if(!actualDate)return false;
    if(operator==='before_today')return actualDate<today;if(operator==='after_today')return actualDate>today;return actualDate===today;
  }
  return false;
}

export function genericAutomationMatches(rule,state,nowMs=Date.now()){
  const target=rule.target;if(!target||!AUTOMATION_TARGETS[target])return[];
  const conditions=Array.isArray(rule.conditions)?rule.conditions.filter(c=>c?.field):[];
  const matchMode=rule.matchMode==='any'?'any':'all';
  const labelField=rule.labelField||AUTOMATION_TARGETS[target].defaultLabelField;
  const rows=active(state,target).filter(item=>{
    if(!conditions.length)return true;
    const values=conditions.map(condition=>evaluateCondition(item,condition,nowMs));
    return matchMode==='any'?values.some(Boolean):values.every(Boolean);
  });
  const max=Math.min(200,Math.max(1,Number(rule.maxMatches||50)));
  return rows.slice(0,max).map(item=>({
    entity:target,entityId:item.id,title:rule.name||AUTOMATION_TARGETS[target].label,
    message:String(valueAt(item,labelField)||item.name||item.title||item.nom||item.type||item.id||'Élément'),
    label:String(valueAt(item,labelField)||item.name||item.title||item.nom||item.type||item.id||'Élément'),
    data:item
  }));
}

export function automationMatches(rule,state,nowMs=Date.now()){
  if(!rule?.enabled)return[];
  if(rule.target)return genericAutomationMatches(rule,state,nowMs);
  const today=isoDate(nowMs),threshold=toNumber(rule.threshold);
  if(rule.kind==='task_overdue')return active(state,'tasks').filter(x=>x.status!=='Terminé'&&x.dueDate&&x.dueDate<today).map(x=>({entity:'tasks',entityId:x.id,title:'Tâche en retard',message:x.title||'Tâche',label:x.title||'Tâche',data:x}));
  if(rule.kind==='work_today')return active(state,'interventions').filter(x=>!['Terminé','Annulé'].includes(x.status)&&((x.plannedDate||x.date)===today)).map(x=>({entity:'interventions',entityId:x.id,title:'Travail prévu aujourd’hui',message:x.type||'Travail',label:x.type||'Travail',data:x}));
  if(rule.kind==='stock_low')return active(state,'stockItems').filter(x=>x.alertBelow!==null&&x.alertBelow!==undefined&&Number(x.quantity)<=Number(x.alertBelow)).map(x=>({entity:'stockItems',entityId:x.id,title:Number(x.quantity)<=0?'Stock épuisé':'Stock faible',message:`${x.name||'Article'} · ${x.quantity??0} ${x.unit||''}`,label:x.name||'Article',data:x}));
  if(rule.kind==='maintenance_due')return active(state,'materiels').filter(x=>Number.isFinite(Number(x.currentMeter))&&Number.isFinite(Number(x.maintenanceDue))&&(Number(x.maintenanceDue)-Number(x.currentMeter))<=threshold).map(x=>({entity:'materiels',entityId:x.id,title:'Entretien matériel',message:`${x.nom||'Matériel'} · ${Math.round(Number(x.maintenanceDue)-Number(x.currentMeter))} h restantes`,label:x.nom||'Matériel',data:x}));
  if(rule.kind==='urgent_observation')return active(state,'observations').filter(x=>x.status!=='Résolu'&&x.severity==='urgent').map(x=>({entity:'observations',entityId:x.id,title:'Observation terrain urgente',message:x.title||x.type||'Observation',label:x.title||x.type||'Observation',data:x}));
  if(rule.kind==='backup_old'){const last=state.metadata?.lastAutoBackupDay;if(!last)return[{entity:'backup',entityId:'',title:'Sauvegarde à vérifier',message:'Aucune sauvegarde automatique datée.',label:'Sauvegarde',data:{}}];const age=(nowMs-new Date(`${last}T12:00:00`).getTime())/86400000;return age>threshold?[{entity:'backup',entityId:'',title:'Sauvegarde ancienne',message:`Dernière sauvegarde il y a ${Math.floor(age)} jours.`,label:'Sauvegarde',data:{age}}]:[];}
  if(rule.kind==='sync_pending'){const count=(state.queue||[]).filter(x=>x.status==='pending').length;return count>=threshold?[{entity:'sync',entityId:'',title:'Synchronisation en attente',message:`${count} modifications attendent la synchronisation.`,label:'Synchronisation',data:{count}}]:[];}
  return[];
}

export function automationDue(rule,nowMs=Date.now(),context={}){
  if(!rule?.enabled)return false;
  const trigger=rule.trigger||'interval';
  if(trigger==='manual'&&!context.manual)return false;
  if(trigger==='entity_change'){
    if(context.manual)return true;
    const event=context.event;if(!event?.entity)return false;
    const expected=rule.triggerEntity||rule.target;
    if(expected&&event.entity!==expected)return false;
  }
  const last=Number(rule.lastRunAt||0);
  if(trigger==='daily'&&last&&isoDate(last)===isoDate(nowMs)&&!context.manual)return false;
  if(context.manual&&context.force)return true;
  const cooldown=Math.max(0,toNumber(rule.cooldownHours))*3600000;
  return !last||nowMs-last>=cooldown;
}

export function evaluateAutomationRules(state,nowMs=Date.now(),context={}){
  const results=[];
  for(const rule of active(state,'automationRules')){
    if(!automationDue(rule,nowMs,context))continue;
    const matches=automationMatches(rule,state,nowMs);
    if(matches.length)results.push({rule,matches,runKey:`${rule.id}:${isoDate(nowMs)}:${Math.floor(nowMs/3600000)}`});
  }
  return results;
}

export function automationActions(rule){
  const actions=Array.isArray(rule?.actions)?rule.actions.filter(a=>a?.type):[];
  if(actions.length)return actions;
  return [{type:rule?.action||'notify'}];
}

export function interpolateAutomationText(template,match,rule){
  const source=String(template||'').trim();
  const fallback=match?.label||match?.message||automationRuleLabel(rule);
  if(!source)return fallback;
  const data=match?.data||{};
  return source.replace(/\{([^}]+)\}/g,(_,key)=>{
    if(key==='label')return match?.label||fallback;
    if(key==='message')return match?.message||'';
    if(key==='rule')return automationRuleLabel(rule);
    const value=valueAt(data,key);return value===null||value===undefined?'':String(value);
  });
}

export function automationRuleSummary(rule){
  const trigger=AUTOMATION_TRIGGERS[rule?.trigger||'interval']?.label||'Périodique';
  const actions=automationActions(rule).map(a=>AUTOMATION_ACTIONS[a.type]?.label||a.type).join(' + ');
  if(rule?.target){const target=AUTOMATION_TARGETS[rule.target]?.label||rule.target;const count=(rule.conditions||[]).filter(c=>c?.field).length;return `${trigger} · ${target} · ${count} condition(s) · ${actions}`;}
  return `${trigger} · ${AUTOMATION_KINDS[rule?.kind]?.description||rule?.kind||''} · ${actions}`;
}

export function newAutomationFromTemplate(template){return{
  id:uid('automation'),name:template.name||AUTOMATION_KINDS[template.kind]?.label||'Automatisation',kind:template.kind||'custom',
  target:template.target||null,trigger:template.trigger||'interval',triggerEntity:template.triggerEntity||template.target||null,
  matchMode:template.matchMode||'all',conditions:Array.isArray(template.conditions)?template.conditions:[],
  actions:Array.isArray(template.actions)?template.actions:[{type:template.action||'notify'}],threshold:template.threshold??1,
  cooldownHours:template.cooldownHours??12,maxMatches:template.maxMatches??50,enabled:true,lastRunAt:null,lastResult:null
};}
export function automationRuleLabel(rule){return rule?.name||AUTOMATION_KINDS[rule?.kind]?.label||'Automatisation';}
