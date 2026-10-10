// n° 88 — carte « Ma campagne » (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignCardModel,previousCampaignId} from './campaign-card.js';
import {HOME_CARDS,normalizePersonalization} from './personalization.js';
import {emptyState} from './state.js';

const C = '2026/27', P = '2025/26';
const farm = () => ({...emptyState(), parcelles: [{id: 'p1', nom: 'Les Noues', culture: 'Blé', surfaceHa: 10, economicsByCampaign: {[C]: {yield: 8, salePrice: 200}, [P]: {yield: 7, salePrice: 190}}}],
  interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-10-01', status: 'Terminé', cost: 1000}, {id: 'w0', parcelId: 'p1', type: 'Semis', date: '2025-10-01', status: 'Terminé', cost: 900}]});

test('marge, écart N−1 et action contextuelle', () => {
  assert.equal(previousCampaignId(C), P);
  const m = campaignCardModel(farm(), {campaign: C});
  assert.equal(m.reliable, true); assert.equal(m.margin, 15000);
  assert.equal(m.delta, 15000 - (13300 - 900));
  assert.equal(m.action.kind, 'sales'); // aucune vente enregistrée
  const s = farm(); s.interventions.push({id: 'w2', parcelId: 'p1', type: 'Roulage', date: '2026-10-02', status: 'Terminé'});
  assert.equal(campaignCardModel(s, {campaign: C}).action.text, '1 travail réalisé sans coût : compléter');
});

test('pas de chiffre sous 50 % de fiabilité', () => {
  const s = farm(); s.parcelles[0].economicsByCampaign[C] = {};
  const m = campaignCardModel(s, {campaign: C});
  assert.equal(m.reliable, false); assert.equal(m.margin, null); assert.equal(m.reliability, 50); // produit inconnu : marge non affichée
  assert.match(m.action.text, /sans rendement ni prix/);
});

test('cachée au rôle lecture seule', () => {
  assert.equal(campaignCardModel(farm(), {campaign: C, role: 'viewer'}).hidden, true);
  assert.equal(campaignCardModel(farm(), {campaign: C, role: 'accountant'}).hidden, false);
});

test('carte désactivable, ajoutée une fois aux accueils existants', () => {
  assert.ok(HOME_CARDS.some(c => c.id === 'campaign'));
  assert.ok(emptyState().preferences.homeCards.includes('campaign'));
  const old = {homeCards: ['weather', 'today'], homeCardOrder: ['weather', 'today', 'tasks', 'alerts', 'recent']};
  assert.deepEqual(normalizePersonalization(old).homeCards, ['weather', 'today', 'campaign']);
  const off = {homeCards: ['weather'], homeCardOrder: ['weather', 'today', 'tasks', 'alerts', 'recent', 'campaign']};
  assert.deepEqual(normalizePersonalization(off).homeCards, ['weather']);
});
