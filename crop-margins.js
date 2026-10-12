// n° 65 — Marges par culture en €/ha, aides PAC et prix d'équilibre.
// Logique pure : tout vient de marginModel (pilotage.js) et de costPriceByCulture (costs.js),
// aucun second calcul de marge. Un montant inconnu reste null, jamais 0 €.
import {campaignFor,normalize} from './utils.js';
import {marginModel} from './pilotage.js';
import {costPriceByCulture} from './costs.js';
import {farmRecords} from './farm-records.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const yearsBack=(id,n)=>{const m=String(id||'').match(/^(\d{4})/);if(!m)return'';const y=Number(m[1])-n;return`${y}/${String(y+1).slice(-2)}`;};
const FORAGE=/prairie|herbe|pature|paturage|luzerne|trefle|ray.?grass|fetuque|dactyle|fourrag|ensil|sainfoin|meteil/;

export const AIDS_RULE='Aides découplées et éco-régime : montants €/ha saisis une fois, appliqués à toutes les cultures (indicatif, à vérifier sur votre relevé PAC).';

/** Aides €/ha saisies une fois (préférences). Valeur absente = null. */
export function pacAids(state){
  const a=state?.preferences?.pacAidsHa||{};
  const decoupled=num(a.decoupled),ecoScheme=num(a.ecoScheme);
  return{decoupled,ecoScheme,total:decoupled===null&&ecoScheme===null?null:(decoupled||0)+(ecoScheme||0),updatedAt:a.updatedAt||null};
}
export function validateAids(values){
  const out={};for(const k of ['decoupled','ecoScheme']){const v=num(values?.[k]);if(String(values?.[k]??'').trim()!==''&&(v===null||v<0||v>2000))return{error:'Montant d’aide invalide (0 à 2 000 €/ha).'};out[k]=v;}
  return{value:out};
}

/** Ligne €/ha d'une culture, issue d'une ligne byCulture de marginModel. */
export function cultureLine(c,aids){
  // Quand un produit est connu, charges et produit portent sur la même surface (celle de marginModel).
  const base=c.productArea>0?c.productArea:c.area,charges=c.productArea>0?c.chargesWithProduct:c.charges,mech=c.productArea>0?c.mechanizationWithProduct:c.mechanization;
  const perHa=v=>base>0?v/base:null;
  const productHa=c.productArea>0?c.product/c.productArea:null,mechanizationHa=perHa(mech||0),operationalHa=perHa(Math.max(0,charges-(mech||0)));
  const grossHa=productHa===null||operationalHa===null?null:productHa-operationalHa;
  const directHa=grossHa===null?null:grossHa-mechanizationHa;
  const aidsHa=aids?.total??null,withAidsHa=directHa===null||aidsHa===null?directHa:directHa+aidsHa;
  const missing=(c.unknownRealized||0)+(c.unknownPlanned||0);
  return{culture:c.culture,key:normalize(c.culture),area:c.area,productHa,operationalHa,grossHa,mechanizationHa,directHa,decoupledHa:aids?.decoupled??null,ecoSchemeHa:aids?.ecoScheme??null,aidsHa,withAidsHa,
    missing,partial:missing>0||c.withoutProduct>0,withoutProduct:c.withoutProduct||0,reliability:c.reliability,marginHa:c.marginHa};
}

/** Étapes de la cascade €/ha : produit → charges op. → marge brute → mécanisation → marge directe → aides. */
export function waterfallSteps(line){
  if(!line||line.productHa===null)return[];
  const s=[{label:'Produit',short:'Produit',value:line.productHa,kind:'start'},{label:'Charges opérationnelles',short:'Ch. op.',value:-line.operationalHa,kind:'delta'},{label:'Marge brute',short:'MB',value:line.grossHa,kind:'total'},{label:'Mécanisation',short:'Méca.',value:-line.mechanizationHa,kind:'delta'},{label:'Marge directe',short:'MD',value:line.directHa,kind:'total'}];
  if(line.aidsHa!==null)s.push({label:'Aides PAC',short:'Aides',value:line.aidsHa,kind:'delta'},{label:'Marge avec aides',short:'Total',value:line.withAidsHa,kind:'total'});
  return s;
}

/** Marge simplifiée du troupeau : ventes d'animaux − charges des surfaces fourragères (marginModel). */
export function herdSimpleMargin(state,model){
  const forage=model.rows.filter(r=>FORAGE.test(normalize(r.culture)));
  const sales=farmRecords(state,'animalSale').filter(s=>s.date&&campaignFor(s.date)===model.campaign);
  const product=sales.reduce((s,x)=>s+(num(x.amount)||0),0),charges=forage.reduce((s,r)=>s+r.charges,0),area=forage.reduce((s,r)=>s+r.area,0);
  const missing=forage.reduce((s,r)=>s+r.unknownRealized+r.unknownPlanned,0);
  if(!forage.length&&!sales.length)return null;
  return{area,charges,product:sales.length?product:null,sales:sales.length,margin:sales.length?product-charges:null,missing};
}

export function cropMargins(state,{campaign=campaignFor()}={}){
  const model=marginModel(state,{campaign}),aids=pacAids(state);
  const costs=new Map(costPriceByCulture(state,{campaign}).rows.map(r=>[r.key,r]));
  const history=[1,2].map(n=>{const id=yearsBack(campaign,n),m=marginModel(state,{campaign:id});return{campaign:id,lines:new Map(m.byCulture.map(c=>[normalize(c.culture),cultureLine(c,aids)]))};});
  const rows=model.byCulture.map(c=>{
    const line=cultureLine(c,aids),cost=costs.get(line.key)||null;
    return{...line,breakEven:cost?.breakEven??null,breakEvenYield:cost?.breakEvenYield??null,yieldUnit:cost?.yieldUnit||'t/ha',currentPrice:cost?.currentPrice??null,
      previous:history.map(h=>({campaign:h.campaign,directHa:h.lines.get(line.key)?.directHa??null,grossHa:h.lines.get(line.key)?.grossHa??null}))};
  });
  const total=cultureLine({culture:'Exploitation',...model.total},aids);
  return{campaign,model,aids,rows,total,herd:herdSimpleMargin(state,model),missing:model.total.unknownRealized+model.total.unknownPlanned,history:history.map(h=>h.campaign)};
}

/** « marge partielle : 3 travaux sans coût ». Chaîne vide si la marge est complète. */
export function partialLabel(missing){return missing>0?`marge partielle : ${missing} ${missing>1?'travaux':'travail'} sans coût`:'';}
