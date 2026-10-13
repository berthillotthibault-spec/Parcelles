// n° 47 : écran « Vérification du parcellaire » (contrôle PAC indicatif). Le RPG est facultatif :
// sans connexion, les contrôles locaux (contours, chevauchements, surfaces saisies) restent disponibles.
import {html, raw} from './safe-html.js';
import {PARCEL_CHECK_DISCLAIMER, bboxPolygon, checkParcels, rpgYearOptions} from './parcel-check.js';
import {geometryBbox} from './utils.js';

const KIND_LABELS={overlap:'Chevauchements',geometry:'Contours à corriger',surface:'Écarts de surface (> 2 %)','rpg-split':'Découpes RPG','rpg-missing':'Parcelles RPG non reprises'};
const ORDER=['overlap','geometry','surface','rpg-split','rpg-missing'];

export function createParcelCheckUI({state, modal, toast, fetchRpg, mapRpg = () => null, showOnMap, doc = globalThis.document, now = () => new Date()} = {}) {
  let rpg = null, year = null, loading = false, result = null;
  const $ = sel => doc.querySelector(sel);

  function farmZone() {
    const boxes = (state().parcelles || []).filter(p => !p.deletedAt && p.geometry).map(p => geometryBbox(p.geometry)).filter(Boolean);
    if (!boxes.length) return null;
    const pad = 0.002;
    return bboxPolygon([Math.min(...boxes.map(b => b[0])) - pad, Math.min(...boxes.map(b => b[1])) - pad, Math.max(...boxes.map(b => b[2])) + pad, Math.max(...boxes.map(b => b[3])) + pad]);
  }
  function currentRpg() {
    if (rpg) return rpg;
    const fromMap = mapRpg();
    return fromMap?.features?.length ? fromMap : null;
  }
  function fixButtons(issue) {
    const id = issue.parcelIds[0];
    if (!id) return '';
    if (issue.kind === 'surface') return html`<button class="small-button" data-action="edit-parcel" data-id="${id}">Corriger</button>`;
    if (issue.kind === 'rpg-split') return html`<button class="small-button" data-action="split-parcel" data-id="${id}">Découper</button>`;
    if (issue.kind === 'rpg-missing') return '';
    return html`<button class="small-button" data-action="edit-contour" data-id="${id}">Corriger</button>`;
  }
  function listHtml() {
    if (!result.issues.length) return html`<div class="empty-state">Aucun écart détecté sur ${result.checked} parcelle${result.checked > 1 ? 's' : ''}.</div>`;
    return raw(ORDER.filter(kind => result.counts[kind]).map(kind => {
      const items = result.issues.map((issue, index) => ({issue, index})).filter(x => x.issue.kind === kind);
      return html`<section class="parcel-check-group"><h3>${KIND_LABELS[kind]} <span class="badge ${kind === 'rpg-missing' ? 'info' : items[0].issue.severity}">${items.length}</span></h3><div class="stack-list">${items.map(({issue, index}) => html`<div class="list-row"><div><strong>${issue.title}</strong><small>${issue.detail}</small></div><div class="parcel-check-actions">${issue.geometry ? html`<button class="small-button" data-check-show="${index}">Voir sur la carte</button>` : ''}${fixButtons(issue)}</div></div>`)}</div></section>`;
    }).map(String).join(''));
  }
  function rpgHtml() {
    const loaded = currentRpg(), years = rpgYearOptions(now());
    const status = loading ? 'Chargement du RPG…' : loaded ? `RPG ${loaded.year} chargé : ${loaded.features.length} parcelle${loaded.features.length > 1 ? 's' : ''} autour de l’exploitation.` : 'RPG non chargé : les comparaisons au RPG sont ignorées.';
    return html`<div class="parcel-check-rpg"><label class="field-label">Millésime RPG<select id="parcel-check-year">${years.map(y => html`<option value="${y}" ${raw(Number(year || loaded?.year || years[0]) === y ? 'selected' : '')}>${y}</option>`)}</select></label><button class="button secondary" id="parcel-check-load" ${raw(loading ? 'disabled' : '')}>Charger le RPG</button><small class="form-note" id="parcel-check-status">${status}</small></div>`;
  }
  function render() {
    const loaded = currentRpg();
    result = checkParcels(state(), {rpgFeatures: loaded?.features || [], rpgYear: loaded?.year || null});
    const body = $('#parcel-check-body');
    if (body) { body.innerHTML = String(html`${rpgHtml()}${listHtml()}`); bind(); }
  }
  function bind() {
    $('#parcel-check-year')?.addEventListener('change', event => { year = Number(event.target.value); });
    $('#parcel-check-load')?.addEventListener('click', loadRpg);
    doc.querySelectorAll('[data-check-show]').forEach(button => button.addEventListener('click', () => {
      const issue = result.issues[Number(button.dataset.checkShow)];
      if (issue) showOnMap(issue);
    }));
  }
  async function loadRpg() {
    const zone = farmZone();
    if (!zone) { toast('Aucune parcelle dessinée : rien à comparer au RPG.', 'error'); return; }
    const chosen = Number($('#parcel-check-year')?.value || year || rpgYearOptions(now())[0]);
    if (globalThis.navigator && globalThis.navigator.onLine === false) { toast('Hors connexion : le RPG ne peut pas être chargé. Les autres contrôles restent valables.', 'error'); return; }
    loading = true; year = chosen; render();
    try {
      const data = await fetchRpg({geometry: zone, year: chosen});
      rpg = {year: chosen, features: data.features || []};
      toast(`RPG ${chosen} chargé.`, 'success');
    } catch (error) {
      toast(`${error?.message || 'RPG indisponible.'} Essayez un millésime plus ancien si celui-ci n’est pas encore publié.`, 'error');
    } finally { loading = false; render(); }
  }
  function open() {
    modal('Vérification du parcellaire', 'Chevauchements, surfaces, RPG et contours.',
      html`<div class="notice info"><small>${PARCEL_CHECK_DISCLAIMER}</small></div><div id="parcel-check-body"></div>`,
      html`<button class="button secondary" data-action="open-pac">Assistant PAC</button><button class="button primary" data-action="close-modal">Fermer</button>`, 'large');
    render();
  }
  return {open, render, result: () => result};
}
