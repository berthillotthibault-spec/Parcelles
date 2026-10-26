// Facturation (vague 13) : textes d’envoi des documents (envoi, relances, remerciement), en logique pure.
// documentMessage() prépare {subject, body, recipients} pour la messagerie (messaging-ui.js, openComposer) :
// rien n’est envoyé ici. Modèles personnalisables dans les paramètres de facturation (messages.<clé>) et,
// pour les relances, dans chaque niveau de relance (subject, body). Variables entre accolades ; une
// variable inconnue reste visible telle quelle pour que l’utilisateur la remarque.
import {active} from './farm-memory.js';
import {DOC_LABELS,dateFr,docTypeOf,documentTotals,invoiceBalance,invoiceFileName,invoiceSettings,isoDay,daysBetween,round2} from './invoices.js';

export const MESSAGE_PURPOSES=['envoi','relance1','relance2','relance3','remerciement'];
const text=v=>String(v??'').trim();
const NB='\u00a0';
const euros=v=>`${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0).replace(/[  ]/g,NB)}${NB}€`;

export const DEFAULT_MESSAGES={
  envoi:{subject:'{type} {numero} · {entreprise}',body:'Bonjour {prenom},\n\nVeuillez trouver ci-joint {article} {typeMinuscule} n° {numero} du {date}, d’un montant de {montant} TTC.{ligneEcheance}\n\nCordialement,\n{entreprise}'},
  relance1:{subject:'Rappel : facture {numero} arrivée à échéance',body:'Bonjour {prenom},\n\nSauf erreur de notre part, la facture n° {numero} du {date} ({montant} TTC) arrivée à échéance le {echeance} reste à régler : {reste}.\n\nSi votre paiement est déjà parti, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{entreprise}'},
  relance2:{subject:'Deuxième relance : facture {numero}',body:'Bonjour {prenom},\n\nMalgré notre premier rappel, la facture n° {numero} du {date} reste impayée ({reste}, échéance du {echeance}, {jours} jours de retard).\n\nMerci de procéder à son règlement dans les meilleurs délais{ligneIban}.\n\nCordialement,\n{entreprise}'},
  relance3:{subject:'Dernière relance avant recouvrement : facture {numero}',body:'Bonjour {prenom},\n\nLa facture n° {numero} du {date} reste impayée ({reste}) malgré nos relances, avec {jours} jours de retard sur l’échéance du {echeance}.\n\nSans règlement sous huit jours, nous appliquerons les pénalités de retard et l’indemnité forfaitaire pour frais de recouvrement prévues à nos conditions{ligneFrais}.\n\nCordialement,\n{entreprise}'},
  remerciement:{subject:'Merci pour votre règlement · {numero}',body:'Bonjour {prenom},\n\nNous avons bien reçu votre règlement de la facture n° {numero}. Merci pour votre confiance.\n\nCordialement,\n{entreprise}'}
};
const QUOTE_ENVOI={subject:'Devis {numero} · {entreprise}',body:'Bonjour {prenom},\n\nVeuillez trouver ci-joint notre devis n° {numero} du {date}, d’un montant de {montant} TTC, valable jusqu’au {validite}.\n\nPour l’accepter, il suffit de nous le retourner signé avec la mention « Bon pour accord ».\n\nCordialement,\n{entreprise}'};

// Remplace {variable} ; les variables inconnues (ou sans valeur) restent visibles.
export function fillTemplate(template,vars){return String(template||'').replace(/\{([a-zA-Z]+)\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(vars,k)&&vars[k]!==null&&vars[k]!==undefined?String(vars[k]):m);}

// Destinataire du document : fiche client à jour, sinon coordonnées figées sur le document.
export function documentRecipients(state,doc){
  const c=doc.clientId?active(state,'clients').find(x=>x.id===doc.clientId):null;
  const email=text(c?.billingEmail)||text(c?.email)||text(doc.clientEmail),phone=text(c?.phone)||text(doc.clientPhone),name=text(c?.name)||text(doc.clientName);
  if(!name&&!email&&!phone)return[];
  return[{...(c?{id:c.id}:doc.clientId?{id:doc.clientId}:{}),kind:'client',name,phone,email,role:'Client',...(text(c?.contact)?{contact:text(c.contact)}:{})}];
}
function names(state,doc){
  const c=doc.clientId?active(state,'clients').find(x=>x.id===doc.clientId):null,contact=text(c?.contact);
  if(contact){const [first,...rest]=contact.split(/\s+/);return{prenom:first,nom:rest.join(' ')||first};}
  return{prenom:'',nom:text(c?.name)||text(doc.clientName)};
}
// Variables disponibles pour un document (utiles aussi pour l’aperçu du modèle dans les paramètres).
export function documentVars(state,doc,{today=isoDay(),level=null}={}){
  const s={...invoiceSettings(state),...(doc.seller||{})},t=docTypeOf(doc),tot=doc.status==='brouillon'?documentTotals(doc):doc.totals||documentTotals(doc);
  const b=['facture','acompte'].includes(t)&&doc.status!=='brouillon'?invoiceBalance(state,doc):null,{prenom,nom}=names(state,doc);
  const fee=level?invoiceSettings(state).reminders.find(r=>r.level===level)?.fee||0:0;
  const iban=text(s.iban).replace(/\s/g,'').replace(/(.{4})/g,'$1 ').trim();
  return{prenom:prenom||'Madame, Monsieur',nom,client:text(doc.clientName),entreprise:text(s.legalName),type:DOC_LABELS[t],typeMinuscule:DOC_LABELS[t].toLowerCase(),article:'notre',
    numero:doc.number||'(brouillon)',date:dateFr(doc.issueDate),montant:euros(Math.abs(tot.ttc)),echeance:dateFr(doc.dueDate),validite:dateFr(doc.validUntil),
    reste:euros(b?b.due:Math.abs(tot.ttc)),jours:doc.dueDate?String(Math.max(0,daysBetween(doc.dueDate,today))):'0',frais:euros(fee),iban,
    lien:'',travaux:(doc.lines||[]).filter(l=>l&&(l.kind===undefined||l.kind==='item')&&l.label).slice(0,5).map(l=>l.label).join(', '),
    ligneEcheance:t==='avoir'?`\nCet avoir vient en déduction de la facture ${doc.creditOfNumber||''}.`:doc.dueDate&&t!=='devis'&&t!=='proforma'?`\nÉchéance : ${dateFr(doc.dueDate)}${iban?` (virement : ${iban})`:''}.`:'',
    ligneIban:iban?`, par virement sur le compte ${iban}`:'',ligneFrais:fee?` (frais de relance : ${euros(fee)})`:''};
}
const amountDue=(state,doc)=>{const t=docTypeOf(doc);return['facture','acompte'].includes(t)&&doc.status!=='brouillon'?invoiceBalance(state,doc).due:round2(Math.abs((doc.totals||documentTotals(doc)).ttc));};
// Texte d’un envoi : purpose = envoi | relance1 | relance2 | relance3 | remerciement.
export function documentMessage(state,doc,{purpose='envoi',today=isoDay()}={}){
  const p=MESSAGE_PURPOSES.includes(purpose)?purpose:'envoi',t=docTypeOf(doc),level=/^relance(\d)$/.exec(p)?Number(p.slice(-1)):null;
  if(level&&!['facture','acompte'].includes(t))throw Error('Seule une facture se relance.');
  const s=invoiceSettings(state),own=level?s.reminders.find(r=>r.level===level):null,custom=s.messages?.[p==='envoi'&&(t==='devis'||t==='proforma')?'devis':p];
  const base=p==='envoi'&&(t==='devis'||t==='proforma')?QUOTE_ENVOI:DEFAULT_MESSAGES[p];
  const tpl={subject:text(own?.subject)||text(custom?.subject)||base.subject,body:text(own?.body)||text(custom?.body)||base.body};
  const vars=documentVars(state,doc,{today,level});
  return{subject:fillTemplate(tpl.subject,vars),body:fillTemplate(tpl.body,vars),recipients:documentRecipients(state,doc),
    context:{entity:'integrationImports',id:doc.id,kind:doc.farmKind},templateKey:`billing.${p}`,purpose:p,attachmentName:invoiceFileName(doc),amountDue:amountDue(state,doc)};
}

// Relance groupée (centre Facturation) : un seul message par client pour toutes ses factures en retard.
// Une seule facture : texte du niveau de relance (documentMessage). Plusieurs : liste des pièces avec leur
// reste dû, total et coordonnées bancaires. Le niveau est celui de la facture la plus avancée.
export const GROUPED_REMINDER={
  subject:'{intitule} : {nombre} factures en attente de règlement',
  body:'Bonjour {prenom},\n\n{introduction}\n\n{liste}\n\nTotal restant dû : {total}.{ligneIban}{ligneFrais}\n\nSi votre paiement est déjà parti, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{entreprise}'
};
const GROUP_INTRO={1:'Sauf erreur de notre part, les factures suivantes, arrivées à échéance, restent à régler :',2:'Malgré notre premier rappel, les factures suivantes restent impayées :',3:'Malgré nos relances, les factures suivantes restent impayées. Sans règlement sous huit jours, nous appliquerons les pénalités de retard et l’indemnité forfaitaire prévues à nos conditions :'};
const GROUP_TITLE={1:'Rappel',2:'Deuxième relance',3:'Dernière relance avant recouvrement'};
export function groupedReminderMessage(state,docs,{level=1,today=isoDay()}={}){
  const list=(docs||[]).filter(d=>d&&['facture','acompte'].includes(docTypeOf(d))&&d.status!=='brouillon');
  if(!list.length)throw Error('Aucune facture à relancer.');
  const lv=Math.min(3,Math.max(1,Math.floor(Number(level))||1));
  if(list.length===1)return{...documentMessage(state,list[0],{purpose:`relance${lv}`,today}),ids:[list[0].id],level:lv};
  const sorted=[...list].sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||''))),first=sorted[0];
  const vars=documentVars(state,first,{today,level:lv}),dues=sorted.map(d=>invoiceBalance(state,d).due),total=round2(dues.reduce((s,v)=>s+v,0));
  const fees=round2((invoiceSettings(state).reminders.find(r=>r.level===lv)?.fee||0)*sorted.length);
  const liste=sorted.map((d,i)=>`- Facture n° ${d.number} du ${dateFr(d.issueDate)}, échéance du ${dateFr(d.dueDate)} (${Math.max(0,daysBetween(d.dueDate,today))} jours de retard) : ${euros(dues[i])}`).join('\n');
  const all={...vars,intitule:GROUP_TITLE[lv],introduction:GROUP_INTRO[lv],liste,nombre:String(sorted.length),total:euros(total),
    ligneFrais:fees?`\nFrais de relance : ${euros(fees)}.`:'',ligneIban:vars.iban?`\nRèglement par virement sur le compte ${vars.iban}.`:''};
  return{subject:fillTemplate(GROUPED_REMINDER.subject,all),body:fillTemplate(GROUPED_REMINDER.body,all),recipients:documentRecipients(state,first),
    context:{entity:'integrationImports',id:first.id,kind:first.farmKind||'invoice',finance:true,label:`Relance ${lv} groupée · ${sorted.length} factures`},
    templateKey:`billing.relance${lv}`,purpose:`relance${lv}`,attachmentName:'',amountDue:total,ids:sorted.map(d=>d.id),level:lv};
}

// Suivi d’un devis envoyé sans réponse ou qui expire bientôt (modèle « suiviDevis » personnalisable).
export const QUOTE_FOLLOW_UP={subject:'Votre devis {numero} · {entreprise}',body:'Bonjour {prenom},\n\nNous revenons vers vous au sujet de notre devis n° {numero} du {date}, d’un montant de {montant} TTC{ligneValidite}.\n\nAvez-vous pu en prendre connaissance ? Nous restons à votre disposition pour toute question ou adaptation. Pour l’accepter, il suffit de nous le retourner signé avec la mention « Bon pour accord ».\n\nCordialement,\n{entreprise}'};
export function quoteFollowUpMessage(state,quote,{today=isoDay()}={}){
  if(docTypeOf(quote)!=='devis')throw Error('Seul un devis se relance de cette façon.');
  const custom=invoiceSettings(state).messages?.suiviDevis,vars=documentVars(state,quote,{today});
  const all={...vars,ligneValidite:quote.validUntil?`, valable jusqu’au ${dateFr(quote.validUntil)}`:''};
  return{subject:fillTemplate(text(custom?.subject)||QUOTE_FOLLOW_UP.subject,all),body:fillTemplate(text(custom?.body)||QUOTE_FOLLOW_UP.body,all),recipients:documentRecipients(state,quote),
    context:{entity:'integrationImports',id:quote.id,kind:quote.farmKind||'quote',finance:true,label:`Suivi du devis ${quote.number||''}`.trim()},templateKey:'billing.suiviDevis',purpose:'suivi',attachmentName:invoiceFileName(quote),amountDue:round2(Math.abs((quote.totals||documentTotals(quote)).ttc))};
}
