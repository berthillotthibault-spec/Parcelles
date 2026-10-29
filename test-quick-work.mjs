import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedWorkTypes, typeBadge, doseConfig, parseDose, learnedDose, plannedToday, parcelChoices, parcelFilters,
  draftSummary, draftDate, buildQuickWorks, draftFields} from './quick-work.js';

const TODAY = '2026-10-28';
const parcels = [
  {id: 'p1', nom: 'Les Grands Champs', culture: 'Blé tendre', surfaceHa: 12.4},
  {id: 'p2', nom: 'Les Noues', culture: 'Colza', surfaceHa: 8.1, favorite: true},
  {id: 'p3', nom: 'Pré du Moulin', culture: 'Prairie permanente', surfaceHa: 5.6},
  {id: 'p4', nom: 'Archivée', culture: 'Maïs', surfaceHa: 3, archived: true}
];
const data = () => ({
  parcelles: parcels.map(p => ({...p})),
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Semis', status: 'Terminé', date: '2026-10-14', product: 'Rubisko', dose: 160, doseUnit: 'kg/ha'},
    {id: 'w2', parcelId: 'p2', type: 'Traitement', status: 'Terminé', date: '2026-10-21', product: 'Insecticide X', dose: '0,1', doseUnit: 'L/ha'},
    {id: 'w3', parcelId: 'p2', type: 'Traitement', status: 'Terminé', date: '2026-10-01', product: 'Insecticide X', dose: 0.2, doseUnit: 'L/ha'},
    {id: 'w4', parcelId: 'p1', type: 'Fongicide', status: 'À faire', date: '2026-10-28', plannedDate: '2026-10-28'},
    {id: 'w5', parcelId: 'p1', type: 'Récolte', status: 'Terminé', date: '2025-07-22'}
  ],
  tasks: [
    {id: 't1', title: 'Fongicide', parcelId: 'p2', dueDate: TODAY, status: 'À faire'},
    {id: 't2', title: 'Vérifier la levée', parcelId: 'p1', dueDate: TODAY, status: 'À faire'},
    {id: 't3', title: 'Désherbage', parcelId: 'p3', dueDate: '2026-11-02', status: 'À faire'}
  ],
  grazingSessions: [], materiels: [{id: 'm1', nom: 'Pulvé'}], templates: []
});

test('types : usage sur 90 jours d’abord, 8 tuiles, le reste derrière « Autre… »', () => {
  const {top, more} = orderedWorkTypes(data(), {today: TODAY});
  assert.equal(top.length, 8);
  assert.equal(top[0].type, 'Traitement');
  assert.ok(top.some(t => t.type === 'Observation') || more.some(t => t.type === 'Observation'));
  assert.deepEqual(typeBadge('Traitement'), {ab: 'Tr', family: 'spray'});
  assert.deepEqual(typeBadge('Observation'), {ab: 'Ob', family: 'other'});
  assert.equal(typeBadge('Pâturage').ab, 'Pâ');
});

test('dose selon le type, saisie avec virgule', () => {
  assert.deepEqual([doseConfig('Traitement').unit, doseConfig('Traitement').step, doseConfig('Traitement').digits], ['L/ha', 0.1, 1]);
  assert.equal(doseConfig('Semis').def, 160);
  assert.equal(doseConfig('Fertilisation').label, 'Engrais');
  assert.equal(doseConfig('Observation').none, true);
  assert.equal(parseDose('1,5'), 1.5);
  assert.equal(parseDose(''), null);
  assert.equal(parseDose('-2'), null);
});

test('dose apprise : dernière dose du produit, sinon du type', () => {
  assert.deepEqual(learnedDose(data(), {type: 'Traitement', product: 'insecticide x'}), {dose: 0.1, unit: 'L/ha', product: 'Insecticide X'});
  assert.equal(learnedDose(data(), {type: 'Semis'}).dose, 160);
  assert.equal(learnedDose(data(), {type: 'Traitement', product: 'Inconnu'}), null);
});

test('prévu aujourd’hui : travaux et tâches du même genre remontent en tête', () => {
  const planned = plannedToday(data(), {type: 'Traitement', today: TODAY});
  assert.deepEqual([...planned.parcelIds].sort(), ['p1', 'p2']);
  const list = parcelChoices(data(), {type: 'Traitement', today: TODAY});
  assert.deepEqual(list.map(r => r.parcel.id), ['p1', 'p2', 'p3']);
  assert.ok(list[0].planned && !list[2].planned);
  assert.deepEqual(parcelChoices(data(), {type: 'Traitement', today: TODAY, filter: 'pasture'}).map(r => r.parcel.id), ['p3']);
  assert.deepEqual(parcelChoices(data(), {type: 'Semis', today: TODAY, filter: 'favorites', selected: ['p1']}).map(r => r.parcel.id), ['p1', 'p2']);
  assert.deepEqual(parcelChoices(data(), {type: 'Semis', today: TODAY, query: 'moulin'}).map(r => r.parcel.id), ['p3']);
  assert.deepEqual(parcelFilters(data()).map(f => f.id), ['all', 'favorites', 'pasture', 'culture:Blé tendre', 'culture:Colza', 'culture:Prairie permanente']);
});

test('récapitulatif et dates', () => {
  assert.equal(draftSummary(data(), {type: 'Traitement', parcelIds: ['p1', 'p2']}), 'Traitement · 2 parcelles · 20,5 ha');
  assert.equal(draftSummary(data(), {type: 'Semis', parcelIds: []}), 'Semis');
  assert.equal(draftDate('yesterday', TODAY), '2026-10-27');
  assert.equal(draftDate('custom', TODAY, '2026-10-20'), '2026-10-20');
  assert.equal(draftDate('custom', TODAY, ''), TODAY);
});

test('enregistrement : prévu terminé, nouveau créé en lot, tâche cochée', () => {
  const draft = {type: 'Traitement', parcelIds: ['p1', 'p2', 'p3'], date: TODAY, product: 'Fongi Y', dose: 1, doseUnit: 'L/ha', equipmentId: 'm1'};
  const {creates, updates, tasks} = buildQuickWorks(draft, data(), {today: TODAY, batchId: 'batch_1'});
  assert.deepEqual(updates.map(w => [w.id, w.status, w.plannedDate, w.product, w.dose]), [['w4', 'Terminé', '2026-10-28', 'Fongi Y', 1]]);
  assert.deepEqual(creates.map(w => w.parcelId), ['p2', 'p3']);
  assert.ok(creates.every(w => w.batchId === 'batch_1' && w.status === 'Terminé' && w.isPhytosanitary && w.equipmentId === 'm1' && w.doseUnit === 'L/ha'));
  assert.equal(creates[0].surfaceWorked, 8.1);
  assert.deepEqual(tasks.map(t => [t.id, t.status]), [['t1', 'Terminé']]);
});

test('date future : travail à faire, aucune tâche cochée ; remarque sans dose', () => {
  const future = buildQuickWorks({type: 'Semis', parcelIds: ['p3'], date: '2026-11-03', dose: 150}, data(), {today: TODAY});
  assert.deepEqual([future.creates[0].status, future.creates[0].plannedDate, future.creates[0].dose], ['À faire', '2026-11-03', 150]);
  assert.equal(future.creates[0].batchId, undefined);
  assert.deepEqual(future.tasks, []);
  const obs = buildQuickWorks({type: 'Observation', parcelIds: ['p1'], date: TODAY, product: 'Levée régulière', dose: 3}, data(), {today: TODAY});
  assert.deepEqual([obs.creates[0].note, obs.creates[0].dose, obs.creates[0].product], ['Levée régulière', '', '']);
  assert.throws(() => buildQuickWorks({type: '', parcelIds: ['p1'], date: TODAY}, data(), {today: TODAY}), /type/);
  assert.throws(() => buildQuickWorks({type: 'Semis', parcelIds: [], date: TODAY}, data(), {today: TODAY}), /parcelle/);
});

test('brouillon : seulement des champs simples', () => {
  const fields = draftFields({type: 'Semis', parcelIds: ['p1'], step: 3, extra: () => 1});
  assert.deepEqual(Object.keys(fields).sort(), ['customDate', 'dateChoice', 'dose', 'doseUnit', 'equipmentId', 'note', 'parcelIds', 'product', 'step', 'type']);
  assert.equal(JSON.parse(JSON.stringify(fields)).step, 3);
});
