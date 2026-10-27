// @ts-check
import {roleCan} from './permissions.js';
// n° 4 : sauvegardes hors de l'appareil automatiques (logique pure, testée par test-backup-vault.mjs).
// - ZIP complet écrit dans le dossier choisi (showDirectoryPicker) quand la dernière sauvegarde externe a plus
//   de 7 jours, avec rotation « garder les N derniers » limitée aux fichiers créés par Parcelles (préfixe) ;
// - instantané cloud mensuel facultatif (Storage workspaces/{id}/snapshots/), réservé au propriétaire.
// Les réglages restent propres à l'appareil (magasin app d'IndexedDB, clé VAULT_SETTINGS_KEY) : rien n'est
// ajouté à l'état synchronisé.

export const BACKUP_FILE_PREFIX = 'parcelles-sauvegarde-complete-';
export const SNAPSHOT_PREFIX = 'parcelles-instantane-';
export const VAULT_SETTINGS_KEY = 'backup-vault';
export const DEFAULT_KEEP = 8;
export const MAX_KEEP = 60;
export const FOLDER_BACKUP_DAYS = 7;
export const CLOUD_SNAPSHOT_KEEP = 12;
// Même borne que storage.rules (snapshots) : au-delà, l'envoi est refusé avant tout transfert.
export const SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024;
export const CLOUD_MODES = Object.freeze(['off', 'encrypted', 'plain']);
const DAY = 86400000;

// Fichiers de la sauvegarde complète : parcelles-sauvegarde-complete-AAAA-MM-JJ[...].zip
const BACKUP_FILE_RE = /^parcelles-sauvegarde-complete-\d{4}-\d{2}-\d{2}[\w.-]*\.zip$/;
// Instantanés : parcelles-instantane-AAAAMMJJTHHMMSSZ[-chiffre].json (même motif que storage.rules).
const SNAPSHOT_RE = /^parcelles-instantane-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(-chiffre)?\.json$/;

export const normalizeKeep = value => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_KEEP, n) : DEFAULT_KEEP;
};

export function normalizeVaultSettings(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cloud = {};
  for (const [id, entry] of Object.entries(value.cloud && typeof value.cloud === 'object' ? value.cloud : {})) {
    if (!id || !entry || typeof entry !== 'object') continue;
    cloud[id] = {mode: CLOUD_MODES.includes(entry.mode) ? entry.mode : 'off', lastAt: Number(entry.lastAt) || null, warned: Boolean(entry.warned)};
  }
  return {keep: normalizeKeep(value.keep ?? DEFAULT_KEEP), autoFolder: value.autoFolder !== false, cloud};
}

export const cloudSettings = (settings, workspaceId) => settings?.cloud?.[workspaceId] || {mode: 'off', lastAt: null, warned: false};

// Exploitation dans le nom du ZIP : deux exploitations sauvegardées le même jour dans le même dossier ne s'écrasent pas.
// Exploitation locale : aucun suffixe (noms des versions précédentes inchangés).
export const backupWorkspaceSuffix = workspaceId => {
  const id = String(workspaceId || 'local').trim();
  return id && id !== 'local' ? `-${id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}` : '';
};
export const backupFileName = (day, workspaceId) => `${BACKUP_FILE_PREFIX}${day}${backupWorkspaceSuffix(workspaceId)}.zip`;
export const isBackupFileName = name => BACKUP_FILE_RE.test(String(name || ''));

// Noms à supprimer pour ne garder que les `keep` plus récents (le nom porte la date : tri lexical).
// Tout fichier qui n'a pas le préfixe et la forme de Parcelles est ignoré, jamais supprimé.
// Avec `workspaceId`, seuls les fichiers de cette exploitation comptent : un même dossier sert à toutes.
export function filesToPrune(names, keep = DEFAULT_KEEP, workspaceId = undefined) {
  const mine = name => workspaceId === undefined || name.slice(BACKUP_FILE_PREFIX.length + 10, -4) === backupWorkspaceSuffix(workspaceId);
  const own = [...new Set((names || []).filter(name => isBackupFileName(name) && mine(name)))].sort().reverse();
  return own.slice(normalizeKeep(keep));
}

// Écriture automatique dans le dossier : la dernière sauvegarde externe a plus de 7 jours (ou n'existe pas).
export function folderBackupDue(lastExternalBackupAt, at = Date.now(), days = FOLDER_BACKUP_DAYS) {
  const last = Number(lastExternalBackupAt) || 0;
  return !last || at - last > days * DAY;
}

const monthKey = at => { const d = new Date(at); return `${d.getUTCFullYear()}-${d.getUTCMonth()}`; };
// Instantané mensuel : aucun instantané ce mois-ci (UTC).
export function cloudSnapshotDue(lastAt, at = Date.now()) {
  const last = Number(lastAt) || 0;
  return !last || monthKey(last) !== monthKey(at);
}

const pad = n => String(n).padStart(2, '0');
export function snapshotFileName(at = Date.now(), encrypted = false) {
  const d = new Date(at);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return `${SNAPSHOT_PREFIX}${stamp}${encrypted ? '-chiffre' : ''}.json`;
}

export function parseSnapshotName(name) {
  const m = SNAPSHOT_RE.exec(String(name || ''));
  if (!m) return null;
  return {name: m[0], createdAt: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), encrypted: Boolean(m[7])};
}

export function snapshotPath(workspaceId, name) {
  const id = String(workspaceId || '');
  if (!id || id.includes('/') || !parseSnapshotName(name)) throw new Error('Instantané cloud : chemin invalide.');
  return `workspaces/${id}/snapshots/${name}`;
}

// Instantanés listés du plus récent au plus ancien, et ceux à supprimer au-delà de `keep`.
export function sortSnapshots(names) {
  return (names || []).map(parseSnapshotName).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
export const snapshotsToPrune = (names, keep = CLOUD_SNAPSHOT_KEEP) => sortSnapshots(names).slice(Math.max(1, keep)).map(s => s.name);

// Réservé au propriétaire d'une exploitation cloud (capacité 'cloud-snapshot' de permissions.js, même règle que storage.rules).
export const canUseCloudSnapshots = ({role, connected = false, demo = false} = {}) => Boolean(connected) && !demo && roleCan(role, 'cloud-snapshot');
