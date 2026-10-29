// @ts-check
// Vue Troupeau (n° 160) : logique pure qui agrège l'existant, sans nouvelle donnée.
// Lots au pré = sessions de pâturage en cours (grazing.js) ; animaux au bâtiment = fiches présentes du troupeau
// hors d'un lot au pré (herd.js) ; « À venir » = vêlages prévus, notifications BDNI et rappels sanitaires
// des 14 prochains jours ; destinations de « Déplacer » = prairies (isForageParcel) avec leur occupation et leur repos.
// Aucune durée de séjour cible n'existe dans grazing.js : la vue affiche « Jour N » sans barre de progression.
import {filterGrazingSessions, grazingTotal, grazingAnimalList, isForageParcel, stockingRate, grazingDate} from './grazing.js';
import {lotLabel, animalLot, filterAnimals} from './herd.js';
import {expectedCalvings, pendingBdni} from './home-priorities.js';
import {healthReminders} from './herd-health.js';

const DAY = 864e5;
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const daysBetween = (from, to) => Math.max(0, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY));
const animalsKey = session => grazingAnimalList(session).map(a => a.animalId || a.number || a.name || '').sort().join('|');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Lots au pré, du plus ancien au plus récent : nom, effectif, parcelle, jour de présence.
 * @param {any} state @param {{today: string}} options
 */
export function herdLots(state, {today}) {
  const names = new Map(live(state?.parcelles).map(p => [p.id, p.nom]));
  return filterGrazingSessions(state?.grazingSessions || [], {status: 'current', date: new Date(`${today}T12:00:00`)})
    .map(s => ({id: s.id, session: s, name: lotLabel(s) || 'Lot', n: grazingTotal(s), parcelId: s.parcelId,
      parcelName: names.get(s.parcelId) || 'Parcelle', startDate: grazingDate(s.startDate), days: daysBetween(grazingDate(s.startDate), today) + 1}))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'fr'));
}

/**
 * Animaux enregistrés présents qui ne sont dans aucun lot au pré (donc au bâtiment).
 * @param {any} state @param {{today: string}} options
 */
export function animalsInside(state, {today}) {
  const lots = herdLots(state, {today});
  const out = new Set(lots.map(l => l.id));
  const sessions = live(state?.grazingSessions);
  // Un lot déplacé (moveGrazingLot) est clos puis rouvert ailleurs le même jour avec le même nom, le même effectif et les mêmes animaux :
  // l'animal rattaché au passage d'origine suit le lot jusqu'à son passage actuel.
  const follow = lot => {
    for (let i = 0; lot && !out.has(lot.id) && lot.endDate && i < 50; i++) {
      const end = grazingDate(lot.endDate);
      const from = lot, key = animalsKey(from);
      lot = sessions.find(s => s.id !== from.id && grazingDate(s.startDate) === end && (s.note || '') === (from.note || '')
        && (s.animalType || '') === (from.animalType || '') && grazingTotal(s) === grazingTotal(from) && animalsKey(s) === key) || null;
    }
    return lot;
  };
  return filterAnimals(state, {status: 'present', today}).filter(a => !out.has(follow(animalLot(state, a, {today}) || sessions.find(x => x.id === a.sessionId) || null)?.id));
}

/**
 * Sous-ligne de la vue : « 55 animaux · 46 au pré ».
 * @param {any} state @param {{today: string}} options
 */
export function herdHeadline(state, {today}) {
  const out = herdLots(state, {today}).reduce((sum, lot) => sum + lot.n, 0);
  const inside = animalsInside(state, {today}).length;
  const total = out + inside;
  if (!total) return 'Aucun animal enregistré ni au pré';
  return `${total} anima${total > 1 ? 'ux' : 'l'} · ${out} au pré`;
}

/**
 * Échéances des 14 prochains jours (et retards) : vêlages prévus, BDNI à notifier, rappels sanitaires.
 * @param {any} state @param {{today: string, horizon?: number}} options
 * @returns {{date: string, title: string, sub: string, action: string, id: string}[]}
 */
export function herdUpcoming(state, {today, horizon = 14}) {
  const until = addDays(today, horizon);
  const lots = new Map(herdLots(state, {today}).map(l => [l.id, l.name]));
  const calvings = expectedCalvings(state, {today, horizon, past: 0}).map(r => ({
    date: r.date, title: `Vêlage prévu · ${r.animal?.name || r.label}`,
    sub: [r.animal?.nationalId ? `n° ${r.animal.nationalId}` : '', lots.get(animalLot(state, r.animal, {today})?.id) || ''].filter(Boolean).join(' · ') || r.label,
    action: 'open-herd-animal', id: r.animal?.id || ''}));
  const bdni = pendingBdni(state, today).filter(r => r.deadline <= until).map(r => ({
    date: r.deadline, title: `Notification BDNI · ${r.calf?.name || r.calf?.nationalId || 'veau'}`,
    sub: r.status === 'late' ? 'Délai de 7 jours dépassé' : `Mère : ${r.mother?.name || r.mother?.nationalId || 'non nommée'}`,
    action: 'open-herd-animal', id: r.mother?.id || ''}));
  const health = healthReminders(state, {today}).filter(r => r.due && r.due <= until && r.status !== 'ok').map(r => ({
    date: String(r.due), title: String(r.label), sub: r.text || '', action: 'open-herd-health', id: ''}));
  return [...calvings, ...bdni, ...health].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Destinations de « Déplacer » : prairies hors de la parcelle actuelle, occupation et repos.
 * @param {any} state @param {{fromParcelId?: string|null, today: string}} options
 */
export function moveDestinations(state, {fromParcelId = null, today}) {
  const lots = herdLots(state, {today});
  return live(state?.parcelles).filter(p => !p.archived && p.id !== fromParcelId && isForageParcel(p, state?.grazingSessions || []))
    .map(p => {
      const occupant = lots.find(l => l.parcelId === p.id);
      const rate = stockingRate(state, p.id, {date: new Date(`${today}T12:00:00`)});
      const status = occupant ? `occupé par ${occupant.name.toLowerCase()}`
        : rate.restDays === null ? 'libre' : rate.rested ? 'libre · repousse OK' : `libre · repos ${rate.restDays} j sur ${rate.advisedRest}`;
      return {parcel: p, occupied: Boolean(occupant), status};
    })
    .sort((a, b) => Number(a.occupied) - Number(b.occupied) || String(a.parcel.nom).localeCompare(String(b.parcel.nom), 'fr'));
}
