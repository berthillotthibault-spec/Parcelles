// n° 161 : applis dans l'appli (apps.js, logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appAlerts, billingSummary} from './apps.js';
import {APPS, APP_IDS, DEFAULT_APP, appById, appForAction, appForView, appRoute, appTools, normalizeAppId, parseAppRoute, returnChip, startScreen, switchTarget, visibleApps} from './apps.js';
import {TOOL_MODULES} from './activity-modules.js';

test('les huit applis du découpage validé, Champs en premier', () => {
  assert.deepEqual(APP_IDS, ['champs', 'troupeau', 'facturation', 'materiel', 'gestion', 'reglementaire', 'tp', 'reglages']);
  assert.equal(DEFAULT_APP, 'champs');
  assert.equal(appById('inconnue').id, 'champs');
  assert.equal(normalizeAppId(42), 'champs');
});

test('chaque outil appartient à une seule appli et chaque action existe dans le catalogue', () => {
  const seen = new Map();
  for (const app of APPS) for (const action of app.tools) {
    assert.ok(!seen.has(action), `${action} est dans ${seen.get(action)} et ${app.id}`);
    seen.set(action, app.id);
  }
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  for (const action of seen.keys()) assert.match(source, new RegExp(`'${action}'`), `${action} absent de MORE_CATEGORIES`);
});

test('chaque barre d’appli a au plus 4 onglets et des actions connues', () => {
  const sources = ['farm-actions.js', 'field-actions.js', 'modules-actions.js', 'data-actions.js', 'work-actions.js', 'today-actions.js', 'parcel-actions.js', 'map-actions.js', 'assistant-actions.js']
    .map(f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).join('\n') + readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  for (const app of APPS) {
    assert.ok(app.tabs.length <= 4, app.id);
    for (const tab of [...app.tabs, app.plus].filter(Boolean)) {
      if (tab.view) assert.ok(['space', 'herd'].includes(tab.view), `${app.id} : vue ${tab.view}`);
      else assert.match(sources, new RegExp(`'${tab.action}'`), `${app.id} : action ${tab.action}`);
    }
  }
});

test('applis visibles : rôle et activités, Champs et Réglages toujours là', () => {
  assert.equal(visibleApps().length, APPS.length);
  const cropsOnly = action => !TOOL_MODULES[action] || TOOL_MODULES[action].includes('crops');
  const ids = visibleApps({isVisible: cropsOnly, livestock: false}).map(a => a.id);
  assert.ok(!ids.includes('troupeau'));
  assert.ok(!ids.includes('facturation'), 'facturation suit le module prestations');
  assert.ok(!ids.includes('tp'));
  assert.ok(ids.includes('champs') && ids.includes('reglages') && ids.includes('reglementaire'));
  assert.deepEqual(visibleApps({isVisible: () => false}).map(a => a.id), ['champs', 'reglages']);
});

test('appli propriétaire d’une action ou d’une vue', () => {
  assert.equal(appForAction('open-invoices'), 'facturation');
  assert.equal(appForAction('new-invoice'), 'facturation');
  assert.equal(appForAction('open-equipment'), 'materiel');
  assert.equal(appForAction('new-grazing'), 'troupeau');
  assert.equal(appForAction('open-rotations'), '', 'les outils de Champs ne font pas basculer');
  assert.equal(appForAction('new-work'), '', 'le « + » commun de Troupeau ne rend pas Troupeau propriétaire d’Ajouter');
  assert.equal(appForAction('open-herd-view'), 'troupeau');
  assert.equal(switchTarget({action: 'new-work'}, 'troupeau'), '', 'Ajouter depuis Troupeau reste dans Troupeau');
  assert.equal(switchTarget({action: 'new-work'}, 'facturation'), '');
  assert.equal(appForAction(''), '');
  assert.equal(appForView('herd'), 'troupeau');
  assert.equal(appForView('parcel'), 'champs');
  assert.equal(appForView('space'), '');
  assert.equal(appForView('more'), '');
});

test('bascule automatique : vers l’appli de l’action, jamais dans la même ni vers Réglages', () => {
  assert.equal(switchTarget({action: 'open-invoices'}, 'champs'), 'facturation');
  assert.equal(switchTarget({action: 'open-invoices'}, 'facturation'), '');
  assert.equal(switchTarget({action: 'new-invoice'}, 'facturation'), '');
  assert.equal(switchTarget({action: 'open-settings'}, 'facturation'), '', 'Réglages refuse la bascule');
  assert.equal(switchTarget({action: 'open-rotations'}, 'facturation'), '', 'un outil de Champs ne fait pas quitter l’appli');
  assert.equal(switchTarget({action: 'open-accounting-export'}, 'facturation'), 'gestion');
  assert.equal(switchTarget({view: 'parcels'}, 'facturation'), 'champs');
  assert.equal(switchTarget({view: 'parcels'}, 'champs'), '');
  assert.equal(switchTarget({view: 'herd'}, 'champs'), 'troupeau');
  assert.equal(switchTarget({view: 'herd'}, 'troupeau'), '');
  assert.equal(switchTarget({view: 'space'}, 'gestion'), '');
  assert.equal(switchTarget({action: 'open-invoices'}, 'champs', {visibleIds: ['champs', 'reglages']}), '', 'appli cachée : pas de bascule');
});

test('pastille de retour', () => {
  assert.deepEqual(returnChip('champs'), {app: 'champs', label: 'Retour à Champs'});
  assert.equal(returnChip('xx').app, 'champs');
});

test('outils d’une appli : ordre de l’appli, filtre et catalogue', () => {
  const catalog = [['Facturation', 'x', 'open-invoices', 'files'], ['Clients', 'y', 'open-clients', 'users'], ['Doublon', 'z', 'open-invoices', 'files']];
  assert.deepEqual(appTools('facturation', catalog).map(i => i[0]), ['Facturation', 'Clients']);
  assert.deepEqual(appTools('facturation', catalog, a => a !== 'open-clients').map(i => i[2]), ['open-invoices']);
  assert.deepEqual(appTools('gestion', catalog), []);
});

test('routes #app/<id>', () => {
  assert.equal(appRoute('gestion'), '#app/gestion');
  assert.equal(appRoute('??'), '#app/champs');
  assert.equal(parseAppRoute('app/facturation'), 'facturation');
  assert.equal(parseAppRoute('app/inconnue'), '');
  assert.equal(parseAppRoute('parcels'), '');
});

test('ouverture sur la dernière appli utilisée, si elle est encore visible', () => {
  assert.deepEqual(startScreen(null), {app: 'champs', view: 'today'});
  assert.deepEqual(startScreen('facturation'), {app: 'facturation', view: 'space'});
  assert.deepEqual(startScreen('troupeau'), {app: 'troupeau', view: 'herd'});
  assert.deepEqual(startScreen('troupeau', ['champs', 'reglages']), {app: 'champs', view: 'today'});
});

test('alertes rangées par appli (lignes de computeNotifications)', () => {
  const rows = [
    {id: 'maintenance-m1', level: 'urgent', entity: 'materiels'},
    {id: 'stock-s1', level: 'warning', entity: 'stockItems'},
    {id: 'deadline-certiphyto-x', level: 'warning', entity: 'regulated'},
    {id: 'grazing-open-g1', level: 'warning', entity: 'grazingSessions'},
    {id: 'backup-old', level: 'warning'},
    {id: 'task-overdue-t1', level: 'urgent', entity: 'tasks'}
  ];
  assert.deepEqual(appAlerts('materiel', rows).map(r => r.id), ['maintenance-m1']);
  assert.deepEqual(appAlerts('gestion', rows).map(r => r.id), ['stock-s1']);
  assert.deepEqual(appAlerts('reglementaire', rows).map(r => r.id), ['deadline-certiphyto-x']);
  assert.deepEqual(appAlerts('troupeau', rows).map(r => r.id), ['grazing-open-g1']);
  assert.deepEqual(appAlerts('reglages', rows).map(r => r.id), ['backup-old']);
  assert.deepEqual(appAlerts('champs', rows), [], 'Champs a son propre accueil');
  assert.deepEqual(appAlerts('materiel', [null, {}]), []);
});

test('résumé de la facturation : compteurs non nuls, montant en retard', () => {
  assert.deepEqual(billingSummary({}), []);
  const rows = billingSummary({reminders: [{}, {}], unbilled: [{}], quotes: [], recurring: [{}], lateTotal: 1080});
  assert.deepEqual(rows.map(r => [r.key, r.count]), [['reminders', 2], ['unbilled', 1], ['recurring', 1]]);
  assert.equal(rows[0].label, 'clients à relancer');
  assert.equal(rows[0].amount, 1080);
  assert.equal(rows[1].label, 'prestation à facturer');
});
