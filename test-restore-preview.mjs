// n° 133 : aperçu de restauration, restauration sélective et cohérence avec le cloud (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {diffBackup, prepareCloudRestore, previewSentence, restorableItems, selectiveEntities} from './restore-preview.js';

const e = (id, updatedAt, extra = {}) => ({id, createdAt: 1, updatedAt, version: 1, deletedAt: null, ...extra});
const backup = {
  parcelles: [e('p1', 10, {nom: 'Les Noues'}), e('p2', 10, {nom: 'Grand Champ'}), e('p3', 10, {nom: 'Le Pré'}), e('pOld', 5, {nom: 'Ancienne', deletedAt: 4})],
  interventions: [e('w1', 10, {type: 'Semis'}), e('w2', 10, {type: 'Labour'})],
  syncConflicts: [e('c1', 1)]
};
const current = {
  parcelles: [e('p1', 10, {nom: 'Les Noues'}), e('p3', 20, {nom: 'Le Pré', notes: 'drainé'}), e('p4', 30, {nom: 'Nouvelle'}), e('pOld', 5, {nom: 'Ancienne', deletedAt: 4})],
  interventions: [e('w1', 12, {type: 'Semis'}), e('w2', 10, {type: 'Labour', deletedAt: 15})],
  queue: [{id: 'op1', entity: 'tasks', entityId: 't1', status: 'pending'}],
  preferences: {syncEnabled: true, workspaceId: 'ws1', cloudRole: 'owner'},
  metadata: {syncCursors: {ws1: 99}, lastSyncAt: 98}
};

test('diff par type, sur id et updatedAt', () => {
  const diff = diffBackup(current, backup);
  assert.deepEqual(diff.byType.parcelles, {added: ['p2'], changed: ['p3'], deletedSince: [], newer: ['p4']});
  assert.deepEqual(diff.byType.interventions, {added: [], changed: ['w1'], deletedSince: ['w2'], newer: []});
  assert.equal(diff.byType.syncConflicts, undefined, 'collections techniques ignorées');
  assert.deepEqual(diff.totals, {added: 1, changed: 2, deletedSince: 1, newer: 1});
  assert.equal(diffBackup(current, current).identical, true);
});

test('phrase d’aperçu en français', () => {
  const createdAt = new Date(2026, 8, 28, 9).getTime();
  assert.equal(previewSentence(diffBackup(current, backup), createdAt), 'Cette sauvegarde du 28/09 : +1 parcelle, 1 parcelle différente, 1 travail différent, 1 supprimé depuis, 1 créé ou rétabli depuis.');
  assert.equal(previewSentence(diffBackup(current, current), createdAt), 'Cette sauvegarde du 28/09 est identique à vos données actuelles.');
});

test('restauration sélective : versions de la sauvegarde, actives, champs apparus depuis remis à null', () => {
  const diff = diffBackup(current, backup);
  assert.deepEqual(restorableItems(diff, backup, 'parcelles').map(i => [i.id, i.kind, i.title]), [['p2', 'added', 'Grand Champ'], ['p3', 'changed', 'Le Pré']]);
  const out = selectiveEntities(current, backup, [{type: 'parcelles', id: 'p3'}, {type: 'interventions', id: 'w2'}, {type: 'parcelles', id: 'inconnue'}]);
  const p3 = out.find(x => x.type === 'parcelles').entities[0];
  assert.equal(p3.notes, null);assert.equal(p3.updatedAt, 10);assert.equal(p3.deletedAt, null);
  assert.equal(out.find(x => x.type === 'interventions').entities[0].deletedAt, null, 'une fiche supprimée depuis revient');
  assert.equal(out.reduce((n, g) => n + g.entities.length, 0), 2);
  assert.equal(backup.parcelles[2].notes, undefined, 'sauvegarde non modifiée');
});

test('restauration complète dans un espace cloud : réglages de synchro gardés, différences en file, créées depuis à la corbeille', () => {
  const restoreState = {...structuredClone(backup), preferences: {syncEnabled: false, workspaceId: '', mapLayer: 'osm'}, metadata: {syncCursors: {}}, queue: [{id: 'vieux'}]};
  const {data, ops} = prepareCloudRestore(current, restoreState, {now: 1000});
  assert.equal(data.preferences.syncEnabled, true);assert.equal(data.preferences.workspaceId, 'ws1');assert.equal(data.preferences.mapLayer, 'osm');
  assert.deepEqual(data.metadata.syncCursors, {ws1: 99});
  assert.deepEqual(data.queue.map(q => q.id), ['op1'], 'file en cours conservée, ancienne file de la sauvegarde ignorée');
  const byId = Object.fromEntries(ops.map(op => [op.entityId, op]));
  assert.equal(byId.p4.action, 'delete');assert.equal(data.parcelles.find(p => p.id === 'p4').deletedAt, 1000);
  assert.equal(byId.p3.action, 'update');assert.equal(byId.p3.payload.updatedAt, 1000);
  assert.equal(byId.p2.action, 'create');
  assert.equal(byId.w2.action, 'update');assert.equal(data.interventions.find(w => w.id === 'w2').deletedAt, null);
  assert.equal(byId.p1, undefined, 'identique : rien à envoyer');assert.equal(byId.pOld, undefined);
  assert.ok(ops.every(op => op.payload.version > 1));
});
