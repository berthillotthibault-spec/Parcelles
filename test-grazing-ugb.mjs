// n° 78 — chargement UGB/ha, repos et bilan de pâturage (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {ugbOf,ugbTable,stockingRate,presenceDays,farmGrazingBalance,grazingNitrogen,restLabel,UGB_REFERENCES} from './grazing.js';
import {grazingTimeline} from './charts.js';

const farm = (sessions, prefs = {}) => ({preferences: prefs, parcelles: [
  {id: 'pre', nom: 'Pré Bas', culture: 'Prairie permanente', surfaceHa: 4},
  {id: 'ble', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10}], grazingSessions: sessions});

test('ugbOf : coefficient de la catégorie, 1 UGB par animal sans catégorie avec avertissement', () => {
  const vaches = ugbOf({animalsCount: 20, animalCategory: 'vache-allaitante'});
  assert.equal(vaches.ugb, 17); assert.equal(vaches.known, true); assert.equal(vaches.warning, '');
  const inconnu = ugbOf({animalsCount: 10});
  assert.equal(inconnu.ugb, 10); assert.equal(inconnu.known, false); assert.match(inconnu.warning, /1 UGB/);
  assert.equal(ugbOf({animals: [{number: 'FR1'}, {number: 'FR2'}], additionalAnimalsCount: 2, animalCategory: 'veau'}).ugb, 1.6);
});

test('ugbTable : coefficient modifiable, valeurs aberrantes ignorées, source et mention à vérifier', () => {
  const t = ugbTable({preferences: {ugbCoefficients: {'vache-allaitante': 0.9, veau: 12, taureau: 'x'}}});
  assert.equal(t.categories.find(c => c.key === 'vache-allaitante').ugb, 0.9);
  assert.equal(t.categories.find(c => c.key === 'veau').ugb, 0.4);
  assert.deepEqual(t.modified, ['vache-allaitante']);
  assert.match(UGB_REFERENCES.verify, /vérifier/); assert.ok(UGB_REFERENCES.source);
  assert.equal(ugbOf({animalsCount: 10, animalCategory: 'vache-allaitante'}, t).ugb, 9);
});

test('presenceDays : sortie non comptée, bornes de la période', () => {
  assert.equal(presenceDays({startDate: '2026-04-01', endDate: '2026-04-11'}, {from: '2026-01-01', to: '2026-10-10'}), 10);
  assert.equal(presenceDays({startDate: '2025-12-20', endDate: '2026-01-05'}, {from: '2026-01-01', to: '2026-10-10'}), 4);
  assert.equal(presenceDays({startDate: '2026-10-01'}, {from: '2026-01-01', to: '2026-10-10'}), 10);
  assert.equal(presenceDays({startDate: '2026-11-01'}, {from: '2026-01-01', to: '2026-10-10'}), 0);
});

test('stockingRate : chargement instantané, cumul de la saison et repos', () => {
  const s = farm([
    {id: 'a', parcelId: 'pre', animalsCount: 24, animalCategory: 'vache-allaitante', startDate: '2026-10-01'},
    {id: 'b', parcelId: 'pre', animalsCount: 10, animalCategory: 'genisse-1-2ans', startDate: '2026-05-01', endDate: '2026-05-11'}]);
  const r = stockingRate(s, 'pre', {date: '2026-10-10'});
  assert.equal(r.grazed, true); assert.equal(r.ugb, 20.4); assert.equal(r.instant, 5.1);
  // 20,4 UGB × 10 j + 6 UGB × 10 j = 264 j UGB, sur 4 ha.
  assert.equal(r.seasonUgbDays, 264); assert.equal(r.seasonPerHa, 66);
  assert.equal(r.restDays, null);
  const rest = stockingRate(farm([{id: 'b', parcelId: 'pre', animalsCount: 10, startDate: '2026-09-01', endDate: '2026-09-28'}]), 'pre', {date: '2026-10-10'});
  assert.equal(rest.grazed, false); assert.equal(rest.restDays, 12); assert.equal(rest.advisedRest, 21); assert.equal(rest.rested, false);
  assert.equal(restLabel(rest), 'Repos depuis 12 j, 21 j conseillés');
  assert.equal(stockingRate(farm([], {grazingRestDays: 30}), 'pre', {date: '2026-10-10'}).advisedRest, 30);
});

test('farmGrazingBalance : SFP, chargement moyen annuel, présence par lot, azote', () => {
  const s = farm([
    {id: 'a', parcelId: 'pre', animalsCount: 10, animalCategory: 'vache-laitiere', note: 'Laitières', startDate: '2026-04-01', endDate: '2026-04-11'},
    {id: 'b', parcelId: 'ble', animalsCount: 10, animalCategory: 'vache-laitiere', note: 'Laitières', startDate: '2026-04-11', endDate: '2026-04-21'},
    {id: 'c', parcelId: 'pre', animalsCount: 5, note: 'Génisses', startDate: '2026-06-01', endDate: '2026-06-03'}]);
  const b = farmGrazingBalance(s, {date: '2026-10-10'});
  assert.equal(b.sfp, 14); // le blé pâturé entre dans la SFP
  assert.equal(b.ugbDays, 210);
  assert.equal(b.meanStocking, Math.round(210 / 365 / 14 * 100) / 100);
  assert.equal(b.lots[0].label, 'Laitières'); assert.equal(b.lots[0].days, 20); assert.equal(b.lots[0].passages, 2); assert.equal(b.lots[0].parcels, 2);
  assert.equal(b.unknownCategory, 1);
  assert.equal(b.nitrogen, Math.round(10 * 101 * 20 / 365 + 5 * 85 * 2 / 365));
  assert.equal(grazingNitrogen(s, {from: '2026-04-01', to: '2026-04-30'}).total, Math.round(10 * 101 * 20 / 365));
});

test('Gantt : libellés de lignes à gauche quand labelWidth est fourni', () => {
  const svg = grazingTimeline([{label: 'Laitières', sessions: [{start: '2026-04-01', end: '2026-04-11', count: 10, type: 'Pré Bas'}]}], {from: '2026-01-01', to: '2026-12-31', today: '2026-10-10', width: 400, labelWidth: 100});
  assert.match(svg, /chart-row-label/); assert.match(svg, />Laitières</);
  assert.doesNotMatch(grazingTimeline([{label: 'P', sessions: []}], {from: '2026-01-01', to: '2026-12-31'}), /chart-row-label/);
});

test('azote : les animaux au pâturage comptent dans le plafond de 170 kg N', async () => {
  const {nitrogenAlerts} = await import('./nitrogen.js');
  const s = {...farm([{id: 'a', parcelId: 'pre', animalsCount: 30, animalCategory: 'vache-laitiere', startDate: '2026-08-01'}]), exploitation: {}, interventions: [], rotations: []};
  const {organic} = nitrogenAlerts(s, {today: '2026-10-10', campaign: '2026/27'});
  assert.equal(organic.grazing, Math.round(30 * 101 * 71 / 365));
  assert.equal(organic.perHa, Math.round(organic.grazing / 14 * 10) / 10);
});

// ---------- n° 77 ----------
test('terrain : en-tête de la prairie, lots ailleurs, écart de comptage, observation géolocalisée', async () => {
  const {fieldGrazingSummary, countGap, grazingCheckObservation} = await import('./grazing.js');
  const s = farm([{id: 'a', parcelId: 'pre', animalType: 'Vaches', animalsCount: 24, startDate: '2026-10-01'}, {id: 'b', parcelId: 'ble', animalType: 'Génisses', animalsCount: 8, note: 'Lot génisses', startDate: '2026-10-05'}]);
  const f = fieldGrazingSummary(s, 'pre', {date: '2026-10-10'});
  assert.equal(f.headline, 'Pré Bas · 24 vaches depuis 9 j');
  assert.equal(f.known, 24); assert.equal(f.pasture, true);
  assert.deepEqual(f.elsewhere.map(l => [l.id, l.label, l.parcelName]), [['b', 'Lot génisses', 'Les Noues']]);
  assert.equal(fieldGrazingSummary(s, 'ble', {date: '2026-10-10'}).pasture, true); // pâturée : carte affichée
  assert.equal(fieldGrazingSummary(farm([]), 'ble', {date: '2026-10-10'}).pasture, false);
  assert.equal(countGap(24, 22).label, 'Écart de −2 sur 24 connus');
  assert.equal(countGap(24, 24).gap, 0);
  const o = grazingCheckObservation('fence', {parcel: s.parcelles[0], gps: {latitude: 46.3, longitude: 5.1, accuracy: 8}, date: new Date('2026-10-10T10:00:00')});
  assert.equal(o.type, 'Clôture'); assert.equal(o.parcelId, 'pre'); assert.equal(o.latitude, 46.3); assert.equal(o.severity, 'warning');
  assert.equal(grazingCheckObservation('water', {parcel: s.parcelles[0]}).latitude, null);
  assert.equal(grazingCheckObservation('autre', {parcel: s.parcelles[0]}), null);
});

test('terrain : déplacement et comptage passent par le Store, effectif changé seulement sur demande', async () => {
  const {moveGrazingLot, updateGrazingCount} = await import('./grazing-records.js');
  const rows = farm([{id: 'b', parcelId: 'ble', animalType: 'Génisses', animalCategory: 'genisse-1-2ans', animals: [{number: 'FR1'}], additionalAnimalsCount: 7, animalsCount: 8, startDate: '2026-10-05'}]);
  const store = {state: rows, writeGuard: null, enqueueWrite: fn => fn(), async _mutate(label, fn) { fn(this.state); }};
  const moved = await moveGrazingLot(store, rows.grazingSessions[0], 'pre', {date: '2026-10-10'});
  assert.equal(rows.grazingSessions[0].endDate, '2026-10-10');
  assert.equal(moved.parcelId, 'pre'); assert.equal(moved.animalsCount, 8); assert.equal(moved.animalCategory, 'genisse-1-2ans');
  const counted = await updateGrazingCount(store, moved.id, 10);
  assert.equal(counted.animalsCount, 10); assert.equal(counted.additionalAnimalsCount, 9);
  await assert.rejects(updateGrazingCount(store, moved.id, 0), /au moins un/);
});
