// n° 102 — Apprentissage des habitudes, fonctions pures.
// Sur les 3 dernières campagnes complètes, plus la campagne en cours, on apprend :
// - pour chaque couple (culture, type de travail), le travail suivant le plus fréquent sur la même
//   parcelle et la même campagne, avec son délai médian ;
// - pour chaque couple (culture, type), le produit, la dose et le matériel habituels.
// Une habitude n'est retenue qu'à partir de HABIT_MIN_COUNT occurrences. Rien n'est jamais écrit
// automatiquement : l'interface propose, l'utilisateur valide.
import {campaignFor, normalize} from './utils.js';

export const HABIT_MIN_COUNT = 2;
export const HABIT_CAMPAIGNS = 3;
const DAY = 86400000;
const DONE = new Set(['Terminé', 'Terminée']);

const day = value => {const s = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';};
const dayMs = s => Date.parse(`${s}T12:00:00Z`);
// Date du jour en heure locale (AAAA-MM-JJ) : toISOString donnerait la veille entre 0 h et 2 h à Paris.
const localDay = t => {const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;};
export const habitKey = (culture, type) => `${normalize(culture || '')}|${normalize(type || '')}`;
export function median(values = []) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
function campaignsBack(now, count) {
  const start = Number(campaignFor(now).slice(0, 4));
  return new Set(Array.from({length: count + 1}, (_, i) => `${start - i}/${String(start - i + 1).slice(-2)}`));
}
function mode(values) {
  const counts = new Map();
  for (const v of values) if (v !== '' && v != null) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = {value, count};
  return best;
}

// Culture d'un travail : saisie sur le travail, sinon rotation de la campagne, sinon culture de la parcelle.
export function workCulture(state, work) {
  if (work?.culture) return work.culture;
  const campaign = campaignFor(day(work?.date) || Date.now());
  const rotation = (state.rotations || []).find(r => !r.deletedAt && r.parcelId === work?.parcelId && r.campaignId === campaign);
  if (rotation?.culture) return rotation.culture;
  return (state.parcelles || []).find(p => p.id === work?.parcelId)?.culture || '';
}

function doneWorks(state, now, campaigns) {
  const keep = campaignsBack(now, campaigns);
  return (state.interventions || [])
    .filter(w => !w.deletedAt && DONE.has(w.status || 'Terminé') && day(w.date) && w.type && keep.has(campaignFor(day(w.date))))
    .map(w => ({...w, day: day(w.date), culture: workCulture(state, w)}));
}

export function learnHabits(state = {}, {now = Date.now(), campaigns = HABIT_CAMPAIGNS, minCount = HABIT_MIN_COUNT} = {}) {
  const works = doneWorks(state, now, campaigns);
  const byRun = new Map();
  for (const w of works) {
    const k = `${w.parcelId}|${campaignFor(w.day)}`;
    if (!byRun.has(k)) byRun.set(k, []);
    byRun.get(k).push(w);
  }
  const transitions = new Map();
  for (const list of byRun.values()) {
    list.sort((a, b) => a.day.localeCompare(b.day) || (a.createdAt || 0) - (b.createdAt || 0));
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (normalize(a.type) === normalize(b.type)) continue;
      const key = habitKey(a.culture, a.type);
      if (!transitions.has(key)) transitions.set(key, new Map());
      const next = transitions.get(key), nk = normalize(b.type);
      if (!next.has(nk)) next.set(nk, {labels: [], delays: [], years: [], parcels: new Set(), weekdays: []});
      const row = next.get(nk);
      row.labels.push(b.type); row.weekdays.push(weekdayOf(b.day)); row.delays.push(Math.round((dayMs(b.day) - dayMs(a.day)) / DAY)); row.years.push(Number(b.day.slice(0, 4))); row.parcels.add(b.parcelId);
    }
  }
  const next = {};
  for (const [key, options] of transitions) {
    let best = null;
    for (const row of options.values()) if (!best || row.delays.length > best.delays.length) best = row;
    if (!best || best.delays.length < minCount) continue;
    next[key] = {type: mode(best.labels).value, count: best.delays.length, delayDays: median(best.delays), years: [...new Set(best.years)].sort((a, b) => b - a)};
    const weekday = habitualWeekday(best.weekdays, minCount);
    if (weekday) next[key].weekday = weekday;
  }
  const groups = new Map();
  for (const w of works) {
    const key = habitKey(w.culture, w.type);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const inputs = {};
  const machines = new Set((state.materiels || []).filter(m => !m.deletedAt).map(m => m.id));
  for (const [key, list] of groups) {
    const out = {};
    const product = mode(list.map(w => String(w.product || '').trim()));
    if (product && product.count >= minCount) {
      out.product = product;
      const dose = mode(list.filter(w => String(w.product || '').trim() === product.value && w.dose !== '' && w.dose != null).map(w => `${w.dose}|${w.doseUnit || ''}`));
      if (dose && dose.count >= minCount) {const [value, unit] = dose.value.split('|'); out.dose = {value, unit, count: dose.count};}
    } else {
      const dose = mode(list.filter(w => w.dose !== '' && w.dose != null).map(w => `${w.dose}|${w.doseUnit || ''}`));
      if (dose && dose.count >= minCount) {const [value, unit] = dose.value.split('|'); out.dose = {value, unit, count: dose.count};}
    }
    const equipment = mode(list.map(w => w.equipmentId).filter(id => machines.has(id)));
    if (equipment && equipment.count >= minCount) out.equipmentId = equipment;
    if (Object.keys(out).length) inputs[key] = {...out, total: list.length};
  }
  return {next, inputs, campaigns: [...campaignsBack(now, campaigns)]};
}

// Jour de semaine habituel (0 = dimanche) : retenu s'il revient au moins minCount fois et dans
// au moins la moitié des cas, sinon rien (un travail fait n'importe quel jour n'a pas de jour habituel).
export const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export function weekdayOf(iso) {const t = dayMs(iso); return Number.isFinite(t) ? new Date(t).getUTCDay() : null;}
export function habitualWeekday(weekdays = [], minCount = HABIT_MIN_COUNT) {
  const list = weekdays.filter(Number.isInteger), best = mode(list);
  if (!best || best.count < minCount || best.count * 2 < list.length) return null;
  return {value: best.value, count: best.count, label: WEEKDAYS[best.value]};
}
// Date la plus proche (± 3 jours) qui tombe le jour de semaine habituel.
export function alignToWeekday(iso, weekday) {
  const t = dayMs(iso);if (!Number.isFinite(t) || !Number.isInteger(weekday)) return iso;
  let diff = (weekday - new Date(t).getUTCDay() + 7) % 7;if (diff > 3) diff -= 7;
  return new Date(t + diff * DAY).toISOString().slice(0, 10);
}

export function frenchDayMonth(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'}) : iso;
}
export function yearsText(years = []) {
  const y = years.slice(0, 3).map(String);
  return y.length <= 1 ? y.join('') : `${y.slice(0, -1).join(', ')} et ${y.at(-1)}`;
}

// Proposition après un travail terminé. Rien si l'habitude est trop rare ou si un travail du même
// type est déjà prévu (ou fait) ensuite sur la parcelle.
export function nextStepSuggestion(state = {}, work, {now = Date.now(), habits = null} = {}) {
  if (!work?.type || !work.parcelId) return null;
  const from = day(work.date) || day(now);
  const learned = habits || learnHabits(state, {now});
  const habit = learned.next[habitKey(workCulture(state, work), work.type)];
  if (!habit || !Number.isFinite(habit.delayDays)) return null;
  const nt = normalize(habit.type);
  const campaign = campaignFor(from);
  const already = (state.interventions || []).some(w => !w.deletedAt && w.id !== work.id && w.parcelId === work.parcelId && normalize(w.type) === nt && !['Annulé', 'Annulée'].includes(w.status)
    && (!DONE.has(w.status || 'Terminé') || (day(w.date) >= from && campaignFor(day(w.date)) === campaign)));
  if (already) return null;
  const raw = new Date(dayMs(from) + habit.delayDays * DAY).toISOString().slice(0, 10);
  const date = habit.weekday ? alignToWeekday(raw, habit.weekday.value) : raw;
  if (date < localDay(now)) return null; // étape habituelle déjà passée : missedHabits s'en charge
  const years = habit.years;
  return {
    type: habit.type, date, delayDays: habit.delayDays, count: habit.count, years,
    parcelId: work.parcelId, culture: workCulture(state, work), weekday: habit.weekday || null,
    label: `${habit.type} prévu vers le ${frenchDayMonth(date)} (comme en ${yearsText(years)}) ?`,
    source: `vu ${habit.count} fois, délai médian ${habit.delayDays} j après ${work.type}${habit.weekday ? `, souvent un ${habit.weekday.label}` : ''}`
  };
}

// Valeurs habituelles pour pré-remplir un formulaire de travail.
export function habitDefaults(state = {}, {culture = '', type = '', now = Date.now(), habits = null} = {}) {
  if (!type) return null;
  const learned = habits || learnHabits(state, {now});
  return learned.inputs[habitKey(culture, type)] || null;
}

// Rappel « travail habituel non fait » : après le dernier travail A d'une parcelle cette campagne, le
// travail B qui le suit d'habitude est attendu à A + délai médian. Au-delà de graceDays sans B (prévu,
// en cours ou fait depuis A), un rappel est proposé, jusqu'à maxLateDays (ensuite, l'étape a sans doute
// été sautée volontairement). Lecture seule : rien n'est jamais créé.
export const HABIT_GRACE_DAYS = 7, HABIT_MAX_LATE_DAYS = 30;
export function missedHabits(state = {}, {now = Date.now(), habits = null, graceDays = HABIT_GRACE_DAYS, maxLateDays = HABIT_MAX_LATE_DAYS} = {}) {
  const learned = habits || learnHabits(state, {now});
  if (!Object.keys(learned.next).length) return [];
  const today = localDay(now), campaign = campaignFor(today);
  const works = (state.interventions || []).filter(w => !w.deletedAt && w.parcelId && w.type && !['Annulé', 'Annulée'].includes(w.status));
  const last = new Map();
  for (const w of works) {
    const d = day(w.date);
    if (!DONE.has(w.status || 'Terminé') || !d || d > today || campaignFor(d) !== campaign) continue;
    const k = `${w.parcelId}|${normalize(w.type)}`, prev = last.get(k);
    if (!prev || d > prev.day) last.set(k, {work: w, day: d});
  }
  const names = new Map((state.parcelles || []).filter(p => !p.deletedAt).map(p => [p.id, p.nom || p.name || 'Parcelle']));
  const rows = new Map();
  for (const {work, day: from} of last.values()) {
    const habit = learned.next[habitKey(workCulture(state, work), work.type)];
    if (!habit || !Number.isFinite(habit.delayDays)) continue;
    const expected = new Date(dayMs(from) + habit.delayDays * DAY).toISOString().slice(0, 10);
    const late = Math.round((dayMs(today) - dayMs(expected)) / DAY);
    if (late < graceDays || late > maxLateDays) continue;
    const nt = normalize(habit.type);
    const done = works.some(w => w.parcelId === work.parcelId && normalize(w.type) === nt && (!DONE.has(w.status || 'Terminé') || day(w.date) >= from));
    if (done) continue;
    const key = `${work.parcelId}|${nt}`;
    if (rows.has(key) && rows.get(key).late <= late) continue;
    rows.set(key, {id: `habit-missed-${work.parcelId}-${nt.replace(/[^a-z0-9]+/g, '-')}`, parcelId: work.parcelId, type: habit.type, after: work.type, afterId: work.id, expected, late, count: habit.count,
      label: `${habit.type} · ${names.get(work.parcelId) || 'Parcelle'}`,
      message: `${habit.type} habituellement ${habit.delayDays} j après ${work.type}, attendu vers le ${frenchDayMonth(expected)} (vu ${habit.count} fois)`});
  }
  return [...rows.values()].sort((a, b) => b.late - a.late);
}

// Calendrier habituel des premiers travaux de campagne (semis, première fauche…) : ces travaux n'ont pas
// de travail habituel avant eux, missedHabits ne peut donc pas les anticiper. Pour chaque couple
// (culture, type), on retient la date du premier travail de ce type par parcelle et par campagne, sur les
// campagnes passées ; à partir de CALENDAR_MIN_YEARS campagnes et si les dates restent groupées (au plus
// CALENDAR_MAX_SPREAD jours d'écart), la période habituelle est connue. Les types déjà attendus après un
// autre travail (habitudes « next ») sont laissés à missedHabits. Lecture seule.
export const CALENDAR_MIN_YEARS = 2, CALENDAR_MAX_SPREAD = 45, CALENDAR_LEAD_DAYS = 7, CALENDAR_LATE_DAYS = 10;
const campaignStart = campaign => `${campaign.slice(0, 4)}-08-01`;
const campaignOffset = iso => Math.round((dayMs(iso) - dayMs(campaignStart(campaignFor(iso)))) / DAY);
const offsetDate = (campaign, offset) => new Date(dayMs(campaignStart(campaign)) + offset * DAY).toISOString().slice(0, 10);
const slug = value => normalize(value || '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

export function learnCalendar(state = {}, {now = Date.now(), campaigns = HABIT_CAMPAIGNS, minYears = CALENDAR_MIN_YEARS, habits = null} = {}) {
  const current = campaignFor(localDay(now));
  const learned = habits || learnHabits(state, {now, campaigns});
  const followers = new Set();
  for (const [key, h] of Object.entries(learned.next || {})) followers.add(`${key.split('|')[0]}|${normalize(h.type)}`);
  const firsts = new Map();
  for (const w of doneWorks(state, now, campaigns)) {
    const campaign = campaignFor(w.day);
    if (campaign === current || !w.parcelId) continue;
    const k = `${w.parcelId}|${campaign}|${normalize(w.type)}`, prev = firsts.get(k);
    if (!prev || w.day < prev.day) firsts.set(k, w);
  }
  const groups = new Map();
  for (const w of firsts.values()) {
    const key = habitKey(w.culture, w.type);
    if (!w.culture || followers.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const out = {};
  for (const [key, list] of groups) {
    // Une valeur par campagne : la médiane des premiers passages de toutes les parcelles de cette campagne.
    const byCampaign = new Map();
    for (const w of list) {const c = campaignFor(w.day); if (!byCampaign.has(c)) byCampaign.set(c, []); byCampaign.get(c).push(campaignOffset(w.day));}
    if (byCampaign.size < minYears) continue;
    // Une période à cheval sur le 1er août (moisson fin juillet / début août) : décalages repris sur 365 jours de plus.
    const raw = [...byCampaign.values()].map(median), wrapped = raw.map(o => o < 183 ? o + 365 : o);
    const spread = list => Math.max(...list) - Math.min(...list);
    const offsets = spread(wrapped) < spread(raw) ? wrapped : raw;
    const from = Math.min(...offsets), to = Math.max(...offsets);
    if (to - from > CALENDAR_MAX_SPREAD) continue;
    out[key] = {type: mode(list.map(w => w.type)).value, culture: mode(list.map(w => w.culture)).value, from, to, median: median(offsets),
      campaigns: [...byCampaign.keys()].sort(), count: list.length};
  }
  return out;
}

// Rappel « travail de saison à prévoir » : de CALENDAR_LEAD_DAYS jours avant la période habituelle jusqu'à
// CALENDAR_LATE_DAYS jours après, pour les parcelles de la culture (rotation de la campagne, sinon culture
// de la parcelle) où aucun travail de ce type n'est prévu, en cours ou fait cette campagne. Un rappel par
// couple (culture, type) et par campagne, toutes parcelles regroupées.
export function calendarDue(state = {}, {now = Date.now(), calendar = null, habits = null, leadDays = CALENDAR_LEAD_DAYS, lateDays = CALENDAR_LATE_DAYS} = {}) {
  const learned = calendar || learnCalendar(state, {now, habits});
  if (!Object.keys(learned).length) return [];
  const today = localDay(now), campaign = campaignFor(today), offset = campaignOffset(today);
  const previous = `${Number(campaign.slice(0, 4)) - 1}/${campaign.slice(2, 4)}`;
  const parcels = (state.parcelles || []).filter(p => p && !p.deletedAt && !p.archived);
  const rotationOf = id => new Map((state.rotations || []).filter(r => !r.deletedAt && r.campaignId === id && r.culture).map(r => [r.parcelId, r.culture]));
  const rotation = rotationOf(campaign), lastRotation = rotationOf(previous);
  // Culture de la campagne : la rotation ; à défaut la culture de la parcelle, sauf si elle n'est que celle de la
  // campagne passée (fiche pas encore mise à jour après la récolte) : la culture est alors inconnue.
  const cultureOf = p => {
    if (rotation.has(p.id)) return normalize(rotation.get(p.id));
    const own = normalize(p.culture || '');
    return own && lastRotation.has(p.id) && normalize(lastRotation.get(p.id)) === own ? '' : own;
  };
  // Date retenue d'un travail : celle de réalisation s'il est fait, l'échéance s'il est prévu.
  const works = (state.interventions || []).filter(w => !w.deletedAt && w.parcelId && w.type && !['Annulé', 'Annulée'].includes(w.status))
    .map(w => ({parcelId: w.parcelId, type: normalize(w.type), day: DONE.has(w.status || 'Terminé') ? day(w.date) || day(w.plannedDate) : day(w.plannedDate) || day(w.date)}))
    .filter(w => w.day);
  const rows = [];
  for (const [key, h] of Object.entries(learned)) {
    // Fenêtre de cette campagne, ou de la suivante / précédente quand la période déborde du 1er août.
    const shift = [0, -365, 365].find(k => offset + k >= h.from - leadDays && offset + k <= h.to + lateDays);
    if (shift === undefined) continue;
    const [culture, type] = key.split('|');
    const from = offsetDate(campaign, h.from - shift), to = offsetDate(campaign, h.to - shift);
    // Travail déjà prévu ou fait autour de la période (60 jours de part et d'autre), quelle que soit la campagne comptable.
    const lo = new Date(dayMs(from) - 60 * DAY).toISOString().slice(0, 10), hi = new Date(dayMs(to) + 60 * DAY).toISOString().slice(0, 10);
    const handled = new Set(works.filter(w => w.type === type && w.day >= lo && w.day <= hi).map(w => w.parcelId));
    const missing = parcels.filter(p => cultureOf(p) === culture && !handled.has(p.id));
    if (!missing.length) continue;
    const late = offset + shift > h.to;
    const names = missing.map(p => p.nom || p.name || 'Parcelle');
    const ha = Math.round(missing.reduce((s, p) => s + (Number(p.surfaceHa) || 0), 0) * 10) / 10;
    const period = from === to ? `vers le ${frenchDayMonth(from)}` : `entre le ${frenchDayMonth(from)} et le ${frenchDayMonth(to)}`;
    const list = names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');
    rows.push({id: `habit-calendar-${slug(culture)}-${slug(type)}-${from.slice(0, 4)}`, type: h.type, culture: h.culture, parcelIds: missing.map(p => p.id), from, to, late, ha,
      label: `${h.type} · ${h.culture}`,
      message: `${h.type} de ${h.culture} fait d’habitude ${period} (campagnes ${h.campaigns.join(', ')}) : rien de prévu sur ${missing.length} parcelle${missing.length > 1 ? 's' : ''} (${list}).`});
  }
  return rows.sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
}
