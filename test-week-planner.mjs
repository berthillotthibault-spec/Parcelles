import test from 'node:test';
import assert from 'node:assert/strict';
import {weekStart, weekDays, shiftWeek, isUndated, dayWeather, buildWeek, proposeWeek, checkPlacement, moveDate, planChanges} from './week-planner.js';

// Lundi 5 octobre 2026, 7 h.
const NOW = new Date(2026, 9, 5, 7).getTime();
const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d * 0.7], [x, y + d * 0.7], [x, y]]]});
// Prévision horaire sur 7 jours : pluie mardi et mercredi, vent fort jeudi, beau sinon.
function forecast() {
  const time = [], precipitation = [], wind = [], temperature = [], humidity = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const t = new Date(2026, 9, 5 + d, h);
    time.push(t.toISOString());
    precipitation.push(d === 1 || d === 2 ? 2 : 0);
    wind.push(d === 3 ? 40 : 10);
    temperature.push(15);
    humidity.push(70);
  }
  return {loadedAt: NOW, hourly: {time, precipitation, wind_speed_10m: wind, temperature_2m: temperature, relative_humidity_2m: humidity}};
}
const base = () => ({
  parcelles: [
    {id: 'a', nom: 'Les Noues', culture: 'Blé', surfaceHa: 10, geometry: sq(5.130, 46.340)},
    {id: 'b', nom: 'Pré du Bas', culture: 'Prairie', surfaceHa: 4, geometry: sq(5.135, 46.340)},
    {id: 'c', nom: 'Loin', culture: 'Maïs', surfaceHa: 6, geometry: sq(5.400, 46.500)},
  ],
  materiels: [{id: 'm1', nom: 'Tracteur'}, {id: 'm2', nom: 'Pulvé'}],
  interventions: [],
  chantiers: [],
});

test('semaine : lundi de départ, 7 jours, décalage', () => {
  assert.equal(weekStart(new Date(2026, 9, 8)), '2026-10-05');
  assert.equal(weekDays('2026-10-05').at(-1), '2026-10-11');
  assert.equal(shiftWeek('2026-10-05', 1), '2026-10-12');
  assert.equal(isUndated({status: 'À faire', date: '2026-10-01', plannedDate: ''}), true);
  assert.equal(isUndated({status: 'À faire', plannedDate: '2026-10-07'}), false);
  assert.equal(isUndated({status: 'Terminé', plannedDate: ''}), false);
});

test('bande météo : 14 heures, pluie mardi défavorable, sans prévision inconnue', () => {
  const w = forecast();
  const tue = dayWeather(w, '2026-10-06', {rule: 'Fauche', now: NOW});
  assert.equal(tue.hours.length, 14);
  assert.equal(tue.known, true);
  assert.equal(tue.favorable, 0);
  assert.ok(tue.rain > 20);
  assert.ok(dayWeather(w, '2026-10-09', {rule: 'Fauche', now: NOW}).favorable >= 12);
  assert.equal(dayWeather(null, '2026-10-06').known, false);
});

test('proposition : créneau météo, regroupement, engin unique, chantier daté', () => {
  const s = base();
  s.interventions.push(
    {id: 'f1', parcelId: 'b', type: 'Fauche', status: 'À faire', date: '2026-10-01', plannedDate: '', createdAt: 1, equipmentId: 'm1'},
    {id: 'f2', parcelId: 'a', type: 'Fauche', status: 'À faire', date: '2026-10-01', plannedDate: '', createdAt: 2, equipmentId: 'm1'},
    {id: 'l1', parcelId: 'c', type: 'Labour', status: 'À faire', date: '2026-10-01', plannedDate: '', createdAt: 3, equipmentId: 'm1'},
    {id: 'd1', parcelId: 'a', type: 'Semis', status: 'À faire', date: '2026-10-05', plannedDate: '2026-10-05', duration: 9},
  );
  // Le tracteur est pris par un chantier de travaux publics lundi.
  s.chantiers.push({id: 'tp1', kind: 'tp', type: 'Curage fossé', plannedDate: '2026-10-05', equipmentId: 'm1', status: 'Planifié'});
  const plan = proposeWeek(s, '2026-10-05', {weather: forecast(), now: NOW});
  const at = id => plan.placed.find(p => p.work.id === id);
  // Lundi : tracteur au chantier ; mardi/mercredi : pluie ; jeudi : vent → vendredi.
  assert.equal(at('f1').date, '2026-10-09');
  assert.match(at('f1').reasons.join(' '), /créneau fauche/);
  // f2 voisine : même sortie, même jour, avec la raison du regroupement.
  assert.equal(at('f2').date, '2026-10-09');
  assert.match(at('f2').reasons[0], /regroupé avec Pré du Bas, \d+ m/);
  // Labour loin, même tracteur, autre travail : jamais le même jour que la fauche.
  assert.notEqual(at('l1').date, '2026-10-09');
  assert.notEqual(at('l1').date, '2026-10-05');
  assert.equal(plan.unplaced.length, 0);
  // Le jour du chantier apparaît comme réservé.
  assert.equal(plan.week[0].booked.get('m1').kind, 'chantier');
});

test('jours passés exclus, non placé expliqué', () => {
  const s = base();
  s.interventions.push({id: 'f1', parcelId: 'b', type: 'Fauche', status: 'À faire', date: '2026-10-01', plannedDate: ''});
  const late = new Date(2026, 9, 10, 7).getTime(), w = forecast();
  w.loadedAt = late;
  const plan = proposeWeek(s, '2026-10-05', {weather: w, now: late});
  assert.ok(['2026-10-10', '2026-10-11'].includes(plan.placed[0].date));
  const s2 = base();
  s2.interventions.push({id: 'p1', parcelId: 'b', type: 'Fauche', status: 'À faire', date: '2026-10-01', plannedDate: ''});
  const rainy = forecast(); rainy.hourly.precipitation = rainy.hourly.precipitation.map(() => 3);
  const none = proposeWeek(s2, '2026-10-05', {weather: rainy, now: NOW});
  assert.equal(none.placed.length, 0);
  assert.match(none.unplaced[0].reasons[0], /pas de créneau fauche/);
});

test('déplacement manuel : avertissements, bornes et écritures', () => {
  const s = base();
  s.interventions.push(
    {id: 'f1', parcelId: 'b', type: 'Fauche', status: 'À faire', date: '2026-10-01', plannedDate: '', equipmentId: 'm1', createdAt: 1},
    {id: 'l1', parcelId: 'c', type: 'Labour', status: 'À faire', date: '2026-10-01', plannedDate: '', equipmentId: 'm1', createdAt: 2},
  );
  const plan = proposeWeek(s, '2026-10-05', {weather: forecast(), now: NOW});
  const fauche = plan.placed.find(p => p.work.id === 'f1'), labour = plan.placed.find(p => p.work.id === 'l1');
  labour.date = fauche.date;
  assert.ok(checkPlacement(s, plan, 'l1', labour.date, {weather: forecast(), now: NOW}).includes('Tracteur déjà réservé ce jour'));
  assert.ok(checkPlacement(s, plan, 'f1', '2026-10-06', {weather: forecast(), now: NOW}).includes('pas de créneau fauche'));
  assert.equal(moveDate(plan.week, '2026-10-11', 1), '2026-10-11');
  assert.equal(moveDate(plan.week, '2026-10-07', -1), '2026-10-06');
  const changes = planChanges(plan);
  assert.equal(changes.length, 2);
  assert.ok(changes.every(w => /^2026-10-\d\d$/.test(w.plannedDate)));
});

test('charge : les travaux non datés ne pèsent pas sur le jour de création', () => {
  const s = base();
  s.interventions.push({id: 'u', parcelId: 'a', type: 'Broyage', status: 'À faire', date: '2026-10-05', plannedDate: '', duration: 5});
  assert.equal(buildWeek(s, '2026-10-05', {now: NOW})[0].hours, 0);
});
