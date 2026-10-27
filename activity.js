// Journal d'activité unifié (n° 139) : journal local et audit cloud fusionnés en une frise, avec filtres.
// Logique pure (testée avec node:test) ; l'affichage est dans activity-ui.js.

export const ENTITY_LABELS = {
  parcelles: 'Parcelle', interventions: 'Travail', tasks: 'Tâche', grazingSessions: 'Pâturage', materiels: 'Matériel',
  stockItems: 'Stock', stockMovements: 'Mouvement de stock', observations: 'Observation', photos: 'Photo', documents: 'Document',
  harvests: 'Récolte', vetTreatments: 'Soin', animals: 'Animal', animalEvents: 'Événement d’élevage', parcelComments: 'Commentaire', clients: 'Client', invoices: 'Facture', sales: 'Vente', rotations: 'Rotation'
};
const ACTION_LABELS = {create: 'Création', update: 'Modification', delete: 'Mise à la corbeille', purge: 'Suppression définitive', remote: 'Reçu du cloud', restore: 'Restauration'};
export const entityLabel = type => ENTITY_LABELS[type] || (type ? String(type) : 'Autre');
export const actionLabel = action => ACTION_LABELS[action] || 'Événement';

// Entrée du journal local → ligne de frise.
export function fromJournal(entry, {deviceName = 'Cet appareil'} = {}) {
  const d = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  return {
    id: `local:${entry.id}`, source: 'local', at: Number(entry.createdAt) || 0,
    who: String(entry.by || ''), device: deviceName,
    entityType: d.entityType || '', entityId: d.entityId || '', action: d.action || (entry.type === 'purge' ? 'purge' : ''),
    kind: String(entry.type || ''), message: String(entry.message || '')
  };
}

// Document d'audit Firestore → ligne de frise (security, sync, invitations… et données si présentes).
export function fromAudit(row, {devices = []} = {}) {
  const device = devices.find(d => d.id === row.deviceId);
  const message = row.details?.message ? `${row.action} : ${row.details.message}` : String(row.action || 'audit');
  return {
    id: `cloud:${row.id || `${row.createdAt}-${row.action}`}`, source: 'cloud', at: Number(row.createdAt) || 0,
    who: String(row.email || row.userId || ''), device: String(device?.name || row.deviceId || ''),
    entityType: row.entity && row.entity !== 'security' && row.entity !== 'sync' ? String(row.entity) : '',
    entityId: String(row.entityId || ''), action: String(row.action || ''), kind: String(row.entity || 'audit'), message
  };
}

// Parcelle concernée par une ligne (directement, ou par le travail, la tâche, le pâturage… rattaché).
export function parcelOf(row, lookup = () => null) {
  if (row.entityType === 'parcelles') return row.entityId;
  if (!row.entityType || !row.entityId) return '';
  const entity = lookup(row.entityType, row.entityId);
  return entity?.parcelId || (Array.isArray(entity?.parcelIds) ? entity.parcelIds[0] : '') || '';
}

export function buildTimeline({journal = [], audit = [], devices = [], deviceName, lookup} = {}) {
  const rows = [...journal.map(e => fromJournal(e, {deviceName})), ...audit.map(a => fromAudit(a, {devices}))];
  for (const row of rows) row.parcelId = parcelOf(row, lookup);
  return rows.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
}

const dayStart = iso => new Date(`${iso}T00:00:00`).getTime();
export function filterTimeline(rows, {person = '', device = '', parcelId = '', type = '', from = '', to = '', text = ''} = {}) {
  const q = String(text || '').trim().toLowerCase();
  const min = from ? dayStart(from) : -Infinity, max = to ? dayStart(to) + 864e5 : Infinity;
  return rows.filter(r => (!person || r.who === person) && (!device || r.device === device) && (!parcelId || r.parcelId === parcelId)
    && (!type || r.entityType === type || (type === 'autre' && !r.entityType)) && r.at >= min && r.at < max
    && (!q || `${r.message} ${r.who}`.toLowerCase().includes(q)));
}

// Valeurs disponibles pour les filtres (seulement celles présentes dans la frise).
export function facets(rows) {
  const uniq = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  return {people: uniq(rows.map(r => r.who)), devices: uniq(rows.map(r => r.device)), parcels: uniq(rows.map(r => r.parcelId)), types: uniq(rows.map(r => r.entityType))};
}

export const csvCell = value => { const s = String(value ?? ''); return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const stamp = at => { const d = new Date(at), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export function timelineCsv(rows, {parcelName = () => ''} = {}) {
  const head = ['Date', 'Personne', 'Appareil', 'Origine', 'Type', 'Action', 'Parcelle', 'Description'];
  const lines = rows.map(r => [stamp(r.at), r.who, r.device, r.source === 'cloud' ? 'Cloud' : 'Local', r.entityType ? entityLabel(r.entityType) : '', actionLabel(r.action), parcelName(r.parcelId) || '', r.message].map(csvCell).join(';'));
  return `﻿${[head.join(';'), ...lines].join('\r\n')}\r\n`;
}

// Blocs pour flowPdf (pdf-lite.js) : « Registre des modifications ».
export function registerBlocks(rows, {title = 'Registre des modifications', farm = '', filters = '', parcelName = () => '', generatedAt = Date.now()} = {}) {
  return [
    {type: 'h1', text: title},
    {type: 'p', text: [farm, `édité le ${stamp(generatedAt)}`, `${rows.length} événement${rows.length > 1 ? 's' : ''}`].filter(Boolean).join(' · '), muted: true},
    ...(filters ? [{type: 'note', text: `Filtres : ${filters}`}] : []),
    {type: 'table', head: ['Date', 'Personne', 'Appareil', 'Type', 'Parcelle', 'Description'], rows: rows.map(r => [stamp(r.at), r.who || '—', r.device || '—', r.entityType ? entityLabel(r.entityType) : '—', parcelName(r.parcelId) || '—', r.message])},
    {type: 'p', text: 'Journal local de cet appareil (500 derniers événements) et audit cloud de l’exploitation.', small: true, muted: true}
  ];
}
