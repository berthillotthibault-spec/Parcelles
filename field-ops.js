import {campaignFor, geometryCentroid, haversineMeters, pointInGeometry, toNumber} from './utils.js';
import {grazingWatch} from './home-priorities.js';

export function sessionElapsedMs(session, nowMs=Date.now()){
  if(!session?.startedAt)return 0;
  const end=session.endedAt||nowMs;
  return Math.max(0,Number(end)-Number(session.startedAt));
}

export function sessionDurationHours(session, nowMs=Date.now()){
  return Math.round((sessionElapsedMs(session,nowMs)/3600000)*100)/100;
}

export function formatElapsed(ms){
  const seconds=Math.max(0,Math.floor(Number(ms||0)/1000));
  const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function distanceToBoundary(position,geometry){
  const rings=geometry?.type==='Polygon'?geometry.coordinates:geometry?.type==='MultiPolygon'?geometry.coordinates.flat():[];
  const lat=Number(position.latitude),lon=Number(position.longitude),scaleX=111320*Math.cos(lat*Math.PI/180),scaleY=111320;
  let best=Infinity;
  for(const ring of rings)for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],ax=(a[0]-lon)*scaleX,ay=(a[1]-lat)*scaleY,bx=(b[0]-lon)*scaleX,by=(b[1]-lat)*scaleY;
    const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/length)):0;
    best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return best;
}

export function locateParcels(position,parcels=[]){
  if(!Number.isFinite(Number(position?.latitude))||!Number.isFinite(Number(position?.longitude)))return[];
  return parcels.filter(p=>p&&!p.deletedAt&&p.geometry).map(parcel=>{
    const inside=pointInGeometry(Number(position.longitude),Number(position.latitude),parcel.geometry);
    const center=geometryCentroid(parcel.geometry);
    return{parcel,inside,distance:inside?0:Math.min(distanceToBoundary(position,parcel.geometry),haversineMeters(position,center))};
  }).sort((a,b)=>a.distance-b.distance);
}

export function currentParcelAt(position,parcels=[]){
  return locateParcels(position,parcels).find(row=>row.inside)?.parcel||null;
}

export function buildInterventionFromSession(session,parcel,overrides={}){
  if(!session?.parcelId&&!parcel?.id)throw new Error('Parcelle manquante pour la session terrain.');
  const started=new Date(Number(session.startedAt)||Date.now());
  const ended=new Date(Number(session.endedAt)||Date.now());
  const date=started.toISOString().slice(0,10);
  const startTime=`${String(started.getHours()).padStart(2,'0')}:${String(started.getMinutes()).padStart(2,'0')}`;
  const endTime=`${String(ended.getHours()).padStart(2,'0')}:${String(ended.getMinutes()).padStart(2,'0')}`;
  return{
    parcelId:session.parcelId||parcel.id,
    date,
    campaignId:campaignFor(date),
    type:session.type||'Travail terrain',
    status:'Terminé',
    startTime,endTime,
    duration:sessionDurationHours(session,Number(session.endedAt)||Date.now()),
    surfaceWorked:toNumber(session.surfaceWorked||parcel?.surfaceHa)||null,
    operator:session.operator||'',
    equipmentId:session.equipmentId||'',
    note:session.note||'',
    fieldSessionId:session.id||null,
    chantierId:session.chantierId||null,
    ...overrides
  };
}

export function chantierProgress(chantier,interventions=[]){
  const parcelIds=[...new Set(chantier?.parcelIds||[])];
  const doneIds=new Set(interventions.filter(w=>!w.deletedAt&&w.chantierId===chantier?.id&&w.status==='Terminé').map(w=>w.parcelId));
  const done=parcelIds.filter(id=>doneIds.has(id)).length;
  return{total:parcelIds.length,done,remaining:Math.max(0,parcelIds.length-done),ratio:parcelIds.length?done/parcelIds.length:0};
}

export function nextChantierParcelId(chantier,interventions=[]){
  const progressDone=new Set(interventions.filter(w=>!w.deletedAt&&w.chantierId===chantier?.id&&w.status==='Terminé').map(w=>w.parcelId));
  return(chantier?.parcelIds||[]).find(id=>!progressDone.has(id))||null;
}

// ---- n° 12 « Ma tournée du jour » : logique pure, testable sans DOM. ----
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const fold=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const isOpen=(item,kind)=>!item?.deletedAt&&!['Terminé','Annulé'].includes(item?.status||(kind==='task'?'À faire':'Terminé'));
const dayOf=(item,kind)=>{const v=String(kind==='task'?item.dueDate||'':item.plannedDate||item.date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';};

// Point de destination d’une parcelle : son « Entrée de champ » si elle existe, sinon le centre.
export function parcelRoutePoint(parcel,points=[]){
  if(!parcel)return null;
  const entry=(points||[]).find(pt=>!pt.deletedAt&&pt.parcelId===parcel.id&&fold(pt.type).includes('entree')&&finite(pt.latitude)&&finite(pt.longitude));
  if(entry)return{latitude:Number(entry.latitude),longitude:Number(entry.longitude),source:'Entrée de champ'};
  const c=parcel.geometry?geometryCentroid(parcel.geometry):null;
  return c&&finite(c.latitude)&&finite(c.longitude)?{latitude:Number(c.latitude),longitude:Number(c.longitude),source:'Centre de parcelle'}:null;
}

// Actions du jour : travaux et tâches du jour ou en retard, lots à déplacer, entretiens dus.
// `include` force des clés déjà prévues dans la tournée (une étape finie reste visible).
export function dayRouteActions(data,today,{grazingDays=7,maintenanceHours=0,include=[]}={}){
  const keep=new Set(include||[]),parcels=new Map((data.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,p])),out=[];
  const push=(key,kind,item,label,parcelId,extra={})=>{const parcel=parcels.get(parcelId)||null;out.push({key,kind,id:item.id,label,parcelId:parcel?.id||null,place:parcel?.nom||extra.place||'',surfaceHa:finite(parcel?.surfaceHa)?Number(parcel.surfaceHa):null,point:parcelRoutePoint(parcel,data.points),...extra});};
  for(const w of data.interventions||[]){const key='work:'+w.id,d=dayOf(w,'work');if(w.deletedAt)continue;if(keep.has(key)||(isOpen(w,'work')&&d&&d<=today))push(key,'work',w,w.type||'Travail',w.parcelId,{done:!isOpen(w,'work')});}
  for(const t of data.tasks||[]){const key='task:'+t.id,d=dayOf(t,'task');if(t.deletedAt)continue;if(keep.has(key)||(isOpen(t,'task')&&d&&d<=today))push(key,'task',t,t.title||'Tâche',t.parcelId,{done:!isOpen(t,'task')});}
  const watch=new Map(grazingWatch(data,today,grazingDays).map(r=>[r.id,r]));
  for(const s of data.grazingSessions||[]){const key='grazing:'+s.id,row=watch.get(s.id);if(s.deletedAt||!(row||keep.has(key)))continue;push(key,'grazing',s,'Déplacer le lot',s.parcelId,{done:!row,detail:`${s.animalsCount?`${s.animalsCount} ${s.animalType||'animaux'}`:'Lot'}${row?` · ${row.days} j`:''}`});}
  for(const m of data.materiels||[]){const key='maintenance:'+m.id,due=finite(m.maintenanceDue)&&finite(m.currentMeter)?Number(m.maintenanceDue)-Number(m.currentMeter):null;if(m.deletedAt)continue;if(keep.has(key)||(due!==null&&due<=maintenanceHours))push(key,'maintenance',m,`Entretien · ${m.nom||'Matériel'}`,null,{place:m.location||'Atelier'});}
  return out;
}

// Minutes de trajet approchées : distance à vol d’oiseau × 1,3 (routes et chemins) à 30 km/h.
export function travelMinutes(meters,{speedKmh=30,detour=1.3}={}){return finite(meters)?Math.max(1,Math.round(Number(meters)*detour/1000/speedKmh*60)):null;}

// Ordre de tournée : `order` (clés) d’abord, puis plus proche voisin depuis `start` ; les actions
// sans lieu (entretien à l’atelier) passent en fin de liste. Chaque étape porte son trajet depuis la précédente.
export function planDayRoute(actions,start=null,{order=[],speedKmh=30}={}){
  const byKey=new Map((actions||[]).map(a=>[a.key,a])),placed=[],seen=new Set();
  for(const key of order||[])if(byKey.has(key)&&!seen.has(key)){placed.push(byKey.get(key));seen.add(key);}
  const located=[],floating=[];
  for(const a of actions||[])if(!seen.has(a.key))(a.point?located:floating).push(a);
  let current=start&&finite(start.latitude)&&finite(start.longitude)?start:null;
  for(let i=placed.length-1;i>=0&&!current;i--)if(placed[i].point)current=placed[i].point;
  if(!current&&located.length)current=located[0].point;
  while(located.length){located.sort((a,b)=>haversineMeters(current,a.point)-haversineMeters(current,b.point));const next=located.shift();placed.push(next);current=next.point;}
  placed.push(...floating);
  let from=start&&finite(start.latitude)&&finite(start.longitude)?start:null;
  return placed.map((a,i)=>{const meters=from&&a.point?haversineMeters(from,a.point):null;if(a.point)from=a.point;return{...a,index:i,distanceM:meters===null?null:Math.round(meters),minutes:meters===null?null:(meters<50?0:travelMinutes(meters,{speedKmh}))};});
}

// Déplace une étape d’un cran (−1 / +1) dans l’ordre des clés.
export function moveRouteKey(keys,key,delta){const list=[...(keys||[])],i=list.indexOf(key),j=i+delta;if(i<0||j<0||j>=list.length)return list;[list[i],list[j]]=[list[j],list[i]];return list;}

// « 1/5 · Fauche · Les Brosses · 6 min »
export function stepTitle(stop,total){return[`${stop.index+1}/${total}`,stop.label,stop.place,stop.minutes===null||stop.minutes===undefined?'':stop.minutes===0?'sur place':`${stop.minutes} min`].filter(Boolean).join(' · ');}

// Récapitulatif du soir : étapes faites, heures terrain par parcelle, hectares réalisés, à reporter.
export function dayRouteRecap(stops,doneKeys,data,today){
  const done=new Set(doneKeys||[]),finished=stops.filter(s=>done.has(s.key)||s.done),remaining=stops.filter(s=>!done.has(s.key)&&!s.done);
  const hours=new Map();
  for(const s of data.fieldSessions||[]){if(s.deletedAt||!s.startedAt||!s.endedAt)continue;const d=new Date(Number(s.startedAt)),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if(day!==today)continue;hours.set(s.parcelId,(hours.get(s.parcelId)||0)+sessionDurationHours(s));}
  const names=new Map((data.parcelles||[]).map(p=>[p.id,p.nom]));
  const ha=finished.filter(s=>s.kind==='work').reduce((sum,s)=>{const w=(data.interventions||[]).find(x=>x.id===s.id);return sum+(toNumber(w?.surfaceWorked)||s.surfaceHa||0);},0);
  return{done:finished.length,total:stops.length,hectares:Math.round(ha*100)/100,hoursByParcel:[...hours].map(([parcelId,h])=>({parcelId,name:names.get(parcelId)||'Parcelle',hours:Math.round(h*100)/100})).sort((a,b)=>b.hours-a.hours),remaining};
}
