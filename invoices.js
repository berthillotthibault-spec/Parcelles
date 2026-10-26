// Facturation (n° 56, moteur complet en vague 13). Logique pure : aucun accès au DOM.
// Documents : devis et factures pro forma (integrationImports, farmKind « quote »), factures,
// factures d’acompte et avoirs (farmKind « invoice »). Pas de nouvelle collection ni de migration.
// Les travaux et journaux facturés ne sont pas modifiés : le « déjà facturé » se déduit des lignes des
// factures, ce qui évite toute double facturation sans toucher aux autres entités. Un document émis est
// figé (empreinte de contrôle) : seuls ses paiements, relances, envois et la réponse d’un devis
// s’enregistrent ensuite ; on le corrige par un avoir. Montants arrondis au centime ligne par ligne,
// puis par taux de TVA.
// Ce module n’est chargé qu’à la demande (écrans de facturation, trésorerie, exports) : le premier rendu
// (accueil, carte de campagne) n’utilise que invoices-core.js, réexporté ici tel quel pour les appelants.
// Il ne doit importer aucun module billing-*.js.
// Devis (cycle de vie), catalogue, récurrences : billing.js ; tableaux de bord et aide à la saisie :
// billing-insights.js ; Factur-X, FEC et QR de virement : billing-export.js ; messages : billing-messages.js.
import {normalize,uid} from './utils.js';
import {active} from './farm-memory.js';
import {saveFarmRecord} from './farm-records.js';
import {printCss,printDocument} from './dossier.js';
import {INVOICE_KIND,QUOTE_KIND,DOC_TYPES,docTypeOf,VAT_RATES_ALL,LINE_KINDS,num,loose,text,round2,round3,DATE_RE,validDay,isoDay,invoices,quotes,
  customRatesOf,settingsVatRate,lineKind,amountLine,lineTotal,documentTotals,quoteStatus,creditNotesOf,creditedShare,paymentsOf,invoiceBalance,
  installmentsOf,invoiceStatus,docStatus,overdueInvoices,billedKeys,inPeriod,fr,workLine,fuelLine,tpLines,billableItems,clientsToBill} from './invoices-core.js';

// Noyau (invoices-core.js) : même API publique qu’avant la séparation.
export {INVOICE_KIND,QUOTE_KIND,DOC_TYPES,docTypeOf,VAT_RATES_ALL,LINE_KINDS,round2,validDay,isoDay,invoices,quotes,lineKind,amountLine,lineTotal,
  documentTotals,quoteStatus,creditNotesOf,creditedShare,paymentsOf,invoiceBalance,invoiceStatus,docStatus,overdueInvoices,billedKeys,workLine,
  fuelLine,tpLines,billableItems,clientsToBill};

export const DOC_LABELS={devis:'Devis',proforma:'Facture pro forma',acompte:'Facture d’acompte',facture:'Facture',avoir:'Avoir'};
export const ACCOUNTING_TYPES=new Set(['acompte','facture','avoir']);
export const kindOfDocType=t=>t==='devis'||t==='proforma'?QUOTE_KIND:INVOICE_KIND;
export const VAT_RATES=[20,10,5.5,0];
export const UNITS=[['h','heure'],['ha','hectare'],['m³','m³'],['t','tonne'],['L','litre'],['forfait','forfait'],['u','unité']];
export const MORE_UNITS=[['j','jour'],['km','kilomètre'],['m²','m²'],['m','mètre'],['kg','kilogramme'],['lot','lot'],['mois','mois']];
const UNIT_SET=new Set([...UNITS,...MORE_UNITS].map(([u])=>u));
export const PAYMENT_TERMS=[0,15,30,45,60];
export const PAYMENT_METHODS=[['virement','Virement'],['cheque','Chèque'],['especes','Espèces'],['carte','Carte bancaire'],['prelevement','Prélèvement'],['compensation','Compensation'],['remboursement','Remboursement']];
export const VAT_REGIMES=[['normal','Régime réel : TVA collectée'],['franchise','Franchise en base de TVA'],['remboursement-forfaitaire','Remboursement forfaitaire agricole']];
export const OPERATION_NATURES=[['services','Prestations de services'],['biens','Livraisons de biens'],['mixte','Biens et services']];
// Motifs d’exonération (lignes à 0 %) : mention imprimée et catégorie EN 16931 (Factur-X).
export const VAT_EXEMPTIONS={
  franchise:{label:'Franchise en base',mention:'TVA non applicable, art. 293 B du CGI.',category:'E',vatex:'VATEX-FR-FRANCHISE'},
  autoliquidation:{label:'Autoliquidation',mention:'Autoliquidation : TVA due par le preneur (art. 283-2 nonies du CGI).',category:'AE',vatex:'VATEX-EU-AE'},
  intracom:{label:'Livraison intracommunautaire',mention:'Exonération de TVA, art. 262 ter I du CGI.',category:'K',vatex:'VATEX-EU-IC'},
  export:{label:'Exportation',mention:'Exonération de TVA, art. 262 I du CGI.',category:'G',vatex:'VATEX-EU-G'},
  exoneration:{label:'Exonération',mention:'Exonération de TVA, art. 261 du CGI.',category:'E',vatex:'VATEX-EU-132'},
  'hors-champ':{label:'Hors champ',mention:'Opération située hors du champ d’application de la TVA.',category:'O',vatex:'VATEX-EU-O'},
  forfaitaire:{label:'Remboursement forfaitaire',mention:'Exploitant agricole au remboursement forfaitaire (art. 298 quater du CGI) : TVA non facturée.',category:'O',vatex:'VATEX-EU-O'}
};
export const DEFAULT_PENALTY='Pénalités de retard : trois fois le taux d’intérêt légal, exigibles dès le lendemain de l’échéance. Indemnité forfaitaire pour frais de recouvrement : 40 €. Pas d’escompte pour paiement anticipé.';
// Facturation électronique : mentions nouvelles (SIREN du client, nature de l’opération, adresse de
// livraison, option sur les débits) ; émission obligatoire pour les TPE et PME au 1er septembre 2027.
export const REFORM_MENTIONS_DATE='2026-09-01';
export const E_INVOICING_DATE='2027-09-01';
export const DEFAULT_NUMBERING_FORMAT='{PREFIXE}{AAAA}-{NUM:4}';
export const DEFAULT_REMINDERS=[{level:1,days:7,fee:0},{level:2,days:20,fee:0},{level:3,days:45,fee:40}];
export const FONTS=[['sans','Instrument Sans'],['serif','Instrument Serif'],['mono','Chasse fixe']];
// Apparence (lot 2) : couleur d’accent en pastilles et logo facultatif (data URL PNG/JPEG, 150 Ko au plus).
export const ACCENTS=[['#2f6b4a','Vert Parcelles'],['#2c5a85','Bleu'],['#7d2f3a','Bordeaux'],['#9a5a24','Terre'],['#3f4b55','Ardoise'],['#1f2421','Noir']];
export const DEFAULT_ACCENT=ACCENTS[0][0];
export const LOGO_MAX_BYTES=150*1024;
const LOGO_RE=/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export const logoBytes=url=>{const b64=String(url||'').split(',')[1]||'';return Math.floor(b64.length*3/4)-(b64.endsWith('==')?2:b64.endsWith('=')?1:0);};
export const validLogo=url=>!!url&&LOGO_RE.test(url)&&logoBytes(url)<=LOGO_MAX_BYTES;
const accentOf=v=>/^#[0-9a-f]{6}$/i.test(String(v||'').trim())?String(v).trim().toLowerCase():DEFAULT_ACCENT;
export const STATUS_LABELS={brouillon:'Brouillon',emise:'Émise',partielle:'Partiellement payée',payee:'Payée',retard:'En retard',annulee:'Annulée par avoir',avoir:'Avoir',envoye:'Envoyé',accepte:'Accepté',refuse:'Refusé',expire:'Expiré',converti:'Converti'};

export const addDays=(day,n)=>{const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+Number(n||0));return isoDay(d);};
// Ajout de mois sans débordement : le 31 janvier + 1 mois donne le 28 (ou 29) février.
export const addMonths=(day,n,anchor=null)=>{const [y,m,d]=String(day).split('-').map(Number),t=y*12+(m-1)+Number(n||0),ny=Math.floor(t/12),nm=t-ny*12,last=new Date(ny,nm+1,0).getDate();return`${ny}-${String(nm+1).padStart(2,'0')}-${String(Math.min(anchor||d,last)).padStart(2,'0')}`;};
export const daysBetween=(a,b)=>Math.round((new Date(`${b}T12:00:00`)-new Date(`${a}T12:00:00`))/86400000);
const canWrite=(store,action='update',farmKind=INVOICE_KIND)=>!store.writeGuard||store.writeGuard({entity:'integrationImports',action,farmKind});

export const billingDocs=state=>[...invoices(state),...quotes(state)];
const docsOfKind=(state,kind)=>kind===QUOTE_KIND?quotes(state):invoices(state);

// ---------- Contrôles de saisie ----------
// IBAN : clé ISO 13616 (modulo 97).
export function ibanValid(value){
  const iban=String(value||'').replace(/\s/g,'').toUpperCase();if(!/^[A-Z]{2}\d{2}[0-9A-Z]{10,30}$/.test(iban))return false;
  let m=0;for(const c of iban.slice(4)+iban.slice(0,4)){const d=/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c;for(const x of d)m=(m*10+Number(x))%97;}
  return m===1;
}
// SIREN / SIRET : clé de Luhn (La Poste, SIRET commençant par 356000000, en est dispensée).
export function luhnValid(value){const s=String(value||'');if(!/^\d+$/.test(s))return false;if(s.length===14&&s.startsWith('356000000'))return true;let sum=0;for(let i=0;i<s.length;i+=1){let d=Number(s[s.length-1-i]);if(i%2){d*=2;if(d>9)d-=9;}sum+=d;}return sum%10===0;}
// Un numéro de TVA français contient le SIREN (FRkk + 9 chiffres).
export const sirenFromVat=vat=>{const m=String(vat||'').replace(/\s/g,'').toUpperCase().match(/^FR[0-9A-Z]{2}(\d{9})$/);return m?m[1]:'';};

// ---------- Paramètres ----------
const NUMBERING_TYPES=['facture','acompte','avoir','devis'];
const TOKEN_RE=/\{(PREFIXE|AAAA|AA|MM|NUM(?::(\d{1,2}))?)\}/g;
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Format à jetons {PREFIXE}{AAAA}{AA}{MM}{NUM:n} : expression de lecture et construction du numéro.
export function compileNumbering(format=DEFAULT_NUMBERING_FORMAT,prefix='F'){
  const f=String(format||DEFAULT_NUMBERING_FORMAT);let re='^',last=0,width=4;const parts=[],seen=new Set();
  if(/[^A-Za-z0-9{}:_/.-]/.test(f))return{error:'Format de numérotation : lettres, chiffres, tirets, barres obliques, points ou soulignés seulement.'};
  for(const m of f.matchAll(TOKEN_RE)){
    const lit=f.slice(last,m.index);if(/[{}]/.test(lit))return{error:`Format de numérotation : jeton inconnu dans « ${lit} ».`};
    re+=escapeRe(lit);parts.push({lit});last=m.index+m[0].length;
    const tok=m[1].startsWith('NUM')?'NUM':m[1];if(seen.has(tok))return{error:`Format de numérotation : jeton {${tok}} en double.`};seen.add(tok);
    if(tok==='PREFIXE'){re+=escapeRe(prefix);parts.push({lit:prefix});}
    else if(tok==='AAAA'){re+='(\\d{4})';parts.push({tok});}
    else if(tok==='AA'){re+='(\\d{2})';parts.push({tok});}
    else if(tok==='MM'){re+='(\\d{2})';parts.push({tok});}
    else{width=Math.min(10,Math.max(1,Number(m[2]||4)));re+=`(\\d{${width},})`;parts.push({tok:'NUM'});}
  }
  const tail=f.slice(last);if(/[{}]/.test(tail))return{error:`Format de numérotation : jeton inconnu dans « ${tail} ».`};
  re+=`${escapeRe(tail)}$`;parts.push({lit:tail});
  if(!seen.has('NUM'))return{error:'Format de numérotation : le jeton {NUM} (compteur) est obligatoire.'};
  if(seen.has('AAAA')&&seen.has('AA'))return{error:'Format de numérotation : choisissez {AAAA} ou {AA}, pas les deux.'};
  const groups=parts.filter(p=>p.tok).map(p=>p.tok),regex=new RegExp(re);
  const build=({date,seq})=>parts.map(p=>p.lit!==undefined?p.lit:p.tok==='AAAA'?String(date).slice(0,4):p.tok==='AA'?String(date).slice(2,4):p.tok==='MM'?String(date).slice(5,7):String(seq).padStart(width,'0')).join('');
  const parse=number=>{const m=String(number||'').match(regex);if(!m)return null;const out={};groups.forEach((g,i)=>{out[g]=m[i+1];});return{seq:Number(out.NUM),year:out.AAAA?Number(out.AAAA):out.AA?2000+Number(out.AA):null,month:out.MM?Number(out.MM):null};};
  return{regex,build,parse,hasYear:seen.has('AAAA')||seen.has('AA'),width};
}
function numberingOf(raw,prefix){
  const out={};
  for(const t of NUMBERING_TYPES){const o=raw?.[t]||{};const startAt=Math.floor(loose(o.startAt)??1);
    out[t]={prefix:text(o.prefix)||(t==='devis'?'D':prefix),format:text(o.format)||DEFAULT_NUMBERING_FORMAT,reset:o.reset==='jamais'?'jamais':'annuel',startAt:startAt>=1?startAt:1};}
  return out;
}
function remindersOf(raw){
  const list=Array.isArray(raw)&&raw.length?raw:DEFAULT_REMINDERS;
  return list.slice(0,3).map((r,i)=>({level:i+1,days:Math.max(0,Math.floor(loose(r?.days)??DEFAULT_REMINDERS[i]?.days??0)),fee:Math.max(0,round2(loose(r?.fee)??0)),...(text(r?.subject)?{subject:text(r.subject).slice(0,200)}:{}),...(text(r?.body)?{body:text(r.body).slice(0,4000)}:{})}));
}
function templateOf(raw={}){
  const c=raw.columns||{};
  return{font:FONTS.some(([f])=>f===raw.font)?raw.font:'sans',columns:{date:c.date!==false,unit:c.unit!==false,vat:c.vat!==false,discount:c.discount!==false},footer:text(raw.footer).slice(0,500),terms:text(raw.terms).slice(0,6000),freeMentions:text(raw.freeMentions).slice(0,2000),showQr:!!raw.showQr};
}
const messagesOf=raw=>Object.fromEntries(Object.entries(raw&&typeof raw==='object'?raw:{}).filter(([k,v])=>/^[a-z0-9]{1,20}$/i.test(k)&&v&&typeof v==='object').map(([k,v])=>[k,{subject:text(v.subject).slice(0,200),body:text(v.body).slice(0,4000)}]));
export function invoiceSettings(state){
  const s=state?.exploitation?.invoicing||{},prefix=text(s.prefix)||'F',custom=customRatesOf(s.customVatRates);
  return{legalName:text(s.legalName)||text(state?.exploitation?.nom),legalForm:text(s.legalForm),capital:text(s.capital),rcs:text(s.rcs),address:text(s.address),siret:text(s.siret),vatNumber:text(s.vatNumber),iban:text(s.iban),bic:text(s.bic),
    paymentDays:PAYMENT_TERMS.includes(Number(s.paymentDays))?Number(s.paymentDays):30,vatRate:settingsVatRate(state),prefix,penalty:text(s.penalty)||DEFAULT_PENALTY,mention:text(s.mention),vatOnDebits:!!s.vatOnDebits,email:text(s.email),phone:text(s.phone),accent:accentOf(s.accent),logo:validLogo(text(s.logo))?text(s.logo):'',
    vatRegime:VAT_REGIMES.some(([k])=>k===s.vatRegime)?s.vatRegime:'normal',operationNature:OPERATION_NATURES.some(([k])=>k===s.operationNature)?s.operationNature:'services',escompte:text(s.escompte),
    quoteValidityDays:Math.min(365,Math.max(1,Math.floor(loose(s.quoteValidityDays)??30))),depositPct:Math.min(100,Math.max(1,loose(s.depositPct)??30)),
    customVatRates:custom,numbering:numberingOf(s.numbering,prefix),reminders:remindersOf(s.reminders),template:templateOf(s.template||{}),messages:messagesOf(s.messages)};
}
export const vatRatesOf=settings=>[...VAT_RATES_ALL,...(settings?.customVatRates||[]).filter(r=>!VAT_RATES_ALL.includes(r))];

export function invoiceTotals(lines=[]){
  const byRate=new Map();let ht=0,missing=0;
  for(const l of lines){if(!amountLine(l))continue;const t=lineTotal(l);if(t===null){missing+=1;continue;}ht+=t;const r=loose(l.vatRate)??0;byRate.set(r,round2((byRate.get(r)||0)+t));}
  const rates=[...byRate.entries()].sort((a,b)=>b[0]-a[0]).map(([rate,base])=>({rate,base,tax:round2(base*rate/100)}));
  const tva=round2(rates.reduce((s,r)=>s+r.tax,0));ht=round2(ht);
  return{ht,tva,ttc:round2(ht+tva),byRate:rates,missing};
}
// Sous-totaux : montant HT des lignes depuis le titre de section (ou le sous-total) précédent.
export function runningSubtotals(lines=[]){
  const out=new Map();let acc=0;
  for(const l of lines){const k=lineKind(l);if(k==='section'){acc=0;continue;}if(k==='subtotal'){out.set(l.id,round2(acc));acc=0;continue;}const t=lineTotal(l);if(t!==null)acc=round2(acc+t);}
  return out;
}

const OPEN=new Set(['emise','retard','partielle']);
export function receivable(state,today=isoDay()){
  let due=0,late=0,lateCount=0,draft=0;
  for(const inv of invoices(state)){const s=invoiceStatus(inv,state,today);if(OPEN.has(s)){const rest=invoiceBalance(state,inv).due;due+=rest;if(s==='retard'){late+=rest;lateCount+=1;}}if(s==='brouillon')draft+=1;}
  return{due:round2(due),late:round2(late),lateCount,draft};
}
// Encaissements attendus (trésorerie n° 86) : reste dû par échéance, les paiements soldant d’abord les plus anciennes.
export function expectedReceipts(state,today=isoDay()){
  const out=[];
  for(const inv of invoices(state)){
    const s=invoiceStatus(inv,state,today);if(!OPEN.has(s))continue;const b=invoiceBalance(state,inv);if(b.due<=0.005)continue;
    const plan=installmentsOf(inv);
    if(plan.length){let covered=round2(b.paid+b.credited),left=b.due;for(const i of plan){const rest=round2(Math.max(0,i.amount-Math.max(0,covered)));covered=round2(covered-i.amount);const amount=Math.min(rest,left);if(amount>0.005){out.push({invoice:inv,date:i.date,amount:round2(amount),late:i.date<today});left=round2(left-amount);}}if(left>0.005)out.push({invoice:inv,date:plan[plan.length-1].date,amount:left,late:plan[plan.length-1].date<today});}
    else out.push({invoice:inv,date:inv.dueDate||inv.issueDate||today,amount:b.due,late:!!inv.dueDate&&inv.dueDate<today});
  }
  return out;// Ordre des factures (la trésorerie regroupe par mois) ; triez par date au besoin.
}

// ---------- Numérotation continue, sans trou, par série ----------
// Une série = un préfixe et un format ; facture, acompte et avoir la partagent par défaut (préfixe F).
// Le numéro n’est attribué qu’à l’émission : max des numéros de la série (ou départ choisi) + 1.
const NUMBER_RE=/^(.*?)(\d{4})-(\d{4,})$/;
export const formatNumber=(prefix,year,seq)=>`${prefix}${year}-${String(seq).padStart(4,'0')}`;
export function numberingConfig(settings,docType='facture'){const t=docType==='proforma'?'devis':NUMBERING_TYPES.includes(docType)?docType:'facture';return settings.numbering?.[t]||numberingOf({},settings.prefix||'F')[t];}
function sameSeries(a,b){return a.prefix===b.prefix&&a.format===b.format;}
export function allocateNumber(state,docType='facture',date=isoDay(),{settings=null,prefix=null}={}){
  const s=settings||invoiceSettings(state),cfg={...numberingConfig(s,docType)};if(prefix!==null&&prefix!==undefined)cfg.prefix=String(prefix);
  const c=compileNumbering(cfg.format,cfg.prefix);if(c.error)throw Error(c.error);
  const scope=cfg.reset==='annuel'?String(date).slice(0,4):'';let max=cfg.startAt-1,lastDate='',lastNumber='';
  for(const doc of docsOfKind(state,kindOfDocType(docType))){
    if(!doc.number)continue;const p=c.parse(doc.number);if(!p)continue;
    const y=String(p.year??String(doc.issueDate||'').slice(0,4));if(scope&&y!==scope)continue;
    if(p.seq>max)max=p.seq;if(String(doc.issueDate||'')>lastDate){lastDate=String(doc.issueDate||'');lastNumber=doc.number;}
  }
  return{number:c.build({date,seq:max+1}),sequence:max+1,series:`${cfg.prefix}|${cfg.format}|${scope}`,lastDate,lastNumber};
}
export function nextNumber(state,{docType='facture',prefix=null,year=null,date=null}={}){
  const day=validDay(date)?date:year?`${year}-01-01`:isoDay(),{number,sequence}=allocateNumber(state,docType,day,{prefix});
  return{number,sequence};
}
// Contrôle : numéros en double (émissions simultanées hors ligne sur deux appareils) et trous.
export function numberingIssues(state){
  const s=invoiceSettings(state),seen=new Map(),series=new Map(),duplicates=[],gaps=[];
  const configs=kind=>NUMBERING_TYPES.filter(t=>kindOfDocType(t)===kind).map(t=>numberingConfig(s,t)).filter((c,i,a)=>a.findIndex(x=>sameSeries(x,c))===i);
  for(const kind of [INVOICE_KIND,QUOTE_KIND]){
    const list=configs(kind).map(cfg=>({cfg,c:compileNumbering(cfg.format,cfg.prefix)})).filter(x=>!x.c.error);
    for(const doc of docsOfKind(state,kind)){
      if(!doc.number)continue;const k0=`${kind}|${doc.number}`;seen.set(k0,(seen.get(k0)||0)+1);if(seen.get(k0)===2)duplicates.push(doc.number);
      let key=null,entry=null;
      for(const {cfg,c} of list){const p=c.parse(doc.number);if(!p)continue;const y=cfg.reset==='annuel'?String(p.year??String(doc.issueDate||'').slice(0,4)):'';key=`${kind}|${cfg.prefix}|${cfg.format}|${y}`;entry={start:cfg.startAt,seq:p.seq,build:seq=>c.build({date:`${y||String(doc.issueDate||'').slice(0,4)}-${String(p.month||1).padStart(2,'0')}-01`,seq})};break;}
      if(!key){const m=String(doc.number).match(NUMBER_RE);if(!m)continue;key=`${kind}|legacy|${m[1]}${m[2]}`;entry={start:1,seq:Number(m[3]),build:seq=>formatNumber(m[1],m[2],seq)};}
      if(!series.has(key))series.set(key,{start:entry.start,items:new Map()});series.get(key).items.set(entry.seq,entry.build);
    }
  }
  for(const sr of series.values()){const seqs=[...sr.items.keys()].sort((a,b)=>a-b),max=seqs[seqs.length-1];for(let i=sr.start;i<max;i++)if(!sr.items.has(i)){const next=seqs.find(x=>x>i);gaps.push(sr.items.get(next)(i));}}
  return{duplicates,gaps};
}


// ---------- Validation ----------
const vatRateOk=(rate,custom=[],flag=false)=>rate!==null&&(VAT_RATES_ALL.includes(rate)||custom.includes(rate)||(flag&&rate>=0&&rate<=100));
export function cleanLine(l,i=0,{customRates=[]}={}){
  const kind=lineKind(l),id=text(l?.id)||`l${i+1}`,label=text(l?.label).slice(0,200);
  if(kind==='section'||kind==='subtotal')return{id,kind,label};
  if(kind==='comment')return{id,kind,label,description:text(l.description).slice(0,2000)};
  const unit=UNIT_SET.has(l.unit)?l.unit:'forfait',rate=loose(l.vatRate),disc=loose(l.discountPct),custom=customRates.includes(rate)||!!l.vatCustom;
  return{id,label,date:DATE_RE.test(text(l.date))?text(l.date):'',quantity:loose(l.quantity),unit,unitPrice:loose(l.unitPrice),vatRate:vatRateOk(rate,customRates,l.vatCustom)?round3(rate):20,
    ...(kind==='deduction'?{kind}:{}),...(kind==='deduction'&&loose(l.vatAmount)!==null?{vatAmount:round2(loose(l.vatAmount))}:{}),...(text(l.description)?{description:text(l.description).slice(0,2000)}:{}),...(disc!==null&&disc>0&&disc<=100?{discountPct:round2(disc)}:{}),
    ...(VAT_EXEMPTIONS[l.vatExemption]?{vatExemption:l.vatExemption}:{}),...(custom&&!VAT_RATES_ALL.includes(rate)&&vatRateOk(rate,customRates,true)?{vatCustom:true}:{}),
    ...(text(l.itemId)?{itemId:text(l.itemId)}:{}),...(/^\d{3,10}$/.test(text(l.account))?{account:text(l.account)}:{}),...(l.basis?{basis:text(l.basis).slice(0,120)}:{}),
    ...(l.source?.type&&l.source?.id?{source:{type:text(l.source.type),id:text(l.source.id),...(l.source.parentId?{parentId:text(l.source.parentId)}:{})}}:{})};
}
// partial : enregistrement d’une seule section des réglages (identité encore incomplète) ; les champs
// obligatoires manquants sont tolérés, mais tout champ saisi reste contrôlé. L’émission reste bloquée
// (settingsReady) tant que l’identité n’est pas complète.
export function validateSettings(v,{partial=false}={}){
  const raw=v||{},custom=customRatesOf(raw.customVatRates);
  const out={legalName:text(raw.legalName),legalForm:text(raw.legalForm),address:text(raw.address),siret:text(raw.siret).replace(/\s/g,''),vatNumber:text(raw.vatNumber).replace(/\s/g,'').toUpperCase(),iban:text(raw.iban).replace(/\s/g,'').toUpperCase(),bic:text(raw.bic).replace(/\s/g,'').toUpperCase(),paymentDays:Number(raw.paymentDays),vatRate:Number(raw.vatRate),prefix:text(raw.prefix)||'F',penalty:text(raw.penalty),mention:text(raw.mention),email:text(raw.email),phone:text(raw.phone),accent:accentOf(raw.accent),logo:text(raw.logo),
    capital:text(raw.capital).slice(0,60),rcs:text(raw.rcs).slice(0,80),vatRegime:VAT_REGIMES.some(([k])=>k===raw.vatRegime)?raw.vatRegime:'normal',operationNature:OPERATION_NATURES.some(([k])=>k===raw.operationNature)?raw.operationNature:'services',escompte:text(raw.escompte).slice(0,300),
    quoteValidityDays:Math.min(365,Math.max(1,Math.floor(loose(raw.quoteValidityDays)??30))),depositPct:Math.min(100,Math.max(1,loose(raw.depositPct)??30)),customVatRates:custom,
    numbering:numberingOf(raw.numbering,text(raw.prefix)||'F'),reminders:remindersOf(raw.reminders),template:templateOf(raw.template||{}),messages:messagesOf(raw.messages)};
  if(raw.vatOnDebits!==undefined)out.vatOnDebits=!!raw.vatOnDebits;
  const missing=!out.legalName?'Raison sociale':!out.address?'Adresse':!out.siret?'SIRET':'';
  if(missing&&!partial)return{error:`Champ obligatoire : ${missing}`,field:missing};
  if((out.siret||!partial)&&!/^\d{14}$/.test(out.siret))return{error:'SIRET invalide : 14 chiffres attendus.',field:'SIRET'};
  if(out.vatNumber&&!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(out.vatNumber))return{error:'Numéro de TVA invalide (ex. FR12345678901).',field:'N° de TVA'};
  if(out.iban&&!/^[A-Z]{2}\d{2}[0-9A-Z]{10,30}$/.test(out.iban))return{error:'IBAN invalide.',field:'IBAN'};
  if(out.iban&&!ibanValid(out.iban))return{error:'IBAN invalide : la clé de contrôle ne correspond pas (vérifiez chaque caractère).',field:'IBAN'};
  if(out.bic&&!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(out.bic))return{error:'BIC invalide : 8 ou 11 caractères.',field:'BIC'};
  if(!/^[A-Za-z0-9-]{1,6}$/.test(out.prefix))return{error:'Préfixe invalide : 1 à 6 lettres ou chiffres.',field:'Préfixe'};
  if(out.logo&&!validLogo(out.logo))return{error:`Logo invalide ou trop lourd (${Math.round(LOGO_MAX_BYTES/1024)} Ko au plus) : importez-le de nouveau.`,field:'Logo'};
  for(const [t,cfg] of Object.entries(out.numbering)){
    if(!/^[A-Za-z0-9-]{1,6}$/.test(cfg.prefix))return{error:`Préfixe invalide (${DOC_LABELS[t]}) : 1 à 6 lettres ou chiffres.`,field:'Numérotation'};
    const c=compileNumbering(cfg.format,cfg.prefix);if(c.error)return{error:`${c.error} (${DOC_LABELS[t]})`,field:'Numérotation'};
    if(cfg.reset==='annuel'&&!c.hasYear)return{error:`Numérotation (${DOC_LABELS[t]}) : une remise à zéro annuelle exige l’année ({AAAA} ou {AA}) dans le format.`,field:'Numérotation'};
  }
  for(let i=1;i<out.reminders.length;i+=1)if(out.reminders[i].days<=out.reminders[i-1].days)return{error:'Relances : chaque niveau doit suivre le précédent (jours croissants).',field:'Relances'};
  if(!PAYMENT_TERMS.includes(out.paymentDays))out.paymentDays=30;if(!VAT_RATES_ALL.includes(out.vatRate)&&!custom.includes(out.vatRate))out.vatRate=20;
  return{value:out};
}
export function settingsReady(state){return validateSettings(invoiceSettings(state)).error?false:true;}

// Champs propres aux documents ajoutés en vague 13 (absents des anciens brouillons : valeurs par défaut).
const DOC_FIELDS=['clientKind','clientEmail','clientPhone','deliveryAddress','deliveryDate','operationNature','discount','shipping','installments','vatExemption','validUntil','reference','subject','terms','goodForAgreement'];
function cleanInstallments(list){return(Array.isArray(list)?list:[]).map(i=>({date:text(i?.date),amount:loose(i?.amount)})).filter(i=>i.date||i.amount!==null);}
export function validateDraft(v,{customRates=[],docType=null}={}){
  const lines=(v.lines||[]).map((l,i)=>cleanLine(l,i,{customRates})).filter(l=>lineKind(l)!=='item'&&lineKind(l)!=='deduction'?l.label||l.description:l.label||l.quantity!==null||l.unitPrice!==null);
  const out={clientId:text(v.clientId),clientName:text(v.clientName),clientAddress:text(v.clientAddress),clientSiren:text(v.clientSiren).replace(/\s/g,''),clientVat:text(v.clientVat).replace(/\s/g,'').toUpperCase(),issueDate:text(v.issueDate),dueDate:text(v.dueDate),note:text(v.note).slice(0,1000),lines};
  if(!out.clientName)return{error:'Champ obligatoire : Client',field:'Client'};
  if(out.clientSiren&&!/^\d{9}(\d{5})?$/.test(out.clientSiren))return{error:'SIREN du client invalide : 9 chiffres (ou SIRET 14).',field:'SIREN'};
  for(const [k,label] of [['issueDate','Date d’émission'],['dueDate','Échéance']])if(out[k]&&!validDay(out[k]))return{error:`${label} invalide.`,field:label};
  if(out.issueDate&&out.dueDate&&out.dueDate<out.issueDate)return{error:'L’échéance doit suivre la date d’émission.',field:'Échéance'};
  const bad=lines.findIndex(l=>amountLine(l)&&!l.label);if(bad>=0)return{error:`Champ obligatoire : Désignation (ligne ${bad+1})`,field:'Désignation'};
  // Remise de ligne hors de 0 à 100 % : refusée (cleanLine l’ignorerait sans le dire et le document ne correspondrait plus à la saisie).
  const badDisc=(v.lines||[]).findIndex(l=>{const d=amountLine(l)?loose(l?.discountPct):null;return d!==null&&(d<0||d>100);});if(badDisc>=0)return{error:`Remise ligne ${badDisc+1} : entre 0 et 100 %.`,field:'Remise'};
  // Champs étendus : seulement s’ils sont fournis (compatibilité avec l’ancien formulaire).
  // Un champ fourni vide (ou null) est effacé ; un champ absent n’est pas touché.
  const given=k=>v[k]!==undefined,has=k=>given(k)&&v[k]!==null&&v[k]!=='';
  if(given('clientKind'))out.clientKind=['pro','particulier'].includes(v.clientKind)?v.clientKind:'';
  for(const k of ['clientEmail','clientPhone','reference','subject'])if(given(k))out[k]=text(v[k]).slice(0,200);
  if(given('deliveryAddress'))out.deliveryAddress=text(v.deliveryAddress).slice(0,400);
  if(given('terms'))out.terms=text(v.terms).slice(0,4000);
  if(given('goodForAgreement'))out.goodForAgreement=!!v.goodForAgreement;
  for(const [k,label] of [['deliveryDate','Date de livraison ou de prestation'],['validUntil','Validité du devis']]){if(has(k)){if(!validDay(text(v[k])))return{error:`${label} invalide.`,field:label};out[k]=text(v[k]);}else if(given(k))out[k]=null;}
  if(out.validUntil&&out.issueDate&&out.validUntil<out.issueDate)return{error:'La validité du devis doit suivre sa date.',field:'Validité du devis'};
  if(given('operationNature'))out.operationNature=OPERATION_NATURES.some(([k])=>k===v.operationNature)?v.operationNature:'';
  if(given('vatExemption'))out.vatExemption=VAT_EXEMPTIONS[v.vatExemption]?v.vatExemption:'';
  if(v.discount!==undefined){const d=v.discount||{},val=loose(d.value);
    if(val===null||val===0)out.discount=null;
    else{if(val<0)return{error:'Remise globale négative.',field:'Remise'};if(d.type==='pct'&&val>100)return{error:'Remise globale supérieure à 100 %.',field:'Remise'};out.discount={type:d.type==='pct'?'pct':'amount',value:round2(val)};}}
  if(v.shipping!==undefined){const sh=v.shipping||{},amount=loose(sh.amount);
    if(amount===null||amount===0)out.shipping=null;
    else{if(amount<0&&docType!=='avoir')return{error:'Frais de port ou de déplacement négatifs.',field:'Frais'};const rate=loose(sh.vatRate);out.shipping={label:text(sh.label).slice(0,120)||'Frais de déplacement',amount:round2(amount),vatRate:vatRateOk(rate,customRates,false)?rate:20,...(VAT_EXEMPTIONS[sh.vatExemption]?{vatExemption:sh.vatExemption}:{})};}}
  if(v.installments!==undefined){
    const plan=cleanInstallments(v.installments);
    for(const [i,p] of plan.entries()){if(!validDay(p.date))return{error:`Échéancier : date invalide (échéance ${i+1}).`,field:'Échéancier'};if(p.amount===null||p.amount<=0)return{error:`Échéancier : montant invalide (échéance ${i+1}).`,field:'Échéancier'};}
    const sorted=[...plan].sort((a,b)=>a.date.localeCompare(b.date));
    if(sorted.length){const ttc=documentTotals({...out,lines}).ttc,sum=round2(sorted.reduce((s,p)=>s+p.amount,0));if(Math.abs(sum-ttc)>0.005)return{error:`Échéancier : la somme des échéances (${fr(sum)} €) diffère du total TTC (${fr(ttc)} €).`,field:'Échéancier'};if(out.issueDate&&sorted[0].date<out.issueDate)return{error:'Échéancier : la première échéance précède la date du document.',field:'Échéancier'};}
    out.installments=sorted.map(p=>({date:p.date,amount:round2(p.amount)}));
  }
  if(out.discount?.type==='amount'){const t=documentTotals({lines});if(out.discount.value>Math.abs(t.linesHt)+0.005)return{error:'La remise globale dépasse le total des lignes.',field:'Remise'};}
  return{value:out};
}

// ---------- Mentions légales et conformité ----------
const COMPANY_RE=/\b(sarl|sas|sasu|eurl|sa|snc|sca|scea|earl|gaec|sel|selarl|scop|cuma)\b/;
const COMMERCIAL_RE=/\b(sarl|sas|sasu|eurl|sa|snc|sca|selarl)\b/;
export const clientIsPro=doc=>doc.clientKind==='pro'||(doc.clientKind!=='particulier'&&!!(doc.clientSiren||doc.clientVat))?true:doc.clientKind==='particulier'?false:null;
// Vendeur d’un document : paramètres actuels pour un brouillon, instantané figé pour un document émis.
// Document émis par l’ancien code (sans legalMentions) : son instantané ne connaît ni modèle, ni escompte,
// ni régime, ni nature d’opération, ni capital, ni RCS ; on ne les complète pas avec les paramètres actuels
// (le duplicata doit reproduire l’original).
const LEGACY_SELLER={capital:'',rcs:'',escompte:'',vatRegime:'normal',operationNature:'services'};
export const legacyIssued=doc=>!!doc?.status&&doc.status!=='brouillon'&&!Array.isArray(doc.legalMentions);
export function issuedSeller(state,doc){
  const now=invoiceSettings(state);if(!doc?.status||doc.status==='brouillon')return now;
  const snap=doc.seller||{},base={logo:now.logo,accent:snap.accent||now.accent};
  if(!legacyIssued(doc))return{...now,...snap,...base,template:{...now.template,...(snap.template||{})}};
  return{...now,...LEGACY_SELLER,...snap,...base,template:{...templateOf({}),...(snap.template||{})}};
}
const sellerOf=issuedSeller;
const natureSentence=(nature,debits)=>`Opération : ${nature==='biens'?'livraisons de biens':nature==='mixte'?'livraisons de biens et prestations de services':'prestations de services'}.${debits?' Option pour le paiement de la taxe d’après les débits.':''}`;
// Mentions imprimées en pied de document (ordre stable : conditions, opération, TVA, livraison, libres).
export function legalMentions(state,doc,{seller=null,legacy=legacyIssued(doc)}={}){
  const s=seller||sellerOf(state,doc),t=docTypeOf(doc),out=[];
  // Document émis par l’ancien code : mêmes mentions qu’à l’origine (pénalités, opération, mention libre).
  if(legacy)return[t!=='avoir'?s.penalty||DEFAULT_PENALTY:'',natureSentence('services',!!s.vatOnDebits),s.mention].filter(Boolean);
  if(t!=='avoir'&&t!=='proforma')out.push(s.penalty||DEFAULT_PENALTY);
  if(s.escompte&&t!=='avoir')out.push(`Escompte : ${s.escompte}`);
  out.push(natureSentence(doc.operationNature||s.operationNature,s.vatOnDebits&&(doc.operationNature||s.operationNature)!=='biens'));
  const exemptions=new Set();
  if(s.vatRegime==='franchise')exemptions.add('franchise');if(s.vatRegime==='remboursement-forfaitaire')exemptions.add('forfaitaire');
  for(const l of doc.lines||[])if(amountLine(l)&&Number(l.vatRate)===0&&(l.vatExemption||doc.vatExemption))exemptions.add(l.vatExemption||doc.vatExemption);
  if(doc.shipping&&Number(doc.shipping.vatRate)===0&&(doc.shipping.vatExemption||doc.vatExemption))exemptions.add(doc.shipping.vatExemption||doc.vatExemption);
  for(const k of exemptions)out.push(VAT_EXEMPTIONS[k].mention);
  if(doc.deliveryAddress&&normalize(doc.deliveryAddress)!==normalize(doc.clientAddress))out.push(`Adresse de livraison : ${doc.deliveryAddress.replace(/\s*\n\s*/g,', ')}.`);
  if(t==='proforma')out.push('Facture pro forma : document sans valeur comptable, ne vaut pas facture.');
  if(s.mention)out.push(s.mention);
  if(s.template?.freeMentions)out.push(s.template.freeMentions);
  return out;
}
// Contrôle avant émission : erreurs bloquantes (mentions obligatoires) et avertissements.
export function complianceReport(state,doc,{today=isoDay()}={}){
  const s=invoiceSettings(state),t=docTypeOf(doc),accounting=ACCOUNTING_TYPES.has(t),errors=[],warnings=[];
  const lines=(doc.lines||[]).filter(amountLine),rates=[...lines.map(l=>Number(l.vatRate)),...(doc.shipping?[Number(doc.shipping.vatRate)]:[])];
  const regime=VAT_REGIMES.find(([k])=>k===s.vatRegime)[1],issue=doc.issueDate||today;
  if(s.vatRegime!=='normal'&&rates.some(r=>r>0))errors.push(`${regime} : facturez sans TVA (taux 0 %).`);
  if(s.vatRegime==='normal'){
    if(rates.some(r=>r>0)&&!s.vatNumber)errors.push('N° de TVA intracommunautaire du vendeur manquant (paramètres de facturation).');
    lines.forEach((l,i)=>{if(Number(l.vatRate)!==0)return;const ex=l.vatExemption||doc.vatExemption;if(!ex&&!s.mention)errors.push(`Motif d’exonération de TVA à préciser (ligne ${(doc.lines||[]).indexOf(l)+1||i+1}).`);if(ex==='intracom'&&!doc.clientVat)errors.push('Livraison intracommunautaire : n° de TVA du client obligatoire.');if(ex==='autoliquidation'&&!doc.clientVat&&!doc.clientSiren)warnings.push('Autoliquidation : indiquez le n° de TVA ou le SIREN du client.');});
  }
  const form=normalize(`${s.legalForm} ${s.capital}`);
  if(COMPANY_RE.test(form)&&!text(s.capital)&&!/capital/.test(form))warnings.push('Capital social non indiqué (ex. « EARL au capital de 7 500 € »).');
  if(COMMERCIAL_RE.test(form)&&!s.rcs)warnings.push('Mention RCS (ville du greffe) non indiquée.');
  const pro=clientIsPro(doc);
  if(accounting||t==='devis'){
    if(pro===true){
      if(!doc.clientSiren&&!sirenFromVat(doc.clientVat)){if(issue>=E_INVOICING_DATE)errors.push('SIREN du client professionnel obligatoire (facturation électronique).');else warnings.push('SIREN du client professionnel : mention obligatoire de la réforme de la facturation électronique, à renseigner.');}
      if(t!=='avoir'&&!/40\s*€|40 euros/.test(s.penalty))errors.push('Client professionnel : mentionnez l’indemnité forfaitaire de 40 € pour frais de recouvrement.');
    }else if(pro===null&&t!=='avoir'&&!/40\s*€|40 euros/.test(s.penalty))warnings.push('Indemnité forfaitaire de 40 € absente des conditions : obligatoire pour un client professionnel.');
    if(doc.clientSiren&&/^\d{9}(\d{5})?$/.test(doc.clientSiren)&&!luhnValid(doc.clientSiren))warnings.push('SIREN du client : la clé de contrôle ne correspond pas, vérifiez-le.');
  }
  const dated=!!(doc.deliveryDate||doc.periodStart||doc.periodEnd||lines.some(l=>l.date));
  // Livraison intracommunautaire : date de livraison ou période obligatoire (EN 16931, BR-IC-11).
  if(accounting&&!dated&&lines.some(l=>Number(l.vatRate)===0&&(l.vatExemption||doc.vatExemption)==='intracom'))errors.push('Livraison intracommunautaire : date de livraison (ou période de facturation) obligatoire.');
  else if(accounting&&!dated)warnings.push('Date de la livraison ou de la prestation non précisée : la date d’émission fera foi.');
  if(doc.issueDate&&doc.issueDate>today)warnings.push('Date d’émission postérieure à aujourd’hui.');
  if(t==='devis'&&!doc.validUntil)warnings.push('Durée de validité du devis non précisée.');
  return{errors,warnings,mentions:legalMentions(state,doc,{seller:s})};
}
// Contrôles supplémentaires avant émission (mentions obligatoires et montants complets).
export function emissionProblems(state,inv,docType=inv.docType||'facture',{today=isoDay()}={}){
  const p=[],settings=validateSettings(invoiceSettings(state)),t=DOC_TYPES.includes(docType)?docType:'facture',quote=t==='devis'||t==='proforma';
  if(settings.error)p.push(`Paramètres de facturation : ${settings.error.replace(/^Champ obligatoire : /,'champ manquant : ')}`);
  if(!inv.clientAddress)p.push('Champ obligatoire : Adresse du client');
  if(!inv.issueDate)p.push('Champ obligatoire : Date d’émission');
  if(!inv.dueDate&&!quote)p.push('Champ obligatoire : Échéance');
  if(!(inv.lines||[]).some(amountLine))p.push('Ajoutez au moins une ligne.');
  (inv.lines||[]).forEach((l,i)=>{if(!amountLine(l))return;const strict=t!=='avoir'&&lineKind(l)!=='deduction';if(l.quantity===null||(strict&&t==='facture'&&l.quantity<=0))p.push(`Quantité à saisir (ligne ${i+1})`);if(l.unitPrice===null)p.push(`Prix unitaire à saisir (ligne ${i+1})`);else if(strict&&l.unitPrice<0)p.push(`Prix unitaire négatif (ligne ${i+1}) : utilisez un avoir`);});
  const totals=documentTotals(inv);
  if(t==='avoir'&&!(totals.ttc<0))p.push('Un avoir doit avoir un total négatif.');
  if(t!=='avoir'&&totals.ttc<0)p.push('Total négatif : établissez un avoir.');
  if(!quote&&settings.value){
    const {lastDate,lastNumber}=allocateNumber(state,t,inv.issueDate||today);
    if(inv.issueDate&&lastDate&&inv.issueDate<lastDate)p.push(`Date d’émission antérieure à la dernière pièce de la série (${lastNumber} du ${dateFr(lastDate)}) : la numérotation doit rester chronologique.`);
  }
  const plan=installmentsOf(inv);if(plan.length&&Math.abs(round2(plan.reduce((s,x)=>s+x.amount,0))-totals.ttc)>0.005)p.push('Échéancier : la somme des échéances diffère du total TTC.');
  if(settings.value)p.push(...complianceReport(state,inv,{today}).errors);
  return p;
}

// ---------- Empreinte d’un document émis ----------
const FROZEN_FIELDS=['docType','number','issueDate','dueDate','deliveryDate','validUntil','clientName','clientAddress','clientSiren','clientVat','deliveryAddress','operationNature','lines','discount','shipping','installments','totals','seller','creditOf','quoteId'];
// Version 2 : s’y ajoutent les références et mentions légales ou fiscales (facture d’origine, devis, motif
// d’exonération, période, mentions). Un document émis avant garde la version 1 (empreinte inchangée).
export const FINGERPRINT_VERSION=2;
const FROZEN_FIELDS_V2=[...FROZEN_FIELDS,'creditOfNumber','quoteNumber','vatExemption','periodStart','periodEnd','legalMentions'];
const canon=v=>Array.isArray(v)?`[${v.map(canon).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`:JSON.stringify(v===undefined?null:v);
export function fingerprint(doc){
  const s=canon(Object.fromEntries((doc?.fingerprintVersion===2?FROZEN_FIELDS_V2:FROZEN_FIELDS).map(k=>[k,doc?.[k]??null])));let h1=0x811c9dc5,h2=0x9747b28c;
  for(let i=0;i<s.length;i+=1){const c=s.charCodeAt(i);h1=Math.imul(h1^c,0x01000193)>>>0;h2=Math.imul(h2^c,0x5bd1e995)>>>0;h2=(h2^(h2>>>15))>>>0;}
  return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
// true : intact ; false : modifié depuis l’émission ; null : document ancien sans empreinte.
export const fingerprintOk=doc=>doc?.fingerprint?fingerprint(doc)===doc.fingerprint:null;

// ---------- Écritures ----------
const KINDS=[INVOICE_KIND,QUOTE_KIND];
function current(store,id,kinds=KINDS){const inv=store.get('integrationImports',id);if(!inv||inv.deletedAt||!kinds.includes(inv.farmKind))throw Error(kinds.length===1&&kinds[0]===QUOTE_KIND?'Devis introuvable : il a peut-être été supprimé.':'Facture introuvable : elle a peut-être été supprimée.');return inv;}
export const getDocument=current;
const guardVersion=(inv,version)=>{if(version!==undefined&&version!==null&&inv.version!==undefined&&inv.version!==version)throw Error('La facture a changé entre-temps : rouvrez-la.');};
const SELLER_FIELDS=['legalName','legalForm','capital','rcs','address','siret','vatNumber','iban','bic','paymentDays','vatRate','prefix','penalty','mention','vatOnDebits','email','phone','accent','vatRegime','operationNature','escompte'];
export const sellerSnapshot=s=>({...Object.fromEntries(SELLER_FIELDS.map(k=>[k,s[k]])),template:{font:s.template.font,columns:s.template.columns,footer:s.template.footer,terms:s.template.terms,freeMentions:s.template.freeMentions}});

export async function saveSettings(store,values,{partial=false}={}){
  if(store.writeGuard&&!store.writeGuard({entity:'exploitation',action:'update',farmKind:'invoice'}))throw Error('Votre rôle ne permet pas de modifier les paramètres de facturation.');
  // Les champs absents (ancien formulaire) gardent leur valeur enregistrée.
  const checked=validateSettings({...(store.state?.exploitation?.invoicing||{}),...values},{partial});if(checked.error)throw Error(checked.error);
  return store.setExploitation({invoicing:checked.value},{farmKind:'invoice'});
}

export const clientSnapshot=c=>({clientId:c.id||null,clientName:text(c.name),clientAddress:text(c.billingAddress||c.address),clientSiren:text(c.siren).replace(/\s/g,''),clientVat:text(c.vatNumber).replace(/\s/g,'').toUpperCase(),clientKind:['pro','particulier'].includes(c.kind)?c.kind:'',clientEmail:text(c.billingEmail||c.email),clientPhone:text(c.phone)});
// Conditions par défaut d’une fiche client (v13) : échéance, remise et adresse de livraison, pour un document neuf seulement.
export const clientTerms=(c,settings,today,quote)=>{const days=loose(c?.paymentDays),pct=loose(c?.discountPct),out={};if(!quote&&days!==null&&days>=0&&days<=120)out.dueDate=addDays(today,Math.floor(days));if(pct!==null&&pct>0&&pct<=100)out.discount={type:'pct',value:round2(pct)};if(text(c?.deliveryAddress))out.deliveryAddress=text(c.deliveryAddress).slice(0,400);return out;};
// Brouillon de n’importe quel type. client : fiche existante (clientId) ou client ponctuel ({name, address…}).
export async function createDraft(store,{clientId,client=null,items=[],from='',to='',docType='facture',creditOf=null,lines=null,today=isoDay(),extra={},allowArchived=false,clientDefaults=false}){
  const t=DOC_TYPES.includes(docType)?docType:'facture',kind=kindOfDocType(t);
  if(!canWrite(store,'create',kind))throw Error('Votre rôle ne permet pas de créer des factures.');
  const state=store.state,found=clientId?active(state,'clients').find(c=>c.id===clientId):null,who=found||(client&&text(client.name)?client:null);
  if(!who)throw Error('Champ obligatoire : Client');
  if(found?.archived&&!allowArchived)throw Error('Client archivé : réactivez sa fiche pour lui établir un nouveau document.');
  const settings=invoiceSettings(state),keys=billedKeys(state);
  const chosen=lines||items.filter(it=>!keys.has(it.key)).map(it=>it.line);
  if(!lines&&chosen.length<items.length)throw Error('Une partie de ces prestations vient d’être facturée : rouvrez la préparation.');
  const clean=chosen.map((l,i)=>cleanLine({...l,id:`l${i+1}`},i,{customRates:settings.customVatRates}));
  const quote=kind===QUOTE_KIND,snap=clientSnapshot({...who,id:found?.id||null});
  const payload={docType:t,status:'brouillon',...snap,issueDate:today,dueDate:quote?null:addDays(today,settings.paymentDays),...(t==='devis'?{validUntil:addDays(today,settings.quoteValidityDays)}:{}),periodStart:from||null,periodEnd:to||null,lines:clean,totals:invoiceTotals(clean),creditOf:creditOf||null,number:null,note:'',name:`${DOC_LABELS[t]} (brouillon)`,...(clientDefaults&&t!=='avoir'?clientTerms(who,settings,today,quote):{}),...extra};
  payload.totals={...documentTotals(payload)};
  return saveFarmRecord(store,kind,payload,null);
}

export async function saveDraft(store,id,values,{version}={}){
  const inv=current(store,id);
  if(!canWrite(store,'update',inv.farmKind))throw Error('Votre rôle ne permet pas de modifier les factures.');
  if(inv.status!=='brouillon')throw Error('Une facture émise ne se modifie plus : corrigez-la par un avoir.');guardVersion(inv,version);
  const keep=Object.fromEntries(DOC_FIELDS.filter(k=>values[k]===undefined&&inv[k]!==undefined&&inv[k]!==null).map(k=>[k,inv[k]]));
  // v13 : un brouillon peut changer de client (fiche active) ; son identité est reprise de la fiche, sauf valeurs saisies.
  let clientId=inv.clientId;
  if(values.clientId!==undefined&&text(values.clientId)!==text(inv.clientId)){const c=active(store.state,'clients').find(x=>x.id===text(values.clientId));if(!c)throw Error('Client introuvable : il a peut-être été supprimé.');if(c.archived)throw Error('Client archivé : réactivez sa fiche pour lui établir un nouveau document.');if(inv.docType==='avoir')throw Error('Le client d’un avoir est celui de la facture d’origine.');const snap=clientSnapshot(c);clientId=c.id;for(const k of ['clientName','clientAddress','clientSiren','clientVat','clientKind','clientEmail','clientPhone'])if(values[k]===undefined)values={...values,[k]:snap[k]};}
  const settings=invoiceSettings(store.state),checked=validateDraft({...keep,...values,clientId},{customRates:settings.customVatRates,docType:docTypeOf(inv)});if(checked.error)throw Error(checked.error);
  if(inv.farmKind===INVOICE_KIND&&inv.docType!=='avoir'){const billed=billedKeys(store.state,{exceptId:id}),dup=checked.value.lines.find(l=>l.source&&billed.has(`${l.source.type}:${l.source.id}`));if(dup)throw Error(`Déjà facturé ailleurs : ${dup.label}`);}
  const v=checked.value,next={...inv,...v,clientId};
  return saveFarmRecord(store,inv.farmKind,{...v,clientId,totals:documentTotals(next)},inv);
}

export async function deleteDraft(store,id){
  const inv=current(store,id);
  if(!canWrite(store,'delete',inv.farmKind))throw Error('Votre rôle ne permet pas de supprimer les factures.');
  if(inv.status!=='brouillon')throw Error(inv.farmKind===QUOTE_KIND?'Un devis envoyé ne se supprime pas : marquez-le refusé ou laissez-le expirer.':'Une facture émise ne peut pas être supprimée : établissez un avoir.');
  await store.remove('integrationImports',id);return inv;
}

// Facture de solde émise (non annulée) qui déduit cet acompte.
export function depositDeductedIn(state,depositId,exceptId=null){
  return invoices(state).find(i=>i.id!==exceptId&&docTypeOf(i)==='facture'&&i.status!=='brouillon'&&invoiceStatus(i,state)!=='annulee'&&(i.lines||[]).some(l=>l.source?.type==='deposit'&&l.source.id===depositId))||null;
}
const depositCreditError=fin=>`Acompte déjà déduit sur la facture ${fin.number} : établissez l’avoir sur cette facture.`;
// Contrôle des montants liés : avoir ≤ reste de la facture, acomptes ≤ devis.
function linkedChecks(store,inv,t){
  const state=store.state;let base=null,quote=null;
  if(t==='avoir'){base=current(store,inv.creditOf,[INVOICE_KIND]);if(base.status==='brouillon'||!ACCOUNTING_TYPES.has(docTypeOf(base))||base.docType==='avoir')throw Error('La facture d’origine n’est pas émise.');const totals=documentTotals(inv);const already=creditNotesOf(state,base).reduce((s,a)=>s+Math.abs(num(a.totals?.ttc)||0),0);if(Math.abs(totals.ttc)+already>Math.abs(num(base.totals?.ttc)||0)+0.005)throw Error('L’avoir dépasse le montant restant de la facture.');
    // Acompte déjà déduit sur une facture de solde émise : l’annuler rembourserait deux fois le client.
    const fin=docTypeOf(base)==='acompte'?depositDeductedIn(state,base.id,inv.id):null;if(fin)throw Error(depositCreditError(fin));}
  if(t==='acompte'&&inv.quoteId){quote=current(store,inv.quoteId,[QUOTE_KIND]);const others=invoices(state).filter(a=>a.id!==inv.id&&a.docType==='acompte'&&a.quoteId===quote.id&&a.status!=='brouillon'&&invoiceStatus(a,state)!=='annulee').reduce((s,a)=>s+(num(a.totals?.ttc)||0),0);if(others+documentTotals(inv).ttc>(num(quote.totals?.ttc)||0)+0.005)throw Error('Les acomptes dépassent le montant du devis.');}
  if(t==='facture'||t==='acompte'){const billed=billedKeys(state,{exceptId:inv.id}),dup=(inv.lines||[]).find(l=>l.source&&billed.has(`${l.source.type}:${l.source.id}`));if(dup)throw Error(`Déjà facturé ailleurs : ${dup.label}`);
    for(const l of (inv.lines||[]).filter(x=>x.source?.type==='deposit')){const dep=store.get('integrationImports',l.source.id);if(!dep||dep.deletedAt||dep.docType!=='acompte'||dep.status==='brouillon')throw Error(`Acompte à déduire non émis : ${l.label}`);if(inv.clientId&&dep.clientId&&dep.clientId!==inv.clientId)throw Error('Acompte d’un autre client.');}}
  // Une seule facture (de solde) par devis, une seule facture par période d’un modèle récurrent : revérifié
  // ici, dans la file d’écriture, car deux préparations simultanées peuvent produire deux brouillons.
  if(t==='facture'){const live=i=>i.id!==inv.id&&docTypeOf(i)==='facture'&&i.status!=='brouillon'&&invoiceStatus(i,state)!=='annulee';
    if(inv.quoteId){const other=invoices(state).find(i=>live(i)&&i.quoteId===inv.quoteId);if(other)throw Error(`Ce devis est déjà facturé (${other.number}).`);}
    if(inv.scheduleId&&inv.periodStart){const other=invoices(state).find(i=>live(i)&&i.scheduleId===inv.scheduleId&&i.periodStart===inv.periodStart);if(other)throw Error(`La facture de cette période est déjà émise (${other.number}).`);}}
  if(inv.quoteId&&!quote)quote=store.get('integrationImports',inv.quoteId);
  return{base,quote};
}
// Émission : numéro définitif (sauf pro forma), figé avec l’identité du vendeur et du client, empreinte.
// Devis : numéro de la série des devis et statut « envoyé ». Plus aucune modification ensuite.
// Attribution du numéro sûre sur l’appareil : la lecture du dernier numéro et l’écriture se font dans la
// même étape de la file d’écriture du Store (enqueueWrite), donc deux émissions lancées en même temps
// (double clic, deux actions rapprochées) reçoivent deux numéros successifs, jamais le même. Une seule
// fenêtre écrit (verrou parcelles-writer). Limite : deux appareils HORS LIGNE peuvent attribuer le même
// numéro ; la synchronisation garde les deux pièces et numberingIssues() signale le doublon (à corriger
// par un avoir sur l’une et une nouvelle émission).
function serializedWrite(store,fn){
  if(typeof store.enqueueWrite==='function'&&typeof store._upsert==='function')return store.enqueueWrite(()=>fn((type,entity,options)=>store._upsert(type,entity,options)));
  return fn((type,entity,options)=>store.upsert(type,entity,options));
}
export async function emitDocument(store,id,{version,today=isoDay()}={}){
  const first=current(store,id);
  if(!canWrite(store,'update',first.farmKind))throw Error('Votre rôle ne permet pas d’émettre des factures.');
  return serializedWrite(store,async upsert=>{
    const inv=current(store,id),t=docTypeOf(inv);
    if(inv.status!=='brouillon')throw Error(inv.farmKind===QUOTE_KIND?'Ce document est déjà envoyé.':'Cette facture est déjà émise.');guardVersion(inv,version);
    const state=store.state,date=inv.issueDate||today,problems=emissionProblems(state,{...inv,issueDate:date},t,{today});if(problems.length)throw Error(problems[0]);
    const {base,quote}=linkedChecks(store,inv,t);
    const settings=invoiceSettings(state),seller=sellerSnapshot(settings);// Le logo reste dans les paramètres : pas de copie de l’image dans chaque facture.
    const n=t==='proforma'?{number:null,sequence:null,series:null}:allocateNumber(state,t,date,{settings});
    const patch={status:kindOfDocType(t)===QUOTE_KIND?'envoye':'emise',number:n.number,sequence:n.sequence,series:n.series,name:`${DOC_LABELS[t]} ${n.number||'pro forma'}`,issueDate:date,totals:documentTotals(inv),seller,emittedAt:Date.now(),
      legalMentions:legalMentions(state,{...inv,status:'emise',seller},{seller:{...settings,...seller},legacy:false}),...(base?{creditOfNumber:base.number}:{}),...(quote?{quoteNumber:quote.number||null}:{})};
    patch.fingerprintVersion=FINGERPRINT_VERSION;patch.fingerprint=fingerprint({...inv,...patch});
    const record={...inv,...patch};
    if(new TextEncoder().encode(JSON.stringify(record)).length>700000)throw Error('Document trop volumineux : réduisez le nombre de lignes.');
    return upsert('integrationImports',record,{label:`${DOC_LABELS[t]} ${n.number||'pro forma'} ${t==='devis'?'envoyé':'émis'}`});
  });
}
export const emitInvoice=emitDocument;

// Après émission, seuls ces champs évoluent (suivi) ; le reste est figé.
const MUTABLE_AFTER_EMISSION=new Set(['payments','paidAt','paymentMethod','reminders','sentLog','status','acceptance','refusal','conversions','followUp']);
export async function patchEmitted(store,id,patch,{label='Document mis à jour.'}={}){
  const inv=current(store,id);
  if(!canWrite(store,'update',inv.farmKind))throw Error('Votre rôle ne permet pas de modifier les factures.');
  if(inv.status==='brouillon')throw Error('Document en brouillon : enregistrez-le normalement.');
  const frozen=Object.keys(patch).find(k=>!MUTABLE_AFTER_EMISSION.has(k));if(frozen)throw Error(`Document émis : « ${frozen} » est figé. Établissez un avoir pour corriger.`);
  if(patch.status!==undefined&&inv.farmKind!==QUOTE_KIND)throw Error('Le statut d’une facture se déduit de ses paiements.');
  return store.upsert('integrationImports',{...inv,...patch},{label});
}
const methodKey=m=>{const n=normalize(m);const hit=PAYMENT_METHODS.find(([k,l])=>k===m||normalize(l)===n);return hit?hit[0]:n?'autre':'';};
export const methodLabel=k=>PAYMENT_METHODS.find(([x])=>x===k)?.[1]||'Autre';
// Paiement partiel ou total ; montant négatif = remboursement d’un trop-perçu.
export async function addPayment(store,id,{date=isoDay(),amount,method='virement',reference='',fromId=null}={}){
  const inv=current(store,id,[INVOICE_KIND]);if(inv.status==='brouillon'||inv.docType==='avoir')throw Error('Un paiement s’enregistre sur une facture émise.');
  if(!validDay(date))throw Error('Date de paiement invalide.');
  const a=loose(amount);if(a===null||a===0)throw Error('Montant du paiement invalide.');
  const b=invoiceBalance(store.state,inv);if(a<0&&-a>b.overpaid+0.005)throw Error('Un remboursement ne peut pas dépasser le trop-perçu.');
  const existing=b.legacy?[{id:'p-ancien',date:inv.paidAt,amount:b.net,method:methodKey(inv.paymentMethod),reference:''}]:paymentsOf(inv).map(p=>({...p}));
  const mk=methodKey(method),key=a<0?(mk==='compensation'?'compensation':'remboursement'):mk||'virement';
  const payments=[...existing,{id:uid('pay'),date,amount:round2(a),method:key,reference:text(reference).slice(0,80),...(fromId?{fromId:text(fromId)}:{}),at:Date.now()}];
  return patchEmitted(store,id,paidPatch(store.state,inv,payments),{label:`${a<0?'Remboursement':'Paiement'} enregistré : ${inv.number}`});
}
function paidPatch(state,inv,payments){
  const after=invoiceBalance(state,{...inv,payments,paidAt:null}),done=payments.length&&after.due<=0.005;
  const last=[...payments].sort((x,y)=>String(x.date).localeCompare(String(y.date))).pop();
  return{payments,paidAt:done?after.lastPayment:null,paymentMethod:done&&last?methodLabel(last.method):null};
}
export async function removePayment(store,id,paymentId){
  const inv=current(store,id,[INVOICE_KIND]),payments=paymentsOf(inv).filter(p=>!p.legacy&&p.id!==paymentId);
  return patchEmitted(store,id,paidPatch(store.state,inv,payments),{label:`Paiement retiré : ${inv.number}`});
}
// Ancien bouton « Payée le » : solde la facture en un paiement (ou retire tous les paiements).
export async function markPaid(store,id,{paidAt=isoDay(),method=''}={}){
  if(!canWrite(store))throw Error('Votre rôle ne permet pas de modifier les factures.');
  const inv=current(store,id,[INVOICE_KIND]);if(inv.status==='brouillon'||inv.docType==='avoir')throw Error('Seule une facture émise peut être marquée payée.');
  if(paidAt!==null&&!validDay(paidAt))throw Error('Date de paiement invalide.');
  if(!paidAt)return store.upsert('integrationImports',{...inv,payments:[],paidAt:null,paymentMethod:null},{label:`Paiement retiré : ${inv.number}`});
  const b=invoiceBalance(store.state,inv),payments=b.legacy?[]:paymentsOf(inv).map(p=>({...p}));
  const rest=round2(b.legacy?b.net:b.due);if(rest>0)payments.push({id:uid('pay'),date:paidAt,amount:rest,method:methodKey(method)||'virement',reference:'',at:Date.now()});
  return store.upsert('integrationImports',{...inv,payments,paidAt,paymentMethod:text(method)||null},{label:`Facture ${inv.number} payée`});
}

// Avoir : reprend les lignes de la facture en montants négatifs (modifiables tant qu’il est en brouillon).
// lines : avoir partiel (lignes choisies, quantités positives ou négatives, toujours inversées).
export async function createCreditNote(store,id,{today=isoDay(),lines=null}={}){
  const inv=current(store,id,[INVOICE_KIND]);if(inv.status==='brouillon'||inv.docType==='avoir')throw Error('Un avoir se crée depuis une facture émise.');
  if(creditedShare(store.state,inv)>=0.999)throw Error('Cette facture est déjà entièrement annulée par avoir.');
  const pending=invoices(store.state).find(a=>a.docType==='avoir'&&a.creditOf===inv.id&&a.status==='brouillon');if(pending)return pending;
  if(inv.docType==='acompte'){const fin=depositDeductedIn(store.state,inv.id);if(fin)throw Error(depositCreditError(fin));}
  const neg=(lines||inv.lines||[]).map(l=>{if(!amountLine(l))return{...l};const q=loose(l.quantity);return{...l,quantity:q===null?null:-Math.abs(q)};});
  const client={name:inv.clientName,address:inv.clientAddress,siren:inv.clientSiren,vatNumber:inv.clientVat,kind:inv.clientKind,email:inv.clientEmail,phone:inv.clientPhone};
  const exists=active(store.state,'clients').some(c=>c.id===inv.clientId);
  // Avoir partiel : la remise globale s’applique aussi aux lignes reprises (en %, telle quelle ; en
  // montant, au prorata du HT des lignes reprises). Les frais restent à reprendre à la main.
  const dv=loose(inv.discount?.value),linesHt=Math.abs(documentTotals({lines:inv.lines||[]}).linesHt);
  const discount=!(dv>0)?null:!lines||inv.discount.type==='pct'?inv.discount:linesHt>0?{...inv.discount,value:round2(dv*Math.min(1,Math.abs(documentTotals({lines:neg}).linesHt)/linesHt))}:null;
  const extra={...(discount?{discount}:{}),...(inv.shipping&&!lines?{shipping:{...inv.shipping,amount:-Math.abs(inv.shipping.amount)}}:{}),...(inv.vatExemption?{vatExemption:inv.vatExemption}:{}),...(inv.operationNature?{operationNature:inv.operationNature}:{}),...Object.fromEntries(['deliveryDate','periodStart','periodEnd'].filter(k=>inv[k]).map(k=>[k,inv[k]]))};
  const draft=await createDraft(store,{clientId:exists?inv.clientId:null,client,docType:'avoir',creditOf:inv.id,lines:neg,today,allowArchived:true,extra});
  return store.upsert('integrationImports',{...draft,clientId:inv.clientId||null,clientName:inv.clientName,clientAddress:inv.clientAddress,clientSiren:inv.clientSiren||'',clientVat:inv.clientVat||'',dueDate:draft.dueDate,note:`Avoir sur la facture ${inv.number}.`,totals:documentTotals({...draft,...extra})},{label:'Avoir préparé'});
}

// ---------- Export comptable ----------
const csvCell=v=>{const s=String(v??'');return/[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
const dec=v=>num(v)===null?'':String(round2(v)).replace('.',',');
export function invoicesCsv(state,{from='',to=''}={}){
  const head=['Date','Numéro','Type','Client','SIREN client','Taux TVA','Base HT','TVA','TTC','Échéance','Statut','Payée le','Facture d’origine','Encaissé','Reste dû'];
  const rows=invoices(state).filter(i=>i.status!=='brouillon'&&inPeriod(i.issueDate,from,to)).sort((a,b)=>String(a.issueDate).localeCompare(String(b.issueDate))||String(a.number).localeCompare(String(b.number)));
  const out=[head];
  for(const i of rows){const t=i.totals||invoiceTotals(i.lines),status=STATUS_LABELS[invoiceStatus(i,state)],avoir=i.docType==='avoir',b=avoir?null:invoiceBalance(state,i);
    (t.byRate.length?t.byRate:[{rate:0,base:0,tax:0}]).forEach((r,k)=>out.push([i.issueDate,i.number,DOC_LABELS[docTypeOf(i)],i.clientName,i.clientSiren||'',dec(r.rate),dec(r.base),dec(r.tax),dec(round2(r.base+r.tax)),i.dueDate||'',status,i.paidAt||'',i.creditOfNumber||'',b&&!k?dec(b.paid):'',b&&!k?dec(b.due):'']));}
  return'﻿'+out.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
export const sortInvoices=list=>[...list].sort((a,b)=>(a.status==='brouillon'?0:1)-(b.status==='brouillon'?0:1)||String(b.issueDate||'').localeCompare(String(a.issueDate||''))||String(b.number||'').localeCompare(String(a.number||'')));
export const clientKey=c=>normalize(c?.name);

// ---------- Document imprimable (A4) ----------
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const NB=' ';
const money=v=>num(v)===null?'—':`${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v).replace(/[  ]/g,NB).replace(/^-/,'−')}${NB}€`;
const qty=v=>num(v)===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(v).replace(/[  ]/g,NB).replace(/^-/,'−');
const pctRate=r=>`${String(r).replace('.',',')}${NB}%`;
export const dateFr=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'—';};
const lines2=v=>esc(v).replace(/\n/g,'<br>');
// Contenu affichable d’une facture, partagé par l’aperçu HTML et le PDF (même hiérarchie, mêmes textes).
export const invoiceMoney=money,invoiceQty=qty;
export function invoiceView(state,inv){
  const draft=inv.status==='brouillon',t=docTypeOf(inv),settingsNow=invoiceSettings(state);
  const seller=draft?settingsNow:issuedSeller(state,inv);
  const tot=draft?documentTotals(inv):inv.totals||documentTotals(inv);
  const avoir=t==='avoir',quote=t==='devis'||t==='proforma',kind=DOC_LABELS[t],number=inv.number||(t==='proforma'&&!draft?'Pro forma':'Brouillon');
  const status=draft?'':invoiceStatus(inv,state),paid=!avoir&&!quote&&!draft&&inv.paidAt;
  const credits=!avoir&&!quote&&!draft?creditNotesOf(state,inv):[],creditTotal=round2(credits.reduce((s,a)=>s+(num(a.totals?.ttc)||0),0));
  const split=v=>String(v||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const period=inv.periodStart||inv.periodEnd?(inv.periodStart&&inv.periodEnd?`${dateFr(inv.periodStart)} – ${dateFr(inv.periodEnd)}`:inv.periodStart?`depuis le ${dateFr(inv.periodStart)}`:`jusqu’au ${dateFr(inv.periodEnd)}`):'';
  const meta=[[quote?'Date':'Date d’émission',dateFr(inv.issueDate)],!avoir&&!quote&&['Échéance',dateFr(inv.dueDate)],t==='devis'&&inv.validUntil&&['Valable jusqu’au',dateFr(inv.validUntil)],inv.deliveryDate&&['Date de prestation',dateFr(inv.deliveryDate)],period&&['Période',period],
    avoir&&inv.creditOfNumber&&['Facture d’origine',inv.creditOfNumber],inv.quoteNumber&&['Devis',inv.quoteNumber],inv.reference&&['Votre référence',inv.reference]].filter(Boolean);
  const ids=[`SIRET ${seller.siret||'à compléter'}`,seller.vatNumber?`TVA ${seller.vatNumber}`:''].filter(Boolean).join(' · ');
  const sellerLines=[[seller.legalForm,seller.capital&&!/capital/i.test(seller.legalForm)?`au capital de ${seller.capital}`:''].filter(Boolean).join(' '),...split(seller.address||'Adresse à compléter'),ids,seller.rcs?`RCS ${seller.rcs.replace(/^RCS\s*/i,'')}`:'',[seller.phone,seller.email].filter(Boolean).join(' · ')].filter(Boolean);
  const clientLines=[...split(inv.clientAddress||'Adresse à compléter'),inv.clientSiren?`SIREN ${inv.clientSiren}`:'',inv.clientVat?`TVA ${inv.clientVat}`:''].filter(Boolean);
  const subs=runningSubtotals(inv.lines||[]),cols=seller.template?.columns||{date:true,unit:true,vat:true,discount:true};
  const rows=(inv.lines||[]).map(l=>{const k=lineKind(l);
    if(k==='section')return{kind:k,date:'',label:text(l.label),qty:'',unit:'',price:'',vat:'',total:''};
    if(k==='subtotal')return{kind:k,date:'',label:text(l.label)||'Sous-total',qty:'',unit:'',price:'',vat:'',total:money(subs.get(l.id))};
    if(k==='comment')return{kind:k,date:'',label:[text(l.label),text(l.description)].filter(Boolean).join(' — '),qty:'',unit:'',price:'',vat:'',total:''};
    const ex=Number(l.vatRate)===0&&(l.vatExemption||inv.vatExemption);
    return{kind:k,date:cols.date&&l.date?dateFr(l.date):'',label:[text(l.label),text(l.description)].filter(Boolean).join(' — '),qty:qty(l.quantity),unit:cols.unit?(l.unit==='forfait'?'forf.':text(l.unit)):'',price:`${money(l.unitPrice)}${cols.discount&&l.discountPct?` −${String(l.discountPct).replace('.',',')}${NB}%`:''}`,vat:ex?'Exo.':pctRate(l.vatRate),total:money(lineTotal(l))};});
  const totals=[[tot.discount||tot.shipping||tot.deductions?.ht?'Total des lignes HT':'Total HT',money(tot.discount||tot.shipping||tot.deductions?.ht?tot.linesHt:tot.ht)],
    ...(tot.discount?[[inv.discount?.type==='pct'?`Remise ${String(inv.discount.value).replace('.',',')}${NB}%`:'Remise',money(-tot.discount)]]:[]),...(tot.shipping?[[text(inv.shipping?.label)||'Frais',money(tot.shipping)]]:[]),
    ...(tot.deductions?.ht?[['Acomptes déduits HT',money(-tot.deductions.ht)]]:[]),...(tot.discount||tot.shipping||tot.deductions?.ht?[['Total HT',money(tot.ht)]]:[]),
    ...tot.byRate.map(r=>[`TVA ${pctRate(r.rate)} sur ${money(r.base)}`,money(r.tax)])];
  const grand=[avoir?'Total TTC de l’avoir':t==='devis'?'Total TTC du devis':'Total TTC',money(tot.ttc)];
  const b=!avoir&&!quote&&!draft?invoiceBalance(state,inv):null,partial=b&&!b.legacy&&b.paid>0&&!inv.paidAt;
  const after=[...(credits.length?[[`Avoirs (${credits.map(a=>a.number).join(', ')})`,money(creditTotal)],['Net à payer',money(round2(tot.ttc+creditTotal))]]:[]),...(partial?[['Déjà réglé',money(-b.paid)],['Reste à payer',money(b.due)]]:[])];
  const iban=seller.iban?seller.iban.replace(/(.{4})/g,'$1 ').trim():'';
  const plan=installmentsOf(inv);
  const terms=avoir?{title:'Avoir',lines:[`Avoir sur la facture ${inv.creditOfNumber||''} : ce montant vient en déduction de la facture d’origine.`],bank:[]}
    :t==='devis'?{title:'Validité',lines:[inv.validUntil?`Devis valable jusqu’au ${dateFr(inv.validUntil)}.`:'Devis valable 30 jours.',...(inv.acceptance?[`Accepté le ${dateFr(inv.acceptance.date)} par ${inv.acceptance.signatory}${inv.acceptance.goodForAgreement?' (« Bon pour accord »)':''}.`]:[])],bank:[]}
    :t==='proforma'?{title:'Pro forma',lines:['Document préalable, sans valeur comptable.'],bank:iban?[['IBAN',iban],...(seller.bic?[['BIC',seller.bic]]:[])]:[]}
    :{title:'Règlement',lines:[...(plan.length?plan.map((p,i)=>`Échéance ${i+1} : ${money(p.amount)} le ${dateFr(p.date)}.`):[`À régler au plus tard le ${dateFr(inv.dueDate)}${iban?' par virement bancaire':''}.`]),...(paid?[`Payée le ${dateFr(inv.paidAt)}${inv.paymentMethod?` · ${inv.paymentMethod}`:''}.`]:[])],bank:iban?[['IBAN',iban],...(seller.bic?[['BIC',seller.bic]]:[])]:[]};
  const legal=!draft&&Array.isArray(inv.legalMentions)?inv.legalMentions:legalMentions(state,inv,{seller});
  const stamp=draft?{text:'Brouillon · sans valeur',tone:'draft'}:paid?{text:`Payée le ${dateFr(inv.paidAt)}`,tone:'paid'}:status==='annulee'?{text:'Annulée par avoir',tone:'draft'}:status==='accepte'||status==='converti'?{text:`Accepté le ${dateFr(inv.acceptance?.date)}`,tone:'paid'}:status==='refuse'?{text:'Refusé',tone:'draft'}:null;
  const footer=seller.template?.footer||[seller.legalName,seller.legalForm,`SIRET ${seller.siret||'—'}`,seller.vatNumber?`TVA ${seller.vatNumber}`:''].filter(Boolean).join(' · ');
  const agreement=t==='devis'&&inv.goodForAgreement!==false&&!inv.acceptance?['Date, nom et signature du client, précédés de la mention « Bon pour accord » :']:[];
  return{draft,avoir,quote,docType:t,kind,number,title:`${kind} ${number} · ${inv.clientName||''}`,seller,accent:accentOf(seller.accent),logo:seller.logo||'',font:seller.template?.font||'sans',sellerName:seller.legalName||'Raison sociale à compléter',sellerLines,meta,stamp,clientLabel:avoir||quote?'Client':'Facturé à',clientName:inv.clientName||'Client',clientLines,rows,totals,grand,after,missing:tot.missing,terms,legal,note:text(inv.note),conditions:text(inv.terms||seller.template?.terms),agreement,footer,status:status&&status!=='avoir'?STATUS_LABELS[status]:'',totalsRaw:tot};
}
export function invoiceFileName(inv){
  const kind=DOC_LABELS[docTypeOf(inv)].replace('’',"'"),n=inv.number||'brouillon',client=text(inv.clientName);
  return`${kind} ${n}${client?` - ${client}`:''}.pdf`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
}
const FONT_CSS={sans:'',serif:".inv-doc{font-family:'Instrument Serif',Georgia,serif}",mono:'.inv-doc{font-family:ui-monospace,Menlo,Consolas,monospace}'};
// qrSvg : QR code de virement SEPA déjà dessiné (billing-export.js), placé dans l’encadré de règlement.
export function invoiceHtml(state,inv,{assetBase='',qrSvg=''}={}){
  const v=invoiceView(state,inv),showVat=v.seller.template?.columns?.vat!==false;
  const css=printCss({assetBase,footer:`${v.seller.legalName} · ${v.kind} ${v.number}`,cover:false})+`
.inv-doc{--acc:${v.accent};border-top:6px solid var(--acc);position:relative}
.inv-top{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:20px;align-items:start;padding-bottom:14px;border-bottom:1px solid var(--rule)}
.inv-brand{display:flex;flex-direction:column;gap:2px;min-width:0}.inv-logo{display:block;max-width:58mm;max-height:22mm;width:auto;height:auto;object-fit:contain;margin-bottom:8px}
.inv-name{font:600 15pt/1.15 'Instrument Sans',system-ui,sans-serif;color:var(--ink)}.inv-brand p{margin:0;font-size:9pt;color:var(--muted)}
.inv-title{text-align:right}.inv-title h1{margin:0;font:700 24pt/1 'Instrument Sans',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--acc)}
.inv-no{margin:6px 0 0;font-weight:700;font-size:12pt}
.inv-title dl{display:grid;grid-template-columns:auto auto;justify-content:end;gap:3px 14px;margin:10px 0 0;font-size:9.5pt}.inv-title dt{color:var(--muted)}.inv-title dd{margin:0;font-weight:600;text-align:right}
.inv-stamp{display:inline-block;margin-top:8px;padding:3px 10px;border:1.5px solid currentColor;border-radius:6px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:8.5pt}.inv-stamp.is-draft{color:#9b3b2e}.inv-stamp.is-paid{color:#2f6b4a}
.inv-parties{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin:16px 0 14px}
.inv-box{border:1px solid var(--rule);border-radius:10px;padding:10px 12px;background:#fff}.inv-box small{display:block;color:var(--acc);text-transform:uppercase;letter-spacing:.1em;font-size:7.5pt;font-weight:700;margin-bottom:4px}.inv-box p{margin:0;font-size:9.5pt}.inv-box strong{font-size:11pt}
.inv-client{border-color:var(--acc);border-width:1.5px}
.inv-table thead th{background:var(--acc);color:#fff;border-bottom:0;padding:7px 6px;font-size:7.5pt}.inv-table thead th:first-child{border-radius:6px 0 0 0}.inv-table thead th:last-child{border-radius:0 6px 0 0}
.inv-table tbody tr:nth-child(even) td{background:#f6f4ee}.inv-table td{border-bottom:1px solid #e6e1d4}.inv-table td small{display:block;color:var(--muted);font-size:8pt}.inv-table td.n{font-variant-numeric:tabular-nums}
.inv-bottom{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;margin-top:6px;break-inside:avoid}
.inv-pay p{margin:0 0 4px}.inv-bank{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0 0;font-size:9pt}.inv-bank dt{color:var(--muted)}.inv-bank dd{margin:0;font-weight:600;letter-spacing:.02em}
.inv-totals table{margin:0;font-size:9.5pt}.inv-totals td{padding:4px 8px;border-bottom:1px solid #ece7db}.inv-totals tr.is-grand td{background:var(--acc);color:#fff;font-weight:700;font-size:12.5pt;border:0;padding:8px}.inv-totals tr.is-grand td:first-child{border-radius:8px 0 0 8px}.inv-totals tr.is-grand td:last-child{border-radius:0 8px 8px 0}
.inv-totals tr.is-net td{font-weight:700}
.inv-note{margin:0;padding:10px 12px;border-left:3px solid var(--acc);background:var(--soft);border-radius:0 8px 8px 0;font-size:9.5pt}
.inv-legal{font-size:8pt;color:var(--muted);border-top:1px solid var(--rule);padding-top:8px;margin-top:16px}.inv-legal p{margin:0 0 4px}
.inv-draft-mark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font:700 92pt 'Instrument Sans',system-ui,sans-serif;letter-spacing:.1em;color:rgba(155,59,46,.09);transform:rotate(-30deg);z-index:1}
@media (max-width:640px){.inv-top,.inv-parties,.inv-bottom{grid-template-columns:1fr}.inv-title{text-align:left}.inv-title dl{justify-content:start}.inv-title dd{text-align:left}.inv-title h1{font-size:20pt}}
@media print{.inv-table thead th,.inv-totals tr.is-grand td,.inv-table tbody tr:nth-child(even) td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.inv-table tr.is-section td{font-weight:700;color:var(--acc);background:transparent}.inv-table tr.is-subtotal td{font-weight:700}.inv-table tr.is-comment td{font-style:italic;color:var(--muted)}
.inv-qr{display:flex;align-items:center;gap:8px;margin-top:8px}.inv-qr svg{width:26mm;height:26mm;flex:none}.inv-qr small{font-size:7.5pt;color:var(--muted)}
.inv-cgv{font-size:7.5pt;color:var(--muted);margin-top:10px;white-space:pre-line}.inv-sign{margin-top:14px;border:1px dashed var(--rule);border-radius:10px;padding:10px 12px;min-height:22mm;font-size:9pt}${FONT_CSS[v.font]||''}`;
  const sellerBlock=`<div class="inv-brand">${v.logo?`<img class="inv-logo" src="${esc(v.logo)}" alt="${esc(`Logo ${v.sellerName}`)}">`:''}<strong class="inv-name">${esc(v.sellerName)}</strong>${v.sellerLines.map(l=>`<p>${esc(l)}</p>`).join('')}</div>`;
  const head=`<header class="inv-top">${sellerBlock}<div class="inv-title"><h1>${v.kind}</h1><p class="inv-no">N° ${esc(v.number)}</p>${v.stamp?`<span class="inv-stamp is-${v.stamp.tone}">${esc(v.stamp.text)}</span>`:''}<dl>${v.meta.map(([k,x])=>`<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></div></header>`;
  const parties=`<section class="inv-parties"><div class="inv-box inv-pay"><small>${esc(v.terms.title)}</small>${v.terms.lines.map(l=>`<p>${esc(l)}</p>`).join('')}${v.terms.bank.length?`<dl class="inv-bank">${v.terms.bank.map(([k,x])=>`<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>`:''}${qrSvg&&/^<svg[\s>]/.test(qrSvg)?`<div class="inv-qr">${qrSvg}<small>Virement SEPA : scannez avec l’application de votre banque.</small></div>`:''}</div><div class="inv-box inv-client"><small>${esc(v.clientLabel)}</small><p><strong>${esc(v.clientName)}</strong></p>${v.clientLines.map(l=>`<p>${esc(l)}</p>`).join('')}</div></section>`;
  const cols=showVat?5:4;
  const rows=v.rows.map(r=>r.kind==='section'||r.kind==='comment'?`<tr class="is-${r.kind}"><td colspan="${cols}">${esc(r.label)}</td></tr>`:r.kind==='subtotal'?`<tr class="is-subtotal"><td colspan="${cols-1}">${esc(r.label)}</td><td class="n">${esc(r.total)}</td></tr>`
    :`<tr><td>${esc(r.label)}${r.date?`<small>${esc(r.date)}</small>`:''}</td><td class="n">${esc(r.qty)}${r.unit?`${NB}${esc(r.unit)}`:''}</td><td class="n">${esc(r.price)}</td>${showVat?`<td class="n">${esc(r.vat)}</td>`:''}<td class="n">${esc(r.total)}</td></tr>`).join('');
  const table=`<div class="dz-wide"><table class="inv-table"><thead><tr><th>Désignation</th><th class="n">Quantité</th><th class="n">PU HT</th>${showVat?'<th class="n">TVA</th>':''}<th class="n">Montant HT</th></tr></thead><tbody>${rows||`<tr><td colspan="${cols}" class="muted">Aucune ligne.</td></tr>`}</tbody></table></div>`;
  const totals=`<div class="inv-totals"><table><tbody>${v.totals.map(([k,x])=>`<tr><td>${esc(k)}</td><td class="n">${esc(x)}</td></tr>`).join('')}<tr class="is-grand"><td>${esc(v.grand[0])}</td><td class="n">${esc(v.grand[1])}</td></tr>${v.after.map(([k,x],i)=>`<tr${i?' class="is-net"':''}><td>${esc(k)}</td><td class="n">${esc(x)}</td></tr>`).join('')}</tbody></table>${v.missing?`<p class="dz-note">${v.missing} ligne${v.missing>1?'s':''} sans prix : non comptée${v.missing>1?'s':''}.</p>`:''}</div>`;
  const bottom=`<section class="inv-bottom"><div>${v.note?`<p class="inv-note"><strong>Note</strong><br>${lines2(v.note)}</p>`:''}</div>${totals}</section>`;
  const sign=v.agreement.length?`<div class="inv-sign">${v.agreement.map(l=>`<p>${esc(l)}</p>`).join('')}</div>`:'';
  const legal=`<div class="inv-legal">${v.legal.map(l=>`<p>${esc(l)}</p>`).join('')}${v.conditions?`<div class="inv-cgv"><strong>Conditions générales</strong>\n${esc(v.conditions)}</div>`:''}</div>`;
  const body=`${v.draft?'<div class="inv-draft-mark" aria-hidden="true">Brouillon</div>':''}<main class="page inv-doc"><div class="dz-body">${head}${parties}${table}${bottom}${sign}${legal}</div><footer class="dz-foot"><span>${esc(v.footer)}</span><span>${esc(v.kind)} ${esc(v.number)}${v.status?` · ${esc(v.status)}`:''}</span></footer></main>`;
  return printDocument({title:v.title,css,body});
}
