import test from 'node:test';
import assert from 'node:assert/strict';
import {deltaT, humidityFromDewPoint, weatherWindows} from './weather-decision.js';
import {favorableToday, slotSpan, workWeatherSlot} from './work-weather.js';
import {automationMatches, automationTemplates, newAutomationFromTemplate} from './automations.js';

const at = (h, day = 8) => new Date(2026, 9, day, h, 0).getTime();
// Prévision horaire sur 3 jours à partir du 8 octobre 0 h ; overrides(heureDepuisDébut) → valeurs.
function forecast(now, overrides = () => ({}), {loadedAt = now - 3600000} = {}) {
  const h = {time: [], temperature_2m: [], relative_humidity_2m: [], precipitation: [], precipitation_probability: [], wind_speed_10m: [], wind_gusts_10m: []};
  for (let i = 0; i < 96; i++) {
    const d = new Date(2026, 9, 8, i), v = {t: 14, rh: 70, rain: 0, p: 0, wind: 8, gust: 15, ...overrides(i, d.getHours())};
    h.time.push(d.toISOString()); h.temperature_2m.push(v.t); h.relative_humidity_2m.push(v.rh); h.precipitation.push(v.rain);
    h.precipitation_probability.push(v.p); h.wind_speed_10m.push(v.wind); h.wind_gusts_10m.push(v.gust);
  }
  return {loadedAt, hourly: h};
}
const pending = type => ({id: 'w-' + type, type, status: 'À faire', parcelId: 'p1'});

test('delta T approché (Stull) et humidité depuis le point de rosée', () => {
  assert.ok(Math.abs(deltaT(20, 50) - 6.3) < 0.3);
  assert.ok(deltaT(25, 30) > 8);
  assert.ok(deltaT(10, 95) < 1);
  assert.equal(deltaT(null, 50), null);
  assert.equal(humidityFromDewPoint(20, 20), 100);
  assert.ok(Math.abs(humidityFromDewPoint(20, 10) - 53) <= 1);
});

test('pulvérisation : delta T hors de 2 à 8 °C et rafales sortent du créneau favorable', () => {
  const now = at(20);
  const humid = weatherWindows(forecast(now, () => ({t: 6, rh: 90})), 'Pulvérisation', {now});
  assert.ok(humid.windows.every(w => w.level === 'watch'), 'delta T ≈ 1 °C : à surveiller');
  assert.ok(humid.windows[0].hours[0].why.includes('Delta T 1 °C (2–8)'));
  const fine = weatherWindows(forecast(now, () => ({t: 18, rh: 60})), 'Pulvérisation', {now});
  assert.ok(fine.windows.every(w => w.level === 'favorable'));
  const gusty = weatherWindows(forecast(now, () => ({gust: 40})), 'Pulvérisation', {now});
  assert.ok(gusty.windows.every(w => w.level === 'unfavorable'));
  assert.ok(gusty.windows[0].hours[0].why.some(x => x.startsWith('Rafales 40')));
});

test('pulvérisation : pluie dans les 6 h qui suivent → défavorable', () => {
  const now = at(20);
  const w = weatherWindows(forecast(now, i => ({rain: i === 24 + 12 ? 3 : 0})), 'Pulvérisation', {now});
  const hourAt = ms => w.windows.flatMap(x => x.hours).find(h => h.start === ms);
  assert.equal(hourAt(at(8, 9)).level, 'unfavorable');
  assert.ok(hourAt(at(8, 9)).why.some(x => x.includes('Pluie dans les 6 h suivantes : 3 mm')));
  assert.equal(hourAt(at(3, 9)).level, 'favorable');
});

test('épandage : repos de 48 h après une pluie notable', () => {
  const now = at(1);
  const w = weatherWindows(forecast(now, i => ({rain: i >= 2 && i < 6 ? 4 : 0})), 'Épandage', {now});
  const level = ms => w.windows.flatMap(x => x.hours).find(h => h.start === ms)?.level;
  assert.equal(level(at(12)), 'unfavorable');
  assert.equal(level(at(12, 9)), 'unfavorable');
  assert.equal(level(at(8, 10)), 'favorable');
});

test('pastille de travail : créneau, à surveiller, aucun, données anciennes', () => {
  const now = at(20), calmMorning = (i, hr) => ({wind: hr >= 6 && hr < 11 ? 8 : 22});
  assert.equal(workWeatherSlot(pending('Désherbage'), forecast(now, calmMorning), {now}).text, 'Créneau : demain 6 h–11 h');
  assert.equal(workWeatherSlot(pending('Désherbage'), forecast(now, calmMorning), {now}).tone, 'good');
  const watch = workWeatherSlot(pending('Fauche'), forecast(now, () => ({wind: 26})), {now});
  assert.equal(watch.tone, 'watch');
  assert.match(watch.text, /^Créneau à surveiller : /);
  assert.equal(workWeatherSlot(pending('Fauche'), forecast(now, () => ({rain: 5})), {now}).text, 'Pas de créneau sur 3 jours');
  const stale = workWeatherSlot(pending('Désherbage'), forecast(now, calmMorning, {loadedAt: now - 10 * 3600000}), {now});
  assert.equal(stale.tone, 'none');
  assert.equal(stale.text, 'Créneau : demain 6 h–11 h · données anciennes');
  assert.equal(workWeatherSlot(pending('Désherbage'), forecast(now, calmMorning, {loadedAt: now - 60 * 3600000}), {now}).text, 'Créneau : données anciennes');
  assert.match(workWeatherSlot(pending('Désherbage'), forecast(now, calmMorning), {now}).title, /pas une autorisation/);
});

test('pastille absente : travail terminé, type inconnu ou aucune météo', () => {
  const now = at(20), w = forecast(now);
  assert.equal(workWeatherSlot({...pending('Fauche'), status: 'Terminé'}, w, {now}), null);
  assert.equal(workWeatherSlot(pending('Clôture'), w, {now}), null);
  assert.equal(workWeatherSlot(pending('Fauche'), null, {now}), null);
});

test('libellés de créneau', () => {
  const now = at(9);
  assert.equal(slotSpan(at(14), at(17), now), 'aujourd’hui 14 h–17 h');
  assert.equal(slotSpan(at(8), at(12), now), 'maintenant jusqu’à 12 h');
  assert.equal(slotSpan(at(22), at(4, 9), now), 'aujourd’hui dès 22 h');
  assert.equal(slotSpan(at(6, 10), at(9, 10), now), 'samedi 6 h–9 h');
});

test('automatisation quotidienne « Créneaux météo du jour »', () => {
  const now = at(5), weather = forecast(now);
  const template = automationTemplates().find(t => t.kind === 'weather_window');
  assert.equal(template.trigger, 'daily');
  const rule = newAutomationFromTemplate(template), state = {interventions: [pending('Fauche'), pending('Semis'), {...pending('Récolte'), status: 'Terminé'}]};
  assert.equal(favorableToday(state.interventions, weather, {now}).length, 2);
  const [match] = automationMatches(rule, state, now, {weather});
  assert.equal(match.title, 'Créneau favorable pour 2 travaux');
  assert.match(match.message, /pas une autorisation/);
  assert.deepEqual(automationMatches(rule, state, now, {}), [], 'sans météo, pas de notification');
  assert.deepEqual(automationMatches(rule, state, now, {weather: {...weather, loadedAt: now - 8 * 3600000}}), [], 'prévisions anciennes : silence');
});
