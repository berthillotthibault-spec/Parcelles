import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {versionFromBuild, compareVersions, entriesSince, whatsNewDecision, parseDraftKey, resumeTarget} from './whats-new.js';
import {BUILD_ID} from './utils.js';
import {draftKey} from './form-drafts.js';

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
  assert.deepEqual(parseDraftKey(draftKey('interventions', 'w1')), {type: 'interventions', id: 'w1'});
  assert.deepEqual(parseDraftKey(draftKey('tasks', null)), {type: 'tasks', id: null});
  assert.equal(parseDraftKey('autre:clé'), null);
  assert.deepEqual(resumeTarget(['parcelles:draft:materiels:m1', draftKey('grazingSessions', 'g1')]), {type: 'grazingSessions', id: 'g1', key: 'parcelles:draft:grazingSessions:g1'});
  assert.equal(resumeTarget(['parcelles:draft:materiels:m1']), null);
});
