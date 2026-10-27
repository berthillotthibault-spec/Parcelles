// n° 89 — Simulateur de décision « Et si… » : logique pure, aucune écriture.
// Base : marginModel (n° 85). Hypothèses : rendement ±30 %, prix ±30 %, engrais ±50 %, prix du GNR.
// Marge nette : celle de net-margin.js (moteur unique) + l'écart simulé. Trésorerie : le prévisionnel de
// treasury.js reçoit l'écart simulé en lignes supplémentaires (dates indicatives), rien n'est enregistré.
import {campaignFor,normalize} from './utils.js';
import {marginModel,workCampaignOf} from './pilotage.js';
import {netMargin} from './net-margin.js';

export const LIMITS=Object.freeze({yieldPct:[-30,30],pricePct:[-30,30],fertPct:[-50,50],gnrPrice:[0.5,2.5]});
export const MATRIX_STEPS=Object.freeze([-20,-10,0,10,20]);
const clamp=(v,[lo,hi])=>Math.min(hi,Math.max(lo,Number(v)||0));
const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};
const FERT=/ferti|engrais|epand|azote|ammonitrate|uree|lisier|fumier|solution azotee/;
const active=(state,k)=>(state?.[k]||[]).filter(x=>x&&!x.deletedAt);

/** Base de simulation : produit, charges, part engrais et litres de GNR, par exploitation ou par culture. */
export function simulationBase(state,{campaign=campaignFor(),culture=''}={}){
  const model=marginModel(state,{campaign}),rows=model.rows.filter(r=>!culture||normalize(r.culture)===normalize(culture));
  const ids=new Set(rows.map(r=>r.parcelId));
  const works=active(state,'interventions').filter(w=>ids.has(w.parcelId)&&workCampaignOf(w)===campaign&&w.status!=='Annulé');
  let fert=0,litres=0,fuelCost=0;
  for(const w of works){
    const cost=num(w.cost);
    if(FERT.test(normalize(w.type))||w.isFertilization)fert+=num(w.inputCost)??(cost!==null&&cost>0?cost:0);
    const l=num(w.fuel);if(l!==null&&l>0)litres+=l;
    const fc=num(w.fuelCost);if(fc!==null&&fc>0)fuelCost+=fc;
  }
  const withProduct=rows.filter(r=>r.product!==null),product=withProduct.reduce((s,r)=>s+r.product,0),charges=withProduct.reduce((s,r)=>s+r.charges,0);
  const area=rows.reduce((s,r)=>s+r.area,0),gnrPrice=num(state?.preferences?.fuelPrice)??1.7;
  const nm=netMargin(state,{campaign}),netLine=culture?nm.rows.find(r=>r.key===normalize(culture)):nm.total;
  return{campaign,culture,area,parcels:rows.length,net:netLine&&netLine.net!==null&&netLine.net!==undefined?netLine.net:null,
    netParts:netLine?{rent:netLine.rentHa*netLine.area,structure:netLine.structureHa*netLine.area,aids:netLine.aidsHa*netLine.area}:null,withoutProduct:rows.length-withProduct.length,product,charges,fert,litres,fuelCost,gnrPrice,
    reliability:rows.length?Math.round(rows.reduce((s,r)=>s+r.reliability*(r.area||0),0)/Math.max(area,1e-9)):0,
    margin:withProduct.length?product-charges:null};
}

/** Marge simulée pour des hypothèses données (pourcentages et prix du GNR en €/L). */
export function simulate(base,{yieldPct=0,pricePct=0,fertPct=0,gnrPrice=null}={}){
  const y=clamp(yieldPct,LIMITS.yieldPct),p=clamp(pricePct,LIMITS.pricePct),f=clamp(fertPct,LIMITS.fertPct);
  const g=gnrPrice===null||gnrPrice===undefined?base.gnrPrice:clamp(gnrPrice,LIMITS.gnrPrice);
  if(base.margin===null)return{margin:null,product:null,charges:null,delta:null,gnrEffect:0,fertEffect:0,net:null,productDelta:0};
  const product=base.product*(1+y/100)*(1+p/100),fertEffect=base.fert*f/100,gnrEffect=base.litres*(g-base.gnrPrice);
  const charges=base.charges+fertEffect+gnrEffect,margin=product-charges;
  const delta=margin-base.margin,net=base.net===null||base.net===undefined?null:base.net+delta;
  return{margin,product,charges,delta,fertEffect,gnrEffect,productDelta:product-base.product,net,netHa:net!==null&&base.area>0?net/base.area:null,marginHa:base.area>0?margin/base.area:null};
}

const harvestYear=campaign=>Number(String(campaign).slice(0,4))+1;
/**
 * Lignes de trésorerie de l'écart simulé, à dates indicatives : recette de la récolte en septembre de
 * l'année de récolte, engrais en février, GNR en juillet (moisson). Montants nuls omis.
 */
export function scenarioTreasuryLines(base,result,{campaign=base?.campaign}={}){
  if(!result||result.margin===null)return[];
  const y=harvestYear(campaign),out=[];
  const add=(month,amount,label,id)=>{const v=Math.round(amount*100)/100;if(v)out.push({id,month,amount:v,label,source:'simulation'});};
  add(`${y}-09`,result.productDelta,'Écart de recette simulé (vente de la récolte)','sim:produit');
  add(`${y}-02`,-result.fertEffect,'Écart d’engrais simulé','sim:engrais');
  add(`${y}-07`,-result.gnrEffect,'Écart de GNR simulé','sim:gnr');
  return out;
}

/**
 * Applique des lignes supplémentaires à un prévisionnel (treasuryForecast) : soldes recalculés et point bas.
 * Une ligne avant le début compte au premier mois ; une ligne après l'horizon est écartée (outside).
 */
export function treasuryWithScenario(forecast,extra=[]){
  if(!forecast?.months?.length)return null;
  const first=forecast.months[0].key,last=forecast.months[forecast.months.length-1].key;
  const used=extra.map(l=>({...l,month:l.month<first?first:l.month})).filter(l=>l.month<=last);
  let carry=0;
  const months=forecast.months.map(m=>{const added=used.filter(l=>l.month===m.key).reduce((s,l)=>s+l.amount,0);carry+=added;return{key:m.key,label:m.label,added:Math.round(added*100)/100,balance:Math.round((m.balance+carry)*100)/100};});
  const low=months.reduce((a,m)=>!a||m.balance<a.balance?m:a,null);
  const baseLow=forecast.low;
  return{months,low:{key:low.key,label:low.label,balance:low.balance,negative:low.balance<0},baseLow,
    lowDelta:baseLow?Math.round((low.balance-baseLow.balance)*100)/100:null,applied:used.length,outside:extra.length-used.length};
}

/** Matrice 5 × 5 rendement × prix : marges et classe de couleur. */
export function sensitivityMatrix(base,{fertPct=0,gnrPrice=null,steps=MATRIX_STEPS}={}){
  if(base.margin===null)return null;
  const rows=steps.map(y=>steps.map(p=>({yieldPct:y,pricePct:p,margin:simulate(base,{yieldPct:y,pricePct:p,fertPct,gnrPrice}).margin})));
  const band=Math.max(1,Math.abs(base.margin)*0.05);
  for(const row of rows)for(const c of row)c.level=c.margin<0?'loss':c.margin<base.margin-band?'down':c.margin>base.margin+band?'up':'flat';
  return{steps,rows};
}

const sign=v=>`${v>0?'+':v<0?'−':''}${Math.abs(v)}`;
/** Phrase lisible des hypothèses (remplace un JSON brut). */
export function describeScenario({yieldPercent=0,priceDelta=0,inputPercent=0,extraCost=0,yieldPct,pricePct,fertPct,gnrPrice}={}){
  if(yieldPct!==undefined){const parts=[`rendement ${sign(yieldPct)} %`,`prix ${sign(pricePct||0)} %`,`engrais ${sign(fertPct||0)} %`];if(gnrPrice!==null&&gnrPrice!==undefined)parts.push(`GNR à ${String(Number(gnrPrice).toFixed(2)).replace('.',',')} €/L`);return`Hypothèses : ${parts.join(', ')}.`;}
  const parts=[`rendement ${sign(yieldPercent)} %`,`prix ${sign(priceDelta)} €/t`,`intrants ${sign(inputPercent)} %`];if(extraCost)parts.push(`autre écart de coût ${sign(extraCost)} €`);
  return`Votre simulation : ${parts.join(', ')}.`;
}

export const nextCampaign=id=>{const y=Number(String(id).slice(0,4))+1;return`${y}/${String(y+1).slice(-2)}`;};
const prevCampaign=(id,n)=>{const y=Number(String(id).slice(0,4))-n;return`${y}/${String(y+1).slice(-2)}`;};
/** Marges/ha historiques par culture (campagnes fiables à 50 % au moins). */
export function historicalMargins(state,{campaign=campaignFor(),years=3}={}){
  const map=new Map();
  for(let i=0;i<years;i++){const id=prevCampaign(campaign,i),m=marginModel(state,{campaign:id});
    for(const c of m.byCulture){if(c.marginHa===null||c.reliability<50)continue;const k=normalize(c.culture),x=map.get(k)||{culture:c.culture,values:[],campaigns:[]};x.values.push(c.marginHa);x.campaigns.push(id);map.set(k,x);}}
  return new Map([...map].map(([k,x])=>[k,{...x,marginHa:x.values.reduce((s,v)=>s+v,0)/x.values.length}]));
}
/** Compare l’assolement prévu (rotations N+1) au reconduit (cultures actuelles), avec les marges/ha historiques. */
export function compareRotationChoices(state,{campaign=campaignFor()}={}){
  const next=nextCampaign(campaign),hist=historicalMargins(state,{campaign}),parcels=active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
  const rotations=active(state,'rotations');
  const planned=evaluateAssolement(parcels,hist,p=>rotations.find(r=>r.parcelId===p.id&&r.campaignId===next)?.culture);
  const kept=evaluateAssolement(parcels,hist,p=>rotations.find(r=>r.parcelId===p.id&&r.campaignId===campaign)?.culture||p.culture);
  return{next,history:[...hist.values()].sort((a,b)=>b.marginHa-a.marginHa),planned,kept,hasPlan:rotations.some(r=>r.campaignId===next)};
}

function evaluateAssolement(parcels,hist,pick){
  let margin=0,known=0,unknown=0;const by=new Map();
  for(const p of parcels){const culture=pick(p)||'Non renseignée',area=num(p.surfaceHa)||0,h=hist.get(normalize(culture));by.set(culture,(by.get(culture)||0)+area);if(h){margin+=h.marginHa*area;known+=area;}else unknown+=area;}
  return{margin:known?margin:null,knownArea:known,unknownArea:unknown,cultures:[...by].map(([culture,area])=>({culture,area})).sort((a,b)=>b.area-a.area)};
}

/** Parcelles de l'assolement de référence de la campagne suivante (prévu s'il existe, sinon reconduit). */
export function assolementParcels(state,{campaign=campaignFor()}={}){
  const next=nextCampaign(campaign),rotations=active(state,'rotations'),hasPlan=rotations.some(r=>r.campaignId===next);
  return active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived).map(p=>({id:p.id,name:p.nom||p.name||'Parcelle',area:num(p.surfaceHa)||0,
    culture:(hasPlan?rotations.find(r=>r.parcelId===p.id&&r.campaignId===next)?.culture:null)||rotations.find(r=>r.parcelId===p.id&&r.campaignId===campaign)?.culture||p.culture||'Non renseignée'}));
}

/**
 * Comparaison libre d'assolement : remplace la culture des parcelles choisies par `to`, et compare la marge
 * estimée (marges/ha historiques) à l'assolement de référence. Simulation pure, aucune écriture.
 */
export function compareCropSwap(state,{campaign=campaignFor(),parcelIds=[],to=''}={}){
  const next=nextCampaign(campaign),hist=historicalMargins(state,{campaign}),ref=assolementParcels(state,{campaign});
  const chosen=new Set(parcelIds),target=String(to||'').trim();
  const parcels=ref.map(p=>({...p,surfaceHa:p.area}));
  const base=evaluateAssolement(parcels,hist,p=>p.culture);
  if(!target||!chosen.size)return{next,base,swapped:null,delta:null,changed:[],error:!target?'Choisissez la culture de remplacement.':'Choisissez au moins une parcelle.'};
  const changed=ref.filter(p=>chosen.has(p.id)&&normalize(p.culture)!==normalize(target)).map(p=>({id:p.id,name:p.name,area:p.area,from:p.culture,to:target}));
  const swapped=evaluateAssolement(parcels,hist,p=>chosen.has(p.id)?target:p.culture);
  const missing=[...new Set([target,...changed.map(c=>c.from)].filter(c=>!hist.has(normalize(c))))];
  const delta=base.margin!==null&&swapped.margin!==null&&!missing.length?swapped.margin-base.margin:null;
  return{next,base,swapped,delta,changed,missing,area:changed.reduce((s,c)=>s+c.area,0)};
}

/** Phrase de la comparaison : « Plan 2027/28 : marge prévisionnelle 41 k€ contre 36 k€ si colza remplacé par tournesol. » */
export function describeCropSwap(result,{format=v=>`${Math.round(v)} €`}={}){
  if(!result||result.error)return result?.error||'';
  if(!result.changed.length)return'Les parcelles choisies ont déjà cette culture : rien ne change.';
  const from=[...new Set(result.changed.map(c=>c.from))].join(', ');
  if(result.delta===null)return`Plan ${result.next} : marge non comparable, pas d’historique de marge fiable pour ${result.missing.join(', ')}.`;
  return`Plan ${result.next} : marge prévisionnelle ${format(result.base.margin)} contre ${format(result.swapped.margin)} si ${from.toLocaleLowerCase('fr')} remplacé par ${result.changed[0].to.toLocaleLowerCase('fr')} (${Math.round(result.area*10)/10} ha).`;
}
