export const APP_VERSION = 4;
export const BUILD_ID = '2026.09.14-deployfix.2';
export const ENTITY_TYPES = [
  'parcelles','interventions','tasks','rotations','grazingSessions','materiels',
  'products','clients','documents','photos','points','templates','importSessions','syncConflicts'
];

export const uid = (prefix = 'obj') => `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
export const clone = value => structuredClone(value);
export const now = () => Date.now();
export const isoDate = value => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0,10);
};
export const localDate = value => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(d);
};
export const localDateTime = value => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
export const formatNumber = value => new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(value)||0);
export const formatEuro = value => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(Number(value)||0);
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g,' ').trim();
export const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

export function toNullableNumber(value){
  if (value === null || value === undefined || String(value).trim()==='') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim().replace(/\s/g,'').replace(',', '.').replace(/[^0-9.eE+-]/g,'');
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
export const toNumber = value => toNullableNumber(value) ?? 0;

export const campaignFor = dateValue => {
  const date = new Date(dateValue || Date.now());
  const year = date.getFullYear() - (date.getMonth() < 7 ? 1 : 0);
  return `${year}/${String(year + 1).slice(-2)}`;
};

export function parseImportDate(value){
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date, including the historical 1900 leap-year bug correction.
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : isoDate(d);
  }
  const raw = String(value).trim();
  let m = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]); if(year < 100) year += year >= 70 ? 1900 : 2000;
    const d = new Date(Date.UTC(year,Number(m[2])-1,Number(m[1])));
    if(d.getUTCFullYear()===year && d.getUTCMonth()===Number(m[2])-1 && d.getUTCDate()===Number(m[1])) return isoDate(d);
    return null;
  }
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : isoDate(d);
}

export const safeJsonParse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };

export async function checksum(value){
  const source = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(hash)].map(item => item.toString(16).padStart(2,'0')).join('');
}

export function download(filename, text, type = 'application/json;charset=utf-8'){
  downloadBlob(filename,new Blob([text],{type}));
}
export function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ringAreaPlanar(ring){
  return ring.reduce((sum,point,index)=>{
    const next=ring[(index+1)%ring.length];
    return sum + (point[0]*next[1]-next[0]*point[1]);
  },0)/2;
}

export function geometryAreaHa(geometry){
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) return 0;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const degreesToMeters = 111320;
  return Math.abs(polygons.reduce((total, polygon) => total + polygon.reduce((ringTotal, ring, index) => {
    if (!ring?.length) return ringTotal;
    const latitude = ring.reduce((sum, point) => sum + point[1],0) / ring.length;
    const projected = ring.map(([lon,lat]) => [lon * degreesToMeters * Math.cos(latitude*Math.PI/180), lat * degreesToMeters]);
    const area = Math.abs(ringAreaPlanar(projected));
    return ringTotal + (index ? -area : area);
  },0),0)) / 10000;
}

export function geometryBbox(geometry){
  const points=[];
  const walk=value=>{
    if(!Array.isArray(value)) return;
    if(value.length>=2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) { points.push(value); return; }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  if(!points.length)return null;
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}

export function geometryCentroid(geometry){
  const bbox=geometryBbox(geometry); if(!bbox)return null;
  return {longitude:(bbox[0]+bbox[2])/2, latitude:(bbox[1]+bbox[3])/2};
}

export function haversineMeters(a,b){
  if(!a||!b)return Infinity;
  const R=6371000,rad=x=>x*Math.PI/180;
  const dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);
  const lat1=rad(a.latitude),lat2=rad(b.latitude);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function pointInRing([x,y],ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const intersect=((yi>y)!==(yj>y)) && x < (xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi;
    if(intersect)inside=!inside;
  }
  return inside;
}
export function pointInGeometry(longitude,latitude,geometry){
  if(!geometry)return false;
  const point=[longitude,latitude];
  const containsPolygon=polygon=>polygon?.length && pointInRing(point,polygon[0]) && !polygon.slice(1).some(r=>pointInRing(point,r));
  if(geometry.type==='Polygon')return containsPolygon(geometry.coordinates);
  if(geometry.type==='MultiPolygon')return geometry.coordinates.some(containsPolygon);
  return false;
}

export function validateGeometry(geometry){
  const errors=[];
  if(!geometry)return errors;
  if(!['Point','Polygon','MultiPolygon'].includes(geometry.type)){errors.push('Géométrie non prise en charge');return errors;}
  const bbox=geometryBbox(geometry);
  if(!bbox || bbox.some(n=>!Number.isFinite(n))) errors.push('Coordonnées non numériques');
  else if(bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) errors.push('Coordonnées hors WGS84');
  const checkRing=ring=>{
    if(!Array.isArray(ring)||ring.length<4)return false;
    const a=ring[0],b=ring[ring.length-1];
    return a?.length>=2 && b?.length>=2 && Math.abs(a[0]-b[0])<1e-9 && Math.abs(a[1]-b[1])<1e-9;
  };
  if(geometry.type==='Polygon' && !geometry.coordinates.every(checkRing))errors.push('Anneau polygonal invalide ou non fermé');
  if(geometry.type==='MultiPolygon' && !geometry.coordinates.every(poly=>poly.every(checkRing)))errors.push('Anneau multipolygonal invalide ou non fermé');
  return errors;
}

export function validateParcel(parcel){
  const errors=[];
  if(!String(parcel.nom||'').trim())errors.push('Nom de parcelle manquant');
  if(parcel.surfaceHa!==undefined && parcel.surfaceHa!==null && (!Number.isFinite(Number(parcel.surfaceHa)) || Number(parcel.surfaceHa)<0))errors.push('Surface invalide');
  errors.push(...validateGeometry(parcel.geometry));
  return errors;
}
export function validateIntervention(intervention){
  const errors=[];
  if(!intervention.parcelId)errors.push('Parcelle obligatoire');
  if(!intervention.date || !parseImportDate(intervention.date))errors.push('Date invalide');
  if(!String(intervention.type||'').trim())errors.push('Type obligatoire');
  for(const key of ['cost','surfaceWorked','duration','fuel','productUnitPrice','machineCost','inputCost','operatorCost','otherCost']){
    if(intervention[key]!==undefined && intervention[key]!==null && Number(intervention[key])<0)errors.push(`${key} invalide`);
  }
  return errors;
}

export function fileLabel(bytes){
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} Ko`;
  return `${(bytes/(1024*1024)).toFixed(1)} Mo`;
}

export function slug(value){return normalize(value).replace(/\s+/g,'-') || 'sans-nom';}
