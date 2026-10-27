// @ts-check
// n° 4 : sauvegardes automatiques hors de l'appareil (module différé, clé lazy backupVault).
// - au démarrage et à la reprise : ZIP complet écrit dans le dossier choisi si la dernière sauvegarde externe a
//   plus de 7 jours ET que l'accès au dossier est encore accordé (aucune demande d'autorisation ici : sinon, le
//   rappel discret de l'accueil suffit) ; rotation « garder les N derniers » sur les seuls fichiers de Parcelles ;
// - instantané cloud mensuel facultatif (propriétaire seul), chiffré par une phrase secrète saisie au moment de
//   l'instantané (jamais enregistrée) ou, après un avertissement RGPD accepté, non chiffré et automatique ;
// - liste, restauration (chemin de restauration habituel, déchiffrement compris) et suppression des instantanés.
import {ctx} from './app-context.js';
import {APP_VERSION, escapeHtml, isoDate, localDateTime} from './utils.js';
import {DEFAULT_PBKDF2_ITERATIONS, encryptJsonPayload, passwordStrength} from './security.js';
import {isDemoState} from './state.js';
import {
  BACKUP_FILE_PREFIX, CLOUD_SNAPSHOT_KEEP, MAX_KEEP, SNAPSHOT_MAX_BYTES, VAULT_SETTINGS_KEY,
  backupFileName, canUseCloudSnapshots, cloudSettings, cloudSnapshotDue, filesToPrune, folderBackupDue, normalizeKeep,
  normalizeVaultSettings, snapshotFileName, snapshotPath, snapshotsToPrune, sortSnapshots
} from './backup-vault.js';

const FOLDER_KEY = 'backup-folder'; // même clé qu'app.js (chooseBackupFolder)
const RESUME_THROTTLE_MS = 30 * 60 * 1000;

export function createBackupVaultUI({restoreFile = null, recordExternalBackup = null} = {}) {
  let running = false, lastRunAt = 0, remindedEncrypted = false;
  const storage = () => ctx.store.storage;
  const $ = id => /** @type {any} */(document.getElementById(id));

  async function loadSettings() {
    try { return normalizeVaultSettings(await storage().get(VAULT_SETTINGS_KEY)); } catch { return normalizeVaultSettings(null); }
  }
  async function saveSettings(settings) { await storage().set(VAULT_SETTINGS_KEY, normalizeVaultSettings(settings)); }

  async function folderHandle() {
    const handle = await storage().get(FOLDER_KEY).catch(() => null);
    return handle && typeof handle.getFileHandle === 'function' ? handle : null;
  }
  // Accès déjà accordé seulement : queryPermission, jamais requestPermission (pas d'invite hors d'un geste).
  async function grantedFolder() {
    const handle = await folderHandle();
    if (!handle) return null;
    try { return (typeof handle.queryPermission === 'function' ? await handle.queryPermission({mode: 'readwrite'}) : 'granted') === 'granted' ? handle : null; }
    catch { return null; }
  }

  // Rotation : ne supprime que les fichiers parcelles-sauvegarde-complete-AAAA-MM-JJ….zip au-delà des N plus récents.
  async function rotateFolder(handle, keep) {
    if (!handle || typeof handle.removeEntry !== 'function' || typeof handle.entries !== 'function') return 0;
    const names = [];
    for await (const [name, entry] of handle.entries()) if (entry?.kind === 'file') names.push(name);
    let removed = 0;
    for (const name of filesToPrune(names, keep, ctx.store.workspaceId || 'local')) {
      try { await handle.removeEntry(name); removed++; } catch (error) { console.warn('[Parcelles] ancienne sauvegarde non supprimée.', name, error); }
    }
    return removed;
  }
  async function rotateBackupFolder(handle) { try { return await rotateFolder(handle, (await loadSettings()).keep); } catch (error) { console.warn('[Parcelles] rotation des sauvegardes impossible.', error); return 0; } }

  async function importExport() {
    if (!(await ctx.lazy.need('importExport', {silent: true}))) throw new Error('Module de sauvegarde indisponible.');
    return ctx.lazy.get('importExport');
  }

  async function autoFolder(settings) {
    if (!settings.autoFolder || !folderBackupDue(ctx.state().metadata?.lastExternalBackupAt)) return false;
    const handle = await grantedFolder();
    if (!handle) return false;
    const impex = await importExport();
    const backup = await impex.createCompleteBackup(ctx.store);
    const verification = await impex.verifyCompleteBackupBlob(backup.blob);
    if (!verification.ok) throw new Error('La sauvegarde n’a pas passé le contrôle d’intégrité.');
    const fileHandle = await handle.getFileHandle(backupFileName(isoDate(backup.manifest.createdAt), ctx.store.workspaceId), {create: true});
    const writable = await fileHandle.createWritable();
    await writable.write(backup.blob); await writable.close();
    await rotateFolder(handle, settings.keep);
    await recordExternalBackup?.('zip-auto');
    ctx.toast(`Sauvegarde automatique enregistrée dans « ${handle.name} ».`);
    return true;
  }

  // --- Instantanés cloud ---
  const cloudReady = () => {
    const sync = ctx.sync;
    return canUseCloudSnapshots({role: sync?.role, connected: Boolean(sync?.status?.connected && sync?.user && sync?.storage && sync?.workspaceId), demo: isDemoState(ctx.state())});
  };
  const folderRef = () => ctx.sync.storage.ref(`workspaces/${ctx.sync.workspaceId}/snapshots`);
  const fileRef = name => ctx.sync.storage.ref(snapshotPath(ctx.sync.workspaceId, name));

  async function listSnapshots() { const result = await folderRef().listAll(); return sortSnapshots((result?.items || []).map(item => item.name)); }

  async function uploadSnapshot(passphrase = '') {
    const workspaceId = ctx.sync.workspaceId, impex = await importExport();
    const backup = await impex.makeBackup(ctx.state());
    const encrypted = Boolean(passphrase);
    const body = encrypted ? await encryptJsonPayload(backup, passphrase, {iterations: Math.max(DEFAULT_PBKDF2_ITERATIONS, Number(ctx.state().preferences?.encryptedExportIterations) || 0)}) : backup;
    const blob = new Blob([JSON.stringify(body)], {type: 'application/json'});
    if (blob.size >= SNAPSHOT_MAX_BYTES) throw new Error('Instantané trop volumineux pour le cloud (50 Mo au plus) : faites une sauvegarde complète.');
    const at = Date.now(), name = snapshotFileName(at, encrypted);
    await fileRef(name).put(blob, {contentType: 'application/json', customMetadata: {schemaVersion: String(APP_VERSION), encrypted: encrypted ? '1' : '0'}});
    const settings = await loadSettings();
    settings.cloud[workspaceId] = {...cloudSettings(settings, workspaceId), lastAt: at};
    await saveSettings(settings);
    try { for (const old of snapshotsToPrune((await listSnapshots()).map(s => s.name), CLOUD_SNAPSHOT_KEEP)) await fileRef(old).delete(); }
    catch (error) { console.warn('[Parcelles] rotation des instantanés cloud impossible.', error); }
    return name;
  }

  async function autoCloud(settings) {
    if (!cloudReady()) return false;
    const workspaceId = ctx.sync.workspaceId, cloud = cloudSettings(settings, workspaceId);
    if (cloud.mode === 'off' || !cloudSnapshotDue(cloud.lastAt)) return false;
    // Un autre appareil du propriétaire a peut-être déjà fait l'instantané du mois.
    const latest = (await listSnapshots())[0];
    if (latest && !cloudSnapshotDue(latest.createdAt)) { settings.cloud[workspaceId] = {...cloud, lastAt: latest.createdAt}; await saveSettings(settings); return false; }
    if (cloud.mode === 'plain' && cloud.warned) { await uploadSnapshot(''); ctx.toast('Instantané cloud mensuel enregistré.'); return true; }
    if (cloud.mode === 'encrypted' && !remindedEncrypted) {
      remindedEncrypted = true;
      ctx.toast('Instantané cloud chiffré du mois à faire.', 'info', {label: 'Créer', run: () => openSnapshotForm()});
    }
    return false;
  }

  // Démarrage et reprise : jamais pendant une lecture seule, une démonstration ou une autre exécution.
  async function autoRun({force = false} = {}) {
    const store = ctx.store;
    if (running || !store || store.tabReadOnly || store.schemaLock || isDemoState(ctx.state())) return false;
    if (!force && Date.now() - lastRunAt < RESUME_THROTTLE_MS) return false;
    running = true; lastRunAt = Date.now();
    try {
      const settings = await loadSettings();
      try { await autoFolder(settings); } catch (error) { console.warn('[Parcelles] sauvegarde automatique dans le dossier impossible.', error); ctx.toast(`Sauvegarde automatique impossible : ${error?.message || error}`, 'error'); }
      try { await autoCloud(settings); } catch (error) { console.warn('[Parcelles] instantané cloud impossible.', error); }
      return true;
    } finally { running = false; }
  }

  // --- Écrans ---
  const formError = (id, message) => { const el = $(id); if (el) { el.textContent = message; el.hidden = !message; } };

  async function open() {
    const settings = await loadSettings(), handle = await folderHandle(), owner = cloudReady();
    const cloud = owner ? cloudSettings(settings, ctx.sync.workspaceId) : null;
    const option = (value, label) => `<option value="${value}"${cloud?.mode === value ? ' selected' : ''}>${label}</option>`;
    ctx.modal('Sauvegardes automatiques', 'Une copie hors du navigateur, sans y penser.', `<form id="backup-vault-form" class="form-grid">
      <h3 class="span-2">Dossier de l’ordinateur</h3>
      <p class="span-2 form-note">${handle ? `Dossier choisi : « ${escapeHtml(handle.name)} ».` : 'Aucun dossier choisi : choisissez-le dans Mes données › Dossier de sauvegarde.'} Au démarrage ou à la reprise de Parcelles, une sauvegarde complète y est écrite si la dernière a plus de 7 jours et que l’accès au dossier est encore accordé ; sinon, un simple rappel s’affiche.</p>
      <label class="span-2 check-row"><input type="checkbox" name="autoFolder"${settings.autoFolder ? ' checked' : ''}> Écrire automatiquement chaque semaine</label>
      <label class="span-2">Garder les N dernières sauvegardes<input name="keep" type="number" min="1" max="${MAX_KEEP}" step="1" value="${settings.keep}" inputmode="numeric"></label>
      <p class="span-2 form-note">Seuls les fichiers « ${BACKUP_FILE_PREFIX}….zip » créés par Parcelles sont supprimés.</p>
      <h3 class="span-2">Instantané cloud mensuel</h3>
      ${owner ? `<label class="span-2">Instantané mensuel<select name="mode">${option('off', 'Désactivé')}${option('encrypted', 'Chiffré par une phrase secrète (recommandé)')}${option('plain', 'Non chiffré, automatique')}</select></label>
      <div class="span-2 notice warning" id="backup-vault-rgpd"${cloud.mode === 'plain' ? '' : ' hidden'}><strong>Données personnelles en clair dans le cloud.</strong> Sans chiffrement, l’instantané contient en clair vos clients, contacts et données d’exploitation (RGPD) ; il n’est lisible que par le propriétaire.<label class="check-row"><input type="checkbox" name="ack"${cloud.warned ? ' checked' : ''}> J’ai compris et j’accepte</label></div>
      <p class="span-2 form-note">Chiffré : la phrase secrète est demandée à chaque instantané et n’est jamais enregistrée ; un rappel discret s’affiche une fois par mois.</p>` : '<p class="span-2 form-note">Réservé au propriétaire d’une exploitation cloud connectée.</p>'}
      <p class="span-2 form-error" id="backup-vault-error" role="alert" hidden></p>
    </form>${owner ? '<div id="backup-vault-list" class="menu-list"><p class="form-note">Chargement des instantanés…</p></div>' : ''}`,
    `<button class="button secondary" data-action="close-modal">Fermer</button>${owner ? '<button class="button secondary" id="backup-vault-snapshot">Instantané maintenant</button>' : ''}<button class="button primary" id="backup-vault-save">Enregistrer</button>`, 'small');
    const form = $('backup-vault-form');
    form?.elements.mode?.addEventListener('change', () => { $('backup-vault-rgpd').hidden = form.elements.mode.value !== 'plain'; });
    $('backup-vault-snapshot')?.addEventListener('click', () => openSnapshotForm());
    $('backup-vault-save')?.addEventListener('click', async () => {
      const keep = Number(form.elements.keep.value);
      if (!Number.isInteger(keep) || keep < 1 || keep > MAX_KEEP) return formError('backup-vault-error', `Nombre de sauvegardes à garder : entre 1 et ${MAX_KEEP}.`);
      const mode = form.elements.mode?.value || 'off', ack = Boolean(form.elements.ack?.checked);
      if (owner && mode === 'plain' && !ack) return formError('backup-vault-error', 'Cochez l’avertissement pour un instantané non chiffré, ou choisissez le chiffrement.');
      const previous = await loadSettings(), next = normalizeVaultSettings({...previous, keep: normalizeKeep(keep), autoFolder: form.elements.autoFolder.checked});
      if (owner) next.cloud[ctx.sync.workspaceId] = {...cloudSettings(previous, ctx.sync.workspaceId), mode, warned: mode === 'plain' ? ack : cloudSettings(previous, ctx.sync.workspaceId).warned};
      try { await saveSettings(next); } catch (error) { return formError('backup-vault-error', `Réglage non enregistré : ${error?.message || error}`); }
      ctx.closeModal();
      ctx.toast('Réglages de sauvegarde enregistrés.', 'success', {label: 'Annuler', run: async () => { await saveSettings(previous); ctx.toast('Réglages précédents rétablis.'); }});
    });
    if (owner) renderList();
  }

  async function renderList() {
    const host = $('backup-vault-list');
    if (!host) return;
    let items;
    try { items = await listSnapshots(); } catch (error) { host.innerHTML = `<p class="form-note">Instantanés indisponibles : ${escapeHtml(error?.message || error)}</p>`; return; }
    if (!$('backup-vault-list')) return;
    host.innerHTML = items.length ? items.map(item => `<div class="menu-row"><span>☁</span><span><strong>${escapeHtml(localDateTime(item.createdAt))}</strong><small>${item.encrypted ? 'Chiffré' : 'Non chiffré'}</small></span><span><button type="button" class="button small secondary" data-vault-restore="${escapeHtml(item.name)}">Restaurer</button> <button type="button" class="button small ghost" data-vault-delete="${escapeHtml(item.name)}">Supprimer</button></span></div>`).join('') : '<p class="form-note">Aucun instantané cloud pour le moment.</p>';
    host.onclick = async event => {
      const button = event.target.closest('[data-vault-restore],[data-vault-delete]');
      if (!button) return;
      const name = button.dataset.vaultRestore || button.dataset.vaultDelete;
      if (button.dataset.vaultDelete) {
        if (button.dataset.confirm !== '1') { button.dataset.confirm = '1'; button.textContent = 'Confirmer la suppression'; return; }
        button.disabled = true;
        try { await fileRef(name).delete(); ctx.toast('Instantané supprimé du cloud.'); await renderList(); } catch (error) { button.disabled = false; ctx.toast(`Suppression impossible : ${error?.message || error}`, 'error'); }
        return;
      }
      button.disabled = true; button.textContent = 'Téléchargement…';
      try { await restoreSnapshot(name); } catch (error) { button.disabled = false; button.textContent = 'Restaurer'; ctx.toast(`Restauration impossible : ${error?.message || error}`, 'error'); }
    };
  }

  // Restauration : même chemin qu'un fichier choisi (aperçu, déchiffrement si besoin, confirmation).
  async function restoreSnapshot(name) {
    if (typeof restoreFile !== 'function') throw new Error('Restauration indisponible.');
    const response = await fetch(await fileRef(name).getDownloadURL());
    if (!response.ok) throw new Error(`téléchargement refusé (${response.status})`);
    const blob = await response.blob();
    await restoreFile(new File([blob], name, {type: 'application/json'}));
  }

  function openSnapshotForm() {
    if (!cloudReady()) { ctx.toast('Instantané cloud réservé au propriétaire d’une exploitation cloud connectée.', 'error'); return; }
    ctx.modal('Instantané cloud', 'Copie des données structurées dans le cloud de l’exploitation, lisible par le propriétaire seul.', `<form id="backup-snapshot-form" class="form-grid">
      <label class="span-2">Phrase secrète (recommandée)<input name="password" type="password" minlength="12" autocomplete="new-password"></label>
      <label class="span-2">Confirmer<input name="confirm" type="password" autocomplete="new-password"></label>
      <div class="span-2 notice warning"><strong>Sans phrase secrète, l’instantané est stocké en clair</strong> (clients, contacts, données d’exploitation : RGPD).<label class="check-row"><input type="checkbox" name="ack"> Envoyer sans chiffrement</label></div>
      <p class="span-2 form-note">Une phrase secrète oubliée rend l’instantané irrécupérable ; elle n’est jamais enregistrée. Les photos et documents ne sont pas inclus (ils sont déjà dans le cloud).</p>
      <p class="span-2 form-error" id="backup-snapshot-error" role="alert" hidden></p>
    </form>`, '<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="backup-snapshot-create">Créer l’instantané</button>', 'small');
    const button = $('backup-snapshot-create');
    button?.addEventListener('click', async () => {
      const form = $('backup-snapshot-form'), password = String(form.elements.password.value || ''), confirm = String(form.elements.confirm.value || '');
      if (password) {
        if (password !== confirm) return formError('backup-snapshot-error', 'Les deux phrases secrètes sont différentes.');
        const quality = passwordStrength(password);
        if (!quality.ok) return formError('backup-snapshot-error', `Phrase secrète ${String(quality.label).toLowerCase()} : au moins 12 caractères variés.`);
      } else if (!form.elements.ack.checked) return formError('backup-snapshot-error', 'Saisissez une phrase secrète, ou cochez l’envoi sans chiffrement.');
      formError('backup-snapshot-error', '');
      button.disabled = true; button.textContent = password ? 'Chiffrement…' : 'Envoi…';
      try {
        const name = await uploadSnapshot(password);
        ctx.closeModal();
        ctx.toast('Instantané cloud enregistré.', 'success', {label: 'Annuler', run: async () => { try { await fileRef(name).delete(); ctx.toast('Instantané retiré du cloud.'); } catch (error) { ctx.toast(`Retrait impossible : ${error?.message || error}`, 'error'); } }});
      } catch (error) { button.disabled = false; button.textContent = 'Créer l’instantané'; formError('backup-snapshot-error', `Instantané impossible : ${error?.message || error}`); }
    });
  }

  return {open, autoRun, rotateBackupFolder, openSnapshotForm, listSnapshots, restoreSnapshot};
}
