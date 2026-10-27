// n° 104 : actions d'écriture proposées par l'assistant distant (observation, mouvement de stock,
// sortie de lot, planification de travaux). Logique pure : chaque action devient un brouillon qui dit
// exactement ce qui sera écrit (lignes « avant → après ») et passe par les permissions du rôle.
// Rien n'est écrit ici : assistant-remote-ui.js affiche la fiche et n'écrit qu'après confirmation.
import {canMutate, roleLabel} from './permissions.js';
import {grazingDate, grazingStatus, grazingTotal, grazingType} from './grazing.js';
import {OBSERVATION_TYPES} from './voice-grammar.js';
import {campaignFor, normalize, toNumber} from './utils.js';

export const NEW_WRITE_ACTIONS = Object.freeze(['create_observation', 'stock_movement', 'grazing_exit', 'plan_works']);
export const SEVERITIES = Object.freeze({info: 'Information', warning: 'À surveiller', urgent: 'Urgent'});
export const STOCK_MOVEMENT_TYPES = Object.freeze(['Entrée', 'Sortie', 'Ajustement']);
export const MAX_PLANNED_WORKS = 20;

const active = (state, type) => (state?.[type] || []).filter(row => row && !row.deletedAt);
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
const fail = error => ({ok: false, error});

function findParcel(state, payload) {
  const parcels = active(state, 'parcelles');
  if (payload.parcelId) return parcels.find(p => p.id === payload.parcelId) || null;
  const name = normalize(payload.parcelName || payload.parcel || '');
  return name ? parcels.find(p => normalize(p.nom) === name) || null : null;
}

function findStock(state, payload) {
  const items = active(state, 'stockItems');
  if (payload.stockId || payload.stockItemId) return items.find(x => x.id === (payload.stockId || payload.stockItemId)) || null;
  const name = normalize(payload.stockName || payload.product || payload.name || '');
  if (!name) return null;
  const hits = items.filter(x => normalize(x.name) === name);
  return hits.length === 1 ? hits[0] : null;
}

function allowed(role, writes) {
  for (const write of writes) {
    if (!canMutate(role, {entity: write.entity, action: write.action, record: write.after, previous: write.before})) return fail(`Votre rôle (${roleLabel(role)}) ne permet pas cette écriture.`);
  }
  return null;
}

const row = (label, before, after) => ({label, before: before === undefined || before === null || before === '' ? '' : String(before), after: after === undefined || after === null || after === '' ? '' : String(after)});

function observationDraft(state, payload, {today}) {
  const parcel = findParcel(state, payload);
  if ((payload.parcelId || payload.parcelName) && !parcel) return fail('Parcelle introuvable.');
  const title = text(payload.title || payload.type, 120);
  if (!title) return fail('Champ obligatoire : titre de l’observation.');
  const date = payload.date ? String(payload.date).slice(0, 10) : today;
  if (!isDay(date) || date > today) return fail('Date d’observation invalide (au plus aujourd’hui).');
  const severity = Object.hasOwn(SEVERITIES, payload.severity) ? payload.severity : 'info';
  const type = OBSERVATION_TYPES.includes(payload.type) ? payload.type : 'Observation';
  const after = {parcelId: parcel?.id || '', date, type, title, note: text(payload.note, 1000), severity, status: 'À surveiller', latitude: null, longitude: null, accuracy: null, resolvedAt: null, source: 'assistant-remote'};
  return {ok: true, title: 'Nouvelle observation', writes: [{entity: 'observations', action: 'create', before: null, after}],
    rows: [row('Parcelle', '', parcel?.nom || 'Aucune'), row('Titre', '', title), row('Type', '', type), row('Niveau', '', SEVERITIES[severity]), row('Date', '', date), ...(after.note ? [row('Note', '', after.note)] : [])]};
}

function stockDraft(state, payload, {today}) {
  const item = findStock(state, payload);
  if (!item) return fail('Fiche de stock introuvable (ou plusieurs fiches portent ce nom).');
  const type = STOCK_MOVEMENT_TYPES.includes(payload.type) ? payload.type : payload.type === 'in' ? 'Entrée' : payload.type === 'out' ? 'Sortie' : '';
  if (!type) return fail('Type de mouvement attendu : Entrée, Sortie ou Ajustement.');
  const quantity = Number(String(payload.quantity ?? '').replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'Ajustement' && quantity === 0)) return fail('Quantité invalide.');
  if (payload.unit && item.unit && normalize(payload.unit) !== normalize(item.unit)) return fail(`Unité à vérifier : le stock « ${item.name} » est suivi en « ${item.unit} ».`);
  const date = payload.date ? String(payload.date).slice(0, 10) : today;
  if (!isDay(date) || date > today) return fail('Date du mouvement invalide (au plus aujourd’hui).');
  const current = toNumber(item.quantity);
  if (type === 'Sortie' && quantity > current) return fail('Stock insuffisant pour cette sortie.');
  const next = type === 'Entrée' ? current + quantity : type === 'Sortie' ? current - quantity : quantity;
  const movement = {stockItemId: item.id, type, quantity, date, note: text(payload.note || 'Proposé par l’assistant', 300)};
  const writes = [{entity: 'stockMovements', action: 'create', before: null, after: movement}, {entity: 'stockItems', action: 'update', before: item, after: {...item, quantity: next}}];
  return {ok: true, title: `Mouvement de stock : ${item.name || 'Produit'}`, movement, writes,
    rows: [row('Produit', '', item.name || 'Produit'), row('Mouvement', '', `${type} ${quantity} ${item.unit || ''}`.trim()), row('Quantité en stock', `${current} ${item.unit || ''}`.trim(), `${next} ${item.unit || ''}`.trim()), row('Date', '', date)]};
}

function grazingDraft(state, payload, {today}) {
  const sessions = active(state, 'grazingSessions').filter(s => grazingStatus(s, {date: today}) === 'current');
  let session = payload.grazingId || payload.sessionId ? sessions.find(s => s.id === (payload.grazingId || payload.sessionId)) : null;
  if (!session && !(payload.grazingId || payload.sessionId)) {
    const parcel = findParcel(state, payload), hits = parcel ? sessions.filter(s => s.parcelId === parcel.id) : [];
    session = hits.length === 1 ? hits[0] : null;
    if (hits.length > 1) return fail('Plusieurs lots sont au pré sur cette parcelle : choisissez-le dans Pâturage.');
  }
  if (!session) return fail('Aucun lot au pré ne correspond.');
  const date = payload.date ? grazingDate(payload.date) : today;
  if (!isDay(date) || date > today || date < grazingDate(session.startDate)) return fail('Date de sortie invalide (entre l’entrée et aujourd’hui).');
  const parcel = active(state, 'parcelles').find(p => p.id === session.parcelId);
  return {ok: true, title: 'Sortie du pré', session, date, writes: [{entity: 'grazingSessions', action: 'update', before: session, after: {...session, endDate: date}}],
    rows: [row('Parcelle', '', parcel?.nom || 'Parcelle'), row('Lot', '', `${grazingTotal(session)} ${grazingType(session) || 'animaux'}`), row('Sortie', session.endDate || 'Au pré', date)]};
}

function planDraft(state, payload, {today}) {
  const list = Array.isArray(payload.works) ? payload.works : [];
  if (!list.length) return fail('Aucun travail à planifier.');
  if (list.length > MAX_PLANNED_WORKS) return fail(`Au plus ${MAX_PLANNED_WORKS} travaux à la fois.`);
  const writes = [], rows = [];
  for (const [index, item] of list.entries()) {
    const entry = item && typeof item === 'object' ? item : {};
    const parcel = findParcel(state, entry);
    if (!parcel) return fail(`Travail ${index + 1} : parcelle introuvable.`);
    const type = text(entry.type || entry.workType, 80);
    if (!type) return fail(`Travail ${index + 1} : type de travail manquant.`);
    const day = String(entry.plannedDate || entry.date || today).slice(0, 10);
    if (!isDay(day) || day < today) return fail(`Travail ${index + 1} : date prévue invalide (aujourd’hui ou plus tard).`);
    const after = {parcelId: parcel.id, type, date: day, plannedDate: day, status: 'À faire', surfaceWorked: toNumber(parcel.surfaceHa), cost: 0, campaignId: campaignFor(day), note: text(entry.note, 500), source: 'assistant-remote'};
    writes.push({entity: 'interventions', action: 'create', before: null, after});
    rows.push(row(`${type} · ${parcel.nom}`, '', `à faire le ${day}`));
  }
  return {ok: true, title: `${writes.length} ${writes.length > 1 ? 'travaux' : 'travail'} à planifier`, writes, rows};
}

const BUILDERS = {create_observation: observationDraft, stock_movement: stockDraft, grazing_exit: grazingDraft, plan_works: planDraft};

// Brouillon d'une action : {ok, title, writes:[{entity, action, before, after}], rows:[{label, before, after}]} ou {ok:false, error}.
export function buildActionDraft(action, state, {role = 'owner', today = grazingDate()} = {}) {
  const build = BUILDERS[action?.type];
  if (!build) return fail('Action non prise en charge.');
  const payload = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload) ? action.payload : {};
  const draft = build(state, payload, {today});
  if (!draft.ok) return draft;
  return allowed(role, draft.writes) || draft;
}
