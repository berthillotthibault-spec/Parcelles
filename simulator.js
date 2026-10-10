// n° 89 — Simulateur de décision « Et si… » : logique pure, aucune écriture.
// Base : marginModel (n° 85). Hypothèses : rendement ±30 %, prix ±30 %, engrais ±50 %, prix du GNR.
import {campaignFor,normalize} from './utils.js';
import {marginModel,workCampaignOf} from './pilotage.js';

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
  return{campaign,culture,area,parcels:rows.length,withoutProduct:rows.length-withProduct.length,product,charges,fert,litres,fuelCost,gnrPrice,
    reliability:rows.length?Math.round(rows.reduce((s,r)=>s+r.reliability*(r.area||0),0)/Math.max(area,1e-9)):0,
    margin:withProduct.length?product-charges:null};
}

/** Marge simulée pour des hypothèses données (pourcentages et prix du GNR en €/L). */
export function simulate(base,{yieldPct=0,pricePct=0,fertPct=0,gnrPrice=null}={}){
  const y=clamp(yieldPct,LIMITS.yieldPct),p=clamp(pricePct,LIMITS.pricePct),f=clamp(fertPct,LIMITS.fertPct);
  const g=gnrPrice===null||gnrPrice===undefined?base.gnrPrice:clamp(gnrPrice,LIMITS.gnrPrice);
  if(base.margin===null)return{margin:null,product:null,charges:null,delta:null,gnrEffect:0,fertEffect:0};
  const product=base.product*(1+y/100)*(1+p/100),fertEffect=base.fert*f/100,gnrEffect=base.litres*(g-base.gnrPrice);
  const charges=base.charges+fertEffect+gnrEffect,margin=product-charges;
  return{margin,product,charges,delta:margin-base.margin,fertEffect,gnrEffect,marginHa:base.area>0?margin/base.area:null};
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

const nextCampaign=id=>{const y=Number(String(id).slice(0,4))+1;return`${y}/${String(y+1).slice(-2)}`;};
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
  const evaluate=pick=>{let margin=0,known=0,unknown=0;const by=new Map();
    for(const p of parcels){const culture=pick(p)||'Non renseignée',area=num(p.surfaceHa)||0,h=hist.get(normalize(culture));by.set(culture,(by.get(culture)||0)+area);if(h){margin+=h.marginHa*area;known+=area;}else unknown+=area;}
    return{margin:known?margin:null,knownArea:known,unknownArea:unknown,cultures:[...by].map(([culture,area])=>({culture,area})).sort((a,b)=>b.area-a.area)};};
  const planned=evaluate(p=>rotations.find(r=>r.parcelId===p.id&&r.campaignId===next)?.culture);
  const kept=evaluate(p=>rotations.find(r=>r.parcelId===p.id&&r.campaignId===campaign)?.culture||p.culture);
  return{next,history:[...hist.values()].sort((a,b)=>b.marginHa-a.marginHa),planned,kept,hasPlan:rotations.some(r=>r.campaignId===next)};
}
