// n° 73 (n° 97) — lots, péremption, AMM retirée, PPNU, PMP glissant, inventaire et dérive de prix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {itemLots,initialQuantity,movementsOf,ammStatus,priceDrift,pmpAt,valuationAt,inventoryCsv,workRevaluations,revaluedWork,inputAlerts,adivalorReminder} from './stock-lots.js';

const T = '2026-10-12';
const mv = (id, date, type, quantity, x = {}) => ({id, stockItemId: 'i1', date, type, quantity, delta: type === 'Sortie' ? -quantity : quantity, createdAt: Date.parse(date), ...x});
const farm = (extra = {}) => ({preferences: {}, interventions: [],
  stockItems: [{id: 'i1', name: 'Fongi X', unit: 'L', quantity: 70, createdAt: Date.parse('2026-01-01'), unitPrice: 12}],
  stockMovements: [
    mv('m1', '2026-02-01', 'Entrée', 50, {unitPrice: 10, lotNumber: 'A1', supplier: 'Coop', expiryDate: '2026-09-30'}),
    mv('m2', '2026-03-01', 'Sortie', 30),
    mv('m3', '2026-04-01', 'Entrée', 50, {unitPrice: 14, lotNumber: 'B2', expiryDate: '2027-03-01'})],
  ...extra});

test('stock initial et lots consommés en FIFO, péremption', () => {
  const s = farm(), item = s.stockItems[0];
  // 70 = q0 + 50 − 30 + 50 → q0 = 0
  assert.equal(initialQuantity(item, movementsOf(s, 'i1')), 0);
  const lots = itemLots(s, item, {today: T});
  assert.deepEqual(lots.map(l => [l.lotNumber, l.remaining]), [['A1', 20], ['B2', 50]]);
  assert.equal(lots[0].expired, true); assert.equal(lots[1].expired, false);
});

test('PMP glissant et inventaire à une date', () => {
  const s = farm(), item = s.stockItems[0];
  assert.equal(pmpAt(s, item, '2026-02-15'), 10);
  // (20 × 10 + 50 × 14) / 70 = 12,857
  assert.equal(pmpAt(s, item, T), 12.8571);
  const v = valuationAt(s, '2026-03-15');
  assert.equal(v.rows[0].quantity, 20); assert.equal(v.rows[0].value, 200);
  const now = valuationAt(s, T, {today: T});
  assert.equal(now.total, 900); assert.equal(now.rows[0].nextExpiry, '2026-09-30');
  assert.match(inventoryCsv(now), /Fongi X;;L;70;12,8571;900;A1 B2;2026-09-30;/);
  assert.equal(valuationAt(s, '2025-12-01').rows.length, 0);
});

test('dérive de prix : dernier achat +40 % sur le PMP', () => {
  const d = priceDrift(farm(), farm().stockItems[0]);
  assert.equal(d.pmp, 10); assert.equal(d.ratio, 0.4);
  const calm = farm(); calm.stockMovements[2].unitPrice = 10.5;
  assert.equal(priceDrift(calm, calm.stockItems[0]), null);
});

test('AMM retirée : fiche ou catalogue, utilisable puis interdit', () => {
  const item = {name: 'Herbi', phyto: {amm: '9', withdrawnAt: '2026-05-01', useUntil: '2026-11-01'}};
  assert.equal(ammStatus(item, {today: T}).status, 'retiré');
  assert.equal(ammStatus(item, {today: '2026-12-01'}).status, 'interdit');
  const viaCatalog = ammStatus({name: 'Y', phyto: {amm: '7'}}, {today: T, lookup: q => q.amm === '7' ? {amm: '7', withdrawnAt: '2025-01-01', useUntil: '2025-12-31'} : null});
  assert.equal(viaCatalog.status, 'interdit'); assert.equal(viaCatalog.source, 'catalogue');
  assert.equal(ammStatus({name: 'Z'}, {today: T}).status, 'autorisé');
});

test('alertes, PPNU et rappel ADIVALOR', () => {
  const s = farm();
  const kinds = inputAlerts(s, {today: T}).map(a => a.kind);
  assert.ok(kinds.includes('expired')); assert.ok(kinds.includes('drift'));
  s.stockItems[0].ppnu = 'à évacuer';
  assert.deepEqual(inputAlerts(s, {today: T}).map(a => a.kind), ['ppnu']);
  assert.equal(adivalorReminder(s, {today: T}).missingDate, true);
  s.preferences.adivalorNextCollection = '2026-10-30';
  assert.equal(adivalorReminder(s, {today: T}).due, true);
});

test('revalorisation des sorties de travaux au PMP du jour, sans écriture', () => {
  const w = {id: 'w1', type: 'Fongicide', date: '2026-03-01', inputCost: 360, machineCost: 50, cost: 410, resourceEffects: {stockItemId: 'i1', quantity: 30}};
  const s = farm({interventions: [w]});
  const r = workRevaluations(s);
  assert.equal(r.length, 1); assert.equal(r[0].expected, 300);
  const next = revaluedWork(w, r[0].expected);
  assert.equal(next.inputCost, 300); assert.equal(next.cost, 350);
  assert.equal(s.interventions[0].inputCost, 360);
});
