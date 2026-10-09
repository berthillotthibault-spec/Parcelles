// Planificateur « Organise ma semaine » (n° 107) : logique pure.
// 7 jours, bande météo horaire par jour (weatherWindows), charge en heures (weeklyLoad),
// puis proposition de dates pour les travaux non datés sous contraintes :
// créneau météo du type de travail, regroupement par proximité, engin réservé une seule
// fois par jour (une même sortie peut enchaîner des parcelles voisines pour le même travail),
// chantiers déjà datés. Rien n'est écrit ici : l'interface applique en une seule écriture.
import {weeklyLoad, workDuration} from './farm-planner.js';
import {weatherWindows} from './weather-decision.js';
import {weatherRuleFor} from './home-story.js';
import {isPending} from './home-priorities.js';
import {geometryCentroid, haversineMeters} from './utils.js';

const DAY_MS = 864e5;
const active = (state, key) => (state?.[key] || []).filter(x => x && !x.deletedAt);
const pad = n => String(n).padStart(2, '0');
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = day => new Date(`${day}T00:00:00`);
export const DAY_NAMES = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const GROUP_METERS = 3000;
export const DAY_CAPACITY = 10;
export const WORK_HOURS = [6, 20];
export const WEEK_DISCLAIMER = 'Proposition indicative : météo et disponibilités à vérifier avant d’intervenir.';

export function weekStart(value = new Date()) {
  const d = new Date(value); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return isoDay(d);
}
export function shiftWeek(start, weeks) { const d = parseDay(start); d.setDate(d.getDate() + 7 * weeks); return isoDay(d); }
export function weekDays(start) { return Array.from({length: 7}, (_, i) => { const d = parseDay(start); d.setDate(d.getDate() + i); return isoDay(d); }); }

// Un travail « non daté » : en attente, sans date prévue.
export const isUndated = w => isPending(w) && w.status !== 'Annulé' && !String(w.plannedDate || '').trim();

const fmtKm = m => (m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 1})} km`);
const hourLabel = ms => `${new Date(ms).getHours()} h`;

// Bande météo d'un jour : une case par heure de travail (6 h–20 h), niveau de weatherWindows.
// La fraîcheur des prévisions se juge avec l'heure réelle (now), pas avec le début du jour.
export function dayWeather(weather, day, {rule = 'Semis', now = Date.now(), maxAgeHours = 48} = {}) {
  const from = parseDay(day).getTime(), hours = [];
  if (!weather?.loadedAt || now - weather.loadedAt > maxAgeHours * 3600e3) return {known: false, hours, reason: 'Prévisions absentes ou anciennes'};
  const res = weatherWindows(weather, rule, {now: Math.max(from, now - 3600e3), maxAgeHours: 1e6});
  const levels = new Map();
  for (const w of res.windows || []) for (const h of w.hours || []) levels.set(h.start, {level: h.level, values: h.values});
  for (let h = WORK_HOURS[0]; h < WORK_HOURS[1]; h++) {
    const at = parseDay(day); at.setHours(h);
    const start = at.getTime(), hit = levels.get(start);
    hours.push({start, hour: h, level: start + 3600e3 <= now ? 'past' : hit?.level || 'none', rain: hit?.values?.rain ?? null, wind: hit?.values?.wind ?? null});
  }
  const known = hours.some(h => !['none', 'past'].includes(h.level));
  const rain = hours.reduce((s, h) => s + (Number(h.rain) || 0), 0);
  const winds = hours.map(h => h.wind).filter(Number.isFinite);
  const count = level => hours.filter(h => h.level === level).length;
  return {known, hours, rain: Math.round(rain * 10) / 10, wind: winds.length ? Math.max(...winds) : null, favorable: count('favorable'), watch: count('watch'), unfavorable: count('unfavorable')};
}

// Plus longue suite d'heures favorables d'un jour pour une règle.
function bestSlot(dw) {
  let best = null, cur = null;
  for (const h of dw.hours) {
    if (h.level === 'favorable') { cur = cur ? {...cur, end: h.start + 3600e3, n: cur.n + 1} : {start: h.start, end: h.start + 3600e3, n: 1}; if (!best || cur.n > best.n) best = cur; }
    else cur = null;
  }
  return best;
}

function chantierDays(chantier) {
  const day = String(chantier.plannedDate || '').slice(0, 10);
  return day ? [day] : [];
}

// Tableau de la semaine : jours, bande météo générique, charge et réservations existantes.
export function buildWeek(state, start, {weather = null, now = Date.now()} = {}) {
  const days = weekDays(start), today = isoDay(new Date(now));
  const dated = {...state, interventions: active(state, 'interventions').filter(w => !isUndated(w))};
  const load = weeklyLoad(dated, start);
  const parcels = new Map(active(state, 'parcelles').map(p => [p.id, p]));
  const machines = new Map(active(state, 'materiels').map(m => [m.id, m]));
  const chantiers = active(state, 'chantiers').filter(c => !['Terminé', 'Annulé'].includes(c.status));
  return days.map((date, i) => {
    const row = load[i] || {hours: 0, unknown: 0, works: []};
    const booked = new Map();
    for (const w of row.works) if (w.equipmentId) booked.set(w.equipmentId, {kind: 'work', type: w.type, label: `${w.type || 'Travail'} · ${parcels.get(w.parcelId)?.nom || 'parcelle'}`, parcelId: w.parcelId});
    const sites = chantiers.filter(c => chantierDays(c).includes(date));
    for (const c of sites) if (c.equipmentId) booked.set(c.equipmentId, {kind: 'chantier', label: `chantier ${c.type || ''}`.trim()});
    return {
      date, name: DAY_NAMES[i], past: date < today || (date === today && new Date(now).getHours() >= WORK_HOURS[1] - 1), isToday: date === today,
      hours: row.hours, unknown: row.unknown, works: row.works, chantiers: sites,
      booked, machines, weather: dayWeather(weather, date, {now})
    };
  });
}

const centerOf = p => (p?.geometry ? geometryCentroid(p.geometry) : null);

// Proposition : renvoie [{work, date, reasons:[…], warnings:[…]}] et les travaux non placés.
export function proposeWeek(state, start, {weather = null, now = Date.now(), capacity = DAY_CAPACITY} = {}) {
  const week = buildWeek(state, start, {weather, now});
  const parcels = new Map(active(state, 'parcelles').map(p => [p.id, p]));
  const machines = new Map(active(state, 'materiels').map(m => [m.id, m]));
  const candidates = active(state, 'interventions').filter(isUndated)
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)));
  // État de travail par jour : charge, engins, travaux présents (existants + proposés).
  const slots = week.map(d => ({...d, load: d.hours, booked: new Map(d.booked), present: d.works.map(w => ({work: w, proposed: false}))}));
  const ruleWeather = new Map();
  const weatherFor = (rule, day) => { const k = `${rule}|${day.date}`; if (!ruleWeather.has(k)) ruleWeather.set(k, dayWeather(weather, day.date, {rule, now})); return ruleWeather.get(k); };
  const placed = [], unplaced = [];
  for (const work of candidates) {
    const parcel = parcels.get(work.parcelId), center = centerOf(parcel), rule = weatherRuleFor(work.type);
    const hours = workDuration(work, state).hours;
    const machine = work.equipmentId ? machines.get(work.equipmentId) : null;
    let best = null; const refused = [];
    for (const [i, day] of slots.entries()) {
      if (day.past) continue;
      const reasons = [];
      let score = i * 2;
      // Engin : libre, ou même sortie (même travail sur une parcelle voisine).
      if (work.equipmentId && day.booked.has(work.equipmentId)) {
        const b = day.booked.get(work.equipmentId);
        const near = b.kind !== 'chantier' && b.type === work.type && center && haversineMeters(center, centerOf(parcels.get(b.parcelId))) <= GROUP_METERS;
        if (!near) { refused.push(`${day.name} : ${machine?.nom || 'engin'} déjà réservé (${b.label})`); continue; }
      }
      // Météo du type de travail.
      if (rule) {
        const dw = weatherFor(rule, day);
        if (dw.known) {
          const slot = bestSlot(dw), need = Math.max(1, Math.min(8, Math.ceil(hours || 2)));
          if (slot && slot.n >= need) reasons.push(`créneau ${rule.toLowerCase()} ${hourLabel(slot.start)}–${hourLabel(slot.end)}`);
          else if (dw.watch >= need) { reasons.push('créneau à surveiller'); score += 15; }
          else { refused.push(`${day.name} : pas de créneau ${rule.toLowerCase()}`); continue; }
        } else { reasons.push('météo inconnue ce jour'); score += 8; }
      }
      // Regroupement par proximité avec un travail déjà présent ce jour-là.
      let group = null;
      if (center) for (const item of day.present) {
        if (item.work.parcelId === work.parcelId && item.work.type !== work.type) continue;
        const d = haversineMeters(center, centerOf(parcels.get(item.work.parcelId)));
        const same = item.work.type === work.type;
        if (d <= GROUP_METERS && (!group || (same && !group.same) || (same === group.same && d < group.d))) group = {d, same, work: item.work};
      }
      if (group) { score -= group.work.type === work.type ? 40 : 25; reasons.unshift(`regroupé avec ${parcels.get(group.work.parcelId)?.nom || 'une parcelle'}, ${fmtKm(group.d)}`); }
      const after = day.load + (hours || 0);
      if (after > capacity) { score += (after - capacity) * 6; reasons.push(`journée chargée (${Math.round(after * 10) / 10} h)`); }
      else score += day.load * 1.5;
      if (!best || score < best.score) best = {i, score, reasons};
    }
    if (!best) { unplaced.push({work, reasons: refused.length ? refused : ['aucun jour restant cette semaine']}); continue; }
    const day = slots[best.i];
    if (!best.reasons.length) best.reasons.push(day.load ? 'journée la moins chargée' : 'journée libre');
    day.load += hours || 0;
    day.present.push({work, proposed: true});
    if (work.equipmentId && !day.booked.has(work.equipmentId)) day.booked.set(work.equipmentId, {kind: 'work', type: work.type, label: `${work.type} · ${parcel?.nom || 'parcelle'}`, parcelId: work.parcelId});
    placed.push({work, date: day.date, hours, reasons: best.reasons});
  }
  return {week, placed, unplaced, disclaimer: WEEK_DISCLAIMER};
}

// Vérifie une carte déplacée à la main : avertissements non bloquants.
export function checkPlacement(state, plan, workId, date, {weather = null, now = Date.now()} = {}) {
  const item = plan.placed.find(p => p.work.id === workId);
  if (!item) return [];
  const warnings = [], machine = active(state, 'materiels').find(m => m.id === item.work.equipmentId);
  const day = plan.week.find(d => d.date === date);
  if (!day) return warnings;
  if (day.past) warnings.push('jour passé');
  if (item.work.equipmentId) {
    const b = day.booked.get(item.work.equipmentId);
    const others = plan.placed.filter(p => p !== item && p.date === date && p.work.equipmentId === item.work.equipmentId && p.work.type !== item.work.type);
    if ((b && (b.kind === 'chantier' || b.type !== item.work.type)) || others.length) warnings.push(`${machine?.nom || 'engin'} déjà réservé ce jour`);
  }
  const rule = weatherRuleFor(item.work.type);
  if (rule) { const dw = dayWeather(weather, date, {rule, now}); if (dw.known && !dw.favorable && !dw.watch) warnings.push(`pas de créneau ${rule.toLowerCase()}`); }
  return warnings;
}

// Déplacement d'une carte d'un jour (−1 / +1) en restant dans la semaine.
export function moveDate(week, date, step) {
  const i = week.findIndex(d => d.date === date), j = Math.max(0, Math.min(week.length - 1, i + step));
  return week[j]?.date || date;
}

// Écritures à faire : seulement les dates qui changent.
export function planChanges(plan) {
  return plan.placed.filter(p => p.date && p.date !== p.work.plannedDate).map(p => ({...p.work, plannedDate: p.date}));
}

export const dayLoadAfter = (plan, date) => {
  const d = plan.week.find(x => x.date === date);
  return (d?.hours || 0) + plan.placed.filter(p => p.date === date).reduce((s, p) => s + (p.hours || 0), 0);
};
export const weekRangeLabel = start => { const a = parseDay(start), b = new Date(a.getTime() + 6 * DAY_MS); return `${a.getDate()} ${a.toLocaleDateString('fr-FR', {month: 'short'})} – ${b.getDate()} ${b.toLocaleDateString('fr-FR', {month: 'short'})}`; };
