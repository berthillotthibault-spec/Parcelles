// Automatisations proposées d'après les gestes répétés (idée 4).
// Module pur : il lit l'historique (travaux terminés, tâches et travaux créés à la main) et repère les
// enchaînements « après un travail A sur une parcelle, vous créez B dans les N jours ». Il ne propose que
// ce qu'une règle personnalisée existante sait reproduire (cible Travaux, action « Créer une tâche ») et
// ce qui n'est pas déjà couvert par une règle. Il n'écrit rien : l'écran des automatisations propose,
// l'utilisateur confirme (« Créer la règle ») ou écarte (« Non merci », mémorisé dans les préférences).
import {campaignFor, localIso, normalize} from './utils.js';
import {CANCELLED} from './pilotage.js';
import {newAutomationFromTemplate} from './automations.js';

export const GESTURE_DEFAULTS = Object.freeze({windowDays: 14, minOccurrences: 3, minCampaigns: 2, minRatio: 0.5, max: 3});
export const GESTURE_PREF = 'gestureRuleDismissed';
// Délai de l'enchaînement réglable dans l'écran Automatisations (préférence de l'appareil, non synchronisée).
export const GESTURE_WINDOW_PREF = 'gestureWindowDays';
export const GESTURE_WINDOWS = Object.freeze([7, 14, 21, 30]);
/** Délai retenu : la préférence si elle fait partie des choix proposés, sinon 14 jours. */
export const gestureWindowDays = preferences => {
  const n = Number(preferences?.[GESTURE_WINDOW_PREF]);
  return GESTURE_WINDOWS.includes(n) ? n : GESTURE_DEFAULTS.windowDays;
};
const DONE = ['Terminé', 'Terminée'];
const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const live = (state, type) => (Array.isArray(state?.[type]) ? state[type] : []).filter(x => x && !x.deletedAt);
// Jour civil local : une date « AAAA-MM-JJ » est gardée telle quelle, un horodatage (createdAt) est lu à l'heure locale
// (isoDate passe par l'UTC et donnerait la veille pour une saisie entre minuit et 2 h).
const day = value => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && ISO.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : localIso(d);
};
const dayMs = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const between = (from, to) => Math.round((dayMs(to) - dayMs(from)) / DAY);
const median = list => {
  const s = [...list].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const manual = x => x.source !== 'automation' && !x.automationRuleId;

/** Clé stable d'un enchaînement (sert à « Non merci » et à reconnaître la règle créée). */
export const gestureKey = (from, to) => `${normalize(from)}>${normalize(to)}`;

/** Gestes « conséquence » créés à la main : tâches (titre) et travaux (type), avec leur jour de création et d'échéance. */
function followUps(state) {
  const rows = [];
  for (const t of live(state, 'tasks')) {
    if (!manual(t) || CANCELLED.includes(t.status) || !t.parcelId || !String(t.title || '').trim()) continue;
    const created = day(t.createdAt) || day(t.dueDate);
    if (created) rows.push({id: t.id, kind: 'task', label: String(t.title).trim(), parcelId: t.parcelId, created, due: day(t.dueDate) || created});
  }
  for (const w of live(state, 'interventions')) {
    if (!manual(w) || CANCELLED.includes(w.status) || !w.parcelId || !String(w.type || '').trim()) continue;
    const created = day(w.createdAt) || day(w.plannedDate || w.date);
    if (created) rows.push({id: w.id, kind: 'work', label: String(w.type).trim(), parcelId: w.parcelId, created, due: day(w.plannedDate || w.date) || created});
  }
  return rows;
}

/** Une règle couvre déjà l'enchaînement si elle porte sa clé, ou si elle vise les travaux de type A et crée une tâche. */
export function isCovered(rules, from, to) {
  const key = gestureKey(from, to), a = normalize(from);
  return (Array.isArray(rules) ? rules : []).filter(r => r && !r.deletedAt).some(r => {
    if (r.gestureKey === key) return true;
    if (r.target !== 'interventions') return false;
    const createsTask = (r.actions || []).some(x => x?.type === 'create_task');
    const onType = (r.conditions || []).some(c => c?.field === 'type' && ['eq', 'contains'].includes(c.operator || 'eq') && normalize(c.value) &&
      (c.operator === 'contains' ? a.includes(normalize(c.value)) : a === normalize(c.value)));
    return createsTask && onType;
  });
}

/**
 * Enchaînements répétés. Pour chaque travail terminé A (type, parcelle, date de réalisation), on cherche une tâche ou
 * un travail B créé à la main sur la même parcelle dans les `windowDays` jours qui suivent. Un enchaînement est retenu
 * s'il s'observe au moins `minOccurrences` fois, sur `minCampaigns` campagnes, et après au moins `minRatio` des A.
 * `windowDays` vient de preferences.gestureWindowDays (7, 14, 21 ou 30), sauf s'il est passé dans options.
 */
export function detectGestures(state, options = {}) {
  const o = {...GESTURE_DEFAULTS, windowDays: gestureWindowDays(state?.preferences), ...options};
  const dismissed = new Set(Array.isArray(state?.preferences?.[GESTURE_PREF]) ? state.preferences[GESTURE_PREF] : []);
  const rules = live(state, 'automationRules');
  const sources = live(state, 'interventions').filter(w => DONE.includes(w.status) && w.parcelId && String(w.type || '').trim() && day(w.date));
  const after = followUps(state);
  const totals = new Map(), pairs = new Map();
  for (const a of sources) {
    const aKey = normalize(a.type), aDay = day(a.date);
    totals.set(aKey, (totals.get(aKey) || 0) + 1);
    const seen = new Set();
    for (const b of after) {
      if (b.id === a.id || b.parcelId !== a.parcelId) continue;
      const gap = between(aDay, b.created);
      if (gap < 0 || gap > o.windowDays) continue;
      const key = gestureKey(a.type, b.label);
      if (normalize(b.label) === aKey || seen.has(key)) continue;
      const p = pairs.get(key) || {key, from: String(a.type).trim(), to: b.label, fromKey: aKey, occurrences: 0,
        campaigns: new Set(), delays: [], parcels: new Set(), kinds: new Set(), used: new Set()};
      // Un même B ne compte qu'une fois : deux passages de A rapprochés suivis d'une seule tâche ne font pas deux gestes.
      if (p.used.has(`${b.kind}:${b.id}`)) continue;
      seen.add(key); p.used.add(`${b.kind}:${b.id}`);
      p.occurrences += 1; p.campaigns.add(campaignFor(aDay)); p.parcels.add(a.parcelId); p.kinds.add(b.kind);
      p.delays.push(Math.max(0, Math.min(365, between(aDay, b.due))));
      pairs.set(key, p);
    }
  }
  return [...pairs.values()]
    .map(({used, ...p}) => ({...p, total: totals.get(p.fromKey) || p.occurrences,
      campaigns: [...p.campaigns].sort(), parcels: p.parcels.size, kinds: [...p.kinds],
      dueOffsetDays: median(p.delays), windowDays: o.windowDays}))
    .filter(p => p.occurrences >= o.minOccurrences && p.campaigns.length >= o.minCampaigns && p.occurrences / p.total >= o.minRatio)
    .filter(p => !dismissed.has(p.key) && !isCovered(rules, p.from, p.to))
    .sort((x, y) => y.occurrences - x.occurrences || y.occurrences / y.total - x.occurrences / x.total || x.key.localeCompare(y.key))
    .slice(0, o.max);
}

/** Phrase « pourquoi » : données utilisées et nombre d'observations. */
export function gestureReason(g) {
  const what = g.kinds.length === 1 ? (g.kinds[0] === 'task' ? 'une tâche' : 'un travail') : 'une tâche ou un travail';
  const delay = g.dueOffsetDays === 0 ? 'pour le jour même' : `pour J+${g.dueOffsetDays} (médiane)`;
  return `Après ${g.occurrences} des ${g.total} « ${g.from} » terminés (${g.campaigns.length} campagnes : ${g.campaigns.join(', ')}, `
    + `${g.parcels} ${g.parcels > 1 ? 'parcelles' : 'parcelle'}), vous avez créé ${what} « ${g.to} » dans les ${g.windowDays} jours, ${delay}.`;
}

/** Règle personnalisée qui reproduit l'enchaînement : le jour où un travail A est terminé, créer la tâche B sur la parcelle. */
export function gestureRule(g) {
  const rule = newAutomationFromTemplate({
    kind: 'custom', name: `Après ${g.from} → ${g.to}`.slice(0, 120), target: 'interventions', trigger: 'entity_change', triggerEntity: 'interventions',
    matchMode: 'all', cooldownHours: 1, maxMatches: 20,
    conditions: [
      {field: 'type', operator: 'eq', value: g.from},
      {field: 'status', operator: 'contains', value: 'Termin'},
      {field: 'date', operator: 'on_today', value: ''}
    ],
    actions: [{type: 'create_task', titleTemplate: `${g.to} (après {label})`.slice(0, 160), dueOffsetDays: g.dueOffsetDays, priority: 'Normale'}]
  });
  return {...rule, gestureKey: g.key};
}

/** Nouvelle liste des enchaînements écartés (« Non merci »), bornée à 100 clés. */
export function dismissGesture(preferences, key) {
  const list = Array.isArray(preferences?.[GESTURE_PREF]) ? preferences[GESTURE_PREF].filter(x => typeof x === 'string' && x !== key) : [];
  return [...list, String(key)].slice(-100);
}
