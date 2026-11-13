import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {decisionFeed} from './decision-feed.js';
import {recordFeedback, applyFeedback, normalizeFeedback, kindWeight, forgetDecision, unhideAll, laterDays, hiddenLabel, addDays, undoFeedback, alreadyRecorded, restoreHidden} from './decision-feedback.js';

const TODAY = '2026-11-12';
const row = (id, kind, level = 'warning', score = 10, daysLeft = null) => ({id, kind, level, score, why: ['Signalé.'], stakes: {ha: null, eur: null, daysLeft}});

test('addDays traverse les mois et les années', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('« Plus tard » : 1 jour si urgent ou échéance proche, 3 jours sinon', () => {
  assert.equal(laterDays(row('a', 'k', 'urgent')), 1);
  assert.equal(laterDays(row('a', 'k', 'info', 1, 2)), 1);
  assert.equal(laterDays(row('a', 'k', 'info', 1, -3)), 1);
  assert.equal(laterDays(row('a', 'k', 'info', 1, 10)), 3);
  assert.equal(laterDays(row('a', 'k', 'info')), 3);
  const fb = recordFeedback(null, row('a', 'stock', 'info', 1, 10), 'later', {today: TODAY});
  assert.equal(fb.items.a.until, '2026-11-15');
  assert.deepEqual(fb.kinds, {}, '« Plus tard » n’apprend rien sur le type');
});

test('une carte écartée est masquée jusqu’à son échéance, puis revient', () => {
  const fb = recordFeedback(null, row('stock-s1', 'stock'), 'no', {today: TODAY});
  assert.equal(fb.items['stock-s1'].until, '2026-11-26');
  const rows = [row('stock-s1', 'stock'), row('work-w1', 'work')];
  assert.deepEqual(applyFeedback(rows, fb, {today: TODAY}).rows.map(r => r.id), ['work-w1']);
  assert.equal(applyFeedback(rows, fb, {today: '2026-11-25'}).hidden, 1);
  assert.equal(applyFeedback(rows, fb, {today: '2026-11-26'}).hidden, 0);
});

test('une carte masquée revient si elle devient plus grave', () => {
  const fb = recordFeedback(null, row('stock-s1', 'stock', 'warning'), 'done', {today: TODAY});
  assert.equal(applyFeedback([row('stock-s1', 'stock', 'warning')], fb, {today: TODAY}).rows.length, 0);
  assert.equal(applyFeedback([row('stock-s1', 'stock', 'info')], fb, {today: TODAY}).rows.length, 0);
  const back = applyFeedback([row('stock-s1', 'stock', 'urgent')], fb, {today: TODAY});
  assert.equal(back.rows.length, 1);
  assert.equal(back.hidden, 0);
});

test('« Pas pertinent » répété abaisse le type, sauf alerte urgente', () => {
  let fb = null;
  fb = recordFeedback(fb, row('a', 'cost-drift'), 'no', {today: TODAY});
  assert.equal(kindWeight(fb, 'cost-drift', 'warning', {today: TODAY}).factor, 1, 'un seul refus ne suffit pas');
  fb = recordFeedback(fb, row('b', 'cost-drift'), 'no', {today: TODAY});
  assert.equal(kindWeight(fb, 'cost-drift', 'warning', {today: TODAY}).factor, 0.8);
  for (const id of ['c', 'd', 'e', 'f']) fb = recordFeedback(fb, row(id, 'cost-drift'), 'no', {today: TODAY});
  assert.equal(kindWeight(fb, 'cost-drift', 'warning', {today: TODAY}).factor, 0.4, 'plancher');
  assert.equal(kindWeight(fb, 'cost-drift', 'urgent', {today: TODAY}).factor, 1);
  const out = applyFeedback([row('x', 'cost-drift', 'warning', 10), row('y', 'work', 'warning', 6)], fb, {today: TODAY});
  assert.deepEqual(out.rows.map(r => r.id), ['y', 'x'], 'reclassé après abaissement');
  assert.equal(out.rows[1].score, 4);
  assert.match(out.rows[1].why.at(-1), /Rang abaissé .* 6 fois/);
});

test('« Fait » relève le type, plafonné à 1,3', () => {
  let fb = null;
  for (const id of ['a', 'b', 'c', 'd', 'e']) fb = recordFeedback(fb, row(id, 'stock'), 'done', {today: TODAY});
  assert.equal(kindWeight(fb, 'stock', 'info', {today: TODAY}).factor, 1.3);
  const [r] = applyFeedback([row('z', 'stock', 'info', 10)], fb, {today: TODAY}).rows;
  assert.equal(r.score, 13);
  assert.match(r.why.at(-1), /Rang relevé/);
});

test('les dates de plus de 90 jours sont oubliées', () => {
  let fb = null;
  fb = recordFeedback(fb, row('a', 'stock'), 'no', {today: '2026-07-01'});
  fb = recordFeedback(fb, row('b', 'stock'), 'no', {today: '2026-07-02'});
  assert.equal(kindWeight(fb, 'stock', 'info', {today: '2026-07-03'}).factor, 0.8);
  assert.equal(kindWeight(fb, 'stock', 'info', {today: TODAY}).factor, 1);
  assert.deepEqual(normalizeFeedback(fb, {today: TODAY}), {items: {}, kinds: {}});
});

test('valeurs corrompues ignorées, entrées invalides refusées', () => {
  assert.deepEqual(normalizeFeedback('n’importe quoi'), {items: {}, kinds: {}});
  assert.deepEqual(normalizeFeedback({items: {a: {verdict: 'zzz', until: '2027-01-01'}, b: null}, kinds: {k: {no: ['pas une date', 3]}}}, {today: TODAY}), {items: {}, kinds: {}});
  const rows = [row('a', 'k')];
  assert.equal(applyFeedback(rows, null, {today: TODAY}).rows, rows);
  assert.throws(() => recordFeedback(null, row('a', 'k'), 'peut-être', {today: TODAY}));
  assert.throws(() => recordFeedback(null, {}, 'no', {today: TODAY}));
});

test('Annuler une carte et tout réafficher conservent l’apprentissage', () => {
  let fb = recordFeedback(null, row('a', 'stock'), 'no', {today: TODAY});
  fb = recordFeedback(fb, row('b', 'stock'), 'no', {today: TODAY});
  assert.deepEqual(Object.keys(forgetDecision(fb, 'a', {today: TODAY}).items), ['b']);
  const all = unhideAll(fb, {today: TODAY});
  assert.deepEqual(all.items, {});
  assert.equal(all.kinds.stock.no.length, 2);
});

test('Annuler un verdict ne touche pas aux retours donnés entre-temps', () => {
  const a = row('a', 'stock'), b = row('b', 'stock');
  let fb = recordFeedback(null, a, 'no', {today: TODAY});
  fb = recordFeedback(fb, b, 'no', {today: TODAY});
  const undone = undoFeedback(fb, a, 'no', {today: TODAY});
  assert.deepEqual(Object.keys(undone.items), ['b']);
  assert.deepEqual(undone.kinds.stock.no, [TODAY]);
  assert.deepEqual(undoFeedback(undone, b, 'no', {today: TODAY}), {items: {}, kinds: {}});
});

test('double appui : le même verdict du jour est reconnu', () => {
  const fb = recordFeedback(null, row('a', 'stock'), 'no', {today: TODAY});
  assert.equal(alreadyRecorded(fb, 'a', 'no', {today: TODAY}), true);
  assert.equal(alreadyRecorded(fb, 'a', 'done', {today: TODAY}), false);
  assert.equal(alreadyRecorded(fb, 'b', 'no', {today: TODAY}), false);
});

test('Annuler le réaffichage remet les cartes d’avant sans écraser les nouvelles', () => {
  const before = recordFeedback(null, row('a', 'stock'), 'no', {today: TODAY});
  let fb = unhideAll(before, {today: TODAY});
  fb = recordFeedback(fb, row('b', 'work'), 'done', {today: TODAY});
  const restored = restoreHidden(fb, before, {today: TODAY});
  assert.deepEqual(Object.keys(restored.items).sort(), ['a', 'b']);
  assert.equal(restored.kinds.work.done.length, 1);
});

test('hiddenLabel', () => {
  assert.equal(hiddenLabel(1), '1 alerte masquée');
  assert.equal(hiddenLabel(3), '3 alertes masquées');
});

test('decisionFeed lit preferences.decisionFeedback, masque avant la limite et compte les cartes masquées', () => {
  const notifications = ['s1', 's2', 's3'].map(id => ({id: `stock-${id}`, level: 'warning', title: 'Stock faible', message: id, entity: 'stockItems', entityId: id}));
  const base = {...emptyState(), stockItems: [{id: 's1', name: 'A'}, {id: 's2', name: 'B'}, {id: 's3', name: 'C'}]};
  const opts = {today: TODAY, now: Date.UTC(2026, 10, 12, 9), notifications, compliance: [], limit: 2};
  assert.equal(decisionFeed(base, opts).length, 2);
  const fb = recordFeedback(null, {id: 'stock-s1', kind: 'stock', level: 'warning', stakes: {}}, 'no', {today: TODAY});
  const state = {...base, preferences: {...base.preferences, decisionFeedback: fb}};
  const stats = {};
  const rows = decisionFeed(state, {...opts, stats});
  assert.deepEqual(rows.map(r => r.id).sort(), ['stock-s2', 'stock-s3']);
  assert.equal(stats.hidden, 1);
  assert.equal(decisionFeed(state, {...opts, feedback: null}).length, 2, 'feedback: null ignore le retour');
});
