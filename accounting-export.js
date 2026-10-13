// n° 96 — Export « Pour mon comptable » : CSV / XLSX ventilé par compte et par taux de TVA.
// Logique pure. C'est une aide à la saisie, pas une écriture comptable certifiée ni un FEC :
// aucun rapprochement par pièce, comptes indicatifs, taux de TVA jamais devinés (saisis par
// catégorie dans preferences.accountingPlan ; seules les factures émises portent leur propre TVA).
import {campaignFor,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {farmRecords} from './farm-records.js';
import {invoices,invoiceTotals} from './invoices.js';
import {campaignSales} from './sales.js';
import {fuelEntries} from './fuel.js';
import {valuationAt,INVENTORY_HEADERS,inventoryTable} from './stock-lots.js';
import {cultureForCampaign} from './pilotage.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>{const r=Math.round((Math.abs(v)+Number.EPSILON)*100)/100;return v<0?-r:r;};
const day=v=>String(v||'').slice(0,10);
const inPeriod=(d,from,to)=>Boolean(d)&&(!from||d>=from)&&(!to||d<=to);

export const DISCLAIMER='Aide pour votre comptable, pas une comptabilité légale : ni FEC, ni écriture certifiée, ni rapprochement par pièce. Comptes indicatifs à faire valider ; montants tels que saisis dans Parcelles.';
export const VAT_CHOICES=Object.freeze([20,10,5.5,2.1,0]);

// Plan de catégories par défaut (comptes du plan comptable agricole usuel, indicatifs).
export const ACCOUNT_CATEGORIES=Object.freeze([
  {key:'semences',label:'Semences et plants',account:'6011',side:'achat'},
  {key:'engrais',label:'Engrais et amendements',account:'6012',side:'achat'},
  {key:'phyto',label:'Produits de défense des cultures',account:'6013',side:'achat'},
  {key:'aliments',label:'Aliments du bétail',account:'6014',side:'achat'},
  {key:'animaux-achats',label:'Achats d’animaux',account:'6040',side:'achat'},
  {key:'autres-appro',label:'Autres approvisionnements',account:'6018',side:'achat'},
  {key:'carburant',label:'Carburants et lubrifiants',account:'6061',side:'achat'},
  {key:'fournitures',label:'Petit équipement et fournitures',account:'6063',side:'achat'},
  {key:'entretien',label:'Entretien et réparation du matériel',account:'6155',side:'achat'},
  {key:'ventes-vegetales',label:'Ventes de produits végétaux',account:'7010',side:'vente'},
  {key:'ventes-animaux',label:'Ventes d’animaux',account:'7020',side:'vente'},
  {key:'prestations',label:'Prestations de services (travaux à façon)',account:'7060',side:'vente'}
]);
export const categoryOf=key=>ACCOUNT_CATEGORIES.find(c=>c.key===key);

/** Plan de l'exploitation : compte et taux de TVA par catégorie ; taux absent = null. */
export function accountingPlan(state){
  const own=state?.preferences?.accountingPlan||{},out={};
  for(const c of ACCOUNT_CATEGORIES){const o=own[c.key]||{},rate=num(o.vatRate);out[c.key]={...c,account:String(o.account||c.account),vatRate:rate!==null&&VAT_CHOICES.includes(rate)?rate:null};}
  return out;
}
export function validatePlan(values){
  const out={};
  for(const c of ACCOUNT_CATEGORIES){
    const account=String(values?.[`account_${c.key}`]??c.account).trim(),rawRate=String(values?.[`vat_${c.key}`]??'').trim(),rate=num(rawRate);
    if(!/^\d{3,10}$/.test(account))return{error:`Compte invalide pour « ${c.label} » (3 à 10 chiffres).`};
    if(rawRate!==''&&(rate===null||!VAT_CHOICES.includes(rate)))return{error:`Taux de TVA invalide pour « ${c.label} ».`};
    out[c.key]={account,vatRate:rawRate===''?null:rate};
  }
  return{value:out};
}

/** Catégorie d'un article de stock d'après sa catégorie Parcelles, puis son nom. */
export function stockCategory(item){
  const c=normalize(item?.category),n=normalize(item?.name);
  if(c==='semence'||c==='semences')return'semences';if(c==='engrais')return'engrais';if(c==='aliment'||c==='aliments')return'aliments';
  if(c==='carburant')return'carburant';if(c==='fourniture'||c==='fournitures')return'fournitures';
  if(c==='produit'||/phyto|herbicide|fongicide|insecticide/.test(n))return'phyto';
  if(/semence|semis/.test(n))return'semences';if(/engrais|ammonitrate|uree|azote|chaux|amendement/.test(n))return'engrais';
  return'autres-appro';
}

const line=(plan,{date,piece='',label,category,parcel=null,culture='',ht,vatRate=undefined,tva=undefined,source})=>{
  const cat=plan[category],rate=vatRate!==undefined?vatRate:cat.vatRate,known=rate!==null&&rate!==undefined;
  const tax=tva!==undefined?tva:known?r2(ht*rate/100):null;
  return{date,piece,label,category,categoryLabel:cat.label,account:cat.account,side:cat.side,parcel:parcel?.nom||'',culture,ht:r2(ht),vatRate:known?rate:null,tva:tax,ttc:tax===null?null:r2(ht+tax),source};
};

export function accountingRows(state,{from='',to=''}={}){
  const plan=accountingPlan(state),rows=[],warnings=[],parcels=new Map(active(state,'parcelles').map(p=>[p.id,p])),works=new Map(active(state,'interventions').map(w=>[w.id,w]));
  const cultureOf=(p,date)=>p?cultureForCampaign(state,p,campaignFor(date)):'';
  // Factures et avoirs émis : TVA du document, une ligne par taux.
  for(const inv of invoices(state).filter(i=>i.status!=='brouillon'&&inPeriod(day(i.issueDate),from,to))){
    const t=inv.totals||invoiceTotals(inv.lines);
    for(const r of t.byRate)rows.push(line(plan,{date:day(inv.issueDate),piece:inv.number||'',label:`${inv.docType==='avoir'?'Avoir':'Facture'} ${inv.clientName||''}`.trim(),category:'prestations',ht:r.base,vatRate:r.rate,tva:r.tax,source:'Facture émise'}));
  }
  // Ventes de récolte (lots), aux campagnes couvertes par la période.
  const campaigns=new Set(farmRecords(state,'harvest').map(l=>l.date&&campaignFor(l.date)).filter(Boolean));
  for(const c of campaigns)for(const s of campaignSales(state,c)){
    const date=day(s.sale.date||s.lot.date);if(!inPeriod(date,from,to))continue;
    if(s.price===null){warnings.push(`Vente ${s.culture} du ${date} sans prix : non exportée.`);continue;}
    rows.push(line(plan,{date,piece:s.sale.code||'',label:`Vente ${s.culture}${s.sale.buyer?` · ${s.sale.buyer}`:''} (${r2(s.tonnes)} t)`,category:'ventes-vegetales',parcel:parcels.get(s.lot.parcelId),culture:s.culture,ht:s.tonnes*s.price,source:s.priceSource==='contract'?'Vente (prix du contrat)':'Vente de récolte'}));
  }
  // Ventes et achats d'animaux (atelier bovin).
  for(const [kind,cat,word] of [['animalSale','ventes-animaux','Vente'],['animalPurchase','animaux-achats','Achat']])
    for(const r of farmRecords(state,kind).filter(r=>inPeriod(day(r.date),from,to)&&num(r.amount)!==null))
      rows.push(line(plan,{date:day(r.date),label:`${word} d’animaux${r.count?` (${r.count})`:''}${r.party?` · ${r.party}`:''}`,category:cat,ht:num(r.amount),source:'Atelier bovin'}));
  // Achats d'intrants : entrées de stock valorisées.
  const fuel=fuelEntries(state).filter(r=>(r.entry==='tank'||r.fromTank===false)&&inPeriod(day(r.date),from,to));
  const items=new Map(active(state,'stockItems').map(i=>[i.id,i]));let skippedFuel=0,unpriced=0;
  for(const m of active(state,'stockMovements').filter(m=>m.type==='Entrée'&&inPeriod(day(m.date),from,to))){
    const item=items.get(m.stockItemId);if(!item)continue;const cat=stockCategory(item),q=num(m.quantity),p=num(m.unitPrice);
    if(cat==='carburant'&&fuel.length){skippedFuel+=1;continue;}
    if(q===null||p===null){unpriced+=1;continue;}
    const w=works.get(m.workId),parcel=w?parcels.get(w.parcelId):null;
    rows.push(line(plan,{date:day(m.date),piece:m.invoiceRef||m.reference||'',label:`${item.name||'Article'} : ${q} ${item.unit||''}${m.supplier?` · ${m.supplier}`:''}`.trim(),category:cat,parcel,culture:parcel?cultureOf(parcel,m.date):'',ht:q*p,source:'Entrée de stock'}));
  }
  if(unpriced)warnings.push(`${unpriced} entrée(s) de stock sans prix : non exportée(s).`);
  if(skippedFuel)warnings.push(`${skippedFuel} entrée(s) de stock « Carburant » ignorée(s) : le carburant vient des pleins GNR, pour ne pas le compter deux fois.`);
  // Carburant : livraisons en cuve et pleins hors cuve (n° 95).
  for(const r of fuel){const amount=num(r.amount);if(amount===null){warnings.push(`Plein du ${day(r.date)} sans montant : non exporté.`);continue;}
    rows.push(line(plan,{date:day(r.date),piece:r.invoiceRef||'',label:`GNR ${r.litres} L${r.supplier?` · ${r.supplier}`:''}`,category:'carburant',ht:amount,source:r.entry==='tank'?'Plein de cuve':'Plein hors cuve'}));}
  // Entretiens du matériel.
  const machines=new Map(active(state,'materiels').map(m=>[m.id,m]));
  for(const r of active(state,'maintenanceRecords').filter(r=>inPeriod(day(r.date),from,to)&&num(r.cost)!==null&&num(r.cost)>0))
    rows.push(line(plan,{date:day(r.date),label:`${r.type||'Entretien'} · ${machines.get(r.equipmentId)?.nom||'Matériel'}`,category:'entretien',ht:num(r.cost),source:'Entretien'}));
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.account.localeCompare(b.account));
  if(rows.some(r=>r.vatRate===null))warnings.push('Taux de TVA non renseigné pour certaines catégories : TVA et TTC laissés vides. Saisissez-les dans le plan de catégories.');
  return{from,to,rows,warnings,plan};
}

/** Totaux par compte et par taux de TVA. */
export function accountSummary(rows){
  const map=new Map();
  for(const r of rows){const k=`${r.account}|${r.vatRate??''}`,g=map.get(k)||{account:r.account,label:r.categoryLabel,side:r.side,vatRate:r.vatRate,ht:0,tva:0,count:0,tvaUnknown:false};
    g.ht=r2(g.ht+r.ht);if(r.tva===null)g.tvaUnknown=true;else g.tva=r2(g.tva+r.tva);g.count+=1;map.set(k,g);}
  return[...map.values()].sort((a,b)=>a.account.localeCompare(b.account)||(b.vatRate??-1)-(a.vatRate??-1));
}

export const OPERATION_HEADERS=['Date','Pièce','Libellé','Compte','Catégorie','Sens','Parcelle','Culture','Montant HT','Taux TVA','TVA','TTC','Origine'];
export const operationTable=rows=>rows.map(r=>[r.date,r.piece,r.label,r.account,r.categoryLabel,r.side==='vente'?'Produit':'Charge',r.parcel,r.culture,r.ht,r.vatRate??'',r.tva??'',r.ttc??'',r.source]);
const cell=x=>{const s=typeof x==='number'?String(x).replace('.',','):String(x??'');return/[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
export const toCsv=(head,table)=>'﻿'+[head,...table].map(r=>r.map(cell).join(';')).join('\r\n');
export function operationsCsv(result){return toCsv(OPERATION_HEADERS,operationTable(result.rows));}
export function stocksCsv(state,date){return toCsv(INVENTORY_HEADERS,inventoryTable(valuationAt(state,date)));}

/** Feuilles du classeur : Opérations, Ventes, Synthèse, Stocks à la date de clôture. */
export function workbookSheets(state,result){
  const sales=result.rows.filter(r=>r.side==='vente'),v=valuationAt(state,result.to||new Date().toISOString().slice(0,10)),sum=accountSummary(result.rows);
  const note=[`${DISCLAIMER}`],period=`Période du ${result.from||'début'} au ${result.to||'ce jour'}`;
  return[
    {name:'Opérations',rows:[[period],note,OPERATION_HEADERS,...operationTable(result.rows)]},
    {name:'Ventes',rows:[[period],OPERATION_HEADERS,...operationTable(sales)]},
    {name:'Synthèse',rows:[[period],['Compte','Catégorie','Sens','Taux TVA','Montant HT','TVA','Lignes'],...sum.map(g=>[g.account,g.label,g.side==='vente'?'Produit':'Charge',g.vatRate??'',g.ht,g.tvaUnknown?'':g.tva,g.count]),[],...result.warnings.map(w=>[w])]},
    {name:`Stocks au ${v.date}`.slice(0,31),rows:[[`Stocks valorisés au prix moyen pondéré au ${v.date}`],INVENTORY_HEADERS,...inventoryTable(v),['Total','','','','',v.total]]}
  ];
}
