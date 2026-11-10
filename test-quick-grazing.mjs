// Pâturage dans le « + » : logique pure (quick-grazing.js) et écritures sur un vrai Store (grazing-records.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './state.js';
import {canMutate, roleScope} from './permissions.js';
import {farmGrazingBalance, grazingNitrogen, longOpenLots, stockingRate} from './grazing.js';
import {herdHeadline, herdLots, animalsInside, moveDestinations} from './herd-home.js';
import {animalLot, exitedInLot, lotsListing} from './herd.js';
import {moveGrazingLot, removeAnimalFromLot, saveGrazingEntries} from './grazing-records.js';
import {readableTables} from './open-export.js';
import {encodeCloudPayload} from './sync.js';
import {readFileSync} from 'node:fs';
import {closingCandidates, draftFields, isGrazingType, orderedWorkTypes, plannedToday} from './quick-work.js';
import {buildGrazingEntries, finishedEntry, freshEntry, fullFormAllowed, grazingClosings, grazingEntryAlerts, grazingGestures, grazingParcelRows, herdGroups, planLotMoves, plannedEntry, plannedGrazingWorks, plannedNote, presentPicks, selectedParcels, splitByArea} from './quick-grazing.js';

function memoryStorage() { const data = new Map(); return {async init() {}, async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; }, async getStored(k) { return this.get(k); }, async set(k, v) { data.set(k, structuredClone(v)); }, async setIfCurrent(k, v) { data.set(k, structuredClone(v)); }, async backupPut() {}, async pruneBackups() {}, async blobDelete() {}, async blobGet() { return null; }}; }
const TODAY = new Date().toISOString().slice(0, 10);
const shift = n => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const farm = (extra = {}) => ({
  parcelles: [{id: 'pre1', nom: 'Pré Bas', culture: 'Prairie permanente', surfaceHa: 6}, {id: 'pre2', nom: 'Pré Haut', culture: 'Prairie', surfaceHa: 2}, {id: 'ble', nom: 'Blé Nord', culture: 'Blé tendre', surfaceHa: 10}],
  interventions: [], tasks: [], grazingSessions: [], animals: [], preferences: {}, ...extra
});
const entry = (patch = {}) => ({...freshEntry(farm()), parcelIds: ['pre1'], lines: [{category: 'vache-laitiere', count: '24'}], ...patch});
async function storeWith(data) {
  const store = new Store(memoryStorage()); await store.init();
  Object.assign(store.state, data);
  return store;
}

test('liste fermée : les vrais gestes d’animaux, jamais la famille ni /patur/', () => {
  for (const label of ['Pâturage', 'pâture', 'Mise à l’herbe', "Mise à l'herbe", 'Mise au pré', 'Pacage', 'Transhumance', 'Estive']) assert.equal(isGrazingType(label), true, label);
  for (const label of ['Rentrée des animaux', 'Broyage pâture', 'Hersage pâture', 'Fertilisation pâture', 'Clôture pâture', 'Réparer la clôture', 'Clôture', 'Abreuvoir', 'Vermifuger le troupeau', '', null]) assert.equal(isGrazingType(label), false, String(label));
});

test('clé : après saisie, chargement, lots et bilan sont non nuls, et aucune intervention n’est créée', async () => {
  const data = farm(), store = await storeWith(data);
  const {entries} = buildGrazingEntries(entry({lotName: 'Lot 1'}), store.state, {today: TODAY, date: shift(-5)});
  await saveGrazingEntries(store, entries);
  assert.equal(store.state.interventions.length, 0);
  assert.equal(store.state.grazingSessions.length, 1);
  assert.equal(store.state.grazingSessions[0].note, 'Lot 1');
  assert.ok(stockingRate(store.state, 'pre1', {date: TODAY}).ugb > 0);
  assert.equal(herdLots(store.state, {today: TODAY})[0].n, 24);
  const balance = farmGrazingBalance(store.state, {date: TODAY});
  assert.ok(balance.ugbDays > 0 && balance.nitrogen >= 0 && balance.lots.length === 1);
  assert.ok(grazingNitrogen(store.state, {from: shift(-30), to: TODAY}).total > 0);
});

test('répartition : somme exacte, prorata des surfaces, parts égales sans surface, jamais de total copié', () => {
  assert.deepEqual(splitByArea(24, [{id: 'a', surfaceHa: 6}, {id: 'b', surfaceHa: 2}]), {a: 18, b: 6});
  assert.deepEqual(splitByArea(10, [{id: 'a', surfaceHa: 1}, {id: 'b', surfaceHa: 1}, {id: 'c', surfaceHa: 1}]), {a: 4, b: 3, c: 3});
  assert.deepEqual(splitByArea(5, [{id: 'a', surfaceHa: 3}, {id: 'b', surfaceHa: 0}]), {a: 3, b: 2});
  assert.deepEqual(splitByArea(4, [{id: 'a'}, {id: 'b', surfaceHa: 9}]), {a: 2, b: 2});
  const built = buildGrazingEntries(entry({parcelIds: ['pre1', 'pre2'], lotName: 'Lot 1'}), farm(), {today: TODAY, date: TODAY});
  assert.equal(built.total, 24);
  assert.deepEqual(built.entries.map(e => [e.parcelId, e.additionalAnimalsCount, e.note]), [['pre1', 18, 'Lot 1 · Pré Bas'], ['pre2', 6, 'Lot 1 · Pré Haut']]);
  assert.throws(() => buildGrazingEntries(entry({parcelIds: ['pre1', 'pre2'], alloc: {0: {pre1: '20', pre2: '6'}}}), farm(), {today: TODAY, date: TODAY}), /Répartition : 26 répartis pour 24/);
});

test('le lot tourne : un seul passage sur le pré d’entrée', () => {
  const built = buildGrazingEntries(entry({parcelIds: ['pre1', 'pre2'], rotate: true, entryParcelId: 'pre2'}), farm(), {today: TODAY, date: TODAY});
  assert.deepEqual(built.entries.map(e => [e.parcelId, e.additionalAnimalsCount]), [['pre2', 24]]);
});

test('plusieurs catégories : une ligne par catégorie, nom commun, passages distincts', () => {
  const built = buildGrazingEntries(entry({lotName: 'Lot 1', lines: [{category: 'vache-allaitante', count: '10'}, {category: 'veau', count: '8'}]}), farm(), {today: TODAY, date: TODAY});
  assert.deepEqual(built.entries.map(e => [e.note, e.animalCategory, e.additionalAnimalsCount]), [['Lot 1 · Vache allaitante', 'vache-allaitante', 10], ['Lot 1 · Veau', 'veau', 8]]);
  assert.equal(built.unknownCategory, false);
});

test('saisie refusée : aucun animal, sortie avant entrée, date future ; rappels si champs facultatifs vides', () => {
  assert.throws(() => buildGrazingEntries(entry({lines: [{category: '', count: ''}]}), farm(), {today: TODAY, date: TODAY}), /combien d’animaux/);
  assert.throws(() => buildGrazingEntries(entry({endDate: shift(-3)}), farm(), {today: TODAY, date: shift(-1)}), /Sortie|sortie/);
  assert.throws(() => buildGrazingEntries(entry(), farm(), {today: TODAY, date: shift(2)}), /travail à faire/);
  const built = buildGrazingEntries(entry({lines: [{category: '', count: '3'}]}), farm(), {today: TODAY, date: TODAY});
  assert.deepEqual([built.unknownCategory, built.noLotName], [true, true]);
});

test('sélecteur : au bâtiment d’abord, lot affiché, gestation conservée, animal déplacé sans doublon, lot vidé clôturé', async () => {
  const animals = [{id: 'a1', nationalId: 'FR0000000001', name: 'Rose', sex: 'F', birthDate: '2020-01-01'}, {id: 'a2', nationalId: 'FR0000000002', name: 'Lila', sex: 'F', birthDate: '2020-01-01'},
    {id: 'a3', nationalId: 'FR0000000003', name: 'Vendue', sex: 'F', exitDate: shift(-20), exitReason: 'Vente'}];
  const lot = {id: 'L1', parcelId: 'pre1', note: 'Vieux lot', animalType: 'Bovins', startDate: shift(-10), endDate: null, animals: [{number: 'FR0000000002', name: 'Lila', animalId: 'a2', gestation: true}], additionalAnimalsCount: 0, animalsCount: 1};
  const data = farm({animals, grazingSessions: [lot]}), store = await storeWith(data);
  const groups = herdGroups(store.state, {date: TODAY});
  assert.deepEqual(groups.map(g => g.label), ['Au bâtiment', 'Vieux lot']);
  assert.deepEqual(groups[0].animals.map(x => x.animal.id), ['a1']);
  assert.equal(groups[1].animals[0].gestation, true);
  assert.equal(herdGroups(store.state, {date: shift(-30)})[0].animals.some(x => x.animal.id === 'a3'), true, 'présente à une date passée');
  const built = buildGrazingEntries(entry({parcelIds: ['pre2'], lines: [{category: 'vache-allaitante', count: ''}], picks: {a1: {line: 0}, a2: {line: 0}}}), store.state, {today: TODAY, date: TODAY});
  assert.equal(built.total, 2);
  assert.equal(built.animals.find(x => x.animalId === 'a2').gestation, true);
  const plan = planLotMoves(store.state, built.animals, {date: TODAY});
  assert.deepEqual(plan.closed, [{id: 'L1', name: 'Vieux lot'}]);
  assert.deepEqual(plan.emptied, []);
  assert.equal(plan.updates[0].endDate, TODAY);
  assert.equal(plan.updates[0].animalsCount, 1, 'liste du passage passé intacte');
  await saveGrazingEntries(store, built.entries);
  await store.upsertMany('grazingSessions', plan.updates, {label: 'test'});
  assert.equal(herdLots(store.state, {today: TODAY}).length, 1);
  assert.equal(animalsInside(store.state, {today: TODAY}).length, 0);
  assert.match(herdHeadline(store.state, {today: TODAY}), /^2 animaux · 2 au pré/);
});

const herd10 = () => Array.from({length: 10}, (_, i) => ({id: `a${i}`, nationalId: `FR000000000${i}`, name: `V${i}`, sex: 'F', birthDate: '2020-01-01'}));
const lotOf = (animals, patch = {}) => ({id: 'L', parcelId: 'pre1', note: 'Lot L', animalType: 'Bovins', animalCategory: 'vache-laitiere', startDate: shift(-90), endDate: null, additionalAnimalsCount: 0,
  animals: animals.map(a => ({number: a.nationalId, name: a.name, animalId: a.id, gestation: false})), animalsCount: animals.length, ...patch});
const pickAll = list => Object.fromEntries(list.map(a => [a.id, {line: 0, parcelId: ''}]));
const applyMove = async (store, picks, date, patch = {}) => {
  const built = buildGrazingEntries(entry({parcelIds: ['pre2'], lines: [{category: 'vache-laitiere', count: ''}], picks, ...patch}), store.state, {today: TODAY, date});
  const plan = planLotMoves(store.state, built.animals, {date, today: TODAY, endDate: patch.endDate || ''});
  await saveGrazingEntries(store, built.entries);
  await store.upsertMany('grazingSessions', [...plan.updates, ...plan.creates], {label: 'test'});
  return plan;
};
const measures = (state, from) => ({n: grazingNitrogen(state, {from, to: TODAY}).total, days: farmGrazingBalance(state, {date: TODAY}).ugbDays});

test('lot au pré repris en entier : clos sans toucher à sa liste, azote et UGB-jours identiques à un déplacement', async () => {
  const animals = herd10(), from = shift(-120), mid = shift(-30);
  const store = await storeWith(farm({animals, grazingSessions: [lotOf(animals)]})), avant = measures(store.state, from);
  const twin = await storeWith(farm({animals, grazingSessions: [lotOf(animals)]}));
  await moveGrazingLot(twin, twin.state.grazingSessions[0], 'pre2', {date: mid});
  const plan = await applyMove(store, pickAll(animals), mid);
  const old = store.state.grazingSessions.find(s => s.id === 'L');
  assert.equal(old.animals.length, 10); assert.equal(old.animalsCount, 10); assert.equal(old.endDate, mid);
  assert.deepEqual(plan.creates, []);
  assert.equal(herdLots(store.state, {today: TODAY}).length, 1);
  const apres = measures(store.state, from), reference = measures(twin.state, from);
  assert.ok(Math.abs(apres.n - reference.n) < 1e-6, 'azote comme moveGrazingLot');
  assert.ok(Math.abs(apres.days - reference.days) < 1e-6, 'UGB-jours comme moveGrazingLot');
  assert.ok(Math.abs(apres.n - avant.n) < 1e-6, 'le lot change de pré : azote de la période inchangé');
});

test('lot au pré repris en partie : clos à la date, le reste repart dans un passage ; le passé ne bouge pas', async () => {
  const animals = herd10(), mid = shift(-30), before = shift(-40);
  const store = await storeWith(farm({animals, grazingSessions: [lotOf(animals)]}));
  const passe = grazingNitrogen(store.state, {from: shift(-120), to: before}).total;
  const plan = await applyMove(store, pickAll(animals.slice(0, 3)), mid);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].animalsCount, 7);
  assert.equal(plan.creates[0].startDate, mid);
  assert.equal(plan.creates[0].note, 'Lot L');
  const old = store.state.grazingSessions.find(s => s.id === 'L');
  assert.equal(old.animalsCount, 10); assert.equal(old.endDate, mid);
  assert.equal(grazingNitrogen(store.state, {from: shift(-120), to: before}).total, passe, 'azote passé inchangé');
  const open = herdLots(store.state, {today: TODAY});
  assert.deepEqual(open.map(l => l.n).sort((a, b) => a - b), [3, 7]);
});

test('entrée le jour du lot ou avant : correction de la liste, sans nouveau passage ; lot déjà clos jamais touché', async () => {
  const animals = herd10();
  const ouvert = lotOf(animals, {startDate: shift(-10)}), clos = lotOf(animals.slice(0, 2), {id: 'C', startDate: shift(-10), endDate: shift(-5), parcelId: 'pre2'});
  const data = farm({animals, grazingSessions: [ouvert, clos]});
  const item = {number: animals[0].nationalId, name: 'V0', animalId: 'a0', gestation: false};
  const plan = planLotMoves(data, [item], {date: shift(-20), today: TODAY});
  assert.deepEqual(plan.updates.map(r => [r.id, r.animalsCount, r.endDate]), [['L', 9, null]]);
  assert.deepEqual(plan.creates, []);
  const seul = lotOf(animals.slice(0, 1), {startDate: shift(-10)});
  const vide = planLotMoves(farm({animals, grazingSessions: [seul]}), [item], {date: shift(-10), today: TODAY});
  assert.deepEqual(vide.emptied, [{id: 'L', name: 'Lot L'}]);
  assert.equal(vide.updates[0].endDate, shift(-10));
});

test('lot vidé : toujours clos à son entrée, jamais un lot ouvert à 0 animal (n° 160)', async () => {
  const animals = herd10(), item = {number: animals[0].nationalId, name: 'V0', animalId: 'a0', gestation: false};
  // Même avec une sortie prévue, le lot vidé est clos à son entrée ; l'ancienne option « ne pas clôturer » est ignorée.
  const seul = lotOf(animals.slice(0, 1), {startDate: shift(-10), endDate: shift(5)});
  const plan = planLotMoves(farm({animals, grazingSessions: [seul]}), [item], {date: shift(-10), today: TODAY, keepEmptied: ['L']});
  assert.deepEqual(plan.updates.map(r => [r.id, r.animalsCount, r.endDate]), [['L', 0, shift(-10)]]);
  const store = await storeWith(farm({animals, grazingSessions: [lotOf(animals.slice(0, 1), {startDate: shift(-10)})]}));
  await applyMove(store, pickAll(animals.slice(0, 1)), shift(-10));
  const old = store.get('grazingSessions', 'L');
  assert.deepEqual([old.animalsCount, old.endDate], [0, shift(-10)]);
  assert.equal(herdLots(store.state, {today: TODAY}).some(l => l.id === 'L'), false, 'plus au pré');
});

test('animal coché puis sorti, ou absent à la date : jamais écrit dans le lot (n° 160)', () => {
  const animals = [...herd10().slice(0, 3), {id: 'parti', nationalId: 'FR0000000099', name: 'Partie', exitDate: shift(-3), exitReason: 'Vente'}];
  const data = farm({animals});
  const picks = pickAll(animals);
  const built = buildGrazingEntries(entry({parcelIds: ['pre2'], lines: [{category: 'vache-laitiere', count: ''}], picks}), data, {today: TODAY, date: shift(-1)});
  assert.deepEqual(built.animals.map(a => a.animalId), ['a0', 'a1', 'a2']);
  // Avant sa sortie, il était là : il compte.
  assert.equal(buildGrazingEntries(entry({parcelIds: ['pre2'], lines: [{category: 'vache-laitiere', count: ''}], picks}), data, {today: TODAY, date: shift(-5)}).animals.length, 4);
  assert.deepEqual(Object.keys(presentPicks(data, picks, shift(-1))), ['a0', 'a1', 'a2']);
  assert.deepEqual(Object.keys(presentPicks(data, picks, shift(-5))), ['a0', 'a1', 'a2', 'parti']);
  assert.throws(() => buildGrazingEntries(entry({parcelIds: ['pre2'], lines: [{category: 'vache-laitiere', count: ''}], picks: {parti: {line: 0, parcelId: ''}}}), data, {today: TODAY, date: TODAY}), /Indiquez combien/);
});

test('saisie déjà terminée : lot actuel inchangé, rien à planifier', async () => {
  const animals = herd10(), lot = lotOf(animals, {startDate: shift(-5)});
  const store = await storeWith(farm({animals, grazingSessions: [lot]}));
  const plan = await applyMove(store, pickAll(animals.slice(0, 1)), shift(-30), {endDate: shift(-25)});
  assert.deepEqual([plan.updates, plan.creates, plan.emptied, plan.closed], [[], [], [], []]);
  assert.equal(store.state.grazingSessions.find(s => s.id === 'L').animalsCount, 10);
  assert.equal(finishedEntry({endDate: TODAY}, TODAY), true, 'entrée et sortie le jour même');
  assert.equal(finishedEntry({endDate: shift(1)}, TODAY), false);
  assert.equal(finishedEntry({endDate: ''}, TODAY), false);
  assert.equal(herdLots(store.state, {today: TODAY}).find(l => l.id === 'L').n, 10);
});

test('saisie ouverte rétroactive : le sélecteur annonce le lot réellement quitté, pas un lot clos', () => {
  const animals = herd10();
  const data = farm({animals, grazingSessions: [lotOf(animals.slice(0, 1), {startDate: shift(-5)}), lotOf(animals.slice(1, 2), {id: 'C', note: 'Clos', startDate: shift(-40), endDate: shift(-20)})]});
  const flat = herdGroups(data, {date: shift(-30), today: TODAY}).flatMap(g => g.animals);
  const a0 = flat.find(x => x.animal.id === 'a0'), a1 = flat.find(x => x.animal.id === 'a1');
  assert.equal(a0.leavesName, 'Lot L');
  assert.equal(a1.lotName, 'Clos'); assert.equal(a1.lotOpen, false);
  assert.equal(flat.find(x => x.animal.id === 'a2').leavesName, '');
});

test('formulaire complet : réservé à une saisie sans animal de lot ni travail à clore', () => {
  assert.equal(fullFormAllowed(entry()), true);
  assert.equal(fullFormAllowed(entry(), {workId: 'w1'}), false);
  assert.equal(fullFormAllowed(entry({picks: {a1: {line: 0}}})), false);
  assert.equal(fullFormAllowed(entry({numbers: 'FR0000000001'})), false);
});

test('répartition : à surfaces égales et sélection inversée, l’écran et l’enregistrement donnent la même chose', () => {
  const data = farm({parcelles: [{id: 'A', nom: 'A', culture: 'Prairie', surfaceHa: 5}, {id: 'B', nom: 'B', culture: 'Prairie', surfaceHa: 5}]});
  const shown = splitByArea(5, selectedParcels(data, ['B', 'A']));
  const {entries} = buildGrazingEntries(entry({parcelIds: ['B', 'A'], lines: [{category: '', count: '5'}]}), data, {today: TODAY, date: TODAY});
  assert.deepEqual(Object.fromEntries(entries.map(row => [row.parcelId, row.additionalAnimalsCount])), shown);
  assert.deepEqual(shown, {B: 3, A: 2});
});

test('nom tapé : relié à sa fiche, sans doublon avec une coche ; nom ambigu refusé', () => {
  const animals = herd10(), data = farm({animals, grazingSessions: [lotOf(animals)]});
  const base = {lines: [{category: '', count: ''}], parcelIds: ['pre2']};
  const typed = buildGrazingEntries(entry({...base, numbers: 'V1 | gestante'}), data, {today: TODAY, date: TODAY});
  assert.equal(typed.animals[0].animalId, 'a1');
  assert.equal(typed.animals[0].gestation, true);
  assert.equal(planLotMoves(data, typed.animals, {date: TODAY, today: TODAY}).creates[0].animalsCount, 9);
  assert.equal(buildGrazingEntries(entry({...base, numbers: 'v1', picks: {a1: {line: 0}}}), data, {today: TODAY, date: TODAY}).total, 1);
  assert.equal(buildGrazingEntries(entry({...base, numbers: 'V1\nFR0000000001'}), data, {today: TODAY, date: TODAY}).total, 1, 'nom et numéro de la même bête');
  const twins = farm({animals: [{id: 'x', nationalId: 'FR1', name: 'Rose'}, {id: 'y', nationalId: 'FR2', name: 'Rose'}]});
  assert.throws(() => buildGrazingEntries(entry({...base, numbers: 'Rose'}), twins, {today: TODAY, date: TODAY}), /Plusieurs animaux/);
});

test('date future : chaque travail porte la part de son pré, conservée au stockage et en synchro, rechargée à la clôture', async () => {
  const animals = herd10(), store = await storeWith(farm({animals}));
  const works = plannedGrazingWorks(entry({parcelIds: ['pre1', 'pre2'], lotName: 'Lot 1', lines: [{category: 'vache-laitiere', count: '30'}], picks: {a0: {line: 0, parcelId: 'pre2'}}}), store.state, {type: 'Pâturage', date: shift(3), today: TODAY});
  assert.deepEqual(works.map(w => [w.parcelId, w.grazingPlan.lines[0].count]), [['pre1', '23'], ['pre2', '7']]);
  assert.match(works[0].note, /^Prévu : 23 animaux/);
  assert.match(works[1].note, /^Prévu : 8 animaux/, 'pas le total sur chaque pré');
  const saved = await store.upsertMany('interventions', works, {label: 'test'});
  const plan = store.get('interventions', saved[1].id).grazingPlan;
  assert.deepEqual(encodeCloudPayload(saved[1]).grazingPlan, plan, 'sans tableau imbriqué : inchangé en synchro');
  const back = {...freshEntry(store.state, {parcelIds: ['pre2']}), ...plannedEntry(plan)};
  assert.equal(back.lotName, 'Lot 1');
  const rows = buildGrazingEntries(back, store.state, {today: TODAY, date: TODAY});
  assert.equal(rows.total, 8);
  assert.equal(rows.entries[0].animalCategory, 'vache-laitiere');
  assert.equal(rows.animals[0].animalId, 'a0');
  assert.throws(() => plannedGrazingWorks(entry({parcelIds: ['pre1', 'pre2'], alloc: {0: {pre1: '1', pre2: '1'}}}), store.state, {type: 'Pâturage', date: shift(3), today: TODAY}), /Répartition/);
  assert.equal(plannedGrazingWorks(entry({lines: [{category: '', count: ''}]}), store.state, {type: 'Pâturage', date: shift(3), today: TODAY}).length, 1, 'effectif encore inconnu : travail quand même');
  assert.match(plannedNote({lines: [{count: '2'}], picks: [{id: 'a'}], numbers: 'X\nY', animalType: 'Bovins'}), /^Prévu : 5 animaux/);
});

test('rentrée des animaux prévue : pas proposée à la clôture d’une mise au pré', () => {
  const data = farm({interventions: [{id: 'r', parcelId: 'pre1', type: 'Rentrée des animaux', status: 'À faire', date: TODAY, plannedDate: TODAY}]});
  assert.deepEqual(closingCandidates(data, {type: 'Pâturage', parcelIds: ['pre1'], date: TODAY, today: TODAY}).works, []);
});

test('dictée : délai phyto confirmé par un bouton distinct, jamais par un second appui', () => {
  const source = readFileSync(new URL('./voice-notes-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /dreAck|Touchez à nouveau/);
  assert.match(source, /vn-reentry-ack/);
  assert.match(source, /Déplacer quand même/);
});

test('numéro tapé relié au troupeau, sans compter deux fois un animal coché', () => {
  const data = farm({animals: [{id: 'a1', nationalId: 'FR0000000001', name: 'Rose', sex: 'F'}]});
  const built = buildGrazingEntries(entry({numbers: 'FR0000000001\nFR0000000009 | gestante', lines: [{category: '', count: ''}], picks: {a1: {line: 0}}}), data, {today: TODAY, date: TODAY});
  assert.equal(built.total, 2);
  assert.equal(built.animals.filter(x => x.animalId === 'a1').length, 1);
  assert.equal(built.animals.find(x => x.number === 'FR0000000009').gestation, true);
});

test('alertes à la date : occupation, repos, non fourrager, sortie le jour de l’entrée, délai phyto', () => {
  const data = farm({grazingSessions: [{id: 'L1', parcelId: 'pre1', note: 'Lot A', startDate: shift(-3), endDate: null, additionalAnimalsCount: 5, animalsCount: 5},
    {id: 'L2', parcelId: 'pre2', note: 'Lot B', startDate: shift(-20), endDate: shift(-2), additionalAnimalsCount: 5, animalsCount: 5}],
    interventions: [{id: 'w', parcelId: 'ble', type: 'Traitement', product: 'X', status: 'Terminé', date: TODAY, isPhytosanitary: true}]});
  const kinds = grazingEntryAlerts(data, {parcelIds: ['pre1', 'pre2', 'ble'], date: TODAY, endDate: TODAY}).map(a => `${a.parcelId}:${a.kind}`);
  assert.ok(kinds.includes('pre1:occupied') && kinds.includes('pre2:rest') && kinds.includes('ble:forage') && kinds.includes(':oneday'), kinds.join());
  // Avant l'entrée du lot A, le pré n'était pas occupé : le contrôle suit la date saisie et la sortie.
  assert.ok(!grazingEntryAlerts(data, {parcelIds: ['pre1'], date: shift(-10), endDate: shift(-5)}).some(a => a.kind === 'occupied'));
  // Sortie le jour où le lot A entre : simple rotation, pas d'occupation.
  assert.ok(!grazingEntryAlerts(data, {parcelIds: ['pre1'], date: shift(-10), endDate: shift(-3)}).some(a => a.kind === 'occupied'));
  assert.ok(!grazingEntryAlerts(data, {parcelIds: ['pre1'], date: TODAY, ignoreId: 'L1'}).some(a => a.kind === 'occupied'));
  // Heure fixée : traitement fini à 00 h 01, délai minimal de 6 h, entrée à 1 h.
  const treated = farm({interventions: [{id: 'w', parcelId: 'pre1', type: 'Traitement', status: 'Terminé', date: TODAY, endTime: '00:01', product: 'Fongi', isPhytosanitary: true}]}), now = new Date(`${TODAY}T01:00:00`).getTime();
  assert.ok(grazingEntryAlerts(treated, {parcelIds: ['pre1'], date: TODAY, now}).some(a => a.kind === 'reentry' && a.parcelId === 'pre1'));
  assert.ok(!grazingEntryAlerts(treated, {parcelIds: ['pre1'], date: TODAY, now, withReentry: false}).some(a => a.kind === 'reentry'));
});

test('prés : prairies en tête même sous « Toutes », statut par ligne, destinations élargies sur demande', () => {
  const data = farm({grazingSessions: [{id: 'L1', parcelId: 'pre1', note: 'Lot A', startDate: shift(-3), endDate: null, additionalAnimalsCount: 5, animalsCount: 5}]});
  const rows = grazingParcelRows(data, {type: 'Pâturage', today: TODAY, filter: 'all', selected: ['ble']});
  assert.deepEqual(rows.map(r => r.parcel.id), ['pre1', 'pre2', 'ble']);
  assert.match(rows[0].status, /occupé par lot a/);
  assert.equal(moveDestinations(data, {today: TODAY}).some(r => r.parcel.id === 'ble'), false);
  assert.equal(moveDestinations(data, {today: TODAY, all: true}).some(r => r.parcel.id === 'ble'), true);
});

test('gestes : sans lot, directement la mise au pré ; le lot du pré choisi vient d’abord', () => {
  assert.equal(grazingGestures(farm(), {today: TODAY}).skipToEntry, true);
  const data = farm({grazingSessions: [{id: 'L1', parcelId: 'pre1', startDate: shift(-9), additionalAnimalsCount: 1, animalsCount: 1}, {id: 'L2', parcelId: 'pre2', startDate: shift(-1), additionalAnimalsCount: 1, animalsCount: 1}]});
  const ways = grazingGestures(data, {today: TODAY, parcelIds: ['pre2']});
  assert.deepEqual(ways.hereIds, ['L2']);
  assert.equal(ways.lots[0].id, 'L2');
});

test('sortie à une autre date : le lot demandé est présélectionné, un lot déjà sorti est ignoré', () => {
  const data = farm({grazingSessions: [{id: 'L1', parcelId: 'pre1', startDate: shift(-9), additionalAnimalsCount: 1, animalsCount: 1}, {id: 'L2', parcelId: 'pre2', startDate: shift(-1), additionalAnimalsCount: 1, animalsCount: 1},
    {id: 'L3', parcelId: 'pre1', startDate: shift(-20), endDate: shift(-5), additionalAnimalsCount: 1, animalsCount: 1}]});
  assert.deepEqual(grazingGestures(data, {today: TODAY, exitIds: ['L1']}).exitIds, ['L1']);
  assert.deepEqual(grazingGestures(data, {today: TODAY, parcelIds: ['pre2'], exitIds: ['L3']}).exitIds, ['L2']);
  assert.deepEqual(grazingGestures(data, {today: TODAY, exitIds: ['L3']}).exitIds, []);
  assert.deepEqual(grazingGestures(data, {today: TODAY, parcelIds: ['pre1']}).exitIds, ['L1']);
  // Lot demandé déjà sorti : on ne coche pas à sa place le seul autre lot au pré.
  const one = farm({grazingSessions: [{id: 'L1', parcelId: 'pre1', startDate: shift(-9), additionalAnimalsCount: 1, animalsCount: 1}]});
  assert.deepEqual(grazingGestures(one, {today: TODAY, exitIds: ['L9']}).exitIds, []);
  assert.deepEqual(grazingGestures(one, {today: TODAY}).exitIds, ['L1']);
});

test('date future : travail à faire avec l’effectif en note, aucun passage', () => {
  const works = plannedGrazingWorks(entry({lotName: 'Lot 1'}), farm(), {type: 'Pâturage', date: shift(3), today: TODAY});
  assert.equal(works.length, 1);
  assert.equal(works[0].status, 'À faire');
  assert.equal(works[0].plannedDate, shift(3));
  assert.match(works[0].note, /24 animaux.*Lot 1/);
});

test('clôture : seulement le vrai pâturage prévu, jamais clôture ni troupeau', () => {
  const data = farm({
    interventions: [{id: 'w1', parcelId: 'pre1', type: 'Réparer clôture', status: 'À faire', date: TODAY, plannedDate: TODAY}, {id: 'w2', parcelId: 'pre1', type: 'Pâturage', status: 'À faire', date: TODAY, plannedDate: TODAY}],
    tasks: [{id: 't1', parcelId: 'pre1', title: 'Réparer la clôture', dueDate: TODAY, status: 'À faire'}, {id: 't2', parcelId: 'pre1', title: 'Vérifier abreuvoir', dueDate: TODAY, status: 'À faire'},
      {id: 't3', parcelId: 'pre1', title: 'Vermifuger le troupeau', dueDate: TODAY, status: 'À faire'}, {id: 't4', parcelId: 'pre1', title: 'Pâturage Pré Bas', dueDate: TODAY, status: 'À faire'}]});
  const closing = closingCandidates(data, {type: 'Pâturage', parcelIds: ['pre1'], date: TODAY, today: TODAY});
  assert.deepEqual(closing.works.map(w => w.id), ['w2']);
  assert.deepEqual(closing.tasks.map(t => t.id), ['t4']);
  assert.deepEqual(closing.looseTasks, []);
  assert.deepEqual(plannedToday(data, {type: 'Pâturage', today: TODAY}).tasks.map(t => t.id), ['t4']);
  const closes = grazingClosings(data, {closing, date: TODAY, skip: ['t4']});
  assert.deepEqual(closes.works.map(w => [w.id, w.status]), [['w2', 'Terminé']]);
  assert.deepEqual(closes.tasks, []);
  assert.deepEqual(closingCandidates(data, {type: 'Pâturage', parcelIds: ['pre1'], date: shift(1), today: TODAY}).works, []);
});

test('tuile : épinglée avec Élevage malgré l’historique, retirée sans Élevage sauf si vient de l’historique', () => {
  const works = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((type, i) => ({id: `w${i}`, parcelId: 'pre1', type, status: 'Terminé', date: TODAY}));
  const tile = data => orderedWorkTypes(data, {today: TODAY}).top.map(t => t.type);
  assert.ok(tile(farm({interventions: works})).includes('Pâturage'));
  const many = Array.from({length: 45}, (_, i) => ({id: `m${i}`, parcelId: 'pre1', type: `Type ${i}`, status: 'Terminé', date: TODAY}));
  const all = orderedWorkTypes(farm({interventions: many}), {today: TODAY});
  assert.ok(all.top.some(t => t.type === 'Pâturage') && [...all.top, ...all.more].some(t => t.type === 'Semis'));
  const crops = {preferences: {activeModules: ['crops']}};
  assert.ok(![...orderedWorkTypes(farm(crops), {today: TODAY}).top, ...orderedWorkTypes(farm(crops), {today: TODAY}).more].some(t => t.type === 'Pâturage'));
  assert.ok(tile(farm({...crops, interventions: [{id: 'h', parcelId: 'pre1', type: 'Pâturage', status: 'Terminé', date: TODAY}]})).includes('Pâturage'));
});

test('échec en route : suppression des passages écrits, ou reprise du reste sans droit de suppression', async () => {
  const bad = {parcelId: 'absent', animalType: 'Bovins', animalCategory: null, startDate: TODAY, endDate: null, animals: [], additionalAnimalsCount: 1, note: ''};
  const good = {...bad, parcelId: 'pre1'};
  const owner = await storeWith(farm());
  await assert.rejects(saveGrazingEntries(owner, [good, bad]));
  assert.equal(owner.state.grazingSessions.filter(s => !s.deletedAt).length, 0);
  const op = await storeWith(farm());
  op.setWriteGuard(operation => canMutate('operator', operation));
  const failure = await saveGrazingEntries(op, [good, bad]).catch(error => error);
  assert.equal(failure.saved.length, 1);
  assert.deepEqual(failure.remaining, [bad]);
  assert.equal(op.state.grazingSessions.filter(s => !s.deletedAt).length, 1);
  const again = await saveGrazingEntries(op, [good]);
  assert.equal(again.length, 1);
});

test('opérateur terrain : crée, modifie et déplace un passage, sans suppression', async () => {
  assert.equal(canMutate('operator', {entity: 'grazingSessions', action: 'create'}), true);
  assert.equal(canMutate('operator', {entity: 'grazingSessions', action: 'update'}), true);
  assert.equal(canMutate('operator', {entity: 'grazingSessions', action: 'delete'}), false);
  assert.equal(canMutate('viewer', {entity: 'grazingSessions', action: 'create'}), false);
  assert.equal(canMutate('accountant', {entity: 'grazingSessions', action: 'create'}), false);
  assert.ok(roleScope('operator').entities.includes('grazingSessions'));
  const store = await storeWith(farm());
  store.setWriteGuard(operation => canMutate('operator', operation));
  const [first] = await saveGrazingEntries(store, buildGrazingEntries(entry(), store.state, {today: TODAY, date: shift(-2)}).entries);
  const moved = await moveGrazingLot(store, first, 'pre2', {date: TODAY});
  assert.equal(moved.animalCategory, 'vache-laitiere', 'la catégorie suit le lot');
  await assert.rejects(store.remove('grazingSessions', moved.id));
  // Même règle que herdOperatorDoc (firestore.rules) : aucun passage supprimé, écrit ou restauré.
  assert.equal(canMutate('operator', {entity: 'grazingSessions', action: 'update', record: {deletedAt: '2026-01-01'}}), false);
  assert.equal(canMutate('operator', {entity: 'grazingSessions', action: 'update', payload: {id: 'x', deletedAt: null}, previous: {deletedAt: '2026-01-01'}}), false);
  store.setWriteGuard(null); await store.remove('grazingSessions', moved.id);
  store.setWriteGuard(operation => canMutate('operator', operation));
  await assert.rejects(store.restore('grazingSessions', moved.id));
  store.setWriteGuard(null); await store.restore('grazingSessions', moved.id);
  assert.ok(store.get('grazingSessions', moved.id), 'la gestion peut restaurer');
});

test('animal sorti encore dans un lot : écart signalé, passage clos et rouvert sans lui, lot vide clos', async () => {
  const animal = {id: 'a1', nationalId: 'FR0000000001', name: 'Rose', exitDate: shift(-1), exitReason: 'Vente'};
  const other = {number: 'FR0000000002', name: '', gestation: false};
  const lot = {id: 'L', parcelId: 'pre1', animalType: 'Bovins', animalCategory: 'vache-laitiere', note: 'Lot', startDate: shift(-10), endDate: null, animals: [{number: 'FR0000000001', name: 'Rose', animalId: 'a1', gestation: false}, other], additionalAnimalsCount: 3, animalsCount: 5};
  const store = await storeWith(farm({animals: [animal], grazingSessions: [lot]}));
  assert.deepEqual(exitedInLot(store.state, lot, {today: TODAY}).map(a => a.id), ['a1']);
  assert.deepEqual(lotsListing(store.state, animal, {today: TODAY}).map(s => s.id), ['L']);
  const next = await removeAnimalFromLot(store, 'L', animal, {date: shift(-1)});
  assert.equal(store.get('grazingSessions', 'L').endDate, shift(-1));
  assert.deepEqual([next.startDate, next.animalsCount, next.animalCategory, next.note], [shift(-1), 4, 'vache-laitiere', 'Lot']);
  assert.equal(next.animals.some(x => x.animalId === 'a1'), false);
  const solo = await storeWith(farm({animals: [animal], grazingSessions: [{...lot, animals: [lot.animals[0]], additionalAnimalsCount: 0, animalsCount: 1}]}));
  await removeAnimalFromLot(solo, 'L', animal, {date: shift(-1)});
  assert.equal(solo.state.grazingSessions.filter(s => !s.endDate).length, 0);
});

test('animal sorti d’un lot à sortie prévue : le passage rouvert garde la sortie prévue (n° 160)', async () => {
  const animal = {id: 'a1', nationalId: 'FR0000000001', name: 'Rose', exitDate: shift(-1), exitReason: 'Vente'};
  const lot = {id: 'L', parcelId: 'pre1', animalType: 'Bovins', animalCategory: 'vache-laitiere', note: 'Lot', startDate: shift(-10), endDate: shift(7),
    animals: [{number: 'FR0000000001', name: 'Rose', animalId: 'a1', gestation: false}], additionalAnimalsCount: 3, animalsCount: 4};
  const store = await storeWith(farm({animals: [animal], grazingSessions: [lot]}));
  const next = await removeAnimalFromLot(store, 'L', animal, {date: shift(-1)});
  assert.equal(store.get('grazingSessions', 'L').endDate, shift(-1));
  assert.deepEqual([next.startDate, next.endDate, next.animalsCount], [shift(-1), shift(7), 3]);
});

test('lot ouvert anormalement longtemps : rappel, « Toujours là » le suspend 30 jours', () => {
  const session = {id: 'L', parcelId: 'pre1', note: 'Oublié', startDate: shift(-70), additionalAnimalsCount: 5, animalsCount: 5};
  assert.equal(longOpenLots(farm({grazingSessions: [session]}), {date: TODAY}).length, 1);
  assert.match(longOpenLots(farm({grazingSessions: [session]}), {date: TODAY})[0].label, /encore ouvert depuis 70 jours/);
  assert.equal(longOpenLots(farm({grazingSessions: [{...session, startDate: shift(-5)}]}), {date: TODAY, threshold: 60}).filter(l => l.days < 60 && shift(-5).slice(0, 4) === TODAY.slice(0, 4)).length, 0);
  assert.equal(longOpenLots(farm({grazingSessions: [session], preferences: {grazingStillThere: {L: shift(-5)}}}), {date: TODAY}).length, 0);
  assert.equal(longOpenLots(farm({grazingSessions: [session], preferences: {grazingStillThere: {L: shift(-40)}}}), {date: TODAY}).length, 1);
  assert.equal(longOpenLots(farm({grazingSessions: [{...session, endDate: shift(-1)}]}), {date: TODAY}).length, 0);
  // Accusé synchronisé, porté par le passage ; le plus récent des deux accusés compte.
  assert.equal(longOpenLots(farm({grazingSessions: [{...session, stillThereAt: shift(-5)}]}), {date: TODAY}).length, 0);
  assert.equal(longOpenLots(farm({grazingSessions: [{...session, stillThereAt: shift(-40)}], preferences: {grazingStillThere: {L: shift(-5)}}}), {date: TODAY}).length, 0);
  assert.equal(longOpenLots(farm({grazingSessions: [{...session, stillThereAt: shift(-40)}]}), {date: TODAY}).length, 1);
});

test('lot ouvert : pas de rappel le 1er janvier pour une entrée de fin décembre (n° 160)', () => {
  const lot = start => farm({grazingSessions: [{id: 'L', parcelId: 'pre1', note: 'Hiver', startDate: start, additionalAnimalsCount: 5, animalsCount: 5}]});
  assert.equal(longOpenLots(lot('2026-12-28'), {date: '2027-01-01'}).length, 0, '4 jours : pas de rappel');
  assert.equal(longOpenLots(lot('2026-12-03'), {date: '2027-01-01'}).length, 0, '29 jours : pas encore');
  assert.equal(longOpenLots(lot('2026-12-02'), {date: '2027-01-01'}).length, 1, '30 jours et changement d’année : rappel');
  assert.equal(longOpenLots(lot('2026-11-25'), {date: '2027-01-01'}).length, 1, '37 jours et changement d’année : rappel');
  assert.equal(longOpenLots(lot('2026-11-25'), {date: '2026-12-31'}).length, 0, 'même année, sous le seuil');
});

test('brouillon : la saisie d’animaux survit en données simples, un autre travail n’en porte pas', () => {
  const saisie = entry({lotName: 'Lot 1', picks: {a1: {line: 0, parcelId: 'pre1'}}, alloc: {0: {pre1: '24'}}, rotate: true, numbers: 'FR1'});
  const fields = JSON.parse(JSON.stringify(draftFields({type: 'Pâturage', parcelIds: ['pre1'], step: 3, grazing: {entry: saisie, screen: 'details', workId: 'w1'}})));
  assert.deepEqual(fields.grazing, {entry: JSON.parse(JSON.stringify(saisie)), screen: 'details', workId: 'w1'});
  assert.equal('grazing' in draftFields({type: 'Semis', parcelIds: ['p1'], step: 3}), false);
});

test('export : la catégorie figure en fin de colonnes de paturage.csv', () => {
  const table = readableTables(farm({grazingSessions: [{id: 'L', parcelId: 'pre1', animalType: 'Bovins', animalCategory: 'veau', animalsCount: 3, startDate: TODAY}]})).find(t => t.file === 'paturage.csv');
  const last = table.columns.at(-1);
  assert.equal(last[0], 'Catégorie');
  assert.equal(last[1](table.rows[0]), 'Veau (moins de 1 an)');
});

test('entrée rétroactive qui recouvre un passage plus récent du même pré : occupation signalée', () => {
  const data = farm({grazingSessions: [{id: 'g0', parcelId: 'pre1', note: 'Génisses', startDate: '2026-08-27', endDate: '2026-09-26', additionalAnimalsCount: 5, animalsCount: 5}]});
  const now = new Date('2026-11-05T12:00:00').getTime();
  const open = grazingEntryAlerts(data, {parcelIds: ['pre1'], date: '2026-08-01', now}).filter(a => a.kind === 'occupied');
  assert.equal(open.length, 1);
  assert.match(open[0].message, /déjà occupé du 27\/08\/2026 au 26\/09\/2026 par Génisses/);
  assert.ok(grazingEntryAlerts(data, {parcelIds: ['pre1'], date: '2026-08-01', endDate: '2026-09-01', now}).some(a => a.kind === 'occupied'));
  assert.ok(!grazingEntryAlerts(data, {parcelIds: ['pre1'], date: '2026-08-01', endDate: '2026-08-20', now}).some(a => a.kind === 'occupied'));
  assert.ok(grazingEntryAlerts(data, {parcelIds: ['pre1'], date: '2026-09-01', now}).some(a => a.kind === 'occupied'));
});

test('animal rattaché par sa fiche à un lot sans liste : mis au pré ailleurs, le lot d’origine perd une tête (n° 160)', () => {
  const J = shift(0), lot = {id: 'g1', parcelId: 'pre1', animalType: 'Vaches', startDate: shift(-30), endDate: null, animals: [], additionalAnimalsCount: 0, animalsCount: 24};
  const animals = [{id: 'm', nationalId: 'FR1234567890', name: 'Marguerite', sex: 'F', sessionId: 'g1'}, {id: 'b', nationalId: 'FR1234567891', name: 'Bella', sex: 'F', sessionId: 'g1'}];
  const data = farm({animals, grazingSessions: [lot]});
  const item = {number: 'FR1234567890', name: 'Marguerite', animalId: 'm', gestation: false};
  const plan = planLotMoves(data, [item], {date: J, today: J});
  assert.deepEqual(plan.updates.map(r => [r.id, r.endDate]), [['g1', J]]);
  assert.deepEqual(plan.creates.map(r => [r.additionalAnimalsCount, r.animalsCount]), [[23, 23]]);
  // Deux animaux notés : deux têtes en moins, jamais une seule.
  const two = planLotMoves(data, [item, {number: 'FR1234567891', name: 'Bella', animalId: 'b', gestation: false}], {date: J, today: J});
  assert.equal(two.creates[0].animalsCount, 22);
  // Lot ouvert le jour même : effectif corrigé, sans nouveau passage.
  const same = planLotMoves(farm({animals, grazingSessions: [{...lot, startDate: J}]}), [item], {date: J, today: J});
  assert.deepEqual(same.updates.map(r => [r.id, r.animalsCount, r.endDate]), [['g1', 23, null]]);
  assert.deepEqual(same.creates, []);
});

test('lot sans liste déplacé ou fractionné : l’animal rattaché par sa fiche suit le passage actuel (n° 160)', async () => {
  const lot = {id: 'g1', parcelId: 'pre1', animalType: 'Vaches', note: '', startDate: shift(-30), endDate: null, animals: [], additionalAnimalsCount: 0, animalsCount: 24};
  const animal = {id: 'm', nationalId: 'FR1234567890', name: 'Marguerite', sex: 'F', sessionId: 'g1'};
  const store = await storeWith(farm({animals: [animal], grazingSessions: [lot]}));
  const moved = await moveGrazingLot(store, store.get('grazingSessions', 'g1'), 'pre2', {date: TODAY});
  assert.equal(animalLot(store.state, animal, {today: TODAY})?.id, moved.id);
  assert.deepEqual(animalsInside(store.state, {today: TODAY}).map(a => a.id), []);
  // Lot fractionné sur le même pré (effectif changé) : suivi aussi.
  const split = farm({animals: [animal], grazingSessions: [{...lot, endDate: shift(-1)}, {...lot, id: 'g2', startDate: shift(-1), additionalAnimalsCount: 23, animalsCount: 23}]});
  assert.equal(animalLot(split, animal, {today: TODAY})?.id, 'g2');
});

test('lot fractionné sur le même pré : présence continue depuis la première entrée ; déplacé ailleurs, Jour 1', () => {
  const a = {id: 'a', parcelId: 'pre1', note: 'Taries', animalType: 'Bovins', startDate: shift(-1), endDate: TODAY, animals: [{number: 'FR1', animalId: 'x'}, {number: 'FR2', animalId: 'y'}], additionalAnimalsCount: 0, animalsCount: 2};
  const b = {...a, id: 'b2', startDate: TODAY, endDate: null, animals: [{number: 'FR2', animalId: 'y'}], animalsCount: 1};
  const lots = herdLots(farm({grazingSessions: [a, b]}), {today: TODAY});
  assert.deepEqual(lots.map(l => [l.id, l.startDate, l.days]), [['b2', shift(-1), 2]]);
  const ailleurs = herdLots(farm({grazingSessions: [a, {...b, parcelId: 'pre2'}]}), {today: TODAY});
  assert.deepEqual(ailleurs.map(l => [l.startDate, l.days]), [[TODAY, 1]]);
});
