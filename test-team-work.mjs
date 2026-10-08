// n° 114 — Consignes aux salariés : attribution, « Mes tâches du jour », pointage et feuille d’heures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMine, myAgenda, knownPeople, assignPatch, unassignPatch, startPunch, finishPunch, runningEntry, punchedHours,
  timesheet, timesheetCsv, weekStart, weekDays, formatHours, laborCostCandidates, applyLaborCost, normalizeName
} from './team-work.js';

const at = (day, hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();
const TODAY = '2026-10-07';
const base = () => ({
  parcelles: [{id: 'p1', nom: 'Grand Pré'}, {id: 'p2', nom: 'Les Noues'}],
  interventions: [
    {id: 'w1', parcelId: 'p1', type: 'Déchaumage', status: 'À faire', plannedDate: TODAY, assigneeName: 'Paul', instructions: 'Commencer par le bas'},
    {id: 'w2', parcelId: 'p2', type: 'Semis', status: 'À faire', plannedDate: '2026-10-09', assigneeName: 'paul '},
    {id: 'w3', parcelId: 'p2', type: 'Labour', status: 'À faire', plannedDate: '2026-10-05', assigneeName: 'Paul'},
    {id: 'w4', parcelId: 'p1', type: 'Roulage', status: 'Terminé', date: TODAY, assigneeName: 'Paul'},
    {id: 'w5', parcelId: 'p1', type: 'Broyage', status: 'À faire', plannedDate: TODAY, assigneeName: 'Marie', operator: 'Jean'},
    {id: 'w6', parcelId: 'p1', type: 'Fauche', status: 'À faire', plannedDate: TODAY, assigneeName: 'Paul', deletedAt: 3},
    {id: 'w7', parcelId: 'p1', type: 'Andainage', status: 'En cours', plannedDate: '2026-10-06', assigneeId: 'uid-paul', assigneeName: 'Paul D.'}
  ],
  tasks: [{id: 't1', title: 'Réparer clôture', dueDate: '', status: 'À faire', assigneeName: 'Paul'}]
});

test('isMine : par nom (sans casse ni accent) ou par compte cloud', () => {
  assert.ok(isMine({assigneeName: 'Paul '}, {name: 'paul'}));
  assert.ok(isMine({assigneeName: 'Hélène'}, {name: 'helene'}));
  assert.ok(isMine({assigneeId: 'u1', assigneeName: 'X'}, {name: '', uid: 'u1'}));
  assert.ok(!isMine({assigneeName: 'Paul'}, {name: ''}));
  assert.ok(!isMine({}, {name: 'Paul'}));
  assert.equal(normalizeName('  Élodie  Martin '), 'elodie martin');
});

test('myAgenda : en cours, en retard, du jour, sans date, terminé aujourd’hui ; ni futur ni corbeille', () => {
  const rows = myAgenda(base(), {name: 'Paul', uid: 'uid-paul'}, TODAY);
  assert.deepEqual(rows.map(r => r.item.id), ['w7', 'w3', 'w1', 't1', 'w4']);
  assert.deepEqual(rows.map(r => r.state), ['running', 'todo', 'todo', 'todo', 'done']);
  assert.equal(rows[1].overdue, true);
  assert.equal(myAgenda(base(), {name: 'Marie'}, TODAY).length, 1);
  assert.equal(myAgenda(base(), {name: ''}, TODAY).length, 0);
});

test('knownPeople : membres cloud, personnes désignées et opérateurs, sans doublon', () => {
  const people = knownPeople(base(), {members: [{id: 'uid-m', email: 'marie@ferme.fr'}], identity: 'Thibault'});
  const names = people.map(p => p.name);
  assert.equal(names[0], 'Paul');
  assert.ok(names.includes('marie') || names.includes('Marie'));
  assert.equal(names.filter(n => normalizeName(n) === 'paul').length, 1);
  assert.ok(names.includes('Jean') && names.includes('Thibault'));
  assert.equal(people.find(p => normalizeName(p.name) === 'marie').id, 'uid-m');
});

test('assignPatch / unassignPatch : champs optionnels, nom obligatoire', () => {
  const w = assignPatch({id: 'x', type: 'Labour'}, {name: '  Paul  ', instructions: ' Attention fossé ', by: 'Thibault', now: 5});
  assert.equal(w.assigneeName, 'Paul');
  assert.equal(w.instructions, 'Attention fossé');
  assert.equal(w.assignedAt, 5);
  assert.equal(w.assignedBy, 'Thibault');
  assert.equal(w.type, 'Labour');
  assert.throws(() => assignPatch({}, {name: ' '}), /Champ obligatoire : personne/);
  const u = unassignPatch(w);
  assert.equal(u.assigneeName, '');
  assert.equal(u.instructions, 'Attention fossé', 'la consigne reste');
});

test('startPunch puis finishPunch : horodatage, statut, durée reportée, échéance conservée', () => {
  const item = base().interventions[0];
  const started = startPunch(item, {name: 'Paul'}, at(TODAY, 8, 0));
  assert.equal(started.status, 'En cours');
  assert.equal(started.timeLog.length, 1);
  assert.ok(runningEntry(started, {name: 'paul'}));
  assert.throws(() => startPunch(started, {name: 'Paul'}, at(TODAY, 8, 5)), /déjà démarré/);
  assert.throws(() => startPunch(item, {name: ''}), /qui vous êtes/);
  const {item: done, hours} = finishPunch(started, {name: 'Paul'}, {kind: 'work', now: at(TODAY, 9, 30), today: TODAY});
  assert.equal(hours, 1.5);
  assert.equal(done.status, 'Terminé');
  assert.equal(done.date, TODAY);
  assert.equal(done.plannedDate, TODAY);
  assert.equal(done.duration, 1.5);
  assert.equal(done.operator, 'Paul');
  assert.equal(runningEntry(done), null);
  assert.equal(item.timeLog, undefined, 'l’original n’est pas modifié');
  const kept = finishPunch({...started, duration: 3, operator: 'Jean'}, {name: 'Paul'}, {now: at(TODAY, 9, 0)}).item;
  assert.equal(kept.duration, 3, 'durée saisie conservée');
  assert.equal(kept.operator, 'Jean');
  const task = finishPunch(startPunch({id: 't', title: 'Clôture', status: 'À faire'}, {name: 'Paul'}, at(TODAY, 10)), {name: 'Paul'}, {kind: 'task', now: at(TODAY, 10, 45)});
  assert.equal(task.item.completedAt, at(TODAY, 10, 45));
  assert.equal(task.item.date, undefined);
  assert.equal(task.hours, 0.75);
  assert.throws(() => startPunch({status: 'Terminé'}, {name: 'Paul'}), /déjà terminé/);
});

test('timesheet : semaine du lundi, heures par jour et par personne, pointage ouvert exclu', () => {
  assert.equal(weekStart('2026-10-07'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.deepEqual(weekDays('2026-10-05').slice(0, 2), ['2026-10-05', '2026-10-06']);
  const data = {
    parcelles: [{id: 'p1', nom: 'Grand Pré'}],
    interventions: [
      {id: 'a', type: 'Déchaumage', parcelId: 'p1', timeLog: [{personName: 'Paul', start: at('2026-10-05', 8), end: at('2026-10-05', 12)}, {personName: 'paul', start: at('2026-10-06', 13), end: at('2026-10-06', 14, 30)}]},
      {id: 'b', type: 'Semis', timeLog: [{personName: 'Marie', start: at('2026-10-07', 9), end: at('2026-10-07', 11)}, {personName: 'Marie', start: at('2026-10-07', 14), end: null}]},
      {id: 'c', type: 'Vieux', timeLog: [{personName: 'Paul', start: at('2026-09-28', 8), end: at('2026-09-28', 9)}]},
      {id: 'd', type: 'Supprimé', deletedAt: 1, timeLog: [{personName: 'Paul', start: at('2026-10-05', 8), end: at('2026-10-05', 9)}]}
    ],
    tasks: [{id: 't', title: 'Clôture', timeLog: [{personName: 'Paul', start: at('2026-10-11', 7), end: at('2026-10-11', 7, 30)}]}]
  };
  const sheet = timesheet(data, '2026-10-05', {parcelName: id => data.parcelles.find(p => p.id === id)?.nom || ''});
  assert.deepEqual(sheet.people.map(p => p.name), ['Marie', 'Paul']);
  const paul = sheet.people[1];
  assert.equal(paul.total, 6);
  assert.equal(paul.days['2026-10-05'], 4);
  assert.equal(paul.days['2026-10-06'], 1.5);
  assert.equal(paul.days['2026-10-11'], 0.5);
  assert.equal(sheet.people[0].total, 2);
  assert.equal(sheet.running.length, 1);
  assert.equal(sheet.total, 8);
  const csv = timesheetCsv(sheet);
  assert.ok(csv.startsWith('﻿Personne;Date;Début;Fin;Durée (h);Travail;Parcelle\r\n'));
  assert.match(csv, /Paul;2026-10-05;08:00;12:00;4;Déchaumage;Grand Pré/);
  assert.match(csv, /Paul;2026-10-06;13:00;14:30;1,5;Déchaumage;Grand Pré/);
  assert.match(csv, /Paul;Total semaine;;;6;;/);
  assert.ok(!/Vieux|Supprimé/.test(csv));
});

test('formatHours et punchedHours', () => {
  assert.equal(formatHours(0), '0 min');
  assert.equal(formatHours(0.25), '15 min');
  assert.equal(formatHours(1.5), '1 h 30');
  assert.equal(formatHours(2), '2 h');
  assert.equal(formatHours(1.0833), '1 h 05');
  assert.equal(punchedHours({timeLog: [{start: 0, end: 1800000}, {start: 'x'}]}), 0.5);
  assert.equal(punchedHours({timeLog: [{start: 0, end: null}]}, {now: 3600000}), 1);
});

test('laborCostCandidates / applyLaborCost : seulement les coûts vides, total ajusté si automatique', () => {
  const log = [{personName: 'Paul', start: 0, end: 2 * 3600000}];
  const data = {interventions: [
    {id: 'a', type: 'Labour', status: 'Terminé', timeLog: log},
    {id: 'b', type: 'Semis', status: 'Terminé', timeLog: log, operatorCost: 40},
    {id: 'c', type: 'Fauche', status: 'À faire', timeLog: log},
    {id: 'd', type: 'Roulage', status: 'Terminé'}
  ]};
  assert.deepEqual(laborCostCandidates(data, 20), [{id: 'a', hours: 2, cost: 40, title: 'Labour'}]);
  assert.deepEqual(laborCostCandidates(data, 0), []);
  const auto = applyLaborCost({type: 'Labour', status: 'Terminé', timeLog: log, machineCost: 30, cost: 30}, 20);
  assert.equal(auto.operatorCost, 40);
  assert.equal(auto.cost, 70);
  assert.equal(auto.laborFromPunch, true);
  const manual = applyLaborCost({type: 'Labour', status: 'Terminé', timeLog: log, machineCost: 30, cost: 100}, 20);
  assert.equal(manual.cost, 100, 'total saisi à la main non modifié');
  assert.equal(applyLaborCost({timeLog: log, operatorCost: 5}, 20), null);
  assert.equal(applyLaborCost({timeLog: []}, 20), null);
});
