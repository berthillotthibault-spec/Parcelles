import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {ACTIVITY_MODULES, MODULE_IDS, TOOL_MODULES, normalizeActiveModules, isToolVisible, isModuleActive, filterTools, hiddenToolCount} from './activity-modules.js';
import {normalizePersonalization} from './personalization.js';
import {migrateData, emptyState} from './state.js';

test('par défaut tout est affiché, et cocher tous les modules revient à « tout afficher »', () => {
  assert.equal(normalizeActiveModules(undefined), 'all');
  assert.equal(normalizeActiveModules('all'), 'all');
  assert.equal(normalizeActiveModules([...MODULE_IDS]), 'all');
  assert.equal(normalizePersonalization({}).activeModules, 'all');
  assert.equal(migrateData(emptyState()).preferences.activeModules, 'all');
});

test('les identifiants inconnus ou dupliqués sont ignorés, une liste vide est conservée', () => {
  assert.deepEqual(normalizeActiveModules(['livestock', 'bad', 'livestock', 'crops']), ['crops', 'livestock']);
  assert.deepEqual(normalizeActiveModules([]), []);
  const data = emptyState(); data.preferences.activeModules = ['team', 'javascript:'];
  assert.deepEqual(migrateData(data).preferences.activeModules, ['team']);
});

test('table module → outils : phyto, azote, PAC, CIPAN, IFT et registre suivent les grandes cultures', () => {
  for (const action of ['open-phyto-register', 'open-phyto-catalog', 'ift-open', 'open-covers', 'open-nitrogen', 'open-pac', 'open-rotations']) {
    assert.ok(TOOL_MODULES[action].includes('crops'), action);
    assert.equal(isToolVisible(action, ['crops']), true, action);
    assert.equal(isToolVisible(action, ['contracting']), false, action);
  }
  assert.equal(isToolVisible('open-pac', ['livestock']), true, 'la PAC concerne aussi les éleveurs');
  assert.equal(isToolVisible('open-grazing', ['crops']), false);
  assert.equal(isToolVisible('open-grazing', ['livestock']), true);
  assert.equal(isToolVisible('open-public-works', ['contracting']), true);
  assert.equal(isToolVisible('new-machine-mission', ['precision']), true);
  assert.equal(isToolVisible('open-team-roles', ['team']), true);
  assert.equal(isToolVisible('open-team-roles', []), false);
});

test('les outils communs restent toujours visibles', () => {
  for (const action of ['new-work', 'open-documents', 'open-data-center', 'open-settings', 'open-help', 'open-equipment', 'open-stock', 'palette-map'])
    assert.equal(isToolVisible(action, []), true, action);
});

test('filterTools et hiddenToolCount ne modifient pas la liste source', () => {
  const items = [['A', '', 'open-grazing'], ['B', '', 'open-documents'], ['C', '', 'open-phyto-register']];
  const copy = structuredClone(items);
  assert.deepEqual(filterTools(items, ['crops']).map(i => i[0]), ['B', 'C']);
  assert.deepEqual(filterTools(items, 'all').length, 3);
  assert.equal(hiddenToolCount(items.map(i => i[2]), ['livestock']), 1);
  assert.deepEqual(items, copy);
  assert.equal(isModuleActive('livestock', 'all'), true);
  assert.equal(isModuleActive('livestock', ['crops']), false);
});

test('chaque outil de la table existe dans l’application et chaque module a un libellé', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  for (const action of Object.keys(TOOL_MODULES)) assert.ok(app.includes(`'${action}'`), action);
  for (const modules of Object.values(TOOL_MODULES)) for (const id of modules) assert.ok(MODULE_IDS.includes(id), id);
  assert.equal(ACTIVITY_MODULES.length, 5);
});
