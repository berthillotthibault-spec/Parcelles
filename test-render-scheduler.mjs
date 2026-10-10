// n° 145 : ordonnanceur de rendu (vue visible seulement, autres vues marquées).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRenderScheduler, mapSignature, viewsForEvent} from './render-scheduler.js';

function setup(view = 'today') {
  const calls = [], frames = [];let current = view, t = 0;
  const s = createRenderScheduler({render: v => {calls.push(v);t += 2;}, currentView: () => current, raf: cb => {frames.push(cb);return frames.length;}, clock: () => t});
  return {s, calls, frames, go: v => {current = v;}, tick: () => {const cb = frames.shift();cb?.();}};
}

test('après une modification, seule la vue visible est rendue, à la prochaine image et une seule fois', () => {
  const {s, calls, frames, tick} = setup('today');
  s.renderNow();calls.length = 0;
  s.invalidate(['today', 'work', 'parcels']);s.invalidate(['today', 'work']);
  assert.equal(frames.length, 1, 'une seule image demandée');
  assert.deepEqual(calls, []);
  tick();
  assert.deepEqual(calls, ['today']);
  assert.deepEqual(s.dirtyViews().sort(), ['map', 'parcel', 'parcels', 'work']);
});

test('changement d’onglet : la vue marquée est rendue avant d’être montrée, pas deux fois', () => {
  const {s, calls, tick, go} = setup('today');
  s.renderNow();s.invalidate(['work']);tick();calls.length = 0;
  go('work');assert.equal(s.show('work'), true);assert.equal(s.show('work'), false);
  assert.deepEqual(calls, ['work']);
  assert.equal(s.show('today'), false, 'vue à jour : pas de rendu');
});

test('rendu complet : la vue visible tout de suite, les autres au premier affichage ; statistiques', () => {
  const {s, calls} = setup('map');
  s.renderNow();
  assert.deepEqual(calls, ['map']);
  assert.deepEqual(s.dirtyViews().sort(), ['parcel', 'parcels', 'today', 'work']);
  assert.deepEqual(s.stats().map, {count: 1, lastMs: 2, maxMs: 2, totalMs: 2});
});

test('vues touchées par entité', () => {
  assert.equal(viewsForEvent({entity: 'state'}), null);
  assert.equal(viewsForEvent({entity: 'parcelles', kind: 'restore'}), null);
  assert.ok(viewsForEvent({entity: 'interventions'}).includes('work'));
  assert.ok(!viewsForEvent({entity: 'stockItems'}).includes('map'));
  assert.deepEqual(viewsForEvent({entity: 'points'}), ['map', 'parcel']);
});

test('la carte n’est redessinée que si contour, culture ou statut changent', () => {
  const {s} = setup('map');
  const parcel = {id: 'p1', nom: 'A', culture: 'Blé', geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]}, notes: ''};
  s.remember({parcelles: [parcel]});
  assert.equal(s.mapChanged({entity: 'parcelles', entityId: 'p1'}, {parcelles: [{...parcel, notes: 'drainé'}]}), false);
  assert.equal(s.mapChanged({entity: 'parcelles', entityId: 'p1'}, {parcelles: [{...parcel, culture: 'Orge'}]}), true);
  assert.equal(s.mapChanged({entity: 'parcelles', entityId: 'p1'}, {parcelles: [{...parcel, culture: 'Orge'}]}), false);
  assert.equal(s.mapChanged({entity: 'parcelles', entityId: 'p1'}, {parcelles: [{...parcel, culture: 'Orge', geometry: null}]}), true);
  assert.equal(s.mapChanged({entity: 'interventions', entityId: 'w9'}, {interventions: [{id: 'w9', status: 'À faire'}]}), true, 'nouvelle fiche');
  assert.equal(s.mapChanged({entity: 'parcelles'}, {}), true, 'événement sans fiche : prudence');
  assert.equal(mapSignature('stockItems', {id: 's'}), '');
});

test('app.js : la vue d’arrivée est rendue dans switchView, avant la transition', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const i = app.indexOf('function switchView('), body = app.slice(i, app.indexOf('function applyHashRoute', i));
  assert.ok(body.indexOf('scheduler().show(view)') > 0 && body.indexOf('scheduler().show(view)') < body.indexOf('viewTransitions().run'));
  assert.match(app, /function renderAll\(\)\{[^\n]*scheduler\(\)\.renderNow\(\)/);
});
