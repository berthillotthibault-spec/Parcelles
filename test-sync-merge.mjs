// n° 134 : fusion à trois voies (cas concrets et cas limites).
import test from 'node:test';
import assert from 'node:assert/strict';
import {isIdArray, mergeIdArrays, syncBaseKey, threeWayMerge} from './sync-merge.js';
import {conflictFieldRows} from './sync-conflict.js';

const NOW = 1_800_000_000_000;
const m = (base, local, remote) => threeWayMerge(base, local, remote, {now: NOW});
const parcel = {id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 11.3, notes: '', createdAt: 1, updatedAt: 10, version: 3, deletedAt: null};

test('parcelle : culture changée ici, notes changées dans le cloud → les deux gardées sans conflit', () => {
  const r = m(parcel, {...parcel, culture: 'Orge', updatedAt: 20, version: 4}, {...parcel, notes: 'Drainage', updatedAt: 15, version: 4});
  assert.equal(r.canMerge, true);
  assert.equal(r.merged.culture, 'Orge');assert.equal(r.merged.notes, 'Drainage');
  assert.deepEqual(r.autoFields, {culture: 'local', notes: 'remote'});
  assert.equal(r.merged.version, 5);assert.equal(r.merged.updatedAt, NOW);assert.equal(r.merged.createdAt, 1);
});

test('parcelle : même champ changé des deux côtés → vrai conflit ; même valeur → pas de conflit', () => {
  const r = m(parcel, {...parcel, culture: 'Orge'}, {...parcel, culture: 'Maïs'});
  assert.equal(r.canMerge, false);assert.deepEqual(r.conflicts, ['culture']);
  assert.equal(m(parcel, {...parcel, culture: 'Orge'}, {...parcel, culture: 'Orge'}).canMerge, true);
});

test('intervention : dose modifiée ici, statut dans le cloud ; puis dose modifiée des deux côtés', () => {
  const work = {id: 'w1', type: 'Désherbage', parcelId: 'p1', dose: 1.5, doseUnit: 'L/ha', status: 'À faire', date: '2026-10-08'};
  const ok = m(work, {...work, dose: 1.2}, {...work, status: 'Terminé', date: '2026-10-09'});
  assert.equal(ok.canMerge, true);assert.equal(ok.merged.dose, 1.2);assert.equal(ok.merged.status, 'Terminé');assert.equal(ok.merged.date, '2026-10-09');
  const ko = m(work, {...work, dose: 1.2}, {...work, dose: 2});
  assert.deepEqual(ko.conflicts, ['dose']);
});

test('lot de pâturage : animaux fusionnés par id', () => {
  const lot = {id: 'g1', parcelId: 'p3', animalsCount: 2, animals: [{id: 'a1', name: 'Rosette'}, {id: 'a2', name: 'Bella', weight: 600}]};
  // Ajout ici, modification d'un autre animal dans le cloud.
  const r = m(lot, {...lot, animals: [...lot.animals, {id: 'a3', name: 'Câline'}]}, {...lot, animals: [lot.animals[0], {...lot.animals[1], weight: 620}]});
  assert.equal(r.canMerge, true);
  assert.deepEqual(r.merged.animals, [{id: 'a1', name: 'Rosette'}, {id: 'a2', name: 'Bella', weight: 620}, {id: 'a3', name: 'Câline'}]);
  // Retiré ici, inchangé dans le cloud (mais autre animal modifié) → retiré.
  const removed = m(lot, {...lot, animals: [lot.animals[1]]}, {...lot, animals: [{...lot.animals[0], name: 'Rosette'}, {...lot.animals[1], weight: 610}]});
  assert.equal(removed.canMerge, true);assert.deepEqual(removed.merged.animals, [{id: 'a2', name: 'Bella', weight: 610}]);
  // Retiré ici, modifié dans le cloud → conflit.
  assert.deepEqual(m(lot, {...lot, animals: [lot.animals[1]]}, {...lot, animals: [{...lot.animals[0], name: 'Rosette II'}, lot.animals[1]]}).conflicts, ['animals']);
  // Même animal, champs différents des deux côtés → fusion de l'élément.
  const both = m(lot, {...lot, animals: [{...lot.animals[0], tag: 'FR01'}, lot.animals[1]]}, {...lot, animals: [{...lot.animals[0], name: 'Rose'}, lot.animals[1]]});
  assert.deepEqual(both.merged.animals[0], {id: 'a1', name: 'Rose', tag: 'FR01'});
  // Même champ d'un même animal → conflit.
  assert.deepEqual(m(lot, {...lot, animals: [{...lot.animals[0], name: 'X'}, lot.animals[1]]}, {...lot, animals: [{...lot.animals[0], name: 'Y'}, lot.animals[1]]}).conflicts, ['animals']);
});

test('tableaux sans id (coordonnées, étiquettes) : modifiés des deux côtés → conflit', () => {
  const base = {id: 'x', tags: ['a']};
  assert.deepEqual(m(base, {...base, tags: ['a', 'b']}, {...base, tags: ['c']}).conflicts, ['tags']);
  assert.equal(isIdArray([{id: 1}, {id: 1}]), false);
  assert.equal(mergeIdArrays([], [{id: 'a', v: 1}], [{id: 'a', v: 2}]), null);
});

test('suppression : appliquée si l’autre côté n’a rien changé, conflit sinon', () => {
  const deleted = m(parcel, parcel, {...parcel, deletedAt: 99});
  assert.equal(deleted.canMerge, true);assert.equal(deleted.merged.deletedAt, 99);
  const edited = m(parcel, {...parcel, culture: 'Orge'}, {...parcel, deletedAt: 99});
  assert.deepEqual(edited.conflicts, ['deletedAt']);
  assert.deepEqual(m(parcel, {...parcel, deletedAt: 50}, {...parcel, notes: 'x'}).conflicts, ['deletedAt']);
});

test('champ ajouté ou retiré', () => {
  // Ajouté ici, autre champ changé dans le cloud.
  const added = m(parcel, {...parcel, variety: 'Chevignon'}, {...parcel, surfaceHa: 11.5});
  assert.equal(added.canMerge, true);assert.equal(added.merged.variety, 'Chevignon');assert.equal(added.merged.surfaceHa, 11.5);
  // Retiré dans le cloud, inchangé ici → retiré.
  const {ilot, ...noIlot} = {...parcel, ilot: '3'};
  const removed = m({...parcel, ilot: '3'}, {...parcel, ilot: '3'}, noIlot);
  assert.equal(removed.canMerge, true);assert.equal('ilot' in removed.merged, false);
  void ilot;
  // Retiré dans le cloud, modifié ici → conflit.
  assert.deepEqual(m({...parcel, ilot: '3'}, {...parcel, ilot: '4'}, noIlot).conflicts, ['ilot']);
  // Ajouté des deux côtés avec des valeurs différentes → conflit ; vide d'un côté → l'autre.
  assert.deepEqual(m(parcel, {...parcel, variety: 'A'}, {...parcel, variety: 'B'}).conflicts, ['variety']);
  assert.equal(m(parcel, {...parcel, notes: 'Vu'}, {...parcel, notes: null}).merged.notes, 'Vu');
});

test('sans base : null (l’ancienne fusion reste utilisée)', () => {
  assert.equal(threeWayMerge(null, parcel, parcel), null);
  assert.equal(threeWayMerge({id: 'autre'}, parcel, parcel), null);
  assert.equal(syncBaseKey('ws1', 'parcelles', 'p1'), 'ws1::parcelles::p1');
});

test('écran de conflit : en trois voies, seuls les champs modifiés des deux côtés sont à choisir', () => {
  const local = {...parcel, culture: 'Orge', notes: 'ici'}, remote = {...parcel, culture: 'Maïs', surfaceHa: 12};
  const r = m({...parcel}, local, remote);
  const rows = conflictFieldRows({local, remote, conflictFields: r.conflicts, autoFields: r.autoFields, mergeMode: 'three-way'});
  const kinds = Object.fromEntries(rows.map(row => [row.key, [row.kind, row.suggested]]));
  assert.deepEqual(kinds.culture, ['conflict', null]);
  assert.deepEqual(kinds.surfaceHa, ['fill', 'remote']);
  assert.deepEqual(kinds.notes, ['fill', 'local']);
});
