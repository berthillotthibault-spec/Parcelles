// Fraîcheur de la météo (chantier A3) : quand rafraîchir la météo principale, et cache
// de la météo de parcelle pour l'afficher hors ligne. Module pur : stockage et horloge injectés.

export const WEATHER_MAX_AGE_MS = 60 * 60 * 1000;      // au-delà d'1 h, la météo principale est rafraîchie
export const WEATHER_RETRY_MS = 10 * 60 * 1000;        // après un échec, nouvel essai au plus tôt 10 min après
export const PARCEL_WEATHER_KEY = 'parcelles:parcel-weather';
export const PARCEL_WEATHER_MAX = 50;
const SKEW_MS = 5 * 60 * 1000; // tolérance d'horloge

function timeOf(value) {
  if (value == null || value === '') return NaN;
  const t = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// Vrai s'il faut relancer refreshWeather({silent:true}).
// lastAttemptAt : horodatage de la dernière tentative ratée (null si aucune).
export function shouldRefreshWeather({cache = null, now = Date.now(), online = true, pref, isDemo = false, lastAttemptAt = null, inFlight = false} = {}) {
  if (!online || pref === false || isDemo || inFlight) return false;
  // Horloge reculée (date future) : l'échec ou le cache ne bloquent pas le rafraîchissement.
  const failedAt = timeOf(lastAttemptAt), sinceFail = now - failedAt;
  if (Number.isFinite(failedAt) && sinceFail >= 0 && sinceFail < WEATHER_RETRY_MS) return false;
  const loadedAt = timeOf(cache?.loadedAt), age = now - loadedAt;
  if (!cache || !Number.isFinite(loadedAt)) return true;
  return age > WEATHER_MAX_AGE_MS || age < -SKEW_MS;
}

// Clé de cache : position arrondie à 3 décimales (environ 100 m).
export function parcelWeatherKey(lat, lon) {
  const a = Number(lat), b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const r = x => (Math.round(x * 1000) / 1000 + 0).toFixed(3); // + 0 : pas de « -0.000 »
  return `${r(a)},${r(b)}`;
}

function readAll(storage) {
  try {
    const raw = storage?.getItem(PARCEL_WEATHER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
function writeAll(storage, entries) {
  try { storage?.setItem(PARCEL_WEATHER_KEY, JSON.stringify(entries)); return true; } catch { return false; }
}
// keepKey : entrée toujours gardée (la nouvelle), même si d'autres ont un usedAt plus récent (horloge reculée).
function trim(entries, max, keepKey = null) {
  const keys = Object.keys(entries);
  if (keys.length <= max) return entries;
  const others = keys.filter(key => key !== keepKey).sort((a, b) => (Number(entries[b]?.usedAt) || 0) - (Number(entries[a]?.usedAt) || 0));
  const kept = {};
  if (keepKey != null && keepKey in entries) kept[keepKey] = entries[keepKey];
  for (const key of others.slice(0, Math.max(0, max - Object.keys(kept).length))) kept[key] = entries[key];
  return kept;
}

// Dernière météo connue pour cette position : {data, savedAt} ou null.
export function readParcelWeather(storage, key, now = Date.now()) {
  if (!key) return null;
  const entries = readAll(storage), entry = entries[key];
  if (!entry || entry.data == null || !Number.isFinite(entry.savedAt)) return null;
  entry.usedAt = now; // LRU : une lecture garde l'entrée
  writeAll(storage, entries);
  return {data: entry.data, savedAt: entry.savedAt};
}

export function writeParcelWeather(storage, key, data, now = Date.now(), {max = PARCEL_WEATHER_MAX} = {}) {
  if (!key || data == null) return false;
  const entries = readAll(storage);
  entries[key] = {data, savedAt: now, usedAt: now};
  // Quota dépassé : on garde les entrées les plus récentes, de moins en moins, jusqu'à la seule nouvelle.
  for (let keep = Math.min(max, Object.keys(entries).length); keep >= 1; keep = keep > 1 ? Math.floor(keep / 2) : 0) {
    if (writeAll(storage, trim(entries, keep, key))) return true;
  }
  return false;
}

const pad = n => String(n).padStart(2, '0');
// « Prévisions du 12/11 08:05 » (heure locale).
// now est gardé dans la signature pour un futur « il y a 2 h » ; il n'est pas utilisé.
export function formatWeatherAge(loadedAt, now = Date.now()) { // eslint-disable-line no-unused-vars
  const t = timeOf(loadedAt);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `Prévisions du ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
