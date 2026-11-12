// Mémoire des corrections de l’utilisateur (logique pure, sans écriture).
// 1. TVA : quand l’utilisateur remplace à la main le taux proposé pour une désignation, on retient
//    « désignation normalisée -> taux » (preferences.vatCorrections, champ optionnel, 200 entrées au plus).
// 2. Conseils : un conseil marqué « pas utile » deux fois pour la même parcelle (ou le même animal) n’est plus montré
//    jusqu’à la fin de la campagne (preferences.dismissedAdvice, champ optionnel, 200 entrées au plus).
// Les deux listes sont des tableaux d’objets plats (compatibles Firestore : pas de tableaux imbriqués,
// pas de désignation utilisée comme nom de champ).
import {normalize, campaignFor, localIso} from './utils.js';

export const LEARNING_LIMIT = 200;
export const ADVICE_HIDE_AFTER = 2;
const UNITS = new Set([
  'ha', 'h', 'heure', 'heures', 'j', 'jour', 'jours', 'km', 't', 'kg', 'q', 'qx', 'l', 'm', 'ml', 'm2', 'm3',
  'u', 'unite', 'unites', 'x', 'eur', 'euro', 'euros', 'ht', 'ttc'
]);
const prefsOf = state => (state && typeof state.preferences === 'object' && state.preferences) || {};
const list = value => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : [];
const validRate = rate => {const n = Number(rate); return Number.isFinite(n) && n >= 0 && n <= 30 ? n : null;};

/** Désignation réduite à ses mots porteurs : « Fauche 12 ha (parcelle Nord) » -> « fauche parcelle nord ». */
export function vatLabelKey(label) {
  return normalize(label).split(' ').filter(w => w && !/^\d+([.,]\d+)?$/.test(w) && !/^\d/.test(w) && !UNITS.has(w)).slice(0, 8).join(' ');
}

/**
 * Enregistre une correction de taux. Retourne le nouveau tableau (le plus récent d’abord, borné).
 * Même désignation et même taux : compteur +1 ; autre taux : il remplace l’ancien (compteur 1).
 */
export function recordVatCorrection(state, label, rate, {now = Date.now(), proposed = null, limit = LEARNING_LIMIT} = {}) {
  const key = vatLabelKey(label), r = validRate(rate), rows = list(prefsOf(state).vatCorrections);
  if (!key || r === null) return rows;
  const prev = rows.find(x => x.key === key);
  const count = prev && Number(prev.rate) === r ? (Number(prev.count) || 1) + 1 : 1;
  const entry = {key, label: String(label || '').trim().slice(0, 80), rate: r, count, at: localIso(new Date(now))};
  const p = validRate(proposed);
  if (p !== null) entry.proposed = p;
  return [entry, ...rows.filter(x => x.key !== key)].slice(0, Math.max(1, limit));
}

/**
 * Taux appris pour une désignation, ou null. Correspondance exacte d’abord, sinon la plus longue
 * désignation apprise (2 mots ou plus) contenue mot pour mot dans la désignation demandée.
 */
export function learnedVatRate(state, label) {
  const key = vatLabelKey(label);
  if (!key) return null;
  const rows = list(prefsOf(state).vatCorrections).filter(x => x.key && validRate(x.rate) !== null);
  const padded = ` ${key} `;
  const hit = rows.find(x => x.key === key)
    || rows.filter(x => x.key.includes(' ') && padded.includes(` ${x.key} `)).sort((a, b) => b.key.length - a.key.length)[0];
  if (!hit) return null;
  const count = Number(hit.count) || 1;
  return {rate: Number(hit.rate), count, key: hit.key, at: hit.at || '', exact: hit.key === key, confidence: 'learned',
    basis: `taux que vous avez choisi ${count > 1 ? `${count} fois` : 'auparavant'} pour « ${hit.label || hit.key} »`};
}

/** Clé d’un conseil : règle + parcelle (ou fiche concernée). Accepte un conseil de conseils.js ou une carte de décision. */
export function adviceKey(advice) {
  if (!advice) return '';
  const rule = advice.rule || advice.kind || String(advice.id || '').split(/[:|]/)[0] || '';
  const target = advice.parcelId || (advice.entity === 'parcelles' ? advice.entityId : '') || advice.entityId || advice.parcelIds?.[0] || '';
  return rule ? `${rule}|${target}` : '';
}

/** Enregistre un « pas utile ». Le compteur repart à 1 à chaque nouvelle campagne. */
export function recordAdviceDismissal(state, advice, {today = localIso(), limit = LEARNING_LIMIT} = {}) {
  const key = adviceKey(advice), rows = list(prefsOf(state).dismissedAdvice);
  if (!key) return rows;
  const campaign = campaignFor(today), prev = rows.find(x => x.key === key);
  const count = prev && prev.campaign === campaign ? (Number(prev.count) || 1) + 1 : 1;
  const [rule, target] = key.split('|');
  return [{key, rule, target, campaign, count, at: today}, ...rows.filter(x => x.key !== key)].slice(0, Math.max(1, limit));
}

/** Annule le dernier « pas utile » (bouton Annuler du toast). */
export function undoAdviceDismissal(state, advice) {
  const key = adviceKey(advice), rows = list(prefsOf(state).dismissedAdvice);
  return rows.flatMap(x => x.key !== key ? [x] : (Number(x.count) || 1) > 1 ? [{...x, count: Number(x.count) - 1}] : []);
}

/** Vrai si le conseil a été jugé « pas utile » au moins deux fois pendant la campagne en cours. */
export function isAdviceHidden(state, advice, {today = localIso(), threshold = ADVICE_HIDE_AFTER} = {}) {
  const key = adviceKey(advice);
  if (!key) return false;
  const hit = list(prefsOf(state).dismissedAdvice).find(x => x.key === key);
  return Boolean(hit && hit.campaign === campaignFor(today) && (Number(hit.count) || 0) >= threshold);
}

/** Retire d’une liste de conseils ceux que l’utilisateur a écartés. Les conseils urgents restent visibles. */
export function filterHiddenAdvice(state, advices, {today = localIso(), threshold = ADVICE_HIDE_AFTER, keepUrgent = true} = {}) {
  return (advices || []).filter(a => (keepUrgent && a?.level === 'urgent') || !isAdviceHidden(state, a, {today, threshold}));
}
