// @ts-check
// Navigation principale (n° 160) : logique pure, sans DOM.
// Barre du bas : Accueil · Carte · + · Parcelles · Troupeau (ou Travaux sans élevage).
// Barre latérale : Accueil · Carte · Parcelles · Troupeau · Planning · Modules.

/** Vues que le routeur sait afficher. */
export const NAV_VIEWS = ['today', 'map', 'parcels', 'parcel', 'herd', 'work', 'more', 'more-category'];

/** Vues dont l'ancien accès passait par l'onglet « Plus » : elles s'ouvrent désormais par le menu profil. */
export const PROFILE_VIEWS = ['more', 'more-category'];

/**
 * Onglets de la barre du bas, dans l'ordre. Le « + » n'est pas un onglet : il n'est jamais actif.
 * @param {{livestock?: boolean}} [options]
 * @returns {{kind: 'tab'|'action', view?: string, action?: string, label: string}[]}
 */
export function primaryTabs({livestock = true} = {}) {
  return [
    {kind: 'tab', view: 'today', label: 'Accueil'},
    {kind: 'tab', view: 'map', label: 'Carte'},
    {kind: 'action', action: 'new-work', label: 'Saisir un travail'},
    {kind: 'tab', view: 'parcels', label: 'Parcelles'},
    livestock ? {kind: 'tab', view: 'herd', label: 'Troupeau'} : {kind: 'tab', view: 'work', label: 'Travaux'}
  ];
}

/**
 * Entrées de la barre latérale (ordinateur). Sans élevage, Troupeau disparaît.
 * @param {{livestock?: boolean}} [options]
 * @returns {string[]}
 */
export function sidebarViews({livestock = true} = {}) {
  return ['today', 'map', 'parcels', ...(livestock ? ['herd'] : []), 'work', 'more'];
}

/**
 * Onglet à marquer actif pour une vue affichée.
 * La fiche relève de Parcelles, les modules du menu profil, le Planning de l'Accueil
 * (sauf sans élevage : l'onglet Travaux est alors dans la barre et s'allume lui-même).
 * Sur ordinateur, Planning et Modules ont leur propre entrée.
 * @param {string} view
 * @param {{livestock?: boolean, desktop?: boolean}} [options]
 * @returns {string}
 */
export function activeNavView(view, {livestock = true, desktop = false} = {}) {
  if (view === 'parcel') return 'parcels';
  if (view === 'more-category') return 'more';
  if (desktop) return view;
  if (view === 'work') return livestock ? 'today' : 'work';
  if (view === 'more') return '';
  if (view === 'herd' && !livestock) return '';
  return view;
}

/**
 * Vue réellement affichée pour une vue demandée : une vue inconnue retombe sur l'accueil,
 * et Troupeau sans module élevage sur le Planning.
 * @param {string} view
 * @param {{livestock?: boolean}} [options]
 * @returns {string}
 */
export function resolveView(view, {livestock = true} = {}) {
  if (!NAV_VIEWS.includes(view)) return 'today';
  if (view === 'herd' && !livestock) return 'work';
  return view;
}

/** @param {string} view */
export function isProfileView(view) {
  return PROFILE_VIEWS.includes(view);
}

const LEGAL_FORMS = /^(gaec|earl|scea|sarl|sas|sasu|eurl|ei|sa|sci|cuma|eta|ste|société|societe|de|des|du|la|le|les|et|d|l)$/i;
/**
 * Initiales de la pastille de profil : deux lettres tirées du nom de l'exploitation,
 * sans la forme juridique (« GAEC Berthillot » → « BE », « Ferme des Prés » → « FP »).
 * @param {string} [name]
 * @returns {string}
 */
export function profileInitials(name = '') {
  const words = String(name).normalize('NFC').split(/[\s'’-]+/).filter(w => /\p{L}/u.test(w) && !LEGAL_FORMS.test(w));
  const list = words;
  if (!list.length) return 'P';
  const letters = list.length > 1 ? list[0][0] + list[1][0] : list[0].slice(0, 2);
  return letters.toLocaleUpperCase('fr');
}
