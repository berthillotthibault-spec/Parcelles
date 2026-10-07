// Commercialisation (n° 82) : contrats de vente, ventes déclarées dans les lots de récolte
// et prix moyen réellement obtenu, par culture et par campagne.
// Logique pure : aucun accès au DOM. Les contrats sont des enregistrements d’exploitation
// (integrationImports, farmKind « salesContract ») : pas de nouvelle collection ni de migration.
import {campaignFor,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {costPriceByCulture,cultureFor} from './costs.js';
import {farmRecords,saveFarmRecord} from './farm-records.js';

export const CONTRACT_KIND='salesContract';
export const CONTRACT_TYPES=[
  {id:'ferme',label:'Prix ferme',short:'ferme'},
  {id:'moyen',label:'Prix moyen coopé',short:'prix moyen'},
  {id:'a-fixer',label:'Prix à fixer',short:'à fixer'},
];
const TYPE_IDS=new Set(CONTRACT_TYPES.map(t=>t.id));
const CAMPAIGN_RE=/^\d{4}\/\d{2}$/,DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const loose=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const positive=v=>{const n=loose(v);return n!==null&&n>0?n:null;};
const round2=v=>Math.round(v*100)/100;
const text=v=>String(v??'').trim();

// Conversions : la quantité et le prix d’une vente sont exprimés dans l’unité du lot.
export const toTonnes=(quantity,unit)=>{const q=positive(quantity);if(q===null)return null;const u=normalize(unit);return u==='kg'?q/1000:u==='q'||u==='quintal'||u==='quintaux'?q/10:u==='t'||u===''?q:null;};
export const pricePerTonne=(price,unit)=>{const p=positive(price);if(p===null)return null;const u=normalize(unit);return u==='kg'?p*1000:u==='q'||u==='quintal'||u==='quintaux'?p*10:u==='t'||u===''?p:null;};

export const contractTypeLabel=id=>CONTRACT_TYPES.find(t=>t.id===id)?.label||'Contrat';
export const contracts=(state,{campaign=null}={})=>farmRecords(state,CONTRACT_KIND).filter(c=>!campaign||c.campaign===campaign);
// Prix connu d’un contrat (€/t, prime comprise). Un prix ferme est sûr ; ailleurs, c’est un prix indicatif.
export function contractPrice(contract){const base=positive(contract?.price);if(base===null)return null;const premium=loose(contract?.premium)||0;const v=base+premium;return v>0?v:null;}
export const contractIsFirm=c=>c?.type==='ferme'&&contractPrice(c)!==null;

export function lotCampaign(lot){return lot?.date?campaignFor(lot.date):null;}
export function lotCulture(state,lot,campaign=lotCampaign(lot)){
  const own=text(lot?.crop);if(own)return own;const parcel=active(state,'parcelles').find(p=>p.id===lot?.parcelId);
  return parcel&&campaign?cultureFor(state,parcel,campaign):'';
}
// Contrats proposés pour une vente d’un lot : même culture et même campagne.
export function contractsForLot(state,lot){const campaign=lotCampaign(lot),key=normalize(lotCulture(state,lot,campaign));if(!campaign||!key)return[];return contracts(state,{campaign}).filter(c=>normalize(c.culture)===key);}

// Toutes les ventes déclarées des lots de la campagne, avec leur valeur en €/t.
export function campaignSales(state,campaign){
  const all=contracts(state),byId=new Map(all.map(c=>[c.id,c])),rows=[];
  for(const lot of farmRecords(state,'harvest')){
    if(lotCampaign(lot)!==campaign)continue;const culture=lotCulture(state,lot,campaign);
    for(const sale of lot.sales||[]){
      const tonnes=toTonnes(sale.quantity,lot.unit);if(tonnes===null)continue;const contract=sale.contractId?byId.get(sale.contractId)||null:null;
      const own=pricePerTonne(sale.price,lot.unit),fallback=contract?contractPrice(contract):null,price=own??fallback;
      rows.push({lot,sale,culture,key:normalize(culture),tonnes,price,priceSource:own!==null?'sale':fallback!==null?'contract':null,contract:contract&&!contract.deletedAt?contract:null});
    }
  }
  return rows;
}

export function contractProgress(state,contract){
  const sales=campaignSales(state,contract.campaign).filter(r=>r.sale.contractId===contract.id),delivered=sales.reduce((s,r)=>s+r.tonnes,0),tonnes=positive(contract.tonnes)||0;
  return{contract,sales,delivered,open:Math.max(0,tonnes-delivered),over:Math.max(0,delivered-tonnes),share:tonnes>0?Math.min(1,delivered/tonnes):0,price:contractPrice(contract),firm:contractIsFirm(contract)};
}

// Synthèse par culture. Volume = max(récolte estimée, lots récoltés).
// Produit brut par priorité : ventes réelles des lots, puis contrats, puis prix estimé de la parcelle.
export function commercialisation(state,{campaign=campaignFor(),targetHa=state.preferences?.salesMarginTargetHa}={}){
  const target=loose(targetHa),costs=costPriceByCulture(state,{campaign}),groups=new Map();
  const group=(key,culture)=>{if(!groups.has(key))groups.set(key,{key,culture,cost:null,harvested:0,lots:0,sales:[],contracts:[]});return groups.get(key);};
  for(const row of costs.rows)group(row.key,row.culture).cost=row;
  for(const lot of farmRecords(state,'harvest')){if(lotCampaign(lot)!==campaign)continue;const culture=lotCulture(state,lot,campaign),key=normalize(culture);if(!key)continue;const t=toTonnes(lot.quantity,lot.unit);const g=group(key,culture);g.lots+=1;if(t!==null)g.harvested+=t;}
  for(const sale of campaignSales(state,campaign)){if(!sale.key)continue;group(sale.key,sale.culture).sales.push(sale);}
  for(const c of contracts(state,{campaign})){const key=normalize(c.culture);if(!key)continue;group(key,text(c.culture)).contracts.push(contractProgress(state,c));}
  const rows=[...groups.values()].filter(g=>g.cost?.area>0||g.lots||g.sales.length||g.contracts.length).map(g=>{
    const estimate=g.cost&&g.cost.production>0?g.cost.production:null,volume=Math.max(estimate||0,g.harvested),volumeSource=g.harvested>0&&g.harvested>=(estimate||0)?'lots':estimate!==null?'estimate':null;
    const sold=g.sales.reduce((s,r)=>s+r.tonnes,0),soldPriced=g.sales.filter(r=>r.price!==null),soldAmount=soldPriced.reduce((s,r)=>s+r.tonnes*r.price,0),soldPricedTonnes=soldPriced.reduce((s,r)=>s+r.tonnes,0);
    let firmT=0,firmA=0,indicT=0,indicA=0,unpricedT=0;
    for(const p of g.contracts){if(!p.open)continue;if(p.firm){firmT+=p.open;firmA+=p.open*p.price;}else if(p.price!==null){indicT+=p.open;indicA+=p.open*p.price;}else unpricedT+=p.open;}
    const contracted=firmT+indicT+unpricedT,engaged=sold+contracted,remaining=volume-engaged,securedT=soldPricedTonnes+firmT,securedA=soldAmount+firmA;
    const estimatedPrice=g.cost?.marketPrice??null,unpricedEngaged=(sold-soldPricedTonnes)+unpricedT,rest=Math.max(0,remaining)+unpricedEngaged;
    const estimateAmount=estimatedPrice!==null?rest*estimatedPrice:0,missingTonnes=estimatedPrice===null?rest:0;
    const sources=[{id:'sales',label:'ventes des lots',tonnes:soldPricedTonnes,amount:soldAmount},{id:'contracts',label:'contrats',tonnes:firmT+indicT,amount:firmA+indicA},{id:'estimate',label:'prix estimé',tonnes:estimatedPrice!==null?rest:0,amount:estimateAmount}].filter(s=>s.tonnes>0);
    const area=g.cost?.area||0,charges=g.cost?.charges||0,structure=g.cost?.structure||0,need=charges+structure+(target||0)*area,known=securedA+indicA;
    const requiredPrice=area>0&&rest>0&&(charges>0||target)?(need-known)/rest:null;
    return{key:g.key,culture:g.culture,area,estimate,harvested:g.harvested,lots:g.lots,volume,volumeSource,sold,soldPricedTonnes,soldAmount,contracted,firmTonnes:firmT,indicativeTonnes:indicT,unpricedTonnes:unpricedT,
      engaged,share:volume>0?engaged/volume:null,remaining:Math.max(0,remaining),overCommitted:Math.max(0,-remaining),securedTonnes:securedT,averagePrice:securedT>0?securedA/securedT:null,
      indicativeAverage:securedT+indicT>0?(securedA+indicA)/(securedT+indicT):null,estimatedPrice,grossProduct:soldAmount+firmA+indicA+estimateAmount,sources,missingTonnes,unpricedEngaged,
      charges,structure,target,requiredPrice,targetReached:requiredPrice!==null&&requiredPrice<=0,partial:!!g.cost?.partial||missingTonnes>0||volume===0,contracts:g.contracts.sort((a,b)=>String(a.contract.deliveryDate||'9999').localeCompare(String(b.contract.deliveryDate||'9999'))),salesCount:g.sales.length};
  }).sort((a,b)=>b.area-a.area||b.volume-a.volume||a.culture.localeCompare(b.culture,'fr'));
  const totals=rows.reduce((t,r)=>({engaged:t.engaged+r.engaged,volume:t.volume+r.volume,grossProduct:t.grossProduct+r.grossProduct}),{engaged:0,volume:0,grossProduct:0});
  return{campaign,rows,target,totals,contracts:contracts(state,{campaign}).length};
}

// ---------- Écritures ----------
const canWrite=(store,action='update')=>!store.writeGuard||store.writeGuard({entity:'integrationImports',action});
export function validateContract(values){
  const v={culture:text(values.culture),campaign:text(values.campaign),buyer:text(values.buyer),type:text(values.type)||'ferme',tonnes:loose(values.tonnes),price:loose(values.price),premium:loose(values.premium),deliveryDate:text(values.deliveryDate),paymentDate:text(values.paymentDate),reference:text(values.reference),note:text(values.note)};
  const missing=!v.culture?'Culture':!v.buyer?'Acheteur':!CAMPAIGN_RE.test(v.campaign)?'Campagne':v.tonnes===null?'Tonnage (t)':v.type==='ferme'&&v.price===null?'Prix (€/t)':'';
  if(missing)return{error:`Champ obligatoire : ${missing}`,field:missing};
  if(!TYPE_IDS.has(v.type))return{error:'Type de contrat invalide.',field:'Type'};
  if(v.tonnes<=0)return{error:'Tonnage invalide : saisissez une quantité supérieure à 0 t.',field:'Tonnage (t)'};
  if(v.price!==null&&v.price<=0)return{error:'Prix invalide : saisissez un prix supérieur à 0 €/t.',field:'Prix (€/t)'};
  if(v.premium!==null&&Math.abs(v.premium)>10000)return{error:'Prime invalide.',field:'Prime (€/t)'};
  for(const [k,label] of [['deliveryDate','Date de livraison'],['paymentDate','Date de paiement']])if(v[k]&&!DATE_RE.test(v[k]))return{error:`${label} invalide.`,field:label};
  return{value:{...v,tonnes:round2(v.tonnes),price:v.price===null?null:round2(v.price),premium:v.premium===null||v.premium===0?null:round2(v.premium),deliveryDate:v.deliveryDate||null,paymentDate:v.paymentDate||null}};
}

export async function saveContract(store,values,existing=null){
  if(!canWrite(store,existing?'update':'create'))throw Error('Votre rôle ne permet pas de modifier les contrats.');
  const checked=validateContract(values);if(checked.error)throw Error(checked.error);
  const current=existing?store.get('integrationImports',existing.id):null;if(existing&&(!current||current.deletedAt))throw Error('Contrat introuvable : il a peut-être été supprimé.');
  if(existing&&existing.version!==undefined&&current.version!==existing.version)throw Error('Le contrat a changé entre-temps : rouvrez-le.');
  const v=checked.value;return saveFarmRecord(store,CONTRACT_KIND,{...v,name:`Contrat ${v.buyer} · ${v.culture} ${v.campaign}`},current);
}

export async function deleteContract(store,id){
  if(!canWrite(store,'delete'))throw Error('Votre rôle ne permet pas de supprimer les contrats.');
  const c=store.get('integrationImports',id);if(!c||c.deletedAt||c.farmKind!==CONTRACT_KIND)throw Error('Contrat introuvable.');
  await store.remove('integrationImports',id);return c;
}

// Relie (ou détache, contractId null) une vente déclarée d’un lot à un contrat de la même culture et campagne.
export async function linkSale(store,{lotId,saleId,contractId=null}){
  if(!canWrite(store))throw Error('Votre rôle ne permet pas de modifier les ventes.');
  const lot=store.get('integrationImports',lotId);if(!lot||lot.deletedAt||lot.farmKind!=='harvest')throw Error('Lot introuvable.');
  const sale=(lot.sales||[]).find(s=>s.id===saleId);if(!sale)throw Error('Vente introuvable dans ce lot.');
  if(contractId){const state=store.snapshot(),ok=contractsForLot(state,lot).some(c=>c.id===contractId);if(!ok)throw Error('Ce contrat ne correspond pas à la culture ou à la campagne du lot.');}
  const sales=(lot.sales||[]).map(s=>s.id===saleId?{...s,contractId:contractId||null}:s);
  return store.upsert('integrationImports',{...lot,sales},{label:contractId?'Vente reliée au contrat':'Vente détachée du contrat'});
}

// Ventes de la campagne et de la culture du contrat, encore libres (sans contrat valide).
export function linkableSales(state,contract){const key=normalize(contract.culture),ids=new Set(contracts(state).map(c=>c.id));return campaignSales(state,contract.campaign).filter(r=>r.key===key&&(!r.sale.contractId||!ids.has(r.sale.contractId)));}

export async function setMarginTarget(store,value){
  if(store.writeGuard&&!store.writeGuard({entity:'preferences',action:'update'}))throw Error('Votre rôle ne permet pas de modifier cet objectif.');
  const n=loose(value);if(n!==null&&(n<0||n>100000))throw Error('Objectif invalide : saisissez un montant positif en €/ha.');
  return store.setPreferences({salesMarginTargetHa:n===null?null:round2(n)});
}
