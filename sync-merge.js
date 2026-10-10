// n° 134 : fusion à trois voies (base = dernière version synchronisée), logique pure.
// Règle par champ :
// - modifié seulement en local → valeur locale ;
// - modifié seulement à distance → valeur distante ;
// - modifié des deux côtés avec des valeurs différentes → vrai conflit (choix manuel, n° 131).
// Les tableaux d'objets avec id (animaux, produits…) sont fusionnés élément par élément.
// Prudence : toute situation douteuse est un conflit, jamais un choix silencieux.
import {canonicalData, ignoredMergeKeys} from './security.js';

const same = (a, b) => canonicalData(a) === canonicalData(b);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
// Tableau fusionnable par élément : uniquement des objets portant chacun un id distinct.
export function isIdArray(value) {
  if (!Array.isArray(value) || !value.length) return Array.isArray(value);
  if (!value.every(item => isRecord(item) && (typeof item.id === 'string' || typeof item.id === 'number') && String(item.id) !== '')) return false;
  return new Set(value.map(item => String(item.id))).size === value.length;
}

// Un élément d'un tableau à id : même règle qu'une fiche, champ par champ (sans les clés techniques).
function mergeRecord(base, local, remote) {
  const merged = {}, conflicts = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const r = mergeValue(key, base, local, remote);
    if (r.conflict) conflicts.push(key);
    else if (r.present) merged[key] = r.value;
  }
  return {merged, conflicts};
}

// Fusion d'un tableau d'objets à id. null si la fusion est impossible (conflit).
export function mergeIdArrays(base = [], local = [], remote = []) {
  if (![base, local, remote].every(isIdArray)) return null;
  const index = list => new Map(list.map(item => [String(item.id), item]));
  const b = index(base), l = index(local), r = index(remote);
  const result = new Map();
  const order = [...local.map(item => String(item.id)), ...remote.map(item => String(item.id)).filter(id => !l.has(id))];
  for (const id of new Set([...order, ...b.keys()])) {
    const inB = b.has(id), inL = l.has(id), inR = r.has(id);
    if (inL && inR) {
      if (same(l.get(id), r.get(id))) {result.set(id, structuredClone(l.get(id)));continue;}
      const m = mergeRecord(inB ? b.get(id) : {}, l.get(id), r.get(id));
      if (m.conflicts.length) return null;
      result.set(id, m.merged);
    } else if (inL && !inR) {
      // Retiré à distance : accepté seulement si l'élément local n'a pas changé depuis la base.
      if (!inB) result.set(id, structuredClone(l.get(id)));
      else if (!same(b.get(id), l.get(id))) return null;
    } else if (!inL && inR) {
      if (!inB) result.set(id, structuredClone(r.get(id)));
      else if (!same(b.get(id), r.get(id))) return null;
    }
  }
  return order.filter(id => result.has(id)).map(id => result.get(id));
}

// Valeur fusionnée d'un champ. present:false → champ retiré.
// Vide (absent, null, '' ou []) équivaut à vide : renseigner un champ vide n'est une modification que d'un côté.
const blank = value => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
const equal = (a, b) => (blank(a) && blank(b)) || same(a, b);
function mergeValue(key, base, local, remote) {
  const inL = has(local, key), inR = has(remote, key);
  const b = base[key], l = local[key], r = remote[key];
  const pick = (present, value) => ({present, value: present ? structuredClone(value) : undefined, conflict: false});
  if (inL === inR && same(l, r)) return pick(inL, l);
  if (equal(b, l)) return pick(inR, r); // seulement à distance
  if (equal(b, r)) return pick(inL, l); // seulement en local
  if (Array.isArray(l) && Array.isArray(r) && (blank(b) || Array.isArray(b))) {
    const merged = mergeIdArrays(Array.isArray(b) ? b : [], l, r);
    if (merged) return pick(true, merged);
  }
  return {present: false, value: undefined, conflict: true};
}

const changedSince = (base, entity, skip) => [...new Set([...Object.keys(base), ...Object.keys(entity)])]
  .some(key => !skip.has(key) && !ignoredMergeKeys.has(key) && !equal(base[key], entity[key]));

// Fusion à trois voies d'une fiche. Sans base connue : null (l'appelant garde l'ancienne fusion).
// Renvoie {canMerge, merged, conflicts, autoFields} : autoFields indique, pour chaque champ différent
// réglé automatiquement, le côté retenu (pour pré-remplir l'écran de conflit).
export function threeWayMerge(base, local, remote, {now = Date.now()} = {}) {
  if (!isRecord(base) || !isRecord(local) || !isRecord(remote)) return null;
  if (base.id !== undefined && local.id !== undefined && String(base.id) !== String(local.id)) return null;
  const merged = {}, conflicts = [], autoFields = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    if (ignoredMergeKeys.has(key)) continue;
    const r = mergeValue(key, base, local, remote);
    if (r.conflict) {conflicts.push(key);continue;}
    if (r.present) merged[key] = r.value;
    if (!(has(local, key) === has(remote, key) && same(local[key], remote[key]))) autoFields[key] = (has(local, key) === r.present && same(local[key], r.value)) ? 'local' : 'remote';
  }
  // Suppression d'un côté pendant que l'autre a modifié la fiche : jamais tranché automatiquement.
  const deletedLocal = Boolean(local.deletedAt), deletedRemote = Boolean(remote.deletedAt), deletedBase = Boolean(base.deletedAt);
  if (!conflicts.includes('deletedAt') && deletedLocal !== deletedRemote) {
    const deleter = deletedLocal !== deletedBase ? 'local' : 'remote';
    const other = deleter === 'local' ? remote : local;
    if (changedSince(base, other, new Set(['deletedAt']))) {conflicts.push('deletedAt');delete autoFields.deletedAt;}
  }
  merged.id = local.id ?? remote.id ?? base.id;
  const created = Math.min(Number(local.createdAt) || Infinity, Number(remote.createdAt) || Infinity);
  merged.createdAt = Number.isFinite(created) ? created : (local.createdAt || remote.createdAt || now);
  merged.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0, now);
  merged.version = Math.max(Number(local.version) || 0, Number(remote.version) || 0) + 1;
  return {canMerge: conflicts.length === 0, merged, conflicts, autoFields};
}

// Clé de la base dans IndexedDB (store « syncBase ») : espace, type et identifiant.
export const syncBaseKey = (workspaceId, type, id) => `${String(workspaceId || 'local')}::${type}::${id}`;
