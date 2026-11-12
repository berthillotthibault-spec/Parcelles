// Zones vulnérables : calendrier national d'interdiction d'épandage (zv-calendar.js), conseil R12,
// réponse de l'assistant et fusion dans le fil « À décider ».
import test from 'node:test';
import assert from 'node:assert/strict';
import {ZV_NATIONAL_PERIODS, ZV_CALENDAR_SOURCE, classifyFertilizer, occupationFor, bansAt, dayAfterBan, zvSpreadStatus, zvPeriods, zvStatusText} from './zv-calendar.js';
import {farmAdvice} from './conseils.js';
import {answerAgroQuestion} from './agro-assistant.js';
import {agroIntent} from './agro-knowledge.js';
import {decisionFeed} from './decision-feed.js';

const zvState = ({product = 'Lisier bovin', date = '2026-11-20', culture = 'Blé tendre', zone = true, type = 'Épandage'} = {}) => ({
  parcelles: [{id: 'p1', nom: 'Les Brosses', culture, surfaceHa: 12, zoneVulnerable: zone}],
  interventions: [{id: 'w1', parcelId: 'p1', type, product, status: 'À faire', plannedDate: date}]
});

test('source citée : arrêté du 19 décembre 2011 modifié, version 30 janvier 2023', () => {
  assert.match(ZV_CALENDAR_SOURCE.text, /19 décembre 2011/);
  assert.match(ZV_CALENDAR_SOURCE.version, /30 janvier 2023/);
  assert.match(ZV_CALENDAR_SOURCE.url, /legifrance\.gouv\.fr/);
});

test('table nationale : lignes lues dans l’annexe I', () => {
  const get = (o, t) => ZV_NATIONAL_PERIODS.filter(p => p.occupation === o && p.type === t).map(p => `${p.from}/${p.to}`);
  assert.deepEqual(get('automne', 'II'), ['10-01/01-31']);
  assert.deepEqual(get('colza', 'II'), ['10-15/01-31']);
  assert.deepEqual(get('printemps', 'Ia'), ['07-01/08-31', '11-15/01-15']);
  assert.deepEqual(get('printemps', 'III'), ['07-01/02-15']);
  assert.deepEqual(get('prairie', 'II'), ['11-15/01-15']);
  assert.deepEqual(get('prairie', 'III'), ['10-01/01-31']);
  assert.deepEqual(get('autres', 'III'), ['12-15/01-15']);
});

test('classement des fertilisants', () => {
  assert.equal(classifyFertilizer('Lisier de porc').type, 'II');
  assert.equal(classifyFertilizer('Fientes de poules').type, 'II');
  assert.equal(classifyFertilizer('Fumier de volaille').type, 'II');
  assert.equal(classifyFertilizer('Fumier bovin').type, 'I');
  assert.equal(classifyFertilizer('Fumier pailleux').type, 'Ia');
  assert.equal(classifyFertilizer('Compost de fumier').type, 'Ia');
  assert.equal(classifyFertilizer('Ammonitrate 33,5').type, 'III');
  assert.equal(classifyFertilizer('Solution azotée 390').type, 'III');
  const unknown = classifyFertilizer('Produit maison');
  assert.equal(unknown.type, null);
  assert.equal(unknown.label, 'Type de fertilisant à préciser');
  assert.equal(classifyFertilizer('Digestat').type, null);
});

test('classement : type déclaré dans le stock prioritaire', () => {
  const state = {stockItems: [{id: 's', name: 'Bouchons X', fertilizer: {N: 4, type: 'II'}}]};
  const r = classifyFertilizer('Bouchons X', {state});
  assert.equal(r.type, 'II');
  assert.equal(r.certain, true);
});

test('occupation du sol', () => {
  assert.equal(occupationFor('Colza d’hiver'), 'colza');
  assert.equal(occupationFor('Blé tendre'), 'automne');
  assert.equal(occupationFor('Maïs grain'), 'printemps');
  assert.equal(occupationFor('Prairie permanente'), 'prairie');
  assert.equal(occupationFor('Vigne'), 'autres');
  assert.equal(occupationFor(''), null);
  assert.equal(occupationFor('Culture exotique'), null);
});

test('périodes qui passent le 31/12 et jour de reprise', () => {
  assert.equal(bansAt('2026-12-20', 'automne', 'II').length, 1);
  assert.equal(bansAt('2027-01-20', 'automne', 'II').length, 1);
  assert.equal(bansAt('2026-09-20', 'automne', 'II').length, 0);
  const ban = bansAt('2026-11-20', 'automne', 'II')[0];
  assert.equal(dayAfterBan('2026-11-20', ban), '2027-02-01');
  assert.equal(dayAfterBan('2027-01-10', ban), '2027-02-01');
});

test('statut : lisier sur blé en novembre interdit, fin au 31/01', () => {
  const r = zvSpreadStatus({date: '2026-11-20', culture: 'Blé tendre', product: 'Lisier'});
  assert.equal(r.status, 'interdit');
  assert.equal(r.hit.until, '2027-02-01');
  assert.match(zvStatusText(r, {product: 'Lisier', parcelName: 'Les Brosses'}), /interdit en zone vulnérable sur Les Brosses du 01\/10 au 31\/01/);
});

test('statut : fumier (I.a ou I.b) sur maïs en septembre, à préciser', () => {
  const r = zvSpreadStatus({date: '2026-09-10', culture: 'Maïs grain', product: 'Fumier bovin'});
  assert.equal(r.status, 'a-preciser');
});

test('statut : type inconnu en décembre sur blé, interdit pour tous les types', () => {
  assert.equal(zvSpreadStatus({date: '2026-12-20', culture: 'Blé tendre', product: 'Produit maison'}).status, 'interdit');
  assert.equal(zvSpreadStatus({date: '2026-10-05', culture: 'Blé tendre', product: 'Produit maison'}).status, 'a-preciser');
});

test('statut : hors période, autorisé (sous réserve du PAR)', () => {
  const r = zvSpreadStatus({date: '2026-03-10', culture: 'Blé tendre', product: 'Ammonitrate'});
  assert.equal(r.status, 'autorise');
  assert.match(zvStatusText(r, {product: 'Ammonitrate'}), /programme d’actions régional/);
});

test('périodes régionales saisies : ajoutées, invalides ignorées', () => {
  const state = {exploitation: {azote: {zvCalendar: {periods: [{occupation: 'automne', type: 'III', from: '02-01', to: '02-15', label: 'PAR'}, {occupation: 'x', type: 'II', from: '01-01', to: '01-02'}]}}}};
  assert.equal(zvPeriods(state).length, ZV_NATIONAL_PERIODS.length + 1);
  assert.equal(zvSpreadStatus({date: '2027-02-10', culture: 'Blé', product: 'Ammonitrate', state}).status, 'interdit');
  assert.equal(zvSpreadStatus({date: '2027-02-10', culture: 'Blé', product: 'Ammonitrate'}).status, 'autorise');
});

test('R12 : épandage de lisier prévu dans 3 jours en ZV, urgent avec report', () => {
  const list = farmAdvice(zvState({date: '2026-11-15'}), {today: '2026-11-12'}).filter(a => a.rule === 'R12');
  assert.equal(list.length, 1);
  assert.equal(list[0].level, 'urgent');
  assert.equal(list[0].action.type, 'postpone-work');
  assert.ok(list[0].why.some(w => /19 décembre 2011/.test(w)));
});

test('R12 : hors zone vulnérable, rien', () => {
  assert.equal(farmAdvice(zvState({zone: false}), {today: '2026-11-12'}).filter(a => a.rule === 'R12').length, 0);
});

test('R12 : zone détectée automatiquement (zvAuto)', () => {
  const s = zvState({zone: null});
  assert.equal(farmAdvice(s, {today: '2026-11-12'}).filter(a => a.rule === 'R12').length, 0);
  assert.equal(farmAdvice(s, {today: '2026-11-12', zvAuto: () => ({inZone: true})}).filter(a => a.rule === 'R12').length, 1);
});

test('R12 : type inconnu, conseil « à préciser » avec modification du travail', () => {
  const list = farmAdvice(zvState({product: 'Produit maison', date: '2026-10-05', type: 'Fertilisation'}), {today: '2026-10-01'}).filter(a => a.rule === 'R12');
  assert.equal(list.length, 1);
  assert.equal(list[0].action.type, 'edit-work');
  assert.ok(list[0].why.some(w => /à préciser/.test(w)));
});

test('R12 : apport hors période ou trop lointain, rien', () => {
  assert.equal(farmAdvice(zvState({product: 'Ammonitrate', date: '2026-03-10'}), {today: '2026-03-01'}).filter(a => a.rule === 'R12').length, 0);
  assert.equal(farmAdvice(zvState({date: '2027-01-20'}), {today: '2026-11-01'}).filter(a => a.rule === 'R12').length, 0);
});

test('fil « À décider » : conseil R12 et alerte azote du même travail en une seule carte', () => {
  const rows = decisionFeed(zvState({date: '2026-11-15'}), {today: '2026-11-12', now: Date.parse('2026-11-12T08:00:00')});
  const cards = rows.filter(r => /w1/.test(r.id));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, 'urgent');
});

test('assistant : intention zvSpread', () => {
  assert.equal(agroIntent('Puis-je épandre du lisier sur les Brosses ?'), 'zvSpread');
  assert.equal(agroIntent('je peux mettre du fumier demain ?'), 'zvSpread');
  assert.equal(agroIntent('Combien d’azote ai-je apporté sur les Brosses ?'), 'nitrogen');
});

test('assistant : « puis-je épandre du lisier sur les Brosses ? » en novembre', () => {
  const r = answerAgroQuestion('Puis-je épandre du lisier sur les Brosses ?', zvState(), {today: '2026-11-12'});
  assert.equal(r.intent, 'zv_spread');
  assert.match(r.answer, /zone vulnérable/);
  assert.match(r.answer, /interdit/);
  assert.match(r.answer, /régional/);
  assert.equal(r.actions[0].payload.parcelId, 'p1');
});

test('assistant : parcelle hors zone, sans parcelle citée', () => {
  const out = answerAgroQuestion('Puis-je épandre du lisier sur les Brosses ?', zvState({zone: false}), {today: '2026-11-12'});
  assert.match(out.answer, /hors zone vulnérable/);
  const none = answerAgroQuestion('Puis-je épandre du lisier ?', zvState(), {today: '2026-11-12'});
  assert.match(none.answer, /Citez la parcelle/);
});

test('période régionale qui prolonge la nationale : la fin la plus tardive l’emporte', () => {
  const state = {exploitation: {azote: {zvCalendar: {periods: [{occupation: 'colza', type: 'II', from: '09-01', to: '02-28', label: 'PAR : colza, lisier'}]}}}};
  const r = zvSpreadStatus({date: '2026-11-12', culture: 'Colza', product: 'Lisier', state});
  assert.equal(r.status, 'interdit');
  assert.equal(r.hit.until, '2027-03-01');
  assert.equal(r.hit.ban.origin, 'regional');
  assert.match(zvStatusText(r, {product: 'Lisier'}), /du 01\/09 au 28\/02 .*possible à partir du 01\/03/);
  // Seule la période régionale s'applique (avant le 15/10 national).
  const early = zvSpreadStatus({date: '2026-09-20', culture: 'Colza', product: 'Lisier', state});
  assert.equal(early.hit.ban.origin, 'regional');
  // Sans période régionale : calendrier national.
  assert.equal(zvSpreadStatus({date: '2026-11-12', culture: 'Colza', product: 'Lisier'}).hit.until, '2027-02-01');
});

test('exception de la note (Sud, irrigation) signalée seulement aux dates concernées', () => {
  assert.equal(zvSpreadStatus({date: '2027-01-20', culture: 'Blé tendre', product: 'Lisier'}).exception, true);
  assert.equal(zvSpreadStatus({date: '2026-11-20', culture: 'Blé tendre', product: 'Lisier'}).exception, false);
  assert.equal(zvSpreadStatus({date: '2026-07-05', culture: 'Maïs grain', product: 'Ammonitrate'}).exception, true);
  assert.equal(zvSpreadStatus({date: '2026-10-05', culture: 'Maïs grain', product: 'Ammonitrate'}).exception, false);
});

test('à préciser : type écrit avec le point (I.a, I.b)', () => {
  const r = zvSpreadStatus({date: '2026-09-10', culture: 'Maïs grain', product: 'Fumier bovin'});
  const text = zvStatusText(r, {product: 'Fumier'});
  assert.match(text, /pour une partie des fertilisants de type I ; si c’est du type I\.b,/);
});
