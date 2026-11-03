// @ts-check
// Applis dans l'appli (n° 161) : logique pure, sans DOM.
// Parcelles se présente comme plusieurs applis (Champs, Troupeau, Facturation…) qui partagent les mêmes
// données. Chaque appli a sa couleur, sa barre du bas et ses outils ; le lanceur (logo de l'en-tête) les
// liste. Champs garde la navigation n° 160 telle quelle. Un bouton qui relève d'une autre appli y bascule
// (« bascule automatique ») et une pastille ramène là où l'on était.

/** @typedef {{label: string, icon: string, view?: string, action?: string, tab?: string, shared?: boolean}} AppTab  shared : action commune à plusieurs applis (jamais propriétaire) */
/** @typedef {{id: string, title: string, icon: string, color: string, desc: string, home: string, tabs: AppTab[], plus?: AppTab|null, tools: string[], owns?: string[], autoSwitch?: boolean}} AppDef  owns : actions hors catalogue qui ouvrent l'appli */

/** Applis, dans l'ordre du lanceur. `tools` : data-action des outils (MORE_CATEGORIES), dans l'ordre d'affichage. */
/** @type {AppDef[]} */
export const APPS = [
  {id: 'champs', title: 'Champs', icon: 'parcels', color: '#3f6b2a', desc: 'Accueil, carte, parcelles et travaux', home: 'today',
    tabs: [], tools: ['open-rotations', 'open-seeds', 'open-soil-analyses', 'open-hedges', 'open-observations', 'open-chantiers',
      'open-calendar', 'open-day-route', 'open-weather', 'open-field-mode', 'open-team-work', 'open-messages', 'open-farm',
      'open-assistant', 'open-automations']},
  {id: 'troupeau', title: 'Troupeau', icon: 'herd', color: '#8a5a2b', desc: 'Lots, pâturage, santé et fourrage', home: 'herd',
    tabs: [{label: 'Troupeau', icon: 'herd', view: 'herd'}, {label: 'Pâturage', icon: 'fence', action: 'open-grazing'},
      {label: 'Santé', icon: 'alert', action: 'open-herd-health'}, {label: 'Outils', icon: 'more', view: 'space'}],
    // « + » : la feuille Ajouter de la n° 160 (Pâturage, Vêlage, Pesée…), commune avec Champs.
    plus: {label: 'Ajouter', icon: 'plus', action: 'new-work', shared: true}, owns: ['new-grazing', 'open-herd-view'],
    tools: ['open-herd', 'open-grazing', 'open-herd-health', 'open-forage', 'open-herd-economics']},
  {id: 'facturation', title: 'Facturation', icon: 'files', color: '#2f5d8a', desc: 'Devis, factures, clients et relances', home: 'space',
    tabs: [{label: 'Accueil', icon: 'home', view: 'space'}, {label: 'Suivi', icon: 'wallet', action: 'open-invoices', tab: 'suivi'},
      {label: 'À faire', icon: 'check', action: 'open-invoices', tab: 'afaire'}, {label: 'Clients', icon: 'users', action: 'open-invoices', tab: 'clients'}],
    plus: {label: 'Nouvelle facture', icon: 'plus', action: 'new-invoice'},
    tools: ['open-invoices', 'open-clients']},
  {id: 'materiel', title: 'Matériel', icon: 'tractor', color: '#b0582a', desc: 'Engins, carburant, coûts et missions', home: 'space',
    tabs: [{label: 'Accueil', icon: 'home', view: 'space'}, {label: 'Engins', icon: 'tractor', action: 'open-equipment'},
      {label: 'Carburant', icon: 'package', action: 'open-fuel'}, {label: 'Coûts', icon: 'wallet', action: 'open-machine-costs'}],
    plus: {label: 'Nouvel engin', icon: 'plus', action: 'new-equipment'},
    tools: ['open-equipment', 'open-fuel', 'open-machine-costs', 'new-machine-mission', 'open-integrations']},
  {id: 'gestion', title: 'Gestion', icon: 'wallet', color: '#6b4a8a', desc: 'Trésorerie, marges, stocks et comptabilité', home: 'space',
    tabs: [{label: 'Accueil', icon: 'home', view: 'space'}, {label: 'Trésorerie', icon: 'wallet', action: 'open-treasury'},
      {label: 'Marges', icon: 'production', action: 'open-crop-margins'}, {label: 'Stocks', icon: 'package', action: 'open-stock'}],
    plus: null,
    tools: ['open-statistics', 'open-treasury', 'open-crop-margins', 'open-net-margin', 'open-campaign-history', 'open-stock',
      'open-accounting-export', 'open-land', 'open-claims', 'open-documents', 'open-reports']},
  {id: 'reglementaire', title: 'Réglementaire', icon: 'shield', color: '#8a2f3f', desc: 'PAC, phyto, azote, registres et contrôles', home: 'space',
    tabs: [{label: 'Accueil', icon: 'home', view: 'space'}, {label: 'Phyto', icon: 'files', action: 'open-phyto-register'},
      {label: 'Azote', icon: 'production', action: 'open-nitrogen'}, {label: 'PAC', icon: 'parcels', action: 'open-pac'}],
    plus: null,
    tools: ['open-pac', 'open-telepac-import', 'open-parcel-check', 'open-phyto-register', 'open-phyto-catalog', 'open-nitrogen',
      'open-covers', 'open-traceability', 'open-compliance', 'open-green-indicators', 'open-regulated-ops']},
  {id: 'tp', title: 'Travaux publics', icon: 'tools', color: '#a07a12', desc: 'Chantiers, engins, heures et quantités', home: 'space',
    tabs: [{label: 'Accueil', icon: 'home', view: 'space'}, {label: 'Chantiers', icon: 'work', action: 'open-public-works'}],
    plus: null,
    tools: ['open-public-works']},
  {id: 'reglages', title: 'Réglages', icon: 'settings', color: '#55585c', desc: 'Compte, équipe, données et aide', home: 'space',
    tabs: [{label: 'Accueil', icon: 'home', view: 'space'}, {label: 'Paramètres', icon: 'settings', action: 'open-settings'},
      {label: 'Données', icon: 'database', action: 'open-data-center'}, {label: 'Aide', icon: 'help', action: 'open-help'}],
    plus: null, autoSwitch: false,
    tools: ['open-team-roles', 'open-account', 'open-data-center', 'open-log', 'open-settings', 'open-privacy', 'open-app-lock',
      'open-help', 'open-advanced-tools']}
];

export const DEFAULT_APP = 'champs';
export const APP_IDS = APPS.map(app => app.id);
/** Clé du stockage local de l'appareil (pas de synchro : chaque appareil rouvre sa dernière appli). */
export const LAST_APP_KEY = 'parcelles:last-app';

/** @param {string} id */
export function appById(id) {
  return APPS.find(app => app.id === id) || APPS[0];
}

/** @param {unknown} id */
export function normalizeAppId(id) {
  return typeof id === 'string' && APP_IDS.includes(id) ? id : DEFAULT_APP;
}

/** Actions dont l'appli est propriétaire : outils, onglets, « + » propre et `owns`. @param {AppDef} app */
function ownedActions(app) {
  return new Set([...app.tools, ...app.tabs.map(t => t.action), app.plus && !app.plus.shared ? app.plus.action : '', ...(app.owns || [])].filter(Boolean));
}

/** Actions qui ne font pas quitter l'appli : les siennes, plus son « + » commun. @param {AppDef} app */
function appActions(app) {
  return new Set([...ownedActions(app), app.plus?.action].filter(Boolean));
}

/**
 * Applis affichées dans le lanceur. `isVisible(action)` applique les filtres de rôle et d'activité ;
 * une appli dont aucun outil n'est visible disparaît. Champs et Réglages sont toujours là ;
 * Troupeau suit le module élevage.
 * @param {{isVisible?: (action: string) => boolean, livestock?: boolean}} [options]
 */
export function visibleApps({isVisible = () => true, livestock = true} = {}) {
  return APPS.filter(app => {
    if (app.id === 'champs' || app.id === 'reglages') return true;
    if (app.id === 'troupeau' && !livestock) return false;
    return app.tools.some(isVisible);
  });
}

/**
 * Appli propriétaire d'une action (la première qui la liste), ou '' si l'action est commune.
 * @param {string} action
 */
export function appForAction(action) {
  if (!action) return '';
  return APPS.find(app => app.id !== 'champs' && ownedActions(app).has(action))?.id || '';
}

/**
 * Appli d'une vue de l'application : Troupeau pour la vue troupeau, Champs pour l'accueil, la carte,
 * les parcelles et le planning ; '' pour les vues neutres (page d'une appli, anciennes listes de modules).
 * @param {string} view
 */
export function appForView(view) {
  if (view === 'herd') return 'troupeau';
  if (['today', 'map', 'parcels', 'parcel', 'work'].includes(view)) return 'champs';
  return '';
}

/**
 * Bascule automatique : appli à ouvrir quand on déclenche `target` (action ou vue) depuis `current`.
 * Rien ne bascule si l'action appartient déjà à l'appli courante, si elle est commune, si l'appli
 * cible est cachée, ou si elle refuse la bascule (Réglages : outils ponctuels ouverts de partout).
 * @param {{action?: string, view?: string}} target
 * @param {string} current
 * @param {{visibleIds?: string[]}} [options]
 * @returns {string} identifiant de l'appli cible, ou '' si l'on reste
 */
export function switchTarget({action = '', view = ''}, current, {visibleIds = APP_IDS} = {}) {
  const here = appById(normalizeAppId(current));
  if (action && appActions(here).has(action)) return '';
  if (view && here.tabs.some(t => t.view === view)) return '';
  const id = view ? appForView(view) : appForAction(action);
  if (!id || id === here.id || !visibleIds.includes(id)) return '';
  if (appById(id).autoSwitch === false) return '';
  return id;
}

/**
 * Pastille de retour : texte et cible. `from` est l'appli quittée par une bascule automatique.
 * @param {string} from
 */
export function returnChip(from) {
  const app = appById(normalizeAppId(from));
  return {app: app.id, label: `Retour à ${app.title}`};
}

/**
 * Outils de la page d'une appli, à partir du catalogue [libellé, sous-titre, action, icône] et d'un filtre.
 * L'ordre suit `tools` ; un outil absent du catalogue ou masqué est omis.
 * @param {string} id
 * @param {[string, string, string, string][]} catalog
 * @param {(action: string) => boolean} [isVisible]
 */
export function appTools(id, catalog, isVisible = () => true) {
  const byAction = new Map();
  for (const item of catalog) if (!byAction.has(item[2])) byAction.set(item[2], item);
  return appById(id).tools.filter(isVisible).map(action => byAction.get(action)).filter(Boolean);
}

/**
 * Route d'une appli (#app/<id>) et lecture inverse.
 * @param {string} id
 */
export function appRoute(id) {
  return `#app/${normalizeAppId(id)}`;
}

/** @param {string} route sans « # » @returns {string} '' si la route n'est pas celle d'une appli */
export function parseAppRoute(route) {
  const match = /^app\/([a-z]+)$/.exec(String(route || ''));
  return match && APP_IDS.includes(match[1]) ? match[1] : '';
}

/**
 * Écran d'ouverture : la dernière appli utilisée (si elle est encore visible), sur sa vue d'accueil.
 * @param {unknown} lastApp
 * @param {string[]} [visibleIds]
 * @returns {{app: string, view: string}}
 */
export function startScreen(lastApp, visibleIds = APP_IDS) {
  const id = normalizeAppId(lastApp);
  const app = visibleIds.includes(id) ? appById(id) : appById(DEFAULT_APP);
  return {app: app.id, view: app.home};
}

/**
 * Alertes d'une appli (n° 161, étape 3) : tri des lignes de computeNotifications (notifications.js) selon
 * l'appli qu'elles concernent. Champs a déjà son accueil ; la facturation a son propre résumé (hubTodo).
 * @type {Record<string, (row: {id: string, entity?: string}) => boolean>}
 */
export const ALERT_RULES = {
  troupeau: row => row.entity === 'grazingSessions' || row.id.startsWith('grazing'),
  materiel: row => row.entity === 'materiels',
  gestion: row => row.entity === 'stockItems',
  reglementaire: row => row.id.startsWith('deadline-'),
  reglages: row => row.id === 'sync-queue' || row.id === 'backup-old'
};

/**
 * @param {string} id
 * @param {{id: string, entity?: string, level?: string}[]} rows déjà triées par gravité
 */
export function appAlerts(id, rows = []) {
  const rule = ALERT_RULES[id];
  return rule ? rows.filter(row => row && typeof row.id === 'string' && rule(row)) : [];
}

/**
 * Résumé de la facturation à partir de hubTodo (billing-hub.js) : quatre compteurs, chacun ouvrant
 * l'onglet « À faire » de la facturation. Les compteurs à zéro sont omis.
 * @param {{reminders?: any[], quotes?: any[], unbilled?: any[], recurring?: any[], lateTotal?: number}} todo
 * @returns {{key: string, count: number, label: string, tone: string, amount?: number}[]}
 */
export function billingSummary(todo = {}) {
  const n = list => (Array.isArray(list) ? list.length : 0);
  const rows = [
    {key: 'reminders', count: n(todo.reminders), label: n(todo.reminders) > 1 ? 'clients à relancer' : 'client à relancer', tone: 'bad', amount: Number(todo.lateTotal) || 0},
    {key: 'unbilled', count: n(todo.unbilled), label: n(todo.unbilled) > 1 ? 'prestations à facturer' : 'prestation à facturer', tone: 'warn'},
    {key: 'quotes', count: n(todo.quotes), label: n(todo.quotes) > 1 ? 'devis à suivre' : 'devis à suivre', tone: 'warn'},
    {key: 'recurring', count: n(todo.recurring), label: n(todo.recurring) > 1 ? 'factures récurrentes dues' : 'facture récurrente due', tone: 'warn'}
  ];
  return rows.filter(row => row.count > 0);
}
