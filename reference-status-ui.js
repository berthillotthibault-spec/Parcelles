// @ts-check
// Liste « Données de référence » (chantier A0) : état de chaque source du registre auto-update.js.
// Rendu pur (HTML échappé) ; le bouton data-action="ref-refresh" relance la vérification d'une source.
import {escapeHtml} from './utils.js';

const pad = n => String(n).padStart(2, '0');

/** JJ/MM/AAAA en heure locale. */
export function frenchDay(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Phrase d'état d'une source (sans HTML). */
export function referenceStatusLine(item, now = Date.now()) {
  const parts = [];
  if (item.origin === 'embarque' || !item.okAt) {
    const version = item.version ?? item.embeddedVersion;
    parts.push(`valeur embarquée${version != null && version !== '' ? ` (${version})` : ''}`);
  } else {
    parts.push(`à jour le ${frenchDay(item.okAt)}`);
    if (item.stale || (item.ttlMs && now - item.okAt > item.ttlMs)) parts.push('à revérifier');
  }
  if (item.pending) parts.push('vérification en cours');
  if (item.error) parts.push('vérification en échec');
  return parts.join(' · ');
}

/** HTML de la section « Données de référence » ; chaîne vide si aucune source. */
export function referenceStatusHtml(statusList, now = Date.now()) {
  const list = Array.isArray(statusList) ? statusList : [];
  if (!list.length) return '';
  const rows = list.map(item => {
    const error = item.error ? ` title="${escapeHtml(item.error)}"` : '';
    return `<div class="list-row ref-status-row${item.error ? ' warn' : ''}"${error}><div><strong>${escapeHtml(item.label || item.id)}</strong>`
      + `<small>${escapeHtml(referenceStatusLine(item, now))}</small></div>`
      + `<button class="button secondary small" type="button" data-action="ref-refresh" data-id="${escapeHtml(item.id)}"`
      + `${item.pending ? ' disabled' : ''} aria-label="Vérifier ${escapeHtml(item.label || item.id)}">Vérifier</button></div>`;
  }).join('');
  return `<section class="reference-status" aria-label="Données de référence"><h3>Données de référence</h3>`
    + `<div class="stack-list">${rows}</div></section>`;
}
