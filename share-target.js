// n° 121 — Recevoir des fichiers depuis les autres applications, fonctions pures.
// Android/Chrome : « Partager vers Parcelles » (share_target, POST multipart reçu par sw.js et mis en
// IndexedDB) et « Ouvrir avec Parcelles » (file_handlers, launchQueue). Ailleurs, les boutons
// d'import existants restent le chemin normal.
// Les mêmes listes sont recopiées dans sw.js (script classique) : test-share-target.mjs vérifie
// qu'elles restent identiques.

export const INBOX_DB = 'parcelles-inbox';
export const INBOX_STORE = 'files';
export const SHARE_EXTENSIONS = ['zip', 'shp', 'kml', 'kmz', 'gpx', 'xml', 'pdf', 'jpg', 'jpeg'];
export const SHARE_MAX_BYTES = 25 * 1024 * 1024;
export const SHARE_MAX_FILES = 10;

export const SHARE_KINDS = {
  contour: {label: 'Contour de parcelle', hint: 'Shapefile, KML ou KMZ : aperçu avant import des parcelles.'},
  trace: {label: 'Trace GPS', hint: 'GPX, KML ou ISOXML : import des traces et points.'},
  ordonnance: {label: 'Ordonnance', hint: 'Rangée dans Documents (réglementaire).'},
  facture: {label: 'Facture', hint: 'Rangée dans Documents ; une photo peut être lue vers le stock.'},
  analyse: {label: 'Analyse de sol', hint: 'Rangée dans Documents (analyse de sol).'},
  document: {label: 'Autre document', hint: 'Rangé dans Documents.'}
};

export const extensionOf = name => {const m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : '';};

export function validateIncoming(files = [], {maxBytes = SHARE_MAX_BYTES, maxFiles = SHARE_MAX_FILES} = {}) {
  const accepted = [], rejected = [];
  for (const f of files) {
    const ext = extensionOf(f?.name);
    if (!SHARE_EXTENSIONS.includes(ext)) rejected.push({name: f?.name || 'fichier', reason: 'type non pris en charge'});
    else if (!(f.size > 0)) rejected.push({name: f.name, reason: 'fichier vide'});
    else if (f.size > maxBytes) rejected.push({name: f.name, reason: `plus de ${Math.round(maxBytes / 1048576)} Mo`});
    else if (accepted.length >= maxFiles) rejected.push({name: f.name, reason: `au-delà de ${maxFiles} fichiers`});
    else accepted.push(f);
  }
  return {accepted, rejected};
}

// Types proposés pour un lot de fichiers, le plus probable en premier.
export function guessKinds(files = []) {
  const exts = new Set(files.map(f => extensionOf(f.name)));
  const names = files.map(f => String(f.name || '').toLowerCase()).join(' ');
  const geo = ['zip', 'shp', 'kmz'].some(x => exts.has(x));
  const docs = ['pdf', 'jpg', 'jpeg'].some(x => exts.has(x));
  if (exts.has('gpx')) return ['trace', 'contour'];
  if (geo) return ['contour', 'trace'];
  if (exts.has('kml')) return ['contour', 'trace'];
  if (exts.has('xml') && !docs) return ['trace', 'contour', 'document'];
  const order = ['facture', 'ordonnance', 'analyse', 'document'];
  const first = /ordonnance|prescri/.test(names) ? 'ordonnance' : /facture|invoice|\bbl\b|livraison/.test(names) ? 'facture' : /analyse|labo|sol\b/.test(names) ? 'analyse' : null;
  return first ? [first, ...order.filter(k => k !== first)] : order;
}

// Les fichiers géographiques ne vont qu'aux importeurs, les documents qu'aux Documents.
export function kindAccepts(kind, file) {
  const ext = extensionOf(file?.name);
  if (kind === 'contour') return ['zip', 'shp', 'kml', 'kmz', 'xml'].includes(ext);
  if (kind === 'trace') return ['gpx', 'kml', 'xml'].includes(ext);
  return ['pdf', 'jpg', 'jpeg', 'xml', 'zip'].includes(ext);
}
export const DOCUMENT_CATEGORY = {ordonnance: 'Réglementaire', facture: 'Facture', analyse: 'Analyse de sol', document: 'Autre'};
