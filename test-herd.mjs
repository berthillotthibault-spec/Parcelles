// n° 79 — Troupeau bovin : identification, vêlages, rappel BDNI, migration, import CSV et rôles (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeNationalId,isValidNationalId,formatNationalId,workNumber,parseSex,normalizeAnimal,normalizeAnimalEvent,calvingPlan,animalLot,filterAnimals,animalTreatments,animalTimeline,dailyGain,
  grazingCandidates,candidatesToAnimals,readHerdCsv,guessColumns,herdImportPreview,herdImportEntities,bdniTaskTitle,strictDate,BDNI_NOTICE,IMPORT_SOURCE} from './herd.js';
import {expectedCalvingDate,expectedCalvings,pendingBdni,bdniDeadline,addIsoDays,localDay,GESTATION_DAYS} from './home-priorities.js';
import {emptyState,migrateData} from './state.js';
import {APP_VERSION,ENTITY_TYPES} from './utils.js';
import {canMutate,roleScope} from './permissions.js';
import {computeNotifications} from './notifications.js';
import {complianceChecks} from './compliance.js';
import {homeLayout,HOME_CARDS} from './personalization.js';
import {isToolVisible} from './activity-modules.js';
import {encodeCloudPayload} from './sync.js';

const TODAY = '2026-10-20';
const lot = {id: 'g1', parcelId: 'p1', animalType: 'Bovins', startDate: '2026-09-01', note: 'Lot vaches', animals: [{number: 'FR 01 2345 6789', gestation: true}, {number: 'Marguerite'}]};
const cow = {id: 'a1', nationalId: 'FR0123456789', name: 'Belle', sex: 'F', breed: 'Charolaise', birthDate: '2020-03-01'};
const bull = {id: 'a2', nationalId: 'FR0123450000', name: 'Titan', sex: 'M', birthDate: '2019-01-01'};
const farm = (extra = {}) => ({...emptyState(), grazingSessions: [lot], animals: [cow, bull], ...extra});

test('numéro national : FR + 10 chiffres, espaces tolérés, format contrôlé', () => {
  assert.equal(normalizeNationalId('fr 01 2345 6789'), 'FR0123456789');
  assert.equal(normalizeNationalId('0123456789'), 'FR0123456789', '10 chiffres seuls : préfixe FR');
  assert.equal(normalizeNationalId('FR-01.2345.6789'), 'FR0123456789');
  for (const bad of ['FR123', 'FR01234567890', 'BE0123456789', 'FR01234A6789', '']) assert.equal(isValidNationalId(bad), false, bad);
  assert.equal(isValidNationalId('FR0123456789'), true);
  assert.equal(formatNationalId('FR0123456789'), 'FR 01 2345 6789');
  assert.equal(workNumber('FR0123456789'), '6789');
  assert.deepEqual(['F', 'femelle', '2', 'M', 'Mâle', '1', 'x'].map(parseSex), ['F', 'F', 'F', 'M', 'M', 'M', '']);
  assert.equal(strictDate('03/12/2024'), '2024-12-03', 'jour/mois/année, jamais le format américain');
  assert.equal(strictDate('2024-02-30'), null);
});

test('fiche animal : validation, doublon, mère, entrée et sortie', () => {
  const s = farm();
  const a = normalizeAnimal({nationalId: 'FR 11 2222 3333', name: ' Rose ', sex: 'Femelle', birthDate: '2024-03-02', motherId: 'a1', entryReason: 'Naissance'}, {state: s, today: TODAY});
  assert.equal(a.nationalId, 'FR1122223333'); assert.equal(a.name, 'Rose'); assert.equal(a.sex, 'F');
  assert.equal(a.motherNationalId, 'FR0123456789'); assert.equal(a.entryDate, '2024-03-02', 'entrée = naissance par défaut');
  assert.throws(() => normalizeAnimal({nationalId: 'FR12'}, {state: s}), /FR suivi de 10 chiffres/);
  assert.throws(() => normalizeAnimal({nationalId: 'FR0123456789'}, {state: s, id: 'autre'}), /déjà attribué à Belle/);
  assert.doesNotThrow(() => normalizeAnimal({nationalId: 'FR0123456789', name: 'Belle'}, {state: s, id: 'a1', today: TODAY}), 'sa propre fiche');
  assert.throws(() => normalizeAnimal({name: 'X', motherId: 'a2'}, {state: s}), /mâle/);
  assert.throws(() => normalizeAnimal({name: 'X', motherId: 'a1', birthDate: '2019-01-01'}, {state: s, today: TODAY}), /née avant/);
  assert.throws(() => normalizeAnimal({name: 'X', sex: 'chat'}, {state: s}), /Sexe invalide/);
  assert.throws(() => normalizeAnimal({name: 'X', birthDate: '2027-01-01'}, {state: s, today: TODAY}), /futur/);
  assert.throws(() => normalizeAnimal({name: 'X', exitDate: '2026-01-01'}, {state: s, today: TODAY}), /motif de sortie/);
  assert.throws(() => normalizeAnimal({name: 'X', entryDate: '2026-02-01', exitDate: '2026-01-01', exitReason: 'Vente'}, {state: s, today: TODAY}), /postérieure/);
  assert.throws(() => normalizeAnimal({}, {state: s}), /numéro national ou un nom/);
});

test('insémination : vêlage prévu à J+283, visible dans les vêlages à venir', () => {
  assert.equal(GESTATION_DAYS, 283);
  assert.equal(expectedCalvingDate('2026-01-10'), '2026-10-20');
  assert.equal(expectedCalvingDate('2024-05-01'), '2025-02-08', 'année bissextile traversée');
  const ia = normalizeAnimalEvent({animalId: 'a1', kind: 'insemination', date: '2026-01-15', sire: 'Taureau IA'}, {state: farm(), today: TODAY});
  assert.equal(ia.expectedCalvingDate, '2026-10-25');
  assert.throws(() => normalizeAnimalEvent({animalId: 'a2', kind: 'mating', date: '2026-01-15'}, {state: farm(), today: TODAY}), /femelle/);
  assert.throws(() => normalizeAnimalEvent({animalId: 'a1', kind: 'weighing', date: '2026-01-15', weightKg: '-3'}, {state: farm(), today: TODAY}), /Poids/);
  assert.equal(normalizeAnimalEvent({animalId: 'a1', kind: 'weighing', date: '2026-01-15', weightKg: '612,5'}, {state: farm(), today: TODAY}).weightKg, 612.5);
  const s = farm({animalEvents: [{id: 'e0', animalId: 'a1', kind: 'insemination', date: '2025-11-01'}, {id: 'e1', ...ia}]});
  const rows = expectedCalvings(s, {today: TODAY});
  assert.equal(rows.length, 1, 'seule la dernière insémination compte');
  assert.equal(rows[0].date, '2026-10-25'); assert.equal(rows[0].days, 5); assert.equal(rows[0].label, 'Belle · n° 6789');
  // Un vêlage enregistré après l’insémination ferme l’attente ; une sortie aussi.
  assert.equal(expectedCalvings({...s, animalEvents: [...s.animalEvents, {id: 'c', animalId: 'a1', kind: 'calving', date: '2026-10-18'}]}, {today: TODAY}).length, 0);
  assert.equal(expectedCalvings({...s, animals: [{...cow, exitDate: '2026-10-01', exitReason: 'Vente'}]}, {today: TODAY}).length, 0);
  assert.equal(expectedCalvings(s, {today: '2026-06-01', horizon: 45}).length, 0, 'hors horizon');
});

const ids = {event: 'ev1', calf: 'calf1', task: 'task1'};
test('vêlage : veau prérempli (mère, naissance, lot) et tâche BDNI à J+7 avec rappel à J+5', () => {
  const s = farm();
  const {event, calf, task} = calvingPlan({animalId: 'a1', date: '2026-10-18', calfSex: 'M', calfNationalId: 'FR0123459999', birthWeightKg: '45'}, {state: s, today: TODAY, ids});
  assert.equal(calf.motherId, 'a1'); assert.equal(calf.birthDate, '2026-10-18'); assert.equal(calf.origin, 'birth');
  assert.equal(calf.sessionId, 'g1', 'lot de la mère (numéro listé dans le lot)'); assert.equal(calf.breed, 'Charolaise'); assert.equal(calf.entryReason, 'Naissance');
  assert.equal(event.kind, 'calving'); assert.equal(event.calfId, 'calf1'); assert.equal(event.bdniTaskId, 'task1'); assert.equal(event.birthWeightKg, 45);
  assert.equal(bdniDeadline('2026-10-18'), '2026-10-25');
  assert.equal(task.dueDate, '2026-10-25'); assert.equal(task.remindOn, '2026-10-23'); assert.equal(task.kind, 'bdni');
  assert.equal(task.title, 'Notifier la naissance de n° 9999 à l’EDE/BDNI avant le 25/10');
  assert.equal(bdniTaskTitle('2026-12-28'), 'Notifier la naissance à l’EDE/BDNI avant le 04/01');
  assert.match(task.note, /ne notifie pas la BDNI/); assert.equal(task.note, BDNI_NOTICE);
  assert.equal(task.parcelId, 'p1');
  assert.throws(() => calvingPlan({animalId: 'a2', date: '2026-10-18'}, {state: s, today: TODAY, ids}), /femelle/);
  assert.throws(() => calvingPlan({animalId: 'a1', date: '2026-10-30'}, {state: s, today: TODAY, ids}), /futur/);
  assert.throws(() => calvingPlan({animalId: 'a1', date: '2026-10-18', calfNationalId: 'FR0123456789'}, {state: s, today: TODAY, ids}), /déjà attribué/);
  const twice = farm({animalEvents: [event]});
  assert.throws(() => calvingPlan({animalId: 'a1', date: '2026-10-18'}, {state: twice, today: TODAY, ids}), /déjà enregistré/);
  // Veau sans numéro : nom provisoire, titre sans numéro.
  const anonymous = calvingPlan({animalId: 'a1', date: '2026-10-18'}, {state: s, today: TODAY, ids});
  assert.equal(anonymous.calf.name, 'Veau de Belle · n° 6789'); assert.equal(anonymous.calf.nationalId, '');
});

test('échéance BDNI : en attente, rappel à J+5, retard après J+7, fermée par la case « notifié » ou la tâche', () => {
  const plan = calvingPlan({animalId: 'a1', date: '2026-10-10'}, {state: farm(), today: TODAY, ids});
  const s = farm({animals: [cow, bull, plan.calf], animalEvents: [plan.event], tasks: [plan.task]});
  assert.equal(pendingBdni(s, '2026-10-12')[0].status, 'pending');
  assert.equal(pendingBdni(s, '2026-10-15')[0].status, 'remind');
  assert.equal(pendingBdni(s, '2026-10-17')[0].status, 'remind', 'J+7 : encore dans le délai');
  assert.equal(pendingBdni(s, '2026-10-18')[0].status, 'late');
  assert.equal(pendingBdni({...s, animalEvents: [{...plan.event, bdniNotifiedAt: 1}]}, TODAY).length, 0);
  assert.equal(pendingBdni({...s, tasks: [{...plan.task, status: 'Terminé'}]}, TODAY).length, 0);
  // Rappel de tâche (remindOn) dans « À surveiller » : à partir de J+5, avant l’échéance J+7.
  const now = localDay(), remind = (remindOn, dueDate) => computeNotifications({...s, tasks: [{...plan.task, remindOn, dueDate}]}).filter(n => n.entityId === 'task1').map(n => n.id.replace(/-task1$/, ''));
  assert.deepEqual(remind(addIsoDays(now, -1), addIsoDays(now, 2)), ['task-remind']);
  assert.deepEqual(remind(addIsoDays(now, 1), addIsoDays(now, 3)), [], 'pas avant J+5');
  assert.deepEqual(remind(addIsoDays(now, -3), now), ['task-today'], 'le jour de l’échéance, la tâche du jour suffit');
});

test('lot de pâturage ↔ animaux : identifiant, numéro, lot noté ; filtres et recherche', () => {
  const s = farm({animals: [cow, bull, {id: 'a3', name: 'Rose', sex: 'F', sessionId: 'g1'}, {id: 'a4', name: 'Vendue', sex: 'F', exitDate: '2026-05-01', exitReason: 'Vente'}]});
  assert.equal(animalLot(s, cow, {today: TODAY})?.id, 'g1', 'numéro listé dans le lot');
  assert.equal(animalLot(s, bull, {today: TODAY}), null);
  assert.equal(animalLot({...s, grazingSessions: [{...lot, animals: [{number: 'X', animalId: 'a2'}]}]}, bull, {today: TODAY})?.id, 'g1', 'animal choisi dans le troupeau');
  assert.equal(animalLot(s, s.animals[2], {today: TODAY})?.id, 'g1', 'lot noté sur la fiche');
  assert.equal(animalLot({...s, grazingSessions: [{...lot, endDate: '2026-10-01'}]}, s.animals[2], {today: TODAY}), null, 'lot terminé');
  assert.deepEqual(filterAnimals(s, {today: TODAY}).map(a => a.id), ['a1', 'a3', 'a2']);
  assert.deepEqual(filterAnimals(s, {status: 'exited', today: TODAY}).map(a => a.id), ['a4']);
  assert.deepEqual(filterAnimals(s, {sex: 'M', today: TODAY}).map(a => a.id), ['a2']);
  assert.deepEqual(filterAnimals(s, {query: '6789', today: TODAY}).map(a => a.id), ['a1']);
  assert.deepEqual(filterAnimals(s, {query: 'fr 01 2345 6789', today: TODAY}).map(a => a.id), ['a1']);
  assert.deepEqual(filterAnimals(s, {sessionId: 'g1', today: TODAY}).map(a => a.id), ['a1', 'a3']);
});

test('fiche : soins du carnet sanitaire, naissance, pesées et GMQ', () => {
  const s = farm({vetTreatments: [{id: 't1', kind: 'treatment', date: '2026-09-01', animal: 'FR0123456789', medicine: 'Antibio'}, {id: 't2', kind: 'treatment', date: '2026-09-02', animal: '6789', medicine: 'Vermifuge'}, {id: 't3', kind: 'treatment', date: '2026-09-03', animal: 'Titan', medicine: 'Autre'}],
    animalEvents: [{id: 'w1', animalId: 'a1', kind: 'weighing', date: '2026-06-01', weightKg: 600}, {id: 'w2', animalId: 'a1', kind: 'weighing', date: '2026-07-01', weightKg: 630}]});
  assert.deepEqual(animalTreatments(s, cow).map(t => t.id), ['t2', 't1']);
  assert.deepEqual(animalTimeline(s, cow).map(r => r.type), ['treatment', 'treatment', 'weighing', 'weighing']);
  assert.equal(dailyGain(s, 'a1'), 1000);
});

test('migration v18 : collections vides, aucun animal créé depuis les lots ; reprise explicite proposée', () => {
  assert.equal(APP_VERSION, 18);
  for (const k of ['animals', 'animalEvents']) { assert.ok(ENTITY_TYPES.includes(k)); assert.deepEqual(emptyState()[k], []); }
  const old = migrateData({version: 17, grazingSessions: [lot], parcelles: []});
  assert.equal(old.version, 18); assert.deepEqual(old.animals, []); assert.deepEqual(old.animalEvents, []);
  assert.deepEqual(old.grazingSessions[0].animals, lot.animals, 'lots inchangés');
  assert.deepEqual(migrateData(old), old, 'idempotent');
  assert.equal(migrateData({...emptyState(), animals: 'x'}).animals.length, 0);
  // Proposition de reprise : seuls les numéros nationaux valides, sans doublon avec le troupeau.
  const s = {...emptyState(), grazingSessions: [lot, {...lot, id: 'g0', startDate: '2026-01-01', endDate: '2026-02-01', animals: [{number: 'FR0123456789'}, {number: 'FR9999999999'}]}]};
  const c = grazingCandidates(s);
  assert.deepEqual(c.map(x => x.nationalId), ['FR0123456789', 'FR9999999999']);
  assert.equal(c[0].sessionId, 'g1'); assert.equal(c[0].gestation, true);
  const entities = candidatesToAnimals(c, {today: TODAY});
  assert.equal(entities[0].sex, 'F', 'gestante → femelle'); assert.equal(entities[0].sessionId, 'g1'); assert.equal(entities[1].sessionId, null, 'lot terminé');
  assert.equal(entities[0].source, 'grazing'); assert.equal(entities[0].sourceId, 'FR0123456789'); assert.equal(entities[0].origin, 'grazing');
  assert.equal(grazingCandidates({...s, animals: [cow]}).length, 1, 'déjà au troupeau');
});

test('fixture de sauvegarde v18 : troupeau relu sans perte', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/backups/v18-actuelle.json', import.meta.url), 'utf8'));
  const m = migrateData(raw.data);
  assert.equal(m.animals.length, 2); assert.equal(m.animalEvents[0].expectedCalvingDate, '2026-10-20');
  assert.equal(m.tasks[0].remindOn, '2026-10-15');
});

test('import CSV de l’inventaire : colonnes, aperçu, dédoublonnage par numéro, mères reliées', () => {
  const csv = '﻿Numéro national;Nom;Sexe;Race;Date de naissance;N° mère\nFR 01 2345 6789;Belle;2;Charolaise;01/03/2020;\nFR1122223333;Rose;F;Charolaise;02/03/2024;FR0123456789\nFR1122223333;Rose bis;F;;;\nFR12;X;F;;;\nFR4455556666;Petit;1;;2024-13-01;\nFR7777777777;Veau;M;;15/04/2025;FR1122223333\n';
  const {headers, rows} = readHerdCsv(csv);
  assert.equal(rows.length, 6);
  const map = guessColumns(headers);
  assert.deepEqual(map, {nationalId: 'Numéro national', name: 'Nom', sex: 'Sexe', breed: 'Race', birthDate: 'Date de naissance', motherNationalId: 'N° mère'});
  const s = farm();
  const p = herdImportPreview(s, rows, map, {today: TODAY});
  assert.deepEqual([p.create, p.update, p.skip], [2, 1, 3]);
  assert.deepEqual(p.rows.map(r => r.action), ['update', 'create', 'skip', 'skip', 'skip', 'create']);
  assert.match(p.rows[2].reason, /double/); assert.match(p.rows[3].reason, /invalide/); assert.match(p.rows[4].reason, /naissance invalide/);
  assert.equal(p.rows[1].value.birthDate, '2024-03-02');
  assert.equal(herdImportPreview(s, rows, {...map, nationalId: ''}).error, 'Choisissez la colonne du numéro national.');
  let n = 0;
  const writes = herdImportEntities(s, p, {newId: () => `imp${++n}`, today: TODAY});
  assert.equal(writes.length, 3);
  const [belle, rose, veau] = writes;
  assert.equal(belle.id, 'a1', 'mise à jour de la fiche existante'); assert.equal(belle.name, 'Belle'); assert.equal(belle.createdAt, cow.createdAt);
  assert.equal(rose.source, IMPORT_SOURCE); assert.equal(rose.sourceId, 'FR1122223333'); assert.equal(rose.motherId, 'a1'); assert.equal(rose.origin, 'import');
  assert.equal(veau.motherId, 'imp1', 'mère présente dans le même fichier'); assert.equal(veau.sex, 'M');
  // Réimport du même fichier : plus aucune création (dédoublonnage par numéro).
  const again = herdImportPreview({...s, animals: [...s.animals.filter(a => a.id !== 'a1'), ...writes]}, rows, map, {today: TODAY});
  assert.equal(again.create, 0); assert.equal(again.update, 3);
});

test('rôles : l’opérateur enregistre vêlage et pesée, la suppression reste aux rôles qui suppriment', () => {
  const op = (entity, action, record, previous = null) => canMutate('operator', {entity, action, payload: record, record, previous});
  assert.equal(op('animalEvents', 'create', {kind: 'calving', animalId: 'a1'}), true);
  assert.equal(op('animalEvents', 'create', {kind: 'weighing', animalId: 'a1'}), true);
  assert.equal(op('animalEvents', 'create', {kind: 'insemination', animalId: 'a1'}), false);
  assert.equal(op('animals', 'create', {origin: 'birth', name: 'Veau'}), true);
  assert.equal(op('animals', 'update', {origin: 'birth'}, {origin: 'import'}), false, 'pas de réécriture d’une fiche importée');
  assert.equal(op('animals', 'create', {origin: 'import'}), false);
  assert.equal(op('animals', 'delete', {origin: 'birth'}), false);
  assert.equal(op('animalEvents', 'update', {kind: 'calving', deletedAt: 5}), false, 'pas de mise en corbeille par l’opérateur');
  assert.equal(op('animalEvents', 'update', {kind: 'weighing'}, {kind: 'insemination'}), false, 'pas de détournement d’une insémination');
  for (const role of ['owner', 'manager', 'editor']) { assert.equal(canMutate(role, {entity: 'animals', action: 'delete'}), true, role); assert.equal(canMutate(role, {entity: 'animalEvents', action: 'create', payload: {kind: 'insemination'}}), true); }
  for (const role of ['accountant', 'viewer']) assert.equal(canMutate(role, {entity: 'animals', action: 'create', payload: {origin: 'birth'}}), false, role);
  assert.equal(canMutate('operator', {entity: 'tasks', action: 'create'}), true, 'tâche BDNI');
  assert.ok(roleScope('operator').entities.includes('animalEvents'));
  const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function herdOperatorDoc[\s\S]*'animalEvents' && d\.payload\.get\('kind', ''\) in \['calving','weighing'\][\s\S]*'animals' && d\.payload\.get\('origin', ''\) == 'birth'/);
});

test('transport cloud : un animal et un vêlage passent par encodeCloudPayload sans tableau imbriqué', () => {
  const plan = calvingPlan({animalId: 'a1', date: '2026-10-18'}, {state: farm(), today: TODAY, ids});
  for (const doc of [plan.calf, plan.event, plan.task]) assert.deepEqual(encodeCloudPayload(doc), doc, 'aucun champ à encoder');
});

test('accueil et Plus : carte « Vêlages à venir » désactivable, écran Troupeau lié au module Élevage', () => {
  assert.ok(HOME_CARDS.some(c => c.id === 'calvings'));
  assert.ok(homeLayout({homeCards: ['weather'], homeCardOrder: ['weather', 'today', 'tasks', 'alerts', 'recent', 'campaign']}).homeCards.includes('calvings'), 'nouvelle carte affichée une première fois');
  assert.equal(homeLayout({homeCards: ['weather'], homeCardOrder: HOME_CARDS.map(c => c.id)}).homeCards.includes('calvings'), false, 'désactivée par la personnalisation');
  assert.ok(emptyState().preferences.homeCards.includes('calvings'));
  assert.equal(isToolVisible('open-herd', ['crops']), false);
  assert.equal(isToolVisible('open-herd', ['livestock']), true);
});

test('conformité BDNI : naissances non notifiées signalées, jamais déclaré à jour', () => {
  const plan = calvingPlan({animalId: 'a1', date: '2026-10-01'}, {state: farm(), today: TODAY, ids});
  const s = farm({animals: [cow, bull, plan.calf], animalEvents: [plan.event], tasks: [plan.task]});
  const c = complianceChecks(s, {today: TODAY}).find(x => x.id === 'bdni');
  assert.equal(c.status, 'warn'); assert.equal(c.items.length, 1); assert.match(c.items[0].note, /08\/10/);
  const done = complianceChecks({...s, animalEvents: [{...plan.event, bdniNotifiedAt: 1}]}, {today: TODAY}).find(x => x.id === 'bdni');
  assert.equal(done.status, 'unknown');
});

test('écran et branchements : module différé, CORE, actions, aucune notification BDNI envoyée', () => {
  const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  const sw = read('sw.js'), lazy = read('lazy-modules.js'), app = read('app.js'), ui = read('herd-ui.js');
  for (const f of ['./herd.js', './herd-ui.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(lazy, /herd: \(\) => import\('\.\/herd-ui\.js'\)/);
  assert.match(app, /lazy\.onLoad\('herd'/);
  assert.match(ui, /BDNI_NOTICE/);
  assert.doesNotMatch(ui + read('herd.js'), /fetch\(|XMLHttpRequest|sendBeacon/, 'aucun envoi vers la BDNI');
});

test('lot de pâturage : choisir un animal du troupeau, le retirer de l’ancien lot', async () => {
  const {lotAssignment} = await import('./herd.js');
  const {linkGrazingAnimals} = await import('./grazing.js');
  const other = {id: 'g2', parcelId: 'p2', startDate: '2026-09-01', animals: []};
  const s = farm({grazingSessions: [lot, other]});
  const moved = lotAssignment(s, cow, 'g2', {today: TODAY});
  assert.deepEqual(moved.map(x => x.id).sort(), ['g1', 'g2']);
  assert.deepEqual(moved.find(x => x.id === 'g1').animals.map(a => a.number), ['Marguerite'], 'retiré de l’ancien lot');
  assert.deepEqual(moved.find(x => x.id === 'g2').animals, [{number: 'FR0123456789', name: 'Belle', animalId: 'a1', gestation: true}], 'gestation reprise de l’ancien lot');
  assert.deepEqual(lotAssignment(s, cow, null, {today: TODAY}).map(x => x.id), ['g1'], 'aucun lot');
  assert.throws(() => lotAssignment({...s, grazingSessions: [{...other, animals: 'FR1\nFR2'}]}, cow, 'g2', {today: TODAY}), /texte libre/);
  assert.deepEqual(linkGrazingAnimals([{number: 'fr 0123456789', gestation: true}, {number: 'X'}, {number: '0123456789'}], [cow]), [{number: 'fr 0123456789', gestation: true, animalId: 'a1', name: 'Belle'}, {number: 'X'}, {number: '0123456789', animalId: 'a1', name: 'Belle'}]);
});
test('lot de pâturage : numéro saisi sans FR reconnu, gestation conservée au changement de lot', async () => {
  const {lotAssignment} = await import('./herd.js');
  const {nationalIdKey} = await import('./grazing.js');
  const old = {id: 'gA', parcelId: 'p1', startDate: '2026-09-01', animals: [{number: '0123456789', gestation: true}]};
  const next = {id: 'gB', parcelId: 'p2', startDate: '2026-09-01', animals: []};
  const s = farm({grazingSessions: [old, next], vetTreatments: [{id: 'v1', date: '2026-10-01', animal: '0123456789'}]});
  assert.equal(animalLot(s, cow, {today: TODAY})?.id, 'gA', 'numéro sans FR');
  assert.deepEqual(filterAnimals(s, {sessionId: 'gA', today: TODAY}).map(a => a.id), ['a1']);
  assert.deepEqual(animalTreatments(s, cow).map(t => t.id), ['v1']);
  const moved = lotAssignment(s, cow, 'gB', {today: TODAY});
  assert.deepEqual(moved.find(x => x.id === 'gA').animals, [], 'retiré de l’ancien lot');
  assert.equal(moved.find(x => x.id === 'gB').animals[0].gestation, true, 'gestation reprise');
  assert.equal(nationalIdKey('01 2345 6789'), nationalIdKey('FR0123456789'));
});
