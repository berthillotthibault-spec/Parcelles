// n° 8 — Saisie express « J’ai fait… » : bouton flottant, feuille du bas et enregistrement en un geste.
// La parcelle vient du mode terrain ou du GPS (seulement si la précision est ≤ 30 m) ; un appui
// sur un type enregistre un travail terminé aujourd’hui, annulable depuis le toast.
import {rankTypes, rankParcels, buildQuickWork, isPhytoType, formatDistance, GPS_MAX_ACCURACY_M} from './quick-entry.js';
import {haptic} from './motion.js';
import {escapeHtml, formatNumber} from './utils.js';

const SVG = path => `<svg class="quick-glyph" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
export const GLYPHS = {
  spray: SVG('<path d="M12 3c3 4 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 3-7 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
  harvest: SVG('<path d="M12 21V7"/><path d="M12 7c-2-.8-3-2.6-3-4.5 2 .2 3 2 3 4.5zm0 0c2-.8 3-2.6 3-4.5-2 .2-3 2-3 4.5z"/><path d="M12 12.5c-2.2-.6-3.6-2.2-3.6-4.2 2.2.1 3.6 1.8 3.6 4.2zm0 0c2.2-.6 3.6-2.2 3.6-4.2-2.2.1-3.6 1.8-3.6 4.2z"/><path d="M12 18c-2.2-.6-3.6-2.2-3.6-4.2 2.2.1 3.6 1.8 3.6 4.2zm0 0c2.2-.6 3.6-2.2 3.6-4.2-2.2.1-3.6 1.8-3.6 4.2z"/>'),
  mow: SVG('<path d="M3 20h18"/><path d="M5 20c.6-4.4 2.2-7.6 4.5-10"/><path d="M10 20c0-5 .8-9 3-12.5"/><path d="M15 20c0-4 .8-7 3-9.5"/><path d="M19.5 20c0-2.6.2-4.6 1-6.5"/>'),
  seed: SVG('<path d="M12 21v-8.5"/><path d="M12 12.5C12 8.6 9.3 6 5 6c0 4 2.8 6.5 7 6.5z"/><path d="M12 12.5c0-3.6 2.6-6.5 7-6.5 0 4-2.8 6.5-7 6.5z"/><path d="M7 21h10"/>'),
  fertilize: SVG('<path d="M6 8h12l-1.2 12H7.2z"/><path d="M9 8V5.5h6V8"/><path d="M10 12.5h.01M14 12.5h.01M12 15.5h.01M10 17.5h.01M14 17.5h.01"/>'),
  soil: SVG('<path d="M3 19h18"/><path d="M3 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M8 11 11 5h3l2 6"/>'),
  graze: SVG('<path d="M5 4v16M12 4v16M19 4v16M3 9h18M3 15h18"/>'),
  other: SVG('<path d="M5 12.5l4.5 4.5L19 7"/>')
};
const FAB_GLYPH = '<svg class="ui-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function createQuickEntryUI({store, state, modal, closeModal, toast, bindChipChoices = () => {}, openWorkForm = () => {}, todayIso, recentParcelIds = () => [], native = () => null, doc = globalThis.document, nav = globalThis.navigator} = {}) {
  let fix = null; // dernière position reçue, horodatée ici (celle d’app.js ne l’est pas)
  let busy = false;
  doc?.addEventListener?.('parcelles:gps', event => {
    const d = event.detail || {};
    if (Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude))) {fix = {latitude: Number(d.latitude), longitude: Number(d.longitude), accuracy: Number(d.accuracy), at: Date.now()}; onFix();}
  });
  let sheet = null; // état de la feuille ouverte

  function mount() {
    if (!doc?.body || doc.getElementById('quick-work-fab')) return;
    const button = doc.createElement('button');
    button.type = 'button'; button.id = 'quick-work-fab'; button.className = 'quick-work-fab';
    button.dataset.action = 'quick-work';
    button.setAttribute('aria-label', 'J’ai fait : saisie express d’un travail terminé');
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = `${FAB_GLYPH}<span aria-hidden="true">J’ai fait</span>`;
    const dock = doc.getElementById('assistant-dock');
    if (dock) dock.before(button); else doc.body.append(button);
  }

  const parcelsOf = data => (data.parcelles || []).filter(p => p && !p.deletedAt && !p.archived);
  const prefs = () => state()?.preferences || {};
  const canLocate = () => Boolean(prefs().gpsConsent && nav?.geolocation);

  function gpsNote(ranking) {
    if (ranking.reason === 'context') return 'Parcelle du mode terrain';
    if (ranking.reason === 'gps') return `Détectée par GPS (± ${Math.round(ranking.accuracy)} m)`;
    if (sheet?.locating) return 'Localisation en cours…';
    if (ranking.imprecise) return `Position imprécise (± ${Math.round(ranking.accuracy)} m, plus de ${GPS_MAX_ACCURACY_M} m) : choisissez la parcelle.`;
    if (sheet?.gpsError) return 'Position indisponible : choisissez la parcelle.';
    if (fix && !ranking.selectedId) return 'Vous n’êtes dans aucune parcelle connue : choisissez-la.';
    if (!prefs().gpsConsent) return 'Choisissez la parcelle. Autorisez le GPS depuis le mode terrain pour qu’elle soit détectée.';
    return 'Choisissez la parcelle.';
  }

  function parcelSummary(parcel, note) {
    if (!parcel) return `<strong class="quick-parcel-name is-empty">À choisir</strong><span>${escapeHtml(note)}</span>`;
    const area = Number(parcel.surfaceHa);
    const meta = [Number.isFinite(area) && area > 0 ? `${formatNumber(area)} ha` : '', parcel.culture || ''].filter(Boolean).join(' · ');
    return `<strong class="quick-parcel-name">${escapeHtml(parcel.nom || 'Parcelle')}</strong><span>${escapeHtml([meta, note].filter(Boolean).join(' · '))}</span>`;
  }

  function parcelSection() {
    const data = state();
    const ranking = rankParcels(data, {gps: fix, contextId: sheet.contextId, recentIds: recentParcelIds()});
    if (!sheet.userPicked) sheet.parcelId = ranking.selectedId || '';
    const all = parcelsOf(data);
    const chosen = all.find(p => p.id === sheet.parcelId) || null;
    const chips = ranking.chips.slice();
    if (chosen && !chips.some(c => c.parcel.id === chosen.id)) chips.unshift({parcel: chosen, distance: null});
    const hasList = all.length > chips.length;
    const showList = Boolean(sheet.listOpen || (chosen && !ranking.chips.some(c => c.parcel.id === chosen.id) && sheet.userPicked));
    const locate = canLocate() ? `<button type="button" class="text-button quick-locate" data-quick-locate>${sheet.locating ? 'Localisation…' : 'Me localiser'}</button>` : '';
    return `<input type="hidden" name="parcelId" value="${escapeHtml(sheet.parcelId)}">
      <fieldset class="quick-fieldset"><legend class="sr-only">Parcelle (obligatoire)</legend>
      <div class="quick-parcel-card"><div class="quick-card-head"><span class="quick-card-label" aria-hidden="true">Parcelle *</span><span class="quick-legend-actions">${locate}${hasList ? `<button type="button" class="text-button quick-list-toggle" data-quick-list aria-expanded="${showList}" aria-controls="quick-other">Toutes</button>` : ''}</span></div>
      <div class="quick-parcel-now" id="quick-parcel-now" aria-live="polite">${parcelSummary(chosen, gpsNote(ranking))}</div></div>
      <div class="chip-choices quick-parcels" data-chip-target="parcelId" role="group" aria-label="Parcelles proposées">${chips.map(({parcel, distance}) => {
        const on = parcel.id === sheet.parcelId, d = formatDistance(distance);
        return `<button type="button" class="choice-chip quick-parcel-chip${on ? ' is-on' : ''}" data-value="${escapeHtml(parcel.id)}" aria-pressed="${on}"><strong>${escapeHtml(parcel.nom || 'Parcelle')}</strong>${d ? `<small>${escapeHtml(d)}</small>` : ''}</button>`;
      }).join('')}</div>
      ${hasList ? `<label class="quick-other" id="quick-other"${showList ? '' : ' hidden'}>Autre parcelle<select id="quick-other-parcel"><option value="">Choisir dans la liste…</option>${all.slice().sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')).map(p => `<option value="${escapeHtml(p.id)}" ${p.id === sheet.parcelId && !chips.some(c => c.parcel.id === p.id) ? 'selected' : ''}>${escapeHtml(p.nom || 'Parcelle')}</option>`).join('')}</select></label>` : ''}
      </fieldset>`;
  }

  function typeSection() {
    const types = rankTypes(state());
    return `<fieldset class="quick-fieldset"><legend>Touchez le travail fait aujourd’hui *</legend>
      <div class="quick-types" role="group" aria-label="Types de travaux">${types.map(t => {
        const hint = isPhytoType(t.type) ? 'Produit à compléter' : t.count ? `Fait ${plural(t.count, 'fois', 'fois')}` : ({planned: 'Déjà prévu', template: 'Modèle'}[t.source] || 'Type courant');
        return `<button type="button" class="quick-type" data-quick-type="${escapeHtml(t.type)}" data-family="${t.family}">${GLYPHS[t.family] || GLYPHS.other}<strong>${escapeHtml(t.type)}</strong><small>${escapeHtml(hint)}</small></button>`;
      }).join('')}</div></fieldset>
      <p class="form-error hidden" id="quick-work-error" role="alert"></p>
      <button type="button" class="button secondary quick-detail" id="quick-work-detail">Saisie détaillée</button>`;
  }

  function bindParcelSection(form) {
    bindChipChoices(form);
    form.querySelector('.quick-parcels')?.addEventListener('click', event => {
      const chip = event.target.closest('.choice-chip'); if (!chip) return;
      sheet.parcelId = chip.dataset.value; sheet.userPicked = true;
      const select = form.querySelector('#quick-other-parcel'); if (select) select.value = '';
      refreshSummary(form);
    });
    const select = form.querySelector('#quick-other-parcel');
    if (select) select.onchange = () => {
      if (!select.value) return;
      sheet.parcelId = select.value; sheet.userPicked = true;
      form.elements.parcelId.value = select.value;
      form.querySelectorAll('.quick-parcels .choice-chip').forEach(c => {c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false');});
      form.querySelector('#quick-work-error')?.classList.add('hidden');
      refreshSummary(form);
    };
    form.querySelector('[data-quick-locate]')?.addEventListener('click', () => locate(true));
    form.querySelector('[data-quick-list]')?.addEventListener('click', event => {
      const panel = form.querySelector('#quick-other'); if (!panel) return;
      sheet.listOpen = panel.hidden; panel.hidden = !sheet.listOpen;
      event.currentTarget.setAttribute('aria-expanded', String(sheet.listOpen));
      if (sheet.listOpen) panel.querySelector('select')?.focus();
    });
  }

  function refreshSummary(form) {
    const parcel = parcelsOf(state()).find(p => p.id === sheet.parcelId) || null;
    const root = form.querySelector('#quick-parcel-now');
    if (root) root.innerHTML = parcelSummary(parcel, sheet.userPicked ? 'Choisie à la main' : gpsNote(rankParcels(state(), {gps: fix, contextId: sheet.contextId, recentIds: recentParcelIds()})));
  }

  function renderParcels() {
    const form = doc.getElementById('quick-work-form'); const root = form?.querySelector('#quick-parcel-zone');
    if (!root) return;
    root.innerHTML = parcelSection();
    bindParcelSection(form);
  }

  function onFix() {
    if (!sheet || !doc.getElementById('quick-work-form')) return;
    sheet.locating = false; sheet.gpsError = false;
    if (sheet.userPicked) return;
    renderParcels();
  }

  function locate(force = false) {
    if (!canLocate() || !sheet) return;
    if (!force && fix && Date.now() - fix.at < 60000) return;
    sheet.locating = true; sheet.gpsError = false; renderParcels();
    try {
      nav.geolocation.getCurrentPosition(position => {
        const {latitude, longitude, accuracy} = position.coords;
        const status = accuracy <= 10 ? 'GPS précis' : accuracy <= 30 ? 'GPS correct' : 'GPS faible';
        doc.dispatchEvent(new CustomEvent('parcelles:gps', {detail: {latitude, longitude, accuracy, status}}));
      }, () => {
        if (!sheet) return;
        sheet.locating = false; sheet.gpsError = true;
        if (doc.getElementById('quick-work-form')) renderParcels();
      }, {enableHighAccuracy: true, maximumAge: force ? 0 : 30000, timeout: 15000});
    } catch {sheet.locating = false; sheet.gpsError = true; renderParcels();}
  }

  function showError(form, message) {
    const error = form.querySelector('#quick-work-error');
    if (!error) return;
    error.textContent = message; error.classList.remove('hidden');
  }

  async function save(form, type) {
    if (busy) return;
    const data = state();
    const parcel = parcelsOf(data).find(p => p.id === (form.elements.parcelId?.value || sheet.parcelId));
    if (!parcel) {
      showError(form, 'Champ obligatoire : parcelle.');
      form.querySelector('.quick-parcels .choice-chip, #quick-other-parcel')?.focus();
      return;
    }
    busy = true;
    form.querySelectorAll('.quick-type').forEach(b => {b.disabled = true;});
    try {
      const work = buildQuickWork({type, parcel, data, today: todayIso()});
      const saved = await store.upsert('interventions', work, {label: `Travail enregistré : ${work.type}`});
      sheet = null;
      closeModal();
      haptic('success', {enabled: prefs().nativeHaptics !== false, native: native()});
      const phyto = isPhytoType(work.type);
      toast(`Enregistré : ${work.type} · ${parcel.nom || 'Parcelle'}${phyto ? '. Produit et dose à compléter.' : '.'}`, 'success', {label: 'Annuler', run: async () => {
        try {await store.remove('interventions', saved.id); toast('Saisie annulée.');}
        catch (error) {toast(error?.message || 'Annulation impossible.', 'error');}
      }});
      addDetailsButton(saved.id, phyto);
    } catch (error) {
      showError(form, error?.message || 'Enregistrement impossible.');
      form.querySelectorAll('.quick-type').forEach(b => {b.disabled = false;});
    } finally {busy = false;}
  }

  // Le toast de l’application porte une seule action : on y ajoute « Détails » avant « Annuler ».
  function addDetailsButton(id, phyto) {
    const item = doc.querySelector('#toast-root .toast:last-child');
    const undo = item?.querySelector('button');
    if (!item || !undo) return;
    const button = doc.createElement('button');
    button.type = 'button'; button.textContent = phyto ? 'Compléter' : 'Détails';
    button.onclick = () => {item.remove(); const work = store.get('interventions', id); if (work) openWorkForm(work);};
    undo.before(button);
  }

  function open({parcelId = null} = {}) {
    const data = state();
    if (!parcelsOf(data).length) {toast('Créez ou importez d’abord une parcelle.', 'error'); return;}
    sheet = {contextId: parcelId || null, parcelId: '', userPicked: false, locating: false, gpsError: false, listOpen: false};
    modal('J’ai fait…', '',
      `<form id="quick-work-form" class="quick-work-form" novalidate><div id="quick-parcel-zone">${parcelSection()}</div>${typeSection()}</form>`,
      '', 'small quick-sheet');
    const form = doc.getElementById('quick-work-form');
    bindParcelSection(form);
    form.querySelector('.quick-types').addEventListener('click', event => {
      const button = event.target.closest('.quick-type'); if (button) save(form, button.dataset.quickType);
    });
    doc.getElementById('quick-work-detail').onclick = () => {
      const id = form.elements.parcelId?.value || null;
      sheet = null; closeModal(); openWorkForm(null, id);
    };
    if (!sheet.contextId) locate(false);
  }

  return {mount, open};
}
