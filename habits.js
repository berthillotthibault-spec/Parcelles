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
      if (!next.has(nk)) next.set(nk, {labels: [], delays: [], years: [], parcels: new Set()});
      const row = next.get(nk);
      row.labels.push(b.type); row.delays.push(Math.round((dayMs(b.day) - dayMs(a.day)) / DAY)); row.years.push(Number(b.day.slice(0, 4))); row.parcels.add(b.parcelId);
    }
  }
  const next = {};
  for (const [key, options] of transitions) {
    let best = null;
    for (const row of options.values()) if (!best || row.delays.length > best.delays.length) best = row;
    if (!best || best.delays.length < minCount) continue;
    next[key] = {type: mode(best.labels).value, count: best.delays.length, delayDays: median(best.delays), years: [...new Set(best.years)].sort((a, b) => b - a)};
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
  const date = new Date(dayMs(from) + habit.delayDays * DAY).toISOString().slice(0, 10);
  const years = habit.years;
  return {
    type: habit.type, date, delayDays: habit.delayDays, count: habit.count, years,
    parcelId: work.parcelId, culture: workCulture(state, work),
    label: `${habit.type} prévu vers le ${frenchDayMonth(date)} (comme en ${yearsText(years)}) ?`,
    source: `vu ${habit.count} fois, délai médian ${habit.delayDays} j après ${work.type}`
  };
}

// Valeurs habituelles pour pré-remplir un formulaire de travail.
export function habitDefaults(state = {}, {culture = '', type = '', now = Date.now(), habits = null} = {}) {
  if (!type) return null;
  const learned = habits || learnHabits(state, {now});
  return learned.inputs[habitKey(culture, type)] || null;
}
