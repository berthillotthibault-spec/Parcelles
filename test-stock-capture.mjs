import test from 'node:test';
import assert from 'node:assert/strict';
import {eanValid, itemByEan, validateExtraction, similarity, matchLine, matchLines, entryMovement, rememberSupplierRef, convertLineToItem, MAX_SUPPLIER_REFS} from './stock-capture.js';

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

// ---------- n° W1 : mémoire fournisseur, conditionnements, lecture du texte collé ----------

test('W1 : la référence retenue chez ce fournisseur passe avant l’AMM et le nom', () => {
  const remembered = rememberSupplierRef(items[2], {supplier: 'Agro Négoce Fictif SAS', label: 'ADENGO 5L', factor: 20, unit: 'L'});
  assert.equal(items[2].supplierRefs, undefined, 'copie, l’article d’origine est intact');
  const list = [items[0], items[1], remembered];
  const hit = matchLine({product: 'Adengo 5L', amm: '2090016'}, list, {supplier: 'AGRO NEGOCE FICTIF SAS'});
  assert.equal(hit.item.id, 'c'); assert.equal(hit.by, 'fournisseur');
  // Même désignation chez un autre fournisseur : la référence n’est pas appliquée.
  const other = matchLine({product: 'ADENGO 5L', amm: '2090016'}, list, {supplier: 'Autre Coop'});
  assert.equal(other.item.id, 'a'); assert.equal(other.by, 'AMM');
  // Le fournisseur de la ligne suffit, et matchLines transmet l’option.
  assert.equal(matchLine({product: 'ADENGO 5L', supplier: 'agro negoce fictif sas'}, list).by, 'fournisseur');
  assert.equal(matchLines([{product: 'ADENGO 5L'}], list, {supplier: 'Agro Négoce Fictif SAS'})[0].item.id, 'c');
});

test('W1 : rememberSupplierRef remplace un doublon et garde 50 références', () => {
  let item = {id: 'x', name: 'X'};
  item = rememberSupplierRef(item, {supplier: 'Coop', label: 'Sac X', factor: 25, unit: 'kg'});
  item = rememberSupplierRef(item, {supplier: 'COOP', label: 'sac x', factor: 50, unit: 'kg'});
  assert.equal(item.supplierRefs.length, 1); assert.equal(item.supplierRefs[0].factor, 50);
  for (let i = 0; i < 60; i++) item = rememberSupplierRef(item, {supplier: 'Coop', label: `Produit ${i}`});
  assert.equal(item.supplierRefs.length, MAX_SUPPLIER_REFS);
  assert.equal(item.supplierRefs.at(-1).label, 'Produit 59');
  assert.deepEqual(rememberSupplierRef(item, {supplier: '', label: 'Y'}).supplierRefs.length, MAX_SUPPLIER_REFS);
});

test('W1 : convertLineToItem ramène le conditionnement à l’unité de l’article', () => {
  const r = convertLineToItem({product: 'Bidon 5 L', quantity: 4, unit: 'bidon', unitPrice: 45, pack: {factor: 5, unit: 'L', count: null, raw: 'bidon 5 L'}}, {unit: 'L'});
  assert.deepEqual(r, {quantity: 20, unitPrice: 9, converted: true, why: '4 × 5 L = 20 L'});
  // Ligne déjà convertie par doc-text (20 L) : rien à refaire.
  assert.equal(convertLineToItem({quantity: 20, unit: 'L', unitPrice: 9, pack: {factor: 20, unit: 'L', count: 4}}, {unit: 'litres'}).converted, false);
  const t = convertLineToItem({quantity: 12000, unit: 'kg', unitPrice: 0.38}, {unit: 't'});
  assert.equal(t.quantity, 12); assert.equal(t.unitPrice, 380);
  // Unité incompatible : pas d’exception, valeurs d’origine et raison.
  const bad = convertLineToItem({quantity: 20, unit: 'L', unitPrice: 9}, {unit: 'kg'});
  assert.deepEqual(bad, {quantity: 20, unitPrice: 9, converted: false, why: 'Unité incompatible'});
  assert.equal(convertLineToItem({quantity: 'abc'}, {unit: 'L'}).converted, false);
});

// Faux DOM minimal : seuls les éléments touchés par « coller › lire › tableau › valider ».
function fakeUi({text, stockItems}) {
  const els = new Map(), listen = () => {const l = {}; return {l, addEventListener(t, f) {(l[t] ??= []).push(f);}};};
  const el = id => {if (!els.has(id)) els.set(id, {id, innerHTML: '', ...listen(), querySelectorAll: () => []}); return els.get(id);};
  const err = {textContent: '', hidden: true};
  const field = value => ({value, ...listen(), dispatchEvent() {}});
  const form = {id: 'stock-capture-form', isConnected: true, ...listen(), querySelector: s => (s === '.form-error' ? err : null), querySelectorAll: () => [],
    elements: {photo: field(''), docText: field(''), linesJson: field(''), ean: field(''), consent: {checked: false}}};
  els.set('stock-capture-form', form);
  let rows = [];
  const doc = {getElementById: el, querySelectorAll: s => (s.startsWith('#sc-result') ? rows : []), addEventListener() {}, removeEventListener() {}};
  const st = {stockItems, stockMovements: [], preferences: {}};
  const calls = {movements: [], upserts: [], modal: 0, closed: 0, toasts: []};
  const store = {upsert: async (type, entity) => {calls.upserts.push({type, entity}); if (type === 'stockItems') st.stockItems = [...st.stockItems.filter(i => i.id !== entity.id), entity]; return entity;},
    recordStockMovement: async m => calls.movements.push(m), storage: {blobPut: async () => {}}};
  const win = {navigator: {clipboard: {readText: async () => text}}};
  const noFetch = () => {throw new Error('fetch interdit dans ce chemin');};
  return {els, el, err, form, doc, calls, win, store, st, noFetch, setRows: r => {rows = r;},
    deps: {store, state: () => st, modal: () => calls.modal++, closeModal: () => calls.closed++, toast: (m) => calls.toasts.push(m), doc, win, fetchImpl: noFetch}};
}
const PHYTO_TEXT = `AGRO NEGOCE FICTIF SAS
FACTURE N° FA-2026-0412
Date facture : 03/10/2026
4 x ADENGO 5L  225,00  900,00
RPD  18,40
Total HT  918,40
TVA 20 %  918,40  183,68
Net à payer  1 102,08 €`;

test('W1 : coller › lire › tableau, puis validation, sans aucun appel réseau', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {throw new Error('fetch interdit dans ce chemin');};
  try {
    const {createStockCaptureUI} = await import('./stock-capture-ui.js');
    const ui = fakeUi({text: PHYTO_TEXT, stockItems: [{id: 'a', name: 'Adengo', unit: 'L', amm: '2090016'}]});
    createStockCaptureUI(ui.deps).open();
    assert.equal(ui.calls.modal, 1);
    for (const f of ui.el('sc-paste').l.click) await f();
    assert.equal(ui.err.hidden, true, ui.err.textContent);
    assert.equal(ui.form.elements.docText.value, PHYTO_TEXT);
    const html = ui.el('sc-result').innerHTML;
    assert.match(html, /Facture/); assert.match(html, /AGRO NEGOCE FICTIF SAS/); assert.match(html, /n° FA-2026-0412/);
    assert.match(html, /totaux cohérents/);
    assert.match(html, /4 × 5 L = 20 L/);
    assert.match(html, /Retenir pour ce fournisseur/);
    assert.equal((html.match(/data-line=/g) || []).length, 1, 'le RPD reste en frais');
    // Validation : la ligne cochée crée l’entrée et retient la référence fournisseur.
    const tr = {dataset: {line: '0'}, querySelector: s => ({'.sc-ok': {checked: true}, '.sc-qty': {value: '20'}, '.sc-price': {value: '45'}, '.sc-item': {value: 'a'}, '.sc-remember': {checked: true}})[s]};
    ui.setRows([tr]);
    await ui.el('sc-lines-save').onclick();
    assert.equal(ui.calls.movements.length, 1);
    assert.equal(ui.calls.movements[0].quantity, 20); assert.equal(ui.calls.movements[0].supplier, 'AGRO NEGOCE FICTIF SAS');
    const ref = ui.calls.upserts.find(u => u.type === 'stockItems')?.entity.supplierRefs?.[0];
    assert.deepEqual([ref.supplier, ref.label], ['AGRO NEGOCE FICTIF SAS', 'ADENGO 5L']);
    assert.equal(ui.calls.closed, 1);
    // Relecture : la ligne est maintenant reconnue par la mémoire fournisseur.
    const again = fakeUi({text: PHYTO_TEXT, stockItems: ui.st.stockItems});
    createStockCaptureUI(again.deps).open();
    again.form.elements.docText.value = PHYTO_TEXT;
    for (const f of again.el('sc-read').l.click) f();
    assert.match(again.el('sc-result').innerHTML, /Reconnu \(déjà associé\)/);
    assert.doesNotMatch(again.el('sc-result').innerHTML, /Retenir pour ce fournisseur/);
  } finally {globalThis.fetch = savedFetch;}
});

test('W1 : texte vide en erreur en ligne, pesée en récapitulatif', async () => {
  const {createStockCaptureUI} = await import('./stock-capture-ui.js');
  const ui = fakeUi({text: '', stockItems: []});
  createStockCaptureUI(ui.deps).open();
  for (const f of ui.el('sc-read').l.click) f();
  assert.equal(ui.err.hidden, false); assert.match(ui.err.textContent, /Aucune ligne lisible/);
  ui.form.elements.docText.value = 'SILO FICTIF\nTICKET DE PESEE n° 4567\nBrut 32 480 kg\nTare 14 220 kg\nNet 18 260 kg\nHumidité 14,8 %\nPS 76';
  for (const f of ui.el('sc-read').l.click) f();
  assert.equal(ui.err.hidden, true);
  const html = ui.el('sc-result').innerHTML;
  assert.match(html, /Ticket de pesée/); assert.match(html, /net 18[\u202f\u00a0 ]260 kg/); assert.match(html, /Récolte › Lot/);
});

// Revue adverse W1 : un test par correction.
test('W1 revue : pas de multiplication cachée pour un conditionnement déjà appliqué ou compté en unités', () => {
  // « Carton 12 doses » lu 3 cartons : le tableau affiche 3, l’entrée ne devient pas 36.
  const doses = convertLineToItem({quantity: 3, unit: '', unitPrice: 10, pack: {factor: 12, unit: 'u', count: null}, packs: null}, {unit: 'unités'});
  assert.deepEqual([doses.quantity, doses.converted], [3, false]);
  // Conditionnement déjà multiplié par doc-text (packs) : pas de deuxième multiplication.
  const done = convertLineToItem({quantity: 20, unit: 'kg', unitPrice: 1, pack: {factor: 5, unit: 'L', count: null}, packs: {count: 4, per: 5}}, {unit: 'kg'});
  assert.deepEqual([done.quantity, done.converted], [20, false]);
});

test('W1 revue : badge de conditionnement seulement quand la quantité a été multipliée', async () => {
  const {lineBadge, docHeaderHtml} = await import('./stock-capture-ui.js');
  assert.equal(lineBadge({line: {quantity: 3, unit: '', pack: {factor: 12, unit: 'u', count: null}, packs: null}}), '');
  assert.equal(lineBadge({line: {quantity: 20000, unit: 'kg', pack: {factor: 600, unit: 'kg', count: null}, packs: null}}), '');
  assert.equal(lineBadge({line: {quantity: 5, unit: 'L', pack: {factor: 5, unit: 'L'}, packs: {count: 1, per: 5}}}), '');
  assert.equal(lineBadge({line: {quantity: 20, unit: 'L', pack: {factor: 20, unit: 'L', count: 4}, packs: {count: 4, per: 5}}}), '4 × 5 L = 20 L');
  // Coche « totaux cohérents » seulement si un contrôle a eu lieu.
  const base = {kind: 'facture', warnings: [], header: {fournisseur: 'X', totalHT: 100, tva: [], totalTTC: null}};
  assert.doesNotMatch(docHeaderHtml({...base, lignes: [{amount: null}]}), /totaux cohérents/);
  assert.match(docHeaderHtml({...base, lignes: [{amount: 100}]}), /totaux cohérents/);
  assert.match(docHeaderHtml({...base, lignes: [], header: {...base.header, tva: [{taux: 20, montant: 20}], totalTTC: 120}}), /totaux cohérents/);
});

test('W1 revue : unité incompatible signalée à l’enregistrement', async () => {
  const {createStockCaptureUI} = await import('./stock-capture-ui.js');
  const ui = fakeUi({text: PHYTO_TEXT, stockItems: [{id: 'a', name: 'Adengo', unit: 'kg'}]});
  createStockCaptureUI(ui.deps).open();
  for (const f of ui.el('sc-paste').l.click) await f();
  const tr = {dataset: {line: '0'}, querySelector: s => ({'.sc-ok': {checked: true}, '.sc-qty': {value: '20'}, '.sc-price': {value: '45'}, '.sc-item': {value: 'a'}, '.sc-remember': {checked: false}})[s]};
  ui.setRows([tr]);
  await ui.el('sc-lines-save').onclick();
  assert.equal(ui.calls.movements[0].quantity, 20);
  assert.match(ui.calls.toasts[0], /Ligne 1 : unité différente de l’article/);
});

test('récap ticket de pesée et bon de gasoil : milliers séparés à la française', async () => {
  const {docRecapHtml} = await import('./stock-capture-ui.js');
  const sp = s => s.replace(/[  ]/g, ' ');
  const pesee = sp(docRecapHtml({kind: 'pesee', header: {fournisseur: 'Coop', date: '', numero: ''}, pesee: {brutKg: 28460, tareKg: 14200, netKg: 14260, humidite: 14.8, ps: 76.5, impuretes: null, produit: 'Blé', plaque: ''}}));
  assert.match(pesee, /brut 28 460 kg · tare 14 200 kg · net 14 260 kg · humidité 14,8 % · PS 76,5/);
  const gnr = sp(docRecapHtml({kind: 'gasoil', header: {fournisseur: 'X', date: '', numero: ''}, gasoil: {produit: 'GNR', litres: 1500, prixLitre: 1.145, indexDebut: 12345, indexFin: 13845}}));
  assert.match(gnr, /GNR · 1 500 L · 1,145 €\/L · index 12 345 → 13 845/);
});
