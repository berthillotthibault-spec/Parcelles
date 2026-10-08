import test from 'node:test';
import assert from 'node:assert/strict';
import {dayRouteActions, dayRouteRecap, moveRouteKey, parcelRoutePoint, planDayRoute, stepTitle, travelMinutes} from './field-ops.js';

const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]});
const today = '2026-10-08';
const data = () => ({
  parcelles: [
    {id: 'a', nom: 'Les Brosses', surfaceHa: 4, geometry: sq(5.00, 46.00)},
    {id: 'b', nom: 'Grand Champ', surfaceHa: 8, geometry: sq(5.10, 46.00)},
    {id: 'c', nom: 'Le Pré Bas', surfaceHa: 3, geometry: sq(5.02, 46.00)},
    {id: 'z', nom: 'Supprimée', geometry: sq(6, 46), deletedAt: 1}
  ],
  points: [{id: 'e1', parcelId: 'b', type: 'Entrée de champ', latitude: 46.001, longitude: 5.099}],
  interventions: [
    {id: 'w1', parcelId: 'b', type: 'Fauche', status: 'À faire', plannedDate: today},
    {id: 'w2', parcelId: 'a', type: 'Semis', status: 'À faire', plannedDate: '2026-10-05'},
    {id: 'w3', parcelId: 'a', type: 'Récolte', status: 'À faire', plannedDate: '2026-10-12'},
    {id: 'w4', parcelId: 'c', type: 'Broyage', status: 'Terminé', date: today}
  ],
  tasks: [{id: 't1', title: 'Réparer clôture', parcelId: 'c', dueDate: today, status: 'À faire'}, {id: 't2', title: 'Appeler le vétérinaire', dueDate: today, status: 'À faire'}],
  grazingSessions: [{id: 'g1', parcelId: 'c', animalType: 'Vaches', animalsCount: 24, startDate: '2026-09-20'}],
  materiels: [{id: 'm1', nom: 'Tracteur 6155M', currentMeter: 1210, maintenanceDue: 1200, location: 'Hangar'}, {id: 'm2', nom: 'Faucheuse', currentMeter: 10, maintenanceDue: 300}],
  fieldSessions: [
    {id: 's1', parcelId: 'b', startedAt: new Date(2026, 9, 8, 8).getTime(), endedAt: new Date(2026, 9, 8, 9, 30).getTime()},
    {id: 's2', parcelId: 'b', startedAt: new Date(2026, 9, 8, 14).getTime(), endedAt: new Date(2026, 9, 8, 15).getTime()},
    {id: 's3', parcelId: 'a', startedAt: new Date(2026, 9, 7, 8).getTime(), endedAt: new Date(2026, 9, 7, 9).getTime()}
  ]
});

test('point de destination : entrée de champ prioritaire, sinon centre', () => {
  const d = data();
  assert.deepEqual(parcelRoutePoint(d.parcelles[1], d.points), {latitude: 46.001, longitude: 5.099, source: 'Entrée de champ'});
  assert.equal(parcelRoutePoint(d.parcelles[0], d.points).source, 'Centre de parcelle');
  assert.equal(parcelRoutePoint({id: 'x'}, []), null);
});

test('actions du jour : travaux et tâches du jour ou en retard, lots à déplacer, entretiens dus', () => {
  const keys = dayRouteActions(data(), today).map(a => a.key).sort();
  assert.deepEqual(keys, ['grazing:g1', 'maintenance:m1', 'task:t1', 'task:t2', 'work:w1', 'work:w2']);
  const grazing = dayRouteActions(data(), today).find(a => a.kind === 'grazing');
  assert.equal(grazing.label, 'Déplacer le lot');
  assert.match(grazing.detail, /24 Vaches · 18 j/);
  // Une étape déjà prévue reste visible une fois terminée.
  const kept = dayRouteActions(data(), today, {include: ['work:w4']}).find(a => a.key === 'work:w4');
  assert.equal(kept.done, true);
});

test('plus proche voisin depuis la position, actions sans lieu en dernier', () => {
  const plan = planDayRoute(dayRouteActions(data(), today), {latitude: 46.002, longitude: 5.001});
  assert.deepEqual(plan.map(s => s.key), ['work:w2', 'task:t1', 'grazing:g1', 'work:w1', 'task:t2', 'maintenance:m1']);
  assert.equal(plan[0].index, 0);
  assert.equal(plan[1].minutes > 0, true);
  assert.equal(plan[2].minutes, 0, 'même parcelle : sur place');
  assert.equal(plan[4].minutes, null);
  // Sans position : on part de la première action localisée.
  assert.equal(planDayRoute(dayRouteActions(data(), today), null)[0].minutes, null);
});

test('ordre enregistré respecté, nouvelles actions ajoutées au plus court', () => {
  const actions = dayRouteActions(data(), today);
  const plan = planDayRoute(actions, null, {order: ['work:w1', 'task:t1', 'inconnue']});
  assert.deepEqual(plan.slice(0, 2).map(s => s.key), ['work:w1', 'task:t1']);
  assert.equal(plan.length, actions.length);
  assert.ok(plan[1].distanceM > 1000);
});

test('réordonner une étape', () => {
  assert.deepEqual(moveRouteKey(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveRouteKey(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(moveRouteKey(['a', 'b', 'c'], 'x', 1), ['a', 'b', 'c']);
});

test('titre d’étape et temps de trajet', () => {
  assert.equal(stepTitle({index: 0, label: 'Fauche', place: 'Les Brosses', minutes: 6}, 5), '1/5 · Fauche · Les Brosses · 6 min');
  assert.equal(stepTitle({index: 1, label: 'Entretien · Tracteur', place: 'Hangar', minutes: null}, 5), '2/5 · Entretien · Tracteur · Hangar');
  assert.equal(travelMinutes(2500), 7);
  assert.equal(travelMinutes(null), null);
});

test('récapitulatif du soir : heures par parcelle, hectares, à reporter', () => {
  const d = data(), stops = planDayRoute(dayRouteActions(d, today), null);
  const r = dayRouteRecap(stops, ['work:w1', 'grazing:g1'], d, today);
  assert.equal(r.done, 2);
  assert.equal(r.total, 6);
  assert.equal(r.hectares, 8);
  assert.deepEqual(r.hoursByParcel, [{parcelId: 'b', name: 'Grand Champ', hours: 2.5}]);
  assert.deepEqual(r.remaining.map(s => s.key).sort(), ['maintenance:m1', 'task:t1', 'task:t2', 'work:w2']);
});
