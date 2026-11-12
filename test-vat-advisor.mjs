// Conseil de taux de TVA (vat-advisor.js) : opérations de façon, services au taux normal,
// travaux forestiers, ventes de produits, contrôle des documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classify, clientCategory, cropRate, checkDocumentVat, FORESTRY_END} from './vat-advisor.js';

const T = '2026-11-12';
const rate = (label, opts = {}) => classify(label, {today: T, ...opts})?.rate;
const GAEC = {clientName: 'GAEC des Prés', clientKind: 'pro'};

test('opérations de façon : taux du produit obtenu', () => {
  assert.equal(rate('Labour pour blé'), 5.5);
  assert.equal(rate('Moisson de blé'), 5.5);
  assert.equal(rate('Moisson de chanvre'), 20);
  assert.equal(classify('Moisson de chanvre').confidence, 'sure');
  assert.equal(rate('Moisson de blé fourrager'), 10, 'destination animale');
  assert.equal(rate('Moisson de blé', {destination: 'animale'}), 10);
  assert.equal(rate('Récolte de pommes de terre'), 5.5);
  assert.equal(rate('Arrachage de betteraves sucrières'), 5.5);
  assert.equal(rate('Battage de triticale'), 10);
  assert.equal(rate('Broyage de paille'), 5.5);
  assert.equal(rate('Pressage de paille'), 5.5);
  assert.equal(rate('Hersage colza'), 5.5);
  assert.equal(classify('Hersage colza').confidence, 'check');
  assert.equal(rate('Vendanges'), 5.5);
  assert.equal(rate('Récolte de maïs pour méthaniseur'), 20, 'destination non alimentaire');
});

test('préparation des sols ou récolte sans culture : taux réduit à confirmer', () => {
  const l = classify('Labour');
  assert.equal(l.category, 'facon');
  assert.equal(l.confidence, 'check');
  assert.deepEqual(l.alternatives.map(a => a.rate).sort(), [20, 5.5]);
  assert.match(l.ref, /SECT-80-70 §30/);
  assert.equal(classify('Moisson').confidence, 'check');
  assert.equal(rate('Faux semis'), 10, 'un faux semis est un travail du sol, pas un semis');
});

test('services toujours au taux normal (§30)', () => {
  for (const label of ['Semis de blé', 'Pulvérisation fongicide', 'Épandage de lisier', 'Épandage d’engrais', 'Désherbage mécanique', 'Taille de vigne', 'Tri de semences', 'Plantation de pommes de terre', 'Curage de fossés', 'Drainage', 'Tonte des brebis', 'Chargement de betteraves', 'Pressurage pour vinification']) {
    const a = classify(label, {today: T});
    assert.equal(a.rate, 20, label);
    assert.equal(a.confidence, 'sure', label);
  }
});

test('cas non traités par la doctrine : 20 % à vérifier', () => {
  for (const label of ['Transport de céréales', 'Ensilage de maïs', 'Fauchage de ray grass', 'Enrubannage', 'Location de tracteur avec chauffeur', 'Séchage de foin']) {
    const a = classify(label, {today: T});
    assert.equal(a.rate, 20, label);
    assert.equal(a.confidence, 'check', label);
  }
  assert.ok(classify('Ensilage de maïs').alternatives.some(a => a.rate === 10), 'taux réduit évoqué comme alternative');
});

test('travaux forestiers : 10 % pour un exploitant agricole jusqu’au 31/12/2028', () => {
  assert.equal(rate('Abattage', GAEC), 10);
  assert.equal(rate('Élagage de haies', {clientName: 'EARL du Moulin'}), 10);
  assert.equal(rate('Abattage', {clientKind: 'particulier', clientName: 'M. Martin'}), 20);
  assert.equal(classify('Abattage', {clientKind: 'particulier', today: T}).confidence, 'sure');
  assert.equal(rate('Élagage', {clientName: 'Commune de Montrevel'}), 20);
  assert.equal(rate('Abattage', {...GAEC, today: '2029-01-02'}), 20);
  assert.equal(rate('Abattage', {...GAEC, today: FORESTRY_END}), 10);
  const u = classify('Débroussaillage', {today: T});
  assert.equal(u.rate, 20); assert.equal(u.confidence, 'check'); assert.ok(u.alternatives.some(a => a.rate === 10));
  assert.equal(rate('Sciage de bois', GAEC), 20, 'travaux postérieurs au débardage');
  assert.notEqual(classify('Abattage de bovins', {...GAEC, today: T})?.category, 'forestier');
});

test('ventes de produits', () => {
  assert.equal(rate('Vente de paille'), 10);
  assert.equal(rate('Foin en bottes'), 10);
  assert.equal(rate('Vente de bovins'), 10);
  assert.equal(rate('Broutards'), 10);
  assert.equal(rate('Légumes de saison'), 5.5);
  assert.equal(rate('Pommes de terre'), 5.5);
  assert.equal(rate('Vente de blé'), 5.5);
  assert.equal(rate('Bûches de chêne'), 10);
  assert.equal(rate('Fumier'), 10);
  assert.equal(classify('Fumier').confidence, 'check');
  assert.equal(rate('Vente de vin'), 20);
  assert.equal(rate('Vente de chevaux'), 20);
  assert.equal(rate('Truc inconnu'), undefined);
});

test('élevage, logement, franchise, frais accessoires', () => {
  assert.equal(rate('Engraissement de taurillons'), 5.5);
  assert.equal(rate('Saillie'), 5.5);
  assert.equal(rate('Rénovation salle de bains', {clientKind: 'particulier'}), 10);
  assert.equal(classify('Rénovation salle de bains', {clientKind: 'particulier'}).confidence, 'check');
  assert.equal(rate('Rénovation salle de bains', {clientKind: 'pro'}), 20);
  assert.equal(rate('Moisson de blé', {regime: 'franchise'}), 0);
  assert.equal(rate('Gazole refacturé', {mainRate: 10}), 10);
  assert.equal(rate('Déplacement', {mainRate: 5.5}), 5.5);
  assert.equal(classify('Déplacement').category, 'accessoire');
  assert.equal(rate('Terrassement'), 20);
  assert.equal(rate('Pelle'), 20);
});

test('catégorie du client', () => {
  assert.equal(clientCategory({clientName: 'GAEC des Prés'}), 'farm');
  assert.equal(clientCategory({clientName: 'SCEA du Bois', clientKind: 'pro'}), 'farm');
  assert.equal(clientCategory({clientName: 'Mairie de Bourg'}), 'public');
  assert.equal(clientCategory({clientName: 'Paul Martin', clientKind: 'particulier'}), 'private');
  assert.equal(clientCategory({clientName: 'SARL Transports Durand', clientKind: 'pro'}), 'pro');
  assert.equal(clientCategory({client: {name: 'Dupont', farmer: true}}), 'farm');
  assert.equal(clientCategory({}), 'unknown');
  assert.equal(cropRate('Labour'), null);
  assert.equal(cropRate('blé meunier').rate, 5.5);
});

const st = (invoicing = {}) => ({exploitation: {invoicing: {vatRegime: 'normal', ...invoicing}}, clients: []});
const codes = list => list.map(w => w.code);

test('contrôle d’un document : avertissements TVA', () => {
  const doc = (lines, extra = {}) => ({issueDate: T, clientName: 'GAEC des Prés', clientKind: 'pro', lines, ...extra});
  assert.deepEqual(checkDocumentVat(st(), doc([{label: 'Moisson de blé', quantity: 10, unitPrice: 100, vatRate: 5.5}])), []);
  // Gazole refacturé à un autre taux que la prestation principale.
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Moisson de blé', quantity: 10, unitPrice: 100, vatRate: 5.5}, {label: 'Gazole refacturé', quantity: 40, unitPrice: 1.5, vatRate: 20}]))), ['accessoire']);
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Moisson de blé', quantity: 10, unitPrice: 100, vatRate: 5.5}], {shipping: {label: 'Déplacement', amount: 30, vatRate: 20}}))), ['accessoire']);
  // Forestier à 10 % : particulier, commune, après 2028, client non identifié.
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Abattage', quantity: 1, unitPrice: 500, vatRate: 10}], {clientName: 'Paul Martin', clientKind: 'particulier'}))), ['forestier-client']);
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Élagage', quantity: 1, unitPrice: 500, vatRate: 10}], {clientName: 'Commune de Foissiat', clientKind: 'pro'}))), ['forestier-client']);
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Abattage', quantity: 1, unitPrice: 500, vatRate: 10}], {issueDate: '2029-02-01'}))), ['forestier-date']);
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Abattage', quantity: 1, unitPrice: 500, vatRate: 10}], {clientName: 'SARL Durand'}))), ['forestier-verifier']);
  assert.deepEqual(checkDocumentVat(st(), doc([{label: 'Abattage', quantity: 1, unitPrice: 500, vatRate: 10}])), []);
  // Taux réduit agricole pour un particulier.
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Labour', quantity: 1, unitPrice: 80, vatRate: 10}], {clientName: 'Paul Martin', clientKind: 'particulier'}))), ['reduit-particulier']);
  // Écart avec une règle sûre.
  const w = checkDocumentVat(st(), doc([{label: 'Semis de blé', quantity: 10, unitPrice: 60, vatRate: 10}]));
  assert.deepEqual(codes(w), ['ecart']); assert.match(w[0].text, /Ligne 1 « Semis de blé » à 10 % : le taux usuel est 20 %/);
  // 0 % sans motif alors qu'une mention libre existe.
  assert.deepEqual(codes(checkDocumentVat(st({mention: 'Texte'}), doc([{label: 'Prestation', quantity: 1, unitPrice: 50, vatRate: 0}]))), ['zero-sans-motif']);
  // Client UE sans autoliquidation.
  assert.deepEqual(codes(checkDocumentVat(st(), doc([{label: 'Prestation', quantity: 1, unitPrice: 50, vatRate: 20}], {clientVat: 'DE123456789'}))), ['client-ue']);
  assert.deepEqual(checkDocumentVat(st(), doc([{label: 'Prestation', quantity: 1, unitPrice: 50, vatRate: 0, vatExemption: 'autoliquidation'}], {clientVat: 'DE123456789'})), []);
  // Franchise mais TVA facturée.
  assert.deepEqual(codes(checkDocumentVat(st({vatRegime: 'franchise'}), doc([{label: 'Labour', quantity: 1, unitPrice: 80, vatRate: 20}]))), ['franchise']);
  // Travaux dans un logement à 10 % sans attestation.
  const home = doc([{label: 'Rénovation salle de bains', quantity: 1, unitPrice: 3000, vatRate: 10}], {clientName: 'Paul Martin', clientKind: 'particulier'});
  assert.deepEqual(codes(checkDocumentVat(st(), home)), ['logement-attestation']);
  assert.deepEqual(checkDocumentVat(st(), {...home, terms: 'Attestation du client : logement achevé depuis plus de 2 ans.'}), []);
});

test('suggestVatRate : catalogue et habitude d’abord, mise en garde contre une règle sûre', async () => {
  const {suggestVatRate} = await import('./billing-insights.js');
  const {emptyState} = await import('./state.js');
  const state = emptyState();
  const r = suggestVatRate('Moisson de blé', {state});
  assert.equal(r.rate, 5.5); assert.ok(r.basis); assert.ok(r.alternatives.some(a => a.rate === 10)); assert.ok(r.reason);
  assert.equal(suggestVatRate('Abattage', {state, clientName: 'GAEC des Prés', today: T}).rate, 10);
  assert.equal(suggestVatRate('Abattage', {state, clientKind: 'particulier', today: T}).rate, 20);
  const {INVOICE_KIND} = await import('./invoices-core.js');
  state.integrationImports = [{id: 'f1', farmKind: INVOICE_KIND, docType: 'facture', status: 'emise', number: 'F1', issueDate: '2026-05-01', lines: [{label: 'Semis de blé', quantity: 1, unitPrice: 50, vatRate: 10}]}];
  const h = suggestVatRate('Semis de blé', {state});
  assert.equal(h.basis, 'Taux déjà utilisé pour cette désignation'); assert.equal(h.rate, 10); assert.match(h.caution, /20 %/);
});

test('libellés « Type · Parcelle » : le nom de parcelle est ignoré', () => {
  assert.equal(rate('Moisson de blé · Champ du fossé'), 5.5);
  assert.equal(classify('Moisson · Derrière la maison', {today: T, clientKind: 'private'}).category, 'facon');
  assert.equal(rate('Labour pour blé · La Taille'), 5.5);
  assert.notEqual(classify('Moissonneuse · Les Vignes', {today: T}).category, 'logement');
  assert.equal(cropRate('Moisson · Les Vignes'.split(' · ')[0]), null);
  assert.equal(classify('Moisson · Les Vignes', {today: T}).confidence, 'check');
  // Frais accessoires détectés sur tout le libellé.
  assert.equal(classify('Gazole refacturé · Champ du fossé', {today: T, mainRate: 5.5}).category, 'accessoire');
  const doc = {issueDate: T, clientName: 'GAEC des Prés', clientKind: 'pro', lines: [{label: 'Moisson de blé · Champ du fossé', quantity: 10, unitPrice: 100, vatRate: 5.5}]};
  assert.deepEqual(checkDocumentVat(st(), doc), []);
});

test('arrachage et ramassage : récolte seulement avec une culture récoltable', () => {
  assert.equal(rate('Arrachage de pommes de terre'), 5.5);
  assert.equal(classify('Arrachage de betteraves', {today: T}).category, 'facon');
  for (const label of ['Arrachage de vigne', 'Arrachage de haies', 'Ramassage de pierres', 'Arrachage']) {
    const a = classify(label, {today: T});
    assert.equal(a.rate, 20, label); assert.equal(a.category, 'service', label); assert.equal(a.confidence, 'check', label);
  }
  assert.equal(classify('Arrachage de haies', {today: T}).alternatives[0].rate, 10);
  assert.deepEqual(classify('Ramassage de pierres', {today: T}).alternatives, []);
});
