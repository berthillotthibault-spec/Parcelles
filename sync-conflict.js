// n° 131 : conflit de synchronisation lisible, champ par champ (logique pure, sans DOM).
// Rien n'est jamais choisi à la place de l'utilisateur pour un vrai conflit : la fusion n'est
// construite qu'à partir de choix explicites, les champs identiques restant inchangés.
import {canonicalData, ignoredMergeKeys} from './security.js';

// Champs jamais présentés : identité et métadonnées techniques de synchronisation.
const HIDDEN_KEYS = new Set([...ignoredMergeKeys, 'id', 'createdAt', 'source', 'sourceId', 'campaignId', 'cloudPath']);

const FIELD_LABELS = {
  nom: 'Nom', name: 'Nom', title: 'Titre', culture: 'Culture', variety: 'Variété', surfaceHa: 'Surface', surfaceWorked: 'Surface travaillée',
  commune: 'Commune', ilot: 'Îlot', geometry: 'Contour', ownershipType: 'Statut foncier', exploitant: 'Exploitant', favorite: 'Favorite',
  notes: 'Notes', note: 'Note', status: 'Statut', type: 'Type', date: 'Date', plannedDate: 'Date prévue', dueDate: 'Échéance',
  startTime: 'Heure de début', endTime: 'Heure de fin', product: 'Produit', dose: 'Dose', doseUnit: 'Unité de dose', quantity: 'Quantité',
  unit: 'Unité', unitPrice: 'Prix unitaire', cost: 'Coût', operator: 'Opérateur', equipmentId: 'Matériel', parcelId: 'Parcelle',
  parcelIds: 'Parcelles', clientId: 'Client', deletedAt: 'Suppression', animalType: 'Animaux', animalsCount: 'Nombre d’animaux',
  animals: 'Animaux du lot', startDate: 'Entrée', endDate: 'Sortie', products: 'Produits', alertBelow: 'Seuil d’alerte',
  category: 'Catégorie', location: 'Emplacement', tags: 'Étiquettes', description: 'Description', latitude: 'Latitude', longitude: 'Longitude'
};
const UNITS = {surfaceHa: 'ha', surfaceWorked: 'ha'};

const isEmpty = value => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
const pad = n => String(n).padStart(2, '0');
const number = value => Number(value).toLocaleString('fr-FR', {maximumFractionDigits: 2});

export function fieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLocaleLowerCase('fr');
  return words.charAt(0).toLocaleUpperCase('fr') + words.slice(1);
}

// « 14 h 02 », précédé de la date si ce n'est pas aujourd'hui.
export function clockLabel(ms, now = Date.now()) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  const d = new Date(value), today = new Date(now);
  const time = `${d.getHours()} h ${pad(d.getMinutes())}`;
  return d.toDateString() === today.toDateString() ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${time}`;
}

// Valeur affichée : dates en français, surfaces en ha, doses avec leur unité, contours résumés.
export function formatFieldValue(key, value, entity = {}, {parcelName} = {}) {
  if (isEmpty(value)) return '(vide)';
  if (key === 'deletedAt') return `Supprimé le ${clockLabel(value)}`;
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (/At$/.test(key) && Number.isFinite(Number(value))) return clockLabel(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {const [y, m, d] = value.slice(0, 10).split('-');return `${d}/${m}/${y}${value.length > 10 && /T\d{2}:\d{2}/.test(value) ? ` à ${Number(value.slice(11, 13))} h ${value.slice(14, 16)}` : ''}`;}
  if ((key === 'parcelId' || key === 'parcelIds') && parcelName) return (Array.isArray(value) ? value : [value]).map(id => parcelName(id) || 'Parcelle inconnue').join(', ');
  if (key === 'geometry' && value && typeof value === 'object') {
    const points = JSON.stringify(value.coordinates || []).match(/\[-?\d+(\.\d+)?,-?\d+(\.\d+)?\]/g)?.length || 0;
    const parts = value.type === 'MultiPolygon' ? value.coordinates?.length || 0 : 1;
    return `Contour · ${parts > 1 ? `${parts} morceaux, ` : ''}${points} points`;
  }
  if (typeof value === 'number' || (key === 'dose' && Number.isFinite(Number(value)))) {
    if (key === 'dose') return `${number(value)}${entity.doseUnit ? ` ${entity.doseUnit}` : ''}`;
    if (/(cost|price|Price|Cost)$/.test(key)) return `${number(value)} €`;
    return `${number(value)}${UNITS[key] ? ` ${UNITS[key]}` : ''}`;
  }
  if (Array.isArray(value)) {
    if (value.every(item => item && typeof item === 'object')) return `${value.length} élément${value.length > 1 ? 's' : ''}${value.some(item => item.name || item.nom) ? ` : ${value.map(item => item.name || item.nom || '').filter(Boolean).slice(0, 4).join(', ')}${value.length > 4 ? '…' : ''}` : ''}`;
    return value.map(String).join(', ');
  }
  if (typeof value === 'object') {const text = JSON.stringify(value);return text.length > 120 ? `${text.slice(0, 117)}…` : text;}
  return String(value);
}

export function entityTitle(type, entity = {}, {parcelName} = {}) {
  const e = entity || {};
  const name = e.nom || e.title || e.name || e.label || e.type || '';
  const parcel = type !== 'parcelles' && e.parcelId && parcelName ? parcelName(e.parcelId) : '';
  return [String(name).trim(), parcel].filter(Boolean).join(' — ') || 'Fiche sans nom';
}

// Lignes du conflit : chaque champ affiché une fois, avec son statut.
// - same : identique des deux côtés (replié) ;
// - fill : un seul côté renseigné (valeur proposée : la renseignée) ;
// - conflict : deux valeurs différentes (choix obligatoire).
export function conflictFieldRows(conflict = {}, options = {}) {
  const local = conflict.local || {}, remote = conflict.remote || {};
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter(key => !HIDDEN_KEYS.has(key));
  const auto = conflict.autoFields && typeof conflict.autoFields === 'object' ? conflict.autoFields : {};
  const threeWay = conflict.mergeMode === 'three-way' && Array.isArray(conflict.conflictFields), conflictKeys = new Set(threeWay ? conflict.conflictFields : []);
  const rows = keys.map(key => {
    const a = local[key], b = remote[key];
    let kind = canonicalData(a) === canonicalData(b) ? 'same' : key !== 'deletedAt' && (isEmpty(a) || isEmpty(b)) ? 'fill' : 'conflict';
    let suggested = kind === 'fill' ? (isEmpty(a) ? 'remote' : 'local') : kind === 'same' ? 'local' : null;
    // n° 134 : fusion à trois voies connue → seuls les champs modifiés des deux côtés sont à choisir.
    if (threeWay && kind !== 'same') {
      if (conflictKeys.has(key)) {kind = 'conflict';suggested = null;}
      else if (auto[key]) {kind = 'fill';suggested = auto[key];}
    }
    return {key, label: fieldLabel(key), kind, local: a, remote: b, suggested,
      localText: formatFieldValue(key, a, local, options), remoteText: formatFieldValue(key, b, remote, options)};
  });
  const order = {conflict: 0, fill: 1, same: 2};
  return rows.sort((x, y) => order[x.kind] - order[y.kind] || x.label.localeCompare(y.label, 'fr'));
}

// Pastilles d'origine : « Sur ce téléphone · vous, 14 h 02 » / « Dans le cloud · paul@…, 13 h 40 ».
export function conflictSources(conflict = {}, {deviceNoun = 'cet appareil', now = Date.now()} = {}) {
  const local = conflict.local || {}, remote = conflict.remote || {}, meta = conflict.remoteMeta || {};
  const who = meta.modifiedEmail || (meta.deviceName ? meta.deviceName : meta.deviceId ? 'un autre appareil' : 'un autre appareil');
  const localTime = clockLabel(local.updatedAt, now), remoteTime = clockLabel(meta.updatedAt || remote.updatedAt, now);
  return {
    local: `Sur ${deviceNoun} · vous${localTime ? `, ${localTime}` : ''}`,
    remote: `Dans le cloud · ${who}${remoteTime ? `, ${remoteTime}` : ''}`
  };
}

// Champs restant à choisir (vrais conflits sans choix).
export function missingChoices(rows, choices = {}) {
  return rows.filter(row => row.kind === 'conflict' && !['local', 'remote'].includes(choices[row.key])).map(row => row.key);
}

// Objet fusionné : la version locale, puis pour chaque champ différent la valeur choisie (ou proposée).
// Un champ absent du côté choisi devient null (store.upsert fusionne avec la fiche existante).
export function buildMergedEntity(conflict = {}, choices = {}, rows = conflictFieldRows(conflict)) {
  const missing = missingChoices(rows, choices);
  if (missing.length) throw new Error(`Choisissez une version pour : ${missing.map(fieldLabel).join(', ')}.`);
  const local = conflict.local || {}, remote = conflict.remote || {};
  const merged = structuredClone(Object.keys(local).length ? local : remote);
  for (const row of rows) {
    if (row.kind === 'same') continue;
    const side = choices[row.key] || row.suggested;
    const source = side === 'remote' ? remote : local;
    merged[row.key] = row.key in source ? structuredClone(source[row.key]) : null;
  }
  merged.id = local.id || remote.id || conflict.entityId;
  merged.version = Math.max(Number(local.version) || 0, Number(remote.version) || 0);
  return merged;
}

export function openConflicts(data = {}) {
  return (Array.isArray(data.syncConflicts) ? data.syncConflicts : []).filter(c => c && c.status === 'open' && !c.deletedAt);
}
