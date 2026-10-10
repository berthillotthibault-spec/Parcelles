// n° 133 : restauration avec aperçu, restauration sélective et restauration complète cohérente avec le cloud.
// Restauration sélective : store.upsertMany (historique, Annuler, synchronisation).
// Restauration complète : ZIP de sécurité d'abord ; dans un espace cloud, réservée au propriétaire, avec mise en file.
import {escapeHtml} from './utils.js';
import {diffBackup, prepareCloudRestore, previewSentence, restorableItems, selectiveEntities, typeName} from './restore-preview.js';

const KIND_LABELS = {added: 'revient', changed: 'version de la sauvegarde', deletedSince: 'supprimé depuis'};

export function createRestoreUI({store, sync, modal, closeModal, toast, exportCompleteBackup, restoreCompleteBackup}) {
  const $ = selector => document.querySelector(selector);
  const cloudSpace = () => !store.workspaceContext().isLocal;
  const role = () => sync?.role || 'owner';
  const dateTime = ms => {const d = new Date(Number(ms));return Number.isFinite(d.getTime()) ? d.toLocaleString('fr-FR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).replace(/^(\S+)\s+(\d+):(\d+)$/, '$1 à $2 h $3') : 'date inconnue';};
  const cap = text => text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);

  function table(diff) {
    const rows = Object.entries(diff.byType).map(([type, r]) => `<tr><th scope="row">${escapeHtml(cap(typeName(type)))}</th><td>${r.added.length ? `+${r.added.length}` : '–'}</td><td>${r.changed.length || '–'}</td><td>${r.deletedSince.length || '–'}</td><td>${r.newer.length || '–'}</td></tr>`).join('');
    return rows ? `<div class="restore-table-wrap"><table class="restore-table"><thead><tr><th scope="col">Type</th><th scope="col">Revient</th><th scope="col">Diffère</th><th scope="col">Supprimé<span class="sr-only"> depuis</span></th><th scope="col">Nouveau<span class="sr-only"> depuis</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  }

  // Aperçu : backup = {data (migrée), blobs?, meta:{createdAt, complete}}.
  function open(backup) {
    const current = store.snapshot(), diff = diffBackup(current, backup.data);
    const cloud = cloudSpace(), owner = role() === 'owner', fullAllowed = !cloud || owner;
    const newer = diff.totals.newer;
    const cloudNote = cloud
      ? owner
        ? '<div class="notice info">Espace cloud partagé : la restauration complète s’applique à toute l’équipe. Les fiches qui diffèrent sont envoyées au cloud ; celles créées depuis passent à la corbeille (récupérables).</div>'
        : '<div class="notice warning">Espace cloud partagé : seule la personne propriétaire peut tout restaurer, car cela remplace les données de toute l’équipe. Vous pouvez restaurer seulement certaines fiches.</div>'
      : '';
    const body = `<p class="restore-sentence">${escapeHtml(previewSentence(diff, backup.meta?.createdAt))}</p>${table(diff)}${newer && fullAllowed ? `<div class="notice warning">Une restauration complète retire ${newer} fiche${newer > 1 ? 's' : ''} créée${newer > 1 ? 's' : ''} ou rétablie${newer > 1 ? 's' : ''} depuis. Une sauvegarde de sécurité est faite avant.</div>` : ''}${cloudNote}<div class="notice info">${backup.meta?.complete ? 'Sauvegarde complète avec photos et documents.' : 'Sauvegarde de données sans fichiers joints.'}</div>`;
    modal('Restaurer la sauvegarde', `Sauvegarde du ${dateTime(backup.meta?.createdAt)}`, body,
      `<button class="button secondary" data-action="close-modal">Annuler</button>${diff.identical ? '' : '<button class="button secondary" id="restore-select">Restaurer seulement…</button>'}${fullAllowed ? '<button class="button primary" id="confirm-restore">Sauvegarder puis tout restaurer</button>' : ''}`, 'large');
    $('#restore-select')?.addEventListener('click', () => openSelection(backup, diff));
    $('#confirm-restore')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try {await restoreAll(backup);closeModal();toast(cloud ? 'Sauvegarde restaurée : les différences seront envoyées au cloud.' : 'Sauvegarde restaurée.');}
      catch (error) {event.currentTarget.disabled = false;toast(`Restauration impossible : ${error.message}`, 'error');}
    });
    return diff;
  }

  async function restoreAll(backup) {
    await exportCompleteBackup({deliver: false});
    if (!cloudSpace()) {
      if (backup.meta?.complete) await restoreCompleteBackup(backup, store);
      else await store.replaceState(backup.data, 'Sauvegarde restaurée.', {kind: 'restore'});
      return;
    }
    if (role() !== 'owner') throw new Error('Réservée à la personne propriétaire de l’exploitation.');
    const {data, ops} = prepareCloudRestore(store.snapshot(), backup.data);
    await store.replaceState(data, 'Sauvegarde restaurée dans l’espace cloud.', {kind: 'restore'});
    for (const item of backup.blobs || []) await store.storage.blobPut(item.meta.id, item.blob);
    if (ops.length) await store.mutate(`Restauration : ${ops.length} fiche${ops.length > 1 ? 's' : ''} à synchroniser.`, () => {for (const op of ops) store.queue(op);}, {queue: false, kind: 'restore', entity: 'state', action: 'restore'});
  }

  function openSelection(backup, diff) {
    const groups = Object.keys(diff.byType).map(type => ({type, items: restorableItems(diff, backup.data, type)})).filter(group => group.items.length);
    const body = groups.length ? `<form id="restore-select-form" class="restore-select">${groups.map(({type, items}) => `<fieldset class="restore-group"><legend><label class="restore-check"><input type="checkbox" data-restore-type="${escapeHtml(type)}"> <strong>${escapeHtml(cap(typeName(type)))}</strong> <small>${items.length} fiche${items.length > 1 ? 's' : ''}</small></label></legend><details><summary>Choisir des fiches</summary><div class="restore-items">${items.map(item => `<label class="restore-check"><input type="checkbox" name="item" value="${escapeHtml(`${type}|${item.id}`)}" data-type="${escapeHtml(type)}"> <span>${escapeHtml(item.title)} <small>${KIND_LABELS[item.kind]}</small></span></label>`).join('')}</div></details></fieldset>`).join('')}<p class="form-error" id="restore-select-error" hidden>Cochez au moins un type ou une fiche.</p></form>` : '<div class="empty-state">Rien à rétablir depuis cette sauvegarde.</div>';
    modal('Restaurer seulement…', 'Les fiches cochées reprennent leur version de la sauvegarde. Le reste ne change pas, et chaque fiche peut être annulée dans son historique.', body,
      `<button class="button secondary" id="restore-select-back">Retour</button>${groups.length ? '<button class="button primary" id="restore-select-apply">Restaurer la sélection</button>' : ''}`, 'large');
    const form = $('#restore-select-form');
    form?.querySelectorAll('[data-restore-type]').forEach(box => box.addEventListener('change', () => {
      form.querySelectorAll(`input[name="item"][data-type="${box.dataset.restoreType}"]`).forEach(input => {input.checked = box.checked;});
    }));
    form?.querySelectorAll('input[name="item"]').forEach(input => input.addEventListener('change', () => {
      const all = [...form.querySelectorAll(`input[name="item"][data-type="${input.dataset.type}"]`)], head = form.querySelector(`[data-restore-type="${input.dataset.type}"]`);
      head.checked = all.every(x => x.checked);head.indeterminate = !head.checked && all.some(x => x.checked);
    }));
    $('#restore-select-back').addEventListener('click', () => open(backup));
    $('#restore-select-apply')?.addEventListener('click', async event => {
      const selection = [...form.querySelectorAll('input[name="item"]:checked')].map(input => {const [type, ...rest] = input.value.split('|');return {type, id: rest.join('|')};});
      const error = $('#restore-select-error');
      if (!selection.length) {error.hidden = false;return;}
      error.hidden = true;event.currentTarget.disabled = true;
      try {
        const n = await restoreSelection(backup, selection);
        closeModal();toast(`${n} fiche${n > 1 ? 's' : ''} restaurée${n > 1 ? 's' : ''} depuis la sauvegarde.`);
      } catch (err) {event.currentTarget.disabled = false;toast(`Restauration impossible : ${err.message}`, 'error');}
    });
  }

  async function restoreSelection(backup, selection) {
    let n = 0;
    for (const {type, entities} of selectiveEntities(store.snapshot(), backup.data, selection)) {
      await store.upsertMany(type, entities, {label: `Restauration de ${entities.length} ${typeName(type, entities.length)} depuis une sauvegarde`});
      n += entities.length;
      if (type === 'photos' || type === 'documents') {
        const ids = new Set(entities.map(item => item.id));
        for (const item of backup.blobs || []) if (ids.has(item.meta.id)) await store.storage.blobPut(item.meta.id, item.blob);
      }
    }
    return n;
  }

  return {open, restoreAll, restoreSelection};
}
