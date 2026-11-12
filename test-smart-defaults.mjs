// I7 — valeurs « comme la dernière fois » : stock, carburant, entretien.
import test from 'node:test';
import assert from 'node:assert/strict';
import {stockEntryDefaults,fuelDefaults,maintenanceDefaults,priceWarning,median} from './smart-defaults.js';

const today = '2026-11-12';
let n = 0;
const mv = (date, x = {}) => ({id: `m${++n}`, stockItemId: 's1', type: 'Entrée', quantity: 10, date, createdAt: n, ...x});
const stockState = movements => ({stockItems: [{id: 's1', name: 'Engrais', unit: 'kg'}], stockMovements: movements});
const fuel = (date, litres, unitPrice, x = {}) => ({id: `f${++n}`, farmKind: 'fuel', entry: 'tank', date, litres, unitPrice, createdAt: n, ...x});

test('historique vide : null partout', () => {
  const s = stockEntryDefaults({}, 's1', {today});
  assert.deepEqual(s, {supplier: null, unitPrice: null, unit: null, expiryOffsetDays: null, priceMedian: null});
  assert.deepEqual(fuelDefaults({}, {today}), {supplier: null, pricePerLiter: null, tank: null, liters: null, priceMedian: null});
  assert.deepEqual(maintenanceDefaults({}, 't1', 'Vidange', {today}), {interval: null, counter: null});
  assert.deepEqual(stockEntryDefaults(stockState([]), 's1', {today}).unit, null);
});

test('fournisseur choisi par fréquence puis par récence', () => {
  const s = stockState([
    mv('2026-02-01', {supplier: 'Coop A'}), mv('2026-03-01', {supplier: 'Négoce B'}), mv('2026-04-01', {supplier: 'coop a'}),
    mv('2026-09-12', {supplier: 'Négoce B'}), mv('2026-10-01', {supplier: 'Coop C'}),
    mv('2025-01-01', {supplier: 'Vieux'}), mv('2025-01-02', {supplier: 'Vieux'}), mv('2025-01-03', {supplier: 'Vieux'})
  ]);
  const d = stockEntryDefaults(s, 's1', {today});
  assert.equal(d.supplier.value, 'Négoce B'); // 2 contre 2 pour Coop A, plus récent ; « Vieux » hors 12 mois
  assert.match(d.supplier.from, /2 entrées sur 12 mois/);
  const one = stockEntryDefaults(stockState([mv('2026-09-12', {supplier: 'Coop X'})]), 's1', {today});
  assert.deepEqual(one.supplier, {value: 'Coop X', from: 'dernière entrée du 12/09'});
});

test('dernier prix, médiane des 3 derniers, unité et péremption', () => {
  const s = stockState([
    mv('2026-01-01', {unitPrice: 50}), mv('2026-03-01', {unitPrice: 9}), mv('2026-05-01', {unitPrice: 9.2}),
    mv('2026-09-12', {unitPrice: 10, expiryDate: '2028-09-11'}), mv('2026-10-01', {type: 'Sortie', unitPrice: 99})
  ]);
  const d = stockEntryDefaults(s, 's1', {today});
  assert.deepEqual(d.unitPrice, {value: 10, from: 'dernière entrée du 12/09'});
  assert.equal(d.priceMedian, 9.2);
  assert.equal(d.unit.value, 'kg');
  assert.equal(d.expiryOffsetDays.value, 730);
  assert.equal(median([3, 1, 2, 4]), 2.5);
});

test('entités supprimées et mouvements annulés exclus', () => {
  const s = stockState([
    mv('2026-09-01', {supplier: 'Bon', unitPrice: 9}),
    mv('2026-10-01', {supplier: 'Supprimé', unitPrice: 90, deletedAt: 1}),
    mv('2026-10-02', {supplier: 'Annulé', unitPrice: 80, status: 'Annulé'}),
    mv('2026-10-03', {supplier: 'Annulé2', unitPrice: 70, cancelledAt: 5})
  ]);
  const d = stockEntryDefaults(s, 's1', {today});
  assert.equal(d.supplier.value, 'Bon'); assert.equal(d.unitPrice.value, 9); assert.equal(d.priceMedian, 9);
  const f = fuelDefaults({integrationImports: [fuel('2026-09-01', 2000, 1.1, {supplier: 'Coop X'}), fuel('2026-10-01', 9000, 3, {deletedAt: 1, supplier: 'Z'})]}, {today});
  assert.equal(f.supplier.value, 'Coop X'); assert.equal(f.liters.value, 2000);
  assert.deepEqual(stockEntryDefaults(stockState([mv('2026-09-01', {deletedAt: 1, supplier: 'X', unitPrice: 1})]), 's1', {today}),
    {supplier: null, unitPrice: null, unit: null, expiryOffsetDays: null, priceMedian: null});
});

test('fuelDefaults sur 3 pleins de cuve', () => {
  const s = {preferences: {fuelTank: {capacity: 3000}}, integrationImports: [
    fuel('2026-03-01', 2000, 1.1, {supplier: 'Coop X'}), fuel('2026-06-01', 1500, 1.2, {supplier: 'Coop X'}), fuel('2026-09-12', 2500, 1.12, {supplier: 'Pétrole Y'}),
    fuel('2026-10-01', 100, 1.5, {entry: 'machine', equipmentId: 't1', meter: 1200, fromTank: false})
  ]};
  const d = fuelDefaults(s, {today});
  assert.equal(d.supplier.value, 'Coop X');
  assert.deepEqual(d.pricePerLiter, {value: 1.12, from: 'dernière livraison du 12/09'});
  assert.equal(d.priceMedian, 1.12);
  assert.deepEqual(d.liters, {value: 2000, from: 'médiane de 3 livraisons'});
  assert.equal(d.tank.value, 3000);
  const m = fuelDefaults(s, {today, entry: 'machine', equipmentId: 't1'});
  assert.equal(m.liters.value, 100); assert.equal(m.tank.value, false); assert.equal(m.pricePerLiter.value, 1.5);
});

test('compteur estimé = dernier compteur + durées des travaux depuis', () => {
  const s = {
    materiels: [{id: 't1', nom: 'Tracteur', currentMeter: 1000}],
    maintenanceRecords: [
      {id: 'r1', equipmentId: 't1', type: 'Vidange', date: '2026-01-10', meter: 1000},
      {id: 'r2', equipmentId: 't1', type: 'Vidange', date: '2026-06-10', meter: 1250},
      {id: 'r3', equipmentId: 't1', type: 'Vidange', date: '2026-09-01', meter: 1500},
      {id: 'r4', equipmentId: 't1', type: 'Vidange', date: '2026-09-05', meter: 9999, deletedAt: 1}
    ],
    interventions: [
      {id: 'w1', equipmentId: 't1', date: '2026-09-10', status: 'Terminé', duration: 6},
      {id: 'w2', equipmentId: 't1', date: '2026-10-01', status: 'Terminé', durationHours: 4.5},
      {id: 'w3', equipmentId: 't1', date: '2026-10-02', status: 'À faire', duration: 50},
      {id: 'w4', equipmentId: 't1', date: '2026-08-01', status: 'Terminé', duration: 30},
      {id: 'w5', equipmentId: 't2', date: '2026-10-05', status: 'Terminé', duration: 30},
      {id: 'w6', equipmentId: 't1', date: '2026-10-06', status: 'Terminé', duration: 30, deletedAt: 1}
    ]
  };
  const d = maintenanceDefaults(s, 't1', 'Vidange', {today});
  assert.equal(d.counter.value, 1510.5);
  assert.match(d.counter.from, /relevé du 01\/09 \+ 10,5 h/);
  assert.equal(d.interval.value, 250); assert.equal(d.interval.unit, 'h');
  // Un plein d'engin plus récent avec compteur devient la référence.
  s.integrationImports = [fuel('2026-09-20', 120, 1.2, {entry: 'machine', equipmentId: 't1', meter: 1520})];
  assert.equal(maintenanceDefaults(s, 't1', 'Vidange', {today}).counter.value, 1524.5);
  assert.equal(maintenanceDefaults(s, 't1', 'Graissage', {today}).interval, null);
});

test('priceWarning à 20 %', () => {
  assert.equal(priceWarning(92, 9.2), 'Prix inhabituel : 92,00 € contre 9,20 € d’habitude. Vérifiez la saisie.');
  assert.equal(priceWarning(1.2, 1), null);
  assert.equal(priceWarning(0.8, 1), null);
  assert.ok(priceWarning(1.21, 1));
  assert.ok(priceWarning(0.79, 1));
  assert.equal(priceWarning('', 1), null);
  assert.equal(priceWarning(5, null), null);
  assert.match(priceWarning(2, 1, {unit: 'L'}), /2,00 €\/L contre 1,00 €\/L/);
});

test('entretien sans engin : pas de relevé emprunté aux autres engins', () => {
  const s = {integrationImports: [fuel('2026-09-20', 120, 1.2, {entry: 'machine', equipmentId: 't9', meter: 4000})]};
  assert.deepEqual(maintenanceDefaults(s, '', 'Vidange', {today}), {interval: null, counter: null});
  assert.deepEqual(maintenanceDefaults(s, undefined, 'Vidange', {today}), {interval: null, counter: null});
});

test('fiche engin corrigée après le relevé : heures comptées une seule fois, journées TP incluses', () => {
  const updatedAt = new Date(2026, 9, 1, 18).getTime(); // fiche mise à jour le 01/10 (heure locale)
  const s = {
    materiels: [{id: 't1', nom: 'Tracteur', currentMeter: 1600, updatedAt}],
    maintenanceRecords: [{id: 'r1', equipmentId: 't1', type: 'Vidange', date: '2026-09-01', meter: 1500}],
    interventions: [
      {id: 'w1', equipmentId: 't1', date: '2026-09-15', status: 'Terminé', duration: 80}, // déjà dans la fiche
      {id: 'w2', equipmentId: 't1', date: '2026-10-10', status: 'Terminé', duration: 5}
    ],
    chantiers: [{id: 'c1', kind: 'tp', tpLogs: [{date: '2026-10-11', equipmentId: 't1', hours: 3}, {date: '2026-10-12', equipmentId: 't2', hours: 9}]}]
  };
  const d = maintenanceDefaults(s, 't1', 'Vidange', {today});
  assert.equal(d.counter.value, 1608);
  assert.match(d.counter.from, /compteur de la fiche engin \(mis à jour le 01\/10\) \+ 8 h/);
  delete s.materiels[0].updatedAt; // date de mise à jour inconnue : la fiche seule
  assert.deepEqual(maintenanceDefaults(s, 't1', 'Vidange', {today}).counter, {value: 1600, from: 'compteur de la fiche engin'});
  s.materiels[0].currentMeter = 1000; // fiche plus basse : relevé + travaux + TP depuis le 01/09
  assert.equal(maintenanceDefaults(s, 't1', 'Vidange', {today}).counter.value, 1588);
});
