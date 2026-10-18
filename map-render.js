// v11 n° 52 : carte fluide avec des centaines de parcelles.
// Logique pure : plan de mise à jour partielle des couches (par id + updatedAt) et styles
// explicites pour le rendu canvas (setStyle fusionne les options : chaque clé doit être fournie).
import {legendStyle} from './map-legend.js';

// Clé de géométrie d'une parcelle : la couche n'est recréée que si elle change.
// Sans date ni version (anciennes données), l'identité de l'objet géométrie fait foi.
const geometryTokens=new WeakMap();let nextToken=0;
export function parcelLayerKey(parcel){
  if(!parcel)return '';
  const stamp=[parcel.updatedAt||'',parcel.version??''].join('|');
  if(stamp!=='|')return `${parcel.id}|${stamp}|${parcel.geometry?.type||''}`;
  const geometry=parcel.geometry;if(!geometry||typeof geometry!=='object')return `${parcel.id}|-`;
  if(!geometryTokens.has(geometry))geometryTokens.set(geometry,++nextToken);
  return `${parcel.id}|#${geometryTokens.get(geometry)}`;
}

// previous : Map id -> clé de la couche existante. Retourne les couches à garder, créer, retirer.
export function planParcelLayers(previous,parcels){
  const before=previous instanceof Map?previous:new Map(),keep=[],create=[],seen=new Set();
  for(const parcel of parcels||[]){
    if(!parcel?.id||!parcel.geometry||parcel.deletedAt||seen.has(parcel.id))continue;seen.add(parcel.id);
    const key=parcelLayerKey(parcel);(before.get(parcel.id)===key?keep:create).push({id:parcel.id,key,parcel});
  }
  const kept=new Set(keep.map(item=>item.id));
  return {keep,create,remove:[...before.keys()].filter(id=>!kept.has(id))};
}

// Style complet d'une parcelle. dashArray et lineCap toujours présents pour qu'un setStyle efface l'état précédent.
export function parcelStyle({selected=false,color='#4d8f67',fill=null,reentry=false,late=false,hatch=false,overlay=false,focus=null,label=''}={}){
  const dash=reentry&&!selected?{dashArray:'7 5',lineCap:'round'}:late?{dashArray:'1 7',lineCap:'round'}:{dashArray:null,lineCap:'round'};
  return legendStyle({color:selected?'#092c1c':reentry?'#b3261e':late?'#c33b36':color,weight:selected?5:3,opacity:1,...dash,fill:true,fillColor:fill||color,fillOpacity:overlay?0:hatch?.7:(selected?.52:.3)},{focus,label});
}

// Signature d'un style : évite un setStyle (et un redessin) quand rien ne change.
export function styleKey(style){
  if(!style)return '';
  const fill=style.fillColor;
  return [style.color,style.weight,style.opacity,style.dashArray??'',style.lineCap??'',style.fill===false?0:1,typeof fill==='string'?fill:fill?'motif':'',style.fillOpacity].join(';');
}

// Emprise [ouest, sud, est, nord] d'une géométrie GeoJSON (null si vide).
export function geometryBox(geometry){
  let box=null;const visit=c=>{if(!Array.isArray(c))return;if(typeof c[0]==='number'){const [x,y]=c;if(!Number.isFinite(x)||!Number.isFinite(y))return;if(!box)box=[x,y,x,y];else{box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);}return;}c.forEach(visit);};
  if(geometry?.type==='GeometryCollection')(geometry.geometries||[]).forEach(g=>visit(g?.coordinates));else visit(geometry?.coordinates);
  return box;
}

// Taille à l'écran (pixels, Web Mercator) d'une emprise au zoom donné : une parcelle trop petite
// pour porter une étiquette n'en crée pas (évite des centaines d'infobulles masquées en vue large).
const mercY=lat=>{const s=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180);return .5-Math.log((1+s)/(1-s))/(4*Math.PI);};
export function boxPixelSize(box,zoom){
  if(!box)return {w:0,h:0};const scale=256*2**zoom;
  return {w:(box[2]-box[0])/360*scale,h:Math.abs(mercY(box[1])-mercY(box[3]))*scale};
}
export const LABEL_MIN_PX={w:44,h:18};
export function labelHasRoom(box,zoom,min=LABEL_MIN_PX){const {w,h}=boxPixelSize(box,zoom);return w>=min.w&&h>=min.h;}
