// n° 44 : accrochage aux limites (logique pure, en pixels écran).
// Index spatial par grille : chaque segment est rangé dans les cases que couvre
// sa boîte englobante ; une recherche ne lit que les cases autour du point.

export const SNAP_TOLERANCE_PX=12;

// rings : [{id, points:[{x,y}], closed=true}]
export function buildSnapIndex(rings,{cell=64}={}){
  const cells=new Map(),segments=[];
  const key=(i,j)=>`${i}:${j}`;
  for(const ring of rings||[]){
    const pts=ring.points||[],n=pts.length;if(n<2)continue;
    const last=ring.closed===false?n-1:n;
    for(let k=0;k<last;k++){
      const a=pts[k],b=pts[(k+1)%n];
      if(!Number.isFinite(a?.x)||!Number.isFinite(a?.y)||!Number.isFinite(b?.x)||!Number.isFinite(b?.y))continue;
      const seg={ringId:ring.id,index:k,a,b,n};segments.push(seg);
      const i0=Math.floor(Math.min(a.x,b.x)/cell),i1=Math.floor(Math.max(a.x,b.x)/cell),j0=Math.floor(Math.min(a.y,b.y)/cell),j1=Math.floor(Math.max(a.y,b.y)/cell);
      // Segments très longs à l'écran : on borne le nombre de cases parcourues.
      if((i1-i0+1)*(j1-j0+1)>4096){(cells.get('*')||cells.set('*',[]).get('*')).push(seg);continue;}
      for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const k2=key(i,j);(cells.get(k2)||cells.set(k2,[]).get(k2)).push(seg);}
    }
  }
  return{cell,cells,segments};
}

function nearestOnSegment(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
  const t=len2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2)):0;
  const x=a.x+t*dx,y=a.y+t*dy;
  return{x,y,t,d:Math.hypot(p.x-x,p.y-y)};
}

// Point accroché le plus proche à moins de `tolerance` pixels, sommets en priorité.
// Retour : {x,y,kind:'vertex'|'segment',ringId,index,t,distance} ou null.
export function snapPoint(index,p,{tolerance=SNAP_TOLERANCE_PX,exclude=null}={}){
  if(!index||!Number.isFinite(p?.x)||!Number.isFinite(p?.y))return null;
  const {cell,cells}=index,seen=new Set(),cand=[];
  const i0=Math.floor((p.x-tolerance)/cell),i1=Math.floor((p.x+tolerance)/cell),j0=Math.floor((p.y-tolerance)/cell),j1=Math.floor((p.y+tolerance)/cell);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(const s of cells.get(`${i}:${j}`)||[])if(!seen.has(s)){seen.add(s);cand.push(s);}
  for(const s of cells.get('*')||[])if(!seen.has(s)){seen.add(s);cand.push(s);}
  let vertex=null,segment=null;
  for(const s of cand){
    if(exclude&&exclude(s.ringId))continue;
    for(const [v,idx] of [[s.a,s.index],[s.b,(s.index+1)%s.n]]){const d=Math.hypot(p.x-v.x,p.y-v.y);if(d<=tolerance&&(!vertex||d<vertex.distance))vertex={x:v.x,y:v.y,kind:'vertex',ringId:s.ringId,index:idx,t:0,distance:d};}
    const q=nearestOnSegment(p,s.a,s.b);
    if(q.d<=tolerance&&(!segment||q.d<segment.distance))segment={x:q.x,y:q.y,kind:'segment',ringId:s.ringId,index:s.index,t:q.t,distance:q.d};
  }
  return vertex||segment;
}

// Position le long d'un anneau de n sommets : sommet k = k, segment k à t = k + t.
export function ringPosition(snap){return snap.kind==='vertex'?snap.index:snap.index+snap.t;}

// « Suivre la limite » : sommets de l'anneau situés strictement entre deux points
// accrochés au même contour, par le plus court chemin (en nombre de sommets).
// ring : sommets ouverts ; renvoie les indices dans l'ordre de parcours.
export function followBoundary(ringLength,from,to){
  const n=ringLength;if(!n||from.ringId!==to.ringId)return[];
  const a=ringPosition(from),b=ringPosition(to);if(Math.abs(a-b)<1e-9)return[];
  const forward=[],backward=[];
  // Sens direct : sommets k avec a < k < b (modulo n).
  const fwdEnd=b>a?b:b+n;for(let k=Math.floor(a)+1;k<fwdEnd-1e-9;k++)forward.push(k%n);
  const bwdEnd=a>b?b:b-n;for(let k=Math.ceil(a)-1;k>bwdEnd+1e-9;k--)backward.push(((k%n)+n)%n);
  return forward.length<=backward.length?forward:backward;
}
