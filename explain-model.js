// n° 110 — Calculs purs de la feuille « Pourquoi ? » (explain-ui.js), au format
// {value, why[], missing[], rule}. Déplacés hors des modules du démarrage (home-priorities.js,
// notifications.js, pilotage.js, automations.js) : ce module n’est importé que par explain-ui.js,
// lui-même chargé à la demande. Lecture seule : rien n’est enregistré.
import {toNumber, localDate} from './utils.js';
import {localDay, dailySituation, grazingWatch, maintenanceRemaining} from './home-priorities.js';
import {computeNotifications} from './notifications.js';
import {AUTOMATION_KINDS, AUTOMATION_TRIGGERS, AUTOMATION_TARGETS, AUTOMATION_OPERATORS, AUTOMATION_FIELDS, automationMatches, automationRuleLabel} from './automations.js';
import {SLOT_DISCLAIMER} from './work-weather.js';

// Aides reprises à l’identique des modules d’origine (non exportées là-bas).
const number=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const active=(state,type)=>(state[type]||[]).filter(x=>!x.deletedAt);
const numOrNull=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};

// n° 110 : « Pourquoi ? » d’une priorité de l’accueil, au format {value, why[], missing[]}.
// Reprend l’ordre de getHomeAgenda : en cours, en retard, aujourd’hui, sans échéance, à venir.
const frDay=day=>new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
const dayGap=(a,b)=>Math.round((new Date(`${b}T12:00:00Z`)-new Date(`${a}T12:00:00Z`))/86400000);
export const AGENDA_ORDER='Ordre de l’accueil : en cours, puis en retard, aujourd’hui, sans échéance et à venir ; à égalité, la date puis l’heure de début.';
export function explainAgendaEntry(entry,today,{parcel=null,position=0,total=0}={}){
  if(!entry?.item)return {value:null,why:[],missing:[]};
  const {item,kind,date}=entry,task=kind==='task',ongoing=item.status==='En cours',late=Boolean(date)&&date<today;
  const why=[],missing=[];
  if(ongoing)why.push('Statut « En cours » : un travail commencé passe avant tout le reste.');
  if(late){const n=dayGap(date,today);why.push(`Échéance du ${frDay(date)} dépassée de ${n} jour${n>1?'s':''}.`);}
  else if(date===today)why.push('Échéance aujourd’hui.');
  else if(date){const n=dayGap(today,date);why.push(`Échéance le ${frDay(date)}, dans ${n} jour${n>1?'s':''}.`);}
  else why.push('Sans échéance : rangé après les travaux du jour.');
  if(!task&&item.plannedDate&&item.date&&String(item.plannedDate).slice(0,10)!==String(item.date).slice(0,10))why.push(`Date prévue (${frDay(String(item.plannedDate).slice(0,10))}) retenue plutôt que la date de saisie.`);
  if(item.startTime)why.push(`Heure de début : ${item.startTime}${item.endTime?` → ${item.endTime}`:''}.`);
  if(parcel)why.push(`Parcelle : ${parcel.nom||'sans nom'}${number(parcel.surfaceHa)!==null?` (${String(number(parcel.surfaceHa)).replace('.',',')} ha)`:''}.`);
  if(position&&total)why.push(`Rang ${position} sur ${total} ${total>1?'éléments':'élément'} en attente.`);
  why.push(AGENDA_ORDER);
  if(!date)missing.push(task?'Aucune échéance saisie':'Aucune date prévue saisie');
  if(!item.parcelId)missing.push('Parcelle non renseignée');
  else if(!parcel)missing.push('Parcelle introuvable (supprimée ?)');
  if(!task&&!item.startTime&&date===today)missing.push('Heure de début non renseignée : rangé après les travaux horodatés du même jour');
  const value=ongoing?'En cours':late?'En retard':date===today?'Aujourd’hui':!date?'À organiser':'À venir';
  return {value,why,missing};
}
// n° 110 : chiffres du bilan de la journée (travaux faits, hectares, heures de matériel).
export function explainDailySituation(data,today=localDay()){
  const s=dailySituation(data,today),noArea=s.done.filter(w=>number(w.surfaceWorked)===null),noHours=s.done.filter(w=>w.equipmentId&&number(w.duration)===null);
  const parcels=new Map((data.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,p]));
  const plannedFromParcel=s.planned.filter(w=>number(w.surfaceWorked)===null&&number(parcels.get(w.parcelId)?.surfaceHa)!==null).length;
  const plural=(n,one,many)=>`${n} ${n>1?many:one}`;
  const why=[`${plural(s.done.length,'travail terminé','travaux terminés')} aujourd’hui (date de réalisation, jamais la date prévue).`,
    `${plural(s.planned.length,'travail prévu','travaux prévus')} aujourd’hui et pas encore terminé${s.planned.length>1?'s':''}.`,
    `Hectares enregistrés : somme des surfaces travaillées saisies (${String(Math.round(s.doneArea*100)/100).replace('.',',')} ha).`];
  if(s.equipmentHours)why.push(`Heures de matériel : durées des travaux terminés avec un matériel (${String(Math.round(s.equipmentHours*10)/10).replace('.',',')} h).`);
  if(plannedFromParcel)why.push(`${plural(plannedFromParcel,'travail prévu compte','travaux prévus comptent')} la surface de la parcelle, faute de surface travaillée.`);
  const missing=[];
  if(noArea.length)missing.push(`${plural(noArea.length,'travail terminé','travaux terminés')} sans surface travaillée : exclu${noArea.length>1?'s':''} des hectares`);
  if(noHours.length)missing.push(`${plural(noHours.length,'travail avec matériel','travaux avec matériel')} sans durée : exclu${noHours.length>1?'s':''} des heures`);
  return {value:`${s.done.length}/${s.done.length+s.planned.length}`,why,missing,done:s.done,planned:s.planned};
}

// n° 110 : « Pourquoi ? » d’une alerte, au format {value, why[], missing[], rule}.
// L’alerte est recalculée à partir de son identifiant : la feuille montre les faits du moment.
const LEVELS={urgent:'Urgent',warning:'À surveiller',info:'Information'};
const gapDays=(from,to)=>Math.round((new Date(`${to}T12:00:00Z`)-new Date(`${from}T12:00:00Z`))/86400000);
const plural=(n,one,many)=>`${n} ${Math.abs(n)>1?many:one}`;
const OPENABLE=['tasks','interventions','materiels','stockItems','grazingSessions','observations','regulated','sync'];
export function explainNotification(state,id,{today=localDay()}={}){
  const n=computeNotifications(state).find(row=>row.id===id);
  if(!n)return {value:null,why:['Cette alerte n’est plus active : la situation a changé depuis son affichage.'],missing:[],rule:null};
  const item=n.entity&&n.entityId?(state[n.entity]||[]).find(x=>x.id===n.entityId):null,why=[],missing=[];
  let rule=OPENABLE.includes(n.entity)?{label:'Ouvrir l’élément',action:'notification-open',entity:n.entity,id:n.entityId||''}:null;
  if(/^(task|work)-(overdue|today)-/.test(n.id)){
    const task=n.entity==='tasks';
    why.push(task?`Échéance de la tâche : ${localDate(n.date)}.`:`Date prévue du travail : ${localDate(n.date)}${item&&!item.plannedDate?' (date du travail, faute de date prévue)':''}.`);
    why.push(n.date<today?`Dépassée de ${plural(gapDays(n.date,today),'jour','jours')} : l’élément n’est ni terminé ni annulé.`:'Prévu aujourd’hui et pas encore terminé.');
    why.push(`Statut actuel : ${item?.status||(task?'À faire':'Planifié')}.`);
    if(!item?.parcelId)missing.push('Parcelle non renseignée');
  }else if(n.id.startsWith('maintenance-')){
    const remaining=maintenanceRemaining(item||{});
    why.push(`Compteur actuel : ${toNumber(item?.currentMeter)} h ; entretien prévu à ${toNumber(item?.maintenanceDue)} h (fiche du matériel).`);
    why.push(remaining<=0?`Échéance dépassée de ${Math.abs(Math.round(remaining))} h.`:`Alerte dès 20 h avant l’échéance : il reste ${Math.round(remaining)} h.`);
    rule={label:'Modifier l’échéance du matériel',action:'notification-open',entity:'materiels',id:n.entityId,edit:true};
  }else if(n.id.startsWith('stock-')){
    const unit=item?.unit?` ${item.unit}`:'';
    why.push(`Quantité en stock : ${item?.quantity??0}${unit}.`,`Seuil d’alerte de la fiche : ${item?.alertBelow}${unit} (alerte quand la quantité l’atteint ou passe dessous).`);
    if(Number(item?.quantity)<=0)why.push('Quantité nulle ou négative : alerte urgente.');
    rule={label:'Modifier le seuil d’alerte',action:'notification-open',entity:'stockItems',id:n.entityId,edit:true};
  }else if(n.id.startsWith('observation-')){
    why.push('Observation de gravité « urgente » non résolue.');
    if(item?.date)why.push(`Saisie le ${localDate(item.date)}.`);else missing.push('Date de l’observation non renseignée');
    why.push('L’alerte disparaît quand l’observation passe à « Résolu ».');
  }else if(n.id.startsWith('grazing-')){
    const rules=(state.automationRules||[]).filter(r=>!r.deletedAt&&r.enabled&&r.kind==='grazing_duration'&&Number(r.threshold)>0).sort((a,b)=>Number(a.threshold)-Number(b.threshold)),first=rules[0];
    const watch=first?grazingWatch(state,today,Number(first.threshold)).find(row=>row.id===n.entityId):null;
    if(watch)why.push(`Animaux présents depuis ${plural(watch.days,'jour','jours')} (entrée au pré le ${localDate(item?.startDate)}).`);
    if(first){why.push(`Seuil de la règle « ${first.name||'Durée au pâturage'} » : ${plural(Number(first.threshold),'jour','jours')}.`);rule={label:'Modifier la règle',action:'edit-automation',id:first.id};}
  }else if(n.id==='sync-queue'){
    why.push(n.message,'L’alerte apparaît au-delà de 20 modifications en attente ; elles partiront à la prochaine connexion, rien n’est perdu sur cet appareil.');
  }else if(n.id==='backup-old'){
    const last=state.metadata?.lastAutoBackupDay;
    why.push(`Dernière sauvegarde automatique : ${localDate(last)}, il y a ${plural(gapDays(last,today),'jour','jours')}.`,'L’alerte apparaît au-delà de 3 jours sans sauvegarde.');
  }else if(n.id.startsWith('deadline-')){
    why.push(`${n.message}.`,n.level==='urgent'?'Échéance dépassée.':'Échéance proche (fenêtre d’alerte du suivi réglementaire).');
  }else why.push(n.message||n.title);
  why.push(`Niveau : ${LEVELS[n.level]||n.level}. Les alertes sont triées : urgent, puis à surveiller, puis information.`);
  return {value:n.title,why,missing,rule};
}

// ---------- n° 110 · « Pourquoi ? » des totaux du Pilotage ----------
// Chaque explication suit le format {value, why[], missing[], rule} : faits, données exclues, règle.
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(v)} €`;
const ha=v=>`${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(v||0)} ha`;
const many=(n,one,more)=>`${n} ${n>1?more:one}`;
const names=(rows,max=4)=>rows.slice(0,max).map(r=>r.parcel?.nom||'Parcelle').join(', ')+(rows.length>max?` et ${rows.length-max} autre${rows.length-max>1?'s':''}`:'');
export const MARGIN_TOTALS=Object.freeze({realized:'Charges réalisées',engaged:'Charges engagées (prévues)',product:'Produit attendu',margin:'Marge prévisionnelle'});
export function explainMarginTotal(model,key){
  const t=model.total,rows=model.rows,why=[`Campagne ${model.campaign} : ${many(rows.length,'parcelle exploitée','parcelles exploitées')} (${ha(t.area)}), parcelles louées à d’autres et archivées exclues.`],missing=[];
  const costed=rows.filter(r=>r.works);
  if(key==='realized'){
    why.push(`Somme des coûts des travaux terminés : ${eur(t.realized)}.`);
    if(t.forfait)why.push(`Forfait de charges manuelles (€/ha × surface) : ${eur(t.forfait)}, sur ${many(rows.filter(r=>r.forfaitApplied).length,'parcelle','parcelles')} sans aucun travail chiffré.`);
    const ignored=rows.filter(r=>r.ignoredManual);if(ignored.length)why.push(`Charges manuelles non appliquées sur ${names(ignored)} : des travaux y sont chiffrés.`);
    if(t.unknownRealized)missing.push(`${many(t.unknownRealized,'travail terminé sans coût : exclu','travaux terminés sans coût : exclus')} (jamais compté comme 0 €)`);
  }else if(key==='engaged'){
    why.push(`Somme des coûts des travaux prévus (ni terminés ni annulés) : ${eur(t.engaged)}.`);
    if(t.unknownPlanned)missing.push(`${many(t.unknownPlanned,'travail prévu non chiffré : exclu','travaux prévus non chiffrés : exclus')}`);
  }else if(key==='product'){
    const known=rows.filter(r=>r.product!==null),none=rows.filter(r=>r.product===null);
    why.push(`Produit = produit/ha saisi, sinon rendement × prix, multiplié par la surface.`,`${many(known.length,'parcelle','parcelles')} avec un produit connu (${ha(t.productArea)}) : ${eur(t.productArea?t.product:null)}.`);
    if(none.length)missing.push(`${many(none.length,'parcelle sans rendement ni prix','parcelles sans rendement ni prix')} : ${names(none)} (exclue${none.length>1?'s':''})`);
  }else if(key==='margin'){
    why.push('Marge = produit attendu − charges réalisées − charges engagées.',`Calculée seulement sur les parcelles dont le produit est connu (${ha(t.productArea)}) : produit ${eur(t.productArea?t.product:null)} − charges ${eur(t.chargesWithProduct)}.`);
    if(t.marginHa!==null)why.push(`Soit ${eur(t.marginHa)}/ha sur ${ha(t.productArea)}.`);
    if(t.withoutProduct)missing.push(`${many(t.withoutProduct,'parcelle sans produit : exclue','parcelles sans produit : exclues')} de la marge`);
    if(t.unknownRealized+t.unknownPlanned)missing.push(`${many(t.unknownRealized+t.unknownPlanned,'travail sans coût','travaux sans coût')} : la marge peut être surestimée`);
  }else return {value:null,why:[],missing:[],rule:null};
  why.push(`Fiabilité : ${t.reliability} % (moitié produit connu, moitié travaux chiffrés, pondérée par la surface).`);
  if(!costed.length)missing.push('Aucun travail sur la campagne');
  const value=key==='realized'?t.realized+t.forfait:key==='engaged'?t.engaged:key==='product'?(t.productArea?t.product:null):t.margin;
  return {value:eur(value),why,missing,rule:{label:'Marges par culture',action:'open-crop-margins',campaign:model.campaign}};
}
// Valeur des stocks : quantité × prix unitaire ; un article sans prix est exclu, pas compté à 0 €.
export function explainStockValue(state){
  const items=active(state,'stockItems'),priced=items.filter(x=>numOrNull(x.unitPrice)!==null&&numOrNull(x.quantity)!==null);
  const unpriced=items.length-priced.length,value=priced.reduce((s,x)=>s+toNumber(x.quantity)*toNumber(x.unitPrice),0);
  const why=[`Somme quantité × prix unitaire de ${many(priced.length,'article','articles')} : ${eur(value)}.`];
  const top=[...priced].sort((a,b)=>toNumber(b.quantity)*toNumber(b.unitPrice)-toNumber(a.quantity)*toNumber(a.unitPrice))[0];
  if(top)why.push(`Plus forte valeur : ${top.name||'Article'} (${eur(toNumber(top.quantity)*toNumber(top.unitPrice))}).`);
  return {value:eur(value),why,missing:unpriced?[`${many(unpriced,'article sans prix ou quantité : exclu','articles sans prix ou quantité : exclus')}`]:[],rule:{label:'Ouvrir les stocks',action:'open-stock'}};
}

// n° 110 : « Pourquoi ? » d’une règle, au format {value, why[], missing[], rule} : déclencheur,
// conditions ou seuil, délai entre deux alertes et correspondances actuelles (sans rien exécuter).
const WEATHER_KINDS=['weather_window','sowing_conditions','agro_risk'];
export function explainAutomationRule(rule,state,nowMs=Date.now(),context={}){
  if(!rule)return {value:null,why:['Règle introuvable (supprimée ?).'],missing:[],rule:null};
  const why=[],missing=[],trigger=AUTOMATION_TRIGGERS[rule.trigger||'interval'];
  why.push(rule.enabled?'Règle active.':'Règle désactivée : elle ne se déclenche pas.');
  why.push(`Déclencheur « ${trigger?.label||rule.trigger} »${trigger?.description?` : ${trigger.description}`:'.'}`);
  if(rule.target){
    const conditions=(rule.conditions||[]).filter(c=>c?.field),fields=Object.fromEntries(AUTOMATION_FIELDS[rule.target]||[]);
    why.push(`Cible : ${AUTOMATION_TARGETS[rule.target]?.label||rule.target}, ${rule.matchMode==='any'?'au moins une condition':'toutes les conditions'} :`);
    for(const c of conditions)why.push(`– ${fields[c.field]||c.field} ${AUTOMATION_OPERATORS[c.operator||'eq']||c.operator}${['empty','not_empty','truthy','falsy','before_today','on_today','after_today'].includes(c.operator)?'':` « ${c.valueField?fields[c.valueField]||c.valueField:c.value??''} »`}`);
    if(!conditions.length)missing.push('Aucune condition : tous les éléments de la cible correspondent');
  }else{
    why.push(AUTOMATION_KINDS[rule.kind]?.description||automationRuleLabel(rule));
    if(rule.threshold!==undefined&&rule.threshold!==null&&rule.kind!=='urgent_observation')why.push(`Seuil réglé : ${rule.threshold}.`);
  }
  const cooldown=toNumber(rule.cooldownHours);if(cooldown>0)why.push(`Délai minimal entre deux déclenchements : ${cooldown} h.`);
  if(rule.lastRunAt)why.push(`Dernier déclenchement : ${new Date(Number(rule.lastRunAt)).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}${rule.lastResult?` (${rule.lastResult.count||0} correspondance${(rule.lastResult.count||0)>1?'s':''})`:''}.`);
  else why.push('Jamais déclenchée pour l’instant.');
  if(WEATHER_KINDS.includes(rule.kind)){
    if(!context.weather&&!context.agroWeather)missing.push('Prévisions météo non chargées : la règle ne peut pas conclure');
    why.push(SLOT_DISCLAIMER);
  }
  let matches=[];try{matches=automationMatches({...rule,enabled:true},state,nowMs,context);}catch{missing.push('Évaluation impossible avec les données actuelles');}
  if(matches.length)why.push(`Correspond maintenant à : ${matches.slice(0,5).map(m=>m.label||m.message).join(' ; ')}${matches.length>5?` et ${matches.length-5} autre${matches.length-5>1?'s':''}`:''}.`);
  return {value:`${matches.length} correspondance${matches.length>1?'s':''} maintenant`,why,missing,rule:{label:'Modifier la règle',action:'edit-automation',id:rule.id}};
}
