// Troupeau « à surveiller » : indicateurs de reproduction et de croissance tirés des événements saisis
// (vêlages, inséminations / saillies, pesées) et des soins. Module pur, lecture seule ; repères indicatifs
// d'un troupeau allaitant, à adapter avec le vétérinaire ou le conseiller.
// - vache vide : dernier vêlage il y a plus de 400 jours sans insémination ni saillie depuis ;
// - génisse de plus de 36 mois jamais vêlée ni mise à la reproduction ;
// - intervalle vêlage-vêlage (IVV) du dernier vêlage au-delà de 420 jours ;
// - croissance (GMQ entre les deux dernières pesées) d'un jeune sous 75 % de la médiane de ses pairs, ou perte de poids ;
// - 3 soins ou plus en 12 mois.
import {isPresent, dailyGain, animalTreatments, offspring} from './herd.js';

export const OPEN_DAYS = 400, HEIFER_MONTHS = 36, IVV_LONG_DAYS = 420, GAIN_RATIO = 0.75, YOUNG_MONTHS = 24, CARE_COUNT = 3;
const GESTATION_DAYS = 290;
const ISO = /^\d{4}-\d{2}-\d{2}/;
const live = (state, key) => (state?.[key] || []).filter(x => x && !x.deletedAt);
const day = v => ISO.test(String(v || '')) ? String(v).slice(0, 10) : '';
const ms = d => Date.parse(`${d}T12:00:00Z`);
const days = (a, b) => Math.round((ms(b) - ms(a)) / 864e5);
const months = (from, to) => days(from, to) / 30.44;
const median = list => {const v = [...list].sort((a, b) => a - b), m = Math.floor(v.length / 2); return v.length ? v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 : null;};
const label = a => a?.name ? `${a.name}${a.nationalId ? ` (${String(a.nationalId).slice(-4)})` : ''}` : a?.nationalId || 'Animal';
const n0 = v => Math.round(v).toLocaleString('fr-FR');
const dd = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', year: 'numeric'});

/** Indicateurs d'une femelle : vêlages triés, dernier IVV, dernière mise à la reproduction. */
export function reproductionOf(state, animalId) {
  const events = live(state, 'animalEvents').filter(e => e.animalId === animalId && day(e.date));
  // Vêlages : événements saisis, et naissances des veaux rattachés à la mère (inventaire importé sans événement).
  const births = offspring(state, animalId).map(c => day(c.birthDate)).filter(Boolean);
  const calvings = [...new Set([...events.filter(e => e.kind === 'calving').map(e => day(e.date)), ...births])].sort();
  const serviceEvents = events.filter(e => e.kind === 'insemination' || e.kind === 'mating').sort((x, y) => day(x.date).localeCompare(day(y.date)));
  const services = serviceEvents.map(e => day(e.date));
  const last = calvings.at(-1) || null;
  const ivv = calvings.length >= 2 ? days(calvings.at(-2), last) : null;
  const lastService = services.at(-1) || null;
  const lastServiceKind = !serviceEvents.length ? null : serviceEvents.at(-1).kind === 'mating' ? 'saillie' : 'inséminée';
  return {calvings, last, ivv, lastService, lastServiceKind};
}

/** IVV moyen du troupeau (dernier intervalle de chaque vache qui en a un), ou null. */
export function herdIvv(state, {today}) {
  const values = live(state, 'animals').filter(a => a.sex === 'F' && isPresent(a, today)).map(a => reproductionOf(state, a.id).ivv).filter(v => v !== null);
  return values.length ? {days: Math.round(values.reduce((s, v) => s + v, 0) / values.length), cows: values.length} : null;
}

/** Liste « à surveiller » : [{animalId, label, kind, level, text}], la plus grave d'abord. */
export function herdWatch(state, {today} = {}) {
  if (!state || !ISO.test(String(today || ''))) return [];
  const present = live(state, 'animals').filter(a => isPresent(a, today));
  const rows = [];
  for (const a of present.filter(x => x.sex === 'F')) {
    const r = reproductionOf(state, a.id), birth = day(a.birthDate);
    // Saillie ou insémination depuis le dernier vêlage, sans vêlage depuis et encore dans la durée d'une gestation : pleine présumée.
    const served = r.lastService && (!r.last || r.lastService > r.last) && days(r.lastService, today) <= GESTATION_DAYS;
    const serviceAfter = r.lastService && (!r.last || r.lastService > r.last);
    if (r.last && !served && days(r.last, today) > OPEN_DAYS)
      rows.push({animalId: a.id, label: label(a), kind: 'open', level: 'warning', text: serviceAfter
        ? `${label(a)} : pas de vêlage depuis ${days(r.last, today)} jours (dernier le ${dd(r.last)}) ; ${r.lastServiceKind} le ${dd(r.lastService)} sans vêlage enregistré depuis.`
        : `${label(a)} : pas de vêlage depuis ${days(r.last, today)} jours (dernier le ${dd(r.last)}) et aucune insémination ni saillie enregistrée depuis.`});
    // Génisse : seulement une femelle née sur l'exploitation (une vache achetée ou importée a un passé inconnu).
    else if (!r.last && !served && a.origin === 'birth' && birth && months(birth, today) > HEIFER_MONTHS && !r.lastService)
      rows.push({animalId: a.id, label: label(a), kind: 'heifer', level: 'info', text: `${label(a)} : ${Math.floor(months(birth, today))} mois, jamais vêlée ni mise à la reproduction.`});
    if (r.ivv !== null && r.ivv > IVV_LONG_DAYS && days(r.last, today) <= 365)
      rows.push({animalId: a.id, label: label(a), kind: 'ivv', level: 'info', text: `${label(a)} : intervalle vêlage-vêlage de ${r.ivv} jours au dernier vêlage (repère : 365 à 400).`});
  }
  // Croissance : jeunes de moins de 24 mois avec deux pesées, comparés à la médiane des jeunes du même sexe.
  const young = present.filter(a => day(a.birthDate) && months(day(a.birthDate), today) < YOUNG_MONTHS)
    .map(a => ({a, gain: dailyGain(state, a.id)})).filter(x => x.gain !== null);
  for (const x of young) {
    const peers = young.filter(y => y !== x && y.a.sex === x.a.sex).map(y => y.gain);
    const ref = peers.length >= 2 ? median(peers) : null;
    if (x.gain < 0) rows.push({animalId: x.a.id, label: label(x.a), kind: 'gain', level: 'warning', text: `${label(x.a)} : perte de poids entre les deux dernières pesées (${n0(x.gain)} g/j).`});
    else if (ref !== null && ref > 0 && x.gain < GAIN_RATIO * ref)
      rows.push({animalId: x.a.id, label: label(x.a), kind: 'gain', level: 'info', text: `${label(x.a)} : croissance de ${n0(x.gain)} g/j, contre ${n0(ref)} g/j pour les ${peers.length} autres jeunes ${x.a.sex === 'M' ? 'mâles' : 'femelles'} pesés.`});
  }
  // Soins répétés sur 12 mois.
  const since = new Date(ms(today) - 365 * 864e5).toISOString().slice(0, 10);
  for (const a of present) {
    const cares = animalTreatments(state, a).filter(t => day(t.date) && day(t.date) >= since && day(t.date) <= today);
    if (cares.length >= CARE_COUNT) rows.push({animalId: a.id, label: label(a), kind: 'care', level: 'info', text: `${label(a)} : ${cares.length} soins en 12 mois (dernier le ${dd(day(cares[0].date))}).`});
  }
  const rank = {warning: 0, info: 1};
  return rows.sort((x, y) => rank[x.level] - rank[y.level] || x.label.localeCompare(y.label, 'fr'));
}
