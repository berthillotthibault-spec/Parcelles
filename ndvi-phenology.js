// Levée contrôlée par satellite (n° chantier 13). Le NDVI de Sentinel-2 ne date pas la levée elle-même : il voit la
// végétation quand elle couvre assez le sol (blé vers 2-3 feuilles), et des repousses ou adventices verdissent parfois
// juste après le semis. Il sert donc de contrôle, jamais à recaler le calcul d'office :
// - « confirmée » : verdissement entre 5 jours avant et 15 jours après la levée calculée ;
// - « tardive » : verdissement plus de 15 jours après → vérifier, puis saisir le stade observé (formulaire existant) ;
// - « non visible » : levée calculée passée depuis 20 jours, sol encore nu sur au moins deux images → vérifier ;
// - verdissement plus de 5 jours avant la levée calculée : repousses ou adventices, ignoré.
// Aucun signal si une température manque entre le semis et la levée calculée.
import {dailyDegree} from './phenology.js';

export const GREEN_MIN = 0.25, RISE_MIN = 0.08, DROP_RESET = 0.1, MAX_BRACKET_DAYS = 20;
export const EARLY_DAYS = 5, LATE_DAYS = 15, MISSING_AFTER_DAYS = 20, MISSING_IMAGES = 2;
const DAY = 864e5;
const ms = iso => Date.parse(`${iso}T12:00:00Z`);
const iso = t => new Date(t).toISOString().slice(0, 10);
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Séries NDVI publiées par l'écran satellite (cache local), lues par la phénologie sans recharger le satellite.
let published = new Map();
const listeners = new Set();
export function publishNdviSeries(map) { published = map instanceof Map ? map : new Map(); for (const fn of listeners) { try { fn(); } catch { /* écouteur fautif ignoré */ } } }
export function ndviSeriesFor(parcelId) { return published.get(parcelId) || []; }
/** Rappel à chaque publication (la carte phénologie déjà affichée se met à jour). Renvoie la fonction de retrait. */
export function onNdviSeries(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const usableRows = (series, sowingDate, today) => (Array.isArray(series) ? series : [])
  .filter(r => r && r.usable !== false && Number.isFinite(r.ndvi) && r.date > sowingDate && r.date <= today).sort((a, b) => a.date.localeCompare(b.date));

/**
 * Début du verdissement après le semis : relevé nettement au-dessus du minimum (sol nu), confirmé par le relevé
 * suivant s'il existe. Une végétation verte qui retombe (repousses détruites) remet la recherche à zéro.
 * Date : milieu entre ce relevé et le précédent, si moins de MAX_BRACKET_DAYS jours les séparent.
 */
export function detectGreenUp(series, {sowingDate, today = iso(Date.now())} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sowingDate || ''))) return null;
  const rows = usableRows(series, sowingDate, today);
  let prev = null, min = Infinity, high = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.ndvi <= high - DROP_RESET) { prev = r; min = r.ndvi; high = r.ndvi; continue; } // chute : sol de nouveau nu
    high = Math.max(high, r.ndvi);
    if (prev && r.ndvi >= GREEN_MIN && r.ndvi - min >= RISE_MIN) {
      const next = rows[i + 1];
      if (next && next.ndvi < r.ndvi - 0.03) { prev = r; continue; } // pic isolé (bruit) : pas confirmé
      const spanDays = Math.round((ms(r.date) - ms(prev.date)) / DAY);
      if (spanDays > MAX_BRACKET_DAYS) return null;
      return {date: iso((ms(prev.date) + ms(r.date)) / 2), low: {date: prev.date, ndvi: prev.ndvi}, high: {date: r.date, ndvi: r.ndvi}, spanDays};
    }
    if (r.ndvi < min) min = r.ndvi;
    prev = r;
  }
  return null;
}

/**
 * Levée calculée : premier jour où la somme de températures depuis le semis atteint le seuil de levée du profil.
 * Jour par jour : un jour absent ou sans température avant ce seuil → null (pas de conclusion).
 */
export function computedEmergence(estimate, days = [], today = null) {
  const profile = estimate?.profile, stage = profile?.stages?.find(s => /lev/i.test(plain(s.name)));
  if (!stage || !estimate.sowingDate) return null;
  const byDate = new Map((days || []).map(d => [d.date, d]));
  let sum = 0;
  for (let t = ms(estimate.sowingDate) + DAY; ; t += DAY) {
    const date = iso(t);
    if (today && date > today) return {date: null, stage: stage.name};
    const d = byDate.get(date);
    // Jour absent : aujourd'hui (météo du jour pas encore publiée) = pas encore atteinte ; avant = trou, pas de conclusion.
    if (!d) return !today || date >= today ? {date: null, stage: stage.name} : null;
    const v = dailyDegree(d, profile.base, profile.method);
    if (v === null) return null;
    sum += v;
    if (sum >= stage.gdd) return {date, stage: stage.name};
  }
}

/**
 * Contrôle à afficher, ou null. kind : 'confirmed' | 'late' | 'missing'.
 * Rien si un stade est déjà observé pour ce semis, ou si le calcul est déjà recalé.
 */
export function emergenceCheck(parcel, estimate, {series = [], days = [], today = iso(Date.now())} = {}) {
  if (estimate?.status !== 'ok' || estimate.recalibrated) return null;
  const sowingDate = estimate.sowingDate;
  if (parcel?.phenologyObservation?.sowingDate === sowingDate) return null;
  const computed = computedEmergence(estimate, days, today);
  if (!computed?.date) return null;
  const green = detectGreenUp(series, {sowingDate, today});
  if (green) {
    const gapDays = Math.round((ms(green.date) - ms(computed.date)) / DAY);
    if (gapDays < -EARLY_DAYS) return null; // repousses ou adventices, pas la culture
    return {kind: gapDays <= LATE_DAYS ? 'confirmed' : 'late', stage: computed.stage, computedDate: computed.date, greenDate: green.date, gapDays, seen: green};
  }
  const since = Math.round((ms(today) - ms(computed.date)) / DAY);
  const bare = usableRows(series, iso(ms(computed.date) + 10 * DAY), today);
  if (since >= MISSING_AFTER_DAYS && bare.length >= MISSING_IMAGES && bare.every(r => r.ndvi < GREEN_MIN))
    return {kind: 'missing', stage: computed.stage, computedDate: computed.date, images: bare.slice(-MISSING_IMAGES)};
  return null;
}
