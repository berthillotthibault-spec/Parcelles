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
const PRICE_RE=/(?:^|\s)(?:à|a|@|pour|x|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur)\s*(?:\/\s*([a-zA-Zéèêàâîôûç³²]+))?\s*(ht|ttc)?\s*$/i;
const VAT_RE=/\b(?:tva\s*(?:à\s*)?(\d+(?:[.,]\d+)?)\s*%?|(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s*)?tva\b)/i;
// « devis Dupont 3 h de pelle à 65 € et 12 t de cailloux à 18 € HT » → brouillon de lignes à valider.
export function parseQuickEntry(input,state=null){
  const warnings=[],src=String(input||'').replace(/\s+/g,' ').trim();let rest=src,docType=null;
  const first=rest.split(' ')[0]||'';const dt=DOC_WORDS.find(([re])=>re.test(normalize(first)));if(dt){docType=dt[1];rest=rest.slice(first.length).trim();}
  if(/^pro forma\b/i.test(rest)){docType='proforma';rest=rest.slice(8).trim();}
  const globalTtc=/\bttc\b/i.test(src)&&!/\bht\b/i.test(src);
  // Client : mots avant la première quantité ou le premier prix (« pour » / « à » facultatifs).
  const firstNum=rest.search(/\d/),head=(firstNum<0?rest:rest.slice(0,firstNum)).replace(/^(pour|à|a|chez|client)\s+/i,'').trim();
  const words=head.split(' ').filter(Boolean),labelStart=words.findIndex(w=>/^(de|d’|d'|du|des)$/i.test(w));
  const clientQuery=(labelStart>0?words.slice(0,labelStart):words).join(' ').replace(/[,:;]$/,'').trim();
  rest=firstNum<0?'':rest.slice(firstNum);
  if(labelStart>0&&firstNum>=0)rest=`${words.slice(labelStart).join(' ')} ${rest}`.trim();
  const settings=state?invoiceSettings(state):{vatRate:20,customVatRates:[]};
  const clients=state?active(state,'clients').filter(c=>!c.archived):[];
  const q=normalize(clientQuery),candidates=q?clients.map(c=>{const n=normalize(c.name),tokens=q.split(' ');const score=n===q?3:n.includes(q)?2:tokens.every(t=>n.includes(t))?1:0;return{c,score};}).filter(x=>x.score).sort((a,b)=>b.score-a.score).map(x=>x.c):[];
  if(clientQuery&&!candidates.length)warnings.push(`Client « ${clientQuery} » introuvable : choisissez-le ou créez sa fiche.`);
  const client=candidates.length===1||(candidates.length>1&&normalize(candidates[0].name)===q)?candidates[0]:null;
  if(candidates.length>1&&!client)warnings.push(`Plusieurs clients correspondent à « ${clientQuery} » : précisez.`);
  const lines=[],unparsed=[];
  for(const seg of rest.split(/\s*;\s*|\s*\+\s*|,\s+(?=\D)|\s+(?:et|puis|plus)\s+(?=\d|[a-zéè])/i).map(s=>s.trim()).filter(Boolean)){
    let s=seg,vatRate=settings.vatRate,mode=globalTtc?'TTC':'HT';
    const vm=s.match(VAT_RE);if(vm){const r=numberOf(vm[1]||vm[2]);if(r!==null&&(VAT_RATES_ALL.includes(r)||settings.customVatRates.includes(r)))vatRate=r;s=s.replace(vm[0],' ').replace(/\s+/g,' ').trim();}
    const pm=s.match(PRICE_RE);let price=null,perUnit=null;
    if(pm){price=numberOf(pm[1]);perUnit=pm[2]?unitOf(pm[2]):null;if(pm[3])mode=pm[3].toUpperCase();s=s.slice(0,pm.index).trim();}
    const qm=s.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zéèêàâîôûç³²]+[23]?(?=[\s,.;:]|$))?\s*(?:de|d’|d'|du|des)?\s*(.*)$/i);
    let quantity=1,unit=perUnit||'forfait',label=s;
    if(qm){const u=qm[2]?unitOf(qm[2]):null;quantity=numberOf(qm[1]);if(u){unit=u;label=qm[3];}else label=`${qm[2]||''} ${qm[3]}`.replace(/^(de|d’|d'|du|des)\s+/i,'').trim();}
    label=label.replace(/^(de|d’|d'|du|des)\s+/i,'').replace(/\s*(à|a|@|pour)$/i,'').trim();
    if(!label&&price===null){unparsed.push(seg);continue;}
    if(!label)label='Prestation';
    const item=state?findCatalogItem(state,label):null;
    if(item&&item.vatRate!==undefined&&!vm)vatRate=item.vatRate;
    let unitPrice=price,basis='Prix saisi';
    if(price!==null&&mode==='TTC'){unitPrice=Math.round(price/(1+vatRate/100)*10000)/10000;basis='Prix TTC saisi, converti en HT';}
    if(unitPrice===null&&state){const sug=suggestPrice(state,{clientId:client?.id||null,itemId:item?.id||null,label,unit});if(sug){unitPrice=sug.price;basis=sug.source==='client'?'Dernier prix pratiqué pour ce client':sug.source==='historique'?'Prix habituel (historique)':'Prix du catalogue';}}
    if(unitPrice===null)warnings.push(`Prix à saisir : ${label}.`);
    // Article reconnu : sa désignation du catalogue (« paillage » → « Paillage de copeaux »).
    if(item?.label)label=item.label;
    lines.push({label:label.charAt(0).toUpperCase()+label.slice(1),quantity,unit,unitPrice,vatRate,basis,...(item?{itemId:item.id,...(item.account?{account:item.account}:{})}:{})});
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
