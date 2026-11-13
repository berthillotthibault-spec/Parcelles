import test from 'node:test';
import assert from 'node:assert/strict';
import {ndviPeerComparison, ndviPeerAlerts, median, cropKey, nearestReading, dayLabel, publishNdviPeers, publishedNdviPeers} from './ndvi-peers.js';
import {decisionFeed, fromNdviPeer} from './decision-feed.js';

const row = (date, ndvi, usable = true) => ({date, ndvi, usable});
const parcels = [
  {id: 'a', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 8},
  {id: 'b', nom: 'Le Pré long', culture: 'blé  tendre', surfaceHa: 5},
  {id: 'c', nom: 'La Combe', culture: 'Blé tendre', surfaceHa: 6},
  {id: 'd', nom: 'Le Bois', culture: 'Blé tendre', surfaceHa: 4},
  {id: 'e', nom: 'Champ du haut', culture: 'Maïs', surfaceHa: 9}
];
const series = {
  a: [row('2026-05-01', 0.6), row('2026-05-12', 0.52)],
  b: [row('2026-05-12', 0.68)],
  c: [row('2026-05-12', 0.7), row('2026-05-30', 0.2, false)],
  d: [row('2026-05-12', 0.66)],
  e: [row('2026-05-12', 0.3)]
};
const rows = ndviPeerComparison(parcels, p => series[p.id], {today: '2026-05-13'});

test('outils : médiane, clé de culture, date courte, mesure la plus proche', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(cropKey(' Blé  Tendre '), 'ble tendre');
  assert.equal(dayLabel('2026-05-12'), '12 mai');
  assert.equal(nearestReading([row('2026-05-01', 0.5), row('2026-05-10', 0.6)], '2026-05-12').ndvi, 0.6);
  assert.equal(nearestReading([row('2026-05-01', 0.5)], '2026-05-12'), null);
});

test('parcelle en retard : texte explicatif avec la médiane des autres parcelles de même culture', () => {
  const a = rows.find(r => r.parcelId === 'a');
  assert.ok(a.lagging);
  assert.equal(a.peers.length, 3);
  assert.equal(a.median, 0.68);
  assert.equal(a.text, 'Les Brosses : NDVI 0,52 contre 0,68 pour les 3 autres parcelles de Blé tendre mesurées le 12 mai');
  assert.equal(a.level, 'info');
  assert.match(a.why.join(' '), /Écart de 0,16 \(24 %\)/);
  assert.deepEqual(ndviPeerAlerts(rows).map(r => r.parcelId), ['a']);
});

test('pas de comparaison sans au moins 2 autres parcelles comparables à ± 5 jours', () => {
  assert.equal(rows.find(r => r.parcelId === 'e'), undefined);
  const far = ndviPeerComparison(parcels.slice(0, 3), p => ({a: [row('2026-05-12', 0.4)], b: [row('2026-05-20', 0.7)], c: [row('2026-05-14', 0.7)]})[p.id], {today: '2026-05-13'});
  assert.equal(far.find(r => r.parcelId === 'a'), undefined);
  // Image inexploitable (nuages) ignorée : c garde son NDVI du 12 mai.
  assert.equal(rows.find(r => r.parcelId === 'c').date, '2026-05-12');
});

test('seuils : écart ≥ 0,1 et ≥ 15 % ; plage de dates si les mesures diffèrent', () => {
  const s = {a: [row('2026-05-12', 0.6)], b: [row('2026-05-10', 0.68)], c: [row('2026-05-14', 0.7)]};
  const near = ndviPeerComparison(parcels.slice(0, 3), p => s[p.id], {today: '2026-05-15'}).find(r => r.parcelId === 'a');
  assert.equal(near.lagging, false);
  const low = {a: [row('2026-05-12', 0.1)], b: [row('2026-05-10', 0.3)], c: [row('2026-05-14', 0.32)]};
  const big = ndviPeerComparison(parcels.slice(0, 3), p => low[p.id], {today: '2026-05-15'}).find(r => r.parcelId === 'a');
  assert.ok(big.lagging);
  assert.equal(big.level, 'warning');
  assert.match(big.text, /mesurées entre le 10 mai et le 14 mai$/);
});

test('fil « À décider » : carte avec action ouvrir la parcelle, rien sans retard', () => {
  const a = rows.find(r => r.parcelId === 'a');
  const d = fromNdviPeer(a);
  assert.equal(d.kind, 'ndvi-peer');
  assert.equal(d.action.type, 'open-parcel');
  assert.equal(d.action.id, 'a');
  assert.equal(d.stakes.ha, 8);
  assert.ok(d.why[0].startsWith('Les Brosses : NDVI 0,52'));
  assert.equal(fromNdviPeer(rows.find(r => r.parcelId === 'b')), null);
  const state = {parcelles: parcels, interventions: [], tasks: [], preferences: {}};
  const feed = decisionFeed(state, {today: '2026-05-13', notifications: [], compliance: [], ndviPeers: rows});
  assert.ok(feed.some(x => x.kind === 'ndvi-peer' && x.action.id === 'a'));
  publishNdviPeers(rows);
  assert.equal(publishedNdviPeers(), rows);
  publishNdviPeers(null);
  assert.deepEqual(publishedNdviPeers(), []);
});

test('image trop ancienne : aucune comparaison (pas de carte périmée en novembre pour une image de mai)', () => {
  assert.equal(ndviPeerComparison(parcels, p => series[p.id], {today: '2026-11-13'}).length, 0);
  assert.ok(ndviPeerComparison(parcels, p => series[p.id], {today: '2026-06-11'}).some(r => r.parcelId === 'a'));
  assert.equal(ndviPeerComparison(parcels, p => series[p.id], {today: '2026-06-13'}).length, 0);
});
