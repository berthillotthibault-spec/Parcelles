import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedWorkTypes, typeBadge, doseConfig, parseDose, learnedDose, plannedToday, parcelChoices, parcelFilters,
  draftSummary, draftDate, buildQuickWorks, draftFields, closingCandidates, plannedPrefill, doseSuggestion, quickWorksProblem, missingDose,
  hedgeBlock, assignWriteIds, writeQuickWorks, writesStarted, addRoutes, isObservationType, workFamily, prefillHolds,
  shareOut, harvestLotCode, nextCut, isForageFollowup, destructionModeFor, coversToDestroy, stockOutPreview, stockItemFor, harvestDarWarnings,
  productChoices, hoursBetween, nitrogenHint, billingProblem, dropForbidden, entryWorks, quickEffects, sowingWrites, dateNotice, fullFormLeftovers} from './quick-work.js';
import {requiredStock} from './work-effects.js';
import {darConflicts, registerRows} from './phyto.js';
import {campaignFor} from './utils.js';
import {typeFamily, isPhytoType} from './quick-entry.js';
import {isTreatment} from './phyto.js';
import {isSowingWork} from './seeds.js';
import {billableItems} from './invoices-core.js';
import {costCompletion} from './costs.js';
import {canMutate} from './permissions.js';
import {primaryTabs} from './nav-model.js';
import {guardBatchWorks, missingTreatmentProduct, staleKind, batchKindFields} from './work-form-ui.js';
import {readFileSync} from 'node:fs';

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
  // « Fongicide » (tâche sur p2) ne cite pas le type : plus de remontée d'office par le seul genre.
  assert.deepEqual([...planned.parcelIds].sort(), ['p1']);
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
  const draft = {type: 'Fongicide', parcelIds: ['p1', 'p2', 'p3'], date: TODAY, product: 'Fongi Y', dose: 1, doseUnit: 'L/ha', equipmentId: 'm1'};
  const {creates, updates, tasks} = buildQuickWorks(draft, data(), {today: TODAY, batchId: 'batch_1'});
  assert.deepEqual(updates.map(w => [w.id, w.status, w.plannedDate, w.product, w.dose]), [['w4', 'Terminé', '2026-10-28', 'Fongi Y', 1]]);
  assert.deepEqual(creates.map(w => w.parcelId), ['p2', 'p3']);
  assert.ok(creates.every(w => w.batchId === 'batch_1' && w.status === 'Terminé' && w.isPhytosanitary && w.equipmentId === 'm1' && w.doseUnit === 'L/ha'));
  assert.equal(creates[0].surfaceWorked, 8.1);
  // La tâche cite le type saisi : cochée.
  assert.deepEqual(tasks.map(t => [t.id, t.status]), [['t1', 'Terminé']]);
  // Même genre sans citer le type : proposé décoché, écrit seulement si l'utilisateur le coche.
  const loose = {...draft, type: 'Traitement'};
  assert.deepEqual(buildQuickWorks(loose, data(), {today: TODAY, batchId: 'batch_1'}).tasks, []);
  assert.deepEqual(buildQuickWorks(loose, data(), {today: TODAY, batchId: 'batch_1', include: ['t1']}).tasks.map(t => t.id), ['t1']);
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
  assert.deepEqual(Object.keys(fields).sort(), ['customDate', 'dateChoice', 'dose', 'doseTouched', 'doseUnit', 'equipmentId', 'include', 'kind', 'needReason', 'note', 'parcelIds', 'product',
    'reason', 'showTime', 'skip', 'startTime', 'step', 'type', 'unitTouched']);
  // L'heure et les détails de l'étape 3 survivent à la reprise (AT-M3, lot 3).
  const more = draftFields({type: 'Récolte', parcelIds: ['p1'], startTime: '08:30', details: {quantity: '42', fn: () => 1}});
  assert.equal(more.startTime, '08:30');
  assert.equal(more.details.quantity, '42');
  assert.equal('fn' in more.details, false);
  assert.equal(JSON.parse(JSON.stringify(fields)).step, 3);
  // Le prévu repris survit au brouillon : la reprise revérifie qu'il sera encore clôturé (prefillHolds).
  const kept = draftFields({type: 'Fongicide', parcelIds: ['p1'], prefill: {workId: 'w4', product: 'P', dose: 1, doseUnit: 'L/ha'}});
  assert.equal(kept.prefill.workId, 'w4');
  assert.equal(prefillHolds(data(), kept.prefill, {type: 'Fongicide', parcelIds: ['p1'], date: '2026-12-15', today: TODAY}), false);
});

test('clôture bornée : fenêtre de dates, autre produit, éléments écartés, campagne recalculée', async () => {
  const d = data();
  d.interventions.push({id: 'w6', parcelId: 'p3', type: 'Traitement', status: 'À faire', plannedDate: '2026-10-30', date: '2026-10-30', product: 'Herbi Z', note: 'côté bois', campaignId: '2025/26'});
  // date passée loin : rien n'est clôturé
  const far = buildQuickWorks({type: 'Traitement', parcelIds: ['p1', 'p2'], date: '2026-10-10'}, d, {today: TODAY});
  assert.equal(far.updates.length, 0);
  assert.equal(far.tasks.length, 0);
  // prévu dans 2 jours avec un autre produit : pas écrasé
  const other = buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: TODAY, product: 'Fongi Y'}, d, {today: TODAY});
  assert.deepEqual([other.updates.length, other.creates.length], [0, 1]);
  // même produit : clôturé, note gardée, campagne et culture recalculées, heure reprise
  const same = buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: TODAY, product: 'herbi z', note: 'vent nul', startTime: '07:30'}, d, {today: TODAY});
  assert.deepEqual([same.updates[0].id, same.updates[0].note, same.updates[0].campaignId, same.updates[0].culture, same.updates[0].startTime],
    ['w6', 'côté bois · vent nul', '2026/27', 'Prairie permanente', '07:30']);
  // écartés par l'utilisateur
  const skipped = buildQuickWorks({type: 'Fongicide', parcelIds: ['p1', 'p2'], date: TODAY}, d, {today: TODAY, skip: ['w4', 't1']});
  assert.deepEqual([skipped.updates.length, skipped.tasks.length, skipped.creates.length], [0, 0, 2]);
  assert.deepEqual(closingCandidates(d, {type: 'Traitement', parcelIds: ['p1'], date: '2026-11-02', today: TODAY}), {works: [], tasks: [], looseTasks: [], looseWorks: [], ignored: []});
});

// ---------- Lot 2 : écritures fausses ou dangereuses ----------
const planned = extra => { const d = data(); d.interventions.push(...extra); return d; };

test('Observation : tuile routée, exclue de la facturation et des coûts à la lecture', () => {
  assert.ok(isObservationType('observation ') && isObservationType('Observation') && !isObservationType('Observation levée'));
  const state = {parcelles: [{id: 'p', nom: 'A', clientId: 'c', surfaceHa: 10}], clients: [{id: 'c', nom: 'C'}], preferences: {},
    interventions: [{id: 'o', parcelId: 'p', type: 'Observation', status: 'Terminé', date: TODAY, surfaceWorked: 10},
      {id: 'f', parcelId: 'p', type: 'Fauche', status: 'Terminé', date: TODAY, surfaceWorked: 10}]};
  assert.deepEqual(billableItems(state, 'c').filter(i => i.kind === 'work').map(i => i.key), ['work:f']);
  assert.deepEqual(costCompletion(state).rows.map(r => r.work.id), ['f']);
});

test('dose : la suggestion n’est jamais écrite, la dose prévue n’est pas écrasée', () => {
  const semis = buildQuickWorks({type: 'Semis', parcelIds: ['p3'], date: TODAY, dose: null}, data(), {today: TODAY}).creates[0];
  assert.deepEqual([semis.dose, semis.doseUnit], ['', '']);
  assert.equal(missingDose({creates: [semis], updates: []}), true);
  assert.deepEqual(doseSuggestion(data(), {type: 'Semis'}), {value: 160, unit: 'kg/ha', learned: true, product: 'Rubisko'});
  assert.deepEqual(doseSuggestion({}, {type: 'Fertilisation'}), {value: 120, unit: 'kg/ha', learned: false, product: ''});
  assert.equal(doseSuggestion({}, {type: 'Broyage'}), null);
  const d = planned([{id: 'pv', parcelId: 'p3', type: 'Traitement', status: 'À faire', plannedDate: TODAY, date: TODAY, product: 'Elatus', dose: 0.75, doseUnit: 'L/ha', culture: 'Colza', surfaceWorked: 5}]);
  const kept = buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: TODAY, dose: null}, d, {today: TODAY}).updates[0];
  assert.deepEqual([kept.dose, kept.doseUnit, kept.product], [0.75, 'L/ha', 'Elatus']);
  assert.equal(missingDose({creates: [], updates: [kept]}), false);
  assert.deepEqual(plannedPrefill(d, {type: 'Traitement', parcelIds: ['p3'], date: TODAY, today: TODAY}), {workId: 'pv', product: 'Elatus', dose: 0.75, doseUnit: 'L/ha'});
  assert.equal(plannedPrefill(d, {type: 'Traitement', parcelIds: ['p3', 'p2'], date: TODAY, today: TODAY}), null);
  // AT-M1 : la culture prévue reste ; PF-11 : les mesures réalisées sont remplies à la clôture.
  assert.equal(kept.culture, 'Colza');
  assert.deepEqual(kept.actualMetrics, {areaHa: 5, dose: 0.75, duration: null});
});

test('produit obligatoire pour un traitement terminé, pas pour un travail prévu', () => {
  const done = buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: TODAY}, data(), {today: TODAY});
  assert.match(quickWorksProblem(done), /produit/);
  assert.equal(quickWorksProblem(buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: TODAY, product: 'X'}, data(), {today: TODAY})), '');
  assert.equal(quickWorksProblem(buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: '2026-11-03'}, data(), {today: TODAY})), '');
  assert.equal(quickWorksProblem(buildQuickWorks({type: 'Semis', parcelIds: ['p3'], date: TODAY}, data(), {today: TODAY})), '');
});

test('haies : période interdite bloquée, dérogation posée sur la fiche, remarque prise en compte', () => {
  const day = '2026-05-10';
  const d = data();
  const taille = () => buildQuickWorks({type: 'Taille haie', parcelIds: ['p3'], date: day}, d, {today: TODAY});
  const hit = hedgeBlock(taille(), d);
  assert.ok(hit.blocked && /BCAE 8/.test(hit.message));
  const result = taille();
  assert.equal(hedgeBlock(result, d, {derogation: true}).blocked, false);
  assert.equal(result.creates[0].hedgeDerogation, true);
  assert.ok(hedgeBlock(buildQuickWorks({type: 'Taille', parcelIds: ['p3'], date: day}, d, {today: TODAY}), d, {remark: 'la haie du bas'}).blocked);
  assert.equal(hedgeBlock(buildQuickWorks({type: 'Taille haie', parcelIds: ['p3'], date: '2026-10-10'}, d, {today: TODAY}), d).message, '');
});

test('rapprochement : seul le même type se clôture d’office (AT-M2, PF-10, PF-11)', () => {
  const d = planned([
    {id: 'b', parcelId: 'p3', type: 'Broyage', status: 'À faire', plannedDate: TODAY, date: TODAY},
    {id: 'v', parcelId: 'p2', type: 'Fauche', status: 'À faire', plannedDate: '2026-09-01', date: '2026-09-01'},
    {id: 'a1', parcelId: 'p1', type: 'Fauche', status: 'À faire', plannedDate: TODAY, date: TODAY},
    {id: 'a2', parcelId: 'p1', type: 'Fauche', status: 'À faire', plannedDate: '2026-10-27', date: '2026-10-27'}]);
  const c = closingCandidates(d, {type: 'Fauche', parcelIds: ['p1', 'p2', 'p3'], date: TODAY, today: TODAY});
  assert.deepEqual(c.works.map(w => w.id), ['a1']);
  assert.deepEqual(c.ignored.map(i => [i.work.id, i.reason]), [['a2', 'autre travail prévu']]);
  assert.deepEqual(c.looseWorks.map(w => [w.id, Boolean(w.overdue)]).sort(), [['b', false], ['v', true]]);
  // Décochés : créations ; cochés : clôture sans doublon.
  const plain = buildQuickWorks({type: 'Fauche', parcelIds: ['p2', 'p3'], date: TODAY}, d, {today: TODAY});
  assert.deepEqual([plain.updates.length, plain.creates.length], [0, 2]);
  const ticked = buildQuickWorks({type: 'Fauche', parcelIds: ['p2', 'p3'], date: TODAY}, d, {today: TODAY, include: ['v', 'b']});
  assert.deepEqual([ticked.updates.map(w => [w.id, w.type]).sort(), ticked.creates.length], [[['b', 'Broyage'], ['v', 'Fauche']], 0]);
  assert.equal(ticked.updates.find(w => w.id === 'v').overdue, undefined);
  // Étiquette selon la date saisie.
  const list = parcelChoices(d, {type: 'Fauche', today: TODAY});
  assert.deepEqual(Object.fromEntries(list.map(r => [r.parcel.id, r.plannedLabel])), {p1: 'Prévu aujourd’hui', p2: 'En retard', p3: 'Prévu aujourd’hui'});
  const later = parcelChoices(d, {type: 'Fauche', today: TODAY, date: '2026-10-26'});
  assert.equal(later.find(r => r.parcel.id === 'p1').plannedLabel, 'Prévu le 27/10');
});

test('tâches sans rapport : Pâturage et Traitement ne les cochent pas (PF-10)', () => {
  const d = data();
  d.tasks.push({id: 'c1', title: 'Réparer la clôture', parcelId: 'p3', dueDate: TODAY, status: 'À faire'},
    {id: 'c2', title: 'Vérifier abreuvoir', parcelId: 'p3', dueDate: TODAY, status: 'À faire'});
  const c = closingCandidates(d, {type: 'Pâturage', parcelIds: ['p3'], date: TODAY, today: TODAY});
  assert.deepEqual([c.tasks, c.looseTasks], [[], []]);
  assert.deepEqual(plannedToday(d, {type: 'Pâturage', today: TODAY}).tasks, []);
  const r = buildQuickWorks({type: 'Fauche', parcelIds: ['p3'], date: TODAY}, d, {today: TODAY});
  assert.deepEqual(r.tasks, []);
});

test('famille : travaux mécaniques et sans intrant hors phyto (AT-08)', () => {
  const cases = {'Désherbage mécanique': 'soil', 'Retrait bâche': 'other', 'Traite': 'other', 'Nettoyage cabine': 'other', 'Nettoyage pulvé': 'other',
    'Transport bottes': 'other', 'Plantation haie': 'other', 'Entretien clôture': 'other', 'Traitement': 'spray', 'Traitements': 'spray', 'Fongicide': 'spray',
    'Désherbage chimique': 'spray', 'Binage': 'soil', 'Travail du sol': 'soil', 'Sursemis': 'seed', 'Fertilisation': 'fertilize', 'Fauche': 'mow', 'Pâturage': 'graze'};
  for (const [type, family] of Object.entries(cases)) assert.equal(typeFamily(type), family, type);
  for (const type of ['Désherbage mécanique', 'Retrait bâche', 'Traite', 'Nettoyage pulvé']) {
    assert.ok(!isPhytoType(type) && !isTreatment({type}), type);
    assert.equal(buildQuickWorks({type, parcelIds: ['p3'], date: TODAY}, data(), {today: TODAY}).creates[0].isPhytosanitary, undefined);
  }
  assert.ok(isTreatment({type: 'Désherbage'}) && isTreatment({type: 'Traitement d’entretien'}));
  assert.ok(isSowingWork({type: 'Sursemis'}) && !isSowingWork({type: 'Plantation haie'}));
});

test('genre choisi sous « Autre… » : il prime sur le libellé, et reste facultatif', () => {
  assert.equal(workFamily('Application X', 'spray'), 'spray');
  assert.equal(doseConfig('Application X', 'seed').label, 'Variété');
  const w = buildQuickWorks({type: 'Application X', kind: 'spray', parcelIds: ['p3'], date: TODAY, product: 'P'}, data(), {today: TODAY}).creates[0];
  assert.deepEqual([w.kind, w.isPhytosanitary, w.product], ['spray', true, 'P']);
  assert.ok(isTreatment(w));
  const none = buildQuickWorks({type: 'Pulvérisation eau', kind: 'none', parcelIds: ['p3'], date: TODAY}, data(), {today: TODAY}).creates[0];
  assert.deepEqual([none.kind, none.isPhytosanitary, isTreatment(none)], ['none', undefined, false]);
  assert.equal(isSowingWork({type: 'X', kind: 'seed'}), true);
  assert.equal(buildQuickWorks({type: 'Semis', parcelIds: ['p3'], date: TODAY}, data(), {today: TODAY}).creates[0].kind, undefined);
});

test('écriture partielle : le nouvel essai termine sans doublon (PF-12)', async () => {
  const d = planned([{id: 'pv', parcelId: 'p1', type: 'Fauche', status: 'À faire', plannedDate: TODAY, date: TODAY}]);
  const db = new Map(), calls = [];
  let failing = true;
  const store = {
    get: (_t, id) => db.get(id),
    async upsertMany(type, list) {
      calls.push(type);
      if (type === 'tasks' && failing) throw new Error('stockage plein');
      list.forEach(x => db.set(x.id, x));
    }
  };
  d.tasks.push({id: 'tf', title: 'Fauche', parcelId: 'p1', dueDate: TODAY, status: 'À faire'});
  const memo = {};
  let n = 0;
  const first = assignWriteIds(buildQuickWorks({type: 'Fauche', parcelIds: ['p1', 'p3'], date: TODAY}, d, {today: TODAY}), memo, () => `id${++n}`);
  assert.deepEqual(first.creates.map(w => w.id), ['id1']);
  await assert.rejects(writeQuickWorks(store, first, {}), /stockage plein/);
  assert.equal(writesStarted(store, first), true);
  // La saisie figée ne rejoue que le reste, y compris après passage par le brouillon.
  const frozen = draftFields({type: 'Fauche', pending: first}).pending;
  failing = false;
  calls.length = 0;
  await writeQuickWorks(store, frozen, {});
  assert.deepEqual(calls, ['tasks']);
  assert.equal([...db.values()].filter(w => w.parcelId === 'p3').length, 1);
  // Même identifiant si la saisie est reconstruite.
  assert.deepEqual(assignWriteIds({creates: [{parcelId: 'p3'}]}, memo, () => 'autre').creates[0].id, 'id1');
  // Rien d'écrit : la saisie reste modifiable.
  assert.equal(writesStarted({get: () => null}, {creates: [{id: 'z'}], updates: [], tasks: [], done: []}), false);
});

test('rangée Ajouter : filtrée par activité et rôle', () => {
  const guard = role => g => canMutate(role, {...g, record: g.payload || null});
  assert.deepEqual(addRoutes().map(r => r.label), ['Tâche', 'Vêlage', 'Pesée', 'Soin']);
  assert.deepEqual(addRoutes({visible: a => !['herd-pick', 'open-herd-health'].includes(a)}).map(r => r.label), ['Tâche']);
  // Soin : filtré par le droit d'écrire un soin, refusé à l'opérateur terrain comme au lecteur.
  assert.deepEqual(addRoutes({canWrite: guard('operator')}).map(r => r.label), ['Tâche', 'Vêlage', 'Pesée']);
  assert.deepEqual(addRoutes({canWrite: guard('viewer')}).map(r => r.label), []);
  assert.deepEqual(addRoutes({canWrite: guard('editor')}).map(r => r.label), ['Tâche', 'Vêlage', 'Pesée', 'Soin']);
  assert.equal(addRoutes()[1].kind, 'calving');
  assert.equal(primaryTabs()[2].label, 'Ajouter');
});

test('lecteur : le + est masqué, sa case reste dans la barre', () => {
  const css = readFileSync(new URL('./design-v3.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-role="viewer"\] \[data-action="new-work"\]\{display:none!important\}/);
  assert.match(css, /html\[data-role="viewer"\] \.nav-plus\{display:block!important;visibility:hidden\}/);
});

test('travail groupé : mêmes contrôles que le formulaire simple (MV-02)', async () => {
  const seen = [];
  const phytoUI = {guardWork: async (_f, e) => { seen.push(e.parcelId); return e.parcelId !== 'bloque'; }};
  const hedgesUI = {guardWork: e => e.type === 'Taille haie' ? 'interdit' : ''};
  const base = {status: 'À faire', type: 'Traitement', parcelId: 'a'};
  assert.equal(await guardBatchWorks([base, {...base, parcelId: 'bloque'}, {...base, parcelId: 'c'}], {phytoUI, hedgesUI}), false);
  assert.deepEqual(seen, ['a', 'bloque']);
  assert.equal(await guardBatchWorks([{...base, type: 'Taille haie'}], {phytoUI, hedgesUI}), 'interdit');
  assert.match(await guardBatchWorks([{...base, status: 'Terminé'}], {phytoUI, hedgesUI}), /produit/);
  assert.equal(await guardBatchWorks([{...base, status: 'Terminé', product: 'P'}], {phytoUI, hedgesUI}), '');
});

// ---------- Relecture du lot 2 ----------
test('famille et registre suivent la même règle : haie, Pulvé, sous-solage', () => {
  for (const type of ['Désherbage haie', 'Traitement haie', 'Insecticide haie', 'Pulvé']) {
    assert.equal(typeFamily(type), 'spray', type);
    assert.equal(workFamily(type), 'spray', type);
    assert.ok(isTreatment({type}), type);
    const w = buildQuickWorks({type, parcelIds: ['p3'], date: TODAY, product: 'Glypho'}, data(), {today: TODAY}).creates[0];
    assert.deepEqual([w.product, w.isPhytosanitary], ['Glypho', true], type);
    assert.match(quickWorksProblem({creates: [{...w, product: ''}], updates: []}), /produit/, type);
  }
  for (const [type, family] of Object.entries({'Plantation haie': 'other', 'Taille haie': 'other', 'Broyage haie': 'other', 'Sous-solage': 'soil',
    'Sous solage': 'soil', 'Rebinage': 'soil', 'Nettoyage pulvé': 'other', 'Entretien pulvé': 'other', 'Réparation pulvé': 'other'})) {
    assert.equal(typeFamily(type), family, type);
    assert.ok(!isTreatment({type}) && workFamily(type) !== 'spray', type);
  }
  // Un Labour prévu se propose pour un Sous-solage (même genre).
  const d = planned([{id: 'lb', parcelId: 'p3', type: 'Labour', status: 'À faire', plannedDate: TODAY, date: TODAY}]);
  assert.deepEqual(closingCandidates(d, {type: 'Sous-solage', parcelIds: ['p3'], date: TODAY, today: TODAY}).looseWorks.map(w => w.id), ['lb']);
  // Un traitement sans isPhytosanitary reste refusé sans produit.
  assert.match(quickWorksProblem({creates: [{type: 'Pulvé', status: 'Terminé'}], updates: []}), /produit/);
});

test('« Un produit » prime sur le libellé, « Rien » aussi', () => {
  assert.equal(isTreatment({type: 'Broyage', kind: 'spray'}), true);
  assert.equal(isTreatment({type: 'Bouillie', kind: 'spray'}), true);
  assert.equal(isTreatment({type: 'Traitement', kind: 'none'}), false);
  assert.equal(workFamily('Traitement', 'none'), 'other');
});

test('rapprochement : le genre choisi compte pour le produit, un seul prévu reçoit la saisie', () => {
  // Type libre « Un produit » : un prévu avec un autre produit n'est pas réécrit.
  const d = planned([{id: 'bA', parcelId: 'p3', type: 'Bouillie', kind: 'spray', status: 'À faire', plannedDate: TODAY, date: TODAY, product: 'A'}]);
  const r = buildQuickWorks({type: 'Bouillie', kind: 'spray', parcelIds: ['p3'], date: TODAY, product: 'B'}, d, {today: TODAY});
  assert.deepEqual([r.updates.length, r.creates.length, r.creates[0].product], [0, 1, 'B']);
  assert.equal(closingCandidates(d, {type: 'Bouillie', kind: 'spray', parcelIds: ['p3'], date: TODAY, today: TODAY, product: 'B'}).ignored[0].reason, 'autre produit');
  // Sans genre, le genre du prévu compte aussi.
  assert.equal(closingCandidates(d, {type: 'Bouillie', parcelIds: ['p3'], date: TODAY, today: TODAY, product: 'B'}).works.length, 0);
  // Prévu proche + retard coché : une seule fiche porte produit et dose.
  const d2 = planned([
    {id: 'near', parcelId: 'p3', type: 'Traitement', status: 'À faire', plannedDate: TODAY, date: TODAY},
    {id: 'late', parcelId: 'p3', type: 'Traitement', status: 'À faire', plannedDate: '2026-10-01', date: '2026-10-01', dose: 3, doseUnit: 'L/ha'}]);
  const two = buildQuickWorks({type: 'Traitement', parcelIds: ['p3'], date: TODAY, product: 'P', dose: 1.5, doseUnit: 'L/ha'}, d2, {today: TODAY, include: ['late']});
  assert.equal(two.updates.length, 2);
  assert.deepEqual([two.updates[0].product, two.updates[0].dose], ['P', 1.5]);
  assert.deepEqual([two.updates[1].id, two.updates[1].status, two.updates[1].product, two.updates[1].dose, two.updates[1].plannedDate], ['late', 'Annulé', undefined, 3, '2026-10-01']);
  // Retard ou autre type avec un autre produit : jamais proposé à cocher.
  const d3 = planned([{id: 'lateA', parcelId: 'p3', type: 'Traitement', status: 'À faire', plannedDate: '2026-10-01', date: '2026-10-01', product: 'A'},
    {id: 'fongA', parcelId: 'p3', type: 'Fongicide', status: 'À faire', plannedDate: TODAY, date: TODAY, product: 'A'}]);
  const c = closingCandidates(d3, {type: 'Traitement', parcelIds: ['p3'], date: TODAY, today: TODAY, product: 'B'});
  assert.deepEqual([c.looseWorks.length, c.ignored.map(i => i.work.id).sort()], [0, ['fongA', 'lateA']]);
});

test('reprise du prévu : abandonnée si le produit ou la date changent', () => {
  const d = planned([{id: 'pA', parcelId: 'p3', type: 'Traitement', status: 'À faire', plannedDate: TODAY, date: TODAY, product: 'A', dose: 2, doseUnit: 'L/ha'}]);
  const prefill = plannedPrefill(d, {type: 'Traitement', parcelIds: ['p3'], date: TODAY, today: TODAY});
  assert.equal(prefill.workId, 'pA');
  const opts = {type: 'Traitement', parcelIds: ['p3'], date: TODAY, today: TODAY};
  assert.equal(prefillHolds(d, prefill, {...opts, product: 'A'}), true);
  assert.equal(prefillHolds(d, prefill, {...opts, product: 'B'}), false);
  assert.equal(prefillHolds(d, prefill, {...opts, product: 'A', date: '2026-10-01'}), false);
  assert.equal(prefillHolds(d, prefill, {...opts, product: 'A', date: '2026-11-05'}), false);
  assert.equal(prefillHolds(d, null, opts), false);
});

test('formulaire complet : produit exigé pour un traitement terminé, genre obsolète retiré', () => {
  assert.equal(missingTreatmentProduct({type: 'Traitement', status: 'Terminé', product: ''}), true);
  assert.equal(missingTreatmentProduct({type: 'Bouillie', kind: 'spray', status: 'Terminé'}), true);
  assert.equal(missingTreatmentProduct({type: 'Bouillie', isPhytosanitary: true, status: 'Terminé', product: 'P'}), false);
  assert.equal(missingTreatmentProduct({type: 'Traitement', status: 'À faire'}), false);
  assert.equal(missingTreatmentProduct({type: 'Fauche', status: 'Terminé'}), false);
  assert.equal(staleKind({type: 'Application', kind: 'none'}, {type: 'Traitement'}), true);
  assert.equal(staleKind({type: 'Application', kind: 'spray'}, {type: 'application'}), false);
  assert.equal(staleKind({type: 'Semis'}, {type: 'Traitement'}), false);
});

test('travail groupé : le genre choisi décide du produit exigé', async () => {
  assert.match(await guardBatchWorks([{type: 'Bouillie', kind: 'spray', status: 'Terminé', parcelId: 'a'}]), /produit/);
  assert.equal(await guardBatchWorks([{type: 'Traitement', kind: 'none', status: 'Terminé', parcelId: 'a'}]), '');
  const src = readFileSync(new URL('./work-form-ui.js', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.batchKindFields\(prefill, v\)/);
  assert.match(src, /bindGrazingNotice\(\$\('#batch-work-form'\), \(\) => \$\$\('#batch-work-form input\[name="parcelIds"\]:checked'\)/);
});

test('saisie en 3 étapes : écriture partielle figée, unité, genre et verrou perdu', () => {
  const src = readFileSync(new URL('./quick-work-ui.js', import.meta.url), 'utf8');
  // Perte du verrou : l'écriture partielle est retenue avant de rendre la main.
  assert.ok(src.indexOf('s.pending = started ? pending : null;') < src.indexOf("if (error?.name === 'TabReadOnlyError')"));
  assert.match(src, /if \(s\.pending\) return; \/\/ écriture partielle/);
  assert.match(src, /if \(s\.pending && step !== 3\) return;/);
  assert.match(src, /const changed = type !== s\.type \|\| kind !== s\.typeKind;/);
  // Unité choisie à la main : gardée, la valeur d'habitude seulement dans cette unité.
  assert.match(src, /const usable = hint && \(!s\.unitTouched \|\| hint\.unit === s\.doseUnit\) \? hint : null;/);
  assert.match(src, /if \(usable\?\.unit && !s\.unitTouched\) \{ s\.doseUnit = usable\.unit; showUnit\(usable\.unit\); \}/);
  // Brouillon repris : le prévu prérempli est revérifié (checkPrefill), sa dose ne part pas s'il n'est plus clôturé.
  assert.match(src, /if \(!s\.pending\) checkPrefill\(\); render\(\); \}/);
  assert.match(src, /isSpray\(\) \? \{isPhytosanitary: true\} : \{\}/);
  const grazing = readFileSync(new URL('./quick-grazing-ui.js', import.meta.url), 'utf8');
  assert.match(grazing, /try \{ await store\.upsertMany\('interventions', works/);
  assert.match(grazing, /\.filter\(r => store\.get\('grazingSessions', r\.id\)\)\) await store\.remove/);
});

test('travail groupé : le genre du « + » ne suit pas un type changé dans le formulaire', () => {
  // Autre… Broyage en genre pulvérisation, puis Fauche dans le formulaire groupé : ni genre ni registre phyto.
  assert.deepEqual(batchKindFields({type: 'Broyage', kind: 'spray'}, {type: 'Fauche'}), {});
  assert.deepEqual(batchKindFields({type: 'Broyage', kind: 'spray'}, {type: 'broyage'}), {isPhytosanitary: true, kind: 'spray'});
  assert.deepEqual(batchKindFields({type: 'Traitement'}, {type: 'Traitement'}), {isPhytosanitary: true});
  assert.deepEqual(batchKindFields({}, {type: 'Fauche'}), {});
});

test('formulaire complet : aucun motif de dérogation caché repris du « + »', () => {
  const quick = readFileSync(new URL('./quick-work-ui.js', import.meta.url), 'utf8');
  const openFull = quick.slice(quick.indexOf('function openFull()'), quick.indexOf('// ---------- Interactions ----------'));
  assert.doesNotMatch(openFull, /phytoOverrideReason/);
  const form = readFileSync(new URL('./work-form-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(form, /prefill\?\.phytoOverrideReason/);
});

test('saisie en 3 étapes : même famille, l\'unité de départ suit le nouveau type', () => {
  // Fertilisation (kg/ha) puis Épandage lisier (m³/ha) : même famille, unités de départ différentes.
  assert.equal(workFamily('Fertilisation'), workFamily('Épandage lisier'));
  assert.notEqual(doseConfig('Fertilisation').unit, doseConfig('Épandage lisier').unit);
  const src = readFileSync(new URL('./quick-work-ui.js', import.meta.url), 'utf8');
  assert.match(src, /\} else if \(!s\.unitTouched && !s\.doseTouched\) s\.doseUnit = doseConfig\(type, kind, s\.product\)\.unit;/);
});

test('formulaire complet : les prévus et tâches cochés ne restent pas ouverts en silence', () => {
  const w = id => ({id, parcelId: id});
  // Deux parcelles, un prévu chacune : le formulaire groupé créerait des doublons.
  assert.deepEqual(fullFormLeftovers({works: [w('a'), w('b')]}, {parcelCount: 2}), ['a', 'b']);
  assert.deepEqual(fullFormLeftovers({works: [w('a'), w('b')]}, {parcelCount: 2, skip: ['a', 'b']}), []);
  // Une parcelle, un seul prévu : repris par le formulaire ; une tâche ou un prévu ajouté resterait ouvert.
  assert.deepEqual(fullFormLeftovers({works: [w('a')]}, {parcelCount: 1}), []);
  assert.deepEqual(fullFormLeftovers({works: [w('a')], tasks: [w('t')]}, {parcelCount: 1}), ['t']);
  assert.deepEqual(fullFormLeftovers({works: [w('a')], looseWorks: [w('r')], looseTasks: [w('u')]}, {parcelCount: 1, include: ['r']}), ['r']);
  assert.deepEqual(fullFormLeftovers({}, {parcelCount: 1}), []);
});

// ---------- Lot 3 : données métier de l'étape 3 ----------
const lot3 = () => ({
  ...data(),
  parcelles: [...parcels.map(p => ({...p})), {id: 'p5', nom: 'Client Sud', culture: 'Maïs', surfaceHa: 4, clientId: 'c1'}],
  clients: [{id: 'c1', nom: 'GAEC Sud', hourlyRate: 60}],
  rotations: [], integrationImports: [], preferences: {fuelPrice: 1.2},
  stockItems: [
    {id: 's1', name: 'Elatus Era', category: 'Phytosanitaire', unit: 'L', quantity: 20, unitPrice: 50, phyto: {amm: '2160046', dar: 35, maxDose: 1, doseUnit: 'L/ha'}},
    {id: 's2', name: 'Ammonitrate 33,5', category: 'Engrais', unit: 'kg', quantity: 5000, fertilizer: {N: 33.5, type: 'III'}},
    {id: 's3', name: 'Rubisko', category: 'Semence', unit: 'kg', quantity: 100}
  ],
  materiels: [{id: 'm1', nom: 'Pulvé', hourlyCost: 40, currentMeter: 1200}, ...Array.from({length: 7}, (_, i) => ({id: `mx${i}`, nom: `Engin ${i}`}))]
});

test('lot 3 : unités par genre, effluents sans dose de départ, irrigation en mm', () => {
  assert.deepEqual(doseConfig('Semis').units, ['kg/ha', 'grains/m²']);
  assert.deepEqual(doseConfig('Traitement').units, ['L/ha', 'kg/ha']);
  assert.equal(doseConfig('Épandage lisier').unit, 'm³/ha');
  assert.equal(doseConfig('Épandage lisier').def, null);
  assert.equal(doseConfig('Fertilisation', '', 'Fumier bovin').unit, 't/ha');
  assert.equal(doseConfig('Irrigation').unit, 'mm');
  assert.equal(doseConfig('Irrigation').none, false);
  assert.equal(doseSuggestion({interventions: []}, {type: 'Épandage lisier'}), null);
  assert.equal(requiredStock({surfaceWorked: 2, dose: 30, doseUnit: 'm³/ha'}, {unit: 'm³'}), 60);
  assert.equal(requiredStock({surfaceWorked: 2, dose: 30, doseUnit: 'q/ha'}, {unit: 't'}), 6);
});

test('lot 3 : récolte, lot créé seulement terminé, avec quantité, sans doublon, réparti au prorata', () => {
  const d = lot3();
  const none = buildQuickWorks({type: 'Récolte', parcelIds: ['p1'], date: TODAY}, d, {today: TODAY});
  assert.equal(none.records.length, 0);
  const r = buildQuickWorks({type: 'Récolte', parcelIds: ['p1', 'p2'], date: TODAY, details: {quantity: '100', quantityUnit: 't', humidity: '15'}}, d, {today: TODAY});
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].farmKind, 'harvest');
  assert.equal(Math.round((r.records[0].quantity + r.records[1].quantity) * 1000) / 1000, 100);
  assert.ok(r.records[0].quantity > r.records[1].quantity); // 12,4 ha contre 8,1 ha
  assert.equal(r.records[0].humidity, 15);
  assert.match(r.records[0].code, /^20261028-/);
  assert.equal(r.records[0].crop, 'Blé tendre');
  const future = buildQuickWorks({type: 'Récolte', parcelIds: ['p1'], date: '2026-11-05', details: {quantity: '10'}}, d, {today: TODAY});
  assert.equal(future.records.length, 0);
  d.integrationImports.push({id: 'l1', farmKind: 'harvest', code: 'A', parcelId: 'p1', date: TODAY, quantity: 50});
  const again = buildQuickWorks({type: 'Récolte', parcelIds: ['p1'], date: TODAY, details: {quantity: '10'}}, d, {today: TODAY});
  assert.equal(again.records.length, 0);
  assert.equal(again.existingLots.length, 1);
  assert.deepEqual(shareOut(10, [1, 1, 1], 2), [3.33, 3.33, 3.34]);
  assert.equal(harvestLotCode({integrationImports: [{farmKind: 'harvest', code: '20261028-LESGRAND'}]}, {date: TODAY, parcel: parcels[0]}), '20261028-LESGRAND-2');
});

test('lot 3 : fauche, coupe de fourrage seulement avec type et quantité ; fanage sans coupe', () => {
  const d = lot3();
  const bare = buildQuickWorks({type: 'Fauche', parcelIds: ['p3'], date: TODAY}, d, {today: TODAY});
  assert.equal(bare.records.length, 0);
  const cut = buildQuickWorks({type: 'Fauche', parcelIds: ['p3'], date: TODAY, details: {forageType: 'foin', forageMode: 'bales', bales: '40'}}, d, {today: TODAY});
  assert.equal(cut.records.length, 1);
  assert.equal(cut.records[0].farmKind, 'forage');
  assert.equal(cut.records[0].cut, 1);
  assert.equal(cut.records[0].bales, 40);
  assert.ok(cut.records[0].tms > 0);
  d.integrationImports.push({id: 'f1', ...cut.records[0]});
  assert.equal(nextCut(d, 'p3', TODAY), 2);
  assert.equal(buildQuickWorks({type: 'Fanage', parcelIds: ['p3'], date: TODAY, details: {forageType: 'foin', bales: '40'}}, d, {today: TODAY}).records.length, 0);
  assert.equal(isForageFollowup('Pressage'), true);
});

test('lot 3 : semis, culture et rotation sans doublon, campagne précédente, couvert à part', () => {
  const d = lot3();
  const r = buildQuickWorks({type: 'Semis', parcelIds: ['p1'], date: '2026-09-10', product: 'Rubisko', dose: 2.5, doseUnit: 'kg/ha', details: {culture: 'Colza', seedTgw: '5'}}, d, {today: '2026-09-12'});
  assert.equal(r.creates[0].culture, 'Colza');
  assert.equal(r.creates[0].seed.variety, 'Rubisko');
  assert.equal(r.creates[0].seed.density, 2.5);
  assert.equal(r.creates[0].seed.densityUnit, 'kg/ha');
  assert.equal(r.creates[0].seed.stockItemId, 's3');
  assert.deepEqual(r.rotations.map(x => [x.campaignId, x.culture]), [['2025/26', 'Blé tendre'], ['2026/27', 'Colza']]);
  assert.equal(r.parcels[0].culture, 'Colza');
  assert.equal(r.changes[0].from, 'Blé tendre');
  // Ligne existante : mise à jour, jamais une seconde ligne.
  d.rotations.push({id: 'r1', parcelId: 'p1', campaignId: '2026/27', culture: 'Orge'});
  const again = buildQuickWorks({type: 'Semis', parcelIds: ['p1'], date: '2026-09-10', details: {culture: 'Colza'}}, d, {today: '2026-09-12'});
  assert.deepEqual(again.rotations.map(x => [x.id, x.culture]), [['r1', 'Colza']]);
  // Futur : rien ; couvert : interculture, culture inchangée.
  assert.equal(buildQuickWorks({type: 'Semis', parcelIds: ['p1'], date: '2026-10-30', details: {culture: 'Colza'}}, d, {today: TODAY}).rotations.length, 0);
  const cover = buildQuickWorks({type: 'Semis', parcelIds: ['p2'], date: TODAY, details: {culture: 'Moutarde', cover: true}}, d, {today: TODAY});
  assert.equal(cover.creates[0].culture, 'Colza');
  assert.equal(cover.parcels.length, 0);
  assert.equal(cover.rotations[0].interculture.especes, 'Moutarde');
  assert.equal(cover.rotations[0].interculture.semisDate, TODAY);
  assert.equal(cover.rotations[0].culture, 'Colza');
  assert.throws(() => buildQuickWorks({type: 'Semis', parcelIds: ['p1'], date: TODAY, details: {seedTgw: '5000'}}, d, {today: TODAY}), /PMG/);
});

test('lot 3 : destruction du couvert par un passage, date minimale signalée', () => {
  const d = lot3();
  d.rotations.push({id: 'r2', parcelId: 'p2', campaignId: '2026/27', culture: 'Maïs', interculture: {especes: 'Phacélie', semisDate: '2026-08-20'}});
  assert.equal(destructionModeFor('Labour'), 'Labour');
  assert.equal(destructionModeFor('Broyage'), 'Broyage');
  assert.equal(destructionModeFor('Récolte'), '');
  const early = coversToDestroy(d, {type: 'Déchaumage', parcelIds: ['p2'], date: TODAY});
  assert.equal(early.length, 1);
  assert.equal(early[0].mode, 'Travail superficiel');
  assert.equal(early[0].early, '2026-11-01');
  const r = buildQuickWorks({type: 'Labour', parcelIds: ['p2'], date: TODAY, details: {destroyCover: true, depth: '25'}}, d, {today: TODAY});
  assert.equal(r.rotations[0].interculture.destructionDate, TODAY);
  assert.equal(r.rotations[0].interculture.destructionMode, 'Labour');
  assert.equal(r.creates[0].depthCm, 25);
  assert.equal(buildQuickWorks({type: 'Labour', parcelIds: ['p2'], date: TODAY}, d, {today: TODAY}).rotations.length, 0);
});

test('lot 3 : traitement, cible, heures, AMM de la fiche, stock et délai avant récolte', () => {
  const d = lot3();
  const r = buildQuickWorks({type: 'Traitement', parcelIds: ['p1'], date: TODAY, product: 'Elatus Era', dose: 0.75, doseUnit: 'L/ha', startTime: '08:00',
    details: {target: 'Septoriose', endTime: '10:30', stage: 'DFE', operator: 'Paul', productLot: 'L42'}}, d, {today: TODAY, now: 1});
  const w = r.creates[0];
  assert.equal(w.target, 'Septoriose');
  assert.equal(w.endTime, '10:30');
  assert.equal(w.duration, 2.5);
  assert.equal(w.amm, '2160046');
  assert.equal(w.operator, 'Paul');
  assert.equal(w.productLot, 'L42');
  assert.deepEqual(w.actualMetrics, {areaHa: 12.4, dose: 0.75, duration: 2.5});
  // Coût estimé : intrant du stock (0,75 x 12,4 x 50 €) ; matériel non choisi.
  assert.equal(w.inputCost, 465);
  assert.equal(w.costSource, 'estimé');
  assert.equal(w.cost, 465);
  const preview = stockOutPreview(r.creates, stockItemFor(d, {type: 'Traitement', product: 'elatus era'}));
  assert.equal(preview.quantity, 9.3);
  assert.equal(preview.short, false);
  assert.equal(stockOutPreview(r.creates, {...d.stockItems[0], quantity: 2}).short, true);
  assert.match(stockOutPreview(r.creates, {...d.stockItems[0], unit: 'pièce'}).error, /non convertible/);
  // Délai avant récolte : une récolte 10 jours après est signalée, pas une 40 jours après.
  d.interventions.push({...w, id: 'wt'});
  assert.equal(harvestDarWarnings(d, {parcelIds: ['p1'], date: '2026-11-07'}).length, 1);
  assert.match(harvestDarWarnings(d, {parcelIds: ['p1'], date: '2026-11-07'})[0].message, /35 jours/);
  assert.equal(harvestDarWarnings(d, {parcelIds: ['p1'], date: '2026-12-10'}).length, 0);
  assert.equal(darConflicts(d, 'p1', '2026-10-27').length, 0);
  // Délai qui traverse le passage à l'heure d'hiver (25/10/2026) : 1er octobre + 35 jours = 5 novembre, pas le 4.
  d.interventions.push({...w, id: 'wdst', date: '2026-10-01'});
  assert.equal(darConflicts(d, 'p1', '2026-11-04').find(c => c.work.id === 'wdst')?.until, '2026-11-05');
  assert.equal(darConflicts(d, 'p1', '2026-11-05').some(c => c.work.id === 'wdst'), false);
});

test('lot 3 : produits filtrés par genre, engin au-delà de six, travail futur en mesures prévues', () => {
  const d = lot3();
  const spray = productChoices(d, {type: 'Traitement'});
  assert.ok(spray.includes('Elatus Era'));
  assert.ok(!spray.includes('Rubisko'));
  assert.ok(!spray.includes('Ammonitrate 33,5'));
  assert.ok(productChoices(d, {type: 'Fertilisation'}).includes('Lisier bovin'));
  assert.ok(productChoices(d, {type: 'Semis'}).includes('Rubisko'));
  assert.deepEqual(productChoices(d, {type: 'Labour'}), []);
  const future = buildQuickWorks({type: 'Traitement', parcelIds: ['p1'], date: '2026-11-03', product: 'Elatus Era', dose: 0.5}, d, {today: TODAY});
  assert.equal(future.creates[0].actualMetrics, undefined);
  assert.deepEqual(future.creates[0].plannedMetrics, {areaHa: 12.4, dose: 0.5, duration: null});
  assert.equal(future.creates[0].cost, undefined);
  // Surface saisie (une parcelle), durée et carburant répartis sur plusieurs parcelles.
  assert.equal(buildQuickWorks({type: 'Labour', parcelIds: ['p1'], date: TODAY, details: {surface: '6'}}, d, {today: TODAY}).creates[0].surfaceWorked, 6);
  const two = buildQuickWorks({type: 'Labour', parcelIds: ['p1', 'p2'], date: TODAY, equipmentId: 'm1', details: {duration: '10', fuel: '100'}}, d, {today: TODAY});
  assert.equal(two.creates[0].duration + two.creates[1].duration, 10);
  assert.equal(Math.round((two.creates[0].fuel + two.creates[1].fuel) * 100) / 100, 100);
  assert.equal(two.creates[0].machineCost, Math.round(two.creates[0].duration * 40 * 100) / 100);
  assert.equal(hoursBetween('22:00', '01:30'), 3.5);
  assert.equal(hoursBetween('', '01:30'), null);
});

test('lot 3 : fertilisation, azote apporté, composition inconnue, interdiction en zone vulnérable', () => {
  const d = lot3();
  const hint = nitrogenHint(d, {product: 'Ammonitrate 33,5', dose: 150, doseUnit: 'kg/ha', parcelIds: ['p1'], date: TODAY, today: TODAY});
  assert.equal(hint.perHa.nTotal, 50.3);
  assert.equal(hint.unknown, false);
  assert.equal(nitrogenHint(d, {product: 'Engrais maison', dose: 100, doseUnit: 'kg/ha', parcelIds: ['p1'], date: TODAY, today: TODAY}).unknown, true);
  assert.equal(nitrogenHint(d, {product: 'Engrais maison', dose: 40, doseUnit: 'unité/ha', parcelIds: ['p1'], date: TODAY, today: TODAY}).unknown, false);
  d.parcelles[0].zoneVulnerable = true;
  const ban = nitrogenHint(d, {product: 'Ammonitrate 33,5', dose: 150, doseUnit: 'kg/ha', parcelIds: ['p1'], date: '2026-12-01', today: TODAY});
  assert.ok(Array.isArray(ban.bans));
});

test('lot 3 : facturation, case décochée respectée, durée exigée pour un client à l’heure', () => {
  const d = lot3();
  const r = buildQuickWorks({type: 'Labour', parcelIds: ['p5'], date: TODAY}, d, {today: TODAY});
  assert.match(billingProblem(r, d), /durée/);
  assert.equal(billingProblem(buildQuickWorks({type: 'Labour', parcelIds: ['p5'], date: TODAY, details: {duration: '2'}}, d, {today: TODAY}), d), '');
  const off = buildQuickWorks({type: 'Labour', parcelIds: ['p5'], date: TODAY, details: {billable: false}}, d, {today: TODAY});
  assert.equal(off.creates[0].billable, false);
  assert.equal(billingProblem(off, d), '');
  d.interventions.push({...off.creates[0], id: 'wb'});
  assert.equal(billableItems(d, 'c1').length, 0);
  d.interventions.find(w => w.id === 'wb').billable = true;
  assert.equal(billableItems(d, 'c1').length, 1);
});

test('lot 3 : rôle sans rotation ni parcelle, identifiants fixes, étapes d’écriture complètes', async () => {
  const d = lot3();
  const r = buildQuickWorks({type: 'Semis', parcelIds: ['p1'], date: TODAY, details: {culture: 'Colza'}}, d, {today: TODAY});
  const message = dropForbidden(r, op => op.entity !== 'rotations' && op.entity !== 'parcelles');
  assert.match(message, /rotation/);
  assert.equal(r.rotations.length, 0);
  assert.equal(r.parcels.length, 0);
  const lots = buildQuickWorks({type: 'Récolte', parcelIds: ['p1'], date: TODAY, details: {quantity: '5'}}, d, {today: TODAY});
  let n = 0;
  assignWriteIds(lots, {}, (prefix = 'work') => `${prefix}-${++n}`);
  assert.match(lots.records[0].id, /^harvest-/);
  const calls = [];
  await writeQuickWorks({upsertMany: async (entity, list) => { calls.push([entity, list.length]); }}, lots, {});
  assert.deepEqual(calls, [['interventions', 1], ['integrationImports', 1]]);
});

test('lot 3 : un prévu en retard clos avec le prévu proche ne sort pas deux fois le stock et ne bloque pas la facturation', () => {
  const d = lot3();
  d.parcelles.push({id: 'pa', nom: 'Herbi', culture: 'Blé tendre', surfaceHa: 10, clientId: 'c1'});
  d.interventions.push({id: 'near', parcelId: 'pa', type: 'Traitement', status: 'À faire', plannedDate: TODAY, date: TODAY, product: 'Elatus Era', dose: 1, doseUnit: 'L/ha', surfaceWorked: 10},
    {id: 'old', parcelId: 'pa', type: 'Traitement', status: 'À faire', plannedDate: '2026-10-01', date: '2026-10-01', product: 'Elatus Era', dose: 1, doseUnit: 'L/ha', surfaceWorked: 10});
  const r = buildQuickWorks({type: 'Traitement', parcelIds: ['pa'], date: TODAY, product: 'Elatus Era', dose: 1, doseUnit: 'L/ha', details: {duration: '3'}}, d, {today: TODAY, include: ['old']});
  assert.deepEqual(r.updates.map(w => w.status), ['Terminé', 'Annulé']);
  assert.equal(r.updates[1].mergedInto, 'near');
  assert.deepEqual(r.closedOnly, ['old']);
  assert.deepEqual(entryWorks(r).map(w => w.id), ['near']);
  const fx = quickEffects(r, d, {type: 'Traitement', product: 'Elatus Era', details: {duration: '3'}});
  assert.equal(fx.preview.quantity, 10); // et non 20 : un seul passage
  // Client à l'heure : la durée saisie suffit, le prévu seulement clos n'est pas facturé une seconde fois.
  assert.equal(billingProblem(r, d), '');
  assert.equal(r.updates[1].billable, false);
  // Registre phytosanitaire : un seul passage, le prévu fusionné n'y entre pas avec son produit.
  const saved = new Map(r.updates.map(w => [w.id, w]));
  const after = {...d, interventions: d.interventions.map(w => saved.get(w.id) || w)};
  assert.equal(registerRows(after, campaignFor(TODAY)).filter(row => row.parcel?.id === 'pa').length, 1);
});

test('prévu seulement clos sans produit : ni refus « produit » ni contrôle BCAE en double', () => {
  const d = lot3();
  d.parcelles.push({id: 'pb', nom: 'Sans produit', culture: 'Blé tendre', surfaceHa: 4});
  d.interventions.push({id: 'nb', parcelId: 'pb', type: 'Traitement', status: 'À faire', plannedDate: TODAY, date: TODAY},
    {id: 'ob', parcelId: 'pb', type: 'Traitement', status: 'À faire', plannedDate: '2026-10-01', date: '2026-10-01'});
  const r = buildQuickWorks({type: 'Traitement', parcelIds: ['pb'], date: TODAY, product: 'X'}, d, {today: TODAY, include: ['ob']});
  assert.deepEqual(r.closedOnly, ['ob']);
  assert.equal(quickWorksProblem(r), '');
});

test('shareOut : plus forts restes, somme exacte, jamais de part négative', () => {
  assert.deepEqual(shareOut(2, [1, 1, 1, 1], 0), [0, 0, 1, 1]);
  assert.deepEqual(shareOut(1, [1, 1, 1], 0), [0, 0, 1]);
  assert.deepEqual(shareOut(3, [2, 1], 0), [2, 1]);
  const parts = shareOut(10.5, [12.4, 8.1, 5.6], 2);
  assert.ok(parts.every(v => v >= 0));
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 1050);
  assert.deepEqual(parts, [4.99, 3.26, 2.25]);
});

test('lot 3 : sortie de stock et compteur selon le rôle et un compteur numérique', () => {
  const d = lot3();
  const draft = {type: 'Traitement', parcelIds: ['p1'], date: TODAY, product: 'Elatus Era', dose: 0.5, equipmentId: 'm1', details: {duration: '2'}};
  const r = buildQuickWorks(draft, d, {today: TODAY});
  const opts = {type: 'Traitement', product: 'Elatus Era', equipmentId: 'm1', details: {duration: '2'}};
  const all = quickEffects(r, d, opts);
  assert.deepEqual([all.stockItemId, all.countMachine], ['s1', true]);
  // Opérateur terrain : ni stock ni mouvement ; le compteur par applyWorkEffects (sans liste de champs) lui est refusé aussi.
  const can = op => canMutate('operator', op);
  const operator = quickEffects(r, d, {...opts, canStock: can({entity: 'stockItems', action: 'update'}) && can({entity: 'stockMovements', action: 'create'}), canMeter: can({entity: 'materiels', action: 'update'})});
  assert.deepEqual([operator.stockItemId, operator.preview, operator.countMachine], ['', null, false]);
  const none = quickEffects(r, d, {...opts, canStock: false, canMeter: false});
  assert.equal(none.stockItemId || none.countMachine ? 'effets' : null, null);
  // Compteur vide ou en texte : ni case ni heures ajoutées, la sortie de stock reste.
  for (const meter of ['', '1234', undefined]) {
    const m = {...d, materiels: d.materiels.map(x => x.id === 'm1' ? {...x, currentMeter: meter} : x)};
    const fx = quickEffects(r, m, opts);
    assert.deepEqual([fx.meterable, fx.countMachine, fx.stockItemId], [false, false, 's1']);
  }
  // Cases décochées.
  const off = quickEffects(r, d, {...opts, details: {duration: '2', stockOut: false, meter: false}});
  assert.deepEqual([off.stockItemId, off.countMachine], ['', false]);
});

test('lot 3 : récolte sur deux parcelles dont une a déjà son lot, la part de l’autre seule', () => {
  const d = lot3();
  d.parcelles.push({id: 'ha', nom: 'A', culture: 'Blé tendre', surfaceHa: 10}, {id: 'hb', nom: 'B', culture: 'Blé tendre', surfaceHa: 10});
  d.integrationImports.push({id: 'la', farmKind: 'harvest', code: 'X', parcelId: 'ha', date: '2026-07-10', quantity: 100});
  const r = buildQuickWorks({type: 'Moisson', parcelIds: ['ha', 'hb'], date: '2026-07-10', details: {quantity: '200'}}, d, {today: TODAY});
  assert.equal(r.records.length, 1);
  assert.deepEqual([r.records[0].parcelId, r.records[0].quantity], ['hb', 100]);
});

test('lot 3 : semis d’une campagne passée, la culture courante n’est pas reportée en arrière', () => {
  const d = {parcelles: [{id: 'p', nom: 'P', culture: 'Blé', surfaceHa: 5}], rotations: []};
  const r = sowingWrites(d, {parcels: d.parcelles, culture: 'Maïs', date: '2026-04-15', today: '2026-11-02'});
  assert.deepEqual(r.rotations.map(x => [x.campaignId, x.culture]), [['2025/26', 'Maïs']]);
  assert.equal(r.parcels.length, 0);
  assert.deepEqual([r.changes[0].from, r.changes[0].to], ['', 'Maïs']);
  // Campagne courante : l'ancienne culture complète la campagne précédente, comme avant.
  const now = sowingWrites(d, {parcels: d.parcelles, culture: 'Maïs', date: '2026-10-20', today: '2026-11-02'});
  assert.deepEqual(now.rotations.map(x => [x.campaignId, x.culture]), [['2025/26', 'Blé'], ['2026/27', 'Maïs']]);
});

test('lot 4 : ordre figé de l’étape 2, cochée hors filtre signalée (PF-16)', () => {
  const d = data();
  const first = parcelChoices(d, {type: 'Semis', today: TODAY}).map(r => r.parcel.id);
  // Cocher la dernière ne la fait plus remonter quand l'ordre est figé.
  const last = first.at(-1);
  const moved = parcelChoices(d, {type: 'Semis', today: TODAY, selected: [last]}).map(r => r.parcel.id);
  assert.equal(moved[0], last);
  assert.deepEqual(parcelChoices(d, {type: 'Semis', today: TODAY, selected: [last], order: first}).map(r => r.parcel.id), first);
  // Filtre Favoris : la cochée non favorite reste visible, marquée hors filtre.
  const fav = parcelChoices(d, {type: 'Semis', today: TODAY, filter: 'favorites', selected: ['p1']});
  assert.deepEqual(fav.map(r => [r.parcel.id, r.outside]), [['p1', true], ['p2', false]]);
});

test('lot 4 : date dans le résumé, date future, lointaine ou d’une autre campagne (PF-19)', () => {
  assert.equal(draftSummary(data(), {type: 'Semis', parcelIds: ['p1'], date: TODAY, today: TODAY}), 'Semis · 1 parcelle · 12,4 ha');
  assert.equal(draftSummary(data(), {type: 'Semis', parcelIds: ['p1'], date: '2026-10-27', today: TODAY}), 'Semis · 1 parcelle · 12,4 ha · hier');
  assert.equal(draftSummary(data(), {type: 'Semis', parcelIds: [], date: '2026-11-03', today: TODAY}), 'Semis · le 03/11/2026');
  assert.deepEqual(dateNotice(TODAY, TODAY), {future: false, far: false, messages: []});
  const soon = dateNotice('2026-11-03', TODAY);
  assert.equal(soon.future, true);
  assert.deepEqual(soon.messages.map(m => m.text), ['Sera prévu le 03/11/2026, non terminé.']);
  const typo = dateNotice('2062-10-28', TODAY);
  assert.equal(typo.far, true);
  assert.ok(typo.messages.some(m => m.warn && /plus d’un an/.test(m.text)));
  assert.ok(typo.messages.some(m => /Campagne 2062\/63/.test(m.text)));
  // Passé récent d'une autre campagne : signalé, sans alerte d'année.
  const july = dateNotice('2026-07-10', TODAY);
  assert.deepEqual([july.future, july.far, july.messages.length], [false, false, 1]);
  assert.match(july.messages[0].text, /Campagne 2025\/26/);
  assert.deepEqual(dateNotice('pas une date', TODAY).messages, []);
});

test('lot 4 : une parcelle archivée d’un ancien brouillon ne reçoit rien (PF-17)', () => {
  assert.throws(() => buildQuickWorks({type: 'Semis', parcelIds: ['p4'], date: TODAY}, data(), {today: TODAY}), /parcelle/);
  const r = buildQuickWorks({type: 'Semis', parcelIds: ['p1', 'p4'], date: TODAY}, data(), {today: TODAY});
  assert.deepEqual(r.creates.map(w => w.parcelId), ['p1']);
});

test('lot 4 : la reprise garde heure, prévus écartés, motif de dérogation et unité choisie (PF-13, AT-M3)', () => {
  const draft = {type: 'Traitement', parcelIds: ['p1'], step: 3, startTime: '07:15', skip: ['w9'], include: ['t9'], reason: 'préconisation écrite', needReason: true, doseTouched: true, unitTouched: true};
  const back = JSON.parse(JSON.stringify(draftFields(draft)));
  assert.deepEqual([back.startTime, back.showTime, back.skip, back.include, back.reason, back.needReason, back.doseTouched, back.unitTouched],
    ['07:15', true, ['w9'], ['t9'], 'préconisation écrite', true, true, true]);
  // Les tableaux sont copiés : modifier la saisie ensuite ne change pas le brouillon écrit.
  const fields = draftFields(draft); draft.skip.push('w10');
  assert.deepEqual(fields.skip, ['w9']);
  assert.equal(draftFields({type: 'Semis'}).showTime, false);
});

