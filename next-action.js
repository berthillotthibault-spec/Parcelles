// n° 28 - Prochaine action enrichie : compte à rebours, pastille météo du créneau et action suivante.
// Logique pure (aucun accès au DOM ni au stockage) ; les heures sont lues en heure locale.

const pad = n => String(n).padStart(2, '0');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function localStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function parseTime(value) {
  const m = TIME_RE.exec(String(value || '').trim());
  return m ? {h: Number(m[1]), m: Number(m[2])} : null;
}
function at(day, time) {
  const t = parseTime(time);
  if (!DAY_RE.test(String(day || '')) || !t) return null;
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, t.h, t.m, 0, 0);
}
function addDay(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d + n, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function entryTitle(entry) {
  const item = entry?.item || {};
  return String((entry?.kind === 'task' ? item.title : item.type) || (entry?.kind === 'task' ? 'Tâche' : 'Travail')).trim();
}

// Moment de début de l'action (date + heure de début), ou null sans heure.
export function actionStart(entry) {
  return entry?.date ? at(entry.date, entry.item?.startTime) : null;
}

// Durée lisible : « 35 min », « 2 h 10 », « 2 h », « 3 j ». `up` arrondit à la minute supérieure.
export function formatSpan(ms, up = false) {
  const minutes = Math.max(0, (up ? Math.ceil : Math.floor)(Math.abs(ms) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return m ? `${h} h ${pad(m)}` : `${h} h`;
  }
  return `${Math.floor(minutes / 1440)} j`;
}

// « dans 2 h 10 », « depuis 35 min », « maintenant » ; '' quand l'action n'a pas d'heure.
// À venir : minute entamée comptée (08:30 vu à 06:20:30 reste « dans 2 h 10 ») ; passé : minutes écoulées.
export function countdownLabel(entry, now = new Date()) {
  const start = actionStart(entry);
  if (!start) return '';
  const diff = start.getTime() - now.getTime();
  if (Math.abs(diff) < 60000) return 'maintenant';
  return diff > 0 ? `dans ${formatSpan(diff, true)}` : `depuis ${formatSpan(diff)}`;
}

// Délai jusqu'au prochain changement de minute (pour caler la mise à jour du compte à rebours).
export function msToNextMinute(now = new Date()) {
  return 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) || 60000;
}

const sameEntry = (a, b) => Boolean(a && b) && a.kind === b.kind && String(a.item?.id) === String(b.item?.id);

// Action suivante : la première entrée de l'agenda trié qui n'est pas l'action affichée.
export function pickFollowing(entries = [], current = null) {
  return (entries || []).find(entry => entry?.item && !sameEntry(entry, current)) || null;
}

const SHORT_DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export function dayWord(day, today) {
  if (!DAY_RE.test(String(day || ''))) return 'sans échéance';
  if (day === today) return 'aujourd’hui';
  if (day === addDay(today, 1)) return 'demain';
  if (day === addDay(today, -1)) return 'hier';
  const [y, m, d] = day.split('-').map(Number), date = new Date(y, m - 1, d, 12);
  return `${SHORT_DAYS[date.getDay()]} ${d} ${SHORT_MONTHS[m - 1]}`;
}

// « Récolte maïs · 08:30 demain », « Semis · en retard », « Clôture · sans échéance ».
export function followingLabel(entry, today) {
  if (!entry?.item) return '';
  const time = parseTime(entry.item.startTime);
  const hhmm = time ? `${pad(time.h)}:${pad(time.m)}` : '';
  const when = entry.overdue ? 'en retard' : [hhmm, dayWord(entry.date, today)].filter(Boolean).join(' ');
  return `${entryTitle(entry)} · ${when}`;
}

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export const RAIN_MM = 0.2;
export const RAIN_PROBABILITY = 60;
const WEATHER_MAX_AGE = 48 * 3600000;

// Créneau observé pour la météo : autour de l'heure prévue, sinon le reste de la journée.
export function weatherWindow(entry, today, now = new Date()) {
  if (!entry) return null;
  const nowStamp = localStamp(now);
  const start = actionStart(entry);
  if (start && !entry.overdue) {
    const end = at(entry.date, entry.item?.endTime);
    const until = end && end > start ? end : new Date(start.getTime() + 2 * 3600000);
    const from = localStamp(new Date(start.getTime() - 3600000));
    return {from: from < nowStamp ? nowStamp.slice(0, 13) + ':00' : from, to: localStamp(until)};
  }
  const day = !entry.date || entry.overdue || entry.date < today ? today : entry.date;
  const from = day === today ? nowStamp.slice(0, 13) + ':00' : `${day}T07:00`;
  return {from, to: day === today ? localStamp(new Date(now.getTime() + 4 * 3600000)) : `${day}T19:00`};
}

// Pastille météo du créneau à partir des prévisions horaires en cache ; null sans météo exploitable.
export function weatherChip(weather, entry, {today, now = new Date()} = {}) {
  const hourly = weather?.hourly, times = hourly?.time;
  if (!entry || !Array.isArray(times) || !times.length) return null;
  const loaded = Number(weather.loadedAt);
  if (Number.isFinite(loaded) && (now.getTime() - loaded > WEATHER_MAX_AGE)) return null;
  const win = weatherWindow(entry, today || localStamp(now).slice(0, 10), now);
  if (!win || win.to < win.from) return null;
  const slots = [];
  times.forEach((time, i) => {
    const stamp = String(time || '').slice(0, 16);
    if (stamp.length === 16 && stamp >= win.from && stamp <= win.to) slots.push(i);
  });
  if (!slots.length) return null;
  const hourOf = i => Number(String(times[i]).slice(11, 13));
  const rainy = slots.find(i => (finite(hourly.precipitation?.[i]) ?? 0) >= RAIN_MM || (finite(hourly.precipitation_probability?.[i]) ?? 0) >= RAIN_PROBABILITY);
  if (rainy !== undefined) {
    const mm = finite(hourly.precipitation?.[rainy]), prob = finite(hourly.precipitation_probability?.[rainy]);
    const detail = [mm !== null && mm > 0 ? `${String(Math.round(mm * 10) / 10).replace('.', ',')} mm` : '', prob !== null ? `${Math.round(prob)} %` : ''].filter(Boolean).join(', ');
    return {tone: 'rain', label: `Pluie ${hourOf(rainy)} h`, title: `Pluie prévue vers ${hourOf(rainy)} h${detail ? ` (${detail})` : ''}`};
  }
  const known = slots.some(i => finite(hourly.precipitation?.[i]) !== null || finite(hourly.precipitation_probability?.[i]) !== null);
  if (!known) return null;
  const temp = finite(hourly.temperature_2m?.[slots[0]]);
  return {tone: 'dry', label: temp === null ? 'Sec' : `Sec · ${Math.round(temp)}°`, title: 'Pas de pluie prévue sur le créneau'};
}
