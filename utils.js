export const APP_VERSION = 3;
export const ENTITY_TYPES = ['parcelles','interventions','rotations','materiels','documents','photos','points'];

export const uid = (prefix = 'obj') => `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
export const clone = value => structuredClone(value);
export const now = () => Date.now();
export const isoDate = value => new Date(value).toISOString().slice(0,10);
export const localDate = value => new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(value));
export const localDateTime = value => new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export const formatNumber = value => new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(value)||0);
export const formatEuro = value => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(Number(value)||0);
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g,' ').trim();
export const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
export const toNumber = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '').trim().replace(/\s/g,'').replace(',', '.').replace(/[^0-9.-]/g,'');
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
};
export const campaignFor = dateValue => {
  const date = new Date(dateValue || Date.now());
  const year = date.getFullYear() - (date.getMonth() < 7 ? 1 : 0);
  return `${year}/${String(year + 1).slice(-2)}`;
};
export const safeJsonParse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };

export async function checksum(value){
  const source = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(hash)].map(item => item.toString(16).padStart(2,'0')).join('');
}

export function download(filename, text, type = 'application/json;charset=utf-8'){
  const url = URL.createObjectURL(new Blob([text], {type}));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function geometryAreaHa(geometry){
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) return 0;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const ringArea = ring => Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + (point[0] * next[1] - next[0] * point[1]);
  },0) / 2);
  // Approximation plane locale, suffisante pour signaler une incohérence d'import : la surface source reste prioritaire.
  const degreesToMeters = 111320;
  return polygons.reduce((total, polygon) => total + polygon.reduce((ringTotal, ring, index) => {
    if (!ring.length) return ringTotal;
    const latitude = ring.reduce((sum, point) => sum + point[1],0) / ring.length;
    const projected = ring.map(([lon,lat]) => [lon * degreesToMeters * Math.cos(latitude*Math.PI/180), lat * degreesToMeters]);
    const area = ringArea(projected);
    return ringTotal + (index ? -area : area);
  },0),0) / 10000;
}

export function validateParcel(parcel){
  const errors = [];
  if (!String(parcel.nom || '').trim()) errors.push('Nom de parcelle manquant');
  if (parcel.surfaceHa !== undefined && (!Number.isFinite(Number(parcel.surfaceHa)) || Number(parcel.surfaceHa) < 0)) errors.push('Surface invalide');
  if (parcel.geometry && !['Point','Polygon','MultiPolygon'].includes(parcel.geometry.type)) errors.push('Géométrie non prise en charge');
  return errors;
}

export function validateIntervention(intervention){
  const errors = [];
  if (!intervention.parcelId) errors.push('Parcelle obligatoire');
  if (!intervention.date || Number.isNaN(new Date(intervention.date).getTime())) errors.push('Date invalide');
  if (!String(intervention.type || '').trim()) errors.push('Type obligatoire');
  if (intervention.cost !== undefined && Number(intervention.cost) < 0) errors.push('Coût invalide');
  return errors;
}

export function fileLabel(bytes){
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} Ko`;
  return `${(bytes/(1024*1024)).toFixed(1)} Mo`;
}
