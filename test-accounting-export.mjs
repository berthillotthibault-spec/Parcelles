// n° 96 — export comptable ventilé (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {accountingRows,accountSummary,operationsCsv,workbookSheets,validatePlan,accountingPlan,stockCategory,DISCLAIMER} from './accounting-export.js';

const farm = (prefs = {}, extra = {}) => ({preferences: prefs, rotations: [], clients: [], contracts: [],
  parcelles: [{id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10}],
  materiels: [{id: 'm1', nom: 'Tracteur'}],
  interventions: [{id: 'w1', parcelId: 'p1', type: 'Fertilisation', date: '2026-03-01', status: 'Terminé'}],
  stockItems: [{id: 's1', name: 'Ammonitrate', category: 'Engrais', unit: 't', quantity: 2, unitPrice: 400},
    {id: 's2', name: 'GNR', category: 'Carburant', unit: 'L', quantity: 0, unitPrice: 1}],
  stockMovements: [
    {id: 'mv1', stockItemId: 's1', type: 'Entrée', quantity: 3, unitPrice: 400, date: '2026-02-10', workId: 'w1'},
    {id: 'mv2', stockItemId: 's1', type: 'Sortie', quantity: 1, date: '2026-03-01'},
    {id: 'mv3', stockItemId: 's2', type: 'Entrée', quantity: 500, unitPrice: 1, date: '2026-02-11'},
    {id: 'mv4', stockItemId: 's1', type: 'Entrée', quantity: 1, date: '2026-02-12'}],
  maintenanceRecords: [{id: 'r1', equipmentId: 'm1', date: '2026-04-01', cost: 350, type: 'Vidange'}],
  integrationImports: [
    {id: 'i1', farmKind: 'invoice', status: 'emise', docType: 'facture', number: 'F2026-0001', issueDate: '2026-05-02', clientName: 'GAEC Voisin',
      lines: [{quantity: 10, unitPrice: 50, vatRate: 20}, {quantity: 100, unitPrice: 1, vatRate: 10}]},
    {id: 'i2', farmKind: 'invoice', status: 'brouillon', docType: 'facture', issueDate: '2026-05-03', lines: [{quantity: 1, unitPrice: 999, vatRate: 20}]},
    {id: 'h1', farmKind: 'harvest', parcelId: 'p1', crop: 'Blé tendre', date: '2025-07-20', unit: 't', sales: [{id: 'v1', date: '2026-01-15', quantity: 30, price: 210, buyer: 'Coop'}, {id: 'v2', date: '2026-01-20', quantity: 5}]},
    {id: 'f1', farmKind: 'fuel', entry: 'tank', date: '2026-02-20', litres: 1000, unitPrice: 1.1, amount: 1100, invoiceRef: 'BL-12'},
    {id: 'a1', farmKind: 'animalSale', date: '2026-06-01', amount: 4200, count: 3}],
  ...extra});

test('une ligne par opération chiffrée, sur la période, sans brouillon', () => {
  const r = accountingRows(farm(), {from: '2026-01-01', to: '2026-12-31'});
  const accounts = r.rows.map(x => x.account);
  assert.deepEqual(accounts, ['7010', '6012', '6061', '6155', '7060', '7060', '7020']);
  const engrais = r.rows.find(x => x.account === '6012');
  assert.equal(engrais.ht, 1200); assert.equal(engrais.parcel, 'Les Noues'); assert.equal(engrais.culture, 'Blé tendre');
  assert.equal(engrais.vatRate, null); assert.equal(engrais.tva, null); // TVA jamais devinée
  const fact = r.rows.filter(x => x.account === '7060');
  assert.deepEqual(fact.map(x => [x.vatRate, x.ht, x.tva]), [[20, 500, 100], [10, 100, 10]]);
  assert.ok(r.warnings.some(w => /sans prix/.test(w)));
  assert.ok(r.warnings.some(w => /Carburant.*deux fois/.test(w)));
  assert.ok(r.warnings.some(w => /TVA non renseigné/.test(w)));
  assert.equal(accountingRows(farm(), {from: '2026-05-01', to: '2026-05-31'}).rows.length, 2);
});

test('plan modifiable : compte et TVA par catégorie', () => {
  assert.match(validatePlan({account_engrais: '60A'}).error, /Compte invalide/);
  assert.match(validatePlan({vat_engrais: '7'}).error, /TVA invalide/);
  const plan = validatePlan({account_engrais: '601200', vat_engrais: '10'}).value;
  assert.equal(plan.engrais.account, '601200'); assert.equal(plan.engrais.vatRate, 10); assert.equal(plan.semences.vatRate, null);
  const r = accountingRows(farm({accountingPlan: plan}), {from: '2026-01-01', to: '2026-12-31'});
  const engrais = r.rows.find(x => x.category === 'engrais');
  assert.equal(engrais.account, '601200'); assert.equal(engrais.tva, 120); assert.equal(engrais.ttc, 1320);
  assert.equal(accountingPlan({}).phyto.account, '6013');
  assert.equal(stockCategory({category: 'Produit', name: 'Herbicide X'}), 'phyto');
  assert.equal(stockCategory({category: 'Intrant', name: 'Semence colza'}), 'semences');
});

test('CSV au format français et classeur à quatre feuilles avec avertissement', () => {
  const s = farm(), r = accountingRows(s, {from: '2026-01-01', to: '2026-12-31'}), csv = operationsCsv(r);
  assert.ok(csv.startsWith('﻿Date;Pièce;Libellé;Compte'));
  assert.match(csv, /2026-02-10;;Ammonitrate : 3 t;6012;Engrais et amendements;Charge;Les Noues;Blé tendre;1200;;;;Entrée de stock/);
  assert.match(csv, /F2026-0001;Facture GAEC Voisin;7060;.*;500;20;100;600;/);
  const sheets = workbookSheets(s, r);
  assert.deepEqual(sheets.map(x => x.name), ['Opérations', 'Ventes', 'Synthèse', 'Stocks au 2026-12-31']);
  assert.equal(sheets[0].rows[1][0], DISCLAIMER);
  const sum = accountSummary(r.rows), f20 = sum.find(g => g.account === '7060' && g.vatRate === 20);
  assert.equal(f20.ht, 500); assert.equal(f20.tva, 100);
  assert.ok(sum.find(g => g.account === '6012').tvaUnknown);
});
