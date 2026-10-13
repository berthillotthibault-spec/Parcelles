// n° 92 — historique pluriannuel des campagnes (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignHistory,underperformers,olympicMean,campaignRange,sparkPoints} from './campaign-history.js';
import {marginModel} from './pilotage.js';

const econ = (y, p) => ({yield: y, salePrice: p});
const farm = () => ({preferences: {}, integrationImports: [],
  rotations: [{id: 'r1', parcelId: 'p2', campaignId: '2024/25', culture: 'Colza'}],
  parcelles: [
    {id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 10, economicsByCampaign: {'2022/23': econ(6, 200), '2023/24': econ(6, 200), '2024/25': econ(5, 200), '2025/26': econ(7, 200), '2026/27': econ(6, 200)}},
    {id: 'p2', nom: 'Grand Champ', culture: 'Blé tendre', surfaceHa: 10, economicsByCampaign: {'2022/23': econ(8, 200), '2023/24': econ(8, 200), '2024/25': econ(3, 500), '2025/26': econ(6, 200), '2026/27': econ(8, 200)}}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 2000},
    {id: 'w2', parcelId: 'p2', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 2000}]});

test('plage de campagnes au format 2026/27, bornée de 3 à 5 ans', () => {
  assert.deepEqual(campaignRange('2026/27', 3), ['2024/25', '2025/26', '2026/27']);
  assert.equal(campaignHistory(farm(), {campaign: '2026/27', years: 9}).campaigns.length, 5);
  assert.equal(campaignHistory(farm(), {campaign: '2026/27', years: 1}).campaigns.length, 3);
});

test('par culture : culture de l’assolement de chaque campagne et valeurs du moteur unique', () => {
  const h = campaignHistory(farm(), {campaign: '2026/27', years: 5});
  const ble = h.rows.find(r => r.label === 'Blé tendre'), colza = h.rows.find(r => r.label === 'Colza');
  assert.deepEqual(colza.values, [null, null, 1500, null, null]);
  assert.equal(ble.cells[2].area, 10); // en 2024/25, Grand Champ était en colza
  assert.equal(ble.values[4], marginModel(farm(), {campaign: '2026/27'}).byCulture[0].marginHa);
  assert.deepEqual(h.farm, [1400, 1400, 1250, 1300, 1200]);
});

test('moyenne olympique : sans la meilleure ni la pire année', () => {
  assert.deepEqual(olympicMean([10, 100, 20, 30, null]), {value: 25, kind: 'olympique', count: 4});
  assert.deepEqual(olympicMean([10, 20]), {value: 15, kind: 'simple', count: 2});
  assert.equal(olympicMean([null]).value, null);
});

test('parcelles régulièrement sous la moyenne de l’exploitation', () => {
  const h = campaignHistory(farm(), {campaign: '2026/27', years: 5, by: 'parcel'});
  const brosses = h.rows.find(r => r.label === 'Les Brosses');
  assert.deepEqual(brosses.values, [1200, 1200, 1000, 1400, 1000]);
  assert.equal(brosses.cells[2].culture, 'Blé tendre');
  const weak = underperformers(h);
  assert.equal(weak.length, 1);
  assert.equal(weak[0].text, 'Les Brosses : 4 années sur 5 sous la moyenne de l’exploitation');
  const costs = campaignHistory(farm(), {campaign: '2026/27', years: 3, metric: 'costHa'});
  assert.deepEqual(costs.rows.find(r => r.label === 'Blé tendre').values, [0, 0, 200]);
});

test('mini-courbe : points sautant les années inconnues', () => {
  assert.deepEqual(sparkPoints([null, 5]), []);
  const p = sparkPoints([0, null, 10], {width: 64, height: 20, pad: 2});
  assert.deepEqual(p, [[2, 18], [62, 2]]);
});

test('par culture : les variantes d’un même libellé s’additionnent au lieu de s’écraser', () => {
  const s = farm();
  s.parcelles[0].surfaceHa = 20;
  s.parcelles[1].culture = 'blé tendre';
  s.parcelles[1].surfaceHa = 5;
  const h = campaignHistory(s, {campaign: '2026/27', years: 5});
  const rows = h.rows.filter(r => r.label.toLowerCase() === 'blé tendre');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Blé tendre');
  assert.equal(rows[0].cells[3].area, 25);
  assert.equal(rows[0].values[3], marginModel(s, {campaign: '2025/26'}).total.marginHa);
});
