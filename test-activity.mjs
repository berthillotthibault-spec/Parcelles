import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Store} from './state.js';
import {buildTimeline, filterTimeline, facets, timelineCsv, registerBlocks, fromAudit} from './activity.js';

function memoryStorage() { const data = new Map(); return {async init() {}, async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; }, async getStored(k) { return this.get(k); }, async set(k, v) { data.set(k, structuredClone(v)); }, async setIfCurrent(k, v) { data.set(k, structuredClone(v)); }, async backupPut() {}, async pruneBackups() {}, async blobDelete() {}, async blobGet() { return null; }}; }

test('journal local : entityType, entityId, action et auteur dans les détails', async () => {
  const store = new Store(memoryStorage()); await store.init();
  store.historyActor = () => 'paul@ex.fr';
  await store.upsert('parcelles', {id: 'p1', nom: 'Les Noues'});
  await store.upsert('interventions', {id: 'w1', parcelId: 'p1', type: 'Fauche', date: '2026-10-12'});
  await store.remove('interventions', 'w1');
  const [del, work, parcel] = store.snapshot().journal;
  assert.deepEqual([del.details.entityType, del.details.entityId, del.details.action], ['interventions', 'w1', 'delete']);
  assert.deepEqual([work.details.entityType, work.details.action], ['interventions', 'create']);
  assert.equal(parcel.details.entityId, 'p1');
  assert.equal(del.by, 'paul@ex.fr');
  await store.upsertMany('tasks', [{id: 't1', title: 'A'}]);
  assert.equal(store.snapshot().journal[0].details.entityId, 't1');
});

test('frise : local et cloud fusionnés, parcelle déduite, filtres et facettes', async () => {
  const entities = {'interventions:w1': {id: 'w1', parcelId: 'p1'}};
  const journal = [
    {id: 'a', type: 'modification', message: 'Travail créé', createdAt: 3000, by: 'paul@ex.fr', details: {entityType: 'interventions', entityId: 'w1', action: 'create'}},
    {id: 'b', type: 'modification', message: 'Parcelle modifiée', createdAt: 1000, details: {entityType: 'parcelles', entityId: 'p2', action: 'update'}}
  ];
  const audit = [{id: 'x', action: 'sign-in', entity: 'security', userId: 'u', email: 'ana@ex.fr', deviceId: 'd1', createdAt: 2000}];
  const rows = buildTimeline({journal, audit, devices: [{id: 'd1', name: 'iPhone d’Ana'}], deviceName: 'Cet appareil', lookup: (t, id) => entities[`${t}:${id}`]});
  assert.deepEqual(rows.map(r => r.id), ['local:a', 'cloud:x', 'local:b']);
  assert.equal(rows[0].parcelId, 'p1'); assert.equal(rows[2].parcelId, 'p2'); assert.equal(rows[1].device, 'iPhone d’Ana');
  assert.deepEqual(filterTimeline(rows, {person: 'ana@ex.fr'}).map(r => r.id), ['cloud:x']);
  assert.deepEqual(filterTimeline(rows, {parcelId: 'p1'}).map(r => r.id), ['local:a']);
  assert.deepEqual(filterTimeline(rows, {type: 'parcelles'}).map(r => r.id), ['local:b']);
  assert.deepEqual(filterTimeline(rows, {device: 'Cet appareil'}).length, 2);
  const day = new Date(3000); const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  assert.equal(filterTimeline(rows, {from: iso, to: iso}).length, 3);
  assert.equal(filterTimeline(rows, {from: '2099-01-01'}).length, 0);
  assert.deepEqual(facets(rows).people, ['ana@ex.fr', 'paul@ex.fr']);
  assert.equal(fromAudit({action: 'sync-error', entity: 'sync', details: {message: 'réseau'}, createdAt: 1}).message, 'sync-error : réseau');
});

test('exports CSV et PDF « Registre des modifications »', () => {
  const rows = [{id: 'l', source: 'local', at: Date.UTC(2026, 9, 12, 8), who: 'paul@ex.fr', device: 'Cet appareil', entityType: 'interventions', entityId: 'w1', action: 'create', parcelId: 'p1', message: 'Travail; "créé"'}];
  const csv = timelineCsv(rows, {parcelName: () => 'Les Noues'});
  assert.ok(csv.startsWith('﻿Date;Personne;Appareil;Origine;Type;Action;Parcelle;Description\r\n'));
  assert.match(csv, /;Travail;Création;Les Noues;"Travail; ""créé"""\r\n$/);
  const blocks = registerBlocks(rows, {filters: 'personne paul@ex.fr', parcelName: () => 'Les Noues'});
  assert.equal(blocks[0].text, 'Registre des modifications');
  assert.equal(blocks.find(b => b.type === 'table').rows[0][4], 'Les Noues');
  assert.ok(blocks.some(b => b.type === 'note' && /paul/.test(b.text)));
});
