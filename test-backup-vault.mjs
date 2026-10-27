// n° 4 : sauvegardes automatiques hors de l'appareil (backup-vault.js, backup-vault-ui.js).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DEFAULT_KEEP, backupFileName, canUseCloudSnapshots, cloudSnapshotDue, filesToPrune, folderBackupDue, normalizeKeep,
  normalizeVaultSettings, parseSnapshotName, snapshotFileName, snapshotPath, snapshotsToPrune, VAULT_SETTINGS_KEY
} from './backup-vault.js';
import {initContext} from './app-context.js';
import {createBackupVaultUI} from './backup-vault-ui.js';

const DAY = 86400000;
const at = Date.UTC(2026, 9, 27, 12);

test('rotation : garde les N plus récents, ne touche qu’aux fichiers de Parcelles', () => {
  const names = ['parcelles-sauvegarde-complete-2026-10-01.zip', 'parcelles-sauvegarde-complete-2026-10-08.zip', 'parcelles-sauvegarde-complete-2026-10-15.zip',
    'parcelles-sauvegarde-complete-2026-09-01.zip', 'notes.zip', 'parcelles-sauvegarde-complete-copie.zip', 'parcelles-donnees-2026-01-01.json', 'Parcelles-sauvegarde-complete-2020-01-01.zip'];
  assert.deepEqual(filesToPrune(names, 2), ['parcelles-sauvegarde-complete-2026-10-01.zip', 'parcelles-sauvegarde-complete-2026-09-01.zip']);
  assert.deepEqual(filesToPrune(names, 8), []);
  assert.equal(normalizeKeep(0), DEFAULT_KEEP);
  assert.equal(normalizeKeep(500), 60);
  assert.equal(normalizeVaultSettings(null).keep, 8);
  assert.equal(normalizeVaultSettings({autoFolder: false}).autoFolder, false);
});

test('échéances : dossier au-delà de 7 jours, instantané cloud une fois par mois', () => {
  assert.equal(folderBackupDue(null, at), true);
  assert.equal(folderBackupDue(at - 7 * DAY, at), false);
  assert.equal(folderBackupDue(at - 8 * DAY, at), true);
  assert.equal(cloudSnapshotDue(null, at), true);
  assert.equal(cloudSnapshotDue(Date.UTC(2026, 9, 1), at), false);
  assert.equal(cloudSnapshotDue(Date.UTC(2026, 8, 30), at), true);
});

test('instantanés : nom, chemin, tri, rotation et propriétaire seul', () => {
  const name = snapshotFileName(at, true);
  assert.equal(name, 'parcelles-instantane-20261027T120000Z-chiffre.json');
  assert.deepEqual(parseSnapshotName(name), {name, createdAt: at, encrypted: true});
  assert.equal(parseSnapshotName('autre.json'), null);
  assert.equal(snapshotPath('ws1', name), `workspaces/ws1/snapshots/${name}`);
  assert.throws(() => snapshotPath('ws1', '../x.json'));
  assert.throws(() => snapshotPath('a/b', name));
  const names = [0, 1, 2].map(i => snapshotFileName(at - i * 31 * DAY));
  assert.deepEqual(snapshotsToPrune([...names, 'x.json'], 2), [names[2]]);
  assert.equal(canUseCloudSnapshots({role: 'owner', connected: true}), true);
  for (const role of ['manager', 'editor', 'operator', 'accountant', 'advisor', 'viewer']) assert.equal(canUseCloudSnapshots({role, connected: true}), false, role);
  assert.equal(canUseCloudSnapshots({role: 'owner', connected: false}), false);
  assert.equal(canUseCloudSnapshots({role: 'owner', connected: true, demo: true}), false);
  // Même motif de nom que storage.rules.
  const rules = readFileSync(new URL('./storage.rules', import.meta.url), 'utf8');
  const pattern = /fileId\.matches\('([^']+)'\)/.exec(rules)?.[1];
  assert.ok(pattern, 'motif des instantanés dans storage.rules');
  assert.ok(new RegExp(`^${pattern}$`).test(name) && new RegExp(`^${pattern}$`).test(snapshotFileName(at)));
  assert.ok(/snapshots\/\{fileId\}[\s\S]*isOwner\(workspaceId\)/.test(rules));
});

// ---------- Environnement simulé : dossier (File System Access) et stockage ----------
function folder(name, files = [], permission = 'granted') {
  const map = new Map(files.map(f => [f, new Blob(['old'])]));
  return {name, map, kind: 'directory', queried: 0, requested: 0,
    async queryPermission() { this.queried++; return permission; },
    async requestPermission() { this.requested++; return 'granted'; },
    async getFileHandle(file) { return {async createWritable() { let data = null; return {async write(b) { data = b; }, async close() { map.set(file, data); }}; }}; },
    async *entries() { for (const key of map.keys()) yield [key, {kind: 'file'}]; },
    async removeEntry(file) { map.delete(file); }};
}
function setup({handle, metadata = {}, sync = null} = {}) {
  const kv = new Map([['backup-folder', handle]]), toasts = [], recorded = [];
  const state = {metadata, preferences: {}};
  const impex = {
    async createCompleteBackup() { return {blob: new Blob(['zip']), manifest: {createdAt: at}}; },
    async verifyCompleteBackupBlob() { return {ok: true, attachments: 0}; },
    async makeBackup() { return {format: 'parcelles-backup', state: {}}; }
  };
  initContext({
    get store() { return {storage: {get: async k => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); }}, tabReadOnly: null, schemaLock: null}; },
    state: () => state, toast: (...args) => toasts.push(args),
    lazy: {need: async () => true, get: () => impex},
    get sync() { return sync; }
  });
  const ui = createBackupVaultUI({recordExternalBackup: async kind => recorded.push(kind)});
  return {ui, kv, toasts, recorded};
}

test('rotation et nom : chaque exploitation a ses ZIP dans le dossier commun', () => {
  assert.equal(backupFileName('2026-10-27', 'local'), 'parcelles-sauvegarde-complete-2026-10-27.zip');
  assert.equal(backupFileName('2026-10-27', 'ws/A b'), 'parcelles-sauvegarde-complete-2026-10-27-ws_A_b.zip');
  const names = ['2026-10-01', '2026-10-08', '2026-10-15'].flatMap(d => [backupFileName(d, 'local'), backupFileName(d, 'wsB')]);
  assert.deepEqual(filesToPrune(names, 2, 'wsB'), ['parcelles-sauvegarde-complete-2026-10-01-wsB.zip']);
  assert.deepEqual(filesToPrune(names, 2, 'local'), ['parcelles-sauvegarde-complete-2026-10-01.zip']);
  assert.deepEqual(filesToPrune(names, 1, 'wsC'), [], 'autre exploitation : rien supprimé');
});

test('démarrage : ZIP écrit dans le dossier accordé au-delà de 7 jours, puis rotation', async () => {
  const old = Array.from({length: 9}, (_, i) => `parcelles-sauvegarde-complete-2026-0${1 + (i % 9)}-0${1 + i}.zip`);
  const handle = folder('Sauvegardes', [...old, 'photo.jpg']);
  const {ui, recorded, toasts} = setup({handle, metadata: {lastExternalBackupAt: at - 10 * DAY}});
  assert.equal(await ui.autoRun({force: true}), true);
  assert.ok(handle.map.has('parcelles-sauvegarde-complete-2026-10-27.zip'), 'ZIP du jour écrit');
  assert.equal([...handle.map.keys()].filter(n => n.startsWith('parcelles-')).length, 8, '8 derniers gardés');
  assert.ok(handle.map.has('photo.jpg'), 'fichier étranger jamais supprimé');
  assert.deepEqual(recorded, ['zip-auto']);
  assert.match(toasts[0][0], /Sauvegardes/);
  assert.equal(handle.requested, 0, 'aucune demande d’autorisation hors d’un geste');
});

test('démarrage : sauvegarde récente, permission à redemander ou option coupée : rien n’est écrit', async () => {
  const recent = folder('A');
  let env = setup({handle: recent, metadata: {lastExternalBackupAt: Date.now() - DAY}});
  await env.ui.autoRun({force: true});
  assert.equal(recent.map.size, 0);
  const prompt = folder('B', [], 'prompt');
  env = setup({handle: prompt, metadata: {}});
  await env.ui.autoRun({force: true});
  assert.equal(prompt.map.size, 0); assert.equal(prompt.requested, 0); assert.equal(env.toasts.length, 0, 'pas d’invite : le rappel de l’accueil suffit');
  const off = folder('C');
  env = setup({handle: off, metadata: {}});
  await env.kv.set(VAULT_SETTINGS_KEY, {autoFolder: false});
  await env.ui.autoRun({force: true});
  assert.equal(off.map.size, 0);
});

function fakeCloud(role = 'owner', existing = []) {
  const files = new Map(existing.map(n => [`workspaces/ws1/snapshots/${n}`, {}]));
  const ref = path => ({
    async put(blob, meta) { files.set(path, {blob, meta}); },
    async listAll() { return {items: [...files.keys()].filter(p => p.startsWith(`${path}/`)).map(p => ({name: p.split('/').pop()}))}; },
    async delete() { files.delete(path); }
  });
  return {files, sync: {role, workspaceId: 'ws1', user: {uid: 'u'}, status: {connected: true}, storage: {ref}}};
}

test('instantané cloud mensuel : non chiffré seulement après avertissement accepté, propriétaire seul', async () => {
  const {files, sync} = fakeCloud();
  const env = setup({handle: null, sync, metadata: {lastExternalBackupAt: Date.now()}});
  await env.kv.set(VAULT_SETTINGS_KEY, {cloud: {ws1: {mode: 'plain', warned: false}}});
  await env.ui.autoRun({force: true});
  assert.equal(files.size, 0, 'sans avertissement accepté, rien ne part');
  await env.kv.set(VAULT_SETTINGS_KEY, {cloud: {ws1: {mode: 'plain', warned: true}}});
  await env.ui.autoRun({force: true});
  assert.equal(files.size, 1);
  const [path, {meta}] = [...files.entries()][0];
  assert.match(path, /^workspaces\/ws1\/snapshots\/parcelles-instantane-\d{8}T\d{6}Z\.json$/);
  assert.equal(meta.contentType, 'application/json');
  assert.equal(meta.customMetadata.encrypted, '0');
  await env.ui.autoRun({force: true});
  assert.equal(files.size, 1, 'un seul par mois');
  const editor = fakeCloud('editor');
  const env2 = setup({handle: null, sync: editor.sync, metadata: {lastExternalBackupAt: Date.now()}});
  await env2.kv.set(VAULT_SETTINGS_KEY, {cloud: {ws1: {mode: 'plain', warned: true}}});
  await env2.ui.autoRun({force: true});
  assert.equal(editor.files.size, 0, 'réservé au propriétaire');
});

test('instantané chiffré : rappel discret (une fois), jamais d’envoi sans phrase secrète', async () => {
  const {files, sync} = fakeCloud();
  const env = setup({handle: null, sync, metadata: {lastExternalBackupAt: Date.now()}});
  await env.kv.set(VAULT_SETTINGS_KEY, {cloud: {ws1: {mode: 'encrypted'}}});
  await env.ui.autoRun({force: true});
  await env.ui.autoRun({force: true});
  assert.equal(files.size, 0);
  assert.equal(env.toasts.filter(t => /chiffré/.test(t[0])).length, 1);
  assert.equal(env.toasts[0][2].label, 'Créer');
});

test('branchement : module différé, action, CORE et REQUIRED_ASSETS', () => {
  const lazy = readFileSync(new URL('./lazy-modules.js', import.meta.url), 'utf8');
  assert.match(lazy, /backupVault: \(\) => import\('\.\/backup-vault-ui\.js'\)/);
  assert.match(lazy, /actions\('backupVault', 'open-backup-vault'\)/);
  for (const file of ['sw.js', 'runtime.js']) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.ok(src.includes("'./backup-vault.js'") && src.includes("'./backup-vault-ui.js'"), file);
  }
});
