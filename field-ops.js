import {campaignFor, geometryCentroid, haversineMeters, pointInGeometry, toNumber} from './utils.js';

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

export function locateParcels(position,parcels=[]){
  if(!Number.isFinite(Number(position?.latitude))||!Number.isFinite(Number(position?.longitude)))return[];
  return parcels.filter(p=>p&&!p.deletedAt&&p.geometry).map(parcel=>{
    const inside=pointInGeometry(Number(position.longitude),Number(position.latitude),parcel.geometry);
    const center=geometryCentroid(parcel.geometry);
    return{parcel,inside,distance:inside?0:haversineMeters(position,center)};
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
