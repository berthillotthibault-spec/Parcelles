import assert from 'node:assert/strict';
import {test} from 'node:test';
import {treasuryForecast, treasuryFlows, treasurySettings, itemOccurrences, addMonths, dayKey, monthDiff, monthLabel, validateItem, validateOpening, treasuryChart} from './treasury.js';
import {emptyState} from './state.js';
import {canSeeTreasury} from './permissions.js';

const START = '2026-10';
const base = (patch = {}) => { const s = emptyState(); Object.assign(s.preferences, patch.preferences || {}); for (const k of ['interventions', 'integrationImports', 'parcelles', 'maintenanceRecords', 'materiels']) if (patch[k]) s[k] = patch[k]; return s; };
const opts = {start: START, today: '2026-10-15'};

test('mois : ajout, écart et libellé', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthDiff('2026-10', '2027-10'), 12);
  assert.equal(monthLabel('2027-02'), 'févr. 27');
});

test('périodicités : mensuelle, trimestrielle, annuelle, départ futur ou passé', () => {
  assert.equal(itemOccurrences({periodicity: 'mensuelle', startMonth: '2026-01'}, START).length, 12);
  assert.deepEqual(itemOccurrences({periodicity: 'trimestrielle', startMonth: '2026-11'}, START), ['2026-11', '2027-02', '2027-05', '2027-08']);
  assert.deepEqual(itemOccurrences({periodicity: 'trimestrielle', startMonth: '2026-08'}, START), ['2026-11', '2027-02', '2027-05', '2027-08']);
  assert.deepEqual(itemOccurrences({periodicity: 'annuelle', startMonth: '2025-03'}, START), ['2027-03']);
  assert.deepEqual(itemOccurrences({periodicity: 'annuelle', startMonth: '2028-01'}, START), []);
  assert.deepEqual(itemOccurrences({periodicity: 'hebdo', startMonth: '2026-10'}, START), []);
});

test('état vide : 12 mois, solde nul, sources manquantes signalées', () => {
  const f = treasuryForecast(base(), opts);
  assert.equal(f.months.length, 12);
  assert.equal(f.months[0].key, '2026-10');
  assert.equal(f.months[11].key, '2027-09');
  assert.equal(f.openingMissing, true);
  assert.equal(f.missing.pac, true);
  assert.ok(f.months.every(m => m.balance === 0));
  assert.equal(f.low.negative, false);
});

test('échéancier et solde de départ : solde cumulé et point bas', () => {
  const s = base({preferences: {treasury: {openingBalance: 5000, items: [
    {id: 'a', label: 'Annuité prêt', amount: 1500, sign: '-', periodicity: 'trimestrielle', startMonth: '2026-11'},
    {id: 'b', label: 'Lait', amount: 1000, sign: '+', periodicity: 'mensuelle', startMonth: '2027-03'},
    {id: 'x', label: '', amount: 10, sign: '+', periodicity: 'mensuelle', startMonth: '2026-10'}
  ]}}});
  assert.equal(treasurySettings(s).items.length, 2, 'ligne invalide ignorée');
  const f = treasuryForecast(s, opts);
  assert.equal(f.months[1].expense, 1500);
  assert.equal(f.months[1].balance, 3500);
  assert.equal(f.months[4].balance, 2000);
  assert.equal(f.low.key, '2027-02');
  assert.equal(f.low.balance, 2000);
  assert.equal(f.months[11].balance, 5000 - 4 * 1500 + 7 * 1000);
});

test('point bas négatif détecté', () => {
  const s = base({preferences: {treasury: {openingBalance: 1000, items: [{id: 'a', label: 'Fermage', amount: 3000, sign: '-', periodicity: 'annuelle', startMonth: '2026-11'}]}}});
  const f = treasuryForecast(s, opts);
  assert.equal(f.low.key, '2026-11');
  assert.equal(f.low.balance, -2000);
  assert.equal(f.low.negative, true);
});

test('contrats, factures non payées, aides PAC, travaux prévus et entretiens', () => {
  const s = base({
    preferences: {pacAidsHa: {decoupled: 100, ecoScheme: null}},
    parcelles: [{id: 'p1', nom: 'A', surfaceHa: 10}],
    integrationImports: [
      {id: 'c1', farmKind: 'salesContract', culture: 'Blé', buyer: 'Coop', type: 'ferme', tonnes: 10, price: 200, paymentDate: '2027-01-15'},
      {id: 'c2', farmKind: 'salesContract', culture: 'Orge', buyer: 'Coop', type: 'a-fixer', tonnes: 10, price: null, deliveryDate: '2026-12-01'},
      {id: 'c3', farmKind: 'salesContract', culture: 'Colza', buyer: 'Coop', type: 'ferme', tonnes: 5, price: 400, paymentDate: '2026-05-01'},
      {id: 'i1', farmKind: 'invoice', docType: 'facture', status: 'emise', number: 'F2026-0001', dueDate: '2026-11-20', totals: {ttc: 1200}},
      {id: 'i2', farmKind: 'invoice', docType: 'facture', status: 'emise', number: 'F2026-0002', dueDate: '2026-09-01', totals: {ttc: 300}},
      {id: 'i3', farmKind: 'invoice', docType: 'facture', status: 'emise', paidAt: '2026-10-01', dueDate: '2026-11-01', totals: {ttc: 999}},
      {id: 'i4', farmKind: 'invoice', docType: 'facture', status: 'brouillon', dueDate: '2026-11-01', totals: {ttc: 888}}
    ],
    interventions: [
      {id: 'w1', type: 'Semis', status: 'Prévu', plannedDate: '2026-11-05', parcelId: 'p1', cost: 400},
      {id: 'w2', type: 'Labour', status: 'Prévu', plannedDate: '2026-12-05', parcelId: 'p1'},
      {id: 'w3', type: 'Récolte', status: 'Terminé', date: '2026-11-05', parcelId: 'p1', cost: 700},
      {id: 'w4', type: 'Désherbage', status: 'Prévu', plannedDate: '2026-08-01', parcelId: 'p1', cost: 50}
    ],
    materiels: [{id: 'm1', nom: 'Tracteur'}],
    maintenanceRecords: [{id: 'r1', equipmentId: 'm1', date: '2027-02-10', type: 'Vidange', cost: 250}, {id: 'r2', equipmentId: 'm1', date: '2026-01-10', type: 'Pneus', cost: 900}]
  });
  const {lines, missing} = treasuryFlows(s, opts);
  const by = src => lines.filter(l => l.source === src);
  assert.deepEqual(by('contrat').map(l => [l.month, l.amount]), [['2027-01', 2000]]);
  assert.equal(missing.contracts, 1, 'contrat sans prix compté comme manquant');
  assert.deepEqual(by('facture').map(l => [l.month, l.amount, l.late]), [['2026-11', 1200, false], ['2026-10', 300, true]]);
  assert.deepEqual(by('pac').map(l => [l.month, l.amount]), [['2026-10', 700], ['2026-12', 300]]);
  assert.equal(missing.pac, false);
  assert.deepEqual(by('travail').map(l => [l.month, l.amount, l.late]), [['2026-11', -400, false], ['2026-10', -50, true]]);
  assert.equal(missing.works, 1, 'travail sans coût ni estimation');
  assert.deepEqual(by('entretien').map(l => [l.month, l.amount]), [['2027-02', -250]]);
  const f = treasuryForecast(s, opts);
  assert.equal(f.totals.income, 2000 + 1500 + 1000);
  assert.equal(f.totals.expense, 700);
});

test('avoir déduit du reste dû', () => {
  const s = base({integrationImports: [
    {id: 'i1', farmKind: 'invoice', docType: 'facture', status: 'emise', dueDate: '2026-11-20', totals: {ttc: 1000}},
    {id: 'a1', farmKind: 'invoice', docType: 'avoir', status: 'emise', creditOf: 'i1', totals: {ttc: -400}}
  ]});
  assert.deepEqual(treasuryFlows(s, opts).lines.map(l => l.amount), [600]);
});

test('validation de la saisie', () => {
  assert.ok(validateItem({label: '', amount: 10, periodicity: 'mensuelle', startMonth: '2026-10'}).error);
  assert.ok(validateItem({label: 'Prêt', amount: '-5', periodicity: 'mensuelle', startMonth: '2026-10'}).error);
  assert.ok(validateItem({label: 'Prêt', amount: 5, periodicity: 'mensuelle', startMonth: '2026-13'}).error);
  assert.deepEqual(validateItem({label: ' Prêt ', amount: '1 200,5', sign: '-', periodicity: 'annuelle', startMonth: '2027-01'}).value, {label: 'Prêt', amount: 1200.5, sign: '-', periodicity: 'annuelle', startMonth: '2027-01'});
  assert.equal(validateOpening('').value, null);
  assert.equal(validateOpening('-1500,25').value, -1500.25);
  assert.ok(validateOpening('abc').error);
});

test('courbe SVG : 12 mois, point bas, vide sans données', () => {
  const s = base({preferences: {treasury: {openingBalance: 100, items: [{id: 'a', label: 'X', amount: 300, sign: '-', periodicity: 'annuelle', startMonth: '2026-12'}]}}});
  const svg = treasuryChart(treasuryForecast(s, opts));
  assert.match(svg, /^<svg class="treasury-chart"/);
  assert.match(svg, /tr-low is-negative/);
  assert.equal((svg.match(/<text /g) || []).length, 12);
  assert.equal(treasuryChart({months: []}), '');
});

test('flux du mois en cours déjà passés exclus selon la date du jour (n° 86)', () => {
  const s = base({
    integrationImports: [
      {id: 'c1', farmKind: 'salesContract', culture: 'Blé', buyer: 'Coop', type: 'ferme', tonnes: 10, price: 200, paymentDate: '2026-10-05'},
      {id: 'c2', farmKind: 'salesContract', culture: 'Orge', buyer: 'Coop', type: 'ferme', tonnes: 10, price: 100, paymentDate: '2026-10-20'},
      {id: 'l1', farmKind: 'harvest', crop: 'Maïs', unit: 't', sales: [{quantity: 2, price: 150, date: '2026-10-02'}, {quantity: 1, price: 150, date: '2026-10-25'}]},
      {id: 'i1', farmKind: 'invoice', docType: 'facture', status: 'emise', number: 'F1', dueDate: '2026-10-10', totals: {ttc: 500}}
    ],
    materiels: [{id: 'm1', nom: 'Tracteur'}],
    maintenanceRecords: [{id: 'r1', equipmentId: 'm1', date: '2026-10-03', type: 'Vidange', cost: 250}, {id: 'r2', equipmentId: 'm1', date: '2026-10-28', type: 'Pneus', cost: 900}]
  });
  const {lines} = treasuryFlows(s, opts);
  const by = src => lines.filter(l => l.source === src).map(l => l.amount);
  assert.deepEqual(by('contrat'), [1000], 'contrat payé le 5 exclu au 15');
  assert.deepEqual(by('vente'), [150], 'vente du 2 exclue au 15');
  assert.deepEqual(by('entretien'), [-900], 'entretien du 3 exclu au 15');
  assert.deepEqual(lines.filter(l => l.source === 'facture').map(l => l.late), [true], 'facture échue le 10 en retard au 15');
});

test('dayKey : date locale AAAA-MM-JJ', () => {
  assert.equal(dayKey(new Date(2026, 9, 3, 23, 30)), '2026-10-03');
});

test('trésorerie masquée au rôle viewer (n° 86)', () => {
  assert.equal(canSeeTreasury('viewer'), false);
  assert.equal(canSeeTreasury('editor'), true);
  assert.equal(canSeeTreasury('owner'), true);
});
