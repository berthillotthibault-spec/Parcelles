import test from 'node:test';
import assert from 'node:assert/strict';
import {herdLots, animalsInside, herdHeadline, herdUpcoming, moveDestinations} from './herd-home.js';

const TODAY = '2026-10-28';
const state = () => ({
  parcelles: [
    {id: 'p3', nom: 'Pré du Moulin', culture: 'Prairie permanente', surfaceHa: 5.6},
    {id: 'p7', nom: 'La Croix', culture: 'Prairie temporaire', surfaceHa: 4.3},
    {id: 'p8', nom: 'Le Grand Pré', culture: 'Prairie permanente', surfaceHa: 3.9},
    {id: 'p1', nom: 'Les Grands Champs', culture: 'Blé tendre', surfaceHa: 12.4}
  ],
  grazingSessions: [
    {id: 'g1', parcelId: 'p3', startDate: '2026-10-23', animalsCount: 32, note: 'Vaches laitières'},
    {id: 'g2', parcelId: 'p7', startDate: '2026-10-18', animalsCount: 14, note: 'Génisses'},
    {id: 'g0', parcelId: 'p8', startDate: '2026-08-01', endDate: '2026-09-01', animalsCount: 10, note: 'Taurillons'}
  ],
  animals: [
    {id: 'a1', nationalId: 'FR0112344521', name: 'Marguerite', sex: 'F', sessionId: 'g1', entryDate: '2020-01-01'},
    {id: 'a2', nationalId: 'FR0112349999', name: 'Taureau', sex: 'M', entryDate: '2020-01-01'}
  ],
  animalEvents: [{id: 'e1', animalId: 'a1', kind: 'insemination', date: '2026-01-24'}],
  tasks: [], vetTreatments: [], preferences: {}
});

test('lots au pré : jours de présence, du plus ancien au plus récent', () => {
  const lots = herdLots(state(), {today: TODAY});
  assert.deepEqual(lots.map(l => [l.name, l.n, l.parcelName, l.days]), [['Génisses', 14, 'La Croix', 11], ['Vaches laitières', 32, 'Pré du Moulin', 6]]);
});

test('au bâtiment et sous-ligne', () => {
  assert.deepEqual(animalsInside(state(), {today: TODAY}).map(a => a.id), ['a2']);
  assert.equal(herdHeadline(state(), {today: TODAY}), '47 animaux · 46 au pré');
  assert.equal(herdHeadline({parcelles: [], grazingSessions: [], animals: []}, {today: TODAY}), 'Aucun animal enregistré ni au pré');
});

test('à venir : vêlage prévu dans les 14 jours', () => {
  const rows = herdUpcoming(state(), {today: TODAY});
  const calving = rows.find(r => r.title.startsWith('Vêlage prévu'));
  assert.ok(calving, JSON.stringify(rows));
  assert.equal(calving.title, 'Vêlage prévu · Marguerite');
  assert.equal(calving.action, 'open-herd-animal');
  assert.match(calving.sub, /FR0112344521/);
  assert.ok(rows.every(r => r.date <= '2026-11-11'));
});

test('déplacer : prairies seulement, sans la parcelle actuelle, libres d’abord', () => {
  const rows = moveDestinations(state(), {fromParcelId: 'p3', today: TODAY});
  assert.deepEqual(rows.map(r => r.parcel.id), ['p8', 'p7']);
  assert.match(rows[0].status, /^libre/);
  assert.equal(rows[1].status, 'occupé par génisses');
});

test('lot déplacé : l’animal rattaché au passage d’origine reste dans le lot (pas de double compte)', () => {
  const s = state();
  s.grazingSessions[0] = {...s.grazingSessions[0], endDate: '2026-10-27'};
  s.grazingSessions.push({id: 'g1b', parcelId: 'p8', startDate: '2026-10-27', animalsCount: 32, note: 'Vaches laitières'});
  assert.deepEqual(animalsInside(s, {today: TODAY}).map(a => a.id), ['a2']);
  assert.equal(herdHeadline(s, {today: TODAY}), '47 animaux · 46 au pré');
});
