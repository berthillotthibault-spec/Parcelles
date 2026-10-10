// n° 132 : pastille de synchronisation à 5 états, feuille « File de synchronisation » et rappel d'Aujourd'hui.
// N'appelle que les méthodes publiques de sync.js (sync, retryFailed) : le moteur n'est pas modifié.
import {escapeHtml} from './utils.js';
import {sanitizeCloudError} from './security.js';
import {readableQueue, staleSyncReminder, syncPillState, durationAgo, entityLabel} from './sync-status.js';
import {entityTitle, fieldLabel} from './sync-conflict.js';

const TONES = ['ok', 'sending', 'pending', 'error', 'conflict', 'offline', 'readonly', 'local'];
const MAX_ROWS = 60;

export function createSyncStatusUI({store, sync, modal, closeModal, toast, openSync, withProgress}) {
  let run = null, timer = null;
  const $ = selector => document.querySelector(selector);
  const data = () => store.snapshot();
  const cloudConnected = () => Boolean(sync?.status?.connected);
  const cloudActive = () => {const p = data().preferences || {};return cloudConnected() || Boolean(p.syncEnabled && p.workspaceId);};

  // Suit l'envoi en cours (« Envoi… 4/12 ») à partir des opérations prêtes au début de la synchronisation.
  function progress(queue) {
    const promise = sync?.syncPromise;
    if (!promise) {run = null;return null;}
    if (!run || run.promise !== promise) {
      const now = Date.now();
      const ids = new Set(queue.filter(op => op?.status === 'pending' && Number(op.nextRetryAt || 0) <= now).map(op => op.id));
      run = {promise, ids};
      const end = () => {if (run?.promise === promise) {run = null;render();}};
      promise.then(end, end);
    }
    const waiting = new Set(queue.filter(op => op?.status === 'pending').map(op => op.id));
    return {total: run.ids.size, done: [...run.ids].filter(id => !waiting.has(id)).length};
  }

  function pill() {
    const snapshot = data();
    return syncPillState({data: snapshot, offline: !navigator.onLine, schemaLock: Boolean(store.schemaLock), tabReadOnly: Boolean(store.tabReadOnly),
      viewer: cloudConnected() && sync.role === 'viewer', cloud: cloudConnected(), syncing: progress(snapshot.queue || [])});
  }

  function render() {
    if (!store) return;
    const state = pill();
    const button = $('#network-button');
    if (button) {
      TONES.forEach(tone => button.classList.toggle(`sync-${tone}`, state.tone === tone));
      button.classList.toggle('offline', state.tone === 'offline');
      button.classList.toggle('is-pending', state.tone === 'pending');
      button.setAttribute('aria-label', `Synchronisation : ${state.label}${state.detail ? `. ${state.detail}` : ''} Ouvrir la file de synchronisation.`);
      button.title = state.detail ? `${state.label} · ${state.detail}` : state.label;
    }
    for (const id of ['#network-label', '#desktop-network-label']) {const el = $(id);if (el && el.textContent !== state.label) el.textContent = state.label;}
    const side = $('#desktop-network-dot')?.parentElement;
    if (side) TONES.forEach(tone => side.classList.toggle(`sync-${tone}`, state.tone === tone));
    // n° 131 : la pastille du bureau ouvre aussi la file (et les conflits à régler).
    if (side && !side.dataset.action) {
      side.dataset.action = 'network-details';side.setAttribute('role', 'button');side.tabIndex = 0;
      side.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();side.click();}});
    }
    if (side) side.setAttribute('aria-label', `Synchronisation : ${state.label}. Ouvrir la file de synchronisation.`);
    $('#desktop-network-dot')?.classList.toggle('offline', state.tone === 'offline');
    if (!timer) timer = setInterval(() => {if (!document.hidden) render();}, 60000);
    return state;
  }

  async function retry({quiet = false} = {}) {
    try {
      await sync.retryFailed();
      if (cloudConnected() && navigator.onLine && !store.tabReadOnly) {
        const task = () => sync.sync({force: true});
        render();
        const result = withProgress ? await withProgress('Synchronisation des données…', task) : await task();
        if (!quiet) toast(`Synchronisation terminée : ${result?.sent || 0} ${(result?.sent || 0) > 1 ? 'envoyées' : 'envoyée'}.`);
      } else if (!quiet) toast(navigator.onLine ? 'File réarmée : l’envoi reprendra dès que le cloud sera connecté.' : 'File réarmée : l’envoi reprendra au retour du réseau.');
    } catch (error) {
      toast(`Synchronisation impossible : ${sanitizeCloudError(error)}`, 'error');
    } finally {render();}
  }

  function rowHtml(row) {
    const icon = row.status === 'error' ? '!' : row.status === 'conflict' ? '≠' : '…';
    const error = row.error ? `<button type="button" class="text-button" data-sync-error="${escapeHtml(row.id)}" aria-expanded="false" aria-controls="sync-error-${escapeHtml(row.id)}">Voir l’erreur</button><p class="sync-op-error" id="sync-error-${escapeHtml(row.id)}" hidden>${escapeHtml(sanitizeCloudError(row.error))}</p>` : '';
    return `<li class="sync-op sync-op-${row.status}"><span class="sync-op-icon" aria-hidden="true">${icon}</span><div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.kind)} · ${escapeHtml(row.detail)}</small>${error}</div></li>`;
  }

  function sheetBody() {
    const snapshot = data(), state = pill(), rows = readableQueue(snapshot);
    const conflicts = (snapshot.syncConflicts || []).filter(c => c && c.status === 'open' && !c.deletedAt);
    const last = Number(snapshot.metadata?.lastSyncAt) || 0, lastError = snapshot.metadata?.lastSyncError;
    const head = `<div class="sync-sheet-state sync-${state.tone}" role="status"><span class="sync-sheet-dot" aria-hidden="true"></span><div><strong>${escapeHtml(state.label)}</strong><small>${escapeHtml(state.detail || '')}${last ? ` Dernière synchronisation réussie ${escapeHtml(durationAgo(Date.now() - last))}.` : cloudActive() ? ' Aucune synchronisation réussie pour l’instant.' : ''}</small></div></div>`;
    const errorNotice = lastError && cloudActive() ? `<div class="notice warning sync-last-error"><strong>Dernière erreur</strong> <button type="button" class="text-button" data-sync-error="last" aria-expanded="false" aria-controls="sync-error-last">Voir l’erreur</button><p class="sync-op-error" id="sync-error-last" hidden>${escapeHtml(sanitizeCloudError(lastError))}</p></div>` : '';
    const conflictList = conflicts.length ? `<h3 class="sync-sheet-title">À arbitrer</h3><div class="stack-list">${conflicts.map(c => `<button class="menu-row" data-action="open-sync-conflict" data-id="${escapeHtml(c.id)}"><span>≠</span><span><strong>${escapeHtml(`${entityLabel(c.entity)} · ${entityTitle(c.entity, c.local || c.remote)}`)}</strong><small>${escapeHtml((c.conflictFields || []).length ? `À choisir : ${c.conflictFields.map(fieldLabel).join(', ')}` : 'Deux versions différentes')}</small></span><b>›</b></button>`).join('')}</div>` : '';
    const list = rows.length
      ? `<h3 class="sync-sheet-title">${rows.length > 1 ? `${rows.length} opérations à envoyer` : '1 opération à envoyer'}</h3><ul class="sync-op-list">${rows.slice(0, MAX_ROWS).map(rowHtml).join('')}</ul>${rows.length > MAX_ROWS ? `<p class="form-note">Et ${rows.length - MAX_ROWS} autres, envoyées dans l’ordre.</p>` : ''}`
      : `<p class="sync-empty">${cloudActive() ? 'Rien en attente : tout ce que vous avez saisi est envoyé.' : 'Synchronisation cloud non activée : vos données restent sur cet appareil.'}</p>`;
    return `${head}${errorNotice}${conflictList}${list}<p class="form-note">Une erreur réseau n’efface jamais la saisie locale : chaque opération reste ici jusqu’à son envoi.</p>`;
  }

  function sheetFooter() {
    const snapshot = data(), errors = (snapshot.queue || []).some(op => op?.status === 'error') || Boolean(snapshot.metadata?.lastSyncError && cloudActive());
    const writable = !store.tabReadOnly && !store.schemaLock;
    const canRun = cloudConnected() && navigator.onLine && !store.tabReadOnly;
    return `<button class="button secondary" type="button" id="sync-sheet-details">Détails techniques</button><button class="button secondary" data-action="close-modal">Fermer</button>${errors && writable ? '<button class="button primary" type="button" id="sync-sheet-retry">Réessayer</button>' : canRun ? '<button class="button primary" type="button" id="sync-sheet-run">Synchroniser maintenant</button>' : ''}`;
  }

  function bindSheet() {
    const body = document.querySelector('.sync-sheet-body')?.closest('.modal') || document;
    body.querySelectorAll('[data-sync-error]').forEach(button => button.addEventListener('click', () => {
      const target = document.getElementById(button.getAttribute('aria-controls'));if (!target) return;
      target.hidden = !target.hidden;button.setAttribute('aria-expanded', String(!target.hidden));button.textContent = target.hidden ? 'Voir l’erreur' : 'Masquer l’erreur';
    }));
    $('#sync-sheet-details')?.addEventListener('click', () => openSync());
    const again = async button => {button.disabled = true;await retry();if (document.getElementById('sync-sheet-root')) openSheet();};
    $('#sync-sheet-retry')?.addEventListener('click', event => again(event.currentTarget));
    $('#sync-sheet-run')?.addEventListener('click', event => again(event.currentTarget));
  }

  function openSheet({autoRetry = false} = {}) {
    const state = render();
    modal('Synchronisation', 'Ce qui attend d’être envoyé, en clair.', `<div id="sync-sheet-root" class="sync-sheet-body">${sheetBody()}</div>`, sheetFooter(), 'small');
    bindSheet();
    if (autoRetry && state?.tone === 'error' && navigator.onLine) retry({quiet: false}).then(() => {if (document.getElementById('sync-sheet-root')) openSheet();});
  }

  function today() {
    const anchor = document.getElementById('backup-reminder');if (!anchor) return;
    let root = document.getElementById('sync-reminder');
    const info = store.schemaLock ? null : staleSyncReminder({data: data(), cloudActive: cloudActive()});
    if (!info) {root?.remove();return;}
    if (!root) {root = document.createElement('div');root.id = 'sync-reminder';root.className = 'sync-reminder';root.setAttribute('role', 'status');anchor.after(root);}
    const title = info.never ? `Saisies en attente d’envoi depuis ${info.days} jours` : `Aucune synchronisation depuis ${info.days} jours`;
    const html = `<div><strong>${escapeHtml(title)}</strong><small>Vos saisies sont en sécurité sur cet appareil, mais l’équipe ne les voit pas encore.</small></div><button type="button" class="button secondary" data-action="sync-sheet">Voir la file</button>`;
    if (root.innerHTML !== html) root.innerHTML = html;
  }

  return {render, openSheet, retry, today};
}
