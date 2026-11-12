// Fil « À décider » de l’accueil : une seule liste, classée par enjeu (hectares, euros, délai).
// Module pur : il lit l’état et des sources déjà calculées, il n’écrit jamais. Chaque entrée
// porte une action (bouton délégué d’app.js) qui ouvre un écran ou un formulaire : rien n’est
// enregistré sans un geste explicite de l’utilisateur.
import {localIso} from './utils.js';
import {computeNotifications} from './notifications.js';
import {complianceChecks} from './compliance.js';
import {evaluateAgroRisks} from './agro-risk.js';
import {nitrogenAlerts} from './nitrogen.js';
import {explainNotification} from './explain-model.js';
import {orderTaskDraft} from './input-needs.js';

export const GRAVITY = Object.freeze({urgent: 3, warning: 2, info: 1});
// Actions autorisées : toutes ouvrent un écran ou un formulaire, aucune n’enregistre seule. open-compliance
// (modules-actions.js), edit-work, open-rotations et open-herd-animal (actions des conseils W2) sont déjà routées.
export const DECISION_ACTIONS = Object.freeze(['finish-work', 'postpone-work', 'open-parcel', 'stock-movement', 'open-treasury', 'move-grazing', 'notification-open', 'create-task-prefill', 'open-compliance', 'edit-work', 'open-rotations', 'open-herd-animal']);
// Entités que notification-open sait ouvrir (today-actions.js, openNotificationEntity).
const OPENABLE = new Set(['tasks', 'interventions', 'materiels', 'regulated', 'stockItems', 'grazingSessions', 'observations', 'weather', 'sync', 'backup', 'parcelComments']);

const num = value => {const n = Number(value); return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;};
const round = (value, digits = 0) => value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const dayMs = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const ISO = /^\d{4}-\d{2}-\d{2}/;
/** Jours entre aujourd’hui et une date ISO (négatif si dépassée), null si la date manque. */
export function daysUntil(date, today) {
  if (!ISO.test(String(date || '')) || !ISO.test(String(today || ''))) return null;
  return Math.round((dayMs(String(date).slice(0, 10)) - dayMs(String(today).slice(0, 10))) / 86400000);
}
const active = (state, type) => (state?.[type] || []).filter(x => x && !x.deletedAt);
const find = (state, type, id) => id ? active(state, type).find(x => x.id === id) || null : null;
const parcelHa = (state, id) => num(find(state, 'parcelles', id)?.surfaceHa);
const text = value => String(value ?? '').trim();
const whyList = (...lists) => [...new Set(lists.flat().map(text).filter(Boolean))];
const levelOf = level => GRAVITY[level] ? level : 'info';
const frNum = (value, digits = 1) => String(round(value, digits)).replace('.', ',');

/** Coefficient d’urgence selon le délai en jours (null : pas de date, coefficient neutre). */
export function urgency(daysLeft) {
  const d = num(daysLeft);
  if (d === null) return 1;
  return d <= 0 ? 3 : d <= 2 ? 2.5 : d <= 7 ? 1.8 : d <= 30 ? 1.2 : 1;
}

/** Score = gravité × (1 + log10(1 + ha)) × (1 + €/1000) × urgence. ha et € absents comptent pour 0. */
export function scoreDecision({gravity = 1, ha = null, eur = null, daysLeft = null} = {}) {
  const h = Math.max(0, num(ha) ?? 0), e = Math.max(0, num(eur) ?? 0);
  return (num(gravity) ?? 1) * (1 + Math.log10(1 + h)) * (1 + e / 1000) * urgency(daysLeft);
}

function decision({id, kind, title, why, level, ha = null, eur = null, daysLeft = null, action, key = null}) {
  const lvl = levelOf(level), stakes = {ha: round(num(ha), 1), eur: round(num(eur)), daysLeft: num(daysLeft)};
  return {id: String(id), kind, title: text(title) || 'À vérifier', why: why.length ? why : ['Signalé par l’application.'], stakes,
    score: scoreDecision({gravity: GRAVITY[lvl], ...stakes}), level: lvl, action, key};
}

const NOTIF_KINDS = {interventions: 'work', tasks: 'task', stockItems: 'stock', grazingSessions: 'grazing', materiels: 'maintenance', observations: 'observation', regulated: 'deadline', parcelComments: 'comments', sync: 'sync', backup: 'backup'};

/** Notification (computeNotifications, conseils compris) vers décision. */
export function fromNotification(n, state = {}, {today = localIso()} = {}) {
  if (!n?.id) return null;
  const entity = n.entity || '', item = n.entityId ? find(state, entity, n.entityId) : null;
  const parcelId = n.parcelId || item?.parcelId || null;
  const ha = entity === 'interventions' ? (num(item?.surfaceWorked) ?? parcelHa(state, parcelId))
    : entity === 'tasks' ? ((item?.parcelIds || []).reduce((s, id) => s + (parcelHa(state, id) ?? 0), 0) || parcelHa(state, parcelId))
    : parcelHa(state, parcelId);
  // Le message est déjà dans le titre des alertes simples : il ne sert de « pourquoi » qu’à défaut d’autre explication.
  let why = whyList(Array.isArray(n.why) ? n.why : []);
  if (!why.length || n.action) why = whyList(why, n.message);
  if (!why.length) {try {why = whyList(explainNotification(state, n.id, {today}).why || []);} catch {}}
  const given = n.action && DECISION_ACTIONS.includes(n.action.type) ? n.action : null;
  const action = given ? {type: given.type, label: given.label || 'Voir', id: given.id ?? n.entityId ?? '', payload: given.payload ?? null}
    : entity === 'stockItems' ? {type: 'stock-movement', label: 'Mouvement de stock', id: n.entityId, payload: null}
    : entity === 'grazingSessions' ? {type: 'move-grazing', label: 'Changer de parcelle', id: n.entityId, payload: null}
    : entity === 'parcelles' && n.entityId ? {type: 'open-parcel', label: 'Voir la parcelle', id: n.entityId, payload: null}
    : entity === 'animals' && n.entityId ? {type: 'open-herd-animal', label: 'Ouvrir la fiche', id: n.entityId, payload: null}
    : {type: 'notification-open', label: 'Ouvrir', id: n.entityId || '', payload: {entity: OPENABLE.has(entity) ? entity : 'regulated'}};
  const kind = n.rule ? `advice-${n.rule}` : NOTIF_KINDS[entity] || entity || 'notification';
  // Conseil (action fournie) : son titre suffit. Alerte simple : « Travail en retard : Semis ».
  const title = n.title && n.message && !n.action ? `${n.title} : ${n.message}` : n.title || n.message;
  return decision({id: n.id, kind, title, why, level: n.level, ha, eur: n.eur ?? null, daysLeft: daysUntil(n.date, today), action, key: n.entityId || parcelId});
}

/** Voyant de conformité (statut ko ou warn) vers décision ; les autres statuts sont ignorés. */
export function fromCompliance(c) {
  if (!c?.id || (c.status !== 'ko' && c.status !== 'warn')) return null;
  return decision({id: `compliance-${c.id}`, kind: 'compliance', title: c.label, why: whyList(c.detail, c.hint), level: c.status === 'ko' ? 'urgent' : 'warning',
    action: {type: 'open-compliance', label: c.status === 'ko' ? 'Corriger' : 'Vérifier', id: c.id, payload: null}, key: `compliance-${c.id}`});
}

/** Point bas de trésorerie négatif ou sous la réserve (preferences.treasury.reserve). */
export function fromTreasury(f, {today = localIso(), reserve = null} = {}) {
  const low = f?.low;
  if (!low || f.openingMissing) return null;
  const min = num(reserve), negative = low.balance < 0;
  if (!negative && !(min !== null && min > 0 && low.balance < min)) return null;
  const gap = negative ? -low.balance : min - low.balance, eur = (n => `${Math.round(n).toLocaleString('fr-FR')} €`);
  const why = [negative ? `Solde prévu au plus bas en ${low.label} : ${eur(low.balance)}.` : `Solde prévu au plus bas en ${low.label} : ${eur(low.balance)}, sous la réserve de ${eur(min)}.`];
  if (low.nextIncome) why.push(`Prochaine rentrée attendue : ${low.nextIncome.line} (${eur(low.nextIncome.amount)}) en ${low.nextIncome.label}.`);
  const days = daysUntil(`${low.key}-01`, today);
  return decision({id: 'treasury-low', kind: 'treasury-low', title: negative ? 'Trésorerie négative prévue' : 'Trésorerie sous la réserve', why,
    level: negative ? 'urgent' : 'warning', eur: gap, daysLeft: days === null ? null : Math.max(0, days), action: {type: 'open-treasury', label: 'Voir la trésorerie', id: '', payload: null}, key: 'treasury'});
}

/** Besoin en intrants (input-needs.js) vers décision « stock-shortfall ». */
export function fromInputNeed(n, {today = localIso()} = {}) {
  if (!n?.itemId) return null;
  const ha = (n.works || []).reduce((s, w) => s + (num(w.surfaceHa) ?? 0), 0);
  const short = num(n.shortfall) > 0, name = n.name || 'produit';
  const why = whyList(n.why || [], short ? `Manque ${frNum(num(n.shortfall), 2)} ${n.unit || ''} de ${name} pour les travaux prévus.` : '');
  // Un besoin peut venir d’une AMM retirée ou d’un lot périmé sans manque de quantité : le titre le dit.
  const title = short ? `Stock insuffisant : ${name}` : n.ammWithdrawn ? `AMM retirée : ${name}` : `Lot périmé avant emploi : ${name}`;
  return decision({id: n.id || `stock-shortfall-${n.itemId}`, kind: 'stock-shortfall', title, why, level: n.level || 'warning',
    // Manque de quantité : tâche « Commander … » préremplie (create-task-prefill, today-actions.js) ; sinon le stock.
    ha: ha || null, eur: n.valueEur, daysLeft: daysUntil(n.firstShortDate, today), key: n.itemId,
    action: short ? {type: 'create-task-prefill', label: 'Préparer la commande', id: n.itemId, payload: orderTaskDraft(n, {today})} : {type: 'stock-movement', label: 'Voir le stock', id: n.itemId, payload: null}});
}

/** Dérive de coût d’un poste (cost-drift.js) : enjeu = (€/ha − référence) × surface. */
export function fromCostDrift(d) {
  if (!d?.parcelId) return null;
  const delta = (num(d.eurPerHa) ?? 0) - (num(d.refEurPerHa) ?? 0), surface = num(d.surfaceHa);
  const eur = surface === null ? null : Math.max(0, delta * surface), pct = num(d.deltaPct);
  const why = whyList(Array.isArray(d.why) ? d.why : [d.why], `${d.post || 'Poste'} : ${Math.round(num(d.eurPerHa) ?? 0)} €/ha contre ${Math.round(num(d.refEurPerHa) ?? 0)} €/ha de référence${pct === null ? '' : ` (+${Math.round(pct * 100)} %)`}.`);
  return decision({id: `cost-drift-${d.parcelId}-${d.post || ''}`, kind: 'cost-drift', title: `${d.parcelName || 'Parcelle'} : coûts au-dessus de la référence`, why,
    level: 'info', ha: surface, eur, action: {type: 'open-parcel', label: 'Voir la parcelle', id: d.parcelId, payload: null}, key: d.parcelId});
}

/** Conseil de rotation du pâturage (grazing-rotation.js) : seulement à 3 jours d’herbe ou moins. */
export function fromGrazing(g, state = {}) {
  const left = num(g?.daysLeft);
  if (!g?.sessionId || left === null || left > 3) return null;
  const next = g.next?.[0], rest = num(next?.restDays);
  // daysLeft vient d’un calcul au demi-jour (2,5) : affichage avec virgule, délai arrondi au jour inférieur.
  const why = whyList(g.why || [], `Environ ${frNum(left)} jour${left >= 2 ? 's' : ''} d’herbe sur ${g.parcelName || 'la parcelle'} (confiance ${g.confidence || 'basse'}).`,
    next ? `Paddock suivant proposé : ${next.parcelName || 'parcelle'}${rest === null ? '' : ` (${rest} j de repos)`}.` : '');
  return decision({id: `grazing-move-${g.sessionId}`, kind: 'grazing-move', title: `Déplacer le lot : ${g.parcelName || 'parcelle'}`, why, level: g.level || (left <= 1 ? 'urgent' : 'warning'),
    ha: parcelHa(state, g.parcelId), daysLeft: Math.floor(left), action: {type: 'move-grazing', label: 'Changer de parcelle', id: g.sessionId, payload: null}, key: g.parcelId || g.sessionId});
}

function fromAgroRisk(a, state) {
  if (!a?.id) return null;
  return decision({id: `agro-${a.id}`, kind: `agro-${a.kind || 'risk'}`, title: a.title || a.label, why: whyList(a.message, a.data, a.rule), level: a.level === 'risque' ? 'warning' : 'info',
    ha: parcelHa(state, a.parcelId), action: a.parcelId ? {type: 'open-parcel', label: 'Voir la parcelle', id: a.parcelId, payload: null} : {type: 'notification-open', label: 'Météo', id: '', payload: {entity: 'weather'}}, key: a.parcelId});
}

function fromNitrogen(a, state, i) {
  const id = `nitrogen-${a.kind || 'alert'}-${a.workId || a.parcelId || i}`;
  return decision({id, kind: `nitrogen-${a.kind || 'alert'}`, title: a.label, why: whyList(a.note), level: a.status === 'ko' ? 'urgent' : 'warning',
    ha: a.workId ? (num(find(state, 'interventions', a.workId)?.surfaceWorked) ?? parcelHa(state, a.parcelId)) : parcelHa(state, a.parcelId),
    action: a.workId ? {type: 'notification-open', label: 'Voir le travail', id: a.workId, payload: {entity: 'interventions'}} : {type: 'open-compliance', label: 'Voir', id: 'nitrogen', payload: null}, key: a.workId || a.parcelId || id});
}

// Point du matin (morning-brief.js, items injectés) : seules les phrases qui appellent une décision sur un
// travail du jour ou du lendemain (créneau de traitement absent, sol humide, portance limite, type de
// fertilisant à préciser en zone vulnérable). Épandage interdit et délai avant récolte viennent déjà des conseils.
const BRIEF_KINDS = {'spray-none': 'postpone-work', 'spray-watch': 'edit-work', 'soil-wet': 'postpone-work', 'soil-limit': 'edit-work', 'zv-check': 'edit-work'};
export function fromBrief(item, state = {}, {today = localIso()} = {}) {
  const type = BRIEF_KINDS[item?.kind];
  if (!type || !item.workId || !item.text) return null;
  const label = type === 'postpone-work' ? 'Reporter' : item.kind === 'zv-check' ? 'Préciser le produit' : 'Modifier';
  return decision({id: `brief-${item.kind}-${item.workId}`, kind: `brief-${item.kind}`, title: item.text, why: ['Point du matin : rapprochement du planning et des conditions du jour (indicatif).'],
    level: item.level, ha: num(find(state, 'interventions', item.workId)?.surfaceWorked) ?? parcelHa(state, item.parcelId), daysLeft: daysUntil(item.day, today),
    action: {type, label, id: item.workId, payload: null}, key: item.workId});
}

const safe = (fn, fallback = []) => {try {return fn() ?? fallback;} catch {return fallback;}};

/** Fusionne les entrées de même clé (entité ou parcelle) et de même kind. */
function merge(into, other) {
  into.why = whyList(into.why, other.why);
  const sum = (a, b) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  into.stakes = {ha: into.stakes.ha ?? other.stakes.ha, eur: into.kind === 'cost-drift' ? sum(into.stakes.eur, other.stakes.eur) : (into.stakes.eur ?? other.stakes.eur),
    daysLeft: into.stakes.daysLeft === null ? other.stakes.daysLeft : other.stakes.daysLeft === null ? into.stakes.daysLeft : Math.min(into.stakes.daysLeft, other.stakes.daysLeft)};
  if (GRAVITY[other.level] > GRAVITY[into.level]) into.level = other.level;
  into.score = scoreDecision({gravity: GRAVITY[into.level], ...into.stakes});
}

/**
 * Fil « À décider ». Sources internes recalculées (sauf si fournies dans options pour les tests :
 * notifications, compliance, treasury) et sources injectées (inputNeeds, costDrifts, grazingAdvice, morning :
 * items de briefing() de morning-brief.js).
 * treasuryForecast : fonction de treasury.js, injectée car ce module est chargé à la demande (pas au démarrage).
 */
export function decisionFeed(state, {today = localIso(), now = Date.now(), weather = null, inputNeeds = [], costDrifts = [], grazingAdvice = [], morning = [], limit = 7,
  notifications = null, compliance = null, treasury = null, treasuryForecast = null} = {}) {
  if (!state) return [];
  const rows = [];
  const push = list => {for (const d of list) if (d) rows.push(d);};
  push(safe(() => notifications || computeNotifications(state, {now, today})).map(n => safe(() => fromNotification(n, state, {today}), null)));
  push(safe(() => compliance || complianceChecks(state, {today})).map(c => safe(() => fromCompliance(c), null)));
  push([safe(() => fromTreasury(treasury || treasuryForecast?.(state, {start: today.slice(0, 7)}), {today, reserve: state.preferences?.treasury?.reserve}), null)]);
  if (weather) push(safe(() => evaluateAgroRisks(state, weather, {now})).map(a => safe(() => fromAgroRisk(a, state), null)));
  push(safe(() => nitrogenAlerts(state, {today}).alerts).map((a, i) => safe(() => fromNitrogen(a, state, i), null)));
  push((inputNeeds || []).map(n => safe(() => fromInputNeed(n, {today}), null)));
  push((costDrifts || []).map(d => safe(() => fromCostDrift(d), null)));
  push((grazingAdvice || []).map(g => safe(() => fromGrazing(g, state), null)));
  push((Array.isArray(morning) ? morning : morning?.items || []).map(m => safe(() => fromBrief(m, state, {today}), null)));
  // 1. Même id : la première occurrence l’emporte. 2. Même clé + même kind (stock et stock-shortfall comptent pour un) : les why fusionnent.
  const seen = new Set(), byKey = new Map(), out = [];
  for (const d of rows) {
    if (!DECISION_ACTIONS.includes(d.action?.type) || seen.has(d.id)) continue;
    seen.add(d.id);
    // « Stock faible » (notification) et besoin en intrants du même article : une seule carte, celle du besoin (commande préparée).
    // Épandage interdit : conseil R12 (calendrier national) et alerte azote du même travail ne font qu’une carte.
    const k = d.key ? `${d.key}|${d.kind === 'stock' ? 'stock-shortfall' : d.kind === 'nitrogen-ban' || d.id.startsWith('advice-R12-') ? 'zv-ban' : d.kind}` : null;
    if (k && byKey.has(k)) {
      const prev = byKey.get(k);
      if (prev.kind === 'stock' && d.kind === 'stock-shortfall') {merge(d, prev); out[out.indexOf(prev)] = d; byKey.set(k, d);} else merge(prev, d);
      continue;
    }
    if (k) byKey.set(k, d);
    out.push(d);
  }
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, Math.max(0, Number(limit) || 0)).map(({key, ...d}) => d);
}

/** « À décider (3) ». */
export function decisionCountLabel(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  return `À décider (${count})`;
}

/** Ligne d’enjeux : « 30 ha · ≈ 520 € · J-2 » (éléments absents omis). */
export function stakesLabel(stakes = {}) {
  const parts = [], ha = num(stakes.ha), eur = num(stakes.eur), d = num(stakes.daysLeft);
  if (ha) parts.push(`${String(round(ha, 1)).replace('.', ',')} ha`);
  if (eur) parts.push(`≈ ${Math.round(eur).toLocaleString('fr-FR')} €`);
  if (d !== null) {const day = Math.floor(d); parts.push(day < 0 ? `retard ${-day} j` : day === 0 ? 'aujourd’hui' : `J-${day}`);}
  return parts.join(' · ');
}
