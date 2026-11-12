// Destination de la récolte et taux conseillé des lignes générées depuis les travaux.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classify, cropRate, workVatContext, workVatAdvice, checkDocumentVat, validDestination} from './vat-advisor.js';
import {billableItems} from './invoices-core.js';

const rate = (label, opts = {}) => classify(label, {today: '2026-11-12', ...opts})?.rate;

test('destination explicite prioritaire sur le libellé', () => {
  assert.equal(rate('Moisson de blé fourrager', {destination: 'humaine'}), 5.5);
  assert.equal(rate('Moisson de blé', {destination: 'animale'}), 10);
  assert.equal(rate('Moisson de blé', {destination: 'semence'}), 10);
  assert.equal(rate('Récolte de maïs', {destination: 'energie'}), 20);
  assert.equal(rate('Moisson', {crop: 'Colza', destination: 'autre'}), 20);
});
test('destination énergie : raison prudente et référence', () => {
  const a = classify('Moisson', {crop: 'Maïs', destination: 'energie', today: '2026-11-12'});
  assert.equal(a.confidence, 'probable'); assert.match(a.reason, /méthanisation/); assert.match(a.reason, /§20/); assert.match(a.reason, /vérifier/);
});
test('culture de la parcelle prioritaire sur le libellé', () => {
  assert.equal(rate('Moisson', {crop: 'Blé tendre'}), 5.5);
  assert.equal(rate('Moisson de blé', {crop: 'Luzerne'}), 10);
  assert.equal(cropRate('Moisson', {crop: 'Chanvre'}).rate, 20);
});
test('services au taux normal quelle que soit la destination', () => {
  assert.equal(rate('Semis', {crop: 'Blé', destination: 'humaine'}), 20);
  assert.equal(rate('Pulvérisation', {crop: 'Blé', destination: 'animale'}), 20);
});
test('destination inconnue ignorée', () => {
  assert.equal(validDestination('cosmétique'), '');
  assert.equal(rate('Moisson de blé', {destination: 'cosmétique'}), 5.5);
});

const W = (id, type, more = {}) => ({id, type, parcelId: 'p1', status: 'Terminé', date: '2026-07-15', duration: 2, ...more});
function farm({parcel = {}, works = [W('w1', 'Moisson')], invoicing = {}, client = {}, rotations = []} = {}) {
  return {exploitation: {invoicing: {vatRegime: 'normal', vatRate: 20, ...invoicing}}, preferences: {fuelPrice: 1.2},
    clients: [{id: 'c1', name: 'Paul Client', kind: 'pro', hourlyRate: 80, ...client}],
    parcelles: [{id: 'p1', nom: 'Le Grand Champ', culture: 'Blé', clientId: 'c1', surfaceHa: 5, ...parcel}],
    interventions: works, rotations, chantiers: [], integrationImports: []};
}

test('contexte du travail : assolement de la campagne, puis parcelle', () => {
  const s = farm({parcel: {cropDestination: 'animale', cropDestinationFor: 'Blé'}, rotations: [{id: 'r1', parcelId: 'p1', campaignId: '2025/26', culture: 'Maïs', destination: 'energie'}]});
  assert.deepEqual(workVatContext(s, W('a', 'Moisson', {date: '2026-07-15'})), {crop: 'Maïs', destination: 'energie'});
  assert.deepEqual(workVatContext(s, W('b', 'Moisson', {date: '2026-09-15'})), {crop: 'Blé', destination: 'animale'});
});
test('destination de la parcelle ignorée si la culture a changé', () => {
  const s = farm({parcel: {culture: 'Colza', cropDestination: 'animale', cropDestinationFor: 'Blé'}});
  assert.equal(workVatContext(s, W('a', 'Moisson')).destination, '');
});
test('destination : culture comparée sans casse ni espaces ; enregistrée sans culture, elle ne vaut pour aucune', () => {
  const same = farm({parcel: {culture: 'blé ', cropDestination: 'animale', cropDestinationFor: 'Blé'}});
  assert.equal(workVatContext(same, W('a', 'Moisson')).destination, 'animale');
  const empty = farm({parcel: {culture: 'Blé', cropDestination: 'animale', cropDestinationFor: ''}});
  assert.equal(workVatContext(empty, W('a', 'Moisson')).destination, '');
  const legacy = farm({parcel: {culture: 'Blé', cropDestination: 'animale'}});
  assert.equal(workVatContext(legacy, W('a', 'Moisson')).destination, 'animale');
});
test('arrachage d’une parcelle de vigne : taux normal, même avec une destination', () => {
  assert.equal(classify('Arrachage', {today: '2026-11-12', crop: 'Vigne'}).rate, 20);
  assert.equal(classify('Arrachage', {today: '2026-11-12', crop: 'Vigne', destination: 'humaine'}).rate, 20);
  assert.equal(cropRate('Vendanges', {destination: 'humaine'}).kind, 'vine');
  const s = farm({parcel: {culture: 'Vigne', cropDestination: 'humaine', cropDestinationFor: 'Vigne'}});
  // 20 % « à vérifier » : jamais appliqué d'office (avant, 5,5 % « probable » l'était).
  assert.equal(workVatAdvice(s, {work: W('w1', 'Arrachage')}), null);
});
test('conseil d’un travail : récolte de blé à 5,5 %', () => {
  const a = workVatAdvice(farm(), {work: W('w1', 'Moisson')});
  assert.equal(a.rate, 5.5); assert.match(a.note, /5,5 %/);
});
test('conseil d’un travail : rien si la confiance est « à vérifier »', () => {
  assert.equal(workVatAdvice(farm({parcel: {culture: ''}}), {work: W('w1', 'Moisson')}), null);
  assert.equal(workVatAdvice(farm({parcel: {culture: 'Maïs'}}), {work: W('w1', 'Moisson')}), null);
});
test('conseil d’un travail : rien en franchise ou en remboursement forfaitaire', () => {
  assert.equal(workVatAdvice(farm({invoicing: {vatRegime: 'franchise'}}), {work: W('w1', 'Moisson')}), null);
  assert.equal(workVatAdvice(farm({invoicing: {vatRegime: 'remboursement-forfaitaire'}}), {work: W('w1', 'Moisson')}), null);
});
test('lignes à facturer : taux conseillé et trace non imprimée', () => {
  const items = billableItems(farm(), 'c1', {vatAdvice: workVatAdvice});
  const work = items.find(i => i.kind === 'work').line;
  assert.equal(work.vatRate, 5.5); assert.match(work.vatBasis, /conseillée/); assert.match(work.basis, /^Tarif horaire du client · TVA 5,5 %/);
  assert.ok(work.basis.length <= 120);
});
test('lignes à facturer : gazole refacturé au taux de son travail', () => {
  const s = farm({works: [W('w1', 'Moisson', {fuel: 30}), W('w2', 'Semis', {fuel: 10})]});
  const items = billableItems(s, 'c1', {vatAdvice: workVatAdvice});
  const by = key => items.find(i => i.key === key).line;
  assert.equal(by('work:w1').vatRate, 5.5); assert.equal(by('fuel:w1').vatRate, 5.5);
  assert.equal(by('work:w2').vatRate, 20); assert.equal(by('fuel:w2').vatRate, 20);
  assert.match(by('fuel:w1').basis, /comme le travail/);
});
test('lignes à facturer : taux des paramètres sans conseil sûr ou probable', () => {
  const s = farm({parcel: {culture: ''}, invoicing: {vatRate: 10}});
  const line = billableItems(s, 'c1', {vatAdvice: workVatAdvice}).find(i => i.kind === 'work').line;
  assert.equal(line.vatRate, 10); assert.equal(line.vatBasis, undefined);
  assert.equal(billableItems(farm(), 'c1', {vatAdvice: null}).find(i => i.kind === 'work').line.vatRate, 20);
});
test('lignes à facturer : franchise, taux des paramètres', () => {
  const s = farm({invoicing: {vatRegime: 'franchise', vatRate: 0}});
  assert.equal(billableItems(s, 'c1', {vatAdvice: workVatAdvice}).find(i => i.kind === 'work').line.vatRate, 0);
});
test('lignes à facturer : destination énergie de la parcelle → 20 %', () => {
  const s = farm({parcel: {culture: 'Maïs', cropDestination: 'energie', cropDestinationFor: 'Maïs'}});
  assert.equal(billableItems(s, 'c1', {vatAdvice: workVatAdvice}).find(i => i.kind === 'work').line.vatRate, 20);
});
test('lignes à facturer : un conseil qui échoue ou hors taux proposés garde les paramètres', () => {
  assert.equal(billableItems(farm(), 'c1', {vatAdvice: () => { throw new Error('x'); }}).find(i => i.kind === 'work').line.vatRate, 20);
  assert.equal(billableItems(farm(), 'c1', {vatAdvice: () => ({rate: 7, note: 'x'})}).find(i => i.kind === 'work').line.vatRate, 20);
});
test('conseil branché par défaut dès le chargement de vat-advisor.js', () => {
  assert.equal(billableItems(farm(), 'c1').find(i => i.kind === 'work').line.vatRate, 5.5);
});
test('contrôle : gazole comparé à son travail, destination de la parcelle prise en compte', () => {
  const s = farm({works: [W('w1', 'Moisson', {fuel: 30}), W('w2', 'Semis')]});
  const doc = {issueDate: '2026-11-12', clientId: 'c1', clientName: 'Paul Client', lines: [
    {label: 'Semis · Le Grand Champ', quantity: 10, unitPrice: 100, vatRate: 20, source: {type: 'work', id: 'w2'}},
    {label: 'Moisson · Le Grand Champ', quantity: 2, unitPrice: 100, vatRate: 5.5, source: {type: 'work', id: 'w1'}},
    {label: 'Gazole refacturé · Moisson · Le Grand Champ', quantity: 30, unitPrice: 1.2, vatRate: 5.5, source: {type: 'fuel', id: 'w1'}}]};
  assert.deepEqual(checkDocumentVat(s, doc).filter(w => w.code === 'accessoire'), []);
});
