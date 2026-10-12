// n° 109 — Aide aux dates de semis selon la température du sol, fonctions pures.
// Données : soil_temperature_6cm et soil_moisture_3_to_9cm (Open-Meteo, météo agronomique groupée).
// Pour chaque semis en attente : température moyenne du sol à 6 cm aujourd'hui, premier jour prévu
// au-dessus du seuil de la culture, humidité du sol et dates des semis des années précédentes.
// « Conditions réunies » : seuil atteint aujourd'hui et les 2 jours suivants, sol pas saturé.
// Seuils indicatifs, réglables par culture (preferences.sowingSoilThresholds).
import {normalize} from './utils.js';

export const SOWING_SOURCE = 'Repères indicatifs de température du sol au semis (Arvalis, Terres Inovia)';
export const SOWING_DEFAULTS = {
  mais: {label: 'maïs', soilMin: 10}, sorgho: {label: 'sorgho', soilMin: 12}, soja: {label: 'soja', soilMin: 10},
  tournesol: {label: 'tournesol', soilMin: 8}, betterave: {label: 'betterave', soilMin: 6}, colza: {label: 'colza', soilMin: 8},
  cereales: {label: 'céréales', soilMin: 5}
};
export const SOIL_WET_MAX = 0.4; // m³/m³ : au-delà, sol probablement saturé (indicatif)
const SOWING = /\b(semis|seme|semer|semi)\b/;
const pad = n => String(n).padStart(2, '0');
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function sowingKey(text = '') {
  const c = normalize(text);
  if (/mais/.test(c)) return 'mais';
  if (/sorgho/.test(c)) return 'sorgho';
  if (/soja/.test(c)) return 'soja';
  if (/tournesol/.test(c)) return 'tournesol';
  if (/betterave/.test(c)) return 'betterave';
  if (/colza/.test(c)) return 'colza';
  if (/\b(ble|orge|triticale|seigle|epeautre|avoine)\b/.test(c)) return 'cereales';
  return null;
}
export function sowingThreshold(key, prefs = {}) {
  const d = SOWING_DEFAULTS[key];
  if (!d) return null;
  const o = Number(prefs?.sowingSoilThresholds?.[key]);
  return {key, label: d.label, soilMin: Number.isFinite(o) && o > 0 ? o : d.soilMin, custom: Number.isFinite(o) && o > 0};
}

// Moyennes journalières du sol (température à 6 cm, humidité 3-9 cm).
export function soilDays(hourly) {
  const map = new Map();
  (hourly?.time || []).forEach((t, i) => {
    const d = String(t).slice(0, 10), r = map.get(d) || {date: d, ts: 0, tn: 0, ms: 0, mn: 0};
    const temp = hourly.soil_temperature_6cm?.[i], m = hourly.soil_moisture_3_to_9cm?.[i];
    if (Number.isFinite(temp)) {r.ts += temp; r.tn++;}
    if (Number.isFinite(m)) {r.ms += m; r.mn++;}
    map.set(d, r);
  });
  return [...map.values()].map(r => ({date: r.date, soilTemp: r.tn ? Math.round(r.ts / r.tn * 10) / 10 : null, moisture: r.mn ? Math.round(r.ms / r.mn * 1000) / 1000 : null})).sort((a, b) => a.date.localeCompare(b.date));
}

export function weekdayLabel(iso, today) {
  if (iso === today) return 'aujourd’hui';
  const t = new Date(`${today}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  if (iso === t.toISOString().slice(0, 10)) return 'demain';
  return DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}
const short = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Semis réalisés les années précédentes pour la même culture (le plus récent par année, 3 au plus).
export function previousSowings(state = {}, key, {today, parcelId = null} = {}) {
  const year = today.slice(0, 4), byYear = new Map();
  for (const w of state.interventions || []) {
    if (w.deletedAt || !['Terminé', 'Terminée'].includes(w.status || 'Terminé') || !SOWING.test(normalize(w.type))) continue;
    const date = String(w.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 4) >= year) continue;
    const parcel = (state.parcelles || []).find(p => p.id === w.parcelId);
    if (sowingKey(`${w.culture || ''} ${w.type} ${parcel?.culture || ''}`) !== key) continue;
    const y = date.slice(0, 4), prev = byYear.get(y);
    const score = parcelId && w.parcelId === parcelId ? 1 : 0;
    if (!prev || score > prev.score || (score === prev.score && date < prev.date)) byYear.set(y, {date, score});
  }
  return [...byYear.values()].map(x => x.date).sort((a, b) => b.localeCompare(a)).slice(0, 3);
}

export function pendingSowings(state = {}) {
  return (state.interventions || []).filter(w => !w.deletedAt && !['Terminé', 'Terminée', 'Annulé', 'Annulée'].includes(w.status || 'Terminé') && SOWING.test(normalize(w.type)));
}

export function sowingAdvice(state = {}, work, agro, {today, wetMax = SOIL_WET_MAX} = {}) {
  const parcel = (state.parcelles || []).find(p => p.id === work?.parcelId);
  const key = sowingKey(`${work?.culture || ''} ${work?.type || ''}`) || sowingKey(parcel?.culture || '');
  const th = key && sowingThreshold(key, state.preferences);
  if (!th) return null;
  const days = soilDays(agro?.hourly).filter(d => d.date >= today && d.soilTemp !== null);
  const previous = previousSowings(state, key, {today, parcelId: work.parcelId});
  const prevText = previous.length ? ` Vos semis précédents : ${previous.map(short).join(', ')}.` : '';
  const base = {workId: work.id, parcelId: work.parcelId, parcelName: parcel?.nom || '', key, threshold: th.soilMin, label: th.label, previous};
  if (!days.length) return {...base, status: 'no-data', ready: false, message: `Température du sol indisponible (seuil ${th.label} ${th.soilMin} °C).${prevText}`};
  const now = days[0], first = days.find(d => d.soilTemp >= th.soilMin);
  const moisture = now.moisture, wet = Number.isFinite(moisture) && moisture > wetMax;
  const next3 = days.slice(0, 3);
  const ready = next3.length === 3 && next3.every(d => d.soilTemp >= th.soilMin) && !wet;
  const fmt = v => String(v).replace('.', ',');
  let message;
  if (ready) message = `Sol à ${fmt(now.soilTemp)} °C, au-dessus du seuil ${th.label} (${th.soilMin} °C) pour les 3 prochains jours : conditions de semis réunies.`;
  else if (first && first.date === today) message = `Sol à ${fmt(now.soilTemp)} °C (seuil ${th.label} ${th.soilMin} °C), mais ${wet ? 'sol très humide' : 'la tenue sur 3 jours n’est pas assurée'}.`;
  else if (first) message = `Sol à ${fmt(now.soilTemp)} °C, ${fmt(first.soilTemp)} °C prévu à partir de ${weekdayLabel(first.date, today)} (seuil ${th.label} ${th.soilMin} °C).`;
  else message = `Sol à ${fmt(now.soilTemp)} °C, seuil ${th.label} (${th.soilMin} °C) non atteint dans les prévisions.`;
  if (wet && !ready && !(first && first.date === today)) message += ' Sol très humide.';
  return {...base, status: 'ok', ready, soilTemp: now.soilTemp, moisture, wet, firstDate: first?.date || null, message: message + prevText};
}

export function sowingAdvices(state = {}, agro, {today}) {
  return pendingSowings(state).map(w => sowingAdvice(state, w, agro, {today})).filter(Boolean);
}
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
