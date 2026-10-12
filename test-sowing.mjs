import test from 'node:test';
import assert from 'node:assert/strict';
import {sowingKey, sowingThreshold, soilDays, previousSowings, sowingAdvice, weekdayLabel} from './sowing.js';
import {automationMatches, automationTemplates, newAutomationFromTemplate} from './automations.js';

const pad = n => String(n).padStart(2, '0');
// 5 jours à partir du 2026-04-13 (lundi) ; soil(jourIndex) → température du sol.
function agro(soil, moisture = () => 0.3) {
  const hourly = {time: [], soil_temperature_6cm: [], soil_moisture_3_to_9cm: []};
  for (let i = 0; i < 5; i++) for (let h = 0; h < 24; h++) {hourly.time.push(`2026-04-${pad(13 + i)}T${pad(h)}:00`); hourly.soil_temperature_6cm.push(soil(i)); hourly.soil_moisture_3_to_9cm.push(moisture(i));}
  return {hourly, days: []};
}
const state = extra => ({preferences: {}, parcelles: [{id: 'p', nom: 'Grand Champ', culture: 'Maïs grain'}],
  interventions: [
    {id: 'a', parcelId: 'p', type: 'Semis', date: '2025-04-18', status: 'Terminé'},
    {id: 'b', parcelId: 'p', type: 'Semis maïs', date: '2024-04-22', status: 'Terminé'},
    {id: 'w', parcelId: 'p', type: 'Semis', date: '2026-04-20', status: 'À faire'}], ...extra});

test('culture, seuils réglables et jours', () => {
  assert.equal(sowingKey('Maïs grain'), 'mais');
  assert.equal(sowingKey('Prairie'), null);
  assert.equal(sowingThreshold('mais').soilMin, 10);
  assert.equal(sowingThreshold('mais', {sowingSoilThresholds: {mais: 12}}).soilMin, 12);
  assert.equal(weekdayLabel('2026-04-16', '2026-04-13'), 'jeudi');
  assert.equal(weekdayLabel('2026-04-14', '2026-04-13'), 'demain');
  assert.deepEqual(soilDays(agro(i => 8 + i).hourly).map(d => d.soilTemp), [8, 9, 10, 11, 12]);
});

test('semis précédents de la même culture', () => {
  assert.deepEqual(previousSowings(state(), 'mais', {today: '2026-04-13'}), ['2025-04-18', '2024-04-22']);
});

test('sol à 8 °C, seuil atteint jeudi : message et pas encore réuni', () => {
  const s = state();
  const a = sowingAdvice(s, s.interventions[2], agro(i => [8, 8, 9, 10, 11][i]), {today: '2026-04-13'});
  assert.equal(a.ready, false);
  assert.equal(a.message, 'Sol à 8 °C, 10 °C prévu à partir de jeudi (seuil maïs 10 °C). Vos semis précédents : 18/04/2025, 22/04/2024.');
});

test('conditions réunies sur 3 jours, sauf sol saturé', () => {
  const s = state();
  const ok = sowingAdvice(s, s.interventions[2], agro(() => 11), {today: '2026-04-13'});
  assert.equal(ok.ready, true);
  assert.match(ok.message, /conditions de semis réunies/);
  const wet = sowingAdvice(s, s.interventions[2], agro(() => 11, () => 0.45), {today: '2026-04-13'});
  assert.equal(wet.ready, false);
  assert.match(wet.message, /très humide/);
});

test('automatisation « conditions de semis réunies »', () => {
  const tpl = automationTemplates().find(t => t.kind === 'sowing_conditions');
  const rule = {...newAutomationFromTemplate(tpl), id: 'r', enabled: true};
  const now = new Date(2026, 3, 13, 9).getTime();
  const m = automationMatches(rule, state(), now, {agroWeather: agro(() => 11)});
  assert.equal(m.length, 1);
  assert.equal(m[0].entityId, 'w');
  assert.equal(automationMatches(rule, state(), now, {agroWeather: agro(() => 7)}).length, 0);
});
