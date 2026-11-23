// Rendement probable (yield-forecast.js) : base saisie ou historique, corrections NDVI et eau bornées, récolte mesurée.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {yieldForecast, NDVI_MAX_LOSS, NDVI_MAX_GAIN} from './yield-forecast.js';

const CUR = '2026/27';
function farm({economics = {}, lots = []} = {}) {
  const s = emptyState();
  const past = ['2022/23', '2023/24', '2024/25', '2025/26'], yields = [6, 9, 7, 8];
  s.parcelles = [{id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10,
    economicsByCampaign: {...Object.fromEntries(past.map((c, i) => [c, {yield: yields[i], yieldUnit: 't/ha'}])), ...economics}}];
  s.rotations = [...past, CUR].map((c, i) => ({id: `r${i}`, parcelId: 'p1', campaignId: c, culture: 'Blé tendre'}));
  s.integrationImports = lots;
  return s;
}
const forecast = (s, ctx = {}) => yieldForecast(s, s.parcelles[0], {campaign: CUR, ...ctx});

test('base : moyenne olympique des campagnes passées, sinon objectif saisi', () => {
  const f = forecast(farm());
  assert.equal(f.status, 'estime');
  assert.equal(f.tPerHa, 7.5, '6 et 9 écartés : (7 + 8) / 2');
  assert.deepEqual([f.low, f.high], [6.38, 8.63]);
  assert.match(f.text, /^Rendement probable : 7,5 t\/ha \(6,38 à 8,63\) · moyenne de 4 campagnes\.$/);
  const saisi = forecast(farm({economics: {[CUR]: {yield: 85, yieldUnit: 'q/ha'}}}));
  assert.equal(saisi.tPerHa, 8.5);
  assert.match(saisi.text, /objectif saisi/);
  const s = farm(); s.parcelles[0].economicsByCampaign = {}; s.rotations = [];
  assert.equal(forecast(s).status, 'inconnu');
});

test('NDVI : retard pris à moitié et borné, avance bornée, écart minime ignoré', () => {
  const row = gapPct => ({gapPct, ndvi: 0.6, median: 0.7, date: '2026-04-20', peers: [{}, {}]});
  const late = forecast(farm(), {ndvi: row(0.2)});
  assert.equal(late.factors[0].pct, -0.1);
  assert.equal(late.tPerHa, 6.75);
  assert.match(late.text, /végétation \(satellite\) −10 %/);
  assert.equal(forecast(farm(), {ndvi: row(0.9)}).factors[0].pct, -NDVI_MAX_LOSS);
  assert.equal(forecast(farm(), {ndvi: row(-0.6)}).factors[0].pct, NDVI_MAX_GAIN);
  assert.deepEqual(forecast(farm(), {ndvi: row(0.02)}).factors, []);
  assert.deepEqual(forecast(farm(), {ndvi: {...row(0.3), peers: []}}).factors, [], 'sans parcelle de comparaison');
});

test('eau : réserve basse seulement à un stade sensible', () => {
  const water = {balance: {fraction: 0.1}}, flowering = {status: 'ok', stage: {name: 'Floraison'}}, tillering = {status: 'ok', stage: {name: 'Début tallage'}};
  const dry = forecast(farm(), {water, phenology: flowering});
  assert.equal(dry.factors[0].key, 'water');
  assert.equal(Math.round(dry.factors[0].pct * 1000) / 1000, -0.06);
  assert.match(dry.factors[0].why, /Réserve du sol à 10 % au stade Floraison/);
  assert.deepEqual(forecast(farm(), {water, phenology: tillering}).factors, []);
  assert.deepEqual(forecast(farm(), {water: {balance: {fraction: 0.5}}, phenology: flowering}).factors, []);
});

test('récolte mesurée : remplace l’estimation', () => {
  const lots = [{id: 'l1', farmKind: 'harvest', parcelId: 'p1', campaignId: CUR, quantity: 80, unit: 't', date: '2027-07-10'}];
  const f = forecast(farm({lots}));
  assert.equal(f.status, 'mesure');
  assert.equal(f.tPerHa, 8);
  assert.match(f.text, /Rendement mesuré : 8 t\/ha \(1 lot de récolte\)/);
});

test('relecture : culture de la rotation de la campagne, pas de pénalité à maturité', () => {
  const s = farm();
  s.parcelles[0].economicsByCampaign['2025/26'] = {yield: 3.5, yieldUnit: 't/ha'};
  s.parcelles[0].economicsByCampaign['2024/25'] = {yield: 3.4, yieldUnit: 't/ha'};
  s.rotations = s.rotations.map(r => ['2024/25', '2025/26', CUR].includes(r.campaignId) ? {...r, culture: 'Colza'} : r);
  assert.equal(forecast(s).tPerHa, 3.45, 'historique du colza, la culture prévue, pas du blé');
  const water = {balance: {fraction: 0.1}};
  assert.deepEqual(forecast(farm(), {water, phenology: {status: 'ok', stage: {name: 'Maturité physiologique'}}}).factors, []);
});
