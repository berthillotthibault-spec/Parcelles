// Opérations géométriques pures (aucun accès au DOM ni à Leaflet).
// Coordonnées GeoJSON [longitude, latitude]. Les calculs se font dans une projection
// locale équirectangulaire en mètres, suffisante à l'échelle d'une parcelle.

const M_PER_DEG=111320;

// Projection locale autour d'une latitude de référence.
export function localProjection(lat0){
  const kx=M_PER_DEG*Math.cos(lat0*Math.PI/180),ky=M_PER_DEG;
  return{
    toXY:([lon,lat])=>[lon*kx,lat*ky],
    toLonLat:([x,y])=>[x/kx,y/ky]
  };
}

// Anneau ouvert (sans le point de fermeture répété).
export function openRing(ring){
  const pts=(ring||[]).map(p=>[Number(p[0]),Number(p[1])]);
  if(pts.length>1&&samePoint(pts[0],pts[pts.length-1]))pts.pop();
  return pts;
}
export function closeRing(points){
  const pts=(points||[]).map(p=>[p[0],p[1]]);
  if(pts.length&&!samePoint(pts[0],pts[pts.length-1]))pts.push([pts[0][0],pts[0][1]]);
  return pts;
}
function samePoint(a,b,eps=1e-12){return Math.abs(a[0]-b[0])<=eps&&Math.abs(a[1]-b[1])<=eps;}

const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function onSegment(p,q,r){return Math.min(p[0],r[0])-1e-12<=q[0]&&q[0]<=Math.max(p[0],r[0])+1e-12&&Math.min(p[1],r[1])-1e-12<=q[1]&&q[1]<=Math.max(p[1],r[1])+1e-12;}

// Les segments [a,b] et [c,d] se coupent-ils (contact compris) ?
export function segmentsIntersect(a,b,c,d){
  const d1=cross(c,d,a),d2=cross(c,d,b),d3=cross(a,b,c),d4=cross(a,b,d);
  if(((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0)))return true;
  if(d1===0&&onSegment(c,a,d))return true;
  if(d2===0&&onSegment(c,b,d))return true;
  if(d3===0&&onSegment(a,c,b))return true;
  if(d4===0&&onSegment(a,d,b))return true;
  return false;
}

// Un anneau (ouvert ou fermé) se recoupe-t-il ? Les segments voisins partagent un
// sommet et ne comptent pas, sauf s'ils se replient l'un sur l'autre.
export function ringSelfIntersects(ring){
  const pts=openRing(ring),n=pts.length;
  if(n<3)return false;
  for(let i=0;i<n;i++){
    const a=pts[i],b=pts[(i+1)%n];
    if(samePoint(a,b))return true;
    for(let j=i+1;j<n;j++){
      const c=pts[j],d=pts[(j+1)%n];
      const adjacent=j===i+1||(i===0&&j===n-1);
      if(adjacent){
        // Repli : le sommet partagé est suivi d'un retour colinéaire sur le segment voisin.
        const shared=j===i+1?b:a,other1=j===i+1?a:b,other2=j===i+1?d:c;
        if(cross(shared,other1,other2)===0&&((other1[0]-shared[0])*(other2[0]-shared[0])+(other1[1]-shared[1])*(other2[1]-shared[1]))>0)return true;
        continue;
      }
      if(segmentsIntersect(a,b,c,d))return true;
    }
  }
  return false;
}

// Contrôle d'un contour avant enregistrement : message d'erreur ou null.
export function ringError(ring){
  const pts=openRing(ring);
  if(pts.length<3)return'Un contour doit garder au moins 3 sommets.';
  if(pts.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))return'Un sommet du contour est invalide.';
  if(ringSelfIntersects(pts))return'Le contour se croise lui-même : déplacez le sommet pour le démêler.';
  if(Math.abs(ringAreaM2(pts))<1)return'Le contour est trop petit ou plat.';
  return null;
}

// Surface signée en m² (positive dans le sens trigonométrique).
export function ringAreaM2(ring){
  const pts=openRing(ring);if(pts.length<3)return 0;
  const lat0=pts.reduce((s,p)=>s+p[1],0)/pts.length,{toXY}=localProjection(lat0),xy=pts.map(toXY);
  let s=0;for(let i=0;i<xy.length;i++){const a=xy[i],b=xy[(i+1)%xy.length];s+=a[0]*b[1]-b[0]*a[1];}
  return s/2;
}

// Périmètre en mètres d'un anneau (fermé implicitement).
export function ringPerimeterM(ring,{closed=true}={}){
  const pts=openRing(ring);if(pts.length<2)return 0;
  const lat0=pts.reduce((s,p)=>s+p[1],0)/pts.length,{toXY}=localProjection(lat0),xy=pts.map(toXY);
  let s=0;const n=closed&&xy.length>2?xy.length:xy.length-1;
  for(let i=0;i<n;i++){const a=xy[i],b=xy[(i+1)%xy.length];s+=Math.hypot(b[0]-a[0],b[1]-a[1]);}
  return s;
}

// ---------------------------------------------------------------------------
// n° 51 : découpe et fusion de polygones simples (sans trou, un seul polygone).

// Anneau extérieur d'une géométrie « simple » ou message d'erreur.
export function simpleRing(geometry){
  if(geometry?.type==='MultiPolygon'){
    if(geometry.coordinates.length!==1)return{error:'Parcelle en plusieurs morceaux (MultiPolygon) : opération non gérée.'};
    geometry={type:'Polygon',coordinates:geometry.coordinates[0]};
  }
  if(geometry?.type!=='Polygon')return{error:'Cette parcelle n’a pas de contour polygonal.'};
  if(geometry.coordinates.length>1)return{error:'Parcelle avec un trou (enclave) : opération non gérée.'};
  const ring=openRing(geometry.coordinates[0]);
  const error=ringError(ring);
  return error?{error}:{ring};
}

function segIntersection(a,b,c,d){
  const r=[b[0]-a[0],b[1]-a[1]],s=[d[0]-c[0],d[1]-c[1]],den=r[0]*s[1]-r[1]*s[0];
  if(Math.abs(den)<1e-12)return null;
  const t=((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0])/den,u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den;
  if(t<-1e-9||t>1+1e-9||u<-1e-9||u>1+1e-9)return null;
  return{t:Math.min(1,Math.max(0,t)),u:Math.min(1,Math.max(0,u)),p:[a[0]+t*r[0],a[1]+t*r[1]]};
}

// Sommets de l'anneau (n sommets) strictement après la position a et jusqu'à b, en avançant.
function ringBetween(ring,a,b){
  const n=ring.length,d=((b-a)%n+n)%n,out=[];
  for(let j=1;j<=n;j++){const v=(Math.floor(a)+j)%n,dist=((v-a)%n+n)%n;if(dist>1e-9&&dist<d-1e-9)out.push(ring[v]);else if(dist>=d-1e-9)break;}
  return out;
}

// Découpe d'un polygone simple par une polyligne qui le traverse une seule fois.
// Retour : {parts:[geometryA, geometryB]} ou {error}.
export function splitPolygonByLine(geometry,line){
  const base=simpleRing(geometry);if(base.error)return{error:base.error};
  const pts=(line||[]).map(p=>[Number(p[0]),Number(p[1])]);
  if(pts.length<2)return{error:'Tracez une ligne d’au moins deux points.'};
  const lat0=base.ring.reduce((s,p)=>s+p[1],0)/base.ring.length,{toXY,toLonLat}=localProjection(lat0);
  const ring=base.ring.map(toXY),path=pts.map(toXY),n=ring.length;
  for(let i=0;i<path.length-1;i++)for(let j=i+2;j<path.length-1;j++)if(segmentsIntersect(path[i],path[i+1],path[j],path[j+1]))return{error:'La ligne de découpe se croise elle-même.'};
  const hits=[];
  for(let s=0;s<path.length-1;s++)for(let e=0;e<n;e++){
    const x=segIntersection(path[s],path[s+1],ring[e],ring[(e+1)%n]);
    if(x)hits.push({seg:s,t:x.t,pos:e+x.u,p:x.p});
  }
  // Fusion des doublons (ligne passant exactement par un sommet).
  hits.sort((a,b)=>a.seg-b.seg||a.t-b.t);
  const uniq=hits.filter((h,i)=>!hits.slice(0,i).some(o=>Math.hypot(o.p[0]-h.p[0],o.p[1]-h.p[1])<1e-6));
  if(uniq.length<2)return{error:'La ligne doit traverser entièrement la parcelle, d’un bord à l’autre.'};
  if(uniq.length>2)return{error:'La ligne doit traverser la parcelle une seule fois.'};
  const [h1,h2]=uniq,cut=[h1.p,...path.slice(h1.seg+1,h2.seg+1),h2.p];
  const partA=[h1.p,...ringBetween(ring,h1.pos,h2.pos),h2.p,...cut.slice(1,-1).reverse()];
  const partB=[h2.p,...ringBetween(ring,h2.pos,h1.pos),h1.p,...cut.slice(1,-1)];
  const parts=[partA,partB].map(r=>r.map(toLonLat));
  for(const r of parts){const e=ringError(r);if(e)return{error:`Découpe impossible : ${e}`};}
  return{parts:parts.map(r=>({type:'Polygon',coordinates:[closeRing(r)]}))};
}

// Libellés d'orientation des deux morceaux : Nord/Sud ou Ouest/Est.
export function splitLabels(a,b){
  const c=g=>{const r=openRing(g.coordinates[0]);return[r.reduce((s,p)=>s+p[0],0)/r.length,r.reduce((s,p)=>s+p[1],0)/r.length];};
  const [ax,ay]=c(a),[bx,by]=c(b),k=Math.cos(((ay+by)/2)*Math.PI/180);
  if(Math.abs(ay-by)>=Math.abs(ax-bx)*k)return ay>by?['Nord','Sud']:['Sud','Nord'];
  return ax<bx?['Ouest','Est']:['Est','Ouest'];
}

function nearestOnSeg(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;const q=[a[0]+t*dx,a[1]+t*dy];return{q,t,d:Math.hypot(p[0]-q[0],p[1]-q[1])};}
const signedArea=r=>{let s=0;for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];s+=a[0]*b[1]-b[0]*a[1];}return s/2;};

// Accroche les sommets de `ring` sur les sommets puis les côtés de `other` (tolérance en m).
function snapRingTo(ring,other,tol){
  return ring.map(p=>{
    let best=null;for(const v of other){const d=Math.hypot(p[0]-v[0],p[1]-v[1]);if(d<=tol&&(!best||d<best.d))best={q:v,d};}
    if(best)return[...best.q];
    for(let i=0;i<other.length;i++){const r=nearestOnSeg(p,other[i],other[(i+1)%other.length]);if(r.d<=tol&&(!best||r.d<best.d))best=r;}
    return best?[...best.q]:p;
  });
}
// Insère dans `ring` les sommets de `other` situés sur ses côtés.
function insertTouching(ring,other,eps=1e-3){
  const out=[];
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];out.push(a);
    const on=other.map(p=>({p,...nearestOnSeg(p,a,b)})).filter(r=>r.d<=eps&&r.t>1e-9&&r.t<1-1e-9).sort((x,y)=>x.t-y.t);
    for(const r of on)out.push(r.q);
  }
  return out.filter((p,i)=>{const q=out[(i+1)%out.length];return Math.hypot(p[0]-q[0],p[1]-q[1])>eps;});
}

// Union de deux polygones simples adjacents (limites communes à 0,5 m près).
// Retour : {geometry} ou {error}.
export function unionPolygons(g1,g2,{tolerance=0.5}={}){
  const r1=simpleRing(g1),r2=simpleRing(g2);
  if(r1.error)return{error:r1.error};if(r2.error)return{error:r2.error};
  const lat0=[...r1.ring,...r2.ring].reduce((s,p)=>s+p[1],0)/(r1.ring.length+r2.ring.length),{toXY,toLonLat}=localProjection(lat0);
  let A=r1.ring.map(toXY),B=r2.ring.map(toXY);
  if(signedArea(A)<0)A.reverse();if(signedArea(B)<0)B.reverse();
  const areaSum=signedArea(A)+signedArea(B);
  B=snapRingTo(B,A,tolerance);A=snapRingTo(A,B,tolerance);
  A=insertTouching(A,B);B=insertTouching(B,A);
  const key=p=>`${Math.round(p[0]*1000)}:${Math.round(p[1]*1000)}`;
  const edges=[];for(const R of [A,B])for(let i=0;i<R.length;i++)edges.push({a:R[i],b:R[(i+1)%R.length],ka:key(R[i]),kb:key(R[(i+1)%R.length])});
  const count=new Map();for(const e of edges)count.set(`${e.ka}>${e.kb}`,(count.get(`${e.ka}>${e.kb}`)||0)+1);
  const shared=edges.filter(e=>count.has(`${e.kb}>${e.ka}`));
  if(!shared.length)return{error:'Les contours ne se touchent pas : fusion impossible.'};
  const rest=edges.filter(e=>!count.has(`${e.kb}>${e.ka}`));
  const byStart=new Map();for(const e of rest){if(byStart.has(e.ka))return{error:'Les contours se touchent en un seul point ou se chevauchent : fusion non gérée.'};byStart.set(e.ka,e);}
  const ring=[];let e=rest[0];const used=new Set();
  while(e&&!used.has(e)){used.add(e);ring.push(e.a);e=byStart.get(e.kb);}
  if(used.size!==rest.length)return{error:'La fusion créerait un trou ou plusieurs morceaux : non gérée.'};
  // Retire les sommets alignés laissés par l'ancienne limite.
  const clean=ring.filter((p,i)=>{const a=ring[(i-1+ring.length)%ring.length],b=ring[(i+1)%ring.length];return Math.abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]))>1e-6*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]));});
  const area=signedArea(clean);
  if(Math.abs(area-areaSum)>Math.max(1,areaSum*0.02))return{error:'Les contours se chevauchent : fusion non gérée.'};
  const lonlat=clean.map(toLonLat),error=ringError(lonlat);
  if(error)return{error:`Fusion impossible : ${error}`};
  return{geometry:{type:'Polygon',coordinates:[closeRing(lonlat)]}};
}
