// W6 : conseiller de rotation du pâturage (logique pure, aucune horloge réelle).
import test from 'node:test';
import assert from 'node:assert/strict';
import {grazingRotationAdvice,grazingPressure,noRestedPaddock,seasonRestTarget,urgentRotationAdvice,rotationLine} from './grazing-rotation.js';

const TODAY = '2026-06-15';// été : repos cible 35 j
const square = (lon, lat) => ({type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.001, lat], [lon + 0.001, lat + 0.001], [lon, lat + 0.001], [lon, lat]]]});
const lot = (id, parcelId, startDate, extra = {}) => ({id, parcelId, startDate, animalsCount: 18, animalCategory: 'vache-laitiere', animalType: 'Génisses', ...extra});
const farm = (parcelles, sessions, preferences = {}) => ({preferences, parcelles, grazingSessions: sessions});
const pre = {id: 'bas', nom: 'Pré du bas', culture: 'Prairie permanente', surfaceHa: 3.2};
const noue = {id: 'noue', nom: 'La Noue', culture: 'Prairie temporaire', surfaceHa: 4};
// Sortie de La Noue il y a 40 j : reposée (cible été 35 j).
const noueOld = {id: 'old-noue', parcelId: 'noue', startDate: '2026-04-20', endDate: '2026-05-06', animalsCount: 5};

test('18 UGB sur 3,2 ha depuis 14 j : 78,75 UGB.j/ha, alerte, sortie sous 4 j, message type', () => {
  const state = farm([pre, noue], [lot('g1', 'bas', '2026-06-01', {note: 'génisses'}), noueOld]);
  const [entry] = grazingRotationAdvice(state, {today: TODAY});
  assert.equal(entry.sessionId, 'g1');
  assert.equal(entry.ugb, 18); assert.equal(entry.days, 14);
  assert.equal(entry.pressure, 78.75);
  assert.equal(entry.pressureMax, 100);
  assert.equal(entry.level, 'warning');
  assert.ok(Math.abs(entry.daysLeft - 4) <= 0.5, `daysLeft ${entry.daysLeft}`);
  assert.equal(entry.next[0].parcelId, 'noue');
  assert.equal(entry.next[0].restDays, 40);
  assert.equal(entry.why[0], 'Lot génisses (18 UGB) sur Pré du bas (3,2 ha) depuis 14 j : 79 UGB.j/ha, seuil 100. Sortie conseillée d’ici 4 jours ; La Noue est reposée depuis 40 j.');
  assert.equal(rotationLine(entry), 'Herbe ≈ 4 j · Suivant : La Noue (repos 40 j)');
  assert.equal(urgentRotationAdvice([entry]).length, 0);
});

test('grazingPressure et niveau urgent au-delà du seuil', () => {
  const p = grazingPressure(lot('g', 'bas', '2026-05-27'), pre, {today: TODAY});
  assert.deepEqual(p, {ugb: 18, days: 19, pressure: 106.88});
  const [entry] = grazingRotationAdvice(farm([pre, noue], [lot('g', 'bas', '2026-05-27'), noueOld]), {today: TODAY});
  assert.equal(entry.level, 'urgent'); assert.equal(entry.daysLeft, 0);
  assert.match(entry.why[0], /dès aujourd’hui/);
  assert.equal(urgentRotationAdvice([entry]).length, 1);
});

test('10 UGB sur 2 ha avec croissance connue : repousse ajoutée', () => {
  const parc = {id: 'p', nom: 'Le Clos', culture: 'Prairie', surfaceHa: 2};
  const s = lot('g', 'p', '2026-06-05', {animalsCount: 10});// 10 j -> 50 UGB.j/ha
  const state = farm([parc], [s]);
  const sans = grazingRotationAdvice(state, {today: TODAY}).find(e => e.lotId);
  assert.equal(sans.pressure, 50); assert.equal(sans.daysLeft, 10); assert.equal(sans.confidence, 'moyenne');
  // 50 kg MS/ha/j × 2 ha / (10 UGB × 15 kg) = 0,667 j rendu par jour -> 10 / 0,333 = 30 j
  const avec = grazingRotationAdvice(state, {today: TODAY, growthKgMsHaDay: 50}).find(e => e.lotId);
  assert.ok(Math.abs(avec.daysLeft - 30) <= 0.5, `daysLeft ${avec.daysLeft}`);
  assert.equal(avec.confidence, 'haute');
  // La repousse dépasse la consommation : pas de date de sortie.
  const large = grazingRotationAdvice(state, {today: TODAY, growthKgMsHaDay: 100}).find(e => e.lotId);
  assert.equal(large.daysLeft, null); assert.equal(large.level, 'info');
  assert.match(large.why[0], /repousse couvre/);
});

test('un paddock pâturé il y a moins de 15 j n’est jamais proposé, même avec une cible courte', () => {
  const recent = {id: 'r', nom: 'Récent', culture: 'Prairie', surfaceHa: 5};
  const state = farm([pre, recent, noue], [lot('g', 'bas', '2026-06-10'), noueOld,
    {id: 'x', parcelId: 'r', startDate: '2026-05-20', endDate: '2026-06-05', animalsCount: 4}]);
  const [entry] = grazingRotationAdvice(state, {today: TODAY, restTargetDays: 5});
  assert.ok(!entry.next.some(n => n.parcelId === 'r'));
  assert.equal(entry.next[0].parcelId, 'noue');
});

test('sans surface : pas de calcul, level null et explication', () => {
  const sansSurface = {id: 's', nom: 'Sans surface', culture: 'Prairie'};
  const [entry] = grazingRotationAdvice(farm([sansSurface, noue], [lot('g', 's', '2026-06-01'), noueOld]), {today: TODAY});
  assert.equal(entry.level, null); assert.equal(entry.pressure, null); assert.equal(entry.daysLeft, null);
  assert.match(entry.why[0], /Surface inconnue/);
  assert.equal(rotationLine(entry), '');
});

test('catégorie inconnue : confiance basse, jamais urgent', () => {
  const s = lot('g', 'bas', '2026-05-20', {animalCategory: ''});// 18 animaux × 26 j / 3,2 ha = 146
  const [entry] = grazingRotationAdvice(farm([pre, noue], [s, noueOld]), {today: TODAY});
  assert.ok(entry.pressure > 100);
  assert.equal(entry.confidence, 'basse');
  assert.equal(entry.level, 'warning');
  assert.ok(entry.why.some(w => /Catégorie/.test(w)));
});

test('deux lots : premiers choix différents, le plus pressé choisit en premier', () => {
  const haut = {id: 'haut', nom: 'Pré du haut', culture: 'Prairie', surfaceHa: 3, geometry: square(2, 46)};
  const proche = {id: 'proche', nom: 'Proche', culture: 'Prairie', surfaceHa: 6, geometry: square(2.002, 46)};
  const loin = {id: 'loin', nom: 'Loin', culture: 'Prairie', surfaceHa: 6, geometry: square(2.2, 46.1)};
  const bas = {...pre, geometry: square(2.001, 46)};
  const state = farm([bas, haut, proche, loin], [
    lot('calme', 'haut', '2026-06-13', {animalsCount: 5}),
    lot('presse', 'bas', '2026-06-01'),
    {id: 'o1', parcelId: 'proche', startDate: '2026-04-01', endDate: '2026-04-10', animalsCount: 3},
    {id: 'o2', parcelId: 'loin', startDate: '2026-04-01', endDate: '2026-04-10', animalsCount: 3}]);
  const advice = grazingRotationAdvice(state, {today: TODAY});
  const presse = advice.find(e => e.lotId === 'presse'), calme = advice.find(e => e.lotId === 'calme');
  assert.equal(presse.next[0].parcelId, 'proche');
  assert.equal(calme.next[0].parcelId, 'loin');
  assert.notEqual(presse.next[0].parcelId, calme.next[0].parcelId);
});

test('aucun paddock reposé : entrée info, noRestedPaddock vrai', () => {
  const state = farm([pre, noue], [lot('g', 'bas', '2026-06-10'),
    {id: 'n', parcelId: 'noue', startDate: '2026-05-01', endDate: '2026-06-01', animalsCount: 5}]);
  assert.equal(noRestedPaddock(state, {today: TODAY}), true);
  const advice = grazingRotationAdvice(state, {today: TODAY});
  const info = advice.find(e => e.lotId === null);
  assert.equal(info.level, 'info');
  assert.deepEqual(info.why, ['Aucun paddock reposé : affouragez ou ouvrez une parcelle de fauche']);
  assert.equal(advice.find(e => e.lotId === 'g').next.length, 0);
  assert.equal(noRestedPaddock(farm([pre, noue], [noueOld]), {today: TODAY}), false);
  // Le maïs fourrage n'est pas un paddock.
  assert.equal(noRestedPaddock(farm([{id: 'm', nom: 'Maïs', culture: 'Maïs fourrage', surfaceHa: 5}], []), {today: TODAY}), true);
});

test('seasonRestTarget selon la saison et la préférence', () => {
  assert.equal(seasonRestTarget('2026-04-10'), 21);
  assert.equal(seasonRestTarget('2026-07-10'), 35);
  assert.equal(seasonRestTarget('2026-10-10'), 30);
  assert.equal(seasonRestTarget('2026-01-10'), 45);
  assert.equal(seasonRestTarget('2026-12-10'), 45);
  assert.equal(seasonRestTarget('2026-07-10', {preferences: {grazingRestDays: 28}}), 28);
});

test('seuil de pression réglable et absence de lot', () => {
  assert.deepEqual(grazingRotationAdvice(farm([pre], []), {today: TODAY}), []);
  const [entry] = grazingRotationAdvice(farm([pre, noue], [lot('g', 'bas', '2026-06-01'), noueOld], {grazingPressureMax: 70}), {today: TODAY});
  assert.equal(entry.pressureMax, 70); assert.equal(entry.level, 'urgent');
});

test('revue : deux lots sur le même pré partagent l’herbe (pression et jours cumulés)', () => {
  const state = farm([pre, noue], [lot('a', 'bas', '2026-06-08'), lot('b', 'bas', '2026-06-08', {animalType: 'Vaches'}), noueOld]);
  const advice = grazingRotationAdvice(state, {today: TODAY});
  const a = advice.find(e => e.sessionId === 'a');
  // 2 × 18 UGB × 7 j / 3,2 ha = 78,75 ; reste (100 − 78,75) × 3,2 / 36 = 1,9 j
  assert.equal(a.ugb, 18);
  assert.equal(a.pressure, 78.75);
  assert.equal(a.daysLeft, 2);
  assert.match(a.why[0], /avec 1 autre lot \(36 UGB au total\)/);
});

test('revue : parcelle archivée jamais proposée, seuil négatif ignoré', () => {
  const archived = {...noue, id: 'arch', nom: 'Archivée', archived: true};
  const state = farm([pre, archived], [lot('g', 'bas', '2026-06-01')], {grazingPressureMax: -5});
  const advice = grazingRotationAdvice(state, {today: TODAY});
  const entry = advice.find(e => e.sessionId === 'g');
  assert.equal(entry.next.length, 0);
  assert.equal(entry.pressureMax, 100);
  assert.equal(entry.level, 'warning');
  assert.ok(advice.some(e => e.lotId === null && e.level === 'info'));
});
