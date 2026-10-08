// n° 8 — Saisie express « J’ai fait… » : classement des types et parcelles, travail préparé.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rankTypes, defaultsFor, rankParcels, buildQuickWork, typeFamily, isPhytoType, formatDistance, normalizeType, FALLBACK_TYPES, GPS_MAX_AGE_MS} from './quick-entry.js';

const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d * 0.7], [x, y + d * 0.7], [x, y]]]});
const base = () => ({
  parcelles: [
    {id: 'p1', nom: 'Les Noues', surfaceHa: 11.3, culture: 'Blé tendre', geometry: sq(5.13, 46.34), favorite: true},
    {id: 'p2', nom: 'Grand Champ', surfaceHa: 8.2, culture: 'Maïs grain', geometry: sq(5.136, 46.34)},
    {id: 'p3', nom: 'Le Pré Bas', surfaceHa: 4.6, geometry: sq(5.142, 46.34)},
    {id: 'p4', nom: 'Ancienne', surfaceHa: 2, geometry: sq(5.2, 46.4), deletedAt: 5},
    {id: 'p5', nom: 'La Côte', surfaceHa: 6.1, geometry: sq(5.13, 46.345)}
  ],
  interventions: [
    {id: 'w1', parcelId: 'p2', type: 'Fauche', status: 'Terminé', date: '2026-06-01', updatedAt: 10, equipmentId: 'm1', operator: 'Paul'},
    {id: 'w2', parcelId: 'p3', type: 'fauche ', status: 'Terminé', date: '2026-06-10', updatedAt: 20, operator: 'Jean'},
    {id: 'w3', parcelId: 'p1', type: 'Semis blé', status: 'Terminé', date: '2026-10-01', updatedAt: 30, equipmentId: 'm-old'},
    {id: 'w4', parcelId: 'p1', type: 'Désherbage', status: 'À faire', date: '2026-10-05', updatedAt: 40},
    {id: 'w5', parcelId: 'p2', type: 'Récolte maïs', status: 'Terminé', deletedAt: 9, updatedAt: 50}
  ],
  templates: [{id: 't1', name: 'Épandage fumier', type: 'Épandage fumier'}],
  materiels: [{id: 'm1', nom: 'Tracteur'}, {id: 'm-old', nom: 'Vieux semoir', deletedAt: 3}],
  preferences: {defaultOperator: 'Marie'}
});

test('rankTypes : fréquence, regroupement sans casse ni accent, corbeille ignorée, complété à 6', () => {
  const types = rankTypes(base());
  assert.equal(types.length, 6);
  assert.equal(types[0].type, 'fauche', 'le libellé le plus récent est gardé');
  assert.equal(types[0].count, 2);
  assert.deepEqual(types.slice(0, 4).map(t => t.source), ['done', 'done', 'planned', 'template']);
  assert.equal(types[4].source, 'suggested');
  assert.deepEqual(types.slice(1, 4).map(t => t.type), ['Semis blé', 'Désherbage', 'Épandage fumier']);
  assert.ok(!types.some(t => /récolte maïs/i.test(t.type)), 'travail supprimé ignoré');
  assert.ok(types.slice(4).every(t => t.suggested && t.count === 0));
  assert.ok(!types.some(t => t.suggested && normalizeType(t.type) === 'fauche'), 'pas de doublon avec les types courants');
  assert.deepEqual(rankTypes({}).map(t => t.type), FALLBACK_TYPES);
  assert.equal(rankTypes(base(), {limit: 2}).length, 2);
});

test('typeFamily et isPhytoType', () => {
  assert.equal(typeFamily('Désherbage'), 'spray');
  assert.equal(typeFamily('Traitement fongicide'), 'spray');
  assert.equal(typeFamily('Récolte maïs'), 'harvest');
  assert.equal(typeFamily('Fauche'), 'mow');
  assert.equal(typeFamily('Semis blé'), 'seed');
  assert.equal(typeFamily('Épandage fumier'), 'fertilize');
  assert.equal(typeFamily('Labour'), 'soil');
  assert.equal(typeFamily('Réparer'), 'other');
  assert.ok(isPhytoType('Désherbage') && !isPhytoType('Fauche'));
});

test('defaultsFor : dernier engin encore présent et dernier opérateur du type', () => {
  const data = base();
  assert.deepEqual(defaultsFor('FAUCHE', data), {equipmentId: 'm1', operator: 'Jean'});
  assert.deepEqual(defaultsFor('Semis blé', data), {equipmentId: '', operator: 'Marie'}, 'engin supprimé non repris');
  assert.deepEqual(defaultsFor('Inconnu', {}), {equipmentId: '', operator: ''});
});

test('rankParcels : GPS précis dans une parcelle → présélection', () => {
  const now = 1e12;
  const r = rankParcels(base(), {gps: {latitude: 46.3415, longitude: 5.138, accuracy: 12, at: now}, now});
  assert.equal(r.selectedId, 'p2');
  assert.equal(r.reason, 'gps');
  assert.equal(r.chips[0].parcel.id, 'p2');
  assert.equal(r.chips[0].distance, 0);
  assert.equal(r.chips.length, 3);
  assert.ok(!r.chips.some(c => c.parcel.id === 'p4'));
});

test('rankParcels : précision > 30 m → pas de présélection, parcelles proches proposées', () => {
  const now = 1e12;
  const r = rankParcels(base(), {gps: {latitude: 46.3415, longitude: 5.138, accuracy: 45, at: now}, now});
  assert.equal(r.selectedId, null);
  assert.equal(r.imprecise, true);
  assert.equal(r.chips[0].parcel.id, 'p2', 'la plus proche reste en tête des pastilles');
});

test('rankParcels : position périmée ignorée, puis récentes et favorites', () => {
  const now = 1e12;
  const r = rankParcels(base(), {gps: {latitude: 46.3415, longitude: 5.138, accuracy: 5, at: now - GPS_MAX_AGE_MS - 1}, recentIds: ['p5', 'p4'], now});
  assert.equal(r.selectedId, null);
  assert.deepEqual(r.chips.map(c => c.parcel.id), ['p5', 'p1', 'p3']);
  assert.ok(r.chips.every(c => c.distance === null));
});

test('rankParcels : la parcelle du mode terrain prime', () => {
  const r = rankParcels(base(), {contextId: 'p3'});
  assert.equal(r.selectedId, 'p3');
  assert.equal(r.reason, 'context');
  assert.equal(r.chips[0].parcel.id, 'p3');
  assert.equal(rankParcels(base(), {contextId: 'p4'}).selectedId, null, 'parcelle supprimée refusée');
});

test('buildQuickWork : travail terminé daté du jour, surface et habitudes reprises', () => {
  const data = base();
  const work = buildQuickWork({type: ' Fauche ', parcel: data.parcelles[0], data, today: '2026-10-07'});
  assert.equal(work.status, 'Terminé');
  assert.equal(work.date, '2026-10-07');
  assert.equal(work.plannedDate, '');
  assert.equal(work.type, 'Fauche');
  assert.equal(work.parcelId, 'p1');
  assert.equal(work.surfaceWorked, 11.3);
  assert.equal(work.culture, 'Blé tendre');
  assert.equal(work.equipmentId, 'm1');
  assert.equal(work.operator, 'Jean');
  assert.equal(work.campaignId, '2026/27');
  assert.deepEqual(work.actualMetrics, {areaHa: 11.3, dose: null, duration: null});
  assert.equal(work.isPhytosanitary, undefined);
  assert.equal(work.id, undefined, 'identifiant laissé au Store');
  const phyto = buildQuickWork({type: 'Désherbage', parcel: {id: 'x', nom: 'X'}, data: {}, today: '2026-03-02'});
  assert.equal(phyto.isPhytosanitary, true);
  assert.equal(phyto.surfaceWorked, null, 'surface inconnue non inventée');
  assert.equal(phyto.campaignId, '2025/26');
  assert.equal(phyto.product, undefined, 'aucun produit inventé');
});

test('buildQuickWork : champs obligatoires', () => {
  assert.throws(() => buildQuickWork({type: '', parcel: {id: 'p'}, today: '2026-10-07'}), /Champ obligatoire : type/);
  assert.throws(() => buildQuickWork({type: 'Fauche', parcel: null, today: '2026-10-07'}), /Champ obligatoire : parcelle/);
  assert.throws(() => buildQuickWork({type: 'Fauche', parcel: {id: 'p'}, today: 'hier'}), /Date/);
});

test('formatDistance', () => {
  assert.equal(formatDistance(null), '');
  assert.equal(formatDistance(0), 'ici');
  assert.equal(formatDistance(3), '10 m');
  assert.equal(formatDistance(347), '350 m');
  assert.equal(formatDistance(1520), '1,5 km');
});
