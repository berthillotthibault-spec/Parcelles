import test from 'node:test';
import assert from 'node:assert/strict';
import {thi, longestWetSpell, evaluateAgroRisks, riskThresholds, partOfDay, RISK_SOURCES} from './agro-risk.js';
import {automationMatches, automationTemplates, newAutomationFromTemplate} from './automations.js';

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Météo sur 11 jours autour de « now » ; f(date, heure) → {t, rh, rain}.
function weather(now, f = () => ({}), daily = () => ({})) {
  const days = [], hourly = {time: [], temperature_2m: [], relative_humidity_2m: [], precipitation: []};
  for (let i = -6; i <= 4; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i); const date = iso(d);
    days.push({date, tmax: 20, tmin: 10, rain: 0, forecast: i > 0, ...daily(date, i)});
    for (let h = 0; h < 24; h++) {const v = {t: 18, rh: 60, rain: 0, ...f(date, h, i)}; hourly.time.push(`${date}T${pad(h)}:00`); hourly.temperature_2m.push(v.t); hourly.relative_humidity_2m.push(v.rh); hourly.precipitation.push(v.rain);}
  }
  return {days, hourly};
}
const farm = extra => ({preferences: {}, parcelles: [
  {id: 'b', nom: 'Les Noues', culture: 'Blé tendre'}, {id: 'm', nom: 'Grand Champ', culture: 'Maïs grain'},
  {id: 'c', nom: 'La Côte', culture: 'Colza'}, {id: 'pr', nom: 'Le Pré Bas', culture: 'Prairie permanente'}], grazingSessions: [], ...extra});

test('THI et période de la journée', () => {
  assert.equal(thi(30, 50), 78.3);
  assert.equal(thi(20, 60), 65.8);
  assert.equal(thi(null, 50), null);
  assert.equal(partOfDay('2026-06-16T15:00', '2026-06-15'), 'demain après-midi');
  assert.equal(partOfDay('2026-06-15T09:00', '2026-06-15'), 'ce matin');
});

test('humectation : plus longue suite d’heures humides dans la plage de température', () => {
  const hours = [{t: 'a', temp: 18, rh: 95}, {t: 'b', temp: 18, rh: 92}, {t: 'c', temp: 30, rh: 95}, {t: 'd', temp: 20, rh: 50, rain: 0.2}];
  assert.deepEqual(longestWetSpell(hours, {rhMin: 90, tMin: 15, tMax: 27}), {hours: 2, start: 'a'});
});

test('septoriose : 1 pluie de 10 mm = surveiller, 2 = risque, hors saison rien', () => {
  const now = new Date(2026, 4, 15, 10).getTime();
  const one = evaluateAgroRisks(farm(), weather(now, () => ({}), (d, i) => (i === -2 ? {rain: 12} : {})), {now});
  const s = one.find(a => a.kind === 'septoria');
  assert.equal(s.level, 'surveiller');
  assert.equal(s.parcelId, 'b');
  assert.match(s.data, /12 mm/);
  assert.match(s.rule, /≥ 10 mm/);
  assert.equal(s.source, RISK_SOURCES.septoria);
  const two = evaluateAgroRisks(farm(), weather(now, () => ({}), (d, i) => (i === -2 || i === 2 ? {rain: 15} : {})), {now});
  assert.equal(two.find(a => a.kind === 'septoria').level, 'risque');
  assert.match(two.find(a => a.kind === 'septoria').data, /\(prévue\)/);
  const winter = new Date(2026, 0, 15, 10).getTime();
  assert.equal(evaluateAgroRisks(farm(), weather(winter, () => ({}), (d, i) => (i === -2 ? {rain: 20} : {})), {now: winter}).length, 0);
  // Seuil réglable.
  const tuned = riskThresholds({agroRiskThresholds: {septoria: {rainMm: 15}}});
  assert.equal(evaluateAgroRisks(farm(), weather(now, () => ({}), (d, i) => (i === -2 ? {rain: 12} : {})), {now, thresholds: tuned}).length, 0);
});

test('maïs : humectation de 10 h entre 15 et 27 °C = risque', () => {
  const now = new Date(2026, 6, 15, 10).getTime();
  const r = evaluateAgroRisks(farm(), weather(now, (d, h, i) => (i === 1 && h >= 2 && h < 13 ? {rh: 95, t: 19} : {})), {now});
  const a = r.find(x => x.kind === 'maizeLeaf');
  assert.equal(a.level, 'risque');
  assert.match(a.data, /11 h/);
  const w = evaluateAgroRisks(farm(), weather(now, (d, h, i) => (i === 1 && h >= 2 && h < 9 ? {rh: 95, t: 19} : {})), {now});
  assert.equal(w.find(x => x.kind === 'maizeLeaf').level, 'surveiller');
});

test('colza : 3 jours humides et doux en floraison = risque', () => {
  const now = new Date(2026, 3, 15, 10).getTime();
  const r = evaluateAgroRisks(farm(), weather(now, (d, h, i) => (i >= -1 && i <= 1 ? {rh: 88} : {})), {now});
  assert.equal(r.find(x => x.kind === 'sclerotinia').level, 'risque');
});

test('bovins au pré : THI croisé avec les lots', () => {
  const now = new Date(2026, 6, 15, 10).getTime();
  const lots = [{id: 'g1', parcelId: 'pr', animalType: 'Vaches', animalsCount: 24, startDate: '2026-07-01'}, {id: 'g2', parcelId: 'pr', animalType: 'Brebis', animalsCount: 40, startDate: '2026-07-01'}];
  const r = evaluateAgroRisks(farm({grazingSessions: lots}), weather(now, (d, h, i) => (i === 1 && h === 15 ? {t: 29, rh: 50} : {})), {now});
  const a = r.filter(x => x.kind === 'thi');
  assert.equal(a.length, 1, 'seulement le lot de bovins');
  assert.equal(a[0].level, 'risque');
  assert.match(a[0].message, /^24 vaches sur Le Pré Bas, THI 77 demain après-midi : vérifier l’eau et l’ombre\.$/);
  assert.equal(evaluateAgroRisks(farm({grazingSessions: lots}), weather(now), {now}).filter(x => x.kind === 'thi').length, 0);
});

test('automatisation « alertes sanitaires » : notifie les risques', () => {
  const now = new Date(2026, 4, 15, 10).getTime();
  const tpl = automationTemplates().find(t => t.kind === 'agro_risk');
  assert.ok(tpl);
  const rule = {...newAutomationFromTemplate(tpl), id: 'r', enabled: true};
  const agro = weather(now, () => ({}), (d, i) => (i === -2 || i === -1 ? {rain: 15} : {}));
  const m = automationMatches(rule, farm(), now, {agroWeather: agro});
  assert.equal(m.length, 1);
  assert.match(m[0].message, /septoriose/);
  assert.equal(automationMatches(rule, farm(), now, {agroWeather: null}).length, 0);
});
