// n° 67 — variétés et semences : saisie, dose, libellé de parcelle, essai variétal, semences de ferme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isSowingWork,normalizeSeed,seedKgPerHa,seedQuantityKg,seedLabel,parcelSowing,varietyNames,varietyTrials,farmSavedSeed,seedStockItems} from './seeds.js';

const sow = (id, parcelId, date, culture, seed, x = {}) => ({id, parcelId, date, type: 'Semis', culture, status: 'Terminé', surfaceWorked: 10, seed, ...x});
const lot = (id, parcelId, date, quantity, unit = 't') => ({id, farmKind: 'harvest', parcelId, date, quantity, unit});

test('détection du semis et normalisation des champs', () => {
  assert.equal(isSowingWork({type: 'Semis colza'}), true);
  assert.equal(isSowingWork({type: 'Resemis'}), true);
  assert.equal(isSowingWork({type: 'Désherbage'}), false);
  assert.equal(normalizeSeed({}).value, null);
  assert.ok(normalizeSeed({seedDensity: -1}).error);
  assert.ok(normalizeSeed({seedTgw: 5000}).error);
  const s = normalizeSeed({seedVariety: '  LG  Aviron ', seedDensity: '45', seedTgw: '5,2', seedOrigin: 'certifiée', seedDensityUnit: 'x'}).value;
  assert.equal(s.variety, 'LG Aviron'); assert.equal(s.density, 45); assert.equal(s.tgw, 5.2); assert.equal(s.densityUnit, 'grains/m²');
});

test('dose en kg/ha et quantité semée', () => {
  assert.equal(seedKgPerHa({density: 250, tgw: 48}), 120);
  assert.equal(seedKgPerHa({density: 160, densityUnit: 'kg/ha'}), 160);
  assert.equal(seedKgPerHa({density: 250}), null);
  assert.equal(seedQuantityKg({surfaceWorked: 10, seed: {density: 250, tgw: 48}}), 1200);
  assert.equal(seedQuantityKg({surfaceWorked: 10, seed: {quantityKg: 900, density: 250, tgw: 48}}), 900);
});

test('libellé de la fiche parcelle et variétés apprises', () => {
  const w = sow('w1', 'p1', '2026-08-28', 'Colza', {variety: 'LG Aviron', density: 45, densityUnit: 'grains/m²'});
  assert.equal(seedLabel(w), 'Colza LG Aviron, 45 gr/m², semé le 28/08');
  const s = {interventions: [w, sow('w2', 'p2', '2025-10-10', 'Blé', {variety: 'Chevignon'}), sow('w3', 'p3', '2024-10-12', 'Blé', {variety: 'chevignon'}), sow('w4', 'p3', '2024-10-12', 'Blé', {variety: 'Annulée'}, {status: 'Annulé'})]};
  assert.equal(parcelSowing(s, 'p1').id, 'w1');
  assert.equal(parcelSowing(s, 'p1', {campaign: '2025/26'}), null);
  assert.deepEqual(varietyNames(s), ['Chevignon', 'LG Aviron']);
  assert.deepEqual(varietyNames(s, {culture: 'blé'}), ['Chevignon']);
});

test('essai variétal : rendement par semis et synthèse pluriannuelle', () => {
  const s = {
    parcelles: [{id: 'p1', nom: 'A', surfaceHa: 10}, {id: 'p2', nom: 'B', surfaceHa: 5}],
    interventions: [
      sow('a', 'p1', '2024-10-15', 'Blé', {variety: 'Chevignon'}, {inputCost: 900}),
      sow('b', 'p1', '2025-10-12', 'Blé', {variety: 'Chevignon'}, {inputCost: 1100}),
      sow('c', 'p2', '2025-10-20', 'Blé', {variety: 'KWS Extase'}, {surfaceWorked: 5}),
      sow('d', 'p2', '2026-09-01', 'Colza', {variety: 'LG Aviron'}, {surfaceWorked: 5})
    ],
    integrationImports: [lot('h1', 'p1', '2025-07-15', 80), lot('h2', 'p1', '2026-07-10', 90), lot('h3', 'p2', '2026-07-12', 35000, 'kg')]
  };
  const t = varietyTrials(s);
  assert.equal(t.rows.length, 4);
  const a = t.rows.find(r => r.work.id === 'a');
  assert.equal(a.yieldTHa, 8); assert.equal(a.seedCostHa, 90); assert.equal(a.campaign, '2024/25');
  const chev = t.summary.find(x => x.variety === 'Chevignon');
  assert.equal(chev.sowings, 2); assert.equal(chev.yieldTHa, 8.5); assert.equal(chev.seedCostHa, 100); assert.deepEqual(chev.campaigns, ['2024/25', '2025/26']);
  const extase = t.summary.find(x => x.variety === 'KWS Extase');
  assert.equal(extase.yieldTHa, 7); assert.equal(extase.gapPct, -15); assert.equal(chev.gapPct, 4);
  assert.equal(t.summary.find(x => x.variety === 'LG Aviron').yieldTHa, null);
  assert.equal(varietyTrials(s, {culture: 'colza'}).rows.length, 1);
});

test('semences de ferme ressemées par culture et articles de stock « Semence »', () => {
  const s = {parcelles: [{id: 'p1', surfaceHa: 12}], interventions: [
    sow('a', 'p1', '2026-10-10', 'Blé', {origin: 'ferme', density: 250, tgw: 45}),
    sow('b', 'p1', '2026-10-11', 'Blé', {origin: 'ferme'}, {surfaceWorked: null}),
    sow('c', 'p1', '2026-10-12', 'Orge', {origin: 'certifiée', density: 160, densityUnit: 'kg/ha'})
  ], stockItems: [{id: 's1', name: 'Blé Chevignon C2', category: 'Semence'}, {id: 's2', name: 'Ammonitrate', category: 'Engrais'}]};
  const r = farmSavedSeed(s, {campaign: '2026/27'});
  assert.deepEqual(r, [{culture: 'Blé', kg: 1125, area: 22, sowings: 2, unknown: 1}]);
  assert.deepEqual(seedStockItems(s).map(i => i.id), ['s1']);
});

test('export CSV de l’essai variétal', async () => {
  const {trialsCsv} = await import('./seeds.js');
  const csv = trialsCsv(varietyTrials({parcelles: [{id: 'p1', nom: 'Le Haut', surfaceHa: 4}], interventions: [sow('a', 'p1', '2025-10-01', 'Blé', {variety: 'Chevignon; bis'}, {surfaceWorked: 4})], integrationImports: [lot('h', 'p1', '2026-07-01', 30)]}));
  assert.match(csv, /^﻿Culture;Variété/);
  assert.match(csv, /Blé;"Chevignon; bis";2025\/26;Le Haut;2025-10-01;4;;;7,5;/);
});

test('vague 8 : coût d’intrant 0 = inconnu, écart pondéré par la surface mesurée, semence effaçable', async () => {
  const s = {
    parcelles: [{id: 'p1', surfaceHa: 10}, {id: 'p2', surfaceHa: 40}, {id: 'p3', surfaceHa: 10}],
    interventions: [
      sow('a1', 'p1', '2025-10-10', 'Blé', {variety: 'A'}, {inputCost: 0}),
      sow('a2', 'p2', '2025-10-11', 'Blé', {variety: 'A'}, {surfaceWorked: 40, inputCost: 4800}),
      sow('b1', 'p3', '2025-10-12', 'Blé', {variety: 'B'})
    ],
    integrationImports: [lot('h1', 'p1', '2026-07-10', 100), lot('h2', 'p3', '2026-07-11', 50)]
  };
  const t = varietyTrials(s);
  assert.equal(t.rows.find(r => r.work.id === 'a1').seedCostHa, null);
  const a = t.summary.find(x => x.variety === 'A'), b = t.summary.find(x => x.variety === 'B');
  assert.equal(a.seedCostHa, 120); assert.equal(a.measuredArea, 10);
  assert.equal(a.yieldTHa, 10); assert.equal(b.yieldTHa, 5);
  assert.equal(a.gapPct, 33); assert.equal(b.gapPct, -33);
  const {createSeedsUI} = await import('./seeds-ui.js');
  const {normalizeEntity} = await import('./state.js');
  const existing = normalizeEntity('interventions', sow('w', 'p1', '2025-10-10', 'Blé', {variety: 'Chevignon'}));
  const entity = {...existing, seedVariety: '', seedDensity: '', seedDensityUnit: 'gr/m²', seedTgw: '', seedLot: '', seedOrigin: '', seedTreatment: '', seedStockItemId: '', seedQuantityKg: ''};
  globalThis.document ??= {addEventListener() {}};
  assert.equal(createSeedsUI({}).applyToWork(entity), '');
  assert.ok(!normalizeEntity('interventions', entity, existing).seed);
});
