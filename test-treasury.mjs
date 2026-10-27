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

// n° 86 et n° 94 : fermages, structure, appro, GNR et sinistres repris, sans double compte.
test('sources reprises : fermages, structure, appro, GNR et indemnité de sinistre (n° 86, n° 94)', () => {
  const s = base({
    parcelles: [{id: 'p1', nom: 'A', surfaceHa: 10, lease: {ownerName: 'M. Martin', leaseType: 'fermage', rentMode: 'eur', rent: 150}}],
    preferences: {structureByCampaign: {'2026/27': {items: {social: {amount: 1200}, annuities: {amount: 2400}}}}},
    integrationImports: [
      {id: 'f1', farmKind: 'fuel', entry: 'tank', date: '2026-12-03', litres: 1000, amount: 1100, supplier: 'Coop'},
      {id: 'f2', farmKind: 'fuel', entry: 'tank', date: '2026-09-03', litres: 1000, amount: 900},
      {id: 'k1', farmKind: 'claim', cause: 'grele', status: 'déclaré', date: '2026-08-20', indemnity: 3000},
      {id: 'k2', farmKind: 'claim', cause: 'gibier', status: 'expertisé', date: '2026-10-01', indemnity: 500, expectedPaymentDate: '2027-03-10'},
      {id: 'k3', farmKind: 'claim', cause: 'gibier', status: 'indemnisé', date: '2026-06-01', indemnity: 800}
    ]
  });
  s.stockItems = [{id: 's1', name: 'Ammonitrate', category: 'engrais'}, {id: 's2', name: 'GNR', category: 'carburant'}];
  s.stockMovements = [
    {id: 'mv1', type: 'Entrée', stockItemId: 's1', date: '2027-02-01', quantity: 10, unitPrice: 400, supplier: 'Négoce'},
    {id: 'mv2', type: 'Entrée', stockItemId: 's1', date: '2026-10-01', quantity: 5, unitPrice: 400},
    {id: 'mv3', type: 'Entrée', stockItemId: 's2', date: '2027-01-01', quantity: 500, unitPrice: 1},
    {id: 'mv4', type: 'Entrée', stockItemId: 's1', date: '2027-03-01', quantity: 5}
  ];
  const {lines, missing, duplicates} = treasuryFlows(s, opts);
  const by = src => lines.filter(l => l.source === src).map(l => [l.month, l.amount]);
  assert.deepEqual(by('fermage'), [['2026-11', -1500]], 'fermage du Foncier à la Saint-Martin');
  assert.equal(by('structure').length, 24, 'MSA et annuités sur 12 mois, campagne reconduite');
  assert.deepEqual(by('structure').slice(0, 2), [['2026-10', -100], ['2026-11', -100]]);
  assert.deepEqual(by('appro'), [['2027-02', -4000]], 'passé et carburant (pleins GNR présents) exclus');
  assert.equal(missing.appro, 1, 'entrée sans prix signalée');
  assert.deepEqual(by('gnr'), [['2026-12', -1100]]);
  assert.deepEqual(lines.filter(l => l.source === 'sinistre').map(l => [l.month, l.amount, l.late]).sort(), [['2026-11', 3000, false], ['2027-03', 500, false]], 'date estimée (+3 mois) ou saisie ; indemnisé exclu');
  assert.match(lines.find(l => l.id === 'sinistre:k1').label, /Grêle \(date estimée\)/);
  assert.deepEqual(duplicates, []);
  assert.ok(lines.every(l => l.id), 'chaque flux a un identifiant');
});

test('échéancier saisi prioritaire : fermage, MSA et GNR non recomptés, et signalés', () => {
  const s = base({
    parcelles: [{id: 'p1', nom: 'A', surfaceHa: 10, lease: {ownerName: 'M. Martin', leaseType: 'fermage', rentMode: 'eur', rent: 150}}],
    preferences: {structureByCampaign: {'2026/27': {items: {social: {amount: 1200}, annuities: {amount: 2400}}}},
      treasury: {items: [{id: 'a', label: 'Fermages', amount: 1500, sign: '-', periodicity: 'annuelle', startMonth: '2026-11'}, {id: 'b', label: 'Cotisations MSA', amount: 300, sign: '-', periodicity: 'trimestrielle', startMonth: '2026-10'}, {id: 'c', label: 'Livraison GNR', amount: 1000, sign: '-', periodicity: 'annuelle', startMonth: '2027-01'}]}},
    integrationImports: [{id: 'f1', farmKind: 'fuel', entry: 'tank', date: '2026-12-03', litres: 1000, amount: 1100}]
  });
  const {lines, duplicates} = treasuryFlows(s, opts);
  assert.equal(lines.filter(l => l.source === 'fermage' || l.source === 'gnr').length, 0);
  assert.deepEqual([...new Set(lines.filter(l => l.source === 'structure').map(l => l.label))], ['Annuités d’emprunts (1/12 de la fiche de structure)']);
  assert.deepEqual(duplicates.map(d => [d.source, d.item]), [['fermage', 'Fermages'], ['structure', 'Cotisations MSA'], ['gnr', 'Livraison GNR']]);
});

test('point bas : prochain encaissement attendu, et scénario de décalage sans écriture', async () => {
  const s = base({preferences: {treasury: {openingBalance: 1000, items: [{id: 'a', label: 'Annuité', amount: 3000, sign: '-', periodicity: 'annuelle', startMonth: '2026-11'}]}},
    integrationImports: [{id: 'c1', farmKind: 'salesContract', culture: 'Blé', buyer: 'Coop', type: 'ferme', tonnes: 10, price: 200, paymentDate: '2027-01-15'}]});
  const f = treasuryForecast(s, opts);
  assert.equal(f.low.key, '2026-11');
  assert.deepEqual([f.low.nextIncome.key, f.low.nextIncome.amount, f.low.nextIncome.source], ['2027-01', 2000, 'contrat']);
  const {lowPointText, scenarioText} = await import('./treasury-ui.js');
  assert.match(lowPointText(f.low), /Prochain encaissement attendu : Contrat « Contrat Blé · Coop », 2[\s ]000 € en janv\. 27/);
  const before = JSON.stringify(s);
  const moved = treasuryForecast(s, {...opts, shifts: {'contrat:c1': 3}});
  assert.equal(moved.months.find(m => m.key === '2027-04').income, 2000);
  assert.equal(moved.months.find(m => m.key === '2027-01').income, 0);
  assert.equal(moved.low.balance, -2000);
  assert.equal(treasuryForecast(s, {...opts, shifts: {'contrat:c1': 12}}).totals.income, 0, 'au-delà de l’horizon : sort du calcul');
  assert.equal(JSON.stringify(s), before, 'simulation sans écriture');
  assert.match(scenarioText(f, moved, f.lines.find(l => l.id === 'contrat:c1'), 3), /arrive en avr\. 27 au lieu de janv\. 27 : point bas −2[\s ]000 € fin nov\. 26 \(inchangé\)/);
});

test('appro et GNR à venir : part intrants et carburant des travaux prévus estimés non recomptée (n° 86)', () => {
  const s = base({
    parcelles: [{id: 'p1', nom: 'A', surfaceHa: 10}],
    preferences: {fuelPrice: 1.2},
    materiels: [{id: 'm1', nom: 'Pulvé', hourlyCost: 50}],
    interventions: [{id: 'w1', type: 'Traitement fongicide', status: 'À faire', plannedDate: '2027-04-10', parcelId: 'p1', machineId: 'm1', duration: 2, fuel: 20, resourceEffects: {stockItemId: 's1', quantity: 1000}}],
    integrationImports: [{id: 'f1', farmKind: 'fuel', entry: 'tank', date: '2027-03-03', litres: 1000, amount: 1100}]
  });
  s.stockItems = [{id: 's1', name: 'Fongix', category: 'phyto', unitPrice: 20}];
  s.stockMovements = [{id: 'mv1', type: 'Entrée', stockItemId: 's1', date: '2027-03-01', quantity: 1000, unitPrice: 20}];
  const {lines, duplicates} = treasuryFlows(s, opts);
  const by = src => lines.filter(l => l.source === src).map(l => [l.month, l.amount]);
  assert.deepEqual(by('appro'), [['2027-03', -20000]]);
  assert.deepEqual(by('gnr'), [['2027-03', -1100]]);
  assert.deepEqual(by('travail'), [['2027-04', -100]], 'seule la part matériel reste (2 h × 50 €)');
  assert.deepEqual(duplicates.map(d => d.source), ['travail']);
  // Sans achat repris, l'estimation complète revient.
  s.stockMovements = []; s.integrationImports = [];
  assert.deepEqual(treasuryFlows(s, opts).lines.filter(l => l.source === 'travail').map(l => l.amount), [-20124]);
});
