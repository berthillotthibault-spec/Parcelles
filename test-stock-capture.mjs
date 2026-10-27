import test from 'node:test';
import assert from 'node:assert/strict';
import {eanValid, itemByEan, validateExtraction, similarity, matchLine, matchLines, entryMovement} from './stock-capture.js';

const items = [{id: 'a', name: 'Adengo', unit: 'L', amm: '2090016'}, {id: 'b', name: 'Ammonitrate 33,5', unit: 'kg', ean: '3123450000006'}, {id: 'c', name: 'Semences P9234', unit: 'dose'}];

test('EAN : clé de contrôle et dictionnaire local', () => {
  assert.equal(eanValid('4006381333931'), true);
  assert.equal(eanValid('4006381333932'), false);
  assert.equal(eanValid('96385074'), true);
  assert.equal(eanValid('abc'), false);
  assert.equal(itemByEan(items, '3123 4500 0000 6').id, 'b');
  assert.equal(itemByEan(items, '4006381333931'), null);
});

test('réponse d’extraction validée et nettoyée', () => {
  const lines = validateExtraction({lignes: [
    {produit: 'ADENGO 5L', quantité: '10', unité: 'L', prix: '48,50', AMM: '2090016', lot: 'L23'},
    {produit: '', quantité: 3}, {produit: 'Gratuit', quantité: 0}, null,
    {product: 'Ammonitrate', quantity: 1200, unit: 'kg', price: 0.42}]});
  assert.deepEqual(lines[0], {product: 'ADENGO 5L', quantity: 10, unit: 'L', unitPrice: 48.5, amm: '2090016', lot: 'L23', supplier: '', expiryDate: ''});
  assert.equal(lines.length, 2);
  assert.throws(() => validateExtraction({foo: 1}), /lignes/);
});

test('correspondance floue avec les articles existants', () => {
  assert.equal(similarity('Adengo', 'ADENGO'), 1);
  assert.ok(similarity('Ammonitrate 33.5', 'Ammonitrate 33,5') >= 0.85);
  assert.ok(similarity('Glyphosate', 'Semences P9234') < 0.5);
  assert.equal(matchLine({product: 'Herbicide maïs', amm: '2090016'}, items).by, 'AMM');
  assert.equal(matchLine({product: 'AMMONITRATE 33,5 % big bag'}, items).item.id, 'b');
  assert.equal(matchLine({product: 'Glyphosate 360'}, items).item, null);
  assert.equal(matchLines([{product: 'Adengo'}], items)[0].item.id, 'a');
});

test('mouvement d’entrée pour une ligne validée', () => {
  const m = entryMovement({product: 'ADENGO 5L', quantity: 10, unitPrice: 48.5, lot: 'L23', amm: '2090016'}, 'a', {date: '2026-10-12'});
  assert.deepEqual(m, {stockItemId: 'a', type: 'Entrée', quantity: 10, unitPrice: 48.5, date: '2026-10-12', lotNumber: 'L23', note: 'Facture : ADENGO 5L · lot L23 · AMM 2090016'});
});

test('n° 73 : fournisseur et péremption lus sur la facture', async () => {
  const {isoDay} = await import('./stock-capture.js');
  assert.equal(isoDay('2027-03-31'), '2027-03-31');
  assert.equal(isoDay('05/02/2028'), '2028-02-05');
  assert.equal(isoDay('02/2028'), '2028-02-29');
  assert.equal(isoDay('31/02/2028'), '');
  assert.equal(isoDay('bientôt'), '');
  const [line] = validateExtraction({fournisseur: 'Coop Fictive', lignes: [{produit: 'X', quantité: 2, lot: 'L1', péremption: '12/2027'}]});
  assert.equal(line.supplier, 'Coop Fictive'); assert.equal(line.expiryDate, '2027-12-31');
  const m = entryMovement(line, 'a', {date: '2026-10-12'});
  assert.deepEqual([m.lotNumber, m.supplier, m.expiryDate], ['L1', 'Coop Fictive', '2027-12-31']);
  assert.equal('supplier' in entryMovement({product: 'Y', quantity: 1}, 'a', {date: '2026-10-12'}), false);
});
