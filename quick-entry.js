// n° 8 — Saisie express « J’ai fait… » : logique pure, testable sous node:test.
// Classe les types de travaux et les parcelles probables, puis prépare le travail terminé
// enregistré d’un seul geste. Aucune donnée n’est inventée : seules l’historique et les modèles
// de l’exploitation servent, complétés par quelques types courants quand l’historique est vide.
import {campaignFor} from './utils.js';
import {locateParcels} from './field-ops.js';

export const QUICK_TYPE_LIMIT = 6;
export const QUICK_PARCEL_LIMIT = 3;
// Au-delà de cette précision, la position ne suffit pas à choisir la parcelle à la place de l’utilisateur.
export const GPS_MAX_ACCURACY_M = 30;
// Une position plus ancienne n’est plus utilisée pour présélectionner.
export const GPS_MAX_AGE_MS = 3 * 60 * 1000;
// Distance maximale pour proposer une parcelle « proche ».
export const NEAR_MAX_DISTANCE_M = 2000;
export const FALLBACK_TYPES = ['Fauche', 'Semis', 'Fertilisation', 'Traitement', 'Travail du sol', 'Récolte'];

const DONE = new Set(['terminé', 'terminée', 'termine', 'terminee']);
export const normalizeType = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const isDone = work => DONE.has(normalizeType(work?.status));
const stamp = work => Math.max(Number(work?.updatedAt) || 0, Date.parse(work?.date || '') || 0);

// Famille visuelle d’un type, pour l’icône de la pastille.
const FAMILIES = [
  ['spray', /(trait|desherb|fongi|insecti|herbici|pulver|phyto|regulat)/],
  ['harvest', /(recolt|moisson|battage|ensil|arrach|vendang)/],
  ['mow', /(fauch|fane|andain|foin|enrubann|pressage|botte|broy|gyrobroy)/],
  ['seed', /(semi|semer|implant|plantat|resemi|sursemi)/],
  ['fertilize', /(fertili|engrais|epand|fumier|lisier|azote|amendement|chaul|ammonitr|compost)/],
  ['soil', /(labour|dechaum|hers|sol|rouleau|rotative|cultivat|scarif|decompact|bin)/],
  ['graze', /(patur|clotur|abreuv|troupeau|betail|vache)/]
];
export function typeFamily(type) {
  const key = normalizeType(type);
  return FAMILIES.find(([, re]) => re.test(key))?.[0] || 'other';
}
// Un traitement phytosanitaire doit être complété (produit, dose, AMM) pour le registre.
export const isPhytoType = type => typeFamily(type) === 'spray';

// Les types les plus fréquents (travaux terminés d’abord, puis tous les travaux, puis les modèles),
// à égalité le plus récent. Complété par les types courants si l’historique est court.
const RANK = {done: 0, planned: 1, template: 2};
export function rankTypes(data = {}, {limit = QUICK_TYPE_LIMIT, fallback = FALLBACK_TYPES} = {}) {
  const groups = new Map();
  const add = (type, weight, at, source) => {
    const key = normalizeType(type);
    if (!key) return;
    const previous = groups.get(key);
    const label = String(type).trim().replace(/\s+/g, ' ');
    if (!previous) groups.set(key, {type: label, score: weight, count: weight >= 1 ? 1 : 0, lastAt: at, source});
    else {
      previous.score += weight;
      if (weight >= 1) previous.count += 1;
      if (RANK[source] < RANK[previous.source]) previous.source = source;
      if (at >= previous.lastAt) {previous.lastAt = at; previous.type = label;}
    }
  };
  for (const work of live(data.interventions)) add(work.type, isDone(work) ? 1 : 0.5, stamp(work), isDone(work) ? 'done' : 'planned');
  for (const template of live(data.templates)) add(template.type || template.name, 0.25, Number(template.updatedAt) || 0, 'template');
  const ranked = [...groups.values()].sort((a, b) => b.score - a.score || b.lastAt - a.lastAt || a.type.localeCompare(b.type, 'fr'));
  const out = ranked.slice(0, limit).map(g => ({type: g.type, count: g.count, family: typeFamily(g.type), source: g.source, suggested: false}));
  for (const type of fallback) {
    if (out.length >= limit) break;
    if (!out.some(item => normalizeType(item.type) === normalizeType(type))) out.push({type, count: 0, family: typeFamily(type), source: 'suggested', suggested: true});
  }
  return out;
}

// Dernier engin et opérateur utilisés pour ce type ; l’engin n’est repris que s’il existe encore.
export function defaultsFor(type, data = {}) {
  const key = normalizeType(type);
  const same = live(data.interventions).filter(w => normalizeType(w.type) === key).sort((a, b) => (isDone(b) - isDone(a)) || stamp(b) - stamp(a));
  const machines = new Set(live(data.materiels).map(m => m.id));
  const withMachine = same.find(w => w.equipmentId && machines.has(w.equipmentId));
  const withOperator = same.find(w => String(w.operator || '').trim());
  return {
    equipmentId: withMachine?.equipmentId || '',
    operator: String(withOperator?.operator || data.preferences?.defaultOperator || '').trim()
  };
}

const usablePosition = (gps, now) => {
  if (!gps || !Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) return null;
  if (gps.at && now - Number(gps.at) > GPS_MAX_AGE_MS) return null;
  return gps;
};

// Parcelle présélectionnée et pastilles proposées.
// Ordre : parcelle imposée par le contexte (mode terrain), sinon la parcelle sous les pieds si le GPS
// est assez précis ; pastilles : parcelles proches, puis récentes (consultées ou travaillées), puis favorites.
export function rankParcels(data = {}, {gps = null, contextId = null, recentIds = [], limit = QUICK_PARCEL_LIMIT, now = Date.now()} = {}) {
  const parcels = live(data.parcelles).filter(p => !p.archived);
  const byId = new Map(parcels.map(p => [p.id, p]));
  let selectedId = null, reason = null, accuracy = null, imprecise = false;
  const distances = new Map();
  const position = usablePosition(gps, now);
  if (position) {
    accuracy = Number.isFinite(Number(position.accuracy)) ? Number(position.accuracy) : null;
    const rows = locateParcels(position, parcels);
    for (const row of rows) distances.set(row.parcel.id, row.inside ? 0 : row.distance);
    const inside = rows.find(r => r.inside);
    if (inside) {
      if (accuracy !== null && accuracy <= GPS_MAX_ACCURACY_M) {selectedId = inside.parcel.id; reason = 'gps';}
      else imprecise = true;
    } else if (accuracy !== null && accuracy > GPS_MAX_ACCURACY_M) imprecise = true;
  }
  if (contextId && byId.has(contextId)) {selectedId = contextId; reason = 'context';}
  const order = [];
  const push = id => {if (id && byId.has(id) && !order.includes(id)) order.push(id);};
  push(selectedId);
  [...distances.entries()].filter(([, d]) => d <= NEAR_MAX_DISTANCE_M).sort((a, b) => a[1] - b[1]).forEach(([id]) => push(id));
  (Array.isArray(recentIds) ? recentIds : []).forEach(push);
  live(data.interventions).sort((a, b) => stamp(b) - stamp(a)).forEach(w => push(w.parcelId));
  parcels.filter(p => p.favorite).forEach(p => push(p.id));
  parcels.forEach(p => push(p.id));
  const chips = order.slice(0, Math.max(limit, selectedId ? 1 : 0)).map(id => ({parcel: byId.get(id), distance: distances.has(id) ? distances.get(id) : null}));
  return {selectedId, reason, accuracy, imprecise, chips};
}

// Travail terminé, daté du jour, avec la surface de la parcelle et les derniers engin et opérateur du type.
export function buildQuickWork({type, parcel, data = {}, today}) {
  const label = String(type || '').trim().replace(/\s+/g, ' ');
  if (!label) throw new Error('Champ obligatoire : type de travail.');
  if (!parcel?.id) throw new Error('Champ obligatoire : parcelle.');
  const date = String(today || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date du jour invalide.');
  const {equipmentId, operator} = defaultsFor(label, data);
  const area = Number(parcel.surfaceHa);
  const surfaceWorked = Number.isFinite(area) && area > 0 ? area : null;
  const work = {
    parcelId: parcel.id, type: label, status: 'Terminé', date, plannedDate: '',
    culture: parcel.culture || '', surfaceWorked, operator, equipmentId,
    campaignId: campaignFor(date), source: 'local',
    actualMetrics: {areaHa: surfaceWorked, dose: null, duration: null}
  };
  if (isPhytoType(label)) work.isPhytosanitary = true;
  return work;
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined || !Number.isFinite(Number(meters))) return '';
  const m = Number(meters);
  if (m <= 0) return 'ici';
  if (m < 1000) return `${Math.round(m / 10) * 10 || 10} m`;
  return `${(m / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 1})} km`;
}
