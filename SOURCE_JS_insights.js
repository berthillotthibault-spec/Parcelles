import {toNumber, campaignFor, normalize, localDate} from './utils.js';
export function farmInsights(state){
  const active=(t)=>(state[t]||[]).filter(x=>!x.deletedAt);
  const parcels=active('parcelles'), works=active('interventions'), tasks=active('tasks'), machines=active('materiels');
  const own=parcels.filter(p=>(p.ownershipType||'own')==='own');
  const area=own.reduce((s,p)=>s+toNumber(p.surfaceHa),0);
  const byCulture={}; own.forEach(p=>{const c=p.culture||'Non renseignée';byCulture[c]=(byCulture[c]||0)+toNumber(p.surfaceHa)});
  const today=new Date().toISOString().slice(0,10);
  const overdueTasks=tasks.filter(t=>t.status!=='Terminé'&&t.dueDate&&t.dueDate<today);
  const dueMaintenance=machines.filter(m=>Number.isFinite(Number(m.maintenanceDue))&&Number.isFinite(Number(m.currentMeter))&&Number(m.currentMeter)>=Number(m.maintenanceDue)-20);
  const campaign=campaignFor();
  const campaignWorks=works.filter(w=>(w.campaignId||campaignFor(w.date))===campaign);
  const cost=campaignWorks.reduce((s,w)=>s+toNumber(w.cost),0);
  return {area,parcelCount:own.length,byCulture,todayWorks:works.filter(w=>(w.plannedDate||w.date)===today&&w.status!=='Annulé'),overdueTasks,dueMaintenance,campaign,cost};
}
export function searchEverything(state,query){
  const q=normalize(query); if(!q)return[]; const out=[];
  const add=(type,id,title,subtitle,text)=>{if(normalize(text).includes(q))out.push({type,id,title,subtitle})};
  (state.parcelles||[]).filter(x=>!x.deletedAt).forEach(p=>add('parcel',p.id,p.nom,`${p.culture||''} · ${p.commune||''}`,[p.nom,p.culture,p.commune,p.notes,p.exploitant].join(' ')));
  (state.interventions||[]).filter(x=>!x.deletedAt).forEach(w=>{const p=(state.parcelles||[]).find(x=>x.id===w.parcelId);add('work',w.id,w.type,`${p?.nom||'Parcelle'} · ${localDate(w.date)}`,[w.type,w.product,w.note,w.operator,p?.nom].join(' '))});
  (state.tasks||[]).filter(x=>!x.deletedAt).forEach(t=>add('task',t.id,t.title,t.status,[t.title,t.note,t.status].join(' ')));
  (state.materiels||[]).filter(x=>!x.deletedAt).forEach(m=>add('equipment',m.id,m.nom,'Matériel',[m.nom,m.brand,m.model].join(' ')));
  (state.clients||[]).filter(x=>!x.deletedAt).forEach(c=>add('client',c.id,c.name,'Client',[c.name,c.phone,c.email,c.address].join(' ')));
  (state.points||[]).filter(x=>!x.deletedAt).forEach(pt=>add('point',pt.id,pt.nom||pt.type,pt.type,[pt.nom,pt.type,pt.note].join(' ')));
  (state.observations||[]).filter(x=>!x.deletedAt).forEach(o=>{const p=(state.parcelles||[]).find(x=>x.id===o.parcelId);add('observation',o.id,o.title||o.type||'Observation',`${p?.nom||'Sans parcelle'} · ${localDate(o.date)}`,[o.title,o.type,o.note,p?.nom].join(' '))});
  (state.stockItems||[]).filter(x=>!x.deletedAt).forEach(x=>add('stock',x.id,x.name||'Stock',`${x.quantity??0} ${x.unit||''}`,[x.name,x.note,x.unit].join(' ')));
  (state.documents||[]).filter(x=>!x.deletedAt).forEach(x=>add('document',x.id,x.name||'Document',x.mimeType||'Document',[x.name,x.note,x.mimeType].join(' ')));
  return out.slice(0,80);
}
