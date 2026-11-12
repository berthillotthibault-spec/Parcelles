// Solde de TVA d’une période : TVA collectée (factures émises, d’après les débits ou les encaissements)
// moins la TVA déductible connue (factures d’achat lues par le lecteur de documents, ou montant de TVA
// saisi sur un achat). Logique pure, sans DOM ni réseau ; rien n’est écrit.
// Prudence : seule la TVA d’achat dont le montant est réellement connu est déduite ; les achats sans TVA
// connue sont listés à part, le solde est donc un repère, pas une déclaration. À confirmer avec le comptable.
import {normalize} from './utils.js';
import {active} from './farm-memory.js';
import {farmRecords} from './farm-records.js';
import {fuelEntries,isLegacyFill} from './fuel.js';
import {ACCOUNTING_TYPES,docTypeOf,documentTotals,invoiceBalance,invoiceSettings,invoices,paymentsOf,round2} from './invoices.js';

const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const DAY=/^\d{4}-\d{2}-\d{2}/;
const day=v=>DAY.test(String(v||''))?String(v).slice(0,10):'';
const inRange=(d,from,to)=>!!d&&(!from||d>=from)&&(!to||d<=to);
const totalsOf=d=>d.totals&&num(d.totals.ttc)!==null&&num(d.totals.tva)!==null?d.totals:documentTotals(d);
const emitted=state=>invoices(state).filter(i=>i.status!=='brouillon'&&ACCOUNTING_TYPES.has(docTypeOf(i)));

export const VAT_BASES=['debits','encaissements'];

/** Base retenue par défaut selon les paramètres : livraisons de biens ou option débits → débits ; prestations → encaissements ; mixte → null. */
export function defaultVatBasis(settings){
  const nature=settings?.operationNature;
  if(nature==='biens'||settings?.vatOnDebits)return'debits';
  return nature==='mixte'?null:'encaissements';
}

/** TVA collectée sur la période : sur les factures émises (débits) et sur les encaissements reçus. */
export function collectedVat(state,{from='',to=''}={}){
  let debits=0,cash=0,cashUnknown=0;const byRate=new Map();
  for(const d of emitted(state)){
    const t=totalsOf(d);
    if(inRange(day(d.issueDate),from,to)){
      debits=round2(debits+t.tva);
      for(const r of t.byRate||[])if(r.tax)byRate.set(r.rate,round2((byRate.get(r.rate)||0)+r.tax));
    }
    // Avoirs : comptés en débits (montants négatifs) ; côté encaissements, ils réduisent déjà le solde de la facture.
    if(d.docType==='avoir'||!(Math.abs(t.ttc)>0))continue;
    const b=invoiceBalance(state,d),ratio=t.tva/t.ttc;
    const pays=b.legacy?[{date:d.paidAt,amount:Math.max(0,b.net)}]:paymentsOf(d);
    for(const pay of pays){
      if(!inRange(day(pay.date),from,to))continue;
      if(num(pay.amount)===null)cashUnknown+=1;else cash=round2(cash+pay.amount*ratio);
    }
  }
  return{debits,cash,cashUnknown,byRate:[...byRate.entries()].sort((a,b)=>b[0]-a[0]).map(([rate,tax])=>({rate,tax}))};
}

// Montant de TVA d’une facture d’achat lue : somme des montants par taux, sinon TTC − HT.
export function purchaseVatAmount(extract){
  if(!extract)return null;
  const parts=(Array.isArray(extract.tva)?extract.tva:[]).map(t=>num(t?.montant)).filter(v=>v!==null);
  if(parts.length)return round2(parts.reduce((s,v)=>s+v,0));
  const ht=num(extract.totalHT),ttc=num(extract.totalTTC);
  return ht!==null&&ttc!==null&&ttc>=ht?round2(ttc-ht):null;
}
const invoiceKey=(supplier,numero,date)=>`${normalize(supplier)}|${normalize(numero)}|${date}`;

/**
 * Factures d’achat dont la TVA est connue : conservée sur l’entrée de stock (purchaseVat, n° de lecture
 * partagé purchaseKey) ou sur le document rangé (docExtract d’une facture). Une même facture n’est comptée
 * qu’une fois : même purchaseKey, ou même fournisseur + numéro + date quand le numéro est connu (deux lectures
 * de la même facture ont deux purchaseKey différents). `keys` liste les purchaseKey regroupés sous l’entrée.
 */
export function supplierInvoices(state){
  const out=new Map(),byNumber=new Map();
  const add=(key,{date,supplier,numero,extract,origin})=>{
    if(out.has(key))return;
    const ref=String(numero||'').trim()?invoiceKey(supplier,numero,date):'',same=ref&&byNumber.get(ref);
    if(same){if(!same.keys.includes(key))same.keys.push(key);return;}
    const amount=purchaseVatAmount(extract);if(amount===null)return;
    const entry={key,keys:[key],date,supplier:String(supplier||'').trim(),numero:String(numero||'').trim(),vat:amount,
      totalHT:num(extract.totalHT),totalTTC:num(extract.totalTTC),origin};
    out.set(key,entry);if(ref)byNumber.set(ref,entry);
  };
  for(const m of active(state,'stockMovements')){
    const p=m.purchaseVat;if(!p||m.type!=='Entrée')continue;
    const date=day(p.date)||day(m.date);
    add(m.purchaseKey||invoiceKey(p.supplier||m.supplier,p.numero,date),{date,supplier:p.supplier||m.supplier,numero:p.numero,extract:p,origin:'stock'});
  }
  for(const d of active(state,'documents')){
    const x=d.docExtract;if(!x||x.kind!=='facture')continue;
    const date=day(x.date)||day(d.documentDate);
    add(d.purchaseKey||invoiceKey(d.supplier,x.numero,date),{date,supplier:d.supplier,numero:x.numero,extract:x,origin:'document'});
  }
  return[...out.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

/**
 * Achats de la période et TVA déductible : {known:[...], unknown:[...]}. Un achat porte une TVA connue
 * s’il a un champ vatAmount saisi (optionnel) ou s’il est rattaché (purchaseKey) à une facture lue
 * dont la TVA est connue. Les autres achats chiffrés sont listés dans unknown.
 */
export function purchasesVat(state,{from='',to=''}={}){
  const invoicesRead=supplierInvoices(state),covered=new Set(invoicesRead.flatMap(i=>i.keys));
  const label=i=>`Facture ${i.supplier||'fournisseur'}${i.numero?` n° ${i.numero}`:''}`;
  const known=invoicesRead.filter(i=>inRange(i.date,from,to)).map(i=>({date:i.date,label:label(i),vat:i.vat,source:'facture lue'}));
  const unknown=[];
  const take=(date,label,amount,vat,source)=>{
    if(!inRange(date,from,to))return;
    if(num(vat)!==null)known.push({date,label,vat:round2(vat),source});
    else if(amount!==null&&amount>0)unknown.push({date,label,amount:round2(amount),source});
  };
  const items=new Map(active(state,'stockItems').map(i=>[i.id,i]));
  for(const m of active(state,'stockMovements')){
    if(m.type!=='Entrée'||(m.purchaseKey&&covered.has(m.purchaseKey)))continue;
    const q=num(m.quantity),p=num(m.unitPrice),item=items.get(m.stockItemId);
    take(day(m.date),`${item?.name||'Article'}${m.supplier?` · ${m.supplier}`:''}`,q!==null&&p!==null?q*p:null,m.vatAmount,'stock');
  }
  for(const r of fuelEntries(state)){
    if(r.entry!=='tank'&&r.fromTank!==false)continue;
    const label=`GNR ${num(r.litres)??''} L${r.supplier?` · ${r.supplier}`:''}`.replace('  ',' ');
    take(day(r.date),label,num(r.amount),r.vatAmount,'carburant');
  }
  for(const r of active(state,'maintenanceRecords')){if(isLegacyFill(r))continue;take(day(r.date),r.type||'Entretien',num(r.cost),r.vatAmount,'entretien');}
  for(const r of farmRecords(state,'animalPurchase'))take(day(r.date),`Achat d’animaux${r.party?` · ${r.party}`:''}`,num(r.amount),r.vatAmount,'animaux');
  known.sort((a,b)=>a.date.localeCompare(b.date));unknown.sort((a,b)=>a.date.localeCompare(b.date));
  return{known,unknown};
}

/**
 * Solde de TVA de la période [from, to] : collectée − déductible connue.
 * basis : 'debits' | 'encaissements' ; absent, déduit des paramètres de facturation (null pour une activité mixte).
 * balance > 0 : TVA à payer ; balance < 0 : crédit de TVA. balance null si la base n’est pas déterminée.
 * Hors régime réel (franchise, remboursement forfaitaire) : aucune TVA déductible, applicable false, balance null.
 */
export function vatBalance(state,{from='',to='',basis}={}){
  const settings=invoiceSettings(state),regime=settings.vatRegime;
  const base=VAT_BASES.includes(basis)?basis:defaultVatBasis(settings);
  const collected=collectedVat(state,{from,to});
  const main=base==='debits'?collected.debits:base==='encaissements'?collected.cash:null;
  const applicable=regime==='normal';
  const {known,unknown}=applicable?purchasesVat(state,{from,to}):{known:[],unknown:[]};
  const deductible=round2(known.reduce((s,k)=>s+k.vat,0));
  const balance=main===null||!applicable?null:round2(main-deductible);
  const unknownAmount=round2(unknown.reduce((s,u)=>s+u.amount,0));
  const balances=applicable?{debits:round2(collected.debits-deductible),encaissements:round2(collected.cash-deductible)}:{debits:null,encaissements:null};
  return{from,to,regime,applicable,basis:base,collected:{...collected,main},deductible,known,unknown,unknownAmount,balance,
    toPay:balance!==null&&balance>0?balance:0,credit:balance!==null&&balance<0?-balance:0,balances};
}

/** Une phrase sur le rythme de déclaration, sans date d’échéance (elle dépend du régime et du calendrier fiscal). */
export const FILING_NOTE='Rythme de déclaration selon votre régime : réel normal, déclaration en principe mensuelle (trimestrielle sous conditions) ; '
  +'régime simplifié agricole, déclaration annuelle avec acomptes en cours d’année ; remboursement forfaitaire, pas de TVA à reverser '
  +'sur les ventes concernées. Les dates exactes sont à vérifier sur impots.gouv.fr ou avec votre comptable.';
