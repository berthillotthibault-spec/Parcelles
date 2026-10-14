import test from 'node:test';
import assert from 'node:assert/strict';
import {countdownLabel, formatSpan, msToNextMinute, pickFollowing, followingLabel, dayWord, weatherChip, weatherWindow, actionStart, entryTitle} from './next-action.js';
import {silhouettePath} from './parcel-silhouette.js';
import {getHomeAgenda} from './home-priorities.js';

const NOW = new Date(2026, 9, 14, 6, 20); // 14 oct. 2026, 06:20 locale
const TODAY = '2026-10-14';
const work = (id, type, date, startTime, extra = {}) => ({item: {id, type, startTime, status: 'À faire', ...extra}, kind: 'work', date, overdue: Boolean(date) && date < TODAY});

test('compte à rebours : dans, depuis, maintenant et sans heure', () => {
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '08:30'), NOW), 'dans 2 h 10');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '07:00'), NOW), 'dans 40 min');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '05:45'), NOW), 'depuis 35 min');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '06:20'), NOW), 'maintenant');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '04:20'), NOW), 'depuis 2 h');
  assert.equal(countdownLabel(work('a', 'Semis', '2026-10-17', '06:20'), NOW), 'dans 3 j');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, ''), NOW), '');
  assert.equal(countdownLabel(work('a', 'Semis', '', '08:00'), NOW), '');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '25:00'), NOW), '');
  assert.equal(countdownLabel(null, NOW), '');
  assert.equal(formatSpan(30000), '1 min');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '08:30'), new Date(2026, 9, 14, 6, 20, 30)), 'dans 2 h 10');
  assert.equal(countdownLabel(work('a', 'Semis', TODAY, '05:45'), new Date(2026, 9, 14, 6, 20, 50)), 'depuis 35 min');
  assert.equal(formatSpan(61000, true), '2 min');
  assert.equal(formatSpan(-125 * 60000), '2 h 05');
  assert.equal(actionStart(work('a', 'Semis', TODAY, '8:05')).getHours(), 8);
});

test('mise à jour calée sur la minute suivante', () => {
  assert.equal(msToNextMinute(new Date(2026, 9, 14, 6, 20, 15, 500)), 44500);
  assert.equal(msToNextMinute(new Date(2026, 9, 14, 6, 20, 0, 0)), 60000);
});

test('action suivante : saute l’action affichée, libellé lisible', () => {
  const data = {interventions: [
    {id: 'w1', type: 'Semis blé', plannedDate: TODAY, status: 'À faire', startTime: '14:00'},
    {id: 'w2', type: 'Récolte maïs', plannedDate: '2026-10-15', status: 'À faire', startTime: '08:30'},
    {id: 'w3', type: 'Labour', plannedDate: TODAY, status: 'Terminé'}
  ], tasks: [{id: 'w1', title: 'Même id, autre type', dueDate: '2026-10-20', status: 'À faire'}]};
  const agenda = getHomeAgenda(data, TODAY);
  const following = pickFollowing(agenda.entries, agenda.next);
  assert.equal(following.item.id, 'w2');
  assert.equal(followingLabel(following, TODAY), 'Récolte maïs · 08:30 demain');
  const after = pickFollowing(agenda.entries.slice(1), following);
  assert.equal(after.kind, 'task');
  assert.equal(followingLabel(after, TODAY), 'Même id, autre type · mar. 20 oct.');
  assert.equal(pickFollowing([agenda.next], agenda.next), null);
  assert.equal(pickFollowing(undefined, null), null);
  assert.equal(followingLabel(work('x', '', '2026-10-01', '09:00'), TODAY), 'Travail · en retard');
  assert.equal(followingLabel({item: {id: 't', title: 'Clôture'}, kind: 'task', date: '', overdue: false}, TODAY), 'Clôture · sans échéance');
  assert.equal(followingLabel(work('x', 'Semis', TODAY, '9:05'), TODAY), 'Semis · 09:05 aujourd’hui');
  assert.equal(entryTitle({item: {}, kind: 'task'}), 'Tâche');
  assert.equal(dayWord('2026-10-13', TODAY), 'hier');
  assert.equal(dayWord('2026-11-01', '2026-10-31'), 'demain');
});

const hourly = (rows, start = '2026-10-14T00:00') => {
  const base = Number(start.slice(11, 13));
  return {time: rows.map((_, i) => `${start.slice(0, 11)}${String(base + i).padStart(2, '0')}:00`),
    precipitation: rows.map(r => r[0]), precipitation_probability: rows.map(r => r[1]), temperature_2m: rows.map(r => r[2])};
};

test('pastille météo : pluie autour de l’heure, sec, rien sans météo', () => {
  const dryDay = Array.from({length: 24}, () => [0, 10, 12]);
  const wet = dryDay.map((r, h) => h === 15 ? [1.4, 80, 11] : r);
  const loadedAt = NOW.getTime() - 3600000;
  const at14 = work('a', 'Semis', TODAY, '14:00');
  assert.deepEqual(weatherChip({loadedAt, hourly: hourly(wet)}, at14, {today: TODAY, now: NOW}), {tone: 'rain', label: 'Pluie 15 h', title: 'Pluie prévue vers 15 h (1,4 mm, 80 %)'});
  assert.deepEqual(weatherChip({loadedAt, hourly: hourly(dryDay)}, at14, {today: TODAY, now: NOW}), {tone: 'dry', label: 'Sec · 12°', title: 'Pas de pluie prévue sur le créneau'});
  // Pluie hors créneau (19 h) : non signalée pour une action à 08:30 - 10:00.
  const late = dryDay.map((r, h) => h === 19 ? [3, 90, 9] : r);
  assert.equal(weatherChip({loadedAt, hourly: hourly(late)}, work('b', 'Récolte', TODAY, '08:30', {endTime: '10:00'}), {today: TODAY, now: NOW}).tone, 'dry');
  // Seule la probabilité suffit.
  const prob = dryDay.map((r, h) => h === 8 ? [0, 70, 9] : r);
  assert.equal(weatherChip({loadedAt, hourly: hourly(prob)}, work('b', 'Récolte', TODAY, '08:30'), {today: TODAY, now: NOW}).label, 'Pluie 8 h');
  assert.equal(weatherChip(null, at14, {today: TODAY, now: NOW}), null);
  assert.equal(weatherChip({hourly: {time: []}}, at14, {today: TODAY, now: NOW}), null);
  assert.equal(weatherChip({loadedAt: NOW.getTime() - 72 * 3600000, hourly: hourly(wet)}, at14, {today: TODAY, now: NOW}), null);
  // Créneau hors des prévisions (dans 10 jours) : rien.
  assert.equal(weatherChip({loadedAt, hourly: hourly(wet)}, work('c', 'Semis', '2026-10-24', '14:00'), {today: TODAY, now: NOW}), null);
  // Prévisions sans pluie renseignée : rien plutôt qu’un faux « Sec ».
  assert.equal(weatherChip({loadedAt, hourly: {time: hourly(dryDay).time, temperature_2m: dryDay.map(r => r[2])}}, at14, {today: TODAY, now: NOW}), null);
  // Sans heure, en retard ou sans échéance : reste de la journée à partir de maintenant.
  const soon = dryDay.map((r, h) => h === 9 ? [0.6, 40, 9] : r);
  assert.equal(weatherChip({loadedAt, hourly: hourly(soon)}, work('d', 'Labour', '2026-10-10', ''), {today: TODAY, now: NOW}).label, 'Pluie 9 h');
  assert.deepEqual(weatherWindow(work('d', 'Labour', '2026-10-16', ''), TODAY, NOW), {from: '2026-10-16T07:00', to: '2026-10-16T19:00'});
  assert.deepEqual(weatherWindow(work('e', 'Labour', TODAY, '05:00'), TODAY, NOW), {from: '2026-10-14T06:00', to: '2026-10-14T07:00'});
});

test('vignette : Polygon et MultiPolygon projetés, repli sans géométrie', () => {
  const sq = (x, y, d = 0.004) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
  const one = silhouettePath({type: 'Polygon', coordinates: sq(5.13, 46.34)}, 40);
  assert.match(one, /^M[\d. L]+Z$/);
  const multi = silhouettePath({type: 'MultiPolygon', coordinates: [sq(5.13, 46.34), sq(5.14, 46.34)]}, 40);
  assert.equal((multi.match(/M/g) || []).length, 2);
  assert.equal(silhouettePath(null, 40), '');
  assert.equal(silhouettePath({type: 'Point', coordinates: [5, 46]}, 40), '');
});
