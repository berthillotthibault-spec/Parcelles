// Outillage de développement (n° 151) : lint ESLint, vérification de types tsc et types JSDoc.
// Contrôles statiques rapides ; `npm run lint` et `npm run typecheck` tournent à part (CI, tests.yml).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState} from './state.js';

const root = new URL('./', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const stripBlockComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '');

test('jsconfig : chaque module vérifié porte // @ts-check en tête', () => {
  const config = JSON.parse(read('jsconfig.json'));
  assert.equal(config.compilerOptions.checkJs, false, 'checkJs reste limité aux fichiers marqués // @ts-check');
  assert.equal(config.compilerOptions.noEmit, true);
  for (const module of ['state.js', 'grazing.js', 'yield.js', 'public-works.js', 'home-priorities.js'])
    assert.ok(config.files.includes(module), `${module} absent de jsconfig.json`);
  for (const file of config.files) {
    assert.ok(fs.existsSync(new URL(file, root)), `${file} introuvable`);
    assert.match(read(file), /^\/\/ @ts-check\r?\n/, `${file} : // @ts-check manquant en première ligne`);
  }
});

test('types.js : aucun code exécuté, aucun import depuis un module servi, hors CORE', () => {
  assert.equal(stripBlockComments(read('types.js')).replace(/^\s*\/\/.*$/gm, '').trim(), 'export {};');
  const served = fs.readdirSync(root).filter(f => f.endsWith('.js') && !f.endsWith('.min.js') && !['support.js', 'types.js', 'eslint.config.js'].includes(f));
  // Même en commentaire, « ./types.js » serait suivi par le graphe d'imports de tools/release.mjs : alias obligatoire.
  assert.deepEqual(served.filter(f => read(f).includes('./types.js')), [], "écrire import('parcelles/types'), pas './types.js'");
  assert.deepEqual(JSON.parse(read('jsconfig.json')).compilerOptions.paths['parcelles/types'], ['./types.js']);
  assert.ok(read('state.js').includes("import('parcelles/types').AppState"), 'emptyState() typé par AppState');
  for (const file of ['sw.js', 'runtime.js'])
    for (const devOnly of ['types.js', 'eslint.config.js', 'jsconfig.json'])
      assert.ok(!read(file).includes(`'./${devOnly}'`), `${devOnly} ne doit pas être précaché par ${file}`);
});

test('AppState décrit chaque clé de emptyState()', () => {
  const block = read('types.js').split('/**').find(comment => /\}\} AppState\s/.test(comment));
  assert.ok(block, 'typedef AppState introuvable');
  const typed = new Set([...block.matchAll(/^\s*\*\s+(\w+)\??:/gm)].map(m => m[1]));
  const state = emptyState();
  for (const key of typed) assert.ok(key in state, `AppState.${key} absent de emptyState()`);
  for (const key of ['version', 'exploitation', 'parcelles', 'interventions', 'tasks', 'grazingSessions', 'materiels', 'preferences', 'metadata', 'queue', 'journal'])
    assert.ok(typed.has(key), `AppState.${key} non décrit dans types.js`);
});

test('scripts lint / typecheck branchés dans package.json et la CI', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.lint, /^eslint \. --max-warnings \d+$/);
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit -p jsconfig.json');
  assert.ok(!pkg.scripts.test.includes('eslint') && !pkg.scripts.test.includes('tsc'), 'npm test reste rapide');
  for (const dep of ['eslint', '@eslint/js', 'globals', 'typescript']) assert.ok(pkg.devDependencies[dep], `${dep} en devDependency`);
  assert.ok(!pkg.dependencies, 'aucune dépendance d’exécution');
  const ci = read('.github/workflows/tests.yml');
  assert.match(ci, /run: npm run lint/);
  assert.match(ci, /run: npm run typecheck/);
});

test('eslint.config.js : règles demandées et vendors ignorés', async () => {
  const {default: config} = await import('./eslint.config.js');
  const ignores = config.find(entry => entry.ignores && Object.keys(entry).length === 1).ignores;
  for (const pattern of ['node_modules/**', 'audit/**', '*.min.js', 'support.js', 'Parcelles v3.dc.html']) assert.ok(ignores.includes(pattern), pattern);
  // Copies du dépôt sous .claude/worktrees et dossiers d'outillage locaux : jamais lintés (sinon des milliers de no-undef).
  for (const pattern of ['.claude/**', '.cursor/**', '.kiro/**', '**/worktrees/**']) assert.ok(ignores.includes(pattern), pattern);
  const rules = Object.assign({}, ...config.map(entry => entry.rules || {}));
  for (const rule of ['no-undef', 'no-unused-vars', 'no-shadow', 'eqeqeq', 'no-implicit-globals', 'prefer-const']) assert.ok(rules[rule], rule);
  assert.equal(rules['no-undef'], 'error');
  assert.deepEqual(rules.eqeqeq, ['error', 'smart']);
});
