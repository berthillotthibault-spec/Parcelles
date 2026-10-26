// Feuilles de style des écrans différés (v13 : facturation). Elles ne sont pas liées par index.html (le
// premier rendu ne les attend plus) : le module de l'écran les lie à sa première ouverture, une seule fois,
// par un <link> inséré à la place qu'elles occupaient (avant design-v3.css, dans l'ordre de LAZY_SHEETS).
// Chaque feuille déclare sa couche (@layer features{…}) et l'ordre des couches est fixé par tokens.css :
// arrivée après coup, elle garde sa couche et son rang dans la cascade. Le module de l'écran attend la
// feuille (au plus LOAD_TIMEOUT ms) avant d'afficher quoi que ce soit : jamais d'écran sans style.
// ?v= : monté par tools/release.mjs quand la feuille change, comme ceux d'index.html (test-release.mjs).
// Les feuilles restent dans CORE (sw.js) et REQUIRED_ASSETS (runtime.js) pour le hors connexion.
export const LAZY_SHEETS = Object.freeze({
  'billing-docs.css': '1',
  'billing-hub.css': '1'
});
export const LOAD_TIMEOUT = 2500;
// Feuille chargée au démarrage avant laquelle les feuilles différées s'insèrent (la dernière d'index.html).
const ANCHOR = 'design-v3.css';
// Promesse de chargement par document et par feuille : une seule insertion.
const loading = new WeakMap();

export const sheetHref = file => `./${file}?v=${LAZY_SHEETS[file]}`;

// Lie la feuille si besoin ; la promesse se résout à true une fois la feuille appliquée, à false en cas
// d'erreur ou après timeout ms (l'écran s'affiche alors quand même). Sans document (tests Node) : false.
export function loadSheet(file, {doc = globalThis.document, timeout = LOAD_TIMEOUT} = {}) {
  if (!doc?.head || !Object.hasOwn(LAZY_SHEETS, file)) return Promise.resolve(false);
  if (!loading.has(doc)) loading.set(doc, new Map());
  const pending = loading.get(doc);
  if (pending.has(file)) return pending.get(file);
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = sheetHref(file);
  link.dataset.lazySheet = file;
  const order = Object.keys(LAZY_SHEETS);
  const before = order.slice(order.indexOf(file) + 1).map(f => doc.querySelector(`link[data-lazy-sheet="${f}"]`)).find(Boolean)
    || [...doc.querySelectorAll('link[rel="stylesheet"]')].find(l => (l.getAttribute('href') || '').replace(/^\.\//, '').split('?')[0] === ANCHOR);
  const promise = new Promise(resolve => {
    // Délai dépassé : l'écran s'affiche, la feuille s'appliquera à son arrivée.
    const timer = setTimeout(() => resolve(Boolean(link.sheet)), timeout);
    link.addEventListener('load', () => { clearTimeout(timer); resolve(true); }, {once: true});
    // Échec : lien retiré ; l'écran rappelle loadSheet à chaque ouverture, la suivante réessaie.
    link.addEventListener('error', () => { clearTimeout(timer); link.remove(); pending.delete(file); resolve(false); }, {once: true});
  });
  pending.set(file, promise);
  if (before) before.parentNode.insertBefore(link, before); else doc.head.append(link);
  return promise;
}
