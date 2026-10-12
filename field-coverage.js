// n° 42 - Enregistrement GPS du chantier : logique pure, sans DOM ni stockage.
// Échantillonnage des positions, simplification Douglas-Peucker, découpage en passages,
// bandes travaillées à la largeur de l'outil et couverture par grille (réutilise analyzeCoverage).
// Estimation GPS de téléphone : ce n'est pas du guidage RTK.
import {analyzeCoverage} from './application-coverage.js';
import {geometryBbox, haversineMeters} from './utils.js';

export const TRACK_LIMITS=Object.freeze({
  minMs:2000,        // un point toutes les 2 s...
  minM:3,            // ...ou tous les 3 m
  maxAccuracy:30,    // m : position trop imprécise ignorée
  toleranceM:0.8,    // tolérance de simplification
  turnDeg:60,        // virage au-delà duquel un nouveau passage commence
  gapMs:60000,       // interruption d'enregistrement au-delà de laquelle le point porte brk:1 (nouveau passage)
  maxPoints:5000,     // borne la taille du document synchronisé
  batchSize:15,      // points mis en tampon avant enregistrement
  batchMs:30000
});
export const COVERAGE_COLORS=Object.freeze({Couvert:'#31865b',Manque:'#e0892c',Recouvrement:'#c8402f'});

const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const R=111320;

// Point de trace compact et sans donnée superflue.
export function trackPoint(position,now=Date.now(),previous=null,limits={}){
  const lat=Number(position?.latitude),lon=Number(position?.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
  const p={lat:Math.round(lat*1e7)/1e7,lon:Math.round(lon*1e7)/1e7,t:Number(now)||Date.now()};
  if(finite(position.accuracy))p.acc=Math.round(Number(position.accuracy)*10)/10;
  // Interruption (écran verrouillé, signal perdu) : ne pas relier les deux morceaux.
  if(previous&&p.t-previous.t>({...TRACK_LIMITS,...limits}).gapMs)p.brk=1;
  return p;
}

const dist=(a,b)=>haversineMeters({latitude:a.lat,longitude:a.lon},{latitude:b.lat,longitude:b.lon});

// Faut-il garder cette position ? Oui si la précision est correcte et si 2 s ou 3 m se sont écoulés.
export function shouldRecord(previous,point,limits={}){
  const L={...TRACK_LIMITS,...limits};
  if(!point)return false;
  if(finite(point.acc)&&Number(point.acc)>L.maxAccuracy)return false;
  if(!previous)return true;
  return point.t-previous.t>=L.minMs||dist(previous,point)>=L.minM;
}

function projector(points){
  const lat0=points[0]?.lat||0,lon0=points[0]?.lon||0,k=Math.cos(lat0*Math.PI/180);
  return{xy:p=>[(p.lon-lon0)*R*k,(p.lat-lat0)*R],ll:([x,y])=>[lon0+x/(R*k),lat0+y/R]};
}

function segmentDistance(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
  let t=len?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len:0;t=Math.max(0,Math.min(1,t));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}

// Douglas-Peucker itératif (pas de récursion profonde sur une longue trace).
export function simplifyTrack(points=[],toleranceM=TRACK_LIMITS.toleranceM){
  const list=(points||[]).filter(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  if(list.length<3)return list.slice();
  const {xy}=projector(list),pts=list.map(xy),keep=new Uint8Array(list.length);
  keep[0]=1;keep[list.length-1]=1;
  // Les coupures sont conservées : chaque morceau est simplifié séparément.
  const cuts=[0];for(let i=1;i<list.length;i++)if(list[i].brk){keep[i]=1;keep[i-1]=1;cuts.push(i-1,i);}cuts.push(list.length-1);
  const stack=[];for(let i=0;i<cuts.length;i+=2)if(cuts[i+1]-cuts[i]>1)stack.push([cuts[i],cuts[i+1]]);
  while(stack.length){
    const [first,last]=stack.pop();let max=0,index=-1;
    for(let i=first+1;i<last;i++){const d=segmentDistance(pts[i],pts[first],pts[last]);if(d>max){max=d;index=i;}}
    if(index>0&&max>toleranceM){keep[index]=1;stack.push([first,index],[index,last]);}
  }
  return list.filter((_,i)=>keep[i]);
}

// Ajoute un paquet de points puis simplifie l'ensemble ; borne la taille stockée.
export function appendTrack(track=[],points=[],limits={}){
  const L={...TRACK_LIMITS,...limits};
  let merged=simplifyTrack([...(track||[]),...(points||[])].sort((a,b)=>a.t-b.t),L.toleranceM);
  if(merged.length>L.maxPoints)merged=simplifyTrack(merged,L.toleranceM*4).slice(-L.maxPoints);
  return merged;
}

const heading=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1]);
const angleDiff=(a,b)=>{let d=Math.abs(a-b)%(2*Math.PI);return d>Math.PI?2*Math.PI-d:d;};

// Découpe la trace en passages : virage marqué ou interruption longue.
export function splitPasses(points=[],limits={}){
  const L={...TRACK_LIMITS,...limits},list=(points||[]).filter(Boolean);
  if(list.length<2)return list.length?[list]:[];
  const {xy}=projector(list),pts=list.map(xy),passes=[];let current=[list[0]];
  for(let i=1;i<list.length;i++){
    if(list[i].brk){if(current.length)passes.push(current);current=[list[i]];continue;}
    current.push(list[i]);
    if(i<list.length-1&&current.length>=2){
      const turn=angleDiff(heading(pts[i-1],pts[i]),heading(pts[i],pts[i+1]))*180/Math.PI;
      if(turn>=L.turnDeg){passes.push(current);current=[list[i]];}
    }
  }
  if(current.length)passes.push(current);
  return passes.filter(p=>p.length>=2);
}

// Bande travaillée d'un passage : contour gauche puis droit, à la demi-largeur de l'outil.
export function passPolygon(pass,widthM){
  const w=Number(widthM);if(!(w>0)||!pass||pass.length<2)return null;
  const {xy,ll}=projector(pass),pts=pass.map(xy),half=w/2,left=[],right=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];
    let dx=b[0]-a[0],dy=b[1]-a[1];const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
    const nx=-dy*half,ny=dx*half;
    left.push([pts[i][0]+nx,pts[i][1]+ny]);right.push([pts[i][0]-nx,pts[i][1]-ny]);
  }
  const ring=[...left,...right.reverse()].map(ll);ring.push(ring[0].slice());
  return{type:'Polygon',coordinates:[ring]};
}

// Passages sous forme d'entités GeoJSON, compatibles avec analyzeCoverage (properties.rate).
export function trackSwathFeatures(track=[],widthM,limits={}){
  return splitPasses(track,limits).map((pass,index)=>{const geometry=passPolygon(pass,widthM);return geometry?{type:'Feature',geometry,properties:{rate:0,passage:index+1,largeur:Number(widthM)}}:null;}).filter(Boolean);
}

// Résolution la plus fine qui reste sous 25 000 cellules (limite d'analyzeCoverage).
export function pickResolution(geometry,choices=[2,5,10,20]){
  const b=geometryBbox(geometry);if(!b)return null;
  const h=(b[3]-b[1])*R,wd=(b[2]-b[0])*R*Math.cos((b[1]+b[3])/2*Math.PI/180);
  return choices.find(r=>Math.ceil(wd/r+1)*Math.ceil(h/r+1)<=25000)||null;
}

// Couverture estimée de la parcelle par la trace : couvert, manques et recouvrements.
export function trackCoverage(parcel,track=[],widthM,{resolution=null,limits={}}={}){
  if(!parcel?.geometry||!(Number(widthM)>0))return null;
  const res=resolution||pickResolution(parcel.geometry);if(!res)return null;
  const features=trackSwathFeatures(track,widthM,limits);
  const result=analyzeCoverage(parcel,features,{resolution:res});
  for(const cell of result.cells)cell.properties.color=COVERAGE_COLORS[cell.properties.classe];
  const percent=result.targetHa>0?Math.min(100,Math.round(result.coveredHa/result.targetHa*100)):0;
  return{...result,swaths:features,percent,remainingHa:Math.max(0,result.targetHa-result.coveredHa),widthM:Number(widthM)};
}

const fr=(n,d=1)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:0}).format(n);
export function coverageLabel(name,coverage){
  if(!coverage)return `${name||'Parcelle'} : couverture indisponible`;
  return `${name||'Parcelle'} : ${coverage.percent} % · reste ~${fr(coverage.remainingHa)} ha`;
}

export function trackLengthM(track=[]){let m=0;for(let i=1;i<(track||[]).length;i++)m+=dist(track[i-1],track[i]);return m;}

const xml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// Export GPX 1.1 : seules la position et l'heure de chaque point sont écrites.
export function trackToGpx(track=[],{name='Chantier'}={}){
  const pts=(track||[]).filter(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  const body=pts.map(p=>`<trkpt lat="${p.lat}" lon="${p.lon}">${Number.isFinite(p.t)?`<time>${new Date(p.t).toISOString()}</time>`:''}</trkpt>`).join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Parcelles" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${xml(name)}</name>\n    <trkseg>\n      ${body}\n    </trkseg>\n  </trk>\n</gpx>\n`;
}
