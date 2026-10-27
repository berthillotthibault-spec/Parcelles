import test from 'node:test';
import assert from 'node:assert/strict';
import {learnHabits, nextStepSuggestion, habitDefaults, median, yearsText} from './habits.js';

const NOW = Date.parse('2026-05-10T10:00:00Z');
const parcels = [{id: 'p1', nom: 'Les Noues', culture: 'Maïs grain'}, {id: 'p2', nom: 'Grand Champ', culture: 'Maïs grain'}];
const w = (id, parcelId, type, date, extra = {}) => ({id, parcelId, type, date, status: 'Terminé', ...extra});
function farm(extra = []) {
  return {
    parcelles: parcels, materiels: [{id: 'm1', nom: 'Pulvé'}], rotations: [],
    interventions: [
      w('a1', 'p1', 'Semis', '2025-04-20', {product: 'P9234', dose: 90000, doseUnit: 'graines/ha', equipmentId: 'm1'}),
      w('a2', 'p1', 'Désherbage', '2025-05-25', {product: 'Adengo', dose: 0.33, doseUnit: 'L/ha', equipmentId: 'm1'}),
      w('b1', 'p1', 'Semis', '2024-04-22', {product: 'P9234', dose: 90000, doseUnit: 'graines/ha'}),
      w('b2', 'p1', 'Désherbage', '2024-06-01', {product: 'Adengo', dose: 0.33, doseUnit: 'L/ha', equipmentId: 'm1'}),
      w('c1', 'p2', 'Semis', '2021-04-25'), // hors fenêtre : 2020/21, alors que l'on remonte à 2022/23
      ...extra
    ]
  };
}

test('médiane et liste d’années', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 3);
  assert.equal(median([]), null);
  assert.equal(yearsText([2025, 2024]), '2025 et 2024');
  assert.equal(yearsText([2025, 2024, 2023]), '2025, 2024 et 2023');
});

test('le travail suivant le plus fréquent avec son délai médian, seuil de 2', () => {
  const h = learnHabits(farm(), {now: NOW});
  const next = h.next['mais grain|semis'];
  assert.equal(next.type, 'Désherbage');
  assert.equal(next.count, 2);
  assert.equal(next.delayDays, 38); // 35 et 40 jours
  assert.deepEqual(next.years, [2025, 2024]);
  assert.equal(h.next['mais grain|desherbage'], undefined);
});

test('une seule occurrence ne fait pas une habitude', () => {
  const state = farm();
  state.interventions = state.interventions.filter(x => !x.id.startsWith('b'));
  assert.equal(learnHabits(state, {now: NOW}).next['mais grain|semis'], undefined);
});

test('proposition après un semis terminé, sauf si déjà prévu', () => {
  const sowing = w('n1', 'p1', 'Semis', '2026-04-26');
  const state = farm([sowing]);
  const s = nextStepSuggestion(state, sowing, {now: NOW});
  assert.equal(s.type, 'Désherbage');
  assert.equal(s.date, '2026-06-03');
  assert.match(s.label, /^Désherbage prévu vers le 3 juin \(comme en 2025 et 2024\) \?$/);
  assert.match(s.source, /vu 2 fois/);
  const planned = farm([sowing, {id: 'n2', parcelId: 'p1', type: 'désherbage', date: '2026-06-01', status: 'À faire'}]);
  assert.equal(nextStepSuggestion(planned, sowing, {now: NOW}), null);
});

test('produit, dose et matériel habituels', () => {
  const d = habitDefaults(farm(), {culture: 'Maïs grain', type: 'Désherbage', now: NOW});
  assert.equal(d.product.value, 'Adengo');
  assert.equal(d.product.count, 2);
  assert.deepEqual([d.dose.value, d.dose.unit], ['0.33', 'L/ha']);
  assert.equal(d.equipmentId.value, 'm1');
  const sowing = habitDefaults(farm(), {culture: 'Maïs grain', type: 'Semis', now: NOW});
  assert.equal(sowing.equipmentId, undefined, 'matériel vu une seule fois');
  assert.equal(habitDefaults(farm(), {culture: 'Blé', type: 'Semis', now: NOW}), null);
});

test('la culture vient de la rotation de la campagne si le travail n’en a pas', () => {
  const state = farm();
  state.rotations = [{id: 'r', parcelId: 'p1', campaignId: '2025/26', culture: 'Blé tendre'}];
  state.interventions.push(w('x1', 'p1', 'Semis', '2025-10-10'), w('x2', 'p1', 'Désherbage', '2025-11-01'));
  const h = learnHabits(state, {now: NOW});
  assert.equal(h.next['ble tendre|semis'], undefined);
  assert.ok(h.next['mais grain|semis']);
});

// n° 102 : rappel du travail habituel non fait, jour de semaine habituel.
test('jour de semaine habituel : appris au-delà de la moitié des cas, date proposée alignée', async () => {
  const {habitualWeekday, alignToWeekday, weekdayOf} = await import('./habits.js');
  assert.equal(weekdayOf('2026-06-01'), 1);
  assert.deepEqual(habitualWeekday([1, 1, 3]), {value: 1, count: 2, label: 'lundi'});
  assert.equal(habitualWeekday([1, 2, 3, 4]), null);
  assert.equal(alignToWeekday('2026-06-03', 1), '2026-06-01');
  assert.equal(alignToWeekday('2026-06-05', 1), '2026-06-08');
  // 2025-05-25 et 2024-06-01 tombent un dimanche et un samedi : aucun jour habituel retenu.
  const s = farm([w('x1', 'p2', 'Semis', '2025-04-21'), w('x2', 'p2', 'Désherbage', '2025-05-26')]);
  const habit = learnHabits(s, {now: NOW}).next['mais grain|semis'];
  assert.equal(habit.weekday, undefined);
});

test('travail habituel non fait : rappel après le délai médian + 7 j, jamais s’il est prévu ou fait', async () => {
  const {missedHabits} = await import('./habits.js');
  const {computeNotifications} = await import('./notifications.js');
  const at = day => Date.parse(`${day}T10:00:00Z`);
  const s = farm([w('n1', 'p1', 'Semis', '2026-04-20')]); // désherbage attendu vers le 2026-05-28 (délai médian 38 j)
  assert.deepEqual(missedHabits(s, {now: at('2026-06-01')}), [], 'dans le délai de grâce');
  const [row] = missedHabits(s, {now: at('2026-06-06')});
  assert.equal(row.type, 'Désherbage'); assert.equal(row.expected, '2026-05-28'); assert.equal(row.late, 9);
  assert.match(row.message, /habituellement 38 j après Semis, attendu vers le 28 mai \(vu 2 fois\)/);
  assert.deepEqual(missedHabits(s, {now: at('2026-07-15')}), [], 'trop tard : étape sans doute sautée');
  assert.deepEqual(missedHabits(farm([w('n1', 'p1', 'Semis', '2026-04-20'), {id: 'n2', parcelId: 'p1', type: 'Désherbage', status: 'À faire', plannedDate: '2026-06-10'}]), {now: at('2026-06-06')}), [], 'déjà prévu');
  assert.deepEqual(missedHabits(farm([w('n1', 'p1', 'Semis', '2026-04-20'), w('n2', 'p1', 'Désherbage', '2026-05-30')]), {now: at('2026-06-06')}), [], 'déjà fait');
  const notes = computeNotifications({...s, preferences: {}}, {now: at('2026-06-06')}).filter(n => n.id.startsWith('habit-missed-'));
  assert.equal(notes.length, 1); assert.equal(notes[0].title, 'Travail habituel non fait'); assert.match(notes[0].message, /^Désherbage · Les Noues/);
  assert.equal(computeNotifications({...s, preferences: {habitReminders: false}}, {now: at('2026-06-06')}).filter(n => n.id.startsWith('habit-missed-')).length, 0, 'désactivable');
});
