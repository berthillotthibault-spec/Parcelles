// Écran « Itinéraire de la campagne suivante » : brouillon tiré des habitudes (campaign-itinerary.js), lignes à cocher,
// date modifiable, besoins en intrants et IFT prévisionnel. Rien n'est écrit avant « Créer les travaux cochés ».
import {escapeHtml as e, formatNumber} from './utils.js';
import {draftCampaignItinerary, itineraryEntities} from './campaign-itinerary.js';

export function createItineraryUI({store, state, modal, closeModal, toast, catalog = () => null, canWrite = () => true, doc = globalThis.document}) {
  let draft = null, busy = false;

  function open() {
    draft = draftCampaignItinerary(state(), {catalog: catalog()});
    const write = canWrite(), works = draft.works;
    const rows = works.map((w, i) => `<tr data-row="${i}"><td data-label="Créer"><input type="checkbox" class="it-ok" ${write ? 'checked' : 'disabled'} aria-label="Créer ${e(w.type)} sur ${e(w.parcelName)}"></td>
      <td><strong>${e(w.type)}</strong><small>${e(w.parcelName)} · ${e(w.culture)}${w.product ? ` · ${e(w.product)}${w.dose !== null ? ` ${e(formatNumber(w.dose))} ${e(w.doseUnit)}` : ''}` : ''}</small><small>${e(w.reason)}</small></td>
      <td data-label="Date"><input type="date" class="it-date" value="${e(w.plannedDate)}" aria-label="Date prévue"></td></tr>`).join('');
    const needs = draft.needs.length ? `<h3>Besoins en intrants</h3><ul class="stack-list">${draft.needs.map(n => `<li>${e(n.product)} : <strong>${e(formatNumber(n.quantity))} ${e(n.unit)}</strong> (${n.parcels} parcelle${n.parcels > 1 ? 's' : ''})</li>`).join('')}</ul>` : '';
    const ift = draft.ift.total !== null ? `<p class="form-note">IFT prévisionnel de l’exploitation : <strong>${e(formatNumber(draft.ift.total))}</strong>${draft.ift.missing ? ` (${draft.ift.missing} traitement${draft.ift.missing > 1 ? 's' : ''} sans dose de référence)` : ''}.</p>` : '';
    const skipped = draft.skipped.length ? `<details class="form-note"><summary>${draft.skipped.length} parcelle${draft.skipped.length > 1 ? 's' : ''} sans proposition</summary><ul>${draft.skipped.map(s => `<li>${e(s.name)} : ${e(s.reason)}</li>`).join('')}</ul></details>` : '';
    const body = works.length
      ? `<form id="itinerary-form" novalidate><div class="table-wrap"><table class="sc-table"><thead><tr><th>Créer</th><th>Travail</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>${ift}${needs}${skipped}<p class="form-error" hidden></p></form>`
      : `<div class="empty-state"><p>Aucune proposition pour ${e(draft.campaign)}.</p><p class="muted">Il faut au moins deux campagnes de travaux terminés pour une culture, et la culture ${e(draft.campaign)} de chaque parcelle (Planifier la campagne).</p></div>${skipped}`;
    modal(`Itinéraire ${draft.campaign}`, 'Travaux proposés d’après vos habitudes des campagnes passées. Rien n’est créé avant votre validation.', body,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${works.length && write ? '<button class="button primary" type="submit" form="itinerary-form">Créer les travaux cochés</button>' : ''}`, 'large');
    doc.getElementById('itinerary-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, error = form.querySelector('.form-error');
      const chosen = [...form.querySelectorAll('tr[data-row]')].filter(tr => tr.querySelector('.it-ok')?.checked).map(tr => {
        const w = draft.works[Number(tr.dataset.row)], date = tr.querySelector('.it-date')?.value || w.plannedDate;
        return {...w, plannedDate: date, date};
      });
      if (!chosen.length) { error.textContent = 'Cochez au moins un travail.'; error.hidden = false; return; }
      // Double appui : un seul envoi (les travaux n'ont pas encore d'identifiant, un second envoi les dupliquerait).
      if (busy) return;
      busy = true;
      const submit = doc.querySelector?.('button[form="itinerary-form"]');
      if (submit) submit.disabled = true;
      try {
        await store.upsertMany('interventions', itineraryEntities(chosen), {label: `Itinéraire ${draft.campaign} : ${chosen.length} travaux prévus`});
      } catch (err) {
        error.textContent = `Création impossible : ${err?.message || 'erreur inconnue'}.`; error.hidden = false;
        if (submit) submit.disabled = false;
        return;
      } finally { busy = false; }
      closeModal();
      toast(`${chosen.length} travail${chosen.length > 1 ? 'x' : ''} prévu${chosen.length > 1 ? 's' : ''} pour ${draft.campaign}.`, 'success');
    });
  }

  return {open};
}
