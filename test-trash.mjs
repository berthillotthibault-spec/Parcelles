import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Store} from './state.js';
import {canPurgeTrash} from './permissions.js';
import {trashRows, trashGroups, filterTrash, deletedAgo, deletedBy, deletedLabel, relatedDeletions, emptyConfirmed} from './trash.js';

function memoryStorage() { const data = new Map(); return {async init() {}, async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; }, async getStored(k) { return this.get(k); }, async set(k, v) { data.set(k, structuredClone(v)); }, async setIfCurrent(k, v) { data.set(k, structuredClone(v)); }, async backupPut() {}, async pruneBackups() {}, async blobDelete() {}, async blobGet() { return null; }}; }
const day = (d, h = 10) => new Date(2026, 9, d, h).getTime();

test('groupement par type, filtre et recherche sans accents', () => {
  const data = {parcelles: [{id: 'p1', nom: 'Les Prés', deletedAt: day(10)}, {id: 'p2', nom: 'Ok'}], interventions: [{id: 'w1', type: 'Fauche', deletedAt: day(11)}, {id: 'w2', type: 'Semis', deletedAt: day(9)}]};
  const rows = trashRows(data, ['parcelles', 'interventions']);
  assert.deepEqual(rows.map(r => r.item.id), ['w1', 'p1', 'w2']);
  assert.deepEqual(trashGroups(rows), [{type: 'interventions', count: 2}, {type: 'parcelles', count: 1}]);
  const titleOf = (t, i) => i.nom || i.type;
  assert.deepEqual(filterTrash(rows, {type: 'interventions', titleOf}).map(r => r.item.id), ['w1', 'w2']);
  assert.deepEqual(filterTrash(rows, {query: 'pres', titleOf}).map(r => r.item.id), ['p1']);
});

test('« Supprimé il y a 3 j par X » : sync puis journal local', () => {
  assert.equal(deletedAgo(day(9), day(12, 8)), 'il y a 3 j');
  assert.equal(deletedAgo(day(11), day(12)), 'hier');
  assert.equal(deletedAgo(day(12, 1), day(12, 23)), 'aujourd’hui');
  const item = {id: 'w1', deletedAt: day(9)};
  const journal = [{by: 'paul@ex.fr', details: {entityType: 'interventions', entityId: 'w1', action: 'delete'}}];
  assert.equal(deletedBy('interventions', item, {journal, remoteAuthor: {email: 'ana@ex.fr', action: 'delete'}}), 'ana@ex.fr');
  assert.equal(deletedBy('interventions', item, {journal, remoteAuthor: {email: 'ana@ex.fr', action: 'update'}}), 'paul@ex.fr');
  assert.equal(deletedBy('interventions', {...item, modifiedEmail: 'zoe@ex.fr'}, {}), 'zoe@ex.fr');
  assert.equal(deletedLabel('interventions', item, {now: day(12), who: 'paul@ex.fr'}), 'Supprimé il y a 3 j par paul@ex.fr');
  assert.equal(deletedLabel('interventions', item, {now: day(12)}), 'Supprimé il y a 3 j');
});

test('restauration d’une parcelle : travaux et passages du même jour proposés, rien de restauré d’office', async () => {
  const store = new Store(memoryStorage()); await store.init();
  await store.upsert('parcelles', {id: 'p1', nom: 'Les Noues'});
  await store.upsert('interventions', {id: 'w1', parcelId: 'p1', type: 'Fauche', date: '2026-10-01'});
  await store.upsert('interventions', {id: 'w2', parcelId: 'p2', type: 'Semis', date: '2026-10-01'});
  await store.remove('interventions', 'w1'); await store.remove('interventions', 'w2'); await store.remove('parcelles', 'p1');
  const data = store.snapshot();
  data.grazingSessions = [{id: 'g1', parcelId: 'p1', deletedAt: data.parcelles[0].deletedAt}, {id: 'g2', parcelId: 'p1', deletedAt: data.parcelles[0].deletedAt - 3 * 864e5}];
  const parcel = data.parcelles.find(p => p.id === 'p1');
  assert.deepEqual(relatedDeletions(data, parcel).map(r => r.item.id), ['w1', 'g1']);
  await store.restore('parcelles', 'p1');
  assert.ok(store.get('interventions', 'w1', {includeDeleted: true}).deletedAt, 'le travail reste à la corbeille tant que l’utilisateur ne le choisit pas');
  assert.deepEqual(relatedDeletions(store.snapshot(), store.get('parcelles', 'p1')), []);
});

test('vider : saisie du nombre exact, purge réservée au propriétaire en cloud', () => {
  assert.ok(emptyConfirmed(' 12 ', 12));
  assert.ok(!emptyConfirmed('11', 12) && !emptyConfirmed('', 12) && !emptyConfirmed('0', 0));
  assert.ok(canPurgeTrash({cloud: false, role: 'viewer'}));
  assert.ok(canPurgeTrash({cloud: true, role: 'owner'}));
  for (const role of ['manager', 'editor', 'operator', 'viewer', undefined]) assert.ok(!canPurgeTrash({cloud: true, role}), String(role));
});
