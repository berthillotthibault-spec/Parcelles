// n° 36 — Sous-vues de Travaux : routes et navigation clavier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkRoute, workSubviewHash, normalizeSubview, normalizeCalendarMode, nextTabIndex, WORK_SUBVIEWS} from './work-subviews.js';

test('parseWorkRoute reconnaît #work et ses sous-vues, ignore les autres routes', () => {
  assert.equal(parseWorkRoute('work'), 'list');
  assert.equal(parseWorkRoute('#work/calendar'), 'calendar');
  assert.equal(parseWorkRoute('work/tasks'), 'tasks');
  assert.equal(parseWorkRoute('work/chantiers'), 'chantiers');
  assert.equal(parseWorkRoute('work/inconnu'), 'list');
  assert.equal(parseWorkRoute('map'), null);
  assert.equal(parseWorkRoute('parcel/work'), null);
  assert.equal(parseWorkRoute(''), null);
});

test('workSubviewHash est l’inverse de parseWorkRoute', () => {
  for (const sub of WORK_SUBVIEWS) assert.equal(parseWorkRoute(workSubviewHash(sub)), sub);
  assert.equal(workSubviewHash('list'), '#work');
  assert.equal(workSubviewHash('n’importe quoi'), '#work');
});

test('normalisations', () => {
  assert.equal(normalizeSubview('tasks'), 'tasks');
  assert.equal(normalizeSubview(undefined), 'list');
  assert.equal(normalizeCalendarMode('week'), 'week');
  assert.equal(normalizeCalendarMode('jour'), 'month');
});

test('nextTabIndex : flèches en boucle, Début et Fin', () => {
  assert.equal(nextTabIndex(0, 'ArrowRight', 4), 1);
  assert.equal(nextTabIndex(3, 'ArrowRight', 4), 0);
  assert.equal(nextTabIndex(0, 'ArrowLeft', 4), 3);
  assert.equal(nextTabIndex(2, 'Home', 4), 0);
  assert.equal(nextTabIndex(1, 'End', 4), 3);
  assert.equal(nextTabIndex(1, 'Enter', 4), 1);
  assert.equal(nextTabIndex(0, 'ArrowRight', 0), -1);
});
