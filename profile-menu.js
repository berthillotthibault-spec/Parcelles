// @ts-check
// Menu profil (n° 160) : logique pure, sans DOM. Il remplace l'onglet « Plus » : les outils de
// MORE_CATEGORIES (app.js) y sont rangés en quatre groupes, filtrés par rôle et par activité comme avant,
// avec une recherche. Chaque ligne déclenche la même action qu'aujourd'hui.

/** @typedef {[string, string, string, string]} CatalogItem  libellé, sous-titre, data-action, icône */
/** @typedef {{id: string, title: string, desc: string, action?: string, view?: string, icon: string}} MenuItem */
/** @typedef {{id: string, title: string, items: MenuItem[]}} MenuGroup */

/** Entrées sans équivalent dans MORE_CATEGORIES : une vue, ou un réglage rangé dans Personnaliser. */
/** @type {Record<string, MenuItem>} */
export const EXTRA_ITEMS = {
  planning: {id: 'planning', title: 'Planning', desc: 'À faire, semaine, calendrier et chantiers', view: 'work', icon: 'calendar'},
  gloves: {id: 'gloves', title: 'Mode gants', desc: 'Boutons encore plus grands · dans Personnaliser', action: 'personalize', icon: 'settings'},
  personalize: {id: 'personalize', title: 'Personnaliser', desc: 'Accueil, raccourcis et activités', action: 'personalize', icon: 'settings'}
};

/** Libellés revus pour le menu (l'action reste la même). */
/** @type {Record<string, [string, string]>} */
export const RENAMES = {
  'open-farm': ['Agriculture de précision', 'Campagnes, modulation, missions et connexions'],
  'open-assistant': ['Assistant IA', 'Analyse locale, actions et voix']
};

/** Groupes du menu, dans l'ordre : actions de MORE_CATEGORIES ou clés d'EXTRA_ITEMS. */
export const PROFILE_GROUPS = [
  {id: 'farm', title: 'Exploitation', ids: ['open-equipment', 'open-stock', 'open-rotations', 'open-seeds', 'open-soil-analyses', 'open-hedges',
    'open-grazing', 'open-herd', 'open-herd-health', 'open-forage', 'open-observations', 'planning', 'open-calendar', 'open-day-route',
    'open-team-work', 'open-weather', 'open-field-mode', 'open-chantiers', 'open-public-works']},
  {id: 'management', title: 'Gestion', ids: ['open-clients', 'open-invoices', 'open-statistics', 'open-treasury', 'open-crop-margins',
    'open-net-margin', 'open-campaign-history', 'open-herd-economics', 'open-machine-costs', 'open-fuel', 'open-land', 'open-claims',
    'open-documents', 'open-accounting-export', 'open-reports', 'open-messages', 'open-green-indicators']},
  {id: 'rules', title: 'Réglementaire', ids: ['open-traceability', 'open-phyto-register', 'open-phyto-catalog', 'open-nitrogen', 'open-covers',
    'open-pac', 'open-parcel-check', 'open-compliance']},
  {id: 'settings', title: 'Réglages', ids: ['open-assistant', 'open-automations', 'open-integrations', 'open-farm', 'new-machine-mission',
    'open-telepac-import', 'open-regulated-ops', 'open-team-roles', 'open-account', 'open-data-center', 'open-log', 'gloves', 'personalize',
    'open-settings', 'open-privacy', 'open-app-lock', 'open-advanced-tools', 'open-help']}
];

const ASSIGNED = new Set(PROFILE_GROUPS.flatMap(g => g.ids));

/** Texte comparable : minuscules, sans accents ni ponctuation. @param {string} text */
export function normalizeQuery(text = '') {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Actions du catalogue qui n'ont pas de groupe (elles iraient dans « Autres outils »). @param {string[]} actions */
export function unassignedActions(actions) {
  return actions.filter(action => !ASSIGNED.has(action));
}

/**
 * Groupes affichés. `visible` reçoit les entrées du catalogue et rend celles que le rôle et les activités
 * laissent voir (mêmes filtres que « Plus »). Une requête aplatit la recherche sur libellé, sous-titre et groupe.
 * @param {CatalogItem[]} catalog
 * @param {{visible?: (items: CatalogItem[]) => CatalogItem[], query?: string}} [options]
 * @returns {MenuGroup[]}
 */
export function buildProfileMenu(catalog, {visible = items => items, query = ''} = {}) {
  const shown = new Map();
  for (const entry of visible(catalog)) {
    const [title, desc, action, icon] = entry;
    if (shown.has(action)) continue;
    const [label, sub] = RENAMES[action] || [title, desc];
    shown.set(action, {id: action, title: label, desc: sub, action, icon});
  }
  /** @type {MenuGroup[]} */
  const groups = PROFILE_GROUPS.map(group => ({id: group.id, title: group.title,
    items: group.ids.map(id => EXTRA_ITEMS[id] || shown.get(id)).filter(Boolean)}));
  const others = [...shown.values()].filter(item => !ASSIGNED.has(item.id));
  if (others.length) groups.push({id: 'others', title: 'Autres outils', items: others});
  const q = normalizeQuery(query);
  const result = q ? groups.map(group => ({...group, items: group.items.filter(item =>
    q.split(' ').every(word => normalizeQuery(`${item.title} ${item.desc} ${group.title}`).includes(word)))})) : groups;
  return result.filter(group => group.items.length);
}

/**
 * Sous-ligne de l'en-tête : « 60,5 ha · 8 parcelles · 55 animaux » (animaux omis s'il n'y en a pas).
 * @param {{area?: number, parcels?: number, animals?: number}} counts
 */
export function farmSummary({area = 0, parcels = 0, animals = 0} = {}) {
  const ha = `${(Math.round(area * 10) / 10).toLocaleString('fr-FR', {maximumFractionDigits: 1})} ha`;
  const parts = [ha, `${parcels} parcelle${parcels > 1 ? 's' : ''}`];
  if (animals > 0) parts.push(`${animals} anima${animals > 1 ? 'ux' : 'l'}`);
  return parts.join(' · ');
}
