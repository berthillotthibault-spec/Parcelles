import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {forageBalance} from './forage.js';
import {fromForage, fromGrassShortfall, decisionFeed, DECISION_ACTIONS} from './decision-feed.js';
import {grassShortfall, estimateGrassGrowth} from './grass-growth.js';

const TODAY = '2026-12-01';
const balance = extra => ({settings: {configured: true, start: '2026-11-15', end: '2027-03-31', lossPct: 10}, daily: 0.5, available: 30, coversAll: false, coveredUntil: '2027-01-30', missing: 30, ...extra});

test('fourrage : carte seulement si l’hivernage est paramétré et le stock court', () => {
  assert.equal(fromForage(null), null);
  assert.equal(fromForage(balance({coversAll: true})), null);
  assert.equal(fromForage(balance({settings: {configured: false, start: '2026-11-15', end: '2027-03-31', lossPct: 10}})), null);
  assert.equal(fromForage(balance({daily: 0})), null);
  const d = fromForage(balance(), {today: TODAY});
  assert.equal(d.id, 'forage-shortfall-2026');
  assert.equal(d.title, 'Fourrage : stock couvert jusqu’au 30 janvier, il manque 30 t MS');
  assert.equal(d.level, 'info');
  assert.equal(d.stakes.daysLeft, 60);
  assert.deepEqual(d.action, {type: 'open-forage', label: 'Bilan fourrager', id: '', payload: null});
  assert.ok(DECISION_ACTIONS.includes('open-forage'));
  assert.match(d.why[0], /30 t MS pour 0,5 t MS\/j .* 31 mars .* 10 %/);
});

test('fourrage : gravité selon la date de rupture, stock nul', () => {
  assert.equal(fromForage(balance({coveredUntil: '2026-12-20'}), {today: TODAY}).level, 'warning');
  assert.equal(fromForage(balance({coveredUntil: '2026-12-05'}), {today: TODAY}).level, 'urgent');
  assert.match(fromForage(balance({available: 0, coveredUntil: TODAY}), {today: TODAY}).title, /^Fourrage : aucun stock disponible, il manque/);
});

test('fourrage : bilan réel sans stock, carte urgente dans le fil', () => {
  const state = {...emptyState()};
  state.preferences = {...state.preferences, forageWinter: {start: '2026-11-15', end: '2027-03-31', lots: [{category: 'vache-allaitante', heads: 20, kgMsDay: 14}]}};
  const b = forageBalance(state, {today: TODAY});
  const rows = decisionFeed(state, {today: TODAY, now: Date.UTC(2026, 11, 1, 9), notifications: [], compliance: [], forage: b});
  const card = rows.find(r => r.kind === 'forage-shortfall');
  assert.ok(card, JSON.stringify(rows.map(r => r.id)));
  assert.equal(card.level, 'urgent');
});

const week = (tmin, tmax) => Array.from({length: 7}, (_, i) => ({date: `2026-07-${String(5 + i).padStart(2, '0')}`, tmin, tmax}));
function pasture(count = 40) {
  return {...emptyState(), parcelles: [{id: 'p1', nom: 'Le Pré', culture: 'Prairie permanente', surfaceHa: 10}, {id: 'p2', nom: 'Blé', culture: 'Blé tendre', surfaceHa: 20}],
    grazingSessions: [{id: 'g1', parcelId: 'p1', startDate: '2026-07-01', count, animalType: 'Vaches allaitantes'}]};
}

test('herbe : pousse d’été sèche face à 40 animaux au pré, alerte « affourager »', () => {
  const growth = estimateGrassGrowth({today: '2026-07-12', days: week(14, 26), waterFraction: 0.2});
  const g = grassShortfall(pasture(), growth, {today: '2026-07-12'});
  assert.ok(g, `pousse ${growth.kgMsHaDay}`);
  assert.equal(g.grassHa, 10, 'seules les prairies comptent');
  assert.equal(g.need, 600);
  assert.ok(g.offer < 480);
  const d = fromGrassShortfall(g, {today: '2026-07-12'});
  assert.equal(d.id, 'grass-shortfall-2026');
  assert.equal(d.action.type, 'open-grazing');
  assert.match(d.why[0], /600 kg MS\/j pour 40 UGB au pré/);
  assert.ok(d.why.some(w => /1 UGB par animal/.test(w)));
});

test('herbe : assez de pousse, pas de lot au pré ou pas d’estimation, aucune alerte', () => {
  const spring = estimateGrassGrowth({today: '2026-05-12', days: week(8, 18).map((d, i) => ({...d, date: `2026-05-${String(5 + i).padStart(2, '0')}`})), waterFraction: 0.8});
  assert.equal(grassShortfall(pasture(), spring, {today: '2026-05-12'}), null);
  assert.equal(grassShortfall({...pasture(), grazingSessions: []}, spring, {today: '2026-05-12'}), null);
  assert.equal(grassShortfall(pasture(), null, {today: '2026-05-12'}), null);
  assert.equal(fromGrassShortfall(null), null);
});

test('relecture : hors saison de pâturage (novembre à février), pas d’alerte herbe', () => {
  const growth = {kgMsHaDay: 0, note: 'x'};
  assert.equal(grassShortfall({...pasture(), grazingSessions: [{id: 'g1', parcelId: 'p1', startDate: '2026-11-01', count: 30, animalType: 'Vaches'}]}, growth, {today: '2026-12-08'}), null);
  assert.ok(grassShortfall(pasture(), growth, {today: '2026-07-12'}), 'en été, même pousse nulle : alerte');
});

test('relecture : pré occupé sans surface, pas de conclusion', () => {
  const state = pasture();
  state.parcelles = [...state.parcelles, {id: 'p3', nom: 'Sans surface', culture: 'Prairie'}];
  state.grazingSessions = [...state.grazingSessions, {id: 'g2', parcelId: 'p3', startDate: '2026-07-01', count: 15, animalType: 'Vaches'}];
  assert.equal(grassShortfall(state, {kgMsHaDay: 5, note: 'x'}, {today: '2026-07-12'}), null);
});

test('relecture : un inventaire de l’hiver précédent ne sert plus de base au stock', () => {
  const state = {...emptyState()};
  state.preferences = {...state.preferences, forageWinter: {start: '2026-11-15', end: '2027-03-31', lots: [{category: 'other', heads: 30, kgMsDay: 13}]}};
  const inv = (id, date) => ({id, farmKind: 'forage', entry: 'inventory', date, tms: 30, type: 'foin', mode: 'tonnes'});
  state.integrationImports = [inv('i1', '2026-02-15')];
  assert.equal(forageBalance(state, {today: '2026-12-01'}).inventory, null, 'inventaire de l’hiver 2025/26 écarté');
  state.integrationImports = [inv('i1', '2026-02-15'), inv('i2', '2026-10-01')];
  assert.equal(forageBalance(state, {today: '2026-12-01'}).inventory?.id, 'i2', 'inventaire d’automne retenu');
});
