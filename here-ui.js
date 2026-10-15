// « Vous êtes dans » contextuel (n° 111) : pastille de l'assistant et du micro, parcelle de la position
// appliquée à une saisie vocale sans parcelle nommée, actions de la feuille de carte de la parcelle courante.
// Module différé (lazy-modules.js : here), chargé à la première position GPS. Logique dans here-context.js.
import {accuracyText, applyHereToEntry, dueWorksHere, hereBadge, pickHereParcel} from './here-context.js';
import {escapeHtml as e, localDate} from './utils.js';

export function createHereUI({state, todayIso, onChange = () => {}, initial = null, now = () => Date.now()} = {}) {
  let position = null, lastKey = '';
  const current = () => position ? pickHereParcel(position, state()?.parcelles || [], {now: now()}) : null;

  // Nouvelle position (événement parcelles:gps) : prévient seulement si la parcelle ou la pastille change.
  function gps(detail, {silent = false} = {}) {
    if (!detail || !Number.isFinite(Number(detail.latitude)) || !Number.isFinite(Number(detail.longitude))) return;
    position = {latitude: Number(detail.latitude), longitude: Number(detail.longitude), accuracy: detail.accuracy, at: now()};
    // Clé : parcelle, précision suffisante, proximité d'une limite et précision arrondie à 5 m (« ± N m » à jour).
    const here = current(), key = here ? `${here.parcel.id}:${here.precise}:${here.nearEdge}:${here.accuracy === null ? '' : Math.round(here.accuracy / 5)}` : '';
    if (key !== lastKey) { lastKey = key; if (!silent) try { onChange(here); } catch {} }
  }

  // role="status" pour l'assistant et le micro ; pas dans la feuille de carte, reconstruite à chaque rendu.
  function pill({live = true} = {}) {
    const badge = hereBadge(current());
    return badge ? `<p class="here-pill"${live ? ' role="status"' : ''}><span>${e(badge.label)}</span><small>${e(badge.detail)}</small></p>` : '';
  }

  // Feuille de carte : travaux dus ici (terminer en un geste) et saisie rapide préremplie.
  function sheetHtml(parcel) {
    const here = current();
    if (!parcel || !here || here.parcel.id !== parcel.id) return '';
    const due = dueWorksHere(state()?.interventions || [], parcel.id, todayIso());
    const head = here.precise ? pill({live: false}) : `<p class="here-pill is-approx"><span>Vous semblez être dans cette parcelle</span><small>${e(accuracyText(here))}</small></p>`;
    const rows = due.map(w => `<li><span>${e(w.type || 'Travail')}<small>${w.overdue ? 'En retard · ' : ''}${w.dueDate ? `prévu le ${e(localDate(w.dueDate))}` : 'sans date'}</small></span><button type="button" class="small-button" data-action="finish-work" data-id="${e(w.id)}">Terminé</button></li>`).join('');
    return `<div class="map-here">${head}${rows ? `<ul class="map-here-due" aria-label="Travaux dus ici">${rows}</ul>` : '<p class="map-here-none">Aucun travail dû sur cette parcelle.</p>'}<button type="button" class="button secondary" data-action="quick-work" data-parcel-id="${e(parcel.id)}">Saisie rapide ici</button></div>`;
  }

  gps(initial, {silent: true}); // position déjà connue au chargement du module

  return {gps, current, pill, sheetHtml, apply: entry => applyHereToEntry(entry, current(), {today: todayIso()})};
}
