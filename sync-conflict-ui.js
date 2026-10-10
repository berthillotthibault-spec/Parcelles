// n° 131 : écran de conflit de synchronisation, une carte par champ (interface).
// La résolution passe toujours par store.upsert (historique, Annuler, file de synchronisation).
import {escapeHtml} from './utils.js';
import {chipify, validateForm} from './form-chips-ui.js';
import {buildMergedEntity, conflictFieldRows, conflictSources, entityTitle} from './sync-conflict.js';

export function createSyncConflictUI({store, modal, closeModal, toast, openSync, entityTypeLabel}) {
  const $ = selector => document.querySelector(selector);
  const parcelName = id => store.get('parcelles', id, {includeDeleted: true})?.nom || '';
  const deviceNoun = () => (globalThis.matchMedia?.('(pointer: coarse)').matches && innerWidth < 900 ? 'ce téléphone' : 'cet appareil');

  function fieldCard(row, index) {
    const name = `cf-${index}`;
    const note = row.kind === 'fill' ? '<small class="conflict-sheet-note">Modifié d’un seul côté : cette valeur est proposée.</small>' : '';
    return `<div class="conflict-sheet-field conflict-sheet-${row.kind}" data-field="${escapeHtml(row.key)}"><label>${escapeHtml(row.label)}<input name="${name}" data-key="${escapeHtml(row.key)}" ${row.kind === 'conflict' ? 'required' : ''} value="${row.suggested || ''}"></label>${note}</div>`;
  }

  function open(id) {
    const c = store.get('syncConflicts', id);
    if (!c) return;
    const rows = conflictFieldRows(c, {parcelName});
    const noun = deviceNoun(), src = conflictSources(c, {deviceNoun: noun});
    const sources = {...src, localShort: noun === 'ce téléphone' ? 'Ce téléphone' : 'Cet appareil', remoteShort: 'Cloud'};
    const differing = rows.filter(row => row.kind !== 'same'), same = rows.filter(row => row.kind === 'same');
    const conflicts = differing.filter(row => row.kind === 'conflict').length;
    const title = entityTitle(c.entity, c.local || c.remote, {parcelName});
    const body = `<div class="conflict-sheet">
      <div class="conflict-sheet-sources"><span class="sync-source sync-source-local">${escapeHtml(src.local)}</span><span class="sync-source sync-source-remote">${escapeHtml(src.remote)}</span></div>
      <p class="conflict-sheet-summary">${conflicts ? `${conflicts} champ${conflicts > 1 ? 's' : ''} modifié${conflicts > 1 ? 's' : ''} des deux côtés : choisissez la bonne valeur.` : 'Aucun champ contradictoire : vérifiez puis validez.'}</p>
      ${differing.length > 1 ? `<div class="conflict-sheet-all" role="group" aria-label="Tout choisir"><span>Tout choisir :</span><button type="button" class="choice-chip" data-conflict-all="local">${escapeHtml(sources.localShort)}</button><button type="button" class="choice-chip" data-conflict-all="remote">Cloud</button></div>` : ''}
      <form id="conflict-sheet-form" class="conflict-sheet-fields" novalidate>${differing.map((row, index) => fieldCard(row, index)).join('')}</form>
      ${same.length ? `<details class="conflict-sheet-same"><summary>${same.length} champ${same.length > 1 ? 's' : ''} identique${same.length > 1 ? 's' : ''}</summary><dl>${same.map(row => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.localText)}</dd></div>`).join('')}</dl></details>` : ''}
    </div>`;
    modal('Conflit de synchronisation', `${entityTypeLabel(c.entity)} · ${title}`, body,
      `<button class="button secondary" data-action="open-sync">Annuler</button><button class="button primary" id="conflict-sheet-apply">Valider ma sélection</button>`, 'large');
    const form = $('#conflict-sheet-form');
    form.querySelectorAll('input[data-key]').forEach(input => {
      const row = differing.find(r => r.key === input.dataset.key);
      chipify(input, {other: null, options: [{value: 'local', label: `${sources.localShort} · ${row.localText}`}, {value: 'remote', label: `Cloud · ${row.remoteText}`}]});
    });
    document.querySelectorAll('[data-conflict-all]').forEach(button => button.addEventListener('click', () => {
      form.querySelectorAll('input[data-key]').forEach(input => {input.value = button.dataset.conflictAll;input.dispatchEvent(new Event('change', {bubbles: true}));});
    }));
    $('#conflict-sheet-apply').addEventListener('click', async event => {
      if (!validateForm(form)) return;
      const choices = Object.fromEntries([...form.querySelectorAll('input[data-key]')].map(input => [input.dataset.key, input.value]));
      const button = event.currentTarget;button.disabled = true;
      try {
        await resolveWithChoices(c, choices, rows);
        closeModal();openSync?.();toast('Conflit réglé : votre sélection est enregistrée et sera synchronisée.');
      } catch (error) {button.disabled = false;toast(error.message, 'error');}
    });
  }

  async function resolveWithChoices(c, choices, rows = conflictFieldRows(c, {parcelName})) {
    const merged = buildMergedEntity(c, choices, rows);
    const types = Object.keys(store.state || {});
    if (types.includes(c.entity) && Array.isArray(store.state[c.entity])) {
      const deletedAt = merged.deletedAt || null;
      await store.upsert(c.entity, {...merged, deletedAt: null}, {label: `Conflit réglé : ${entityTitle(c.entity, merged, {parcelName})}.`, queue: true});
      // store.upsert rend la fiche active : une suppression retenue est appliquée ensuite (corbeille, synchronisée).
      if (deletedAt) await store.remove(c.entity, merged.id);
    }
    await store.upsert('syncConflicts', {...c, status: 'resolved-fields', choices, resolvedAt: Date.now()}, {label: 'Conflit de synchronisation résolu.', queue: false});
    return merged;
  }

  return {open, resolveWithChoices};
}
