// I7 — Valeurs « comme la dernière fois » pour le stock, le carburant et l'entretien.
// Logique pure, sur le modèle de defaultsFor (quick-entry.js) et learnedDose (quick-work.js).
// Chaque suggestion a la forme {value, from} : from explique d'où vient la valeur
// (« dernière entrée du 12/09 »). Rien n'est imposé : l'interface propose, l'utilisateur choisit.
// Historique vide : toutes les valeurs valent null.
import {active,completed} from './farm-memory.js';
import {tankFills,machineFills,isLegacyFill} from './fuel.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const pos=v=>{const n=num(v);return n!==null&&n>0?n:null;};
const r2=v=>Math.round(v*100)/100,r3=v=>Math.round(v*1000)/1000;
const day=v=>String(v||'').slice(0,10);
const isDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(day(v));
const dayMs=d=>Date.parse(`${day(d)}T12:00:00Z`);
const daysBetween=(a,b)=>Math.round((dayMs(b)-dayMs(a))/86400000);
const shortDate=d=>isDay(d)?`${day(d).slice(8,10)}/${day(d).slice(5,7)}`:'';
const byDate=(a,b)=>day(a.date).localeCompare(day(b.date))||(Number(a.createdAt)||0)-(Number(b.createdAt)||0);
const suggest=(value,from)=>value===null||value===undefined||value===''?null:{value,from};
const eur=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});

/** Médiane d'une liste de nombres (null si vide). */
export function median(values){
  const v=(values||[]).map(num).filter(x=>x!==null).sort((a,b)=>a-b);if(!v.length)return null;
  const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;
}

// Mouvement annulé : plusieurs marquages possibles selon l'origine (corbeille exclue par active()).
const cancelled=m=>Boolean(m.cancelled||m.cancelledAt||m.reversedBy||m.voided)||['Annulé','Annulée','annulé','cancelled'].includes(m.status);

/** Fournisseur le plus fréquent sur la fenêtre, départagé par la date la plus récente. */
function frequentSupplier(rows,{today=null,windowDays=365,label}){
  const since=today&&isDay(today)?dayMs(today)-windowDays*86400000:null;
  const counts=new Map();
  for(const r of rows){
    const name=String(r.supplier||'').trim();if(!name)continue;if(since!==null&&dayMs(r.date)<since)continue;
    const key=name.toLocaleLowerCase('fr'),c=counts.get(key)||{name,count:0,last:''};
    c.count+=1;if(day(r.date)>=c.last){c.last=day(r.date);c.name=name;}counts.set(key,c);
  }
  const best=[...counts.values()].sort((a,b)=>b.count-a.count||b.last.localeCompare(a.last))[0];
  if(!best)return null;
  return suggest(best.name,best.count>1?`${best.count} ${label.plural} sur 12 mois`:`${label.singular} du ${shortDate(best.last)}`);
}

/**
 * Valeurs habituelles d'une entrée de stock.
 * @returns {{supplier,unitPrice,unit,expiryOffsetDays,priceMedian:number|null}}
 */
export function stockEntryDefaults(state,stockItemId,{today=null}={}){
  const item=active(state||{},'stockItems').find(x=>x.id===stockItemId)||null;
  const entries=active(state||{},'stockMovements').filter(m=>m.stockItemId===stockItemId&&m.type==='Entrée'&&!cancelled(m)&&isDay(m.date)&&(!today||day(m.date)<=day(today))).sort(byDate);
  const out={supplier:null,unitPrice:null,unit:null,expiryOffsetDays:null,priceMedian:null};
  if(!entries.length)return out;
  out.supplier=frequentSupplier(entries,{today,label:{singular:'dernière entrée',plural:'entrées'}});
  const priced=entries.filter(m=>pos(m.unitPrice)!==null);
  const lastPriced=priced.at(-1);
  if(lastPriced)out.unitPrice=suggest(r3(pos(lastPriced.unitPrice)),`dernière entrée du ${shortDate(lastPriced.date)}`);
  const m3=median(priced.slice(-3).map(m=>pos(m.unitPrice)));out.priceMedian=m3===null?null:r3(m3);
  const unit=String(entries.at(-1).unit||item?.unit||'').trim();
  if(unit)out.unit=suggest(unit,entries.at(-1).unit?`dernière entrée du ${shortDate(entries.at(-1).date)}`:'unité de l’article');
  const withExpiry=entries.filter(m=>isDay(m.expiryDate)&&day(m.expiryDate)>=day(m.date)).at(-1);
  if(withExpiry)out.expiryOffsetDays=suggest(daysBetween(withExpiry.date,withExpiry.expiryDate),`péremption de la dernière entrée du ${shortDate(withExpiry.date)}`);
  return out;
}

/**
 * Valeurs habituelles d'un plein (livraison de cuve par défaut, plein d'engin avec entry:'machine').
 * @returns {{supplier,pricePerLiter,tank,liters,priceMedian:number|null}}
 */
export function fuelDefaults(state,{today=null,entry='tank',equipmentId=null}={}){
  const s=state||{};
  const rows=(entry==='machine'?machineFills(s,equipmentId||undefined):tankFills(s)).filter(r=>!r.deletedAt&&!cancelled(r)&&isDay(r.date)&&(!today||day(r.date)<=day(today))&&pos(r.litres)!==null);
  const out={supplier:null,pricePerLiter:null,tank:null,liters:null,priceMedian:null};
  if(!rows.length)return out;
  const what=entry==='machine'?'plein':'livraison';
  out.supplier=frequentSupplier(rows.filter(r=>!r.legacy),{today,label:{singular:entry==='machine'?'dernier plein':'dernière livraison',plural:`${what}s`}});
  const priced=rows.filter(r=>pos(r.unitPrice)!==null),last=priced.at(-1);
  if(last)out.pricePerLiter=suggest(r3(pos(last.unitPrice)),`${entry==='machine'?'dernier plein':'dernière livraison'} du ${shortDate(last.date)}`);
  const pm=median(priced.slice(-3).map(r=>pos(r.unitPrice)));out.priceMedian=pm===null?null:r3(pm);
  const lit=median(rows.map(r=>pos(r.litres)));
  if(lit!==null)out.liters=suggest(r2(lit),rows.length>1?`médiane de ${rows.length} ${what}s`:`${entry==='machine'?'dernier plein':'dernière livraison'} du ${shortDate(rows.at(-1).date)}`);
  if(entry==='machine'){const lastFill=rows.at(-1);if(typeof lastFill.fromTank==='boolean')out.tank=suggest(lastFill.fromTank,`dernier plein du ${shortDate(lastFill.date)}`);}
  else{const cap=pos(s.preferences?.fuelTank?.capacity);if(cap!==null)out.tank=suggest(cap,'capacité de la cuve');}
  return out;
}

const updatedDay=m=>{const v=m?.updatedAt;if(v===null||v===undefined||v==='')return null;const d=typeof v==='number'?new Date(v):new Date(String(v));if(Number.isNaN(d.getTime()))return null;return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const usesMachine=(w,id)=>w.equipmentId===id||w.machineId===id||w.resourceEffects?.machineId===id||(Array.isArray(w.materielIds)&&w.materielIds.includes(id));
const workHours=w=>pos(w?.resourceEffects?.hours)??pos(w?.duration??w?.durationHours);

/**
 * Valeurs habituelles d'un entretien : intervalle entre deux opérations du même type
 * (en heures si les compteurs sont connus, sinon en jours) et compteur estimé
 * (dernier relevé connu + heures des travaux terminés de l'engin depuis ce relevé).
 * @returns {{interval,counter}}
 */
export function maintenanceDefaults(state,equipmentId,type,{today=null}={}){
  const s=state||{},out={interval:null,counter:null};
  if(!equipmentId)return out; // sans engin, machineFills() renverrait les pleins de tous les engins
  const records=active(s,'maintenanceRecords').filter(r=>r.equipmentId===equipmentId&&!isLegacyFill(r)&&!cancelled(r)&&isDay(r.date)&&(!today||day(r.date)<=day(today))).sort(byDate);
  const same=type?records.filter(r=>String(r.type||'').toLocaleLowerCase('fr')===String(type).toLocaleLowerCase('fr')):[];
  if(same.length>=2){
    const metered=same.filter(r=>num(r.meter)!==null),gapsH=[];
    for(let i=1;i<metered.length;i++){const g=num(metered[i].meter)-num(metered[i-1].meter);if(g>0)gapsH.push(g);}
    const lastTwo=`${same.length} opérations « ${type} »`;
    if(gapsH.length)out.interval={...suggest(r2(median(gapsH)),`écart médian entre ${lastTwo}`),unit:'h'};
    else{const gapsD=[];for(let i=1;i<same.length;i++){const g=daysBetween(same[i-1].date,same[i].date);if(g>0)gapsD.push(g);}
      if(gapsD.length)out.interval={...suggest(Math.round(median(gapsD)),`écart médian entre ${lastTwo}`),unit:'j'};}
  }
  // Dernier relevé daté : entretiens et pleins d'engin.
  const readings=[...records.filter(r=>num(r.meter)!==null).map(r=>({date:day(r.date),meter:num(r.meter),createdAt:r.createdAt,src:'entretien'})),
    ...machineFills(s,equipmentId).filter(r=>!r.deletedAt&&isDay(r.date)&&num(r.meter)!==null&&(!today||day(r.date)<=day(today))).map(r=>({date:day(r.date),meter:num(r.meter),createdAt:r.createdAt,src:'plein'}))]
    .sort((a,b)=>byDate(a,b)||a.meter-b.meter);
  const last=readings.at(-1);
  const machine=active(s,'materiels').find(m=>m.id===equipmentId);const card=num(machine?.currentMeter);
  if(!last){if(card!==null)out.counter=suggest(card,'compteur de la fiche engin');return out;}
  // Fiche plus haute que le dernier relevé : elle a été corrigée après lui. Seules les heures postérieures
  // à sa dernière mise à jour s'y ajoutent (sinon elles seraient comptées deux fois) ; date inconnue : aucune.
  const fromCard=card!==null&&card>last.meter,base=fromCard?card:last.meter,since=fromCard?updatedDay(machine):last.date;
  const inWindow=d=>Boolean(since)&&isDay(d)&&day(d)>since&&(!today||day(d)<=day(today));
  const works=active(s,'interventions').filter(w=>usesMachine(w,equipmentId)&&completed(w)&&w.status!=='Annulé'&&inWindow(w.date));
  // Comme machine-costs.js : les journées de chantier TP (heures saisies) comptent aussi.
  const tp=active(s,'chantiers').filter(c=>c.kind==='tp').flatMap(c=>(c.tpLogs||[]).filter(l=>!l.deletedAt&&l.equipmentId===equipmentId&&inWindow(l.date)));
  const added=r2(works.reduce((sum,w)=>sum+(workHours(w)||0),0)+tp.reduce((sum,l)=>sum+(pos(l.hours)||0),0));
  const from=fromCard?`compteur de la fiche engin${since?` (mis à jour le ${shortDate(since)})`:''}`:`${last.src==='plein'?'plein':'relevé'} du ${shortDate(last.date)}`;
  out.counter=suggest(r2(base+added),added>0?`${from} + ${String(added).replace('.',',')} h de travaux depuis`:from);
  return out;
}

/** Alerte non bloquante si la valeur s'écarte de la médiane de plus de la tolérance (20 % par défaut). */
export function priceWarning(value,median,{tolerance=0.2,unit=''}={}){
  const v=pos(value),m=pos(median);if(v===null||m===null)return null;
  if(Math.abs(v-m)/m<=tolerance+1e-9)return null;
  const u=unit?`/${unit}`:'';
  return`Prix inhabituel : ${eur.format(v)} €${u} contre ${eur.format(m)} €${u} d’habitude. Vérifiez la saisie.`;
}

/** Libellé court des pastilles « Comme la dernière fois ». */
export function suggestionSummary(parts){return (parts||[]).filter(Boolean).join(' · ');}
