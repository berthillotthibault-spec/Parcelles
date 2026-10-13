// n° 18 : retour « enregistré » perceptible avec des gants et au soleil.
// Logique pure : quand vibrer, afficher la grande coche, biper (option), selon le contexte.

export const SAVED_OVERLAY_MS = 600;
// Messages de confirmation d'un enregistrement (toasts de succès).
const SAVE_WORDS = /(enregistr|ajout|cré[ée]|termin|déplac|mise? au pré|sortie|entrée|pointage|consign|sauvegard|mis à jour|mise à jour)/i;

export function isSaveMessage(message) {
  return SAVE_WORDS.test(String(message || ''));
}

// Contexte terrain : mode terrain ouvert ou réglage « Plein champ ».
export function feedbackPlan({type = 'success', message = '', fieldMode = false, pleinChamp = false, reducedMotion = false, haptics = true, beep = false} = {}) {
  const field = Boolean(fieldMode || pleinChamp);
  if (type === 'error') return {haptic: field && haptics ? 'error' : null, overlay: false, beep: field && beep ? 'error' : null};
  if (type !== 'success' || !isSaveMessage(message)) return {haptic: null, overlay: false, beep: null};
  return {
    haptic: haptics ? 'saved' : null,
    // La grande coche n'apparaît qu'en mode terrain ; mouvement réduit : affichée sans animation.
    overlay: Boolean(fieldMode),
    animate: !reducedMotion,
    beep: field && beep ? 'saved' : null
  };
}

// Bip court : aigu pour « enregistré », deux notes graves pour une erreur.
export function beepNotes(kind = 'saved') {
  return kind === 'error' ? [{freq: 330, ms: 120}, {freq: 247, ms: 160}] : [{freq: 880, ms: 90}];
}
