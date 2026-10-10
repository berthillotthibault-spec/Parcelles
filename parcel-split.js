// n° 51 : découper et fusionner des parcelles (logique pure).
// L'origine est archivée (archived:true) avec splitInto / mergedInto ; les nouvelles
// parcelles portent parentId / parentIds. Champs optionnels : aucune migration.
import {geometryAreaHa} from './utils.js';
import {splitPolygonByLine,splitLabels,unionPolygons} from './geometry-ops.js';

// Champs propres à une fiche qui ne passent pas aux parcelles issues de la découpe.
const IDENTITY=['id','createdAt','updatedAt','version','deletedAt','geometry','surfaceHa','nom','source','sourceId','archived','favorite','splitInto','mergedInto','parentId','parentIds','syncedAt','remoteVersion'];
function inherit(parcel){const out={};for(const [k,v] of Object.entries(parcel||{}))if(!IDENTITY.includes(k))out[k]=structuredClone(v);return out;}
const round=v=>Number(v.toFixed(4));

// Prévisualisation d'une découpe : morceaux, surfaces et noms proposés.
export function previewSplit(parcel,line){
  const res=splitPolygonByLine(parcel?.geometry,line);if(res.error)return res;
  const labels=splitLabels(res.parts[0],res.parts[1]);
  const parts=res.parts.map((geometry,i)=>({geometry,areaHa:geometryAreaHa(geometry),label:labels[i],name:`${parcel.nom} ${labels[i]}`}));
  return{parts,summary:parts.map(p=>`${p.label} ${String(Math.round(p.areaHa*10)/10).replace('.',',')} ha`).join(' · ')};
}

// Entités à enregistrer : deux filles + l'origine archivée.
export function buildSplit(parcel,parts,names,ids){
  const children=parts.map((p,i)=>({...inherit(parcel),id:ids[i],nom:String(names[i]||p.name).trim(),geometry:p.geometry,surfaceHa:round(p.areaHa),parentId:parcel.id,source:'local'}));
  return{children,original:{...parcel,archived:true,splitInto:children.map(c=>c.id)}};
}

export function previewMerge(a,b){
  const res=unionPolygons(a?.geometry,b?.geometry);if(res.error)return res;
  return{geometry:res.geometry,areaHa:geometryAreaHa(res.geometry)};
}

export function buildMerge(a,b,geometry,name,id){
  const merged={...inherit(a),id,nom:String(name||a.nom).trim(),geometry,surfaceHa:round(geometryAreaHa(geometry)),parentIds:[a.id,b.id],source:'local'};
  return{merged,originals:[{...a,archived:true,mergedInto:id},{...b,archived:true,mergedInto:id}]};
}

// « issue de … » pour la fiche d'une parcelle née d'une découpe ou d'une fusion.
export function lineageLabel(parcel,findParcel){
  const ids=parcel?.parentIds?.length?parcel.parentIds:parcel?.parentId?[parcel.parentId]:[];
  const names=ids.map(id=>findParcel(id)?.nom).filter(Boolean);
  if(!names.length)return'';
  return`issue de ${names.length>1?`${names.slice(0,-1).join(', ')} et ${names[names.length-1]}`:names[0]}`;
}
