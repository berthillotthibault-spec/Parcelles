// n° 66 — poids aux normes, articles de silo, reste à vendre, fiche de traçabilité et route QR.
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedWeight,normFor,grainNorms,validateNorms,lotTonnes,siloItemFor,grainStock,lotSheet,lotLink,parseLotRoute,DEFAULT_GRAIN_NORMS} from './grain-stock.js';

const lot = (x = {}) => ({id: 'l1', farmKind: 'harvest', code: 'B26-1', parcelId: 'p1', date: '2026-07-15', crop: 'Blé tendre', quantity: 100, unit: 't', humidity: 17, impurities: 3, silo: 'Cellule 2', sales: [], ...x});
const state = (lots = [lot()], extra = {}) => ({preferences: {}, rotations: [], documents: [], stockItems: [], stockMovements: [], products: [{id: 'pr1', name: 'Fongi X', phyto: {amm: '2000001', dar: 35}}],
  parcelles: [{id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Semis blé', date: '2025-10-20', status: 'Terminé', product: 'Semence Rubisko', variety: 'Rubisko', dose: 180, doseUnit: 'kg/ha'},
    {id: 'w2', parcelId: 'p1', type: 'Épandage engrais', date: '2026-03-01', status: 'Terminé', product: 'Ammonitrate', dose: 150, doseUnit: 'kg/ha'},
    {id: 'w3', parcelId: 'p1', type: 'Traitement fongicide', category: 'Phyto', date: '2026-07-01', status: 'Terminé', product: 'Fongi X', amm: '2000001'},
    {id: 'w4', parcelId: 'p1', type: 'Désherbage', category: 'Phyto', date: '2026-03-15', status: 'Terminé', product: 'Herbi Y', amm: '2000002'}],
  integrationImports: lots, ...extra});

test('normes : blé 15 %, maïs 15,5 %, table modifiable', () => {
  assert.equal(normFor('Blé tendre').humidity, 15);
  assert.equal(normFor('Maïs grain').humidity, 15.5);
  assert.equal(normFor('Betterave'), null);
  const own = grainNorms({preferences: {grainNorms: [{key: 'mais', humidity: 15, impurities: 1}]}});
  assert.equal(own.find(n => n.key === 'mais').humidity, 15);
  assert.equal(own.find(n => n.key === 'ble').humidity, 15);
  assert.ok(validateNorms([{key: 'ble', humidity: 0, impurities: 2}]).error);
  assert.deepEqual(validateNorms([{key: 'ble', humidity: '14,5', impurities: '1'}]).value, [{key: 'ble', humidity: 14.5, impurities: 1}]);
});

test('poids aux normes : humidité puis impuretés, sans bonification', () => {
  const ble = DEFAULT_GRAIN_NORMS[0];
  const w = normalizedWeight(100, {humidity: 17, impurities: 3}, ble);
  // 100 × 83/85 = 97,647 puis − 1 % = 96,671
  assert.equal(w.normalized, 96.671);
  assert.ok(w.applied);
  assert.equal(normalizedWeight(100, {humidity: 13}, ble).normalized, 100);
  assert.equal(normalizedWeight(100, {}, null).normalized, 100);
  assert.equal(normalizedWeight('', {}, ble), null);
  assert.equal(lotTonnes(state(), lot({unit: 'kg', quantity: 1000, humidity: null, impurities: null})).tonnes, 1);
});

test('article de silo : à créer puis retrouvé ; silo obligatoire', () => {
  const s = state();
  const first = siloItemFor(s, lot());
  assert.equal(first.item, null); assert.equal(first.draft.name, 'Blé tendre · silo Cellule 2'); assert.equal(first.draft.unit, 't');
  s.stockItems.push({id: 's9', ...first.draft});
  assert.equal(siloItemFor(s, lot()).item.id, 's9');
  assert.ok(siloItemFor(s, lot({silo: ''})).error);
});

test('stock par silo et reste à vendre', () => {
  const s = state([lot({stockMovementId: 'm1', sales: [{id: 'v1', quantity: 40, date: '2026-08-01', buyer: 'Coop'}]})], {stockItems: [{id: 's9', name: 'Blé · silo Cellule 2', category: 'Récolte', silo: 'Cellule 2', crop: 'Blé tendre', quantity: 56.671, unit: 't'}]});
  const g = grainStock(s);
  assert.equal(g.silos.length, 1); assert.equal(g.silos[0].tonnes, 56.671);
  assert.equal(g.lots[0].remaining, 56.671); assert.equal(g.remaining, 56.671); assert.equal(g.lots[0].inStock, true);
});

test('fiche de traçabilité : DAR respecté ou non, engrais, semences', () => {
  const sheet = lotSheet(state(), lot());
  assert.equal(sheet.treatments.length, 2);
  const fongi = sheet.treatments.find(t => t.product === 'Fongi X');
  assert.equal(fongi.gap, 14); assert.equal(fongi.dar, 35); assert.equal(fongi.darStatus, 'non respecté');
  assert.equal(sheet.treatments.find(t => t.product === 'Herbi Y').darStatus, 'inconnu');
  assert.equal(sheet.darIssues, 1);
  assert.equal(sheet.fertilizers.length, 1); assert.equal(sheet.seeds.length, 1); assert.equal(sheet.seeds[0].variety, 'Rubisko');
});

test('route QR « #lot/<id> »', () => {
  assert.equal(lotLink('https://x.fr/Parcelles/', 'l 1'), 'https://x.fr/Parcelles/#lot/l%201');
  assert.deepEqual(parseLotRoute('#lot/l%201'), {id: 'l 1'});
  assert.equal(parseLotRoute('#equipment/x'), null);
  assert.equal(parseLotRoute('#lot/%E0'), null);
});
