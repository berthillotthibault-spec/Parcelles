// n° 138 : export ouvert lisible sans l'application (dossier lisible/ du ZIP complet).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {frDate, frNumber, parcelsGeoJson, readableEntries, readableTables, toCsv} from './open-export.js';
import {createCompleteBackup, parseCompleteBackup} from './import-export.js';
import {readZip} from './zip-lite.js';
import {emptyState} from './state.js';

const state = {...emptyState(),
  exploitation: {nom: 'Ferme fictive'},
  parcelles: [
    {id: 'p1', nom: 'Les Noues', surfaceHa: 11.3, culture: 'Blé tendre', commune: 'Villefictive', ownershipType: 'own', geometry: {type: 'Polygon', coordinates: [[[5, 46], [5.01, 46], [5.01, 46.01], [5, 46]]]}},
    {id: 'p2', nom: 'Le "Pré"; bas', surfaceHa: 4.6, ownershipType: 'rented'},
    {id: 'p3', nom: 'Supprimée', deletedAt: 5}],
  interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-10-08', dose: 2.5, doseUnit: 'L/ha', cost: 12.5, status: 'Terminé'},
    {id: 'w2', parcelId: 'p9', type: 'Labour', date: '2026-09-01'}],
  grazingSessions: [{id: 'g1', parcelId: 'p2', animalType: 'Vaches', animalsCount: 24, startDate: '2026-09-20'}],
  stockItems: [{id: 's1', name: 'Ammonitrate', unit: 'kg', quantity: 500}],
  maintenanceRecords: [{id: 'm1', equipmentId: 'e1', type: 'Vidange', date: '2026-08-02', cost: 80}],
  materiels: [{id: 'e1', nom: 'Tracteur'}],
  clients: [{id: 'c1', name: 'GAEC du Bois', phone: '06 00 00 00 00'}]
};

test('formats français : dates JJ/MM/AAAA, virgule décimale', () => {
  assert.equal(frDate('2026-10-08'), '08/10/2026');
  assert.equal(frDate(new Date(2026, 0, 2, 12).getTime()), '02/01/2026');
  assert.equal(frDate(''), '');
  assert.equal(frNumber(11.3), '11,3');assert.equal(frNumber(null), '');
});

test('CSV : « ; », BOM, guillemets échappés, noms de parcelles au lieu des id, corbeille exclue', () => {
  const tables = Object.fromEntries(readableTables(state).map(t => [t.file, toCsv(t.columns, t.rows)]));
  assert.deepEqual(Object.keys(tables).sort(), ['clients.csv', 'entretiens.csv', 'mouvements-stock.csv', 'parcelles.csv', 'paturage.csv', 'stocks.csv', 'travaux.csv']);
  const parcels = tables['parcelles.csv'];
  assert.ok(parcels.startsWith('﻿Nom;Surface (ha);Culture'));
  assert.match(parcels, /\r\nLes Noues;11,3;Blé tendre;Villefictive;;Propriété;/);
  assert.match(parcels, /"Le ""Pré""; bas";4,6/);
  assert.doesNotMatch(parcels, /Supprimée/);
  const work = tables['travaux.csv'];
  assert.match(work, /08\/10\/2026;;Terminé;[^;]*;Semis;Les Noues;Blé tendre;;2,5;L\/ha;;12,5/);
  assert.match(work, /Labour;Parcelle supprimée/);
  assert.doesNotMatch(work, /\bp1\b/);
  assert.match(tables['paturage.csv'], /"Le ""Pré""; bas";Vaches;24;20\/09\/2026/);
  assert.match(tables['entretiens.csv'], /02\/08\/2026;Tracteur;Vidange/);
});

test('GeoJSON des parcelles avec contour seulement', () => {
  const geo = JSON.parse(parcelsGeoJson(state));
  assert.equal(geo.features.length, 1);assert.equal(geo.features[0].properties.nom, 'Les Noues');
});

test('classeur .xlsx multi-onglets avec le vrai SheetJS, absent sans lui', () => {
  const without = readableEntries(state).map(e => e.name);
  assert.ok(!without.includes('lisible/parcelles.xlsx'));assert.ok(without.includes('lisible/LISEZMOI.txt'));
  const sandbox = {};vm.runInNewContext(fs.readFileSync(new URL('./xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
  const XLSX = sandbox.XLSX;assert.ok(XLSX?.write, 'SheetJS chargé');
  const entries = readableEntries(state, {xlsx: XLSX});
  const book = XLSX.read(entries.find(e => e.name === 'lisible/parcelles.xlsx').data, {type: 'array'});
  assert.deepEqual([...book.SheetNames], ['Parcelles', 'Travaux', 'Pâturage', 'Stocks', 'Mouvements de stock', 'Entretiens', 'Clients']);
  assert.equal(XLSX.utils.sheet_to_json(book.Sheets.Travaux).find(r => r.Type === 'Semis').Parcelle, 'Les Noues');
  assert.match(entries.find(e => e.name === 'lisible/LISEZMOI.txt').data, /parcelles\.xlsx regroupe/);
});

test('ZIP complet : dossier lisible/ présent et ignoré par parseCompleteBackup', async () => {
  const store = {snapshot: () => structuredClone(state), storage: {blobGet: async () => null}};
  const {blob, manifest} = await createCompleteBackup(store);
  const names = (await readZip(await blob.arrayBuffer())).map(e => e.name);
  for (const name of ['manifest.json', 'state.json', 'lisible/parcelles.csv', 'lisible/travaux.csv', 'lisible/parcelles.geojson', 'lisible/LISEZMOI.txt']) assert.ok(names.includes(name), name);
  assert.ok(manifest.readable.includes('lisible/clients.csv'));
  const parsed = await parseCompleteBackup(blob);
  assert.equal(parsed.data.parcelles.length, 3);assert.deepEqual(parsed.blobs, []);
  assert.equal(parsed.data.interventions[0].parcelId, 'p1', 'les données restaurées viennent de state.json');
});
