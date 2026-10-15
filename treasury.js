// n° 86 — Prévisionnel de trésorerie sur 12 mois. Logique pure : aucun accès au DOM.
// Les flux sont déduits de l'état existant (contrats et ventes, factures émises non payées, aides PAC
// saisies en €/ha, travaux prévus chiffrés, entretiens datés à venir) et d'un petit échéancier saisi
// par la personne. Solde de départ et échéancier vivent dans preferences.treasury (préférence locale,
// non synchronisée) : pas de nouvelle collection ni de changement de schéma. Estimation, non contractuelle.
import {active,completed} from './farm-memory.js';
import {contracts,contractPrice,toTonnes,pricePerTonne} from './sales.js';
import {invoices,invoiceStatus,creditNotesOf} from './invoices.js';
import {hasCost,proposeCost,costReferences} from './costs.js';
import {farmRecords} from './farm-records.js';
import {pacAids} from './crop-margins.js';

export const HORIZON=12;
export const DISCLAIMER='Estimation, non contractuelle : les montants viennent de vos saisies et de coûts estimés ; ils ne remplacent ni votre banque ni votre comptable.';
export const PERIODICITIES=Object.freeze([['mensuelle','Mensuelle',1],['trimestrielle','Trimestrielle',3],['annuelle','Annuelle',12]]);
const STEP=Object.fromEntries(PERIODICITIES.map(([id,,n])=>[id,n]));
// Calendrier indicatif des aides PAC : avance mi-octobre, solde en décembre.
export const PAC_SCHEDULE=Object.freeze([[10,.7],[12,.3]]);
const MONTHS=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/,DATE_RE=/^\d{4}-\d{2}-\d{2}/;

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const round2=v=>Math.round(v*100)/100;
const text=v=>String(v??'').trim();
const pad=n=>String(n).padStart(2,'0');

export const monthKey=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
/** Date du jour locale (AAAA-MM-JJ), pas UTC. */
export const dayKey=(d=new Date())=>`${monthKey(d)}-${pad(d.getDate())}`;
export function addMonths(key,n){const [y,m]=key.split('-').map(Number),t=y*12+(m-1)+n;return`${Math.floor(t/12)}-${pad(t%12+1)}`;}
export function monthDiff(from,to){const [a,b]=from.split('-').map(Number),[c,d]=to.split('-').map(Number);return(c*12+d)-(a*12+b);}
export const monthLabel=key=>{const [y,m]=key.split('-');return`${MONTHS[Number(m)-1]} ${y.slice(2)}`;};
const monthOf=date=>DATE_RE.test(String(date||''))?String(date).slice(0,7):null;

/** Réglages lus dans les préférences, nettoyés (tolère l'absence et les valeurs abîmées). */
export function treasurySettings(state){
  const t=state?.preferences?.treasury||{};
  return{openingBalance:num(t.openingBalance),updatedAt:t.updatedAt||null,items:(Array.isArray(t.items)?t.items:[]).map(cleanItem).filter(Boolean)};
}
function cleanItem(item){
  const amount=num(item?.amount),label=text(item?.label);
  if(!label||amount===null||amount<=0||!STEP[item?.periodicity]||!MONTH_RE.test(item?.startMonth||''))return null;
  return{id:text(item.id)||`ech_${label}`,label,amount:round2(amount),sign:item.sign==='+'?'+':'-',periodicity:item.periodicity,startMonth:item.startMonth};
}

/** Validation d'une ligne d'échéancier saisie dans le formulaire. */
export function validateItem(values){
  const label=text(values?.label),amount=num(values?.amount),periodicity=text(values?.periodicity)||'mensuelle',startMonth=text(values?.startMonth),sign=values?.sign==='+'?'+':'-';
  if(!label)return{error:'Champ obligatoire : Libellé',field:'Libellé'};
  if(label.length>80)return{error:'Libellé trop long (80 caractères au plus).',field:'Libellé'};
  if(amount===null||amount<=0||amount>10_000_000)return{error:'Montant invalide : saisissez un montant positif en €.',field:'Montant'};
  if(!STEP[periodicity])return{error:'Périodicité invalide.',field:'Périodicité'};
  if(!MONTH_RE.test(startMonth))return{error:'Mois de départ invalide.',field:'Mois de départ'};
  return{value:{label,amount:round2(amount),sign,periodicity,startMonth}};
}
export function validateOpening(value){
  if(String(value??'').trim()==='')return{value:null};
  const n=num(value);if(n===null||Math.abs(n)>100_000_000)return{error:'Solde de départ invalide.'};
  return{value:round2(n)};
}

/** Mois de l'horizon où tombe une ligne d'échéancier. */
export function itemOccurrences(item,start,horizon=HORIZON){
  const step=STEP[item.periodicity];if(!step)return[];const out=[];
  for(let i=0;i<horizon;i+=1){const key=addMonths(start,i),d=monthDiff(item.startMonth,key);if(d>=0&&d%step===0)out.push(key);}
  return out;
}

/**
 * Flux prévisionnels : lignes {month,amount (signé),label,source,late?}. Un flux daté avant le mois
 * de départ mais toujours attendu (facture en retard, travail prévu en retard) tombe dans le premier mois.
 */
export function treasuryFlows(state,{start=monthKey(),today=`${start}-01`,horizon=HORIZON}={}){
  const end=addMonths(start,horizon-1),lines=[],missing={works:0,contracts:0,pac:false};
  const inRange=m=>m&&m>=start&&m<=end;
  const push=(month,amount,label,source,late=false)=>{if(amount&&inRange(month))lines.push({month,amount:round2(amount),label,source,late});};
  // Contrats de vente : montant à la date de paiement, sinon de livraison.
  for(const c of contracts(state)){
    const month=monthOf(c.paymentDate)||monthOf(c.deliveryDate);if(!inRange(month))continue;
    const day=String(c.paymentDate||c.deliveryDate||'');if(DATE_RE.test(day)&&day.slice(0,10)<today)continue; // déjà encaissé
    const price=contractPrice(c),tonnes=num(c.tonnes);
    if(price===null||!tonnes){missing.contracts+=1;continue;}
    push(month,tonnes*price,`Contrat ${text(c.culture)} · ${text(c.buyer)}`,'contrat');
  }
  // Ventes déclarées hors contrat (lots de récolte) datées dans l'horizon.
  for(const lot of farmRecords(state,'harvest')){
    for(const sale of lot.sales||[]){
      if(sale.contractId)continue;const month=monthOf(sale.paymentDate)||monthOf(sale.date);if(!inRange(month))continue;
      const day=String(sale.paymentDate||sale.date||'');if(DATE_RE.test(day)&&day.slice(0,10)<today)continue; // déjà encaissé
      const t=toTonnes(sale.quantity,lot.unit),p=pricePerTonne(sale.price,lot.unit);if(t===null||p===null)continue;
      push(month,t*p,`Vente ${text(lot.crop||lot.code||lot.name)}`,'vente');
    }
  }
  // Factures émises non payées : reste dû (avoirs déduits) à l'échéance.
  for(const inv of invoices(state)){
    const s=invoiceStatus(inv,state,today);if(s!=='emise'&&s!=='retard')continue;
    const credited=creditNotesOf(state,inv).reduce((x,a)=>x+Math.abs(num(a.totals?.ttc)||0),0),rest=Math.max(0,(num(inv.totals?.ttc)||0)-credited);
    const due=monthOf(inv.dueDate)||monthOf(inv.issueDate)||start,late=s==='retard'||due<start;
    push(late?start:due,rest,`Facture ${text(inv.number)||'émise'}`,'facture',late);
  }
  // Aides PAC saisies en €/ha × surface des parcelles (calendrier indicatif).
  const aids=pacAids(state);
  if(aids.total!==null&&aids.total>0){
    const area=active(state,'parcelles').reduce((s,p)=>s+(num(p.surfaceHa)||0),0),total=aids.total*area;
    for(let i=0;i<horizon;i+=1){const key=addMonths(start,i),share=PAC_SCHEDULE.find(([m])=>m===Number(key.slice(5)))?.[1];if(share)push(key,total*share,share>=.5?'Aides PAC (avance)':'Aides PAC (solde)','pac');}
  }else missing.pac=true;
  // Travaux prévus : coût saisi, sinon coût estimé (moyenne de l'exploitation ou barème).
  const references=costReferences(state);
  for(const w of active(state,'interventions')){
    if(completed(w)||w.status==='Annulé')continue;const due=monthOf(w.plannedDate||w.date);if(!due||due>end)continue;
    const value=hasCost(w)?num(w.cost):proposeCost(state,w,{references})?.value??null;
    if(value===null||!(value>0)){missing.works+=1;continue;}
    const late=due<start;push(late?start:due,-value,text(w.type)||'Travail','travail',late);
  }
  // Entretiens datés à venir.
  for(const r of active(state,'maintenanceRecords')){
    if(!(String(r.date||'')>=today))continue;const cost=num(r.cost);if(!cost||cost<=0)continue;
    const machine=active(state,'materiels').find(m=>m.id===r.equipmentId);
    push(monthOf(r.date),-cost,`Entretien ${text(r.type)}${machine?` · ${text(machine.nom)}`:''}`,'entretien');
  }
  // Échéancier saisi.
  for(const item of treasurySettings(state).items)for(const month of itemOccurrences(item,start,horizon))push(month,item.sign==='+'?item.amount:-item.amount,item.label,'echeancier');
  return{lines,missing};
}

/** Prévisionnel mois par mois avec solde cumulé et point bas. */
export function treasuryForecast(state,options={}){
  const start=options.start||monthKey(),horizon=options.horizon||HORIZON,settings=treasurySettings(state);
  const {lines,missing}=treasuryFlows(state,{...options,start,horizon});
  const opening=settings.openingBalance;let balance=opening??0;
  const months=Array.from({length:horizon},(_,i)=>{
    const key=addMonths(start,i),own=lines.filter(l=>l.month===key);
    const income=round2(own.filter(l=>l.amount>0).reduce((s,l)=>s+l.amount,0)),expense=round2(own.filter(l=>l.amount<0).reduce((s,l)=>s-l.amount,0));
    balance=round2(balance+income-expense);
    return{key,label:monthLabel(key),income,expense,net:round2(income-expense),balance,lines:own};
  });
  const low=months.reduce((m,x)=>!m||x.balance<m.balance?x:m,null);
  return{start,months,opening,openingMissing:opening===null,low:low?{key:low.key,label:low.label,balance:low.balance,negative:low.balance<0}:null,
    totals:{income:round2(months.reduce((s,m)=>s+m.income,0)),expense:round2(months.reduce((s,m)=>s+m.expense,0))},missing,items:settings.items};
}

const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
/** Courbe SVG : barres d'encaissements et de décaissements, ligne du solde, zéro et point bas. */
export function treasuryChart(forecast,{width=340,height=180}={}){
  const months=forecast?.months||[];if(!months.length)return'';
  const values=months.flatMap(m=>[m.balance,m.income,-m.expense]).concat(0);
  let min=Math.min(...values),max=Math.max(...values);if(max===min){max+=1;min-=1;}
  const top=10,bottom=height-22,left=4,right=width-4,slot=(right-left)/months.length,y=v=>top+(max-v)/(max-min)*(bottom-top),zero=y(0);
  const bars=months.map((m,i)=>{const x=left+i*slot,w=Math.max(2,slot*.32);return`${m.income?`<rect class="tr-in" x="${(x+slot*.15).toFixed(1)}" y="${y(m.income).toFixed(1)}" width="${w.toFixed(1)}" height="${(zero-y(m.income)).toFixed(1)}"/>`:''}${m.expense?`<rect class="tr-out" x="${(x+slot*.5).toFixed(1)}" y="${zero.toFixed(1)}" width="${w.toFixed(1)}" height="${(y(-m.expense)-zero).toFixed(1)}"/>`:''}<text x="${(x+slot/2).toFixed(1)}" y="${height-6}" text-anchor="middle">${esc(m.label.split(' ')[0])}</text>`;}).join('');
  const pts=months.map((m,i)=>`${(left+(i+.5)*slot).toFixed(1)},${y(m.balance).toFixed(1)}`).join(' ');
  const li=months.findIndex(m=>m.key===forecast.low?.key),lowDot=li>=0?`<circle class="tr-low${forecast.low.negative?' is-negative':''}" cx="${(left+(li+.5)*slot).toFixed(1)}" cy="${y(months[li].balance).toFixed(1)}" r="4"/>`:'';
  return`<svg class="treasury-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Solde de trésorerie prévu sur ${months.length} mois"><line class="tr-zero" x1="${left}" x2="${right}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}"/>${bars}<polyline class="tr-balance" fill="none" points="${pts}"/>${lowDot}</svg>`;
}
