import {campaignFor, toNumber} from './utils.js';

const active=(state,type)=>(state[type]||[]).filter(x=>!x.deletedAt);

export function buildStatistics(state,{campaign=campaignFor()}={}){
  const parcels=active(state,'parcelles');
  const own=parcels.filter(p=>(p.ownershipType||'own')==='own');
  const works=active(state,'interventions').filter(w=>(w.campaignId||campaignFor(w.date))===campaign);
  const machines=active(state,'materiels');
  const tasks=active(state,'tasks');
  const area=own.reduce((s,p)=>s+toNumber(p.surfaceHa),0);
  const byCulture={};
  for(const p of own){const key=p.culture||'Non renseignée';byCulture[key]=(byCulture[key]||0)+toNumber(p.surfaceHa);}
  const byWorkType={};
  const byMonth={};
  let totalCost=0,totalHours=0,totalFuel=0;
  for(const w of works){
    const key=w.type||'Travail';byWorkType[key]=(byWorkType[key]||0)+1;
    const month=String(w.date||w.plannedDate||'').slice(0,7)||'Sans date';byMonth[month]=(byMonth[month]||0)+1;
    totalCost+=toNumber(w.cost);totalHours+=toNumber(w.durationHours);totalFuel+=toNumber(w.fuelLiters);
  }
  const equipment=machines.map(m=>{
    const linked=works.filter(w=>w.equipmentId===m.id||w.machineId===m.id);
    return{id:m.id,name:m.nom||'Matériel',works:linked.length,hours:linked.reduce((s,w)=>s+toNumber(w.durationHours),0),cost:linked.reduce((s,w)=>s+toNumber(w.machineCost),0)};
  }).sort((a,b)=>b.hours-a.hours||b.works-a.works);
  const today=new Date().toISOString().slice(0,10);
  const tasksOpen=tasks.filter(t=>t.status!=='Terminé');
  return{
    campaign,area,parcelCount:own.length,workCount:works.length,totalCost,totalHours,totalFuel,
    costPerHa:area?totalCost/area:0,
    byCulture:Object.entries(byCulture).map(([name,value])=>({name,value,percent:area?value/area*100:0})).sort((a,b)=>b.value-a.value),
    byWorkType:Object.entries(byWorkType).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value),
    byMonth:Object.entries(byMonth).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>({name,value})),
    equipment,
    overdueTasks:tasksOpen.filter(t=>t.dueDate&&t.dueDate<today).length,
    openTasks:tasksOpen.length
  };
}
