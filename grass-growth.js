// Pousse de l’herbe estimée (kg MS/ha/j) pour le conseil de rotation du pâturage.
// Modèle INDICATIF, sans mesure : courbe de pousse mensuelle d’une prairie permanente de plaine,
// corrigée par la température moyenne des 7 derniers jours (météo agronomique) et par la réserve en
// eau du sol des prairies (bilan hydrique de soil-water.js). Un bulletin « pousse de l’herbe » ou une
// mesure à l’herbomètre restent plus justes : les hypothèses sont exposées dans « Pourquoi ? ».
import {AGRO_WEATHER_KEY} from './agro-weather.js';
import {SOIL_WATER_CACHE_KEY, assessParcel, isGrassland} from './soil-water.js';
import {filterGrazingSessions, isForageParcel, ugbOf, ugbTable} from './grazing.js';

// Pousse de référence par mois (janvier à décembre), kg MS/ha/j : ordres de grandeur des réseaux de
// suivi de la pousse de l’herbe en plaine (pic au printemps, creux d’été, reprise d’automne).
export const GRASS_REFERENCE = Object.freeze([3, 8, 25, 55, 70, 50, 30, 25, 35, 25, 10, 4]);
const MIN_TEMP_DAYS = 4;
// Au-delà, le bilan hydrique en cache ne décrit plus le sol d’aujourd’hui : réserve en eau tenue pour inconnue.
export const SOIL_CACHE_MAX_AGE_DAYS = 10;

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = v => Math.round(v * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const shift = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
const fr = (v, digits = 0) => String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',');

/** Effet de la température moyenne : nul sous 4 °C, plein de 10 à 22 °C, freiné au-delà (0,3 à 30 °C). */
export function temperatureFactor(tMean) {
  const t = num(tMean);
  if (t === null) return null;
  if (t <= 4) return 0;
  if (t < 10) return r2((t - 4) / 6);
  if (t <= 22) return 1;
  return r2(clamp(1 - 0.7 * (t - 22) / 8, 0.3, 1));
}

/** Effet de la réserve en eau (fraction de la réserve utile) : plein au-dessus de 50 %, nul sous 10 %. */
export function waterFactor(fraction) {
  const f = num(fraction);
  if (f === null) return null;
  return r2(clamp((f - 0.1) / 0.4, 0, 1));
}

/** Température moyenne des 7 jours passés (aujourd’hui exclu) ; null si moins de 4 jours connus. */
export function recentMeanTemperature(days = [], today) {
  if (!ISO.test(String(today || ''))) return null;
  const from = shift(today, -7);
  const means = (Array.isArray(days) ? days : [])
    .filter(d => d && typeof d.date === 'string' && d.date >= from && d.date < today)
    .map(d => {const lo = num(d.tmin), hi = num(d.tmax); return lo === null || hi === null ? null : (lo + hi) / 2;})
    .filter(v => v !== null);
  return means.length >= MIN_TEMP_DAYS ? means.reduce((s, v) => s + v, 0) / means.length : null;
}

/**
 * Pousse estimée. Sans température récente : null (le conseil de rotation garde son calcul sans repousse).
 * @returns {{kgMsHaDay:number, reference:number, tMean:number, tempFactor:number, waterFraction:number|null, waterFactor:number|null, note:string}|null}
 */
export function estimateGrassGrowth({today, days = [], waterFraction = null} = {}) {
  const tMean = recentMeanTemperature(days, today);
  if (tMean === null) return null;
  const reference = GRASS_REFERENCE[Number(today.slice(5, 7)) - 1];
  const tf = temperatureFactor(tMean), wf = waterFactor(waterFraction);
  const kg = Math.round(reference * tf * (wf ?? 1));
  const water = wf === null ? 'réserve en eau du sol inconnue, non prise en compte' : `réserve en eau des prairies ${Math.round(clamp(num(waterFraction), 0, 1) * 100)} %`;
  const note = `Pousse de l’herbe estimée à ${kg} kg MS/ha/j (repère du mois ${reference}, température moyenne des 7 derniers jours ${fr(tMean, 1)} °C, ${water}) : estimation indicative, à remplacer par un bulletin pousse de l’herbe ou une mesure si vous en avez.`;
  return {kgMsHaDay: kg, reference, tMean: Math.round(tMean * 10) / 10, tempFactor: Math.round(tf * 100) / 100, waterFraction: wf === null ? null : num(waterFraction), waterFactor: wf === null ? null : Math.round(wf * 100) / 100, note};
}

/** Réserve en eau moyenne des prairies (bilan hydrique), à défaut celle d’un sol limoneux au même point météo. */
export function grasslandWaterFraction(state, soilCache) {
  if (!soilCache?.days?.length) return null;
  const stations = (state?.weatherStations || []).filter(s => s && !s.deletedAt);
  const parcels = (state?.parcelles || []).filter(p => p && !p.deletedAt && !p.archived && isGrassland(p));
  const fractions = (parcels.length ? parcels : [{id: '_farm'}])
    .map(p => {try {return assessParcel(p, soilCache, stations)?.balance?.fraction ?? null;} catch {return null;}})
    .filter(f => f !== null && Number.isFinite(f));
  return fractions.length ? fractions.reduce((s, f) => s + f, 0) / fractions.length : null;
}

const readCache = (storage, key) => {try {const c = JSON.parse(storage?.getItem(key) || 'null'); return c?.days?.length ? c : null;} catch {return null;}};

/**
 * Pousse de l’exploitation à partir des caches de l’appareil (météo agronomique, bilan hydrique).
 * agro : cache déjà en mémoire (agroWeather.get()), sinon lu dans le stockage. Jamais d’appel réseau.
 */
export function farmGrassGrowth(state, {today, agro = null, soil = null, storage = globalThis.localStorage, now = Date.now()} = {}) {
  try {
    const agroCache = agro?.days?.length ? agro : readCache(storage, AGRO_WEATHER_KEY);
    if (!agroCache) return null;
    const cached = soil?.days?.length ? soil : readCache(storage, SOIL_WATER_CACHE_KEY);
    const loadedAt = Number(cached?.loadedAt);
    const soilCache = cached && Number.isFinite(loadedAt) && now - loadedAt <= SOIL_CACHE_MAX_AGE_DAYS * 86400000 ? cached : null;
    return estimateGrassGrowth({today, days: agroCache.days, waterFraction: grasslandWaterFraction(state, soilCache)});
  } catch {return null;}
}

/** Options à passer à grazingRotationAdvice : vide si la pousse n’est pas estimable. */
export function growthOptions(growth) {
  return growth ? {growthKgMsHaDay: growth.kgMsHaDay, growthNote: growth.note, growthEstimated: true} : {};
}

// Herbe contre besoins du troupeau au pré : pousse estimée × surface en herbe, face à l’ingestion des lots
// au pré (UGB × 15 kg MS/j). Sous 80 % des besoins, l’herbe ne suffit plus : affourager ou réduire le
// chargement. La surface compte toutes les prairies, fauche comprise : l’alerte reste prudente.
export const GRASS_SHORTFALL_RATIO = 0.8;
export function grassShortfall(state, growth, {today, intakeKgMsUgbDay = 15} = {}) {
  if (!growth || !state || !ISO.test(String(today || ''))) return null;
  const sessions = (state.grazingSessions || []).filter(s => s && !s.deletedAt);
  // Hors saison de pâturage (repère de pousse sous 15 kg MS/ha/j, de novembre à février) : affourager est la règle, pas une alerte.
  if (GRASS_REFERENCE[Number(today.slice(5, 7)) - 1] < 15) return null;
  const current = filterGrazingSessions(sessions, {status: 'current', date: today});
  if (!current.length) return null;
  // Un pré occupé sans surface connue fausserait l’offre : pas de conclusion.
  const surfaceOf = id => num((state.parcelles || []).find(p => p && !p.deletedAt && p.id === id)?.surfaceHa);
  if (current.some(s => !(surfaceOf(s.parcelId) > 0))) return null;
  const table = ugbTable(state);
  const ugb = current.reduce((s, x) => s + ugbOf(x, table).ugb, 0);
  const grassHa = (state.parcelles || []).filter(p => p && !p.deletedAt && !p.archived && isForageParcel(p, sessions))
    .reduce((s, p) => s + (num(p.surfaceHa) || 0), 0);
  if (!(ugb > 0) || !(grassHa > 0)) return null;
  const need = ugb * intakeKgMsUgbDay, offer = growth.kgMsHaDay * grassHa;
  if (offer >= need * GRASS_SHORTFALL_RATIO) return null;
  const known = current.every(x => ugbOf(x, table).known);
  return {ugb: Math.round(ugb * 10) / 10, grassHa: Math.round(grassHa * 10) / 10, need: Math.round(need), offer: Math.round(offer),
    ratio: Math.round(offer / need * 100) / 100, deficitKgDay: Math.round(need - offer), growth, known};
}
