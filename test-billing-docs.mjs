// Documents de facturation (v13, chantier A) : fonctions de vue pures de billing-docs-view.js (listes, filtres, tri,
// actions selon l'état, frise, relances, paiements, avoirs partiels, éditeur, clients, conformité, écritures) et
// compléments du moteur (client modifiable sur un brouillon, conditions par défaut d'une fiche, e-mail de facturation).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from './state.js';
import {createDraft, saveDraft, emitDocument, addPayment, createCreditNote, saveSettings, clientSnapshot, clientTerms, invoiceStatus} from './invoices.js';
import {acceptQuote, createDepositInvoice, convertQuote, recordReminder, logSent, saveCatalogItem} from './billing.js';
import {documentRecipients} from './billing-messages.js';
import {validateFacturX, facturXml} from './billing-export.js';
import {docRow, listRows, listSummary, listClients, matchesFilter, sortRows, docActions, rowActions, actionLabel, reminderLevel, overpaymentTargets, checkPayment, creditLines,
  timeline, newLine, moveLine, duplicateLine, removeLine, lineAmount, dueDateFor, termOf, fuzzyClients, clientScore, clientBillingValues, fixFor, complianceItems, upcomingNumber,
  documentJournal, safeName, editorState, draftValues, workingDoc, applyClient, catalogMatches, billablePicks, priceHint, clientBalance, docAdvice, money, STATUS_FILTERS, LIST_TYPES} from './billing-docs-view.js';

class MemoryStorage {constructor() { this.value = null; } async init() {} async get() { return this.value; } async set(_k, v) { this.value = structuredClone(v); } async backupPut() {} async pruneBackups() {} async blobDelete() {}}
const SETTINGS = {legalName: 'EARL du Sougey', legalForm: 'EARL au capital de 7 500 €', capital: '7 500 €', rcs: 'RCS Bourg 123 456 789', address: '1 route du Sougey\n01340 Montrevel', siret: '12345678900012', vatNumber: 'FR12345678901', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP', paymentDays: 30, vatRate: 20, prefix: 'F'};
const CLIENTS = [
  {id: 'c1', name: 'GAEC du Bois Joli', address: 'Le Bois\n01000 Bourg-en-Bresse', contact: 'Paul Martin', email: 'gaec@exemple.fr', billingEmail: 'compta@gaec-bois.fr', phone: '06 12 34 56 78', hourlyRate: 60, kind: 'pro', siren: '732829320', paymentDays: 15, discountPct: 5, deliveryAddress: 'Ferme du Bois, 01000 Bourg'},
  {id: 'c2', name: 'Mme Durand', address: '3 rue Haute\n01340 Foissiat', kind: 'particulier'},
  {id: 'c3', name: 'SCEA Ancienne', address: 'Loin', archived: true}
];
async function makeStore() {
  const store = new Store(new MemoryStorage()); await store.init(); await store.setPreferences({autoBackup: false});
  await store.upsertMany('clients', CLIENTS); await saveSettings(store, SETTINGS);
  return store;
}
const L = (label, quantity, unitPrice, vatRate = 20, more = {}) => ({label, quantity, unit: 'h', unitPrice, vatRate, ...more});
const doc = (store, id) => store.get('integrationImports', id);
async function issued(store, {clientId = 'c1', lines = [L('Pelle', 10, 65)], docType = 'facture', today = '2026-09-01'} = {}) {
  const d = await createDraft(store, {clientId, lines, docType, today}); return emitDocument(store, d.id, {today});
}

test('liste : statuts calculés, reste dû, retard, recherche (numéro, client, désignation, montant), filtres et tri', async () => {
  const store = await makeStore();
  const a = await issued(store, {today: '2026-08-01'}); // 780 € TTC, échéance au 31/08
  await addPayment(store, a.id, {date: '2026-09-10', amount: 300});
  const b = await issued(store, {clientId: 'c2', lines: [L('Broyage de haies', 2, 50, 10)], today: '2026-10-01'});
  const q = await issued(store, {docType: 'devis', lines: [L('Terrassement', 8, 90)], today: '2026-10-05'});
  const draft = await createDraft(store, {clientId: 'c2', lines: [L('Fauche', 1, 40)], today: '2026-10-10'});
  const state = store.state, today = '2026-10-20';
  const ra = docRow(state, doc(store, a.id), today);
  assert.equal(ra.status, 'retard'); assert.equal(ra.due, 480); assert.equal(ra.paid, 300); assert.equal(ra.lateDays, 50);
  assert.equal(docRow(state, doc(store, draft.id), today).title, 'Brouillon');
  const all = listRows(state, 'all', {}, today);
  assert.equal(all.length, 4); assert.equal(all[0].id, draft.id, 'les brouillons d’abord');
  assert.deepEqual(listRows(state, 'facture', {query: 'durand'}, today).map(r => r.id), [draft.id, b.id]);
  assert.deepEqual(listRows(state, 'all', {query: 'broyage'}, today).map(r => r.id), [b.id]);
  assert.deepEqual(listRows(state, 'all', {query: '780,00'}, today).map(r => r.id), [a.id], 'montant TTC avec virgule');
  assert.deepEqual(listRows(state, 'all', {query: a.number}, today).map(r => r.id), [a.id]);
  assert.deepEqual(listRows(state, 'facture', {status: 'due'}, today).map(r => r.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(listRows(state, 'facture', {status: 'retard'}, today).map(r => r.id), [a.id]);
  assert.deepEqual(listRows(state, 'all', {client: 'c2'}, today).map(r => r.id).sort(), [b.id, draft.id].sort());
  assert.deepEqual(listRows(state, 'all', {from: '2026-10-01', to: '2026-10-06'}, today).map(r => r.id).sort(), [b.id, q.id].sort());
  assert.deepEqual(listRows(state, 'all', {min: '200', max: '800'}, today).map(r => r.id), [a.id]);
  assert.deepEqual(listRows(state, 'all', {sort: 'amount-desc'}, today).map(r => r.id)[0], q.id);
  assert.deepEqual(listRows(state, 'all', {sort: 'client'}, today).map(r => r.clientName)[0], 'GAEC du Bois Joli');
  assert.deepEqual(listRows(state, 'devis', {}, today).map(r => r.status), ['envoye']);
  const sum = listSummary(listRows(state, 'facture', {}, today));
  assert.deepEqual([sum.count, sum.due, sum.late, sum.lateDue, sum.drafts], [3, 480 + 110, 1, 480, 1]);
  assert.deepEqual(listClients(state, 'all').map(c => c.name), ['GAEC du Bois Joli', 'Mme Durand']);
  assert.ok(matchesFilter(ra, {status: 'all'})); assert.ok(!matchesFilter(ra, {status: 'payee'}));
  assert.deepEqual(sortRows([{number: 'F2', issueDate: '2026-01-01', ttc: 1}, {number: 'F10', issueDate: '2026-01-01', ttc: 2}], 'number').map(r => r.number), ['F10', 'F2'], 'tri numérique des numéros');
  for (const [k] of LIST_TYPES) assert.ok(STATUS_FILTERS[k], `filtres de statut pour ${k}`);
});

test('actions selon l’état : brouillon, devis envoyé puis accepté, acompte, facture en retard, payée, avoir, lecture seule', async () => {
  const store = await makeStore(), today = '2026-10-20';
  const late = await issued(store, {today: '2026-08-01'}); // émise d'abord : la numérotation reste chronologique
  const draft = await createDraft(store, {clientId: 'c1', lines: [L('A', 1, 10)], today});
  assert.deepEqual(docActions(store.state, doc(store, draft.id), {today}), ['edit', 'emit', 'preview', 'delete']);
  const q = await issued(store, {docType: 'devis', lines: [L('Terrassement', 10, 100)], today: '2026-10-01'});
  assert.deepEqual(docActions(store.state, doc(store, q.id), {today}).slice(0, 3), ['accept', 'send', 'refuse']);
  await acceptQuote(store, q.id, {date: '2026-10-02', signatory: 'Paul Martin'});
  assert.deepEqual(docActions(store.state, doc(store, q.id), {today}).slice(0, 2), ['invoice', 'deposit']);
  assert.equal(actionLabel('invoice', doc(store, q.id), store.state), 'Facturer');
  const dep = await createDepositInvoice(store, q.id, {percent: 30, today: '2026-10-03'});
  await emitDocument(store, dep.id, {today: '2026-10-03'});
  assert.equal(docActions(store.state, doc(store, q.id), {today})[0], 'balance', 'acompte émis : facture de solde');
  assert.equal(actionLabel('invoice', doc(store, q.id), store.state), 'Facture de solde');
  assert.deepEqual(docActions(store.state, doc(store, late.id), {today}).slice(0, 3), ['pay', 'remind', 'send']);
  assert.deepEqual(rowActions(store.state, doc(store, late.id), {today}), ['pay', 'remind']);
  await addPayment(store, late.id, {date: today, amount: 800});
  const paid = docActions(store.state, doc(store, late.id), {today});
  assert.ok(paid.includes('transfer') && paid.includes('thank') && paid.includes('credit'), 'trop-perçu, remerciement et avoir');
  const avoir = await createCreditNote(store, late.id, {today});
  await emitDocument(store, avoir.id, {today});
  assert.deepEqual(docActions(store.state, doc(store, avoir.id), {today}), ['send', 'preview', 'pdf', 'xml', 'journal']);
  assert.deepEqual(docActions(store.state, doc(store, q.id), {canWrite: false, today}), ['preview', 'pdf'], 'devis en lecture seule : ni Factur-X ni écritures');
  assert.deepEqual(docActions(store.state, doc(store, late.id), {canWrite: false, today}), ['preview', 'pdf', 'xml', 'journal']);
  assert.equal(actionLabel('emit', {docType: 'devis'}), 'Émettre le devis');
});

test('relances, paiements, trop-perçu et avoir partiel', async () => {
  const store = await makeStore(), today = '2026-10-20';
  const a = await issued(store, {today: '2026-08-01'}), b = await issued(store, {lines: [L('Fauche', 2, 50)], today: '2026-10-01'});
  assert.deepEqual(reminderLevel(store.state, doc(store, a.id), today), {level: 3, sent: 0, daysLate: 50, fee: 40, reached: 3});
  await recordReminder(store, a.id, {level: 1, date: '2026-09-10'});
  assert.equal(reminderLevel(store.state, doc(store, a.id), '2026-09-12').level, 2, 'le niveau suivant du dernier envoyé');
  assert.match(checkPayment(store.state, doc(store, a.id), {amount: '0', date: today}).error, /positif/);
  assert.match(checkPayment(store.state, doc(store, a.id), {amount: '10', date: '2026-13-01'}).error, /Date/);
  assert.deepEqual(checkPayment(store.state, doc(store, a.id), {amount: '800,50', date: today}), {value: 800.5, overpaid: 20.5, due: 780});
  await addPayment(store, a.id, {date: today, amount: 800.5});
  const targets = overpaymentTargets(store.state, doc(store, a.id), today);
  assert.deepEqual(targets.map(t => [t.doc.id, t.due]), [[b.id, 120]]);
  const lines = doc(store, b.id).lines;
  assert.match(creditLines(doc(store, b.id), {}).errors[0], /au moins une ligne/);
  assert.match(creditLines(doc(store, b.id), {[lines[0].id]: '3'}).errors[0], /dépasse la quantité facturée/);
  const part = creditLines(doc(store, b.id), {[lines[0].id]: '0,5'});
  assert.deepEqual(part.lines.map(l => l.quantity), [0.5]);
  const avoir = await createCreditNote(store, b.id, {lines: part.lines, today});
  assert.equal(doc(store, avoir.id).totals.ttc, -30, 'avoir partiel : une demi-heure');
  const xmlDoc = await emitDocument(store, avoir.id, {today});
  assert.equal(validateFacturX(facturXml(store.state, xmlDoc)).ok, true, 'Factur-X de l’avoir partiel valide');
  assert.equal(invoiceStatus(doc(store, b.id), store.state, today), 'emise');
});

test('solde : chaque acompte est déduit à l’identique ; acompte + solde = HT, TVA et TTC du devis ; FEC égal aux lignes', async () => {
  const {documentTotals} = await import('./invoices.js'), {billingJournal} = await import('./billing-export.js');
  const store = await makeStore();
  const d = await createDraft(store, {clientId: 'c1', docType: 'devis', today: '2026-10-01', lines: [L('Pelle', 8, 70, 20), L('Plants', 100, 3.5, 10)]});
  await saveDraft(store, d.id, {clientId: 'c1', clientName: d.clientName, clientAddress: d.clientAddress, lines: d.lines, issueDate: d.issueDate, validUntil: d.validUntil, discount: {type: 'pct', value: 5}});
  const q = await emitDocument(store, d.id, {today: '2026-10-01'});
  assert.deepEqual([q.totals.ht, q.totals.tva, q.totals.ttc], [864.5, 139.65, 1004.15]);
  await acceptQuote(store, q.id, {date: '2026-10-02', signatory: 'Paul Martin'});
  const dep = await createDepositInvoice(store, q.id, {percent: 30, today: '2026-10-03'}); const de = await emitDocument(store, dep.id, {today: '2026-10-03'});
  assert.deepEqual([de.totals.ht, de.totals.ttc], [259.35, 301.25]);
  const fin = await convertQuote(store, q.id, {today: '2026-10-10'}); const fe = await emitDocument(store, fin.id, {today: '2026-10-10'});
  const ded = fe.lines.filter(l => l.kind === 'deduction').map(l => [l.vatRate, l.unitPrice]);
  assert.deepEqual(ded, [[20, -159.6], [10, -99.75]], 'déductions = lignes de l’acompte émis');
  assert.deepEqual([fe.totals.ht, fe.totals.tva, fe.totals.ttc], [605.15, 97.75, 702.9]);
  const rate = (t, r) => t.byRate.find(x => x.rate === r);
  assert.equal(rate(fe.totals, 20).tax, 74.48); assert.equal(rate(fe.totals, 10).tax, 23.27);
  assert.equal(Math.round((de.totals.ht + fe.totals.ht) * 100) / 100, 864.5);
  assert.equal(Math.round((rate(de.totals, 10).tax + rate(fe.totals, 10).tax) * 100) / 100, 33.25);
  assert.equal(documentTotals(doc(store, fe.id)).ttc, fe.totals.ttc, 'total recalculé = total émis');
  assert.deepEqual(validateFacturX(facturXml(store.state, doc(store, fe.id))).errors, []);
  // Journal : le compte de ventes égale les lignes de la pièce (560 + 350), sans écart reporté.
  const j = billingJournal(store.state); const e = j.entries.find(x => x.piece === fe.number);
  assert.equal(e.rows.filter(r => r.label === 'Ventes').reduce((s, r) => s + r.credit - r.debit, 0), 910);
  assert.deepEqual(j.warnings, []);
  // Une déduction retouchée à la main reprend la TVA calculée (base × taux).
  const touched = {...doc(store, fe.id), lines: fe.lines.map(l => l.kind === 'deduction' && l.vatRate === 20 ? {...l, unitPrice: -100} : l)};
  assert.equal(rate(documentTotals(touched), 20).tax, Math.round(rate(documentTotals(touched), 20).base * 20) / 100);
});

test('frise : création, émission, envoi, relance, paiement, acceptation, conversions, avoir, déduction d’acompte', async () => {
  const store = await makeStore();
  const q = await issued(store, {docType: 'devis', lines: [L('Terrassement', 10, 100)], today: '2026-10-01'});
  await logSent(store, q.id, {date: '2026-10-01', channel: 'email', recipients: [{name: 'Paul Martin'}]});
  await acceptQuote(store, q.id, {date: '2026-10-02', signatory: 'Paul Martin'});
  const dep = await createDepositInvoice(store, q.id, {percent: 30, today: '2026-10-03'}); await emitDocument(store, dep.id, {today: '2026-10-03'});
  const fin = await convertQuote(store, q.id, {today: '2026-10-10'}); const fe = await emitDocument(store, fin.id, {today: '2026-10-10'});
  await addPayment(store, fe.id, {date: '2026-10-12', amount: 100, method: 'cheque', reference: 'CHQ 42'});
  await recordReminder(store, fe.id, {level: 1, date: '2026-11-20', channel: 'sms'});
  const tq = timeline(store.state, doc(store, q.id)).map(e => [e.kind, e.label]);
  assert.deepEqual(tq.map(e => e[0]), ['create', 'emit', 'send', 'accept', 'convert', 'convert']);
  assert.match(tq[0][1], /Devis préparé en brouillon/);
  assert.match(tq[2][1], /Envoyé par e-mail à Paul Martin/);
  assert.match(tq[3][1], /Accepté par Paul Martin \(« Bon pour accord »\)/);
  const tf = timeline(store.state, doc(store, fe.id)).map(e => e.label);
  assert.ok(tf.some(l => /^Facture préparée en brouillon/.test(l)));
  assert.ok(tf.some(l => /^Issu du devis D/.test(l)));
  assert.ok(tf.some(l => /Paiement de 100,00.€ · Chèque · CHQ 42/.test(l)));
  assert.ok(tf.some(l => /^Relance 1 par SMS · reste/.test(l)));
  const td = timeline(store.state, doc(store, dep.id)).map(e => e.label);
  assert.ok(td.some(l => /^Facture d’acompte préparée/.test(l)), 'accord au féminin');
  assert.ok(td.some(l => /^Déduit de la facture F/.test(l)));
});

test('lignes de l’éditeur : ajout, déplacement, duplication sans lien, suppression, montant, échéance', () => {
  const lines = [{id: 'a', label: 'A', quantity: 2, unitPrice: '10,5', vatRate: 20, discountPct: 10, source: {type: 'work', id: 'w1'}}, newLine('section'), newLine('comment')];
  assert.equal(lineAmount(lines[0]), 18.9);
  assert.equal(lineAmount({label: 'x', quantity: 1, unitPrice: ''}), null);
  assert.equal(lineAmount(newLine('section')), null);
  assert.deepEqual(moveLine(lines, 0, 2).map(l => l.id)[2], 'a');
  assert.deepEqual(moveLine(lines, 2, -5).map(l => l.kind || 'item'), ['comment', 'item', 'section']);
  const dup = duplicateLine(lines, 0);
  assert.equal(dup.length, 4); assert.notEqual(dup[1].id, 'a'); assert.equal(dup[1].source, undefined, 'une copie ne refacture pas le même travail');
  assert.equal(removeLine(lines, 1).length, 2);
  assert.equal(newLine('item', {vatRate: 10}).vatRate, 10);
  assert.equal(dueDateFor('2026-01-31', 30), '2026-03-02');
  assert.equal(termOf({issueDate: '2026-10-01', dueDate: '2026-10-31'}), 30);
  assert.equal(termOf({issueDate: '2026-10-01', dueDate: '2026-10-20'}), null);
});

test('clients : recherche floue (faute de frappe, initiales, SIREN, e-mail) et fiche de facturation', () => {
  const list = [...CLIENTS, {id: 'c4', name: 'Société Laitière Bressane', siren: '552100554', billingEmail: 'factures@slb.fr'}];
  assert.equal(fuzzyClients(list, 'gaec')[0].id, 'c1');
  assert.equal(fuzzyClients(list, 'GAEC du Bios')[0].id, 'c1', 'faute de frappe');
  assert.equal(fuzzyClients(list, 'slb')[0].id, 'c4', 'initiales');
  assert.equal(fuzzyClients(list, '552100554')[0].id, 'c4');
  assert.equal(fuzzyClients(list, 'factures@slb')[0].id, 'c4');
  assert.ok(!fuzzyClients(list, 'ancienne').length, 'client archivé exclu');
  assert.equal(clientScore(CLIENTS[0], ''), 1);
  assert.equal(fuzzyClients(list, 'zzzz').length, 0);
  assert.match(clientBillingValues({}).error, /Nom du client/);
  assert.match(clientBillingValues({name: 'X', siren: '123'}).error, /SIREN invalide/);
  assert.match(clientBillingValues({name: 'X', vatNumber: '12'}).error, /TVA/);
  assert.match(clientBillingValues({name: 'X', billingEmail: 'pas-un-mail'}).error, /E-mail/);
  assert.match(clientBillingValues({name: 'X', paymentDays: '200'}).error, /120 jours/);
  assert.match(clientBillingValues({name: 'X', discountPct: '120'}).error, /100 %/);
  const ok = clientBillingValues({name: ' GAEC ', kind: 'pro', siren: '732 829 320 00014', vatNumber: 'fr 44 732829320', billingEmail: 'compta@gaec.fr', paymentDays: '30', discountPct: '5,5'});
  assert.deepEqual([ok.value.name, ok.value.siren, ok.value.vatNumber, ok.value.paymentDays, ok.value.discountPct], ['GAEC', '73282932000014', 'FR44732829320', 30, 5.5]);
  assert.deepEqual(ok.warnings, []);
  assert.match(clientBillingValues({name: 'X', siren: '123456789'}).warnings[0], /clé de contrôle/);
  assert.match(clientBillingValues({name: 'X', kind: 'pro'}).warnings[0], /SIREN sera obligatoire/);
});

test('moteur : conditions de la fiche client, e-mail de facturation, changement de client d’un brouillon', async () => {
  const store = await makeStore();
  assert.equal(clientSnapshot(CLIENTS[0]).clientEmail, 'compta@gaec-bois.fr', 'e-mail de facturation prioritaire');
  assert.deepEqual(clientTerms(CLIENTS[0], {paymentDays: 30}, '2026-10-01', false), {dueDate: '2026-10-16', discount: {type: 'pct', value: 5}, deliveryAddress: 'Ferme du Bois, 01000 Bourg'});
  assert.equal(clientTerms(CLIENTS[0], {}, '2026-10-01', true).dueDate, undefined, 'un devis n’a pas d’échéance');
  const d = await createDraft(store, {clientId: 'c1', lines: [L('A', 1, 100)], today: '2026-10-01', clientDefaults: true});
  assert.deepEqual([d.dueDate, d.discount?.value, d.deliveryAddress], ['2026-10-16', 5, 'Ferme du Bois, 01000 Bourg']);
  assert.equal(documentRecipients(store.state, d)[0].email, 'compta@gaec-bois.fr');
  const moved = await saveDraft(store, d.id, {clientId: 'c2', lines: d.lines, issueDate: d.issueDate, dueDate: d.dueDate}, {version: d.version});
  assert.deepEqual([moved.clientId, moved.clientName, moved.clientKind, moved.clientSiren], ['c2', 'Mme Durand', 'particulier', '']);
  await assert.rejects(saveDraft(store, d.id, {clientId: 'c3', lines: d.lines, issueDate: d.issueDate}), /archivé/);
  await assert.rejects(saveDraft(store, d.id, {clientId: 'inconnu', lines: d.lines, issueDate: d.issueDate}), /introuvable/);
});

test('éditeur : état, valeurs enregistrées, document de travail, client choisi et ligne vide ignorée', async () => {
  const store = await makeStore(), s = {paymentDays: 30, vatRate: 20, quoteValidityDays: 30, customVatRates: []};
  const fresh = editorState({docType: 'devis'}, {settings: s, today: '2026-10-01'});
  assert.deepEqual([fresh.docType, fresh.issueDate, fresh.dueDate, fresh.validUntil, fresh.term], ['devis', '2026-10-01', '', '2026-10-31', null]);
  const inv = editorState({docType: 'facture'}, {settings: s, today: '2026-10-01'});
  assert.deepEqual([inv.dueDate, inv.term], ['2026-10-31', 30]);
  const withClient = applyClient(inv, CLIENTS[0], {settings: s, fresh: true});
  assert.deepEqual([withClient.clientName, withClient.clientEmail, withClient.dueDate, withClient.term, withClient.discountValue, withClient.deliveryAddress], ['GAEC du Bois Joli', 'compta@gaec-bois.fr', '2026-10-16', 15, 5, 'Ferme du Bois, 01000 Bourg']);
  assert.equal(applyClient(inv, CLIENTS[0], {settings: s}).dueDate, '2026-10-31', 'brouillon existant : conditions inchangées');
  withClient.lines = [{id: 'x', label: 'Pelle', quantity: '3', unit: 'h', unitPrice: '65', vatRate: '20'}, newLine('item'), newLine('section')];
  withClient.lines[2].label = 'Divers';
  const values = draftValues(withClient);
  assert.equal(values.lines.length, 2, 'ligne neuve sans désignation ni prix : ignorée');
  assert.deepEqual(values.discount, {type: 'pct', value: 5});
  assert.equal(values.validUntil, undefined);
  const w = workingDoc(withClient, {customRates: []});
  assert.equal(w.error, ''); assert.equal(w.doc.totals.ht, 185.25); assert.equal(w.doc.totals.ttc, 222.3);
  const bad = workingDoc({...withClient, lines: [{id: 'y', label: '', quantity: 1, unitPrice: 10, vatRate: 20}]}, {customRates: []});
  assert.match(bad.error, /Désignation \(ligne 1\)/);
  // Aller-retour : un brouillon enregistré redonne le même état.
  const d = await createDraft(store, {clientId: 'c1', lines: [], today: '2026-10-01'});
  const saved = await saveDraft(store, d.id, draftValues({...withClient, id: d.id}), {version: d.version});
  const again = editorState(saved, {settings: s});
  assert.deepEqual(draftValues(again).lines.map(l => l.label), ['Pelle', 'Divers']);
  assert.equal(again.deliveryAddress, 'Ferme du Bois, 01000 Bourg');
});

test('catalogue, prestations non facturées, prix suggéré, encours client et conseil', async () => {
  const store = await makeStore();
  await saveCatalogItem(store, {code: 'PEL', label: 'Pelle 8 t avec chauffeur', unit: 'h', unitPrice: 70, vatRate: 20, clientPrices: [{clientId: 'c1', unitPrice: 62}]});
  await saveCatalogItem(store, {code: 'CAIL', label: 'Cailloux 0/31,5', unit: 't', unitPrice: 18, vatRate: 20, category: 'Matériaux'});
  assert.equal(catalogMatches(store.state, 'pel')[0].item.code, 'PEL');
  assert.equal(catalogMatches(store.state, 'pel', {clientId: 'c1'})[0].price, 62, 'prix propre au client');
  assert.equal(catalogMatches(store.state, 'materiaux')[0].item.code, 'CAIL');
  assert.equal(catalogMatches(store.state, '').length, 2);
  await store.upsert('parcelles', {id: 'p1', nom: 'Champ client', surfaceHa: 4, clientId: 'c1'});
  await store.upsert('interventions', {id: 'w1', parcelId: 'p1', type: 'Broyage', date: '2026-09-15', status: 'Terminé', durationHours: 2});
  const ed = editorState({docType: 'facture', clientId: 'c1', clientName: 'GAEC du Bois Joli'}, {today: '2026-10-01'});
  const picks = billablePicks(store.state, ed);
  assert.equal(picks.length, 1);
  assert.equal(billablePicks(store.state, {...ed, lines: [picks[0].line]}).length, 0, 'déjà repris dans le brouillon');
  assert.equal(billablePicks(store.state, {...ed, docType: 'devis'}).length, 0);
  const a = await issued(store, {lines: [L('Pelle 8 t avec chauffeur', 5, 64)], today: '2026-08-01'});
  const hint = priceHint(store.state, {label: 'Pelle 8 t avec chauffeur', unit: 'h', unitPrice: ''}, 'c1');
  assert.equal(hint.price, 64); assert.match(hint.text, new RegExp(`dernier prix pour ce client \\(${a.number}\\)`));
  assert.equal(priceHint(store.state, {label: 'Pelle 8 t avec chauffeur', unit: 'h', unitPrice: '64'}, 'c1'), null, 'même prix : rien à suggérer');
  assert.equal(priceHint(store.state, {kind: 'section', label: 'x'}, 'c1'), null);
  assert.deepEqual(clientBalance(store.state, 'c1', '2026-10-20'), {due: 384, late: 1, open: 1});
  assert.match(docAdvice(store.state, doc(store, a.id), '2026-10-20').text, /En retard de 50 jours : relance 3 conseillée \(frais 40,00.€\)/);
  const b = await issued(store, {lines: [L('Fauche', 1, 50)], today: '2026-10-19'});
  assert.deepEqual(docAdvice(store.state, doc(store, b.id), '2026-10-20'), {text: 'Pas encore envoyée au client.', action: 'send'});
  const q = await issued(store, {docType: 'devis', lines: [L('Terrassement', 1, 100)], today: '2026-10-01'});
  assert.match(docAdvice(store.state, doc(store, q.id), '2026-10-27').text, /Valable encore 4 jours/);
  await acceptQuote(store, q.id, {date: '2026-10-02', signatory: 'P'});
  assert.equal(docAdvice(store.state, doc(store, q.id), '2026-10-27').action, 'deposit');
});

test('conformité : erreurs bloquantes et avertissements avec leur correction, numéro à venir, écritures de la pièce', async () => {
  const store = await makeStore();
  const d = await createDraft(store, {client: {name: 'Client sans adresse', kind: 'pro'}, lines: [L('', 1, 10), L('B', 1, null, 0)], today: '2026-10-01'});
  const c = complianceItems(store.state, doc(store, d.id), '2026-10-01');
  assert.ok(c.errors >= 1);
  assert.ok(c.items.some(i => i.fix?.type === 'client' || i.fix?.field === 'clientAddress' || /Adresse/.test(i.text)));
  assert.deepEqual(fixFor('Désignation manquante (ligne 2)'), {type: 'line', index: 1});
  assert.deepEqual(fixFor('Paramètres de facturation incomplets'), {type: 'settings'});
  assert.deepEqual(fixFor('Échéance absente'), {type: 'field', field: 'dueDate'});
  assert.deepEqual(fixFor('Date de livraison ou de prestation absente'), {type: 'field', field: 'deliveryDate'});
  assert.equal(fixFor('Texte sans rapport'), null);
  const ok = await createDraft(store, {clientId: 'c1', lines: [L('Pelle', 2, 60)], today: '2026-10-01'});
  assert.equal(complianceItems(store.state, doc(store, ok.id), '2026-10-01').errors, 0);
  const n = upcomingNumber(store.state, doc(store, ok.id), '2026-10-01');
  const e = await emitDocument(store, ok.id, {today: '2026-10-01'});
  assert.equal(e.number, n, 'le numéro annoncé est celui attribué');
  assert.equal(upcomingNumber(store.state, {docType: 'proforma'}), null);
  await addPayment(store, e.id, {date: '2026-10-05', amount: 144});
  const j = documentJournal(store.state, doc(store, e.id));
  assert.equal(j.entries.length, 2, 'vente et règlement');
  assert.ok(j.text.startsWith('JournalCode|JournalLib'));
  assert.ok(j.text.split('\r\n').every(r => r.split('|').length === 18));
  assert.equal(safeName('Facture F/2026:1 « x »'), 'Facture F 2026 1 « x »');
  assert.equal(money(-1234.5), '−1 234,50 €');
});

test('branchement : module différé, déclencheurs, fichiers servis, feuille de style en couche', () => {
  const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  const lazy = read('lazy-modules.js'), sw = read('sw.js'), runtime = read('runtime.js'), html = read('index.html'), app = read('app.js'), css = read('billing-docs.css');
  assert.match(lazy, /billingDocs: \(\) => import\('\.\/billing-docs-ui\.js'\)/);
  assert.match(lazy, /'\[data-bdoc\]': 'billingDocs'/);
  for (const f of ['billing-docs-ui.js', 'billing-docs-view.js', 'billing-docs-editor.js', 'billing-docs-actions.js', 'billing-docs.css']) {
    assert.ok(sw.includes(`'./${f}'`), `${f} dans CORE`); assert.ok(runtime.includes(`'./${f}'`), `${f} dans REQUIRED_ASSETS`);
  }
  // Feuille liée à l'ouverture (lazy-styles.js), plus par index.html : le premier rendu ne l'attend pas.
  assert.doesNotMatch(html, /billing-docs\.css/);
  assert.match(read('lazy-styles.js'), /'billing-docs\.css': '\d+'/);
  assert.match(app, /lazy\.onLoad\('billingDocs',m=>m\.createBillingDocsUI\(/);
  assert.ok(css.trim().startsWith('/*') && /@layer features\{/.test(css));
  for (const f of ['billing-docs-ui.js', 'billing-docs-editor.js', 'billing-docs-actions.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\balert\(|reportValidity\(/, `${f} : erreurs en ligne (.form-error), jamais alert`);
    assert.doesNotMatch(src, /innerHTML\s*=\s*`/, `${f} : innerHTML toujours via html\`\``);
  }
});

test('correctifs de relecture : remise de ligne, version après la fiche client, double appui, liste paginée, capital', async () => {
  const view = await import('./billing-docs-view.js');
  const {complianceReport} = await import('./invoices.js');
  const store = await makeStore(), s = {paymentDays: 30, vatRate: 20, quoteValidityDays: 30, customVatRates: []};
  // Remise de ligne hors de 0 à 100 % : signalée, jamais affichée sans être appliquée, refusée à l'enregistrement.
  assert.equal(view.discountInvalid('150'), true); assert.equal(view.discountInvalid('-5'), true);
  assert.equal(view.discountInvalid('12,5'), false); assert.equal(view.discountInvalid(''), false);
  assert.equal(lineAmount(L('Pelle', 8, 70, 20, {discountPct: '150'})), 560, 'remise invalide non appliquée, comme dans les totaux');
  assert.equal(lineAmount(L('Pelle', 8, 70, 20, {discountPct: '10'})), 504);
  const d = await createDraft(store, {clientId: 'c1', lines: [L('Pelle', 8, 70)], today: '2026-10-01'});
  const ed = editorState(doc(store, d.id), {settings: s});
  ed.lines[0].discountPct = '150';
  const w = workingDoc(ed, {stored: doc(store, d.id)});
  assert.match(w.error, /Remise ligne 1 : entre 0 et 100 %/);
  assert.deepEqual(fixFor(w.error), {type: 'line', index: 0});
  await assert.rejects(saveDraft(store, d.id, draftValues(ed), {version: ed.version ?? undefined}), /Remise ligne 1/);
  // Retour de la fiche client : la version enregistrée entre-temps (fermeture de l'éditeur) est gardée.
  const back = {...editorState(doc(store, d.id), {settings: s}), subject: 'Objet A'};
  const saved = await saveDraft(store, d.id, draftValues(back), {version: back.version ?? undefined});
  const restored = view.restoreEditor(back, {...back, version: saved.version});
  assert.equal(restored.version, saved.version); assert.equal(restored.subject, 'Objet A');
  await assert.rejects(saveDraft(store, d.id, draftValues({...back, subject: 'Objet B'}), {version: back.version ?? undefined}));
  const ok = await saveDraft(store, d.id, draftValues({...restored, subject: 'Objet B'}), {version: restored.version ?? undefined});
  assert.equal(ok.subject, 'Objet B');
  assert.deepEqual(view.restoreEditor({subject: 'x'}, {subject: 'y'}), {subject: 'x'}, 'document neuf : rien à reprendre');
  // Double appui : une seule écriture, bouton réactivé si la fenêtre reste affichée.
  let calls = 0; const control = {disabled: false, isConnected: true};
  const act = view.exclusive(async () => { calls += 1; await new Promise(r => setTimeout(r, 5)); });
  await Promise.all([act(control), act(control)]);
  assert.equal(calls, 1); assert.equal(control.disabled, false);
  const gone = {disabled: false, isConnected: true};
  await view.exclusive(async c => { c.isConnected = false; })(gone);
  assert.equal(gone.disabled, true, 'fenêtre remplacée : le bouton disparu reste désactivé');
  // Liste : lignes calculées une fois puis filtrées ; client filtré sans document présent dans le filtre.
  await store.upsert('clients', {id: 'cl-neuf', name: 'SCEA Neuve', address: 'Ici'});
  const rows = view.docRows(store.state, 'all');
  assert.deepEqual(view.filterRows(rows, {query: 'bois'}).map(r => r.id), listRows(store.state, 'all', {query: 'bois'}).map(r => r.id));
  assert.ok(view.filterClients(store.state, 'all', 'cl-neuf').some(c => c.key === 'cl-neuf' && c.name === 'SCEA Neuve'));
  assert.ok(!listClients(store.state, 'all').some(c => c.key === 'cl-neuf'));
  // Capital renseigné dans son champ : plus d'avertissement « Capital social non indiqué ».
  await saveSettings(store, {...SETTINGS, legalForm: 'EARL', capital: '7 500 €'});
  assert.ok(!complianceReport(store.state, doc(store, d.id)).warnings.some(m => /Capital social/.test(m)));
  await saveSettings(store, {...SETTINGS, legalForm: 'EARL', capital: ''});
  assert.ok(complianceReport(store.state, doc(store, d.id)).warnings.some(m => /Capital social/.test(m)));
  // Branchements de l'interface (pas de DOM sous node:test) : écritures protégées, client à choisir, focus gardé.
  const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  const actions = read('billing-docs-actions.js'), editor = read('billing-docs-editor.js'), ui = read('billing-docs-ui.js');
  for (const k of ['pay-save', 'deposit-go', 'dup-go', 'over-save', 'accept-save', 'refuse-save', 'remind-log', 'credit-go', 'emit-confirm', 'client-save']) assert.match(actions, new RegExp(`'${k}': exclusive\\(`), k);
  assert.match(editor, /if \(ed\.id && !ed\.clientName\) \{ setState\('Choisissez le nouveau client/);
  assert.match(editor, /'client-keep'/); assert.match(editor, /restore\(back\)/); assert.match(editor, /prefillClientQuery\(\)/);
  assert.match(editor, /render\(\{focus\}\)/); assert.match(ui, /data-bdoc="more"/); assert.match(ui, /focus: '\.bd-filters summary'/);
});

test('rôles : lecteur et opérateur terrain n’ouvrent ni la liste ni la fiche d’un document ; la fiche client masque ses boutons', async () => {
  const {createBillingDocsUI} = await import('./billing-docs-ui.js');
  const store = await makeStore(), a = await issued(store), had = Object.hasOwn(globalThis, 'document'), was = globalThis.document;
  try {
    for (const role of ['viewer', 'operator']) {
      globalThis.document = {documentElement: {dataset: {role}}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {}, activeElement: null};
      const toasts = [], modals = [];
      const api = createBillingDocsUI({store, modal: (...x) => { modals.push(x); return null; }, toast: (...x) => toasts.push(x), closeModal() {}, lazy: {}});
      api.openList('all'); api.openDocument(a.id);
      assert.equal(modals.length, 0, role);
      assert.deepEqual(toasts.map(t => t[0]), Array(2).fill('La facturation est réservée à la gestion et à la comptabilité.'), role);
    }
  } finally { if (had) globalThis.document = was; else delete globalThis.document; }
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8'), at = app.indexOf('function openClientDetail('), detail = app.slice(at, app.indexOf('\n', at));
  assert.match(detail, /const billing=canSeeBilling\(cloudRole\(\)\)/);
  assert.match(detail, /\$\{billing\?`<button class="button secondary" data-bdoc="list"[^`]*Facturer<\/button>`:''\}/);
  assert.match(detail, /if\(billing&&!lazy\.soon\('billingHub'/);
});
