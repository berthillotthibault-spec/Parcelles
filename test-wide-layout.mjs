import test from 'node:test';
import assert from 'node:assert/strict';
import {columnMode,slotForCard,orderCards,addDays,weekAgenda,pendingTasks,miniMapShapes} from './wide-layout.js';

test('columnMode : une, deux ou trois colonnes selon la largeur', () => {
  assert.equal(columnMode(390), 'single');
  assert.equal(columnMode(1099), 'single');
  assert.equal(columnMode(1100), 'two');
  assert.equal(columnMode(1280), 'two');
  assert.equal(columnMode(1440), 'three');
  assert.equal(columnMode(undefined), 'single');
});

test('slotForCard : météo et alertes à droite, activité récente en troisième colonne', () => {
  assert.equal(slotForCard('today', 'two'), 'main');
  assert.equal(slotForCard('tasks', 'three'), 'main');
  assert.equal(slotForCard('weather', 'two'), 'side');
  assert.equal(slotForCard('alerts', 'three'), 'side');
  assert.equal(slotForCard('recent', 'two'), 'side');
  assert.equal(slotForCard('recent', 'three'), 'extra');
  assert.equal(slotForCard('weather', 'single'), 'main');
  assert.equal(slotForCard('inconnu', 'two'), 'main');
});

test('orderCards garde l’ordre de Personnaliser et met les inconnus à la fin', () => {
  assert.deepEqual(orderCards(['weather', 'today', 'tasks', 'x'], ['tasks', 'weather', 'today']), ['tasks', 'weather', 'today', 'x']);
  assert.deepEqual(orderCards(['b', 'a'], []), ['b', 'a']);
});

test('addDays traverse les mois et refuse une date invalide', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('demain', 1), '');
});

test('weekAgenda range les éléments à faire à leur échéance sur sept jours', () => {
  const data = {
    interventions: [
      {id: 'w1', type: 'Semis', date: '2026-10-07', plannedDate: '2026-10-07', status: 'À faire', startTime: '14:00'},
      {id: 'w2', type: 'Récolte', date: '2026-10-07', status: 'À faire', startTime: '08:30'},
      {id: 'w3', type: 'Labour', date: '2026-10-05', status: 'À faire'},
      {id: 'w4', type: 'Fait', date: '2026-10-08', status: 'Terminé'},
      {id: 'w5', type: 'Annulé', date: '2026-10-08', status: 'Annulé'},
      {id: 'w6', type: 'Loin', date: '2026-10-20', status: 'À faire'},
      {id: 'w7', type: 'Supprimé', date: '2026-10-08', status: 'À faire', deletedAt: 1}
    ],
    tasks: [{id: 't1', title: 'Clôture', dueDate: '2026-10-09', status: 'À faire'}, {id: 't2', title: 'Sans date', status: 'À faire'}]
  };
  const week = weekAgenda(data, '2026-10-07');
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].isToday, true);
  assert.deepEqual(week.days[0].items.map(i => i.id), ['w2', 'w1']);
  assert.equal(week.days[1].items.length, 0);
  assert.deepEqual(week.days[2].items.map(i => [i.id, i.kind]), [['t1', 'task']]);
  assert.equal(week.overdue, 1);
  assert.equal(week.total, 3);
  assert.deepEqual(weekAgenda({}, 'x'), {days: [], overdue: 0, total: 0});
});

test('pendingTasks trie par échéance et compte le total', () => {
  const r = pendingTasks({tasks: [
    {id: 'a', title: 'A', status: 'À faire'}, {id: 'b', title: 'B', dueDate: '2026-10-09', status: 'À faire'},
    {id: 'c', title: 'C', dueDate: '2026-10-01', status: 'À faire'}, {id: 'd', title: 'D', status: 'Terminé'}
  ]}, 2);
  assert.deepEqual(r.items.map(t => t.id), ['c', 'b']);
  assert.equal(r.total, 3);
});

test('miniMapShapes projette les contours et met en avant les parcelles du jour', () => {
  const sq = (x, y) => ({type: 'Polygon', coordinates: [[[x, y], [x + .01, y], [x + .01, y + .01], [x, y + .01], [x, y]]]});
  const r = miniMapShapes([
    {id: 'p1', nom: 'A', geometry: sq(5, 46)},
    {id: 'p2', nom: 'B', geometry: {type: 'MultiPolygon', coordinates: [sq(5.02, 46).coordinates]}},
    {id: 'p3', nom: 'Sans contour'},
    {id: 'p4', nom: 'Archivée', archived: true, geometry: sq(6, 47)},
    {id: 'p5', nom: 'Invalide', geometry: {type: 'Polygon', coordinates: [[[999, 0], [1, 1]]]}}
  ], ['p1'], {width: 300, height: 200, pad: 8});
  assert.equal(r.shapes.length, 2);
  assert.equal(r.focusCount, 1);
  assert.equal(r.shapes.at(-1).id, 'p1');
  for (const s of r.shapes) {
    const nums = s.d.match(/-?\d+(\.\d+)?/g).map(Number);
    assert.ok(nums.every(n => n >= 0 && n <= 300), s.d);
  }
  assert.equal(miniMapShapes([{id: 'x'}], []), null);
  assert.equal(miniMapShapes(null), null);
});
