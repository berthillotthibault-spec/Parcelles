import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {versionFromBuild, compareVersions, entriesSince, whatsNewDecision, parseDraftKey, resumeTarget} from './whats-new.js';
import {BUILD_ID} from './utils.js';
import {draftKey} from './form-drafts.js';
import {createWhatsNewUI} from './whats-new-ui.js';

const catalog = JSON.parse(fs.readFileSync(new URL('./whatsnew.json', import.meta.url), 'utf8'));

test('whatsnew.json : 3 ou 4 puces par version, et une entrée pour la version publiée', () => {
  assert.ok(catalog.versions.length >= 2);
  for (const entry of catalog.versions) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.ok(entry.items.length >= 3 && entry.items.length <= 4, entry.version);
    for (const item of entry.items) assert.ok(item.length < 160 && !/[\u{1F300}-\u{1FAFF}]/u.test(item), item);
  }
  assert.ok(catalog.versions.some(entry => entry.version === versionFromBuild(BUILD_ID)), `ajouter ${versionFromBuild(BUILD_ID)} à whatsnew.json`);
  const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./whatsnew.json'"), 'whatsnew.json dans CORE');
});

test('versions et builds', () => {
  assert.equal(versionFromBuild('2026.10.10-v10.13.0'), '10.13.0');
  assert.equal(versionFromBuild('local-dev'), '');
  assert.equal(compareVersions('10.13.0', '10.9.9'), 1);
  assert.equal(compareVersions('10.12.0', '10.12.0'), 0);
  assert.equal(compareVersions('9.0.0', '10.0.0'), -1);
});

test('seules les versions entre le dernier build vu et le build courant sont montrées', () => {
  assert.deepEqual(entriesSince(catalog, '2026.10.08-v10.12.0', '2026.10.10-v10.13.0').map(e => e.version), ['10.13.0']);
  assert.deepEqual(entriesSince(catalog, '2026.10.01-v10.11.0', '2026.10.10-v10.13.0').map(e => e.version), ['10.13.0', '10.12.0']);
  assert.deepEqual(entriesSince(catalog, '2026.10.10-v10.13.0', '2026.10.10-v10.13.0'), []);
  assert.deepEqual(entriesSince(catalog, '', '2026.10.08-v10.12.0', {max: 1}).map(e => e.version), ['10.12.0']);
  assert.deepEqual(entriesSince(null, '', BUILD_ID), []);
  assert.deepEqual(entriesSince({versions: [{version: 'x', items: []}, {version: '1.0.0'}]}, '', '2.0.0'), []);
});

test('décision : premier lancement silencieux, utilisateur existant informé, même build ignoré', () => {
  assert.equal(whatsNewDecision({}, BUILD_ID), 'first');
  assert.equal(whatsNewDecision({onboardingComplete: true}, BUILD_ID), 'show');
  assert.equal(whatsNewDecision({lastSeenBuild: BUILD_ID}, BUILD_ID), 'none');
  assert.equal(whatsNewDecision({lastSeenBuild: 'ancien'}, BUILD_ID), 'show');
  assert.equal(whatsNewDecision({}, ''), 'none');
});

test('le brouillon à rouvrir après mise à jour est retrouvé depuis sa clé', () => {
  assert.deepEqual(parseDraftKey(draftKey('interventions', 'w1')), {type: 'interventions', id: 'w1', workspace: 'local'});
  assert.deepEqual(parseDraftKey(draftKey('tasks', null)), {type: 'tasks', id: null, workspace: 'local'});
  assert.deepEqual(parseDraftKey(draftKey('tasks', null, 'demo')), {type: 'tasks', id: null, workspace: 'demo'});
  assert.deepEqual(parseDraftKey(draftKey('interventions', 'w1', 'ferme_a')), {type: 'interventions', id: 'w1', workspace: 'ferme_a'});
  assert.equal(parseDraftKey('autre:clé'), null);
  assert.deepEqual(resumeTarget(['parcelles:draft:materiels:m1', draftKey('grazingSessions', 'g1')]), {type: 'grazingSessions', id: 'g1', workspace: 'local', key: 'parcelles:draft:grazingSessions:g1'});
  assert.equal(resumeTarget(['parcelles:draft:materiels:m1']), null);
});

// A3 : toast de mise à jour unique et activation automatique au passage en arrière-plan.
function fakeUI({dirty = false, tabReadOnly = null} = {}) {
  const toasts = [], form = {dataset: {edited: '1'}};
  const modalRoot = {classList: {contains: c => c === 'has-modal' && dirty}, querySelector: () => (dirty ? form : null)};
  const doc = {
    addEventListener() {},
    getElementById: id => (id === 'modal-root' ? modalRoot : null),
    querySelectorAll: () => [...toasts],
  };
  const toast = message => { const node = {firstChild: {textContent: message}, remove() { toasts.splice(toasts.indexOf(node), 1); }}; toasts.push(node); };
  const store = {tabReadOnly, schemaLock: null, snapshot: () => ({preferences: {}})};
  return {toasts, store, ui: createWhatsNewUI({store, modal() {}, closeModal() {}, toast, buildId: BUILD_ID, doc, win: {}})};
}
const fakeUpdate = () => { const u = {count: 0, activate() { u.count++; }}; return u; };

test('offer appelé deux fois : un seul toast, la dernière version remplace la précédente', () => {
  const {toasts, ui} = fakeUI(), first = fakeUpdate(), second = fakeUpdate();
  ui.offer(first); ui.offer(second);
  assert.equal(toasts.length, 1);
  ui.activate();
  assert.equal(first.count, 0); assert.equal(second.count, 1);
});

test('maybeAutoActivate : rien si un formulaire est modifié, si busy() est vrai ou si l’onglet est en lecture seule', () => {
  const dirty = fakeUI({dirty: true}), u1 = fakeUpdate(); dirty.ui.offer(u1);
  assert.equal(dirty.ui.maybeAutoActivate({busy: () => false}), false); assert.equal(u1.count, 0);
  const busy = fakeUI(), u2 = fakeUpdate(); busy.ui.offer(u2);
  assert.equal(busy.ui.maybeAutoActivate({busy: () => true}), false); assert.equal(u2.count, 0);
  assert.equal(busy.ui.maybeAutoActivate({writable: () => false}), false); assert.equal(u2.count, 0);
  const ro = fakeUI({tabReadOnly: 'Lecture seule'}), u3 = fakeUpdate(); ro.ui.offer(u3);
  assert.equal(ro.ui.maybeAutoActivate(), false); assert.equal(u3.count, 0);
});

test('maybeAutoActivate active une seule fois sinon, et ne fait rien sans version en attente', () => {
  const {ui} = fakeUI(), u = fakeUpdate();
  assert.equal(ui.maybeAutoActivate(), false);
  ui.offer(u);
  assert.equal(ui.maybeAutoActivate({writable: () => true, busy: () => false}), true);
  assert.equal(ui.maybeAutoActivate(), false);
  assert.equal(u.count, 1);
});

test('maybeAutoActivate : une nouvelle version annoncée après une activation sans effet peut être activée', () => {
  const {ui} = fakeUI(), first = fakeUpdate(), second = fakeUpdate();
  ui.offer(first); assert.equal(ui.maybeAutoActivate(), true);
  ui.offer(first); assert.equal(ui.maybeAutoActivate(), false, 'même version : une seule fois');
  ui.offer(second); assert.equal(ui.maybeAutoActivate(), true);
  assert.equal(first.count, 1); assert.equal(second.count, 1);
});

test('maybeAutoActivate : attend la fin de l’enregistrement en cours avant de recharger', async () => {
  const {ui, store} = fakeUI(), u = fakeUpdate();
  let finish;
  ui.offer(u);
  store.writePromise = new Promise(resolve => { finish = resolve; });
  assert.equal(ui.maybeAutoActivate(), true);
  await Promise.resolve();
  assert.equal(u.count, 0, 'pas de rechargement pendant l’écriture');
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(u.count, 1);
  assert.equal(ui.maybeAutoActivate(), false, 'une seule activation');
});

test('maybeAutoActivate : une saisie commencée pendant l’enregistrement annule l’activation', async () => {
  const {ui, store} = fakeUI(), u = fakeUpdate();
  let finish, busy = false;
  ui.offer(u);
  store.writePromise = new Promise(resolve => { finish = resolve; });
  assert.equal(ui.maybeAutoActivate({busy: () => busy}), true);
  busy = true; finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(u.count, 0);
  busy = false; store.writePromise = null;
  assert.equal(ui.maybeAutoActivate(), true, 'nouvel essai possible plus tard');
  assert.equal(u.count, 1);
});
