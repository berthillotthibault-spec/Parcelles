import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAgroRisks, riskThresholds} from './agro-risk.js';
import {parcelStage, stageWindow, fungicideCover, isFungicide, diseaseVerdict, COVER_DEFAULT_DAYS} from './disease-window.js';

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date(2026, 4, 15, 10).getTime(); // 15 mai 2026
const TODAY = iso(new Date(NOW));
const shift = n => {const d = new Date(NOW); d.setDate(d.getDate() + n); return iso(d);};
// Météo depuis le 15/10/2025 (semis) à J+4, température moyenne constante ; rain(i) en mm, i = décalage depuis aujourd'hui.
function weather(mean, rain = () => 0) {
  const days = [];
  for (let d = new Date(2025, 9, 15, 12); d.getTime() <= NOW + 4 * 864e5; d.setDate(d.getDate() + 1)) {
    const i = Math.round((d.getTime() - new Date(NOW).setHours(12)) / 864e5);
    days.push({date: iso(d), tmax: mean + 4, tmin: mean - 4, rain: rain(i), forecast: i > 0});
  }
  return {days, hourly: null};
}
const sowing = {id: 's1', parcelId: 'b', type: 'Semis', status: 'Terminé', date: '2025-10-15', culture: 'Blé tendre'};
const farm = (works = []) => ({preferences: {}, parcelles: [{id: 'b', nom: 'Les Noues', culture: 'Blé tendre'}], interventions: [sowing, ...works]});
const fungicide = (n, extra = {}) => ({id: `f${n}`, parcelId: 'b', type: 'Traitement fongicide', status: 'Terminé', date: shift(n), product: 'Produit A',
  ...extra});
const rainy = i => (i === -2 || i === 2 ? 12 : 0);

test('stade : septoriose seulement à partir de 1-2 nœuds', () => {
  // 212 jours depuis le semis : moyenne 3 °C ≈ 636 degrés-jours (tallage), 6,5 °C ≈ 1378 (1-2 nœuds).
  assert.equal(evaluateAgroRisks(farm(), weather(3, rainy), {now: NOW}).filter(a => a.kind === 'septoria').length, 0);
  const st = parcelStage(farm(), farm().parcelles[0], weather(6.5).days, {today: TODAY});
  assert.equal(st.name, '1-2 nœuds');
  assert.equal(st.source, 'estimé');
  const a = evaluateAgroRisks(farm(), weather(6.5, rainy), {now: NOW}).find(x => x.kind === 'septoria');
  assert.equal(a.level, 'risque');
  assert.match(a.message, /Stade sensible : stade estimé : 1-2 nœuds/);
  assert.match(a.why, /dernières feuilles à partir de 2 nœuds/);
});

test('stade inconnu : la règle des mois reste appliquée et le dit', () => {
  const noSowing = {...farm(), interventions: []};
  const a = evaluateAgroRisks(noSowing, weather(6.5, rainy), {now: NOW}).find(x => x.kind === 'septoria');
  assert.equal(a.level, 'risque');
  assert.match(a.why, /stade inconnu/);
  assert.doesNotMatch(a.message, /stade inconnu/);
  assert.equal(evaluateAgroRisks(noSowing, weather(8.5, i => (i === -1 || i === 1 ? 6 : 0)), {now: NOW}).filter(x => x.kind === 'fusarium').length, 0);
});

test('rémanence : fongicide récent = couvert jusqu’au …, sans alerte', () => {
  const data = farm([fungicide(-5)]);
  assert.equal(evaluateAgroRisks(data, weather(6.5, rainy), {now: NOW}).filter(a => a.kind === 'septoria').length, 0);
  const c = evaluateAgroRisks(data, weather(6.5, rainy), {now: NOW, withCovered: true}).find(a => a.kind === 'septoria');
  assert.equal(c.level, 'couvert');
  assert.equal(c.until, shift(9));
  assert.match(c.title, /couvert jusqu’au 24\/05/);
  assert.match(c.why, /protection indicative de 14 jours/);
});

test('rémanence : alerte quand la protection se termine pendant la période à risque', () => {
  // Fongicide à J-20 : protection jusqu'à J-6 ; la pluie de J-8 est couverte, celles de J-2 et J+2 non.
  const r = i => (i === -8 || i === -2 || i === 2 ? 12 : 0);
  const a = evaluateAgroRisks(farm([fungicide(-20)]), weather(6.5, r), {now: NOW}).find(x => x.kind === 'septoria');
  assert.equal(a.level, 'risque');
  assert.match(a.message, /^2 pluies/);
  assert.match(a.message, /terminée le 09\/05/);
  assert.doesNotMatch(a.data, /07\/05/);
  // Protection prolongée par le réglage : couvert.
  const long = riskThresholds({agroRiskThresholds: {cover: {days: 30}}});
  assert.equal(evaluateAgroRisks(farm([fungicide(-20)]), weather(6.5, r), {now: NOW, thresholds: long}).filter(x => x.kind === 'septoria').length, 0);
  // Pluie prévue après la fin de protection : alerte.
  // Pluie avant le traitement : non couverte par la rémanence (préventive).
  const before = evaluateAgroRisks(farm([fungicide(-3)]), weather(6.5, i => (i === -5 ? 12 : 0)), {now: NOW}).find(x => x.kind === 'septoria');
  assert.equal(before.level, 'surveiller');
  assert.match(before.message, /antérieur au fongicide du 12\/05/);
  const late = evaluateAgroRisks(farm([fungicide(-12)]), weather(6.5, i => (i === 3 ? 12 : 0)), {now: NOW}).find(x => x.kind === 'septoria');
  assert.equal(late.level, 'surveiller');
});

test('fusariose : seulement de l’épiaison à la fin de la floraison', () => {
  const r = i => (i === -1 || i === 1 ? 6 : 0);
  const a = evaluateAgroRisks(farm(), weather(8.5, r), {now: NOW}).find(x => x.kind === 'fusarium');
  assert.equal(a.level, 'risque');
  assert.match(a.message, /Épiaison|Floraison/);
  assert.equal(evaluateAgroRisks(farm(), weather(6.5, r), {now: NOW}).filter(x => x.kind === 'fusarium').length, 0);
});

test('fongicide : catégorie, statut et annulation', () => {
  const data = farm([fungicide(-3, {status: 'Annulé'}), fungicide(-4, {type: 'Traitement', phytoLimits: {category: 'herbicide'}})]);
  assert.equal(fungicideCover(data, 'b', {today: TODAY}), null);
  assert.equal(isFungicide({}, {type: 'Traitement', target: 'Septoriose'}), true);
  assert.equal(isFungicide({}, {type: 'Désherbage'}), false);
  const c = fungicideCover(farm([fungicide(-4), fungicide(-10)]), 'b', {today: TODAY, days: 0});
  assert.equal(c.days, COVER_DEFAULT_DAYS);
  assert.equal(c.date, shift(-4));
  assert.equal(fungicideCover(farm([fungicide(2, {status: 'Prévu'})]), 'b', {today: TODAY}), null);
});

test('verdict pur : hors stade, couvert, alerte', () => {
  assert.equal(stageWindow('thi', null).inWindow, true);
  const profile = {key: 'cereales', stages: [{name: '1-2 nœuds', gdd: 1200}, {name: 'Maturité physiologique', gdd: 2500}]};
  assert.equal(diseaseVerdict('septoria', {stage: {profile, sum: 800, name: 'Tallage', source: 'estimé'}, events: [TODAY]}).status, 'skip');
  const stage = {profile, sum: 1300, name: '1-2 nœuds', source: 'observé'};
  assert.equal(diseaseVerdict('septoria', {stage, cover: {date: shift(-3), until: shift(11), days: 14}, events: [shift(-1)]}).status, 'covered');
  const v = diseaseVerdict('septoria', {stage, cover: {date: shift(-20), until: shift(-6), days: 14}, events: [shift(-8), shift(-1)]});
  assert.equal(v.status, 'alert');
  assert.deepEqual(v.events, [shift(-1)]);
});

test('stade observé ancien sans météo depuis : stade inconnu, pas de filtrage', () => {
  // Observation « Début tallage » le 01/02, mais la météo ne couvre que les 31 derniers jours (comme agro-weather).
  const p = {id: 'b', nom: 'Les Noues', culture: 'Blé tendre', phenologyObservation: {stage: 'Début tallage', date: '2026-02-01', sowingDate: '2025-10-15'}};
  const state = {...farm(), parcelles: [p]};
  const recent = weather(10, rainy).days.filter(d => d.date >= shift(-31));
  assert.equal(parcelStage(state, p, recent, {today: TODAY}), null);
  const a = evaluateAgroRisks(state, {days: recent, hourly: null}, {now: NOW}).find(x => x.kind === 'septoria');
  assert.ok(a, 'la règle des mois doit s’appliquer au lieu de supprimer l’alerte');
});
