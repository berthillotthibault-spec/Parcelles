// n° 116 : modules affichés selon les activités de l'exploitation (logique pure, sans DOM).
// preferences.activeModules vaut 'all' (tout afficher, défaut) ou une liste d'identifiants connus.

export const ACTIVITY_MODULES = [
  {id: 'crops', label: 'Grandes cultures', detail: 'Assolement, phyto, azote, PAC, couverts et IFT'},
  {id: 'livestock', label: 'Élevage au pré', detail: 'Pâturage, lots et animaux au pré'},
  {id: 'contracting', label: 'Prestations / travaux publics', detail: 'Clients, factures, chantiers et TP'},
  {id: 'precision', label: 'Agriculture de précision', detail: 'Missions machine, modulation et connexions'},
  {id: 'team', label: 'Travail en équipe', detail: 'Consignes, heures et autorisations'}
];
export const MODULE_IDS = ACTIVITY_MODULES.map(item => item.id);

// Table outil (data-action) → modules qui le rendent visible. Un outil absent de la table est
// commun à toutes les exploitations (travaux, carte, documents, données…) et reste toujours affiché.
export const TOOL_MODULES = Object.freeze({
  'open-rotations': ['crops'],
  'open-phyto-register': ['crops'],
  'open-phyto-catalog': ['crops'],
  'ift-open': ['crops'],
  'open-covers': ['crops'],
  'open-nitrogen': ['crops', 'livestock'],
  'open-pac': ['crops', 'livestock'],
  'open-grazing': ['livestock'],
  'open-herd-health': ['livestock'],
  'new-grazing': ['livestock'],
  'open-clients': ['contracting'],
  'open-invoices': ['contracting'],
  'open-public-works': ['contracting'],
  'open-chantiers': ['contracting'],
  'open-farm': ['precision'],
  'new-machine-mission': ['precision'],
  'open-integrations': ['precision'],
  'open-team-work': ['team'],
  'open-team-roles': ['team']
});

export function normalizeActiveModules(value) {
  if (!Array.isArray(value)) return 'all';
  const list = MODULE_IDS.filter(id => value.includes(id));
  return list.length === MODULE_IDS.length ? 'all' : list;
}

export function isModuleActive(moduleId, activeModules) {
  const active = normalizeActiveModules(activeModules);
  return active === 'all' || active.includes(moduleId);
}

export function isToolVisible(action, activeModules) {
  const modules = TOOL_MODULES[action];
  if (!modules) return true;
  const active = normalizeActiveModules(activeModules);
  return active === 'all' || modules.some(id => active.includes(id));
}

// Filtre une liste d'outils ; getAction extrait la data-action (par défaut : 3e case d'un tableau
// [titre, description, action, icône] comme dans MORE_CATEGORIES).
export function filterTools(items, activeModules, getAction = item => item[2]) {
  return (items || []).filter(item => isToolVisible(getAction(item), activeModules));
}

// Nombre d'outils masqués dans un ensemble d'actions (pour le lien « Afficher tous les outils »).
export function hiddenToolCount(actions, activeModules) {
  return [...new Set(actions)].filter(action => !isToolVisible(action, activeModules)).length;
}
