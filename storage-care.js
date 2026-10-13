// n° 135 : protéger le stockage local contre l'éviction et gérer le quota.
// Logique pure (testable sous Node) : niveaux de remplissage, répartition, candidats au nettoyage.

// Clé (magasin « app » d'IndexedDB) des pièces jointes libérées de l'appareil : la synchronisation
// ne les retélécharge plus d'elle-même, elles sont rechargées à la demande depuis le cloud.
export const EVICTED_ATTACHMENTS_KEY = 'evicted-attachments';
export const KEEP_BACKUPS = 3;

// Lit le blob local d'une pièce jointe ; s'il a été libéré (« Libérer »), le recharge depuis le cloud
// via store.reloadAttachment (branché par app.js). null si absent et non rechargeable.
export async function attachmentBlob(store, id) {
  const blob = await store.storage.blobGet(id);
  if (blob || typeof store.reloadAttachment !== 'function' || typeof store.get !== 'function') return blob || null;
  const entity = store.get('photos', id, {includeDeleted: true}) || store.get('documents', id, {includeDeleted: true});
  return entity ? (await store.reloadAttachment(entity)) || null : null;
}
export const WARN_RATIO = 0.8;
export const CRITICAL_RATIO = 0.92;

export function formatSize(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (!n) return '0 Ko';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024)).toLocaleString('fr-FR')} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toLocaleString('fr-FR', {maximumFractionDigits: n < 10 * 1024 * 1024 ? 1 : 0})} Mo`;
  return `${(n / 1024 ** 3).toLocaleString('fr-FR', {maximumFractionDigits: 1})} Go`;
}

// Niveau de remplissage : 'unknown' si le navigateur ne donne pas de quota.
export function quotaLevel(usage, quota) {
  const u = Number(usage) || 0, q = Number(quota) || 0;
  if (!q) return {level: 'unknown', ratio: 0, pct: 0};
  const ratio = Math.min(1, u / q);
  return {level: ratio >= CRITICAL_RATIO ? 'critical' : ratio >= WARN_RATIO ? 'warn' : 'ok', ratio, pct: Math.round(ratio * 100)};
}

// Répartition affichée en barre ; « Application et données » = le reste de l'usage mesuré.
export function breakdownSegments({usage = 0, quota = 0, blobBytes = 0, backupBytes = 0, tileBytes = 0} = {}) {
  const total = Math.max(Number(usage) || 0, (Number(blobBytes) || 0) + (Number(backupBytes) || 0) + (Number(tileBytes) || 0));
  const base = Number(quota) || total || 1;
  const parts = [
    {key: 'photos', label: 'Photos et documents', bytes: Number(blobBytes) || 0},
    {key: 'backups', label: 'Sauvegardes automatiques', bytes: Number(backupBytes) || 0},
    {key: 'tiles', label: 'Carte hors connexion', bytes: Number(tileBytes) || 0}
  ];
  parts.push({key: 'app', label: 'Application et données', bytes: Math.max(0, total - parts.reduce((s, p) => s + p.bytes, 0))});
  return parts.map(p => ({...p, pct: Math.min(100, Math.round(p.bytes / base * 1000) / 10)}));
}

// Pièces jointes libérables : copie cloud déclarée (cloudPath), présentes localement, non supprimées.
// La copie cloud doit encore être vérifiée par un téléchargement avant toute suppression locale.
export function evictableAttachments(entities, localSizes) {
  const sizes = localSizes instanceof Map ? localSizes : new Map(Object.entries(localSizes || {}));
  return (entities || [])
    .filter(e => e && !e.deletedAt && typeof e.cloudPath === 'string' && e.cloudPath && sizes.get(e.id) > 0)
    .map(e => ({id: e.id, type: e.type || null, name: e.name || e.title || 'Pièce jointe', bytes: sizes.get(e.id)}))
    .sort((a, b) => b.bytes - a.bytes);
}

// Sauvegardes automatiques à purger : on garde les `keep` plus récentes de chaque exploitation.
export function backupsToPurge(backups, keep = KEEP_BACKUPS) {
  const byWorkspace = new Map();
  for (const b of backups || []) {
    const key = String(b.workspaceId || 'local');
    if (!byWorkspace.has(key)) byWorkspace.set(key, []);
    byWorkspace.get(key).push(b);
  }
  return [...byWorkspace.values()].flatMap(rows => rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(keep));
}

// Copie cloud jugée sûre si le téléchargement d'essai a la même taille que la copie locale.
export function cloudCopyVerified(localSize, downloadedSize) {
  return Number(localSize) > 0 && Number(localSize) === Number(downloadedSize);
}

export function addEvicted(list, ids) {
  return [...new Set([...(Array.isArray(list) ? list : []), ...(ids || [])].map(String))];
}
export function removeEvicted(list, id) {
  return (Array.isArray(list) ? list : []).filter(x => x !== String(id));
}

// Guide « protéger mes données » selon l'état d'installation (detectInstallState de runtime.js).
export function protectionAdvice({persisted = false, supported = true, installState = 'unsupported'} = {}) {
  if (persisted) return {protected: true, title: 'Vos données sont protégées', text: 'Le navigateur s’est engagé à ne pas effacer les données de Parcelles pour libérer de la place.', steps: []};
  if (!supported) return {protected: false, title: 'Protection non disponible ici', text: 'Ce navigateur ne permet pas de protéger le stockage. Faites des sauvegardes régulières (Mes données › Exporter).', steps: []};
  const steps = installState === 'ios-safari'
    ? ['Touchez Partager dans Safari.', 'Choisissez « Sur l’écran d’accueil », puis « Ajouter ».', 'Ouvrez Parcelles depuis son icône : Safari n’effacera plus ses données après 7 jours sans visite.']
    : installState === 'installable'
      ? ['Installez Parcelles (bouton ci-dessous).', 'Touchez ensuite « Demander la protection ».']
      : installState === 'standalone'
        ? ['Touchez « Demander la protection ».', 'Si le navigateur refuse, utilisez Parcelles régulièrement et gardez une sauvegarde récente.']
        : ['Dans le menu du navigateur, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».', 'Touchez ensuite « Demander la protection ».'];
  return {protected: false, title: 'Vos données ne sont pas protégées', text: 'Le navigateur peut effacer les données de Parcelles s’il manque de place ou après une longue période sans visite.', steps};
}
