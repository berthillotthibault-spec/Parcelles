// Étiquettes de parcelle sur la carte (n° 45) : contenu selon le zoom, position au pôle
// d'inaccessibilité et élimination des chevauchements. Logique pure, sans Leaflet ni DOM.
import {filterGrazingSessions,grazingTotal,grazingType} from './grazing.js';

export const LARGE_PARCEL_HA=5;

// Pôle d'inaccessibilité (algorithme « polylabel » de Mapbox) : le point intérieur le plus éloigné
// des bords, toujours dans la parcelle même en L ou en U, contrairement au centroïde.
function segDistSq(px,py,a,b){
  let x=a[0],y=a[1],dx=b[0]-x,dy=b[1]-y;
  if(dx||dy){const t=((px-x)*dx+(py-y)*dy)/(dx*dx+dy*dy);if(t>1){x=b[0];y=b[1];}else if(t>0){x+=dx*t;y+=dy*t;}}
  dx=px-x;dy=py-y;return dx*dx+dy*dy;
}
function signedDistance(x,y,rings){
  let inside=false,min=Infinity;
  for(const ring of rings)for(let i=0,len=ring.length,j=len-1;i<len;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    min=Math.min(min,segDistSq(x,y,a,b));
  }
  return min===Infinity?0:(inside?1:-1)*Math.sqrt(min);
}
const makeCell=(x,y,h,rings)=>{const d=signedDistance(x,y,rings);return {x,y,h,d,max:d+h*Math.SQRT2};};
function centroidCell(rings){
  const ring=rings[0];let area=0,x=0,y=0;
  for(let i=0,len=ring.length,j=len-1;i<len;j=i++){const a=ring[i],b=ring[j],f=a[0]*b[1]-b[0]*a[1];x+=(a[0]+b[0])*f;y+=(a[1]+b[1])*f;area+=f*3;}
  return area?makeCell(x/area,y/area,0,rings):makeCell(ring[0][0],ring[0][1],0,rings);
}
export function polylabel(rings,precision){
  const outer=rings?.[0];if(!outer?.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y] of outer){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const width=maxX-minX,height=maxY-minY,size=Math.min(width,height);
  if(!size)return [minX,minY];
  const eps=precision??Math.max(width,height)/200;
  const queue=[];
  for(let x=minX;x<maxX;x+=size)for(let y=minY;y<maxY;y+=size)queue.push(makeCell(x+size/2,y+size/2,size/2,rings));
  let best=centroidCell(rings);const box=makeCell(minX+width/2,minY+height/2,0,rings);if(box.d>best.d)best=box;
  for(let guard=0;queue.length&&guard<20000;guard++){
    let k=0;for(let i=1;i<queue.length;i++)if(queue[i].max>queue[k].max)k=i;
    const cell=queue.splice(k,1)[0];
    if(cell.d>best.d)best=cell;
    if(cell.max-best.d<=eps)continue;
    const h=cell.h/2;for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]])queue.push(makeCell(cell.x+dx*h,cell.y+dy*h,h,rings));
  }
  return [best.x,best.y];
}

const ringArea=ring=>{let a=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a+=(ring[j][0]-ring[i][0])*(ring[j][1]+ring[i][1]);return Math.abs(a/2);};
// Point d'étiquette [lng, lat] d'une géométrie GeoJSON ; longitudes mises à l'échelle du cosinus de la latitude.
export function labelPoint(geometry){
  if(!geometry)return null;
  if(geometry.type==='Point')return geometry.coordinates?.slice(0,2)||null;
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  const polygon=polygons.filter(p=>p?.[0]?.length>=3).sort((a,b)=>ringArea(b[0])-ringArea(a[0]))[0];if(!polygon)return null;
  const lat0=polygon[0].reduce((s,c)=>s+c[1],0)/polygon[0].length,k=Math.cos(lat0*Math.PI/180)||1;
  const point=polylabel(polygon.map(ring=>ring.map(([x,y])=>[x*k,y])));
  return point?[point[0]/k,point[1]]:null;
}

// Niveau d'étiquette : 14 et moins, grandes parcelles seulement ; 15 le nom ; 16 et plus, deux lignes.
export function labelLevel(zoom,areaHa,{largeHa=LARGE_PARCEL_HA}={}){
  if(zoom>=16)return 'full';
  if(zoom>=15)return 'name';
  return Number(areaHa)>=largeHa?'name':'none';
}

const ha=value=>`${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(Number(value)||0)} ha`;
export function labelLines(parcel,{level='name',colorMode='culture',grazingSessions=[],date=new Date(),areaHa=null}={}){
  if(level==='none'||!parcel?.nom)return [];
  const lines=[String(parcel.nom)];if(level!=='full')return lines;
  if(colorMode==='animals'){
    const sessions=filterGrazingSessions(grazingSessions,{parcelId:parcel.id,date});
    if(sessions.length){const first=sessions[0];lines.push(`${grazingType(first)} · ${grazingTotal(first)}${sessions.length>1?` + ${sessions.length-1} lot${sessions.length>2?'s':''}`:''}`);}
    return lines;
  }
  const surface=Number(parcel.surfaceHa)||Number(areaHa)||0;
  const second=[parcel.culture,surface?ha(surface):''].filter(Boolean).join(' · ');
  if(second)lines.push(second);
  return lines;
}

// Rectangles écran {x,y,w,h}. Les étiquettes prioritaires (plus grandes parcelles, sélection) sont
// placées d'abord ; une étiquette est masquée si elle déborde de sa parcelle ou chevauche une autre.
const overlaps=(a,b,m)=>a.x<b.x+b.w+m&&b.x<a.x+a.w+m&&a.y<b.y+b.h+m&&b.y<a.y+a.h+m;
export function resolveLabelCollisions(items,{margin=2,fits=null}={}){
  const placed=[],visible=new Set();
  for(const item of [...items].sort((a,b)=>(b.priority||0)-(a.priority||0))){
    if(!item.rect)continue;
    const inside=fits?fits(item):!item.bounds||(item.rect.x>=item.bounds.x-1&&item.rect.y>=item.bounds.y-1&&item.rect.x+item.rect.w<=item.bounds.x+item.bounds.w+1&&item.rect.y+item.rect.h<=item.bounds.y+item.bounds.h+1);
    if(!inside||placed.some(rect=>overlaps(rect,item.rect,margin)))continue;
    placed.push(item.rect);visible.add(item.id);
  }
  return visible;
}
