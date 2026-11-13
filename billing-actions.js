// Idée 13 : « facturation qui passe à l’action ». Transforme deux constats déjà calculés par le moteur de
// facturation en propositions à un geste, pour le fil « À décider » de l’accueil :
//  - factures en retard dont la relance est due (billing-hub.js, reminderGroups) et que le client n’a pas
//    l’habitude de payer aussi tard (payment-habits.js) : « Relancer » ouvre le message prérempli ;
//  - travaux réalisés pour un client (travaux sur ses parcelles, travaux pour tiers, travaux publics) et non
//    facturés depuis plus de N jours (billableItems) : « Préparer la facture » ouvre un brouillon prérempli.
// Module pur, sans DOM ni écriture : rien n’est envoyé ni enregistré sans un geste de l’utilisateur.
// Chargé à la demande (avec les modules de facturation), jamais au démarrage.
import {active} from './farm-memory.js';
import {addDays,billableItems,dateFr,isoDay,lineTotal,round2} from './invoices.js';
import {reminderGroups} from './billing-hub.js';
import {clientPaymentHabits,habitSentence,habitsIndex} from './payment-habits.js';

export const UNBILLED_DAYS=30;
export const BILLING_ACTIONS=Object.freeze({remind:'billing-remind',prepare:'billing-prepare-invoice'});
const KIND_LABELS={work:['travail','travaux'],fuel:['ligne de carburant','lignes de carburant'],
  tp:['journée de travaux publics','journées de travaux publics']};
const plural=(n,one,many)=>`${n} ${n>1?many:one}`;
const euros=v=>`${Math.round(v).toLocaleString('fr-FR').replace(/\s/g,' ')} €`;
const days=n=>plural(n,'jour','jours');

/** Délai de tolérance du client : retard moyen constaté s’il est fiable et positif, sinon 0. */
export function habitTolerance(habit){
  return habit?.reliable&&habit.averageLateDays>0?habit.averageLateDays:0;
}

/** Note du centre Facturation sous une relance (proposition de reminderProposals), ou '' sans habitude connue. */
export function habitNoteText(p){
  const d=p?.habit?.averageLateDays;
  // Retard moyen inconnu (factures payées sans échéance) : ne rien affirmer.
  if(!p?.habit||typeof d!=='number'||!Number.isFinite(d))return'';
  return`Paie d’habitude ${d>0?`${d} j après l’échéance`:'dans les délais'}${p.beyond>0?' : retard inhabituel.':' : encore dans ses habitudes.'}`;
}

/**
 * Relances à proposer, une par client (même regroupement que le centre Facturation).
 * Un client qui paie d’habitude 20 jours après l’échéance n’est proposé qu’au-delà de ces 20 jours :
 * {key, clientId, name, count, total, level, maxDays, tolerance, beyond, habit, why, gravity}.
 * Avec includeWithinHabits, les groupes encore dans les habitudes du client sont rendus avec beyond <= 0.
 */
export function reminderProposals(state,{today=isoDay(),habits=null,includeWithinHabits=false}={}){
  const index=habitsIndex(habits||clientPaymentHabits(state)),out=[];
  for(const g of reminderGroups(state,today)){
    const habit=index.get(g.key)||null,tolerance=habitTolerance(habit),beyond=g.maxDays-tolerance;
    if(beyond<=0&&!includeWithinHabits)continue;
    const head=plural(g.items.length,'facture impayée','factures impayées');
    const why=[`${head}, ${euros(g.total)} restant dû, échéance dépassée de ${days(g.maxDays)}.`];
    why.push(habit?.reliable?habitSentence(habit):'Historique de paiement insuffisant (moins de 2 factures payées) : l’échéance fait foi.');
    if(tolerance&&beyond>0)why.push(`Retard au-delà de ses habitudes : ${days(beyond)} de plus que d’ordinaire.`);
    const last=g.items.map(i=>i.lastReminder?.date||'').filter(Boolean).sort().pop();
    why.push(last?`Dernière relance le ${dateFr(last)} ; niveau ${g.level} atteint.`:`Aucune relance envoyée ; niveau ${g.level} atteint.`);
    why.push('Le message s’ouvre prérempli : rien n’est envoyé sans votre confirmation.');
    out.push({key:g.key,clientId:g.clientId||'',name:g.name,count:g.items.length,total:g.total,level:g.level,maxDays:g.maxDays,
      tolerance,beyond,habit:habit?.reliable?habit:null,why,gravity:g.level>=3||beyond>30?'urgent':'warning'});
  }
  return out.sort((a,b)=>b.beyond-a.beyond||b.total-a.total);
}

/**
 * Clients à facturer : travaux terminés (ou journées de travaux publics) non facturés depuis plus de `days` jours.
 * {clientId, name, count, oldest, ageDays, amountHt, unpriced, kinds, why}.
 */
export function unbilledProposals(state,{today=isoDay(),days:limitDays=UNBILLED_DAYS}={}){
  const limit=addDays(today,-Math.max(0,Number(limitDays)||0)),out=[];
  for(const c of active(state,'clients').filter(x=>!x.archived)){
    const all=billableItems(state,c.id),old=all.filter(it=>String(it.date||'').slice(0,10)<=limit);
    if(!old.length)continue;
    const priced=all.map(it=>lineTotal(it.line)),amountHt=round2(priced.reduce((s,v)=>s+(v||0),0)),unpriced=priced.filter(v=>v===null).length;
    const kinds={};for(const it of all)kinds[it.kind]=(kinds[it.kind]||0)+1;
    const oldest=String(old[0].date||'').slice(0,10),ageDays=Math.round((Date.parse(`${today}T12:00:00Z`)-Date.parse(`${oldest}T12:00:00Z`))/86400000);
    const detail=Object.entries(kinds).map(([k,n])=>plural(n,...(KIND_LABELS[k]||['élément','éléments']))).join(', ');
    const why=[`${plural(all.length,'ligne à facturer','lignes à facturer')} (${detail}), la plus ancienne du ${dateFr(oldest)}, il y a ${days(ageDays)}.`];
    why.push(amountHt>0?`Environ ${euros(amountHt)} HT d’après vos tarifs.`:'Montant inconnu : aucun tarif trouvé pour ces lignes.');
    if(unpriced)why.push(`${plural(unpriced,'ligne sans prix','lignes sans prix')} : à compléter dans le brouillon.`);
    why.push(`Seuil : travaux non facturés depuis plus de ${days(Number(limitDays)||0)}.`);
    why.push('Le brouillon s’ouvre prérempli : rien n’est enregistré ni émis sans votre validation.');
    out.push({clientId:c.id,name:String(c.name||'').trim()||'Client',count:all.length,oldest,ageDays,amountHt,unpriced,kinds,why});
  }
  return out.sort((a,b)=>a.oldest.localeCompare(b.oldest));
}

/**
 * Propositions pour le fil « À décider » (decision-feed.js, fromBilling) :
 * {id, kind, title, why, level, eur, daysLeft, key, action:{type, id, label}}.
 */
export function billingDecisions(state,{today=isoDay(),habits=null,unbilledDays=UNBILLED_DAYS}={}){
  if(!state)return[];
  const rows=[];
  for(const r of reminderProposals(state,{today,habits}))rows.push({id:`billing-remind-${r.key}`,kind:'billing-remind',key:`client:${r.key}`,
    title:`Relancer ${r.name}`,why:r.why,level:r.gravity,eur:r.total,daysLeft:-r.maxDays,action:{type:BILLING_ACTIONS.remind,id:r.key,label:'Relancer'}});
  for(const u of unbilledProposals(state,{today,days:unbilledDays}))
    rows.push({id:`billing-unbilled-${u.clientId}`,kind:'billing-unbilled',key:`client:${u.clientId}`,
    title:`Facturer ${u.name}`,why:u.why,level:u.ageDays>2*unbilledDays?'warning':'info',eur:u.amountHt||null,daysLeft:null,
    action:{type:BILLING_ACTIONS.prepare,id:u.clientId,label:'Préparer la facture'}});
  return rows;
}
