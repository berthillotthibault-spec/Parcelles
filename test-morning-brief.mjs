// Point du matin (morning-brief.js) : phrases classées par urgence, branchements assistant et fil « À décider ».
import test from 'node:test';
import assert from 'node:assert/strict';
import {briefing, ofParcel, sprayWindowsFor, BRIEF_LIMIT} from './morning-brief.js';
import {answerAgroQuestion} from './agro-assistant.js';
import {agroIntent} from './agro-knowledge.js';
import {decisionFeed, fromBrief} from './decision-feed.js';

const TODAY = '2026-05-12', TOMORROW = '2026-05-13';
const NOW = new Date(2026, 4, 12, 5, 0, 0).getTime(); // 5 h, heure locale
const pad = n => String(n).padStart(2, '0');

// Prévision horaire locale du jour : favorable de 6 h à 10 h, vent fort ensuite.
function weather({goodFrom = 6, goodTo = 10, allBad = false} = {}) {
  const time = [], wind = [], gust = [], temp = [], rh = [], rain = [], cloud = [];
  for (let h = 0; h < 48; h++) {
    const d = new Date(2026, 4, 12, h);
    time.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
    const good = !allBad && h >= goodFrom && h < goodTo;
    wind.push(good ? 8 : 30); gust.push(good ? 12 : 45); temp.push(14); rh.push(70); rain.push(0); cloud.push(60);
  }
  return {loadedAt: NOW, hourly: {time, wind_speed_10m: wind, wind_gusts_10m: gust, temperature_2m: temp, relative_humidity_2m: rh, precipitation: rain, cloud_cover: cloud}};
}
// Météo agronomique : sol à 12 °C, humidité réglable (m³/m³).
function agro({moisture = 0.25, rainDays = []} = {}) {
  const time = [], st = [], sm = [];
  for (let d = 0; d < 4; d++) for (let h = 0; h < 24; h += 6) {time.push(`2026-05-${pad(12 + d)}T${pad(h)}:00`); st.push(12); sm.push(moisture);}
  const days = [];
  for (let d = 2; d <= 15; d++) {const date = `2026-05-${pad(d)}`; days.push({date, rain: rainDays.includes(date) ? 15 : 0, tmin: 8, tmax: 18});}
  return {days, hourly: {time, soil_temperature_6cm: st, soil_moisture_3_to_9cm: sm}};
}
const base = () => ({
  parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 10}, {id: 'p2', nom: 'Le Grand Champ', culture: 'Maïs grain', surfaceHa: 20}, {id: 'p3', nom: 'Arnay', culture: 'Prairie permanente', surfaceHa: 5}],
  interventions: []
});
const work = (id, parcelId, type, date, extra = {}) => ({id, parcelId, type, status: 'À faire', plannedDate: date, ...extra});

test('ofParcel : articles et élision', () => {
  assert.equal(ofParcel('Les Brosses'), 'des Brosses');
  assert.equal(ofParcel('Le Grand Champ'), 'du Grand Champ');
  assert.equal(ofParcel('La Côte'), 'de la Côte');
  assert.equal(ofParcel('L’Étang'), 'de l’Étang');
  assert.equal(ofParcel('Arnay'), 'd’Arnay');
  assert.equal(ofParcel('Bel Air'), 'de Bel Air');
});

test('rien de prévu : une phrase', () => {
  const b = briefing(base(), {today: TODAY, now: NOW});
  assert.deepEqual(b.sentences, ['Rien de prévu aujourd’hui ni demain dans le planning.']);
});

test('traitement du jour : créneau favorable de 6 h à 10 h', () => {
  const s = base(); s.interventions.push(work('t1', 'p1', 'Traitement fongicide', TODAY, {isPhytosanitary: true}));
  const b = briefing(s, {today: TODAY, now: NOW, weather: weather()});
  assert.ok(b.sentences.includes('Traitement des Brosses possible de 6 h à 10 h.'), b.text);
});

test('traitement du jour sans créneau favorable : à décaler (warning)', () => {
  const s = base(); s.interventions.push(work('t1', 'p1', 'Traitement fongicide', TODAY, {isPhytosanitary: true}));
  const b = briefing(s, {today: TODAY, now: NOW, weather: weather({allBad: true})});
  const item = b.items.find(i => i.workId === 't1');
  assert.equal(item.kind, 'spray-none');
  assert.equal(item.level, 'warning');
  assert.match(item.text, /à décaler/);
});

test('traitement sans météo horaire : invite à ouvrir la météo', () => {
  const s = base(); s.interventions.push(work('t1', 'p1', 'Traitement fongicide', TODAY, {isPhytosanitary: true}));
  assert.equal(briefing(s, {today: TODAY, now: NOW}).items[0].kind, 'spray-nodata');
  assert.equal(sprayWindowsFor(null, TODAY), null);
});

test('semis du Grand Champ : sol encore humide, à repousser', () => {
  const s = base(); s.interventions.push(work('s1', 'p2', 'Semis', TODAY, {culture: 'Maïs grain'}));
  const b = briefing(s, {today: TODAY, now: NOW, agro: agro({moisture: 0.45})});
  assert.ok(b.sentences.includes('Semis du Grand Champ : sol encore humide, à repousser.'), b.text);
});

test('semis avec sol réchauffé et sec : conditions réunies', () => {
  const s = base(); s.interventions.push(work('s1', 'p2', 'Semis', TOMORROW, {culture: 'Maïs grain'}));
  const b = briefing(s, {today: TODAY, now: NOW, agro: agro({moisture: 0.25})});
  assert.match(b.text, /Semis du Grand Champ demain : conditions de semis réunies/);
});

test('portance : bilan hydrique saturé, à repousser', () => {
  const s = base(); s.interventions.push(work('l1', 'p3', 'Labour', TODAY));
  const soilWater = {days: Array.from({length: 10}, (_, i) => ({date: `2026-05-${pad(3 + i)}`, rain: 30, et0: 1})), soilMoisture: 0.5, loadedAt: NOW};
  const b = briefing(s, {today: TODAY, now: NOW, soilWater});
  const item = b.items.find(i => i.workId === 'l1');
  assert.equal(item.kind, 'soil-wet');
  assert.match(item.text, /^Labour d’Arnay : sol encore humide/);
});

test('récolte demain pendant un délai avant récolte : urgent en tête', () => {
  const s = base();
  s.stockItems = [{id: 'x', name: 'Prosaro', phyto: {dar: 35}}];
  s.interventions.push(work('f1', 'p3', 'Fauche', TODAY));
  s.interventions.push({id: 'tr', parcelId: 'p1', type: 'Traitement fongicide', product: 'Prosaro', status: 'Terminé', date: '2026-05-01'});
  s.interventions.push(work('h1', 'p1', 'Récolte', TOMORROW));
  const b = briefing(s, {today: TODAY, now: NOW});
  assert.equal(b.items[0].kind, 'dar');
  assert.equal(b.items[0].level, 'urgent');
  assert.match(b.items[0].text, /Récolte des Brosses prévue demain : délai avant récolte de Prosaro jusqu’au 05\/06/);
});

test('épandage interdit en zone vulnérable : urgent', () => {
  const s = base(); s.parcelles[0].zoneVulnerable = true;
  s.interventions.push(work('e1', 'p1', 'Épandage', '2026-11-13', {product: 'Lisier'}));
  const b = briefing(s, {today: '2026-11-12', now: new Date(2026, 10, 12, 6).getTime()});
  assert.equal(b.items[0].kind, 'zv-ban');
  assert.match(b.items[0].text, /^Épandage des Brosses \(Lisier\) prévu demain : interdit en zone vulnérable jusqu’au 31\/01/);
});

test('travaux ordinaires regroupés, retards comptés', () => {
  const s = base();
  s.interventions.push(work('a', 'p1', 'Pose de clôture', TODAY), work('b', 'p3', 'Broyage', TODAY), work('c', 'p1', 'Entretien', '2026-05-01'));
  const b = briefing(s, {today: TODAY, now: NOW});
  assert.ok(b.sentences.includes('1 travail en retard à replanifier ou clôturer.'));
  assert.ok(b.sentences.includes('Aujourd’hui : Pose de clôture des Brosses, Broyage d’Arnay.'));
  assert.ok(b.sentences.indexOf('1 travail en retard à replanifier ou clôturer.') < b.sentences.indexOf('Aujourd’hui : Pose de clôture des Brosses, Broyage d’Arnay.'));
});

test('risque agronomique : septoriose après deux pluies', () => {
  const b = briefing(base(), {today: TODAY, now: NOW, agro: agro({rainDays: ['2026-05-08', '2026-05-10']})});
  assert.ok(b.items.some(i => i.kind === 'risk-septoria' && i.parcelId === 'p1'), b.text);
});

test('au plus 6 phrases, urgences d’abord', () => {
  const s = base(); s.parcelles[0].zoneVulnerable = true;
  for (let i = 0; i < 9; i++) s.interventions.push(work(`w${i}`, 'p1', 'Épandage', '2026-11-12', {product: 'Lisier'}));
  s.interventions.push(work('z', 'p3', 'Broyage', '2026-11-12'));
  const b = briefing(s, {today: '2026-11-12', now: new Date(2026, 10, 12, 6).getTime()});
  assert.equal(b.sentences.length, BRIEF_LIMIT);
  assert.ok(b.items.every(i => i.level === 'urgent'));
});

test('assistant : intentions du point du matin', () => {
  assert.equal(agroIntent('point du matin'), 'brief');
  assert.equal(agroIntent('Qu’est-ce que je fais aujourd’hui ?'), 'brief');
  assert.equal(agroIntent('quoi de prévu demain ?'), 'brief');
  assert.equal(agroIntent('Puis-je traiter aujourd’hui ?'), 'spray');
});

test('assistant : réponse du point du matin avec ouverture de parcelle', () => {
  const s = base(); s.interventions.push(work('s1', 'p2', 'Semis', TODAY, {culture: 'Maïs grain'}));
  const r = answerAgroQuestion('qu’est-ce que je fais aujourd’hui ?', s, {today: TODAY, now: NOW, agro: agro({moisture: 0.45})});
  assert.equal(r.intent, 'morning_brief');
  assert.match(r.answer, /Semis du Grand Champ : sol encore humide, à repousser\./);
  assert.equal(r.actions[0].payload.parcelId, 'p2');
});

test('fil « À décider » : items du point du matin injectés (morning)', () => {
  const s = base(); s.interventions.push(work('t1', 'p1', 'Traitement fongicide', TODAY, {isPhytosanitary: true}));
  const b = briefing(s, {today: TODAY, now: NOW, weather: weather({allBad: true})});
  const rows = decisionFeed(s, {today: TODAY, now: NOW, morning: b, notifications: [], compliance: []});
  const card = rows.find(r => r.id === 'brief-spray-none-t1');
  assert.ok(card);
  assert.equal(card.action.type, 'postpone-work');
  assert.equal(fromBrief({kind: 'spray-window', workId: 't1', text: 'x'}), null);
});

test('épandage en zone vulnérable : exception possible (Sud) => à vérifier, pas interdit ferme', () => {
  const s = base(); s.parcelles[0].zoneVulnerable = true;
  s.interventions.push(work('e1', 'p1', 'Épandage', '2027-01-21', {product: 'Lisier'}));
  const b = briefing(s, {today: '2027-01-20', now: new Date(2027, 0, 20, 6).getTime()});
  assert.equal(b.items[0].kind, 'zv-check');
  assert.equal(b.items[0].level, 'warning');
  assert.match(b.items[0].text, /probablement interdit en zone vulnérable jusqu’au 31\/01 \(calendrier national\), sauf exception : Fin au 15\/01/);
});

test('épandage en zone vulnérable : période régionale saisie citée', () => {
  const s = base(); s.parcelles[0].zoneVulnerable = true; s.parcelles[0].culture = 'Colza';
  s.exploitation = {azote: {zvCalendar: {periods: [{occupation: 'colza', type: 'II', from: '09-01', to: '02-28'}]}}};
  s.interventions.push(work('e1', 'p1', 'Épandage', '2026-11-13', {product: 'Lisier'}));
  const b = briefing(s, {today: '2026-11-12', now: new Date(2026, 10, 12, 6).getTime()});
  assert.equal(b.items[0].kind, 'zv-ban');
  assert.match(b.items[0].text, /jusqu’au 28\/02 \(période régionale saisie\), à reporter/);
});
