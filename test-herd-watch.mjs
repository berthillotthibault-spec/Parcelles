import test from 'node:test';
import assert from 'node:assert/strict';
import {herdWatch, herdIvv, reproductionOf} from './herd-watch.js';

const TODAY = '2026-11-13';
const cow = (id, name, extra = {}) => ({id, name, sex: 'F', nationalId: `FR01123${id.padStart(5, '0')}`, birthDate: '2019-03-01', ...extra});
const ev = (id, animalId, kind, date, extra = {}) => ({id, animalId, kind, date, ...extra});
function herd() {
  return {
    animals: [
      cow('1', 'Marguerite'), cow('2', 'Bella'), cow('3', 'Rosa'), cow('4', 'Génisse', {birthDate: '2022-09-01', origin: 'birth'}),
      cow('5', 'Sortie', {exitDate: '2026-01-01'}),
      {id: 'v1', name: 'Veau 1', sex: 'M', birthDate: '2026-03-01'}, {id: 'v2', name: 'Veau 2', sex: 'M', birthDate: '2026-03-05'},
      {id: 'v3', name: 'Veau 3', sex: 'M', birthDate: '2026-03-10'}, {id: 'v4', name: 'Veau 4', sex: 'M', birthDate: '2026-03-12'}
    ],
    animalEvents: [
      // Marguerite : vêlages 2024-03-01 puis 2025-06-10 (IVV 466 j), rien depuis : vide depuis plus de 400 j... non, 521 j.
      ev('a', '1', 'calving', '2024-03-01'), ev('b', '1', 'calving', '2025-06-10'),
      // Bella : vêlage 2025-02-01, inséminée 2026-05-01 : pleine présumée, pas signalée.
      ev('c', '2', 'calving', '2025-02-01'), ev('d', '2', 'insemination', '2026-05-01'),
      // Rosa : vêlages 2025-01-10 et 2026-01-05 (IVV 360 j).
      ev('e', '3', 'calving', '2025-01-10'), ev('f', '3', 'calving', '2026-01-05'),
      // Sortie : vide mais plus présente.
      ev('g', '5', 'calving', '2023-01-01'),
      // Pesées des veaux : 1 200, 1 100, 1 150 g/j, et 600 g/j pour Veau 4.
      ev('p1', 'v1', 'weighing', '2026-09-01', {weightKg: 200}), ev('p2', 'v1', 'weighing', '2026-10-01', {weightKg: 236}),
      ev('p3', 'v2', 'weighing', '2026-09-01', {weightKg: 200}), ev('p4', 'v2', 'weighing', '2026-10-01', {weightKg: 233}),
      ev('p5', 'v3', 'weighing', '2026-09-01', {weightKg: 200}), ev('p6', 'v3', 'weighing', '2026-10-01', {weightKg: 234.5}),
      ev('p7', 'v4', 'weighing', '2026-09-01', {weightKg: 200}), ev('p8', 'v4', 'weighing', '2026-10-01', {weightKg: 218})
    ],
    vetTreatments: [1, 2, 3].map(i => ({id: `t${i}`, animalId: '3', date: `2026-0${i + 3}-10`, product: 'X'}))
  };
}

test('reproduction d’une vache : vêlages, dernier IVV, dernière mise à la reproduction', () => {
  assert.deepEqual(reproductionOf(herd(), '1'), {calvings: ['2024-03-01', '2025-06-10'], last: '2025-06-10', ivv: 466, lastService: null, lastServiceKind: null});
  assert.deepEqual(herdIvv(herd(), {today: TODAY}), {days: 413, cows: 2});
});

test('à surveiller : vache vide, génisse, IVV long, croissance, soins répétés', () => {
  const rows = herdWatch(herd(), {today: TODAY});
  const of = id => rows.filter(r => r.animalId === id).map(r => r.kind);
  assert.deepEqual(of('1'), ['open'], 'IVV long mais dernier vêlage il y a plus d’un an : seule la vache vide est signalée');
  assert.match(rows.find(r => r.animalId === '1').text, /pas de vêlage depuis 521 jours/);
  assert.deepEqual(of('2'), [], 'Bella est pleine présumée');
  assert.deepEqual(of('3'), ['care']);
  assert.deepEqual(of('4'), ['heifer']);
  assert.deepEqual(of('5'), [], 'animal sorti ignoré');
  assert.deepEqual(of('v4'), ['gain']);
  assert.match(rows.find(r => r.animalId === 'v4').text, /600 g\/j, contre 1\s150 g\/j pour les 3 autres jeunes mâles/);
  assert.equal(rows[0].level, 'warning', 'les plus graves d’abord');
});

test('IVV long au dernier vêlage récent, perte de poids', () => {
  const s = herd();
  s.animalEvents.push(ev('h', '1', 'calving', '2026-09-20'));
  const rows = herdWatch(s, {today: TODAY});
  assert.deepEqual(rows.filter(r => r.animalId === '1').map(r => r.kind), ['ivv']);
  s.animalEvents.push(ev('p9', 'v1', 'weighing', '2026-11-01', {weightKg: 230}));
  assert.equal(herdWatch(s, {today: TODAY}).find(r => r.animalId === 'v1').level, 'warning');
});

test('rien à dire sans données ou sans date', () => {
  assert.deepEqual(herdWatch({}, {today: TODAY}), []);
  assert.deepEqual(herdWatch(herd(), {}), []);
  assert.equal(herdIvv({animals: []}, {today: TODAY}), null);
});

test('relecture : vache importée ou mère de veaux rattachés, pas « génisse jamais vêlée »', () => {
  const s = herd();
  s.animals.push(cow('7', 'Importée', {origin: 'import'}), cow('8', 'Mère', {origin: 'birth'}), {id: 'v8', name: 'Veau 8', sex: 'F', motherId: '8', birthDate: '2026-04-01'});
  const rows = herdWatch(s, {today: TODAY});
  assert.deepEqual(rows.filter(r => ['7', '8'].includes(r.animalId)), []);
  s.animals.push(cow('9', 'Née ici', {origin: 'birth'}));
  assert.deepEqual(herdWatch(s, {today: TODAY}).filter(r => r.animalId === '9').map(r => r.kind), ['heifer']);
});

test('relecture : insémination ancienne sans vêlage, texte exact', () => {
  const s = herd();
  s.animals.push(cow('6', 'Servie'));
  s.animalEvents.push(ev('s1', '6', 'calving', '2025-01-01'), ev('s2', '6', 'insemination', '2025-03-01'));
  assert.match(herdWatch(s, {today: TODAY}).find(r => r.animalId === '6').text, /inséminée le 1 mars 2025 sans vêlage enregistré depuis/);
});

test('relecture : deux pesées le même jour, la croissance reste calculée', async () => {
  const {dailyGain} = await import('./herd.js');
  const s = {animalEvents: [ev('a', 'x', 'weighing', '2026-03-01', {weightKg: 200}), ev('b', 'x', 'weighing', '2026-09-01', {weightKg: 300, createdAt: 1}), ev('c', 'x', 'weighing', '2026-09-01', {weightKg: 302, createdAt: 2})]};
  assert.equal(dailyGain(s, 'x'), Math.round(102 / 184 * 1000));
});
