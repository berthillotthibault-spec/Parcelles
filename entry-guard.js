// Garde-fou de saisie d’un travail, fondé sur l’historique de l’exploitation. Il SIGNALE sans bloquer :
// le formulaire affiche les points à vérifier et un second appui sur « Enregistrer » confirme.
// - surface travaillée plus grande que la parcelle ;
// - dose très éloignée des doses habituelles (même produit et même unité, sinon même culture et même type) :
//   virgule oubliée, mauvaise unité ;
// - même produit déjà appliqué ou prévu sur la parcelle à moins de 7 jours.
// Ces erreurs faussent l’IFT, l’azote, les stocks et les marges. Module pur, aucune écriture.
import {normalize} from './utils.js';
import {workCulture} from './habits.js';

export const GUARD_DOSE_RATIO = 3, GUARD_MIN_HISTORY = 2, GUARD_REPEAT_DAYS = 7, GUARD_SURFACE_MARGIN = 1.05;
const CANCELLED = new Set(['Annulé', 'Annulée']);
const DONE = new Set(['Terminé', 'Terminée']);

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const day = value => {const s = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';};
// Date d’un travail : réalisation s’il est fait, échéance (plannedDate, déplacée par un report) s’il est prévu.
const workDay = w => DONE.has(w?.status || 'Terminé') ? day(w?.date) || day(w?.plannedDate) : day(w?.plannedDate) || day(w?.date);
const dayMs = s => Date.parse(`${s}T12:00:00Z`);
const fr = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
const ddMonth = iso => {const d = new Date(`${iso}T12:00:00`); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'}) : iso;};
const unitOf = w => normalize(w?.doseUnit || '');
function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Points à vérifier pour un travail sur le point d’être enregistré.
 * @param {any} state
 * @param {any} work travail tel qu’il sera écrit (parcelId, type, product, dose, doseUnit, surfaceWorked, date, plannedDate, status)
 * @param {{ignoreIds?:string[]}} [options] travaux à ne pas comparer (le travail lui-même, ceux du même lot de saisie)
 * @returns {{code:string, field:string, message:string}[]}
 */
export function workEntryWarnings(state, work, {ignoreIds = []} = {}) {
  if (!state || !work) return [];
  const ignore = new Set([work.id, ...ignoreIds].filter(Boolean));
  const others = (state.interventions || []).filter(w => w && !w.deletedAt && !ignore.has(w.id) && !CANCELLED.has(w.status));
  const parcel = (state.parcelles || []).find(p => p && !p.deletedAt && p.id === work.parcelId) || null;
  const parcelName = parcel?.nom || parcel?.name || 'la parcelle';
  const out = [];

  const surface = num(work.surfaceWorked), parcelHa = num(parcel?.surfaceHa);
  if (surface !== null && parcelHa !== null && parcelHa > 0 && surface > parcelHa * GUARD_SURFACE_MARGIN + 0.05)
    out.push({code: 'surface', field: 'surfaceWorked', message: `Surface travaillée ${fr(surface)} ha pour ${parcelName}, qui fait ${fr(parcelHa)} ha.`});

  const dose = num(work.dose), product = normalize(work.product || ''), unit = unitOf(work);
  if (dose !== null && dose > 0) {
    const sameUnit = others.filter(w => unitOf(w) === unit && (num(w.dose) ?? 0) > 0);
    let pool = product ? sameUnit.filter(w => normalize(w.product || '') === product) : [];
    let about = product ? String(work.product).trim() : '';
    if (pool.length < GUARD_MIN_HISTORY) {
      const culture = normalize(workCulture(state, work)), type = normalize(work.type || '');
      pool = type ? sameUnit.filter(w => normalize(w.type || '') === type && normalize(workCulture(state, w)) === culture && (!product || !normalize(w.product || '') || normalize(w.product || '') === product)) : [];
      about = `${work.type}${culture ? ` sur ${workCulture(state, work)}` : ''}`;
    }
    const usual = pool.length >= GUARD_MIN_HISTORY ? median(pool.map(w => num(w.dose))) : null;
    if (usual && (dose / usual >= GUARD_DOSE_RATIO || usual / dose >= GUARD_DOSE_RATIO)) {
      const u = work.doseUnit ? ` ${work.doseUnit}` : '';
      out.push({code: 'dose', field: 'dose', message: `Dose ${fr(dose)}${u} : d’habitude ${fr(usual)}${u} pour ${about} (${pool.length} saisies). Vérifiez la virgule ou l’unité.`});
    }
  }

  const when = workDay(work);
  if (product && when && work.parcelId) {
    const near = others.filter(w => w.parcelId === work.parcelId && normalize(w.product || '') === product)
      .map(w => ({w, d: workDay(w)}))
      .filter(x => x.d && Math.abs(dayMs(x.d) - dayMs(when)) < GUARD_REPEAT_DAYS * 86400000)
      .sort((a, b) => Math.abs(dayMs(a.d) - dayMs(when)) - Math.abs(dayMs(b.d) - dayMs(when)))[0];
    if (near) out.push({code: 'repeat', field: 'product', message: `${String(work.product).trim()} déjà ${DONE.has(near.w.status || 'Terminé') ? 'appliqué' : 'prévu'} sur ${parcelName} le ${ddMonth(near.d)} (${near.w.type || 'travail'}).`});
  }
  return out;
}

/** Points à vérifier pour plusieurs travaux saisis ensemble (sans se comparer entre eux), sans doublon de message. */
export function worksEntryWarnings(state, works = []) {
  const list = (Array.isArray(works) ? works : []).filter(Boolean);
  const ids = list.map(w => w.id).filter(Boolean), seen = new Set(), out = [];
  for (const w of list) for (const warning of workEntryWarnings(state, w, {ignoreIds: ids})) {
    if (seen.has(warning.message)) continue;
    seen.add(warning.message); out.push(warning);
  }
  return out;
}

/** Signature d’une liste d’avertissements : un second appui ne confirme que les mêmes points. */
export const warningsSignature = warnings => (warnings || []).map(w => w.message).join('\n');
