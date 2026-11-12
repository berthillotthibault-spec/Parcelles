// Âge des barèmes de référence : badge « à vérifier » au-delà d'un an.
import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceAge, referenceAgeBadge} from './reference-age.js';

const table = {date: '2026-10-01', source: 'Barème test'};

test('11 mois : barème récent, pas de badge', () => {
  const r = referenceAge(table, '2027-09-15');
  assert.equal(r.months, 11); assert.equal(r.old, false);
  assert.equal(referenceAgeBadge(table, '2027-09-15'), '');
});

test('13 mois : barème ancien, badge affiché', () => {
  const r = referenceAge(table, '2027-11-02');
  assert.equal(r.months, 13); assert.equal(r.old, true);
  assert.match(referenceAgeBadge(table, '2027-11-02'), /Barème de plus d’un an, à vérifier/);
});

test('limite d’un an et seuil personnalisé', () => {
  assert.equal(referenceAge(table, '2027-10-01').old, false);
  assert.equal(referenceAge(table, '2027-10-02').old, true);
  assert.equal(referenceAge(table, '2027-04-02', {maxMonths: 6}).old, true);
});

test('date invalide : aucun badge', () => {
  assert.deepEqual(referenceAge({date: 'inconnue'}, '2027-11-02'), {months: null, old: false});
  assert.equal(referenceAgeBadge({}, '2027-11-02'), '');
  assert.equal(referenceAgeBadge(table, 'demain'), '');
  assert.equal(referenceAgeBadge(null, '2030-01-01'), '');
  assert.equal(referenceAgeBadge(table, new Date('invalid')), '');
});
