// n° 51 : découper et fusionner des parcelles (logique pure).
// L'origine est archivée (archived:true) avec splitInto / mergedInto ; les nouvelles
// parcelles portent parentId / parentIds. Champs optionnels : aucune migration.
import {geometryAreaHa,formatNumber} from './utils.js';
import {isPending} from './home-priorities.js';
import {splitPolygonByLine,splitLabels,unionPolygons} from './geometry-ops.js';

// Champs propres à une fiche qui ne passent pas aux parcelles issues de la découpe.
const IDENTITY=['id','createdAt','updatedAt','version','deletedAt','geometry','surfaceHa','nom','source','sourceId','archived','favorite','splitInto','mergedInto','parentId','parentIds','syncedAt','remoteVersion'];
function inherit(parcel){const out={};for(const [k,v] of Object.entries(parcel||{}))if(!IDENTITY.includes(k))out[k]=structuredClone(v);return out;}
const round=v=>Number(v.toFixed(4));
// Surface déclarée à garder (PAC ou cadastrale) : même règle que nextSurfaceHa (contour-edit.js),
// elle diffère du contour de plus de 1 % ou 0,02 ha. Sinon null : on suit le contour.
export function declaredSurfaceHa(parcel){
  const v=parcel?.surfaceHa;if(v===null||v===undefined||v==='')return null;
  const d=Number(v),a=geometryAreaHa(parcel?.geometry);
  return Number.isFinite(d)&&d>0&&a>0&&Math.abs(d-a)>Math.max(0.02,a*0.01)?d:null;
}
// Surfaces des morceaux : la surface déclarée est répartie au prorata du contour.
function partSurfaces(parcel,areas){
  const d=declaredSurfaceHa(parcel),total=areas.reduce((s,v)=>s+v,0);
  if(d===null||!(total>0))return areas.map(round);
  const out=areas.map(v=>round(d*v/total));
  out[out.length-1]=round(d-out.slice(0,-1).reduce((s,v)=>s+v,0));
  return out;
}

// Prévisualisation d'une découpe : morceaux, surfaces et noms proposés.
export function previewSplit(parcel,line){
  const res=splitPolygonByLine(parcel?.geometry,line);if(res.error)return res;
  const labels=splitLabels(res.parts[0],res.parts[1]);
  const parts=res.parts.map((geometry,i)=>({geometry,areaHa:geometryAreaHa(geometry),label:labels[i],name:`${parcel.nom} ${labels[i]}`}));
  const surfaces=partSurfaces(parcel,parts.map(p=>p.areaHa));parts.forEach((p,i)=>{p.surfaceHa=surfaces[i];});
  return{parts,summary:parts.map(p=>`${p.label} ${formatNumber(p.surfaceHa)} ha`).join(' · ')};
}

// Entités à enregistrer : deux filles + l'origine archivée.
export function buildSplit(parcel,parts,names,ids){
  const surfaces=partSurfaces(parcel,parts.map(p=>p.areaHa));
  const children=parts.map((p,i)=>({...inherit(parcel),id:ids[i],nom:String(names[i]||p.name).trim(),geometry:p.geometry,surfaceHa:surfaces[i],parentId:parcel.id,source:'local'}));
  return{children,original:{...parcel,archived:true,splitInto:children.map(c=>c.id)}};
}

export function previewMerge(a,b){
  const res=unionPolygons(a?.geometry,b?.geometry);if(res.error)return res;
  return{geometry:res.geometry,areaHa:geometryAreaHa(res.geometry),surfaceHa:mergeSurfaceHa(a,b,res.geometry)};
}

// Surface de la fusion : somme des surfaces déclarées si l'une des deux est à garder, sinon le contour.
export function mergeSurfaceHa(a,b,geometry){
  const da=declaredSurfaceHa(a),db=declaredSurfaceHa(b);
  if(da===null&&db===null)return round(geometryAreaHa(geometry));
  return round((da??geometryAreaHa(a?.geometry))+(db??geometryAreaHa(b?.geometry)));
}

export function buildMerge(a,b,geometry,name,id){
  const merged={...inherit(a),id,nom:String(name||a.nom).trim(),geometry,surfaceHa:mergeSurfaceHa(a,b,geometry),parentIds:[a.id,b.id],source:'local'};
  return{merged,originals:[{...a,archived:true,mergedInto:id},{...b,archived:true,mergedInto:id}]};
}

// Éléments encore ouverts sur des parcelles (lots au pré, travaux et tâches à faire) :
// à rattacher avant d'archiver. Les travaux terminés restent sur l'origine (historique).
export function openLinks(data,ids){
  const set=new Set(ids||[]),on=x=>!x.deletedAt&&set.has(x.parcelId);
  return{
    grazingSessions:(data?.grazingSessions||[]).filter(g=>on(g)&&!g.endDate),
    interventions:(data?.interventions||[]).filter(w=>on(w)&&isPending(w,'work')),
    tasks:(data?.tasks||[]).filter(t=>on(t)&&isPending(t,'task'))
  };
}
export const openLinksCount=links=>Object.values(links||{}).reduce((s,l)=>s+l.length,0);
export function relink(list,parcelId){return(list||[]).map(e=>({...e,parcelId}));}

// « issue de … » pour la fiche d'une parcelle née d'une découpe ou d'une fusion.
export function lineageLabel(parcel,findParcel){
  const ids=parcel?.parentIds?.length?parcel.parentIds:parcel?.parentId?[parcel.parentId]:[];
  const names=ids.map(id=>findParcel(id)?.nom).filter(Boolean);
  if(!names.length)return'';
  return`issue de ${names.length>1?`${names.slice(0,-1).join(', ')} et ${names[names.length-1]}`:names[0]}`;
}
