// n° 70 — Haies et infrastructures agroécologiques (IAE) : inventaire linéaire et ponctuel,
// linéaire et surface pondérée, part de la SAU en IAE et période d'interdiction de taille (BCAE 8).
// Logique pure. Les objets sont des enregistrements d'exploitation (integrationImports, farmKind
// « agroInfra ») avec une géométrie GeoJSON (LineString, Point ou Polygon) : les tableaux imbriqués
// passent par encodeCloudPayload à la synchronisation. Dates et coefficients : indicatifs, datés,
// modifiables dans les préférences (agroInfraRules).
import {normalize,haversineMeters,geometryAreaHa} from './utils.js';
import {farmRecords} from './farm-records.js';
import {active} from './farm-memory.js';

export const INFRA_KIND='agroInfra';
export const INFRA_TYPES=Object.freeze([
  {key:'haie',label:'Haie',shape:'line',color:'#2f6b2f',coef:20,unit:'m²/m'},
  {key:'alignement',label:'Alignement d’arbres',shape:'line',color:'#6f9a3a',coef:12,unit:'m²/m'},
  {key:'bande',label:'Bande tampon ou enherbée',shape:'line',color:'#a7c35a',coef:1.5,unit:'m²/m²'},
  {key:'bosquet',label:'Bosquet',shape:'area',color:'#466d3a',coef:1.5,unit:'m²/m²'},
  {key:'mare',label:'Mare',shape:'area-or-point',color:'#3f7cab',coef:1.5,unit:'m²/m²'},
  {key:'arbre',label:'Arbre isolé',shape:'point',color:'#4f7d2f',coef:20,unit:'m²/arbre'}
]);
export const INFRA_RULES=Object.freeze({
  date:'2026-10-01',
  // BCAE 8 : interdiction de tailler les haies et les arbres pendant la période de reproduction et de
  // nidification des oiseaux. Des dérogations départementales existent : dates à paramétrer.
  banStart:'03-16',banEnd:'08-15',
  source:'PAC 2023-2027 : BCAE 8 (taille des haies interdite du 16 mars au 15 août) et coefficients de pondération des éléments topographiques. Valeurs indicatives, à vérifier sur Telepac et auprès de la DDT(M).'
});
export const infraType=key=>INFRA_TYPES.find(t=>t.key===key)||null;

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r1=v=>Math.round(v*10)/10,r2=v=>Math.round(v*100)/100;
const MMDD=/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Règles effectives : valeurs de référence remplacées par celles saisies (dates, coefficients). */
export function infraRules(state){
  const c=state?.preferences?.agroInfraRules||{},coefs=c.coefficients||{};
  return{...INFRA_RULES,banStart:MMDD.test(c.banStart||'')?c.banStart:INFRA_RULES.banStart,banEnd:MMDD.test(c.banEnd||'')?c.banEnd:INFRA_RULES.banEnd,
    custom:Boolean(c.banStart||c.banEnd||Object.keys(coefs).length),note:String(c.note||''),
    types:INFRA_TYPES.map(t=>{const v=num(coefs[t.key]);return{...t,coef:v!==null&&v>=0&&v<=100?v:t.coef,reference:t.coef};})};
}
export function validateRules(v){
  if(!MMDD.test(v.banStart||'')||!MMDD.test(v.banEnd||''))return{error:'Dates au format MM-JJ (ex. 03-16).'};
  const coefficients={};for(const t of INFRA_TYPES){const n=num(v[`coef_${t.key}`]);if(n===null)continue;if(n<0||n>100)return{error:'Coefficients entre 0 et 100.'};if(n!==t.coef)coefficients[t.key]=n;}
  return{value:{banStart:v.banStart,banEnd:v.banEnd,coefficients,note:String(v.note||'').trim().slice(0,200)}};
}

export function lineLengthM(coords=[]){let m=0;for(let i=1;i<coords.length;i++)m+=haversineMeters({longitude:coords[i-1][0],latitude:coords[i-1][1]},{longitude:coords[i][0],latitude:coords[i][1]});return Math.round(m);}

/** Géométrie GeoJSON depuis des points saisis ({latitude, longitude}) selon la forme attendue. */
export function geometryFromPoints(points,shape){
  const c=(points||[]).map(p=>[Math.round(Number(p.longitude)*1e7)/1e7,Math.round(Number(p.latitude)*1e7)/1e7]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
  if(shape==='point'){if(!c.length)throw Error('Position manquante.');return{type:'Point',coordinates:c[0]};}
  if(shape==='area'){if(c.length<3)throw Error('Ajoutez au moins trois points.');return{type:'Polygon',coordinates:[[...c,c[0]]]};}
  if(c.length<2)throw Error('Ajoutez au moins deux points.');return{type:'LineString',coordinates:c};
}

/** Mesures d'un objet : linéaire (m), surface (m²) et surface pondérée IAE (m²). */
export function measure(item,rules=infraRules(null)){
  const t=rules.types.find(x=>x.key===item?.type)||null,g=item?.geometry;if(!t||!g)return{length:0,area:0,weighted:0};
  const length=g.type==='LineString'?lineLengthM(g.coordinates):0,width=num(item.widthM);
  let area=g.type==='Polygon'?Math.round(geometryAreaHa(g)*10000):g.type==='LineString'&&width?Math.round(length*width):0;
  if(g.type==='Point'&&num(item.areaM2))area=num(item.areaM2);
  const weighted=t.key==='haie'||t.key==='alignement'?length*t.coef:t.key==='arbre'?(g.type==='Point'?1:0)*t.coef:area*t.coef;
  return{length,area,weighted:Math.round(weighted)};
}

export function validateInfra(v){
  const t=infraType(v.type);if(!t)return{error:'Choisissez le type d’infrastructure.'};
  const g=v.geometry;if(!g||!['LineString','Point','Polygon'].includes(g.type))return{error:'Tracez l’objet sur la carte ou utilisez votre position.'};
  if(t.shape==='line'&&g.type!=='LineString')return{error:`${t.label} : tracez une ligne.`};
  if(t.shape==='point'&&g.type!=='Point')return{error:`${t.label} : placez un point.`};
  if(t.shape==='area'&&g.type!=='Polygon')return{error:`${t.label} : tracez un contour.`};
  const width=num(v.widthM);if(width!==null&&(width<0||width>100))return{error:'Largeur entre 0 et 100 m.'};
  const areaM2=num(v.areaM2);if(areaM2!==null&&areaM2<0)return{error:'Surface invalide.'};
  if(v.lastMaintenance&&!/^\d{4}-\d{2}-\d{2}$/.test(v.lastMaintenance))return{error:'Date d’entretien invalide.'};
  return{value:{type:t.key,geometry:g,label:String(v.label||'').trim().slice(0,80),parcelId:v.parcelId||null,widthM:width,areaM2,species:String(v.species||'').trim().slice(0,160),
    sustainable:v.sustainable===true||v.sustainable==='on',lastMaintenance:v.lastMaintenance||'',note:String(v.note||'').trim().slice(0,300)}};
}

export const infraItems=state=>farmRecords(state,INFRA_KIND).filter(r=>r.geometry).sort((a,b)=>String(a.type).localeCompare(String(b.type))||(a.createdAt||0)-(b.createdAt||0));

/** Compteur de l'exploitation : linéaire de haies, surface pondérée et part de la SAU en IAE. */
export function infraSummary(state){
  const rules=infraRules(state),items=infraItems(state).map(i=>({item:i,m:measure(i,rules)}));
  const sau=active(state,'parcelles').filter(p=>!p.archived).reduce((s,p)=>s+(num(p.surfaceHa)||0),0);
  const byType=rules.types.map(t=>{const rows=items.filter(x=>x.item.type===t.key);return{type:t,count:rows.length,length:rows.reduce((s,x)=>s+x.m.length,0),area:rows.reduce((s,x)=>s+x.m.area,0),weighted:rows.reduce((s,x)=>s+x.m.weighted,0)};});
  const hedgeM=byType.filter(x=>x.type.key==='haie'||x.type.key==='alignement').reduce((s,x)=>s+x.length,0),weighted=byType.reduce((s,x)=>s+x.weighted,0);
  return{rules,items,byType,hedgeKm:r2(hedgeM/1000),weightedHa:r2(weighted/10000),sauHa:r2(sau),iaePct:sau>0?r1(weighted/10000/sau*100):null,sustainable:items.filter(x=>x.item.sustainable).length};
}

// ---------- Période d'interdiction de taille ----------
const TRIM=/\b(taille|tailler|elagage|elaguer|lamier|epareuse|broyage|broyer|entretien|recepage|coupe)\b/;
const TARGET=/\b(haies?|arbres?|lamier|epareuse|alignement|bosquet|ripisylve)\b/;
export const isHedgeTrimWork=work=>{const t=normalize(`${work?.type||''} ${work?.product||''}`);return TRIM.test(t)&&TARGET.test(t);};
/** La date tombe-t-elle dans la période d'interdiction (bornes incluses, période sur une même année) ? */
export function inBanPeriod(date,rules=INFRA_RULES){
  const md=String(date||'').slice(5,10);if(!MMDD.test(md))return false;
  return rules.banStart<=rules.banEnd?md>=rules.banStart&&md<=rules.banEnd:md>=rules.banStart||md<=rules.banEnd;
}
const fr=md=>{const [m,d]=md.split('-');return`${Number(d)}/${m}`;};
/** Contrôle d'un travail : message bloquant si taille de haie pendant la période d'interdiction. */
export function trimCheck(work,state){
  if(!isHedgeTrimWork(work)||work?.status==='Annulé')return{blocked:false};
  const rules=infraRules(state),date=work.status&&work.status!=='Terminé'?(work.plannedDate||work.date):work.date;
  if(!inBanPeriod(date,rules))return{blocked:false};
  return{blocked:!work.hedgeDerogation,rules,message:`Taille des haies et des arbres interdite du ${fr(rules.banStart)} au ${fr(rules.banEnd)} (BCAE 8, période de nidification). Reportez le travail après le ${fr(rules.banEnd)}, ou cochez la dérogation si votre département l’autorise ou s’il s’agit d’un cas prévu (sécurité, chantier déclaré). Information indicative, à vérifier auprès de la DDT(M).`};
}

export const INFRA_HEADERS=['Type','Nom','Parcelle','Linéaire (m)','Surface (m²)','Coefficient','Surface pondérée (m²)','Gestion durable','Dernier entretien','Essences'];
export function infraCsv(state){
  const s=infraSummary(state),parcels=new Map(active(state,'parcelles').map(p=>[p.id,p.nom]));
  const cell=x=>{const v=typeof x==='number'?String(x).replace('.',','):String(x??'');return/[;"\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v;};
  return'﻿'+[INFRA_HEADERS,...s.items.map(({item:i,m})=>{const t=s.rules.types.find(x=>x.key===i.type);return[t?.label||i.type,i.label||'',parcels.get(i.parcelId)||'',m.length||'',m.area||'',t?.coef??'',m.weighted,i.sustainable?'oui':'',i.lastMaintenance||'',i.species||''];})].map(r=>r.map(cell).join(';')).join('\r\n');
}
export function infraGeoJson(state){
  return{type:'FeatureCollection',features:infraItems(state).map(i=>({type:'Feature',geometry:i.geometry,properties:{type:i.type,nom:i.label||'',parcelId:i.parcelId||null,gestionDurable:Boolean(i.sustainable)}}))};
}
