// Étiquettes QR des engins, portails et abreuvoirs (idée n° 11) : liens et planche A4 en PDF.
// Fonctions pures (aucun accès au DOM) : l’URL ne contient que l’identifiant interne, jamais de donnée.
import {encodeQR, qrRuns} from './qr.js';
import {PdfDoc, A4, mm, wrapText} from './pdf-lite.js';

// Base de l’application (dossier de index.html), ex. https://…/Parcelles/
export function appBaseUrl(href) {
  const url = new URL(href);
  url.hash = ''; url.search = '';
  url.pathname = url.pathname.replace(/[^/]*$/, '');
  return url.href;
}
export function qrLink(base, kind, id, {log = true} = {}) {
  const safe = encodeURIComponent(String(id || ''));
  return kind === 'point' ? `${base}#point/${safe}` : `${base}#equipment/${safe}${log ? '/log' : ''}`;
}
// « equipment/<id> », « equipment/<id>/log », « point/<id> » → {kind, id, log} ou null.
export function parseQrRoute(route) {
  const m = String(route || '').replace(/^#/, '').match(/^(equipment|point)\/([^/]+)(?:\/(log))?\/?$/);
  if (!m || (m[1] === 'point' && m[3])) return null;
  let id = '';
  try { id = decodeURIComponent(m[2]); } catch { return null; }
  return id ? {kind: m[1], id, log: m[3] === 'log'} : null;
}

const SUBTITLE = {equipment: 'Matériel · scanner pour noter', point: 'Scanner pour ouvrir le point'};

// Planche A4 : 3 × 4 étiquettes par page, traits de découpe pointillés.
// items = [{kind, id, name, subtitle?}] ; renvoie les octets du PDF.
export function labelSheetPdf(items, {base, farm = '', accent = '#1f5a3d', cols = 3, rows = 4} = {}) {
  if (!items?.length) throw new Error('Aucune étiquette à imprimer.');
  const doc = new PdfDoc({title: 'Étiquettes QR', subject: farm ? `Étiquettes QR · ${farm}` : 'Étiquettes QR'});
  const margin = mm(10), w = (A4[0] - margin * 2) / cols, h = (A4[1] - margin * 2) / rows, qrSize = Math.min(w, h) * 0.62;
  let page = null;
  items.forEach((item, i) => {
    const slot = i % (cols * rows);
    if (!slot) page = doc.addPage();
    const x = margin + (slot % cols) * w, y = margin + Math.floor(slot / cols) * h;
    page.rect(x + 4, y + 4, w - 8, h - 8, {stroke: '#b8beb9', lineWidth: 0.5, radius: 8});
    const q = encodeQR(qrLink(base, item.kind, item.id)), cell = qrSize / q.size, qx = x + (w - qrSize) / 2, qy = y + 16;
    for (const [rx, ry, rw] of qrRuns(q.modules)) page.rect(qx + rx * cell, qy + ry * cell, rw * cell + 0.05, cell + 0.05, {fill: '#000000'});
    let ty = qy + qrSize + 18;
    for (const line of wrapText(item.name || 'Sans nom', 'helvB', 12, w - 24).slice(0, 2)) { page.text(line, x + w / 2, ty, {font: 'helvB', size: 12, color: accent, align: 'center'}); ty += 14; }
    page.text(item.subtitle || SUBTITLE[item.kind] || '', x + w / 2, ty + 1, {size: 8.5, color: '#454d48', align: 'center'});
    if (farm) page.text(farm.length > 40 ? farm.slice(0, 39) + '…' : farm, x + w / 2, y + h - 14, {size: 7.5, color: '#5f6862', align: 'center'});
  });
  return doc.output();
}
