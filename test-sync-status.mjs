import assert from 'node:assert/strict';
import {test} from 'node:test';
import {syncPillState, describeOperation, readableQueue, staleSyncReminder, durationAgo, SYNC_STALE_MS} from './sync-status.js';

const NOW = Date.UTC(2026, 9, 8, 12);
const H = 3600e3;
const data = (extra = {}) => ({
  parcelles: [{id: 'p1', nom: 'Les Grandes Terres'}],
  interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis maïs'}],
  queue: [], syncConflicts: [], metadata: {}, ...extra
});

test('relative durations read naturally in French', () => {
  assert.equal(durationAgo(20e3), 'à l’instant');
  assert.equal(durationAgo(3 * 60e3), 'il y a 3 min');
  assert.equal(durationAgo(2 * H), 'il y a 2 h');
  assert.equal(durationAgo(26 * H), 'il y a 1 jour');
  assert.equal(durationAgo(80 * H), 'il y a 3 jours');
});

test('an operation is described in plain words with parcel, wait and attempts', () => {
  const op = {id: 'o1', entity: 'interventions', entityId: 'w1', action: 'update', status: 'pending', attempts: 3, firstQueuedAt: NOW - 2 * H, createdAt: NOW - H};
  const row = describeOperation(op, data(), NOW);
  assert.equal(row.title, 'Semis maïs — Les Grandes Terres');
  assert.equal(row.detail, 'en attente depuis 2 h · 3 essais');
  assert.equal(row.kind, 'Travail · modification');
  const single = describeOperation({...op, attempts: 1, status: 'error', lastError: 'boom'}, data(), NOW);
  assert.equal(single.detail, 'en erreur depuis 2 h · 1 essai');assert.equal(single.error, 'boom');
  const deleted = describeOperation({id: 'o2', entity: 'tasks', entityId: 'gone', action: 'delete', status: 'pending', createdAt: NOW}, data(), NOW);
  assert.equal(deleted.title, 'Tâche');
});

test('readable queue hides sent operations and lists errors first, oldest first', () => {
  const queue = [
    {id: 'a', entity: 'interventions', entityId: 'w1', status: 'pending', createdAt: NOW - H},
    {id: 'b', entity: 'parcelles', entityId: 'p1', status: 'done', createdAt: NOW - 5 * H},
    {id: 'c', entity: 'parcelles', entityId: 'p1', status: 'error', createdAt: NOW - 10 * 60e3},
    {id: 'd', entity: 'tasks', entityId: 't', status: 'pending', createdAt: NOW - 3 * H}
  ];
  const input = data({queue}), before = structuredClone(input);
  assert.deepEqual(readableQueue(input, NOW).map(r => r.id), ['c', 'd', 'a']);
  assert.deepEqual(input, before, 'reading never mutates the queue');
});

test('the pill keeps offline and read-only states first, then the five sync states', () => {
  const queue = [{id: 'a', status: 'pending'}, {id: 'b', status: 'pending'}, {id: 'c', status: 'pending'}];
  assert.equal(syncPillState({data: data({queue}), offline: true, cloud: true, now: NOW}).label, 'Hors connexion');
  assert.equal(syncPillState({data: data(), schemaLock: true, now: NOW}).label, 'Lecture seule · version plus récente');
  assert.equal(syncPillState({data: data(), tabReadOnly: true, now: NOW}).label, 'Lecture seule · autre fenêtre');
  assert.equal(syncPillState({data: data(), viewer: true, cloud: true, now: NOW}).label, 'Lecture seule · Cloud');
  const conflicts = [{status: 'open'}, {status: 'open'}, {status: 'resolved'}];
  assert.deepEqual(['conflict', '2 conflits'], Object.values((({tone, label}) => ({tone, label}))(syncPillState({data: data({syncConflicts: conflicts, queue: [{status: 'error'}]}), cloud: true, now: NOW}))));
  assert.equal(syncPillState({data: data({queue: [{status: 'error'}]}), cloud: true, now: NOW}).label, 'Erreur — toucher pour réessayer');
  assert.equal(syncPillState({data: data({metadata: {lastSyncError: 'x'}}), cloud: true, now: NOW}).tone, 'error');
  assert.equal(syncPillState({data: data({metadata: {lastSyncError: 'x'}}), cloud: false, now: NOW}).tone, 'local', 'a stale error without cloud is not shown');
  assert.equal(syncPillState({data: data({queue}), cloud: true, syncing: {done: 4, total: 12}, now: NOW}).label, 'Envoi… 4/12');
  assert.equal(syncPillState({data: data({queue}), cloud: true, now: NOW}).label, '3 en attente');
  assert.equal(syncPillState({data: data({metadata: {lastSyncAt: NOW - 3 * 60e3}}), cloud: true, now: NOW}).label, 'Synchronisé · il y a 3 min');
  assert.equal(syncPillState({data: data(), cloud: false, now: NOW}).label, 'À jour');
});

test('Today reminder appears only after 48 h without sync while the cloud is active', () => {
  assert.equal(staleSyncReminder({data: data({metadata: {lastSyncAt: NOW - SYNC_STALE_MS - 1}}), cloudActive: false, now: NOW}), null);
  assert.equal(staleSyncReminder({data: data({metadata: {lastSyncAt: NOW - 47 * H}}), cloudActive: true, now: NOW}), null);
  assert.equal(staleSyncReminder({data: data({metadata: {lastSyncAt: NOW - 73 * H}}), cloudActive: true, now: NOW}).days, 3);
  assert.equal(staleSyncReminder({data: data(), cloudActive: true, now: NOW}), null, 'never synced and nothing waiting');
  const old = staleSyncReminder({data: data({queue: [{status: 'pending', firstQueuedAt: NOW - 50 * H}]}), cloudActive: true, now: NOW});
  assert.equal(old.never, true);assert.equal(old.days, 2);
});
