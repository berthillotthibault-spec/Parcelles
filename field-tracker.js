// Suivi GPS continu du mode terrain : logique pure, sans DOM ni stockage.
// Détecte les entrées et sorties de parcelle, mesure le temps de présence et
// prépare des propositions de travaux. Rien n'est enregistré sans l'accord de l'utilisateur.
import {campaignFor, haversineMeters, normalize, pointInGeometry} from './utils.js';
import {agendaDate, isPending, localDay} from './home-priorities.js';

export const TRACKING_LIMITS=Object.freeze({
  maxAccuracy:50,        // m : au-delà, la position est ignorée pour la détection
  minSamples:3,          // positions valides minimales pour proposer une présence
  minDurationMs:5*60000, // présence minimale proposée : 5 min
  gapMs:2*60000,         // trou de plus de 2 min (écran verrouillé…) : la présence est close à la dernière position
  confirmSamples:2,      // positions consécutives nécessaires pour changer de parcelle (évite les sauts en bordure)
  idleMs:30*60000,       // arrêt conseillé après 30 min sans mouvement
  idleRadiusM:30         // rayon en deçà duquel on considère qu'il n'y a pas de mouvement
});

const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));

export function gpsQuality(accuracy){
  if(!finite(accuracy))return{level:'none',label:'Signal GPS en attente',accuracy:null};
  const value=Math.round(Number(accuracy));
  if(value<=10)return{level:'good',label:'GPS précis',accuracy:value};
  if(value<=30)return{level:'fair',label:'GPS correct',accuracy:value};
  return{level:'poor',label:value>TRACKING_LIMITS.maxAccuracy?'GPS trop imprécis':'GPS faible',accuracy:value};
}

// Parcelle contenant la position. Deux parcelles superposées rendent la position ambiguë.
export function parcelAtPosition(position,parcels=[]){
  if(!finite(position?.latitude)||!finite(position?.longitude))return{parcel:null,ambiguous:false};
  const lon=Number(position.longitude),lat=Number(position.latitude);
  const matches=parcels.filter(p=>p&&!p.deletedAt&&p.geometry&&pointInGeometry(lon,lat,p.geometry));
  return{parcel:matches.length===1?matches[0]:null,ambiguous:matches.length>1};
}

export function formatPresence(ms){
  const minutes=Math.max(0,Math.round(Number(ms||0)/60000));
  if(minutes<60)return `${minutes} min`;
  const h=Math.floor(minutes/60),m=minutes%60;
  return m?`${h} h ${String(m).padStart(2,'0')}`:`${h} h`;
}

export function clockTime(timestamp){
  const d=new Date(Number(timestamp));
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export class FieldTracker{
  constructor(limits={}){this.limits={...TRACKING_LIMITS,...limits};this.reset();}
  reset(){this.current=null;this.pending=null;this.lastAt=null;this.anchor=null;this.lastAccuracy=null;}
  // Renvoie la liste des évènements produits par cette position : enter, exit, idle.
  sample(position,parcels=[],now=Date.now()){
    const events=[],L=this.limits;
    this.lastAccuracy=finite(position?.accuracy)?Number(position.accuracy):null;
    if(!finite(position?.latitude)||!finite(position?.longitude))return{events,ignored:'position'};
    if(this.lastAccuracy===null||this.lastAccuracy>L.maxAccuracy)return{events,ignored:'accuracy'};
    if(this.lastAt!==null&&now-this.lastAt>L.gapMs){
      const closed=this.closeVisit();if(closed)events.push(closed);
      this.pending=null;this.anchor=null;
    }
    this.lastAt=now;
    const point={latitude:Number(position.latitude),longitude:Number(position.longitude)};
    if(!this.anchor||haversineMeters(this.anchor,point)>L.idleRadiusM)this.anchor={...point,at:now,notified:false};
    else if(!this.anchor.notified&&now-this.anchor.at>=L.idleMs){this.anchor.notified=true;events.push({type:'idle',since:this.anchor.at,at:now});}
    const {parcel,ambiguous}=parcelAtPosition(point,parcels);
    if(ambiguous){if(this.current)this.current.last=now;return{events,ambiguous:true};}
    const id=parcel?.id||null;
    if(id===(this.current?.parcelId||null)){
      this.pending=null;
      if(this.current){this.current.last=now;this.current.samples++;}
      return{events};
    }
    // Changement candidat : il doit être confirmé par plusieurs positions consécutives.
    if(!this.pending||this.pending.parcelId!==id)this.pending={parcelId:id,first:now,count:0};
    this.pending.count++;
    if(this.current&&this.pending.count<L.confirmSamples)return{events};
    const next=this.pending;this.pending=null;
    const closed=this.closeVisit();if(closed)events.push(closed);
    if(next.parcelId){this.current={parcelId:next.parcelId,start:next.first,last:now,samples:next.count};events.push({type:'enter',parcelId:next.parcelId,at:next.first});}
    return{events};
  }
  closeVisit(){
    const visit=this.current;this.current=null;if(!visit)return null;
    const durationMs=Math.max(0,visit.last-visit.start);
    return{type:'exit',visit:{parcelId:visit.parcelId,start:visit.start,end:visit.last,samples:visit.samples,durationMs},eligible:visit.samples>=this.limits.minSamples&&durationMs>=this.limits.minDurationMs};
  }
  // Arrêt du suivi : clôt la présence en cours.
  finish(){this.pending=null;const closed=this.closeVisit();this.lastAt=null;this.anchor=null;return closed;}
}

export function visitToProposal(visit){
  return{id:`gps_${visit.parcelId}_${visit.start}`,parcelId:visit.parcelId,start:visit.start,end:visit.end,samples:visit.samples,durationMs:visit.durationMs};
}

const done=w=>!w.deletedAt&&!isPending(w)&&!['Annulé','Annulée'].includes(w.status);

// Chantier multi-parcelles (hors travaux publics) non terminé qui contient cette parcelle, encore à faire.
export function chantierForParcel(data,parcelId){
  if(!parcelId)return null;
  const works=(data.interventions||[]).filter(w=>!w.deletedAt);
  const rows=(data.chantiers||[]).filter(c=>!c.deletedAt&&c.kind!=='tp'&&!['Terminé','Annulé'].includes(c.status)&&(c.parcelIds||[]).includes(parcelId))
    .map(chantier=>{
      const doneIds=new Set(works.filter(w=>w.chantierId===chantier.id&&w.status==='Terminé').map(w=>w.parcelId));
      const ids=[...new Set(chantier.parcelIds||[])];
      return{chantier,done:ids.filter(id=>doneIds.has(id)).length,total:ids.length,parcelDone:doneIds.has(parcelId)};
    }).filter(row=>!row.parcelDone)
    .sort((a,b)=>(a.chantier.status==='En cours'?0:1)-(b.chantier.status==='En cours'?0:1)||String(a.chantier.plannedDate||'').localeCompare(String(b.chantier.plannedDate||'')));
  return rows[0]||null;
}

// Types de travaux proposés pour une présence, du plus probable au moins probable, avec la raison.
export function suggestWorkTypes(data,parcelId,{today=localDay(),limit=4,nowMs=Date.now()}={}){
  const works=(data.interventions||[]).filter(w=>!w.deletedAt&&w.type);
  const out=[],seen=new Set();
  const add=(type,reason,extra={})=>{const key=normalize(type);if(!key||seen.has(key))return;seen.add(key);out.push({type:String(type).trim(),reason,...extra});};
  works.filter(w=>w.parcelId===parcelId&&isPending(w)&&(w.status==='En cours'||(agendaDate(w)&&agendaDate(w)<=today)))
    .sort((a,b)=>(a.status==='En cours'?0:1)-(b.status==='En cours'?0:1)||agendaDate(b).localeCompare(agendaDate(a)))
    .forEach(w=>add(w.type,w.status==='En cours'?'Travail en cours sur cette parcelle':agendaDate(w)===today?'Prévu aujourd’hui sur cette parcelle':'En retard sur cette parcelle',{workId:w.id}));
  const site=chantierForParcel(data,parcelId);if(site?.chantier.type)add(site.chantier.type,'Chantier en cours',{chantierId:site.chantier.id});
  const since=localDay(new Date(nowMs-14*864e5)),counts=new Map();
  works.filter(w=>done(w)&&String(w.date||'').slice(0,10)>=since).forEach(w=>{const k=normalize(w.type);const row=counts.get(k)||{type:w.type,n:0};row.n++;counts.set(k,row);});
  [...counts.values()].sort((a,b)=>b.n-a.n).forEach(row=>add(row.type,'Fait récemment sur l’exploitation'));
  const last=works.filter(w=>done(w)&&w.parcelId===parcelId).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
  if(last)add(last.type,'Dernier travail sur cette parcelle');
  return out.slice(0,limit);
}

// Engin et opérateur du dernier travail terminé du même type.
export function defaultsForType(data,type){
  const key=normalize(type);
  const last=(data.interventions||[]).filter(w=>done(w)&&normalize(w.type)===key).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||(b.updatedAt||0)-(a.updatedAt||0))[0];
  const machines=new Set((data.materiels||[]).filter(m=>!m.deletedAt).map(m=>m.id));
  return{equipmentId:last?.equipmentId&&machines.has(last.equipmentId)?last.equipmentId:'',operator:last?.operator||data.preferences?.defaultOperator||''};
}

export function presenceNote(proposal){
  return `Temps de présence mesuré par le suivi GPS : ${formatPresence(proposal.durationMs)} (${clockTime(proposal.start)}–${clockTime(proposal.end)}).`;
}

// Travail terminé construit à partir d'une présence GPS confirmée par l'utilisateur.
export function workFromProposal(proposal,parcel,type,defaults={},extra={}){
  if(!proposal?.parcelId||!type)throw new Error('Présence ou type de travail manquant.');
  const date=localDay(new Date(proposal.start));
  return{
    parcelId:proposal.parcelId,type:String(type).trim(),status:'Terminé',date,campaignId:campaignFor(date),
    startTime:clockTime(proposal.start),endTime:clockTime(proposal.end),
    duration:Math.round(proposal.durationMs/36000)/100,
    surfaceWorked:finite(parcel?.surfaceHa)?Number(parcel.surfaceHa):null,
    equipmentId:defaults.equipmentId||'',operator:defaults.operator||'',
    note:presenceNote(proposal),
    gpsPresence:{start:proposal.start,end:proposal.end,samples:proposal.samples},
    ...extra
  };
}

export const FINISH_KEYS=['status','date','plannedDate','startTime','endTime','duration','surfaceWorked','note','gpsPresence'];

// Clôture d'un travail prévu à partir d'une présence : l'échéance reste dans plannedDate.
export function finishPlannedFromProposal(work,proposal,parcel){
  const date=localDay(new Date(proposal.start));
  const note=[work.note,presenceNote(proposal)].filter(Boolean).join('\n');
  return{...work,status:'Terminé',date,plannedDate:work.plannedDate||work.date||date,startTime:clockTime(proposal.start),endTime:clockTime(proposal.end),
    duration:Math.round(proposal.durationMs/36000)/100,surfaceWorked:finite(work.surfaceWorked)?Number(work.surfaceWorked):finite(parcel?.surfaceHa)?Number(parcel.surfaceHa):null,
    note,gpsPresence:{start:proposal.start,end:proposal.end,samples:proposal.samples}};
}
