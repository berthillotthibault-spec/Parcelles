// n° 68 — Analyses de sol, grille d'échantillonnage et plan de chaulage.
// Logique pure. Les analyses (kind « soilAnalysis ») et les grilles d'échantillonnage (kind
// « soilGrid ») sont des enregistrements d'exploitation : pas de nouvelle collection. Les seuils et
// besoins de chaulage sont des ordres de grandeur datés, présentés comme indicatifs : la décision
// reste celle de l'exploitant et de son conseiller.
import {geometryAreaHa,geometryBbox,pointInGeometry,haversineMeters} from './utils.js';
import {farmRecords} from './farm-records.js';
import {active} from './farm-memory.js';

export const SOIL_KIND='soilAnalysis',GRID_KIND='soilGrid';
export const SOIL_REFERENCES=Object.freeze({
  date:'2026-10-01',
  source:'Ordres de grandeur usuels (COMIFER, chambres d’agriculture) pour remonter le pH eau sur 0-25 cm. Indicatif : à valider avec votre conseiller et l’interprétation du laboratoire.',
  maxAgeYears:5,
  maxPerYear:2, // t CaO/ha par apport, au-delà on fractionne sur plusieurs années
  textures:Object.freeze([
    {key:'sableux',label:'Sableux, sablo-limoneux',target:6.0,tPerUnit:1.5},
    {key:'limoneux',label:'Limoneux',target:6.5,tPerUnit:2.5},
    {key:'argileux',label:'Argileux, argilo-limoneux',target:6.8,tPerUnit:3.5},
    {key:'calcaire',label:'Calcaire (pas de chaulage)',target:null,tPerUnit:0}
  ]),
  // Valeur neutralisante usuelle des amendements (équivalent CaO, %).
  products:Object.freeze([
    {key:'carbonate',label:'Carbonate de calcium (calcaire broyé)',vn:50},
    {key:'chaux-vive',label:'Chaux vive',vn:85},
    {key:'chaux-magnesienne',label:'Chaux magnésienne',vn:90},
    {key:'ecume',label:'Écumes de sucrerie',vn:25}
  ])
});
export const SOIL_FIELDS=[['ph','pH eau',3,10],['p2o5','P₂O₅ (mg/kg)',0,2000],['k2o','K₂O (mg/kg)',0,3000],['mgo','MgO (mg/kg)',0,2000],['om','Matière organique (%)',0,30],['cec','CEC (méq/100 g)',0,60]];
export const textureOf=key=>SOIL_REFERENCES.textures.find(t=>t.key===key)||null;
export const productOf=key=>SOIL_REFERENCES.products.find(p=>p.key===key)||SOIL_REFERENCES.products[0];

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r1=v=>Math.round(v*10)/10,r2=v=>Math.round(v*100)/100;
const isDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const byDate=(a,b)=>String(a.date).localeCompare(String(b.date))||(a.createdAt||0)-(b.createdAt||0);

export function validateAnalysis(v){
  if(!v.parcelId)return{error:'Choisissez la parcelle.'};
  if(!isDay(v.date))return{error:'Date de prélèvement invalide.'};
  const out={parcelId:v.parcelId,date:v.date,lab:String(v.lab||'').trim().slice(0,120),zone:String(v.zone||'').trim().slice(0,80),texture:textureOf(v.texture)?v.texture:'',
    method:String(v.method||'').trim().slice(0,40),note:String(v.note||'').trim().slice(0,300),documentId:v.documentId||null,targetPh:num(v.targetPh),latitude:num(v.latitude),longitude:num(v.longitude)};
  for(const [key,label,min,max] of SOIL_FIELDS){const n=num(v[key]);if(n!==null&&(n<min||n>max))return{error:`${label} : valeur entre ${min} et ${max}.`};out[key]=n;}
  if(SOIL_FIELDS.every(([k])=>out[k]===null))return{error:'Saisissez au moins une valeur d’analyse.'};
  if(out.targetPh!==null&&(out.targetPh<5||out.targetPh>7.5))return{error:'pH cible entre 5 et 7,5.'};
  if((out.latitude===null)!==(out.longitude===null)||(out.latitude!==null&&(Math.abs(out.latitude)>90||Math.abs(out.longitude)>180)))return{error:'Position GPS incomplète ou invalide.'};
  return{value:out};
}

export const analyses=(state,parcelId=null)=>farmRecords(state,SOIL_KIND).filter(r=>!parcelId||r.parcelId===parcelId).sort(byDate);
export const latestAnalysis=(state,parcelId)=>analyses(state,parcelId).at(-1)||null;
export const ageYears=(date,today)=>r1((Date.parse(`${today}T12:00:00Z`)-Date.parse(`${date}T12:00:00Z`))/(365.25*864e5));

/** Besoin de chaulage indicatif : (pH cible − pH mesuré) × t CaO par unité de pH selon la texture. */
export function limingNeed(analysis,{product='carbonate',maxPerYear=SOIL_REFERENCES.maxPerYear}={}){
  const ph=num(analysis?.ph),t=textureOf(analysis?.texture);
  if(ph===null)return{status:'no-ph'};
  if(!t)return{status:'no-texture',ph};
  if(t.target===null)return{status:'calcareous',ph,texture:t};
  const target=num(analysis.targetPh)??t.target,gap=r2(target-ph);
  if(gap<=0.05)return{status:'ok',ph,target,texture:t,cao:0};
  const cao=r1(gap*t.tPerUnit),p=productOf(product),years=Math.max(1,Math.ceil(cao/maxPerYear-1e-9));
  return{status:'need',ph,target,gap,texture:t,cao,years,perYear:r1(cao/years),product:p,productTonnes:r1(cao/(p.vn/100)),productPerYear:r1(cao/years/(p.vn/100))};
}

const PH_CLASSES=[[5.5,'pH très acide (< 5,5)','#b5452b'],[6.2,'pH acide (5,5 à 6,2)','#d58932'],[7,'pH proche de la neutralité (6,2 à 7)','#5e9a4a'],[7.8,'pH neutre à basique (7 à 7,8)','#3f7cab'],[Infinity,'pH basique (> 7,8)','#6b4fa0']];
export function phClass(ph){const n=num(ph);if(n===null)return null;const c=PH_CLASSES.find(([max])=>n<max);return{label:c[1],color:c[2]};}

/** Couleur de parcelle pour la carte (mode « pH du sol »). */
export function soilColorInfo(state,parcel,{today=new Date().toISOString().slice(0,10)}={}){
  const a=analyses(state,parcel?.id).filter(r=>num(r.ph)!==null).at(-1);
  if(!a)return{label:'Pas d’analyse de pH',color:'#9aa29d'};
  const c=phClass(a.ph);
  return ageYears(a.date,today)>SOIL_REFERENCES.maxAgeYears?{label:'Analyse de plus de 5 ans',color:'#c9c2b4'}:c;
}

/** Parcelles sans analyse ou avec une analyse de plus de 5 ans. */
export function analysisAlerts(state,{today}){
  return active(state,'parcelles').filter(p=>!p.archived).map(p=>{const a=latestAnalysis(state,p.id);return{parcel:p,analysis:a,age:a?ageYears(a.date,today):null};})
    .filter(x=>!x.analysis||x.age>SOIL_REFERENCES.maxAgeYears).sort((a,b)=>(b.age??99)-(a.age??99)||String(a.parcel.nom).localeCompare(String(b.parcel.nom),'fr'));
}

/**
 * Grille d'échantillonnage : environ un point par « haPerPoint » hectares, au centre de mailles
 * carrées situées dans le contour, parcourues en zigzag (rangées alternées) pour limiter la marche.
 */
export function samplingGrid(geometry,{haPerPoint=1,maxPoints=200}={}){
  const area=geometryAreaHa(geometry),bbox=geometryBbox(geometry);if(!area||!bbox)return[];
  const target=Math.min(maxPoints,Math.max(1,Math.round(area/Math.max(0.1,haPerPoint))));
  const lat0=(bbox[1]+bbox[3])/2,mPerLat=111320,mPerLon=111320*Math.cos(lat0*Math.PI/180);
  const build=side=>{const dLat=side/mPerLat,dLon=side/mPerLon,rows=[];
    for(let i=0,y=bbox[3]-dLat/2;y>bbox[1]+dLat*0.25;i++,y-=dLat){const row=[];for(let x=bbox[0]+dLon/2;x<bbox[2]-dLon*0.25;x+=dLon)if(pointInGeometry(x,y,geometry))row.push({longitude:x,latitude:y});rows.push(i%2?row.reverse():row);}
    return rows.flat();};
  let side=Math.sqrt(area*10000/target),pts=build(side);
  // Contours irréguliers : on resserre la maille tant qu'il manque des points.
  for(let k=0;k<6&&pts.length<target*0.85;k++){side*=0.92;pts=build(side);}
  if(!pts.length){const c={longitude:(bbox[0]+bbox[2])/2,latitude:(bbox[1]+bbox[3])/2};pts=pointInGeometry(c.longitude,c.latitude,geometry)?[c]:[];}
  return pts.slice(0,maxPoints).map((p,i)=>({n:i+1,latitude:Math.round(p.latitude*1e7)/1e7,longitude:Math.round(p.longitude*1e7)/1e7}));
}
export const grids=(state,parcelId=null)=>farmRecords(state,GRID_KIND).filter(r=>!parcelId||r.parcelId===parcelId).sort(byDate);

const CARDINAL=['N','NE','E','SE','S','SO','O','NO'];
/** Guidage vers un point : distance (m), cap (degrés) et direction cardinale. */
export function guidance(from,to){
  if(!from||!to)return null;const rad=x=>x*Math.PI/180;
  const y=Math.sin(rad(to.longitude-from.longitude))*Math.cos(rad(to.latitude)),x=Math.cos(rad(from.latitude))*Math.sin(rad(to.latitude))-Math.sin(rad(from.latitude))*Math.cos(rad(to.latitude))*Math.cos(rad(to.longitude-from.longitude));
  const bearing=(Math.atan2(y,x)*180/Math.PI+360)%360;
  return{distance:Math.round(haversineMeters(from,to)),bearing:Math.round(bearing),cardinal:CARDINAL[Math.round(bearing/45)%8]};
}
export const nextPoint=grid=>(grid?.points||[]).find(p=>!p.sampledAt)||null;
