// Statut « exploitant agricole » du client : fiche, annuaire des entreprises et conseil de TVA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classify, clientCategory, explicitFarmer, farmerChoice, clientFarmerFields, farmerPrefill, checkDocumentVat} from './vat-advisor.js';
import {agriculturalActivity, legalFormOf, farmerLikely, parseCompanyResults} from './company-lookup.js';

const T = '2026-11-12';
const forest = (client, more = {}) => classify('Abattage', {today: T, client, ...more});

test('fiche client : Oui prime sur le nom (10 %, sûr jusqu’au 31/12/2028)', () => {
  const a = forest({name: 'SARL Durand', kind: 'pro', farmer: true});
  assert.equal(a.rate, 10); assert.equal(a.confidence, 'sure'); assert.equal(a.category, 'forestier');
  assert.ok(a.alternatives.some(x => x.rate === 20));
});
test('fiche client : Non prime sur le nom GAEC (20 %, sûr)', () => {
  const a = forest({name: 'GAEC des Prés', kind: 'pro', farmer: false});
  assert.equal(a.rate, 20); assert.equal(a.confidence, 'sure');
  assert.equal(clientCategory({client: {name: 'GAEC des Prés', farmer: false}}), 'pro');
});
test('fiche client : Ne sais pas garde l’heuristique du nom', () => {
  const a = forest({name: 'GAEC des Prés', farmer: null});
  assert.equal(a.rate, 10); assert.equal(a.confidence, 'probable');
  assert.equal(forest({name: 'Martin'}).confidence, 'check');
});
test('après le 31/12/2028 : taux normal même pour un exploitant déclaré', () => {
  const a = classify('Élagage', {today: '2029-01-02', client: {name: 'Dupont', farmer: true}});
  assert.equal(a.rate, 20);
});
test('particulier ou collectivité restent au taux normal', () => {
  assert.equal(forest({name: 'Paul Martin', kind: 'particulier'}).rate, 20);
  assert.equal(forest({name: 'Mairie de Bourg', kind: 'pro'}).rate, 20);
});
test('code NAF ou forme juridique enregistrés : exploitant probable', () => {
  assert.equal(clientCategory({client: {name: 'Les Prés', activity: '01.50Z'}}), 'farm');
  assert.equal(clientCategory({client: {name: 'Les Prés', legalForm: 'EARL'}}), 'farm');
  assert.equal(clientCategory({clientKind: 'pro', client: {name: 'Les Prés', activity: '01.61Z'}}), 'pro', 'ETA : soutien aux cultures');
  assert.equal(clientCategory({client: {name: 'Les Prés', activity: '01.50Z', farmer: false, kind: 'pro'}}), 'pro');
});
test('explicitFarmer et farmerChoice', () => {
  assert.equal(explicitFarmer(null), null);
  assert.equal(explicitFarmer({farmer: false}), false);
  assert.equal(explicitFarmer({isFarmer: true}), true);
  assert.equal(farmerChoice('oui'), true); assert.equal(farmerChoice('non'), false); assert.equal(farmerChoice(''), null); assert.equal(farmerChoice(undefined), null);
});
test('clientFarmerFields : statut, forme et NAF contrôlés', () => {
  assert.deepEqual(clientFarmerFields({farmer: 'oui', legalForm: 'gaec', activity: '01.11z'}), {farmer: true, legalForm: 'GAEC', activity: '01.11Z'});
  assert.deepEqual(clientFarmerFields({farmer: '', legalForm: 'SARL', activity: '<b>'}), {farmer: null, legalForm: '', activity: ''});
  assert.deepEqual(clientFarmerFields({farmer: ''}), {farmer: null});
  assert.deepEqual(clientFarmerFields({farmer: 'non'}), {farmer: false});
});
test('annuaire : codes NAF agricoles', () => {
  for (const c of ['01.11Z', '01.41Z', '01.50Z', '02.10Z', '02.20Z', '0111Z']) assert.ok(agriculturalActivity(c), c);
  for (const c of ['01.61Z', '01.70Z', '02.40Z', '43.12A', '', null]) assert.ok(!agriculturalActivity(c), String(c));
});
test('annuaire : forme juridique par code INSEE puis par le nom', () => {
  assert.equal(legalFormOf('6533'), 'GAEC'); assert.equal(legalFormOf('6598'), 'EARL'); assert.equal(legalFormOf('6597'), 'SCEA');
  assert.equal(legalFormOf('5710', 'SCEA DU BOIS'), 'SCEA'); assert.equal(legalFormOf('5710', 'DURAND SAS'), '');
  assert.ok(farmerLikely({legalForm: 'GAEC'})); assert.ok(!farmerLikely({legalForm: 'CUMA'})); assert.ok(farmerLikely({activity: '01.11Z'}));
});
test('annuaire : résultat avec forme juridique et exploitant probable', () => {
  const payload = {results: [
    {siren: '552100554', nom_complet: 'GAEC DU MOULIN', nom_raison_sociale: 'GAEC DU MOULIN', nature_juridique: '6533', activite_principale: '01.50Z', siege: {siret: '55210055400054'}},
    {siren: '552100555', nom_complet: 'TP DURAND', nature_juridique: '5710', activite_principale: '43.12A', siege: {}}]};
  const [farm, tp] = parseCompanyResults(payload);
  assert.equal(farm.legalForm, 'GAEC'); assert.equal(farm.farmerLikely, true); assert.equal(farm.activity, '01.50Z');
  assert.equal(tp.legalForm, ''); assert.equal(tp.farmerLikely, false);
});
test('pré-remplissage : jamais d’écrasement d’un choix manuel', () => {
  assert.equal(farmerPrefill('', {farmerLikely: true}), 'oui');
  assert.equal(farmerPrefill('non', {farmerLikely: true}), null);
  assert.equal(farmerPrefill('', {farmerLikely: true}, {manual: true}), null);
  assert.equal(farmerPrefill('', {farmerLikely: false}), null);
});
test('pré-remplissage : un « Oui » venu de l’annuaire est retiré pour une entreprise non agricole', () => {
  assert.equal(farmerPrefill('oui', {farmerLikely: false}, {auto: true}), '');
  assert.equal(farmerPrefill('oui', {farmerLikely: false}), null);
  assert.equal(farmerPrefill('oui', {farmerLikely: true}, {auto: true}), 'oui');
  assert.equal(farmerPrefill('oui', {farmerLikely: false}, {auto: true, manual: true}), null);
});
test('contrôle d’un document : la fiche client sert à vérifier le taux forestier', () => {
  const state = {exploitation: {invoicing: {vatRegime: 'normal'}}, clients: [{id: 'c1', name: 'SARL Durand', farmer: true}, {id: 'c2', name: 'GAEC Bois', farmer: false}]};
  const line = {label: 'Abattage', quantity: 1, unitPrice: 100, vatRate: 10};
  assert.deepEqual(checkDocumentVat(state, {issueDate: T, clientId: 'c1', clientName: 'SARL Durand', lines: [line]}), []);
  const w = checkDocumentVat(state, {issueDate: T, clientId: 'c2', clientName: 'GAEC Bois', lines: [line]});
  assert.ok(w.some(x => x.code === 'forestier-verifier' || x.code === 'ecart'));
});
