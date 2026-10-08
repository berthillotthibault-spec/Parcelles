// n° 57 — Portance des sols et bilan hydrique par parcelle : « Peut-on rentrer dans la parcelle ? »
// Logique pure, testable sous node:test. Modèle INDICATIF : un réservoir (réserve utile) par classe
// de sol, alimenté par la pluie (modèle Open-Meteo ou relevés de station/pluviomètre) et vidé par
// l’évapotranspiration de référence (ETP FAO). Ce n’est pas une mesure ; les hypothèses sont exposées.

export const SOIL_WATER_CACHE_KEY = 'parcelles:soil-water';
export const SOIL_WATER_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export const PAST_DAYS = 14;

// Réserve utile indicative sur ~1 m d’enracinement, et humidités volumiques (m³/m³)
// au point de flétrissement (wp) et à la capacité au champ (fc), valeurs moyennes de la littérature.
// rain3Avoid : cumul de pluie sur 3 jours (mm) au-delà duquel la circulation est déconseillée.
export const SOIL_TEXTURES = {
  sableux: {label: 'Sableux', ru: 70, wp: 0.06, fc: 0.17, rain3Avoid: 30},
  limoneux: {label: 'Limoneux', ru: 150, wp: 0.12, fc: 0.32, rain3Avoid: 18},
  argileux: {label: 'Argileux', ru: 120, wp: 0.2, fc: 0.4, rain3Avoid: 12}
};
export const DEFAULT_TEXTURE = 'limoneux';
// Coefficient appliqué aux seuils de pluie : un sol hydromorphe se ressuie mal, un sol drainé mieux.
export const SOIL_DRAINAGE = {
  normal: {label: 'Normal', factor: 1},
  hydromorphe: {label: 'Hydromorphe', factor: 0.6},
  drainee: {label: 'Drainé', factor: 1.3}
};
export const LEVELS = {
  good: {label: 'Bonne', rank: 0},
  limit: {label: 'Limite', rank: 1},
  avoid: {label: 'À éviter', rank: 2}
};
const LEVEL_KEYS = ['good', 'limit', 'avoid'];
// Sous 40 % de réserve, la pousse de l’herbe ralentit nettement (seuil indicatif).
export const GRASS_DEFICIT_FRACTION = 0.4;
export const ASSUMED_START_FRACTION = 0.5;

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = v => Math.round(v * 10) / 10;
const pad = n => String(n).padStart(2, '0');
export const isoDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function soilProfile(parcel = {}) {
  const texture = SOIL_TEXTURES[parcel?.soilTexture] ? parcel.soilTexture : DEFAULT_TEXTURE;
  const drainage = SOIL_DRAINAGE[parcel?.soilDrainage] ? parcel.soilDrainage : 'normal';
  return {texture, drainage, assumed: !SOIL_TEXTURES[parcel?.soilTexture], ...SOIL_TEXTURES[texture], drainageFactor: SOIL_DRAINAGE[drainage].factor};
}

export function buildSoilWaterUrl({latitude, longitude} = {}) {
  const lat = num(latitude), lon = num(longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Position de l’exploitation inconnue.');
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=precipitation_sum,et0_fao_evapotranspiration&hourly=soil_moisture_0_to_7cm&past_days=${PAST_DAYS}&forecast_days=3&timezone=auto`;
}

// Réponse Open-Meteo → jours passés (jusqu’à aujourd’hui inclus), jours à venir, humidité du sol.
export function parseSoilWaterResponse(json, {now = Date.now(), place = '', loadedAt = now} = {}) {
  const daily = json?.daily;
  const times = Array.isArray(daily?.time) ? daily.time : [];
  if (!times.length) return null;
  const today = isoDay(new Date(now));
  const rows = times.map((date, i) => ({date: String(date).slice(0, 10), rain: num(daily.precipitation_sum?.[i]), et0: num(daily.et0_fao_evapotranspiration?.[i])}));
  const past = rows.filter(r => r.date <= today);
  const forecast = rows.filter(r => r.date > today);
  if (!past.length) return null;
  const hours = Array.isArray(json?.hourly?.time) ? json.hourly.time : [];
  const moisture = Array.isArray(json?.hourly?.soil_moisture_0_to_7cm) ? json.hourly.soil_moisture_0_to_7cm : [];
  let soilMoisture = null, soilMoistureAt = null, soilMoistureStart = null;
  const nowLocal = `${today}T${pad(new Date(now).getHours())}:00`;
  hours.forEach((t, i) => {
    const v = num(moisture[i]);
    if (v === null) return;
    if (soilMoistureStart === null && String(t).slice(0, 10) === past[0].date) soilMoistureStart = v;
    if (String(t) <= nowLocal) {soilMoisture = v; soilMoistureAt = String(t);}
  });
  return {days: past, forecast, soilMoisture, soilMoistureAt, soilMoistureStart, latitude: num(json.latitude), longitude: num(json.longitude), place, loadedAt};
}

// Relevés de stations et du pluviomètre manuel → pluie journalière (mm) par date.
// Par jour, la première station de la liste qui a un relevé l’emporte (pluviomètre manuel d’abord).
export function stationRainByDay(stations = []) {
  const live = (Array.isArray(stations) ? stations : []).filter(s => s && !s.deletedAt && Array.isArray(s.readings));
  live.sort((a, b) => (b.source === 'manual-gauge') - (a.source === 'manual-gauge') || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  const out = new Map();
  for (const station of live) {
    const sums = new Map();
    for (const r of station.readings) {
      const mm = num(r?.rainMm), day = String(r?.time || '').slice(0, 10);
      if (mm === null || mm < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      sums.set(day, (sums.get(day) || 0) + mm);
    }
    for (const [day, mm] of sums) if (!out.has(day)) out.set(day, {mm: round1(mm), station: station.name || 'Station'});
  }
  return out;
}

export function mergeRain(days = [], stationMap = new Map()) {
  return days.map(d => {
    const s = stationMap.get(d.date);
    return s ? {...d, rain: s.mm, source: 'station', station: s.station} : {...d, source: 'model'};
  });
}

const moistureFraction = (theta, profile) => theta === null ? null : clamp((theta - profile.wp) / (profile.fc - profile.wp), 0, 1);

// Bilan au pas journalier : R = R + pluie − ETR, borné entre 0 et la réserve utile.
// L’ETR suit l’ETP tant que la réserve dépasse 40 %, puis diminue proportionnellement.
export function waterBalance({days = [], soilMoistureStart = null, profile = soilProfile()} = {}) {
  const ru = profile.ru;
  const start = moistureFraction(num(soilMoistureStart), profile);
  let reservoir = (start ?? ASSUMED_START_FRACTION) * ru;
  for (const d of days) {
    const rain = Math.max(0, d.rain ?? 0), et0 = Math.max(0, d.et0 ?? 0);
    const stress = reservoir / ru < 0.4 ? reservoir / (0.4 * ru) : 1;
    reservoir = clamp(reservoir + rain - et0 * stress, 0, ru);
  }
  const sum = (list, key) => round1(list.reduce((s, d) => s + Math.max(0, d[key] ?? 0), 0));
  const last = n => days.slice(-n);
  return {
    ru, reservoirMm: round1(reservoir), fraction: reservoir / ru, percent: Math.round(reservoir / ru * 100),
    rain7: sum(last(7), 'rain'), et07: sum(last(7), 'et0'), rain3: sum(last(3), 'rain'), rain1: sum(last(1), 'rain'),
    days: days.length, initSource: start === null ? 'assumed' : 'model',
    stationDays: days.filter(d => d.source === 'station').length
  };
}

// Portance : cumul de pluie sur 3 jours rapporté au seuil de la classe de sol (corrigé du drainage),
// aggravé si la surface (0–7 cm) dépasse la capacité au champ.
export function trafficability({balance, profile = soilProfile(), soilMoisture = null} = {}) {
  if (!balance) return null;
  const avoid = profile.rain3Avoid * profile.drainageFactor;
  const reasons = [];
  let rank = 0;
  if (balance.rain3 >= avoid) {rank = 2; reasons.push(`${fmt(balance.rain3)} mm en 3 jours`);}
  else if (balance.rain3 >= avoid * 0.5) {rank = 1; reasons.push(`${fmt(balance.rain3)} mm en 3 jours`);}
  const theta = num(soilMoisture);
  if (theta !== null) {
    const wetness = theta / profile.fc;
    if (wetness >= 1.05) {rank = Math.max(rank, profile.drainage === 'hydromorphe' ? 2 : rank + 1); reasons.push('surface gorgée d’eau');}
    else if (wetness >= 0.9) {rank = Math.max(rank, 1); reasons.push('surface humide');}
  }
  if (rank < 2 && balance.fraction >= 0.95 && balance.rain1 >= 2) {rank += 1; reasons.push('réserve pleine et pluie récente');}
  rank = clamp(rank, 0, 2);
  if (!reasons.length) reasons.push('pas de pluie marquante sur 3 jours');
  const level = LEVEL_KEYS[rank];
  return {level, label: LEVELS[level].label, rank, reasons, rain3Threshold: round1(avoid)};
}

export const isGrassland = parcel => /prair|pâtur|patur|herbe|luzern|fourrag|ray-?grass|trèfle|trefle/i.test(String(parcel?.culture || ''));

export function assessParcel(parcel, cache, stations = []) {
  if (!parcel || !cache?.days?.length) return null;
  const profile = soilProfile(parcel);
  const days = mergeRain(cache.days, stationRainByDay(stations));
  const balance = waterBalance({days, soilMoistureStart: cache.soilMoistureStart, profile});
  const portance = trafficability({balance, profile, soilMoisture: cache.soilMoisture});
  const grassDeficit = isGrassland(parcel) && balance.fraction < GRASS_DEFICIT_FRACTION;
  const nextRain = round1((cache.forecast || []).slice(0, 2).reduce((s, d) => s + Math.max(0, d.rain ?? 0), 0));
  return {parcelId: parcel.id, profile, balance, portance, grassDeficit, nextRain, loadedAt: cache.loadedAt};
}

export function farmSummary(parcels = [], cache, stations = []) {
  const rows = (Array.isArray(parcels) ? parcels : []).filter(p => p && !p.deletedAt && !p.archived).map(p => ({parcel: p, a: assessParcel(p, cache, stations)})).filter(r => r.a);
  if (!rows.length) return null;
  const counts = {good: 0, limit: 0, avoid: 0};
  rows.forEach(r => {counts[r.a.portance.level] += 1;});
  const worst = rows.slice().sort((x, y) => y.a.portance.rank - x.a.portance.rank || String(x.parcel.nom || '').localeCompare(String(y.parcel.nom || ''), 'fr'));
  const grass = rows.filter(r => r.a.grassDeficit);
  // Le chiffre de pluie et d’ETP de l’exploitation est celui d’un sol limoneux non renseigné (même point météo).
  const reference = assessParcel({id: '_farm'}, cache, stations);
  return {counts, total: rows.length, worst, grass, reference, level: LEVEL_KEYS[Math.max(...rows.map(r => r.a.portance.rank))]};
}

export function cacheAgeLabel(loadedAt, now = Date.now()) {
  const t = num(loadedAt);
  if (t === null) return 'date inconnue';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}

export function isStale(cache, now = Date.now()) {
  return !cache?.loadedAt || now - Number(cache.loadedAt) > SOIL_WATER_MAX_AGE_MS;
}

// Relevé de pluviomètre : ajoute (ou remplace) la mesure du jour dans la station manuelle.
export function addGaugeReading(station, {date, rainMm}) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Champ obligatoire : date du relevé.');
  const mm = num(String(rainMm ?? '').replace(',', '.'));
  if (mm === null) throw new Error('Champ obligatoire : pluie mesurée (mm).');
  if (mm < 0 || mm > 500) throw new Error('La pluie mesurée doit être comprise entre 0 et 500 mm.');
  const base = station || {name: 'Pluviomètre manuel', source: 'manual-gauge', readings: []};
  const readings = (Array.isArray(base.readings) ? base.readings : []).filter(r => String(r?.time || '').slice(0, 10) !== day);
  readings.push({time: `${day}T08:00`, temperature: null, rainMm: round1(mm), windKmh: null, humidity: null});
  readings.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return {...base, readings: readings.slice(-1000)};
}

function fmt(v) {
  return Number(v).toLocaleString('fr-FR', {maximumFractionDigits: 1});
}
export const formatMm = fmt;
