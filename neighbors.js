// n° 61 - Riverains, ruchers et voisins : information avant traitement. Logique pure.
// Aide indicative : elle ne remplace ni la charte d'engagements départementale ni l'étiquette.
import {normalize} from './utils.js';

export const NEIGHBOR_TYPES=Object.freeze(['Habitation','Rucher (contact apiculteur)','Établissement sensible']);
export const NEIGHBOR_RADIUS_DEFAULT=100;
export const NEIGHBOR_RADIUS_CHOICES=Object.freeze([20,50,100,200,500]);
const KIND={Habitation:'habitation','Rucher (contact apiculteur)':'rucher','Établissement sensible':'etablissement'};
const WORDS={habitation:['habitation','habitations'],rucher:['rucher','ruchers'],etablissement:['établissement sensible','établissements sensibles']};
export const BEE_REMINDER='Colza en fleur : traiter après le coucher du soleil, avec un produit portant la mention abeilles.';
export const NEIGHBOR_SOURCE='Information des riverains : chartes d’engagements départementales (code rural, art. L253-8). Aide indicative.';

export const neighborKind=point=>KIND[point?.type]||null;
export const isNeighborPoint=point=>Boolean(neighborKind(point));
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));

function inRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if(((yi>y)!==(yj>y))&&x<(xj-xi)*(y-yi)/(yj-yi||1e-12)+xi)inside=!inside;}return inside;}
// Distance en mètres d'un point au contour d'une parcelle (0 à l'intérieur).
export function distanceToParcel(point,geometry){
  const polys=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  if(!polys.length||!finite(point?.latitude)||!finite(point?.longitude))return null;
  const lat=Number(point.latitude),lon=Number(point.longitude),sx=111320*Math.cos(lat*Math.PI/180),sy=111320;
  for(const poly of polys)if(poly[0]&&inRing(lon,lat,poly[0])&&!poly.slice(1).some(h=>inRing(lon,lat,h)))return 0;
  let best=Infinity;
  for(const poly of polys)for(const ring of poly)for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],ax=(a[0]-lon)*sx,ay=(a[1]-lat)*sy,bx=(b[0]-lon)*sx,by=(b[1]-lat)*sy,dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy;
    const t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return Number.isFinite(best)?best:null;
}

// Riverains, ruchers et établissements à moins de radiusM du contour, du plus proche au plus éloigné.
export function neighborsNear(parcel,points=[],radiusM=NEIGHBOR_RADIUS_DEFAULT){
  if(!parcel?.geometry)return[];
  return(points||[]).filter(p=>p&&!p.deletedAt&&isNeighborPoint(p)).map(point=>({point,kind:neighborKind(point),distance:distanceToParcel(point,parcel.geometry)}))
    .filter(r=>r.distance!==null&&r.distance<=Number(radiusM)).sort((a,b)=>a.distance-b.distance);
}

// « 2 habitations et 1 rucher à proximité »
export function neighborSummary(rows=[]){
  const counts={habitation:0,rucher:0,etablissement:0};for(const r of rows||[])if(counts[r.kind]!==undefined)counts[r.kind]++;
  const parts=Object.entries(counts).filter(([,n])=>n).map(([k,n])=>`${n} ${WORDS[k][n>1?1:0]}`);
  if(!parts.length)return '';
  return `${parts.length>1?parts.slice(0,-1).join(', ')+' et '+parts.at(-1):parts[0]} à proximité`;
}

// Colza en floraison : stade saisi (floraison, F1, BBCH 60-69) ou, sans stade, mars à mai.
export function needsBeeReminder(parcel,{stage='',date=''}={}){
  if(!normalize(parcel?.culture||'').includes('colza'))return false;
  const s=normalize(stage||'');
  if(s){if(/fleur|florai|\bf[12]\b|bbch ?6\d/.test(s))return true;return false;}
  const m=Number(String(date||'').slice(5,7));return m>=3&&m<=5;
}

const frDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?`${m[3]}/${m[2]}/${m[1]}`:'';};
export function slotLabel(start='',end=''){if(start&&end)return `entre ${start} et ${end}`;if(start)return `à partir de ${start}`;return '';}

// Message pré-rédigé : date, créneau, produit. Aucune donnée inutile.
export function neighborMessage({parcel,work,farmName='',contactName=''}={}){
  const when=[frDate(work?.date),slotLabel(work?.startTime,work?.endTime)].filter(Boolean).join(' ');
  const product=work?.product?` (${work.product})`:'';
  const place=[parcel?.nom,parcel?.commune].filter(Boolean).join(', ');
  return `Bonjour${contactName?` ${contactName}`:''},\nNous prévoyons un traitement${product} sur la parcelle ${place||'voisine'}${when?` le ${when}`:''}.\nN’hésitez pas à nous contacter pour toute question.${farmName?`\n${farmName}`:''}`;
}
export const cleanPhone=v=>String(v||'').replace(/[^\d+]/g,'');
export function contactLinks(point,message,subject='Information avant traitement'){
  const out={};const phone=cleanPhone(point?.phone),email=String(point?.email||'').trim();
  if(phone)out.sms=`sms:${phone}?&body=${encodeURIComponent(message)}`;
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))out.mailto=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  return out;
}

// Coordonnées d'un tiers : enregistrées seulement avec son accord.
export function contactPatch(values={}){
  const name=String(values.contactName||'').trim(),phone=String(values.phone||'').trim(),email=String(values.email||'').trim(),consent=values.contactConsent===true||values.contactConsent==='1'||values.contactConsent==='on';
  if(!name&&!phone&&!email)return{contactName:'',phone:'',email:'',contactConsent:false,contactConsentAt:null};
  if(!consent)throw new Error('Cochez l’accord de la personne pour enregistrer ses coordonnées, ou laissez-les vides.');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Adresse e-mail invalide.');
  if(phone&&cleanPhone(phone).replace('+','').length<6)throw new Error('Numéro de téléphone invalide.');
  return{contactName:name.slice(0,120),phone:phone.slice(0,30),email:email.slice(0,160),contactConsent:true,contactConsentAt:values.contactConsentAt||Date.now()};
}
