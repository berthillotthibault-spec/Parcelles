import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {weatherRaces, raceFamily, rainSeries, dayName} from './weather-race.js';
import {decisionFeed, DECISION_ACTIONS} from './decision-feed.js';

const TODAY = '2026-11-12';
const day = (date, rain) => ({date, rain, tmax: 12, tmin: 4, forecast: date > TODAY});
// Passé sec, pluie de 8 mm le 14 (samedi), sec ensuite.
const agro = (rains = {'2026-11-14': 8}) => ({days: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16',
  '2026-11-17', '2026-11-18'].map(d => day(d, rains[d] ?? 0))});
function farm(extra = {}) {
  return {...emptyState(),
    parcelles: [{id: 'p1', nom: 'Les Brosses', surfaceHa: 10}, {id: 'p2', nom: 'Le Clos', surfaceHa: 12},
      {id: 'p3', nom: 'Les Noues', surfaceHa: 12, soilDrainage: 'hydromorphe'}],
    interventions: [
      {id: 'w1', type: 'Récolte maïs', parcelId: 'p1', status: 'Planifié', plannedDate: '2026-11-12'},
      {id: 'w2', type: 'Récolte maïs', parcelId: 'p2', status: 'Planifié', plannedDate: '2026-11-13'},
      {id: 'w3', type: 'Récolte maïs', parcelId: 'p3', status: 'Planifié', plannedDate: '2026-11-14'}], ...extra};
}

test('familles de chantiers', () => {
  assert.equal(raceFamily('Récolte maïs').key, 'recolte');
  assert.equal(raceFamily('Ensilage maïs').key, 'ensilage');
  assert.equal(raceFamily('Fauche'), raceFamily('Foin'));
  assert.equal(raceFamily('Traitement fongicide'), null);
  assert.equal(dayName('2026-11-13', TODAY), 'demain');
  assert.equal(dayName('2026-11-14', TODAY), 'samedi');
});

test('prévision trouée : arrêt au premier jour manquant', () => {
  const {horizon} = rainSeries({agro: {days: [day('2026-11-12', 0), day('2026-11-13', 0), day('2026-11-15', 0)]}, today: TODAY});
  assert.deepEqual(horizon, ['2026-11-12', '2026-11-13']);
});

test('34 ha, ~2,5 jours de travail, 2 jours praticables avant la pluie de samedi', () => {
  const [race] = weatherRaces(farm(), {today: TODAY, agro: agro()});
  assert.ok(race);
  assert.equal(race.family, 'recolte');
  assert.equal(race.remainingHa, 34);
  assert.ok(Math.abs(race.remainingHours - 20.4) < 1e-9);
  assert.equal(race.dryDays, 2);
  assert.equal(race.rainDate, '2026-11-14');
  assert.equal(race.endDate, '2026-11-15');
  assert.equal(race.level, 'urgent');
  // Sol hydromorphe d’abord (ressuie mal), puis l’échéance la plus proche ; le troisième ne tient pas dans 18 h.
  assert.deepEqual(race.start.map(s => s.workId), ['w3', 'w1']);
  assert.equal(race.title, 'Récolte : 34 ha restants, ~2,5 jours de travail, 2 jours praticables avant la pluie de samedi : commencez par Les Noues et Les Brosses');
  assert.ok(race.why.some(w => w.includes('3 au rythme par défaut de 0,6 h/ha')));
  assert.ok(race.why.some(w => w.includes('samedi 8 mm')));
});

test('pas d’alerte quand le chantier tient avant la pluie', () => {
  assert.deepEqual(weatherRaces(farm(), {today: TODAY, agro: agro({'2026-11-17': 10})}), []);
  // Journées plus longues : 20,4 h tiennent en deux journées de 11 h.
  assert.deepEqual(weatherRaces(farm(), {today: TODAY, agro: agro(), dayHours: 11}), []);
});

test('filtres : une seule parcelle, annulé, terminé, sans prévision', () => {
  const s = farm();
  s.interventions[1].status = 'Annulée';
  s.interventions[2].status = 'Terminé';
  assert.deepEqual(weatherRaces(s, {today: TODAY, agro: agro()}), []);
  assert.deepEqual(weatherRaces(farm(), {today: TODAY, agro: null}), []);
  assert.deepEqual(weatherRaces(null, {today: TODAY}), []);
  const far = farm();
  far.interventions.forEach(w => {w.plannedDate = '2026-12-20';});
  assert.deepEqual(weatherRaces(far, {today: TODAY, agro: agro()}), []);
});

test('durée saisie et historique utilisés avant le rythme par défaut', () => {
  const s = farm();
  s.interventions[0].duration = 4;
  const [race] = weatherRaces(s, {today: TODAY, agro: agro()});
  // w1 : 4 h saisies ; w2 et w3 au rythme du groupe (0,4 h/ha) : 4 + 4,8 + 4,8 = 13,6 h, tient en 2 jours -> pas d’alerte.
  assert.equal(race, undefined);
  s.interventions[0].duration = 10;
  const [late] = weatherRaces(s, {today: TODAY, agro: agro()});
  assert.ok(late.why[0].includes('1 durée saisie'));
  assert.ok(late.why[0].includes('2 au rythme des autres chantiers (1 h/ha)'));
});

test('sol trop humide : chantier impossible dans la prévision sans pluie à venir', () => {
  const wet = agro({'2026-11-10': 15, '2026-11-11': 15, '2026-11-12': 0.5});
  wet.days = wet.days.map(d => d.date > TODAY ? {...d, rain: 0} : d);
  const s = farm();
  s.interventions.forEach(w => {w.duration = 30;});
  const [race] = weatherRaces(s, {today: TODAY, agro: wet});
  assert.equal(race.rainDate, null);
  assert.equal(race.endDate, null);
  assert.equal(race.level, 'info');
  assert.match(race.title, /sol trop humide/);
});

test('carte du fil À décider, action en lecture seule', () => {
  const races = weatherRaces(farm(), {today: TODAY, agro: agro()});
  const rows = decisionFeed(farm(), {today: TODAY, now: Date.UTC(2026, 10, 12, 9), notifications: [], compliance: [], weatherRace: races, feedback: null});
  const card = rows.find(r => r.kind === 'weather-race');
  assert.ok(card);
  assert.equal(card.stakes.ha, 34);
  assert.equal(card.stakes.daysLeft, 2);
  assert.deepEqual(card.action, {type: 'edit-work', label: 'Voir le chantier', id: 'w3', payload: null});
  assert.ok(DECISION_ACTIONS.includes(card.action.type));
});

test('relecture : deux chantiers sur une même parcelle, surface comptée une fois', () => {
  const s = farm();
  s.interventions.push({id: 'w4', type: 'Récolte maïs', parcelId: 'p1', status: 'Planifié', plannedDate: '2026-11-13'});
  const [race] = weatherRaces(s, {today: TODAY, agro: agro()});
  assert.equal(race.remainingHa, 34);
  assert.equal(race.works, 4);
});

test('relecture : sans pluie ni sol humide, un chantier long ne déclenche pas « sol trop humide »', () => {
  const s = farm();
  s.interventions.forEach(w => {w.duration = 30;});
  assert.deepEqual(weatherRaces(s, {today: TODAY, agro: agro({})}), []);
});

test('relecture : pluie aujourd’hui, aucun jour praticable : pas de « commencez par »', () => {
  const [race] = weatherRaces(farm(), {today: TODAY, agro: agro({'2026-11-12': 6})});
  assert.equal(race.dryDays, 0);
  assert.doesNotMatch(race.title, /commencez par/);
  assert.match(race.title, /à replanifier$/);
});
