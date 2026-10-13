// n° 91 — marge nette : fermages, charges de structure et aides, sur le moteur unique.
import test from 'node:test';
import assert from 'node:assert/strict';
import {netMargin,netWaterfall,validateSheet,structureSheet,copySheet} from './net-margin.js';
import {cropMargins} from './crop-margins.js';

const C = '2026/27';
const farm = (prefs = {}) => ({preferences: prefs, rotations: [], integrationImports: [],
  parcelles: [
    {id: 'p1', nom: 'A', culture: 'Blé tendre', surfaceHa: 10, economicsByCampaign: {[C]: {yield: 8, salePrice: 200}},
      lease: {ownerName: 'M. Martin', leaseType: 'fermage', rent: 150, rentMode: 'eur'}},
    {id: 'p2', nom: 'B', culture: 'Colza', surfaceHa: 5, economicsByCampaign: {[C]: {yield: 4, salePrice: 500}}}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-10-02', status: 'Terminé', cost: 1000, machineCost: 600},
    {id: 'w2', parcelId: 'p2', type: 'Semis', date: '2026-09-02', status: 'Terminé', cost: 500, machineCost: 500}]});

test('la marge directe vient de cropMargins, sans second calcul', () => {
  const s = farm(), n = netMargin(s, {campaign: C}), cm = cropMargins(s, {campaign: C});
  for (const r of n.rows) assert.equal(r.directHa, cm.rows.find(x => x.key === r.key).directHa);
  assert.equal(n.total.directHa, cm.total.directHa);
});

test('fermages affectés à la culture, structure et aides au prorata ou ciblées', () => {
  const sheet = {items: {social: {amount: 3000}, insurance: {amount: 1500, target: 'Colza'}, dpb: {amount: 2250}}};
  const n = netMargin(farm({structureByCampaign: {[C]: sheet}}), {campaign: C});
  const ble = n.rows.find(r => r.culture === 'Blé tendre'), colza = n.rows.find(r => r.culture === 'Colza');
  assert.equal(n.rentTotal, 1500);
  assert.equal(ble.rentHa, 150); assert.equal(colza.rentHa, 0);
  assert.equal(ble.structureHa, 200); // 3000 € × 10/15 ha ÷ 10 ha
  assert.equal(colza.structureHa, 500); // 1000 € de MSA + 1500 € d'assurance ciblée, ÷ 5 ha
  assert.equal(ble.aidsHa, 150); assert.equal(colza.aidsHa, 150);
  assert.equal(ble.netHa, 1600 - 100 - 150 - 200 + 150);
  assert.ok(Math.abs(n.total.netHa - (ble.net + colza.net) / 15) < 0.01);
  assert.equal(n.aidsAreEstimates, true);
  const steps = netWaterfall(n.total);
  assert.equal(steps.at(-1).label, 'Marge nette');
  assert.equal(steps.at(-1).value, n.total.netHa);
});

test('replis : forfait de structure €/ha et aides €/ha de Marges par culture', () => {
  const n = netMargin(farm({structureCostHa: 100, pacAidsHa: {decoupled: 120, ecoScheme: 60}}), {campaign: C});
  assert.equal(n.chargesSource, 'forfait'); assert.equal(n.chargesTotal, 1500);
  assert.equal(n.aidsSource, 'marges'); assert.equal(n.aidsTotal, 2700);
  const none = netMargin(farm(), {campaign: C});
  assert.equal(none.chargesSource, null); assert.equal(none.aidsSource, null);
  assert.equal(none.aidsAreEstimates, false);
});

test('fiche : validation, valeur absente = null, reprise de campagne', () => {
  assert.match(validateSheet({amount_social: '-5'}).error, /MSA/);
  const ok = validateSheet({amount_social: '3 000', target_social: '', amount_dpb: '', target_dpb: 'Colza'});
  assert.equal(ok.value.items.social.amount, 3000);
  assert.equal(ok.value.items.dpb.amount, null);
  assert.equal(structureSheet({preferences: {}}, C).exists, false);
  const s = farm({structureByCampaign: {'2025/26': {items: {social: {amount: 2800}}}}});
  assert.equal(copySheet(s, '2025/26').items.social.amount, 2800);
  assert.equal(copySheet(s, '2024/25'), null);
});
