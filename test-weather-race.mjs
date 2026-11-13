import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {weatherRaces, raceFamily, rainSeries, dayName, stationsForParcel} from './weather-race.js';
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

// Par parcelle : petites parcelles carrées autour d’un point, stations positionnées.
const square = (lon, lat) => ({type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.004, lat], [lon + 0.004, lat + 0.004], [lon, lat + 0.004], [lon, lat]]]});
const placed = () => {
  const s = farm();
  s.parcelles[0].geometry = square(4.0, 46.0);
  s.parcelles[1].geometry = square(4.3, 46.0);
  s.parcelles[2].geometry = square(4.01, 46.0);
  return s;
};
const station = (name, lon, lat, readings) => ({id: name, name, longitude: lon + 0.002, latitude: lat + 0.002, readings});

test('par parcelle : station la plus proche, une parcelle détrempée conseillée plus tard', () => {
  const s = placed();
  s.weatherStations = [station('Station du Clos', 4.3, 46.0, [{time: '2026-11-11T08:00', rainMm: 25}]),
    station('Station des Brosses', 4.0, 46.0, [{time: '2026-11-11T08:00', rainMm: 0}])];
  const [race] = weatherRaces(s, {today: TODAY, agro: agro()});
  assert.ok(race.perParcel);
  assert.equal(race.dryDays, 2);
  assert.deepEqual(race.start.map(x => x.workId), ['w3', 'w1']);
  assert.deepEqual(race.blocked.map(b => [b.parcelId, b.from]), [['p2', '2026-11-15']]);
  const line = race.why.find(w => w.startsWith('Bloquées aujourd’hui'));
  assert.match(line, /Le Clos \(25 mm en 3 jours \(seuil 18 mm\) ; praticable dimanche\)/);
  assert.ok(race.why.some(w => w.includes('Station du Clos')));
  // Sans station : calcul de toute la ferme, aucune parcelle bloquée.
  const [plain] = weatherRaces(placed(), {today: TODAY, agro: agro()});
  assert.deepEqual(plain.blocked, []);
  assert.equal(plain.perParcel, false);
});

test('par parcelle : bilan hydrique récent, sol hydromorphe gorgé d’eau aujourd’hui', () => {
  const days = Array.from({length: 15}, (_, i) => ({date: new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10), rain: 0, et0: 1}));
  assert.equal(days.at(-1).date, TODAY);
  const soil = {days, forecast: [], soilMoisture: 0.35, soilMoistureAt: `${TODAY}T08:00`, soilMoistureStart: 0.2, loadedAt: Date.UTC(2026, 10, 12, 8)};
  const [race] = weatherRaces(farm(), {today: TODAY, agro: agro(), soil});
  assert.ok(race.perParcel);
  assert.deepEqual(race.blocked.map(b => [b.parcelId, b.from]), [['p3', '2026-11-13']]);
  assert.deepEqual(race.start.map(x => x.workId), ['w1', 'w2']);
  assert.match(race.title, /commencez par Les Brosses et Le Clos$/);
  assert.ok(race.why.some(w => w.startsWith('Portance par parcelle')));
  assert.ok(race.why.some(w => w.includes('Les Noues (surface gorgée d’eau ; praticable demain)')));
  // Bilan trop ancien : repli sur le cumul de pluie de toute la ferme.
  const old = {...soil, days: days.slice(0, 8), soilMoistureAt: '2026-11-05T08:00'};
  const [fallback] = weatherRaces(farm(), {today: TODAY, agro: agro(), soil: old});
  assert.deepEqual(fallback.blocked, []);
  assert.deepEqual(fallback.start.map(x => x.workId), ['w3', 'w1']);
});

test('stations d’une parcelle : la plus proche positionnée, pluviomètre sans position gardé', () => {
  const gauge = {id: 'g', name: 'Pluviomètre manuel', source: 'manual-gauge', readings: []};
  const near = station('Proche', 4.0, 46.0, []), far = station('Loin', 4.5, 46.0, []), mid = station('Milieu', 4.05, 46.0, []);
  assert.deepEqual(stationsForParcel({geometry: square(4.0, 46.0)}, [far, gauge, mid, near]).map(x => x.id), ['Proche', 'g']);
  assert.deepEqual(stationsForParcel({geometry: square(4.0, 46.0)}, [far, gauge]).map(x => x.id), ['g']);
  assert.deepEqual(stationsForParcel({id: 'sans-contour'}, [far, gauge]).map(x => x.id), ['Loin', 'g']);
  assert.deepEqual(stationsForParcel({geometry: square(4.0, 46.0)}, [{...near, deletedAt: 1}, gauge]).map(x => x.id), ['g']);
});

test('relecture : pluie annoncée aujourd’hui, relevé partiel à 0 mm : aujourd’hui reste non praticable', () => {
  const s = farm();
  s.weatherStations = [{id: 'g', name: 'Pluviomètre manuel', source: 'manual-gauge', readings: [{time: `${TODAY}T07:00`, rainMm: 0}]}];
  const [race] = weatherRaces(s, {today: TODAY, agro: agro({'2026-11-12': 6})});
  assert.equal(race.rainDate, TODAY);
  assert.equal(race.dryDays, 0);
  assert.equal(race.endDate, '2026-11-15');
  assert.match(race.title, /à replanifier$/);
});
