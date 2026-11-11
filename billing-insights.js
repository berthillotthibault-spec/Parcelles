// Facturation (vague 13) : suivi et aide à la saisie, en logique pure et sans réseau.
// Tableau de bord (CA facturé et encaissé, en-cours, balance âgée, délai de paiement, devis), relances
// dues, prévision d’encaissements par semaine, prix suggéré, prestations oubliées, doublons probables,
// clients à risque et saisie rapide en français. Rien n’est jamais écrit : tout résultat est une
// proposition que l’utilisateur valide. Chargé à la demande.
import {normalize} from './utils.js';
import {active} from './farm-memory.js';
import {ACCOUNTING_TYPES,addDays,addMonths,billableItems,billingDocs,daysBetween,docTypeOf,documentTotals,expectedReceipts,invoiceBalance,invoiceSettings,invoiceStatus,invoices,isoDay,lineTotal,paymentsOf,quoteStatus,quotes,round2,amountLine,VAT_RATES_ALL} from './invoices.js';
import {catalogItems,catalogPrice,dueSchedules,findCatalogItem} from './billing.js';

const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const ttcOf=d=>num(d.totals?.ttc)??documentTotals(d).ttc;
const htOf=d=>num(d.totals?.ht)??documentTotals(d).ht;
const month=d=>String(d||'').slice(0,7);
const inRange=(d,from,to)=>!!d&&(!from||d>=from)&&(!to||d<=to);
const emitted=state=>invoices(state).filter(i=>i.status!=='brouillon'&&ACCOUNTING_TYPES.has(docTypeOf(i)));
const clientKeyOf=d=>d.clientId||`nom:${normalize(d.clientName)}`;
// Lundi de la semaine (dates civiles locales).
export const weekStart=day=>{const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()-((d.getDay()+6)%7));return isoDay(d);};
// Paiements datés d’une facture ; une facture ancienne « payée le » compte pour son net à cette date.
function datedPayments(state,inv){const b=invoiceBalance(state,inv);return b.legacy?[{date:inv.paidAt,amount:Math.max(0,b.net)}]:paymentsOf(inv).map(p=>({date:p.date,amount:p.amount}));}

// ---------- Chiffre d’affaires ----------
// Facturé : HT et TTC des factures, acomptes et avoirs émis au mois d’émission. Encaissé : paiements reçus.
export function revenueByMonth(state,{from='',to=''}={}){
  const map=new Map(),row=m=>{if(!map.has(m))map.set(m,{month:m,invoicedHt:0,invoicedTtc:0,collected:0,count:0});return map.get(m);};
  for(const d of emitted(state)){if(inRange(d.issueDate,from,to)){const r=row(month(d.issueDate));r.invoicedHt=round2(r.invoicedHt+htOf(d));r.invoicedTtc=round2(r.invoicedTtc+ttcOf(d));r.count+=1;}
    if(d.docType!=='avoir')for(const p of datedPayments(state,d))if(inRange(p.date,from,to)){const r=row(month(p.date));r.collected=round2(r.collected+p.amount);}}
  return[...map.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
export function revenueByClient(state,{from='',to='',today=isoDay()}={}){
  const map=new Map();
  for(const d of emitted(state)){
    const k=clientKeyOf(d);if(!map.has(k))map.set(k,{key:k,clientId:d.clientId||null,name:d.clientName||'Client',invoicedHt:0,invoicedTtc:0,collected:0,due:0,late:0,count:0});const r=map.get(k);
    if(inRange(d.issueDate,from,to)){r.invoicedHt=round2(r.invoicedHt+htOf(d));r.invoicedTtc=round2(r.invoicedTtc+ttcOf(d));r.count+=1;}
    if(d.docType==='avoir')continue;
    for(const p of datedPayments(state,d))if(inRange(p.date,from,to))r.collected=round2(r.collected+p.amount);
    const s=invoiceStatus(d,state,today);if(['emise','partielle','retard'].includes(s)){const due=invoiceBalance(state,d).due;r.due=round2(r.due+due);if(s==='retard')r.late=round2(r.late+due);}
  }
  return[...map.values()].sort((a,b)=>b.invoicedHt-a.invoicedHt||a.name.localeCompare(b.name,'fr'));
}

// ---------- En-cours, balance âgée, délais ----------
export const AGED_BUCKETS=[['aEchoir','À échoir'],['j0_30','1 à 30 jours'],['j31_60','31 à 60 jours'],['j61_90','61 à 90 jours'],['j90plus','Plus de 90 jours']];
const bucketOf=days=>days<=0?'aEchoir':days<=30?'j0_30':days<=60?'j31_60':days<=90?'j61_90':'j90plus';
export function agedBalance(state,today=isoDay()){
  const totals=Object.fromEntries(AGED_BUCKETS.map(([k])=>[k,0])),byClient=new Map();
  for(const r of expectedReceipts(state,today)){
    const k=bucketOf(daysBetween(r.date,today));totals[k]=round2(totals[k]+r.amount);
    const ck=clientKeyOf(r.invoice);if(!byClient.has(ck))byClient.set(ck,{key:ck,name:r.invoice.clientName||'Client',...Object.fromEntries(AGED_BUCKETS.map(([b])=>[b,0])),total:0});
    const c=byClient.get(ck);c[k]=round2(c[k]+r.amount);c.total=round2(c.total+r.amount);
  }
  return{totals,total:round2(Object.values(totals).reduce((s,v)=>s+v,0)),byClient:[...byClient.values()].sort((a,b)=>b.total-a.total)};
}
// Délai moyen de paiement (jours entre émission et solde, pondéré par le montant) et DSO
// (en-cours ÷ TTC facturé sur la période × nombre de jours).
export function paymentDelays(state,{from='',to=''}={}){
  let weighted=0,amount=0,count=0,late=0;
  for(const d of emitted(state)){
    if(d.docType==='avoir'||!d.paidAt||!inRange(d.paidAt,from,to))continue;const t=ttcOf(d);if(!(t>0))continue;
    const days=Math.max(0,daysBetween(d.issueDate,d.paidAt));weighted+=days*t;amount+=t;count+=1;if(d.dueDate&&d.paidAt>d.dueDate)late+=1;
  }
  return{averageDays:amount?Math.round(weighted/amount):null,count,lateCount:late};
}
export function dso(state,today=isoDay(),{days=90}={}){
  const from=addDays(today,-days),sales=emitted(state).filter(d=>inRange(d.issueDate,from,today)).reduce((s,d)=>s+ttcOf(d),0),due=expectedReceipts(state,today).reduce((s,r)=>s+r.amount,0);
  return sales>0?Math.round(due/sales*days):null;
}

// ---------- Devis ----------
export function quoteStats(state,{from='',to='',today=isoDay()}={}){
  const by={brouillon:0,envoye:0,accepte:0,refuse:0,expire:0,converti:0},amounts={sent:0,won:0};
  for(const q of quotes(state).filter(x=>docTypeOf(x)==='devis'&&inRange(x.issueDate,from,to))){const s=quoteStatus(q,today);by[s]+=1;if(s!=='brouillon')amounts.sent=round2(amounts.sent+ttcOf(q));if(s==='accepte'||s==='converti')amounts.won=round2(amounts.won+ttcOf(q));}
  const sent=by.envoye+by.accepte+by.refuse+by.expire+by.converti,won=by.accepte+by.converti,decided=won+by.refuse+by.expire;
  return{byStatus:by,sent,won,conversionRate:decided?Math.round(won/decided*100):null,amountRate:amounts.sent?Math.round(amounts.won/amounts.sent*100):null,amounts};
}
// Devis envoyés sans réponse depuis afterDays jours, et devis qui expirent dans les expiringDays jours.
export function quotesToFollow(state,today=isoDay(),{afterDays=7,expiringDays=7}={}){
  const open=quotes(state).filter(q=>docTypeOf(q)==='devis'&&quoteStatus(q,today)==='envoye');
  const lastSent=q=>[q.issueDate,...(q.sentLog||[]).map(s=>s.date)].filter(Boolean).sort().pop();
  return{
    toFollow:open.filter(q=>daysBetween(lastSent(q),today)>=afterDays).map(q=>({quote:q,days:daysBetween(lastSent(q),today)})).sort((a,b)=>b.days-a.days),
    expiring:open.filter(q=>q.validUntil&&q.validUntil<=addDays(today,expiringDays)).map(q=>({quote:q,days:daysBetween(today,q.validUntil)})).sort((a,b)=>a.days-b.days)
  };
}

// ---------- Relances ----------
// Niveau de relance atteint (jours de retard depuis l’échéance la plus ancienne impayée) et pas encore envoyé.
export function remindersDue(state,today=isoDay()){
  const levels=invoiceSettings(state).reminders,out=[];
  for(const inv of invoices(state)){
    if(invoiceStatus(inv,state,today)!=='retard')continue;
    const late=expectedReceipts({...state,integrationImports:[inv,...(state.integrationImports||[]).filter(x=>x.creditOf===inv.id)]},today).filter(r=>r.late).map(r=>r.date).sort()[0]||inv.dueDate;
    const days=daysBetween(late,today),sent=Math.max(0,...(inv.reminders||[]).map(r=>Number(r.level)||0));
    const reached=levels.filter(l=>days>=l.days).pop();if(!reached||reached.level<=sent)continue;
    out.push({invoice:inv,level:reached.level,daysLate:days,fee:reached.fee,due:invoiceBalance(state,inv).due,lastReminder:(inv.reminders||[]).slice(-1)[0]||null});
  }
  return out.sort((a,b)=>b.daysLate-a.daysLate);
}

// ---------- Prévision d’encaissements ----------
// Semaines à partir du lundi courant ; les retards sont regroupés sur la première semaine.
export function forecastByWeek(state,today=isoDay(),{weeks=12}={}){
  const start=weekStart(today),out=Array.from({length:weeks},(_,i)=>({week:addDays(start,i*7),amount:0,late:0,count:0}));
  for(const r of expectedReceipts(state,today)){
    const w=r.late||r.date<start?0:Math.floor(daysBetween(start,r.date)/7);if(w>=weeks)continue;
    const slot=out[w];slot.amount=round2(slot.amount+r.amount);if(r.late)slot.late=round2(slot.late+r.amount);slot.count+=1;
  }
  return out;
}

// ---------- Intelligence locale ----------
// Prix suggéré : dernier prix pratiqué pour ce client, sinon médiane des prix pratiqués, sinon catalogue.
export function suggestPrice(state,{clientId=null,itemId=null,label='',unit=''}={}){
  const key=normalize(label),hist=[];
  for(const d of billingDocs(state)){
    if(d.status==='brouillon'||docTypeOf(d)==='avoir'||docTypeOf(d)==='acompte')continue;
    for(const l of d.lines||[]){if(!amountLine(l)||l.kind==='deduction'||num(l.unitPrice)===null)continue;
      const match=itemId?l.itemId===itemId:key&&normalize(l.label)===key;if(!match||(unit&&l.unit&&l.unit!==unit))continue;
      hist.push({price:l.unitPrice,date:d.issueDate||'',number:d.number||'',clientId:d.clientId||null});}
  }
  hist.sort((a,b)=>b.date.localeCompare(a.date));
  const mine=hist.filter(h=>clientId&&h.clientId===clientId);
  if(mine.length)return{price:mine[0].price,source:'client',count:mine.length,last:{date:mine[0].date,number:mine[0].number}};
  if(hist.length){const p=hist.map(h=>h.price).sort((a,b)=>a-b),mid=Math.floor(p.length/2),median=p.length%2?p[mid]:round2((p[mid-1]+p[mid])/2);return{price:median,source:'historique',count:hist.length,last:{date:hist[0].date,number:hist[0].number}};}
  const item=itemId?catalogItems(state,{includeArchived:true}).find(i=>i.id===itemId):findCatalogItem(state,label);
  if(item){const c=catalogPrice(item,clientId);if(c.price!==null)return{price:c.price,source:'catalogue',count:0,last:null,itemId:item.id};}
  return null;
}
// Prestations réalisées et non facturées depuis plus de `days` jours, par client.
export function unbilledAlerts(state,today=isoDay(),{days=30}={}){
  const limit=addDays(today,-days);
  return active(state,'clients').filter(c=>!c.archived).map(c=>{const items=billableItems(state,c.id).filter(it=>String(it.date||'').slice(0,10)<=limit);if(!items.length)return null;
    const priced=items.map(it=>lineTotal(it.line));return{client:c,count:items.length,oldest:String(items[0].date||'').slice(0,10),amountHt:round2(priced.reduce((s,v)=>s+(v||0),0)),unpriced:priced.filter(v=>v===null).length};}).filter(Boolean).sort((a,b)=>a.oldest.localeCompare(b.oldest));
}
// Doublons probables : même client, même montant TTC, même type, à moins de `days` jours d’écart.
export function probableDuplicates(state,{days=7}={}){
  const list=billingDocs(state).filter(d=>docTypeOf(d)!=='avoir'&&!(d.status!=='brouillon'&&invoiceStatus(d,state)==='annulee')).map(d=>({d,t:ttcOf(d),k:clientKeyOf(d),type:docTypeOf(d)})).filter(x=>x.t>0);
  const out=[];
  for(let i=0;i<list.length;i+=1)for(let j=i+1;j<list.length;j+=1){const a=list[i],b=list[j];
    if(a.k!==b.k||a.type!==b.type||Math.abs(a.t-b.t)>0.005)continue;const gap=Math.abs(daysBetween(a.d.issueDate||isoDay(),b.d.issueDate||isoDay()));if(gap>days)continue;
    out.push({a:a.d,b:b.d,amount:a.t,days:gap,reason:`${a.d.clientName||'Client'} : deux documents de ${round2(a.t)} € à ${gap} jour${gap>1?'s':''} d’écart.`});}
  return out;
}
// Client à risque : retards répétés, délai moyen et impayés en cours.
export function clientRisk(state,clientKey,today=isoDay()){
  const docs=emitted(state).filter(d=>clientKeyOf(d)===clientKey&&d.docType!=='avoir');let paidLate=0,paid=0,delay=0,overdue=0,overdueAmount=0;
  for(const d of docs){const s=invoiceStatus(d,state,today);
    if(s==='payee'&&d.paidAt&&d.dueDate){paid+=1;const late=Math.max(0,daysBetween(d.dueDate,d.paidAt));delay+=late;if(late>0)paidLate+=1;}
    if(s==='retard'){overdue+=1;overdueAmount=round2(overdueAmount+invoiceBalance(state,d).due);}}
  const avgLate=paid?Math.round(delay/paid):0,score=Math.min(100,paidLate*15+overdue*25+Math.min(30,avgLate));
  return{clientKey,invoices:docs.length,paidLate,averageLateDays:avgLate,overdue,overdueAmount,score,level:score>=50?'eleve':score>=20?'moyen':'faible'};
}
export function riskyClients(state,today=isoDay()){
  const keys=[...new Set(emitted(state).map(clientKeyOf))];
  return keys.map(k=>({...clientRisk(state,k,today),name:emitted(state).find(d=>clientKeyOf(d)===k)?.clientName||'Client'})).filter(r=>r.level!=='faible').sort((a,b)=>b.score-a.score);
}

// ---------- Saisie rapide en français ----------
const UNIT_WORDS=[[/^(h|hr?s?|heures?)$/,'h'],[/^(ha|hectares?)$/,'ha'],[/^(t|tonnes?)$/,'t'],[/^(m3|m³|metres? cubes?)$/,'m³'],[/^(l|litres?)$/,'L'],[/^(j|jours?|journees?)$/,'j'],[/^km$/,'km'],[/^kg$/,'kg'],[/^(m2|m²)$/,'m²'],[/^(m|ml|metres?)$/,'m'],[/^(u|unites?|pieces?|pcs?)$/,'u'],[/^forfaits?$/,'forfait'],[/^lots?$/,'lot'],[/^mois$/,'mois']];
const unitOf=w=>{const n=normalize(w).replace(/ /g,'');if(w==='m³')return'm³';if(w==='m²')return'm²';const hit=UNIT_WORDS.find(([re])=>re.test(n));return hit?hit[1]:null;};
const DOC_WORDS=[[/^devis$/,'devis'],[/^(facture|fact)$/,'facture'],[/^avoir$/,'avoir'],[/^acompte$/,'acompte'],[/^(proforma|pro-forma)$/,'proforma']];
const numberOf=s=>{const n=Number(String(s).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const PRICE_RE=/(?:^|\s)(?:à|a|@|pour|x|:)?\s*(\d{1,3}(?:[\s  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur)\s*(?:\/\s*([a-zA-Zéèêàâîôûç³²]+))?\s*(ht|ttc)?\s*$/i;
const VAT_RE=/\b(?:tva\s*(?:à\s*)?(\d+(?:[.,]\d+)?)\s*%?|(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s*)?tva\b)/i;
// ---------- Taux de TVA proposé ----------
// Règles usuelles en France métropolitaine, à titre indicatif : l’utilisateur garde la main sur chaque ligne.
const VAT_RULES=[
  [20,/\b(prestations?|travaux|pelle|mini ?pelle|tracteur|terrassement|broyage|fauch\w*|fanage|debroussaill\w*|taille|elagage|location|transport|deplacement|livraison|main d ?oeuvre|heures?|deneigement|curage|epandage|moisson\w*|semis|semer|labour|dechaumage|hersage|roulage|binage|desherbage|traitement|pulverisation|pressage|andainage|ensilage|enrubannage|battage|sechage|arrachage|plantation|chargement|nettoyage|recolte|gazole|carburant|materiel|pieces?|reparation|entretien)\b/,'Prestation de services ou vente de matériel (20 %)'],
  [5.5,/\b(legumes?|fruits?|pommes? de terre|oeufs?|lait|miel|farine|viande|colis de viande|volailles? pretes?|fromages?|beurre|cremes?|confitures?|ble|orge de brasserie|cereales? alimentaires?)\b/,'Produit alimentaire (5,5 %) ; céréales vendues pour l’alimentation animale : 10 %'],
  [10,/\b(paille|foin|fourrages?|ensilage|enrubann\w*|luzerne|regain|balles?|bottes?|mais grain|orge|triticale|avoine|cereales?|semences?|aliments? du betail|tourteaux?|grains?)\b/,'Produit agricole non transformé ou alimentation animale (10 %)'],
  [10,/\b(bois de chauffage|buches?|plaquettes?|granules?|bois energie|stere)\b/,'Bois de chauffage (10 %)'],
  [10,/\b(bovins?|veaux?|genisses?|vaches?|taurillons?|broutards?|agneaux?|brebis|moutons?|porcs?|porcelets?|animaux vivants?)\b/,'Animaux vivants de boucherie ou d’élevage (10 %)'],
  [10,/\b(fumier|compost|lisier|amendements? organiques?|digestat)\b/,'Matière fertilisante organique (10 % si utilisable en agriculture biologique, sinon 20 %)']
];
/** Taux proposé pour une désignation : catalogue, puis habitude de l’exploitation, puis règle usuelle. */
export function suggestVatRate(label,{state=null}={}){
  const n=normalize(label);if(!n)return null;
  const regime=state?.exploitation?.invoicing?.vatRegime;
  if(regime==='franchise')return{rate:0,basis:'Franchise en base de TVA (paramètres)'};
  const item=state?findCatalogItem(state,label):null;
  if(item&&item.vatRate!==undefined&&item.vatRate!==null&&item.vatRate!=='')return{rate:Number(item.vatRate),basis:'Taux de l’article du catalogue'};
  if(state){
    const seen=emitted(state).slice().sort((a,b)=>String(b.issueDate||'').localeCompare(String(a.issueDate||''))).flatMap(d=>d.lines||[]).find(l=>normalize(l.label)===n&&Number.isFinite(Number(l.vatRate)));
    if(seen)return{rate:Number(seen.vatRate),basis:'Taux déjà utilisé pour cette désignation'};
  }
  for(const [rate,re,basis] of VAT_RULES)if(re.test(n))return{rate,basis};
  return null;
}

// ---------- Saisie rapide en français ----------
const NUMBER_WORDS={deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,onze:11,douze:12,treize:13,quatorze:14,quinze:15,seize:16,vingt:20,trente:30,quarante:40,cinquante:50,soixante:60,cent:100,mille:1000};
const LEGAL_FORMS=new Set(['gaec','scea','earl','sarl','sas','sasu','sa','eurl','ets','etablissements','sci','cuma','eta','ste','societe','mr','mme','m','monsieur','madame','de','des','du','la','le','les','et']);
const NOT_CLIENT=/^(semis|semer|moisson\w*|recoltes?|fauch\w*|fanage|pressage|presse|andainage|epandage|labours?|dechaumage|broyage|ensilage|enrubannage|traitements?|pulverisation|desherbage|binage|hersage|roulage|transports?|livraisons?|location|vente|achat|prestations?|travaux|travail|entretien|taille|elagage|debroussaill\w*|terrassement|curage|deneigement|nettoyage|reparations?|main|heures?|journees?|pelle|mini|tracteur|chargement|deplacement|plantation|arrachage|battage|sechage|stockage|ramassage|balles?|bottes?|ballots?|paille|foin|ble|orge|mais|colza|tournesol|luzerne|ray|herbe|fumier|lisier|compost|bois|gazole|gasoil|carburant|semences?|engrais|transport|forfait|frais|materiel|pieces?|ensemble|total)$/;
const CLIENT_PREFIX=/^(pour|chez|client|a|à|au|aux)$/i;
const fold=w=>normalize(w).replace(/ /g,'');
const PRICE_ANY=/(?:(?:\bà|\ba|@|\bpour|\bx|\bau prix de|\bprix|\bsoit)\s*)?(\d{1,3}(?:[\s  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(?:€|euros?\b|eur\b)\s*(ht\b|ttc\b)?/i;
const UNIT_AFTER=/^\s*(?:\/|par\s+|la\s+|le\s+|les\s+|l['’]\s*|de\s+l['’]\s*|de\s+la\s+|du\s+)?([a-zA-Zéèêàâîôûç³²]+[23]?)/i;
function cleanLabel(v){
  let t=String(v||'').replace(/\s+/g,' ').trim();
  for(let k=0;k<4;k++)t=t.replace(/^[,:;\-–—.]+\s*/,'').replace(/^(de|d['’]|du|des|pour|à|a|le|la|les|l['’]|et|avec)\s+/i,'').replace(/^d['’]/i,'').replace(/\s*[,:;\-–—.]+$/,'').replace(/\s+(à|a|@|pour|de|du|des|et|le|la|les)$/i,'').trim();
  return t;
}
function wordsToNumbers(text){
  return text
    .replace(/\b(une?\s+)?demi[- ]journ[ée]es?\b/gi,'0,5 j').replace(/\b(une?\s+)?demi[- ]heures?\b/gi,'0,5 h')
    .replace(/\b(une?)\s+(?=(heures?|jours?|journ[ée]es?|hectares?|tonnes?|ha|h|t|m3|m³|stères?|forfaits?|semaines?)\b)/gi,'1 ')
    .replace(/\b([a-zA-Zéè]+)\b/g,w=>{const n=NUMBER_WORDS[normalize(w)];return n===undefined?w:String(n);});
}
// Client reconnu n’importe où dans la phrase (nom complet, ou mots significatifs du nom).
function findClientInText(text,clients){
  const tokens=text.split(' ').map(fold);
  const scored=clients.map(c=>{
    const all=normalize(c.name).split(' ').filter(Boolean),sig=all.filter(t=>t.length>=3&&!LEGAL_FORMS.has(t));
    if(!sig.length)return{c,score:0};
    const hits=sig.filter(t=>tokens.includes(t));
    const full=normalize(text).includes(normalize(c.name));
    const score=full?3:hits.length===sig.length?2:hits.some(t=>t.length>=4)?1:0;
    return{c,score,hits};
  }).filter(x=>x.score).sort((a,b)=>b.score-a.score);
  if(!scored.length)return{client:null,candidates:[]};
  const top=scored.filter(x=>x.score===scored[0].score);
  return{client:top.length===1?top[0].c:null,candidates:scored.map(x=>x.c),hits:top.length===1?top[0].hits:[]};
}
function removeClientWords(text,client){
  const sig=new Set(normalize(client.name).split(' ').filter(Boolean));
  const words=text.split(' '),idx=words.map((w,i)=>sig.has(fold(w.replace(/[,:;]$/,'')))&&!LEGAL_FORMS.has(fold(w))?i:-1).filter(i=>i>=0);
  if(!idx.length)return text;
  let a=Math.min(...idx),b=Math.max(...idx);
  while(a>0&&(LEGAL_FORMS.has(fold(words[a-1]))&&sig.has(fold(words[a-1]))))a--;
  while(a>0&&CLIENT_PREFIX.test(words[a-1]))a--;
  while(b<words.length-1&&sig.has(fold(words[b+1].replace(/[,:;]$/,''))))b++;
  const tail=words[b].match(/[,:;]$/)?' ; ':' ';
  return `${words.slice(0,a).join(' ')}${tail}${words.slice(b+1).join(' ')}`.replace(/\s+/g,' ').trim();
}
// Nom de client non reconnu : « pour X », « X : … » ou mots en tête avant le premier nombre.
function guessClientQuery(text){
  const m=text.match(/\b(?:pour|chez|client)\s+((?:[A-ZÉÈ][\wéèêàâîôûç'’-]*\s*){1,4})/);
  if(m&&!NOT_CLIENT.test(fold(m[1].split(' ')[0])))return{query:m[1].trim(),rest:text.replace(m[0],' ').trim()};
  const colon=text.indexOf(':');
  if(colon>0){const head=text.slice(0,colon).trim();if(head.split(' ').length<=5&&!/\d/.test(head)&&!NOT_CLIENT.test(fold(head.split(' ')[0])))return{query:head,rest:text.slice(colon+1).trim()};}
  // Nom propre en tête (« Durand 3 h de pelle ») : majuscule, pas un mot d'action ou de produit,
  // et pas suivi de « de » (« Moisson de blé », « Semis de blé » sont des désignations).
  const firstNum=text.search(/\d/);const head=(firstNum<0?'':text.slice(0,firstNum)).trim();
  if(!head)return{query:'',rest:text};
  const words=head.split(' ').filter(Boolean);
  if(!/^[A-ZÉÈ]/.test(words[0])||NOT_CLIENT.test(fold(words[0]))||unitOf(words[0]))return{query:'',rest:text};
  let n=1;while(n<words.length&&n<4&&(/^[A-ZÉÈ]/.test(words[n])&&!NOT_CLIENT.test(fold(words[n]))||LEGAL_FORMS.has(fold(words[n]))&&words[n+1]&&/^[A-ZÉÈ]/.test(words[n+1])))n++;
  if(words[n]&&/^(de|du|des|d['’].*)$/i.test(words[n]))return{query:'',rest:text};
  const query=words.slice(0,n).join(' ').replace(/[,:;]$/,'');
  return{query,rest:text.replace(words.slice(0,n).join(' '),' ').trim()};
}
/**
 * « devis Dupont 3 h de pelle à 65 € et 12 t de cailloux à 18 € HT » → brouillon de lignes à valider.
 * Comprend aussi : client n’importe où (« … pour Martin »), nombres en lettres (« deux heures »,
 * « une demi-journée »), prix unitaires (« 55 € de l’heure », « 80 € la tonne », « 45 €/ha », « 4,5 € pièce »),
 * quantité après la désignation (« fauchage 10 ha ») et taux de TVA proposé selon la nature de la ligne.
 */
export function parseQuickEntry(input,state=null){
  const warnings=[];let src=wordsToNumbers(String(input||'').replace(/[\r\n]+/g,' ; ').replace(/\s+/g,' ').trim());let rest=src,docType=null;
  const first=rest.split(' ')[0]||'';const dt=DOC_WORDS.find(([re])=>re.test(normalize(first)));if(dt){docType=dt[1];rest=rest.slice(first.length).trim();}
  if(/^pro forma\b/i.test(rest)){docType='proforma';rest=rest.slice(8).trim();}
  if(!docType){const any=rest.match(/\b(devis|facture|avoir|acompte|proforma)\b/i);if(any&&any.index<=40){const d=DOC_WORDS.find(([re])=>re.test(normalize(any[1])));if(d){docType=d[1];rest=(rest.slice(0,any.index)+rest.slice(any.index+any[0].length)).replace(/\s+/g,' ').trim();}}}
  const globalTtc=/\bttc\b/i.test(src)&&!/\bht\b/i.test(src);
  const settings=state?invoiceSettings(state):{vatRate:20,customVatRates:[]};
  const clients=state?active(state,'clients').filter(c=>!c.archived):[];
  let clientQuery='',client=null,candidates=[];
  const found=findClientInText(rest,clients);
  if(found.client){client=found.client;candidates=[client];clientQuery=client.name;rest=removeClientWords(rest,client);}
  else{
    const g=guessClientQuery(rest);clientQuery=g.query;
    if(clientQuery){
      rest=g.rest;
      const q=normalize(clientQuery);
      candidates=found.candidates.length?found.candidates:clients.filter(c=>{const n=normalize(c.name);return n.includes(q)||q.split(' ').every(t=>n.includes(t));});
      if(candidates.length===1){client=candidates[0];}
      else if(candidates.length>1){const exact=candidates.find(c=>normalize(c.name)===q);if(exact)client=exact;else warnings.push(`Plusieurs clients correspondent à « ${clientQuery} » : précisez.`);}
      else warnings.push(`Client « ${clientQuery} » introuvable : choisissez-le ou créez sa fiche.`);
    }else if(found.candidates.length>1)warnings.push(`Plusieurs clients possibles (${found.candidates.slice(0,3).map(c=>c.name).join(', ')}) : précisez.`);
  }
  const lines=[],unparsed=[];
  for(const seg of rest.split(/\s*[;]\s*|\s*\+\s*|,\s+(?=\D)|\s+(?:et|puis|plus|ainsi que|avec)\s+(?=\d)/i).map(x=>x.trim()).filter(Boolean)){
    let s=seg,vatRate=null,vatBasis='',mode=globalTtc?'TTC':'HT';
    const vm=s.match(VAT_RE);if(vm){const r=numberOf(vm[1]||vm[2]);if(r!==null&&(VAT_RATES_ALL.includes(r)||settings.customVatRates.includes(r))){vatRate=r;vatBasis='Taux saisi';}s=s.replace(vm[0],' ').replace(/\s+/g,' ').trim();}
    const sansTva=/\b(sans tva|exon[ée]r[ée]e?)\b/i.test(s);if(sansTva){vatRate=0;vatBasis='Sans TVA (saisi)';s=s.replace(/\b(sans tva|exon[ée]r[ée]e?)\b/i,' ');}
    let price=null,perUnit=null;
    const pm=s.match(PRICE_ANY);
    if(pm){
      price=numberOf(pm[1]);if(pm[2])mode=pm[2].toUpperCase();
      let after=s.slice(pm.index+pm[0].length);
      const um=after.match(UNIT_AFTER);
      if(um){const u=unitOf(um[1])||(/^(piece|pieces|unite|unites|botte|bottes|balle|balles|sac|sacs)$/.test(fold(um[1]))?'u':null);if(u){perUnit=u;after=after.slice(um[0].length);}}
      const m2=after.match(/^\s*(ht|ttc)\b/i);if(m2){mode=m2[1].toUpperCase();after=after.slice(m2[0].length);}
      s=`${s.slice(0,pm.index)} ${after}`.replace(/\s+/g,' ').trim();
    }
    let quantity=1,unit=perUnit||'forfait',label=s,qtyFound=false;
    const qm=s.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*([a-zA-Zéèêàâîôûç³²]+[23]?)?(?=[\s,.;:]|$)/);
    if(qm){
      quantity=numberOf(qm[1]);qtyFound=true;const u=qm[2]?unitOf(qm[2]):null;
      const before=s.slice(0,qm.index),after=s.slice(qm.index+qm[0].length);
      if(u){unit=u;label=`${before} ${after}`;}
      // « pressage de paille 200 balles » : le nom compté sert d'unité quand la désignation est déjà devant.
      else if(qm[2]&&/^(balles?|bottes?|ballots?|sacs?|round|rounds|palettes?|big ?bags?)$/.test(fold(qm[2]))&&cleanLabel(before)){unit=perUnit||'u';label=`${before} ${after}`;}
      else{unit=perUnit||(quantity!==1?'u':'forfait');label=`${before} ${qm[2]||''} ${after}`;}
    }
    label=cleanLabel(label);
    if(!label&&price===null&&!qtyFound){unparsed.push(seg);continue;}
    if(!label&&price===null){unparsed.push(seg);continue;}
    if(!label)label='Prestation';
    const item=state?findCatalogItem(state,label):null;
    if(vatRate===null){const sug=suggestVatRate(label,{state});if(sug){vatRate=sug.rate;vatBasis=sug.basis;}}
    if(vatRate===null||!(VAT_RATES_ALL.includes(vatRate)||settings.customVatRates.includes(vatRate))){vatRate=settings.vatRate;vatBasis='Taux par défaut (paramètres)';}
    if(item&&unit==='forfait'&&item.unit&&!qtyFound)unit=item.unit;
    let unitPrice=price,basis='Prix saisi';
    if(price!==null&&mode==='TTC'){unitPrice=Math.round(price/(1+vatRate/100)*10000)/10000;basis='Prix TTC saisi, converti en HT';}
    if(unitPrice===null&&state){const sug=suggestPrice(state,{clientId:client?.id||null,itemId:item?.id||null,label,unit});if(sug){unitPrice=sug.price;basis=sug.source==='client'?'Dernier prix pratiqué pour ce client':sug.source==='historique'?'Prix habituel (historique)':'Prix du catalogue';}}
    if(unitPrice===null)warnings.push(`Prix à saisir : ${label}.`);
    if(item?.label)label=item.label;
    lines.push({label:label.charAt(0).toUpperCase()+label.slice(1),quantity,unit,unitPrice,vatRate,vatBasis,basis,...(item?{itemId:item.id,...(item.account?{account:item.account}:{})}:{})});
  }
  if(!lines.length)warnings.push('Aucune ligne reconnue : écrivez par exemple « 3 h de pelle à 65 € ».');
  return{docType:docType||'facture',docTypeGuessed:!docType,clientQuery,client,candidates,lines,mode:globalTtc?'TTC':'HT',warnings,unparsed,draftOnly:true};
}

// ---------- Tableau de bord ----------
export function billingDashboard(state,{today=isoDay(),months=12}={}){
  const from=addMonths(`${month(today)}-01`,-(months-1));
  const receipts=expectedReceipts(state,today);
  return{today,from,revenue:revenueByMonth(state,{from,to:today}),clients:revenueByClient(state,{from,to:today,today}),aged:agedBalance(state,today),delays:paymentDelays(state,{from,to:today}),dso:dso(state,today),
    receivable:{due:round2(receipts.reduce((s,r)=>s+r.amount,0)),late:round2(receipts.filter(r=>r.late).reduce((s,r)=>s+r.amount,0))},
    quotes:quoteStats(state,{from,to:today,today}),follow:quotesToFollow(state,today),reminders:remindersDue(state,today),recurring:dueSchedules(state,today),
    forecast:forecastByWeek(state,today),unbilled:unbilledAlerts(state,today),duplicates:probableDuplicates(state),risky:riskyClients(state,today)};
}
