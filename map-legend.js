// Légende interactive de la carte (n° 53) : totaux par catégorie et isolement d'une catégorie.
// Logique pure : aucun accès à Leaflet ni au DOM, aucune écriture.
import {geometryAreaHa} from './utils.js';

export const DIMMED_OPACITY=.15;

// Regroupe les parcelles par libellé de légende, dans l'ordre d'apparition.
export function legendGroups(parcels,infoFor){
  const groups=new Map();
  for(const parcel of parcels||[]){
    if(!parcel||parcel.deletedAt)continue;
    const info=infoFor(parcel)||{};const label=String(info.label??'');
    if(!groups.has(label))groups.set(label,{label,color:info.color||'#778579',count:0,ha:0,ids:[]});
    const group=groups.get(label);group.count+=1;group.ids.push(parcel.id);
    let surface=Number(parcel.surfaceHa);if(!(surface>0)&&parcel.geometry){try{surface=geometryAreaHa(parcel.geometry);}catch{surface=0;}}
    group.ha+=Number.isFinite(surface)&&surface>0?surface:0;
  }
  return [...groups.values()].map(group=>({...group,ha:Math.round(group.ha*10)/10}));
}

const haText=value=>new Intl.NumberFormat('fr-FR',{minimumFractionDigits:value%1?1:0,maximumFractionDigits:1}).format(value);
export function legendLine(group){
  return `${group.label} · ${group.count} parcelle${group.count>1?'s':''} · ${haText(group.ha)} ha`;
}

// Style d'une parcelle quand une catégorie est isolée : les autres passent à 15 % d'opacité.
export function legendStyle(style,{focus=null,label=''}={}){
  if(focus===null||focus===undefined||focus===label)return style;
  return {...style,opacity:(style.opacity??1)*DIMMED_OPACITY,fillOpacity:(style.fillOpacity??.3)*DIMMED_OPACITY};
}

// Emprise [[sud, ouest], [nord, est]] des géométries d'une catégorie, pour cadrer la carte.
export function groupBounds(parcels,ids){
  const keep=new Set(ids||[]);let s=Infinity,w=Infinity,n=-Infinity,e=-Infinity;
  const visit=c=>{if(typeof c?.[0]==='number'){w=Math.min(w,c[0]);e=Math.max(e,c[0]);s=Math.min(s,c[1]);n=Math.max(n,c[1]);}else if(Array.isArray(c))c.forEach(visit);};
  for(const parcel of parcels||[])if(keep.has(parcel.id))visit(parcel.geometry?.coordinates);
  return Number.isFinite(s)?[[s,w],[n,e]]:null;
}
