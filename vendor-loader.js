// n° 144 : bibliothèques lourdes chargées à la demande (SheetJS, shpjs), une seule fois.
// Les fichiers restent précachés par le service worker (CORE) : le chargement marche hors connexion.
// Sans la bibliothèque (échec réseau, absence de DOM), la promesse renvoie null et l'appelant garde son repli
// interne (spreadsheetRowsInternal, shapefile-fallback.js, zip-lite.js).
export const VENDORS = {
  xlsx: {src: './xlsx.full.min.js', global: 'XLSX'},
  shp: {src: './shp.min.js', global: 'shp'}
};
const pending = new Map();

export function loadVendor(name, {doc = globalThis.document, root = globalThis, timeoutMs = 20000} = {}) {
  const vendor = VENDORS[name];
  if (!vendor) return Promise.reject(new Error(`Bibliothèque inconnue : ${name}`));
  if (root[vendor.global]) return Promise.resolve(root[vendor.global]);
  if (pending.has(name)) return pending.get(name);
  if (!doc?.createElement) return Promise.resolve(null);
  const promise = new Promise(resolve => {
    const script = doc.createElement('script');
    let done = false;
    const finish = value => {if (done) return;done = true;clearTimeout(timer);if (!value) pending.delete(name);resolve(value);};
    const timer = setTimeout(() => {console.warn(`[Parcelles] ${vendor.src} trop long à charger : repli interne.`);finish(null);}, timeoutMs);
    script.src = vendor.src;
    script.async = true;
    script.dataset.vendor = name;
    script.onload = () => finish(root[vendor.global] || null);
    script.onerror = () => {console.warn(`[Parcelles] ${vendor.src} indisponible : repli interne.`);script.remove?.();finish(null);};
    (doc.head || doc.documentElement).append(script);
  });
  pending.set(name, promise);
  return promise;
}
