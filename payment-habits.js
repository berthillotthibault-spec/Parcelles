// Habitudes de paiement par client : délai moyen réellement constaté entre l’émission et le paiement,
// et retard moyen par rapport à l’échéance. Sert à prévoir quand une facture non payée sera vraiment
// encaissée (trésorerie, assistant de facturation). Logique pure, sans DOM ni réseau ; rien n’est écrit.
// Prudence : on ne décale une échéance que vers plus tard (jamais plus tôt), et seulement à partir de
// MIN_PAID factures payées pour ce client ; sinon l’échéance théorique est gardée.
import {normalize} from './utils.js';
import {invoices,docTypeOf,documentTotals,num,round2,isoDay} from './invoices-core.js';
import {addDays,daysBetween,expectedReceipts} from './invoices.js';

export const MIN_PAID=2;
const DAY=/^\d{4}-\d{2}-\d{2}/;
const day=v=>DAY.test(String(v||''))?String(v).slice(0,10):'';
export const clientKeyOf=d=>d?.clientId||`nom:${normalize(d?.clientName)}`;
const ttcOf=d=>num(d.totals?.ttc)??documentTotals(d).ttc;

/**
 * Habitudes de paiement de chaque client, d’après les factures et acomptes émis et soldés (paidAt).
 * Moyennes pondérées par le montant TTC. Retourne un tableau trié par nom :
 * {key, clientId, name, count, averageDays, averageLateDays, lateCount, reliable}.
 * averageLateDays : jours après l’échéance (négatif = paie en avance), null si aucune échéance connue.
 */
export function clientPaymentHabits(state,{from='',to='',min=MIN_PAID}={}){
  const map=new Map();
  for(const d of invoices(state)){
    if(d.status==='brouillon'||d.status==='annulee'||docTypeOf(d)==='avoir')continue;
    const issue=day(d.issueDate),paid=day(d.paidAt);if(!issue||!paid||paid<issue)continue;
    if((from&&paid<from)||(to&&paid>to))continue;
    const t=ttcOf(d);if(!(t>0))continue;
    const k=clientKeyOf(d);
    if(!map.has(k))map.set(k,{key:k,clientId:d.clientId||null,name:String(d.clientName||'').trim()||'Client',count:0,lateCount:0,_w:0,_days:0,_lw:0,_late:0});
    const r=map.get(k);r.count+=1;r._w+=t;r._days+=daysBetween(issue,paid)*t;
    const due=day(d.dueDate);if(due){const late=daysBetween(due,paid);r._lw+=t;r._late+=late*t;if(late>0)r.lateCount+=1;}
  }
  return[...map.values()].map(({_w,_days,_lw,_late,...r})=>
    ({...r,averageDays:Math.round(_days/_w),averageLateDays:_lw?Math.round(_late/_lw):null,reliable:r.count>=min}))
    .sort((a,b)=>a.name.localeCompare(b.name,'fr'));
}

/** Habitude du client de cette facture (index préparé par habitsIndex), ou null. */
export const habitsIndex=habits=>new Map((habits||[]).map(h=>[h.key,h]));

/** Date d’encaissement attendue : échéance décalée du retard moyen constaté (jamais avancée). */
export function expectedPaymentDate(date,habit){
  const d=day(date);if(!d)return d;
  if(!habit?.reliable||!(habit.averageLateDays>0))return d;
  return addDays(d,habit.averageLateDays);
}

/** Phrase courte : « SCEA Martin paie en moyenne à 52 jours, 22 jours après l’échéance (3 factures payées). » */
export function habitSentence(h){
  if(!h)return'';
  const days=h.averageLateDays;
  const late=days===null?'':days>0?`, ${days} jour${days>1?'s':''} après l’échéance`:', dans les délais';
  return`${h.name} paie en moyenne à ${h.averageDays} jour${h.averageDays>1?'s':''}${late} (${h.count} facture${h.count>1?'s':''} payée${h.count>1?'s':''}).`;
}

/**
 * Encaissements attendus des factures émises non soldées, avec la date probable selon les habitudes
 * du client : {invoice, amount, dueDate, expectedDate, shiftDays, habit, overdue, late}.
 * overdue : échéance théorique dépassée ; late : date probable elle aussi dépassée.
 */
export function expectedCollections(state,{today=isoDay(),habits=null}={}){
  const index=habitsIndex(habits||clientPaymentHabits(state));
  return expectedReceipts(state,today).map(r=>{
    const habit=index.get(clientKeyOf(r.invoice))||null,dueDate=day(r.date)||today,expectedDate=expectedPaymentDate(dueDate,habit);
    return{invoice:r.invoice,amount:round2(r.amount),dueDate,expectedDate,shiftDays:daysBetween(dueDate,expectedDate),
      habit:habit?.reliable?habit:null,overdue:!!r.late,late:expectedDate<today};
  });// Ordre des factures, comme expectedReceipts ; triez par expectedDate au besoin.
}
