import {campaignFor,pointInGeometry} from './utils.js';
export const active=(s,key)=>(s[key]||[]).filter(x=>!x.deletedAt);
export const completed=w=>['Terminé','Terminée'].includes(w.status||'Terminé');
const day=v=>String(v||'').slice(0,10);
export function parcelMemory(state,parcelId,campaign){
  const works=active(state,'interventions').filter(w=>w.parcelId===parcelId&&completed(w)&&(w.campaignId||campaignFor(w.date))===campaign&&w.date);
  const rotations=active(state,'rotations').filter(r=>r.parcelId===parcelId&&r.campaignId===campaign);
  const rows=[];for(const w of works)rows.push({date:day(w.date),kind:'Travail',title:w.type,id:w.id,entity:'interventions',cost:typeof w.cost==='number'?w.cost:null});
  for(const entity of ['observations','photos','documents','grazingSessions'])for(const item of active(state,entity).filter(x=>x.parcelId===parcelId)){const date=day(item.date||item.documentDate||item.startDate||item.entryDate||(item.capturedAt?new Date(item.capturedAt).toISOString():''));if(date&&campaignFor(date)===campaign)rows.push({date,kind:({observations:'Observation',photos:'Photo',documents:'Document',grazingSessions:'Animaux'})[entity],title:item.title||item.name||item.lotName||item.type||'Entrée animaux',id:item.id,entity});}
  const costRows=works.filter(w=>typeof w.cost==='number'&&Number.isFinite(w.cost));
  return{campaign,culture:rotations.map(r=>r.culture).filter(Boolean).join(', ')||[...new Set(works.map(w=>w.culture).filter(Boolean))].join(', ')||null,works:works.length,knownCost:costRows.reduce((s,w)=>s+w.cost,0),missingCost:works.length-costRows.length,rows:rows.sort((a,b)=>b.date.localeCompare(a.date))};
}
export function campaignIds(state,parcelId){const ids=new Set([campaignFor()]);for(const type of ['interventions','rotations'])for(const r of active(state,type).filter(r=>!parcelId||r.parcelId===parcelId)){const id=r.campaignId||(r.date?campaignFor(r.date):null);if(id)ids.add(id);}return [...ids].sort().reverse();}
export function replayFeatures(state,date){return active(state,'parcelles').filter(p=>p.geometry).map(p=>{const works=active(state,'interventions').filter(w=>w.parcelId===p.id&&completed(w)&&w.date&&day(w.date)<=date).sort((a,b)=>String(b.date).localeCompare(String(a.date)));const obs=active(state,'observations').filter(o=>o.parcelId===p.id&&o.date&&day(o.date)<=date&&(!o.resolvedAt||day(new Date(o.resolvedAt).toISOString())>date));const rotations=active(state,'rotations').filter(r=>r.parcelId===p.id&&r.campaignId===campaignFor(date));return{type:'Feature',geometry:p.geometry,properties:{name:p.nom,culture:rotations[0]?.culture||'Culture historique inconnue',last:works[0]?`${works[0].date} · ${works[0].type}`:'Aucun travail daté',observations:obs.length,date}};});}
export class ActivityDetector{
  constructor(){this.reset();}
  reset(){this.current=null;this.previous=null;this.suggestions=[];}
  sample(position,parcels,now=Date.now()){
    if(!Number.isFinite(position?.accuracy)||position.accuracy>50)return null;
    if(this.previous&&now-this.previous>120000){this.current=null;this.previous=now;return null;}this.previous=now;
    const {longitude,latitude}=position;const matches=parcels.filter(p=>!p.deletedAt&&p.geometry&&this.contains(longitude,latitude,p.geometry));if(matches.length>1)return null;const parcel=matches[0];
    if(this.current&&parcel?.id===this.current.parcelId){this.current.last=now;this.current.samples++;return null;}
    const finished=this.current;this.current=parcel?{parcelId:parcel.id,start:now,last:now,samples:1}:null;
    if(finished&&finished.samples>=3&&finished.last-finished.start>=5*60000){const proposal={...finished,duration:(finished.last-finished.start)/3600000};this.suggestions.push(proposal);return proposal;}return null;
  }
  contains(lon,lat,geometry){return pointInGeometry(lon,lat,geometry);}
}
