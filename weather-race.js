// Course contre la météo : pour une même famille de chantiers (récolte, ensilage, fauche, semis, travail du sol)
// à faire sur plusieurs parcelles, estime les heures restantes (farm-planner.js workDuration), les jours
// praticables d’après la prévision en cache (agro-weather.js, soil-water.js) et projette la date de fin.
// Module pur, lecture seule : il ne modifie jamais l’état ; la carte du fil propose seulement d’ouvrir un chantier.
import {workDuration} from './farm-planner.js';
import {isPending} from './home-priorities.js';
import {CANCELLED} from './pilotage.js';
import {soilProfile, assessParcel} from './soil-water.js';

// rate : rythme par défaut (h/ha) quand ni durée saisie ni historique ; dryMm : pluie du jour qui arrête le chantier.
export const RACE_FAMILIES = Object.freeze([
  {key: 'ensilage', label: 'Ensilage', re: /ensil/, rate: 0.5, dryMm: 1},
  {key: 'fauche', label: 'Fauche', re: /fauch|foin|fanage|andain|enrubann/, rate: 0.4, dryMm: 1},
  {key: 'recolte', label: 'Récolte', re: /recolt|moisson|battage|arrach/, rate: 0.6, dryMm: 1},
  {key: 'semis', label: 'Semis', re: /semis|semer|implant/, rate: 0.5, dryMm: 3},
  {key: 'sol', label: 'Travail du sol', re: /labour|dechaum|herse|travail du sol|vibro|cultivat|rotative/, rate: 0.8, dryMm: 3}
]);
export const DEFAULT_DAY_HOURS = 9;
export const DUE_WINDOW_DAYS = 7;
export const MAX_FORECAST_DAYS = 7;

const num = v => {const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;};
const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fr = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');
const addDays = (iso, n) => {const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};
const diffDays = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const live = (state, key) => (state?.[key] || []).filter(x => x && !x.deletedAt);
const median = list => {const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null;};

/** Famille d’un type de travail (null si le chantier ne dépend pas d’une fenêtre sèche). */
export function raceFamily(type) {
  const t = plain(type);
  return t ? RACE_FAMILIES.find(f => f.re.test(t)) || null : null;
}

/** « jeudi », « demain », « aujourd’hui ». */
export function dayName(date, today) {
  const d = diffDays(date, today);
  if (d === 0) return 'aujourd’hui';
  if (d === 1) return 'demain';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', {weekday: 'long', timeZone: 'UTC'});
}

/**
 * Pluie par jour (mm) : cache du bilan hydrique (soil-water.js : days + forecast), remplacé par la météo
 * agronomique (agro-weather.js : days) quand elle existe. Renvoie {rain: Map, horizon: [dates ≥ today]}.
 */
export function rainSeries({agro = null, soil = null, today}) {
  const rain = new Map();
  for (const d of [...(soil?.days || []), ...(soil?.forecast || [])]) if (d?.date && num(d.rain) !== null) rain.set(String(d.date).slice(0, 10), num(d.rain));
  for (const d of agro?.days || []) if (d?.date && num(d.rain) !== null) rain.set(String(d.date).slice(0, 10), num(d.rain));
  const horizon = [...rain.keys()].filter(d => d >= today).sort().slice(0, MAX_FORECAST_DAYS);
  // Une prévision trouée (jour manquant) s’arrête au premier trou.
  const days = [];
  for (let i = 0; i < horizon.length && horizon[i] === addDays(today, i); i++) days.push(horizon[i]);
  return {rain, horizon: days};
}

const dueOf = w => String(w.plannedDate || w.date || '').slice(0, 10);
const inProgress = w => /en cours/i.test(String(w.status || ''));

/**
 * Courses contre la météo : une entrée par famille dont les chantiers ne tiennent pas avant la pluie
 * (ou que le sol humide empêche de finir dans la prévision). Options : today, agro, soil, dayHours.
 */
export function weatherRaces(state, {today, agro = null, soil = null, dayHours = null} = {}) {
  if (!state || !today) return [];
  const {rain, horizon} = rainSeries({agro, soil, today});
  if (horizon.length < 2) return [];
  const hoursPerDay = num(dayHours) ?? num(state.preferences?.workdayHours);
  const hpd = hoursPerDay && hoursPerDay >= 2 && hoursPerDay <= 18 ? hoursPerDay : DEFAULT_DAY_HOURS;
  const parcels = new Map(live(state, 'parcelles').map(p => [p.id, p]));
  const limit = addDays(today, DUE_WINDOW_DAYS);
  const groups = new Map();
  for (const w of live(state, 'interventions')) {
    if (!isPending(w) || CANCELLED.includes(w.status) || !parcels.has(w.parcelId)) continue;
    const due = dueOf(w);
    if (!inProgress(w) && (!due || due > limit)) continue;
    const family = raceFamily(w.type);
    if (!family) continue;
    if (!groups.has(family.key)) groups.set(family.key, {family, works: []});
    groups.get(family.key).works.push(w);
  }
  const out = [];
  for (const {family, works} of groups.values()) {
    if (new Set(works.map(w => w.parcelId)).size < 2) continue;
    const race = projectRace(state, family, works, {today, rain, horizon, hpd, parcels, soil});
    if (race) out.push(race);
  }
  return out.sort((a, b) => (a.rainDate || '9999').localeCompare(b.rainDate || '9999') || b.remainingHa - a.remainingHa);
}

function projectRace(state, family, works, {today, rain, horizon, hpd, parcels, soil}) {
  // 1. Heures restantes par chantier : durée saisie, historique (farm-planner), sinon rythme du groupe ou par défaut.
  const rows = works.map(w => {
    const p = parcels.get(w.parcelId), area = num(w.surfaceWorked) ?? num(p?.surfaceHa);
    const est = (() => {try {return workDuration(w, state);} catch {return {hours: null};}})();
    const how = est.hours === null ? null : est.confidence === 'Durée saisie' ? 'saisie' : est.source === 'gps' ? 'gps' : 'historique';
    return {w, p, area, hours: num(est.hours), how, samples: est.samples || 0};
  });
  const groupRate = median(rows.filter(r => r.hours !== null && r.area > 0).map(r => r.hours / r.area));
  let unknown = 0;
  for (const r of rows) {
    if (r.hours !== null) continue;
    if (r.area > 0) {r.hours = r.area * (groupRate ?? family.rate); r.how = groupRate !== null ? 'groupe' : 'défaut';} else {unknown++; r.hours = 0;}
  }
  const remainingHours = rows.reduce((s, r) => s + r.hours, 0);
  if (!(remainingHours > 0)) return null;
  // Plusieurs chantiers sur une même parcelle (fauche puis fanage…) : la surface n’est comptée qu’une fois.
  const haByParcel = new Map();
  for (const r of rows) haByParcel.set(r.p.id, Math.max(haByParcel.get(r.p.id) ?? 0, r.area ?? 0));
  const remainingHa = [...haByParcel.values()].reduce((s, a) => s + a, 0);

  // 2. Praticabilité par parcelle et par jour : pas de pluie dans la journée, cumul des 3 jours précédents
  // sous le seuil de portance du sol (soil-water.js), et aujourd’hui pas « à éviter » d’après le bilan hydrique.
  const rain3Before = d => [1, 2, 3].reduce((s, i) => s + Math.max(0, rain.get(addDays(d, -i)) ?? 0), 0);
  const todayAvoid = new Set();
  for (const r of rows) {
    r.threshold = (() => {const pr = soilProfile(r.p); return pr.rain3Avoid * pr.drainageFactor;})();
    const a = soil?.days?.length ? (() => {try {return assessParcel(r.p, soil);} catch {return null;}})() : null;
    if (a?.portance?.level === 'avoid') todayAvoid.add(r.p.id);
  }
  const workable = (r, d) => (rain.get(d) ?? 0) < family.dryMm && rain3Before(d) < r.threshold && !(d === today && todayAvoid.has(r.p.id));
  const rainDate = horizon.find(d => (rain.get(d) ?? 0) >= family.dryMm) || null;

  // 3. Ordre conseillé : praticable aujourd’hui, sol qui ressuie le plus lentement, échéance, surface.
  const order = rows.slice().sort((a, b) => Number(workable(b, today)) - Number(workable(a, today)) || a.threshold - b.threshold
    || (dueOf(a.w) || '9999').localeCompare(dueOf(b.w) || '9999') || (b.area ?? 0) - (a.area ?? 0));

  // 4. Projection : chaque jour praticable fournit hpd heures, réparties dans l’ordre conseillé.
  const left = new Map(order.map(r => [r, r.hours]));
  let endDate = null;
  for (const d of horizon) {
    let cap = hpd;
    for (const r of order) {
      if (cap <= 0) break;
      if (!(left.get(r) > 0) || !workable(r, d)) continue;
      const take = Math.min(cap, left.get(r));
      left.set(r, left.get(r) - take); cap -= take;
    }
    if ([...left.values()].every(h => h <= 1e-9)) {endDate = d; break;}
  }
  const beforeRain = rainDate ? horizon.filter(d => d < rainDate) : horizon;
  const dryDays = beforeRain.filter(d => order.some(r => workable(r, d))).length;
  const late = rainDate ? endDate === null || endDate >= rainDate : endDate === null;
  if (!late) return null;
  // Sans pluie annoncée, l’alerte ne vaut que si le sol humide bloque au moins un jour (sinon le chantier dépasse juste la prévision).
  if (!rainDate && horizon.every(d => order.every(r => workable(r, d)))) return null;

  // 5. Parcelles à commencer : celles qui tiennent dans la fenêtre sèche (au moins une, trois au plus).
  const capacity = dryDays * hpd, start = [];
  let used = 0;
  for (const r of order) {
    if (start.length >= 3 || (start.length && used + r.hours > capacity)) break;
    if (!workable(r, today) && !beforeRain.some(d => workable(r, d))) continue;
    start.push(r); used += r.hours;
  }
  if (!start.length) start.push(order[0]);
  const names = start.map(r => r.p.nom || r.p.name || 'parcelle sans nom');
  const namesText = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0];
  const daysOfWork = Math.max(0.5, Math.ceil(remainingHours / hpd * 2) / 2);
  const level = rainDate && diffDays(rainDate, today) <= 2 ? 'urgent' : rainDate ? 'warning' : 'info';
  const dryText = `${dryDays} jour${dryDays > 1 ? 's' : ''} praticable${dryDays > 1 ? 's' : ''}`;
  const rainWhen = !rainDate ? '' : rainDate === today ? 'd’aujourd’hui' : diffDays(rainDate, today) === 1 ? 'de demain' : `de ${dayName(rainDate, today)}`;
  const window = rainDate ? `${dryText} avant la pluie ${rainWhen}`
    : `${dryText} sur ${horizon.length} jours de prévision (sol trop humide)`;
  const title = `${family.label} : ${fr(remainingHa)} ha restants, ~${fr(daysOfWork)} jour${daysOfWork > 1 ? 's' : ''} de travail, ${window} : `
    + (dryDays ? `commencez par ${namesText}` : 'chantier à replanifier');

  const count = how => rows.filter(r => r.how === how).length;
  const samples = Math.max(0, ...rows.filter(r => r.how === 'historique').map(r => r.samples)), pl = (k, w) => k > 1 ? `${w}s` : w;
  const sources = [count('saisie') && `${count('saisie')} durée${count('saisie') > 1 ? 's' : ''} saisie${count('saisie') > 1 ? 's' : ''}`,
    count('historique') && `${count('historique')} ${pl(count('historique'), 'estimée')} sur ${samples} ${pl(samples, 'chantier')} ${pl(samples, 'terminé')}`,
    count('gps') && `${count('gps')} ${pl(count('gps'), 'estimée')} d’après le rythme GPS`,
    count('groupe') && `${count('groupe')} au rythme des autres chantiers (${fr(groupRate, 2)} h/ha)`,
    count('défaut') && `${count('défaut')} au rythme par défaut de ${fr(family.rate, 2)} h/ha`].filter(Boolean).join(', ');
  const rains = horizon.filter(d => (rain.get(d) ?? 0) > 0).map(d => `${dayName(d, today)} ${fr(rain.get(d))} mm`).join(', ');
  const wet = order.filter(r => todayAvoid.has(r.p.id)).map(r => r.p.nom || 'parcelle');
  const n = rows.length, nParcels = new Set(rows.map(r => r.p.id)).size;
  const why = [
    `${n} chantiers sur ${nParcels} parcelles : environ ${fr(remainingHours)} h restantes (${sources}).`,
    `Journées de ${fr(hpd)} h ; fin projetée : ${endDate ? `${dayName(endDate, today)} (${endDate})` : 'au-delà de la prévision'}.`,
    `Prévision en cache sur ${horizon.length} jours : ${rains || 'pas de pluie annoncée'} (chantier arrêté dès ${fr(family.dryMm)} mm).`,
    `Portance : sol jugé trop humide après un cumul de pluie sur 3 jours au-delà du seuil de la parcelle (texture et drainage).`
      + (wet.length ? ` À éviter aujourd’hui : ${wet.join(', ')}.` : ''),
    'Ordre conseillé : parcelles praticables aujourd’hui, puis sols qui ressuient le plus lentement, échéance la plus proche, plus grande surface.',
    ...(unknown ? [`${unknown} chantier${unknown > 1 ? 's' : ''} sans surface connue, non compté${unknown > 1 ? 's' : ''}.`] : []),
    'Estimation indicative : rien n’est modifié dans votre planning.'
  ];
  return {id: `weather-race-${family.key}`, family: family.key, label: family.label, title, why, level, remainingHa, remainingHours,
    daysOfWork, dayHours: hpd, dryDays, rainDate, endDate, start: start.map(r => ({parcelId: r.p.id, nom: r.p.nom || '', workId: r.w.id})), works: rows.length};
}
