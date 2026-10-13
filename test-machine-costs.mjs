// n° 87 et n° 69 — coût réel du matériel (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {machineCost,machineCosts,machineRates,validateRates,guessCategory,underuseText,hourlyCostPatch,gapTone} from './machine-costs.js';

const C = '2026/27';
const farm = (prefs = {}, extra = {}) => ({preferences: {fuelPrice: 1.2, ...prefs}, rotations: [], chantiers: [], clients: [],
  parcelles: [{id: 'p1', nom: 'A', surfaceHa: 10}, {id: 'p2', nom: 'B', surfaceHa: 5}],
  materiels: [
    {id: 'm1', nom: 'Tracteur Fendt', hourlyCost: 42, amortization: 6000, insurance: 1000, actualFuel: 10, currentMeter: 2450, maintenanceDue: 2500},
    {id: 'm2', nom: 'Déchaumeur à disques', amortization: 3000}],
  maintenanceRecords: [{id: 'r1', equipmentId: 'm1', date: '2026-11-02', cost: 1000}, {id: 'r0', equipmentId: 'm1', date: '2025-11-02', cost: 9999}],
  integrationImports: [{id: 'f1', farmKind: 'fuel', entry: 'machine', equipmentId: 'm1', date: '2026-10-20', litres: 500, unitPrice: 1, amount: 500}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Labour', date: '2026-10-05', status: 'Terminé', equipmentId: 'm1', duration: 100},
    {id: 'w2', parcelId: 'p2', type: 'Semis', date: '2026-10-10', status: 'Terminé', equipmentId: 'm1', duration: 100},
    {id: 'w3', parcelId: 'p2', type: 'Semis', date: '2026-10-11', status: 'Terminé', equipmentId: 'm1'},
    {id: 'w4', parcelId: 'p1', type: 'Déchaumage', date: '2026-09-01', status: 'Terminé', equipmentId: 'm2', duration: 38, surfaceWorked: 40},
    {id: 'w5', parcelId: 'p1', type: 'Labour', date: '2026-10-12', status: 'Prévu', equipmentId: 'm1', duration: 50}],
  ...extra});

test('coût complet par heure et par hectare, avec complétude des heures', () => {
  const r = machineCost(farm(), farm().materiels[0], {campaign: C});
  // 6000 + 1000 + entretien 1000 (seul celui de la campagne) + carburant 500 (plein) = 8500
  assert.equal(r.total, 8500);
  assert.equal(r.hours, 200);
  assert.equal(r.perHour, 42.5);
  assert.equal(r.hectares, 20); // 10 + 5 + 5 (travail sans heures compté en surface)
  assert.equal(r.perHa, 425);
  assert.equal(r.completeness, 67);
  assert.equal(r.fuelSource, 'pleins');
  assert.equal(r.gapPct, 1);
  assert.equal(r.remaining, 50);
  assert.ok(r.missing.some(m => /sans heures/.test(m)));
});

test('carburant estimé l/h × heures quand aucun plein ni travail chiffré', () => {
  const s = farm({}, {integrationImports: []});
  const r = machineCost(s, s.materiels[0], {campaign: C});
  assert.equal(r.fuelSource, 'estimé');
  assert.equal(r.fuel, 2400); // 10 l/h × 200 h × 1,2 €/L
  assert.equal(r.estimated, true);
});

test('barème saisi : catégorie devinée, écart et alerte de sous-utilisation', () => {
  assert.equal(guessCategory({nom: 'Déchaumeur à disques'}), 'dechaumeur');
  assert.equal(guessCategory({nom: 'Tracteur Fendt'}), 'tracteur');
  assert.equal(guessCategory({nom: 'Bidule'}), 'autre');
  const s = farm({machineRates: {year: 2025, source: 'barème régional', values: {dechaumeur: {value: 45, unit: 'ha'}}}});
  const m = machineCosts(s, {campaign: C}), d = m.rows.find(r => r.id === 'm2');
  assert.equal(d.perHour, 78.95);
  assert.equal(d.perHa, 75);
  assert.equal(d.refGapPct, 67);
  assert.equal(gapTone(d.refGapPct), 'is-bad');
  assert.equal(d.underused, true);
  assert.match(underuseText(d), /38 h.*79 €\/h.*facturerait environ 45 €\/ha/);
  assert.equal(m.alerts.length, 1);
});

test('aucune valeur de barème inventée et validation', () => {
  const r = machineRates({preferences: {}});
  assert.ok(Object.values(r.values).every(v => v.value === null));
  assert.equal(r.underuseHours, 50);
  assert.match(validateRates({year: '1800'}).error, /Millésime/);
  assert.match(validateRates({rate_tracteur: '-3'}).error, /Tracteur/);
  const ok = validateRates({year: '2025', source: 'BCMA', rate_tracteur: '38,5', unit_tracteur: 'h', underuseHours: '60'});
  assert.equal(ok.value.values.tracteur.value, 38.5);
  assert.equal(ok.value.underuseHours, 60);
});

test('mise à jour du coût horaire : seule la valeur réelle est reprise, l’ancienne gardée en trace', () => {
  const s = farm(), r = machineCost(s, s.materiels[0], {campaign: C});
  const p = hourlyCostPatch(s.materiels[0], r, 1);
  assert.equal(p.hourlyCost, 42.5);
  assert.equal(p.hourlyCostSource.previous, 42);
  assert.equal(p.nom, 'Tracteur Fendt');
  const empty = machineCost(s, {id: 'x', nom: 'Vide'}, {campaign: C});
  assert.throws(() => hourlyCostPatch({id: 'x'}, empty), /inconnu/);
});
