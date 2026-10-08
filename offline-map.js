// Carte de l'exploitation hors connexion (idée n° 40) : logique pure, sans réseau ni DOM.
// Seules les tuiles IGN (Géoplateforme) sont prévues au téléchargement : les conditions
// d'usage d'OSM et d'Esri interdisent le pré-téléchargement en masse.
import {BASE_LAYERS, CADASTRE_OVERLAY} from './basemaps.js';
import {geometryBbox} from './utils.js';

// Doit rester identique au nom calculé dans sw.js (PREFIX + 'tiles-v1'), indépendant de BUILD.
export const TILE_CACHE_SUFFIX='tiles-v1';
export const TILE_CAP_BYTES=150*1024*1024;
export const OFFLINE_ZOOMS=[12,13,14,15,16,17];
export const OFFLINE_BUFFER_M=500;
export const BATCH_SIZE=6;
// Tailles moyennes observées par tuile (hypothèse d'estimation, affichée comme telle).
export const OFFLINE_LAYERS=[
  {id:'ign-photo',label:'Photo IGN',avgBytes:30*1024},
  {id:'ign-plan',label:'Plan IGN',avgBytes:18*1024}
];
export const CADASTRE_AVG_BYTES=7*1024;

export function tileCacheName(scopePath='/'){return `parcelles-${encodeURIComponent(scopePath)}-${TILE_CACHE_SUFFIX}`;}
export function offlineLayer(id){return OFFLINE_LAYERS.find(layer=>layer.id===id)||null;}
export function layerTemplate(id){return id==='cadastre'?CADASTRE_OVERLAY.url:BASE_LAYERS.find(layer=>layer.id===id)?.url||'';}
export function tileUrl(template,{z,x,y}){return String(template).replace('{z}',z).replace('{x}',x).replace('{y}',y);}
export function isIgnTileUrl(value){
  try{const url=new URL(value);return url.hostname==='data.geopf.fr'&&url.pathname==='/wmts'&&url.searchParams.get('REQUEST')==='GetTile';}catch{return false;}
}

const clampLat=lat=>Math.max(-85.05112878,Math.min(85.05112878,lat));
export function lonLatToTile(lon,lat,z){
  const n=2**z,rad=clampLat(lat)*Math.PI/180;
  const x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n);
  return {x:Math.max(0,Math.min(n-1,x)),y:Math.max(0,Math.min(n-1,y))};
}
export function bufferBbox([minLon,minLat,maxLon,maxLat],meters){
  const dLat=meters/111320,midLat=(minLat+maxLat)/2,dLon=meters/(111320*Math.max(0.01,Math.cos(midLat*Math.PI/180)));
  return [minLon-dLon,clampLat(minLat-dLat),maxLon+dLon,clampLat(maxLat+dLat)];
}

// Une emprise par parcelle (+ 500 m), dédoublonnée : une exploitation éclatée ne télécharge
// pas tout l'espace entre ses îlots aux zooms fins.
export function planOfflineTiles(parcels,{zooms=OFFLINE_ZOOMS,bufferM=OFFLINE_BUFFER_M}={}){
  const boxes=(Array.isArray(parcels)?parcels:[]).filter(p=>p&&!p.deletedAt&&p.geometry).map(p=>{try{return geometryBbox(p.geometry);}catch{return null;}})
    .filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)).map(b=>bufferBbox(b,bufferM));
  const tiles=[],perZoom={},seen=new Set();
  for(const z of zooms){
    perZoom[z]=0;
    for(const [minLon,minLat,maxLon,maxLat] of boxes){
      const a=lonLatToTile(minLon,maxLat,z),b=lonLatToTile(maxLon,minLat,z);
      for(let x=a.x;x<=b.x;x++)for(let y=a.y;y<=b.y;y++){const key=`${z}/${x}/${y}`;if(seen.has(key))continue;seen.add(key);tiles.push({z,x,y});perZoom[z]++;}
    }
  }
  const all=boxes.length?[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))]:null;
  return {tiles,perZoom,parcelCount:boxes.length,bbox:all};
}

export function estimateBytes(tileCount,{layer='ign-photo',cadastre=false}={}){
  return tileCount*((offlineLayer(layer)?.avgBytes||30*1024)+(cadastre?CADASTRE_AVG_BYTES:0));
}
// Réduit le zoom maximal tant que l'estimation dépasse le plafond.
export function fitPlan(parcels,{layer='ign-photo',cadastre=false,cap=TILE_CAP_BYTES,zooms=OFFLINE_ZOOMS}={}){
  let list=[...zooms],plan=planOfflineTiles(parcels,{zooms:list});
  while(list.length>1&&estimateBytes(plan.tiles.length,{layer,cadastre})>cap){list=list.slice(0,-1);plan=planOfflineTiles(parcels,{zooms:list});}
  const bytes=estimateBytes(plan.tiles.length,{layer,cadastre});
  return {...plan,zooms:list,reduced:list.length<zooms.length,estimatedBytes:bytes,tooLarge:bytes>cap,requests:plan.tiles.length*(cadastre?2:1)};
}
export function plannedUrls(plan,{layer='ign-photo',cadastre=false}={}){
  const base=layerTemplate(layer),overlay=cadastre?layerTemplate('cadastre'):'';
  return plan.tiles.flatMap(tile=>overlay?[tileUrl(base,tile),tileUrl(overlay,tile)]:[tileUrl(base,tile)]);
}
export function chunk(list,size=BATCH_SIZE){const out=[];for(let i=0;i<list.length;i+=size)out.push(list.slice(i,i+size));return out;}

// Éviction : les tuiles les plus anciennes partent d'abord jusqu'à repasser sous le plafond.
export function evictionList(entries,cap=TILE_CAP_BYTES){
  const rows=[...entries].sort((a,b)=>(a.cachedAt||0)-(b.cachedAt||0));let total=rows.reduce((sum,row)=>sum+(row.size||0),0);const out=[];
  for(const row of rows){if(total<=cap)break;out.push(row.url);total-=row.size||0;}
  return out;
}

const pad=n=>String(n).padStart(2,'0');
export function formatBytes(bytes){
  const value=Number(bytes)||0,fmt=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:n<10?1:0}).format(n);
  if(value<1024*1024)return `${fmt(Math.max(1,Math.round(value/1024)))} Ko`;
  return `${fmt(value/1024/1024)} Mo`;
}
export function formatCount(n){return new Intl.NumberFormat('fr-FR').format(Number(n)||0);}
export function offlineSummary(meta){
  if(!meta||!meta.at)return 'Pas encore téléchargée';
  const d=new Date(meta.at),layer=offlineLayer(meta.layer)?.label||'Fond IGN';
  return `À jour le ${pad(d.getDate())}/${pad(d.getMonth()+1)} · ${layer}${meta.cadastre?' + cadastre':''} · ${formatBytes(meta.bytes)}`;
}
export function normalizeMeta(value){
  if(!value||typeof value!=='object'||!Number.isFinite(Number(value.at))||!offlineLayer(value.layer))return null;
  return {at:Number(value.at),layer:value.layer,cadastre:Boolean(value.cadastre),tiles:Math.max(0,Number(value.tiles)||0),bytes:Math.max(0,Number(value.bytes)||0),failed:Math.max(0,Number(value.failed)||0),maxZoom:Number(value.maxZoom)||17,complete:value.complete!==false};
}
