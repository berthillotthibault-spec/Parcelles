// Créneaux météo par travail en attente (idée n° 100).
// Fonctions pures : la prévision vient du cache météo de l’accueil, le type de travail est
// rapproché d’une famille de seuils (weatherRuleFor), weatherWindows calcule les heures.
// Résultat toujours indicatif : ce n’est jamais une autorisation de traiter ou d’épandre.
import {weatherWindows} from './weather-decision.js';
import {weatherRuleFor, frenchClock} from './home-story.js';
import {isPending} from './home-priorities.js';

const HOUR = 3600000;
const FRESH_HOURS = 6;
const OLD_HOURS = 48;
export const SLOT_DISCLAIMER = 'Créneaux météo indicatifs, pas une autorisation.';
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const dayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
function dayLabel(ms, now) {
  const diff = Math.round((dayStart(ms) - dayStart(now)) / 86400000);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  return DAYS[new Date(ms).getDay()];
}
// « demain 6 h–11 h », « jusqu’à 11 h » si le créneau est en cours, « demain dès 22 h » s’il déborde sur la nuit.
export function slotSpan(start, end, now = Date.now()) {
  const from = Math.max(start, now), sameDay = dayStart(from) === dayStart(end - 1);
  if (start <= now) return sameDay ? `maintenant jusqu’à ${frenchClock(end)}` : `maintenant jusqu’à ${dayLabel(end - 1, now)} ${frenchClock(end)}`;
  return sameDay ? `${dayLabel(from, now)} ${frenchClock(from)}–${frenchClock(end)}` : `${dayLabel(from, now)} dès ${frenchClock(from)}`;
}

function pick(windows, level, now) {
  const rows = (windows || []).filter(w => w.level === level && w.end > now);
  return rows.find(w => w.end - Math.max(w.start, now) >= 2 * HOUR) || rows[0] || null;
}

// Pastille d’un travail : {tone:'good'|'watch'|'none', text, title, stale} ou null si non concerné.
export function workWeatherSlot(work, weather, {now = Date.now(), rules = null} = {}) {
  if (!work || !isPending(work)) return null;
  const rule = weatherRuleFor(work.type);
  if (!rule || !weather?.loadedAt) return null;
  const ageHours = (now - Number(weather.loadedAt)) / HOUR;
  if (!(ageHours <= OLD_HOURS)) return {tone: 'none', stale: true, rule, text: 'Créneau : données anciennes', title: `Prévisions de plus de ${OLD_HOURS} h : actualisez la météo. ${SLOT_DISCLAIMER}`};
  const stale = ageHours > FRESH_HOURS;
  const result = weatherWindows(weather, rule, {now, maxAgeHours: OLD_HOURS, ...(rules?.[rule] ? {rules: rules[rule]} : {})});
  const good = pick(result.windows, 'favorable', now), watch = good ? null : pick(result.windows, 'watch', now);
  const chosen = good || watch;
  const suffix = stale ? ' · données anciennes' : '';
  const why = chosen?.hours?.[0]?.why?.slice(0, 7).join(' · ') || '';
  const base = `Seuils « ${rule} ». ${SLOT_DISCLAIMER}${stale ? ' Prévisions de plus de 6 h : à actualiser.' : ''}`;
  if (!chosen) return {tone: 'none', stale, rule, text: `Pas de créneau sur 3 jours${suffix}`, title: base};
  return {
    tone: stale ? 'none' : good ? 'good' : 'watch', stale, rule, start: chosen.start, end: chosen.end,
    text: `${good ? 'Créneau' : 'Créneau à surveiller'} : ${slotSpan(chosen.start, chosen.end, now)}${suffix}`,
    title: `${why ? `${why}. ` : ''}${base}`
  };
}

// Travaux en attente qui ont un créneau favorable commençant aujourd’hui (prévisions fraîches seulement).
export function favorableToday(works, weather, {now = Date.now()} = {}) {
  if (!weather?.loadedAt || now - weather.loadedAt > FRESH_HOURS * HOUR) return [];
  const end = dayStart(now) + 86400000;
  return (works || []).filter(w => !w.deletedAt).map(work => ({work, slot: workWeatherSlot(work, weather, {now})}))
    .filter(({slot}) => slot?.tone === 'good' && slot.start < end);
}
