// n° 21 - Mode gants : interface à une main et zone pouce (logique pure, sans DOM).
// La préférence glovesMode vaut 'off' (défaut), 'on' (toujours) ou 'field' (seulement en mode terrain).
// gloves-ui.js applique la classe body.gloves, la barre du pouce et le maintien de confirmation.
// Les modes, leur normalisation et le jeton de confirmation vivent dans personalization.js (chargé au
// démarrage) : ce module-ci n’est chargé qu’avec gloves-ui.js, quand le mode gants sert.
import {GLOVES_MODES, GLOVES_MODE_LABELS, normalizeGlovesMode, recordHoldConfirmation, consumeHoldConfirmation} from './personalization.js';
export {GLOVES_MODES, GLOVES_MODE_LABELS, normalizeGlovesMode, recordHoldConfirmation, consumeHoldConfirmation};

// Durée du maintien qui remplace la fenêtre de confirmation d'une action destructrice.
export const HOLD_CONFIRM_MS = 600;
// Un doigt ganté bouge un peu : au-delà, le geste est un défilement et le maintien est abandonné.
export const HOLD_MOVE_TOLERANCE = 14;
// Boutons destructeurs concernés : suppressions des fiches (placées dans la corbeille, avec Annuler).
export const DESTRUCTIVE_SELECTOR = 'button[id^="delete-"],button[data-action="delete-parcel"],button[data-action="delete-map-point"]';

export function glovesActive(mode, {fieldModeOpen = false} = {}) {
  const m = normalizeGlovesMode(mode);
  return m === 'on' || (m === 'field' && Boolean(fieldModeOpen));
}

// Actions primaires regroupées dans la barre basse, par écran (trois au plus, la plus utile à droite,
// sous le pouce d'un droitier). Le rôle lecture seule n'en a aucune : il ne crée rien.
// Quand la saisie express « J’ai fait » (n° 8) est disponible, elle prend la place du milieu et son
// bouton flottant est masqué (il serait recouvert par la barre).
const QUICK_WORK = ['quick-work', 'J’ai fait', 'work'];
const THUMB_ACTIONS = Object.freeze({
  today: [['open-field-mode', 'Terrain', 'locate'], ['new-observation', 'Observation', 'alert'], ['new-work', 'Travail', 'plus']],
  map: [['new-observation', 'Observation', 'alert'], ['open-field-mode', 'Terrain', 'locate']],
  parcels: [['new-observation', 'Observation', 'alert'], ['new-parcel', 'Parcelle', 'plus']],
  work: [['new-task', 'Tâche', 'calendar'], ['new-work', 'Travail', 'plus']]
});
const QUICK_WORK_VIEWS = ['today', 'parcels', 'work'];

export function thumbActions(view, {readOnly = false, modalOpen = false, fieldModeOpen = false, quickWork = false} = {}) {
  if (readOnly || modalOpen || fieldModeOpen) return [];
  let list = THUMB_ACTIONS[view] || [];
  if (quickWork && QUICK_WORK_VIEWS.includes(view)) list = list.length > 2 ? [list[0], QUICK_WORK, list.at(-1)] : [list[0], QUICK_WORK, ...list.slice(1)];
  return list.map(([action, label, icon]) => ({action, label, icon}));
}

// Suivi d'un maintien : start → move (false si le doigt a glissé) → done(t) une fois la durée atteinte.
export function createHoldTracker({duration = HOLD_CONFIRM_MS, tolerance = HOLD_MOVE_TOLERANCE} = {}) {
  let origin = null;
  return {
    get active() { return origin !== null; },
    start(x, y, t) { origin = {x, y, t}; },
    move(x, y) {
      if (!origin) return false;
      if (Math.hypot(x - origin.x, y - origin.y) > tolerance) { origin = null; return false; }
      return true;
    },
    progress(t) { return origin ? Math.max(0, Math.min(1, (t - origin.t) / duration)) : 0; },
    done(t) { return Boolean(origin) && t - origin.t >= duration; },
    cancel() { origin = null; }
  };
}

