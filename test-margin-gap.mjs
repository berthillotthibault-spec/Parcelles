import test from 'node:test';
import assert from 'node:assert/strict';
import {marginGaps, gapText, workPost} from './margin-gap.js';

const C = '2026/27';
const parcel = (id, nom, culture, y, extra = {}) => ({id, nom, culture, surfaceHa: 10, economicsByCampaign: {[C]: {yield: y, salePrice: 200, yieldUnit: 't/ha'}}, ...extra});
const work = (id, parcelId, type, cost, extra = {}) => ({id, parcelId, type, date: '2026-10-05', status: 'Terminé', cost, ...extra});
function farm(extraWorks = [], extraParcels = []) {
  return {preferences: {}, integrationImports: [], rotations: [],
    parcelles: [parcel('a', 'Les Brosses', 'Blé tendre', 6), parcel('b', 'Grand Champ', 'Blé tendre', 7), parcel('c', 'Le Clos', 'blé tendre', 7), parcel('d', 'La Prairie', 'Prairie', 3), ...extraParcels],
    interventions: [
      work('s1', 'a', 'Semis', 2000), work('s2', 'b', 'Semis', 2000), work('s3', 'c', 'Semis', 2000),
      work('f1', 'a', 'Épandage ammonitrate', 3000), work('f2', 'b', 'Fertilisation', 1000), work('f3', 'c', 'Fertilisation', 1000),
      work('x', 'a', 'Fertilisation', 9999, {status: 'Annulé'}), work('y', 'a', 'Fertilisation', 9999, {deletedAt: 1}),
      ...extraWorks]};
}

test('poste d’un travail', () => {
  assert.equal(workPost({type: 'Semis'}), 'seed');
  assert.equal(workPost({type: 'Épandage lisier'}), 'fertilize');
  assert.equal(workPost({type: 'Désherbage'}), 'spray');
  assert.equal(workPost({type: 'Passage', kind: 'fertilize'}), 'fertilize');
  assert.equal(workPost({type: 'Labour'}), 'other');
  assert.equal(workPost({type: 'Moisson'}), 'other');
});

test('écart à culture égale, décomposé : produit et engrais', () => {
  const gaps = marginGaps(farm(), {campaign: C});
  assert.deepEqual(gaps.map(g => g.parcelId), ['a', 'b', 'c'], 'la prairie, seule de sa culture, n’est pas comparée');
  const [a] = gaps;
  assert.equal(a.peers, 2);
  assert.equal(Math.round(a.marginHa), 700);
  assert.equal(Math.round(a.peerMarginHa), 1100);
  assert.equal(Math.round(a.gapHa), -400);
  assert.deepEqual(a.parts.map(p => [p.key, Math.round(p.deltaHa)]), [['product', -200], ['fertilize', -200]]);
  assert.equal(a.significant, true);
  assert.equal(gapText(a), 'Les Brosses : −400 €/ha par rapport aux 2 autres parcelles de Blé tendre, dont produit −200 €/ha (rendement 6 contre 7 t/ha), engrais −200 €/ha.');
  const b = gaps.find(g => g.parcelId === 'b');
  assert.ok(b.gapHa > 0, 'Grand Champ fait mieux que la moyenne de Les Brosses et Le Clos');
});

test('rotation de la campagne : la culture vient de l’assolement', () => {
  const state = farm();
  state.rotations = [{id: 'r', parcelId: 'd', campaignId: C, culture: 'Blé tendre'}];
  assert.equal(marginGaps(state, {campaign: C}).find(g => g.parcelId === 'a').peers, 3);
});

test('produit inconnu : parcelle exclue ; petit écart : non signalé', () => {
  const state = farm([], [parcel('e', 'Sans prix', 'Blé tendre', null)]);
  assert.equal(marginGaps(state, {campaign: C}).some(g => g.parcelId === 'e'), false);
  const close = farm();
  close.interventions = close.interventions.filter(w => w.id !== 'f1').concat(work('f1', 'a', 'Fertilisation', 1000));
  close.parcelles[0].economicsByCampaign[C].yield = 6.9;
  const g = marginGaps(close, {campaign: C}).find(x => x.parcelId === 'a');
  assert.equal(g.significant, false);
});

test('texte avec une seule autre parcelle', () => {
  const state = farm();
  state.parcelles = state.parcelles.filter(p => p.id !== 'c');
  assert.match(gapText(marginGaps(state, {campaign: C})[0]), /par rapport à l’autre parcelle de Blé tendre/);
});

test('relecture : somme des postes = écart, même avec un travail « Annulée »', () => {
  const state = farm([work('z', 'a', 'Labour', 3000, {status: 'Annulée'})]);
  for (const g of marginGaps(state, {campaign: C})) {
    const sum = g.parts.reduce((s, p) => s + p.deltaHa, 0);
    assert.ok(Math.abs(sum - g.gapHa) < 1.5, `${g.name} : ${sum} contre ${g.gapHa}`);
  }
});

test('relecture : genre « Rien » prime sur le libellé', () => {
  assert.equal(workPost({type: 'Traitement fongicide', kind: 'none'}), 'other');
  assert.equal(workPost({type: 'Épandage engrais', kind: 'none'}), 'other');
  assert.equal(workPost({type: 'Passage', kind: 'none', isPhytosanitary: true}), 'spray');
});

test('relecture : rendements q/ha et t/ha comparés dans la même unité', () => {
  const state = farm();
  state.parcelles[0].economicsByCampaign[C] = {yield: 60, salePrice: 20, yieldUnit: 'q/ha'};
  const a = marginGaps(state, {campaign: C}).find(g => g.parcelId === 'a');
  assert.match(gapText(a), /rendement 60 contre 70 q\/ha/);
});

test('relecture : élision et culture non renseignée', () => {
  const state = farm();
  state.parcelles = state.parcelles.map(p => ({...p, culture: p.culture.toLowerCase().includes('blé') ? 'Orge' : p.culture}));
  assert.match(gapText(marginGaps(state, {campaign: C})[0]), /parcelles d’Orge/);
  const unknown = farm();
  unknown.parcelles = unknown.parcelles.map(p => ({...p, culture: ''}));
  assert.deepEqual(marginGaps(unknown, {campaign: C}), []);
});

test('marge : un travail « Annulée » (féminin) n’est pas compté, comme « Annulé »', async () => {
  const {marginModel} = await import('./pilotage.js');
  const base = marginModel(farm(), {campaign: C}).rows.find(r => r.parcelId === 'a').charges;
  for (const status of ['Annulé', 'Annulée'])
    assert.equal(marginModel(farm([work('z', 'a', 'Labour', 3000, {status})]), {campaign: C}).rows.find(r => r.parcelId === 'a').charges, base, status);
});
