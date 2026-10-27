// n° 89 — simulateur « Et si… » (logique pure, aucune écriture).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('marge nette simulée : net-margin.js + écart simulé, par exploitation et par culture', async () => {
  const {netMargin} = await import('./net-margin.js');
  const s = farm(); s.preferences.structureByCampaign = {[C]: {items: {social: {amount: 1500}}}};
  const b = simulationBase(s, {campaign: C}), nm = netMargin(s, {campaign: C});
  assert.equal(b.net, nm.total.net);
  assert.ok(b.net !== null && b.netParts.structure > 0);
  const r = simulate(b, {yieldPct: 10});
  assert.equal(Math.round(r.net), Math.round(nm.total.net + r.delta));
  assert.equal(Math.round(r.productDelta), Math.round(23500 * 0.1));
  const ble = simulationBase(s, {campaign: C, culture: 'Blé'});
  assert.equal(ble.net, nm.rows.find(x => x.key === 'ble').net);
  // Sans économie : pas de marge nette inventée.
  const empty = farm(); empty.parcelles.forEach(p => { p.economicsByCampaign[C] = {}; });
  assert.equal(simulate(simulationBase(empty, {campaign: C})).net, null);
});

test('trésorerie en direct : écart simulé ajouté au prévisionnel, point bas recalculé, rien d’écrit', async () => {
  const {scenarioTreasuryLines, treasuryWithScenario} = await import('./simulator.js');
  const b = simulationBase(farm(), {campaign: C}), r = simulate(b, {yieldPct: -20, fertPct: 50, gnrPrice: 2});
  const lines = scenarioTreasuryLines(b, r);
  assert.deepEqual(lines.map(l => l.month), ['2027-09', '2027-02', '2027-07']);
  assert.ok(lines[0].amount < 0 && lines[1].amount === -1000 && lines[2].amount === -75);
  assert.deepEqual(scenarioTreasuryLines(b, simulate(b)), []);
  const months = ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((key, i) => ({key, label: key, balance: 5000 - i * 1000}));
  const forecast = {months, low: {key: '2027-03', label: '2027-03', balance: 1000}};
  const t = treasuryWithScenario(forecast, [{month: '2027-02', amount: -1500}, {month: '2026-01', amount: -100}, {month: '2027-09', amount: -999}]);
  assert.equal(t.months[0].balance, 4900); // ligne antérieure ramenée au premier mois
  assert.equal(t.low.balance, 1000 - 1600); assert.equal(t.low.negative, true);
  assert.equal(t.lowDelta, -1600); assert.equal(t.outside, 1); assert.equal(t.applied, 2);
  assert.equal(forecast.months[4].balance, 1000); // prévisionnel d'origine intact
  assert.equal(treasuryWithScenario(null, []), null);
});

test('comparaison libre d’assolement : remplacer une culture sur des parcelles choisies', async () => {
  const {compareCropSwap, describeCropSwap, assolementParcels} = await import('./simulator.js');
  const s = farm();
  // Historique fiable pour le maïs aussi (campagne précédente).
  s.parcelles[1].economicsByCampaign['2025/26'] = {yield: 10, salePrice: 150};
  const ref = assolementParcels(s, {campaign: C});
  assert.equal(ref.find(p => p.id === 'p2').culture, 'Blé'); // assolement prévu 2027/28
  assert.equal(ref.find(p => p.id === 'p1').culture, 'Blé'); // reconduit
  const r = compareCropSwap(s, {campaign: C, parcelIds: ['p1'], to: 'Maïs'});
  assert.equal(r.next, '2027/28'); assert.equal(r.changed.length, 1); assert.equal(r.changed[0].from, 'Blé');
  assert.equal(r.area, 10); assert.ok(r.delta !== null);
  assert.equal(Math.round(r.swapped.margin - r.base.margin), Math.round(r.delta));
  assert.match(describeCropSwap(r, {format: v => `${Math.round(v)} €`}), /^Plan 2027\/28 : marge prévisionnelle .* contre .* si blé remplacé par maïs \(10 ha\)\.$/);
  assert.match(compareCropSwap(s, {campaign: C, parcelIds: ['p1'], to: ''}).error, /culture de remplacement/);
  assert.match(compareCropSwap(s, {campaign: C, parcelIds: [], to: 'Maïs'}).error, /au moins une parcelle/);
  const unknown = compareCropSwap(s, {campaign: C, parcelIds: ['p1'], to: 'Tournesol'});
  assert.equal(unknown.delta, null); assert.match(describeCropSwap(unknown), /pas d’historique .*Tournesol/);
  assert.match(describeCropSwap(compareCropSwap(s, {campaign: C, parcelIds: ['p1'], to: 'blé'})), /rien ne change/);
  // Simulation pure : l'état n'est pas modifié.
  assert.equal(s.parcelles[0].culture, 'Blé'); assert.equal(s.rotations.length, 1);
});

test('écran « Et si… » : marge nette, trésorerie selon le rôle et comparaison branchées', () => {
  const ui = readFileSync(new URL('./simulator-ui.js', import.meta.url), 'utf8'), app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(ui, /canSeeTreasury\(role\(\)\)/);
  assert.match(ui, /treasuryWithScenario\(forecast,scenarioTreasuryLines\(base,r\)\)/);
  assert.match(ui, /Marge nette simulée/);
  assert.match(ui, /id="sim-swap"/); assert.match(ui, /describeCropSwap/);
  assert.match(ui, /class="form-error hidden"/);
  assert.match(ui, /pas une prévision/);
  assert.match(app, /createSimulatorUI\(\{modal,state,role:cloudRole\}\)/);
});
