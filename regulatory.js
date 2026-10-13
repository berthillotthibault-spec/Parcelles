// n° 48 : couches réglementaires (cours d'eau BCAE, hydrographie, Natura 2000, zones vulnérables, pentes)
// et évaluation indicative d'une parcelle (distance au cours d'eau, ZNT, Natura 2000). Logique pure.
// Services publics sans clé : Géoplateforme IGN (WMTS, WMS vecteur, WFS) et Sandre (WMS zones vulnérables).
// L'application informe, elle ne certifie pas : la ZNT dépend du produit (AMM) et de l'arrêté départemental.
import {geometryBbox, geometryCentroid, pointInGeometry} from './utils.js';

export const GEOPF_WMTS='https://data.geopf.fr/wmts';
export const GEOPF_WMS_V='https://data.geopf.fr/wms-v/ows';
export const GEOPF_WFS='https://data.geopf.fr/wfs/ows';
export const SANDRE_WMS='https://services.sandre.eaufrance.fr/geo/zon_FXX';
const IGN='© IGN – Géoplateforme';

function wmts(layer,{style='normal',matrixSet='PM'}={}){
  const params=new URLSearchParams({SERVICE:'WMTS',REQUEST:'GetTile',VERSION:'1.0.0',LAYER:layer,STYLE:style,FORMAT:'image/png',TILEMATRIXSET:matrixSet});
  return`${GEOPF_WMTS}?${params.toString()}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}
// Couches vérifiées dans les GetCapabilities publics (octobre 2026). « date » = édition affichée à l'utilisateur.
export const REG_LAYERS=Object.freeze([
  {id:'bcae',label:'Cours d’eau BCAE',hint:'Bandes tampons obligatoires (BCAE 4)',kind:'wmts',url:wmts('HYDROGRAPHY.BCAE.LATEST',{matrixSet:'PM_6_17'}),minZoom:6,maxNativeZoom:17,attribution:`${IGN} (BCAE, dernière édition)`,source:'IGN / MASA, carte BCAE en vigueur',date:'édition 2026'},
  {id:'hydro',label:'Hydrographie BD TOPO',hint:'Réseau hydrographique détaillé',kind:'wmts',url:wmts('HYDROGRAPHY.HYDROGRAPHY',{matrixSet:'PM_6_18'}),minZoom:6,maxNativeZoom:18,attribution:`${IGN} (BD TOPO)`,source:'IGN, BD TOPO',date:'mise à jour continue'},
  {id:'natura-sic',label:'Natura 2000 – habitats (SIC/ZSC)',hint:'Directive Habitats',kind:'wms',url:GEOPF_WMS_V,layers:'Patrinat_SIC_France',attribution:`${IGN} · PatriNat (OFB-MNHN)`,source:'PatriNat (OFB-MNHN) via Géoplateforme',date:'dernière diffusion'},
  {id:'natura-zps',label:'Natura 2000 – oiseaux (ZPS)',hint:'Directive Oiseaux',kind:'wms',url:GEOPF_WMS_V,layers:'Patrinat_ZPS_France',attribution:`${IGN} · PatriNat (OFB-MNHN)`,source:'PatriNat (OFB-MNHN) via Géoplateforme',date:'dernière diffusion'},
  {id:'zv',label:'Zones vulnérables nitrates',hint:'Dernière désignation (Sandre, service parfois lent)',kind:'wms',url:SANDRE_WMS,layers:'ZoneVuln',attribution:'Sandre – OFB',source:'Sandre (OFB), zonages réglementaires',date:'dernière désignation'},
  {id:'pentes',label:'Pentes agricoles',hint:'Zones de pente > 10 % (RGE ALTI)',kind:'wmts',url:wmts('GEOGRAPHICALGRIDSYSTEMS.SLOPES.PAC',{style:'GEOGRAPHICALGRIDSYSTEMS.SLOPES.PAC',matrixSet:'PM_0_15'}),minZoom:0,maxNativeZoom:15,attribution:`${IGN} (RGE ALTI 2017)`,source:'IGN, carte des pentes pour l’agriculture',date:'2017'}
]);
export const REG_LAYER_IDS=REG_LAYERS.map(layer=>layer.id);
export function normalizeRegLayers(value){return Array.isArray(value)?REG_LAYER_IDS.filter(id=>value.includes(id)):[];}

// Valeurs indicatives, datées et sourcées, modifiables dans Paramètres (preferences.regulatoryRules).
export const REG_RULES_DEFAULT=Object.freeze({
  bcaeBufferM:5,zntMinM:5,zntOptionsM:[5,20,50,100],nearWaterM:50,
  date:'2026-10',
  source:'Arrêté du 4 mai 2017 (ZNT des points d’eau, 5 m minimum, 20, 50 ou 100 m selon l’AMM) ; BCAE 4 de la PAC 2023-2027 (bande tampon de 5 m le long des cours d’eau BCAE).'
});
export const REG_DISCLAIMER='Indicatif : la ZNT applicable dépend du produit (AMM, étiquette) et de l’arrêté départemental des points d’eau. Vérifiez avant tout traitement.';
export function regulatoryRules(overrides={}){
  const r={...REG_RULES_DEFAULT},o=overrides||{};
  for(const key of ['bcaeBufferM','zntMinM','nearWaterM']){const n=Number(o[key]);if(Number.isFinite(n)&&n>=0&&n<=500)r[key]=n;}
  if(Array.isArray(o.zntOptionsM)){const list=o.zntOptionsM.map(Number).filter(n=>Number.isFinite(n)&&n>0&&n<=500);if(list.length)r.zntOptionsM=[...new Set(list)].sort((a,b)=>a-b);}
  if(typeof o.date==='string'&&o.date.trim())r.date=o.date.trim().slice(0,20);
  if(typeof o.source==='string'&&o.source.trim())r.source=o.source.trim().slice(0,400);
  r.custom=Object.keys(o).some(k=>o[k]!==undefined&&o[k]!==''&&JSON.stringify(o[k])!==JSON.stringify(REG_RULES_DEFAULT[k]));
  return r;
}

// ---------- WFS ----------
export function expandBbox(b,meters){const lat=(b[1]+b[3])/2,dy=meters/111320,dx=meters/(111320*Math.cos(lat*Math.PI/180));return[b[0]-dx,b[1]-dy,b[2]+dx,b[3]+dy];}
export function wfsUrl(typeName,bbox,{count=500,properties=null}={}){
  const params=new URLSearchParams({SERVICE:'WFS',VERSION:'2.0.0',REQUEST:'GetFeature',TYPENAMES:typeName,OUTPUTFORMAT:'application/json',SRSNAME:'CRS:84',BBOX:`${bbox.map(v=>v.toFixed(6)).join(',')},CRS:84`,COUNT:String(count)});
  if(properties)params.set('PROPERTYNAME',properties.join(','));
  return`${GEOPF_WFS}?${params.toString()}`;
}
export const WFS_TYPES=Object.freeze({bcae:'HYDROGRAPHY.BCAE.LATEST:bcae_cours_eau',hydro:'BDTOPO_V3:troncon_hydrographique',sic:'patrinat_sic:sic',zps:'patrinat_zps:zps'});
/** Demandes nécessaires pour évaluer une parcelle (lignes d'eau autour, sites Natura qui touchent son emprise). */
export function evaluationRequests(geometry,{rules=REG_RULES_DEFAULT}={}){
  const box=geometryBbox(geometry);if(!box)return[];
  const around=expandBbox(box,Math.max(100,rules.nearWaterM*2));
  return[
    {key:'bcae',url:wfsUrl(WFS_TYPES.bcae,around)},
    {key:'hydro',url:wfsUrl(WFS_TYPES.hydro,around)},
    {key:'sic',url:wfsUrl(WFS_TYPES.sic,box,{count:20,properties:['nom_site','url_fiche']})},
    {key:'zps',url:wfsUrl(WFS_TYPES.zps,box,{count:20,properties:['nom_site','url_fiche']})}
  ];
}

// ---------- Géométrie plane locale (mètres) ----------
function projector(lat0){const kx=111320*Math.cos(lat0*Math.PI/180),ky=111320;return([lon,lat])=>[lon*kx,lat*ky];}
function segDist(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;let t=len?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len:0;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));}
function cross(a,b,c,d){const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);return o(a,b,c)*o(a,b,d)<0&&o(c,d,a)*o(c,d,b)<0;}
function segSeg(a,b,c,d){return cross(a,b,c,d)?0:Math.min(segDist(a,c,d),segDist(b,c,d),segDist(c,a,b),segDist(d,a,b));}
export function linesOf(features){
  const out=[];for(const f of features||[]){const g=f?.geometry;if(!g)continue;if(f.properties?.fictif===true)continue;
    if(g.type==='LineString')out.push(g.coordinates);else if(g.type==='MultiLineString')out.push(...g.coordinates);
    else if(g.type==='Polygon')out.push(...g.coordinates);else if(g.type==='MultiPolygon')g.coordinates.forEach(p=>out.push(...p));}
  return out.map(line=>line.map(p=>[p[0],p[1]])).filter(line=>line.length>=2);
}
/** Distance minimale (m) entre un contour de parcelle et des lignes ; 0 si une ligne traverse la parcelle. */
export function distanceToLines(geometry,lines){
  const c=geometryCentroid(geometry);if(!c||!lines?.length)return null;
  const P=projector(c.latitude),rings=(geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[]).flat().map(r=>r.map(P));
  let best=Infinity;
  for(const line of lines){
    if(line.some(([lon,lat])=>pointInGeometry(lon,lat,geometry)))return 0;
    const L=line.map(P);
    for(const ring of rings)for(let i=0;i<ring.length-1;i++)for(let j=0;j<L.length-1;j++){const d=segSeg(ring[i],ring[i+1],L[j],L[j+1]);if(d<best){best=d;if(best===0)return 0;}}
  }
  return Number.isFinite(best)?best:null;
}

/** Distance (m) d'un point aux lignes. */
export function pointDistanceToLines(lon,lat,lines){
  if(!lines?.length)return null;const P=projector(lat),p=P([lon,lat]);let best=Infinity;
  for(const line of lines){const L=line.map(P);for(let j=0;j<L.length-1;j++)best=Math.min(best,segDist(p,L[j],L[j+1]));}
  return Number.isFinite(best)?best:null;
}

/** Évaluation indicative à partir des réponses WFS ({bcae,hydro,sic,zps} : FeatureCollection ou null si en échec). */
export function evaluateParcel(parcel,responses={},{rules=REG_RULES_DEFAULT,at=Date.now()}={}){
  const g=parcel?.geometry;if(!g)return null;
  const dist=key=>responses[key]?distanceToLines(g,linesOf(responses[key].features)):undefined;
  const sites=key=>responses[key]?(responses[key].features||[]).map(f=>({name:String(f.properties?.nom_site||'Site Natura 2000'),url:String(f.properties?.url_fiche||'')})):undefined;
  const natura=[...(sites('sic')||[]),...(sites('zps')||[])].filter((s,i,all)=>all.findIndex(x=>x.name===s.name)===i);
  return{parcelId:parcel.id,signature:geometrySignature(g),at,
    bcaeM:dist('bcae'),hydroM:dist('hydro'),waterChecked:Boolean(responses.bcae||responses.hydro),natura:responses.sic||responses.zps?natura:undefined,
    partial:['bcae','hydro','sic','zps'].some(k=>!responses[k])};
}
export function geometrySignature(geometry){const s=JSON.stringify(geometry?.coordinates||[]);let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return`${s.length}:${h}`;}

const m=v=>`${Math.round(v)} m`;
/** Messages du bandeau de la fiche parcelle (niveau warn/info). */
export function evaluationMessages(evaluation,rules=REG_RULES_DEFAULT){
  if(!evaluation)return[];
  const out=[],znt=`ZNT ${rules.zntMinM} m minimum, ${rules.zntOptionsM.filter(v=>v>rules.zntMinM).join(', ')} m selon le produit`;
  const water=[evaluation.bcaeM,evaluation.hydroM].filter(v=>v!==null&&v!==undefined);
  const nearest=water.length?Math.min(...water):null;
  if(evaluation.bcaeM!==null&&evaluation.bcaeM!==undefined&&evaluation.bcaeM<=rules.nearWaterM)out.push({level:'warn',text:evaluation.bcaeM===0?`Cours d’eau BCAE dans la parcelle : bande tampon de ${rules.bcaeBufferM} m et ${znt}.`:`Cours d’eau BCAE à ${m(evaluation.bcaeM)} : bande tampon de ${rules.bcaeBufferM} m et ${znt}.`});
  else if(nearest!==null&&nearest<=rules.nearWaterM)out.push({level:'warn',text:nearest===0?`Écoulement d’eau dans la parcelle (BD TOPO) : ${znt} si c’est un point d’eau de l’arrêté départemental.`:`Écoulement d’eau à ${m(nearest)} (BD TOPO) : ${znt} si c’est un point d’eau de l’arrêté départemental.`});
  else if(evaluation.waterChecked)out.push({level:'info',text:`Aucun cours d’eau connu à moins de ${rules.nearWaterM} m.`});
  if(evaluation.natura?.length)out.push({level:'warn',text:`Natura 2000 : ${evaluation.natura.map(s=>s.name).join(', ')}. Évaluation d’incidences possible pour certains travaux.`,links:evaluation.natura.filter(s=>/^https:\/\//.test(s.url))});
  if(evaluation.partial)out.push({level:'info',text:'Évaluation partielle : un service public n’a pas répondu.'});
  return out;
}

// ---------- Préconisation : bande exclue le long des cours d'eau ----------
export const BUFFER_GROUP='ZNT';
/** Place dans le groupe « ZNT » (dose 0) les cellules à moins de widthM (bord de cellule) d'une ligne d'eau.
 *  Réversible : bufferFrom garde le groupe d'origine, rétabli à chaque nouvel appel. */
export function excludeWaterBuffer(zones,lines,widthM){
  const width=Number(widthM);if(!zones?.cells||!Number.isFinite(width)||width<=0)return{zones,excluded:0};
  let excluded=0;
  const cells=zones.cells.map(cell=>{
    const restored=cell.bufferFrom?{...cell,group:cell.bufferFrom,bufferFrom:undefined}:cell;
    if(!restored.enabled||!lines?.length)return restored;
    const d=distanceToLines(restored.geometry,lines);
    const inside=d!==null&&d<width;
    if(!inside)return restored;excluded++;return{...restored,bufferFrom:restored.group,group:BUFFER_GROUP};
  });
  return{zones:{...zones,cells},excluded};
}
