// Coût de revient par culture (n° 81) et assistant de complétude des coûts (n° 84).
// Logique pure : aucun accès au DOM. Les écritures passent par le Store et ne remplacent
// jamais un coût déjà renseigné ; une estimation porte costSource « estimé ».
import {campaignFor,normalize} from './utils.js';
import {active,completed} from './farm-memory.js';
import {economicSituation} from './advanced-economics.js';
import {requiredStock} from './work-effects.js';

export const COST_SOURCE_ESTIMATED='estimé';
export const COST_SOURCE_MANUAL='saisi';
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const loose=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};
const positive=v=>{const n=loose(v);return n!==null&&n>0?n:null;};
const round2=v=>Math.round(v*100)/100;
const fr=v=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:2});

export const hasCost=work=>{const c=num(work?.cost);return c!==null&&c>0;};
// Une estimation reste « estimée » tant que le coût n’a pas été changé à la main depuis.
export const isEstimatedCost=work=>work?.costSource===COST_SOURCE_ESTIMATED&&hasCost(work)&&num(work?.costEstimate?.value)!==null&&Math.abs(work.cost-work.costEstimate.value)<0.005;
export const workCampaign=w=>w?.campaignId||(w?.date?campaignFor(w.date):w?.plannedDate?campaignFor(w.plannedDate):null);
export const costTypeKey=work=>normalize(work?.type);
export function workArea(state,work){const own=positive(work?.surfaceWorked);if(own!==null)return own;const parcel=active(state,'parcelles').find(p=>p.id===work?.parcelId);return positive(parcel?.surfaceHa);}

const effectParts=(state,work)=>{
  const parts=[],stocks=active(state,'stockItems'),machines=active(state,'materiels');
  const input=positive(work.inputCost);
  if(input!==null)parts.push({key:'inputCost',label:'Intrants saisis',value:input});
  else{
    const linked=stocks.find(s=>s.id===work.resourceEffects?.stockItemId),unitPrice=positive(work.productUnitPrice),dose=positive(work.dose),area=positive(work.surfaceWorked);
    const quantity=positive(work.resourceEffects?.quantity);
    if(linked&&quantity!==null&&positive(linked.unitPrice)!==null)parts.push({key:'inputCost',label:`${linked.name||'Stock'} (stock relié)`,value:quantity*linked.unitPrice});
    else if(unitPrice!==null&&dose!==null&&area!==null)parts.push({key:'inputCost',label:'Intrant (dose × prix × surface)',value:dose*unitPrice*area});
    else if(work.product){const same=stocks.filter(s=>normalize(s.name)&&normalize(s.name)===normalize(work.product)&&positive(s.unitPrice)!==null);if(same.length===1){const q=requiredStock(work,same[0]);if(q!==null&&q>0)parts.push({key:'inputCost',label:`${same[0].name} (prix du stock)`,value:q*same[0].unitPrice});}}
  }
  const machineCost=positive(work.machineCost);
  if(machineCost!==null)parts.push({key:'machineCost',label:'Matériel saisi',value:machineCost});
  else{const machine=machines.find(m=>m.id===(work.resourceEffects?.machineId||work.equipmentId||work.machineId)),hours=positive(work.resourceEffects?.hours)??positive(work.duration),rate=positive(machine?.hourlyCost);if(machine&&hours!==null&&rate!==null)parts.push({key:'machineCost',label:`${machine.nom||'Matériel'} (${fr(hours)} h × coût horaire)`,value:hours*rate});}
  const fuelCost=positive(work.fuelCost),fuel=positive(work.fuel),fuelPrice=positive(state.preferences?.fuelPrice);
  if(fuelCost!==null)parts.push({key:'fuelCost',label:'Carburant saisi',value:fuelCost});else if(fuel!==null&&fuelPrice!==null)parts.push({key:'fuelCost',label:'Carburant (litres × prix du gazole)',value:fuel*fuelPrice});
  for(const [key,label] of [['operatorCost','Main-d’œuvre saisie'],['otherCost','Autres coûts saisis']]){const v=positive(work[key]);if(v!==null)parts.push({key,label,value:v});}
  return parts;
};

// Références €/ha par type de travail : coûts réels (jamais estimés) rapportés à la surface.
export function costReferences(state){
  const refs=new Map();
  for(const w of active(state,'interventions')){
    if(!completed(w)||!hasCost(w)||isEstimatedCost(w))continue;const key=costTypeKey(w),area=workArea(state,w);if(!key||area===null)continue;
    const r=refs.get(key)||{cost:0,area:0,count:0,ids:new Set()};r.cost+=w.cost;r.area+=area;r.count+=1;r.ids.add(w.id);refs.set(key,r);
  }
  return refs;
}

export function proposeCost(state,work,{references=costReferences(state),rates=state.preferences?.costRates||{}}={}){
  const area=workArea(state,work),parts=effectParts(state,work),effects=parts.reduce((s,p)=>s+p.value,0);
  if(effects>0)return{value:round2(effects),method:'effects',label:'Stock et matériel',detail:parts.map(p=>p.label).join(' + '),parts};
  const key=costTypeKey(work),ref=references.get(key);
  if(ref&&area!==null){const own=ref.ids.has(work.id),count=ref.count-(own?1:0),totalArea=ref.area-(own?area:0),totalCost=ref.cost-(own?work.cost:0);
    if(count>0&&totalArea>0){const perHa=totalCost/totalArea;return{value:round2(perHa*area),method:'average',label:'Moyenne de l’exploitation',detail:`${count} ${count>1?'travaux':'travail'} «\u00a0${work.type}\u00a0» chiffré${count>1?'s':''} : ${fr(perHa)} €/ha × ${fr(area)} ha`,perHa,count};}}
  const rate=positive(rates?.[key]);
  if(rate!==null&&area!==null)return{value:round2(rate*area),method:'rate',label:'Votre barème',detail:`Barème «\u00a0${work.type}\u00a0» : ${fr(rate)} €/ha × ${fr(area)} ha`,perHa:rate};
  return null;
}

export function costCompletion(state,{campaign=null}={}){
  const references=costReferences(state),rates=state.preferences?.costRates||{},parcels=new Map(active(state,'parcelles').map(p=>[p.id,p]));
  const candidates=active(state,'interventions').filter(w=>completed(w)&&!hasCost(w)&&(!campaign||workCampaign(w)===campaign));
  const rows=candidates.filter(w=>!w.costEstimateDismissedAt).map(work=>({work,parcel:parcels.get(work.parcelId)||null,area:workArea(state,work),proposal:proposeCost(state,work,{references,rates})}))
    .sort((a,b)=>String(b.work.date||'').localeCompare(String(a.work.date||''))||String(a.work.type||'').localeCompare(String(b.work.type||''),'fr'));
  const proposed=rows.filter(r=>r.proposal);
  return{campaign,rows,proposed,total:round2(proposed.reduce((s,r)=>s+r.proposal.value,0)),dismissed:candidates.filter(w=>w.costEstimateDismissedAt).length,missing:candidates.length};
}

const UNDO_FIELDS=['cost','costSource','costEstimate','inputCost','machineCost','fuelCost','costEstimateDismissedAt'];
const canUpdate=store=>!store.writeGuard||store.writeGuard({entity:'interventions',action:'update'});
export function estimatedCostPatch(work,proposal,at=Date.now()){
  const value=round2(proposal.value),patch={...work,cost:value,costSource:COST_SOURCE_ESTIMATED,costEstimate:{value,method:proposal.method,label:proposal.label,detail:proposal.detail||'',at}};
  if(proposal.method==='effects'){const sums={};for(const part of proposal.parts||[])if(part.key)sums[part.key]=(sums[part.key]||0)+part.value;for(const [key,v] of Object.entries(sums))if(positive(work[key])===null)patch[key]=round2(v);}
  patch.costEstimateDismissedAt=null;return patch;
}

// items : [{id,version}] ; la proposition est recalculée sur l’état actuel au moment d’écrire.
export async function acceptEstimates(store,items){
  if(!canUpdate(store))throw Error('Votre rôle ne permet pas de modifier les travaux.');
  const state=store.snapshot(),references=costReferences(state),rates=state.preferences?.costRates||{},patches=[],skipped=[];
  for(const item of items){const work=store.get('interventions',item.id);if(!work||work.deletedAt||hasCost(work)||(item.version!==undefined&&work.version!==item.version)){skipped.push(item.id);continue;}const proposal=proposeCost(state,work,{references,rates});if(!proposal){skipped.push(item.id);continue;}patches.push(estimatedCostPatch(work,proposal));}
  if(patches.length)await store.upsertMany('interventions',patches,{label:`${patches.length} coût${patches.length>1?'s':''} estimé${patches.length>1?'s':''} accepté${patches.length>1?'s':''}`});
  return{saved:patches.length,skipped:skipped.length,total:round2(patches.reduce((s,p)=>s+p.cost,0)),undo:patches.map(p=>{const before=(state.interventions||[]).find(w=>w.id===p.id)||{};return{id:p.id,value:p.cost,before:Object.fromEntries(UNDO_FIELDS.map(k=>[k,before[k]??null]))};})};
}

// Annulation : seulement si l’estimation est toujours en place (aucune saisie entre-temps).
export async function undoEstimates(store,undo=[]){
  const patches=[];for(const item of undo){const work=store.get('interventions',item.id);if(!work||work.deletedAt||!isEstimatedCost(work)||Math.abs(work.cost-item.value)>=0.005)continue;patches.push({...work,...item.before});}
  if(patches.length)await store.upsertMany('interventions',patches,{label:'Estimation de coût annulée'});return patches.length;
}

export async function saveManualCost(store,id,value,{version,rateKey=null,area=null}={}){
  if(!canUpdate(store))throw Error('Votre rôle ne permet pas de modifier les travaux.');
  const amount=loose(value);if(amount===null||amount<=0)throw Error('Montant invalide : saisissez un coût supérieur à 0 €.');
  const work=store.get('interventions',id);if(!work||work.deletedAt)throw Error('Travail introuvable.');
  if(hasCost(work))throw Error('Ce travail a déjà un coût : il n’a pas été remplacé.');if(version!==undefined&&work.version!==version)throw Error('Le travail a changé entre-temps : rouvrez la liste.');
  const patch={...work,cost:round2(amount),costSource:COST_SOURCE_MANUAL,costEstimate:null,costEstimateDismissedAt:null};
  const saved=await store.upsert('interventions',patch,{label:`Coût saisi : ${work.type||'travail'}`});
  if(rateKey&&positive(area)!==null){const rates={...(store.snapshot().preferences?.costRates||{}),[rateKey]:round2(amount/area)};await store.setPreferences({costRates:rates});}
  return saved;
}

export async function dismissCost(store,id,dismissed=true){
  if(!canUpdate(store))throw Error('Votre rôle ne permet pas de modifier les travaux.');
  const work=store.get('interventions',id);if(!work||work.deletedAt)throw Error('Travail introuvable.');
  const patch={...work,costEstimateDismissedAt:dismissed?Date.now():null};return store.upsert('interventions',patch,{label:dismissed?`Coût ignoré : ${work.type||'travail'}`:`Coût à compléter : ${work.type||'travail'}`});
}
export async function restoreDismissed(store,{campaign=null}={}){
  if(!canUpdate(store))throw Error('Votre rôle ne permet pas de modifier les travaux.');
  const works=active(store.snapshot(),'interventions').filter(w=>w.costEstimateDismissedAt&&!hasCost(w)&&(!campaign||workCampaign(w)===campaign)).map(w=>({...store.get('interventions',w.id),costEstimateDismissedAt:null}));
  if(works.length)await store.upsertMany('interventions',works,{label:'Travaux ignorés réaffichés'});return works.length;
}

// ---------- Coût de revient et prix d’équilibre (n° 81) ----------
export function cultureFor(state,parcel,campaign){return active(state,'rotations').find(r=>r.parcelId===parcel.id&&r.campaignId===campaign)?.culture||parcel.culture||'Non renseignée';}
const lotTonnes=(quantity,unit)=>{const q=positive(quantity);if(q===null)return null;const u=normalize(unit);return u==='kg'?q/1000:u==='q'||u==='quintal'||u==='quintaux'?q/10:u==='t'||u===''?q:null;};
const pricePerTonne=(price,unit)=>{const p=positive(price);if(p===null)return null;const u=normalize(unit);return u==='kg'?p*1000:u==='q'||u==='quintal'||u==='quintaux'?p*10:u==='t'||u===''?p:null;};

export function salesByCulture(state,campaign){
  const result=new Map(),parcels=new Map(active(state,'parcelles').map(p=>[p.id,p]));
  for(const lot of (state.integrationImports||[]).filter(r=>!r.deletedAt&&r.farmKind==='harvest')){
    if(!lot.date||campaignFor(lot.date)!==campaign)continue;const parcel=parcels.get(lot.parcelId),culture=String(lot.crop||'').trim()||(parcel?cultureFor(state,parcel,campaign):'');if(!culture)continue;
    for(const sale of lot.sales||[]){const t=lotTonnes(sale.quantity,lot.unit),price=pricePerTonne(sale.price,lot.unit);if(t===null||price===null)continue;const key=normalize(culture),r=result.get(key)||{tonnes:0,amount:0,count:0};r.tonnes+=t;r.amount+=t*price;r.count+=1;result.set(key,r);}
  }
  return new Map([...result].map(([k,r])=>[k,{...r,price:r.tonnes>0?r.amount/r.tonnes:null}]));
}

export function machineFixedCosts(state){let total=0,count=0;for(const m of active(state,'materiels')){const v=(positive(m.insurance)||0)+(positive(m.amortization)||0);if(v>0){total+=v;count+=1;}}return{total,count};}

export function costPriceByCulture(state,{campaign=campaignFor(),structureCostHa=state.preferences?.structureCostHa}={}){
  const parcels=active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived),structureHa=positive(structureCostHa)||0,fixed=machineFixedCosts(state);
  const totalArea=parcels.reduce((s,p)=>s+(positive(p.surfaceHa)||0),0),sales=salesByCulture(state,campaign),groups=new Map();
  for(const parcel of parcels){
    const area=positive(parcel.surfaceHa);if(area===null)continue;const s=economicSituation(state,parcel,campaign),culture=cultureFor(state,parcel,campaign),key=normalize(culture);
    const g=groups.get(key)||{culture,area:0,charges:0,production:0,chargesWithYield:0,areaWithYield:0,parcels:0,parcelsWithoutYield:0,unknownPlanned:0,priceProduction:0,priceAmount:0,unknown:0,estimated:0,estimatedCount:0,quintals:0,tonnesUnits:0};
    const charges=s.total+s.remaining+s.manualCosts;g.area+=area;g.charges+=charges;g.parcels+=1;
    g.unknown+=s.actual.filter(w=>!hasCost(w)).length;g.unknownPlanned+=s.planned.filter(w=>!hasCost(w)).length;for(const w of s.actual)if(isEstimatedCost(w)){g.estimated+=w.cost;g.estimatedCount+=1;}
    const econ=parcel.economicsByCampaign?.[campaign]||(campaign===campaignFor()?parcel.economics:null)||{};if(econ.yieldUnit==='q/ha')g.quintals+=1;else g.tonnesUnits+=1;
    if(s.yield!==null&&s.yield>0){const production=s.yield*area;g.production+=production;g.chargesWithYield+=charges;g.areaWithYield+=area;if(s.price!==null&&s.price>0){g.priceProduction+=production;g.priceAmount+=production*s.price;}}else g.parcelsWithoutYield+=1;
    groups.set(key,g);
  }
  const rows=[...groups.entries()].map(([key,g])=>{
    const structure=(totalArea>0?fixed.total*g.area/totalArea:0)+structureHa*g.area,structureWithYield=g.area>0?structure*g.areaWithYield/g.area:0;
    const costPrice=g.production>0?g.chargesWithYield/g.production:null,breakEven=g.production>0?(g.chargesWithYield+structureWithYield)/g.production:null;
    const marketPrice=g.priceProduction>0?g.priceAmount/g.priceProduction:null,sale=sales.get(key)||null,salesPrice=sale?.price??null,currentPrice=marketPrice??salesPrice;
    const breakEvenYield=currentPrice&&g.area>0?(g.charges+structure)/g.area/currentPrice:null;
    return{key,culture:g.culture,area:g.area,parcels:g.parcels,charges:g.charges,structure,production:g.production,yield:g.areaWithYield>0?g.production/g.areaWithYield:null,parcelsWithoutYield:g.parcelsWithoutYield,
      costPrice,breakEven,marketPrice,salesPrice,salesTonnes:sale?.tonnes||0,currentPrice,priceSource:marketPrice!==null?'market':salesPrice!==null?'sales':null,delta:currentPrice!==null&&breakEven!==null?currentPrice-breakEven:null,
      breakEvenYield,yieldUnit:g.quintals>g.tonnesUnits?'q/ha':'t/ha',unknown:g.unknown,unknownPlanned:g.unknownPlanned,estimated:g.estimated,estimatedCount:g.estimatedCount,partial:g.unknown>0||g.unknownPlanned>0||g.parcelsWithoutYield>0};
  }).sort((a,b)=>b.area-a.area||a.culture.localeCompare(b.culture,'fr'));
  return{campaign,rows,structureCostHa:structureHa,machineFixed:fixed,totalArea};
}

// Échelle de la jauge : positions 0..1 des repères, sans valeur inventée.
export function gaugeScale(values){const v=values.filter(x=>num(x)!==null&&x>=0);if(!v.length)return null;let min=Math.min(...v),max=Math.max(...v);const pad=Math.max((max-min)*.25,max*.08,1);min=Math.max(0,min-pad);max=max+pad;return{min,max,at:x=>num(x)===null?null:Math.min(1,Math.max(0,(x-min)/(max-min)))};}
