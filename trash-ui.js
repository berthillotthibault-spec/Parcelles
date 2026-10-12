// Corbeille (n° 141) : groupement par type, recherche, auteur de la suppression, restauration des éléments liés
// proposée (jamais automatique), vidage confirmé par le nombre d'éléments, purge réservée au propriétaire en cloud.
import {html, raw} from './safe-html.js';
import {canPurgeTrash} from './permissions.js';
import {trashRows, trashGroups, filterTrash, deletedBy, deletedLabel, relatedDeletions, emptyConfirmed} from './trash.js';

export function createTrashUI({store, state, modal, closeModal, toast, entityTypes, titleOf, typeLabel, localDateTime = at => new Date(at).toLocaleString('fr-FR'),
  role = () => 'owner', isCloud = () => false, remoteAuthor = () => null, doc = globalThis.document} = {}) {
  let filters = {type: '', query: ''};
  const $ = sel => doc.querySelector(sel);
  const canPurge = () => canPurgeTrash({role: role(), cloud: isCloud()});
  const rows = () => trashRows(state(), entityTypes);

  function rowHtml({type, item}, journal, purge) {
    const who = deletedBy(type, item, {journal, remoteAuthor: remoteAuthor(type, item.id)});
    return html`<div class="list-row"><div><strong>${titleOf(type, item)}</strong><small title="${localDateTime(item.deletedAt)}">${typeLabel(type)} · ${deletedLabel(type, item, {who})}</small></div><div><button class="small-button" data-action="restore-trash" data-type="${type}" data-id="${item.id}">Restaurer</button>${purge ? html` <button class="small-button danger" data-action="purge-trash" data-type="${type}" data-id="${item.id}">Définitif</button>` : ''}</div></div>`;
  }
  function listHtml(all) {
    const list = filterTrash(all, {...filters, titleOf}), journal = state().journal || [], purge = canPurge();
    if (!list.length) return html`<div class="empty-state">${all.length ? 'Aucun élément pour cette recherche.' : 'Aucun élément supprimé.'}</div>`;
    return html`<div class="stack-list">${list.map(row => rowHtml(row, journal, purge))}</div>`;
  }
  function chipsHtml(all) {
    const chip = (type, label) => html`<button type="button" class="filter-chip ${raw(filters.type === type ? 'is-active' : '')}" data-trash-type="${type}" aria-pressed="${filters.type === type ? 'true' : 'false'}">${label}</button>`;
    return html`<div class="filter-row trash-filters" role="group" aria-label="Type d’élément">${chip('', `Tout (${all.length})`)}${trashGroups(all).map(g => chip(g.type, `${typeLabel(g.type)} (${g.count})`))}</div>`;
  }
  function refresh() {
    const all = rows(), box = $('#trash-list'); if (!box) return;
    box.innerHTML = listHtml(all);
    doc.querySelectorAll('[data-trash-type]').forEach(b => { const on = b.dataset.trashType === filters.type; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  }

  function open() {
    const all = rows();
    if (filters.type && !all.some(r => r.type === filters.type)) filters.type = '';
    const purge = canPurge();
    modal('Corbeille', all.length ? `${all.length} élément${all.length > 1 ? 's' : ''} récupérable${all.length > 1 ? 's' : ''}.` : 'La corbeille est vide.',
      all.length ? html`<div class="notice warning">Les photos et documents restent stockés tant qu’ils sont dans la corbeille. La suppression définitive est irréversible.</div>
        ${chipsHtml(all)}<label class="field-label">Rechercher<input type="search" id="trash-search" value="${filters.query}" placeholder="Nom, type, note…" autocomplete="off"></label>
        ${purge ? '' : html`<p class="form-note">Exploitation partagée : seule la personne propriétaire peut supprimer définitivement.</p>`}
        <div id="trash-list">${listHtml(all)}</div>` : html`<div class="empty-state">Aucun élément supprimé.</div>`,
      html`<button class="button secondary" data-action="open-data-center">Retour</button>${all.length && purge ? html`<button class="button danger" data-action="empty-trash">Vider la corbeille</button>` : ''}`, 'large');
    doc.querySelectorAll('[data-trash-type]').forEach(b => b.addEventListener('click', () => { filters.type = b.dataset.trashType; refresh(); }));
    $('#trash-search')?.addEventListener('input', event => { filters.query = event.target.value; refresh(); });
  }

  async function restore(type, id) {
    const before = store.get(type, id, {includeDeleted: true});
    const related = type === 'parcelles' ? relatedDeletions(state(), before) : [];
    await store.restore(type, id);
    if (!related.length) { toast(type === 'parcelles' ? 'Parcelle restaurée.' : 'Élément restauré.'); open(); return; }
    modal('Restaurer aussi ?', `${related.length} élément${related.length > 1 ? 's' : ''} de « ${titleOf(type, before)} » supprimé${related.length > 1 ? 's' : ''} le même jour.`,
      html`<p>La parcelle est restaurée. Voulez-vous aussi restaurer ces travaux et passages ?</p><form id="trash-related" class="stack-list">${related.map(r => html`<label class="check-row"><input type="checkbox" name="item" value="${r.type}:${r.item.id}" checked> ${typeLabel(r.type)} · ${titleOf(r.type, r.item)}</label>`)}</form>`,
      html`<button class="button secondary" id="trash-related-skip">Non, seulement la parcelle</button><button class="button primary" id="trash-related-ok">Restaurer la sélection</button>`, 'small');
    $('#trash-related-skip').addEventListener('click', () => open());
    $('#trash-related-ok').addEventListener('click', async () => {
      const picked = new FormData($('#trash-related')).getAll('item').map(v => String(v).split(':'));
      let n = 0; for (const [t, i] of picked) { try { await store.restore(t, i); n++; } catch {} }
      toast(n ? `Parcelle et ${n} élément${n > 1 ? 's' : ''} restaurés.` : 'Parcelle restaurée.', 'success'); open();
    });
  }

  async function purge(type, id) {
    if (!canPurge()) return toast('Seule la personne propriétaire peut supprimer définitivement.', 'error');
    await store.purge(type, id); open(); toast('Élément supprimé définitivement.');
  }

  function empty() {
    if (!canPurge()) return toast('Seule la personne propriétaire peut vider la corbeille.', 'error');
    const all = rows(); if (!all.length) return;
    modal('Vider la corbeille', `${all.length} élément${all.length > 1 ? 's' : ''} seront supprimés définitivement.`,
      html`<div class="notice warning">Action irréversible. Avant de vider, gardez une sauvegarde complète ZIP (données, photos et documents) hors de l’appareil.</div>
        <p><button type="button" class="button secondary" data-action="export-complete-backup">Télécharger la sauvegarde ZIP</button></p>
        <form id="trash-empty-form" class="form-grid"><label class="span-2">Pour confirmer, saisissez le nombre d’éléments (${all.length})<input name="count" inputmode="numeric" autocomplete="off" required></label><p class="span-2 form-error" id="trash-empty-error" role="alert" hidden></p></form>`,
      html`<button class="button secondary" data-action="open-trash">Annuler</button><button class="button danger" id="trash-empty-ok">Supprimer définitivement</button>`, 'small');
    const run = async event => {
      event?.preventDefault();
      const typed = new FormData($('#trash-empty-form')).get('count'), current = rows();
      if (!emptyConfirmed(typed, current.length)) { const e = $('#trash-empty-error'); e.textContent = `Saisissez ${current.length} pour confirmer.`; e.hidden = false; return; }
      for (const row of current) await store.purge(row.type, row.item.id);
      filters = {type: '', query: ''}; open(); toast('Corbeille vidée.');
    };
    $('#trash-empty-ok').addEventListener('click', run);
    $('#trash-empty-form').addEventListener('submit', run);
  }

  return {open, restore, purge, empty};
}
