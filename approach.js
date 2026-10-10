// n° 46 : guidage jusqu'à la parcelle et « Où suis-je ? » (logique pure).
import {haversineMeters,geometryCentroid} from './utils.js';
import {currentParcelAt,parcelRoutePoint} from './field-ops.js';
import {summarizeParcelGrazing} from './grazing.js';

export const APPROACH_MAX_M=2000;
const rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI;

// Cap initial (degrés, 0 = nord, sens horaire) de a vers b.
export function bearingDeg(a,b){
  const φ1=rad(a.latitude),φ2=rad(b.latitude),Δλ=rad(b.longitude-a.longitude);
  const y=Math.sin(Δλ)*Math.cos(φ2),x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return(deg(Math.atan2(y,x))+360)%360;
}

// Rotation de la flèche à l'écran : cap de la cible moins l'orientation de l'appareil.
export function arrowRotation(bearing,heading){return Number.isFinite(heading)?((bearing-heading)%360+360)%360:bearing;}

const POINTS=['nord','nord-est','est','sud-est','sud','sud-ouest','ouest','nord-ouest'];
export function compassLabel(degrees){return POINTS[Math.round((((degrees%360)+360)%360)/45)%8];}

export function formatDistance(m){
  if(!Number.isFinite(m))return'';
  if(m<1000)return`${Math.round(m/5)*5} m`;
  return`${(Math.round(m/100)/10).toFixed(1).replace('.',',')} km`;
}

// Cap fourni par l'événement d'orientation (iOS : webkitCompassHeading ; sinon alpha absolu).
export function headingFromOrientation(event){
  if(Number.isFinite(event?.webkitCompassHeading))return event.webkitCompassHeading;
  if(event?.absolute&&Number.isFinite(event.alpha))return(360-event.alpha)%360;
  return null;
}
// Cap GPS exploitable seulement en mouvement.
export function headingFromGps(coords){return Number.isFinite(coords?.heading)&&Number(coords?.speed)>0.8?coords.heading:null;}

// Données de la boussole d'approche.
export function approachInfo(position,parcel,points=[]){
  const target=parcelRoutePoint(parcel,points);
  if(!target||!Number.isFinite(Number(position?.latitude)))return null;
  const distanceM=haversineMeters(position,target),bearing=bearingDeg(position,target);
  const center=geometryCentroid(parcel.geometry);
  const isEntry=target.source==='Entrée de champ';
  const entrySide=isEntry&&center&&haversineMeters(center,target)>5?`Entrée côté ${compassLabel(bearingDeg(center,target))}`:isEntry?'Entrée de champ':'Pas d’entrée enregistrée : direction du centre';
  return{target,distanceM,bearing,entrySide,isEntry,near:distanceM<=APPROACH_MAX_M,arrived:distanceM<=25};
}

// Pastille « Vous êtes dans : … ».
export function whereAmI(position,data,{now=new Date()}={}){
  const parcels=(data?.parcelles||[]).filter(p=>!p.archived);
  const parcel=currentParcelAt(position,parcels);
  if(!parcel)return null;
  const parts=[parcel.nom,parcel.culture].filter(Boolean);
  const grazing=summarizeParcelGrazing(data.grazingSessions||[],parcel.id,{date:now});
  if(grazing.total>0){
    const start=grazing.groups.map(g=>g.startDate).filter(Boolean).sort()[0];
    const days=start?Math.max(0,Math.floor((new Date(now.toDateString())-new Date(new Date(start).toDateString()))/864e5)):null;
    const type=(grazing.types[0]||'animaux').toLowerCase();
    parts.push(`${grazing.total} ${type}${days!==null?` depuis ${days} j`:''}`);
  }
  return{parcel,text:`Vous êtes dans : ${parts.join(' · ')}`};
}

// Point d'entrée à enregistrer : met à jour la première entrée existante ou en crée une.
export function entryPointFor(parcel,points,position){
  const existing=(points||[]).find(pt=>!pt.deletedAt&&pt.parcelId===parcel.id&&String(pt.type||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().includes('entree'));
  const accuracy=Number(position.accuracy)||null;
  const base={latitude:Number(position.latitude),longitude:Number(position.longitude),accuracy,note:accuracy>30?'Position GPS à contrôler : précision supérieure à 30 m.':''};
  return existing?{...existing,...base}:{nom:`Entrée · ${parcel.nom}`,type:'Entrée de champ',parcelId:parcel.id,source:'local',...base};
}
