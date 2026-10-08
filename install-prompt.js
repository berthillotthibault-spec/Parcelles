// n° 117 : quand proposer l'installation sur l'écran d'accueil (logique pure, sans DOM).
// État mémorisé dans preferences.installPrompt (champ facultatif, propre à l'appareil) :
// {visits, lastVisitDay, shownCount, nextAt}. Une fois installée, l'app s'ouvre en mode autonome
// (detectInstallState → « standalone ») : rien à mémoriser, et une sauvegarde restaurée ailleurs reste juste.

export const INSTALL_RETRY_MS = 14 * 864e5;
// Première présentation + 2 relances au maximum.
export const INSTALL_MAX_SHOWS = 3;

function record(value) {return value && typeof value === 'object' && !Array.isArray(value) ? value : {};}

export function installPromptState(preferences = {}) {
  const p = record(preferences.installPrompt);
  return {
    visits: Math.max(0, Math.floor(Number(p.visits) || 0)),
    lastVisitDay: typeof p.lastVisitDay === 'string' ? p.lastVisitDay : '',
    shownCount: Math.max(0, Math.floor(Number(p.shownCount) || 0)),
    nextAt: Math.max(0, Number(p.nextAt) || 0)
  };
}

// Une visite = un jour d'ouverture différent. On cesse de compter après la 2e : au plus deux écritures.
export function visitPatch(preferences, day) {
  const p = installPromptState(preferences);
  if (p.visits >= 2 || p.lastVisitDay === day) return null;
  return {...p, visits: p.visits + 1, lastVisitDay: day};
}

export function installPromptDue({installState, preferences = {}, hasWork = false, now = Date.now()} = {}) {
  if (!['installable', 'ios-safari'].includes(installState)) return false;
  const p = installPromptState(preferences);
  if (p.shownCount >= INSTALL_MAX_SHOWS || p.nextAt > now) return false;
  return p.visits >= 2 || Boolean(hasWork);
}

// Mémorisé dès l'affichage : fermer la feuille, « Plus tard » ou « J'ai compris » repoussent de 14 jours.
export function shownPatch(preferences, now = Date.now()) {
  const p = installPromptState(preferences);
  return {...p, shownCount: p.shownCount + 1, nextAt: now + INSTALL_RETRY_MS};
}
