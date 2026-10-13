// n° 47 : vérification du parcellaire (chevauchements, écarts de surface, RPG, contours). Logique pure.
// Aide à la vérification seulement : la déclaration officielle reste celle de telepac.
// Les intersections sont approchées par grille (centres de cellules), comme analyzeCoverage.
import {geometryAreaHa, geometryBbox, geometryCentroid, pointInGeometry} from './utils.js';

export const PARCEL_CHECK_DISCLAIMER='Aide à la vérification calculée sur l’appareil, par approximation : elle ne remplace pas la déclaration telepac ni le contrôle officiel.';
export const SURFACE_TOLERANCE=0.02; // écart relatif signalé (> 2 %)
export const OVERLAP_MIN_HA=0.01;    // 100 m² : en dessous, simple imprécision de tracé

const alive=list=>(list||[]).filter(item=>item&&!item.deletedAt&&!item.archived);
const polygonsOf=g=>g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
const round=(value,digits=2)=>Math.round(value*10**digits)/10**digits;

/** Années RPG proposées, la plus récente d'abord (le millésime N-1 peut ne pas être encore publié). */
export function rpgYearOptions(now=new Date(),oldest=2020){const last=now.getFullYear()-1,out=[];for(let y=last;y>=oldest;y--)out.push(y);return out;}

function segmentsCross(a,b,c,d){
  const o=(p,q,r)=>Math.sign((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]));
  const o1=o(a,b,c),o2=o(a,b,d),o3=o(c,d,a),o4=o(c,d,b);
  return o1!==o2&&o3!==o4&&o1!==0&&o2!==0&&o3!==0&&o4!==0;
}
/** Problèmes de contour : anneau non fermé, trop court, ou qui se recoupe (≤ 3 000 sommets vérifiés). */
export function geometryIssues(geometry){
  if(!geometry)return['missing'];
  if(!['Polygon','MultiPolygon'].includes(geometry.type))return['type'];
  const issues=new Set();
  for(const polygon of polygonsOf(geometry))for(const ring of polygon||[]){
    if(!Array.isArray(ring)||ring.length<4){issues.add('short');continue;}
    const first=ring[0],last=ring[ring.length-1];
    if(first[0]!==last[0]||first[1]!==last[1])issues.add('open');
    const n=ring.length-1;if(n>3000)continue;
    outer:for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(segmentsCross(ring[i],ring[i+1],ring[j],ring[j+1])){issues.add('self');break outer;}}
  }
  return[...issues];
}
const GEOMETRY_LABELS={missing:'Sans contour',type:'Contour non surfacique',short:'Contour trop court',open:'Contour non fermé',self:'Contour qui se recoupe'};

function bboxOverlap(a,b,pad=0){return a&&b&&a[0]-pad<=b[2]&&b[0]-pad<=a[2]&&a[1]-pad<=b[3]&&b[1]-pad<=a[3];}
/** Surface commune approchée de deux contours (grille ≤ 4 000 cellules sur l'emprise commune). */
export function overlapArea(a,b,{maxCells=4000}={}){
  const ba=geometryBbox(a),bb=geometryBbox(b);if(!bboxOverlap(ba,bb))return{areaHa:0,bbox:null};
  const box=[Math.max(ba[0],bb[0]),Math.max(ba[1],bb[1]),Math.min(ba[2],bb[2]),Math.min(ba[3],bb[3])];
  const lat=(box[1]+box[3])/2,mx=111320*Math.cos(lat*Math.PI/180),my=111320,w=(box[2]-box[0])*mx,h=(box[3]-box[1])*my;
  if(w<=0||h<=0)return{areaHa:0,bbox:null};
  const cell=Math.max(1,Math.sqrt(w*h/maxCells)),nx=Math.max(1,Math.ceil(w/cell)),ny=Math.max(1,Math.ceil(h/cell)),dx=(box[2]-box[0])/nx,dy=(box[3]-box[1])/ny;
  let hits=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x=box[0]+(i+.5)*dx,y=box[1]+(j+.5)*dy;if(pointInGeometry(x,y,a)&&pointInGeometry(x,y,b)){hits++;minX=Math.min(minX,x-dx/2);maxX=Math.max(maxX,x+dx/2);minY=Math.min(minY,y-dy/2);maxY=Math.max(maxY,y+dy/2);}}
  return{areaHa:hits*(dx*mx)*(dy*my)/10000,bbox:hits?[minX,minY,maxX,maxY]:null};
}
export const bboxPolygon=b=>b?{type:'Polygon',coordinates:[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]}:null;

function rpgSurface(feature){const v=feature?.properties?.surf_parc??feature?.properties?.SURF_PARC;const n=typeof v==='number'?v:Number(String(v??'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null;}
function rpgIdOf(feature){return String(feature?.properties?.id_parcel??feature?.properties?.ID_PARCEL??feature?.id??'');}
/** Parcelle RPG correspondant à une parcelle : identifiant RPG mémorisé, sinon celle qui contient son centre. */
export function matchRpg(parcel,features){
  const fromSource=/^rpg:\d+:parcel:(.+)$/.exec(String(parcel.sourceId||''))?.[1];
  const id=String(parcel.rpgId||'')||(fromSource?decodeURIComponent(fromSource):'');
  if(id){const hit=features.find(f=>rpgIdOf(f)===id);if(hit)return hit;}
  const c=geometryCentroid(parcel.geometry);if(!c||!pointInGeometry(c.longitude,c.latitude,parcel.geometry))return null;
  return features.find(f=>pointInGeometry(c.longitude,c.latitude,f.geometry))||null;
}

/** Écarts de surface (> 2 %) entre saisie, calcul du contour, déclaration (telepac) et RPG. */
export function surfaceGaps(parcel,{rpgFeature=null,tolerance=SURFACE_TOLERANCE}={}){
  const values=[];
  const add=(key,label,value)=>{const n=Number(value);if(value!==null&&value!==undefined&&value!==''&&Number.isFinite(n)&&n>0)values.push({key,label,value:n});};
  add('entered','saisie',parcel.surfaceHa);
  if(parcel.geometry&&!geometryIssues(parcel.geometry).length)add('computed','contour',geometryAreaHa(parcel.geometry));
  add('declared','déclarée',parcel.declaredSurfaceHa);
  if(rpgFeature)add('rpg','RPG',rpgSurface(rpgFeature));
  let worst=null;
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){const a=values[i],b=values[j],gap=Math.abs(a.value-b.value)/Math.max(a.value,b.value);if(gap>tolerance&&(!worst||gap>worst.gap))worst={gap,a,b};}
  return{values,worst};
}

/**
 * Contrôle complet. rpgFeatures : parcelles RPG chargées (facultatif, hors ligne on s'en passe).
 * Renvoie {issues:[{kind,severity,parcelIds,title,detail,geometry}],counts,rpgYear}.
 */
export function checkParcels(state,{rpgFeatures=[],rpgYear=null,tolerance=SURFACE_TOLERANCE,overlapMinHa=OVERLAP_MIN_HA}={}){
  const parcels=alive(state?.parcelles).filter(p=>(p.ownershipType||'own')==='own'),issues=[];
  const rpg=(rpgFeatures||[]).filter(f=>f?.geometry);
  // 1. Contours
  for(const p of parcels){const list=geometryIssues(p.geometry).filter(x=>x!=='missing');if(list.length)issues.push({kind:'geometry',severity:'danger',parcelIds:[p.id],title:`${p.nom} : ${list.map(x=>GEOMETRY_LABELS[x]).join(', ').toLowerCase()}`,detail:'Redessinez ou corrigez le contour : la surface calculée n’est pas fiable.',geometry:p.geometry,codes:list});}
  // 2. Chevauchements
  const drawn=parcels.filter(p=>p.geometry&&!geometryIssues(p.geometry).length).map(p=>({p,box:geometryBbox(p.geometry)}));
  for(let i=0;i<drawn.length;i++)for(let j=i+1;j<drawn.length;j++){
    const a=drawn[i],b=drawn[j];if(!bboxOverlap(a.box,b.box))continue;
    const {areaHa,bbox}=overlapArea(a.p.geometry,b.p.geometry);if(areaHa<overlapMinHa)continue;
    issues.push({kind:'overlap',severity:'danger',parcelIds:[a.p.id,b.p.id],title:`${a.p.nom} et ${b.p.nom} se chevauchent`,detail:`Environ ${round(areaHa,2).toLocaleString('fr-FR')} ha comptés deux fois.`,overlapHa:round(areaHa,4),geometry:bboxPolygon(bbox)});
  }
  // 3. Surfaces
  for(const p of parcels){
    const {worst}=surfaceGaps(p,{rpgFeature:rpg.length&&p.geometry?matchRpg(p,rpg):null,tolerance});
    if(worst)issues.push({kind:'surface',severity:'warning',parcelIds:[p.id],title:`${p.nom} : écart de surface de ${Math.round(worst.gap*100)} %`,detail:`${worst.a.label} ${round(worst.a.value).toLocaleString('fr-FR')} ha · ${worst.b.label} ${round(worst.b.value).toLocaleString('fr-FR')} ha`,geometry:p.geometry||null,gap:round(worst.gap,4)});
  }
  // 4. RPG : plusieurs parcelles RPG dans une parcelle, parcelles RPG à cheval sur une parcelle mais absentes de l'app
  if(rpg.length){
    const used=new Set();
    for(const {p} of drawn){
      const inside=rpg.filter(f=>{const c=geometryCentroid(f.geometry);return c&&pointInGeometry(c.longitude,c.latitude,p.geometry);});
      inside.forEach(f=>used.add(f));
      if(inside.length>=2)issues.push({kind:'rpg-split',severity:'warning',parcelIds:[p.id],title:`${p.nom} contient ${inside.length} parcelles RPG`,detail:'Le RPG découpe cette parcelle : découpez-la dans Parcelles si la déclaration la sépare.',geometry:p.geometry});
    }
    const pad=10/111320; // ≈ 10 m
    for(const f of rpg){
      if(used.has(f))continue;const box=geometryBbox(f.geometry),c=geometryCentroid(f.geometry);
      if(drawn.some(({p})=>c&&pointInGeometry(c.longitude,c.latitude,p.geometry)))continue;
      // Recouvrement net (≥ 10 % de la parcelle RPG ou ≥ 0,05 ha) : une simple bordure commune ne compte pas.
      const fArea=geometryAreaHa(f.geometry),near=drawn.filter(d=>{if(!bboxOverlap(box,d.box,pad))return false;const shared=overlapArea(f.geometry,d.p.geometry).areaHa;return shared>=0.05||shared>=fArea*0.1;});
      if(!near.length)continue;
      issues.push({kind:'rpg-missing',severity:'info',parcelIds:near.map(d=>d.p.id),rpgId:rpgIdOf(f),title:`Parcelle RPG ${rpgIdOf(f)} absente de Parcelles`,detail:`En partie sous ${near.map(d=>d.p.nom).join(', ')}${rpgSurface(f)?` · ${round(rpgSurface(f)).toLocaleString('fr-FR')} ha`:''}. Le RPG est anonyme : vérifiez s’il s’agit d’une parcelle de l’îlot oubliée ou d’un tracé qui déborde.`,geometry:f.geometry});
    }
  }
  const counts={};for(const issue of issues)counts[issue.kind]=(counts[issue.kind]||0)+1;
  return{issues,counts,checked:parcels.length,rpgYear:rpg.length?rpgYear:null};
}
