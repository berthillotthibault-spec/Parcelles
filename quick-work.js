// @ts-check
// Saisie d'un travail en 3 étapes (n° 160) : logique pure, sans DOM.
// Étape 1 : quel travail (types classés par usage sur 90 jours) ; étape 2 : sur quelles parcelles (celles où un
// travail ou une tâche du même genre est prévu aujourd'hui remontent en tête) ; étape 3 : les détails (date,
// produit, dose apprise, matériel). L'enregistrement suit le modèle actuel : une intervention par parcelle,
// reliées par un batchId ; un travail déjà prévu sur la parcelle est terminé plutôt que dupliqué, et les tâches
// du jour du même genre sont cochées.
import {rankTypes, typeFamily, normalizeType, defaultsFor, buildQuickWork} from './quick-entry.js';
import {agendaDate, isPending} from './home-priorities.js';
import {isForageParcel} from './grazing.js';
import {campaignFor} from './utils.js';
import {isModuleActive} from './activity-modules.js';
import {trimCheck} from './hedges.js';
import {isTreatment, darConflicts, productFor} from './phyto.js';
import {normalizeSeed, varietyNames, DENSITY_UNITS} from './seeds.js';
import {forageRecords, forageType, validateForage, FORAGE_KIND, CUT_TYPES} from './forage.js';
import {normalizeInterculture, intercultureError, minDestructionDate, coverSettings} from './covers.js';
import {fertilizerFor, nitrogenPerHa, parcelPlan, nitrogenRegister, banPeriodFor, cultureSeason, cultureFor, parcelInZone, nitrogenReferences, FERTILIZER_LIBRARY} from './nitrogen.js';
import {workCosts, estimatedCostPatch} from './costs.js';
import {requiredStock} from './work-effects.js';

export const QUICK_STEP_TYPES = 8;
export const BASE_TYPES = ['Semis', 'Traitement', 'Fertilisation', 'Travail du sol', 'Récolte', 'Fauche', 'Pâturage', 'Observation'];
// Vrais gestes d'animaux : liste fermée, jamais typeFamily (la famille « graze » mêle clôture, abreuvoir et troupeau)
// ni /patur/ (« Broyage pâture » n'a pas d'animaux). Sert au « + », à finish-work, au formulaire et à l'assistant.
const GRAZING_TYPES = new Set(['paturage', 'pature', 'mise a l herbe', 'mise au pre', 'pacage', 'transhumance', 'estive']);
/** Ce type de travail est-il en réalité un passage d'animaux ? @param {unknown} type */
export const isGrazingType = type => GRAZING_TYPES.has(normalizeType(String(type ?? '').replace(/['’]/g, ' ')));
/** La tuile Observation ouvre le formulaire d'observation : jamais une intervention. @param {unknown} type */
export const isObservationType = type => normalizeType(type) === 'observation';
// Genre choisi sous « Autre… » (work.kind, facultatif) : il prime sur le libellé.
export const WORK_KINDS = [['none', 'Rien'], ['spray', 'Un produit'], ['seed', 'Une semence'], ['fertilize', 'Un engrais']];
const KIND_FAMILY = {none: 'other', spray: 'spray', seed: 'seed', fertilize: 'fertilize'};
// Sans genre choisi, un libellé du registre (isTreatment : « Pulvé », « Désherbage haie ») est un traitement : la saisie
// et le registre suivent la même règle.
/** @param {string} type @param {string} [kind] */
export const workFamily = (type, kind = '') => KIND_FAMILY[kind] || (isTreatment({type}) ? 'spray' : typeFamily(type));
// Rangée compacte sous l'étape 1 : des raccourcis vers les saisies existantes, filtrés par activité et rôle.
const ADD_ROUTES = [
  {action: 'new-task', label: 'Tâche', guard: {entity: 'tasks', action: 'create'}},
  {action: 'herd-pick', kind: 'calving', label: 'Vêlage', guard: {entity: 'animalEvents', action: 'create', payload: {kind: 'calving'}}},
  {action: 'herd-pick', kind: 'weighing', label: 'Pesée', guard: {entity: 'animalEvents', action: 'create', payload: {kind: 'weighing'}}},
  {action: 'open-herd-health', label: 'Soin', guard: {entity: 'vetTreatments', action: 'create'}}
];
/** @param {{visible?: (action: string) => boolean, canWrite?: (guard: any) => boolean}} options */
export const addRoutes = ({visible = () => true, canWrite = () => true} = {}) =>
  ADD_ROUTES.filter(r => visible(r.action) && (!r.guard || canWrite(r.guard))).map(({action, kind, label}) => ({action, kind: kind || '', label}));
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
  const livestock = isModuleActive('livestock', data?.preferences?.activeModules);
  const ranked = rankTypes(data, {limit: 40, fallback: BASE_TYPES});
  // Types de base toujours proposés, même au-delà de 40 types d'historique.
  const missing = BASE_TYPES.filter(type => !ranked.some(item => normalizeType(item.type) === normalizeType(type)))
    .map(type => ({type, count: 0, family: typeFamily(type), source: 'suggested', suggested: true}));
  const since = shiftIso(today, -90);
  const recent = new Map();
  for (const work of live(data?.interventions)) {
    const date = String(work.date || work.plannedDate || '').slice(0, 10);
    if (date < since || date > today) continue;
    const key = normalizeType(work.type);
    recent.set(key, (recent.get(key) || 0) + 1);
  }
  // Un passage d'animaux ne laisse plus d'intervention : il compte pour la tuile Pâturage.
  const grazings = live(data?.grazingSessions).filter(row => { const date = String(row.startDate || '').slice(0, 10); return date >= since && date <= today; }).length;
  const score = item => (recent.get(normalizeType(item.type)) || 0) + (isGrazingType(item.type) ? grazings : 0);
  // Sans le module Élevage, Pâturage n'est plus suggéré ; un type venu de l'historique reste.
  const all = [...ranked, ...missing].filter(item => livestock || !item.suggested || !isGrazingType(item.type));
  const sorted = all.map((item, i) => ({...item, i})).sort((a, b) => score(b) - score(a) || a.i - b.i)
    .map(({i: _i, ...item}) => ({...item, ...typeBadge(item.type)}));
  // Élevage actif : Pâturage reste épinglé parmi les tuiles, sans changer le classement du reste.
  const pinned = livestock ? sorted.findIndex(item => normalizeType(item.type) === 'paturage') : -1;
  if (pinned >= limit) sorted.splice(limit - 1, 0, sorted.splice(pinned, 1)[0]);
  return {top: sorted.slice(0, limit), more: sorted.slice(limit)};
}

// Effluents liquides (m³/ha) et solides (t/ha) : jamais de dose de départ en kg/ha (lot 3, AT-07).
const LIQUID_MANURE = /(lisier|digestat|purin)/;
const SOLID_MANURE = /(fumier|compost|fiente)/;
/** Irrigation : une lame d'eau en mm. @param {unknown} type */
export const isIrrigation = type => /(irrig|arros)/.test(normalizeType(type));
const FERTILIZE_UNITS = ['kg/ha', 't/ha', 'm³/ha', 'L/ha', 'unité/ha'];

/**
 * Champ produit et dose selon le genre de travail (unités et pas de la maquette). units : choix proposés à l'étape 3,
 * le premier étant l'unité de départ ; product affine l'unité d'un engrais (effluent liquide ou solide).
 * @param {string} type @param {string} [kind] @param {string} [product]
 */
export function doseConfig(type, kind = '', product = '') {
  const family = workFamily(type, kind);
  if (family === 'seed') return {label: 'Variété', placeholder: 'ex. Rubisko', unit: 'kg/ha', units: ['kg/ha', 'grains/m²'], def: 160, step: 10, digits: 0, none: false};
  if (family === 'spray') return {label: 'Produit', placeholder: 'ex. fongicide', unit: 'L/ha', units: ['L/ha', 'kg/ha'], def: 1, step: 0.1, digits: 1, none: false};
  if (family === 'fertilize') {
    const text = normalizeType(`${type} ${product}`);
    const base = {label: 'Engrais', placeholder: 'ex. ammonitrate 27 %', units: FERTILIZE_UNITS, none: false};
    if (LIQUID_MANURE.test(text)) return {...base, unit: 'm³/ha', def: null, step: 5, digits: 0};
    if (SOLID_MANURE.test(text)) return {...base, unit: 't/ha', def: null, step: 5, digits: 0};
    return {...base, unit: 'kg/ha', def: 120, step: 10, digits: 0};
  }
  if (family === 'other' && isIrrigation(type)) return {label: 'Ressource en eau', placeholder: 'ex. forage, rivière', unit: 'mm', units: ['mm'], def: null, step: 5, digits: 0, none: false};
  return {label: 'Remarque', placeholder: 'Facultatif', unit: '', units: [], def: 0, step: 0, digits: 0, none: true};
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

/**
 * Dose proposée, jamais enregistrée sans geste : la dernière saisie si elle existe (bouton « Habituel »), sinon la
 * valeur de départ des boutons + et −.
 * @param {any} data @param {{type: string, kind?: string, product?: string}} options
 */
export function doseSuggestion(data, {type, kind = '', product = ''}) {
  const c = doseConfig(type, kind, product);
  if (c.none) return null;
  const learned = learnedDose(data, {type, product});
  if (!learned && (c.def === null || c.def === undefined)) return null; // effluent ou irrigation : rien à proposer sans historique
  return {value: learned?.dose ?? c.def, unit: learned?.unit || c.unit, learned: Boolean(learned), product: learned?.product || ''};
}

// Même travail, à l'exactitude du libellé près : seul celui-ci se clôture d'office.
const exactKind = (label, type) => (isGrazingType(type) || isGrazingType(label)) ? isGrazingType(type) && isGrazingType(label) : normalizeType(label) === normalizeType(type);
const sameKind = (label, type) => {
  if (isGrazingType(type) || isGrazingType(label)) return isGrazingType(type) && isGrazingType(label);
  const family = typeFamily(type);
  // « graze » regroupe des sujets sans rapport (clôture, abreuvoir, troupeau) : il faut le même libellé.
  return family === 'other' || family === 'graze' ? normalizeType(label) === normalizeType(type) : typeFamily(label) === family;
};
// Tâche : le titre doit citer le type saisi, ou la tâche porter ce type ; le genre seul (titre « Fongicide » pour
// un Traitement) ne suffit qu'à proposer le rapprochement, décoché, jamais pour la famille « graze ».
const sameTask = (task, type) => {
  const wanted = normalizeType(type);
  if (Boolean(wanted) && (normalizeType(task.title).includes(wanted) || normalizeType(task.type) === wanted)) return true;
  return isGrazingType(type) && isGrazingType(task.title);
};
const looseTask = (task, type) => !isGrazingType(type) && typeFamily(type) !== 'graze' && typeFamily(type) !== 'other' && !sameTask(task, type) && typeFamily(task.title) === typeFamily(type);

/** Fenêtre de rapprochement d'un travail ou d'une tâche prévus avec la date saisie : 7 jours avant, 3 jours après. */
export const CLOSE_WINDOW = {before: 7, after: 3};
const windowOf = date => ({from: shiftIso(date, -CLOSE_WINDOW.before), to: shiftIso(date, CLOSE_WINDOW.after)});
const dayLabel = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);

/**
 * Travaux et tâches encore ouverts, du même genre, par parcelle : même fenêtre que la clôture, plus les retards plus
 * anciens. labels donne l'étiquette de chaque parcelle selon la date saisie (labels et retards : voir closingCandidates).
 * @param {any} data @param {{type: string, today: string, date?: string}} options
 */
export function plannedToday(data, {type, today, date = today}) {
  const {from, to} = windowOf(date);
  const works = live(data?.interventions).filter(w => isPending(w) && sameKind(w.type, type) && agendaDate(w) && agendaDate(w) <= to);
  const tasks = live(data?.tasks).filter(t => isPending(t, 'task') && sameTask(t, type) && agendaDate(t, 'task') && agendaDate(t, 'task') <= to);
  const parcelIds = new Set([...works, ...tasks].map(item => item.parcelId).filter(Boolean));
  const rows = [...works.map(w => [w.parcelId, agendaDate(w)]), ...tasks.map(t => [t.parcelId, agendaDate(t, 'task')])];
  const distance = iso => iso < from ? Infinity : Math.abs(Date.parse(iso) - Date.parse(date));
  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const id of parcelIds) {
    const best = rows.filter(([pid]) => pid === id).map(([, iso]) => iso).sort((a, b) => distance(a) - distance(b))[0];
    labels.set(id, best < from ? 'En retard' : best === today ? 'Prévu aujourd’hui' : `Prévu le ${dayLabel(best)}`);
  }
  return {works, tasks, parcelIds, labels};
}

/**
 * Liste de l'étape 2 : parcelles prévues aujourd'hui d'abord, puis les cochées, puis par nom.
 * Filtres : all, favorites, pasture, ou culture:<nom>.
 * order : ordre figé à l'entrée de l'étape (ids) ; cocher ne déplace plus la ligne sous le doigt (PF-16).
 * @param {any} data @param {{type: string, today: string, date?: string, selected?: string[], query?: string, filter?: string, order?: string[]|null}} options
 */
export function parcelChoices(data, {type, today, date = today, selected = [], query = '', filter = 'all', order = null}) {
  const parcels = live(data?.parcelles).filter(p => !p.archived);
  const {parcelIds: planned, labels} = plannedToday(data, {type, today, date});
  const q = normalizeType(query);
  const keep = p => {
    if (filter === 'favorites' && !p.favorite) return false;
    if (filter === 'pasture' && !isForageParcel(p, data?.grazingSessions || [])) return false;
    if (filter.startsWith('culture:') && (p.culture || '') !== filter.slice(8)) return false;
    return !q || normalizeType(`${p.nom} ${p.culture || ''} ${p.commune || ''}`).includes(q);
  };
  const rank = p => planned.has(p.id) ? 0 : selected.includes(p.id) ? 1 : 2;
  const fixed = Array.isArray(order) ? new Map(order.map((id, i) => [id, i])) : null;
  const at = p => fixed?.has(p.id) ? fixed.get(p.id) : Infinity;
  return parcels.filter(p => keep(p) || selected.includes(p.id))
    .sort((a, b) => (fixed ? at(a) - at(b) || 0 : 0) || rank(a) - rank(b) || String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'))
    .map(p => ({parcel: p, planned: planned.has(p.id), plannedLabel: labels.get(p.id) || '', selected: selected.includes(p.id), outside: !keep(p)}));
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

/**
 * Récapitulatif sous le titre : « Traitement · 2 parcelles · 14,2 ha », puis la date si ce n'est pas aujourd'hui (PF-19).
 * @param {any} data @param {{type?: string|null, parcelIds?: string[], date?: string, today?: string}} draft
 */
export function draftSummary(data, {type, parcelIds = [], date = '', today = ''}) {
  const parcels = live(data?.parcelles).filter(p => parcelIds.includes(p.id));
  const area = parcels.reduce((sum, p) => sum + (Number(p.surfaceHa) || 0), 0);
  const parts = [type || ''];
  if (parcels.length) parts.push(`${parcels.length} parcelle${parcels.length > 1 ? 's' : ''} · ${area.toLocaleString('fr-FR', {maximumFractionDigits: 1})} ha`);
  if (date && today && date !== today) parts.push(date === shiftIso(today, -1) ? 'hier' : `le ${frDate(date)}`);
  return parts.filter(Boolean).join(' · ');
}

const frDate = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');

/**
 * Date choisie à l'étape 3 (PF-19) : future = travail « À faire » ; plus d'un an d'écart = faute de frappe probable ;
 * autre campagne que celle du jour = à signaler. Messages non bloquants.
 * @param {string} date @param {string} today
 */
export function dateNotice(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !today) return {future: false, far: false, messages: []};
  const future = date > today;
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const far = Math.abs(days) > 365;
  const messages = [];
  if (future) messages.push({text: `Sera prévu le ${frDate(date)}, non terminé.`, warn: false});
  if (far) messages.push({text: `Date à plus d’un an d’aujourd’hui (${frDate(date)}) : vérifiez l’année.`, warn: true});
  if (campaignFor(date) !== campaignFor(today)) messages.push({text: `Campagne ${campaignFor(date)}, pas celle en cours (${campaignFor(today)}).`, warn: far});
  return {future, far, messages};
}

/** Date choisie : Aujourd'hui, Hier ou une date libre. @param {string} choice @param {string} today @param {string} [custom] */
export function draftDate(choice, today, custom = '') {
  if (choice === 'yesterday') return shiftIso(today, -1);
  if (choice === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(custom)) return custom;
  return today;
}

/**
 * Travaux et tâches prévus que l'enregistrement clôturerait : même type exact, sur les parcelles choisies, échéance
 * proche de la date saisie (CLOSE_WINDOW) ; pour un travail, le plus proche de la date par parcelle, et jamais un
 * travail prévu avec un autre produit. Rien pour une date future (le travail saisi est alors « À faire »).
 * looseWorks et looseTasks : même genre mais autre type, ou retard hors fenêtre, proposés décochés (include).
 * ignored : prévus de la même parcelle qui restent ouverts, à signaler (autre produit, second prévu).
 * kind : genre choisi sous « Autre… » ; il décide, comme à l'enregistrement, si le produit compte.
 * @param {any} data @param {{type: string, kind?: string, parcelIds: string[], date: string, today: string, product?: string}} options
 */
export function closingCandidates(data, {type, kind = '', parcelIds, date, today, product = ''}) {
  if (!type || !parcelIds?.length || date > today) return {works: [], tasks: [], looseTasks: [], looseWorks: [], ignored: []};
  const {from, to} = windowOf(date);
  const near = iso => Boolean(iso) && iso >= from && iso <= to;
  const distance = iso => Math.abs(Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`));
  const p = normalizeType(product);
  const sameProduct = w => workFamily(type, kind || w.kind) === 'other' || !p || !String(w.product || '').trim() || normalizeType(w.product) === p;
  const ids = new Set(parcelIds);
  const works = [], looseWorks = [], ignored = [];
  for (const id of ids) {
    const open = live(data?.interventions).filter(w => w.parcelId === id && isPending(w) && sameKind(w.type, type) && agendaDate(w));
    const exact = open.filter(w => exactKind(w.type, type));
    const [hit, ...others] = exact.filter(w => near(agendaDate(w)) && sameProduct(w)).sort((a, b) => distance(agendaDate(a)) - distance(agendaDate(b)));
    if (hit) works.push(hit);
    others.forEach(work => ignored.push({work, reason: 'autre travail prévu'}));
    exact.filter(w => near(agendaDate(w)) && !sameProduct(w)).forEach(work => ignored.push({work, reason: 'autre produit'}));
    // Proposés décochés, mais jamais avec un autre produit : il serait réécrit une fois coché.
    open.filter(w => !exactKind(w.type, type) && near(agendaDate(w))).forEach(w => sameProduct(w) ? looseWorks.push(w) : ignored.push({work: w, reason: 'autre produit'}));
    exact.filter(w => agendaDate(w) < from).forEach(w => sameProduct(w) ? looseWorks.push({...w, overdue: true}) : ignored.push({work: w, reason: 'autre produit'}));
  }
  const open = live(data?.tasks).filter(t => ids.has(t.parcelId) && isPending(t, 'task') && near(agendaDate(t, 'task')));
  return {works, tasks: open.filter(t => sameTask(t, type)), looseTasks: open.filter(t => looseTask(t, type)), looseWorks, ignored};
}

/**
 * Prévus et tâches cochés à l'étape 3 que le formulaire complet ne fermerait pas : il ne reprend que l'unique prévu
 * d'une seule parcelle ; tout le reste resterait « À faire », en double avec la fiche créée.
 * @param {{works?: any[], tasks?: any[], looseTasks?: any[], looseWorks?: any[]}} candidates closingCandidates
 * @param {{skip?: string[], include?: string[], parcelCount?: number}} [options] @returns {string[]}
 */
export function fullFormLeftovers({works = [], tasks = [], looseTasks = [], looseWorks = []} = {}, {skip = [], include = [], parcelCount = 0} = {}) {
  const off = new Set(skip), on = new Set(include);
  const kept = works.filter(w => !off.has(w.id));
  const carried = parcelCount === 1 && kept.length === 1 ? kept[0].id : '';
  return [...kept, ...looseWorks.filter(w => on.has(w.id)), ...tasks.filter(t => !off.has(t.id)), ...looseTasks.filter(t => on.has(t.id))]
    .map(item => item.id).filter(id => id !== carried);
}

/**
 * Reprise du travail prévu à l'étape 3 : une seule parcelle et un seul prévu, sinon rien (la valeur irait à d'autres).
 * @param {any} data @param {{type: string, kind?: string, parcelIds: string[], date: string, today: string}} options
 * @returns {{workId: string, product: string, dose: number|null, doseUnit: string}|null}
 */
export function plannedPrefill(data, {type, kind = '', parcelIds, date, today}) {
  if (parcelIds?.length !== 1) return null;
  const {works} = closingCandidates(data, {type, kind, parcelIds, date, today});
  if (works.length !== 1) return null;
  const w = works[0], dose = parseDose(w.dose);
  return {workId: w.id, product: String(w.product || ''), dose, doseUnit: dose === null ? '' : String(w.doseUnit || '')};
}

/**
 * La reprise du prévu tient-elle encore ? Faux si le produit ou la date saisis font que ce prévu ne serait plus clôturé :
 * sa dose ne doit alors pas partir sur la nouvelle fiche.
 * @param {any} data @param {{workId: string}|null} prefill
 * @param {{type: string, kind?: string, parcelIds: string[], date: string, today: string, product?: string}} options
 */
export function prefillHolds(data, prefill, options) {
  if (!prefill) return false;
  return closingCandidates(data, options).works.some(w => w.id === prefill.workId);
}

// ---------- Étape 3 par famille (lot 3) ----------
/** Champs de l'étape 3 propres au genre de travail ; operator null = celui d'habitude (defaultsFor), visible. */
export const DETAIL_DEFAULTS = Object.freeze({target: '', stage: '', endTime: '', operator: null, surface: '', duration: '', fuel: '', billable: true,
  culture: '', cover: false, seedTgw: '', seedLot: '', seedOrigin: '', seedTreatment: '', productLot: '',
  quantity: '', quantityUnit: 't', humidity: '', impurities: '', silo: '',
  forageType: '', cut: '', forageMode: 'bales', bales: '', tonnes: '', depth: '', destroyCover: false, stockOut: true, meter: true});
export const freshDetails = () => ({...DETAIL_DEFAULTS});
export const HARVEST_UNITS = ['t', 'kg'];
/** Sous-types proposés pour « Travail du sol » : le choix devient le type du travail. */
export const SOIL_TYPES = ['Labour', 'Déchaumage', 'Hersage', 'Binage', 'Roulage', 'Décompactage'];
/** @param {unknown} type */
export const isSoilBase = type => normalizeType(type) === 'travail du sol';
// Seule la coupe crée une récolte de fourrage ; fanage, andainage, pressage renvoient vers la récolte de fourrage (AT-03).
/** @param {unknown} type */
export const isMowCut = type => normalizeType(type) === 'fauche';
/** @param {unknown} type */
export const isForageFollowup = type => /(fanage|andain|pressage|botte|enrubann|ensil)/.test(normalizeType(type));
/** Récolte de grain (lot de récolte) : famille harvest hors ensilage. @param {string} type @param {string} [kind] */
export const isGrainHarvest = (type, kind = '') => workFamily(type, kind) === 'harvest' && !/ensil/.test(normalizeType(type));

const r2 = v => Math.round(v * 100) / 100;
/** Quantité totale répartie au prorata des poids (surfaces), le reste sur la dernière ligne. @param {number} total @param {number[]} weights @param {number} [digits] */
export function shareOut(total, weights, digits = 2) {
  const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0), f = 10 ** digits;
  if (weights.length === 1 || sum <= 0) return weights.map((_, i) => i === weights.length - 1 ? total - Math.round(total / weights.length * f) / f * (weights.length - 1) : Math.round(total / weights.length * f) / f);
  const parts = weights.map(w => Math.round(total * (w > 0 ? w : 0) / sum * f) / f);
  parts[parts.length - 1] = Math.round((total - parts.slice(0, -1).reduce((a, b) => a + b, 0)) * f) / f;
  return parts;
}

/** Durée en heures entre deux heures « HH:MM », passage de minuit compris, comme le formulaire complet. @param {string} start @param {string} end */
export function hoursBetween(start, end) {
  if (!/^\d{1,2}:\d{2}/.test(String(start || '')) || !/^\d{1,2}:\d{2}/.test(String(end || ''))) return null;
  const [ah, am] = String(start).split(':').map(Number), [bh, bm] = String(end).split(':').map(Number);
  let minutes = (bh * 60 + bm) - (ah * 60 + am);
  if (minutes < 0) minutes += 1440;
  return r2(minutes / 60);
}

const STOCK_FITS = {
  seed: item => /semence/i.test(String(item.category || '')),
  spray: item => Boolean(item.phyto) || /phyto|herbic|fongic|insectic|traitement/i.test(String(item.category || '')),
  fertilize: item => Boolean(item.fertilizer) || /engrais|fertil|amendement|effluent/i.test(String(item.category || ''))
};
const dayOf = w => String(w.date || w.plannedDate || '').slice(0, 10);
/**
 * Produits proposés, filtrés par genre (AT-10, PF-18) : les derniers employés pour ce genre, puis le stock de ce genre,
 * puis les variétés connues (semis) ou la bibliothèque d'engrais ; limités ensuite.
 * @param {any} data @param {{type: string, kind?: string, culture?: string, limit?: number}} options
 */
export function productChoices(data, {type, kind = '', culture = '', limit = 30}) {
  const family = workFamily(type, kind), fits = STOCK_FITS[family];
  if (!fits) return [];
  const used = live(data?.interventions).filter(w => String(w.product || '').trim() && workFamily(w.type, w.kind) === family)
    .sort((a, b) => dayOf(b).localeCompare(dayOf(a))).map(w => String(w.product).trim());
  const stock = live(data?.stockItems).filter(fits).map(i => String(i.name || '').trim());
  const extra = family === 'seed' ? varietyNames(data, {culture}) : family === 'fertilize' ? FERTILIZER_LIBRARY.map(f => f.name) : [];
  const seen = new Set(), out = [];
  for (const name of [...used, ...stock, ...extra]) {
    const key = normalizeType(name);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(name);
  }
  return out.slice(0, limit);
}

/** Article de stock du produit saisi : nom exact, de ce genre d'abord. @param {any} data @param {{type: string, kind?: string, product?: string}} options */
export function stockItemFor(data, {type, kind = '', product = ''}) {
  const key = normalizeType(product), fits = STOCK_FITS[workFamily(type, kind)];
  if (!key || !fits) return null;
  const same = live(data?.stockItems).filter(i => normalizeType(i.name) === key && !/recolte/i.test(normalizeType(i.category)));
  return same.find(fits) || same[0] || null;
}

/**
 * Sortie de stock proposée pour les travaux terminés (AT-10) : quantité totale (dose x surface, convertie dans l'unité
 * du stock), disponible, manque. error si une unité ne se convertit pas.
 * @param {any[]} works @param {any} item
 */
export function stockOutPreview(works, item) {
  const done = works.filter(w => w.status === 'Terminé');
  if (!item || !done.length) return null;
  let quantity = 0;
  for (const work of done) {
    const q = requiredStock({...work, dose: parseDose(work.dose), surfaceWorked: parseDose(work.surfaceWorked)}, item);
    if (q === null) return {item, quantity: null, unit: item.unit || '', available: parseDose(item.quantity), short: false, error: 'Dose, surface ou unité non convertible dans l’unité du stock : sortie à faire depuis la fiche du travail.'};
    quantity += q;
  }
  const available = parseDose(item.quantity);
  return {item, quantity: Math.round(quantity * 1000) / 1000, unit: item.unit || '', available, short: available !== null && quantity > available + 1e-9, error: ''};
}

/**
 * Culture semée (AT-04) : ligne de rotation de la campagne du semis, retrouvée et jamais doublée ; la campagne
 * précédente reçoit l'ancienne culture si elle n'a pas de ligne ; la culture de la parcelle suit si la campagne est
 * la courante. Couvert (cover) : interculture de la campagne, sans toucher à la culture. Rien pour un semis futur.
 * @param {any} data @param {{parcels: any[], culture: string, cover?: boolean, date: string, today: string}} options
 */
export function sowingWrites(data, {parcels, culture, cover = false, date, today}) {
  const out = {rotations: [], parcels: [], changes: [], skipped: []};
  const wanted = String(culture || '').trim();
  if (!wanted || date > today) return out;
  const campaign = campaignFor(date), current = campaignFor(today);
  const rows = live(data?.rotations);
  const previous = (() => { const y = Number(campaign.slice(0, 4)) - 1; return `${y}/${String(y + 1).slice(-2)}`; })();
  for (const parcel of parcels) {
    const row = rows.find(r => r.parcelId === parcel.id && r.campaignId === campaign) || null;
    if (cover) {
      const interculture = normalizeInterculture({...(row?.interculture || {}), especes: wanted, semisDate: date});
      const base = row?.culture || parcel.culture || '';
      if (!base) { out.skipped.push(parcel); continue; } // une ligne de rotation exige une culture
      out.rotations.push({...(row || {parcelId: parcel.id, campaignId: campaign, culture: base}), interculture});
      continue;
    }
    // La culture de la parcelle est celle de la campagne courante : jamais reportée sur une campagne passée.
    const before = String(row?.culture || (campaign === current ? parcel.culture : '') || '').trim();
    if (normalizeType(before) === normalizeType(wanted)) continue;
    const old = String(parcel.culture || '').trim();
    if (campaign === current && old && normalizeType(old) !== normalizeType(wanted) && !row && !rows.some(r => r.parcelId === parcel.id && r.campaignId === previous))
      out.rotations.push({parcelId: parcel.id, campaignId: previous, culture: old});
    out.rotations.push({...(row || {parcelId: parcel.id, campaignId: campaign}), culture: wanted});
    if (campaign === current) out.parcels.push({...parcel, culture: wanted});
    out.changes.push({parcel, from: before, to: wanted});
  }
  return out;
}

/** Mode de destruction du couvert d'après le type de travail (DESTRUCTION_MODES), ou '' s'il ne détruit pas. @param {string} type @param {string} [kind] */
export function destructionModeFor(type, kind = '') {
  const t = normalizeType(type), family = workFamily(type, kind);
  if (/labour/.test(t)) return 'Labour';
  if (/broy/.test(t)) return 'Broyage';
  if (/roul/.test(t)) return 'Roulage';
  if (family === 'spray') return 'Chimique (cas dérogatoires)';
  if (family === 'soil' || /destruction couvert/.test(t)) return 'Travail superficiel';
  return '';
}

/**
 * Couverts encore en place que ce passage peut détruire (AT-12) : interculture de la campagne de la date, sans date de
 * destruction. early : date minimale de destruction non atteinte (avertissement).
 * @param {any} data @param {{type: string, kind?: string, parcelIds: string[], date: string}} options
 */
export function coversToDestroy(data, {type, kind = '', parcelIds, date}) {
  const mode = destructionModeFor(type, kind);
  if (!mode) return [];
  const campaign = campaignFor(date), min = minDestructionDate(campaign, coverSettings(data));
  return live(data?.rotations).filter(r => parcelIds.includes(r.parcelId) && r.campaignId === campaign)
    .map(rotation => ({rotation, ic: normalizeInterculture(rotation.interculture)}))
    .filter(({ic}) => ic?.especes && !ic.destructionDate)
    .map(({rotation, ic}) => ({rotation, ic, mode, early: date < min ? min : ''}));
}

/** Code de lot libre : AAAAMMJJ-NOM, suffixé s'il existe déjà. @param {any} data @param {{date: string, parcel: any}} options @param {Set<string>} [taken] */
export function harvestLotCode(data, {date, parcel}, taken = new Set()) {
  const name = normalizeType(parcel?.nom).replace(/[^a-z0-9]+/g, '').slice(0, 8).toUpperCase() || 'LOT';
  const codes = new Set([...live(data?.integrationImports).filter(r => r.farmKind === 'harvest').map(r => String(r.code || '')), ...taken]);
  const base = `${String(date).replace(/-/g, '')}-${name}`;
  let code = base;
  for (let i = 2; codes.has(code); i += 1) code = `${base}-${i}`;
  taken.add(code);
  return code;
}

/** Numéro de la prochaine coupe de l'année pour la parcelle (comme cutCalendar). @param {any} data @param {string} parcelId @param {string} date */
export function nextCut(data, parcelId, date) {
  const year = String(date).slice(0, 4);
  return forageRecords(data, 'harvest').filter(r => r.parcelId === parcelId && String(r.date).startsWith(year) && r.date <= date && CUT_TYPES.includes(r.type)).length + 1;
}

/**
 * Azote de l'engrais saisi (AT-11) : apport par hectare, reste du plan par parcelle, période d'interdiction en zone
 * vulnérable. unknown : composition inconnue, l'apport ne sera pas compté au bilan.
 * @param {any} data @param {{product?: string, dose?: number|null, doseUnit?: string, parcelIds: string[], date: string, today: string}} options
 */
export function nitrogenHint(data, {product = '', dose = null, doseUnit = '', parcelIds, date, today}) {
  const fert = fertilizerFor(data, product);
  const perHa = dose === null ? null : nitrogenPerHa({dose, doseUnit}, fert);
  const unknown = Boolean(String(product || '').trim()) && !fert && !/^(unite|u n|kg n)/.test(normalizeType(doseUnit));
  const campaign = campaignFor(date), refs = nitrogenReferences(data);
  const register = nitrogenRegister(data, campaign);
  const rest = [], bans = [];
  for (const parcel of live(data?.parcelles).filter(p => parcelIds.includes(p.id))) {
    const plan = parcelPlan(data, parcel, campaign, {today, refs});
    if (plan.dose !== null && perHa) {
      const done = register.filter(r => r.parcel?.id === parcel.id).reduce((sum, r) => sum + (r.nEff || 0), 0);
      rest.push({parcel, left: Math.round(plan.dose - done - perHa.nEff)});
    }
    if (fert && parcelInZone(data, parcel)) {
      const ban = banPeriodFor(date, fert.type, cultureSeason(cultureFor(data, parcel, campaign, today), refs), refs);
      if (ban) bans.push({parcel, ban});
    }
  }
  return {fert, perHa, unknown, rest, bans};
}

/** Délai avant récolte des traitements de la parcelle, vu depuis une récolte ou une fauche (AT-M5). @param {any} data @param {{parcelIds: string[], date: string, catalog?: any}} options */
export const harvestDarWarnings = (data, {parcelIds, date, catalog = null}) => parcelIds.flatMap(id => darConflicts(data, id, date, {catalog}));

/**
 * Fiches à écrire. Une intervention par parcelle (batchId commun s'il y en a plusieurs) ; un travail du même
 * genre prévu près de la date (closingCandidates) est terminé à la place, et les tâches correspondantes cochées ;
 * l'utilisateur peut en écarter (skip). Une date future donne un travail « À faire ».
 * closedOnly : identifiants des prévus seulement clos (le même passage), hors stock, compteur et facturation.
 * Rien n'est écrit sans saisie : pas de dose par défaut, et un prévu garde sa dose si elle n'est pas retouchée.
 * details (lot 3) : champs de l'étape 3 par famille ; ils ajoutent les lots de récolte et de fourrage (records),
 * la rotation et la culture de la parcelle (rotations, parcels), et la destruction d'un couvert.
 * @param {{type: string, kind?: string, parcelIds: string[], date: string, product?: string, dose?: number|null, doseUnit?: string, equipmentId?: string, note?: string, startTime?: string, details?: Record<string, any>}} draft
 * @param {any} data @param {{today: string, batchId?: string, skip?: Set<string>|string[], include?: Set<string>|string[], catalog?: any, now?: number}} options
 */
export function buildQuickWorks(draft, data, {today, batchId = '', skip = [], include = [], catalog = null, now = Date.now()}) {
  const type = String(draft.type || '').trim();
  if (!type) throw new Error('Choisissez un type de travail.');
  // Une parcelle archivée (brouillon ancien) ne reçoit rien : elle n'est plus visible dans la liste (PF-17).
  const parcels = live(data?.parcelles).filter(p => !p.archived && (draft.parcelIds || []).includes(p.id));
  if (!parcels.length) throw new Error('Choisissez au moins une parcelle.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : today;
  const future = date > today;
  const kind = String(draft.kind || '');
  const family = workFamily(type, kind);
  const spray = family === 'spray';
  const x = {...DETAIL_DEFAULTS, ...(draft.details || {})};
  const cfg = doseConfig(type, kind, draft.product);
  const dose = cfg.none ? null : (draft.dose ?? null);
  const fields = {
    product: cfg.none ? '' : String(draft.product || '').trim(),
    dose: dose ?? '', doseUnit: dose === null ? '' : (draft.doseUnit || cfg.unit),
    note: cfg.none ? String(draft.product || draft.note || '').trim() : String(draft.note || '').trim(),
    ...(draft.startTime ? {startTime: draft.startTime} : {})
  };
  const item = stockItemFor(data, {type, kind, product: fields.product});
  // Surface : saisie pour une seule parcelle, sinon celle de la parcelle ; durée et carburant répartis au prorata.
  const ownSurface = parcels.length === 1 ? parseDose(x.surface) : null;
  const surfaces = parcels.map(p => (ownSurface !== null && ownSurface > 0 ? ownSurface : Number(p.surfaceHa) || 0));
  const totalDuration = parseDose(x.duration) ?? hoursBetween(String(draft.startTime || ''), String(x.endTime || ''));
  const durations = totalDuration === null ? null : shareOut(totalDuration, surfaces);
  const totalFuel = parseDose(x.fuel);
  const fuels = totalFuel === null ? null : shareOut(totalFuel, surfaces);
  const clientOf = parcel => parcel.clientId ? live(data?.clients).find(c => c.id === parcel.clientId) || null : null;
  const sowing = family === 'seed' && !cfg.none;
  let seed = null;
  if (sowing) {
    const res = normalizeSeed({seedVariety: fields.product, seedDensity: dose, seedDensityUnit: DENSITY_UNITS.includes(fields.doseUnit) ? fields.doseUnit : 'kg/ha',
      seedTgw: x.seedTgw, seedLot: x.seedLot, seedOrigin: x.seedOrigin, seedTreatment: x.seedTreatment, seedStockItemId: item?.id || ''});
    if (res.error) throw new Error(res.error);
    seed = res.value;
  }
  const sownCulture = sowing && !x.cover ? String(x.culture || '').trim() : '';
  const depth = parseDose(x.depth);
  /** Champs de l'étape 3 communs à la création et à la clôture d'un prévu. @param {any} parcel @param {number} i @param {any} base */
  const extra = (parcel, i, base) => ({
    ...(x.operator !== null && x.operator !== undefined ? {operator: String(x.operator).trim()} : {}),
    ...(ownSurface !== null && ownSurface > 0 ? {surfaceWorked: ownSurface} : {}),
    ...(x.endTime ? {endTime: x.endTime} : {}),
    ...(durations ? {duration: durations[i]} : {}), ...(fuels ? {fuel: fuels[i]} : {}),
    ...(spray && String(x.target || '').trim() ? {target: String(x.target).trim()} : {}),
    ...(spray && String(x.stage || '').trim() ? {stage: String(x.stage).trim()} : {}),
    ...(spray && String(x.productLot || '').trim() ? {productLot: String(x.productLot).trim().slice(0, 60)} : {}),
    ...(spray && fields.product && !base.amm ? (() => { const amm = productFor(data, {product: fields.product}, {catalog})?.sheet?.amm; return amm ? {amm: String(amm)} : {}; })() : {}),
    ...(seed ? {seed} : {}), ...(sownCulture ? {culture: sownCulture} : {}),
    ...(depth !== null && depth > 0 ? {depthCm: depth} : {}),
    ...(x.billable === false && clientOf(parcel) ? {billable: false} : {})
  });
  const skipped = new Set(skip), included = new Set(include);
  const planned = closingCandidates(data, {type, kind, parcelIds: parcels.map(p => p.id), date, today, product: fields.product});
  /** @type {Record<string, any>[]} */
  const creates = [];
  /** @type {Record<string, any>[]} */
  const updates = [];
  /** @type {string[]} */
  const closedOnly = [];
  for (const [index, parcel] of parcels.entries()) {
    const base = buildQuickWork({type, parcel, data, today: date});
    if (kind) { base.kind = kind; if (spray) base.isPhytosanitary = true; else delete base.isPhytosanitary; }
    const equipmentId = draft.equipmentId ?? base.equipmentId;
    const targets = [...planned.works.filter(w => w.parcelId === parcel.id && !skipped.has(w.id)),
      ...planned.looseWorks.filter(w => w.parcelId === parcel.id && included.has(w.id))];
    for (const [i, {overdue: _overdue, ...existing}] of targets.entries()) {
      // Un seul prévu reçoit la saisie : les suivants (retard coché…) sont seulement clos, sans produit ni dose repris,
      // pour ne pas compter deux fois le même passage au registre, à l'azote et aux doses cumulées.
      if (i > 0) {
        updates.push({...existing, status: 'Terminé', plannedDate: existing.plannedDate || existing.date || '', date, campaignId: campaignFor(date), ...(clientOf(parcel) ? {billable: false} : {})});
        closedOnly.push(existing.id);
        continue;
      }
      const note = [String(existing.note || '').trim(), fields.note].filter(Boolean).join(' · ');
      const more = extra(parcel, index, existing);
      updates.push({...existing, status: 'Terminé', plannedDate: existing.plannedDate || existing.date || '', date,
        campaignId: campaignFor(date), culture: existing.culture || parcel.culture || '',
        ...(fields.product ? {product: fields.product} : {}), ...(dose !== null ? {dose, doseUnit: fields.doseUnit} : {}),
        ...(note ? {note} : {}), ...(fields.startTime ? {startTime: fields.startTime} : {}),
        ...(equipmentId ? {equipmentId} : {}), ...(kind ? {kind} : {}), ...(spray ? {isPhytosanitary: true} : {}), ...more,
        actualMetrics: {...existing.actualMetrics, areaHa: more.surfaceWorked ?? existing.surfaceWorked ?? base.surfaceWorked, dose: dose ?? parseDose(existing.dose),
          duration: more.duration ?? existing.actualMetrics?.duration ?? existing.duration ?? null}});
    }
    if (targets.length) continue;
    const work = {...base, ...fields, equipmentId, ...extra(parcel, index, base), status: future ? 'À faire' : 'Terminé', plannedDate: future ? date : ''};
    // Prévu ou réalisé, comme le formulaire complet : la comparaison des prescriptions lit l'un ou l'autre (AT-M4).
    const metrics = {areaHa: work.surfaceWorked ?? null, dose: dose ?? null, duration: work.duration ?? null};
    if (future) { delete work.actualMetrics; work.plannedMetrics = metrics; } else work.actualMetrics = metrics;
    creates.push(work);
  }
  if (creates.length > 1 && batchId) creates.forEach(work => { work.batchId = batchId; });
  // Coût estimé à la saisie (AT-14) : matériel x heures, carburant x prix, intrant du stock x quantité ; jamais un coût saisi.
  if (!future) for (const work of creates) {
    const need = item ? requiredStock({...work, dose: parseDose(work.dose), surfaceWorked: parseDose(work.surfaceWorked)}, item) : null;
    const price = item ? parseDose(item.unitPrice) : null;
    const c = workCosts({...work, inputCost: need !== null && price !== null ? r2(need * price) : ''}, {machines: live(data?.materiels), data: {preferences: data?.preferences || {}}});
    const parts = [['machineCost', 'Matériel', c.machineCost], ['fuelCost', 'Carburant', c.fuelCost], ['inputCost', 'Intrant', c.inputCost]].filter(([, , v]) => v > 0)
      .map(([key, label, value]) => ({key, label: `${label} ${value.toLocaleString('fr-FR', {maximumFractionDigits: 2})} €`, value: r2(value)}));
    if (parts.length) Object.assign(work, estimatedCostPatch(work, {value: parts.reduce((a, p) => a + p.value, 0), method: 'effects', label: 'Saisie rapide', detail: parts.map(p => p.label).join(' + '), parts}, now));
  }
  const tasks = [...planned.tasks.filter(t => !skipped.has(t.id)), ...planned.looseTasks.filter(t => included.has(t.id))].map(t => ({...t, status: 'Terminé'}));
  const written = [...creates, ...updates.filter(w => parcels.some(p => p.id === w.parcelId))];
  const surfaceOf = parcel => parseDose(written.find(w => w.parcelId === parcel.id)?.surfaceWorked) ?? (Number(parcel.surfaceHa) || 0);
  /** @type {Record<string, any>[]} */
  const records = [];
  const existingLots = [];
  // Lot de récolte (AT-02) : seulement terminé et avec une quantité ; jamais un second lot pour la même parcelle et date.
  const quantity = parseDose(x.quantity);
  if (!future && isGrainHarvest(type, kind) && quantity !== null && quantity > 0) {
    const lots = live(data?.integrationImports).filter(r => r.farmKind === 'harvest');
    const fresh = parcels.filter(p => { const lot = lots.find(l => l.parcelId === p.id && String(l.date || '').slice(0, 10) === date); if (lot) existingLots.push({parcel: p, lot}); return !lot; });
    // Parts calculées sur toutes les parcelles : celle qui a déjà son lot garde sa part hors de ce lot.
    const taken = new Set(), shares = shareOut(quantity, parcels.map(surfaceOf), 3);
    fresh.forEach(parcel => {
      const i = parcels.indexOf(parcel);
      const code = harvestLotCode(data, {date, parcel}, taken);
      records.push({farmKind: 'harvest', format: 'Parcelles', recordVersion: 1, name: code, code, date, crop: String(x.culture || '').trim() || cultureFor(data, parcel, campaignFor(date), today) || parcel.culture || '',
        quantity: shares[i], unit: HARVEST_UNITS.includes(x.quantityUnit) ? x.quantityUnit : 't', humidity: parseDose(x.humidity), impurities: parseDose(x.impurities),
        silo: String(x.silo || '').trim(), parcelId: parcel.id, sales: []});
    });
  }
  // Coupe de fourrage (AT-03) : seulement la Fauche, terminée, avec un type et une quantité (validateForage).
  const amount = parseDose(x.forageMode === 'tonnes' ? x.tonnes : x.bales);
  if (!future && isMowCut(type) && forageType(x.forageType) && amount !== null && amount > 0) {
    const shares = shareOut(amount, parcels.map(surfaceOf), x.forageMode === 'tonnes' ? 2 : 0);
    parcels.forEach((parcel, i) => {
      const res = validateForage({entry: 'harvest', type: x.forageType, date, mode: x.forageMode === 'tonnes' ? 'tonnes' : 'bales', [x.forageMode === 'tonnes' ? 'tonnes' : 'bales']: shares[i], parcelId: parcel.id, cut: parseDose(x.cut) || nextCut(data, parcel.id, date)});
      if (res.error || !res.value) return;
      const label = `${forageType(res.value.type)?.label || 'Fourrage'}${res.value.cut ? ` ${res.value.cut}e coupe` : ''}`;
      records.push({farmKind: FORAGE_KIND, format: 'Parcelles', recordVersion: 1, ...res.value, name: `${label} ${res.value.date}`});
    });
  }
  const sown = sowing ? sowingWrites(data, {parcels, culture: String(x.culture || '').trim(), cover: Boolean(x.cover), date, today}) : {rotations: [], parcels: [], changes: [], skipped: []};
  const rotations = [...sown.rotations];
  // Destruction du couvert (AT-12) : cochée, passage terminé.
  if (x.destroyCover && !future) for (const {rotation, ic, mode} of coversToDestroy(data, {type, kind, parcelIds: parcels.map(p => p.id), date})) {
    const interculture = normalizeInterculture({...ic, destructionDate: date, destructionMode: mode});
    const error = intercultureError(interculture);
    if (error) throw new Error(error);
    const same = rotations.find(r => r.parcelId === rotation.parcelId && r.campaignId === rotation.campaignId);
    if (same) same.interculture = interculture; else rotations.push({...rotation, interculture});
  }
  return {creates, updates, tasks, records, rotations, parcels: sown.parcels, changes: sown.changes, existingLots, coverSkipped: sown.skipped, closedOnly};
}

/** Travaux qui portent la saisie (créés et premier prévu clos par parcelle) : seuls comptés au stock, au compteur, au rendement. @param {{creates: any[], updates: any[], closedOnly?: string[]}} result */
export function entryWorks(result) {
  const closed = new Set(result.closedOnly || []);
  return [...result.creates, ...result.updates.filter(w => !closed.has(w.id))];
}

/**
 * Sortie de stock et compteur horaire (AT-10, AT-13), mêmes conditions pour l'aperçu et l'enregistrement.
 * canStock : le rôle écrit le stock et ses mouvements ; canMeter : le rôle écrit le compteur du matériel.
 * x.stockOut et x.meter (cases cochées) ne jouent que sur stockItemId et countMachine.
 * @param {any} result @param {any} data
 * @param {{details?: Record<string, any>, type: string, kind?: string, product?: string, equipmentId?: string, startTime?: string, future?: boolean, canStock?: boolean, canMeter?: boolean}} options
 */
export function quickEffects(result, data, {details = {}, type, kind = '', product = '', equipmentId = '', startTime = '', future = false, canStock = true, canMeter = true}) {
  const x = {...DETAIL_DEFAULTS, ...details};
  const item = !future && canStock ? stockItemFor(data, {type, kind, product}) : null;
  const preview = item ? stockOutPreview(entryWorks(result), item) : null;
  const machine = !future && canMeter && equipmentId ? live(data?.materiels).find(m => m.id === equipmentId) || null : null;
  const hours = parseDose(x.duration) ?? hoursBetween(String(startTime || ''), String(x.endTime || ''));
  // Compteur numérique exigé par applyWorkEffects : un texte « 1234 » ou un champ vide ne s'incrémente pas.
  const meterable = Boolean(machine && hours && typeof machine.currentMeter === 'number' && Number.isFinite(machine.currentMeter) && machine.currentMeter >= 0);
  const stockItemId = preview && !preview.error && !preview.short && x.stockOut ? item.id : '';
  return {item, preview, machine, hours, meterable, stockItemId, countMachine: meterable && Boolean(x.meter)};
}

/**
 * Prestation pour un client facturé seulement à l'heure : la durée est exigée (AT-15).
 * @param {{creates: any[], updates: any[]}} result @param {any} data
 */
export function billingProblem({creates, updates, closedOnly = []}, data) {
  const parcels = new Map(live(data?.parcelles).map(p => [p.id, p])), clients = live(data?.clients);
  const closed = new Set(closedOnly);
  for (const work of [...creates, ...updates]) {
    if (work.status !== 'Terminé' || work.billable === false || closed.has(work.id)) continue;
    const client = clients.find(c => c.id === (work.clientId || parcels.get(work.parcelId)?.clientId));
    if (!client || parseDose(client.hectareRate) > 0 || !(parseDose(client.hourlyRate) > 0)) continue;
    if (!(parseDose(work.duration) > 0)) return `Indiquez la durée (Plus de détails) : ${client.nom || 'ce client'} est facturé à l’heure.`;
  }
  return '';
}

/**
 * Écritures hors des travaux que le rôle ne permet pas (rotation, culture de la parcelle, lots) : retirées avant
 * l'écriture, avec le message à afficher. canWrite : store.writeGuard.
 * @param {any} result @param {(op: any) => boolean} canWrite
 */
export function dropForbidden(result, canWrite) {
  const messages = [];
  const keep = (key, entity, label) => {
    const list = result[key] || [];
    const allowed = list.filter(r => canWrite({entity, action: r.id ? 'update' : 'create', ...(r.farmKind ? {farmKind: r.farmKind} : {})}));
    if (allowed.length < list.length) messages.push(label);
    result[key] = allowed;
  };
  keep('records', 'integrationImports', 'lot de récolte ou de fourrage');
  keep('rotations', 'rotations', 'rotation');
  keep('parcels', 'parcelles', 'culture de la parcelle');
  return messages.length ? `Votre rôle ne permet pas de mettre à jour : ${messages.join(', ')}. À faire par le responsable.` : '';
}

/** Refus avant écriture : un traitement terminé doit nommer son produit. @param {{creates: any[], updates: any[]}} result */
export function quickWorksProblem({creates, updates}) {
  const missing = [...creates, ...updates].some(w => w.status === 'Terminé' && isTreatment(w) && !String(w.product || '').trim());
  return missing ? 'Indiquez le produit : un traitement terminé va au registre phytosanitaire.' : '';
}

/** Un travail enregistré sans dose ? (avertissement seul) @param {{creates: any[], updates: any[]}} result */
export const missingDose = ({creates, updates}) => [...creates, ...updates].some(w => parseDose(w.dose) === null);

/**
 * Contrôle BCAE 8 de chaque fiche (trimCheck). La remarque compte comme le produit du formulaire complet.
 * La dérogation confirmée est posée sur les fiches concernées.
 * @param {{creates: any[], updates: any[]}} result @param {any} data @param {{derogation?: boolean, remark?: string}} [options]
 */
export function hedgeBlock({creates, updates}, data, {derogation = false, remark = ''} = {}) {
  let message = '';
  for (const work of [...creates, ...updates]) {
    const check = trimCheck({...work, product: [work.product, remark].filter(Boolean).join(' '), hedgeDerogation: false}, data);
    if (!check.blocked) continue;
    message = check.message;
    if (derogation) work.hedgeDerogation = true;
  }
  return {message, blocked: Boolean(message) && !derogation};
}

/**
 * Identifiants attribués une seule fois, avant toute écriture : un nouvel essai met à jour au lieu de dupliquer.
 * @param {{creates: any[]}} result @param {Record<string, string>} memo par parcelle @param {() => string} makeId
 */
export function assignWriteIds(result, memo, makeId) {
  for (const work of result.creates) work.id = memo[work.parcelId] ||= makeId();
  for (const record of result.records || []) record.id ||= memo[`${record.farmKind}:${record.parcelId}`] ||= makeId(record.farmKind);
  for (const row of result.rotations || []) row.id ||= memo[`rotation:${row.parcelId}:${row.campaignId}`] ||= makeId('rotation');
  return result;
}

const WRITE_STEPS = [['creates', 'interventions'], ['updates', 'interventions'], ['tasks', 'tasks'], ['records', 'integrationImports'], ['rotations', 'rotations'], ['parcels', 'parcelles']];
/**
 * Écrit les trois lots ; pending.done retient ce qui a réussi, le nouvel essai ne rejoue que le reste.
 * @param {any} store @param {{creates: any[], updates: any[], tasks: any[], done?: string[]}} pending @param {Record<string, string>} labels
 */
export async function writeQuickWorks(store, pending, labels) {
  pending.done ||= [];
  for (const [key, entity] of WRITE_STEPS) {
    if (pending.done.includes(key)) continue;
    if (pending[key]?.length) await store.upsertMany(entity, pending[key], {label: labels[key] || 'Saisie du travail'});
    pending.done.push(key);
  }
  return pending;
}

/** Après un échec : une partie est-elle déjà écrite ? Alors la saisie est figée pour ne pas être reconstruite. @param {any} store @param {any} pending */
export function writesStarted(store, pending) {
  const steps = (pending.done || []).filter(key => pending[key]?.length);
  return steps.length > 0 || pending.creates.some(w => store.get?.('interventions', w.id)) || pending.updates.some(w => store.get?.('interventions', w.id)?.status === 'Terminé');
}

/** Brouillon enregistrable (étapes 2 et 3) : champs simples seulement. @param {any} draft */
export function draftFields(draft) {
  const {type = null, kind = '', parcelIds = [], dateChoice = 'today', customDate = '', product = '', dose = null, doseUnit = '', doseTouched = false, equipmentId = '', note = '', step = 1, startTime = '',
    showTime = false, skip = [], include = [], reason = '', needReason = false, unitTouched = false} = draft || {};
  // Champs de l'étape 3 par famille (valeurs simples) : l'heure et les détails survivent à la reprise.
  const details = draft?.details ? {details: {...DETAIL_DEFAULTS, ...JSON.parse(JSON.stringify(draft.details))}} : {};
  // La saisie d'un pâturage (quick-grazing.js) n'est écrite que pour ce parcours, en données simples.
  const grazing = draft?.grazing ? {grazing: JSON.parse(JSON.stringify(draft.grazing))} : {};
  // Écriture partielle à terminer : conservée pour que la reprise ne recrée rien.
  const pending = draft?.pending ? {pending: JSON.parse(JSON.stringify(draft.pending))} : {};
  // Heure affichée, prévus écartés ou ajoutés, motif de dérogation et unité choisie survivent aussi (PF-13).
  return {type, kind, parcelIds: [...parcelIds], dateChoice, customDate, product, dose, doseUnit, doseTouched, equipmentId, note, step, startTime,
    showTime: Boolean(showTime || startTime), skip: [...skip], include: [...include], reason: String(reason || ''), needReason: Boolean(needReason), unitTouched: Boolean(unitTouched),
    ...details, ...grazing, ...pending};
}

export {defaultsFor};
