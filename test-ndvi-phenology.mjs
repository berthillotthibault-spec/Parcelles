// Levée contrôlée par satellite (ndvi-phenology.js) : verdissement, levée calculée, contrôle (scénarios de la relecture).
import test from 'node:test';
import assert from 'node:assert/strict';
import {detectGreenUp, computedEmergence, emergenceCheck, publishNdviSeries, ndviSeriesFor, onNdviSeries} from './ndvi-phenology.js';

const S = pairs => pairs.map(([date, ndvi]) => ({date, ndvi, usable: true}));
const days = (from, n, t) => Array.from({length: n}, (_, i) => ({date: new Date(Date.parse(`${from}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10), tmin: t, tmax: t}));
const estimate = (over = {}) => ({status: 'ok', sowingDate: '2026-10-10', recalibrated: null, profile: {base: 0, method: 'mean', stages: [{name: 'Levée', gdd: 150}, {name: 'Tallage', gdd: 500}]}, ...over});
const WEATHER = days('2026-10-11', 40, 10); // levée calculée le 25/10
const check = (series, over = {}) => emergenceCheck({id: 'p1'}, estimate(over.estimate), {series: S(series), days: over.days || WEATHER, today: over.today || '2026-11-15'});

test('verdissement : montée progressive datée au début de la hausse, pas au seuil de végétation installée', () => {
  const g = detectGreenUp(S([['2026-10-14', 0.17], ['2026-10-20', 0.18], ['2026-10-26', 0.21], ['2026-11-01', 0.26], ['2026-11-07', 0.28], ['2026-11-13', 0.34]]), {sowingDate: '2026-10-10', today: '2026-11-15'});
  assert.deepEqual([g.date, g.low.date, g.high.date], ['2026-10-29', '2026-10-26', '2026-11-01']);
});

test('verdissement : repousses détruites puis vraie levée ; hausse lente finalement nette ; pic isolé ignoré', () => {
  const d = detectGreenUp(S([['2026-10-12', 0.36], ['2026-10-18', 0.15], ['2026-10-25', 0.17], ['2026-11-01', 0.38], ['2026-11-07', 0.42]]), {sowingDate: '2026-10-10', today: '2026-11-15'});
  assert.equal(d.high.date, '2026-11-01');
  const c = detectGreenUp(S([['2026-10-14', 0.25], ['2026-10-20', 0.27], ['2026-10-27', 0.31], ['2026-11-03', 0.45], ['2026-11-10', 0.55]]), {sowingDate: '2026-10-10', today: '2026-11-15'});
  assert.equal(c.high.date, '2026-11-03');
  assert.equal(detectGreenUp(S([['2026-10-14', 0.15], ['2026-10-20', 0.3], ['2026-10-26', 0.16]]), {sowingDate: '2026-10-10', today: '2026-11-15'}), null);
  assert.equal(detectGreenUp(S([['2026-10-12', 0.15], ['2026-11-10', 0.4]]), {sowingDate: '2026-10-10', today: '2026-11-15'}), null, 'trou de 29 jours');
});

test('levée calculée : jour par jour, aucune conclusion si une température manque', () => {
  assert.deepEqual(computedEmergence(estimate(), WEATHER, '2026-11-15'), {date: '2026-10-25', stage: 'Levée'});
  assert.equal(computedEmergence(estimate(), days('2026-10-15', 40, 10), '2026-11-15'), null, 'archive pas encore chargée');
  const hole = WEATHER.map((d, i) => i === 3 ? {...d, tmax: null} : d);
  assert.equal(computedEmergence(estimate(), hole, '2026-11-15'), null);
  assert.deepEqual(computedEmergence(estimate(), days('2026-10-11', 5, 10), '2026-10-16'), {date: null, stage: 'Levée'}, 'pas encore atteinte');
});

test('contrôle : confirmée, tardive, non visible ; repousses précoces ignorées', () => {
  assert.equal(check([['2026-10-20', 0.17], ['2026-10-26', 0.2], ['2026-11-01', 0.3], ['2026-11-07', 0.36]]).kind, 'confirmed');
  const late = check([['2026-10-20', 0.17], ['2026-11-08', 0.18], ['2026-11-13', 0.32], ['2026-11-14', 0.35]]);
  assert.deepEqual([late.kind, late.gapDays], ['late', 17]);
  assert.equal(check([['2026-10-20', 0.17], ['2026-11-02', 0.18], ['2026-11-10', 0.3], ['2026-11-14', 0.35]]).kind, 'confirmed', '12 jours après : dans la marge');
  const missing = check([['2026-10-20', 0.16], ['2026-11-06', 0.17], ['2026-11-13', 0.18]]);
  assert.equal(missing.kind, 'missing');
  assert.deepEqual(missing.images.map(x => x.date), ['2026-11-06', '2026-11-13']);
  assert.equal(check([['2026-10-12', 0.22], ['2026-10-17', 0.33], ['2026-10-23', 0.4]]), null, 'repousses 5 jours après le semis');
  assert.equal(check([['2026-10-20', 0.16], ['2026-11-06', 0.17]], {today: '2026-11-10'}), null, 'trop tôt pour conclure');
  assert.equal(check([['2026-10-20', 0.17], ['2026-11-01', 0.3], ['2026-11-07', 0.36]], {days: days('2026-10-15', 40, 10)}), null, 'archive météo incomplète');
  assert.equal(emergenceCheck({id: 'p1', phenologyObservation: {sowingDate: '2026-10-10'}}, estimate(), {series: S([['2026-10-20', 0.17], ['2026-11-01', 0.3]]), days: WEATHER, today: '2026-11-15'}), null);
});

test('séries publiées : rappel à chaque publication', () => {
  let calls = 0;
  const off = onNdviSeries(() => { calls += 1; });
  publishNdviSeries(new Map([['p1', S([['2026-10-14', 0.2]])]]));
  assert.equal(ndviSeriesFor('p1').length, 1);
  publishNdviSeries(null);
  assert.deepEqual(ndviSeriesFor('p1'), []);
  off(); publishNdviSeries(new Map());
  assert.equal(calls, 2);
});
