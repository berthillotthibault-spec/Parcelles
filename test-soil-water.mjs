// n° 57 — Portance des sols et bilan hydrique (modèle indicatif).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  soilProfile, buildSoilWaterUrl, parseSoilWaterResponse, stationRainByDay, mergeRain, waterBalance,
  trafficability, assessParcel, farmSummary, isGrassland, cacheAgeLabel, isStale, addGaugeReading,
  SOIL_TEXTURES, ASSUMED_START_FRACTION, SOIL_WATER_MAX_AGE_MS
} from './soil-water.js';

const NOW = new Date('2026-10-07T10:30:00').getTime();
const dates = n => Array.from({length: n}, (_, i) => {const d = new Date('2026-09-23T12:00:00'); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10);});
function response({rain = [], et0 = [], moisture = 0.2} = {}) {
  const time = dates(17); // 14 jours passés + aujourd’hui + 2 jours à venir
  const hours = time.flatMap(d => Array.from({length: 24}, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
  return {latitude: 46.33, longitude: 5.14, daily: {time, precipitation_sum: time.map((_, i) => rain[i] ?? 0), et0_fao_evapotranspiration: time.map((_, i) => et0[i] ?? 2)}, hourly: {time: hours, soil_moisture_0_to_7cm: hours.map(() => moisture)}};
}

test('soilProfile : classe par défaut supposée, drainage corrigé', () => {
  const none = soilProfile({});
  assert.equal(none.texture, 'limoneux');
  assert.equal(none.assumed, true);
  assert.equal(none.ru, SOIL_TEXTURES.limoneux.ru);
  const clay = soilProfile({soilTexture: 'argileux', soilDrainage: 'hydromorphe'});
  assert.equal(clay.assumed, false);
  assert.equal(clay.drainageFactor, 0.6);
  assert.equal(soilProfile({soilTexture: 'tourbe', soilDrainage: 'x'}).drainage, 'normal');
});

test('buildSoilWaterUrl : une requête avec past_days, ETP et humidité du sol', () => {
  const url = buildSoilWaterUrl({latitude: 46.331, longitude: 5.1432});
  assert.match(url, /past_days=14/);
  assert.match(url, /et0_fao_evapotranspiration/);
  assert.match(url, /precipitation_sum/);
  assert.match(url, /soil_moisture_0_to_7cm/);
  assert.match(url, /latitude=46\.3310&longitude=5\.1432/);
  assert.throws(() => buildSoilWaterUrl({}), /Position/);
  assert.throws(() => buildSoilWaterUrl({latitude: 120, longitude: 0}), /Position/);
});

test('parseSoilWaterResponse : sépare passé et prévision, humidité courante et de départ', () => {
  const r = parseSoilWaterResponse(response({moisture: 0.25}), {now: NOW, place: 'Montrevel'});
  assert.equal(r.days.length, 15);
  assert.equal(r.days.at(-1).date, '2026-10-07');
  assert.equal(r.forecast.length, 2);
  assert.equal(r.soilMoisture, 0.25);
  assert.equal(r.soilMoistureAt, '2026-10-07T10:00');
  assert.equal(r.soilMoistureStart, 0.25);
  assert.equal(r.place, 'Montrevel');
  assert.equal(parseSoilWaterResponse({}, {now: NOW}), null);
  assert.equal(parseSoilWaterResponse(null), null);
  const partial = response(); partial.hourly = undefined;
  assert.equal(parseSoilWaterResponse(partial, {now: NOW}).soilMoisture, null, 'humidité absente tolérée');
});

test('stationRainByDay : somme par jour, pluviomètre manuel prioritaire, corbeille ignorée', () => {
  const map = stationRainByDay([
    {name: 'Station', updatedAt: 9, readings: [{time: '2026-10-06T01:00', rainMm: 2}, {time: '2026-10-06T05:00', rainMm: 3.25}, {time: '2026-10-05T05:00', rainMm: 1}, {time: 'nope', rainMm: 4}, {time: '2026-10-04T00:00', rainMm: -1}]},
    {name: 'Pluviomètre manuel', source: 'manual-gauge', updatedAt: 1, readings: [{time: '2026-10-05T08:00', rainMm: 7}]},
    {name: 'Ancienne', deletedAt: 3, readings: [{time: '2026-10-03T08:00', rainMm: 50}]}
  ]);
  assert.deepEqual(map.get('2026-10-06'), {mm: 5.3, station: 'Station'});
  assert.equal(map.get('2026-10-05').mm, 7);
  assert.equal(map.has('2026-10-03'), false);
  assert.equal(map.has('2026-10-04'), false);
  const merged = mergeRain([{date: '2026-10-05', rain: 0, et0: 1}, {date: '2026-10-07', rain: 2, et0: 1}], map);
  assert.equal(merged[0].rain, 7);
  assert.equal(merged[0].source, 'station');
  assert.equal(merged[1].source, 'model');
});

test('waterBalance : réservoir borné, ETR réduite au sec, départ supposé sans mesure', () => {
  const profile = soilProfile({soilTexture: 'sableux'});
  const wet = waterBalance({days: dates(14).map(date => ({date, rain: 30, et0: 1})), profile});
  assert.equal(wet.reservoirMm, profile.ru, 'jamais au-dessus de la réserve utile');
  assert.equal(wet.percent, 100);
  assert.equal(wet.initSource, 'assumed');
  const dry = waterBalance({days: dates(14).map(date => ({date, rain: 0, et0: 6})), profile, soilMoistureStart: profile.fc});
  assert.ok(dry.reservoirMm >= 0 && dry.percent < 40, `réserve vidée (${dry.percent} %)`);
  assert.equal(dry.initSource, 'model');
  const empty = waterBalance({days: [], profile});
  assert.equal(empty.percent, Math.round(ASSUMED_START_FRACTION * 100));
  const sums = waterBalance({days: dates(10).map((date, i) => ({date, rain: i, et0: 1})), profile});
  assert.equal(sums.rain7, 3 + 4 + 5 + 6 + 7 + 8 + 9);
  assert.equal(sums.rain3, 7 + 8 + 9);
  assert.equal(sums.rain1, 9);
  assert.equal(sums.et07, 7);
});

test('trafficability : seuils par sol et par drainage, humidité de surface', () => {
  const balance = rain3 => ({rain3, rain1: 0, fraction: 0.5});
  const loam = soilProfile({soilTexture: 'limoneux'});
  assert.equal(trafficability({balance: balance(2), profile: loam}).level, 'good');
  assert.equal(trafficability({balance: balance(10), profile: loam}).level, 'limit');
  assert.equal(trafficability({balance: balance(20), profile: loam}).level, 'avoid');
  assert.equal(trafficability({balance: balance(20), profile: soilProfile({soilTexture: 'sableux'})}).level, 'limit', 'le sable supporte plus de pluie');
  assert.equal(trafficability({balance: balance(12), profile: soilProfile({soilTexture: 'limoneux', soilDrainage: 'hydromorphe'})}).level, 'avoid', 'sol hydromorphe pénalisé');
  assert.equal(trafficability({balance: balance(10), profile: soilProfile({soilTexture: 'limoneux', soilDrainage: 'drainee'})}).level, 'good', 'sol drainé favorisé');
  const surface = trafficability({balance: balance(0), profile: loam, soilMoisture: 0.36});
  assert.equal(surface.level, 'limit');
  assert.ok(surface.reasons.includes('surface gorgée d’eau'));
  assert.equal(trafficability({balance: {rain3: 3, rain1: 3, fraction: 1}, profile: loam}).level, 'limit', 'réserve pleine et pluie du jour');
  assert.equal(trafficability({}), null);
});

test('assessParcel et farmSummary : prairie en déficit, pire parcelle en tête, aucune donnée inventée', () => {
  const cache = parseSoilWaterResponse(response({rain: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 6], et0: Array(15).fill(4), moisture: 0.1}), {now: NOW});
  const parcels = [
    {id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', soilTexture: 'sableux'},
    {id: 'p2', nom: 'Le Pré Bas', culture: 'Prairie permanente', soilTexture: 'argileux', soilDrainage: 'hydromorphe'},
    {id: 'p3', nom: 'Ancienne', deletedAt: 4}
  ];
  const a = assessParcel(parcels[1], cache, []);
  assert.equal(a.portance.level, 'avoid');
  assert.equal(a.grassDeficit, a.balance.fraction < 0.4);
  assert.equal(a.nextRain, 0);
  assert.equal(assessParcel(parcels[0], null), null);
  const s = farmSummary(parcels, cache, []);
  assert.equal(s.total, 2);
  assert.equal(s.worst[0].parcel.id, 'p2');
  assert.equal(s.level, 'avoid');
  assert.equal(s.counts.avoid + s.counts.limit + s.counts.good, 2);
  assert.equal(farmSummary([], cache), null);
  assert.ok(isGrassland({culture: 'Prairie temporaire'}) && isGrassland({culture: 'Luzerne'}) && !isGrassland({culture: 'Maïs'}));
});

test('cacheAgeLabel et isStale', () => {
  assert.equal(cacheAgeLabel(NOW - 30000, NOW), 'à l’instant');
  assert.equal(cacheAgeLabel(NOW - 25 * 60000, NOW), 'il y a 25 min');
  assert.equal(cacheAgeLabel(NOW - 3 * 3600000, NOW), 'il y a 3 h');
  assert.equal(cacheAgeLabel(NOW - 26 * 3600000, NOW), 'il y a 1 jour');
  assert.equal(cacheAgeLabel(NOW - 50 * 3600000, NOW), 'il y a 2 jours');
  assert.equal(cacheAgeLabel(null, NOW), 'date inconnue');
  assert.equal(isStale(null, NOW), true);
  assert.equal(isStale({loadedAt: NOW - 1000}, NOW), false);
  assert.equal(isStale({loadedAt: NOW - SOIL_WATER_MAX_AGE_MS - 1}, NOW), true);
});

test('addGaugeReading : crée la station manuelle, remplace le relevé du même jour, contrôle la saisie', () => {
  const first = addGaugeReading(null, {date: '2026-10-06', rainMm: '12,5'});
  assert.equal(first.source, 'manual-gauge');
  assert.equal(first.name, 'Pluviomètre manuel');
  assert.deepEqual(first.readings, [{time: '2026-10-06T08:00', temperature: null, rainMm: 12.5, windKmh: null, humidity: null}]);
  const second = addGaugeReading({...first, id: 'st1'}, {date: '2026-10-06', rainMm: 4});
  assert.equal(second.id, 'st1');
  assert.equal(second.readings.length, 1);
  assert.equal(second.readings[0].rainMm, 4);
  const third = addGaugeReading(second, {date: '2026-10-01', rainMm: 0});
  assert.deepEqual(third.readings.map(r => r.time), ['2026-10-01T08:00', '2026-10-06T08:00']);
  assert.throws(() => addGaugeReading(null, {date: '', rainMm: 3}), /Champ obligatoire : date/);
  assert.throws(() => addGaugeReading(null, {date: '2026-10-06', rainMm: ''}), /Champ obligatoire : pluie/);
  assert.throws(() => addGaugeReading(null, {date: '2026-10-06', rainMm: 900}), /entre 0 et 500/);
});
