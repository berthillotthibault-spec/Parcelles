import test from 'node:test';
import assert from 'node:assert/strict';
import {answerQuery, parseQuery, parsePeriod, findParcels, queryCsv, querySuggestions, appliedQuantity} from './query-engine.js';

const NOW = Date.parse('2026-10-08T10:00:00');
const state = {
  parcelles: [
    {id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10},
    {id: 'p2', nom: 'Grand Champ', culture: 'Maïs grain', surfaceHa: 8},
    {id: 'p3', nom: 'Le Pré Bas', culture: 'Prairie permanente', surfaceHa: 4},
    {id: 'p4', nom: 'La Côte', culture: 'Blé tendre', surfaceHa: 6},
  ],
  materiels: [{id: 'm1', nom: 'Tracteur'}, {id: 'm2', nom: 'Moissonneuse'}],
  interventions: [
    {id: 'f1', parcelId: 'p1', type: 'Fertilisation', product: 'Ammonitrate', dose: 200, doseUnit: 'kg/ha', date: '2026-09-20', status: 'Terminé'},
    {id: 'f2', parcelId: 'p4', type: 'Fertilisation', product: 'Ammonitrate', dose: 1.5, doseUnit: 'q/ha', surfaceWorked: 5, date: '2026-09-22', status: 'Terminé'},
    {id: 'f3', parcelId: 'p4', type: 'Fertilisation', product: 'Solution N', date: '2026-09-25', status: 'Terminé'},
    {id: 'f4', parcelId: 'p1', type: 'Épandage lisier', dose: 20, doseUnit: 'm³/ha', date: '2026-09-28', status: 'Terminé'},
    {id: 'f5', parcelId: 'p1', type: 'Fertilisation', dose: 100, doseUnit: 'kg/ha', plannedDate: '2026-10-20', status: 'À faire'},
    {id: 'f6', parcelId: 'p2', type: 'Fertilisation', dose: 100, doseUnit: 'kg/ha', date: '2026-09-21', status: 'Terminé'},
    {id: 'f0', parcelId: 'p1', type: 'Fertilisation', dose: 100, doseUnit: 'kg/ha', date: '2025-09-21', status: 'Terminé'},
    {id: 'h1', parcelId: 'p3', type: 'Fauche', date: '2025-06-12', status: 'Terminé'},
    {id: 'h2', parcelId: 'p3', type: 'Fauche', date: '2025-09-03', status: 'Terminé'},
    {id: 'h3', parcelId: 'p3', type: 'Fauche', date: '2026-06-01', status: 'Terminé'},
    {id: 't1', parcelId: 'p1', type: 'Semis blé', equipmentId: 'm1', duration: 3.5, date: '2026-09-10', status: 'Terminé', cost: 120},
    {id: 't2', parcelId: 'p2', type: 'Labour', equipmentId: 'm1', duration: 4, date: '2026-09-15', status: 'Terminé', cost: 200},
    {id: 't3', parcelId: 'p2', type: 'Labour', equipmentId: 'm1', date: '2026-09-16', status: 'Terminé'},
    {id: 't4', parcelId: 'p2', type: 'Récolte', equipmentId: 'm2', duration: 6, date: '2026-09-18', status: 'Terminé'},
    {id: 't5', parcelId: 'p1', type: 'Labour', equipmentId: 'm1', duration: 9, date: '2026-08-15', status: 'Terminé'},
    {id: 'd1', parcelId: 'p1', type: 'Désherbage', date: '2026-10-01', status: 'Terminé'},
    {id: 'd2', parcelId: 'p4', type: 'Désherbage', plannedDate: '2026-10-12', status: 'À faire'},
    {id: 'x1', parcelId: 'p2', type: 'Désherbage', date: '2026-10-02', status: 'Terminé', deletedAt: 1},
  ],
  grazingSessions: [{id: 'g1', parcelId: 'p3', startDate: '2026-09-01', endDate: '2026-09-10', animalsCount: 20}],
  stockItems: [{id: 's1', name: 'Ammonitrate', unit: 'kg', quantity: 500}],
  integrationImports: [{id: 'l1', farmKind: 'harvest', parcelId: 'p2', date: '2026-09-18', quantity: 85, unit: 't'}, {id: 'l2', farmKind: 'harvest', parcelId: 'p1', date: '2026-08-01', quantity: 700, unit: 'q'}],
};
const ask = q => answerQuery(q, state, {now: NOW});

test('azote sur le blé cette campagne : dose × surface, unités homogènes seulement', () => {
  const r = ask('Combien d’azote sur le blé cette campagne ?');
  assert.equal(r.recognized, true);
  assert.equal(r.query.filters.type.key, 'fertilisation');
  assert.equal(r.query.filters.culture.label, 'Blé tendre');
  assert.equal(r.query.period.label, 'campagne 2026/27');
  // f1 : 200 kg × 10 ha = 2000 ; f2 : 1,5 q × 5 ha = 750 kg ; f4 en m³ ; f3 sans dose ; f5 prévu ; f6 maïs ; f0 autre campagne.
  assert.equal(r.mixedUnits, true);
  assert.equal(r.value, 2750);
  assert.equal(r.unit, 'kg');
  assert.match(r.answer, /750 kg et 200 m³/);
  assert.match(r.answer, /non additionnées/);
  assert.match(r.recipe, /3 travaux de fertilisation terminés ; exclus : 1 sans dose/);
  assert.match(r.recipe, /q et t convertis en kg/);
  assert.ok(r.notes.some(n => /travail prévu non compté/.test(n)));
  assert.ok(r.notes.some(n => /pas les unités d’azote/.test(n)));
});

test('quand ai-je fauché le Pré du Bas l’an dernier : nom approché et année précédente', () => {
  const r = ask('Quand ai-je fauché le Pré du Bas l’an dernier ?');
  assert.equal(r.recognized, true);
  assert.deepEqual(r.query.filters.parcels.map(p => p.id), ['p3']);
  assert.equal(r.query.measure, 'dates');
  assert.deepEqual(r.rows.map(x => x[0]), ['2025-09-03', '2025-06-12']);
  assert.match(r.answer, /3 septembre 2025, 12 juin 2025/);
});

test('combien d’heures de tracteur en septembre : durées connues, manquantes exclues', () => {
  const r = ask('Combien d’heures de tracteur en septembre ?');
  assert.equal(r.recognized, true);
  assert.equal(r.query.period.from, '2026-09-01');
  assert.equal(r.value, 7.5);
  assert.equal(r.unit, 'h');
  assert.match(r.recipe, /1 travail sans durée exclu/);
});

test('quelles parcelles n’ont pas eu de désherbage : négation sur la campagne en cours', () => {
  const r = ask('Quelles parcelles n’ont pas eu de désherbage ?');
  assert.equal(r.recognized, true);
  assert.equal(r.query.negate, true);
  assert.deepEqual(r.rows.map(x => x[0]).sort(), ['Grand Champ', 'La Côte', 'Le Pré Bas']);
  assert.match(r.recipe, /campagne 2026\/27/);
});

test('regroupement par culture, coût et surface', () => {
  const cost = ask('Coût des labours par parcelle cette campagne');
  assert.equal(cost.value, 200);
  assert.equal(cost.unit, '€');
  const surf = ask('Surface de fertilisation par culture cette campagne ?');
  assert.equal(surf.query.groupBy, 'culture');
  assert.deepEqual(surf.rows.map(r => r[0]).sort(), ['Blé tendre', 'Maïs grain']);
  const ble = ask('Quelle surface en blé ?');
  assert.equal(ble.value, 16);
});

test('stock, pâturage et récoltes', () => {
  const s = ask('Combien d’ammonitrate en stock ?');
  assert.equal(s.query.entity, 'stock');
  assert.equal(s.value, 500);
  const g = ask('Combien de jours de pâturage sur le Pré Bas en septembre ?');
  assert.equal(g.query.entity, 'grazing');
  assert.equal(g.value, 10);
  const h = ask('Combien de tonnes récoltées cette campagne ?');
  assert.equal(h.query.entity, 'harvests');
  assert.equal(h.value, 155);
});

test('périodes : entre deux dates, mois nommé, campagne explicite', () => {
  assert.deepEqual(parsePeriod('entre le 1 mars et le 30 avril 2026', {now: NOW}), {from: '2026-03-01', to: '2026-04-30', label: 'du 2026-03-01 au 2026-04-30'});
  assert.equal(parsePeriod('du 01/09/2026 au 15/09/2026', {now: NOW}).to, '2026-09-15');
  assert.equal(parsePeriod('en novembre', {now: NOW}).from, '2025-11-01');
  assert.equal(parsePeriod('campagne 2025/26', {now: NOW}).from, '2025-08-01');
  assert.equal(parsePeriod('du maïs', {now: NOW}), null);
});

test('questions hors périmètre : repli sur l’assistant existant', () => {
  for (const q of ['Résume ma journée', 'Où sont les animaux ?', 'Surface en céréales ?', 'Quelles parcelles sont en retard ?', 'Qu’est-ce que je sème sur Les Noues ?', 'bonjour']) assert.equal(parseQuery(q, state, {now: NOW}).recognized, false, q);
});

test('outils : parcelle approchée, quantité appliquée, CSV et suggestions', () => {
  assert.equal(findParcels('les noue', state)[0].id, 'p1');
  assert.deepEqual(appliedQuantity({dose: 2, doseUnit: 't/ha', surfaceWorked: 3}, null), {amount: 6000, family: 'masse', unit: 'kg', converted: true});
  assert.equal(appliedQuantity({dose: 2, doseUnit: 'mm'}, {surfaceHa: 1}).reason, 'unité non surfacique');
  const csv = queryCsv(ask('Combien d’heures de tracteur en septembre ?'));
  assert.ok(csv.startsWith('﻿Parcelle;Heures;Travaux'));
  assert.match(csv, /Calcul;Somme/);
  const sugg = querySuggestions(state);
  assert.equal(sugg.length, 4);
  for (const q of sugg) assert.equal(parseQuery(q, state, {now: NOW}).recognized, true, q);
});
