import test from 'node:test';
import assert from 'node:assert/strict';
import {herdRowsFromTable,guessColumns,herdImportPreview,herdImportEntities} from './herd.js';

test('feuille Excel : titre ignoré, dates Excel converties, colonnes de sortie reconnues', () => {
  const t = herdRowsFromTable([['Inventaire du cheptel au 01/11/2026'], [], ['N° national', 'Nom', 'Sexe', 'Date de naissance', 'Date de sortie', 'Motif de sortie'], ['FR1234567890', 'Bella', 'F', new Date(2020, 2, 4), '', ''], ['FR1234567891', 'Rex', 'M', '12/05/2019', '02/10/2026', 'Vente']]);
  assert.equal(t.rows.length, 2);
  const map = guessColumns(t.headers);
  assert.equal(map.nationalId, 'N° national'); assert.equal(map.exitDate, 'Date de sortie'); assert.equal(map.exitReason, 'Motif de sortie');
  assert.equal(t.rows[0]['Date de naissance'], '2020-03-04');
  const p = herdImportPreview({animals: []}, t.rows, map, {today: '2026-11-11'});
  assert.equal(p.create, 2, JSON.stringify(p.rows));
  const w = herdImportEntities({animals: []}, p, {newId: (() => { let i = 0; return () => `a${++i}`; })(), today: '2026-11-11'});
  assert.equal(w[1].exitDate, '2026-10-02'); assert.equal(w[1].exitReason, 'Vente');
});

test('inventaire complet : un animal présent absent du fichier est marqué sorti', () => {
  const state = {animals: [{id: 'x', nationalId: 'FR1234567899', name: 'Vieille'}, {id: 'y', nationalId: 'FR1234567890'}]};
  const rows = [{'N° national': 'FR1234567890'}];
  const map = guessColumns(['N° national']);
  const p = herdImportPreview(state, rows, map, {today: '2026-11-11', fullInventory: true});
  assert.equal(p.exit, 1); assert.equal(p.update, 1);
  const w = herdImportEntities(state, p, {newId: () => 'n', today: '2026-11-11'});
  assert.equal(w.find(a => a.id === 'x').exitDate, '2026-11-11');
  assert.equal(herdImportPreview(state, rows, map, {today: '2026-11-11'}).exit, 0);
});
