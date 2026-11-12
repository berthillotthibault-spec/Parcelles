// Apprentissage des corrections (learning.js) : taux de TVA corrigés et conseils jugés « pas utiles ».
import test from 'node:test';
import assert from 'node:assert/strict';
import {vatLabelKey, recordVatCorrection, learnedVatRate, adviceKey, recordAdviceDismissal, undoAdviceDismissal, isAdviceHidden, filterHiddenAdvice, LEARNING_LIMIT} from './learning.js';

const withPrefs = prefs => ({preferences: prefs});
const NOW = new Date('2026-11-12T10:00:00').getTime();

test('vatLabelKey : quantités, unités et accents retirés', () => {
  assert.equal(vatLabelKey('Fauche 12 ha'), 'fauche');
  assert.equal(vatLabelKey('Pressage balles rondes — 35 u'), 'pressage balles rondes');
  assert.equal(vatLabelKey('Entretien de haies (forêt)'), 'entretien de haies foret');
  assert.equal(vatLabelKey(''), '');
});

test('recordVatCorrection : nouvelle correction datée, taux proposé conservé', () => {
  const rows = recordVatCorrection(withPrefs({}), 'Pressage balles rondes 35 u', 10, {now: NOW, proposed: 20});
  assert.deepEqual(rows, [{key: 'pressage balles rondes', label: 'Pressage balles rondes 35 u', rate: 10, count: 1, at: '2026-11-12', proposed: 20}]);
});

test('recordVatCorrection : même taux -> compteur, autre taux -> remplace', () => {
  let s = withPrefs({vatCorrections: recordVatCorrection(withPrefs({}), 'Fauche', 10, {now: NOW})});
  s = withPrefs({vatCorrections: recordVatCorrection(s, 'fauche 8 ha', 10, {now: NOW})});
  assert.equal(s.preferences.vatCorrections[0].count, 2);
  s = withPrefs({vatCorrections: recordVatCorrection(s, 'Fauche', 20, {now: NOW})});
  assert.equal(s.preferences.vatCorrections.length, 1);
  assert.equal(s.preferences.vatCorrections[0].rate, 20);
  assert.equal(s.preferences.vatCorrections[0].count, 1);
});

test('recordVatCorrection : taux ou désignation invalides ignorés', () => {
  assert.deepEqual(recordVatCorrection(withPrefs({}), 'Fauche', 'abc'), []);
  assert.deepEqual(recordVatCorrection(withPrefs({}), 'Fauche', 55), []);
  assert.deepEqual(recordVatCorrection(withPrefs({}), '12 ha', 10), []);
  assert.deepEqual(recordVatCorrection(null, 'Fauche', 10, {now: NOW}).length, 1);
});

test('recordVatCorrection : borné, la plus récente en tête', () => {
  let s = withPrefs({});
  for (let i = 0; i < LEARNING_LIMIT + 15; i++) s = withPrefs({vatCorrections: recordVatCorrection(s, `prestation numero${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}x`, 10, {now: NOW})});
  assert.equal(s.preferences.vatCorrections.length, LEARNING_LIMIT);
  assert.match(s.preferences.vatCorrections[0].key, /x$/);
});

test('learnedVatRate : correspondance exacte, avec la base expliquée', () => {
  const s = withPrefs({vatCorrections: [{key: 'pressage balles rondes', label: 'Pressage balles rondes', rate: 10, count: 3, at: '2026-11-01'}]});
  const r = learnedVatRate(s, 'Pressage balles rondes 40 u');
  assert.equal(r.rate, 10);
  assert.equal(r.exact, true);
  assert.equal(r.confidence, 'learned');
  assert.match(r.basis, /3 fois/);
});

test('learnedVatRate : désignation apprise contenue dans une plus longue', () => {
  const s = withPrefs({vatCorrections: [{key: 'balles rondes', label: 'Balles rondes', rate: 10, count: 1}, {key: 'fauche', rate: 20, count: 1}]});
  assert.equal(learnedVatRate(s, 'Pressage balles rondes enrubannées').rate, 10);
  // Un seul mot appris ne s’étend pas aux désignations plus longues (trop large).
  assert.equal(learnedVatRate(s, 'Fauche et andainage'), null);
  assert.equal(learnedVatRate(s, 'Labour'), null);
});

test('learnedVatRate : préférences absentes ou abîmées sans erreur', () => {
  assert.equal(learnedVatRate({}, 'Fauche'), null);
  assert.equal(learnedVatRate(withPrefs({vatCorrections: 'x'}), 'Fauche'), null);
  assert.equal(learnedVatRate(withPrefs({vatCorrections: [null, {key: 'fauche', rate: 'abc'}]}), 'Fauche'), null);
});

const advice = (rule, parcelId, extra = {}) => ({id: `${rule}:${parcelId}`, rule, level: 'warning', entity: 'parcelles', entityId: parcelId, ...extra});

test('adviceKey : règle + parcelle', () => {
  assert.equal(adviceKey(advice('R3A', 'p1')), 'R3A|p1');
  assert.equal(adviceKey({rule: 'R1', entity: 'interventions', entityId: 'w1', parcelId: 'p2'}), 'R1|p2');
  assert.equal(adviceKey({kind: 'stock', id: 'stock:s1'}), 'stock|');
  assert.equal(adviceKey(null), '');
});

test('conseil rejeté deux fois : masqué pour la campagne', () => {
  const a = advice('R3A', 'p1'), today = '2026-11-12';
  let s = withPrefs({dismissedAdvice: recordAdviceDismissal(withPrefs({}), a, {today})});
  assert.equal(isAdviceHidden(s, a, {today}), false);
  s = withPrefs({dismissedAdvice: recordAdviceDismissal(s, a, {today})});
  assert.equal(isAdviceHidden(s, a, {today}), true);
  assert.equal(s.preferences.dismissedAdvice[0].campaign, '2026/27');
  // Autre parcelle : toujours montré.
  assert.equal(isAdviceHidden(s, advice('R3A', 'p2'), {today}), false);
});

test('nouvelle campagne : le conseil revient et le compteur repart à 1', () => {
  const a = advice('R4', 'p1');
  const s = withPrefs({dismissedAdvice: [{key: 'R4|p1', rule: 'R4', target: 'p1', campaign: '2025/26', count: 2, at: '2026-03-01'}]});
  assert.equal(isAdviceHidden(s, a, {today: '2026-09-01'}), false);
  assert.equal(recordAdviceDismissal(s, a, {today: '2026-09-01'})[0].count, 1);
});

test('filterHiddenAdvice : les conseils urgents restent visibles', () => {
  const s = withPrefs({dismissedAdvice: [{key: 'R3A|p1', campaign: '2026/27', count: 2}, {key: 'R3B|p1', campaign: '2026/27', count: 5}]});
  const out = filterHiddenAdvice(s, [advice('R3A', 'p1'), advice('R3B', 'p1', {level: 'urgent'}), advice('R6', 'p1')], {today: '2026-11-12'});
  assert.deepEqual(out.map(a => a.rule), ['R3B', 'R6']);
});

test('undoAdviceDismissal : annule le dernier « pas utile »', () => {
  const a = advice('R3A', 'p1');
  const s = withPrefs({dismissedAdvice: [{key: 'R3A|p1', campaign: '2026/27', count: 2}]});
  assert.equal(undoAdviceDismissal(s, a)[0].count, 1);
  assert.deepEqual(undoAdviceDismissal(withPrefs({dismissedAdvice: [{key: 'R3A|p1', count: 1}]}), a), []);
});

test('adviceKey : même règle et même parcelle donnent la même clé, quel que soit le travail', async () => {
  const {adviceKey: key} = await import('./learning.js');
  assert.equal(key({rule: 'R1', entity: 'interventions', entityId: 'w1', parcelId: 'p1'}), key({rule: 'R1', entity: 'interventions', entityId: 'w2', parcelId: 'p1'}));
});
