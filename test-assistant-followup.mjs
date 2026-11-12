// Questions de suivi de l’assistant (assistant-followup.js) : « combien me doit Martin ? » puis « et Dupont ? ».
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {detectFollowUp, isFollowUpQuestion, rewriteFollowUp, parcelMention} from './assistant-followup.js';
import {answerLocalIntelligence} from './intelligence.js';

const TODAY = '2026-11-12';
function farm() {
  const s = emptyState();
  s.clients = [{id: 'c2', name: 'Jean Dupont'}, {id: 'c3', name: 'SCEA Martin'}, {id: 'c4', name: 'GAEC des Brosses'}];
  s.parcelles = [
    {id: 'p1', nom: 'Les Brosses', surfaceHa: 5, culture: 'Blé tendre'},
    {id: 'p2', nom: 'Le Grand Champ', surfaceHa: 8, culture: 'Maïs'},
    {id: 'p3', nom: 'La Noue', surfaceHa: 3, culture: 'Orge'}
  ];
  return s;
}
const ctx = {today: TODAY};
// Pose la première question, puis la relance avec la mémoire de session que tient app.js.
function chain(first, second, s = farm()) {
  const r1 = answerLocalIntelligence(first, s, ctx);
  return {r1, r2: answerLocalIntelligence(second, s, {...ctx, previous: {question: first, intent: r1.intent}})};
}

test('relances courtes reconnues', () => {
  for (const q of ['et Dupont ?', 'Et pour Dupont ?', 'et demain ?', 'et le mois dernier ?', 'et au Grand Champ ?', 'même chose pour La Noue', 'pareil pour Martin', 'et cette année ?', 'et pour hier'])
    assert.ok(detectFollowUp(q), q);
});

test('une question complète n’est pas une relance', () => {
  for (const q of ['combien me doit Dupont ?', 'et combien me doit Durand ?', 'et si je sème du colza ?', 'et quel temps demain ?', 'et alors ?', 'et merci', 'et puis-je traiter ?', 'quelles parcelles sont en retard ?', ''])
    assert.equal(isFollowUpQuestion(q), false, q);
});

test('détection du type : période ou entité', () => {
  assert.equal(detectFollowUp('et demain ?').kind, 'time');
  assert.equal(detectFollowUp('et le mois dernier ?').timeCategory, 'month');
  assert.equal(detectFollowUp('et l’année dernière ?').timeCategory, 'year');
  assert.equal(detectFollowUp('et Dupont ?').kind, 'entity');
  assert.equal(detectFollowUp('et Dupont ?').term, 'Dupont');
});

test('client : « combien me doit Martin ? » puis « et Dupont ? »', () => {
  const {r1, r2} = chain('combien me doit Martin ?', 'et Dupont ?');
  assert.equal(r1.intent, 'billing_client_balance');
  assert.equal(r2.intent, 'billing_client_balance');
  assert.equal(r2.followUp.question, 'combien me doit Jean Dupont ?');
  assert.match(r2.answer, /^\(compris : « combien me doit Jean Dupont \? »\)/);
  assert.match(r2.answer, /Jean Dupont/);
});

test('jour : « puis-je traiter les Brosses ? » puis « et demain ? »', () => {
  const {r2} = chain('puis-je traiter les Brosses ?', 'et demain ?');
  assert.equal(r2.followUp.question, 'puis-je traiter les Brosses demain ?');
  assert.equal(r2.intent, 'spray_window');
  assert.match(r2.answer, /demain/);
});

test('jour remplacé : « aujourd’hui » devient « demain »', () => {
  assert.equal(rewriteFollowUp('et demain ?', {question: 'Puis-je traiter aujourd’hui ?'}, farm()).question, 'Puis-je traiter demain ?');
});

test('période : « CA du mois » puis « et le mois dernier ? »', () => {
  const {r1, r2} = chain('CA du mois', 'et le mois dernier ?');
  assert.equal(r1.intent, 'billing_revenue');
  assert.equal(r2.followUp.question, 'CA du mois dernier');
  assert.equal(r2.intent, 'billing_revenue');
  assert.match(r2.answer, /octobre 2026/);
});

test('période d’une autre catégorie : « CA du mois » puis « et cette année ? »', () => {
  const {r2} = chain('CA du mois', 'et cette année ?');
  assert.equal(r2.followUp.question, 'CA cette année');
  assert.match(r2.answer, /1er janvier 2026/);
});

test('parcelle : « que semer après le blé aux Brosses » puis « et au Grand Champ ? »', () => {
  const {r1, r2} = chain('que semer après le blé aux Brosses', 'et au Grand Champ ?');
  assert.equal(r1.intent, 'next_crop');
  assert.equal(r2.followUp.question, 'que semer après le blé au Grand Champ');
  assert.equal(r2.intent, 'next_crop');
  assert.match(r2.answer, /Le Grand Champ/);
});

test('parcelle sans préposition : l’article contracté s’accorde (« aux Brosses » -> « au Grand Champ », « à la Noue »)', () => {
  const s = farm(), prev = {question: 'que semer après le blé aux Brosses', intent: 'next_crop'};
  assert.equal(rewriteFollowUp('et Grand Champ ?', prev, s).question, 'que semer après le blé au Grand Champ');
  assert.equal(rewriteFollowUp('même chose pour la Noue', prev, s).question, 'que semer après le blé à la Noue');
  assert.equal(rewriteFollowUp('et Noue ?', prev, s).question, 'que semer après le blé à la Noue');
});

test('parcelle citée avec son article : remplacement direct', () => {
  assert.equal(rewriteFollowUp('et La Noue ?', {question: 'puis-je traiter les Brosses ?'}, farm()).question, 'puis-je traiter La Noue ?');
});

test('nom à la fois client et parcelle : la question précédente décide', () => {
  const s = farm();
  // « Brosses » est un client (GAEC des Brosses) et une parcelle : après une question d’argent, c’est le client.
  assert.equal(rewriteFollowUp('et Brosses ?', {question: 'combien me doit Martin ?', intent: 'billing_client_balance'}, s).kind, 'client');
  assert.equal(rewriteFollowUp('et Grand Champ ?', {question: 'puis-je traiter les Brosses ?', intent: 'spray_window'}, s).kind, 'parcel');
});

test('relance enchaînée : la question reformulée sert de base à la suivante', () => {
  const s = farm();
  const r1 = answerLocalIntelligence('combien me doit Martin ?', s, ctx);
  const r2 = answerLocalIntelligence('et Dupont ?', s, {...ctx, previous: {question: 'combien me doit Martin ?', intent: r1.intent}});
  const r3 = answerLocalIntelligence('et Martin ?', s, {...ctx, previous: {question: r2.followUp.question, intent: r2.intent}});
  assert.equal(r3.followUp.question, 'combien me doit SCEA Martin ?');
});

test('élément inconnu : réponse claire, pas de chiffre inventé', () => {
  const {r2} = chain('combien me doit Martin ?', 'et Durand ?');
  assert.equal(r2.intent, 'followup_unresolved');
  assert.match(r2.answer, /Durand/);
  assert.doesNotMatch(r2.answer, /€/);
});

test('sans question précédente, une relance suit le chemin normal', () => {
  const r = answerLocalIntelligence('et Dupont ?', farm(), ctx);
  assert.equal(r.followUp, undefined);
  assert.notEqual(r.intent, 'followup_unresolved');
});

test('une question complète après une autre n’est pas reformulée', () => {
  const {r2} = chain('combien me doit Martin ?', 'combien me doit Dupont ?');
  assert.equal(r2.followUp, undefined);
  assert.equal(r2.intent, 'billing_client_balance');
});

test('parcelMention : nom complet ou sans article, le plus long gagne', () => {
  const s = farm();
  assert.equal(parcelMention('aux Brosses', s).parcel.id, 'p1');
  assert.equal(parcelMention('aux Brosses', s).bare, true);
  assert.equal(parcelMention('sur Le Grand Champ', s).bare, false);
  assert.equal(parcelMention('rien ici', s), null);
});

test('relance non résolue : la question nue est essayée avant d’abandonner', () => {
  const s = farm(), previous = {question: 'Résume ma journée', intent: 'daily_summary'};
  for (const q of ['et les stocks faibles ?', 'et les tâches en retard ?', 'et l’assolement ?']) {
    const r = answerLocalIntelligence(q, s, {...ctx, previous});
    assert.equal(r.recognized, true, q);
    assert.notEqual(r.intent, 'followup_unresolved', q);
  }
  // Rien de reconnu : non « reconnue », pour laisser passer l’assistant distant et le repli.
  const r = answerLocalIntelligence('et Durand ?', s, {...ctx, previous});
  assert.equal(r.recognized, false);
  assert.equal(r.intent, 'followup_unresolved');
});

test('préposition accordée même quand l’ancien nom n’avait pas d’article', () => {
  const s = farm();
  s.parcelles.push({id: 'p4', nom: 'Bois Joli', surfaceHa: 2});
  assert.equal(rewriteFollowUp('et Les Brosses ?', {question: 'Quels travaux au Bois Joli ?'}, s).question, 'Quels travaux aux Brosses ?');
  assert.equal(rewriteFollowUp('et Le Grand Champ ?', {question: 'Le rendement de Bois Joli ?'}, s).question, 'Le rendement du Grand Champ ?');
});
