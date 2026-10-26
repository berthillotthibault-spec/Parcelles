// Centre « Facturation » (vague 13, chantier B) : vues pures, sans DOM ni écriture.
// Tableau de bord filtré (période, client), graphiques SVG faits main avec leur équivalent textuel,
// « À faire » (relances groupées par client, devis à suivre, prestations non facturées, récurrences dues,
// doublons, clients à risque), fiche Facturation d’un client, catalogue (recherche, import CSV),
// récurrences (historique), réglages (aperçu de numérotation, IBAN) et document d’exemple pour l’aperçu
// du modèle visuel. Les calculs restent ceux du moteur (invoices.js, billing.js, billing-insights.js).
// Chargé à la demande avec billing-hub-ui.js.
import {normalize} from './utils.js';
import {active} from './farm-memory.js';
import {DOC_LABELS,STATUS_LABELS,UNITS,MORE_UNITS,addDays,addMonths,allocateNumber,billableItems,compileNumbering,dateFr,docTypeOf,documentTotals,ibanValid,invoiceBalance,invoiceSettings,invoiceStatus,invoices,isoDay,legalMentions,lineKind,lineTotal,quoteStatus,round2,billingDocs,luhnValid,validateSettings,numberingIssues} from './invoices.js';
import {FREQUENCIES,catalogItems,schedules,scheduleOccurrences,validateCatalogItem,catalogPrice} from './billing.js';
import {DEFAULT_MESSAGES,QUOTE_FOLLOW_UP,documentMessage,quoteFollowUpMessage} from './billing-messages.js';
import {AGED_BUCKETS,billingDashboard,clientRisk,paymentDelays,probableDuplicates,quotesToFollow,remindersDue,riskyClients,unbilledAlerts} from './billing-insights.js';

export const HUB_TABS=[['suivi','Suivi'],['afaire','À faire'],['clients','Clients'],['catalogue','Catalogue'],['recurrences','Récurrences'],['reglages','Réglages']];
export const hubTab=tab=>HUB_TABS.some(([k])=>k===tab)?tab:'suivi';
const NB=' ';
const nf=d=>new Intl.NumberFormat('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const fix=s=>s.replace(/[  ]/g,NB).replace(/^-/,'−');
export const money=v=>Number.isFinite(v)?`${fix(nf(2).format(v))}${NB}€`:'—';
export const moneyShort=v=>Number.isFinite(v)?`${fix(nf(0).format(Math.round(v)))}${NB}€`:'—';
const compact=v=>Math.abs(v)>=10000?`${fix(nf(0).format(Math.round(v/1000)))}${NB}k€`:moneyShort(v);
export const plural=(n,one,many)=>`${n} ${n>1?many:one}`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MONTHS=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
export const monthLabel=m=>{const [y,mm]=String(m).split('-').map(Number);return`${MONTHS[(mm||1)-1]} ${y}`;};
const shortDay=d=>{const [,m,dd]=String(d).split('-').map(Number);return`${dd}/${String(m).padStart(2,'0')}`;};

// ---------- Périmètre : période et client ----------
export const PERIODS=[['12m','12 mois'],['annee','Cette année'],['trimestre','Ce trimestre'],['mois','Ce mois']];
export function periodMonths(period,today=isoDay()){const m=Number(String(today).slice(5,7))||1;return period==='annee'?m:period==='trimestre'?((m-1)%3)+1:period==='mois'?1:12;}
// État réduit aux documents d’un client (les autres enregistrements restent : catalogue, réglages…).
export function scopeState(state,clientId=''){
  if(!clientId)return state;
  return{...state,integrationImports:(state.integrationImports||[]).filter(r=>!['invoice','quote'].includes(r.farmKind)||r.clientId===clientId)};
}
// Mois de from (AAAA-MM-01) à today, remplis de zéros quand rien n’est facturé ni encaissé.
export function monthSeries(from,today,revenue=[]){
  const by=new Map(revenue.map(r=>[r.month,r])),out=[],end=String(today).slice(0,7);let m=String(from).slice(0,7);
  for(let i=0;i<36&&m<=end;i+=1){const r=by.get(m)||{};out.push({month:m,invoicedHt:r.invoicedHt||0,invoicedTtc:r.invoicedTtc||0,collected:r.collected||0,count:r.count||0});m=addMonths(`${m}-01`,1).slice(0,7);}
  return out;
}

// ---------- Tableau de bord ----------
// Chaque indicateur porte le filtre de la liste à ouvrir (billingDocs.openList(docType, {filter})).
export function hubDashboard(state,{today=isoDay(),period='12m',clientId=''}={}){
  const months=periodMonths(period,today),scoped=scopeState(state,clientId),d=billingDashboard(scoped,{today,months});
  const series=monthSeries(d.from,today,d.revenue),sum=k=>round2(series.reduce((s,r)=>s+r[k],0));
  const invoicedHt=sum('invoicedHt'),collected=sum('collected'),count=series.reduce((s,r)=>s+r.count,0);
  const base={from:d.from,to:today,...(clientId?{clientId}:{})},scope=clientId?{clientId}:{};
  const quotesRate=d.quotes.conversionRate,delay=d.delays.averageDays;
  const kpis=[
    {key:'invoiced',label:'Facturé HT',value:moneyShort(invoicedHt),hint:plural(count,'pièce émise','pièces émises'),link:['facture',{...base}]},
    {key:'collected',label:'Encaissé',value:moneyShort(collected),hint:invoicedHt>0?`${Math.round(collected/Math.max(1,sum('invoicedTtc'))*100)}${NB}% du TTC facturé`:'sur la période',link:['facture',{...base,status:'payee'}]},
    {key:'receivable',label:'En-cours',value:moneyShort(d.receivable.due),hint:'reste à encaisser',link:['facture',{...scope,status:'due'}]},
    {key:'late',label:'En retard',value:moneyShort(d.receivable.late),hint:d.reminders.length?plural(d.reminders.length,'relance due','relances dues'):'aucune relance due',tone:d.receivable.late>0?'bad':'',link:['facture',{...scope,status:'retard'}]},
    {key:'dso',label:'DSO',value:d.dso===null?'—':`${d.dso}${NB}j`,hint:delay===null?'délai moyen : —':`délai moyen payé : ${delay}${NB}j`,link:['facture',{...scope,status:'due'}]},
    {key:'quotes',label:'Devis transformés',value:quotesRate===null?'—':`${quotesRate}${NB}%`,hint:`${plural(d.quotes.won,'accepté','acceptés')} sur ${d.quotes.sent} envoyé${d.quotes.sent>1?'s':''}`,link:['devis',{...base}]}
  ];
  const aged=AGED_BUCKETS.map(([k,label])=>({key:k,label,amount:d.aged.totals[k]||0,share:d.aged.total?Math.round((d.aged.totals[k]||0)/d.aged.total*100):0,link:['facture',{...scope,status:k==='aEchoir'?'due':'retard',aged:k}]}));
  const top=d.clients.filter(c=>c.invoicedHt||c.due).slice(0,5).map(c=>({...c,link:['all',{...base,clientId:c.clientId||'',clientName:c.name}]}));
  const forecast={weeks:d.forecast,total:round2(d.forecast.reduce((s,w)=>s+w.amount,0)),next4:round2(d.forecast.slice(0,4).reduce((s,w)=>s+w.amount,0)),late:round2(d.forecast.reduce((s,w)=>s+w.late,0))};
  return{today,period,clientId,from:d.from,series,totals:{invoicedHt,collected,invoicedTtc:sum('invoicedTtc'),count},kpis,aged,agedTotal:d.aged.total,top,forecast,quotes:d.quotes,raw:d};
}

// Histogramme groupé : facturé HT et encaissé par mois. Couleurs par classes (jetons CSS, clair et sombre).
export function revenueChartSvg(series,{width=640,height=210}={}){
  const left=46,right=8,top=10,bottom=24,plotW=width-left-right,plotH=height-top-bottom,n=Math.max(1,series.length);
  const max=Math.max(1,...series.flatMap(r=>[r.invoicedHt,r.collected])),step=10**Math.floor(Math.log10(max)),ceil=Math.ceil(max/step)*step;
  const y=v=>round2(top+plotH-(v/ceil)*plotH),slot=plotW/n,bw=Math.max(3,Math.min(18,slot*0.34));
  const ticks=[0,ceil/2,ceil].map(v=>`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="${left-6}" y="${y(v)+3}" text-anchor="end">${esc(compact(v))}</text>`).join('');
  const bars=series.map((r,i)=>{const cx=left+slot*i+slot/2,lbl=monthLabel(r.month);
    return`<rect class="bh-bar is-invoiced" x="${round2(cx-bw-1)}" y="${y(r.invoicedHt)}" width="${round2(bw)}" height="${round2(top+plotH-y(r.invoicedHt))}" rx="2"><title>${esc(`${lbl} : facturé ${money(r.invoicedHt)} HT`)}</title></rect>`
      +`<rect class="bh-bar is-collected" x="${round2(cx+1)}" y="${y(r.collected)}" width="${round2(bw)}" height="${round2(top+plotH-y(r.collected))}" rx="2"><title>${esc(`${lbl} : encaissé ${money(r.collected)}`)}</title></rect>`
      +(n<=12||i%2===0?`<text class="chart-axis" x="${round2(cx)}" y="${height-8}" text-anchor="middle">${esc(MONTHS[Number(r.month.slice(5,7))-1])}</text>`:'');}).join('');
  const total=k=>round2(series.reduce((s,r)=>s+r[k],0)),best=[...series].sort((a,b)=>b.invoicedHt-a.invoicedHt)[0];
  const label=`Chiffre d’affaires par mois, ${series.length?`${monthLabel(series[0].month)} à ${monthLabel(series[series.length-1].month)}`:'aucune donnée'} : facturé ${money(total('invoicedHt'))} HT, encaissé ${money(total('collected'))}.${best&&best.invoicedHt>0?` Meilleur mois : ${monthLabel(best.month)} (${money(best.invoicedHt)} HT).`:''}`;
  return`<svg class="chart bh-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${ticks}${bars}</svg>`;
}
// Prévision d’encaissements par semaine : retards (première semaine) distingués du reste.
export function forecastChartSvg(weeks,{width=640,height=170}={}){
  const left=46,right=8,top=10,bottom=24,plotW=width-left-right,plotH=height-top-bottom,n=Math.max(1,weeks.length);
  const max=Math.max(1,...weeks.map(w=>w.amount)),step=10**Math.floor(Math.log10(max)),ceil=Math.ceil(max/step)*step;
  const y=v=>round2(top+plotH-(v/ceil)*plotH),slot=plotW/n,bw=Math.max(4,Math.min(26,slot*0.6));
  const ticks=[0,ceil].map(v=>`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="${left-6}" y="${y(v)+3}" text-anchor="end">${esc(compact(v))}</text>`).join('');
  const bars=weeks.map((w,i)=>{const x=round2(left+slot*i+(slot-bw)/2),onTime=round2(w.amount-w.late);
    return(onTime>0?`<rect class="bh-bar is-forecast" x="${x}" y="${y(onTime)}" width="${round2(bw)}" height="${round2(top+plotH-y(onTime))}" rx="2"><title>${esc(`Semaine du ${dateFr(w.week)} : ${money(onTime)} attendus`)}</title></rect>`:'')
      +(w.late>0?`<rect class="bh-bar is-late" x="${x}" y="${y(w.amount)}" width="${round2(bw)}" height="${round2(y(onTime)-y(w.amount))}" rx="2"><title>${esc(`En retard, à relancer : ${money(w.late)}`)}</title></rect>`:'')
      +(i%2===0?`<text class="chart-axis" x="${round2(left+slot*i+slot/2)}" y="${height-8}" text-anchor="middle">${esc(shortDay(w.week))}</text>`:'');}).join('');
  const total=round2(weeks.reduce((s,w)=>s+w.amount,0)),late=round2(weeks.reduce((s,w)=>s+w.late,0));
  const label=`Encaissements attendus sur ${n} semaines : ${money(total)}${late?`, dont ${money(late)} déjà en retard (semaine en cours)`:''}.`;
  return`<svg class="chart bh-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${ticks}${bars}</svg>`;
}

// ---------- À faire ----------
const keyOf=d=>d.clientId||`nom:${normalize(d.clientName)}`;
// Relances dues regroupées par client : un seul message par client, au niveau le plus avancé.
export function reminderGroups(state,today=isoDay()){
  const map=new Map();
  for(const r of remindersDue(state,today)){const k=keyOf(r.invoice);if(!map.has(k))map.set(k,{key:k,clientId:r.invoice.clientId||'',name:r.invoice.clientName||'Client',items:[],total:0,level:1,maxDays:0});
    const g=map.get(k);g.items.push(r);g.total=round2(g.total+r.due);g.level=Math.max(g.level,r.level);g.maxDays=Math.max(g.maxDays,r.daysLate);}
  return[...map.values()].sort((a,b)=>b.level-a.level||b.total-a.total);
}
export function hubTodo(state,{today=isoDay(),dismissed=[]}={}){
  const skip=new Set(dismissed),reminders=reminderGroups(state,today),follow=quotesToFollow(state,today),expiringIds=new Set(follow.expiring.map(x=>x.quote.id));
  const quotesList=[...follow.expiring.map(x=>({...x,expiring:true})),...follow.toFollow.filter(x=>!expiringIds.has(x.quote.id)).map(x=>({...x,expiring:false}))];
  const recurring=dueSchedulesList(state,today),unbilled=unbilledAlerts(state,today);
  const duplicates=probableDuplicates(state).filter(d=>!skip.has(dupKey(d)));
  const risky=riskyClients(state,today);
  const count=reminders.length+quotesList.length+recurring.length+unbilled.length+duplicates.length;
  return{today,reminders,quotes:quotesList,recurring,unbilled,duplicates,risky,count,lateTotal:round2(reminders.reduce((s,g)=>s+g.total,0))};
}
export const dupKey=d=>[d.a.id,d.b.id].sort().join('|');
function dueSchedulesList(state,today){
  const clients=new Map(active(state,'clients').map(c=>[c.id,c]));
  return schedules(state).map(s=>({schedule:s,dates:scheduleOccurrences(s,today),client:clients.get(s.clientId)})).filter(x=>x.dates.length&&x.client&&!x.client.archived);
}

// ---------- Clients ----------
export function clientBilling(state,clientId,{today=isoDay()}={}){
  const client=active(state,'clients').find(c=>c.id===clientId)||null;
  const docs=billingDocs(state).filter(d=>d.clientId===clientId).sort((a,b)=>(a.status==='brouillon'?0:1)-(b.status==='brouillon'?0:1)||String(b.issueDate||'').localeCompare(String(a.issueDate||'')));
  let due=0,late=0,lateCount=0,drafts=0,openQuotes=0;
  const rows=docs.map(d=>{const t=docTypeOf(d),s=d.status==='brouillon'?'brouillon':t==='devis'||t==='proforma'?quoteStatus(d,today):invoiceStatus(d,state,today);
    if(s==='brouillon')drafts+=1;
    if(['emise','partielle','retard'].includes(s)&&t!=='avoir'){const b=invoiceBalance(state,d).due;due=round2(due+b);if(s==='retard'){late=round2(late+b);lateCount+=1;}}
    if(t==='devis'&&s==='envoye')openQuotes+=1;
    const tot=d.status==='brouillon'?documentTotals(d):d.totals||documentTotals(d);
    return{id:d.id,docType:t,label:DOC_LABELS[t],number:d.number||'Brouillon',date:d.issueDate||'',status:s,statusLabel:STATUS_LABELS[s]||s,ttc:tot.ttc};});
  const risk=clientRisk(state,clientId,today),unbilled=client?billableItems(state,clientId):[];
  const from=addMonths(`${String(today).slice(0,7)}-01`,-11),invoiced12=round2(invoices(state).filter(d=>d.clientId===clientId&&d.status!=='brouillon'&&d.issueDate>=from).reduce((s,d)=>s+(d.totals?.ht??documentTotals(d).ht),0));
  const delays=paymentDelays(scopeState(state,clientId));
  return{client,rows,due,late,lateCount,drafts,openQuotes,risk,invoiced12,averageDays:delays.averageDays,unbilled:{count:unbilled.length,amountHt:round2(unbilled.reduce((s,i)=>s+(lineTotal(i.line)||0),0)),lines:unbilled.map(i=>i.line)},
    schedules:schedules(state).filter(s=>s.clientId===clientId)};
}
export const RISK_LABELS={faible:'Risque faible',moyen:'Risque moyen',eleve:'Risque élevé'};
export function clientsOverview(state,{today=isoDay(),query=''}={}){
  const q=normalize(query);
  return active(state,'clients').filter(c=>!c.archived&&(!q||normalize(`${c.name} ${c.contact||''} ${c.email||''}`).includes(q))).map(c=>{
    const b=clientBilling(state,c.id,{today});return{id:c.id,name:c.name,due:b.due,late:b.late,lateCount:b.lateCount,risk:b.risk.level,docs:b.rows.length,invoiced12:b.invoiced12,unbilled:b.unbilled.count};
  }).sort((a,b)=>b.late-a.late||b.due-a.due||b.invoiced12-a.invoiced12||a.name.localeCompare(b.name,'fr'));
}

// ---------- Catalogue ----------
export function searchCatalog(state,{query='',category='',archived=false}={}){
  const q=normalize(query);
  return catalogItems(state,{includeArchived:true}).filter(i=>!!i.archived===archived&&(!category||(i.category||'')===category)&&(!q||normalize(`${i.code||''} ${i.label} ${i.description||''} ${i.category||''}`).includes(q)));
}
export const catalogCategories=state=>[...new Set(catalogItems(state,{includeArchived:true}).map(i=>i.category||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
export const ALL_UNITS=[...UNITS,...MORE_UNITS];
export const catalogPriceFor=catalogPrice;
// CSV : séparateur détecté (; , tabulation), guillemets doublés, BOM, fins de ligne mixtes.
export function parseCsv(text){
  const src=String(text||'').replace(/^﻿/,''),first=src.split(/\r?\n/,1)[0]||'';
  const delim=[';','\t',','].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<src.length;i+=1){const ch=src[i];
    if(quoted){if(ch==='"'&&src[i+1]==='"'){field+='"';i+=1;}else if(ch==='"')quoted=false;else field+=ch;continue;}
    if(ch==='"')quoted=true;else if(ch===delim){row.push(field);field='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&src[i+1]==='\n')i+=1;row.push(field);rows.push(row);row=[];field='';}else field+=ch;}
  if(field||row.length){row.push(field);rows.push(row);}
  return rows.filter(r=>r.some(c=>String(c).trim()));
}
const COLUMN_ALIASES={code:['code','reference','ref','code article','sku'],label:['designation','libelle','article','prestation','nom','label','intitule'],description:['description','detail','details'],
  unit:['unite','unit','u'],unitPrice:['prix','prix ht','pu ht','prix unitaire','prix unitaire ht','tarif','montant ht'],vatRate:['tva','taux tva','taux','tva %'],category:['categorie','famille','rubrique','category'],account:['compte','compte comptable','compte de produit']};
const unitAlias=v=>{const n=normalize(v).replace(/\s/g,'');const hit=ALL_UNITS.find(([u,l])=>normalize(u)===n||normalize(l)===n||normalize(l).replace(/\s/g,'')===n);return hit?hit[0]:/^(heures?|hrs?)$/.test(n)?'h':/^(m3|metrecube|metrescubes)$/.test(n)?'m³':/^(tonnes?)$/.test(n)?'t':/^(unites?|pieces?|pcs?)$/.test(n)?'u':/^(jours?)$/.test(n)?'j':v;};
const numberText=v=>String(v??'').replace(/[€%\s ]/g,'').replace(',','.');
// Lignes (première = en-têtes) → aperçu de l’import : nouveaux articles, mises à jour (même code), erreurs.
export const CATALOG_IMPORT_MAX=1000;
export function catalogImportPreview(state,rows,{customRates=invoiceSettings(state).customVatRates}={}){
  const [head=[],...body]=rows||[],cols={};
  head.forEach((h,i)=>{const n=normalize(h);for(const [k,list] of Object.entries(COLUMN_ALIASES))if(cols[k]===undefined&&list.includes(n))cols[k]=i;});
  if(cols.label===undefined)return{error:'Colonne « Désignation » introuvable : ajoutez un en-tête Désignation (ou Libellé).',items:[],errors:[],created:0,updated:0};
  const existing=new Map(catalogItems(state,{includeArchived:true}).filter(i=>i.code).map(i=>[i.code,i])),items=[],errors=[],seen=new Set();
  body.slice(0,CATALOG_IMPORT_MAX).forEach((r,i)=>{const get=k=>cols[k]===undefined?'':String(r[cols[k]]??'').trim();
    const read={code:get('code'),label:get('label'),description:get('description'),unit:unitAlias(get('unit')),unitPrice:numberText(get('unitPrice')),vatRate:numberText(get('vatRate')),category:get('category'),account:get('account')};
    if(!read.label&&!read.code)return;
    // Mise à jour (même code) : seules les colonnes présentes dans le fichier remplacent les valeurs de l’article ;
    // TVA, unité, catégorie, compte et description absents du fichier (ou cellule vide pour la désignation, l’unité
    // et la TVA) restent ceux du catalogue.
    const same=read.code?existing.get(read.code.toUpperCase())||null:null;
    const values=same?{...same,...Object.fromEntries(Object.entries(read).filter(([k,x])=>cols[k]!==undefined&&(x!==''||!['label','unit','vatRate'].includes(k))))}:{...read,vatRate:read.vatRate||'20'};
    const checked=validateCatalogItem(values,{customRates});if(checked.error){errors.push({line:i+2,error:checked.error});return;}
    const v=checked.value;if(v.code&&seen.has(v.code)){errors.push({line:i+2,error:`Code en double dans le fichier : ${v.code}`});return;}if(v.code)seen.add(v.code);
    items.push({values:same?{...v,clientPrices:same.clientPrices||[],archived:!!same.archived}:v,id:same?.id||null,line:i+2});});
  // Au-delà de la limite, les lignes ne sont pas lues : on le dit et on les compte parmi les lignes ignorées.
  const truncated=Math.max(0,body.length-CATALOG_IMPORT_MAX);
  return{items,errors,truncated,ignored:errors.length+truncated,created:items.filter(x=>!x.id).length,updated:items.filter(x=>x.id).length,columns:Object.keys(cols)};
}
// Feuille de calcul (SheetJS) → mêmes lignes que le CSV.
export function sheetRows(XLSX,buffer){const wb=XLSX.read(buffer,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];return ws?XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}).map(r=>r.map(c=>String(c??''))):[];}
export const CATALOG_CSV_MODEL='Code;Désignation;Description;Unité;Prix HT;TVA;Catégorie;Compte\nPELLE;Pelle mécanique;Avec chauffeur;h;65;20;Terrassement;706\n';

// ---------- Récurrences ----------
export const frequencyLabel=f=>(FREQUENCIES.find(([k])=>k===f)||FREQUENCIES[0])[2];
export function scheduleRows(state,{today=isoDay()}={}){
  const clients=new Map(active(state,'clients').map(c=>[c.id,c])),docs=invoices(state);
  return schedules(state).map(s=>{const lines=(s.lines||[]).filter(l=>lineKind(l)==='item'),ht=round2(lines.reduce((t,l)=>t+(lineTotal(l)||0),0));
    const history=docs.filter(d=>d.scheduleId===s.id).sort((a,b)=>String(b.periodStart||b.issueDate||'').localeCompare(String(a.periodStart||a.issueDate||''))).map(d=>({id:d.id,number:d.number||'Brouillon',period:d.periodStart||d.issueDate||'',status:d.status==='brouillon'?'brouillon':invoiceStatus(d,state,today)}));
    return{schedule:s,client:clients.get(s.clientId)||null,frequency:frequencyLabel(s.frequency),amountHt:ht,due:scheduleOccurrences(s,today).length,history,ended:!s.active};
  }).sort((a,b)=>(a.ended?1:0)-(b.ended?1:0)||String(a.schedule.nextDate).localeCompare(String(b.schedule.nextDate)));
}
// Modèle prérempli depuis un document : client, lignes facturables, prochaine date un mois après.
export function scheduleFromDocument(doc,{today=isoDay()}={}){
  const lines=(doc?.lines||[]).filter(l=>lineKind(l)!=='deduction').map(({id:_id,source:_s,...l})=>({...l}));
  // Prochaine échéance mensuelle au même jour que le document, aujourd’hui ou plus tard.
  const base=doc?.issueDate||today;let k=1,next=addMonths(base,1);
  while(next<today&&k<240){k+=1;next=addMonths(base,k);}
  return{clientId:doc?.clientId||'',label:doc?.subject||`Facturation mensuelle · ${doc?.clientName||'client'}`,lines,frequency:'mensuel',nextDate:next,endDate:'',mode:'brouillon',note:''};
}

// ---------- Réglages ----------
// Paramètres tels qu’ils seraient enregistrés (saisie en cours fusionnée), pour les aperçus.
export function settingsWith(state,draft={}){
  const invoicing={...(state?.exploitation?.invoicing||{}),...draft};
  return{state:{...state,exploitation:{...(state?.exploitation||{}),invoicing}},settings:invoiceSettings({...state,exploitation:{...(state?.exploitation||{}),invoicing}})};
}
export const NUMBERING_DOC_TYPES=[['facture','Factures'],['acompte','Factures d’acompte'],['avoir','Avoirs'],['devis','Devis et pro forma']];
export function numberingPreview(state,draft,docType='facture',date=isoDay()){
  const {state:s,settings}=settingsWith(state,draft),cfg=settings.numbering[docType],c=compileNumbering(cfg.format,cfg.prefix);
  if(c.error)return{error:c.error};
  if(cfg.reset==='annuel'&&!c.hasYear)return{error:'Remise à zéro annuelle : ajoutez {AAAA} ou {AA} au format.'};
  try{const {number,sequence}=allocateNumber(s,docType,date,{settings});return{number,sequence};}catch(error){return{error:error.message};}
}
export function ibanCheck(value){
  const v=String(value||'').replace(/\s/g,'').toUpperCase();
  if(!v)return{state:'empty',message:'Facultatif : sans IBAN, ni coordonnées bancaires ni QR de virement.'};
  if(!/^[A-Z]{2}\d{2}[0-9A-Z]{10,30}$/.test(v))return{state:'bad',message:'Format inattendu : 2 lettres, 2 chiffres puis 10 à 30 caractères.'};
  if(!ibanValid(v))return{state:'bad',message:'Clé de contrôle incorrecte : vérifiez chaque caractère.'};
  return{state:'ok',message:`IBAN valide (${v.slice(0,2)}) : ${v.replace(/(.{4})/g,'$1 ').trim()}`,formatted:v.replace(/(.{4})/g,'$1 ').trim()};
}
export const bicCheck=v=>{const b=String(v||'').replace(/\s/g,'').toUpperCase();return!b?{state:'empty',message:''}:/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b)?{state:'ok',message:'BIC au bon format.'}:{state:'bad',message:'BIC : 8 ou 11 caractères (ex. AGRIFRPP).'};};
export const siretCheck=v=>{const s=String(v||'').replace(/\s/g,'');return!s?{state:'bad',message:'Obligatoire pour émettre.'}:!/^\d{14}$/.test(s)?{state:'bad',message:'14 chiffres attendus.'}:!luhnValid(s)?{state:'warn',message:'Clé de contrôle inhabituelle : vérifiez le numéro.'}:{state:'ok',message:`SIREN ${s.slice(0,9)}`};};
// Contrôles bloquants de la saisie complète (identité comprise) : liste des points à corriger.
export function settingsChecklist(state){
  const s=invoiceSettings(state),full=validateSettings(s);
  return[{key:'identite',label:'Identité du vendeur',ok:!!(s.legalName&&s.address&&/^\d{14}$/.test(s.siret)),detail:full.error&&['Raison sociale','Adresse','SIRET'].includes(full.field)?full.error:''},
    {key:'banque',label:'Coordonnées bancaires',ok:!!s.iban&&ibanValid(s.iban),detail:s.iban?'':'IBAN absent : pas de QR de virement'},
    {key:'tva',label:'TVA',ok:s.vatRegime!=='normal'||!!s.vatNumber,detail:s.vatRegime==='normal'&&!s.vatNumber?'N° de TVA intracommunautaire absent':''},
    {key:'modele',label:'Modèle visuel',ok:true,detail:s.logo?'Logo importé':'Sans logo'}];
}

// Document d’exemple pour l’aperçu du modèle et des messages (jamais enregistré).
export function sampleDocument(state,{docType='facture',today=isoDay(),draft={}}={}){
  const {state:s,settings}=settingsWith(state,draft),client=active(state,'clients').find(c=>!c.archived);
  const lines=[{id:'l1',kind:'section',label:'Travaux de printemps'},{id:'l2',label:'Labour',quantity:4.5,unit:'ha',unitPrice:95,vatRate:settings.vatRate,date:addDays(today,-12)},{id:'l3',label:'Pelle mécanique avec chauffeur',quantity:6,unit:'h',unitPrice:65,vatRate:settings.vatRate,discountPct:5,date:addDays(today,-9)},{id:'l4',label:'Transport de matériaux',quantity:12,unit:'t',unitPrice:18,vatRate:settings.vatRate,date:addDays(today,-9)}];
  const numbering=numberingPreview(state,draft,docType,today);
  const doc={id:'apercu',farmKind:docType==='devis'?'quote':'invoice',docType,status:'emise',number:numbering.number||'F-APERCU',issueDate:today,dueDate:addDays(today,settings.paymentDays),validUntil:docType==='devis'?addDays(today,settings.quoteValidityDays):'',deliveryDate:addDays(today,-9),
    clientId:'',clientName:client?.name||'GAEC des Exemples',clientAddress:client?.billingAddress||client?.address||'12 chemin des Prés\n01000 Bourg-en-Bresse',clientKind:'pro',clientSiren:client?.siren||'',lines,payments:[],operationNature:settings.operationNature};
  doc.totals=documentTotals(doc);doc.legalMentions=legalMentions(s,{...doc,status:'brouillon'});
  return{doc,state:s,settings};
}

// ---------- Réglages : sections et valeurs saisies ----------
export const SETTINGS_SECTIONS=[['identite','Identité'],['tva','TVA'],['banque','Banque et QR'],['numerotation','Numérotation'],['conditions','Conditions'],['relances','Relances'],['messages','Messages'],['modele','Modèle visuel'],['accueil','Accueil']];
export const settingsSection=s=>SETTINGS_SECTIONS.some(([k])=>k===s)?s:'identite';
export const LEGAL_FORMS=['Exploitant individuel','EARL','GAEC','SCEA','SARL','EURL','SAS','SASU','SA','Entreprise individuelle','Micro-entreprise','Association'];
export const TEMPLATE_COLUMNS=[['date','Date de la prestation'],['unit','Unité'],['vat','Taux de TVA'],['discount','Remise de ligne']];
export const MESSAGE_KEYS=[['envoi','Envoi d’une facture'],['devis','Envoi d’un devis'],['suiviDevis','Suivi d’un devis'],['remerciement','Remerciement après paiement']];
export const MESSAGE_VARIABLES=[['prenom','prénom du contact'],['client','nom du client'],['entreprise','votre raison sociale'],['numero','numéro du document'],['date','date d’émission'],['montant','total TTC'],['echeance','échéance'],['reste','reste dû'],['jours','jours de retard'],['frais','frais de relance'],['iban','IBAN'],['validite','validité du devis'],['travaux','prestations facturées']];
const str=v=>String(v??'').trim();
const decimal=v=>Number(str(v).replace(/\s/g,'').replace(',','.').replace('%',''));
const parseRates=v=>str(v).split(/[;\s]+/).filter(Boolean).map(decimal).filter(x=>Number.isFinite(x)&&x>=0&&x<=100);
const isOn=v=>v===true||v==='on'||v==='1'||v==='true';
// Champs d’un formulaire (objet plat, cases cochées en booléen ou « on ») → valeurs à enregistrer pour une
// section. Les objets composés (modèle, numérotation, relances, messages) repartent des réglages actuels.
export function sectionValues(section,f={},settings=invoiceSettings({})){
  const s=settings;
  switch(settingsSection(section)){
    case 'identite':return{legalName:str(f.legalName),legalForm:str(f.legalForm),capital:str(f.capital),rcs:str(f.rcs),address:str(f.address),siret:str(f.siret),vatNumber:str(f.vatNumber),email:str(f.email),phone:str(f.phone)};
    case 'tva':return{vatRegime:str(f.vatRegime)||'normal',vatOnDebits:f.vatTiming==='debits',operationNature:str(f.operationNature)||'services',vatRate:decimal(f.vatRate),customVatRates:parseRates(f.customVatRates)};
    case 'banque':return{iban:str(f.iban),bic:str(f.bic),template:{...s.template,showQr:isOn(f.showQr)}};
    case 'numerotation':{
      const numbering={};
      for(const [t] of NUMBERING_DOC_TYPES)numbering[t]={prefix:str(f[`${t}Prefix`])||s.numbering[t].prefix,format:str(f[`${t}Format`])||s.numbering[t].format,reset:f[`${t}Reset`]==='jamais'?'jamais':'annuel',startAt:Math.max(1,Math.floor(Number(f[`${t}StartAt`])||1))};
      return{prefix:numbering.facture.prefix,numbering};
    }
    case 'conditions':return{paymentDays:Number(f.paymentDays),escompte:str(f.escompte),penalty:str(f.penalty),quoteValidityDays:Number(f.quoteValidityDays),depositPct:decimal(f.depositPct),mention:str(f.mention)};
    case 'relances':return{reminders:[1,2,3].map(l=>({level:l,days:Number(f[`r${l}Days`]),fee:decimal(f[`r${l}Fee`])||0,...(str(f[`r${l}Subject`])?{subject:str(f[`r${l}Subject`])}:{}),...(str(f[`r${l}Body`])?{body:str(f[`r${l}Body`])}:{})}))};
    case 'messages':{
      const messages={...s.messages};
      for(const [k] of MESSAGE_KEYS){const subject=str(f[`${k}Subject`]),body=str(f[`${k}Body`]);if(subject||body)messages[k]={subject,body};else delete messages[k];}
      return{messages};
    }
    case 'modele':return{accent:str(f.accent)||s.accent,logo:str(f.logo),template:{...s.template,font:str(f.font)||'sans',columns:Object.fromEntries(TEMPLATE_COLUMNS.map(([k])=>[k,isOn(f[`col_${k}`])])),freeMentions:str(f.freeMentions),footer:str(f.footer),terms:str(f.terms),showQr:isOn(f.showQr)}};
    default:return{};
  }
}
// Texte fourni d’un modèle de message (affiché en exemple dans le formulaire).
export function defaultMessage(key){
  if(key==='devis')return{subject:'Devis {numero} · {entreprise}',body:'Bonjour {prenom},\n\nVeuillez trouver ci-joint notre devis n° {numero} du {date}, d’un montant de {montant} TTC, valable jusqu’au {validite}.\n\nPour l’accepter, il suffit de nous le retourner signé avec la mention « Bon pour accord ».\n\nCordialement,\n{entreprise}'};
  if(key==='suiviDevis')return QUOTE_FOLLOW_UP;
  return DEFAULT_MESSAGES[key]||DEFAULT_MESSAGES.envoi;
}
// Aperçu d’un message sur le document d’exemple, avec les réglages en cours de saisie.
export function messagePreview(state,key,draft={},{today=isoDay()}={}){
  const docType=key==='devis'||key==='suiviDevis'?'devis':'facture',{doc,state:s,settings}=sampleDocument(state,{docType,today,draft});
  const relance=/^relance([123])$/.exec(key);
  if(relance){const days=settings.reminders.find(r=>r.level===Number(relance[1]))?.days??10;return documentMessage(s,{...doc,dueDate:addDays(today,-days)},{purpose:key,today});}
  if(key==='suiviDevis')return quoteFollowUpMessage(s,{...doc,status:'envoye'},{today});
  return documentMessage(s,doc,{purpose:key==='devis'?'envoi':key,today});
}
// Contrôle de la numérotation (doublons, trous) pour l’écran Réglages.
export function numberingReport(state){
  let r={duplicates:[],gaps:[]};
  try{r=numberingIssues(state);}catch{/* réglages illisibles : rien à signaler */}
  return{duplicates:r.duplicates||[],gaps:r.gaps||[],ok:!(r.duplicates||[]).length&&!(r.gaps||[]).length};
}
