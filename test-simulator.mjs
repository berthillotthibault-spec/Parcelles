// n° 89 — simulateur « Et si… » (logique pure, aucune écriture).
import test from 'node:test';
import assert from 'node:assert/strict';
import {simulationBase,simulate,sensitivityMatrix,describeScenario,compareRotationChoices,historicalMargins} from './simulator.js';

const C = '2026/27';
const farm = () => ({preferences: {fuelPrice: 1.5}, rotations: [{id: 'r', parcelId: 'p2', campaignId: '2027/28', culture: 'Blé'}],
  parcelles: [
    {id: 'p1', nom: 'A', culture: 'Blé', surfaceHa: 10, economicsByCampaign: {[C]: {yield: 8, salePrice: 200}, '2025/26': {yield: 7, salePrice: 200}}},
    {id: 'p2', nom: 'B', culture: 'Maïs', surfaceHa: 5, economicsByCampaign: {[C]: {yield: 10, salePrice: 150}}}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Épandage engrais', date: '2026-10-01', status: 'Terminé', cost: 2000, fuel: 100},
    {id: 'w2', parcelId: 'p2', type: 'Semis', date: '2026-10-02', status: 'Terminé', cost: 500, fuel: 50},
    {id: 'w0', parcelId: 'p1', type: 'Semis', date: '2025-10-01', status: 'Terminé', cost: 1000}]});

test('base : produit, charges, engrais et GNR', () => {
  const b = simulationBase(farm(), {campaign: C});
  assert.equal(b.product, 16000 + 7500); assert.equal(b.charges, 2500); assert.equal(b.margin, 21000);
  assert.equal(b.fert, 2000); assert.equal(b.litres, 150); assert.equal(b.gnrPrice, 1.5);
  const ble = simulationBase(farm(), {campaign: C, culture: 'Blé'});
  assert.equal(ble.margin, 14000); assert.equal(ble.litres, 100);
});

test('curseurs : rendement, prix, engrais, GNR et bornes', () => {
  const b = simulationBase(farm(), {campaign: C});
  assert.equal(simulate(b).delta, 0);
  assert.equal(simulate(b, {yieldPct: 10}).margin, 23500 * 1.1 - 2500);
  assert.equal(Math.round(simulate(b, {yieldPct: -10, pricePct: 10}).product), Math.round(23500 * 0.9 * 1.1));
  assert.equal(simulate(b, {fertPct: 50}).fertEffect, 1000);
  assert.equal(Math.round(simulate(b, {gnrPrice: 2}).gnrEffect), 75);
  assert.equal(simulate(b, {yieldPct: 80}).margin, simulate(b, {yieldPct: 30}).margin); // borné à ±30 %
});

test('matrice 5 × 5 rendement × prix, couleurs relatives à la base', () => {
  const m = sensitivityMatrix(simulationBase(farm(), {campaign: C}));
  assert.equal(m.rows.length, 5); assert.equal(m.rows[0].length, 5);
  assert.equal(m.rows[2][2].level, 'flat'); assert.equal(m.rows[0][0].level, 'down'); assert.equal(m.rows[4][4].level, 'up');
  const s = farm(); s.parcelles.forEach(p => { p.economicsByCampaign[C] = {}; });
  assert.equal(sensitivityMatrix(simulationBase(s, {campaign: C})), null);
});

test('hypothèses en phrase lisible (pas de JSON)', () => {
  assert.equal(describeScenario({yieldPercent: 10, priceDelta: -5, inputPercent: 0, extraCost: 0}), 'Votre simulation : rendement +10 %, prix −5 €/t, intrants 0 %.');
  assert.equal(describeScenario({yieldPct: -10, pricePct: 5, fertPct: 0, gnrPrice: 1.5}), 'Hypothèses : rendement −10 %, prix +5 %, engrais 0 %, GNR à 1,50 €/L.');
});

test('assolement : prévu contre reconduit avec les marges/ha historiques', () => {
  const h = historicalMargins(farm(), {campaign: C});
  assert.equal(Math.round(h.get('ble').marginHa), 1350);
  const r = compareRotationChoices(farm(), {campaign: C});
  assert.equal(r.next, '2027/28'); assert.equal(r.hasPlan, true);
  assert.ok(r.planned.cultures.some(c => c.culture === 'Blé' && c.area === 5));
  assert.ok(r.kept.cultures.some(c => c.culture === 'Maïs'));
});
