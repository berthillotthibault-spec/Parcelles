// n° 65 — marges par culture (logique pure, issue de marginModel).
import test from 'node:test';
import assert from 'node:assert/strict';
import {cropMargins,waterfallSteps,partialLabel,validateAids,pacAids} from './crop-margins.js';
import {marginModel} from './pilotage.js';
import {waterfallChart} from './charts.js';

const C = '2026/27';
const farm = (prefs = {}) => ({preferences: prefs, rotations: [], integrationImports: [],
  parcelles: [
    {id: 'p1', nom: 'A', culture: 'Blé tendre', surfaceHa: 10, economicsByCampaign: {[C]: {yield: 8, salePrice: 200}, '2025/26': {yield: 7, salePrice: 180}}},
    {id: 'p2', nom: 'B', culture: 'Prairie permanente', surfaceHa: 5}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Fertilisation', date: '2026-10-01', status: 'Terminé', cost: 3000, inputCost: 3000},
    {id: 'w2', parcelId: 'p1', type: 'Semis', date: '2026-10-02', status: 'Terminé', cost: 1000, machineCost: 600, fuelCost: 100},
    {id: 'w3', parcelId: 'p1', type: 'Désherbage', date: '2026-10-03', status: 'Terminé'},
    {id: 'w0', parcelId: 'p1', type: 'Semis', date: '2025-10-01', status: 'Terminé', cost: 2000, machineCost: 500},
    {id: 'w4', parcelId: 'p2', type: 'Fauche', date: '2026-10-05', status: 'Terminé', cost: 400, machineCost: 400}]});

test('cascade €/ha : produit, charges op., marge brute, mécanisation, marge directe', () => {
  const m = cropMargins(farm(), {campaign: C}), ble = m.rows.find(r => r.culture === 'Blé tendre');
  assert.equal(ble.productHa, 1600);
  assert.equal(ble.mechanizationHa, 70);
  assert.equal(ble.operationalHa, 330);
  assert.equal(ble.grossHa, 1270);
  assert.equal(ble.directHa, 1200);
  // Même résultat que le moteur unique.
  const mm = marginModel(farm(), {campaign: C}).byCulture.find(c => c.culture === 'Blé tendre');
  assert.equal(ble.directHa, mm.marginHa);
  assert.equal(ble.missing, 1); assert.equal(ble.partial, true);
  assert.equal(partialLabel(ble.missing), 'marge partielle : 1 travail sans coût');
  assert.equal(partialLabel(0), '');
});

test('aides PAC saisies une fois, N-1 et N-2, prix d’équilibre', () => {
  const m = cropMargins(farm({pacAidsHa: {decoupled: 120, ecoScheme: 60}}), {campaign: C}), ble = m.rows.find(r => r.culture === 'Blé tendre');
  assert.equal(ble.aidsHa, 180); assert.equal(ble.withAidsHa, 1380);
  assert.deepEqual(ble.previous.map(p => p.campaign), ['2025/26', '2024/25']);
  assert.equal(ble.previous[0].directHa, 1060);
  assert.equal(ble.previous[1].directHa, null);
  assert.ok(ble.breakEven > 0);
  assert.equal(pacAids({preferences: {}}).total, null);
});

test('produit inconnu : aucune marge, pas de cascade', () => {
  const m = cropMargins(farm(), {campaign: C}), pr = m.rows.find(r => r.culture === 'Prairie permanente');
  assert.equal(pr.productHa, null); assert.equal(pr.directHa, null);
  assert.deepEqual(waterfallSteps(pr), []);
  assert.ok(m.herd); assert.equal(m.herd.charges, 400); assert.equal(m.herd.margin, null);
});

test('validation des aides et graphique en cascade', () => {
  assert.ok(validateAids({decoupled: '-3'}).error);
  assert.deepEqual(validateAids({decoupled: '120,5', ecoScheme: ''}).value, {decoupled: 120.5, ecoScheme: null});
  const svg = waterfallChart(waterfallSteps(cropMargins(farm(), {campaign: C}).rows[0]));
  assert.match(svg, /<svg class="chart chart-waterfall"/);
  assert.match(svg, /aria-label="Cascade de marge : Produit 1[\s  ]600/);
  assert.equal(waterfallChart([]), '');
});
