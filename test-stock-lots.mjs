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

// n° 73 (complément) : lot scanné, lot consommé par un travail, emballages vides.
test('lot saisi par photo, sortie d’un lot désigné et choix du lot sur un travail', async () => {
  const {entryMovement} = await import('./stock-capture.js');
  const {productLotChoices} = await import('./stock-lots.js');
  const scanned = {id: 'm4', createdAt: Date.parse('2026-05-01'), delta: 10, ...entryMovement({product: 'Fongi X', quantity: 10, unitPrice: 13, lot: 'C3', supplier: 'Négoce Fictif', expiryDate: '30/09/2026'}, 'i1', {date: '2026-05-01'})};
  assert.equal(scanned.lotNumber, 'C3'); assert.equal(scanned.supplier, 'Négoce Fictif'); assert.equal(scanned.expiryDate, '2026-09-30');
  assert.equal('lot' in scanned, false);
  const legacy = mv('m5', '2026-05-02', 'Entrée', 5, {lot: 'OLD9'}); // ancienne saisie par photo (champ « lot »)
  const s = farm({stockMovements: [...farm().stockMovements, scanned, legacy]});
  s.stockItems[0].quantity = 85;
  const lots = itemLots(s, s.stockItems[0], {today: T});
  assert.deepEqual(lots.map(l => l.lotNumber), ['A1', 'B2', 'C3', 'OLD9']);
  assert.ok(inputAlerts(s, {today: T}).some(a => /C3/.test(a.text) || /péri/i.test(a.text)));
  // Une sortie de travail qui désigne B2 est prise sur B2, pas sur le plus ancien lot.
  s.stockMovements.push(mv('m6', '2026-06-01', 'Sortie', 20, {lotNumber: 'B2'}));
  s.stockItems[0].quantity = 65;
  const after = Object.fromEntries(itemLots(s, s.stockItems[0], {today: T}).map(l => [l.lotNumber, l.remaining]));
  assert.deepEqual(after, {A1: 20, B2: 30, C3: 10, OLD9: 5});
  const choices = productLotChoices(s, {product: 'fongi x'}, {today: T});
  assert.deepEqual(choices.map(c => c.lotNumber), ['A1', 'B2', 'C3', 'OLD9']);
  assert.equal(choices[0].expired, true);
  assert.deepEqual(productLotChoices(s, {product: 'Autre produit'}, {today: T}), []);
  assert.deepEqual(productLotChoices({...s, stockItems: [{...s.stockItems[0], category: 'Semence'}]}, {product: 'Fongi X'}, {today: T}), []);
});

test('emballages vides à rapporter : compteur par article et rappel ADIVALOR', async () => {
  const {emptyPackages, packagesAfter, packageCount} = await import('./stock-lots.js');
  const s = farm({stockItems: [{id: 'i1', name: 'Fongi X', quantity: 0, emptyPackages: 3}, {id: 'i2', name: 'Herbi Y', quantity: 0, emptyPackages: '2'}, {id: 'i3', name: 'Z', quantity: 0}]});
  assert.deepEqual(emptyPackages(s).items.map(r => [r.item.id, r.count]), [['i1', 3], ['i2', 2]]);
  assert.equal(emptyPackages(s).total, 5);
  assert.equal(packagesAfter(s.stockItems[0], 1), 4);
  assert.equal(packagesAfter(s.stockItems[2], -1), 0);
  assert.equal(packagesAfter(s.stockItems[0], null), 0);
  assert.equal(packageCount({emptyPackages: -4}), 0);
  const r = adivalorReminder(s, {today: T});
  assert.equal(r.packages, 5); assert.equal(r.count, 0); assert.equal(r.missingDate, true);
  s.preferences.adivalorNextCollection = '2026-10-20';
  assert.equal(adivalorReminder(s, {today: T}).due, true);
  assert.equal(adivalorReminder(farm(), {today: T}).due, false);
});

test('branchement : champs de capture, emballages et lot du travail', async () => {
  const {readFileSync} = await import('node:fs');
  const ui = readFileSync(new URL('./stock-lots-ui.js', import.meta.url), 'utf8');
  for (const k of ['pack-add', 'pack-remove', 'pack-done', "label:'Annuler'", 'name="productLot"', 'enhanceWorkForm']) assert.ok(ui.includes(k), k);
  assert.match(readFileSync(new URL('./work-form-ui.js', import.meta.url), 'utf8'), /ctx\.stockLotsUI\?\.enhanceWorkForm\(form, item\)/);
  assert.match(readFileSync(new URL('./app.js', import.meta.url), 'utf8'), /get stockLotsUI\(\)\{return stockLotsUI;\}/);
  assert.match(readFileSync(new URL('./work-effects.js', import.meta.url), 'utf8'), /work\.productLot&&change\.delta<0\?\{lotNumber:/);
  const cap = readFileSync(new URL('./stock-capture-ui.js', import.meta.url), 'utf8');
  assert.ok(cap.includes('sc-supplier') && cap.includes('sc-expiry'));
});
