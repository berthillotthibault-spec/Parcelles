import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommandIndex, matchCommands, rememberSearch, extractPeriod, filterRowsByPeriod, periodListing, withUndatedMatches} from './spotlight.js';

const CATS = {production: {title: 'Production', items: [['Pâturage', 'Animaux actuellement au pré', 'open-grazing', 'production'], ['Stocks', 'Valeur, seuils et mouvements', 'open-stock', 'package']]},
  management: {title: 'Gestion', items: [['Registre phyto', 'Traitements, contrôles', 'open-phyto-register', 'work'], ['Assistant PAC', 'Déclaration', 'open-pac', 'files']]}};

test('index : fusion des outils de Plus et des actions sans doublon', () => {
  const index = buildCommandIndex(CATS);
  assert.ok(index.some(c => c.action === 'open-phyto-register' && c.kind === 'tool' && c.category === 'Gestion'));
  assert.equal(index.filter(c => c.action === 'open-pac').length, 1);
  assert.ok(index.some(c => c.action === 'new-grazing'));
});

test('correspondance : outils, actions en langage courant et une faute tolérée', () => {
  const index = buildCommandIndex(CATS);
  assert.equal(matchCommands('registre phyto', index)[0].action, 'open-phyto-register');
  assert.equal(matchCommands('sortir les vaches', index)[0].action, 'new-grazing');
  assert.equal(matchCommands('exporter pac', index)[0].action, 'open-pac');
  assert.equal(matchCommands('registe phyto', index)[0].action, 'open-phyto-register');
  assert.equal(matchCommands('paturge', index)[0].action, 'open-grazing');
  assert.deepEqual(matchCommands('zzzz', index), []);
  assert.equal(matchCommands('paturage', index, {visible: a => a !== 'open-grazing'}).some(c => c.action === 'open-grazing'), false);
});

test('recherches récentes : en tête, sans doublon, bornées', () => {
  let list = rememberSearch([], 'Fauche');
  list = rememberSearch(list, 'maïs');
  list = rememberSearch(list, 'fauche');
  assert.deepEqual(list, ['fauche', 'maïs']);
  assert.deepEqual(rememberSearch(list, ' '), list);
  assert.equal(rememberSearch(Array.from({length: 10}, (_, i) => `q${i}`), 'x', 6).length, 6);
});

test('période : semaine dernière, hier et reste de la saisie', () => {
  const now = new Date('2026-10-14T10:00:00').getTime(); // mercredi
  const a = extractPeriod('travaux semaine dernière', {now});
  assert.deepEqual([a.period.from, a.period.to, a.rest], ['2026-10-05', '2026-10-11', 'travaux']);
  assert.equal(extractPeriod('fauche hier', {now}).period.from, '2026-10-13');
  assert.equal(extractPeriod('parcelles maïs > 5', {now}).period, null);
  assert.equal(extractPeriod('travaux en mars', {now}).rest, 'travaux');
});

test('filtre et liste des éléments datés de la période', () => {
  const state = {parcelles: [{id: 'p1', nom: 'Grand Pré'}], interventions: [
    {id: 'w1', type: 'Fauche', parcelId: 'p1', status: 'Terminé', date: '2026-10-07'},
    {id: 'w2', type: 'Semis', parcelId: 'p1', status: 'Planifié', plannedDate: '2026-10-20'},
    {id: 'w3', type: 'Broyage', parcelId: 'p1', status: 'Terminé', date: '2026-10-06', deletedAt: 1}]};
  const period = {from: '2026-10-05', to: '2026-10-11'};
  assert.deepEqual(periodListing('travaux', state, period).map(r => r.id), ['w1']);
  assert.equal(periodListing('maïs', state, period), null);
  const rows = [{type: 'work', id: 'w1'}, {type: 'work', id: 'w2'}, {type: 'parcel', id: 'p1'}];
  assert.deepEqual(filterRowsByPeriod(rows, state, period).map(r => r.id), ['w1']);
});

test('une période dans un nom de lieu garde les résultats non datés', () => {
  assert.ok(extractPeriod('la campagne').period);
  const all = [{type: 'parcel', id: 'p1'}, {type: 'work', id: 'w9'}, {type: 'client', id: 'c1'}];
  assert.deepEqual(withUndatedMatches([{type: 'work', id: 'w1'}], all).map(r => r.id), ['w1', 'p1', 'c1']);
  assert.deepEqual(withUndatedMatches([], [{type: 'parcel', id: 'p1'}]).map(r => r.id), ['p1']);
});
