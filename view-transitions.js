// Transitions entre vues (n° 26) : logique pure.
// Glissement latéral selon l'ordre des onglets ; la carte (Leaflet) n'est jamais animée ;
// rien si reduced-motion ou si l'API View Transitions est absente (repli sur revealView).

export const TAB_ORDER = ['today', 'map', 'parcels', 'work', 'more'];
// Rang d'une vue : les vues de détail se placent juste après leur onglet.
export function viewRank(view) {
  if (view === 'parcel') return TAB_ORDER.indexOf('parcels') + 0.5;
  if (view === 'more-category') return TAB_ORDER.indexOf('more') + 0.5;
  const i = TAB_ORDER.indexOf(view);
  return i < 0 ? 0 : i;
}

export function transitionDirection(from, to) {
  if (!from || !to || from === to) return 'none';
  return viewRank(to) > viewRank(from) ? 'forward' : 'back';
}

export function shouldTransition({from, to, supported = false, reduced = false, ready = true} = {}) {
  if (!supported || reduced || !ready || !from || !to || from === to) return false;
  return from !== 'map' && to !== 'map';
}

// Nom partagé entre la ligne de la liste et l'en-tête de la fiche.
export const SHARED_NAMES = {avatar: 'parcel-avatar', name: 'parcel-name'};
