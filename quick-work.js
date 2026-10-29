// @ts-check
// Saisie d'un travail en 3 étapes (n° 160) : logique pure, sans DOM.
// Étape 1 : quel travail (types classés par usage sur 90 jours) ; étape 2 : sur quelles parcelles (celles où un
// travail ou une tâche du même genre est prévu aujourd'hui remontent en tête) ; étape 3 : les détails (date,
// produit, dose apprise, matériel). L'enregistrement suit le modèle actuel : une intervention par parcelle,
// reliées par un batchId ; un travail déjà prévu sur la parcelle est terminé plutôt que dupliqué, et les tâches
// du jour du même genre sont cochées.
import {rankTypes, typeFamily, normalizeType, defaultsFor, buildQuickWork, isPhytoType} from './quick-entry.js';
import {agendaDate, isPending} from './home-priorities.js';
import {isForageParcel} from './grazing.js';
import {campaignFor} from './utils.js';

export const QUICK_STEP_TYPES = 8;
export const BASE_TYPES = ['Semis', 'Traitement', 'Fertilisation', 'Travail du sol', 'Récolte', 'Fauche', 'Pâturage', 'Observation'];
const ABBR = {seed: 'Se', spray: 'Tr', fertilize: 'Fe', soil: 'So', harvest: 'Ré', mow: 'Fa', graze: 'Pâ'};
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const DAY = 86400000;
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Pastille d'un type : deux lettres et famille (la couleur vient du jeton --c-work-<famille>). @param {string} type */
export function typeBadge(type) {
  const family = typeFamily(type);
  const label = String(type || '').trim();
  const ab = ABBR[family] || (label.slice(0, 1).toLocaleUpperCase('fr') + label.slice(1, 2).toLocaleLowerCase('fr')) || '?';
  return {ab, family};
}

/**
 * Types proposés : les plus utilisés sur 90 jours d'abord, puis le classement habituel (rankTypes),
 * complétés par les types courants. Les 8 premiers sont des tuiles, le reste est derrière « Autre… ».
 * @param {any} data @param {{today: string, limit?: number}} options
 */
export function orderedWorkTypes(data, {today, limit = QUICK_STEP_TYPES}) {
  const all = rankTypes(data, {limit: 40, fallback: BASE_TYPES});
  const since = shiftIso(today, -90);
  const recent = new Map();
  for (const work of live(data?.interventions)) {
    const date = String(work.date || work.plannedDate || '').slice(0, 10);
    if (date < since || date > today) continue;
    const key = normalizeType(work.type);
    recent.set(key, (recent.get(key) || 0) + 1);
  }
  const score = item => recent.get(normalizeType(item.type)) || 0;
  const sorted = all.map((item, i) => ({...item, i})).sort((a, b) => score(b) - score(a) || a.i - b.i)
    .map(({i: _i, ...item}) => ({...item, ...typeBadge(item.type)}));
  return {top: sorted.slice(0, limit), more: sorted.slice(limit)};
}

/**
 * Champ produit et dose selon le genre de travail (unités et pas de la maquette).
 * @param {string} type
 */
export function doseConfig(type) {
  const family = typeFamily(type);
  if (family === 'seed') return {label: 'Variété', placeholder: 'ex. Rubisko', unit: 'kg/ha', def: 160, step: 10, digits: 0, none: false};
  if (family === 'spray') return {label: 'Produit', placeholder: 'ex. fongicide', unit: 'L/ha', def: 1, step: 0.1, digits: 1, none: false};
  if (family === 'fertilize') return {label: 'Engrais', placeholder: 'ex. ammonitrate 27 %', unit: 'kg/ha', def: 120, step: 10, digits: 0, none: false};
  return {label: 'Remarque', placeholder: 'Facultatif', unit: '', def: 0, step: 0, digits: 0, none: true};
}

/** Dose saisie au clavier : virgule acceptée, vide ou invalide → null. @param {unknown} value */
export function parseDose(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** @param {number} value @param {number} digits */
export const formatDose = (value, digits) => Number(value || 0).toLocaleString('fr-FR', {minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2)});

/**
 * Dose apprise : dernière dose saisie pour ce produit, sinon pour ce type de travail.
 * @param {any} data @param {{type: string, product?: string}} options
 * @returns {{dose: number, unit: string, product: string}|null}
 */
export function learnedDose(data, {type, product = ''}) {
  const works = live(data?.interventions).filter(w => parseDose(w.dose) !== null)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  const p = normalizeType(product), t = normalizeType(type);
  const hit = (p && works.find(w => normalizeType(w.product) === p)) || (!p && works.find(w => normalizeType(w.type) === t)) || null;
  return hit ? {dose: /** @type {number} */ (parseDose(hit.dose)), unit: String(hit.doseUnit || ''), product: String(hit.product || '')} : null;
}

const sameKind = (label, type) => {
  const family = typeFamily(type);
  return family === 'other' ? normalizeType(label) === normalizeType(type) : typeFamily(label) === family;
};

/**
 * Travaux et tâches encore ouverts, du même genre, prévus au plus tard aujourd'hui, par parcelle.
 * @param {any} data @param {{type: string, today: string}} options
 */
export function plannedToday(data, {type, today}) {
  const works = live(data?.interventions).filter(w => isPending(w) && sameKind(w.type, type) && agendaDate(w) && agendaDate(w) <= today);
  const tasks = live(data?.tasks).filter(t => isPending(t, 'task') && sameKind(t.title, type) && agendaDate(t, 'task') && agendaDate(t, 'task') <= today);
  const parcelIds = new Set([...works, ...tasks].map(item => item.parcelId).filter(Boolean));
  return {works, tasks, parcelIds};
}

/**
 * Liste de l'étape 2 : parcelles prévues aujourd'hui d'abord, puis les cochées, puis par nom.
 * Filtres : all, favorites, pasture, ou culture:<nom>.
 * @param {any} data @param {{type: string, today: string, selected?: string[], query?: string, filter?: string}} options
 */
export function parcelChoices(data, {type, today, selected = [], query = '', filter = 'all'}) {
  const parcels = live(data?.parcelles).filter(p => !p.archived);
  const planned = plannedToday(data, {type, today}).parcelIds;
  const q = normalizeType(query);
  const keep = p => {
    if (filter === 'favorites' && !p.favorite) return false;
    if (filter === 'pasture' && !isForageParcel(p, data?.grazingSessions || [])) return false;
    if (filter.startsWith('culture:') && (p.culture || '') !== filter.slice(8)) return false;
    return !q || normalizeType(`${p.nom} ${p.culture || ''} ${p.commune || ''}`).includes(q);
  };
  const rank = p => planned.has(p.id) ? 0 : selected.includes(p.id) ? 1 : 2;
  return parcels.filter(p => keep(p) || selected.includes(p.id))
    .sort((a, b) => rank(a) - rank(b) || String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'))
    .map(p => ({parcel: p, planned: planned.has(p.id), selected: selected.includes(p.id)}));
}

/** Pastilles de filtre de l'étape 2 : Toutes, Favoris, Prairies, puis cultures présentes. @param {any} data */
export function parcelFilters(data) {
  const parcels = live(data?.parcelles).filter(p => !p.archived);
  const cultures = [...new Set(parcels.map(p => p.culture).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  return [{id: 'all', label: 'Toutes'},
    ...(parcels.some(p => p.favorite) ? [{id: 'favorites', label: 'Favoris'}] : []),
    ...(parcels.some(p => isForageParcel(p, data?.grazingSessions || [])) ? [{id: 'pasture', label: 'Prairies'}] : []),
    ...cultures.map(c => ({id: `culture:${c}`, label: c}))];
}

/** Récapitulatif sous le titre : « Traitement · 2 parcelles · 14,2 ha ». @param {any} data @param {{type?: string|null, parcelIds?: string[]}} draft */
export function draftSummary(data, {type, parcelIds = []}) {
  const parcels = live(data?.parcelles).filter(p => parcelIds.includes(p.id));
  const area = parcels.reduce((sum, p) => sum + (Number(p.surfaceHa) || 0), 0);
  const parts = [type || ''];
  if (parcels.length) parts.push(`${parcels.length} parcelle${parcels.length > 1 ? 's' : ''} · ${area.toLocaleString('fr-FR', {maximumFractionDigits: 1})} ha`);
  return parts.filter(Boolean).join(' · ');
}

/** Date choisie : Aujourd'hui, Hier ou une date libre. @param {string} choice @param {string} today @param {string} [custom] */
export function draftDate(choice, today, custom = '') {
  if (choice === 'yesterday') return shiftIso(today, -1);
  if (choice === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(custom)) return custom;
  return today;
}

/** Fenêtre de rapprochement d'un travail ou d'une tâche prévus avec la date saisie : 7 jours avant, 3 jours après. */
export const CLOSE_WINDOW = {before: 7, after: 3};

/**
 * Travaux et tâches prévus que l'enregistrement clôturerait : même genre, sur les parcelles choisies, échéance
 * proche de la date saisie (CLOSE_WINDOW) ; pour un travail, le plus proche de la date par parcelle, et jamais un
 * travail prévu avec un autre produit. Rien pour une date future (le travail saisi est alors « À faire »).
 * @param {any} data @param {{type: string, parcelIds: string[], date: string, today: string, product?: string}} options
 */
export function closingCandidates(data, {type, parcelIds, date, today, product = ''}) {
  if (!type || !parcelIds?.length || date > today) return {works: [], tasks: []};
  const from = shiftIso(date, -CLOSE_WINDOW.before), to = shiftIso(date, CLOSE_WINDOW.after);
  const near = iso => Boolean(iso) && iso >= from && iso <= to;
  const distance = iso => Math.abs(Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`));
  const p = normalizeType(product);
  const sameProduct = w => typeFamily(type) === 'other' || !p || !String(w.product || '').trim() || normalizeType(w.product) === p;
  const ids = new Set(parcelIds);
  const works = [];
  for (const id of ids) {
    const hit = live(data?.interventions).filter(w => w.parcelId === id && isPending(w) && sameKind(w.type, type) && near(agendaDate(w)) && sameProduct(w))
      .sort((a, b) => distance(agendaDate(a)) - distance(agendaDate(b)))[0];
    if (hit) works.push(hit);
  }
  const tasks = live(data?.tasks).filter(t => ids.has(t.parcelId) && isPending(t, 'task') && sameKind(t.title, type) && near(agendaDate(t, 'task')));
  return {works, tasks};
}

/**
 * Fiches à écrire. Une intervention par parcelle (batchId commun s'il y en a plusieurs) ; un travail du même
 * genre prévu près de la date (closingCandidates) est terminé à la place, et les tâches correspondantes cochées ;
 * l'utilisateur peut en écarter (skip). Une date future donne un travail « À faire ».
 * @param {{type: string, parcelIds: string[], date: string, product?: string, dose?: number|null, doseUnit?: string, equipmentId?: string, note?: string, startTime?: string}} draft
 * @param {any} data @param {{today: string, batchId?: string, skip?: Set<string>|string[]}} options
 */
export function buildQuickWorks(draft, data, {today, batchId = '', skip = []}) {
  const type = String(draft.type || '').trim();
  if (!type) throw new Error('Choisissez un type de travail.');
  const parcels = live(data?.parcelles).filter(p => (draft.parcelIds || []).includes(p.id));
  if (!parcels.length) throw new Error('Choisissez au moins une parcelle.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : today;
  const future = date > today;
  const cfg = doseConfig(type);
  const dose = cfg.none ? null : (draft.dose ?? null);
  const fields = {
    product: cfg.none ? '' : String(draft.product || '').trim(),
    dose: dose ?? '', doseUnit: dose === null ? '' : (draft.doseUnit || cfg.unit),
    note: cfg.none ? String(draft.product || draft.note || '').trim() : String(draft.note || '').trim(),
    ...(draft.startTime ? {startTime: draft.startTime} : {})
  };
  const skipped = new Set(skip);
  const planned = closingCandidates(data, {type, parcelIds: parcels.map(p => p.id), date, today, product: fields.product});
  /** @type {Record<string, any>[]} */
  const creates = [];
  /** @type {Record<string, any>[]} */
  const updates = [];
  for (const parcel of parcels) {
    const base = buildQuickWork({type, parcel, data, today: date});
    const equipmentId = draft.equipmentId ?? base.equipmentId;
    const existing = planned.works.find(w => w.parcelId === parcel.id && !skipped.has(w.id));
    if (existing) {
      const note = [String(existing.note || '').trim(), fields.note].filter(Boolean).join(' · ');
      updates.push({...existing, status: 'Terminé', plannedDate: existing.plannedDate || existing.date || '', date,
        campaignId: campaignFor(date), culture: parcel.culture || existing.culture || '',
        ...(fields.product ? {product: fields.product} : {}), ...(dose !== null ? {dose, doseUnit: fields.doseUnit} : {}),
        ...(note ? {note} : {}), ...(fields.startTime ? {startTime: fields.startTime} : {}),
        ...(equipmentId ? {equipmentId} : {}), ...(isPhytoType(type) ? {isPhytosanitary: true} : {})});
      continue;
    }
    creates.push({...base, ...fields, equipmentId,
      status: future ? 'À faire' : 'Terminé', plannedDate: future ? date : '',
      actualMetrics: {...base.actualMetrics, dose: dose ?? null}});
  }
  if (creates.length > 1 && batchId) creates.forEach(work => { work.batchId = batchId; });
  const tasks = planned.tasks.filter(t => !skipped.has(t.id)).map(t => ({...t, status: 'Terminé'}));
  return {creates, updates, tasks};
}

/** Brouillon enregistrable (étapes 2 et 3) : champs simples seulement. @param {any} draft */
export function draftFields(draft) {
  const {type = null, parcelIds = [], dateChoice = 'today', customDate = '', product = '', dose = null, doseUnit = '', equipmentId = '', note = '', step = 1} = draft || {};
  return {type, parcelIds: [...parcelIds], dateChoice, customDate, product, dose, doseUnit, equipmentId, note, step};
}

export {defaultsFor};
