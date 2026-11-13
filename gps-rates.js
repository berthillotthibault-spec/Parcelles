// Débits réels appris des passages GPS : surface travaillée / temps de présence mesuré.
// Module pur : aucune écriture, testable sous node.
import {normalize} from './utils.js';
import {active,completed} from './farm-memory.js';

export const GPS_MIN_PASSES = 3;
const MAX_HA_PER_HOUR = 60;
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

export function median(values) {
  const s = [...values].sort((a, b) => a - b), n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Écarte les valeurs aberrantes (écart à la médiane > 3 écarts absolus médians normalisés).
export function robustRate(values) {
  const med = median(values);
  if (med === null) return {value: null, kept: 0, dropped: 0};
  const mad = median(values.map(v => Math.abs(v - med))) * 1.4826;
  const kept = mad > 0 ? values.filter(v => Math.abs(v - med) <= 3 * mad) : values;
  return {value: median(kept), kept: kept.length, dropped: values.length - kept.length};
}

// Passage GPS exploitable : travail terminé, présence mesurée, durée et surface positives.
export function gpsPasses(state) {
  return active(state, 'interventions').filter(w => w.status !== 'Annulé' && w.status !== 'Annulée' && completed(w) && w.gpsPresence)
    .map(w => {
      const hours = positive(Number(w.duration)), area = positive(Number(w.surfaceWorked));
      return hours && area ? {type: normalize(w.type), equipmentId: w.equipmentId || '', rate: area / hours} : null;
    })
    .filter(p => p && p.type && p.rate <= MAX_HA_PER_HOUR);
}

const plural = n => `${n} passage${n > 1 ? 's' : ''} GPS`;

// Débit appris pour un travail : par type et matériel si assez de passages, sinon par type seul.
export function gpsRateFor(state, work, {minPasses = GPS_MIN_PASSES, passes = gpsPasses(state)} = {}) {
  const type = normalize(work?.type);
  if (!type) return null;
  const sameType = passes.filter(p => p.type === type);
  const tries = work.equipmentId ? [[sameType.filter(p => p.equipmentId === work.equipmentId), true], [sameType, false]] : [[sameType, false]];
  for (const [list, withMachine] of tries) {
    if (list.length < minPasses) continue;
    const r = robustRate(list.map(p => p.rate));
    if (r.value === null || r.kept < minPasses) continue;
    const label = `d’après vos ${plural(r.kept)}${withMachine ? ' avec ce matériel' : ''}`;
    return {haPerHour: r.value, samples: r.kept, dropped: r.dropped, withMachine, label};
  }
  return null;
}

// Phrase « pourquoi » : débit, nombre de passages, valeurs écartées.
export function gpsRateNote(rate) {
  if (!rate) return '';
  const ha = rate.haPerHour.toLocaleString('fr-FR', {maximumFractionDigits: 2});
  const out = rate.dropped ? `, ${rate.dropped} valeur${rate.dropped > 1 ? 's' : ''} atypique${rate.dropped > 1 ? 's' : ''} écartée${rate.dropped > 1 ? 's' : ''}` : '';
  return `Durée ${rate.label} : ${ha} ha/h en médiane${out}.`;
}
