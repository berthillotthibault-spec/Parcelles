// Facturation : noyau chargé au démarrage (accueil, carte de campagne). Logique pure, sans DOM.
// Seulement ce que le premier rendu utilise : soldes et statuts des documents (factures en retard,
// encours), prestations à facturer, montants d’une ligne et d’un document, et leurs aides. Le reste du
// moteur (paramètres complets, numérotation, émission, paiements, avoirs, impression) est dans
// invoices.js, chargé à la demande, qui réexporte ce noyau : les appelants différés et les tests
// importent toujours invoices.js. Ce module n’importe ni invoices.js ni aucun module billing-*.js.
import {active,completed} from './farm-memory.js';
import {farmRecords} from './farm-records.js';

export const INVOICE_KIND='invoice';
export const QUOTE_KIND='quote';
// Types de documents : seuls facture, acompte et avoir ont une valeur comptable.
export const DOC_TYPES=['devis','proforma','acompte','facture','avoir'];
export const docTypeOf=doc=>DOC_TYPES.includes(doc?.docType)?doc.docType:'facture';
// Taux usuels (métropole et DOM) ; d’autres taux se saisissent comme taux personnalisés.
export const VAT_RATES_ALL=[20,10,8.5,5.5,2.1,0];
export const LINE_KINDS=['item','section','subtotal','comment','deduction'];
const AMOUNT_KINDS=new Set(['item','deduction']);

export const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export const loose=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const positive=v=>{const n=loose(v);return n!==null&&n>0?n:null;};
export const text=v=>String(v??'').trim();
// Arrondi au centime symétrique : un avoir (montants négatifs) donne exactement l’opposé de la facture.
export const round2=v=>{const r=Math.round((Math.abs(v)+Number.EPSILON)*100)/100;return v<0?-r:r;};
export const round3=v=>Math.round((v+Number.EPSILON)*1000)/1000;
export const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
export const validDay=v=>DATE_RE.test(String(v||''))&&!Number.isNaN(new Date(`${v}T12:00:00`).getTime())&&isoDay(new Date(`${v}T12:00:00`))===v;
// Dates civiles en heure locale (jamais toISOString, qui décale d’un jour selon le fuseau).
export const isoDay=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export const invoices=state=>farmRecords(state,INVOICE_KIND);
export const quotes=state=>farmRecords(state,QUOTE_KIND);

// ---------- Paramètres ----------
export const customRatesOf=raw=>(Array.isArray(raw)?raw:[]).map(loose).filter(r=>r!==null&&r>=0&&r<=100).map(round3).filter((r,i,a)=>a.indexOf(r)===i).slice(0,6);
// Taux de TVA par défaut des réglages : même règle qu’invoiceSettings (invoices.js), qui l’utilise.
export function settingsVatRate(state){const s=state?.exploitation?.invoicing||{},rate=Number(s.vatRate);return VAT_RATES_ALL.includes(rate)||customRatesOf(s.customVatRates).includes(rate)?rate:20;}

// ---------- Montants ----------
export const lineKind=l=>LINE_KINDS.includes(l?.kind)?l.kind:'item';
export const amountLine=l=>AMOUNT_KINDS.has(lineKind(l));
export function lineTotal(line){
  if(!amountLine(line))return null;
  const q=loose(line?.quantity),p=loose(line?.unitPrice);if(q===null||p===null)return null;
  const d=loose(line?.discountPct);return round2(d?q*p*(1-d/100):q*p);
}
// Totaux complets d’un document : remise globale (% ou montant, répartie au prorata des taux), frais de
// port ou de déplacement, déduction des acomptes (facture de solde), ventilation par taux et par motif
// d’exonération. Pour un document sans remise ni frais, byRate est identique à invoiceTotals(lines).
export function documentTotals(doc={}){
  const groups=new Map();let missing=0,linesHt=0,deducted=0;
  const group=(rate,exemption)=>{const k=`${rate}|${exemption||''}`;if(!groups.has(k))groups.set(k,{rate,exemption:exemption||'',items:0,disc:0,ship:0,ded:0,dedTax:null});return groups.get(k);};
  for(const l of doc.lines||[]){
    if(!amountLine(l))continue;const t=lineTotal(l);if(t===null){missing+=1;continue;}
    const rate=loose(l.vatRate)??0,g=group(rate,rate===0?l.vatExemption||doc.vatExemption:'');
    // Acompte déduit : sa TVA est celle de la facture d’acompte (vatAmount, billing.js), tant qu’elle
    // correspond à la ligne à un centime près (une ligne retouchée reprend la TVA calculée).
    if(lineKind(l)==='deduction'){g.ded=round2(g.ded+t);deducted=round2(deducted+t);const fixed=loose(l.vatAmount),calc=round2(t*rate/100),ok=fixed!==null&&Math.abs(fixed-calc)<=0.011;g.dedTax=round2((g.dedTax??0)+(ok?fixed:calc));g.fixed=g.fixed||ok;}else{g.items=round2(g.items+t);linesHt=round2(linesHt+t);}
  }
  const d=doc.discount,dv=loose(d?.value);let discount=0;
  if(dv!==null&&dv>0){
    // Un avoir (lignes négatives) reçoit la remise de même signe : l’avoir total reste l’opposé exact de la facture.
    const list=[...groups.values()].filter(g=>g.items!==0).sort((a,b)=>Math.abs(b.items)-Math.abs(a.items)),base=round2(list.reduce((s,g)=>s+g.items,0));
    if(d.type==='pct'){for(const g of list)g.disc=round2(g.items*Math.min(100,dv)/100);}
    else if(base!==0){const amount=Math.sign(base)*Math.min(round2(dv),Math.abs(base));let left=amount;list.forEach((g,i)=>{g.disc=i===list.length-1?round2(left):round2(amount*g.items/base);left=round2(left-g.disc);});}
    discount=round2(list.reduce((s,g)=>s+g.disc,0));
  }
  const sh=loose(doc.shipping?.amount);let shipping=0;
  if(sh!==null&&sh!==0){const rate=loose(doc.shipping.vatRate)??0,g=group(rate,rate===0?doc.shipping.vatExemption||doc.vatExemption:'');g.ship=round2(sh);shipping=round2(sh);}
  // Facture de solde : TVA du taux = TVA des lignes (comme sur le devis) − TVA des acomptes déduits, si l’écart
  // avec base × taux reste d’un centime (règle BR-S-09 d’EN 16931) ; sinon base × taux.
  const taxOf=(g,base,grossBase)=>{const calc=round2(base*g.rate/100);if(!g.fixed)return calc;const split=round2(round2(grossBase*g.rate/100)+g.dedTax);return Math.abs(split-calc)<=0.011?split:calc;};
  const parTaux=[...groups.values()].map(g=>{const base=round2(g.items-g.disc+g.ship+g.ded),grossBase=round2(g.items-g.disc+g.ship);return{rate:g.rate,exemption:g.exemption,base,tax:taxOf(g,base,grossBase),lines:round2(g.items+g.ded),discount:g.disc,charge:g.ship,grossBase,grossTax:round2(grossBase*g.rate/100)};})
    .sort((a,b)=>b.rate-a.rate||a.exemption.localeCompare(b.exemption));
  const merged=new Map();for(const p of parTaux){const m=merged.get(p.rate)||{rate:p.rate,base:0};m.base=round2(m.base+p.base);merged.set(p.rate,m);}
  const byRate=[...merged.values()].sort((a,b)=>b.rate-a.rate).map(r=>({rate:r.rate,base:r.base,tax:round2(parTaux.filter(p=>p.rate===r.rate).reduce((s,p)=>s+p.tax,0))}));
  const ht=round2(parTaux.reduce((s,p)=>s+p.base,0)),tva=round2(parTaux.reduce((s,p)=>s+p.tax,0)),ttc=round2(ht+tva);
  const gross={ht:round2(parTaux.reduce((s,p)=>s+p.grossBase,0)),tva:round2(parTaux.reduce((s,p)=>s+p.grossTax,0))};gross.ttc=round2(gross.ht+gross.tva);
  return{ht,tva,ttc,byRate,parTaux:parTaux.map(({grossBase:_g,grossTax:_t,...p})=>p),missing,linesHt,discount,shipping,deductions:{ht:round2(-deducted),ttc:round2(gross.ttc-ttc)},gross};
}

// ---------- Statuts, soldes, échéances ----------
export function quoteStatus(q,today=isoDay()){
  if(q.status==='brouillon')return'brouillon';
  if(['accepte','refuse','converti'].includes(q.status))return q.status;
  return docTypeOf(q)==='devis'&&q.validUntil&&q.validUntil<today?'expire':'envoye';
}
export function creditNotesOf(state,inv){return invoices(state).filter(a=>a.docType==='avoir'&&a.creditOf===inv.id&&a.status!=='brouillon');}
export function creditedShare(state,inv){const ttc=num(inv.totals?.ttc);if(!ttc)return 0;const credited=creditNotesOf(state,inv).reduce((s,a)=>s+Math.abs(num(a.totals?.ttc)||0),0);return credited/Math.abs(ttc);}
// Paiements enregistrés ; une facture ancienne « payée le » sans détail compte comme réglée en entier.
export function paymentsOf(inv){
  const list=(Array.isArray(inv?.payments)?inv.payments:[]).filter(p=>p&&num(p.amount)!==null);
  if(list.length)return list;
  return inv?.paidAt?[{id:'legacy',date:inv.paidAt,amount:null,method:inv.paymentMethod||'',legacy:true}]:[];
}
export function invoiceBalance(state,inv){
  const total=num(inv?.totals?.ttc)??documentTotals(inv||{}).ttc,credited=state?round2(creditNotesOf(state,inv).reduce((s,a)=>s+Math.abs(num(a.totals?.ttc)||0),0)):0;
  const net=round2(total-credited),payments=paymentsOf(inv),legacy=payments.some(p=>p.legacy);
  const paid=legacy?Math.max(0,net):round2(payments.reduce((s,p)=>s+p.amount,0));
  const dates=payments.map(p=>p.date).filter(Boolean).sort();
  return{total,credited,net,paid,due:round2(Math.max(0,net-paid)),overpaid:round2(Math.max(0,paid-Math.max(0,net))),payments,lastPayment:dates[dates.length-1]||null,legacy};
}
export const installmentsOf=inv=>(Array.isArray(inv?.installments)?inv.installments:[]).filter(i=>i&&validDay(i.date)&&num(i.amount)!==null).sort((a,b)=>a.date.localeCompare(b.date));
function lateNow(inv,b,today){
  if(b.due<=0.005)return false;const plan=installmentsOf(inv);
  if(plan.length){const dueSoFar=round2(plan.filter(i=>i.date<today).reduce((s,i)=>s+i.amount,0));return dueSoFar-(b.paid+b.credited)>0.005;}
  return!!inv.dueDate&&inv.dueDate<today;
}
export function invoiceStatus(inv,state=null,today=isoDay()){
  const t=docTypeOf(inv);
  if(t==='devis'||t==='proforma')return quoteStatus(inv,today);
  if(t==='avoir')return inv.status==='brouillon'?'brouillon':'avoir';
  if(inv.status==='brouillon')return'brouillon';
  if(state&&creditedShare(state,inv)>=0.999)return'annulee';
  const b=invoiceBalance(state,inv);
  if(b.legacy||(b.paid>0&&b.due<=0.005))return'payee';
  if(lateNow(inv,b,today))return'retard';
  return b.paid>0?'partielle':'emise';
}
export const docStatus=invoiceStatus;
export function overdueInvoices(state,today=isoDay()){return invoices(state).filter(i=>invoiceStatus(i,state,today)==='retard').sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));}

// ---------- Prestations à facturer ----------
// Clés des sources déjà reprises dans une facture ou un brouillon (hors factures annulées par avoir).
export function billedKeys(state,{exceptId=null}={}){
  const keys=new Set();
  for(const inv of invoices(state)){if(inv.id===exceptId||inv.docType==='avoir'||invoiceStatus(inv,state)==='annulee')continue;for(const l of inv.lines||[])if(l.source?.type&&l.source?.id)keys.add(`${l.source.type}:${l.source.id}`);}
  return keys;
}
export const inPeriod=(day,from,to)=>!!day&&(!from||day>=from)&&(!to||day<=to);
export const fr=v=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:2});

export function workLine(work,parcel,client,vatRate){
  const area=positive(work.surfaceWorked)??positive(parcel?.surfaceHa),hours=positive(work.duration??work.durationHours),ha=positive(client?.hectareRate),hr=positive(client?.hourlyRate);
  const base={label:`${text(work.type)||'Prestation'}${parcel?.nom?` · ${text(parcel.nom)}`:''}`,date:work.date||'',vatRate,source:{type:'work',id:work.id}};
  if(ha!==null&&area!==null)return{...base,quantity:round2(area),unit:'ha',unitPrice:ha,basis:'Tarif hectare du client'};
  if(hr!==null&&hours!==null)return{...base,quantity:round2(hours),unit:'h',unitPrice:hr,basis:'Tarif horaire du client'};
  if(hours!==null)return{...base,quantity:round2(hours),unit:'h',unitPrice:null,basis:'Tarif horaire à saisir'};
  if(area!==null)return{...base,quantity:round2(area),unit:'ha',unitPrice:null,basis:'Tarif hectare à saisir'};
  return{...base,quantity:1,unit:'forfait',unitPrice:null,basis:'Forfait à saisir'};
}
export function fuelLine(work,parcel,vatRate,fuelPrice=null){
  const liters=positive(work.fuel);if(liters===null)return null;const cost=positive(work.fuelCost),price=cost!==null?round2(cost/liters*1000)/1000:positive(fuelPrice);
  return{label:`Gazole refacturé · ${text(work.type)||'Prestation'}${parcel?.nom?` · ${text(parcel.nom)}`:''}`,date:work.date||'',quantity:round2(liters),unit:'L',unitPrice:price,vatRate,basis:cost!==null?'Coût carburant du travail':price!==null?`Prix du carburant des préférences (${fr(price)} €/L), à vérifier`:'Prix du carburant à saisir',source:{type:'fuel',id:work.id}};
}
const TP_PARTS=[['hours','h','hourlyRate','tp-h','heures'],['volumeM3','m³','m3Rate','tp-m3','volume'],['tonnage','t','tonneRate','tp-t','tonnage']];
export function tpLines(project,log,client,vatRate){
  const out=[];for(const [key,unit,rateKey,type,what] of TP_PARTS){const q=positive(log[key]);if(q===null)continue;const rate=positive(client?.[rateKey]);
    out.push({label:`${text(project.type)||'Chantier TP'}${project.address?` · ${text(project.address)}`:''} (${what})`,date:log.date||'',quantity:round2(q),unit,unitPrice:rate,vatRate,basis:rate!==null?`Tarif ${unit==='h'?'horaire':unit==='t'?'tonne':'m³'} du client`:'Tarif à saisir',source:{type,id:log.id,parentId:project.id}});}
  return out;
}

// Travaux réalisés sur les parcelles du client (ou rattachés au client) et journaux des chantiers TP
// du client, sur la période, pas encore facturés.
export function billableItems(state,clientId,{from='',to='',exceptId=null,includeFuel=true}={}){
  const client=active(state,'clients').find(c=>c.id===clientId)||null,billed=billedKeys(state,{exceptId}),vat=settingsVatRate(state),fuelPrice=positive(state.preferences?.fuelPrice);
  const parcels=new Map(active(state,'parcelles').map(p=>[p.id,p])),items=[];
  for(const w of active(state,'interventions')){
    const parcel=parcels.get(w.parcelId);if(!completed(w)||!(parcel?.clientId===clientId||w.clientId===clientId)||!inPeriod(String(w.date||'').slice(0,10),from,to))continue;
    if(!billed.has(`work:${w.id}`))items.push({key:`work:${w.id}`,kind:'work',date:w.date,line:workLine(w,parcel,client,vat)});
    if(includeFuel&&!billed.has(`fuel:${w.id}`)){const f=fuelLine(w,parcel,vat,fuelPrice);if(f)items.push({key:`fuel:${w.id}`,kind:'fuel',date:w.date,line:f});}
  }
  for(const p of active(state,'chantiers')){
    if(p.kind!=='tp'||p.clientId!==clientId)continue;
    for(const log of (p.tpLogs||[]).filter(l=>l&&!l.deletedAt)){if(!inPeriod(log.date,from,to))continue;for(const line of tpLines(p,log,client,vat)){const key=`${line.source.type}:${log.id}`;if(!billed.has(key))items.push({key,kind:'tp',date:log.date,line});}}
  }
  return items.map((it,i)=>({it,i})).sort((a,b)=>String(a.it.date).localeCompare(String(b.it.date))||a.i-b.i).map(x=>x.it);
}
// Nombre de clients ayant des prestations à facturer.
export function clientsToBill(state){return active(state,'clients').filter(c=>!c.archived).map(c=>({client:c,count:billableItems(state,c.id).length})).filter(x=>x.count>0);}
