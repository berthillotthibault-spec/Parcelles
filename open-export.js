// n° 138 : export ouvert, lisible sans l'application (logique pure).
// Dossier lisible/ du ZIP complet : un CSV par collection principale (en français, « ; », JJ/MM/AAAA,
// noms de parcelles plutôt qu'identifiants), parcelles.geojson, un classeur .xlsx si possible et LISEZMOI.txt.
// Ces entrées sont ignorées à la restauration : seul state.json fait foi.
export const READABLE_DIR = 'lisible/';

const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const pad = n => String(n).padStart(2, '0');

// « 2026-10-08 » ou horodatage → « 08/10/2026 » ; vide sinon.
export function frDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {const [y, m, d] = value.slice(0, 10).split('-');return `${d}/${m}/${y}`;}
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isFinite(date.getTime()) ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : String(value);
}
// Nombre au format français (virgule décimale), pour un tableur réglé en français.
export function frNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6).replace('.', ',') : String(value);
}

const cell = value => {
  const text = String(value ?? '');
  return /[";\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
// CSV « ; » avec BOM UTF-8 (accents corrects à l'ouverture dans Excel).
export function toCsv(columns, rows) {
  const lines = [columns.map(([label]) => cell(label)).join(';'), ...rows.map(row => columns.map(([, get]) => cell(get(row))).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Tables lisibles : nom de fichier, nom d'onglet, colonnes [libellé, accès], lignes.
export function readableTables(state = {}) {
  const parcels = new Map((state.parcelles || []).map(p => [p.id, p]));
  const parcelName = id => (id ? parcels.get(id)?.nom || 'Parcelle supprimée' : '');
  const clients = new Map((state.clients || []).map(c => [c.id, c]));
  const clientName = id => (id ? clients.get(id)?.name || clients.get(id)?.nom || '' : '');
  const equipment = new Map((state.materiels || []).map(m => [m.id, m]));
  const equipmentName = id => (id ? equipment.get(id)?.nom || equipment.get(id)?.name || '' : '');
  const stock = new Map((state.stockItems || []).map(s => [s.id, s]));
  return [
    {file: 'parcelles.csv', sheet: 'Parcelles', rows: live(state.parcelles), columns: [
      ['Nom', p => p.nom], ['Surface (ha)', p => frNumber(p.surfaceHa)], ['Culture', p => p.culture], ['Commune', p => p.commune], ['Îlot', p => p.ilot],
      ['Statut foncier', p => ({own: 'Propriété', rented: 'Fermage', client: 'Client'}[p.ownershipType] || p.ownershipType || '')], ['Client', p => clientName(p.clientId)],
      ['Favorite', p => (p.favorite ? 'Oui' : '')], ['Contour', p => (p.geometry ? 'Oui' : 'Non')], ['Notes', p => p.notes], ['Identifiant externe', p => p.sourceId]]},
    {file: 'travaux.csv', sheet: 'Travaux', rows: live(state.interventions).sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))), columns: [
      ['Date', w => frDate(w.date)], ['Date prévue', w => frDate(w.plannedDate)], ['Statut', w => w.status], ['Campagne', w => w.campaignId], ['Type', w => w.type],
      ['Parcelle', w => parcelName(w.parcelId)], ['Culture', w => w.culture || parcels.get(w.parcelId)?.culture || ''], ['Produit', w => w.product], ['Dose', w => frNumber(w.dose)],
      ['Unité', w => w.doseUnit], ['Surface travaillée (ha)', w => frNumber(w.surfaceWorked)], ['Coût (€)', w => frNumber(w.cost)], ['Opérateur', w => w.operator],
      ['Matériel', w => equipmentName(w.equipmentId)], ['Note', w => w.note]]},
    {file: 'paturage.csv', sheet: 'Pâturage', rows: live(state.grazingSessions), columns: [
      ['Parcelle', g => parcelName(g.parcelId)], ['Animaux', g => g.animalType], ['Nombre', g => frNumber(g.animalsCount)], ['Entrée', g => frDate(g.startDate)],
      ['Sortie', g => frDate(g.endDate)], ['Note', g => g.note || g.notes]]},
    {file: 'stocks.csv', sheet: 'Stocks', rows: live(state.stockItems), columns: [
      ['Produit', s => s.name], ['Catégorie', s => s.category], ['Quantité', s => frNumber(s.quantity)], ['Unité', s => s.unit], ['Seuil d’alerte', s => frNumber(s.alertBelow)],
      ['Prix unitaire (€)', s => frNumber(s.unitPrice)]]},
    {file: 'mouvements-stock.csv', sheet: 'Mouvements de stock', rows: live(state.stockMovements), columns: [
      ['Date', m => frDate(m.date || m.createdAt)], ['Produit', m => stock.get(m.stockItemId)?.name || ''], ['Mouvement', m => m.type], ['Quantité', m => frNumber(m.quantity)],
      ['Solde après', m => frNumber(m.balanceAfter)], ['Parcelle', m => parcelName(m.parcelId)], ['Note', m => m.note]]},
    {file: 'entretiens.csv', sheet: 'Entretiens', rows: live(state.maintenanceRecords), columns: [
      ['Date', r => frDate(r.date)], ['Matériel', r => equipmentName(r.equipmentId)], ['Type', r => r.type], ['Compteur', r => frNumber(r.meter)],
      ['Coût (€)', r => frNumber(r.cost)], ['Prochaine échéance', r => frDate(r.nextDue)], ['Note', r => r.note || r.notes]]},
    {file: 'clients.csv', sheet: 'Clients', rows: live(state.clients), columns: [
      ['Nom', c => c.name || c.nom], ['Contact', c => c.contact], ['Téléphone', c => c.phone], ['E-mail', c => c.email], ['Adresse', c => c.address],
      ['Tarif hectare (€)', c => frNumber(c.hectareRate)], ['Tarif horaire (€)', c => frNumber(c.hourlyRate)], ['Tarif tonne (€)', c => frNumber(c.tonneRate)]]}
  ];
}

export function parcelsGeoJson(state = {}) {
  const features = live(state.parcelles).filter(p => p.geometry).map(p => ({type: 'Feature', geometry: p.geometry,
    properties: {nom: p.nom || '', surface_ha: p.surfaceHa ?? null, culture: p.culture || '', commune: p.commune || '', ilot: p.ilot || '', identifiant: p.id}}));
  return `${JSON.stringify({type: 'FeatureCollection', features}, null, 2)}\n`;
}

export function readmeText(state = {}, {createdAt = Date.now(), xlsx = false} = {}) {
  const farm = state.exploitation?.nom || 'Mon exploitation';
  return [
    `Parcelles - export lisible de « ${farm} »`,
    `Créé le ${frDate(createdAt)}.`,
    '',
    'Ce dossier se lit sans l’application Parcelles :',
    '- les fichiers .csv s’ouvrent dans Excel, LibreOffice ou Numbers (séparateur « ; », dates JJ/MM/AAAA, encodage UTF-8) ;',
    '- parcelles.geojson contient les contours, à ouvrir dans QGIS, geojson.io ou un logiciel de SIG ;',
    xlsx ? '- parcelles.xlsx regroupe toutes les tables, un onglet par table ;' : '- (classeur .xlsx non créé : module tableur indisponible à ce moment-là) ;',
    '- les fiches supprimées (corbeille) ne figurent pas dans ces tables.',
    '',
    'Pour restaurer vos données dans Parcelles, utilisez le fichier ZIP complet :',
    'Plus › Mes données › Restaurer une sauvegarde. Seuls manifest.json, state.json et attachments/ servent à la restauration ;',
    'ce dossier lisible/ est ignoré et peut être modifié sans risque.',
    ''
  ].join('\r\n');
}

// Entrées du dossier lisible/ pour createZip. xlsx : module SheetJS (window.XLSX) s'il est chargé.
export function readableEntries(state = {}, {createdAt = Date.now(), xlsx = null} = {}) {
  const tables = readableTables(state);
  const entries = tables.map(table => ({name: `${READABLE_DIR}${table.file}`, data: toCsv(table.columns, table.rows)}));
  entries.push({name: `${READABLE_DIR}parcelles.geojson`, data: parcelsGeoJson(state)});
  let workbook = false;
  if (xlsx?.utils && typeof xlsx.write === 'function') {
    try {
      const book = xlsx.utils.book_new();
      for (const table of tables) {
        const rows = [table.columns.map(([label]) => label), ...table.rows.map(row => table.columns.map(([, get]) => String(get(row) ?? '')))];
        xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), table.sheet.slice(0, 31));
      }
      entries.push({name: `${READABLE_DIR}parcelles.xlsx`, data: new Uint8Array(xlsx.write(book, {type: 'array', bookType: 'xlsx'}))});
      workbook = true;
    } catch (error) {console.warn('[Parcelles] classeur lisible non créé ; les CSV restent disponibles.', error);}
  }
  entries.push({name: `${READABLE_DIR}LISEZMOI.txt`, data: `﻿${readmeText(state, {createdAt, xlsx: workbook})}`});
  return entries;
}
