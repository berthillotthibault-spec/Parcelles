import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildProfileMenu, unassignedActions, farmSummary, normalizeQuery, PROFILE_GROUPS} from './profile-menu.js';

// Actions de MORE_CATEGORIES (app.js), y compris celles ajoutées par splice/push après la définition.
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('const MORE_CATEGORIES={');
const end = app.indexOf('function moreToolHtml', start);
const block = app.slice(start, end);
const catalog = [...block.matchAll(/\['([^']+)','([^']*)','([a-z-]+)','([\w-]+)'\]/g)].map(m => [m[1], m[2], m[3], m[4]]);

test('chaque outil de l’ancien « Plus » a sa place dans le menu profil', () => {
  assert.ok(catalog.length >= 59, `catalogue lu : ${catalog.length} entrées`);
  assert.deepEqual(unassignedActions(catalog.map(i => i[2])), []);
  const shown = buildProfileMenu(catalog).flatMap(g => g.items.map(i => i.action || i.view));
  for (const [, , action] of catalog) assert.ok(shown.includes(action), `${action} absent du menu`);
});

test('quatre groupes dans l’ordre, Planning et Personnaliser toujours là', () => {
  const groups = buildProfileMenu(catalog);
  assert.deepEqual(groups.map(g => g.title), ['Exploitation', 'Gestion', 'Réglementaire', 'Réglages']);
  assert.ok(groups[0].items.some(i => i.view === 'work'));
  assert.ok(groups[3].items.some(i => i.id === 'gloves' && i.action === 'personalize'));
  assert.equal(groups[3].items.find(i => i.action === 'open-farm').title, 'Agriculture de précision');
  assert.equal(PROFILE_GROUPS.length, 4);
});

test('filtre de rôle et d’activité appliqué comme dans « Plus »', () => {
  const hidden = new Set(['open-invoices', 'open-statistics']);
  const groups = buildProfileMenu(catalog, {visible: items => items.filter(i => !hidden.has(i[2]))});
  const actions = groups.flatMap(g => g.items.map(i => i.action));
  assert.ok(!actions.includes('open-invoices') && !actions.includes('open-statistics'));
  assert.ok(actions.includes('open-documents'));
});

test('outil inconnu : rangé dans « Autres outils » plutôt que perdu', () => {
  const groups = buildProfileMenu([...catalog, ['Nouveau', 'Essai', 'open-nouveau', 'tools']]);
  assert.equal(groups.at(-1).title, 'Autres outils');
  assert.equal(groups.at(-1).items[0].action, 'open-nouveau');
});

test('recherche sans accents sur libellé, sous-titre et groupe', () => {
  const found = buildProfileMenu(catalog, {query: 'phyto'}).flatMap(g => g.items.map(i => i.action));
  assert.ok(found.includes('open-phyto-register') && found.includes('open-phyto-catalog'));
  assert.ok(buildProfileMenu(catalog, {query: 'tresorerie'}).flatMap(g => g.items).some(i => i.action === 'open-treasury'));
  assert.deepEqual(buildProfileMenu(catalog, {query: 'zzzz'}), []);
  assert.equal(normalizeQuery('  Équipe & synchro '), 'equipe synchro');
});

test('sous-ligne de l’en-tête', () => {
  assert.equal(farmSummary({area: 60.46, parcels: 8, animals: 55}), '60,5 ha · 8 parcelles · 55 animaux');
  assert.equal(farmSummary({area: 4, parcels: 1}), '4 ha · 1 parcelle');
  assert.equal(farmSummary({area: 4, parcels: 2, animals: 1}), '4 ha · 2 parcelles · 1 animal');
});
