// Transitions entre vues (n° 26) : enveloppe document.startViewTransition, avec repli.
// Le rendu des données reste synchrone dans app.js : seul l'échange des vues visibles
// passe dans le rappel de la transition.
import {shouldTransition, transitionDirection, SHARED_NAMES} from './view-transitions.js';

export function createViewTransitions({doc = globalThis.document, win = globalThis.window} = {}) {
  const root = doc?.documentElement;
  const reducedQuery = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let shared = null;
  let named = [];

  const setName = (el, name) => { if (el) { el.style.viewTransitionName = name; named.push(el); } };
  const clearNames = () => { for (const el of named) el.style.viewTransitionName = ''; named = []; };

  // Avant d'ouvrir une fiche depuis une ligne : l'avatar et le nom « voyagent » jusqu'à l'en-tête.
  function shareFromRow(row) {
    if (!row) return;
    shared = {direction: 'open', avatar: row.querySelector('.crop-dot, .recent-card > i'), name: row.querySelector('.row-main strong, strong')};
  }
  // Retour à la liste : l'en-tête revient vers la ligne de la parcelle.
  function shareBackTo(parcelId) {
    if (!parcelId) return;
    shared = {direction: 'close', parcelId};
  }

  // Renvoie true si une transition est lancée (update y est appelé), false sinon (à l'appelant de faire update + revealView).
  function run(from, to, update) {
    const supported = typeof doc?.startViewTransition === 'function';
    if (!shouldTransition({from, to, supported, reduced: Boolean(reducedQuery?.matches)})) { shared = null; return false; }
    const pair = shared; shared = null;
    clearNames();
    const hero = doc.querySelector('#view-parcel .detail-hero'), title = doc.querySelector('#parcel-detail-title');
    if (pair?.direction === 'open' && to === 'parcel') { setName(pair.avatar, SHARED_NAMES.avatar); setName(pair.name, SHARED_NAMES.name); }
    if (pair?.direction === 'close' && from === 'parcel') { setName(hero, SHARED_NAMES.avatar); setName(title, SHARED_NAMES.name); }
    root.dataset.vt = transitionDirection(from, to);
    let transition;
    try {
      transition = doc.startViewTransition(() => {
        clearNames();
        update();
        if (pair?.direction === 'open' && to === 'parcel') { setName(hero, SHARED_NAMES.avatar); setName(title, SHARED_NAMES.name); }
        if (pair?.direction === 'close' && to === 'parcels') {
          const row = doc.querySelector(`#parcel-list [data-id="${CSS.escape(pair.parcelId)}"]`);
          setName(row?.querySelector('.crop-dot'), SHARED_NAMES.avatar); setName(row?.querySelector('.row-main strong'), SHARED_NAMES.name);
        }
      });
    } catch {
      clearNames(); delete root.dataset.vt; update(); return true;
    }
    // Transition sautée (navigation rapide) : sans gravité. Erreur de rendu : jamais avalée.
    transition.ready?.catch?.(() => {});
    transition.updateCallbackDone?.catch?.(error => setTimeout(() => { throw error; }));
    transition.finished.catch(() => {}).finally(() => { clearNames(); delete root.dataset.vt; });
    return true;
  }

  return {run, shareFromRow, shareBackTo};
}
