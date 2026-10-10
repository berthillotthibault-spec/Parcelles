import {campaignFor, toNumber} from './utils.js';

const active=(state,type)=>(state[type]||[]).filter(x=>!x.deletedAt);
const previousCampaign=id=>{const m=String(id||'').match(/^(\d{4})/);if(!m)return'';const y=Number(m[1])-1;return `${y}/${String(y+1).slice(-2)}`;};

// ---------- n° 85 · Un seul moteur de marge ----------
// marginModel : réalisé (travaux terminés), engagé (travaux planifiés chiffrés) et prévisionnel
// (produit attendu − toutes les charges). Règles affichées à l’utilisateur :
//  - un coût absent n’est jamais compté comme 0 € : il fait baisser la fiabilité ;
//  - les charges manuelles €/ha sont un forfait appliqué seulement si aucun travail de la
//    parcelle n’est chiffré sur la campagne ;
//  - la culture est celle de la rotation de la campagne, sinon celle de la parcelle ;
//  - produit/ha = produit saisi, sinon rendement × prix (même unité : t/ha et €/t, ou q/ha et €/q).
export const MARGIN_RULES=Object.freeze([
  'Coût non renseigné : non compté, la fiabilité baisse.',
  'Charges manuelles €/ha : forfait appliqué seulement si aucun travail de la parcelle n’est chiffré.',
  'Culture résolue par campagne d’après l’assolement.',
  'Marge prévisionnelle = produit attendu − charges réalisées − charges engagées (travaux prévus chiffrés).'
]);
const numOrNull=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};
const DONE=['Terminé','Terminée','Fait','Réalisé'];
export const workCampaignOf=w=>w?.campaignId||campaignFor(w?.date||w?.plannedDate);
export function cultureForCampaign(state,parcel,campaign){
  return active(state,'rotations').find(r=>r.parcelId===parcel?.id&&r.campaignId===campaign)?.culture||parcel?.culture||'Non renseignée';
}
const econFor=(parcel,campaign)=>parcel?.economicsByCampaign?.[campaign]||(campaign===campaignFor()?parcel?.economics:null)||{};
const status=(known,total)=>total===0||known===total?'connu':known===0?'inconnu':'partiel';

export function parcelMargin(state,parcel,{campaign=campaignFor(),works=null}={}){
  const area=numOrNull(parcel?.surfaceHa)||0,econ=econFor(parcel,campaign),culture=cultureForCampaign(state,parcel,campaign);
  const list=(works||active(state,'interventions')).filter(w=>!w.deletedAt&&w.parcelId===parcel?.id&&workCampaignOf(w)===campaign&&w.status!=='Annulé');
  const cost=w=>{const c=numOrNull(w.cost);return c!==null&&c>0?c:null;};
  const done=list.filter(w=>DONE.includes(w.status||'Terminé')),planned=list.filter(w=>!done.includes(w));
  const realized=done.reduce((s,w)=>s+(cost(w)||0),0),engaged=planned.reduce((s,w)=>s+(cost(w)||0),0);
  const anyCosted=list.some(w=>cost(w)!==null);
  const manualHa=['inputCostHa','operatorCostHa','otherCostHa'].reduce((s,k)=>s+(numOrNull(econ[k])||0),0);
  const forfaitApplied=!anyCosted&&manualHa>0,forfait=forfaitApplied?manualHa*area:0;
  // Avec le forfait, les travaux non chiffrés sont couverts : ils ne comptent pas comme manquants.
  const unknownRealized=forfaitApplied?0:done.filter(w=>cost(w)===null).length,unknownPlanned=forfaitApplied?0:planned.filter(w=>cost(w)===null).length;
  const yieldValue=numOrNull(econ.yield),price=numOrNull(econ.salePrice),explicit=numOrNull(econ.productHa);
  const productHa=explicit!==null&&explicit>0?explicit:yieldValue!==null&&price!==null&&yieldValue>0&&price>0?yieldValue*price:null;
  const product=productHa!==null&&area>0?productHa*area:null;
  const charges=realized+engaged+forfait;
  // Fiabilité : moitié produit, moitié charges (part des travaux chiffrés ; forfait = connu).
  const totalWorks=list.length,knownWorks=totalWorks-unknownRealized-unknownPlanned;
  const costScore=forfaitApplied?1:totalWorks?knownWorks/totalWorks:0,productScore=product!==null?1:0;
  const lines=[
    {key:'product',label:'Produit attendu',status:product!==null?'connu':yieldValue!==null||price!==null?'partiel':'inconnu',value:product},
    {key:'realized',label:'Charges réalisées',status:forfaitApplied?'connu':status(done.length-unknownRealized,done.length),value:realized,missing:unknownRealized,count:done.length},
    {key:'engaged',label:'Charges engagées (prévues)',status:status(planned.length-unknownPlanned,planned.length),value:engaged,missing:unknownPlanned,count:planned.length},
    {key:'forfait',label:'Forfait de charges manuelles',status:forfaitApplied?'connu':manualHa>0?'ignoré':'absent',value:forfait}
  ];
  return{parcel,parcelId:parcel?.id,culture,area,works:list.length,realized,engaged,forfait,forfaitApplied,manualHa,ignoredManual:!forfaitApplied&&manualHa>0?manualHa*area:0,
    charges,product,productHa,yield:yieldValue,yieldUnit:econ.yieldUnit||'t/ha',price,
    marginRealized:product===null?null:product-realized-forfait,margin:product===null?null:product-charges,
    unknownRealized,unknownPlanned,reliability:Math.round((costScore+productScore)/2*100),lines};
}

const sumRows=rows=>{
  const t=rows.reduce((a,r)=>{a.area+=r.area;a.charges+=r.charges;a.realized+=r.realized;a.engaged+=r.engaged;a.forfait+=r.forfait;a.unknownRealized+=r.unknownRealized;a.unknownPlanned+=r.unknownPlanned;a.weighted+=r.reliability*(r.area||0);if(r.product!==null){a.product+=r.product;a.productArea+=r.area;a.chargesWithProduct+=r.charges;}else a.withoutProduct+=1;return a;},
    {area:0,charges:0,realized:0,engaged:0,forfait:0,unknownRealized:0,unknownPlanned:0,weighted:0,product:0,productArea:0,chargesWithProduct:0,withoutProduct:0});
  const reliability=t.area>0?Math.round(t.weighted/t.area):rows.length?Math.round(rows.reduce((s,r)=>s+r.reliability,0)/rows.length):0;
  const margin=t.productArea>0?t.product-t.chargesWithProduct:null;
  return{...t,reliability,margin,marginHa:margin!==null&&t.productArea>0?margin/t.productArea:null,productHa:t.productArea>0?t.product/t.productArea:null,costHa:t.area>0?t.charges/t.area:null,parcels:rows.length};
};

/** Résumé lisible : « Marge 18 400 € · fiable à 72 % (5 travaux sans coût) ». */
export function reliabilityText(total){
  const parts=[];const missing=total.unknownRealized+total.unknownPlanned;
  if(total.unknownRealized)parts.push(`${total.unknownRealized} ${total.unknownRealized>1?'travaux réalisés':'travail réalisé'} sans coût`);
  if(total.unknownPlanned)parts.push(`${total.unknownPlanned} ${total.unknownPlanned>1?'travaux prévus non chiffrés':'travail prévu non chiffré'}`);
  if(total.withoutProduct)parts.push(`${total.withoutProduct} parcelle${total.withoutProduct>1?'s':''} sans rendement ni prix`);
  return{percent:total.reliability,missing,detail:parts.join(', '),label:`fiable à ${total.reliability} %${parts.length?` (${parts.join(', ')})`:''}`};
}

export function marginModel(state,{campaign=campaignFor()}={}){
  const parcels=active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived),works=active(state,'interventions');
  const rows=parcels.map(parcel=>parcelMargin(state,parcel,{campaign,works}));
  const groups=new Map();for(const r of rows){if(!groups.has(r.culture))groups.set(r.culture,[]);groups.get(r.culture).push(r);}
  const byCulture=[...groups].map(([culture,list])=>({culture,...sumRows(list)})).sort((a,b)=>b.area-a.area||a.culture.localeCompare(b.culture,'fr'));
  const total=sumRows(rows);
  return{campaign,rows,byCulture,total,reliability:reliabilityText(total),rules:MARGIN_RULES};
}

// Ancienne forme conservée pour les appelants : valeurs issues de marginModel (inconnu = 0 ici).
export function parcelEconomics(state,parcel,{campaign=campaignFor()}={}){
  const m=parcelMargin(state,parcel,{campaign}),gross=m.product||0,margin=gross-m.charges;
  return{parcelId:m.parcelId,area:m.area,works:m.works,workCosts:m.realized+m.engaged,manualCostHa:m.manualHa,manualCosts:m.forfait,charges:m.charges,productHa:m.productHa||0,grossProduct:gross,margin,marginHa:m.area?margin/m.area:0,costHa:m.area?m.charges/m.area:0,model:m};
}

export function buildPilotage(state,{campaign=campaignFor()}={}){
  const parcels=active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
  // n° 85 — toutes les valeurs viennent de marginModel. margin vaut null quand aucun produit n’est connu.
  const model=marginModel(state,{campaign});
  const rows=model.rows.map(m=>({parcel:m.parcel,...m,grossProduct:m.product,workCosts:m.realized+m.engaged,manualCosts:m.forfait,marginHa:m.margin!==null&&m.area?m.margin/m.area:null,costHa:m.area?m.charges/m.area:null}));
  const t=model.total,total={area:t.area,grossProduct:t.product,charges:t.charges,margin:t.margin,workCosts:t.realized+t.engaged,manualCosts:t.forfait};
  const byCulture=model.byCulture.map(c=>({...c,grossProduct:c.product,works:model.rows.filter(r=>r.culture===c.culture).reduce((s,r)=>s+r.works,0)}));

  const previous=previousCampaign(campaign);
  const compareCampaign=id=>{const m=id===campaign?model:marginModel(state,{campaign:id});return{id,grossProduct:m.total.product,charges:m.total.charges,margin:m.total.margin,reliability:m.total.reliability};};

  const stock=active(state,'stockItems');
  const stockValue=stock.reduce((s,x)=>s+toNumber(x.quantity)*toNumber(x.unitPrice),0);
  const lowStock=stock.filter(x=>x.alertBelow!==null&&x.alertBelow!==undefined&&toNumber(x.quantity)<=toNumber(x.alertBelow));
  const machines=active(state,'materiels');
  const maintenance=active(state,'maintenanceRecords');
  const machineRows=machines.map(m=>{
    const works=active(state,'interventions').filter(w=>(w.campaignId||campaignFor(w.date||w.plannedDate))===campaign&&(w.equipmentId===m.id||w.machineId===m.id));
    const records=maintenance.filter(r=>r.equipmentId===m.id);
    const workHours=works.reduce((s,w)=>s+toNumber(w.duration),0);
    const workCost=works.reduce((s,w)=>s+toNumber(w.machineCost),0);
    const maintenanceCost=records.reduce((s,r)=>s+toNumber(r.cost),0);
    const fixedAnnual=toNumber(m.insurance)+toNumber(m.amortization);
    return{id:m.id,name:m.nom||'Matériel',workHours,workCost,maintenanceCost,fixedAnnual,totalKnownCost:workCost+maintenanceCost+fixedAnnual};
  }).sort((a,b)=>b.totalKnownCost-a.totalKnownCost);

  return{
    campaign,previousCampaign:previous,
    ...total,
    productHa:t.productHa,costHa:t.costHa,marginHa:t.marginHa,model,reliability:model.reliability,
    byCulture,parcelRows:rows.sort((a,b)=>(b.margin??-Infinity)-(a.margin??-Infinity)),
    current:compareCampaign(campaign),previous:compareCampaign(previous),
    stock:{count:stock.length,value:stockValue,lowCount:lowStock.length,lowStock},
    equipment:machineRows
  };
}

export function stockSummary(state){
  const items=active(state,'stockItems');
  const movements=active(state,'stockMovements').sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||(b.createdAt||0)-(a.createdAt||0));
  const rows=items.map(item=>{
    const history=movements.filter(m=>m.stockItemId===item.id);
    return{...item,value:toNumber(item.quantity)*toNumber(item.unitPrice),movementCount:history.length,lastMovement:history[0]||null};
  }).sort((a,b)=>b.value-a.value||String(a.name).localeCompare(String(b.name),'fr'));
  return{rows,movements,totalValue:rows.reduce((s,x)=>s+x.value,0),low:rows.filter(x=>x.alertBelow!==null&&x.alertBelow!==undefined&&toNumber(x.quantity)<=toNumber(x.alertBelow))};
}

// Carte (n° 85) : valeurs de marginModel ; un montant inconnu n’est jamais affiché comme 0 €.
// Coût/ha : charges réalisées connues ; marge/ha : seulement si le produit est connu et tous les travaux réalisés chiffrés.
export function mapEconomics(state,{campaign=campaignFor()}={}){
  const works=active(state,'interventions');
  return new Map(active(state,'parcelles').map(parcel=>{
    const m=parcelMargin(state,parcel,{campaign,works}),costKnown=m.realized>0||m.forfaitApplied;
    return [parcel.id,{campaign,costHa:m.area>0&&costKnown?(m.realized+m.forfait)/m.area:null,marginHa:m.area>0&&costKnown&&m.marginRealized!==null&&m.unknownRealized===0?m.marginRealized/m.area:null,reliability:m.reliability}];
  }));
}
export function economicColor(value,mode){
  if(value===null||value===undefined||!Number.isFinite(value))return {color:'#7c8580',label:'Données insuffisantes'};
  const color=mode==='margin'?value<0?'#bf4944':value<250?'#b88722':value<750?'#548e61':'#22643f':value<100?'#3a8060':value<300?'#658b85':value<600?'#b88722':'#b65b47';
  return {color,label:`${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(value)} €/ha · ${mode==='margin'?'marge estimée':'coûts enregistrés'}`};
}
