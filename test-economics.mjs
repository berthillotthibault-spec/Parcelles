// n° 85 — moteur de marge unique (marginModel).
import test from 'node:test';
import assert from 'node:assert/strict';
import {marginModel,parcelMargin,mapEconomics,buildPilotage,reliabilityText} from './pilotage.js';
import {pilotageReportHtml} from './reports.js';

const C = '2026/27';
const base = () => ({
  parcelles: [
    {id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10, economicsByCampaign: {[C]: {yield: 8, salePrice: 200, inputCostHa: 300}}},
    {id: 'p2', nom: 'Grand Champ', culture: 'Maïs grain', surfaceHa: 5, economicsByCampaign: {[C]: {yield: 90, yieldUnit: 'q/ha', salePrice: 18}}}],
  interventions: [], rotations: []});

test('réalisé, engagé (planifié) et prévisionnel', () => {
  const s = base();
  s.interventions.push({id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 1000},
    {id: 'w2', parcelId: 'p1', type: 'Désherbage', plannedDate: '2027-03-01', status: 'À faire', cost: 500});
  const r = parcelMargin(s, s.parcelles[0], {campaign: C});
  assert.equal(r.realized, 1000); assert.equal(r.engaged, 500);
  assert.equal(r.product, 16000);
  assert.equal(r.marginRealized, 15000); assert.equal(r.margin, 14500);
  // Forfait manuel ignoré : des travaux sont chiffrés.
  assert.equal(r.forfaitApplied, false); assert.equal(r.ignoredManual, 3000);
  assert.equal(r.reliability, 100);
});

test('charges manuelles : forfait seulement sans travail chiffré', () => {
  const s = base();
  const r = parcelMargin(s, s.parcelles[0], {campaign: C});
  assert.equal(r.forfaitApplied, true); assert.equal(r.forfait, 3000); assert.equal(r.margin, 13000);
  assert.equal(r.lines.find(l => l.key === 'forfait').status, 'connu');
});

test('travaux sans coût : non comptés comme 0 €, la fiabilité baisse', () => {
  const s = base();
  s.interventions.push({id: 'a', parcelId: 'p1', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 800},
    {id: 'b', parcelId: 'p1', type: 'Roulage', date: '2026-10-02', status: 'Terminé'},
    {id: 'c', parcelId: 'p1', type: 'Fongicide', plannedDate: '2027-04-01', status: 'À faire'});
  const r = parcelMargin(s, s.parcelles[0], {campaign: C});
  assert.equal(r.unknownRealized, 1); assert.equal(r.unknownPlanned, 1);
  assert.equal(r.reliability, Math.round((1 / 3 + 1) / 2 * 100));
  assert.equal(r.lines.find(l => l.key === 'realized').status, 'partiel');
  const m = marginModel(s, {campaign: C});
  assert.match(m.reliability.label, /^fiable à \d+ % \(1 travail réalisé sans coût, 1 travail prévu non chiffré\)$/);
  // Sans rendement ni prix : marge inconnue (null), pas 0 €.
  s.parcelles[0].economicsByCampaign[C] = {};
  assert.equal(parcelMargin(s, s.parcelles[0], {campaign: C}).margin, null);
  assert.equal(mapEconomics(s, {campaign: C}).get('p1').marginHa, null);
});

test('changement de culture : culture résolue par campagne via la rotation', () => {
  const s = base();
  s.rotations.push({id: 'r1', parcelId: 'p1', campaignId: '2027/28', culture: 'Colza'});
  assert.equal(parcelMargin(s, s.parcelles[0], {campaign: '2027/28'}).culture, 'Colza');
  assert.equal(parcelMargin(s, s.parcelles[0], {campaign: C}).culture, 'Blé tendre');
  const m = marginModel(s, {campaign: '2027/28'});
  assert.ok(m.byCulture.some(c => c.culture === 'Colza'));
  assert.equal(m.total.margin, null); // aucune économie saisie pour 2027/28
});

test('unité q/ha : rendement × prix au quintal', () => {
  const s = base();
  const r = parcelMargin(s, s.parcelles[1], {campaign: C});
  assert.equal(r.productHa, 1620); assert.equal(r.product, 8100);
  assert.equal(r.yieldUnit, 'q/ha');
});

test('Pilotage, carte et rapport partagent le même moteur', () => {
  const s = {...base(), stockItems: [], materiels: [], maintenanceRecords: [], stockMovements: [], exploitation: {nom: 'Test'}};
  s.interventions.push({id: 'w1', parcelId: 'p2', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 1000});
  const m = marginModel(s, {campaign: C}), p = buildPilotage(s, {campaign: C});
  assert.equal(p.margin, m.total.margin); assert.equal(p.grossProduct, m.total.product);
  assert.equal(m.total.margin, 16000 - 3000 + 8100 - 1000);
  assert.equal(mapEconomics(s, {campaign: C}).get('p2').marginHa, (8100 - 1000) / 5);
  assert.match(pilotageReportHtml(s, C), /fiable à/);
  assert.equal(reliabilityText({...m.total, reliability: 72, unknownRealized: 5, unknownPlanned: 0, withoutProduct: 0}).label, 'fiable à 72 % (5 travaux réalisés sans coût)');
});
