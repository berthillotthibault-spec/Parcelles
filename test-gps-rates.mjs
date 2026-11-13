import test from 'node:test';
import assert from 'node:assert/strict';
import {median, robustRate, gpsPasses, gpsRateFor, gpsRateNote} from './gps-rates.js';
import {workDuration, weeklyLoad, proposePlan} from './farm-planner.js';

const gps = {start: 1, end: 2, samples: 10};
const pass = (id, type, ha, h, extra = {}) => ({id, parcelId: 'p1', type, status: 'Terminé', date: '2026-10-01', duration: h, surfaceWorked: ha, gpsPresence: gps, ...extra});
const state = works => ({parcelles: [{id: 'p1', nom: 'Grand champ', surfaceHa: 10}], interventions: works});

test('médiane et écart des valeurs aberrantes', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  const r = robustRate([2, 2.1, 1.9, 2, 20]);
  assert.equal(r.value, 2);
  assert.equal(r.dropped, 1);
});

test('au moins 3 passages GPS, travaux sans présence ignorés', () => {
  const two = state([pass('a', 'Semis', 4, 2), pass('b', 'Semis', 6, 3), {...pass('c', 'Semis', 1, 5), gpsPresence: null}]);
  assert.equal(gpsRateFor(two, {type: 'Semis'}), null);
  const three = state([pass('a', 'Semis', 4, 2), pass('b', 'Semis', 6, 3), pass('c', 'semis', 2, 1)]);
  const r = gpsRateFor(three, {type: 'Semis'});
  assert.equal(r.haPerHour, 2);
  assert.equal(r.samples, 3);
  assert.equal(r.label, 'd’après vos 3 passages GPS');
  assert.match(gpsRateNote(r), /2 ha\/h en médiane/);
});

test('annulés, supprimés et prévus exclus', () => {
  const s = state([pass('a', 'Semis', 4, 2, {status: 'Annulé'}), pass('b', 'Semis', 4, 2, {deletedAt: 1}), pass('c', 'Semis', 4, 2, {status: 'Prévu'})]);
  assert.equal(gpsPasses(s).length, 0);
});

test('matériel prioritaire quand il a assez de passages', () => {
  const s = state([
    pass('a', 'Semis', 5, 1, {equipmentId: 'm1'}), pass('b', 'Semis', 5, 1, {equipmentId: 'm1'}), pass('c', 'Semis', 5, 1, {equipmentId: 'm1'}),
    pass('d', 'Semis', 1, 1, {equipmentId: 'm2'})
  ]);
  const r = gpsRateFor(s, {type: 'Semis', equipmentId: 'm1'});
  assert.equal(r.haPerHour, 5);
  assert.equal(r.withMachine, true);
  const other = gpsRateFor(s, {type: 'Semis', equipmentId: 'm2'});
  assert.equal(other.withMachine, false);
  assert.equal(other.samples, 4);
});

test('workDuration utilise le débit GPS, sinon le débit par défaut', () => {
  const passes = [pass('a', 'Semis', 4, 2), pass('b', 'Semis', 6, 3), pass('c', 'Semis', 2, 1)];
  const planned = {id: 'w', parcelId: 'p1', type: 'Semis', status: 'Prévu', plannedDate: '2026-11-16'};
  const d = workDuration(planned, state([...passes, planned]));
  assert.equal(d.source, 'gps');
  assert.equal(d.hours, 5);
  assert.equal(d.confidence, 'Durée d’après vos 3 passages GPS');
  assert.equal(weeklyLoad(state([...passes, planned]), '2026-11-16')[0].hours, 5);
  const manual = [pass('a', 'Semis', 4, 2, {gpsPresence: null}), pass('b', 'Semis', 6, 3, {gpsPresence: null}), pass('c', 'Semis', 2, 1, {gpsPresence: null})];
  const fallback = workDuration(planned, state([...manual, planned]));
  assert.notEqual(fallback.source, 'gps');
  assert.equal(fallback.confidence, 'Estimation historique');
  assert.equal(workDuration({...planned, duration: 1.5}, state([...passes])).hours, 1.5);
});

test('planning du jour : la source GPS n’est pas répétée en « références »', () => {
  const passes = [pass('a', 'Semis', 4, 2), pass('b', 'Semis', 6, 3), pass('c', 'Semis', 2, 1)];
  const planned = {id: 'w', parcelId: 'p1', type: 'Semis', status: 'Prévu', plannedDate: '2026-11-16'};
  const plan = proposePlan(state([...passes, planned]), [planned], {date: '2026-11-16'});
  const reasons = plan.rows[0].reasons;
  assert.ok(reasons.includes('Durée d’après vos 3 passages GPS'));
  assert.ok(!reasons.some(r => /références/.test(r)));
});

test('un matériel avec son propre historique garde son débit plutôt que le débit GPS tous matériels', () => {
  const passes = [pass('a', 'Semis', 5, 1, {equipmentId: 'm1'}), pass('b', 'Semis', 5, 1, {equipmentId: 'm1'}), pass('c', 'Semis', 5, 1, {equipmentId: 'm1'})];
  const own = ['x', 'y', 'z'].map(id => ({id, parcelId: 'p1', type: 'Semis', status: 'Terminé', date: '2026-09-01', duration: 2, surfaceWorked: 2, equipmentId: 'm2'}));
  const planned = {id: 'n', parcelId: 'p1', type: 'Semis', status: 'À faire', equipmentId: 'm2'};
  const d = workDuration(planned, state([...passes, ...own, planned]));
  assert.equal(d.source, undefined);
  assert.equal(d.hours, 10, '1 h/ha propre au matériel m2');
  const fresh = workDuration({...planned, equipmentId: 'm3'}, state([...passes, planned]));
  assert.equal(fresh.source, 'gps', 'matériel sans historique : débit GPS du type');
});
