// n° 80 — économie de l'atelier bovin (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {herdEconomics,validateAnimalRecord,campaignBounds,feedCosts} from './herd-economics.js';
import {normalizeTreatment} from './herd-health.js';

const C = '2026/27';
const rec = (kind, x) => ({id: `${kind}-${x.date}`, farmKind: kind, ...x});
const farm = () => ({preferences: {}, rotations: [], documents: [],
  parcelles: [{id: 'p3', nom: 'Pré', culture: 'Prairie permanente', surfaceHa: 10}],
  interventions: [{id: 'w1', parcelId: 'p3', type: 'Fauche', date: '2026-09-01', status: 'Terminé', cost: 600}],
  grazingSessions: [{id: 'g1', parcelId: 'p3', animalType: 'Vaches', animalsCount: 10, animalCategory: 'vache-allaitante', startDate: '2026-09-01', endDate: '2026-10-01'}],
  stockItems: [{id: 'a1', name: 'Tourteau colza', category: 'Aliment', unit: 'kg', quantity: 500, createdAt: 0}],
  stockMovements: [
    {id: 'm1', stockItemId: 'a1', date: '2026-08-05', type: 'Entrée', quantity: 1000, delta: 1000, unitPrice: 0.4, createdAt: 1},
    {id: 'm2', stockItemId: 'a1', date: '2026-09-10', type: 'Sortie', quantity: 500, delta: -500, createdAt: 2}],
  vetTreatments: [{id: 't1', date: '2026-09-15', kind: 'visit', cost: 150}, {id: 't2', date: '2026-09-20', kind: 'visit'}],
  integrationImports: [
    rec('animalSale', {date: '2026-10-05', count: 5, kg: 1500, amount: 6000}),
    rec('animalPurchase', {date: '2026-08-20', count: 1, amount: 2500}),
    rec('animalSale', {date: '2025-10-05', count: 3, amount: 3000})]});

test('bornes de campagne', () => assert.deepEqual(campaignBounds(C), {from: '2026-08-01', to: '2027-07-31'}));

test('marge brute : ventes − achats − aliments − vétérinaire − prairies', () => {
  const h = herdEconomics(farm(), {campaign: C, today: '2026-10-31'});
  assert.equal(h.product, 6000); assert.equal(h.bought, 2500);
  assert.equal(h.feed.total, 200); assert.equal(h.vetCost, 150); assert.equal(h.vetUnpriced, 1);
  assert.equal(h.grassCost, 600);
  assert.equal(h.margin, 6000 - 2500 - 200 - 150 - 600);
  assert.equal(h.partial, true);
  assert.equal(h.pricePerKg, 4);
});

test('indicateurs : marge par UGB et coût de l’herbe par animal et par jour', () => {
  const h = herdEconomics(farm(), {campaign: C, today: '2026-10-31'});
  // 10 vaches allaitantes (0,85 UGB) pendant 30 jours.
  assert.equal(h.animalDays, 300); assert.equal(h.ugbDays, 255);
  assert.equal(h.grassPerAnimalDay, 2);
  assert.equal(h.avgUgb, 2.77); // 255 jours UGB sur 92 jours
  assert.ok(Math.abs(h.marginPerUgb - 2550 / (255 / 92)) < 0.01);
});

test('aliments sans prix et campagne vide', () => {
  const s = farm(); s.stockMovements = s.stockMovements.filter(m => m.type === 'Sortie');
  s.stockItems[0].quantity = 0;
  assert.equal(feedCosts(s, campaignBounds(C)).unpriced, 1);
  assert.equal(herdEconomics({preferences: {}, parcelles: [], interventions: []}, {campaign: C}).empty, true);
});

test('validation d’une vente et coût vétérinaire facultatif', () => {
  assert.ok(validateAnimalRecord({date: '2026-10-01', count: 0, amount: 1}).error);
  assert.ok(validateAnimalRecord({date: 'x', count: 1, amount: 1}).error);
  assert.deepEqual(validateAnimalRecord({date: '2026-10-01', count: '2', amount: '1500,5', kg: ''}).value, {date: '2026-10-01', count: 2, amount: 1500.5, kg: null, category: '', party: '', note: ''});
  assert.equal(normalizeTreatment({kind: 'visit', date: '2026-10-01', cost: '80'}).cost, 80);
  assert.equal(normalizeTreatment({kind: 'visit', date: '2026-10-01'}).cost, null);
  assert.throws(() => normalizeTreatment({kind: 'visit', date: '2026-10-01', cost: '-2'}), /Coût invalide/);
});
