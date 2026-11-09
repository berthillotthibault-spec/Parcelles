// Assistant local (intelligence.js) : questions suggérées, retards, pâturage, stocks et écritures préparées.
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerLocalIntelligence, buildActivityBrief, parseVoiceJournal} from './intelligence.js';
import {isoDate} from './utils.js';

const day = offset => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return isoDate(d); };
const state = () => ({
  parcelles: [
    {id: 'p1', nom: 'Les Noues', surfaceHa: 11.3, culture: 'Blé tendre', commune: 'Montrevel'},
    {id: 'p2', nom: 'La Côte', surfaceHa: 6, culture: 'Maïs'},
    {id: 'p3', nom: 'Le Pré Bas', surfaceHa: 4.2, culture: 'Prairie permanente'},
    {id: 'p4', nom: 'Le Grand Pré', surfaceHa: 8, culture: 'Prairie temporaire'}
  ],
  interventions: [
    {id: 'w1', parcelId: 'p2', type: 'Désherbage', status: 'À faire', plannedDate: day(-3), date: day(-3)},
    {id: 'w2', parcelId: 'p1', type: 'Semis', status: 'Terminé', date: day(-20)}
  ],
  grazingSessions: [
    {id: 'g1', parcelId: 'p3', animalType: 'Vaches', animalsCount: 24, startDate: day(-18)},
    {id: 'g0', parcelId: 'p4', animalType: 'Génisses', animalsCount: 9, startDate: day(-70), endDate: day(-40)}
  ],
  stockItems: [{id: 's1', name: 'Semences blé', category: 'Semences', quantity: 350, unit: 'kg'}],
  tasks: [], observations: [], materiels: [], chantiers: []
});
const ask = q => answerLocalIntelligence(q, state(), {});

test('chaque question suggérée par l’assistant obtient une réponse', () => {
  for (const q of ['Quelles parcelles sont en retard ?', 'Où sont les animaux ?', 'Surface en céréales ?', 'stocks faibles', 'Résume ma journée', 'Quelles observations urgentes, stocks faibles, tâches en retard et entretiens proches dois-je surveiller ?']) {
    assert.equal(ask(q).recognized, true, q);
  }
});

test('« une fauche » donne le type « fauche » et non « e fauche »', () => {
  const r = ask('ajoute une fauche sur Le Pré Bas');
  assert.equal(r.intent, 'create_work');
  assert.equal(r.actions[0].payload.type, 'fauche');
  assert.equal(ask('ajoute un broyage sur Le Pré Bas').actions[0].payload.type, 'broyage');
});

test('« planifie une fauche sur <parcelle> demain » prépare un travail, l’organisation reste un plan', () => {
  const r = ask('planifie une fauche sur Le Pré Bas demain');
  assert.equal(r.intent, 'create_work');
  assert.deepEqual(r.actions[0].payload, {parcelId: 'p3', type: 'fauche', date: isoDate(Date.now() + 86400000), status: 'À faire'});
  assert.equal(ask('organise les travaux de demain').intent, 'supervised_plan');
});

test('retards, lots au pré et céréales', () => {
  const late = ask('Quelles parcelles sont en retard ?');
  assert.equal(late.intent, 'overdue_works');
  assert.match(late.answer, /1 travail en retard : Désherbage — La Côte/);
  const herd = ask('Où sont les animaux ?');
  assert.equal(herd.intent, 'grazing_current');
  assert.match(herd.answer, /1 lot au pré : Vaches — Le Pré Bas \(24\)/);
  const cereal = ask('Surface en céréales ?');
  assert.equal(cereal.intent, 'cereal_area');
  assert.match(cereal.answer, /17,3 ha de céréales sur 2 parcelles/);
});

test('résumé du jour et alertes terrain citent le travail en retard, au bon pluriel', () => {
  const brief = buildActivityBrief(state());
  assert.match(brief.answer, /^0 travail aujourd’hui/);
  assert.match(brief.answer, /1 travail en retard/);
  assert.equal(brief.actions[0].payload.workId, 'w1');
  const alerts = ask('Quelles observations urgentes, stocks faibles, tâches en retard et entretiens proches dois-je surveiller ?');
  assert.equal(alerts.intent, 'terrain_alerts');
  assert.match(alerts.answer, /1 travail en retard/);
  assert.equal(alerts.actions[0].payload.workId, 'w1');
});

test('« quel est le stock de X » donne la quantité, « stocks faibles » les articles sous seuil', () => {
  const r = ask('Quel est le stock de semences ?');
  assert.equal(r.intent, 'stock_quantity');
  assert.match(r.answer, /Semences blé : 350 kg/);
  assert.equal(ask('Quel est le stock de fioul ?').answer, 'Aucun article de stock ne correspond à « fioul ».');
  assert.equal(ask('stocks faibles').intent, 'low_stock');
});

test('une mise au pré n’est pas un travail', () => {
  const r = ask('enregistre 12 vaches au pré sur Le Grand Pré');
  assert.equal(r.intent, 'grazing_entry');
  assert.equal(r.actions[0].type, 'open_grazing');
  assert.deepEqual(r.actions[0].payload.parcelIds, ['p4']);
  assert.equal(parseVoiceJournal('enregistre 12 vaches au pré sur Le Grand Pré', state()).draft.type, '');
});

test('journal vocal : « fini le broyage », « fini le traitement » donnent un brouillon', () => {
  assert.equal(parseVoiceJournal('fini le broyage sur Les Noues', state()).draft.type, 'Broyage');
  const t = parseVoiceJournal('fini le traitement fongicide sur Les Noues 1,2 L/ha', state()).draft;
  assert.equal(t.type, 'Pulvérisation');
  assert.equal(t.status, 'Terminé');
  assert.equal(parseVoiceJournal('fini le semis sur Les Noues', state()).draft.type, 'Semis');
});
