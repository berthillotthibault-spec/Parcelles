// Centre « Facturation » (vague 13, chantier B) : vues pures (tableau de bord, À faire, clients, catalogue,
// récurrences, réglages, aperçus), import du catalogue, carte d'accueil et branchements (module différé,
// relais de l'action historique « open-invoices », CORE, feuille de style).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from './state.js';
import {canMutate} from './permissions.js';
import {addPayment, createDraft, emitDocument, invoiceSettings, saveSettings} from './invoices.js';
import {catalogItems, generateFromSchedule, importCatalogItems, saveCatalogItem, saveSchedule, schedules, undoCatalogImport} from './billing.js';
import {groupedReminderMessage, quoteFollowUpMessage} from './billing-messages.js';
import {invoiceHtmlWithQr} from './billing-export.js';
import {billingHomeModel} from './campaign-card.js';
import {CATALOG_CSV_MODEL, CATALOG_IMPORT_MAX, bicCheck, catalogCategories, catalogImportPreview, clientBilling, clientsOverview, dupKey, forecastChartSvg, hubDashboard, hubTab, hubTodo, ibanCheck, messagePreview, monthSeries, numberingPreview, numberingReport, parseCsv, periodMonths, reminderGroups, revenueChartSvg, sampleDocument, scheduleFromDocument, scheduleRows, scopeState, searchCatalog, sectionValues, settingsChecklist, siretCheck} from './billing-hub.js';
import {LAZY_ACTIONS, LAZY_MODULES} from './lazy-modules.js';

class MemoryStorage{constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}async backupPut(){}async pruneBackups(){}async blobDelete(){}}
const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const TODAY = '2026-05-12';
const SETTINGS = {legalName: 'EARL du Sougey', legalForm: 'EARL', address: '1 route du Sougey\n01340 Montrevel', siret: '73282932000074', vatNumber: 'FR12732829320', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP', paymentDays: 30, vatRate: 20, prefix: 'F'};
const CLIENTS = [
  {id: 'c1', name: 'GAEC du Bois', address: 'Le Bois\n01000 Bourg-en-Bresse', contact: 'Paul Martin', email: 'gaec@exemple.fr', phone: '06 12 34 56 78', kind: 'pro', siren: '732829320'},
  {id: 'c2', name: 'Mme Durand', address: '3 rue Haute\n01340 Foissiat', email: 'durand@exemple.fr', kind: 'particulier'},
  {id: 'c3', name: 'SCEA des Prés', address: 'Les Prés\n01340 Malafretaz', email: 'scea@exemple.fr', kind: 'pro', siren: '552100554'}
];
const L = (label, quantity, unitPrice, unit = 'h') => ({label, quantity, unit, unitPrice, vatRate: 20});
async function makeStore({settings = true} = {}) {
  const store = new Store(new MemoryStorage()); await store.init(); await store.setPreferences({autoBackup: false});
  await store.upsertMany('clients', CLIENTS);
  if (settings) await saveSettings(store, SETTINGS);
  return store;
}
const emit = async (store, clientId, today, lines, docType = 'facture') => { const d = await createDraft(store, {clientId, docType, lines, today}); return emitDocument(store, d.id, {today}); };
// Même jeu que tests-visual/facturation.spec.mjs : 5 factures (payée, 3 en retard, une partielle), un devis envoyé.
async function seeded() {
  const store = await makeStore();
  const f1 = await emit(store, 'c1', '2026-01-15', [L('Labour', 10, 65)]);
  await addPayment(store, f1.id, {date: '2026-02-10', amount: 780, method: 'virement'});
  await emit(store, 'c1', '2026-03-02', [L('Pressage', 8, 50)]);
  await emit(store, 'c1', '2026-03-20', [L('Broyage', 5, 60)]);
  await emit(store, 'c2', '2026-04-01', [L('Fauche', 4, 50)]);
  const f5 = await emit(store, 'c3', '2026-05-05', [L('Transport', 10, 100)]);
  await addPayment(store, f5.id, {date: '2026-05-08', amount: 200, method: 'cheque'});
  const q = await createDraft(store, {clientId: 'c3', docType: 'devis', lines: [L('Terrassement', 20, 70)], today: '2026-04-20', extra: {validUntil: '2026-05-15'}});
  await emitDocument(store, q.id, {today: '2026-04-20'});
  return store;
}

test('tableau de bord : chiffres, filtres période et client, liens vers les listes', async () => {
  const store = await seeded(), d = hubDashboard(store.state, {today: TODAY});
  const kpi = k => d.kpis.find(x => x.key === k);
  assert.equal(d.series.length, 12, '12 mois, remplis de zéros');
  assert.equal(d.series[0].month, '2025-06');
  assert.deepEqual([d.totals.invoicedHt, d.totals.collected, d.totals.count], [2550, 980, 5]);
  assert.equal(d.series.find(r => r.month === '2026-03').invoicedHt, 700);
  assert.equal(d.raw.receivable.due, 2080);
  assert.equal(d.raw.receivable.late, 1080);
  assert.match(kpi('late').value, /^1 080 €$/);
  assert.deepEqual(kpi('late').link, ['facture', {status: 'retard'}]);
  assert.deepEqual(kpi('invoiced').link, ['facture', {from: '2025-06-01', to: TODAY}]);
  assert.equal(d.aged.find(a => a.key === 'aEchoir').amount, 1000);
  assert.equal(d.aged.find(a => a.key === 'j0_30').amount, 600, 'F3 (23 j) et F4 (11 j)');
  assert.equal(d.aged.find(a => a.key === 'j31_60').amount, 480);
  assert.equal(d.top[0].name, 'GAEC du Bois');
  assert.equal(d.forecast.late, 1080, 'retards regroupés sur la semaine en cours (trésorerie n° 86)');
  const c1 = hubDashboard(store.state, {today: TODAY, clientId: 'c1'});
  assert.deepEqual([c1.totals.invoicedHt, c1.raw.receivable.late], [1350, 840]);
  assert.deepEqual(c1.kpis.find(x => x.key === 'late').link, ['facture', {clientId: 'c1', status: 'retard'}]);
  assert.equal(hubDashboard(store.state, {today: TODAY, period: 'mois'}).totals.invoicedHt, 1000);
  assert.deepEqual([periodMonths('annee', TODAY), periodMonths('trimestre', TODAY), periodMonths('mois', TODAY)], [5, 2, 1]);
  assert.equal(scopeState(store.state, 'c2').integrationImports.filter(r => r.farmKind === 'invoice').length, 1);
  assert.deepEqual(monthSeries('2026-03-01', TODAY, [{month: '2026-04', invoicedHt: 5}]).map(r => r.invoicedHt), [0, 5, 0]);
});

test('graphiques SVG : rôle image et équivalent textuel, couleurs par classes', async () => {
  const store = await seeded(), d = hubDashboard(store.state, {today: TODAY});
  const svg = revenueChartSvg(d.series);
  assert.match(svg, /^<svg class="chart bh-chart"[^>]*role="img"/);
  assert.match(svg, /aria-label="Chiffre d’affaires par mois, juin 2025 à mai 2026 : facturé 2 550,00 € HT, encaissé 980,00 €\. Meilleur mois : mai 2026/);
  assert.equal((svg.match(/class="bh-bar is-invoiced"/g) || []).length, 12);
  assert.doesNotMatch(svg, /fill="#|style=/, 'pas de couleur en dur : jetons CSS (clair et sombre)');
  const f = forecastChartSvg(d.forecast.weeks);
  assert.match(f, /dont 1 080,00 € déjà en retard/);
  assert.match(f, /class="bh-bar is-late"/);
  assert.match(revenueChartSvg([]), /aucune donnée/);
});

test('À faire : relances groupées par client au niveau le plus avancé, devis à suivre, doublons ignorés', async () => {
  const store = await seeded(), groups = reminderGroups(store.state, TODAY);
  assert.deepEqual(groups.map(g => [g.name, g.items.length, g.level, g.total]), [['GAEC du Bois', 2, 2, 840], ['Mme Durand', 1, 1, 240]]);
  const todo = hubTodo(store.state, {today: TODAY});
  assert.equal(todo.quotes.length, 1);
  assert.equal(todo.quotes[0].expiring, true, 'devis valable jusqu’au 15 mai');
  assert.equal(todo.lateTotal, 1080);
  assert.ok(todo.risky.some(r => r.name === 'GAEC du Bois'));
  // Deux brouillons identiques = doublon probable ; « Ce n’est pas un doublon » le retire.
  await createDraft(store, {clientId: 'c2', lines: [L('Pension', 1, 100)], today: TODAY});
  await createDraft(store, {clientId: 'c2', lines: [L('Pension', 1, 100)], today: TODAY});
  const dup = hubTodo(store.state, {today: TODAY});
  assert.equal(dup.duplicates.length, 1);
  assert.equal(hubTodo(store.state, {today: TODAY, dismissed: [dupKey(dup.duplicates[0])]}).duplicates.length, 0);
  assert.equal(hubTab('inconnu'), 'suivi');
});

test('relance groupée : un seul message pour plusieurs factures, une facture seule garde son modèle', async () => {
  const store = await seeded(), [gaec, durand] = reminderGroups(store.state, TODAY);
  const m = groupedReminderMessage(store.state, gaec.items.map(i => i.invoice), {level: gaec.level, today: TODAY});
  assert.match(m.subject, /^Deuxième relance : 2 factures en attente de règlement$/);
  assert.match(m.body, /F2026-0002 du 02\/03\/2026, échéance du 01\/04\/2026 \(41 jours de retard\) : 480,00/);
  assert.match(m.body, /Total restant dû : 840,00/);
  assert.match(m.body, /FR76 3000 6000 0112 3456 7890 189/);
  assert.deepEqual(m.ids.length, 2);
  assert.equal(m.context.finance, true);
  assert.equal(m.recipients[0].email, 'gaec@exemple.fr');
  const one = groupedReminderMessage(store.state, durand.items.map(i => i.invoice), {level: 1, today: TODAY});
  assert.match(one.subject, /^Rappel : facture F2026-0004/);
  assert.throws(() => groupedReminderMessage(store.state, [], {}), /Aucune facture/);
  const quote = store.state.integrationImports.find(r => r.docType === 'devis');
  assert.match(quoteFollowUpMessage(store.state, quote, {today: TODAY}).body, /valable jusqu’au 15\/05\/2026/);
});

test('fiche Facturation d’un client et vue d’ensemble des clients', async () => {
  const store = await seeded(), b = clientBilling(store.state, 'c1', {today: TODAY});
  assert.deepEqual([b.due, b.late, b.lateCount, b.invoiced12, b.averageDays], [840, 840, 2, 1350, 26]);
  assert.equal(b.rows.length, 3);
  assert.equal(b.risk.level, 'eleve');
  const all = clientsOverview(store.state, {today: TODAY});
  assert.deepEqual(all.map(c => c.name), ['GAEC du Bois', 'Mme Durand', 'SCEA des Prés'], 'retards d’abord');
  assert.deepEqual(clientsOverview(store.state, {today: TODAY, query: 'pres'}).map(c => c.id), ['c3']);
});

test('catalogue : recherche, catégories, CSV (séparateur, guillemets, BOM), aperçu puis import annulable', async () => {
  const store = await makeStore();
  await saveCatalogItem(store, {code: 'PELLE', label: 'Pelle mécanique', unit: 'h', unitPrice: 65, vatRate: 20, category: 'Terrassement', clientPrices: [{clientId: 'c1', unitPrice: 60}]});
  assert.deepEqual(parseCsv('﻿a;b\r\n"x;y";"dit ""oui"""\n\n'), [['a', 'b'], ['x;y', 'dit "oui"']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2')[1], ['1', '2']);
  const rows = parseCsv('Code;Désignation;Unité;Prix HT;TVA;Catégorie\nPELLE;Pelle mécanique 8 t;heure;68;20;Terrassement\nTRANS;Transport;tonnes;18,5 €;10 %;Transport\nX;;h;1;20;\nTRANS;Doublon;h;1;20;');
  const p = catalogImportPreview(store.state, rows);
  assert.deepEqual([p.created, p.updated, p.errors.length], [1, 1, 2]);
  assert.deepEqual(p.items.map(x => [x.values.code, x.values.unit, x.values.unitPrice, x.values.vatRate]), [['PELLE', 'h', 68, 20], ['TRANS', 't', 18.5, 10]]);
  assert.match(p.errors.find(e => e.line === 5).error, /double/);
  assert.match(catalogImportPreview(store.state, [['Code', 'Prix']]).error, /Désignation/);
  assert.equal(catalogImportPreview(store.state, parseCsv(CATALOG_CSV_MODEL)).items.length, 1, 'le modèle fourni s’importe tel quel');
  const result = await importCatalogItems(store, p.items);
  assert.deepEqual([result.count, result.created.length, result.previous.length], [2, 1, 1]);
  const pelle = catalogItems(store.state).find(i => i.code === 'PELLE');
  assert.deepEqual([pelle.label, pelle.unitPrice, pelle.clientPrices.length], ['Pelle mécanique 8 t', 68, 1], 'prix client conservés');
  assert.deepEqual(catalogCategories(store.state), ['Terrassement', 'Transport']);
  assert.deepEqual(searchCatalog(store.state, {query: 'transp'}).map(i => i.code), ['TRANS']);
  assert.deepEqual(searchCatalog(store.state, {category: 'Terrassement'}).map(i => i.code), ['PELLE']);
  await undoCatalogImport(store, result);
  assert.deepEqual(catalogItems(store.state).map(i => [i.code, i.unitPrice]), [['PELLE', 65]]);
  await assert.rejects(importCatalogItems(store, [{values: {label: ''}, line: 4}]), /Ligne 4 : Champ obligatoire/);
  await assert.rejects(importCatalogItems(store, [{values: {code: 'A', label: 'a'}}, {values: {code: 'A', label: 'b'}}]), /double/);
  store.setWriteGuard(({farmKind}) => farmKind !== 'billingItem');
  await assert.rejects(importCatalogItems(store, p.items), /rôle/);
});

test('récurrences : modèle depuis un document, historique des générations, brouillon sans émission', async () => {
  const store = await seeded();
  const f = store.state.integrationImports.find(r => r.number === 'F2026-0004');
  const preset = scheduleFromDocument(f, {today: TODAY});
  assert.deepEqual([preset.clientId, preset.frequency, preset.mode, preset.nextDate, preset.lines.length], ['c2', 'mensuel', 'brouillon', '2026-06-01', 1]);
  const s = await saveSchedule(store, {...preset, label: 'Pension', nextDate: '2026-05-01'});
  let rows = scheduleRows(store.state, {today: TODAY});
  assert.deepEqual([rows[0].due, rows[0].history.length, rows[0].frequency, rows[0].amountHt], [1, 0, 'Mensuelle', 200]);
  const draft = await generateFromSchedule(store, s.id, {today: TODAY});
  assert.equal(draft.status, 'brouillon');
  rows = scheduleRows(store.state, {today: TODAY});
  assert.deepEqual([rows[0].due, rows[0].schedule.nextDate, rows[0].history.map(h => h.status)], [0, '2026-06-01', ['brouillon']]);
  assert.equal(schedules(store.state)[0].lastGenerated.invoiceId, draft.id);
});

test('réglages : valeurs par section, enregistrement partiel, aperçus de numérotation et contrôles', async () => {
  const store = await seeded(), s = invoiceSettings(store.state);
  assert.deepEqual(sectionValues('tva', {vatRegime: 'normal', vatTiming: 'debits', operationNature: 'mixte', vatRate: '10', customVatRates: '13 ; 2,1 ; 300'}, s), {vatRegime: 'normal', vatOnDebits: true, operationNature: 'mixte', vatRate: 10, customVatRates: [13, 2.1]});
  const num = sectionValues('numerotation', {facturePrefix: 'FA', factureFormat: '{PREFIXE}{AA}-{NUM:5}', factureReset: 'annuel', factureStartAt: '1', devisFormat: '{PREFIXE}-{NUM:3}', devisReset: 'jamais'}, s);
  assert.equal(num.prefix, 'FA');
  assert.deepEqual(num.numbering.devis, {prefix: 'D', format: '{PREFIXE}-{NUM:3}', reset: 'jamais', startAt: 1});
  assert.deepEqual(numberingPreview(store.state, {}, 'facture', TODAY), {number: 'F2026-0006', sequence: 6});
  assert.equal(numberingPreview(store.state, num, 'facture', TODAY).number, 'FA26-00001');
  assert.match(numberingPreview(store.state, {numbering: {...s.numbering, devis: {...s.numbering.devis, format: '{PREFIXE}-{NUM:3}', reset: 'annuel'}}}, 'devis', TODAY).error, /annuelle/);
  assert.match(numberingPreview(store.state, {numbering: {...s.numbering, devis: {...s.numbering.devis, format: 'D{X}'}}}, 'devis', TODAY).error, /jeton/);
  assert.equal(numberingReport(store.state).ok, true);
  const model = sectionValues('modele', {accent: '#7d2f3a', font: 'serif', col_date: true, col_unit: 'on', col_vat: false, footer: ' Merci ', showQr: true}, s);
  assert.deepEqual(model.template.columns, {date: true, unit: true, vat: false, discount: false});
  assert.deepEqual([model.accent, model.template.font, model.template.footer, model.template.showQr], ['#7d2f3a', 'serif', 'Merci', true]);
  const rel = sectionValues('relances', {r1Days: '5', r1Fee: '0', r1Subject: 'Rappel {numero}', r2Days: '15', r2Fee: '', r3Days: '40', r3Fee: '40,5'}, s);
  assert.deepEqual(rel.reminders.map(r => [r.days, r.fee, r.subject || '']), [[5, 0, 'Rappel {numero}'], [15, 0, ''], [40, 40.5, '']]);
  assert.deepEqual(sectionValues('messages', {envoiSubject: 'Votre facture {numero}', envoiBody: ''}, s).messages.envoi, {subject: 'Votre facture {numero}', body: ''});
  // Enregistrement section par section, identité incomplète tolérée (émission bloquée ailleurs).
  const blank = await makeStore({settings: false});
  await saveSettings(blank, sectionValues('modele', {accent: '#2c5a85', font: 'mono', col_date: true, col_unit: true, col_vat: true, col_discount: true}, invoiceSettings(blank.state)), {partial: true});
  assert.equal(invoiceSettings(blank.state).template.font, 'mono');
  await assert.rejects(saveSettings(blank, {siret: '123'}, {partial: true}), /SIRET/);
  await assert.rejects(saveSettings(blank, {iban: 'FR7630006000011234567890180'}, {partial: true}), /clé de contrôle/);
  assert.equal(settingsChecklist(blank.state).find(c => c.key === 'identite').ok, false);
  assert.ok(settingsChecklist(store.state).every(c => c.ok));
  assert.equal(ibanCheck('FR76 3000 6000 0112 3456 7890 189').state, 'ok');
  assert.equal(ibanCheck('FR76 3000 6000 0112 3456 7890 180').state, 'bad');
  assert.equal(ibanCheck('').state, 'empty');
  assert.equal(bicCheck('AGRIFRPP').state, 'ok');
  assert.equal(bicCheck('AGRI').state, 'bad');
  assert.equal(siretCheck('73282932000074').state, 'ok');
  assert.equal(siretCheck('73282932000075').state, 'warn');
  assert.equal(siretCheck('123').state, 'bad');
});

test('aperçus : modèle visuel en direct (accent, colonnes, pied de page, QR) et messages', async () => {
  const store = await seeded();
  const draft = sectionValues('modele', {accent: '#7d2f3a', font: 'serif', col_date: true, col_unit: true, col_vat: false, col_discount: true, footer: 'Merci de votre confiance', terms: 'CGV : paiement à 30 jours.', showQr: true}, invoiceSettings(store.state));
  const {doc, state} = sampleDocument(store.state, {today: TODAY, draft});
  assert.equal(doc.number, 'F2026-0006', 'numéro d’exemple = prochain numéro réel');
  const page = invoiceHtmlWithQr(state, doc);
  assert.match(page, /--acc:#7d2f3a/);
  assert.match(page, /Merci de votre confiance/);
  assert.match(page, /CGV : paiement à 30 jours\./);
  assert.match(page, /class="inv-qr"><svg/);
  assert.doesNotMatch(page, /<th class="n">TVA<\/th>/, 'colonne TVA masquée');
  assert.match(page, /Instrument Serif/);
  assert.equal(store.state.integrationImports.some(r => r.id === 'apercu'), false, 'jamais enregistré');
  const quote = sampleDocument(store.state, {today: TODAY, docType: 'devis'}).doc;
  assert.equal(quote.number, 'D2026-0002');
  const m = messagePreview(store.state, 'relance1', {reminders: [{level: 1, days: 7, fee: 0, subject: 'Petit rappel : {numero}'}, {level: 2, days: 20}, {level: 3, days: 45}]}, {today: TODAY});
  assert.equal(m.subject, 'Petit rappel : F2026-0006');
  assert.match(messagePreview(store.state, 'devis', {}, {today: TODAY}).body, /valable jusqu’au/);
  assert.match(messagePreview(store.state, 'suiviDevis', {messages: {suiviDevis: {subject: 'Suite {numero}', body: 'x'}}}, {today: TODAY}).subject, /^Suite D2026-0002$/);
});

test('carte d’accueil : retards seulement, masquée au lecteur, à l’opérateur et sur demande', async () => {
  const store = await seeded(), m = billingHomeModel(store.state, {today: TODAY});
  assert.deepEqual([m.hidden, m.count, m.amount, m.text, m.detail], [false, 3, 1080, '3 factures en retard', '2 clients']);
  assert.equal(billingHomeModel(store.state, {today: TODAY, role: 'viewer'}).hidden, true);
  assert.equal(billingHomeModel(store.state, {today: TODAY, role: 'operator'}).hidden, true);
  assert.equal(billingHomeModel(store.state, {today: TODAY, role: 'accountant'}).hidden, false);
  assert.equal(billingHomeModel(store.state, {today: TODAY, enabled: false}).reason, 'off');
  assert.equal(billingHomeModel((await makeStore()).state, {today: TODAY}).reason, 'empty');
});

test('branchements : module différé, relais historique, CORE, REQUIRED_ASSETS, feuille dédiée', () => {
  assert.match(String(LAZY_MODULES.billingHub), /import\('\.\/billing-hub-ui\.js'\)/);
  assert.deepEqual(LAZY_ACTIONS['open-invoices'], ['billingHub']);
  assert.deepEqual(LAZY_ACTIONS['new-invoice'], ['billingHub']);
  const app = read('app.js');
  assert.match(app, /action==='open-invoices'\)billingHubUI\?\.open\(/);
  assert.match(app, /lazy\.onLoad\('billingHub',m=>billingHubUI=m\.createBillingHubUI\(/);
  assert.match(app, /'Facturation','Devis, factures, relances, catalogue et suivi','open-invoices'/);
  assert.match(app, /id="client-billing"/);
  assert.doesNotMatch(app, /from '\.\/billing-hub/, 'jamais dans le graphe statique');
  const ui = read('invoices-ui.js');
  assert.match(ui, /legacyOpen:open/);
  assert.match(ui, /h\.newInvoice\(clientId\|\|''\)/);
  const sw = read('sw.js'), runtime = read('runtime.js');
  for (const f of ['billing-hub.js', 'billing-hub-ui.js', 'billing-hub-catalog-ui.js', 'billing-hub-settings-ui.js', 'billing-hub.css']) {
    assert.ok(sw.includes(`'./${f}'`), `${f} dans CORE`);
    assert.ok(runtime.includes(`'./${f}'`), `${f} dans REQUIRED_ASSETS`);
  }
  // Feuille liée à l'ouverture (lazy-styles.js), plus par index.html : le premier rendu ne l'attend pas.
  assert.doesNotMatch(read('index.html'), /billing-hub\.css/);
  assert.match(read('lazy-styles.js'), /'billing-hub\.css': '\d+'/);
  assert.match(read('billing-hub.css'), /^\/\*[^]*?\*\/\n@layer features\{/);
  const hub = read('billing-hub-ui.js');
  assert.match(hub, /lazy\.load\('billingDocs'\)/, 'écran des documents chargé à la demande');
  assert.match(hub, /Écran des documents indisponible/, 'repli propre sans le chantier A');
  assert.match(read('spotlight.js'), /'Facturation', 'open-invoices'/);
});

// Correctifs de relecture (centre Facturation).
// Garde identique à app.js : nature de la fiche prise dans l'opération, sa charge ou la version enregistrée.
const guardAs = (store, role) => store.setWriteGuard(op => { const previous = op.entityId ? store.get(op.entity, op.entityId, {includeDeleted: true}) : null; return canMutate(role, {entity: op.entity, action: op.action, farmKind: op.farmKind ?? op.payload?.farmKind ?? previous?.farmKind, record: op.payload || null, previous}); });

test('correctif : la comptabilité importe le catalogue et annule l’import (garde fiche par fiche)', async () => {
  const store = await makeStore();
  await saveCatalogItem(store, {code: 'PELLE', label: 'Pelle', unit: 'h', unitPrice: 65, vatRate: 20});
  guardAs(store, 'accountant');
  const p = catalogImportPreview(store.state, parseCsv('Code;Désignation;Prix HT\nPELLE;Pelle;70\n;Nouvel article;10'));
  const result = await importCatalogItems(store, p.items);
  assert.deepEqual(catalogItems(store.state).map(i => [i.label, i.unitPrice]).sort(), [['Nouvel article', 10], ['Pelle', 70]]);
  // Pas de droit de suppression : l'article créé est archivé, l'article modifié retrouve sa version.
  assert.deepEqual(await undoCatalogImport(store, result), {removed: 0, archived: 1, restored: 1});
  assert.deepEqual(catalogItems(store.state).map(i => [i.label, i.unitPrice]), [['Pelle', 65]]);
  assert.equal(catalogItems(store.state, {includeArchived: true}).length, 2);
  // Le lot reste refusé quand une seule fiche sort du périmètre du rôle (client : annuaire, pas de la comptabilité).
  await assert.rejects(store.upsertMany('integrationImports', [{id: 'x1', farmKind: 'billingItem', label: 'A', name: 'A'}, {id: 'x2', farmKind: 'client', name: 'B'}]), /rôle/);
  guardAs(store, 'operator');
  await assert.rejects(store.upsertMany('integrationImports', [{id: 'x3', farmKind: 'invoice', name: 'C'}]), /rôle/, 'l’opérateur ne passe plus par un lot sans nature');
});

test('correctif : une mise à jour par import ne touche que les colonnes du fichier', async () => {
  const store = await makeStore();
  await saveCatalogItem(store, {code: 'LABOUR', label: 'Labour', unit: 'ha', unitPrice: 80, vatRate: 10, category: 'Travaux des champs', account: '706100', description: 'Labour profond', clientPrices: [{clientId: 'c1', unitPrice: 75}]});
  const p = catalogImportPreview(store.state, parseCsv('Code;Désignation;Prix HT\nLABOUR;Labour;99'));
  assert.equal(p.updated, 1);
  await importCatalogItems(store, p.items);
  const l = catalogItems(store.state).find(i => i.code === 'LABOUR');
  assert.deepEqual([l.unitPrice, l.unit, l.vatRate, l.category, l.account, l.description, l.clientPrices.length], [99, 'ha', 10, 'Travaux des champs', '706100', 'Labour profond', 1]);
  // Colonne présente mais cellule vide : désignation, TVA et unité conservées ; autre colonne présente : remplacée.
  const q = catalogImportPreview(store.state, parseCsv('Code;Désignation;Unité;TVA;Catégorie\nlabour;;;;Semis'));
  assert.deepEqual(q.errors, []);
  assert.deepEqual([q.items[0].values.label, q.items[0].values.unit, q.items[0].values.vatRate, q.items[0].values.category], ['Labour', 'ha', 10, 'Semis']);
  // Nouvel article : TVA par défaut à 20 %.
  assert.equal(catalogImportPreview(store.state, parseCsv('Code;Désignation\nNEUF;Neuf')).items[0].values.vatRate, 20);
});

test('correctif : au-delà de 1 000 lignes, l’aperçu signale les lignes non prises en compte', async () => {
  const store = await makeStore();
  const csv = ['Code;Désignation;Prix HT', ...Array.from({length: 1200}, (_, i) => `A${i};Article ${i};${i}`)].join('\n');
  const p = catalogImportPreview(store.state, parseCsv(csv));
  assert.deepEqual([p.items.length, p.truncated, p.ignored, p.errors.length], [CATALOG_IMPORT_MAX, 200, 200, 0]);
  assert.equal(catalogImportPreview(store.state, parseCsv('Code;Désignation\nA;a')).truncated, 0);
});

test('correctif : prix saisi avec « € », prix illisible refusé au lieu d’être vidé', async () => {
  const store = await makeStore();
  assert.equal((await saveCatalogItem(store, {label: 'Broyage', unit: 'h', unitPrice: '55 €', vatRate: 20})).unitPrice, 55);
  assert.equal((await saveCatalogItem(store, {label: 'Fauche', unit: 'h', unitPrice: '1 200,50 € HT', vatRate: 20})).unitPrice, 1200.5);
  await assert.rejects(saveCatalogItem(store, {label: 'Pressage', unit: 'h', unitPrice: 'cinquante', vatRate: 20}), /Prix unitaire HT illisible/);
  assert.equal((await saveCatalogItem(store, {label: 'Sans prix', unit: 'h', unitPrice: '', vatRate: 20})).unitPrice, null);
});

test('correctif : « Annuler » d’une récurrence ne recule l’échéance que si le brouillon a été supprimé', async () => {
  const {createHubCatalogUI} = await import('./billing-hub-catalog-ui.js');
  const {html, raw} = await import('./safe-html.js');
  const setup = async role => {
    const store = await seeded();
    const f = store.state.integrationImports.find(r => r.number === 'F2026-0004');
    const s = await saveSchedule(store, {...scheduleFromDocument(f, {today: TODAY}), label: 'Pension', nextDate: '2026-05-01'});
    if (role) guardAs(store, role);
    const toasts = [];
    const ui = createHubCatalogUI({store, data: () => store.state, today: () => TODAY, toast: (message, type, action) => toasts.push({message, type, action}), bindChipChoices: () => {}, canWrite: () => true, doc: {getElementById: () => null}, html, raw, refresh: () => {}, setView: () => {}});
    return {store, s, ui, toasts};
  };
  // Comptabilité : pas de droit de suppression, donc pas de bouton Annuler sur le toast.
  const a = await setup('accountant');
  await a.ui.generate(a.s.id);
  assert.equal(a.toasts.at(-1).action, null);
  assert.equal(schedules(a.store.state)[0].nextDate, '2026-06-01');
  // Gestion : brouillon émis avant « Annuler » : brouillon conservé, échéance inchangée, raison affichée.
  const o = await setup(null);
  const draft = await o.ui.generate(o.s.id);
  await emitDocument(o.store, draft.id, {today: TODAY});
  await o.toasts.at(-1).action.run();
  assert.equal(o.toasts.at(-1).type, 'error');
  assert.match(o.toasts.at(-1).message, /Brouillon conservé : Une facture émise/);
  assert.equal(schedules(o.store.state)[0].nextDate, '2026-06-01');
  // Brouillon intact : supprimé et échéance remise.
  const n = await setup(null);
  const d2 = await n.ui.generate(n.s.id);
  await n.toasts.at(-1).action.run();
  assert.ok(!n.store.get('integrationImports', d2.id));
  assert.equal(schedules(n.store.state)[0].nextDate, '2026-05-01');
});
