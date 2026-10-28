// Registre des actions (n° 147, fin du découpage du délégué de clics d'app.js) : aucun doublon entre les modules
// d'actions, et chaque data-action="…" littéral des fichiers servis a un gestionnaire connu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerActions, registeredActions, hasAction} from './actions.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const sw = read('sw.js');

// Modules d'actions enregistrés par app.js : import {table} from './x-actions.js' puis registerActions(table) dans init().
const MODULES = [...app.matchAll(/import \{(\w+)\} from '\.\/([\w-]+-actions\.js)';/g)]
  .filter(m => app.includes(`registerActions(${m[1]})`)).map(([, table, file]) => ({table, file}));

// Listes d'actions qu'app.js traite encore lui-même : elles viennent d'un module différé, connues une fois chargé.
const APP_LISTS = {'contour-edit-ui.js': 'CONTOUR_EDIT_ACTIONS', 'walk-measure-ui.js': 'WALK_ACTIONS', 'parcel-split-ui.js': 'SPLIT_ACTIONS'};

// Liste blanche documentée : data-action littéral traité par l'écouteur propre d'un module -ui (action: fichier qui le traite).
// Vide aujourd'hui : les modules -ui qui gèrent leurs propres boutons utilisent d'autres attributs (data-… dédiés).
// Toute entrée ajoutée doit rester exacte (affichée, non enregistrée, et citée par le fichier qui la traite).
const OTHER_DELEGATES = {};

async function tables() {
  const out = {};
  for (const {table, file} of MODULES) out[file] = (await import(`./${file}`))[table];
  return out;
}

// Fichiers servis : index.html et les .js de la liste CORE de sw.js, hors bibliothèques minifiées.
function servedFiles() {
  const core = [...new Set([...sw.matchAll(/'\.\/([^']+\.js)'/g)].map(m => m[1]))];
  return ['index.html', ...core.filter(file => fs.existsSync(path.join(root, file)) && !file.endsWith('.min.js'))];
}

test('modules d’actions : au moins les huit domaines, servis hors connexion', () => {
  const files = MODULES.map(m => m.file);
  for (const file of ['work-actions.js', 'parcel-actions.js', 'today-actions.js', 'map-actions.js', 'field-actions.js', 'farm-actions.js',
    'modules-actions.js', 'data-actions.js']) {
    assert.ok(files.includes(file), `${file} non enregistré par app.js`);
    assert.ok(sw.includes(`'./${file}'`), `${file} absent de CORE (sw.js)`);
  }
});

test('modules d’actions : aucune action enregistrée deux fois, ni restée dans le délégué d’app.js', async () => {
  const seen = new Map();
  for (const [file, table] of Object.entries(await tables())) {
    for (const [action, handler] of Object.entries(table)) {
      assert.equal(typeof handler, 'function', `${file} : ${action}`);
      assert.ok(!seen.has(action), `${action} : dans ${seen.get(action)} et ${file}`);
      seen.set(action, file);
      assert.doesNotMatch(app, new RegExp(`action===?'${action}'`), `${action} : branche encore présente dans app.js`);
    }
    // Le registre réel refuse un doublon (registerAction lève une erreur) : l'enregistrement complet doit passer.
    registerActions(table);
  }
  assert.equal(registeredActions().length, seen.size);
  assert.ok(seen.size > 250, `${seen.size} actions seulement`);
});

test('chaque data-action littéral des fichiers servis a un gestionnaire (registre, app.js ou liste blanche)', async () => {
  const registered = new Set(Object.values(await tables()).flatMap(table => Object.keys(table)));
  const appLists = new Set();
  for (const [file, name] of Object.entries(APP_LISTS)) {
    assert.ok(app.includes(`${name}.includes(action)`), `${name} : plus traitée par app.js`);
    for (const action of (await import(`./${file}`))[name]) appLists.add(action);
  }
  const rendered = new Map();
  for (const file of servedFiles()) {
    for (const m of read(file).matchAll(/data-action=\\?["']([a-z0-9-]+)\\?["']/g)) {
      if (!rendered.has(m[1])) rendered.set(m[1], new Set());
      rendered.get(m[1]).add(file);
    }
  }
  assert.ok(rendered.size > 200, `${rendered.size} data-action littéraux seulement : inventaire incomplet ?`);
  const missing = [...rendered].filter(([action]) => !registered.has(action) && !appLists.has(action) && !OTHER_DELEGATES[action])
    .map(([action, files]) => `${action} (${[...files].join(', ')})`);
  assert.deepEqual(missing, []);
  for (const [action, file] of Object.entries(OTHER_DELEGATES)) {
    assert.ok(rendered.has(action), `${action} : entrée obsolète (plus affichée)`);
    assert.ok(!registered.has(action) && !appLists.has(action), `${action} : entrée obsolète (désormais dans le registre ou app.js)`);
    assert.ok(read(file).replace(/data-action=\\?["'][a-z0-9-]+\\?["']/g, '').includes(`'${action}'`), `${action} : non traitée par ${file}`);
  }
  // Le registre ne connaît pas ce qui n'y a pas été inscrit.
  assert.equal(hasAction('action-inconnue-du-registre'), false);
});
