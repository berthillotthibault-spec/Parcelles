import test from 'node:test';
import assert from 'node:assert/strict';
import {profileKey, cropProfile, dailyDegree, degreeDays, sowingFor, estimatePhenology} from './phenology.js';
import {parseDaily, mergeDays, buildAgroForecastUrl, buildArchiveUrl, farmPosition} from './agro-weather.js';

const series = (from, n, tmax, tmin, forecastFrom = '9999') => Array.from({length: n}, (_, i) => {
  const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
  const date = d.toISOString().slice(0, 10);
  return {date, tmax, tmin, rain: 0, forecast: date > forecastFrom};
});

test('profil par culture, base 0 pour les céréales et 6 pour le maïs', () => {
  assert.equal(profileKey('Blé tendre'), 'cereales');
  assert.equal(profileKey('Maïs grain'), 'mais');
  assert.equal(profileKey('Orge de printemps'), 'orge_printemps');
  assert.equal(profileKey('Prairie permanente'), null);
  assert.equal(cropProfile('Blé tendre').base, 0);
  assert.equal(cropProfile('Maïs ensilage').base, 6);
  const tuned = cropProfile('Maïs', {mais: {base: 8, stages: [{name: 'Levée', gdd: 70}, {name: 'Floraison', gdd: 850}]}});
  assert.equal(tuned.base, 8);
  assert.deepEqual(tuned.stages.map(s => s.gdd), [70, 850]);
  assert.equal(tuned.custom, true);
});

test('degrés-jours : moyenne simple et méthode plafonnée 6-30', () => {
  assert.equal(dailyDegree({tmax: 20, tmin: 10}, 0), 15);
  assert.equal(dailyDegree({tmax: 10, tmin: 0}, 6), 0);
  assert.equal(dailyDegree({tmax: 36, tmin: 2}, 6, 'capped'), 12); // (30 + 6) / 2 − 6
  assert.equal(dailyDegree({tmax: null, tmin: 3}, 0), null);
  const r = degreeDays(series('2026-04-12', 11, 20, 10), {from: '2026-04-12', to: '2026-04-22', base: 6});
  assert.deepEqual(r, {sum: 90, counted: 10, forecast: 0, missing: 0}); // le jour du semis ne compte pas
  const gap = degreeDays(series('2026-04-12', 3, 20, 10), {from: '2026-04-12', to: '2026-04-16', base: 0});
  assert.equal(gap.missing, 2);
});

test('semis retenu : le dernier réalisé, sans récolte ensuite', () => {
  const state = {interventions: [
    {id: 'a', parcelId: 'p', type: 'Semis maïs', date: '2026-04-12', status: 'Terminé'},
    {id: 'b', parcelId: 'p', type: 'Semis', date: '2026-05-20', status: 'À faire'},
    {id: 'c', parcelId: 'q', type: 'Semis', date: '2025-10-15', status: 'Terminé'},
    {id: 'd', parcelId: 'q', type: 'Moisson', date: '2026-07-10', status: 'Terminé'}
  ]};
  assert.equal(sowingFor(state, 'p', {today: '2026-06-01'}).date, '2026-04-12');
  assert.equal(sowingFor(state, 'q', {today: '2026-08-01'}), null);
  assert.equal(sowingFor(state, 'p', {today: '2027-04-01'}), null, 'plus de 11 mois');
});

test('stade estimé, progression, recalage par un stade observé', () => {
  const days = series('2026-04-12', 70, 26, 14, '2026-06-15'); // 14 °C·j par jour en base 6
  const e = estimatePhenology({culture: 'Maïs grain', sowingDate: '2026-04-12', days, today: '2026-06-15'});
  assert.equal(e.status, 'ok');
  assert.equal(e.sum, 64 * 14);
  assert.equal(e.stage.name, '8-10 feuilles');
  assert.equal(e.next.name, 'Floraison femelle');
  assert.equal(e.remaining, 900 - 896);
  assert.equal(e.nextDate, '2026-06-16');
  assert.ok(e.progress > 0.5 && e.progress < 0.6);
  const r = estimatePhenology({culture: 'Maïs grain', sowingDate: '2026-04-12', days, today: '2026-06-15', observation: {date: '2026-06-05', stage: 'Floraison femelle'}});
  assert.equal(r.sum, 900 + 10 * 14);
  assert.equal(r.recalibrated.stage, 'Floraison femelle');
  assert.equal(estimatePhenology({culture: 'Prairie', sowingDate: '2026-04-12', days, today: '2026-06-15'}).status, 'unsupported');
  assert.equal(estimatePhenology({culture: 'Maïs', sowingDate: null, days, today: '2026-06-15'}).status, 'no-sowing');
});

test('météo agronomique : une requête groupée, archive, fusion', () => {
  const url = buildAgroForecastUrl({latitude: 46.3412, longitude: 5.1301});
  for (const v of ['temperature_2m_max', 'soil_temperature_6cm', 'soil_moisture_3_to_9cm', 'relative_humidity_2m', 'past_days=31']) assert.ok(url.includes(v), v);
  assert.match(buildArchiveUrl({latitude: 46, longitude: 5, start: '2025-10-01', end: '2026-05-01'}), /archive-api\.open-meteo\.com.*start_date=2025-10-01&end_date=2026-05-01/);
  const days = parseDaily({daily: {time: ['2026-05-01', '2026-05-02'], temperature_2m_max: [20, 21], temperature_2m_min: [8, null], precipitation_sum: [0, 4]}}, {today: '2026-05-01'});
  assert.deepEqual(days[1], {date: '2026-05-02', tmax: 21, tmin: null, rain: 4, forecast: true});
  const merged = mergeDays([{date: '2026-05-01', tmax: 1, tmin: 1}, {date: '2026-04-30', tmax: 2, tmin: 2}], days);
  assert.deepEqual(merged.map(d => [d.date, d.tmax]), [['2026-04-30', 2], ['2026-05-01', 20], ['2026-05-02', 21]]);
  assert.deepEqual(farmPosition({}, {latitude: 46, longitude: 5}), {latitude: 46, longitude: 5});
  assert.equal(farmPosition({parcelles: []}), null);
});

test('assistant : « où en est le maïs ? » répond par parcelle, en estimé', async () => {
  const {answerLocalIntelligence} = await import('./intelligence.js');
  const state = {preferences: {}, parcelles: [{id: 'p', nom: 'Grand Champ', culture: 'Maïs grain'}, {id: 'b', nom: 'Les Noues', culture: 'Blé tendre'}],
    interventions: [{id: 's', parcelId: 'p', type: 'Semis', date: '2026-04-12', status: 'Terminé'}]};
  const days = series('2026-04-12', 70, 26, 14, '2026-06-15');
  const r = answerLocalIntelligence('Où en est le maïs ?', state, {today: '2026-06-15', agroDays: days});
  assert.equal(r.intent, 'phenology');
  assert.match(r.answer, /Grand Champ : 896 °C·j base 6 depuis le semis du 12\/04, stade estimé 8-10 feuilles/);
  assert.match(r.answer, /Estimation indicative/);
  assert.doesNotMatch(r.answer, /Les Noues/);
  assert.equal(r.actions[0].type, 'open_parcel');
  const none = answerLocalIntelligence('où en est le maïs', state, {today: '2026-06-15', agroDays: []});
  assert.match(none.answer, /températures pas encore chargées/);
});
