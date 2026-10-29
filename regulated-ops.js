// n° 72 : opérateurs et matériel réglementés (Certiphyto, contrôle du pulvérisateur, assurance, conseil
// stratégique phytosanitaire) et échéances administratives regroupées. Logique pure, sans DOM.
// Les données restent dans exploitation.conformite (réglages de la conformité, déjà synchronisés) et sur le
// matériel (controleDate, insuranceDue) : aucune nouvelle collection.
import {isoDate, localDate, normalize} from './utils.js';

export const REGULATED_DEFAULTS=Object.freeze({sprayerControlYears:3,warnDays:60,cspYears:5});
export const REGULATED_NOTE='Périodicités indicatives (octobre 2026), modifiables : contrôle du pulvérisateur tous les 3 ans (5 ans pour un matériel neuf au premier contrôle), Certiphyto de 5 ans, conseil stratégique phytosanitaire selon la règle en vigueur. Vérifiez auprès de votre chambre d’agriculture.';
export const CERTIPHYTO_CATEGORIES=Object.freeze([['decideur','Décideur en exploitation agricole'],['operateur','Opérateur en exploitation agricole']]);
const SPRAYER=/pulve|pulverisateur|atomiseur|sprayer|rampe/;
const DAY=864e5;
const clampInt=(value,min,max,fallback)=>{const n=Math.round(Number(value));return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;};
const day=value=>new Date(`${String(value).slice(0,10)}T12:00:00`);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&!Number.isNaN(day(value).getTime());
export function addYears(date,years){const d=day(date);d.setFullYear(d.getFullYear()+years);return isoDate(d);}
export function daysUntil(date,today){return Math.round((day(date)-day(today))/DAY);}

export function regulatedSettings(state){
  const raw=state?.exploitation?.conformite||{};
  return{
    sprayerControlYears:clampInt(raw.sprayerControlYears,1,10,REGULATED_DEFAULTS.sprayerControlYears),
    warnDays:clampInt(raw.warnDays,0,365,REGULATED_DEFAULTS.warnDays),
    cspYears:clampInt(raw.cspYears,1,10,REGULATED_DEFAULTS.cspYears),
    cspDate:validDate(raw.cspDate)?String(raw.cspDate):'',
    operators:operatorCards(state)
  };
}
/** Fiches opérateur : nom, n° Certiphyto, catégorie, fin de validité (enregistrées dans conformite.certiphytos). */
export function operatorCards(state){
  const list=Array.isArray(state?.exploitation?.conformite?.certiphytos)?state.exploitation.conformite.certiphytos:[];
  return list.map(c=>({nom:String(c?.nom||'').trim(),numero:String(c?.numero||'').trim().slice(0,40),categorie:CERTIPHYTO_CATEGORIES.some(([k])=>k===c?.categorie)?c.categorie:'',expiresAt:validDate(c?.expiresAt)?String(c.expiresAt):''})).filter(c=>c.nom);
}
export function certiphytoFor(state,name){const key=normalize(name);return key?operatorCards(state).find(c=>normalize(c.nom)===key)||null:null;}
export const categoryLabel=key=>CERTIPHYTO_CATEGORIES.find(([k])=>k===key)?.[1]||'';

/** Avertissement (non bloquant) pour un traitement : l'opérateur saisi a-t-il un Certiphyto valide à la date ? */
export function operatorCertificateWarning(state,work){
  const name=String(work?.operator||'').trim();if(!name)return null;
  const date=String(work.date||work.plannedDate||isoDate(new Date())).slice(0,10),card=certiphytoFor(state,name);
  if(!card)return{code:'certiphyto',message:`Opérateur « ${name} » : aucun Certiphyto enregistré. Renseignez-le dans Menu › Gestion › Opérateurs et échéances.`};
  if(!card.expiresAt)return{code:'certiphyto',message:`Opérateur « ${name} » : date de validité du Certiphyto non renseignée.`};
  if(card.expiresAt<date)return{code:'certiphyto',message:`Opérateur « ${name} » : Certiphyto expiré le ${localDate(card.expiresAt)}. Le traitement doit être fait par une personne certifiée.`};
  return null;
}

export function sprayerMachines(state){return(state?.materiels||[]).filter(m=>!m.deletedAt&&(m.controleDate||SPRAYER.test(normalize(`${m.nom||''} ${m.type||''} ${m.category||''} ${m.model||''}`))));}
function status(dueDate,today,warnDays){if(!dueDate)return'unknown';const left=daysUntil(dueDate,today);return left<0?'ko':left<=warnDays?'warn':'ok';}

/**
 * Échéances administratives regroupées : Certiphyto, contrôle des pulvérisateurs, assurances du matériel,
 * conseil stratégique phytosanitaire. Triées : dépassées, proches, inconnues, à jour.
 */
export function adminDeadlines(state,{today=isoDate(new Date())}={}){
  const s=regulatedSettings(state),rows=[];
  const push=(row)=>{const st=status(row.dueDate,today,s.warnDays);rows.push({...row,status:st,daysLeft:row.dueDate?daysUntil(row.dueDate,today):null});};
  for(const c of s.operators)push({id:`certiphyto:${normalize(c.nom)}`,kind:'certiphyto',label:`Certiphyto de ${c.nom}`,detail:[categoryLabel(c.categorie),c.numero?`n° ${c.numero}`:''].filter(Boolean).join(' · ')||'Certificat individuel',dueDate:c.expiresAt});
  for(const m of sprayerMachines(state)){const due=m.controleDate?addYears(m.controleDate,s.sprayerControlYears):'';push({id:`sprayer:${m.id}`,kind:'sprayer',label:`Contrôle pulvérisateur : ${m.nom||'Pulvérisateur'}`,detail:m.controleDate?`Dernier contrôle le ${localDate(m.controleDate)} · tous les ${s.sprayerControlYears} ans`:'Date du dernier contrôle non renseignée',dueDate:due,entity:'materiels',entityId:m.id});}
  for(const m of(state?.materiels||[]).filter(x=>!x.deletedAt&&validDate(x.insuranceDue)))push({id:`insurance:${m.id}`,kind:'insurance',label:`Assurance : ${m.nom||'Matériel'}`,detail:'Échéance du contrat',dueDate:m.insuranceDue,entity:'materiels',entityId:m.id});
  const phytoUsed=(state?.interventions||[]).some(w=>!w.deletedAt&&(w.isPhytosanitary||/phyto|pulve|herbicide|fongicide|insecticide/.test(normalize(`${w.type||''}`))));
  if(s.cspDate||phytoUsed)push({id:'csp',kind:'csp',label:'Conseil stratégique phytosanitaire',detail:s.cspDate?`Dernier conseil le ${localDate(s.cspDate)} · tous les ${s.cspYears} ans`:'Date du dernier conseil non renseignée',dueDate:s.cspDate?addYears(s.cspDate,s.cspYears):''});
  const order={ko:0,warn:1,unknown:2,ok:3};
  return rows.sort((a,b)=>order[a.status]-order[b.status]||String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')));
}

/** Rappels pour l'accueil et les notifications : seulement les échéances dépassées ou proches. */
export function deadlineNotifications(state,{today=isoDate(new Date())}={}){
  return adminDeadlines(state,{today}).filter(d=>d.status==='ko'||d.status==='warn').map(d=>({
    id:`deadline-${d.id}`,level:d.status==='ko'?'urgent':'warning',title:d.status==='ko'?'Échéance réglementaire dépassée':'Échéance réglementaire proche',
    message:`${d.label} · ${d.status==='ko'?`depuis le ${localDate(d.dueDate)}`:`le ${localDate(d.dueDate)} (dans ${d.daysLeft} j)`}`,entity:d.entity||'regulated',entityId:d.entityId||d.id,date:d.dueDate
  }));
}

/** Voyant du tableau de conformité pour les échéances non couvertes ailleurs (assurance, conseil stratégique). */
export function adminDeadlinesCheck(state,{today=isoDate(new Date())}={}){
  const rows=adminDeadlines(state,{today}).filter(d=>d.kind==='insurance'||d.kind==='csp');
  const worst=['ko','warn','unknown','ok'].find(s=>rows.some(r=>r.status===s))||'na';
  const labels={ko:'À corriger',warn:'À vérifier',unknown:'Non suivi',ok:'À jour',na:'Non concerné'};
  return{id:'admin-deadlines',label:'Échéances administratives',status:worst,statusLabel:labels[worst],
    detail:rows.length?`${rows.length} échéance${rows.length>1?'s':''} suivie${rows.length>1?'s':''} (assurances, conseil stratégique phytosanitaire).`:'Aucune assurance ni conseil stratégique renseigné.',
    items:rows.filter(r=>r.status!=='ok').map(r=>({label:r.label,note:r.dueDate?`Échéance le ${localDate(r.dueDate)}`:r.detail})),
    action:{type:'regulated',label:'Opérateurs et échéances'},hint:REGULATED_NOTE};
}
