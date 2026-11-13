// Retour de l’utilisateur sur le fil « À décider » : « Fait », « Plus tard », « Pas pertinent ».
// Module pur : il calcule un nouvel objet de retour (rangé dans preferences.decisionFeedback, propre à
// l’appareil, jamais synchronisé) et l’applique au fil. Il n’écrit rien lui-même.
//
// Forme : {items: {<id décision>: {verdict, at, until, level}}, kinds: {<kind>: {no: [dates], done: [dates]}}}
// - une carte écartée disparaît jusqu’à `until`, sauf si elle devient plus grave entre-temps ;
// - « Pas pertinent » répété sur un même type d’alerte abaisse son rang (jamais pour une alerte urgente) ;
// - « Fait » répété le relève un peu. Les dates de plus de 90 jours sont oubliées.

export const FEEDBACK_VERDICTS = Object.freeze(['done', 'later', 'no']);
const GRAVITY = {urgent: 3, warning: 2, info: 1};
const HIDE_DAYS = {done: 7, no: 14};
const MEMORY_DAYS = 90, MAX_ITEMS = 200, MAX_DATES = 20;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const dayMs = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** Date ISO décalée de n jours (calcul UTC, sans effet de l’heure d’été). */
export function addDays(iso, n) {
  return new Date(dayMs(iso) + n * 86400000).toISOString().slice(0, 10);
}
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const dates = list => Array.isArray(list) ? list.filter(d => typeof d === 'string' && ISO.test(d)) : [];

/** Retour normalisé et purgé (cartes échues, dates de plus de 90 jours). Accepte n’importe quelle valeur. */
export function normalizeFeedback(raw, {today} = {}) {
  const src = isRecord(raw) ? raw : {}, items = {}, kinds = {};
  const oldest = today && ISO.test(today) ? addDays(today, -MEMORY_DAYS) : '';
  const recentItems = Object.entries(isRecord(src.items) ? src.items : {})
    .filter(([id, v]) => id && isRecord(v) && FEEDBACK_VERDICTS.includes(v.verdict) && ISO.test(String(v.until || '')) && (!today || v.until > today))
    .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || ''))).slice(0, MAX_ITEMS);
  for (const [id, v] of recentItems) items[id] = {verdict: v.verdict, at: ISO.test(String(v.at || '')) ? v.at : v.until, until: v.until, level: GRAVITY[v.level] ? v.level : 'info'};
  for (const [kind, v] of Object.entries(isRecord(src.kinds) ? src.kinds : {})) {
    if (!kind || !isRecord(v)) continue;
    const keep = list => dates(list).filter(d => d > oldest).sort().slice(-MAX_DATES);
    const no = keep(v.no), done = keep(v.done);
    if (no.length || done.length) kinds[kind] = {no, done};
  }
  return {items, kinds};
}

/** « Plus tard » : 1 jour si l’alerte est urgente ou l’échéance à 2 jours ou moins, 3 jours sinon. */
export function laterDays(decision) {
  const left = decision?.stakes?.daysLeft, n = Number(left);
  return decision?.level === 'urgent' || (left !== null && left !== undefined && left !== '' && Number.isFinite(n) && n <= 2) ? 1 : 3;
}

/** Enregistre un verdict sur une décision du fil ({id, kind, level, stakes}). Renvoie un nouvel objet de retour. */
export function recordFeedback(raw, decision, verdict, {today} = {}) {
  if (!decision?.id || !FEEDBACK_VERDICTS.includes(verdict) || !ISO.test(String(today || ''))) throw new Error('Retour sur la décision invalide.');
  const next = normalizeFeedback(raw, {today});
  const level = GRAVITY[decision.level] ? decision.level : 'info';
  const days = verdict === 'later' ? laterDays(decision) : HIDE_DAYS[verdict];
  next.items[String(decision.id)] = {verdict, at: today, until: addDays(today, days), level};
  if (verdict !== 'later' && decision.kind) {
    const k = next.kinds[decision.kind] || {no: [], done: []};
    k[verdict] = [...k[verdict], today].slice(-MAX_DATES);
    next.kinds[decision.kind] = k;
  }
  return next;
}

/** Retire la carte des cartes écartées. */
export function forgetDecision(raw, id, {today} = {}) {
  const next = normalizeFeedback(raw, {today});
  delete next.items[String(id)];
  return next;
}

/** Vrai si ce verdict est déjà enregistré aujourd’hui pour cette carte (double appui). */
export function alreadyRecorded(raw, id, verdict, {today} = {}) {
  const item = normalizeFeedback(raw, {today}).items[String(id)];
  return Boolean(item && item.verdict === verdict && item.at === today);
}

/**
 * « Annuler » d’un seul verdict : retire la carte et la date ajoutée pour son type, sans toucher
 * aux autres retours donnés entre-temps.
 */
export function undoFeedback(raw, decision, verdict, {today} = {}) {
  const next = forgetDecision(raw, decision?.id, {today});
  const k = next.kinds[decision?.kind];
  if (k && (verdict === 'no' || verdict === 'done')) {
    const i = k[verdict].lastIndexOf(today);
    if (i >= 0) k[verdict].splice(i, 1);
    if (!k.no.length && !k.done.length) delete next.kinds[decision.kind];
  }
  return next;
}

/** Réaffiche toutes les cartes écartées ; l’apprentissage par type est conservé. */
export function unhideAll(raw, {today} = {}) {
  return {...normalizeFeedback(raw, {today}), items: {}};
}

/** « Annuler » du réaffichage : remet les cartes masquées d’avant, sans écraser un retour donné depuis. */
export function restoreHidden(raw, previous, {today} = {}) {
  const next = normalizeFeedback(raw, {today});
  return {...next, items: {...normalizeFeedback(previous, {today}).items, ...next.items}};
}

/**
 * Coefficient de rang d’un type d’alerte : 1 - 0,2 par « Pas pertinent » au-delà du premier (plancher 0,4),
 * puis + 0,1 par « Fait » (plafond 1,3). Les alertes urgentes ne sont jamais abaissées.
 */
export function kindWeight(raw, kind, level = 'info', {today} = {}) {
  const k = normalizeFeedback(raw, {today}).kinds[kind];
  if (!k) return {factor: 1, no: 0, done: 0};
  const no = k.no.length, done = k.done.length;
  const penalty = level === 'urgent' || no < 2 ? 1 : Math.max(0.4, 1 - 0.2 * (no - 1));
  const boost = Math.min(1.3, 1 + 0.1 * done);
  return {factor: Math.round(penalty * boost * 100) / 100, no, done};
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/**
 * Applique le retour au fil déjà classé : masque les cartes écartées (sauf aggravation), ajuste les scores
 * par type d’alerte, l’explique dans « Pourquoi ? » et reclasse. Renvoie {rows, hidden}.
 */
export function applyFeedback(rows, raw, {today} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const fb = normalizeFeedback(raw, {today});
  if (!Object.keys(fb.items).length && !Object.keys(fb.kinds).length) return {rows: list, hidden: 0};
  let hidden = 0;
  const out = [];
  for (const row of list) {
    const item = fb.items[row.id];
    if (item && (GRAVITY[row.level] || 1) <= (GRAVITY[item.level] || 1)) {hidden++; continue;}
    const w = kindWeight(fb, row.kind, row.level, {today});
    if (w.factor === 1) {out.push(row); continue;}
    const why = [...(row.why || [])];
    if (w.factor < 1) why.push(`Rang abaissé : vous avez jugé ce type d’alerte non pertinent ${plural(w.no, 'fois', 'fois')} ces 3 derniers mois.`);
    else why.push(`Rang relevé : vous avez traité ce type d’alerte ${plural(w.done, 'fois', 'fois')} ces 3 derniers mois.`);
    out.push({...row, why, score: row.score * w.factor});
  }
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {rows: out, hidden};
}

/** « 1 alerte masquée » / « 3 alertes masquées ». */
export function hiddenLabel(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  return count > 1 ? `${count} alertes masquées` : `${count} alerte masquée`;
}
