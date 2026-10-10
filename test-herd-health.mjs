// n° 76 — carnet sanitaire d’élevage (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTreatment,withdrawalEnd,activeWithdrawals,healthReminders,registerRows,registerPdfBlocks,herdHealthComplianceChecks,RETENTION_YEARS} from './herd-health.js';
import {emptyState,migrateData} from './state.js';
import {ENTITY_TYPES} from './utils.js';
import {complianceChecks} from './compliance.js';

const lot = {id: 'g1', parcelId: 'p3', animalType: 'Vaches', animalsCount: 24, startDate: '2026-09-20', note: 'Lot vaches'};
const farm = (vetTreatments = []) => ({...emptyState(), grazingSessions: [lot], vetTreatments});

test('collection vetTreatments : état vide, migration défensive des anciennes sauvegardes', () => {
  assert.ok(ENTITY_TYPES.includes('vetTreatments'));
  assert.deepEqual(emptyState().vetTreatments, []);
  const old = migrateData({version: 16, parcelles: []});
  assert.deepEqual(old.vetTreatments, []);
  assert.equal(migrateData({...emptyState(), vetTreatments: 'x'}).vetTreatments.length, 0);
});

test('soin : validation, lot, délais d’attente viande et lait', () => {
  const t = normalizeTreatment({date: '2026-10-04', sessionId: 'g1', animalCount: '3', medicine: 'Antibio', withdrawalMeatDays: '10', withdrawalMilkDays: '4', route: 'Orale', prescriptionNumber: 'ORD-1'}, {state: farm()});
  assert.equal(t.animalCount, 3); assert.equal(t.lotLabel, 'Lot vaches'); assert.equal(t.parcelId, 'p3');
  assert.equal(t.meatUntil, '2026-10-14'); assert.equal(t.milkUntil, '2026-10-08');
  assert.equal(normalizeTreatment({date: '2026-10-04', sessionId: 'g1', medicine: 'X'}, {state: farm()}).animalCount, 24); // tout le lot
  assert.equal(normalizeTreatment({date: '2026-10-04', animal: 'FR12', medicine: 'X'}, {state: farm()}).animalCount, 1);
  assert.throws(() => normalizeTreatment({date: '2026-10-04', sessionId: 'g1'}, {state: farm()}), /médicament/);
  assert.throws(() => normalizeTreatment({date: '2026-10-04', medicine: 'X'}, {state: farm()}), /lot ou le nombre/);
  assert.throws(() => normalizeTreatment({date: '2026-10-04', sessionId: 'g1', medicine: 'X', withdrawalMeatDays: '-2'}, {state: farm()}), /jours positifs/);
  assert.equal(withdrawalEnd('2026-10-04', 0), null);
});

test('bandeau : bovins sous délai d’attente, lait à écarter, délais échus ignorés', () => {
  const s = farm([
    {id: 'v1', kind: 'treatment', date: '2026-10-04', lotLabel: 'Lot vaches', species: 'Vaches', animalCount: 3, medicine: 'A', withdrawalMeatDays: 10, withdrawalMilkDays: 4},
    {id: 'v2', kind: 'treatment', date: '2026-08-01', species: 'Vaches', animalCount: 5, medicine: 'B', withdrawalMeatDays: 10}]);
  const w = activeWithdrawals(s, {today: '2026-10-10'});
  assert.equal(w.meatCount, 3);
  assert.equal(w.messages[0], '3 bovins sous délai d’attente jusqu’au 14/10, ne pas vendre ni abattre');
  assert.equal(w.milkCount, 0); // lait jusqu’au 08/10 : échu
  assert.equal(activeWithdrawals(s, {today: '2026-10-07'}).messages[1], 'Lait de 3 animaux à écarter jusqu’au 08/10');
  assert.equal(activeWithdrawals(s, {today: '2026-10-15'}).active, false);
});

test('rappels : prophylaxie annuelle et visite sanitaire biennale', () => {
  const r = healthReminders(farm([{id: 'p', kind: 'prophylaxis', date: '2025-09-01'}, {id: 'v', kind: 'visit', date: '2025-03-01'}]), {today: '2026-10-10'});
  assert.equal(r.find(x => x.kind === 'prophylaxis').status, 'late');
  assert.equal(r.find(x => x.kind === 'visit').status, 'ok');
  assert.equal(healthReminders(farm(), {today: '2026-10-10'})[0].status, 'unknown');
  assert.deepEqual(healthReminders({...emptyState()}, {today: '2026-10-10'}), []);
});

test('registre annuel, PDF et conservation (aucune purge)', () => {
  const s = farm([{id: 'a', kind: 'treatment', date: '2021-02-01', medicine: 'Ancien', animalCount: 1}, {id: 'b', kind: 'treatment', date: '2026-10-04', medicine: 'Récent', animalCount: 2, meatUntil: '2026-10-14'}]);
  assert.deepEqual(registerRows(s, '2026').map(r => r.id), ['b']);
  assert.deepEqual(registerRows(s, '2021').map(r => r.id), ['a']);
  const blocks = registerPdfBlocks(s, '2026', {today: '2026-10-10'});
  assert.match(blocks[0].text, /Registre sanitaire d’élevage 2026/);
  assert.equal(blocks.find(b => b.type === 'table').rows[0][9], '14/10/2026');
  assert.ok(blocks.some(b => new RegExp(`${RETENTION_YEARS} ans`).test(b.text || '')));
});

test('conformité : entrée du carnet sanitaire au tableau', () => {
  const none = herdHealthComplianceChecks({...emptyState()});
  assert.equal(none[0].status, 'na');
  const c = herdHealthComplianceChecks(farm([{id: 'b', kind: 'treatment', date: '2026-10-04', medicine: 'X', animalCount: 2, withdrawalMeatDays: null, withdrawalMilkDays: null}]), {today: '2026-10-10'});
  assert.equal(c[0].status, 'warn'); assert.equal(c[0].action.type, 'herdHealth');
  assert.ok(complianceChecks(farm(), {today: '2026-10-10'}).some(x => x.id === 'herd-health'));
});
