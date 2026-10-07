import test from 'node:test';
import assert from 'node:assert/strict';
import {briefTitle, composeMorningBrief as compose, dayStory as story, frenchClock, greetingFor, greetingTitle, todayWindow, weatherAge, weatherFacts, weatherRuleFor} from './home-story.js';
import {dailySituation, localDay} from './home-priorities.js';
import {typo} from './home-story.js';

const at = (h, m = 0, day = 7) => new Date(2026, 9, day, h, m); // 7 octobre 2026, un mercredi
const HOUR = 3600000;
// Les phrases portent des espaces insécables ; on les compare en espaces simples.
const plain = text => String(text).replace(/[\u00a0\u202f]/g, ' ');
const composeMorningBrief = (...args) => {const b = compose(...args); return {...b, speech: plain(b.speech), sentences: b.sentences.map(s => ({...s, text: plain(s.text)}))};};
const dayStory = (...args) => plain(story(...args));

// Prévision horaire en heures locales (ISO avec Z, interprétée par forecastTime).
function forecast(now, {rainFrom = null, wind = 9, loadedAt = now.getTime()} = {}) {
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  const time = [], precipitation = [], wind_speed_10m = [], temperature_2m = [], relative_humidity_2m = [], precipitation_probability = [];
  for (let i = 0; i < 48; i++) {
    const t = new Date(base.getTime() + i * HOUR);
    time.push(t.toISOString());
    precipitation.push(rainFrom !== null && i >= rainFrom && i < 24 ? 1.2 : 0);
    wind_speed_10m.push(wind); temperature_2m.push(14); relative_humidity_2m.push(70); precipitation_probability.push(10);
  }
  return {loadedAt, current: {temperature_2m: 13.6, wind_speed_10m: wind}, hourly: {time, precipitation, wind_speed_10m, temperature_2m, relative_humidity_2m, precipitation_probability}};
}

function farm(today, extra = {}) {
  return {
    exploitation: {nom: 'Ferme', commune: 'Montrevel'}, preferences: {},
    parcelles: [{id: 'p1', nom: 'Les Noues', surfaceHa: 11.3}, {id: 'p3', nom: 'Le Pré Bas', surfaceHa: 4.6}],
    interventions: [{id: 'w2', parcelId: 'p1', type: 'Semis blé', date: today, plannedDate: today, status: 'À faire'}],
    tasks: [], grazingSessions: [], stockItems: [], materiels: [], observations: [], ...extra
  };
}

test('salutation selon l’heure', () => {
  assert.equal(greetingFor(at(7)), 'Bonjour');
  assert.equal(greetingFor(at(17, 59)), 'Bonjour');
  assert.equal(greetingFor(at(18)), 'Bonsoir');
  assert.equal(greetingFor(at(22)), 'Bonne nuit');
  assert.equal(greetingFor(at(3)), 'Bonne nuit');
  assert.equal(greetingTitle(' Thibault ', at(19)), 'Bonsoir Thibault');
  assert.equal(greetingTitle('', at(9)), 'Bonjour');
  assert.equal(briefTitle(at(8)), 'Ce matin');
  assert.equal(briefTitle(at(14)), 'Cet après-midi');
  assert.equal(briefTitle(at(20)), 'Ce soir');
  assert.equal(frenchClock(at(14).getTime()), '14 h');
  assert.equal(frenchClock(at(14, 30).getTime()), '14 h 30');
});

test('âge de la météo', () => {
  const now = at(9).getTime();
  assert.equal(weatherAge(null, now).state, 'missing');
  assert.deepEqual([weatherAge({loadedAt: now - 25 * 60000}, now).state, weatherAge({loadedAt: now - 25 * 60000}, now).label], ['fresh', 'il y a 25 min']);
  assert.equal(weatherAge({loadedAt: now - 9 * HOUR}, now).label, 'il y a 9 h');
  assert.equal(weatherAge({loadedAt: now - 9 * HOUR}, now).state, 'stale');
  assert.equal(weatherAge({loadedAt: now - 72 * HOUR}, now).state, 'old');
  assert.equal(weatherAge({loadedAt: now - 72 * HOUR}, now).label, 'il y a 3 jours');
});

test('famille de seuils déduite du type de travail', () => {
  assert.equal(weatherRuleFor('Désherbage colza'), 'Pulvérisation');
  assert.equal(weatherRuleFor('Semis blé'), 'Semis');
  assert.equal(weatherRuleFor('Épandage lisier'), 'Épandage');
  assert.equal(weatherRuleFor('Apport d’urée'), 'Fertilisation');
  assert.equal(weatherRuleFor('Réparer clôture'), '');
  assert.equal(weatherRuleFor(''), '');
});

test('faits météo du reste de la journée', () => {
  const now = at(9);
  const dry = weatherFacts(forecast(now), now.getTime());
  assert.equal(dry.rainAt, null);
  const wet = weatherFacts(forecast(now, {rainFrom: 14}), now.getTime());
  assert.equal(wet.rainAt, at(14).getTime());
  assert.equal(wet.wind, 9);
});

test('créneau favorable du jour, interrompu par la pluie', () => {
  const now = at(9), w = todayWindow(forecast(now, {rainFrom: 14}), 'Semis', now.getTime());
  assert.ok(w.current);
  assert.equal(w.end, at(14).getTime());
  assert.equal(todayWindow(forecast(now, {wind: 50}), 'Semis', now.getTime()), null);
  assert.equal(todayWindow(forecast(now), 'Semis', now.getTime()).endsToday, false);
});

test('briefing : phrase météo-travail avec créneau indicatif et lien vers le travail', () => {
  const now = at(9), today = localDay(now), data = farm(today);
  const brief = composeMorningBrief(data, forecast(now, {rainFrom: 14}), {now: now.getTime()});
  assert.equal(brief.title, 'Ce matin');
  const first = brief.sentences[0];
  assert.equal(first.text, 'Sec jusqu’à 14 h, vent 9 km/h, 14 °C : créneau favorable jusqu’à 14 h pour « Semis blé » sur Les Noues.');
  assert.equal(first.action, 'edit-work');
  assert.equal(first.id, 'w2');
  assert.ok(brief.indicative);
  assert.match(brief.speech, /^Ce matin\. Sec jusqu’à 14 h/);
});

test('briefing : vent trop fort, pas de créneau annoncé', () => {
  const now = at(9), today = localDay(now);
  const brief = composeMorningBrief(farm(today), forecast(now, {wind: 50}), {now: now.getTime()});
  assert.match(brief.sentences[0].text, /Pas de créneau favorable aujourd’hui pour « Semis blé » sur Les Noues selon les seuils indicatifs\.$/);
  assert.equal(brief.sentences[0].tone, 'warn');
});

test('briefing hors connexion : météo en cache ancienne signalée, jamais de créneau', () => {
  const now = at(9), today = localDay(now);
  const stale = composeMorningBrief(farm(today), forecast(now, {loadedAt: now.getTime() - 9 * HOUR}), {now: now.getTime()});
  assert.match(stale.sentences[0].text, /^Dernière météo connue il y a 9 h \(pas de pluie .*, 14 °C\) : à actualiser avant de décider\.$/);
  assert.equal(stale.sentences[0].action, 'refresh-weather');
  assert.equal(stale.indicative, false);
  const none = composeMorningBrief({...farm(today), exploitation: {}}, null, {now: now.getTime()});
  assert.equal(none.sentences[0].story, 'locate');
  assert.match(none.sentences[0].text, /position de l’exploitation n’est pas renseignée/);
});

test('briefing : pâturage, stock, entretien, observation, au plus 5 phrases', () => {
  const now = at(9), today = localDay(now);
  const start = localDay(new Date(now.getTime() - 18 * 86400000));
  const data = farm(today, {
    grazingSessions: [{id: 'g1', parcelId: 'p3', animalType: 'Vaches', animalsCount: 24, startDate: start}],
    stockItems: [{id: 's1', name: 'Urée', unit: 'kg', quantity: 80, alertBelow: 100}],
    materiels: [{id: 'm1', nom: 'Tracteur', currentMeter: 990, maintenanceDue: 1000}],
    observations: [{id: 'o1', title: 'Clôture cassée', severity: 'Urgent', status: 'Ouvert'}]
  });
  const brief = composeMorningBrief(data, forecast(now), {now: now.getTime()});
  const byKey = Object.fromEntries(brief.sentences.map(s => [s.key, s]));
  assert.equal(brief.sentences.length, 5);
  assert.equal(byKey.grazing.text, '24 vaches sur Le Pré Bas depuis 18 jours.');
  assert.equal(byKey.grazing.action, 'edit-grazing');
  assert.equal(byKey.stock.text, 'Stock sous le seuil : Urée (80 kg).');
  assert.equal(byKey.maintenance.text, 'Entretien de Tracteur dans 10 heures.');
  assert.equal(byKey.observation.text, 'Observation urgente à traiter : Clôture cassée.');
});

test('briefing du lundi : la semaine s’ajoute', () => {
  const monday = at(9, 0, 5), today = localDay(monday);
  const lastWeek = localDay(new Date(monday.getTime() - 3 * 86400000));
  const data = farm(today, {interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Labour', date: today, plannedDate: today, status: 'À faire'},
    {id: 'w9', parcelId: 'p1', type: 'Fauche', date: lastWeek, status: 'Terminé', surfaceWorked: 4.5}
  ]});
  const brief = composeMorningBrief(data, forecast(monday), {now: monday.getTime()});
  const week = brief.sentences.find(s => s.key === 'week');
  assert.equal(week.text, 'Cette semaine : 1 travail prévu d’ici dimanche ; 1 travail terminé la semaine dernière (4,5 ha).');
  assert.equal(composeMorningBrief(farm(localDay(at(9))), forecast(at(9)), {now: at(9).getTime()}).sentences.some(s => s.key === 'week'), false);
});

test('briefing calme : une phrase rassurante', () => {
  const now = at(9), today = localDay(now);
  const brief = composeMorningBrief(farm(today, {interventions: []}), forecast(now), {now: now.getTime()});
  assert.equal(brief.sentences.length, 2);
  assert.equal(brief.sentences[0].text, 'Pas de pluie prévue d’ici ce soir, vent 9 km/h, 14 °C.');
  const open = composeMorningBrief(farm(today), forecast(now), {now: now.getTime()});
  assert.match(open.sentences[0].text, /créneau favorable jusqu’à ce soir pour « Semis blé »/);
  assert.equal(brief.sentences[1].key, 'calm');
});

test('sous-titre : agenda du jour en une phrase, accords au singulier', () => {
  const now = at(9), today = localDay(now);
  const yesterday = localDay(new Date(now.getTime() - 86400000));
  const one = dailySituation(farm(today, {tasks: [{id: 't1', title: 'Clôture', dueDate: today, status: 'À faire'}]}), today);
  assert.equal(dayStory(one, now), '1 travail et 1 tâche aujourd’hui.');
  const late = dailySituation(farm(today, {interventions: [{id: 'w3', type: 'Désherbage', plannedDate: yesterday, date: yesterday, status: 'À faire'}]}), today);
  assert.equal(dayStory(late, now), 'Rien de prévu aujourd’hui, mais 1 action en retard à reprendre.');
  const done = dailySituation(farm(today, {interventions: [{id: 'w4', type: 'Semis', date: today, status: 'Terminé'}]}), today);
  assert.equal(dayStory(done, at(19)), 'Journée bouclée : 1 travail terminé.');
  const empty = dailySituation(farm(today, {interventions: []}), today);
  assert.equal(dayStory(empty, now), 'Rien de prévu aujourd’hui.');
  assert.equal(dayStory(one, at(19)), '1 travail et 1 tâche encore à faire ce soir.');
});

test('typographie française : espaces insécables', () => {
  assert.equal(typo('Stock : « Urée » 9 km/h, 14 °C ; 3 h ?'), 'Stock\u202f: «\u202fUrée\u202f» 9\u00a0km/h, 14\u00a0°C\u202f; 3\u00a0h\u202f?');
  assert.equal(story(dailySituation({interventions: [], tasks: []}, '2026-10-07'), at(9)), 'Rien de prévu aujourd’hui.');
});
