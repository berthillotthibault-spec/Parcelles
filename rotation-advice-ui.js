// n° 112 — Vue Rotation : alertes douces de délai de retour et classement des parcelles par marge/ha.
import {rotationAlerts, marginRanking, ROTATION_DELAYS, ROTATION_SOURCE, rotationDelay} from './rotation-advice.js';
import {escapeHtml as e, formatEuro} from './utils.js';
import {validateForm} from './form-chips-ui.js';

const FAMILY_LABELS = {colza: 'Colza', tournesol: 'Tournesol', pois: 'Pois', feverole: 'Féverole', lin: 'Lin', soja: 'Soja', betterave: 'Betterave', 'pomme de terre': 'Pomme de terre', lentille: 'Lentille'};

export function createRotationAdviceUI({store, state, modal, closeModal, toast, canWrite = () => true, doc = globalThis.document, reopen = () => {}} = {}) {
  function html(data = state()) {
    const alerts = rotationAlerts(data), m = marginRanking(data);
    const alertBlock = `<section class="rotation-advice"><h3>Délais de retour</h3>${alerts.length
      ? `<ul class="rotation-alerts">${alerts.map(a => `<li>${e(a.message)}</li>`).join('')}</ul>`
      : '<p class="rotation-ok">Aucune culture prévue ne revient avant son délai de retour conseillé.</p>'}
      <p class="rotation-source"><small>${e(ROTATION_SOURCE)}.</small>${canWrite() ? ' <button type="button" class="text-button" data-action="rotation-delays">Régler les délais</button>' : ''}</p></section>`;
    const rows = m.ranked.map(r => `<tr><td>${e(r.parcelName)}</td><td>${e(r.culture || '—')}</td><td class="num">${formatEuro(r.marginHa)}</td><td class="num ${r.gap < 0 ? 'is-neg' : ''}">${r.gap === null ? '—' : `${r.gap >= 0 ? '+' : '−'}${formatEuro(Math.abs(r.gap))}`}</td><td>${r.missing.length ? e(r.missing.join(', ')) : '—'}</td></tr>`).join('');
    const marginBlock = `<section class="margin-rank"><h3>Marge brute par hectare · ${e(m.campaign)}</h3>
      ${m.ranked.length ? `<p class="rotation-source"><small>Moyenne pondérée par la surface : ${formatEuro(m.average)}/ha · marge ${e(m.reliability.label)}.</small></p><div class="table-wrap"><table><thead><tr><th>Parcelle</th><th>Culture</th><th>Marge/ha</th><th>Écart</th><th>Données manquantes</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="rotation-ok">Aucune parcelle classable : renseignez le rendement et le prix (Économie de la parcelle).</p>'}
      ${m.unranked.length ? `<p class="rotation-source"><small>Non classées (${m.unranked.length}) : ${m.unranked.map(r => `${e(r.parcelName)} (${e(r.missing.join(', '))})`).join(' · ')}.</small></p>` : ''}</section>`;
    return alertBlock + marginBlock;
  }

  function openSettings() {
    const prefs = state().preferences;
    modal('Délais de retour conseillés', 'Nombre de campagnes minimum entre deux cultures de la même famille sur une parcelle.',
      `<form id="rotation-delays-form" class="form-grid">${Object.keys(ROTATION_DELAYS).map(k => `<label>${e(FAMILY_LABELS[k])} (ans)<input type="number" name="${e(k)}" min="1" max="10" step="1" required value="${rotationDelay(k, prefs)}"></label>`).join('')}<p class="span-2"><small>${e(ROTATION_SOURCE)}.</small></p></form>`,
      '<button class="button secondary" id="rotation-delays-reset">Valeurs par défaut</button><button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="rotation-delays-save">Enregistrer</button>');
    const form = doc.getElementById('rotation-delays-form');
    doc.getElementById('rotation-delays-save').onclick = async () => {
      if (!validateForm(form)) return;
      const out = {};
      for (const k of Object.keys(ROTATION_DELAYS)) {const v = Number(form.elements[k].value); if (v !== ROTATION_DELAYS[k]) out[k] = v;}
      await store.setPreferences({rotationDelays: out});
      toast('Délais de retour enregistrés.', 'success'); reopen();
    };
    doc.getElementById('rotation-delays-reset').onclick = async () => {await store.setPreferences({rotationDelays: {}}); toast('Délais par défaut rétablis.', 'success'); reopen();};
  }

  return {html, openSettings};
}
