import test from 'node:test';
import assert from 'node:assert/strict';
import {vatFromSiren, companySearchUrl, parseCompanyResults, searchCompanies} from './company-lookup.js';

test('TVA intracommunautaire calculée depuis le SIREN', () => {
  assert.equal(vatFromSiren('552 100 554'), 'FR96552100554');
  assert.equal(vatFromSiren('123'), '');
});
test('requête : SIREN/SIRET compactés, code postal en filtre', () => {
  assert.equal(new URL(companySearchUrl('552 100 554')).searchParams.get('q'), '552100554');
  assert.equal(new URL(companySearchUrl('FR96552100554')).searchParams.get('q'), '552100554');
  const u = new URL(companySearchUrl('gaec du moulin 01340'));
  assert.equal(u.searchParams.get('code_postal'), '01340'); assert.equal(u.searchParams.get('q'), 'gaec du moulin');
  assert.equal(companySearchUrl('a'), null);
});
test('résultat : fiche client préremplie', async () => {
  const payload = {results: [{siren: '552100554', nom_complet: 'PEUGEOT SA', nom_raison_sociale: 'PEUGEOT SA', etat_administratif: 'A', siege: {siret: '55210055400054', type_voie: 'RTE', libelle_voie: 'DE GIZY', code_postal: '78140', libelle_commune: 'VELIZY-VILLACOUBLAY'}}]};
  const [r] = parseCompanyResults(payload);
  assert.equal(r.billingAddress, 'RTE DE GIZY\n78140 VELIZY-VILLACOUBLAY'); assert.equal(r.vatNumber, 'FR96552100554'); assert.equal(r.kind, 'pro');
  const out = await searchCompanies('peugeot', {fetchImpl: async () => ({ok: true, status: 200, json: async () => payload})});
  assert.equal(out[0].siret, '55210055400054');
  await assert.rejects(searchCompanies('x y', {fetchImpl: async () => { throw new TypeError('offline'); }}), /injoignable/);
});
