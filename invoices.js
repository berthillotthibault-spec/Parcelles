// Facturation des prestations et des chantiers TP (n° 56). Logique pure : aucun accès au DOM.
// Les factures sont des enregistrements d’exploitation (integrationImports, farmKind « invoice ») :
// pas de nouvelle collection ni de migration. Les travaux et journaux facturés ne sont pas modifiés :
// le « déjà facturé » se déduit des lignes des factures, ce qui évite toute double facturation sans
// toucher aux autres entités. Une facture émise ne change plus (seul le paiement s’enregistre) :
// on la corrige par un avoir. Montants HT/TVA/TTC arrondis au centime, ligne par ligne.
import {normalize} from './utils.js';
import {active,completed} from './farm-memory.js';
import {farmRecords,saveFarmRecord} from './farm-records.js';
import {printCss,printDocument} from './dossier.js';

export const INVOICE_KIND='invoice';
export const VAT_RATES=[20,10,5.5,0];
export const UNITS=[['h','heure'],['ha','hectare'],['m³','m³'],['t','tonne'],['L','litre'],['forfait','forfait'],['u','unité']];
export const PAYMENT_TERMS=[0,15,30,45,60];
export const DEFAULT_PENALTY='Pénalités de retard : trois fois le taux d’intérêt légal, exigibles dès le lendemain de l’échéance. Indemnité forfaitaire pour frais de recouvrement : 40 €. Pas d’escompte pour paiement anticipé.';
export const STATUS_LABELS={brouillon:'Brouillon',emise:'Émise',payee:'Payée',retard:'En retard',annulee:'Annulée par avoir',avoir:'Avoir'};

const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const loose=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const positive=v=>{const n=loose(v);return n!==null&&n>0?n:null;};
const text=v=>String(v??'').trim();
export const round2=v=>Math.round((v+Number.EPSILON)*100)/100;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
export const isoDay=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const addDays=(day,n)=>{const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+Number(n||0));return isoDay(d);};
const canWrite=(store,action='update')=>!store.writeGuard||store.writeGuard({entity:'integrationImports',action});

export const invoices=state=>farmRecords(state,INVOICE_KIND);
export const invoiceSettings=state=>{const s=state?.exploitation?.invoicing||{};return{legalName:text(s.legalName)||text(state?.exploitation?.nom),legalForm:text(s.legalForm),address:text(s.address),siret:text(s.siret),vatNumber:text(s.vatNumber),iban:text(s.iban),bic:text(s.bic),paymentDays:PAYMENT_TERMS.includes(Number(s.paymentDays))?Number(s.paymentDays):30,vatRate:VAT_RATES.includes(Number(s.vatRate))?Number(s.vatRate):20,prefix:text(s.prefix)||'F',penalty:text(s.penalty)||DEFAULT_PENALTY,mention:text(s.mention),vatOnDebits:!!s.vatOnDebits,email:text(s.email),phone:text(s.phone)};};

// ---------- Montants ----------
export function lineTotal(line){const q=loose(line?.quantity),p=loose(line?.unitPrice);return q===null||p===null?null:round2(q*p);}
export function invoiceTotals(lines=[]){
  const byRate=new Map();let ht=0,missing=0;
  for(const l of lines){const t=lineTotal(l);if(t===null){missing+=1;continue;}ht+=t;const r=loose(l.vatRate)??0;byRate.set(r,round2((byRate.get(r)||0)+t));}
  const rates=[...byRate.entries()].sort((a,b)=>b[0]-a[0]).map(([rate,base])=>({rate,base,tax:round2(base*rate/100)}));
  const tva=round2(rates.reduce((s,r)=>s+r.tax,0));ht=round2(ht);
  return{ht,tva,ttc:round2(ht+tva),byRate:rates,missing};
}

// ---------- Statut ----------
export function invoiceStatus(inv,state=null,today=isoDay()){
  if(inv.docType==='avoir')return inv.status==='brouillon'?'brouillon':'avoir';
  if(inv.status==='brouillon')return'brouillon';
  if(state&&creditedShare(state,inv)>=0.999)return'annulee';
  if(inv.paidAt)return'payee';
  return inv.dueDate&&inv.dueDate<today?'retard':'emise';
}
export function creditNotesOf(state,inv){return invoices(state).filter(a=>a.docType==='avoir'&&a.creditOf===inv.id&&a.status!=='brouillon');}
export function creditedShare(state,inv){const ttc=num(inv.totals?.ttc);if(!ttc)return 0;const credited=creditNotesOf(state,inv).reduce((s,a)=>s+Math.abs(num(a.totals?.ttc)||0),0);return credited/Math.abs(ttc);}
export function overdueInvoices(state,today=isoDay()){return invoices(state).filter(i=>invoiceStatus(i,state,today)==='retard').sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));}
export function receivable(state,today=isoDay()){
  let due=0,late=0,lateCount=0,draft=0;
  for(const inv of invoices(state)){const s=invoiceStatus(inv,state,today),t=num(inv.totals?.ttc)||0;if(s==='emise'||s==='retard'){const credited=creditNotesOf(state,inv).reduce((x,a)=>x+Math.abs(num(a.totals?.ttc)||0),0);const rest=Math.max(0,round2(t-credited));due+=rest;if(s==='retard'){late+=rest;lateCount+=1;}}if(s==='brouillon')draft+=1;}
  return{due:round2(due),late:round2(late),lateCount,draft};
}

// ---------- Numérotation continue, sans trou, par préfixe et par année ----------
const NUMBER_RE=/^(.*?)(\d{4})-(\d{4,})$/;
export const formatNumber=(prefix,year,seq)=>`${prefix}${year}-${String(seq).padStart(4,'0')}`;
export function nextNumber(state,{prefix='F',year=new Date().getFullYear()}={}){
  let max=0;for(const inv of invoices(state)){if(!inv.number)continue;const m=String(inv.number).match(NUMBER_RE);if(m&&m[1]===prefix&&Number(m[2])===Number(year))max=Math.max(max,Number(m[3]));}
  return{number:formatNumber(prefix,year,max+1),sequence:max+1};
}
// Contrôle : numéros en double (émissions simultanées hors ligne sur deux appareils) et trous.
export function numberingIssues(state){
  const seen=new Map(),series=new Map(),duplicates=[],gaps=[];
  for(const inv of invoices(state)){if(!inv.number)continue;seen.set(inv.number,(seen.get(inv.number)||0)+1);const m=String(inv.number).match(NUMBER_RE);if(m){const k=`${m[1]}${m[2]}`;if(!series.has(k))series.set(k,{prefix:m[1],year:m[2],seqs:[]});series.get(k).seqs.push(Number(m[3]));}}
  for(const [n,c] of seen)if(c>1)duplicates.push(n);
  for(const s of series.values()){const set=new Set(s.seqs),max=Math.max(...s.seqs);for(let i=1;i<max;i++)if(!set.has(i))gaps.push(formatNumber(s.prefix,s.year,i));}
  return{duplicates,gaps};
}

// ---------- Prestations à facturer ----------
// Clés des sources déjà reprises dans une facture ou un brouillon (hors factures annulées par avoir).
export function billedKeys(state,{exceptId=null}={}){
  const keys=new Set();
  for(const inv of invoices(state)){if(inv.id===exceptId||inv.docType==='avoir'||invoiceStatus(inv,state)==='annulee')continue;for(const l of inv.lines||[])if(l.source?.type&&l.source?.id)keys.add(`${l.source.type}:${l.source.id}`);}
  return keys;
}
const inPeriod=(day,from,to)=>!!day&&(!from||day>=from)&&(!to||day<=to);
const fr=v=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:2});

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
  const client=active(state,'clients').find(c=>c.id===clientId)||null,billed=billedKeys(state,{exceptId}),vat=invoiceSettings(state).vatRate,fuelPrice=positive(state.preferences?.fuelPrice);
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
export function clientsToBill(state){return active(state,'clients').map(c=>({client:c,count:billableItems(state,c.id).length})).filter(x=>x.count>0);}

// ---------- Validation ----------
export function cleanLine(l,i=0){
  const unit=UNITS.some(([u])=>u===l.unit)?l.unit:'forfait',rate=loose(l.vatRate);
  return{id:text(l.id)||`l${i+1}`,label:text(l.label).slice(0,200),date:DATE_RE.test(text(l.date))?text(l.date):'',quantity:loose(l.quantity),unit,unitPrice:loose(l.unitPrice),vatRate:VAT_RATES.includes(rate)?rate:20,...(l.source?.type&&l.source?.id?{source:{type:text(l.source.type),id:text(l.source.id),...(l.source.parentId?{parentId:text(l.source.parentId)}:{})}}:{})};
}
export function validateSettings(v){
  const out={legalName:text(v.legalName),legalForm:text(v.legalForm),address:text(v.address),siret:text(v.siret).replace(/\s/g,''),vatNumber:text(v.vatNumber).replace(/\s/g,'').toUpperCase(),iban:text(v.iban).replace(/\s/g,'').toUpperCase(),bic:text(v.bic).toUpperCase(),paymentDays:Number(v.paymentDays),vatRate:Number(v.vatRate),prefix:text(v.prefix)||'F',penalty:text(v.penalty),mention:text(v.mention),email:text(v.email),phone:text(v.phone)};
  const missing=!out.legalName?'Raison sociale':!out.address?'Adresse':!out.siret?'SIRET':'';
  if(missing)return{error:`Champ obligatoire : ${missing}`,field:missing};
  if(!/^\d{14}$/.test(out.siret))return{error:'SIRET invalide : 14 chiffres attendus.',field:'SIRET'};
  if(out.vatNumber&&!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(out.vatNumber))return{error:'Numéro de TVA invalide (ex. FR12345678901).',field:'N° de TVA'};
  if(out.iban&&!/^[A-Z]{2}\d{2}[0-9A-Z]{10,30}$/.test(out.iban))return{error:'IBAN invalide.',field:'IBAN'};
  if(!/^[A-Za-z0-9-]{1,6}$/.test(out.prefix))return{error:'Préfixe invalide : 1 à 6 lettres ou chiffres.',field:'Préfixe'};
  if(!PAYMENT_TERMS.includes(out.paymentDays))out.paymentDays=30;if(!VAT_RATES.includes(out.vatRate))out.vatRate=20;
  return{value:out};
}
export function settingsReady(state){return validateSettings(invoiceSettings(state)).error?false:true;}

export function validateDraft(v){
  const lines=(v.lines||[]).map(cleanLine).filter(l=>l.label||l.quantity!==null||l.unitPrice!==null);
  const out={clientId:text(v.clientId),clientName:text(v.clientName),clientAddress:text(v.clientAddress),clientSiren:text(v.clientSiren).replace(/\s/g,''),clientVat:text(v.clientVat).replace(/\s/g,'').toUpperCase(),issueDate:text(v.issueDate),dueDate:text(v.dueDate),note:text(v.note).slice(0,1000),lines};
  if(!out.clientName)return{error:'Champ obligatoire : Client',field:'Client'};
  if(out.clientSiren&&!/^\d{9}(\d{5})?$/.test(out.clientSiren))return{error:'SIREN du client invalide : 9 chiffres (ou SIRET 14).',field:'SIREN'};
  for(const [k,label] of [['issueDate','Date d’émission'],['dueDate','Échéance']])if(out[k]&&!DATE_RE.test(out[k]))return{error:`${label} invalide.`,field:label};
  if(out.issueDate&&out.dueDate&&out.dueDate<out.issueDate)return{error:'L’échéance doit suivre la date d’émission.',field:'Échéance'};
  const bad=lines.findIndex(l=>!l.label);if(bad>=0)return{error:`Champ obligatoire : Désignation (ligne ${bad+1})`,field:'Désignation'};
  return{value:out};
}
// Contrôles supplémentaires avant émission (mentions obligatoires et montants complets).
export function emissionProblems(state,inv,docType=inv.docType||'facture'){
  const p=[],settings=validateSettings(invoiceSettings(state));
  if(settings.error)p.push(`Paramètres de facturation : ${settings.error.replace(/^Champ obligatoire : /,'champ manquant : ')}`);
  if(!inv.clientAddress)p.push('Champ obligatoire : Adresse du client');
  if(!inv.issueDate)p.push('Champ obligatoire : Date d’émission');
  if(!inv.dueDate)p.push('Champ obligatoire : Échéance');
  if(!(inv.lines||[]).length)p.push('Ajoutez au moins une ligne.');
  (inv.lines||[]).forEach((l,i)=>{if(l.quantity===null||(docType==='facture'&&l.quantity<=0))p.push(`Quantité à saisir (ligne ${i+1})`);if(l.unitPrice===null)p.push(`Prix unitaire à saisir (ligne ${i+1})`);else if(docType==='facture'&&l.unitPrice<0)p.push(`Prix unitaire négatif (ligne ${i+1}) : utilisez un avoir`);});
  return p;
}

// ---------- Écritures ----------
function current(store,id){const inv=store.get('integrationImports',id);if(!inv||inv.deletedAt||inv.farmKind!==INVOICE_KIND)throw Error('Facture introuvable : elle a peut-être été supprimée.');return inv;}
const guardVersion=(inv,version)=>{if(version!==undefined&&version!==null&&inv.version!==undefined&&inv.version!==version)throw Error('La facture a changé entre-temps : rouvrez-la.');};

export async function saveSettings(store,values){
  if(store.writeGuard&&!store.writeGuard({entity:'exploitation',action:'update'}))throw Error('Votre rôle ne permet pas de modifier les paramètres de facturation.');
  const checked=validateSettings(values);if(checked.error)throw Error(checked.error);
  return store.setExploitation({invoicing:checked.value});
}

export async function createDraft(store,{clientId,items=[],from='',to='',docType='facture',creditOf=null,lines=null,today=isoDay()}){
  if(!canWrite(store,'create'))throw Error('Votre rôle ne permet pas de créer des factures.');
  const state=store.state,client=active(state,'clients').find(c=>c.id===clientId);if(!client)throw Error('Champ obligatoire : Client');
  const settings=invoiceSettings(state),keys=billedKeys(state);
  const chosen=lines||items.filter(it=>!keys.has(it.key)).map(it=>it.line);
  if(!lines&&chosen.length<items.length)throw Error('Une partie de ces prestations vient d’être facturée : rouvrez la préparation.');
  const clean=chosen.map((l,i)=>cleanLine({...l,id:`l${i+1}`},i));
  const payload={docType,status:'brouillon',clientId,clientName:text(client.name),clientAddress:text(client.address),clientSiren:text(client.siren),clientVat:'',issueDate:today,dueDate:addDays(today,settings.paymentDays),periodStart:from||null,periodEnd:to||null,lines:clean,totals:invoiceTotals(clean),creditOf:creditOf||null,number:null,note:'',name:docType==='avoir'?'Avoir (brouillon)':'Facture (brouillon)'};
  return saveFarmRecord(store,INVOICE_KIND,payload,null);
}

export async function saveDraft(store,id,values,{version}={}){
  if(!canWrite(store))throw Error('Votre rôle ne permet pas de modifier les factures.');
  const inv=current(store,id);if(inv.status!=='brouillon')throw Error('Une facture émise ne se modifie plus : corrigez-la par un avoir.');guardVersion(inv,version);
  const checked=validateDraft({...values,clientId:inv.clientId});if(checked.error)throw Error(checked.error);
  if(inv.docType!=='avoir'){const billed=billedKeys(store.state,{exceptId:id}),dup=checked.value.lines.find(l=>l.source&&billed.has(`${l.source.type}:${l.source.id}`));if(dup)throw Error(`Déjà facturé ailleurs : ${dup.label}`);}
  const v=checked.value;return saveFarmRecord(store,INVOICE_KIND,{...v,clientId:inv.clientId,totals:invoiceTotals(v.lines)},inv);
}

export async function deleteDraft(store,id){
  if(!canWrite(store,'delete'))throw Error('Votre rôle ne permet pas de supprimer les factures.');
  const inv=current(store,id);if(inv.status!=='brouillon')throw Error('Une facture émise ne peut pas être supprimée : établissez un avoir.');
  await store.remove('integrationImports',id);return inv;
}

// Émission : numéro définitif, figé avec l’identité du vendeur et du client. Plus aucune modification ensuite.
export async function emitInvoice(store,id,{version,today=isoDay()}={}){
  if(!canWrite(store))throw Error('Votre rôle ne permet pas d’émettre des factures.');
  const inv=current(store,id);if(inv.status!=='brouillon')throw Error('Cette facture est déjà émise.');guardVersion(inv,version);
  const state=store.state,docType=inv.docType||'facture',problems=emissionProblems(state,inv,docType);if(problems.length)throw Error(problems[0]);
  if(docType==='facture'){const billed=billedKeys(state,{exceptId:id}),dup=(inv.lines||[]).find(l=>l.source&&billed.has(`${l.source.type}:${l.source.id}`));if(dup)throw Error(`Déjà facturé ailleurs : ${dup.label}`);}
  let base=null;if(docType==='avoir'){base=current(store,inv.creditOf);if(base.status==='brouillon')throw Error('La facture d’origine n’est pas émise.');const totals=invoiceTotals(inv.lines);const already=creditNotesOf(state,base).reduce((s,a)=>s+Math.abs(num(a.totals?.ttc)||0),0);if(Math.abs(totals.ttc)+already>Math.abs(num(base.totals?.ttc)||0)+0.005)throw Error('L’avoir dépasse le montant restant de la facture.');}
  const settings=invoiceSettings(state),year=Number(String(inv.issueDate||today).slice(0,4)),{number,sequence}=nextNumber(state,{prefix:settings.prefix,year});
  return saveFarmRecord(store,INVOICE_KIND,{status:'emise',number,sequence,name:`${docType==='avoir'?'Avoir':'Facture'} ${number}`,issueDate:inv.issueDate||today,totals:invoiceTotals(inv.lines),seller:{...settings},emittedAt:Date.now(),...(base?{creditOfNumber:base.number}:{})},inv);
}

export async function markPaid(store,id,{paidAt=isoDay(),method=''}={}){
  if(!canWrite(store))throw Error('Votre rôle ne permet pas de modifier les factures.');
  const inv=current(store,id);if(inv.status==='brouillon'||inv.docType==='avoir')throw Error('Seule une facture émise peut être marquée payée.');
  if(paidAt!==null&&!DATE_RE.test(String(paidAt)))throw Error('Date de paiement invalide.');
  return store.upsert('integrationImports',{...inv,paidAt:paidAt||null,paymentMethod:paidAt?text(method)||null:null},{label:paidAt?`Facture ${inv.number} payée`:`Paiement retiré : ${inv.number}`});
}

// Avoir : reprend les lignes de la facture en montants négatifs (modifiables tant qu’il est en brouillon).
export async function createCreditNote(store,id,{today=isoDay()}={}){
  const inv=current(store,id);if(inv.status==='brouillon'||inv.docType==='avoir')throw Error('Un avoir se crée depuis une facture émise.');
  if(creditedShare(store.state,inv)>=0.999)throw Error('Cette facture est déjà entièrement annulée par avoir.');
  const pending=invoices(store.state).find(a=>a.docType==='avoir'&&a.creditOf===inv.id&&a.status==='brouillon');if(pending)return pending;
  const lines=(inv.lines||[]).map(l=>({...l,quantity:l.quantity===null?null:-Math.abs(l.quantity),label:l.label}));
  const draft=await createDraft(store,{clientId:inv.clientId,docType:'avoir',creditOf:inv.id,lines,today});
  return store.upsert('integrationImports',{...draft,clientName:inv.clientName,clientAddress:inv.clientAddress,clientSiren:inv.clientSiren||'',clientVat:inv.clientVat||'',note:`Avoir sur la facture ${inv.number}.`},{label:'Avoir préparé'});
}

// ---------- Export comptable ----------
const csvCell=v=>{const s=String(v??'');return/[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
const dec=v=>num(v)===null?'':String(round2(v)).replace('.',',');
export function invoicesCsv(state,{from='',to=''}={}){
  const head=['Date','Numéro','Type','Client','SIREN client','Taux TVA','Base HT','TVA','TTC','Échéance','Statut','Payée le','Facture d’origine'];
  const rows=invoices(state).filter(i=>i.status!=='brouillon'&&inPeriod(i.issueDate,from,to)).sort((a,b)=>String(a.issueDate).localeCompare(String(b.issueDate))||String(a.number).localeCompare(String(b.number)));
  const out=[head];
  for(const i of rows){const t=i.totals||invoiceTotals(i.lines),status=STATUS_LABELS[invoiceStatus(i,state)];for(const r of t.byRate.length?t.byRate:[{rate:0,base:0,tax:0}])out.push([i.issueDate,i.number,i.docType==='avoir'?'Avoir':'Facture',i.clientName,i.clientSiren||'',dec(r.rate),dec(r.base),dec(r.tax),dec(round2(r.base+r.tax)),i.dueDate||'',status,i.paidAt||'',i.creditOfNumber||'']);}
  return'﻿'+out.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
export const sortInvoices=list=>[...list].sort((a,b)=>(a.status==='brouillon'?0:1)-(b.status==='brouillon'?0:1)||String(b.issueDate||'').localeCompare(String(a.issueDate||''))||String(b.number||'').localeCompare(String(a.number||'')));
export const clientKey=c=>normalize(c?.name);

// ---------- Document imprimable (A4) ----------
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const NB=' ';
const money=v=>num(v)===null?'—':`${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v).replace(/[  ]/g,NB).replace(/^-/,'−')}${NB}€`;
const qty=v=>num(v)===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(v).replace(/[  ]/g,NB).replace(/^-/,'−');
const pctRate=r=>`${String(r).replace('.',',')}${NB}%`;
export const dateFr=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'—';};
const lines2=v=>esc(v).replace(/\n/g,'<br>');
export function invoiceHtml(state,inv,{assetBase=''}={}){
  const draft=inv.status==='brouillon',seller=draft?invoiceSettings(state):{...invoiceSettings(state),...(inv.seller||{})},t=draft?invoiceTotals(inv.lines||[]):inv.totals||invoiceTotals(inv.lines||[]);
  const avoir=inv.docType==='avoir',kind=avoir?'Avoir':'Facture',number=inv.number||'Brouillon',title=`${kind} ${number} · ${inv.clientName||''}`;
  const status=draft?'':invoiceStatus(inv,state),paid=!avoir&&inv.paidAt;
  const credits=!avoir&&!draft?creditNotesOf(state,inv):[],creditTotal=round2(credits.reduce((s,a)=>s+(num(a.totals?.ttc)||0),0));
  const css=printCss({assetBase,footer:`${seller.legalName} · ${kind} ${number}`,cover:false})+`
.inv-head{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;align-items:start}.inv-seller strong{font:400 18pt/1.1 'Instrument Serif',Georgia,serif;display:block;margin-bottom:4px}.inv-seller p,.inv-client p{margin:0;font-size:9.5pt}
.inv-title{text-align:right}.inv-title h1{font-size:28pt;margin:0}.inv-title dl{display:grid;grid-template-columns:auto auto;justify-content:end;gap:2px 12px;margin:8px 0 0;font-size:9.5pt}.inv-title dt{color:var(--muted)}.inv-title dd{margin:0;font-weight:600}
.inv-client{margin:16px 0 8px auto;width:55%;border:1px solid var(--rule);border-radius:10px;padding:10px 12px;background:#fff}.inv-client small{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:7.5pt}
.inv-totals{margin:6px 0 12px auto;width:55%;break-inside:avoid}.inv-totals table{margin:0}.inv-totals td{padding:4px 6px}.inv-totals tr.is-grand td{font:400 14pt/1.2 'Instrument Serif',Georgia,serif;border-top:1.5px solid var(--ink);border-bottom:0}
.inv-legal{font-size:8.5pt;color:var(--muted);border-top:1px solid var(--rule);padding-top:8px;margin-top:10px}.inv-legal p{margin:0 0 4px}
.inv-stamp{display:inline-block;padding:3px 10px;border:1.5px solid currentColor;border-radius:6px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:9pt}.inv-stamp.is-draft{color:#9b3b2e}.inv-stamp.is-paid{color:#2f6b4a}
.inv-draft-mark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font:400 90pt 'Instrument Serif',Georgia,serif;color:rgba(155,59,46,.08);transform:rotate(-24deg)}
@media (max-width:640px){.inv-head{grid-template-columns:1fr}.inv-title{text-align:left}.inv-title dl{justify-content:start}.inv-client,.inv-totals{width:100%}}`;
  const sellerBlock=`<div class="inv-seller"><strong>${esc(seller.legalName||'Raison sociale à compléter')}</strong>${seller.legalForm?`<p>${esc(seller.legalForm)}</p>`:''}<p>${lines2(seller.address||'Adresse à compléter')}</p><p>SIRET ${esc(seller.siret||'à compléter')}${seller.vatNumber?` · TVA ${esc(seller.vatNumber)}`:''}</p>${seller.email||seller.phone?`<p>${esc([seller.phone,seller.email].filter(Boolean).join(' · '))}</p>`:''}</div>`;
  const head=`<div class="inv-head">${sellerBlock}<div class="inv-title"><h1>${kind}</h1>${draft?'<span class="inv-stamp is-draft">Brouillon · sans valeur</span>':paid?`<span class="inv-stamp is-paid">Payée le ${esc(dateFr(inv.paidAt))}</span>`:''}<dl><dt>N°</dt><dd>${esc(number)}</dd><dt>Date</dt><dd>${esc(dateFr(inv.issueDate))}</dd>${avoir?'':`<dt>Échéance</dt><dd>${esc(dateFr(inv.dueDate))}</dd>`}${inv.periodStart||inv.periodEnd?`<dt>Période</dt><dd>${esc(inv.periodStart&&inv.periodEnd?`${dateFr(inv.periodStart)} – ${dateFr(inv.periodEnd)}`:inv.periodStart?`depuis le ${dateFr(inv.periodStart)}`:`jusqu’au ${dateFr(inv.periodEnd)}`)}</dd>`:''}${avoir&&inv.creditOfNumber?`<dt>Facture d’origine</dt><dd>${esc(inv.creditOfNumber)}</dd>`:''}</dl></div></div>`;
  const client=`<div class="inv-client"><small>${avoir?'Client':'Facturé à'}</small><p><strong>${esc(inv.clientName||'Client')}</strong></p><p>${lines2(inv.clientAddress||'Adresse à compléter')}</p>${inv.clientSiren?`<p>SIREN ${esc(inv.clientSiren)}</p>`:''}${inv.clientVat?`<p>TVA ${esc(inv.clientVat)}</p>`:''}</div>`;
  const rows=(inv.lines||[]).map(l=>`<tr><td>${esc(l.date?dateFr(l.date):'')}</td><td>${esc(l.label)}</td><td class="n">${esc(qty(l.quantity))}${NB}${esc(l.unit==='forfait'?'forf.':l.unit)}</td><td class="n">${esc(money(l.unitPrice))}</td><td class="n">${esc(pctRate(l.vatRate))}</td><td class="n">${esc(money(lineTotal(l)))}</td></tr>`).join('');
  const table=`<div class="dz-wide"><table><thead><tr><th>Date</th><th>Désignation</th><th class="n">Quantité</th><th class="n">PU HT</th><th class="n">TVA</th><th class="n">Total HT</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="muted">Aucune ligne.</td></tr>'}</tbody></table></div>`;
  const totals=`<div class="inv-totals"><table><tbody><tr><td>Total HT</td><td class="n">${esc(money(t.ht))}</td></tr>${t.byRate.map(r=>`<tr><td>TVA ${esc(pctRate(r.rate))} sur ${esc(money(r.base))}</td><td class="n">${esc(money(r.tax))}</td></tr>`).join('')}<tr class="is-grand"><td>Total TTC</td><td class="n">${esc(money(t.ttc))}</td></tr>${credits.length?`<tr><td>Avoirs (${esc(credits.map(a=>a.number).join(', '))})</td><td class="n">${esc(money(creditTotal))}</td></tr><tr><td><strong>Net à payer</strong></td><td class="n"><strong>${esc(money(round2(t.ttc+creditTotal)))}</strong></td></tr>`:''}</tbody></table>${t.missing?`<p class="dz-note">${t.missing} ligne${t.missing>1?'s':''} sans prix : non comptée${t.missing>1?'s':''}.</p>`:''}</div>`;
  const pay=avoir?`<p>Avoir sur la facture ${esc(inv.creditOfNumber||'')} : ce montant vient en déduction de la facture d’origine.</p>`:`<p><strong>Règlement</strong> au plus tard le ${esc(dateFr(inv.dueDate))}${seller.iban?` par virement · IBAN ${esc(seller.iban.replace(/(.{4})/g,'$1 ').trim())}${seller.bic?` · BIC ${esc(seller.bic)}`:''}`:''}.</p><p>${esc(seller.penalty||DEFAULT_PENALTY)}</p>`;
  const legal=`<div class="inv-legal">${pay}<p>Opération : prestations de services.${seller.vatOnDebits?' Option pour le paiement de la taxe d’après les débits.':''}</p>${seller.mention?`<p>${esc(seller.mention)}</p>`:''}${inv.note?`<p>${lines2(inv.note)}</p>`:''}</div>`;
  const body=`${draft?'<div class="inv-draft-mark" aria-hidden="true">Brouillon</div>':''}<main class="page"><div class="dz-body">${head}${client}${table}${totals}${legal}</div><footer class="dz-foot"><span>${esc(seller.legalName)} · SIRET ${esc(seller.siret||'—')}</span><span>${esc(kind)} ${esc(number)}${status&&status!=='avoir'?` · ${esc(STATUS_LABELS[status])}`:''}</span></footer></main>`;
  return printDocument({title,css,body});
}
