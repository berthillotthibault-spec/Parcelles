// Assistant local de facturation : répond en français aux questions courantes sur les factures,
// devis, impayés, chiffre d’affaires, prix pratiqués et TVA collectée. Logique pure, sans DOM ni
// réseau ; rien n’est jamais écrit. Les montants viennent des documents saisis dans l’appli :
// ils ne remplacent ni la comptabilité ni l’avis du comptable.
import {normalize} from './utils.js';
import {active} from './farm-memory.js';
import {ACCOUNTING_TYPES,addDays,daysBetween,docTypeOf,documentTotals,invoiceBalance,invoiceSettings,invoiceStatus,invoices,isoDay,quoteStatus,quotes,round2,amountLine} from './invoices.js';
import {agedBalance,quotesToFollow,remindersDue,revenueByClient,revenueByMonth,unbilledAlerts} from './billing-insights.js';
import {vatBalance,FILING_NOTE} from './vat-balance.js';
import {expectedCollections,habitSentence} from './payment-habits.js';

const LEGAL=new Set(['gaec','scea','earl','sarl','sas','sasu','sa','eurl','ets','sci','cuma','eta','ste','societe','mr','mme','monsieur','madame','de','des','du','la','le','les','et']);
const MONTHS=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const MONTH_LABELS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const euro=v=>`${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(round2(Number(v)||0))} €`.replace(/ /g,' ');
const dateFr=d=>d?`${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}`:'';
const plural=(n,one,many)=>`${n} ${n>1?many:one}`;
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const ttcOf=d=>num(d.totals?.ttc)??documentTotals(d).ttc;
const emitted=state=>invoices(state).filter(i=>i.status!=='brouillon'&&ACCOUNTING_TYPES.has(docTypeOf(i)));
const docName=d=>`${d.docType==='avoir'?'avoir':d.docType==='acompte'?'acompte':docTypeOf(d)==='devis'?'devis':'facture'}${d.number?` ${d.number}`:''}`;
const reply=(intent,answer,extra={})=>({recognized:true,intent,answer,text:answer,actions:[],source:'billing',...extra});

// ---------- Période demandée ----------
const monthStart=(y,m)=>`${y}-${String(m+1).padStart(2,'0')}-01`;
const monthEnd=(y,m)=>addDays(monthStart(m===11?y+1:y,m===11?0:m+1),-1);
/** Période lue dans la question (mois, trimestre, année, campagne) ; `fallback` si rien n’est précisé. */
export function periodFromQuestion(q,today,fallback='year'){
  const y=Number(today.slice(0,4)),m=Number(today.slice(5,7))-1;
  const named=MONTHS.findIndex(name=>new RegExp(`\\b${name}\\b`).test(q));
  if(named>=0){const yy=named>m?y-1:y;return{from:monthStart(yy,named),to:monthEnd(yy,named),label:`en ${MONTH_LABELS[named]} ${yy}`};}
  if(/\bmois (dernier|precedent|passe)\b/.test(q)){const yy=m===0?y-1:y,mm=m===0?11:m-1;return{from:monthStart(yy,mm),to:monthEnd(yy,mm),label:`en ${MONTH_LABELS[mm]} ${yy}`};}
  if(/\btrimestre (dernier|precedent|passe)\b/.test(q)){let qs=Math.floor(m/3)*3-3,yy=y;if(qs<0){qs=9;yy-=1;}return{from:monthStart(yy,qs),to:monthEnd(yy,qs+2),label:`au trimestre ${MONTH_LABELS[qs]}-${MONTH_LABELS[qs+2]} ${yy}`};}
  if(/\btrimestre\b/.test(q)){const qs=Math.floor(m/3)*3;return{from:monthStart(y,qs),to:today,label:`depuis le début du trimestre (${MONTH_LABELS[qs]} ${y})`};}
  if(/\bcampagne\b/.test(q)){const cy=m<7?y-1:y;return{from:`${cy}-08-01`,to:today,label:`sur la campagne ${cy}/${String(cy+1).slice(-2)} (depuis le 01/08/${cy})`};}
  if(/\bannee (derniere|precedente|passee)\b/.test(q)){return{from:`${y-1}-01-01`,to:`${y-1}-12-31`,label:`en ${y-1}`};}
  if(/\b(annee|an)\b/.test(q)||/\b20\d\d\b/.test(q)){const yy=Number(q.match(/\b(20\d\d)\b/)?.[1])||y;return{from:`${yy}-01-01`,to:yy===y?today:`${yy}-12-31`,label:yy===y?`depuis le 1er janvier ${yy}`:`en ${yy}`};}
  if(/\b(mois|mensuel)\b/.test(q)||fallback==='month')return{from:monthStart(y,m),to:today,label:`en ${MONTH_LABELS[m]} ${y}`};
  return{from:`${y}-01-01`,to:today,label:`depuis le 1er janvier ${y}`};
}

// ---------- Client cité ----------
function clientNames(state){
  const out=new Map();
  for(const c of active(state,'clients'))if(c.name)out.set(`id:${c.id}`,{key:c.id,clientId:c.id,name:c.name});
  for(const d of [...invoices(state),...quotes(state)])if(!d.clientId&&d.clientName&&!out.has(`nom:${normalize(d.clientName)}`))out.set(`nom:${normalize(d.clientName)}`,{key:`nom:${normalize(d.clientName)}`,clientId:null,name:d.clientName});
  return[...out.values()];
}
/** Client nommé dans la question (nom complet ou mots significatifs du nom), ou null. */
export function findClientInQuestion(q,state){
  const words=new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  const scored=clientNames(state).map(c=>{
    const n=normalize(c.name),sig=n.split(/[^a-z0-9]+/).filter(t=>t.length>=3&&!LEGAL.has(t));
    if(!sig.length)return null;const hits=sig.filter(t=>words.has(t));
    const score=q.includes(n)?3:hits.length===sig.length?2:hits.some(t=>t.length>=4)?1:0;
    return score?{c,score}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  if(!scored.length)return null;
  const top=scored.filter(x=>x.score===scored[0].score);
  return top.length===1?top[0].c:{ambiguous:top.map(x=>x.c)};
}
const sameClient=(d,c)=>c.clientId?d.clientId===c.clientId:!d.clientId&&normalize(d.clientName)===normalize(c.name);

// ---------- Réponses ----------
function clientBalance(state,c,today){
  const rows=emitted(state).filter(d=>sameClient(d,c)&&d.docType!=='avoir').map(d=>({d,s:invoiceStatus(d,state,today),b:invoiceBalance(state,d)})).filter(x=>['emise','partielle','retard'].includes(x.s)&&x.b.due>0.005);
  if(!rows.length)return reply('billing_client_balance',`${c.name} ne vous doit rien d’après les factures enregistrées.`);
  const due=round2(rows.reduce((s,x)=>s+x.b.due,0)),late=rows.filter(x=>x.s==='retard'),lateAmount=round2(late.reduce((s,x)=>s+x.b.due,0));
  const list=rows.sort((a,b)=>String(a.d.dueDate||'').localeCompare(String(b.d.dueDate||''))).slice(0,6).map(x=>`${docName(x.d)} : ${euro(x.b.due)}${x.s==='retard'?` en retard depuis le ${dateFr(x.d.dueDate)}`:x.d.dueDate?` (échéance ${dateFr(x.d.dueDate)})`:''}`);
  return reply('billing_client_balance',`${c.name} vous doit ${euro(due)} TTC sur ${plural(rows.length,'facture','factures')}${lateAmount?`, dont ${euro(lateAmount)} en retard`:''} : ${list.join(' ; ')}.`,{metrics:{client:c.name,due,late:lateAmount,count:rows.length}});
}
function whoOwes(state,today){
  const aged=agedBalance(state,today);
  if(aged.total<=0.005)return reply('billing_receivables','Personne ne vous doit d’argent d’après les factures enregistrées.');
  const lateBy=new Map(revenueByClient(state,{today}).map(r=>[r.key,r.late]));
  const late=round2(aged.total-aged.totals.aEchoir),due=remindersDue(state,today);
  const list=aged.byClient.slice(0,6).map(r=>`${r.name} ${euro(r.total)}${lateBy.get(r.key)>0?` (dont ${euro(lateBy.get(r.key))} en retard)`:''}`);
  const old=round2(aged.totals.j61_90+aged.totals.j90plus);
  return reply('billing_receivables',`${euro(aged.total)} TTC restent à encaisser auprès de ${plural(aged.byClient.length,'client','clients')}${late>0.005?`, dont ${euro(late)} échus`:''} : ${list.join(' ; ')}.${old>0.005?` ${euro(old)} ont plus de 60 jours de retard.`:''}${due.length?` ${plural(due.length,'relance est due','relances sont dues')} (${due.slice(0,3).map(r=>`${r.invoice.clientName||'Client'} niveau ${r.level}`).join(', ')}).`:''}`,{metrics:{total:aged.total,late,reminders:due.length}});
}
function revenue(state,q,today){
  const p=periodFromQuestion(q,today,/\bmois\b/.test(q)?'month':'year'),rows=revenueByMonth(state,{from:p.from,to:p.to});
  const ht=round2(rows.reduce((s,r)=>s+r.invoicedHt,0)),ttc=round2(rows.reduce((s,r)=>s+r.invoicedTtc,0)),collected=round2(rows.reduce((s,r)=>s+r.collected,0)),count=rows.reduce((s,r)=>s+r.count,0);
  if(!count&&!collected)return reply('billing_revenue',`Aucune facture émise ni aucun encaissement ${p.label}.`,{metrics:{...p,ht:0,ttc:0,collected:0}});
  return reply('billing_revenue',`Chiffre d’affaires facturé ${p.label} : ${euro(ht)} HT (${euro(ttc)} TTC) sur ${plural(count,'document émis','documents émis')}, avoirs déduits. Encaissé sur la même période : ${euro(collected)}. Les brouillons et les devis ne sont pas comptés.`,{metrics:{...p,ht,ttc,collected,count}});
}
function unbilled(state,today){
  const rows=unbilledAlerts(state,today,{days:0});
  if(!rows.length)return reply('billing_unbilled','Aucun travail réalisé en attente de facturation : tout ce qui est rattaché à un client semble déjà repris dans une facture ou un brouillon.');
  const count=rows.reduce((s,r)=>s+r.count,0),ht=round2(rows.reduce((s,r)=>s+r.amountHt,0)),unpriced=rows.reduce((s,r)=>s+r.unpriced,0);
  const list=rows.slice(0,6).map(r=>`${r.client.name} : ${plural(r.count,'prestation','prestations')} depuis le ${dateFr(r.oldest)}${r.amountHt?` (${euro(r.amountHt)} HT estimés)`:''}`);
  const old=rows.filter(r=>daysBetween(r.oldest,today)>30).length;
  return reply('billing_unbilled',`${plural(count,'prestation réalisée n’est','prestations réalisées ne sont')} pas encore ${count>1?'facturées':'facturée'} : ${list.join(' ; ')}.${unpriced?` ${plural(unpriced,'ligne n’a','lignes n’ont')} pas de tarif client : le montant est incomplet.`:''}${old?` ${plural(old,'client attend','clients attendent')} depuis plus de 30 jours.`:''} Total estimé : ${euro(ht)} HT.`,{metrics:{count,ht,unpriced}});
}
function pendingQuotes(state,today){
  const open=quotes(state).filter(d=>docTypeOf(d)==='devis'&&quoteStatus(d,today)==='envoye'),f=quotesToFollow(state,today);
  if(!open.length)return reply('billing_quotes','Aucun devis envoyé en attente de réponse.');
  const amount=round2(open.reduce((s,d)=>s+ttcOf(d),0));
  const follow=f.toFollow.slice(0,5).map(x=>`${x.quote.clientName||'Client'} (${docName(x.quote)}, ${euro(ttcOf(x.quote))}, sans réponse depuis ${x.days} j)`);
  const expiring=f.expiring.slice(0,3).map(x=>`${x.quote.clientName||'Client'} ${x.days>0?`dans ${x.days} j`:'aujourd’hui'}`);
  return reply('billing_quotes',`${plural(open.length,'devis en attente','devis en attente')} pour ${euro(amount)} TTC.${follow.length?` À relancer : ${follow.join(' ; ')}.`:' Aucun n’attend depuis plus de 7 jours.'}${expiring.length?` Validité qui expire bientôt : ${expiring.join(', ')}.`:''}`,{metrics:{open:open.length,amount,toFollow:f.toFollow.length}});
}
function lastInvoice(state,c,today){
  const list=emitted(state).filter(d=>d.docType!=='avoir'&&(!c||sameClient(d,c))).sort((a,b)=>String(b.issueDate||'').localeCompare(String(a.issueDate||''))||String(b.number||'').localeCompare(String(a.number||'')));
  if(!list.length)return reply('billing_last_invoice',c?`Aucune facture émise pour ${c.name}.`:'Aucune facture émise pour le moment.');
  const d=list[0],s=invoiceStatus(d,state,today),b=invoiceBalance(state,d);
  const st=s==='payee'?'payée':s==='retard'?`en retard, ${euro(b.due)} restant dus`:s==='partielle'?`partiellement payée, ${euro(b.due)} restant dus`:s==='annulee'?'annulée par avoir':`à payer${d.dueDate?` avant le ${dateFr(d.dueDate)}`:''}`;
  return reply('billing_last_invoice',`Dernière ${docName(d)}${c?'':` (${d.clientName||'client'})`}${c?` pour ${c.name}`:''} : émise le ${dateFr(d.issueDate)}, ${euro(ttcOf(d))} TTC, ${st}.`,{metrics:{invoiceId:d.id,status:s}});
}
// Prix pratiqués : lignes des factures et devis émis dont la désignation contient le terme cherché.
function practicedPrice(state,term,c){
  const key=normalize(term);if(key.length<3)return null;
  const hits=[];
  for(const d of [...invoices(state),...quotes(state)]){
    const t=docTypeOf(d);if(d.status==='brouillon'||t==='avoir'||t==='acompte'||(c&&!sameClient(d,c)))continue;
    for(const l of d.lines||[]){const label=normalize(l.label);if(!amountLine(l)||l.kind==='deduction'||num(l.unitPrice)===null||!(label.includes(key)||key.split(' ').every(w=>label.includes(w.replace(/s$/,'')))))continue;hits.push({price:l.unitPrice,unit:l.unit||'u',date:d.issueDate||'',client:d.clientName||''});}
  }
  if(!hits.length)return reply('billing_price',`Je ne trouve aucun prix pratiqué pour « ${term} »${c?` avec ${c.name}`:''} dans vos factures et devis émis.`);
  const byUnit=new Map();for(const h of hits){if(!byUnit.has(h.unit))byUnit.set(h.unit,[]);byUnit.get(h.unit).push(h);}
  const parts=[...byUnit.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,3).map(([unit,list])=>{
    const prices=list.map(h=>h.price).sort((a,b)=>a-b),mid=Math.floor(prices.length/2),median=prices.length%2?prices[mid]:round2((prices[mid-1]+prices[mid])/2);
    const last=list.sort((a,b)=>b.date.localeCompare(a.date))[0],per=unit==='forfait'?'le forfait':`/${unit}`;
    return prices.length>1?`${euro(median)} HT ${per} en médiane sur ${list.length} lignes (de ${euro(prices[0])} à ${euro(prices[prices.length-1])}), dernier : ${euro(last.price)} le ${dateFr(last.date)}${last.client&&!c?` (${last.client})`:''}`:`${euro(last.price)} HT ${per} le ${dateFr(last.date)}${last.client&&!c?` (${last.client})`:''}`;
  });
  return reply('billing_price',`Prix pratiqué pour « ${term} »${c?` avec ${c.name}`:''} : ${parts.join(' ; ')}.`,{metrics:{count:hits.length}});
}
function priceTerm(raw){
  const m=raw.match(/(?:prix|tarif)\s+(?:je\s+pratique\s+|est-ce que je pratique\s+|que je pratique\s+|pratiqu[ée]s?\s+)?(?:pour|du|de la|de l['’]|des|de|sur)\s+(?:le\s+|la\s+|les\s+|l['’]\s*|un\s+|une\s+)?([^?!.]+)/i)||raw.match(/(?:combien je (?:facture|fais payer|prends?|compte))\s+(?:pour\s+|le\s+|la\s+|les\s+|l['’]\s*|un\s+|une\s+)*([^?!.]+)/i);
  return m?m[1].replace(/\b(?:chez|pour|avec|à|au|aux)\s+.*$/i,'').replace(/\s+/g,' ').trim():'';
}
// TVA collectée : sur les factures émises (débits) et sur les encaissements de la période.
function vatCollected(state,q,today){
  const s=invoiceSettings(state),p=periodFromQuestion(q,today,'month');
  if(s.vatRegime==='franchise')return reply('billing_vat','Vos paramètres indiquent la franchise en base de TVA : vos factures ne portent pas de TVA, il n’y a donc pas de TVA collectée à reverser. À confirmer avec votre comptable si votre chiffre d’affaires approche des seuils.');
  if(s.vatRegime==='remboursement-forfaitaire')return reply('billing_vat','Vos paramètres indiquent le remboursement forfaitaire agricole : vous ne collectez normalement pas de TVA sur vos factures. Vérifiez avec votre comptable que ce régime s’applique bien à toutes vos ventes et prestations.');
  // TVA collectée et déductible : un seul calcul, celui de vat-balance.js.
  const vb=vatBalance(state,{from:p.from,to:p.to}),unknown=vb.unknown.length;
  const {debits,cash,cashUnknown}=vb.collected,nature=s.operationNature,onDebits=!!s.vatOnDebits;
  const rates=vb.collected.byRate.map(({rate,tax})=>`${String(rate).replace('.',',')} % : ${euro(tax)}`).join(', ');
  const rule=nature==='biens'?'Pour des livraisons de biens, la TVA est en principe exigible à la livraison, donc le montant facturé est le repère.'
    :nature==='mixte'?'Activité mixte : la TVA des biens suit en principe la livraison (factures), celle des prestations suit l’encaissement, sauf option pour les débits'+(onDebits?' (option cochée dans vos paramètres).':'.')
    :onDebits?'Vous avez opté pour la TVA d’après les débits : pour vos prestations, la TVA est due sur les factures émises.'
    :'Pour des prestations de services, la TVA est en principe due à l’encaissement (sauf option pour les débits, non cochée dans vos paramètres).';
  const main=nature==='biens'||onDebits?debits:nature==='mixte'?null:cash;
  // TVA déductible : seulement celle des achats dont le montant de TVA est connu.
  const unknownText=unknown?` ${plural(unknown,'achat',"achats")} (${euro(vb.unknownAmount)}) sans TVA connue ${unknown>1?'ne sont pas déduits':'n’est pas déduit'} : le solde réel sera sans doute plus faible.`:'';
  const deductibleText=vb.known.length
    ?` TVA déductible connue sur vos achats : ${euro(vb.deductible)} (${plural(vb.known.length,'pièce','pièces')}).${main!==null?` TVA ${vb.balance>=0?'à reverser (à payer)':'en crédit'} ${p.label} : ${euro(Math.abs(vb.balance))}.`:` Solde estimé : ${euro(vb.balances.debits)} d’après les factures, ${euro(vb.balances.encaissements)} d’après les encaissements.`}${unknownText} ${FILING_NOTE}`
    :' La TVA déductible sur vos achats n’est pas connue de l’appli : le montant réellement à reverser est la TVA collectée moins cette TVA déductible, selon votre régime de déclaration (mensuel, trimestriel ou simplifié agricole).';
  const answer=`TVA collectée ${p.label} : ${euro(debits)} sur les factures émises${rates?` (${rates})`:''} et ${euro(cash)} sur les encaissements reçus. ${rule}${main!==null?` Repère retenu : ${euro(main)}.`:''}${deductibleText} À confirmer avec votre comptable.${cashUnknown?` ${plural(cashUnknown,'paiement sans montant n’est pas compté','paiements sans montant ne sont pas comptés')}.`:''}`;
  return reply('billing_vat',answer,{metrics:{...p,debits,cash,main,onDebits,nature,deductible:vb.deductible,balance:main!==null&&vb.known.length?vb.balance:null,unknownPurchases:unknown}});
}
// Prévision d’encaissements : date probable = échéance décalée du retard moyen constaté chez le client.
function collections(state,c,today){
  const rows=expectedCollections(state,{today}).filter(r=>!c||sameClient(r.invoice,c)).sort((a,b)=>a.expectedDate.localeCompare(b.expectedDate));
  if(!rows.length)return reply('billing_collections',c?`Aucune facture de ${c.name} n’attend de paiement.`:'Aucune facture émise n’attend de paiement : rien à encaisser pour le moment.');
  const total=round2(rows.reduce((s,r)=>s+r.amount,0)),soon=addDays(today,30),late=rows.filter(r=>r.late),next=rows.filter(r=>!r.late&&r.expectedDate<=soon);
  const lateAmount=round2(late.reduce((s,r)=>s+r.amount,0)),nextAmount=round2(next.reduce((s,r)=>s+r.amount,0));
  const list=rows.slice(0,5).map(r=>`${c?docName(r.invoice):r.invoice.clientName||'Client'} ${euro(r.amount)} ${r.late?`attendus depuis le ${dateFr(r.expectedDate)}`:`vers le ${dateFr(r.expectedDate)}`}${r.shiftDays>0?` (échéance ${dateFr(r.dueDate)})`:''}`);
  const habits=[...new Map(rows.filter(r=>r.habit).map(r=>[r.habit.key,r.habit])).values()].slice(0,3).map(habitSentence);
  return reply('billing_collections',`${euro(total)} TTC à encaisser${c?` auprès de ${c.name}`:''} sur ${plural(rows.length,'échéance','échéances')}${lateAmount?`, dont ${euro(lateAmount)} déjà attendus`:''}${nextAmount?` ; ${euro(nextAmount)} probables dans les 30 jours`:''} : ${list.join(' ; ')}.${habits.length?` ${habits.join(' ')}`:''} Date probable = échéance décalée du retard moyen constaté chez le client (à partir de 2 factures payées), sinon l’échéance. Estimation, non garantie.`,{metrics:{total,late:lateAmount,next30:nextAmount,count:rows.length}});
}
function billingSummary(state,today){
  const aged=agedBalance(state,today),f=quotesToFollow(state,today),u=unbilledAlerts(state,today,{days:0}),r=remindersDue(state,today);
  const y=today.slice(0,4),rev=revenueByMonth(state,{from:`${y}-01-01`,to:today}),ht=round2(rev.reduce((s,x)=>s+x.invoicedHt,0));
  return reply('billing_summary',`Facturation : ${euro(ht)} HT facturés depuis le 1er janvier, ${euro(aged.total)} TTC à encaisser${aged.total>aged.totals.aEchoir+0.005?` dont ${euro(aged.total-aged.totals.aEchoir)} échus`:''}, ${plural(r.length,'relance due','relances dues')}, ${plural(f.toFollow.length,'devis à relancer','devis à relancer')} et ${plural(u.reduce((s,x)=>s+x.count,0),'prestation à facturer','prestations à facturer')}.`);
}

/**
 * Réponse locale à une question de facturation, ou null si la question n’en relève pas.
 * Même format que les autres réponses locales : {recognized:true, intent, answer, actions}.
 */
export function answerBillingQuestion(question,state,{today=isoDay()}={}){
  const raw=String(question||'').trim(),q=normalize(raw).replace(/['’]/g,' ');
  if(!q||!state)return null;
  // « CA » seulement écrit en capitales dans la question : « ça » normalisé donne aussi « ca ».
  const ca=/(^|[^A-Za-z\u00C0-\u017F])C\.?A\.?(?![A-Za-z\u00C0-\u017F])/.test(raw);
  // « doit » seul ne suffit pas (« qui doit faire le labour ») : il faut un pronom ou un mot d’argent.
  const owe=/\b(me|nous|m)\s+(doi(t|vent)|est dus?|reste)\b|\bdoi(t|vent)\b.*\b(argent|euros?|solde|factur\w*|encore payer|reste a payer)\b|\b(argent|euros?|solde)\b.*\bdoi(t|vent)\b/.test(q);
  const money=ca||owe||/\b(factur\w*|devis|impaye\w*|encaiss\w*|relanc\w*|tva|chiffre d affaires|creances?|reglement\w*|paiements?|dois[- ]?je|argent|paye|payer|payes?|tarif|prix|combien)\b/.test(q);
  if(!money)return null;
  const named=findClientInQuestion(q,state),c=named&&!named.ambiguous?named:null;
  const clientOwe=owe||/\bcombien\b(?:\s+\S+){0,3}?\s+doi(t|vent)\b(?![- ]on\b)(?!\s+(faire|passer|venir|etre|avoir))/.test(q);
  if(named?.ambiguous&&(clientOwe||/\b(derniere facture|solde)\b/.test(q)))return reply('billing_client_ambiguous',`Plusieurs clients correspondent : ${named.ambiguous.slice(0,4).map(x=>x.name).join(', ')}. Précisez le nom.`);
  if(/\btva\b/.test(q)&&/\b(reverser|payer|paye|due|dois|doit|collectee?s?|declarer|declaration|montant|combien|solde|deductible|credit)\b/.test(q))return vatCollected(state,q,today);
  if(/\bquand\b.*(\b(paye|payee?s?|payera|payeront|encaisse\w*|reglee?s?|reglera)\b|\b(me|nous|m)\s+(payer|regler)\b)|\bprevisions? d encaissements?\b|\bencaissements? (prevus?|attendus?|a venir|probables?)\b/.test(q))return collections(state,c,today);
  if(/\b(pas|non|jamais) (encore )?factur|\ba facturer\b|\boubli\w* de factur|\bsans facture\b/.test(q))return unbilled(state,today);
  if(/\bdevis\b/.test(q)&&/\b(attente|relancer|relance|en cours|sans reponse|ouverts?|envoyes?|expire\w*|signes?|combien|quels?)\b/.test(q))return pendingQuotes(state,today);
  if(/\bderni\w+ facture\b/.test(q))return lastInvoice(state,c,today);
  if(/\b(prix|tarif)\b/.test(q)||/\bcombien je (facture|fais payer|prends?|compte)\b/.test(q)){const term=priceTerm(raw);if(term){const r=practicedPrice(state,term,c);if(r)return r;}}
  if(c&&(clientOwe||/\b(reste a payer|solde|impaye\w*|en retard|du par|me reste)\b/.test(q)))return clientBalance(state,c,today);
  if((owe&&/\b(qui|quels? clients?)\b/.test(q))||/\bimpaye\w*\b|\bfactures? (en retard|non payees?|impayees?|a encaisser)\b|\bcreances?\b|\bretards? de paiement\b|\ba encaisser\b|\bme doi(t|vent)\b/.test(q))return whoOwes(state,today);
  if((ca||/\b(chiffre d affaires|facture|factures|encaisse|encaissements?)\b/.test(q))&&/\b(mois|annee|an|campagne|trimestre|combien|total|20\d\d|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(q)&&!/\bdevis\b/.test(q))return revenue(state,q,today);
  if(/\b(point|bilan|resume|etat)\b.*\bfacturation\b|\bfacturation\b.*\b(point|bilan|resume|etat|ou en)\b/.test(q))return billingSummary(state,today);
  return null;
}
