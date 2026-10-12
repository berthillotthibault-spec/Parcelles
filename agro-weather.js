// Vague 7 voie C — météo agronomique partagée (n° 103 sommes de températures, n° 108 risques
// sanitaires, n° 109 température du sol au semis).
// Une seule requête Open-Meteo « prévision » au centre de l'exploitation regroupe toutes les variables
// utiles (31 jours passés + 7 jours de prévision) ; l'archive n'est demandée qu'en complément, quand un
// semis est plus ancien que 31 jours, et au plus une fois par jour. Tout est gardé en cache sur l'appareil.
import {geometryCentroid} from './utils.js';

export const AGRO_WEATHER_KEY = 'parcelles:agro-weather';
export const AGRO_MAX_AGE_MS = 3 * 3600000;
export const AGRO_PAST_DAYS = 31;
export const AGRO_FORECAST_DAYS = 7;
export const AGRO_SOURCE = 'Open-Meteo (modèles de prévision et archive ERA5)';
// L'archive couvre jusqu'à J-26 : au-delà de 4 jours, un trou apparaîtrait avant les 31 jours récents.
const ARCHIVE_MAX_AGE_MS = 4 * 24 * 3600000;
const RETRY_AFTER_ERROR_MS = 10 * 60000;
const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'soil_temperature_6cm', 'soil_moisture_3_to_9cm'];
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'];

const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pad = n => String(n).padStart(2, '0');
export const isoDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const addDays = (iso, n) => {const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};

export function buildAgroForecastUrl({latitude, longitude}) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${Number(latitude).toFixed(4)}&longitude=${Number(longitude).toFixed(4)}&daily=${DAILY.join(',')}&hourly=${HOURLY.join(',')}&past_days=${AGRO_PAST_DAYS}&forecast_days=${AGRO_FORECAST_DAYS}&timezone=auto`;
}
export function buildArchiveUrl({latitude, longitude, start, end}) {
  return `https://archive-api.open-meteo.com/v1/archive?latitude=${Number(latitude).toFixed(4)}&longitude=${Number(longitude).toFixed(4)}&start_date=${start}&end_date=${end}&daily=${DAILY.join(',')}&timezone=auto`;
}

export function parseDaily(json, {today = isoDay(), source = 'forecast'} = {}) {
  const d = json?.daily, times = Array.isArray(d?.time) ? d.time : [];
  return times.map((t, i) => {
    const date = String(t).slice(0, 10);
    return {date, tmax: num(d.temperature_2m_max?.[i]), tmin: num(d.temperature_2m_min?.[i]), rain: num(d.precipitation_sum?.[i]), forecast: source === 'forecast' && date > today};
  });
}
export function parseHourly(json) {
  const h = json?.hourly, times = Array.isArray(h?.time) ? h.time.map(String) : [];
  const out = {time: times};
  for (const k of HOURLY) out[k] = times.map((_, i) => num(h?.[k]?.[i]));
  return out;
}
// Les jours récents (prévision) remplacent ceux de l'archive ; tri par date.
export function mergeDays(older = [], recent = []) {
  const map = new Map();
  for (const d of older) if (d?.date) map.set(d.date, d);
  for (const d of recent) if (d?.date && (d.tmax !== null || d.tmin !== null || !map.has(d.date))) map.set(d.date, d);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function farmPosition(state = {}, weather = null) {
  if (Number.isFinite(Number(weather?.latitude)) && Number.isFinite(Number(weather?.longitude))) return {latitude: Number(weather.latitude), longitude: Number(weather.longitude)};
  const farm = state.exploitation || {};
  if (farm.latitude !== '' && farm.latitude != null && Number.isFinite(Number(farm.latitude)) && Number.isFinite(Number(farm.longitude))) return {latitude: Number(farm.latitude), longitude: Number(farm.longitude)};
  const centers = (state.parcelles || []).filter(p => !p.deletedAt && !p.archived).map(p => geometryCentroid(p.geometry)).filter(Boolean);
  if (!centers.length) return null;
  return {latitude: centers.reduce((s, c) => s + c.latitude, 0) / centers.length, longitude: centers.reduce((s, c) => s + c.longitude, 0) / centers.length};
}

export const isStale = (cache, now = Date.now()) => !cache?.loadedAt || now - Number(cache.loadedAt) > AGRO_MAX_AGE_MS;

// Chargeur avec cache : ensure({since}) garantit, si le réseau le permet, les jours depuis « since ».
export function createAgroWeather({state, weather = () => null, storage = globalThis.localStorage, fetchImpl = (...a) => globalThis.fetch(...a), nav = globalThis.navigator, now = () => Date.now(), onChange = () => {}} = {}) {
  let cache = read(), inflight = null, lastErrorAt = 0, lastError = null;
  function read() {try {const c = JSON.parse(storage?.getItem(AGRO_WEATHER_KEY) || 'null'); return c?.days?.length ? c : null;} catch {return null;}}
  function write() {try {storage?.setItem(AGRO_WEATHER_KEY, JSON.stringify(cache));} catch {/* stockage plein : le calcul reste en mémoire */}}
  const online = () => nav?.onLine !== false;
  async function getJson(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    try {
      const r = await fetchImpl(url, controller ? {signal: controller.signal} : undefined);
      if (!r.ok) throw new Error(`service météo ${r.status}`);
      return await r.json();
    } finally {if (timer) clearTimeout(timer);}
  }
  function ensure({since = null, force = false} = {}) {
    if (inflight) return inflight;
    const today = isoDay(new Date(now()));
    const needArchive = Boolean(since) && since < addDays(today, -AGRO_PAST_DAYS + 1)
      && (!cache?.archiveFrom || since < cache.archiveFrom || now() - (cache.archiveLoadedAt || 0) > ARCHIVE_MAX_AGE_MS);
    if (!force && !isStale(cache, now()) && !needArchive) return Promise.resolve(cache);
    if (!online()) return Promise.resolve(cache);
    if (!force && lastErrorAt && now() - lastErrorAt < RETRY_AFTER_ERROR_MS) return Promise.resolve(cache);
    const position = farmPosition(state(), weather());
    if (!position) return Promise.resolve(cache);
    inflight = (async () => {
      try {
        let days = cache?.days || [], hourly = cache?.hourly || null, loadedAt = cache?.loadedAt || 0, archiveFrom = cache?.archiveFrom || null, archiveLoadedAt = cache?.archiveLoadedAt || 0;
        if (force || isStale(cache, now())) {
          const json = await getJson(buildAgroForecastUrl(position));
          const recent = parseDaily(json, {today});
          if (!recent.length) throw new Error('prévisions incomplètes');
          days = mergeDays(days, recent); hourly = parseHourly(json); loadedAt = now();
        }
        if (needArchive) {
          const start = since < (archiveFrom || '9999') ? since : archiveFrom;
          const json = await getJson(buildArchiveUrl({...position, start, end: addDays(today, -AGRO_PAST_DAYS + 5)}));
          days = mergeDays(parseDaily(json, {today, source: 'archive'}), days); archiveFrom = start; archiveLoadedAt = now();
        }
        // Au plus 14 mois d'historique.
        days = days.filter(d => d.date >= addDays(today, -430));
        cache = {days, hourly, loadedAt, archiveFrom, archiveLoadedAt, latitude: position.latitude, longitude: position.longitude};
        write(); lastError = null; lastErrorAt = 0;
      } catch (error) {
        lastError = error?.name === 'AbortError' ? 'le service met trop de temps à répondre' : (error?.message || 'service indisponible');
        lastErrorAt = now();
      } finally {inflight = null;}
      try {onChange(cache);} catch (e) {console.warn('[Parcelles] météo agronomique', e);}
      return cache;
    })();
    return inflight;
  }
  return {ensure, get: () => cache, error: () => lastError, loading: () => Boolean(inflight)};
}
