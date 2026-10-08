// n° 132 : indicateur de synchronisation riche et file lisible (logique pure, sans DOM).
// Lecture seule de l'état : aucune écriture dans la file ni dans le moteur de synchronisation.

export const SYNC_STALE_MS = 48 * 3600 * 1000;

const TYPE_LABELS = {parcelles:'Parcelle',interventions:'Travail',tasks:'Tâche',rotations:'Rotation',grazingSessions:'Pâturage',materiels:'Matériel',products:'Produit',clients:'Client',documents:'Document',photos:'Photo',points:'Point',templates:'Modèle',observations:'Observation',stockItems:'Stock',stockMovements:'Mouvement de stock',maintenanceRecords:'Entretien',routeSessions:'Tournée',harvests:'Récolte',invoices:'Facture',sales:'Vente',preferences:'Réglages'};
const ACTION_LABELS = {create:'création',update:'modification',delete:'suppression',restore:'restauration'};

export function entityLabel(type) {return TYPE_LABELS[type] || 'Donnée';}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// « à l'instant », « il y a 3 min », « il y a 2 h », « il y a 3 jours ».
export function durationAgo(ms) {
  const value = Math.max(0, Number(ms) || 0), minutes = Math.floor(value / 60000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${plural(Math.floor(hours / 24), 'jour', 'jours')}`;
}
// « depuis 2 h » : même échelle, pour une attente.
function durationSince(ms) {return durationAgo(ms).replace(/^il y a /, 'depuis ').replace('à l’instant', 'depuis un instant');}

function entityTitle(type, item) {
  if (!item) return entityLabel(type);
  const name = item.type || item.title || item.nom || item.name || item.label || item.number || '';
  return String(name || entityLabel(type)).trim();
}

// Une opération de file décrite en clair : « Semis maïs — Les Grandes Terres · en attente depuis 2 h · 3 essais ».
export function describeOperation(op, data = {}, now = Date.now()) {
  const list = Array.isArray(data[op.entity]) ? data[op.entity] : [];
  const item = list.find(row => row?.id === op.entityId) || (op.payload && typeof op.payload === 'object' ? op.payload : null);
  const parcelId = item?.parcelId || (Array.isArray(item?.parcelIds) ? item.parcelIds[0] : '');
  const parcel = parcelId && op.entity !== 'parcelles' ? (data.parcelles || []).find(p => p?.id === parcelId) : null;
  const title = [entityTitle(op.entity, item), parcel?.nom].filter(Boolean).join(' — ');
  const since = Number(op.firstQueuedAt || op.createdAt) || now;
  const attempts = Math.max(0, Number(op.attempts) || 0);
  const state = op.status === 'error' ? 'en erreur' : op.status === 'conflict' ? 'en conflit' : 'en attente';
  const parts = [`${state} ${durationSince(now - since)}`];
  if (attempts) parts.push(plural(attempts, 'essai', 'essais'));
  const kind = `${entityLabel(op.entity)}${ACTION_LABELS[op.action] ? ` · ${ACTION_LABELS[op.action]}` : ''}`;
  return {id: op.id, title, kind, detail: parts.join(' · '), status: op.status, error: op.lastError || '', since};
}

// Opérations à montrer (non envoyées), les plus anciennes d'abord, les erreurs en tête.
export function readableQueue(data = {}, now = Date.now()) {
  const rank = {error: 0, conflict: 1, pending: 2};
  return (Array.isArray(data.queue) ? data.queue : [])
    .filter(op => op && op.status in rank)
    .map(op => describeOperation(op, data, now))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.since - b.since);
}

// Pastille : les états « Hors connexion » et « Lecture seule · … » restent prioritaires,
// puis conflits, erreurs, envoi en cours, attente, et enfin « Synchronisé · il y a … ».
export function syncPillState({data = {}, offline = false, schemaLock = false, tabReadOnly = false, viewer = false, cloud = false, syncing = null, now = Date.now()} = {}) {
  const queue = Array.isArray(data.queue) ? data.queue : [];
  const pending = queue.filter(op => op?.status === 'pending').length;
  const errors = queue.filter(op => op?.status === 'error').length;
  const conflicts = (Array.isArray(data.syncConflicts) ? data.syncConflicts : []).filter(c => c && c.status === 'open' && !c.deletedAt).length;
  const lastSyncAt = Number(data.metadata?.lastSyncAt) || 0, lastError = cloud ? data.metadata?.lastSyncError || '' : '';
  const base = {pending, errors, conflicts, lastSyncAt};
  if (offline) return {...base, tone: 'offline', label: 'Hors connexion', detail: pending ? `${plural(pending, 'opération', 'opérations')} en attente du réseau` : 'Vos données locales restent modifiables.'};
  if (schemaLock) return {...base, tone: 'readonly', label: 'Lecture seule · version plus récente', detail: 'Mettez l’application à jour pour modifier.'};
  if (tabReadOnly) return {...base, tone: 'readonly', label: 'Lecture seule · autre fenêtre', detail: 'Parcelles est ouvert dans une autre fenêtre.'};
  if (viewer) return {...base, tone: 'readonly', label: 'Lecture seule · Cloud', detail: 'Votre rôle permet la consultation.'};
  if (conflicts) return {...base, tone: 'conflict', label: plural(conflicts, 'conflit', 'conflits'), detail: 'Choisissez la bonne version.'};
  if (errors || lastError) return {...base, tone: 'error', label: 'Erreur — toucher pour réessayer', detail: errors ? `${plural(errors, 'opération', 'opérations')} en échec` : 'La dernière synchronisation a échoué.'};
  if (syncing) {
    const total = Math.max(0, Number(syncing.total) || 0), done = Math.min(total, Math.max(0, Number(syncing.done) || 0));
    return {...base, tone: 'sending', label: total ? `Envoi… ${done}/${total}` : 'Synchronisation…', detail: 'Envoi en cours.'};
  }
  if (pending) return {...base, tone: 'pending', label: `${pending} en attente`, detail: cloud ? 'Envoi à la prochaine synchronisation.' : 'Envoi dès que le cloud sera connecté.'};
  if (cloud) return {...base, tone: 'ok', label: lastSyncAt ? `Synchronisé · ${durationAgo(now - lastSyncAt)}` : 'Synchronisé', detail: lastSyncAt ? `Dernière synchronisation ${durationAgo(now - lastSyncAt)}.` : ''};
  return {...base, tone: 'local', label: 'À jour', detail: 'Les données restent sur cet appareil.'};
}

// Rappel d'Aujourd'hui : cloud actif et rien de synchronisé depuis plus de 48 h.
export function staleSyncReminder({data = {}, cloudActive = false, now = Date.now()} = {}) {
  if (!cloudActive) return null;
  const last = Number(data.metadata?.lastSyncAt) || 0;
  const oldestPending = (Array.isArray(data.queue) ? data.queue : []).filter(op => ['pending', 'error'].includes(op?.status)).reduce((min, op) => Math.min(min, Number(op.firstQueuedAt || op.createdAt) || now), now);
  const since = last || (oldestPending < now ? oldestPending : 0);
  if (!since || now - since <= SYNC_STALE_MS) return null;
  return {since, days: Math.floor((now - since) / 86400000), never: !last};
}
