// n° 103 — Sommes de températures et stades estimés, fonctions pures.
// Degrés-jours : somme de max(0, (Tmax + Tmin) / 2 − base) depuis le semis (méthode moyenne simple ;
// pour le maïs et le tournesol, Tmax plafonnée à 30 °C et Tmin ramenée à la base, méthode « 6-30 »).
// Base 0 °C pour les céréales d'hiver et le colza, 6 °C pour le maïs et le tournesol.
// Les seuils de stades sont des ordres de grandeur pour une précocité moyenne : ils varient selon la
// variété et la région et se règlent par culture. Le résultat est toujours « estimé ».
// Un stade observé saisi sur la parcelle recale le calcul : on repart de son seuil à sa date.
import {normalize} from './utils.js';

export const PHENOLOGY_SOURCE = 'Repères indicatifs d’ordre de grandeur (Arvalis, Terres Inovia), à adapter à vos variétés';

export const PHENO_PROFILES = {
  cereales: {label: 'Céréales d’hiver', base: 0, method: 'mean', stages: [
    {name: 'Levée', gdd: 150}, {name: 'Début tallage', gdd: 500}, {name: 'Épi 1 cm', gdd: 1000}, {name: '1-2 nœuds', gdd: 1200},
    {name: 'Épiaison', gdd: 1650}, {name: 'Floraison', gdd: 1800}, {name: 'Maturité physiologique', gdd: 2500}]},
  orge_printemps: {label: 'Céréales de printemps', base: 0, method: 'mean', stages: [
    {name: 'Levée', gdd: 120}, {name: 'Début tallage', gdd: 350}, {name: 'Épi 1 cm', gdd: 650}, {name: 'Épiaison', gdd: 1100}, {name: 'Maturité physiologique', gdd: 1700}]},
  mais: {label: 'Maïs', base: 6, method: 'capped', stages: [
    {name: 'Levée', gdd: 80}, {name: '4-5 feuilles', gdd: 250}, {name: '8-10 feuilles', gdd: 500}, {name: 'Floraison femelle', gdd: 900},
    {name: 'Maturité (32 % d’humidité)', gdd: 1700}]},
  colza: {label: 'Colza', base: 0, method: 'mean', stages: [
    {name: 'Levée', gdd: 120}, {name: '4 feuilles', gdd: 380}, {name: 'Rosette', gdd: 700}, {name: 'Floraison', gdd: 1250}, {name: 'Maturité', gdd: 2300}]},
  tournesol: {label: 'Tournesol', base: 6, method: 'capped', stages: [
    {name: 'Levée', gdd: 100}, {name: 'Bouton étoilé', gdd: 500}, {name: 'Floraison', gdd: 850}, {name: 'Maturité', gdd: 1500}]}
};

export function profileKey(culture = '') {
  const c = normalize(culture);
  if (!c) return null;
  if (/mais/.test(c)) return 'mais';
  if (/tournesol/.test(c)) return 'tournesol';
  if (/colza/.test(c)) return 'colza';
  if (/(orge|ble|avoine).*printemps|printemps.*(orge|ble|avoine)/.test(c)) return 'orge_printemps';
  if (/\b(ble|orge|triticale|seigle|epeautre|avoine)\b/.test(c)) return 'cereales';
  return null;
}
// Profil de la culture, avec les réglages de l'utilisateur ({base, stages:[{name,gdd}]}) par clé.
export function cropProfile(culture, overrides = {}) {
  const key = profileKey(culture);
  if (!key) return null;
  const base = PHENO_PROFILES[key], o = overrides?.[key] || {};
  const stages = Array.isArray(o.stages) && o.stages.length ? o.stages.filter(s => s?.name && Number.isFinite(Number(s.gdd))).map(s => ({name: s.name, gdd: Number(s.gdd)})) : base.stages;
  return {key, label: base.label, method: base.method, base: Number.isFinite(Number(o.base)) ? Number(o.base) : base.base, stages: [...stages].sort((a, b) => a.gdd - b.gdd), custom: Boolean(o.stages || o.base !== undefined)};
}

export function dailyDegree(day, base, method = 'mean') {
  if (!Number.isFinite(day?.tmax) || !Number.isFinite(day?.tmin)) return null;
  let tmax = day.tmax, tmin = day.tmin;
  if (method === 'capped') {tmax = Math.min(30, Math.max(base, tmax)); tmin = Math.min(30, Math.max(base, tmin));}
  return Math.max(0, (tmax + tmin) / 2 - base);
}

// Somme de « from » (exclu : le jour du semis ne compte pas) à « to » (inclus).
export function degreeDays(days = [], {from, to, base = 0, method = 'mean'} = {}) {
  let sum = 0, counted = 0, forecast = 0, missing = 0;
  const known = new Map(days.map(d => [d.date, d]));
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = new Date(`${from}T12:00:00Z`); ; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d > end) break;
    const day = known.get(d.toISOString().slice(0, 10)), v = dailyDegree(day, base, method);
    if (v === null) {missing++; continue;}
    sum += v; counted++; if (day.forecast) forecast++;
  }
  return {sum: Math.round(sum), counted, forecast, missing};
}

const day10 = v => {const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';};
const SOWING = /\b(semis|seme|semer|semi)\b/;
const HARVEST = /\b(recolte|moisson|ensilage|battage)\b/;
// Dernier semis réalisé (moins de 11 mois) sans récolte après lui.
export function sowingFor(state = {}, parcelId, {today}) {
  const works = (state.interventions || []).filter(w => !w.deletedAt && w.parcelId === parcelId && ['Terminé', 'Terminée'].includes(w.status || 'Terminé') && day10(w.date));
  const limit = new Date(`${today}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate() - 330);
  const min = limit.toISOString().slice(0, 10);
  const sowing = works.filter(w => SOWING.test(normalize(w.type)) && day10(w.date) >= min && day10(w.date) <= today).sort((a, b) => day10(b.date).localeCompare(day10(a.date)))[0];
  if (!sowing) return null;
  const harvested = works.some(w => HARVEST.test(normalize(w.type)) && day10(w.date) > day10(sowing.date));
  return harvested ? null : {date: day10(sowing.date), workId: sowing.id, culture: sowing.culture || ''};
}

export function stageAt(profile, gdd) {
  let current = null, next = profile.stages[0] || null;
  for (const s of profile.stages) if (gdd >= s.gdd) {current = s; next = profile.stages[profile.stages.indexOf(s) + 1] || null;}
  return {current, next};
}

// Estimation pour une parcelle. observation : {date, stage} saisi par l'utilisateur.
export function estimatePhenology({culture, sowingDate, days = [], today, observation = null, overrides = {}} = {}) {
  const profile = cropProfile(culture, overrides);
  if (!profile) return {status: 'unsupported', culture};
  if (!sowingDate) return {status: 'no-sowing', profile};
  if (!days.length) return {status: 'no-weather', profile, sowingDate};
  let start = sowingDate, offset = 0, recalibrated = null;
  const obsStage = observation?.stage && profile.stages.find(s => s.name === observation.stage);
  if (obsStage && day10(observation.date) >= sowingDate && day10(observation.date) <= today) {start = day10(observation.date); offset = obsStage.gdd; recalibrated = {date: start, stage: obsStage.name};}
  const past = degreeDays(days, {from: start, to: today, base: profile.base, method: profile.method});
  const last = days.at(-1)?.date || today;
  const ahead = last > today ? degreeDays(days, {from: today, to: last, base: profile.base, method: profile.method}) : {sum: 0, counted: 0};
  const sum = offset + past.sum, total = profile.stages.at(-1)?.gdd || 1;
  const {current, next} = stageAt(profile, sum);
  // Date estimée du prochain stade, seulement si la prévision l'atteint.
  let nextDate = null;
  if (next) {
    let acc = sum;
    for (const d of days.filter(x => x.date > today)) {
      const v = dailyDegree(d, profile.base, profile.method);
      if (v === null) break;
      acc += v;
      if (acc >= next.gdd) {nextDate = d.date; break;}
    }
  }
  return {
    status: 'ok', profile, sowingDate, base: profile.base, sum, forecastSum: sum + ahead.sum, missing: past.missing, recalibrated,
    stage: current, next, remaining: next ? Math.max(0, Math.round(next.gdd - sum)) : 0, nextDate,
    progress: Math.max(0, Math.min(1, sum / total))
  };
}
