import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionDirection, shouldTransition, viewRank} from './view-transitions.js';
import {createViewTransitions} from './view-transitions-ui.js';

test('direction selon l’ordre des onglets, fiche après Parcelles', () => {
  assert.equal(transitionDirection('today', 'parcels'), 'forward');
  assert.equal(transitionDirection('work', 'today'), 'back');
  assert.equal(transitionDirection('parcels', 'parcel'), 'forward');
  assert.equal(transitionDirection('parcel', 'parcels'), 'back');
  assert.equal(transitionDirection('parcel', 'work'), 'forward');
  assert.equal(transitionDirection('more', 'more-category'), 'forward');
  assert.equal(transitionDirection('work', 'work'), 'none');
  assert.ok(viewRank('parcel') > viewRank('parcels') && viewRank('parcel') < viewRank('work'));
});

test('jamais la carte, jamais en reduced-motion, jamais sans API', () => {
  assert.equal(shouldTransition({from: 'today', to: 'work', supported: true}), true);
  assert.equal(shouldTransition({from: 'today', to: 'map', supported: true}), false);
  assert.equal(shouldTransition({from: 'map', to: 'parcels', supported: true}), false);
  assert.equal(shouldTransition({from: 'today', to: 'work', supported: true, reduced: true}), false);
  assert.equal(shouldTransition({from: 'today', to: 'work', supported: false}), false);
});

test('repli : sans startViewTransition, run rend la main sans appeler update', () => {
  const doc = {documentElement: {dataset: {}}, querySelector: () => null};
  const vt = createViewTransitions({doc, win: {matchMedia: () => ({matches: false})}});
  let called = 0;
  assert.equal(vt.run('today', 'work', () => called++), false);
  assert.equal(called, 0);
});

test('transition : update appelé dans le rappel, sens posé puis retiré', async () => {
  let done;
  const doc = {documentElement: {dataset: {}}, querySelector: () => null, startViewTransition(cb) { cb(); const finished = new Promise(r => { done = r; }); return {finished, ready: Promise.resolve(), updateCallbackDone: Promise.resolve()}; }};
  const vt = createViewTransitions({doc, win: {matchMedia: () => ({matches: false})}});
  let called = 0;
  assert.equal(vt.run('today', 'work', () => { called++; assert.equal(doc.documentElement.dataset.vt, 'forward'); }), true);
  assert.equal(called, 1);
  done(); await new Promise(r => setTimeout(r, 0));
  assert.equal(doc.documentElement.dataset.vt, undefined);
  const reduced = createViewTransitions({doc, win: {matchMedia: () => ({matches: true})}});
  assert.equal(reduced.run('today', 'work', () => {}), false);
});
