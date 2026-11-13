// Idée 13 : « facturation qui passe à l’action » : relances selon l’échéance et les habitudes du client,
// travaux réalisés non facturés, cartes du fil « À décider » et branchements (actions, permissions, module différé).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from './state.js';
import {addPayment, createDraft, emitDocument, saveSettings} from './invoices.js';
import {BILLING_ACTIONS, UNBILLED_DAYS, billingDecisions, habitTolerance, reminderProposals, unbilledProposals} from './billing-actions.js';
import {DECISION_ACTIONS, decisionFeed, fromBilling} from './decision-feed.js';
import {LAZY_ACTIONS} from './lazy-modules.js';
import {actionVisibleForRole} from './permissions.js';

class MemoryStorage{
  constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}
  async backupPut(){}async pruneBackups(){}async blobDelete(){}
}
const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const SETTINGS = {legalName: 'EARL Exemple', legalForm: 'EARL', address: '1 route Fictive\n00000 Village', siret: '73282932000074', vatNumber: 'FR12732829320',
  iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP', paymentDays: 30, vatRate: 20, prefix: 'F'};
const CLIENTS = [
  {id: 'c1', name: 'GAEC Fictif', address: 'Lieu-dit Fictif\n00000 Village', email: 'gaec@exemple.fr', kind: 'pro'},
  {id: 'c2', name: 'Mme Exemple', address: '1 rue Fictive\n00000 Village', email: 'exemple@exemple.fr', kind: 'particulier'}
];
const L = (label, quantity, unitPrice) => ({label, quantity, unit: 'h', unitPrice, vatRate: 20});
const emit = async (store, clientId, today, lines) => {
  const d = await createDraft(store, {clientId, docType: 'facture', lines, today}); return emitDocument(store, d.id, {today});
};
async function makeStore(extra = {}) {
  const store = new Store(new MemoryStorage()); await store.init(); await store.setPreferences({autoBackup: false});
  await store.upsertMany('clients', CLIENTS);
  for (const [type, list] of Object.entries(extra)) await store.upsertMany(type, list);
  await saveSettings(store, SETTINGS);
  return store;
}
const TODAY = '2026-06-20';

test('habitTolerance : seulement un retard moyen fiable et positif', () => {
  assert.equal(habitTolerance(null), 0);
  assert.equal(habitTolerance({reliable: false, averageLateDays: 20}), 0);
  assert.equal(habitTolerance({reliable: true, averageLateDays: -3}), 0);
  assert.equal(habitTolerance({reliable: true, averageLateDays: 20}), 20);
});

test('relances : échéance dépassée, mais un client habituellement en retard attend ses habitudes', async () => {
  const store = await makeStore();
  // c1 paie d’habitude 40 jours après l’échéance (2 factures payées) ; c2 n’a pas d’historique.
  const a = await emit(store, 'c1', '2026-01-05', [L('Labour', 10, 50)]); await addPayment(store, a.id, {date: '2026-03-16', amount: 600});
  const b = await emit(store, 'c1', '2026-02-02', [L('Semis', 10, 50)]); await addPayment(store, b.id, {date: '2026-04-13', amount: 600});
  await emit(store, 'c1', '2026-04-15', [L('Fauche', 5, 60)]); // échéance 15/05 : 36 j de retard le 20/06
  await emit(store, 'c2', '2026-04-15', [L('Broyage', 4, 50)]);
  const s = store.state;
  const props = reminderProposals(s, {today: TODAY});
  assert.deepEqual(props.map(p => p.clientId), ['c2'], 'c1 encore dans ses habitudes (40 j) : pas de carte');
  assert.match(props[0].why.join(' '), /Historique de paiement insuffisant/);
  assert.match(props[0].why.join(' '), /rien n’est envoyé sans votre confirmation/);
  const all = reminderProposals(s, {today: TODAY, includeWithinHabits: true}), c1 = all.find(p => p.clientId === 'c1');
  assert.equal(c1.tolerance, 40); assert.ok(c1.beyond <= 0); assert.ok(c1.habit);
  const later = reminderProposals(s, {today: '2026-07-10'}).find(p => p.clientId === 'c1');
  assert.ok(later, 'au-delà de ses 40 jours habituels : relance proposée');
  assert.match(later.why.join(' '), /au-delà de ses habitudes/);
});

test('travaux réalisés non facturés depuis plus de N jours : « Préparer la facture »', async () => {
  const store = await makeStore({
    parcelles: [{id: 'p1', nom: 'Champ fictif', surfaceHa: 4, clientId: 'c1'}],
    interventions: [
      {id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-04-01', status: 'Terminé', duration: 3},
      {id: 'w2', parcelId: 'p1', type: 'Fauche', date: '2026-06-15', status: 'Terminé', duration: 2},
      {id: 'w3', parcelId: 'p1', type: 'Récolte', date: '2026-03-01', status: 'Annulé', duration: 2},
      {id: 'w4', parcelId: 'p1', type: 'Labour', date: '2026-04-02', status: 'Planifié', duration: 2}
    ]});
  const s = store.state;
  const rows = unbilledProposals(s, {today: TODAY});
  assert.equal(rows.length, 1); assert.equal(rows[0].clientId, 'c1');
  assert.equal(rows[0].oldest, '2026-04-01'); assert.equal(rows[0].ageDays, 80);
  assert.ok(rows[0].count >= 2, 'le brouillon reprend aussi les travaux récents');
  assert.match(rows[0].why.join(' '), /Seuil : travaux non facturés depuis plus de 30 jours/);
  assert.equal(unbilledProposals(s, {today: TODAY, days: 90}).length, 0, 'sous le seuil : rien');
  assert.equal(UNBILLED_DAYS, 30);
});

test('fil « À décider » : cartes de facturation avec actions autorisées', async () => {
  const store = await makeStore({parcelles: [{id: 'p1', nom: 'Champ fictif', surfaceHa: 4, clientId: 'c1'}],
    interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-04-01', status: 'Terminé', duration: 3}]});
  await emit(store, 'c2', '2026-03-01', [L('Broyage', 4, 50)]);
  const rows = billingDecisions(store.state, {today: TODAY});
  const remind = rows.find(r => r.kind === 'billing-remind'), bill = rows.find(r => r.kind === 'billing-unbilled');
  assert.equal(remind.action.type, BILLING_ACTIONS.remind); assert.equal(remind.action.id, 'c2'); assert.equal(remind.action.label, 'Relancer');
  assert.equal(bill.action.type, BILLING_ACTIONS.prepare); assert.equal(bill.action.id, 'c1'); assert.equal(bill.action.label, 'Préparer la facture');
  for (const t of Object.values(BILLING_ACTIONS)) assert.ok(DECISION_ACTIONS.includes(t), `${t} autorisée dans le fil`);
  const d = fromBilling(remind);
  assert.ok(d.score > 0); assert.ok(d.stakes.eur > 0); assert.ok(d.stakes.daysLeft < 0); assert.ok(d.why.length >= 3);
  const feed = decisionFeed(store.state, {today: TODAY, notifications: [], compliance: [], treasury: null, billing: rows, feedback: null, limit: 20});
  assert.ok(feed.some(x => x.id === remind.id)); assert.ok(feed.some(x => x.id === bill.id));
  assert.equal(fromBilling(null), null);
  assert.deepEqual(billingDecisions(null), []);
});

test('branchements : module différé, permissions, accueil hors démarrage, aucun envoi automatique', () => {
  assert.deepEqual(LAZY_ACTIONS['billing-remind'], ['billingHub']); assert.deepEqual(LAZY_ACTIONS['billing-prepare-invoice'], ['billingHub']);
  assert.equal(actionVisibleForRole('operator', 'billing-remind'), false); assert.equal(actionVisibleForRole('owner', 'billing-prepare-invoice'), true);
  const fa = read('farm-actions.js'); assert.match(fa, /'billing-remind'\(\{id\}\)/); assert.match(fa, /'billing-prepare-invoice'\(\{id\}\)/);
  const hub = read('billing-hub-ui.js'); assert.match(hub, /remind: key =>/);
  const home = read('home-story-ui.js');
  assert.match(home, /import\('\.\/billing-actions\.js'\)/); assert.doesNotMatch(home, /^import .*billing-actions/m, 'pas chargé au démarrage');
  const src = read('billing-actions.js');
  assert.doesNotMatch(src, /store\.|upsert|openComposer|document\./, 'module pur : ni écriture ni DOM');
  for (const line of src.split('\n')) assert.ok(line.length <= 160, `ligne trop longue : ${line.slice(0, 60)}`);
});

test('note du centre Facturation : rien d’affirmé sans retard moyen connu', async () => {
  const {habitNoteText} = await import('./billing-actions.js');
  assert.equal(habitNoteText(null), '');
  assert.equal(habitNoteText({habit: null, beyond: 5}), '');
  assert.equal(habitNoteText({habit: {reliable: true, averageLateDays: null}, beyond: 12}), '', 'échéances absentes : pas de « à l’heure »');
  assert.equal(habitNoteText({habit: {reliable: true, averageLateDays: 20}, beyond: -4}), 'Paie d’habitude 20 j après l’échéance : encore dans ses habitudes.');
  assert.equal(habitNoteText({habit: {reliable: true, averageLateDays: -2}, beyond: 9}), 'Paie d’habitude dans les délais : retard inhabituel.');
});

test('accueil : les cartes de facturation se chargent aussi avec des factures sans fiche client', () => {
  const src = read('home-story-ui.js');
  assert.match(src, /live\(data\?\.clients\) \|\| live\(\(data\?\.integrationImports \|\| \[\]\)\.filter\(r => r\?\.farmKind === 'invoice'\)\)/);
});

test('seuil réglable « Proposer de facturer après » (preferences.unbilledDays)', async () => {
  const {UNBILLED_CHOICES, hubTodo, unbilledDaysPref} = await import('./billing-hub.js');
  assert.deepEqual(UNBILLED_CHOICES, [15, 30, 45, 60]);
  assert.equal(unbilledDaysPref({}), 30); assert.equal(unbilledDaysPref({unbilledDays: 90}), 30, 'hors choix : 30');
  assert.equal(unbilledDaysPref({unbilledDays: 45}), 45);
  const store = await makeStore({parcelles: [{id: 'p1', nom: 'Champ fictif', surfaceHa: 4, clientId: 'c1'}],
    interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-04-01', status: 'Terminé', duration: 3}]});
  const bill = () => billingDecisions(store.state, {today: TODAY}).find(r => r.kind === 'billing-unbilled');
  assert.equal(bill().level, 'warning', '80 jours > 2 × 30');
  assert.equal(hubTodo(store.state, {today: TODAY}).unbilled.length, 1);
  await store.setPreferences({unbilledDays: 60});
  assert.equal(bill().level, 'info', '80 jours < 2 × 60');
  assert.match(bill().why.join(' '), /depuis plus de 60 jours/);
  // Travail récent seulement : sous le seuil réglé, rien à proposer.
  const recent = await makeStore({parcelles: [{id: 'p1', nom: 'Champ fictif', surfaceHa: 4, clientId: 'c1'}],
    interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-05-01', status: 'Terminé', duration: 3}]});
  assert.ok(billingDecisions(recent.state, {today: TODAY}).some(r => r.kind === 'billing-unbilled'), '50 jours > 30');
  await recent.setPreferences({unbilledDays: 60});
  assert.ok(!billingDecisions(recent.state, {today: TODAY}).some(r => r.kind === 'billing-unbilled'), '50 jours < 60');
  assert.equal(hubTodo(recent.state, {today: TODAY}).unbilled.length, 0, 'le centre suit le même seuil');
  const ui = read('billing-hub-settings-ui.js');
  assert.match(ui, /Proposer de facturer après/); assert.match(ui, /setPreferences\(\{unbilledDays: before\}\); el\.value = String\(before\)/);
});
