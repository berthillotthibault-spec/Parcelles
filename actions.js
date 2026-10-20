// Registre des actions du délégué de clics (n° 147). Un module d'actions par domaine (work-actions.js,
// parcel-actions.js) y inscrit ses gestionnaires ; le délégué d'app.js consulte ce registre avant ses
// branches if(action==='…') restantes. Un gestionnaire reçoit {action, id, control, event} et peut être
// asynchrone : il est appelé tout de suite (dans le geste de la personne) et attendu dans le try du
// délégué, si bien qu'une erreur (lecture seule, rôle refusé par le garde-fou du Store) y est traduite
// comme avant. Les actions qui dépendent d'un module différé restent retenues par gateClicks
// (lazy-modules.js, phase de capture) avant d'arriver ici.
const registry = new Map();

export function registerAction(name, handler) {
  if (typeof handler !== 'function') throw new TypeError(`Gestionnaire absent pour l’action ${name}`);
  if (registry.has(name)) throw new Error(`Action déjà enregistrée : ${name}`);
  registry.set(name, handler);
}

export function registerActions(handlers) {
  for (const [name, handler] of Object.entries(handlers)) registerAction(name, handler);
}

export const hasAction = name => registry.has(name);
export const registeredActions = () => [...registry.keys()];

// Appelle le gestionnaire et renvoie son résultat (promesse éventuelle) ; false si l'action est inconnue.
export function runAction(action, control, event) {
  const handler = registry.get(action);
  if (!handler) return false;
  return handler({action, id: control?.dataset?.id, control, event});
}
