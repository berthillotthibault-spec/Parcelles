// Contexte partagé d'app.js (n° 147) : ce dont les modules d'actions et les écrans extraits ont besoin
// (store, état, fenêtres, navigation, carte…). app.js le remplit une fois au début d'init() ; les valeurs
// qui changent au fil de la session (store, carte, onglet courant, filtres…) y sont des accesseurs, lus
// au moment de l'appel, jamais copiés. Aucun import : ce module ne grossit pas le graphe de démarrage.
export const ctx = {};

// Copie les propriétés en gardant les accesseurs (get / set) tels quels.
export function initContext(values) {
  Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(values));
  return ctx;
}
