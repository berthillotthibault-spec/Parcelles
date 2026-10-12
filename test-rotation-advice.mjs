import test from 'node:test';
import assert from 'node:assert/strict';
import {rotationFamily, rotationAlerts, cultureHistory, marginRanking} from './rotation-advice.js';
import {answerLocalIntelligence} from './intelligence.js';
import {answerQuery} from './query-engine.js';

const C = '2026/27';
const farm = () => ({preferences: {}, parcelles: [
  {id: 'a', nom: 'La Côte', culture: 'Blé tendre', surfaceHa: 10, economicsByCampaign: {[C]: {yield: 8, salePrice: 200}}},
  {id: 'b', nom: 'Les Noues', culture: 'Maïs grain', surfaceHa: 5, economicsByCampaign: {[C]: {yield: 10, salePrice: 180}}},
  {id: 'c', nom: 'Le Pré Bas', culture: 'Prairie', surfaceHa: 4}],
  rotations: [
    {id: 'r1', parcelId: 'a', campaignId: '2025/26', culture: 'Colza'},
    {id: 'r2', parcelId: 'a', campaignId: '2027/28', culture: 'Colza d’hiver'},
    {id: 'r3', parcelId: 'b', campaignId: '2023/24', culture: 'Colza'},
    {id: 'r4', parcelId: 'b', campaignId: '2027/28', culture: 'Colza'}],
  interventions: [
    {id: 'w1', parcelId: 'a', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 600, campaignId: C},
    {id: 'w2', parcelId: 'b', type: 'Semis', date: '2026-10-02', status: 'Terminé', cost: 200, campaignId: C},
    {id: 'w3', parcelId: 'b', type: 'Désherbage', date: '2026-11-02', status: 'À faire', campaignId: C}]});

test('famille de culture et historique', () => {
  assert.equal(rotationFamily('Colza d’hiver'), 'colza');
  assert.equal(rotationFamily('Blé tendre'), null);
  assert.deepEqual(cultureHistory(farm(), 'a', {current: C}).map(h => h.campaignId), ['2025/26', C, '2027/28']);
});

test('alerte douce : colza revenu trop tôt, délai réglable', () => {
  const list = rotationAlerts(farm(), {current: C});
  assert.equal(list.length, 1);
  assert.equal(list[0].message, 'La Côte : colza prévu en 2027/28, dernier colza en 2025/26 (délai conseillé 3 ans, réglable).');
  const tuned = {...farm(), preferences: {rotationDelays: {colza: 5}}};
  assert.equal(rotationAlerts(tuned, {current: C}).length, 2);
});

test('classement par marge/ha avec écart à la moyenne et données manquantes', () => {
  const m = marginRanking(farm(), {campaign: C});
  assert.deepEqual(m.ranked.map(r => r.parcelName), ['La Côte', 'Les Noues']);
  assert.equal(m.ranked[0].marginHa, 1540);
  assert.equal(m.ranked[1].marginHa, 1760);
  assert.ok(m.ranked[0].gap < 0);
  assert.equal(Math.round(m.average), Math.round((1540 * 10 + 1760 * 5) / 15));
  assert.deepEqual(m.ranked.find(r => r.parcelName === 'Les Noues').missing, ['1 travail prévu non chiffré']);
  assert.equal(m.unranked[0].parcelName, 'Le Pré Bas');
  assert.deepEqual(m.unranked[0].missing, ['rendement et prix']);
});

test('assistant : « quelle parcelle me rapporte le moins ? »', () => {
  const q = 'Quelle parcelle me rapporte le moins ?';
  assert.equal(answerQuery(q, farm(), {now: Date.now()}).recognized, false, 'pas capté par le moteur de requêtes');
  const r = answerLocalIntelligence(q, farm(), {campaign: C});
  assert.equal(r.intent, 'margin_rank');
  assert.match(r.answer, /^La plus faible marge brute en 2026\/27 : La Côte \(Blé tendre\), 1[\s ]540,00[\s ]€\/ha, 73,33[\s ]€\/ha sous la moyenne/);
  assert.match(r.answer, /Le Pré Bas : rendement et prix/);
  assert.equal(r.actions[0].payload.parcelId, 'a');
  assert.match(answerLocalIntelligence('Quelle parcelle est la plus rentable ?', farm(), {campaign: C}).answer, /^La meilleure marge brute en 2026\/27 : Les Noues/);
  assert.equal(answerLocalIntelligence('Des alertes de rotation ?', farm(), {}).intent, 'rotation_alerts');
});
