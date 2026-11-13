import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {learnCalendar, calendarDue} from './habits.js';
import {computeNotifications} from './notifications.js';
import {decisionFeed} from './decision-feed.js';

const at = iso => Date.parse(`${iso}T10:00:00Z`);
const w = (id, parcelId, type, date, extra = {}) => ({id, parcelId, type, date, status: 'Terminé', ...extra});
// Blé semé autour du 12-18 octobre sur trois campagnes passées ; maïs au printemps.
function farm(extra = [], parcelExtra = []) {
  return {...emptyState(),
    parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 12}, {id: 'p2', nom: 'Le Clos', culture: 'Blé tendre', surfaceHa: 8.5}, {id: 'p3', nom: 'La Noue', culture: 'Maïs grain', surfaceHa: 6}, ...parcelExtra],
    interventions: [
      w('a', 'p1', 'Semis', '2023-10-12'), w('b', 'p1', 'Semis', '2024-10-18'), w('c', 'p1', 'Semis', '2025-10-09'), w('d', 'p2', 'Semis', '2025-10-15'),
      w('e', 'p3', 'Semis', '2025-04-20'),
      ...extra
    ]};
}

test('période habituelle : une médiane par campagne, campagne en cours exclue', () => {
  const cal = learnCalendar(farm([w('x', 'p1', 'Semis', '2026-08-02')]), {now: at('2026-10-05')});
  const ble = cal['ble tendre|semis'];
  assert.ok(ble, Object.keys(cal).join());
  assert.deepEqual([ble.from, ble.to, ble.median], [72, 78, 72]);
  assert.deepEqual(ble.campaigns, ['2023/24', '2024/25', '2025/26']);
  assert.equal(cal['mais grain|semis'], undefined, 'une seule campagne de maïs');
});

test('rappel une semaine avant la période, parcelles sans semis prévu regroupées', () => {
  const [row] = calendarDue(farm(), {now: at('2026-10-05')});
  assert.equal(row.id, 'habit-calendar-ble-tendre-semis-2026');
  assert.deepEqual(row.parcelIds, ['p1', 'p2']);
  assert.equal(row.ha, 20.5);
  assert.equal(row.late, false);
  assert.deepEqual([row.from, row.to], ['2026-10-12', '2026-10-18']);
  assert.match(row.message, /^Semis de Blé tendre fait d’habitude entre le 12 octobre et le 18 octobre \(campagnes 2023\/24, 2024\/25, 2025\/26\) : rien de prévu sur 2 parcelles \(Les Brosses, Le Clos\)\.$/);
  assert.deepEqual(calendarDue(farm(), {now: at('2026-10-04')}), [], 'trop tôt');
});

test('un semis prévu, en cours ou fait cette campagne retire la parcelle ; annulé ou supprimé, non', () => {
  const planned = w('n1', 'p1', 'semis', '', {status: 'À faire', plannedDate: '2026-10-14'});
  assert.deepEqual(calendarDue(farm([planned]), {now: at('2026-10-05')})[0].parcelIds, ['p2']);
  const both = [planned, w('n2', 'p2', 'Semis', '2026-10-03')];
  assert.deepEqual(calendarDue(farm(both), {now: at('2026-10-05')}), []);
  const ignored = [w('n3', 'p1', 'Semis', '2026-10-03', {status: 'Annulé'}), w('n4', 'p2', 'Semis', '2026-10-03', {deletedAt: 1})];
  assert.deepEqual(calendarDue(farm(ignored), {now: at('2026-10-05')})[0].parcelIds, ['p1', 'p2']);
});

test('culture de la campagne : la rotation prime sur la culture de la parcelle', () => {
  const state = farm();
  state.rotations = [{id: 'r1', parcelId: 'p3', campaignId: '2026/27', culture: 'Blé tendre'}, {id: 'r2', parcelId: 'p2', campaignId: '2026/27', culture: 'Colza'}];
  assert.deepEqual(calendarDue(state, {now: at('2026-10-05')})[0].parcelIds, ['p1', 'p3']);
});

test('en retard après la période, puis silence au-delà de 10 jours', () => {
  const [late] = calendarDue(farm(), {now: at('2026-10-25')});
  assert.equal(late.late, true);
  assert.equal(calendarDue(farm(), {now: at('2026-10-28')}).length, 1);
  assert.deepEqual(calendarDue(farm(), {now: at('2026-10-29')}), []);
});

test('dates trop dispersées : pas de période habituelle', () => {
  const state = farm();
  state.interventions = [w('a', 'p1', 'Semis', '2023-09-01'), w('b', 'p1', 'Semis', '2024-11-20')];
  assert.deepEqual(learnCalendar(state, {now: at('2026-10-05')}), {});
});

test('un travail qui suit d’habitude un autre est laissé au rappel « travail habituel non fait »', () => {
  const labours = [w('l1', 'p1', 'Labour', '2023-10-01'), w('l2', 'p1', 'Labour', '2024-10-08'), w('l3', 'p1', 'Labour', '2025-09-30')];
  const cal = learnCalendar(farm(labours), {now: at('2026-10-05')});
  assert.equal(cal['ble tendre|semis'], undefined);
  assert.ok(cal['ble tendre|labour']);
});

test('notification, puis carte « À décider » avec « Planifier » prérempli', () => {
  const today = '2026-10-05', now = at(today);
  const n = computeNotifications(farm(), {now, today}).find(r => r.id.startsWith('habit-calendar-'));
  assert.equal(n.level, 'info');
  assert.equal(n.title, 'Semis de saison à prévoir · Blé tendre');
  assert.deepEqual(n.action.payload, {parcelIds: ['p1', 'p2'], type: 'Semis', date: '2026-10-12'});
  const card = decisionFeed(farm(), {today, now, compliance: [], limit: 20}).find(d => d.id === n.id);
  assert.equal(card.action.type, 'plan-habit-work');
  assert.equal(card.action.label, 'Planifier');
  assert.equal(card.stakes.ha, 20.5);
  assert.equal(card.stakes.daysLeft, 13);
  const late = computeNotifications(farm(), {now: at('2026-10-25'), today: '2026-10-25'}).find(r => r.id.startsWith('habit-calendar-'));
  assert.equal(late.level, 'warning');
  assert.equal(late.action.payload.date, '2026-10-25', 'jamais une date passée');
  const off = farm();
  off.preferences = {...off.preferences, habitReminders: false};
  assert.equal(computeNotifications(off, {now, today}).some(r => r.id.startsWith('habit-calendar-')), false);
});

test('relecture : travail prévu avant le 1er août et fait après, compté comme fait', () => {
  const state = {...emptyState(), parcelles: [{id: 'A', nom: 'A', culture: 'Blé'}],
    interventions: [w('x1', 'A', 'Déchaumage', '2024-08-05'), w('x2', 'A', 'Déchaumage', '2025-08-06'), w('x3', 'A', 'Déchaumage', '2026-08-02', {plannedDate: '2026-07-30'})]};
  assert.deepEqual(calendarDue(state, {now: at('2026-08-05')}), []);
});

test('relecture : culture de la parcelle restée celle de la campagne passée, parcelle ignorée', () => {
  const state = farm();
  state.rotations = [{id: 'r1', parcelId: 'p1', campaignId: '2025/26', culture: 'Blé tendre'}];
  assert.deepEqual(calendarDue(state, {now: at('2026-10-05')})[0].parcelIds, ['p2'], 'p1 : fiche pas mise à jour depuis la récolte');
});

test('relecture : période à cheval sur le 1er août', () => {
  const state = {...emptyState(), parcelles: [{id: 'A', nom: 'A', culture: 'Orge'}],
    interventions: [w('m1', 'A', 'Moisson', '2023-07-29'), w('m2', 'A', 'Moisson', '2024-08-02')]};
  const cal = learnCalendar(state, {now: at('2026-07-20')});
  assert.ok(cal['orge|moisson'], 'appris malgré la coupure du 1er août');
  const due = calendarDue(state, {now: at('2026-07-25'), calendar: cal});
  assert.deepEqual([due[0].from, due[0].to], ['2026-07-29', '2026-08-02']);
  assert.equal(calendarDue(state, {now: at('2026-08-08'), calendar: cal})[0].late, true, 'retard suivi après le 1er août');
  assert.equal(calendarDue(state, {now: at('2026-08-13'), calendar: cal}).length, 0);
});

test('relecture : la cloche ouvre le travail de saison (entité dédiée)', () => {
  const n = computeNotifications(farm(), {now: at('2026-10-05'), today: '2026-10-05'}).find(r => r.id.startsWith('habit-calendar-'));
  assert.equal(n.entity, 'habitCalendar');
  assert.equal(n.entityId, n.id);
});
