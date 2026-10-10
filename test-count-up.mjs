import assert from 'node:assert/strict';
import {test} from 'node:test';
import {countValue, shouldCountUp, COUNT_UP_MS} from './count-up.js';

test('le compteur va de 0 à N en 400 ms, sans dépasser', () => {
  assert.equal(COUNT_UP_MS, 400);
  assert.equal(countValue(24, 0), 0);
  assert.equal(countValue(24, 400), 24);
  assert.equal(countValue(24, 900), 24);
  const mid = countValue(24, 200); assert.ok(mid > 12 && mid < 24, String(mid));
  let prev = -1; for (let t = 0; t <= 400; t += 20) { const v = countValue(24, t); assert.ok(v >= prev && v <= 24); prev = v; }
  assert.equal(countValue('—', 100), '—');
});

test('pas d’animation en mouvement réduit, pour zéro ou une valeur inchangée', () => {
  assert.equal(shouldCountUp(undefined, '5'), true);
  assert.equal(shouldCountUp(undefined, '5', {reduced: true}), false);
  assert.equal(shouldCountUp('5', '5'), false);
  assert.equal(shouldCountUp('4', '5'), true);
  assert.equal(shouldCountUp(undefined, '0'), false);
  assert.equal(shouldCountUp(undefined, '1,5'), false);
});
