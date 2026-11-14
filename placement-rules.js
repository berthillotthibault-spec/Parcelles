// Interdits de placement d'un travail à une date (n° chantier 7) : utilisés par « Organise ma semaine » pour écarter
// un jour, avec la raison, et pour avertir quand on déplace un travail à la main. Logique pure, testée sous Node.
// Une seule source par règle : calendrier de la zone vulnérable (conseils.js banFor → zv-calendar.js), fiches phyto
// (phyto.js : délai avant récolte, retrait d'AMM, délai de rentrée), pâturage (grazing.js).
// planned : Map id → {work, date} des travaux déjà placés par la même proposition, qui comptent comme s'ils étaient
// datés (un traitement et une récolte proposés ensemble se voient l'un l'autre).
import {active, completed} from './farm-memory.js';
import {at, checkTreatment, darEnd, dayIso, isTreatment, limitsFor, productFor, reentryUntil} from './phyto.js';
import {banFor} from './conseils.js';
import {isFertilization} from './nitrogen.js';
import {summarizeParcelGrazing} from './grazing.js';
import {localDate, normalize} from './utils.js';
import {parcelIndex} from './selectors.js';

const HARVEST = /recolte|moisson|battage|ensilage|arrachage|fauche/;
const pad = n => String(n).padStart(2, '0');
const clockOf = ms => { const d = new Date(ms); return `${d.getHours()} h ${pad(d.getMinutes())}`.replace(' h 00', ' h'); };
// Journée de travail : un délai de rentrée qui finit avant 8 h ne gêne pas ; au-delà de 18 h, la journée est perdue.
const DAY_START = '08:00', DAY_END = '18:00';
const isHarvest = work => HARVEST.test(normalize(work?.type));
const day10 = value => { const s = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };

/**
 * Jour où un traitement de la parcelle a lieu, ou null : proposé dans cette semaine (planned), fait ou en cours (date),
 * sinon prévu (plannedDate). Annulé : null.
 */
function treatmentDay(work, planned) {
  if (!work || work.status === 'Annulé') return null;
  const proposal = planned?.get(work.id);
  if (proposal) return day10(proposal.date) || null;
  if (completed(work) || work.status === 'En cours') return day10(work.date) || null;
  return day10(work.plannedDate || work.date) || null;
}

/**
 * Contraintes d'un travail placé le jour `date` (ISO). level 'refuse' : le jour est écarté par la proposition
 * automatique ; 'warn' : le jour reste possible, avec la précision. Au déplacement manuel, tout s'affiche en avertissement.
 * @returns {{code:string, level:'refuse'|'warn', message:string}[]}
 */
export function placementConstraints(state, work, date, {catalog = null, zvAuto = null, planned = null} = {}) {
  const out = [], day = day10(date);
  if (!work || !day) return out;
  const parcel = active(state, 'parcelles').find(p => p.id === work.parcelId) || null;
  const placed = {...work, date: day, plannedDate: day};
  // Index par parcelle : la fonction est appelée pour chaque travail et chaque jour de la semaine.
  const others = (parcelIndex(state).works.get(work.parcelId) || []).filter(t => t.id !== work.id);
  const proposedHere = [...(planned?.values() || [])].filter(p => p.work.id !== work.id && p.work.parcelId === work.parcelId);
  // Zone vulnérable : épandage pendant une période d'interdiction.
  if (isFertilization(work)) {
    const hit = banFor(state, placed, parcel, day, zvAuto);
    if (hit) out.push({code: 'zv', level: 'refuse', message: `épandage interdit en zone vulnérable (${hit.source}) jusqu’au ${localDate(hit.until)}`});
  }
  if (isTreatment(work)) {
    // Traitement : récolte saisie ou prévue dans le délai avant récolte, AMM retirée à cette date.
    const check = checkTreatment(state, placed, {catalog});
    for (const b of check.blocking) if (b.code === 'dar' || b.code === 'withdrawn') out.push({code: b.code, level: 'refuse', message: lowerFirst(b.message)});
    // Récolte proposée dans cette même semaine.
    const dar = check.limits?.dar;
    if (dar !== null && dar !== undefined) {
      const start = at(day), end = darEnd(start, dar);
      for (const p of proposedHere) if (isHarvest(p.work) && at(p.date) >= start && at(p.date) < end)
        out.push({code: 'dar', level: 'refuse', message: `${p.work.type || 'récolte'} proposée le ${localDate(p.date)}, dans le délai avant récolte de ${dar} jours`});
    }
    // Animaux au pré ce jour-là sur la parcelle.
    const grazing = summarizeParcelGrazing(state?.grazingSessions, work.parcelId, {date: new Date(`${day}T12:00:00`)});
    if (grazing.total > 0) out.push({code: 'grazing', level: 'refuse', message: `${grazing.total} ${grazing.total > 1 ? 'animaux' : 'animal'} au pré sur ${parcel?.nom || 'la parcelle'} : traiter après leur sortie`});
    return out;
  }
  const treatments = [...others.filter(t => isTreatment(t) && !planned?.has(t.id)), ...proposedHere.filter(p => isTreatment(p.work)).map(p => p.work)];
  // Récolte ou fauche dans le délai avant récolte d'un traitement fait, en cours, prévu ou proposé.
  if (isHarvest(work)) for (const t of treatments) {
    const when = treatmentDay(t, planned);
    if (!when || when > day) continue;
    const dar = limitsFor(productFor(state, t, {catalog})?.sheet || null, t, parcel).dar;
    if (dar === null || dar === undefined) continue;
    const end = darEnd(at(when), dar);
    if (at(day) < end) out.push({code: 'dar-harvest', level: 'refuse',
      message: `délai avant récolte de ${dar} jours après ${t.product || t.type || 'traitement'} du ${localDate(when)}, jusqu’au ${localDate(dayIso(end))}`});
  }
  // Délai de rentrée d'un traitement fait, en cours ou proposé (un traitement seulement prévu n'est pas certain).
  const start = at(day, DAY_START), end = at(day, DAY_END);
  for (const t of treatments) {
    const sure = completed(t) || t.status === 'En cours' || planned?.has(t.id);
    const when = sure ? treatmentDay(t, planned) : null;
    if (!when || when > day) continue;
    const until = reentryUntil({...t, date: when}, productFor(state, t, {catalog})?.sheet || null);
    if (!until || until <= start) continue;
    const what = t.product || t.type || 'traitement';
    out.push(until >= end ? {code: 'reentry', level: 'refuse', message: `délai de rentrée après ${what} jusqu’à ${dayLabel(until, day)}`}
      : {code: 'reentry', level: 'warn', message: `après ${clockOf(until)} (délai de rentrée après ${what})`});
  }
  return out;
}

// Messages de phyto.js (« Récolte prévue le … », « AMM retirée … ») repris en milieu de phrase. Seuls ces débuts
// connus passent en minuscule : un message qui commence par un nom de parcelle le garde intact.
function lowerFirst(text) { const s = String(text || ''); return /^(Récolte|Lot de récolte)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function dayLabel(ms, day) {
  const d = new Date(ms), iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return iso === day ? clockOf(ms) : `${localDate(iso)} ${clockOf(ms)}`;
}
