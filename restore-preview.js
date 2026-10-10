// n° 133 : aperçu d'une sauvegarde avant restauration, restauration sélective et cohérence avec le cloud.
// Logique pure : comparaison par id et updatedAt, sans DOM ni écriture.
import {ENTITY_TYPES} from './utils.js';

// Collections non restaurables une par une (techniques ou propres à l'appareil).
const SKIPPED = new Set(['syncConflicts', 'importSessions', 'notifications', 'assistantMessages', 'devices', 'members', 'automationRuns', 'platformJobs', 'platformEvents']);
export const RESTORABLE_TYPES = ENTITY_TYPES.filter(type => !SKIPPED.has(type));

const TYPE_NAMES = {
  parcelles: ['parcelle', 'parcelles'], interventions: ['travail', 'travaux'], tasks: ['tâche', 'tâches'], rotations: ['rotation', 'rotations'],
  grazingSessions: ['pâturage', 'pâturages'], materiels: ['matériel', 'matériels'], products: ['produit', 'produits'], clients: ['client', 'clients'],
  documents: ['document', 'documents'], photos: ['photo', 'photos'], points: ['point', 'points'], templates: ['modèle', 'modèles'],
  observations: ['observation', 'observations'], stockItems: ['stock', 'stocks'], stockMovements: ['mouvement de stock', 'mouvements de stock'],
  maintenanceRecords: ['entretien', 'entretiens'], routeSessions: ['tournée', 'tournées'], fieldSessions: ['session terrain', 'sessions terrain'],
  chantiers: ['chantier', 'chantiers'], automationRules: ['automatisation', 'automatisations'], gpsTracks: ['trace GPS', 'traces GPS'],
  integrationImports: ['import', 'imports'], weatherStations: ['station météo', 'stations météo']
};
const FEMININE = new Set(['parcelles', 'tasks', 'rotations', 'photos', 'observations', 'routeSessions', 'fieldSessions', 'automationRules', 'gpsTracks', 'weatherStations']);
export const typeName = (type, n = 2) => (TYPE_NAMES[type] || [type, type])[n > 1 ? 1 : 0];
const count = (n, type) => `${n} ${typeName(type, n)}`;
const live = item => item && !item.deletedAt;
const pad = n => String(n).padStart(2, '0');
export const shortDate = ms => {const d = new Date(Number(ms));return Number.isFinite(d.getTime()) ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : '';};

export function itemTitle(type, item = {}) {
  return String(item.nom || item.title || item.name || item.label || item.type || typeName(type, 1)).trim();
}

// Comparaison d'une sauvegarde à l'état actuel, du point de vue « que changerait la restauration » :
// - added : dans la sauvegarde, absent aujourd'hui (revient) ;
// - changed : présent des deux côtés, updatedAt différent (version de la sauvegarde rétablie) ;
// - deletedSince : actif dans la sauvegarde, à la corbeille aujourd'hui (revient) ;
// - newer : actif aujourd'hui, absent ou supprimé dans la sauvegarde (perdu par une restauration complète).
export function diffBackup(current = {}, backup = {}, types = RESTORABLE_TYPES) {
  const byType = {};
  const totals = {added: 0, changed: 0, deletedSince: 0, newer: 0};
  for (const type of types) {
    const now = new Map((current[type] || []).filter(item => item?.id).map(item => [item.id, item]));
    const then = new Map((backup[type] || []).filter(item => item?.id).map(item => [item.id, item]));
    const row = {added: [], changed: [], deletedSince: [], newer: []};
    for (const [id, old] of then) {
      if (!live(old)) continue;
      const cur = now.get(id);
      if (!cur) row.added.push(id);
      else if (cur.deletedAt) row.deletedSince.push(id);
      else if (Number(cur.updatedAt || 0) !== Number(old.updatedAt || 0)) row.changed.push(id);
    }
    for (const [id, cur] of now) if (live(cur) && !live(then.get(id))) row.newer.push(id);
    if (Object.values(row).some(list => list.length)) {
      byType[type] = row;
      for (const key of Object.keys(totals)) totals[key] += row[key].length;
    }
  }
  return {byType, totals, identical: !Object.keys(byType).length};
}

// « Cette sauvegarde du 28/09 : +2 parcelles, 14 travaux différents, 3 supprimés depuis. »
export function previewSentence(diff, createdAt) {
  const parts = [];
  for (const [type, row] of Object.entries(diff.byType)) {
    if (row.added.length) parts.push(`+${count(row.added.length, type)}`);
    if (row.changed.length) parts.push(`${count(row.changed.length, type)} différent${FEMININE.has(type) ? 'e' : ''}${row.changed.length > 1 ? 's' : ''}`);
  }
  const {deletedSince, newer} = diff.totals;
  if (deletedSince) parts.push(`${deletedSince} supprimé${deletedSince > 1 ? 's' : ''} depuis`);
  if (newer) parts.push(`${newer} créé${newer > 1 ? 's' : ''} ou rétabli${newer > 1 ? 's' : ''} depuis`);
  const head = `Cette sauvegarde${createdAt ? ` du ${shortDate(createdAt)}` : ''}`;
  return parts.length ? `${head} : ${parts.join(', ')}.` : `${head} est identique à vos données actuelles.`;
}

// Lignes sélectionnables d'un type : ce que la sauvegarde peut rétablir (ajouts, différences, supprimés depuis).
export function restorableItems(diff, backup, type) {
  const row = diff.byType[type];if (!row) return [];
  const then = new Map((backup[type] || []).map(item => [item.id, item]));
  return [['added', row.added], ['changed', row.changed], ['deletedSince', row.deletedSince]]
    .flatMap(([kind, ids]) => ids.map(id => ({id, kind, title: itemTitle(type, then.get(id))})));
}

// Fiches à écrire par upsertMany pour une restauration sélective : la version de la sauvegarde, active,
// et les champs apparus depuis remis à null (upsert fusionne avec la fiche existante).
export function selectiveEntities(current, backup, selection = []) {
  const wanted = new Map();
  for (const {type, id} of selection) {if (!wanted.has(type)) wanted.set(type, new Set());wanted.get(type).add(id);}
  const result = [];
  for (const [type, ids] of wanted) {
    const now = new Map((current[type] || []).map(item => [item.id, item]));
    const entities = (backup[type] || []).filter(item => ids.has(item.id) && live(item)).map(item => {
      const copy = structuredClone(item), cur = now.get(item.id);
      if (cur) for (const key of Object.keys(cur)) if (!(key in copy) && !['createdAt', 'version', 'source', 'sourceId'].includes(key)) copy[key] = null;
      copy.deletedAt = null;
      return copy;
    });
    if (entities.length) result.push({type, entities});
  }
  return result;
}

const SYNC_PREFERENCES = ['syncEnabled', 'workspaceId', 'cloudRole', 'syncAttachments', 'syncWifiOnly', 'syncAttachmentsWifiOnly', 'autoSync'];
const SYNC_METADATA = ['syncCursors', 'syncServerCursors', 'lastSyncAt', 'clockSkew'];

// Restauration complète dans un espace cloud : l'état restauré garde les réglages de synchronisation de l'espace,
// la file en cours, et chaque fiche qui diffère est mise en file. Les fiches actives aujourd'hui mais absentes
// de la sauvegarde passent à la corbeille (récupérables) au lieu de réapparaître au prochain pull.
export function prepareCloudRestore(current, backup, {now = Date.now(), types = RESTORABLE_TYPES} = {}) {
  const data = structuredClone(backup), ops = [];
  data.preferences = {...(data.preferences || {})};data.metadata = {...(data.metadata || {})};
  for (const key of SYNC_PREFERENCES) if (key in (current.preferences || {})) data.preferences[key] = current.preferences[key];
  for (const key of SYNC_METADATA) if (key in (current.metadata || {})) data.metadata[key] = structuredClone(current.metadata[key]);
  data.queue = structuredClone(current.queue || []);
  data.syncConflicts = structuredClone(current.syncConflicts || []);
  for (const type of types) {
    const then = new Map((data[type] || []).map(item => [item.id, item]));
    for (const cur of current[type] || []) {
      if (!cur?.id) continue;
      const old = then.get(cur.id);
      if (!old) {
        if (cur.deletedAt) {data[type] = [...(data[type] || []), structuredClone(cur)];continue;}
        const trashed = {...structuredClone(cur), deletedAt: now, updatedAt: now, version: (Number(cur.version) || 0) + 1};
        data[type] = [...(data[type] || []), trashed];
        ops.push({entity: type, entityId: cur.id, action: 'delete', payload: trashed});
      } else if (Number(old.updatedAt || 0) !== Number(cur.updatedAt || 0) || Boolean(old.deletedAt) !== Boolean(cur.deletedAt)) {
        // Version restaurée réécrite comme une modification récente : elle l'emporte sur l'ancienne copie du cloud.
        const restored = {...old, updatedAt: now, version: Math.max(Number(old.version) || 0, Number(cur.version) || 0) + 1};
        Object.assign(old, restored);
        ops.push({entity: type, entityId: cur.id, action: old.deletedAt ? 'delete' : 'update', payload: structuredClone(restored)});
      }
    }
    for (const old of data[type] || []) if (!(current[type] || []).some(cur => cur?.id === old.id)) {
      Object.assign(old, {updatedAt: now, version: (Number(old.version) || 0) + 1});
      ops.push({entity: type, entityId: old.id, action: 'create', payload: structuredClone(old)});
    }
  }
  return {data, ops};
}
