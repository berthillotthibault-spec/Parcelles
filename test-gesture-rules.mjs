import test from 'node:test';
import assert from 'node:assert/strict';
import {detectGestures, dismissGesture, gestureKey, gestureReason, gestureRule, isCovered, GESTURE_PREF} from './gesture-rules.js';
import {evaluateAutomationRules} from './automations.js';

const ms = iso => new Date(`${iso}T09:00:00`).getTime();
// Données fictives : « Moisson » puis tâche « Déchaumage » créée 2 jours après, échéance J+3.
function farm({years = ['2024', '2025'], parcels = ['p1', 'p2'], extraMoisson = 0} = {}) {
  const interventions = [], tasks = [];
  let n = 0;
  for (const y of years) for (const p of parcels) {
    n += 1;
    interventions.push({id: `w${n}`, type: 'Moisson', status: 'Terminé', parcelId: p, date: `${y}-07-1${n % 9}`, createdAt: ms(`${y}-07-1${n % 9}`)});
    tasks.push({id: `t${n}`, title: 'Déchaumage', status: 'À faire', parcelId: p, createdAt: ms(`${y}-07-2${n % 9}`) - 8 * 86400000, dueDate: ''});
  }
  for (let i = 0; i < extraMoisson; i++) interventions.push({id: `x${i}`, type: 'Moisson', status: 'Terminée', parcelId: 'p9', date: '2025-08-01'});
  return {interventions, tasks, automationRules: [], preferences: {}};
}

test('détecte un enchaînement répété sur 2 campagnes et explique pourquoi', () => {
  const list = detectGestures(farm());
  assert.equal(list.length, 1);
  const g = list[0];
  assert.equal(g.from, 'Moisson'); assert.equal(g.to, 'Déchaumage');
  assert.equal(g.occurrences, 4); assert.equal(g.total, 4); assert.deepEqual(g.campaigns, ['2023/24', '2024/25']);
  assert.equal(g.dueOffsetDays, 2);
  assert.match(gestureReason(g), /4 des 4 « Moisson »/);
  assert.match(gestureReason(g), /2 campagnes/);
});

test('ignore sous le seuil : une seule campagne, trop peu de fois, ratio faible', () => {
  assert.equal(detectGestures(farm({years: ['2025'], parcels: ['p1', 'p2', 'p3', 'p4']})).length, 0);
  assert.equal(detectGestures(farm({parcels: ['p1']})).length, 0);
  assert.equal(detectGestures(farm({extraMoisson: 6})).length, 0);
});

test('ignore les tâches créées par une automatisation, annulées ou hors fenêtre', () => {
  const s = farm();
  s.tasks.forEach(t => { t.source = 'automation'; });
  assert.equal(detectGestures(s).length, 0);
  const c = farm(); c.tasks.forEach(t => { t.status = 'Annulée'; });
  assert.equal(detectGestures(c).length, 0);
  const late = farm(); late.tasks.forEach(t => { t.createdAt += 30 * 86400000; });
  assert.equal(detectGestures(late).length, 0);
});

test('« Non merci » et règle existante masquent la proposition', () => {
  const s = farm(), key = gestureKey('Moisson', 'Déchaumage');
  s.preferences[GESTURE_PREF] = dismissGesture({}, key);
  assert.equal(detectGestures(s).length, 0);
  const r = farm();
  r.automationRules.push({id: 'a1', target: 'interventions', conditions: [{field: 'type', operator: 'eq', value: 'moisson'}], actions: [{type: 'create_task'}]});
  assert.equal(isCovered(r.automationRules, 'Moisson', 'Déchaumage'), true);
  assert.equal(detectGestures(r).length, 0);
  r.automationRules[0].deletedAt = 1;
  assert.equal(detectGestures(r).length, 1);
  assert.deepEqual(dismissGesture({[GESTURE_PREF]: [key]}, key), [key]);
});

test('la règle proposée reproduit le geste avec le moteur existant', () => {
  const g = detectGestures(farm())[0], rule = gestureRule(g);
  assert.equal(rule.gestureKey, g.key); assert.equal(rule.enabled, true);
  assert.equal(isCovered([rule], 'Moisson', 'Déchaumage'), true);
  const now = ms('2026-07-15');
  const state = {interventions: [
    {id: 'n1', type: 'Moisson', status: 'Terminée', parcelId: 'p1', date: '2026-07-15'},
    {id: 'n2', type: 'Moisson', status: 'Terminé', parcelId: 'p2', date: '2026-07-01'},
    {id: 'n3', type: 'Moisson', status: 'Planifié', parcelId: 'p3', date: '2026-07-15'}
  ], automationRules: [rule]};
  const results = evaluateAutomationRules(state, now, {event: {entity: 'interventions'}});
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].matches.map(m => m.entityId), ['n1']);
  assert.equal(results[0].rule.actions[0].type, 'create_task');
  assert.equal(results[0].rule.actions[0].dueOffsetDays, 2);
});

test('une même tâche suivant deux passages rapprochés de A ne compte qu’une fois', () => {
  const s = {automationRules: [], preferences: {}, interventions: [], tasks: []};
  for (const y of ['2024', '2025']) {
    for (const d of ['10', '12']) s.interventions.push({id: `w${y}${d}`, type: 'Moisson', status: 'Terminé', parcelId: 'p1', date: `${y}-07-${d}`});
    s.tasks.push({id: `t${y}`, title: 'Déchaumage', status: 'À faire', parcelId: 'p1', createdAt: ms(`${y}-07-14`), dueDate: `${y}-07-15`});
  }
  // 2 tâches réelles seulement : pas 4 occurrences, donc sous le seuil de 3.
  assert.equal(detectGestures(s).length, 0);
});

test('un horodatage de création juste après minuit compte pour le jour local', () => {
  const s = farm();
  // Tâches créées à 00 h 30 locale le jour même de la moisson : l'écart doit être 0, pas -1 (veille UTC).
  s.tasks.forEach((t, i) => { const d = s.interventions[i].date; t.createdAt = new Date(`${d}T00:30:00`).getTime(); t.dueDate = d; });
  const g = detectGestures(s)[0];
  assert.ok(g); assert.equal(g.occurrences, 4); assert.equal(g.dueOffsetDays, 0);
});
