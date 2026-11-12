import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shouldRefreshWeather, parcelWeatherKey, readParcelWeather, writeParcelWeather, formatWeatherAge, PARCEL_WEATHER_KEY, PARCEL_WEATHER_MAX} from './weather-freshness.js';

const NOW = Date.UTC(2026, 10, 12, 9, 0), MIN = 60 * 1000;
const base = {cache: {loadedAt: NOW - 90 * MIN}, now: NOW, online: true, pref: true, isDemo: false, lastAttemptAt: null, inFlight: false};
function memoryStorage() { const m = new Map(); return {map: m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)}; }

test('shouldRefreshWeather : toutes les branches', () => {
  assert.equal(shouldRefreshWeather(base), true, 'cache de 90 min');
  assert.equal(shouldRefreshWeather({...base, cache: null}), true, 'pas de cache');
  assert.equal(shouldRefreshWeather({...base, cache: {}}), true, 'cache sans date');
  assert.equal(shouldRefreshWeather({...base, cache: {loadedAt: NOW - 30 * MIN}}), false, 'cache de 30 min');
  assert.equal(shouldRefreshWeather({...base, cache: {loadedAt: new Date(NOW - 61 * MIN).toISOString()}}), true, 'date ISO');
  assert.equal(shouldRefreshWeather({...base, online: false}), false, 'hors ligne');
  assert.equal(shouldRefreshWeather({...base, pref: false}), false, 'préférence coupée');
  assert.equal(shouldRefreshWeather({...base, pref: undefined}), true, 'préférence par défaut');
  assert.equal(shouldRefreshWeather({...base, isDemo: true}), false, 'démo');
  assert.equal(shouldRefreshWeather({...base, inFlight: true}), false, 'appel en cours');
  assert.equal(shouldRefreshWeather({...base, lastAttemptAt: NOW - 5 * MIN}), false, 'échec récent');
  assert.equal(shouldRefreshWeather({...base, lastAttemptAt: NOW - 11 * MIN}), true, 'échec ancien');
  assert.equal(shouldRefreshWeather(), true, 'appel sans argument : en ligne, sans cache');
});

test('clé de parcelle arrondie à 3 décimales', () => {
  assert.equal(parcelWeatherKey(45.12345, 4.98765), '45.123,4.988');
  assert.equal(parcelWeatherKey(45.1234, 4.9876), parcelWeatherKey(45.12341, 4.98759));
  assert.equal(parcelWeatherKey(NaN, 4), '');
  assert.equal(parcelWeatherKey(undefined, null), '');
});

test('cache de parcelle : écriture, lecture, LRU borné à 50', () => {
  const storage = memoryStorage();
  assert.equal(readParcelWeather(storage, 'absent', NOW), null);
  for (let i = 0; i < 55; i++) assert.equal(writeParcelWeather(storage, `k${i}`, {temp: i}, NOW + i), true);
  const all = JSON.parse(storage.getItem(PARCEL_WEATHER_KEY));
  assert.equal(Object.keys(all).length, PARCEL_WEATHER_MAX);
  assert.equal(all.k0, undefined); assert.ok(all.k54);
  // Une lecture garde l'entrée : k5 (la plus ancienne) survit à l'écriture suivante.
  assert.deepEqual(readParcelWeather(storage, 'k5', NOW + 100), {data: {temp: 5}, savedAt: NOW + 5});
  writeParcelWeather(storage, 'k99', {temp: 99}, NOW + 101);
  const after = JSON.parse(storage.getItem(PARCEL_WEATHER_KEY));
  assert.ok(after.k5); assert.equal(after.k6, undefined);
  assert.equal(writeParcelWeather(storage, '', {}, NOW), false);
  assert.equal(writeParcelWeather(storage, 'x', null, NOW), false);
});

test('stockage qui lève ou contenu corrompu : aucune exception', () => {
  const throwing = {getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('quota'); }};
  assert.equal(writeParcelWeather(throwing, 'k', {t: 1}, NOW), false);
  assert.equal(readParcelWeather(throwing, 'k', NOW), null);
  assert.equal(readParcelWeather(null, 'k', NOW), null);
  const corrupt = memoryStorage(); corrupt.setItem(PARCEL_WEATHER_KEY, '{pas du json');
  assert.equal(readParcelWeather(corrupt, 'k', NOW), null);
  assert.equal(writeParcelWeather(corrupt, 'k', {t: 1}, NOW), true);
  assert.deepEqual(readParcelWeather(corrupt, 'k', NOW).data, {t: 1});
});

test('formatWeatherAge : « Prévisions du JJ/MM HH:MM » en heure locale', () => {
  const at = new Date(2026, 10, 3, 8, 5).getTime();
  assert.equal(formatWeatherAge(at, at + 3600e3), 'Prévisions du 03/11 08:05');
  assert.equal(formatWeatherAge(new Date(at).toISOString()), 'Prévisions du 03/11 08:05');
  assert.equal(formatWeatherAge(null), '');
  assert.equal(formatWeatherAge('nimporte'), '');
});

test('horloge reculée : cache ou échec datés du futur ne bloquent pas le rafraîchissement', () => {
  assert.equal(shouldRefreshWeather({...base, cache: {loadedAt: NOW + 3 * 3600e3}}), true, 'cache du futur');
  assert.equal(shouldRefreshWeather({...base, cache: {loadedAt: NOW + 2 * MIN}}), false, 'petit écart toléré');
  assert.equal(shouldRefreshWeather({...base, cache: {loadedAt: NOW - 30 * MIN}, lastAttemptAt: NOW + 3 * 3600e3}), false, 'cache frais');
  assert.equal(shouldRefreshWeather({...base, lastAttemptAt: NOW + 3 * 3600e3}), true, 'échec du futur ignoré');
});

test('clé de parcelle : pas de « -0.000 »', () => {
  assert.equal(parcelWeatherKey(-0.0001, 0.0002), '0.000,0.000');
  assert.equal(parcelWeatherKey(-1.23456, 2), '-1.235,2.000');
});

test('quota dépassé : les entrées anciennes sont sacrifiées pour garder la nouvelle', () => {
  const storage = memoryStorage(), setItem = storage.setItem;
  for (let i = 0; i < 40; i++) writeParcelWeather(storage, `k${i}`, {t: i}, NOW + i);
  storage.setItem = (k, v) => { if (String(v).length > 300) throw new Error('QuotaExceededError'); setItem(k, v); };
  assert.equal(writeParcelWeather(storage, 'neuve', {t: 'n'}, NOW + 100), true);
  const all = JSON.parse(storage.map.get(PARCEL_WEATHER_KEY));
  assert.ok(all.neuve); assert.ok(Object.keys(all).length < 40);
});

test('horloge reculée : la nouvelle entrée est gardée même si les autres ont un usedAt plus récent', () => {
  const storage = memoryStorage();
  for (let i = 0; i < PARCEL_WEATHER_MAX; i++) writeParcelWeather(storage, `k${i}`, {t: i}, NOW + 60 * MIN + i);
  assert.equal(writeParcelWeather(storage, 'neuve', {t: 'n'}, NOW), true);
  const all = JSON.parse(storage.map.get(PARCEL_WEATHER_KEY));
  assert.equal(Object.keys(all).length, PARCEL_WEATHER_MAX);
  assert.ok(all.neuve, 'la nouvelle météo est enregistrée');
  assert.equal(all.k0, undefined, 'la plus ancienne des autres est retirée');
  assert.deepEqual(readParcelWeather(storage, 'neuve', NOW)?.data, {t: 'n'});
});
