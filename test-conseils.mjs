// I2 — Veille agronomique quotidienne (conseils.js) : règles R1 à R8, avec une date du jour fixe.
import test from 'node:test';
import assert from 'node:assert/strict';
import {farmAdvice, overdueLevel, SOWING_LIMITS, ADVICE_FAMILIES} from './conseils.js';
import {computeNotifications} from './notifications.js';
import {explainNotification} from './explain-model.js';

const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const rules = (list, rule) => list.filter(a => a.rule === rule);

function darState({treatmentStatus = 'Terminé', harvest = '2026-07-14', sheet = true} = {}) {
  return {
    parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre'}],
    stockItems: sheet ? [{id: 's1', name: 'Prosaro', phyto: {dar: 35}}] : [],
    interventions: [
      {id: 't1', parcelId: 'p1', type: 'Traitement fongicide', product: 'Prosaro', status: treatmentStatus, date: '2026-06-28'},
      {id: 'h1', parcelId: 'p1', type: 'Récolte', status: 'À faire', plannedDate: harvest}
    ]
  };
}

test('état vide : aucun conseil', () => {
  assert.deepEqual(farmAdvice({}, {today: '2026-07-10'}), []);
  assert.deepEqual(farmAdvice({parcelles: [], interventions: [], animals: []}, {today: '2026-07-10'}), []);
});

test('tables exportées', () => {
  assert.equal(SOWING_LIMITS['colza'], '09-15');
  assert.ok(ADVICE_FAMILIES.pailles && ADVICE_FAMILIES.maisGrain && ADVICE_FAMILIES.sclerotinia);
});

test('R1 : récolte prévue dans le DAR d’un traitement terminé', () => {
  const [a] = rules(farmAdvice(darState(), {today: '2026-07-10'}), 'R1');
  assert.ok(a);
  assert.equal(a.id, 'advice-R1-h1');
  assert.equal(a.level, 'urgent');
  assert.match(a.message, /Les Brosses : récolte prévue le 14\/07, mais Prosaro \(traité le 28\/06\) impose 35 j avant récolte, jusqu’au 02\/08\. Décalez la récolte de 19 jours/);
  assert.deepEqual(a.action, {type: 'postpone-work', label: 'Décaler la récolte', id: 'h1'});
  assert.equal(rules(farmAdvice(darState(), {today: '2026-06-30'}), 'R1')[0].level, 'warning', 'à plus de 7 jours : warning');
  assert.equal(rules(farmAdvice(darState({harvest: '2026-08-03'}), {today: '2026-07-10'}), 'R1').length, 0);
  assert.equal(rules(farmAdvice(darState({treatmentStatus: 'Annulé'}), {today: '2026-07-10'}), 'R1').length, 0);
  assert.equal(rules(farmAdvice(darState({sheet: false}), {today: '2026-07-10'}), 'R1').length, 0);
});

function ppfState(plannedDose) {
  return {
    parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 10}],
    rotations: [{id: 'r1', parcelId: 'p1', campaignId: '2025/26', culture: 'Blé tendre', ppf: {yieldTarget: 80, rsh: 20}}],
    interventions: [
      {id: 'f1', parcelId: 'p1', type: 'Apport azote', product: 'Ammonitrate', dose: 120, doseUnit: 'kg N/ha', status: 'Terminé', date: '2026-02-15'},
      {id: 'f2', parcelId: 'p1', type: 'Apport azote', product: 'Ammonitrate', dose: plannedDose, doseUnit: 'kg N/ha', status: 'À faire', plannedDate: '2026-04-15'}
    ]
  };
}

test('R3A : azote réalisé + prévu au-delà du PPF', () => {
  const [a] = rules(farmAdvice(ppfState(90), {today: '2026-03-01'}), 'R3A');
  assert.ok(a);
  assert.equal(a.level, 'warning');
  assert.equal(a.entity, 'parcelles');
  assert.equal(a.message, 'Blé tendre, Les Brosses : 210 kg N efficace/ha prévus et réalisés pour 180 au PPF (+30). Réduisez le dernier apport du 15/04 d’environ 30 kg N/ha.');
  assert.equal(a.action.id, 'f2');
  assert.equal(rules(farmAdvice(ppfState(60), {today: '2026-03-01'}), 'R3A').length, 0);
  // Composition inconnue : non comptée, mais signalée.
  const s = ppfState(90);
  s.interventions.push({id: 'f3', parcelId: 'p1', type: 'Apport engrais', product: 'Mystère', dose: 200, doseUnit: 'kg/ha', status: 'Terminé', date: '2026-02-20'});
  const [b] = rules(farmAdvice(s, {today: '2026-03-01'}), 'R3A');
  assert.ok(b.message.includes('210 kg N'));
  assert.ok(b.why.some(x => x.includes('Composition inconnue pour Mystère')));
});

function banState(zone) {
  return {
    parcelles: [{id: 'p2', nom: 'Pré du bas', culture: 'Maïs', zoneVulnerable: zone}],
    interventions: [{id: 'l1', parcelId: 'p2', type: 'Épandage lisier', product: 'Lisier', status: 'À faire', plannedDate: '2026-06-25'}]
  };
}

test('R3B : apport de type II non fait, période d’interdiction commencée', () => {
  const [a] = rules(farmAdvice(banState(true), {today: '2026-07-02'}), 'R3B');
  assert.ok(a);
  assert.equal(a.level, 'urgent');
  assert.match(a.message, /^Lisier prévu le 25\/06 sur Pré du bas, non fait : l’épandage de type II est interdit du 01\/07 au 31\/01/);
  assert.equal(rules(farmAdvice(banState(false), {today: '2026-07-02'}), 'R3B').length, 0);
});

function rotationState(history, current) {
  return {
    parcelles: [{id: 'p1', nom: 'Les Brosses', culture: current}],
    rotations: history.map(([campaignId, culture], i) => ({id: `r${i}`, parcelId: 'p1', campaignId, culture}))
  };
}

test('R4 : successions à risque', () => {
  const today = '2026-10-01';
  const a = rules(farmAdvice(rotationState([['2025/26', 'Maïs grain']], 'Blé tendre'), {today}), 'R4A');
  assert.equal(a.length, 1);
  assert.match(a[0].message, /fusariose et de DON/);
  assert.ok(a[0].why.some(x => x.includes('Arvalis')));
  assert.equal(rules(farmAdvice(rotationState([['2025/26', 'Maïs ensilage']], 'Blé tendre'), {today}), 'R4A').length, 0);
  const b = rules(farmAdvice(rotationState([['2024/25', 'Blé tendre'], ['2025/26', 'Orge d’hiver']], 'Blé tendre'), {today}), 'R4B');
  assert.equal(b.length, 1);
  assert.match(b[0].message, /pas de tête d’assolement depuis 3 ans/);
  const c = rules(farmAdvice(rotationState([['2024/25', 'Colza']], 'Tournesol'), {today}), 'R4C');
  assert.equal(c.length, 1);
  assert.ok(c[0].why.some(x => x.includes('Terres Inovia')));
  // rotationAlerts signale déjà colza sur colza : une seule ligne.
  const d = rules(farmAdvice(rotationState([['2024/25', 'Colza']], 'Colza'), {today}), 'R4C');
  assert.equal(d.length, 1);
  assert.ok(d[0].why.some(x => x.includes('délai conseillé')));
  assert.equal(rules(farmAdvice(rotationState([['2022/23', 'Colza']], 'Tournesol'), {today}), 'R4C').length, 0);
});

function herdState({breed = 'Montbéliarde', service = '2026-03-25', calving = false, lot = false} = {}) {
  return {
    animals: [{id: 'a1', nationalId: 'FR4512345678', name: 'Marguerite', breed, sex: 'F'}],
    animalEvents: [{id: 'e1', animalId: 'a1', kind: 'insemination', date: service},
      ...(calving ? [{id: 'e2', animalId: 'a1', kind: 'calving', date: calving}] : [])],
    grazingSessions: lot ? [{id: 'g1', startDate: '2026-10-01', note: 'Vaches', animals: [{animalId: 'a1', number: 'FR4512345678', name: 'Marguerite'}]}] : []
  };
}

test('R6 : tarissement, case de vêlage, vêlage dépassé', () => {
  const today = '2026-10-30';
  const [a] = rules(farmAdvice(herdState(), {today}), 'R6A');
  assert.ok(a);
  assert.equal(a.message, 'FR4512345678 (Marguerite, Montbéliarde) : vêlage prévu le 02/01, tarissement conseillé vers le 03/11.');
  assert.equal(a.entity, 'animals');
  assert.equal(rules(farmAdvice(herdState({breed: 'Charolaise'}), {today}), 'R6A').length, 0);
  const near = addDays(addDays(today, 12), -283);
  const [b] = rules(farmAdvice(herdState({breed: 'Charolaise', service: near, lot: true}), {today}), 'R6B');
  assert.ok(b);
  assert.match(b.message, /Rentrez-la en case de vêlage/);
  assert.equal(rules(farmAdvice(herdState({breed: 'Charolaise', service: near}), {today}), 'R6B').length, 0, 'pas au pré');
  const late = addDays(addDays(today, -12), -283);
  const [c] = rules(farmAdvice(herdState({breed: 'Charolaise', service: late}), {today}), 'R6C');
  assert.equal(c.level, 'urgent');
  assert.match(c.message, /Vêlage dépassé de 12 jours : vérifiez la gestation/i);
  assert.equal(rules(farmAdvice(herdState({breed: 'Charolaise', service: late, calving: addDays(today, -5)}), {today}), 'R6C').length, 0);
});

function exitState({exitDate = '2026-11-14', reason = 'Boucherie', lot = false} = {}) {
  return {
    animals: [{id: 'a1', nationalId: 'FR4512345678', name: 'Rosette', sex: 'F', exitReason: reason, exitDate}],
    grazingSessions: [{id: 'g1', startDate: '2026-10-01', animals: [{animalId: 'a1', number: 'FR4512345678'}]}],
    vetTreatments: [lot
      ? {id: 'v1', kind: 'treatment', sessionId: 'g1', lotLabel: 'Vaches', date: '2026-11-05', medicine: 'Oxytétracycline', meatUntil: '2026-12-03'}
      : {id: 'v1', kind: 'treatment', animalId: 'a1', date: '2026-11-05', medicine: 'Oxytétracycline', meatUntil: '2026-12-03', milkUntil: '2026-12-20'}]
  };
}

test('R7 : sortie pendant le délai d’attente viande', () => {
  const today = '2026-11-12';
  const [a] = rules(farmAdvice(exitState(), {today}), 'R7');
  assert.ok(a);
  assert.equal(a.level, 'urgent');
  assert.equal(a.message, 'FR4512345678 : sortie Boucherie le 14/11, mais traitement Oxytétracycline du 05/11 : attente viande jusqu’au 03/12 inclus. Décalez la sortie de 20 jours, au 04/12 au plus tôt.');
  assert.equal(rules(farmAdvice(exitState({exitDate: '2026-12-04'}), {today}), 'R7').length, 0);
  assert.equal(rules(farmAdvice(exitState({lot: true}), {today}), 'R7')[0].level, 'urgent');
  assert.equal(rules(farmAdvice(exitState({reason: 'Mort'}), {today}), 'R7').length, 0);
});

test('R8 : retards reclassés', () => {
  const broyage = {id: 'w1', parcelId: 'p1', type: 'Broyage', status: 'À faire', plannedDate: '2026-11-17'};
  const state = {parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre'}], interventions: [broyage]};
  const r = overdueLevel(state, broyage, {today: '2026-11-20'});
  assert.equal(r.level, 'warning');
  assert.equal(r.rule, 'R8');
  assert.ok(r.why[0].includes('En retard de 3 jours'));
  const semis = {id: 'w2', parcelId: 'p1', type: 'Semis', culture: 'Blé tendre', status: 'À faire', plannedDate: '2026-10-20'};
  const s = overdueLevel({...state, interventions: [semis]}, semis, {today: '2026-11-20'});
  assert.equal(s.level, 'urgent');
  assert.ok(s.why[0].includes('changer de culture ou de variété'.replace('changer', 'Changer')));
  assert.equal(overdueLevel({...state, interventions: [semis]}, semis, {today: '2026-11-10'}).level, 'warning');
  // Traitement en retard dont le DAR déborde sur une récolte prévue.
  const d = darState();
  const late = {id: 't2', parcelId: 'p1', type: 'Traitement fongicide', product: 'Prosaro', status: 'À faire', plannedDate: '2026-07-01'};
  d.interventions.push(late);
  assert.equal(overdueLevel(d, late, {today: '2026-07-05'}).level, 'urgent');
  // Fertilisation en retard en période d’interdiction.
  const b = banState(true);
  assert.equal(overdueLevel(b, b.interventions[0], {today: '2026-07-02'}).level, 'urgent');
});

test('notifications : conseils ajoutés, work-overdue garde son identifiant', () => {
  const state = {
    ...darState(),
    interventions: [...darState().interventions, {id: 'w1', parcelId: 'p1', type: 'Broyage', status: 'À faire', plannedDate: '2026-07-07'}],
    preferences: {}, metadata: {}
  };
  const rows = computeNotifications(state, {today: '2026-07-10'});
  const overdue = rows.find(r => r.id === 'work-overdue-w1');
  assert.ok(overdue);
  assert.equal(overdue.level, 'warning');
  assert.ok(Array.isArray(overdue.why));
  const advice = rows.find(r => r.id === 'advice-R1-h1');
  assert.ok(advice && advice.level === 'urgent' && advice.entity === 'interventions' && advice.why.length);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'aucun doublon');
  const why = explainNotification(state, 'advice-R1-h1', {today: '2026-07-10'});
  assert.equal(why.value, 'Récolte dans le délai avant récolte');
  assert.ok(why.why.some(x => x.includes('délai avant récolte de 35 j')));
  assert.equal(why.rule.action, 'postpone-work');
  const late = explainNotification(state, 'work-overdue-w1', {today: '2026-07-10'});
  assert.ok(late.why.some(x => x.includes('En retard de 3 jours')));
});

// Relecture adverse I2 : cas limites corrigés.
test('R7 : sortie le dernier jour du délai (meatUntil inclus) et lot hors période', () => {
  const today = '2026-11-12';
  const [a] = rules(farmAdvice(exitState({exitDate: '2026-12-03'}), {today}), 'R7');
  assert.ok(a, 'meatUntil est le dernier jour interdit : une sortie ce jour-là reste signalée');
  assert.match(a.message, /Décalez la sortie de 1 jour, au 04\/12 au plus tôt/);
  // Lot entré au pré après le soin : l’animal n’y était pas à la date du traitement.
  const s = exitState({lot: true});
  s.grazingSessions[0].startDate = '2026-11-08';
  assert.equal(rules(farmAdvice(s, {today}), 'R7').length, 0);
  const ended = exitState({lot: true});
  ended.grazingSessions[0].endDate = '2026-11-01';
  assert.equal(rules(farmAdvice(ended, {today}), 'R7').length, 0);
});

test('R8 : un libellé qui cite le semis sans en être un reste en warning', () => {
  const state = {parcelles: [{id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre'}]};
  for (const type of ['Désherbage post-semis', 'Roulage après semis']) {
    const w = {id: 'w9', parcelId: 'p1', type, status: 'À faire', plannedDate: '2026-10-20'};
    assert.equal(overdueLevel({...state, interventions: [w]}, w, {today: '2026-11-20'}).level, 'warning', type);
  }
  const semis = {id: 'w8', parcelId: 'p1', type: 'Semis blé', status: 'À faire', plannedDate: '2026-10-20'};
  assert.equal(overdueLevel({...state, interventions: [semis]}, semis, {today: '2026-11-20'}).level, 'urgent');
});

test('R1 : deux traitements en conflit, une seule ligne stable par récolte', () => {
  const s = darState();
  s.stockItems.push({id: 's2', name: 'Opus', phyto: {dar: 20}});
  s.interventions.push({id: 't0', parcelId: 'p1', type: 'Traitement fongicide', product: 'Opus', status: 'Terminé', date: '2026-07-01'});
  const list = rules(farmAdvice(s, {today: '2026-07-10'}), 'R1');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'advice-R1-h1');
  assert.match(list[0].message, /Prosaro .* jusqu’au 02\/08/);
  assert.ok(list[0].why.some(x => x.includes('Autre traitement en conflit : Opus')));
});

test('notifications : un apport en période d’interdiction ne donne qu’une ligne', () => {
  const state = {...banState(true), preferences: {}, metadata: {}};
  const rows = computeNotifications(state, {today: '2026-07-02'});
  assert.equal(rows.filter(r => r.entityId === 'l1').length, 1);
  const late = rows.find(r => r.id === 'work-overdue-l1');
  assert.equal(late.level, 'urgent');
  assert.match(late.why[0], /Annulez ou reportez/);
});

test('R1 : délai qui traverse le passage à l’heure d’hiver (fuseau Europe/Paris)', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  try {
    const s = darState({harvest: '2026-11-04'});
    s.interventions[0].date = '2026-10-01';
    const [a] = rules(farmAdvice(s, {today: '2026-11-01'}), 'R1');
    assert.ok(a);
    assert.match(a.message, /jusqu’au 05\/11\. Décalez la récolte de 1 jour /);
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});
