// n° 50 : mesurer en marchant (logique pure).
// Un point GPS est retenu tous les 3 m quand la précision vaut 8 m ou moins.
import {haversineMeters,geometryAreaHa,geometryCentroid} from './utils.js';
import {ringPerimeterM,ringError,closeRing} from './geometry-ops.js';

export const WALK_MIN_STEP_M=3;
export const WALK_MAX_ACCURACY_M=8;

// fix : {latitude, longitude, accuracy}. Retour {accept, reason}.
export function acceptFix(points,fix,{minStep=WALK_MIN_STEP_M,maxAccuracy=WALK_MAX_ACCURACY_M}={}){
  const lat=Number(fix?.latitude),lon=Number(fix?.longitude),acc=Number(fix?.accuracy);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return{accept:false,reason:'invalid'};
  if(!Number.isFinite(acc)||acc>maxAccuracy)return{accept:false,reason:'accuracy'};
  const last=points[points.length-1];
  if(last&&haversineMeters(last,{latitude:lat,longitude:lon})<minStep)return{accept:false,reason:'step'};
  return{accept:true,reason:null};
}

const ringOf=points=>points.map(p=>[Number(p.longitude),Number(p.latitude)]);

// Périmètre (fermé à partir de 3 points), surface et marge d'erreur estimée.
export function walkStats(points){
  const n=points.length,ring=ringOf(points);
  const perimeterM=n>=2?ringPerimeterM(ring,{closed:n>=3}):0;
  const areaHa=n>=3?geometryAreaHa({type:'Polygon',coordinates:[closeRing(ring)]}):0;
  const accs=points.map(p=>Number(p.accuracy)).filter(Number.isFinite);
  const meanAccuracy=accs.length?accs.reduce((s,a)=>s+a,0)/accs.length:null;
  // Marge : bande de largeur « précision moyenne » le long du périmètre.
  const marginHa=n>=3&&meanAccuracy!==null?perimeterM*meanAccuracy/10000:null;
  return{count:n,perimeterM,areaHa,meanAccuracy,marginHa};
}

// Niveau d'alerte sur la précision courante.
export function accuracyLevel(accuracy,{maxAccuracy=WALK_MAX_ACCURACY_M}={}){
  const a=Number(accuracy);
  if(!Number.isFinite(a))return{level:'none',label:'En attente du GPS…'};
  if(a<=maxAccuracy)return{level:'ok',label:`Précision ± ${Math.round(a)} m`};
  if(a<=maxAccuracy*2)return{level:'warn',label:`Précision dégradée (± ${Math.round(a)} m) : points en pause`};
  return{level:'bad',label:`Précision insuffisante (± ${Math.round(a)} m) : restez à découvert`};
}

export function formatMeters(m){
  const v=Number(m)||0;
  return v<1000?`${Math.round(v)} m`:`${(Math.round(v/10)/100).toFixed(2).replace('.',',')} km`;
}
const ha=v=>(Math.round(v*100)/100).toFixed(2).replace('.',',');
export function walkSummary(stats){
  if(stats.count<2)return`${stats.count} point${stats.count>1?'s':''} · marchez le long de la limite`;
  const parts=[`${stats.count} points`,`périmètre ${formatMeters(stats.perimeterM)}`];
  if(stats.count>=3)parts.push(`${ha(stats.areaHa)} ha${stats.marginHa!==null?` ± ${ha(stats.marginHa)} ha`:''}`);
  return parts.join(' · ');
}

// Polygone final, refusé proprement s'il se croise.
export function walkGeometry(points){
  if(points.length<3)return{error:'Marchez au moins jusqu’à trois points pour fermer une surface.'};
  const ring=ringOf(points),error=ringError(ring);
  if(error)return{error};
  return{geometry:{type:'Polygon',coordinates:[closeRing(ring)]}};
}

// Parcelles proches du tracé, de la plus proche à la plus lointaine (choix « Remplacer le contour de… »).
export function nearestParcels(geometry,parcels,limit=8){
  const c=geometryCentroid(geometry);if(!c)return[];
  return(parcels||[]).filter(p=>p&&!p.deletedAt&&p.geometry).map(p=>({parcel:p,distance:haversineMeters(c,geometryCentroid(p.geometry))})).sort((a,b)=>a.distance-b.distance).slice(0,limit);
}

// Périmètre d'une mesure de surface tapée sur la carte ({latitude, longitude}).
export function measurePerimeterM(points){return points.length>=2?ringPerimeterM(ringOf(points),{closed:points.length>=3}):0;}
