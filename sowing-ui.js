// n° 109 — Aide aux dates de semis : carte sur la fiche parcelle, ligne d'accueil quand les
// conditions sont réunies, réglage des seuils de température du sol par culture.
import {sowingAdvices, SOWING_DEFAULTS, SOWING_SOURCE, sowingThreshold, isoDay} from './sowing.js';
import {escapeHtml as e} from './utils.js';
import {validateForm} from './form-chips-ui.js';

export function createSowingUI({store, state, modal, closeModal, toast, agro, canWrite = () => true, doc = globalThis.document, today = () => isoDay()} = {}) {
  const advices = (data = state()) => sowingAdvices(data, agro?.get(), {today: today()});

  function parcelHtml(parcel) {
    const list = advices().filter(a => a.parcelId === parcel.id);
    if (!list.length) return '';
    if (list.some(a => a.status === 'no-data')) queueMicrotask(() => agro?.ensure());
    const a = list[0], m = a.moisture;
    return `<section class="panel sowing-card${a.ready ? ' is-ready' : ''}" data-sowing-card data-parcel-id="${e(parcel.id)}"><div class="panel-heading"><h2>Semis en attente</h2><span class="pheno-flag">indicatif</span></div>
      <p class="sowing-sentence">${a.ready ? '<strong>Conditions réunies.</strong> ' : ''}${e(a.message)}</p>
      ${Number.isFinite(m) ? `<p class="pheno-note">Humidité du sol (3-9 cm) : ${String(Math.round(m * 100)).replace('.', ',')} % en volume${a.wet ? ', sol très humide' : ''}.</p>` : ''}
      <p class="pheno-source"><small>Moyenne journalière à 6 cm · Open-Meteo · ${e(SOWING_SOURCE)}. Vérifiez au champ avant de semer.</small></p>
      ${canWrite() ? `<div class="pheno-actions"><button type="button" class="button secondary" data-action="sowing-settings">Régler les seuils</button></div>` : ''}</section>`;
  }

  function refreshDom() {
    if (!doc) return;
    const data = state();
    doc.querySelectorAll('[data-sowing-card]').forEach(card => {
      const p = (data.parcelles || []).find(x => x.id === card.dataset.parcelId);
      if (p) card.outerHTML = parcelHtml(p) || '<span hidden data-sowing-card></span>';
    });
    renderHome();
  }

  function renderHome() {
    if (!doc) return;
    const card = doc.querySelector('[data-home-card="weather"]');
    if (!card) return;
    const ready = advices().filter(a => a.ready);
    let root = doc.getElementById('sowing-home');
    if (!ready.length) {root?.remove(); return;}
    if (!root) {root = doc.createElement('div'); root.id = 'sowing-home'; root.className = 'agro-risk-home'; card.append(root);}
    root.innerHTML = ready.slice(0, 2).map(a => `<button type="button" class="agro-risk-line is-ready" data-action="open-parcel" data-id="${e(a.parcelId)}"><span class="agro-risk-badge sowing-badge">Semis</span><span>Conditions de semis réunies sur ${e(a.parcelName)} (${e(a.label)}, sol à ${String(a.soilTemp).replace('.', ',')} °C)</span></button>`).join('');
  }

  function openSettings() {
    const prefs = state().preferences;
    modal('Seuils de température du sol', 'Température moyenne du sol à 6 cm à partir de laquelle le semis est possible, par culture.',
      `<form id="sowing-settings-form" class="form-grid">${Object.entries(SOWING_DEFAULTS).map(([k, d]) => `<label>${e(d.label[0].toUpperCase() + d.label.slice(1))} (°C)<input type="number" name="${k}" min="0" max="25" step="0.5" required value="${sowingThreshold(k, prefs).soilMin}"></label>`).join('')}<p class="span-2"><small>${e(SOWING_SOURCE)}.</small></p></form>`,
      '<button class="button secondary" id="sowing-settings-reset">Valeurs par défaut</button><button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="sowing-settings-save">Enregistrer</button>');
    const form = doc.getElementById('sowing-settings-form');
    doc.getElementById('sowing-settings-save').onclick = async () => {
      if (!validateForm(form)) return;
      const out = {};
      for (const k of Object.keys(SOWING_DEFAULTS)) {const v = Number(form.elements[k].value); if (v !== SOWING_DEFAULTS[k].soilMin) out[k] = v;}
      await store.setPreferences({sowingSoilThresholds: out});
      closeModal(); toast('Seuils de semis enregistrés.', 'success');
    };
    doc.getElementById('sowing-settings-reset').onclick = async () => {await store.setPreferences({sowingSoilThresholds: {}}); closeModal(); toast('Seuils par défaut rétablis.', 'success');};
  }

  return {parcelHtml, refreshDom, renderHome, openSettings, advices};
}
