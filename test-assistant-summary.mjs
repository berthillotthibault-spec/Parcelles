// Résumé local joint aux questions de l'assistant distant (assistant-summary.js, remote-ai.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {farmSummary, SUMMARY_MAX_CHARS} from './assistant-summary.js';
import {buildRemoteRequest} from './remote-ai.js';

function farm(n = 3) {
  const s = emptyState();
  s.exploitation.nom = 'Ferme fictive';
  s.parcelles = Array.from({length: n}, (_, i) => ({id: `p${i}`, nom: `Parcelle ${i}`, culture: i % 2 ? 'Colza' : 'Blé tendre', surfaceHa: 2 + i}));
  s.interventions = [{id: 'w1', parcelId: 'p0', type: 'Désherbage', status: 'À faire', plannedDate: '2026-11-01'}];
  return s;
}
const decisions = [{title: 'Déplacer le lot : Le Pré', level: 'urgent', stakes: {daysLeft: 1}, why: ['Herbe épuisée dans 1 jour.', 'Repousse insuffisante.', 'Troisième raison.']}];

test('contenu : décisions, retards, IFT, conformité, parcelles avec stade', () => {
  const phenologyFor = p => p.id === 'p1' ? {status: 'ok', stage: {name: 'Rosette'}, next: {name: 'Floraison'}, nextDate: '2027-03-20'} : {status: 'no-sowing'};
  const s = farmSummary(farm(), {today: '2026-11-14', decisions, phenologyFor});
  assert.equal(s.campaign, '2026/27');
  assert.deepEqual(s.decisions, [{title: 'Déplacer le lot : Le Pré', level: 'urgent', daysLeft: 1, why: ['Herbe épuisée dans 1 jour.', 'Repousse insuffisante.']}]);
  assert.equal(s.agenda.overdueWorks, 1);
  assert.deepEqual(s.agenda.next, {what: 'Désherbage', parcel: 'Parcelle 0', date: '2026-11-01', overdue: true});
  assert.equal(typeof s.ift.total, 'number');
  assert.ok(['ok', 'warn', 'ko'].includes(s.compliance.status));
  assert.deepEqual(s.parcels.map(p => p.name), ['Parcelle 2', 'Parcelle 1', 'Parcelle 0'], 'plus grandes en tête');
  assert.deepEqual(s.parcels[1], {name: 'Parcelle 1', culture: 'Colza', ha: 3, stage: 'Rosette', next: 'Floraison vers le 2027-03-20'});
});

test('taille bornée : petites parcelles retirées et signalées', () => {
  const s = farmSummary(farm(300), {today: '2026-11-14', decisions});
  assert.ok(JSON.stringify(s).length <= SUMMARY_MAX_CHARS);
  assert.ok(s.parcelsOmitted > 0);
  assert.equal(s.parcels[0].name, 'Parcelle 299');
  assert.equal(s.decisions.length, 1, 'les décisions passent avant les parcelles');
});

test('robuste : estimation qui échoue, état vide', () => {
  const s = farmSummary(farm(), {today: '2026-11-14', phenologyFor: () => { throw new Error('x'); }});
  assert.equal(s.parcels.length, 3);
  assert.deepEqual(farmSummary(emptyState(), {today: '2026-11-14'}).parcels, []);
});

test('requête : le résumé part avec toute question, et il est anonymisé', () => {
  const state = farm(), summary = farmSummary(state, {today: '2026-11-14', decisions});
  const plain = buildRemoteRequest({question: 'Que dois-je faire cette semaine ?', state, context: {summary}});
  assert.equal(plain.body.context.summary.parcels.length, 3);
  assert.equal(buildRemoteRequest({question: 'Bonjour', state, context: {}}).body.context.summary, null);
  const anon = buildRemoteRequest({question: 'Et Parcelle 1 ?', state, context: {summary}, anonymize: true});
  assert.ok(!JSON.stringify(anon.body.context.summary).includes('Parcelle 1'), 'noms de parcelles remplacés');
});

test('anonymisation : nom long jamais tronqué, client de facturation jamais envoyé', () => {
  const state = farm(1);
  state.parcelles[0].nom = 'Grande pièce derrière la maison du Bas Moulin Martin';
  state.clients = [{id: 'c1', name: 'SCEA Dupont', deletedAt: 5}];
  const billing = [{kind: 'billing-remind', title: 'Relancer SCEA Dupont', why: ['SCEA Dupont : 2 factures'], level: 'warning', stakes: {eur: 1200, daysLeft: -20}}];
  const summary = farmSummary(state, {today: '2026-11-14', decisions: billing});
  assert.deepEqual(summary.decisions[0], {title: 'Relance de facture à faire', level: 'warning', daysLeft: -20, eur: 1200, why: []});
  const sent = JSON.stringify(buildRemoteRequest({question: 'Bonjour', state, context: {summary}, anonymize: true}).body);
  assert.ok(!sent.includes('Grande pièce') && !sent.includes('Dupont'), sent.slice(0, 400));
  // Client supprimé : son nom reste anonymisé partout ailleurs (question comprise).
  assert.ok(!JSON.stringify(buildRemoteRequest({question: 'Et SCEA Dupont ?', state, context: {}, anonymize: true}).body).includes('Dupont'));
});

test('rendement probable joint aux parcelles quand il est connu', () => {
  const s = farmSummary(farm(2), {today: '2026-11-14', yieldFor: p => p.id === 'p1' ? {status: 'estime', tPerHa: 3.4, low: 2.9, high: 3.9} : {status: 'inconnu'}});
  assert.deepEqual(s.parcels.find(p => p.name === 'Parcelle 1').yield, {tPerHa: 3.4, low: 2.9, high: 3.9, status: 'estime'});
  assert.equal(s.parcels.find(p => p.name === 'Parcelle 0').yield, undefined);
});
