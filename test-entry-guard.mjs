import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {workEntryWarnings, worksEntryWarnings, warningsSignature} from './entry-guard.js';

const w = (id, parcelId, type, date, extra = {}) => ({id, parcelId, type, date, status: 'Terminé', ...extra});
function farm(extra = []) {
  return {...emptyState(),
    parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 12}, {id: 'p2', nom: 'Le Clos', culture: 'Blé tendre', surfaceHa: 8}],
    interventions: [
      w('a', 'p1', 'Désherbage', '2025-03-10', {product: 'Axial Pratic', dose: 0.9, doseUnit: 'L/ha'}),
      w('b', 'p2', 'Désherbage', '2025-03-12', {product: 'axial pratic', dose: 1, doseUnit: 'L/ha'}),
      w('c', 'p1', 'Désherbage', '2024-03-15', {product: 'Axial Pratic', dose: 1.2, doseUnit: 'L/ha'}),
      w('d', 'p1', 'Fertilisation', '2025-02-20', {product: 'Ammonitrate', dose: 150, doseUnit: 'kg/ha'}),
      w('e', 'p2', 'Fertilisation', '2025-02-21', {product: 'Ammonitrate', dose: 160, doseUnit: 'kg/ha'}),
      ...extra
    ]};
}
const codes = list => list.map(x => x.code);

test('saisie ordinaire : rien à signaler', () => {
  assert.deepEqual(workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic', dose: 1.1, doseUnit: 'L/ha', surfaceWorked: 12}), []);
  assert.deepEqual(workEntryWarnings(null, {}), []);
});

test('surface travaillée plus grande que la parcelle', () => {
  const [x] = workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Labour', date: '2026-03-10', surfaceWorked: '120'});
  assert.equal(x.code, 'surface');
  assert.equal(x.field, 'surfaceWorked');
  assert.equal(x.message, 'Surface travaillée 120 ha pour Les Brosses, qui fait 12 ha.');
  assert.deepEqual(workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Labour', date: '2026-03-10', surfaceWorked: 12.5}), [], 'marge de 5 %');
});

test('dose ×10 ou ÷10 face au même produit (casse ignorée), même unité seulement', () => {
  const high = workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'AXIAL PRATIC', dose: '10', doseUnit: 'L/ha'});
  assert.deepEqual(codes(high), ['dose']);
  assert.match(high[0].message, /^Dose 10 L\/ha : d’habitude 1 L\/ha pour AXIAL PRATIC \(3 saisies\)\. Vérifiez la virgule ou l’unité\.$/);
  assert.deepEqual(codes(workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic', dose: '0,1', doseUnit: 'L/ha'})), ['dose']);
  assert.deepEqual(workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic', dose: 1000, doseUnit: 'mL/ha'}), [], 'autre unité : pas de comparaison');
});

test('sans historique du produit : même culture et même type', () => {
  const x = workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Fertilisation', date: '2026-03-01', dose: 1500, doseUnit: 'kg/ha'});
  assert.deepEqual(codes(x), ['dose']);
  assert.match(x[0].message, /d’habitude 155 kg\/ha pour Fertilisation sur Blé tendre \(2 saisies\)/);
  assert.deepEqual(workEntryWarnings(farm(), {id: 'n', parcelId: 'p1', type: 'Semis', date: '2026-03-01', dose: 1500, doseUnit: 'kg/ha'}), [], 'aucun historique');
});

test('même produit déjà appliqué ou prévu à moins de 7 jours sur la parcelle', () => {
  const extra = [w('r', 'p1', 'Désherbage', '2026-03-06', {product: 'Axial Pratic', dose: 1, doseUnit: 'L/ha'})];
  const [x] = workEntryWarnings(farm(extra), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'axial pratic', dose: 1, doseUnit: 'L/ha'});
  assert.equal(x.code, 'repeat');
  assert.equal(x.message, 'axial pratic déjà appliqué sur Les Brosses le 6 mars (Désherbage).');
  const planned = [w('r', 'p1', 'Désherbage', '', {status: 'À faire', plannedDate: '2026-03-14', product: 'Axial Pratic'})];
  assert.match(workEntryWarnings(farm(planned), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic'})[0].message, /déjà prévu .* le 14 mars/);
  assert.deepEqual(workEntryWarnings(farm(extra), {id: 'n', parcelId: 'p2', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic'}), [], 'autre parcelle');
  assert.deepEqual(workEntryWarnings(farm(extra), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-13', product: 'Axial Pratic'}), [], '7 jours d’écart');
  const cancelled = [w('r', 'p1', 'Désherbage', '2026-03-09', {status: 'Annulé', product: 'Axial Pratic'}), w('s', 'p1', 'Désherbage', '2026-03-09', {deletedAt: 1, product: 'Axial Pratic'})];
  assert.deepEqual(workEntryWarnings(farm(cancelled), {id: 'n', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic'}), []);
});

test('le travail modifié et ceux du même lot ne se comparent pas à eux-mêmes', () => {
  const self = w('r', 'p1', 'Désherbage', '2026-03-10', {product: 'Axial Pratic'});
  assert.deepEqual(workEntryWarnings(farm([self]), {...self, dose: 1, doseUnit: 'L/ha'}), []);
  const batch = [{id: 'x1', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic', surfaceWorked: 99}, {id: 'x2', parcelId: 'p1', type: 'Désherbage', date: '2026-03-10', product: 'Axial Pratic', surfaceWorked: 99}];
  const out = worksEntryWarnings(farm(batch), batch);
  assert.deepEqual(codes(out), ['surface'], 'message identique dédoublonné, pas de « déjà appliqué » entre travaux du lot');
});

test('signature : un second appui ne confirme que les mêmes points', () => {
  const a = [{message: 'x'}, {message: 'y'}];
  assert.equal(warningsSignature(a), 'x\ny');
  assert.notEqual(warningsSignature(a), warningsSignature([{message: 'x'}]));
  assert.equal(warningsSignature(null), '');
});

test('relecture : un travail reporté est daté par son échéance', () => {
  const postponed = [w('r', 'p1', 'Traitement', '2026-11-01', {status: 'À faire', plannedDate: '2026-11-20', product: 'Prosaro'})];
  assert.deepEqual(codes(workEntryWarnings(farm(postponed), {id: 'n', parcelId: 'p1', type: 'Traitement', date: '2026-11-19', product: 'Prosaro'})), ['repeat']);
  assert.deepEqual(workEntryWarnings(farm(postponed), {id: 'n', parcelId: 'p1', type: 'Traitement', date: '2026-11-03', product: 'Prosaro'}), []);
});
