import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetDragOutcome, attachSheetSwipe, SWIPE_CLOSE_PX} from './sheet-swipe.js';

test('fermer après un glissé assez long ou rapide, sinon rester', () => {
  assert.equal(sheetDragOutcome({dy: SWIPE_CLOSE_PX, ms: 600}), 'close');
  assert.equal(sheetDragOutcome({dy: 50, ms: 60}), 'close');
  assert.equal(sheetDragOutcome({dy: 50, ms: 400}), 'stay');
  assert.equal(sheetDragOutcome({dy: 10, ms: 5}), 'stay');
});

test('glisser la poignée d’une feuille ferme la fenêtre ; un bouton ne déclenche rien', () => {
  const handlers = {};
  const root = {addEventListener: (type, fn) => { handlers[type] = fn; }};
  const sheet = {style: {}, getBoundingClientRect: () => ({top: 400})};
  const handle = {closest: sel => sel === '.modal' ? sheet : null};
  let closed = 0;
  attachSheetSwipe(root, () => closed++, {win: {matchMedia: () => ({matches: true})}});
  handlers.pointerdown({target: handle, clientY: 410, timeStamp: 0, pointerId: 1, button: 0});
  handlers.pointermove({clientY: 470, pointerId: 1});
  assert.equal(sheet.style.transform, 'translateY(60px)');
  handlers.pointerup({type: 'pointerup', clientY: 520, timeStamp: 500, pointerId: 1});
  assert.equal(closed, 1);
  assert.equal(sheet.style.transform, '');
  const button = {closest: sel => sel === '.modal' ? sheet : sel.startsWith('button') ? {} : null};
  handlers.pointerdown({target: button, clientY: 410, timeStamp: 0, pointerId: 2, button: 0});
  handlers.pointerup({type: 'pointerup', clientY: 600, timeStamp: 100, pointerId: 2});
  assert.equal(closed, 1);
});
