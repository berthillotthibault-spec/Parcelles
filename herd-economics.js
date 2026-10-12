// n° 80 — Économie de l'atelier bovin : marge brute, marge par UGB, coût de l'herbe.
// Logique pure. Ventes et achats d'animaux sont des enregistrements d'exploitation
// (integrationImports, farmKind « animalSale » / « animalPurchase ») : pas de nouvelle collection.
// Charges : aliments (sorties de stock valorisées au PMP du jour), frais vétérinaires (carnet
// sanitaire), coût des prairies (marginModel) rapporté aux jours de pâturage.
import {campaignFor,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {farmRecords} from './farm-records.js';
import {marginModel} from './pilotage.js';
import {ugbOf,ugbTable,presenceDays,grazingTotal} from './grazing.js';
import {pmpAt} from './stock-lots.js';

export const SALE_KIND='animalSale',PURCHASE_KIND='animalPurchase';
const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>Math.round(v*100)/100;
const FORAGE=/prairie|herbe|pature|paturage|luzerne|trefle|ray.?grass|fetuque|dactyle|fourrag|ensil|sainfoin|meteil/;
const FEED=/aliment|tourteau|concentre|correcteur|foin|paille|enrubann|ensilage|mineral|lactoremplaceur|cereale.*aplatie|vl ?\d/;
export const FEED_CATEGORY='Aliment';

/** Bornes de la campagne (1er août → 31 juillet). */
export function campaignBounds(campaign){const y=Number(String(campaign).slice(0,4));return{from:`${y}-08-01`,to:`${y+1}-07-31`};}
const inRange=(d,{from,to})=>{const x=String(d||'').slice(0,10);return x>=from&&x<=to;};

export function validateAnimalRecord(v){
  const date=String(v?.date||'').slice(0,10),count=num(v?.count),amount=num(v?.amount),kg=num(v?.kg);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return{error:'Date invalide.'};
  if(count===null||count<1||!Number.isInteger(count))return{error:'Nombre d’animaux invalide.'};
  if(amount===null||amount<0)return{error:'Montant invalide.'};
  if(kg!==null&&kg<0)return{error:'Poids invalide.'};
  return{value:{date,count,amount,kg,category:String(v?.category||'').trim(),party:String(v?.party||'').trim(),note:String(v?.note||'').trim()}};
}

const isFeedItem=i=>i.category===FEED_CATEGORY||FEED.test(normalize(`${i.name} ${i.category||''}`));

/** Aliments consommés : sorties de stock d'articles « Aliment », valorisées au PMP du jour. */
export function feedCosts(state,bounds){
  const items=new Map(active(state,'stockItems').filter(isFeedItem).map(i=>[i.id,i]));let total=0,unpriced=0;const rows=[];
  for(const m of active(state,'stockMovements')){
    const item=items.get(m.stockItemId);if(!item||m.type!=='Sortie'||!inRange(m.date,bounds))continue;
    const q=Math.abs(num(m.delta)??num(m.quantity)??0),pmp=pmpAt(state,item,String(m.date).slice(0,10));
    if(pmp===null){unpriced+=1;continue;}const v=q*pmp;total+=v;rows.push({movement:m,item,quantity:q,value:r2(v)});
  }
  return{total:r2(total),rows,unpriced};
}

export function herdEconomics(state,{campaign=campaignFor(),today=null}={}){
  const bounds=campaignBounds(campaign),end=today&&today<bounds.to?today:bounds.to,table=ugbTable(state);
  const sales=farmRecords(state,SALE_KIND).filter(r=>inRange(r.date,bounds)),purchases=farmRecords(state,PURCHASE_KIND).filter(r=>inRange(r.date,bounds));
  const sum=(list,k)=>r2(list.reduce((s,r)=>s+(num(r[k])||0),0));
  const vet=active(state,'vetTreatments').filter(t=>inRange(t.date,bounds)),vetCost=sum(vet,'cost'),vetUnpriced=vet.filter(t=>num(t.cost)===null).length;
  const feed=feedCosts(state,bounds);
  // Prairies : charges du moteur de marge, rapportées aux jours de pâturage.
  const model=marginModel(state,{campaign}),forage=model.rows.filter(r=>FORAGE.test(normalize(r.culture)));
  const grassCost=r2(forage.reduce((s,r)=>s+r.charges,0)),grassMissing=forage.reduce((s,r)=>s+r.unknownRealized+r.unknownPlanned,0);
  let ugbDays=0,animalDays=0;
  for(const s of active(state,'grazingSessions')){const d=presenceDays(s,{from:bounds.from,to:end});if(!d)continue;ugbDays+=ugbOf(s,table).ugb*d;animalDays+=grazingTotal(s)*d;}
  const periodDays=Math.max(1,Math.round((Date.parse(`${end}T12:00:00`)-Date.parse(`${bounds.from}T12:00:00`))/864e5)+1);
  const avgUgb=ugbDays>0?ugbDays/periodDays:null;
  const product=sum(sales,'amount'),bought=sum(purchases,'amount');
  const charges=r2(bought+feed.total+vetCost+grassCost),margin=r2(product-charges);
  const soldKg=sum(sales,'kg');
  return{campaign,bounds,sales,purchases,product,bought,feed,vetCost,vetUnpriced,vetCount:vet.length,grassCost,grassMissing,forageArea:r2(forage.reduce((s,r)=>s+r.area,0)),
    ugbDays:r2(ugbDays),animalDays:Math.round(animalDays),avgUgb:avgUgb===null?null:r2(avgUgb),charges,margin,
    marginPerUgb:avgUgb?r2(margin/avgUgb):null,grassPerAnimalDay:animalDays>0?r2(grassCost/animalDays):null,grassPerUgbDay:ugbDays>0?r2(grassCost/ugbDays):null,
    soldHeads:sales.reduce((s,r)=>s+(num(r.count)||0),0),soldKg,pricePerKg:soldKg>0?r2(product/soldKg):null,
    partial:grassMissing>0||feed.unpriced>0||vetUnpriced>0,empty:!sales.length&&!purchases.length&&!vet.length&&!feed.rows.length&&!ugbDays};
}
