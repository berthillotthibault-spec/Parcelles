import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {treasuryForecast} from './treasury.js';
import {decisionFeed, decisionCountLabel, scoreDecision, urgency, fromCostDrift, stakesLabel, DECISION_ACTIONS} from './decision-feed.js';

const TODAY = '2026-11-12';
// Notifications et conformité fournies en littéral : le fil reste indépendant de l’horloge réelle.
const feed = (state, opts = {}) => decisionFeed(state, {today: TODAY, now: Date.UTC(2026, 10, 12, 9), notifications: [], compliance: [], ...opts});
function farm(extra = {}) {
  return {...emptyState(), parcelles: [{id: 'p1', nom: 'Les Brosses', surfaceHa: 30}, {id: 'p2', nom: 'Le Clos', surfaceHa: 1}],
    interventions: [{id: 'w1', type: 'Semis', parcelId: 'p1', status: 'Planifié', plannedDate: '2026-11-05'}, {id: 'w2', type: 'Semis', parcelId: 'p2', status: 'Planifié', plannedDate: '2026-11-05'}], ...extra};
}
const overdue = id => ({id: `work-overdue-${id}`, level: 'urgent', title: 'Travail en retard', message: 'Semis', entity: 'interventions', entityId: id, date: '2026-11-05'});

test('état vide : aucune décision', () => {
  assert.deepEqual(decisionFeed(emptyState(), {today: TODAY}), []);
  assert.deepEqual(decisionFeed(null), []);
});

test('échéance réglementaire à J+2 devant un stock faible', () => {
  const notifications = [
    {id: 'stock-s1', level: 'info', title: 'Stock faible', message: 'Ammonitrate · 2 t', entity: 'stockItems', entityId: 's1'},
    {id: 'deadline-certi', level: 'warning', title: 'Échéance réglementaire proche', message: 'Certiphyto · le 14/11/2026 (dans 2 j)', entity: 'regulated', entityId: 'certi', date: '2026-11-14'}
  ];
  const rows = feed(farm({interventions: []}), {notifications});
  assert.deepEqual(rows.map(r => r.id), ['deadline-certi', 'stock-s1']);
  assert.equal(rows[0].stakes.daysLeft, 2);
  assert.deepEqual(rows[0].action, {type: 'notification-open', label: 'Ouvrir', id: 'certi', payload: {entity: 'regulated'}});
  assert.equal(rows[1].action.type, 'stock-movement');
});

test('retard sur 30 ha devant un retard sur 1 ha', () => {
  const rows = feed(farm(), {notifications: [overdue('w2'), overdue('w1')]});
  assert.deepEqual(rows.map(r => r.id), ['work-overdue-w1', 'work-overdue-w2']);
  assert.equal(rows[0].stakes.ha, 30);
  assert.equal(rows[0].stakes.daysLeft, -7);
  assert.equal(stakesLabel(rows[0].stakes), '30 ha · retard 7 j');
});

test('même parcelle et même kind : why fusionnés, euros cumulés', () => {
  const drift = post => ({parcelId: 'p1', parcelName: 'Les Brosses', culture: 'Blé tendre', post, eurPerHa: 120, refEurPerHa: 100, deltaPct: 0.2, surfaceHa: 30, why: [`${post} au-dessus de la référence`]});
  const rows = feed(farm({interventions: []}), {costDrifts: [drift('fertilisation'), drift('traitement')]});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'cost-drift');
  assert.equal(rows[0].stakes.eur, 1200);
  assert.ok(rows[0].why.includes('fertilisation au-dessus de la référence'));
  assert.ok(rows[0].why.includes('traitement au-dessus de la référence'));
  assert.equal(fromCostDrift(drift('semis')).stakes.eur, 600);
});

test('même id dans les notifications et les sources injectées : une seule entrée', () => {
  const notifications = [{id: 'stock-shortfall-s1', level: 'warning', title: 'Stock insuffisant', message: 'Ammonitrate', entity: 'stockItems', entityId: 's1'}];
  const need = {id: 'stock-shortfall-s1', itemId: 's1', name: 'Ammonitrate', unit: 't', need: 5, available: 2, shortfall: 3, firstShortDate: '2026-11-14', valueEur: 1200, works: [], level: 'urgent', why: ['Besoin de 5 t pour 2 travaux.']};
  const rows = feed(farm({interventions: []}), {notifications, inputNeeds: [need]});
  assert.equal(rows.filter(r => r.id === 'stock-shortfall-s1').length, 1);
  assert.equal(rows.length, 1);
});

test('« Stock faible » et « Stock insuffisant » du même article : une seule carte, celle de la commande', () => {
  const notifications = [{id: 'stock-low-s1', level: 'warning', title: 'Stock faible', message: 'Ammonitrate : 2 t', entity: 'stockItems', entityId: 's1'}];
  const need = {id: 'stock-shortfall-s1', itemId: 's1', name: 'Ammonitrate', unit: 't', need: 5, available: 2, shortfall: 3, firstShortDate: '2026-11-14', valueEur: 1200, works: [], level: 'urgent', why: ['Besoin de 5 t pour 2 travaux.']};
  const rows = feed(farm({interventions: []}), {notifications, inputNeeds: [need]});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'stock-shortfall-s1');
  assert.equal(rows[0].action.type, 'create-task-prefill');
  assert.ok(rows[0].why.some(w => /Ammonitrate : 2 t/.test(w)));
  const other = feed(farm({interventions: []}), {notifications: [{...notifications[0], entityId: 's2'}], inputNeeds: [need]});
  assert.equal(other.length, 2);
});

test('chaque entrée a un pourquoi et une action autorisée ; limite respectée', () => {
  const notifications = [overdue('w1'), overdue('w2'), {id: 'backup-old', level: 'warning', title: 'Sauvegarde locale ancienne', message: '', entity: 'backup'}];
  const grazingAdvice = [{lotId: 'l1', sessionId: 'g1', parcelId: 'p2', parcelName: 'Le Clos', daysLeft: 1.5, confidence: 'moyenne', next: [{parcelId: 'p1', parcelName: 'Les Brosses', restDays: 40}], why: []},
    {lotId: 'l2', sessionId: 'g2', parcelId: 'p1', parcelName: 'Les Brosses', daysLeft: 9, confidence: 'haute', next: [], why: []}];
  const inputNeeds = [{itemId: 's1', name: 'Ammonitrate', unit: 't', shortfall: 3, firstShortDate: '2026-11-20', valueEur: 900, works: [{surfaceHa: 30}], level: 'warning', why: []}];
  const compliance = [{id: 'sprayer', label: 'Contrôle pulvérisateur', status: 'ko', detail: 'Contrôle dépassé.'}, {id: 'bdni', label: 'BDNI', status: 'ok', detail: ''}];
  const all = feed(farm(), {notifications, grazingAdvice, inputNeeds, compliance, limit: 20});
  assert.equal(all.length, 6);
  assert.ok(!all.some(r => r.id === 'grazing-move-g2'), 'plus de 3 jours d’herbe : pas de décision');
  for (const r of all) {
    assert.ok(r.why.length > 0 && r.why.every(Boolean), r.id);
    assert.ok(DECISION_ACTIONS.includes(r.action.type), r.id);
    assert.ok(Number.isFinite(r.score));
  }
  assert.equal(all.find(r => r.kind === 'grazing-move').action.type, 'move-grazing');
  assert.equal(feed(farm(), {notifications, grazingAdvice, inputNeeds, compliance, limit: 3}).length, 3);
  assert.equal(feed(farm(), {notifications, grazingAdvice, inputNeeds, compliance}).length, 6);
});

test('point bas de trésorerie négatif : treasury-low', () => {
  const state = {...emptyState(), preferences: {treasury: {openingBalance: -500}}};
  assert.equal(decisionFeed(state, {today: TODAY, notifications: [], compliance: []}).length, 0, 'sans module trésorerie chargé : pas de carte');
  const rows = decisionFeed(state, {today: TODAY, notifications: [], compliance: [], treasuryForecast});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'treasury-low');
  assert.equal(rows[0].level, 'urgent');
  assert.equal(rows[0].stakes.eur, 500);
  assert.equal(rows[0].action.type, 'open-treasury');
  const reserve = decisionFeed({...emptyState(), preferences: {treasury: {openingBalance: 800, reserve: 2000}}}, {today: TODAY, notifications: [], compliance: [], treasuryForecast});
  assert.equal(reserve[0]?.kind, 'treasury-low');
  assert.equal(reserve[0].level, 'warning');
  assert.equal(reserve[0].stakes.eur, 1200);
});

test('scoreDecision et urgency : valeurs exactes', () => {
  assert.deepEqual([null, -3, 0, 1, 2, 3, 7, 8, 30, 31].map(urgency), [1, 3, 3, 2.5, 2.5, 1.8, 1.8, 1.2, 1.2, 1]);
  assert.equal(scoreDecision({gravity: 3, ha: 9, eur: 1000, daysLeft: 0}), 3 * 2 * 2 * 3);
  assert.equal(scoreDecision({gravity: 1}), 1);
  assert.equal(scoreDecision({gravity: 2, ha: 99, eur: 500, daysLeft: 10}), 2 * 3 * 1.5 * 1.2);
});

test('déterminisme et libellés', () => {
  const opts = {notifications: [overdue('w1'), overdue('w2')], costDrifts: [{parcelId: 'p2', parcelName: 'Le Clos', post: 'semis', eurPerHa: 200, refEurPerHa: 100, deltaPct: 1, surfaceHa: 1, why: 'x'}]};
  assert.deepEqual(feed(farm(), opts), feed(farm(), opts));
  assert.equal(decisionCountLabel(3), 'À décider (3)');
  assert.equal(decisionCountLabel(-1), 'À décider (0)');
  assert.equal(stakesLabel({ha: 30, eur: 520, daysLeft: 2}), `30 ha · ≈ ${(520).toLocaleString('fr-FR')} € · J-2`);
});

// Revue adverse I4 : corrections.
test('conseil sur une parcelle ou un animal : action qui ouvre vraiment quelque chose', () => {
  const notifications = [
    {id: 'R4-p1', level: 'warning', title: 'Succession', message: 'Blé sur blé', entity: 'parcelles', entityId: 'p1', why: ['Blé deux ans de suite.'], action: {type: 'open-unknown', label: 'X', id: 'p1'}},
    {id: 'R6-a1', level: 'warning', title: 'Vêlage', message: 'Vêlage proche', entity: 'animals', entityId: 'a1', why: ['Terme dans 5 j.'], action: {type: 'open-herd-animal', label: 'Ouvrir la fiche', id: 'a1'}},
    {id: 'odd-1', level: 'info', title: 'Autre', message: 'Divers', entity: 'inconnue', entityId: 'z1'}
  ];
  const rows = feed(farm({interventions: []}), {notifications});
  const by = id => rows.find(r => r.id === id).action;
  assert.deepEqual(by('R4-p1'), {type: 'open-parcel', label: 'Voir la parcelle', id: 'p1', payload: null});
  assert.equal(by('R6-a1').type, 'open-herd-animal');
  // Entité inconnue de openNotificationEntity : repli sur un écran qui existe.
  assert.equal(by('odd-1').payload.entity, 'regulated');
});

test('travail en retard avec why vide : le titre garde le type de travail', () => {
  const rows = feed(farm(), {notifications: [{...overdue('w1'), why: []}]});
  assert.equal(rows[0].title, 'Travail en retard : Semis');
});

test('pâturage : demi-journées et repos inconnu bien affichés', () => {
  const rows = feed(farm({interventions: []}), {grazingAdvice: [{lotId: 'g1', sessionId: 'g1', parcelId: 'p1', parcelName: 'Les Brosses', daysLeft: 2.5, confidence: 'moyenne', level: 'warning', next: [{parcelId: 'p2', parcelName: 'Le Clos', restDays: null}], why: []}]});
  assert.equal(rows[0].stakes.daysLeft, 2);
  assert.ok(rows[0].why.some(w => w.includes('Environ 2,5 jours')));
  assert.ok(rows[0].why.every(w => !w.includes('null')));
  assert.match(stakesLabel(rows[0].stakes), /J-2$/);
  assert.equal(stakesLabel({daysLeft: 1.5}), 'J-1');
});

test('besoin sans manque (AMM retirée) : titre exact, quantité à virgule', () => {
  const rows = feed(farm({interventions: []}), {inputNeeds: [
    {id: 'stock-shortfall-s1', itemId: 's1', name: 'Fongicide', unit: 'L', shortfall: 0, valueEur: null, firstShortDate: null, works: [], ammWithdrawn: true, level: 'warning', why: ['AMM retirée']},
    {id: 'stock-shortfall-s2', itemId: 's2', name: 'Urée', unit: 't', shortfall: 1.25, valueEur: 600, firstShortDate: '2026-11-20', works: [], level: 'warning', why: []}
  ]});
  assert.equal(rows.find(r => r.id === 'stock-shortfall-s1').title, 'AMM retirée : Fongicide');
  assert.ok(rows.find(r => r.id === 'stock-shortfall-s2').why.some(w => w.includes('1,25 t')));
});

test('notifications recalculées sur la date fournie, pas sur l’horloge', () => {
  const state = farm({interventions: [{id: 'w9', type: 'Semis', parcelId: 'p1', status: 'Planifié', plannedDate: '2026-11-12'}]});
  const rows = decisionFeed(state, {today: '2026-11-20', now: Date.UTC(2026, 10, 20, 9), compliance: [], treasury: {}});
  assert.ok(rows.some(r => r.id === 'work-overdue-w9'), 'le travail du 12/11 est en retard au 20/11');
});

test('manque d’intrant : le bouton prépare la tâche de commande (titre, échéance, notes)', () => {
  const rows = feed(farm({interventions: []}), {inputNeeds: [
    {id: 'stock-shortfall-s2', itemId: 's2', name: 'Urée', unit: 't', shortfall: 1.25, valueEur: 600, firstShortDate: '2026-11-20', firstShortWorkId: null, works: [], level: 'warning', why: []},
    {id: 'stock-shortfall-s1', itemId: 's1', name: 'Fongicide', unit: 'L', shortfall: 0, valueEur: null, firstShortDate: null, works: [], ammWithdrawn: true, level: 'warning', why: ['AMM retirée']}
  ]});
  const short = rows.find(r => r.id === 'stock-shortfall-s2'), amm = rows.find(r => r.id === 'stock-shortfall-s1');
  assert.equal(short.action.type, 'create-task-prefill');
  assert.equal(short.action.payload.title, 'Commander Urée');
  assert.match(short.action.payload.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(short.action.payload.notes, /Urée : il manque 1,3 t dès l’apport du 20\/11/);
  assert.deepEqual([amm.action.type, amm.action.id], ['stock-movement', 's1']);
});
