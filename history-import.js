// n° 124 — « Je viens d'un autre logiciel » : reprise d'un historique de travaux exporté en CSV ou
// Excel par Mes Parcelles, Smag, Geofolia ou un autre tableur. Logique pure : préréglages, textes
// d'aide et nettoyage de la correspondance des colonnes. L'analyse et l'import restent dans
// import-export.js (inspectFiles / applyImport, session d'import annulable, dédoublonnage source/sourceId).
// Les chemins de menu des logiciels changent d'une version à l'autre : l'aide reste indicative.

export const HISTORY_ACCEPT = '.csv,.xlsx,.xls';
export const DAPLOS_NOTE = 'Le format d’échange Daplos (EDI) n’est pas lu pour l’instant : choisissez un export CSV ou Excel des interventions.';

const COMMON_STEPS = Object.freeze([
  'Commencez par vos parcelles : le ZIP de votre déclaration telepac, ou un export SHP/CSV des parcelles. Les travaux sont rattachés par le nom de parcelle.',
  'Exportez ensuite les interventions réalisées en CSV ou Excel, une ligne par intervention : parcelle, date, type d’intervention, puis si possible produit, dose, unité et surface travaillée.',
  'Plusieurs campagnes (3 à 5 ans) peuvent être importées en une fois ou fichier par fichier : une intervention déjà importée n’est pas recréée.'
]);

export const HISTORY_PRESETS = Object.freeze({
  mesparcelles: {label: 'Mes Parcelles', where: 'Dans Mes Parcelles, cherchez l’export Excel des interventions ou du registre des pratiques (éditions, enregistrements).'},
  smag: {label: 'Smag Farmer', where: 'Dans Smag Farmer, cherchez l’export Excel ou CSV des interventions de la campagne (liste des interventions, éditions).'},
  geofolia: {label: 'Geofolia', where: 'Dans Geofolia, cherchez l’export tableur des interventions ou du cahier de traçabilité.'},
  autre: {label: 'Autre logiciel ou tableur', where: 'Tout tableau avec une ligne par intervention convient, même tenu à la main.'}
});
export const presetKey = key => (Object.prototype.hasOwnProperty.call(HISTORY_PRESETS, key) ? key : 'autre');
export const presetSteps = key => [HISTORY_PRESETS[presetKey(key)].where, ...COMMON_STEPS];

/** Correspondance de départ d'un historique : aucune parcelle créée, écran des colonnes toujours affiché. */
export const historyMapping = key => ({historyOnly: '1', preset: presetKey(key)});

const KEYS = ['name', 'sourceId', 'surfaceHa', 'culture', 'commune', 'ilot', 'date', 'type', 'product', 'dose', 'doseUnit', 'workSurface', 'workId'];
/**
 * Valeurs du formulaire de correspondance → mapping pour inspectFiles : seules les colonnes associées
 * sont gardées ; un historique est marqué confirmé pour passer à l'aperçu.
 */
export function cleanMapping(values = {}, {history = false, preset = ''} = {}) {
  const out = {};
  for (const key of KEYS) {const v = String(values[key] ?? '').trim(); if (v) out[key] = v.slice(0, 200);}
  if (history) Object.assign(out, {historyOnly: '1', confirmed: '1', preset: presetKey(preset)});
  return out;
}
