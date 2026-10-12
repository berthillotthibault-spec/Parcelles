// n° 29 - Silhouette SVG réelle d'une parcelle et frise de rotation. Logique pure.
const cache=new Map();const CACHE_MAX=600;

function rings(geometry){
  if(geometry?.type==='Polygon')return[geometry.coordinates?.[0]].filter(Boolean);
  if(geometry?.type==='MultiPolygon')return(geometry.coordinates||[]).map(p=>p?.[0]).filter(Boolean);
  return[];
}
// Contour normalisé dans un carré size x size (marge pad), proportions respectées, nord en haut.
export function silhouettePath(geometry,size=44,pad=3){
  const list=rings(geometry).map(r=>r.filter(c=>Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[1]))).filter(r=>r.length>=3);
  if(!list.length)return '';
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const r of list)for(const [x,y] of r){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  const k=Math.cos((minY+maxY)/2*Math.PI/180),w=(maxX-minX)*k,h=maxY-minY,span=Math.max(w,h);
  if(!(span>0))return '';
  const s=(size-2*pad)/span,ox=pad+(size-2*pad-w*s)/2,oy=pad+(size-2*pad-h*s)/2,r1=v=>Math.round(v*10)/10;
  return list.map(r=>{const step=Math.max(1,Math.ceil(r.length/160));const pts=r.filter((_,i)=>i%step===0||i===r.length-1);let last='';const out=[];for(const [x,y] of pts){const p=`${r1(ox+(x-minX)*k*s)} ${r1(oy+(maxY-y)*s)}`;if(p!==last)out.push(p);last=p;}return 'M'+out.join('L')+'Z';}).join('');
}
// Chemin mis en cache par parcelle (invalidé quand la parcelle change de version).
export function cachedSilhouette(parcel,size=44){
  if(!parcel?.geometry)return '';
  const key=`${parcel.id}|${parcel.version||0}|${parcel.updatedAt||0}|${size}`;
  if(cache.has(key))return cache.get(key);
  const d=silhouettePath(parcel.geometry,size);
  if(cache.size>=CACHE_MAX)cache.delete(cache.keys().next().value);
  cache.set(key,d);return d;
}
export const silhouetteCacheSize=()=>cache.size;

export function shiftCampaign(campaign,n){const y=Number(String(campaign||'').slice(0,4))+n;return Number.isFinite(y)?`${y}/${String(y+1).slice(-2)}`:'';}
// Frise sur `count` campagnes, de la plus ancienne à la campagne en cours.
export function rotationFrieze(parcel,rotations=[],current,count=3){
  const out=[];
  for(let i=count-1;i>=0;i--){const campaignId=shiftCampaign(current,-i),r=(rotations||[]).find(x=>!x.deletedAt&&x.parcelId===parcel?.id&&x.campaignId===campaignId);out.push({campaignId,culture:r?.culture||(i===0?parcel?.culture||'':''),current:i===0});}
  return out;
}
