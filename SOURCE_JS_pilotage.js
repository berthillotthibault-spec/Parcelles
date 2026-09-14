import {campaignFor, toNumber} from './utils.js';

const active=(state,type)=>(state[type]||[]).filter(x=>!x.deletedAt);
const previousCampaign=id=>{const m=String(id||'').match(/^(\d{4})/);if(!m)return'';const y=Number(m[1])-1;return `${y}/${String(y+1).slice(-2)}`;};

export function parcelEconomics(state,parcel,{campaign=campaignFor()}={}){
  const area=toNumber(parcel?.surfaceHa);
  const econ=parcel?.economicsByCampaign?.[campaign] || (campaign===campaignFor()?parcel?.economics:null) || {};
  const works=active(state,'interventions').filter(w=>w.parcelId===parcel?.id&&(w.campaignId||campaignFor(w.date||w.plannedDate))===campaign&&w.status!=='Annulé');
  const workCosts=works.reduce((sum,w)=>sum+toNumber(w.cost),0);
  const manualCostHa=toNumber(econ.inputCostHa)+toNumber(econ.operatorCostHa)+toNumber(econ.otherCostHa);
  const manualCosts=manualCostHa*area;
  const yieldValue=toNumber(econ.yield);
  const salePrice=toNumber(econ.salePrice);
  const productHa=toNumber(econ.productHa)||(yieldValue&&salePrice?yieldValue*salePrice:0);
  const grossProduct=productHa*area;
  const charges=workCosts+manualCosts;
  const margin=grossProduct-charges;
  return {parcelId:parcel?.id,area,works:works.length,workCosts,manualCostHa,manualCosts,charges,productHa,grossProduct,margin,marginHa:area?margin/area:0,costHa:area?charges/area:0};
}

export function buildPilotage(state,{campaign=campaignFor()}={}){
  const parcels=active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
  const rows=parcels.map(parcel=>({parcel,...parcelEconomics(state,parcel,{campaign})}));
  const total=rows.reduce((acc,row)=>{
    acc.area+=row.area;acc.grossProduct+=row.grossProduct;acc.charges+=row.charges;acc.margin+=row.margin;acc.workCosts+=row.workCosts;acc.manualCosts+=row.manualCosts;return acc;
  },{area:0,grossProduct:0,charges:0,margin:0,workCosts:0,manualCosts:0});
  const byCultureMap=new Map();
  for(const row of rows){
    const culture=row.parcel.culture||'Non renseignée';
    if(!byCultureMap.has(culture))byCultureMap.set(culture,{culture,area:0,grossProduct:0,charges:0,margin:0,parcels:0,works:0});
    const c=byCultureMap.get(culture);c.area+=row.area;c.grossProduct+=row.grossProduct;c.charges+=row.charges;c.margin+=row.margin;c.parcels+=1;c.works+=row.works;
  }
  const byCulture=[...byCultureMap.values()].map(c=>({...c,productHa:c.area?c.grossProduct/c.area:0,costHa:c.area?c.charges/c.area:0,marginHa:c.area?c.margin/c.area:0})).sort((a,b)=>b.area-a.area);

  const previous=previousCampaign(campaign);
  const compareCampaign=id=>{
    const values=parcels.map(parcel=>parcelEconomics(state,parcel,{campaign:id}));
    const t=values.reduce((a,r)=>{a.grossProduct+=r.grossProduct;a.charges+=r.charges;a.margin+=r.margin;return a;},{grossProduct:0,charges:0,margin:0});
    return{id,...t};
  };

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
    productHa:total.area?total.grossProduct/total.area:0,
    costHa:total.area?total.charges/total.area:0,
    marginHa:total.area?total.margin/total.area:0,
    byCulture,parcelRows:rows.sort((a,b)=>b.margin-a.margin),
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
