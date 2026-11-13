import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {grazingRotationAdvice} from './grazing-rotation.js';
import {GRASS_REFERENCE, temperatureFactor, waterFactor, recentMeanTemperature, estimateGrassGrowth, grasslandWaterFraction, farmGrassGrowth, growthOptions} from './grass-growth.js';
import {AGRO_WEATHER_KEY} from './agro-weather.js';
import {SOIL_WATER_CACHE_KEY} from './soil-water.js';

const TODAY = '2026-05-12';
const week = (tmin, tmax, from = 5) => Array.from({length: 7}, (_, i) => ({date: `2026-05-${String(from + i).padStart(2, '0')}`, tmin, tmax}));
const memory = values => ({getItem: key => values[key] ?? null});

test('effet de la température', () => {
  assert.equal(temperatureFactor(null), null);
  assert.equal(temperatureFactor(2), 0);
  assert.equal(temperatureFactor(7), 0.5);
  assert.equal(temperatureFactor(15), 1);
  assert.equal(temperatureFactor(30), 0.3);
  assert.equal(temperatureFactor(40), 0.3);
});

test('effet de la réserve en eau', () => {
  assert.equal(waterFactor(null), null);
  assert.equal(waterFactor(0.05), 0);
  assert.equal(waterFactor(0.3), 0.5);
  assert.equal(waterFactor(0.9), 1);
});

test('température moyenne : 7 jours passés, aujourd’hui et prévisions exclus, 4 jours au moins', () => {
  const days = [...week(8, 18), {date: TODAY, tmin: 30, tmax: 40}, {date: '2026-05-13', tmin: 30, tmax: 40}];
  assert.equal(recentMeanTemperature(days, TODAY), 13);
  assert.equal(recentMeanTemperature(week(8, 18).slice(0, 3), TODAY), null);
  assert.equal(recentMeanTemperature(week(8, 18), 'pas une date'), null);
});

test('mai doux et sol bien pourvu : pousse de printemps pleine', () => {
  const g = estimateGrassGrowth({today: TODAY, days: week(8, 18), waterFraction: 0.8});
  assert.equal(g.reference, GRASS_REFERENCE[4]);
  assert.equal(g.kgMsHaDay, 70);
  assert.match(g.note, /70 kg MS\/ha\/j .*13 °C.*réserve en eau des prairies 80 %.*indicative/);
});

test('sécheresse et froid freinent la pousse ; sans température, pas d’estimation', () => {
  assert.equal(estimateGrassGrowth({today: TODAY, days: week(8, 18), waterFraction: 0.3}).kgMsHaDay, 35);
  assert.equal(estimateGrassGrowth({today: TODAY, days: week(0, 8)}).kgMsHaDay, 0);
  assert.match(estimateGrassGrowth({today: TODAY, days: week(8, 18)}).note, /réserve en eau du sol inconnue/);
  assert.equal(estimateGrassGrowth({today: TODAY, days: []}), null);
});

test('réserve en eau : moyenne des prairies, sinon point de référence ; sans cache, inconnue', () => {
  const soil = {days: Array.from({length: 14}, (_, i) => ({date: `2026-05-${String(1 + i).padStart(2, '0')}`, rain: 0, et0: 0}))};
  const state = {...emptyState(), parcelles: [{id: 'p1', culture: 'Prairie permanente', soilTexture: 'sableux'}, {id: 'p2', culture: 'Blé tendre'}]};
  assert.equal(Math.round(grasslandWaterFraction(state, soil) * 100), 50, 'réserve supposée à moitié pleine, sans pluie ni ETP');
  assert.equal(Math.round(grasslandWaterFraction(emptyState(), soil) * 100), 50);
  assert.equal(grasslandWaterFraction(state, null), null);
});

test('farmGrassGrowth lit les caches de l’appareil et ne lève jamais', () => {
  const storage = memory({[AGRO_WEATHER_KEY]: JSON.stringify({days: week(8, 18)}), [SOIL_WATER_CACHE_KEY]: 'corrompu'});
  assert.equal(farmGrassGrowth(emptyState(), {today: TODAY, storage}).kgMsHaDay, 70);
  assert.equal(farmGrassGrowth(emptyState(), {today: TODAY, storage: memory({})}), null);
  assert.equal(farmGrassGrowth(emptyState(), {today: TODAY, agro: {days: week(0, 8)}, storage: memory({})}).kgMsHaDay, 0);
  assert.equal(farmGrassGrowth(null, {today: TODAY, storage: {getItem() {throw new Error('bloqué');}}}), null);
  assert.deepEqual(growthOptions(null), {});
});

test('la pousse estimée allonge les jours d’herbe, s’explique et garde une confiance moyenne', () => {
  const state = {...emptyState(),
    parcelles: [{id: 'p1', nom: 'Le Pré Bas', surfaceHa: 4, culture: 'Prairie'}, {id: 'p2', nom: 'La Noue', surfaceHa: 5, culture: 'Prairie'}],
    grazingSessions: [{id: 'g1', parcelId: 'p1', startDate: '2026-05-02', count: 20, animalType: 'Vaches allaitantes'}]};
  const without = grazingRotationAdvice(state, {today: TODAY})[0];
  const growth = estimateGrassGrowth({today: TODAY, days: week(8, 18), waterFraction: 0.3});
  const withGrowth = grazingRotationAdvice(state, {today: TODAY, ...growthOptions(growth)})[0];
  assert.ok(without.daysLeft !== null, 'jours restants calculés sans pousse');
  assert.ok(withGrowth.daysLeft === null || withGrowth.daysLeft > without.daysLeft, 'la repousse allonge le séjour');
  assert.ok(withGrowth.why.some(w => /Pousse de l’herbe estimée à 35 kg/.test(w)));
  assert.notEqual(withGrowth.confidence, 'haute');
  assert.ok(!without.why.some(w => /Pousse de l’herbe/.test(w)));
});

test('relecture : seuil déjà dépassé, la repousse ne masque pas la sortie', () => {
  const state = {...emptyState(), parcelles: [{id: 'p1', nom: 'P', surfaceHa: 2, culture: 'Prairie'}, {id: 'p2', nom: 'Q', surfaceHa: 5, culture: 'Prairie'}],
    grazingSessions: [{id: 'g1', parcelId: 'p1', startDate: '2026-04-01', count: 5, animalType: 'Vaches allaitantes'}]};
  const growth = estimateGrassGrowth({today: '2026-05-15', days: week(8, 18, 8), waterFraction: 0.8});
  const [a] = grazingRotationAdvice(state, {today: '2026-05-15', ...growthOptions(growth)});
  assert.ok(a.pressure >= a.pressureMax, `pression ${a.pressure}`);
  assert.equal(a.daysLeft, 0);
  assert.match(a.why[0], /Sortie conseillée dès aujourd’hui/);
});

test('relecture : bilan hydrique trop ancien ignoré', () => {
  const now = Date.UTC(2026, 4, 12, 10);
  const soil = {loadedAt: now - 30 * 86400000, days: Array.from({length: 14}, (_, i) => ({date: `2026-04-${String(10 + i).padStart(2, '0')}`, rain: 0, et0: 9}))};
  const g = farmGrassGrowth(emptyState(), {today: TODAY, agro: {days: week(8, 18)}, soil, storage: memory({}), now});
  assert.equal(g.waterFraction, null);
  assert.equal(g.kgMsHaDay, 70);
});
