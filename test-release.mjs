import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs, buildString, setBuild, coverage, appendToList, CORE_RE, bumpCssVersion, bumpChangedCss, stylesheets, lazySheets, sheetVersions, bumpLazySheets, changelogEntry, whatsNewEntry, release, UPLOAD_EXCLUDE} from './tools/release.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

test('arguments : version obligatoire au format X.Y.Z', () => {
  assert.throws(() => parseArgs([]), /X\.Y\.Z/);
  assert.throws(() => parseArgs(['10.15']), /X\.Y\.Z/);
  const o = parseArgs(['v10.15.0', '--dry-run', '--upload-dir', '--date', '2026-10-11']);
  assert.equal(o.version, '10.15.0'); assert.ok(o.dryRun && o.uploadDir); assert.equal(o.date, '2026-10-11');
  assert.equal(buildString('10.15.0', '2026-10-11'), '2026.10.11-v10.15.0');
});

test('BUILD écrit aux 3 endroits en gardant les CRLF', () => {
  const out = setBuild({'sw.js': "const BUILD='x';\r\n", 'index.html': '<meta name="parcelles-build" content="x">\r\n', 'utils.js': "export const BUILD_ID = 'x';\r\n"}, 'B');
  assert.equal(out['sw.js'], "const BUILD='B';\r\n");
  assert.equal(out['index.html'], '<meta name="parcelles-build" content="B">\r\n');
  assert.equal(out['utils.js'], "export const BUILD_ID = 'B';\r\n");
});

test('le CORE du dépôt couvre modules, index.html, icônes et vendor', () => {
  const cov = coverage(root);
  assert.deepEqual(cov.missingOnDisk, []);
  assert.deepEqual(cov.missingCore, []);
  for (const f of ['./app.js', './icon-192.png', './xlsx.full.min.js', './shp.min.js', './layers.png', './instrument-sans-latin.woff2', './whatsnew.json', './sw-reminders.js', './lazy-styles.js', './billing-docs.css', './billing-hub.css']) assert.ok(cov.files.includes(f), f);
});

test('ajout à une liste : une ligne avant « ]; », fins de ligne conservées', () => {
  const src = "const CORE=[\r\n './a.js'\r\n];\r\n";
  const out = appendToList(src, CORE_RE, ['./b.js']);
  assert.equal(out, "const CORE=[\r\n './a.js'\r\n ,/* release */'./b.js'\r\n];\r\n");
  assert.equal(appendToList(out, CORE_RE, []), out);
  // Un commentaire « // … » en fin de liste n'avale pas la virgule.
  assert.equal(appendToList("const CORE=[\n './a.js' // note\n];\n", CORE_RE, ['./b.js']), "const CORE=[\n './a.js' // note\n ,/* release */'./b.js'\n];\n");
  assert.equal(appendToList("const CORE=[\n './a.js', // note\n];\n", CORE_RE, ['./b.js']), "const CORE=[\n './a.js', // note\n /* release */'./b.js'\n];\n");
});

test('?v= de design-v3.css monté une seule fois par rapport à la référence', () => {
  const base = '<link href="./design-v3.css?v=4.3">';
  const once = bumpCssVersion(base, base);
  assert.equal(once.to, '4.4'); assert.match(once.html, /v=4\.4/);
  assert.equal(bumpCssVersion(once.html, base).changed, false);
});

test('?v= monté pour chaque feuille modifiée, et seulement celles-là (n° 153)', () => {
  const base = '<link rel="stylesheet" href="./tokens.css?v=1">\n<link rel="stylesheet" href="./base.css?v=2">\n<link rel="stylesheet" href="./map.css">\n<link rel="stylesheet" href="./design-v3.css?v=4.8">';
  assert.deepEqual(stylesheets(base).map(s => s.file + ':' + s.v), ['tokens.css:1', 'base.css:2', 'map.css:', 'design-v3.css:4.8']);
  const once = bumpChangedCss(base, base, ['tokens.css', 'map.css', 'design-v3.css']);
  assert.match(once.html, /tokens\.css\?v=2"/); assert.match(once.html, /base\.css\?v=2"/);
  assert.match(once.html, /map\.css\?v=1"/); assert.match(once.html, /design-v3\.css\?v=4\.9"/);
  assert.equal(once.done.length, 3);
  // Relancé : rien ne bouge, sauf une feuille encore sans ?v=.
  assert.deepEqual(bumpChangedCss(once.html, base, ['tokens.css', 'map.css', 'design-v3.css']).done, []);
  // Le ?v= ajouté depuis la référence suffit (feuille sans ?v= dans la référence).
  assert.equal(bumpCssVersion('<link rel="stylesheet" href="./map.css?v=1">', '<link rel="stylesheet" href="./map.css">', 'map.css').changed, false);
  // Les ?v= d'index.html sont tous présents et chaque feuille liée existe.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const s of stylesheets(html)) { assert.ok(s.v, `${s.file} sans ?v=`); assert.ok(fs.existsSync(path.join(root, s.file)), s.file); }
});

test('?v= des feuilles différées (lazy-styles.js) monté une seule fois, depuis leur version d’index.html', () => {
  const src = "export const LAZY_SHEETS = Object.freeze({\n  'billing-docs.css': '1',\n  'billing-hub.css': '2.1'\n});\n";
  assert.deepEqual(lazySheets(src), [{file: 'billing-docs.css', v: '1'}, {file: 'billing-hub.css', v: '2.1'}]);
  // Référence : feuille encore liée par index.html (avant lazy-styles.js), ou constante de lazy-styles.js.
  const base = sheetVersions('<link rel="stylesheet" href="./billing-docs.css?v=1">', "export const LAZY_SHEETS = Object.freeze({'billing-hub.css': '2.1'});");
  assert.deepEqual([...base], [['billing-docs.css', '1'], ['billing-hub.css', '2.1']]);
  const once = bumpLazySheets(src, base, ['billing-docs.css', 'billing-hub.css', 'design-v3.css']);
  assert.match(once.src, /'billing-docs\.css': '2',/); assert.match(once.src, /'billing-hub\.css': '2\.2'\n/);
  assert.deepEqual(once.done, ['billing-docs.css ?v=1 → 2', 'billing-hub.css ?v=2.1 → 2.2']);
  // Relancé : rien ne bouge ; feuille non modifiée ou ajoutée depuis la référence : inchangée.
  assert.deepEqual(bumpLazySheets(once.src, base, ['billing-docs.css', 'billing-hub.css']).done, []);
  assert.equal(bumpLazySheets(src, base, ['billing-hub.css']).src.includes("'billing-docs.css': '1'"), true);
  assert.deepEqual(bumpLazySheets(src, new Map(), ['billing-docs.css']).done, []);
  // Le dépôt : chaque feuille différée a un ?v= et existe.
  for (const s of lazySheets(fs.readFileSync(path.join(root, 'lazy-styles.js'), 'utf8'))) { assert.ok(s.v, `${s.file} sans ?v=`); assert.ok(fs.existsSync(path.join(root, s.file)), s.file); }
});

test('CHANGELOG et whatsnew : entrée à compléter ajoutée une seule fois', () => {
  const md = '# Changelog\n\n## 10.14.0 · x — 2026-10-10\n';
  const a = changelogEntry(md, '10.15.0', '2026-10-11');
  assert.ok(a.changed); assert.ok(a.md.indexOf('## 10.15.0') < a.md.indexOf('## 10.14.0'));
  assert.equal(changelogEntry(a.md, '10.15.0', '2026-10-11').changed, false);
  const w = whatsNewEntry('{"versions":[{"version":"10.14.0","items":[]}]}', '10.15.0', '2026-10-11');
  const data = JSON.parse(w.json);
  assert.equal(data.versions[0].version, '10.15.0'); assert.equal(data.versions[0].items.length, 3);
  assert.equal(whatsNewEntry(w.json, '10.15.0', '2026-10-11').changed, false);
});

test('publication sur une copie : idempotente, et --dry-run n’écrit rien', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parcelles-release-'));
  try {
    for (const f of ['sw.js', 'index.html', 'utils.js', 'runtime.js', 'CHANGELOG.md', 'whatsnew.json', 'manifest.webmanifest', 'vendor-loader.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'app.js'), "import './utils.js';\n");
    const snap = () => ['sw.js', 'index.html', 'utils.js', 'runtime.js', 'CHANGELOG.md', 'whatsnew.json'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\0');
    const quiet = () => {};
    const before = snap();
    await release({root: dir, version: '99.0.0', dryRun: true, test: false, apply: true, base: 'ref-absente', date: '2026-10-11'}, quiet);
    assert.equal(snap(), before);
    const first = await release({root: dir, version: '99.0.0', dryRun: false, test: false, apply: true, base: 'ref-absente', date: ''}, quiet);
    assert.match(first.build, /-v99\.0\.0$/);
    const after = snap();
    assert.match(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), /const BUILD='[^']*-v99\.0\.0'/);
    const again = await release({root: dir, version: '99.0.0', dryRun: false, test: false, apply: true, base: 'ref-absente', date: ''}, quiet);
    assert.equal(snap(), after, 'une seconde exécution ne change rien');
    assert.equal(again.build, first.build);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('dossier d’upload : fichiers des assistants et CLAUDE.md exclus', () => {
  const excluded = rel => UPLOAD_EXCLUDE.some(re => re.test(rel));
  for (const rel of ['.claude/settings.json', '.cursor/x', '.kiro/y', 'CLAUDE.md', 'node_modules/a.js']) assert.ok(excluded(rel), rel);
  for (const rel of ['app.js', 'fixtures/backups/v17.json', 'tools/release.mjs', 'docs/CLAUDE.md']) assert.ok(!excluded(rel), rel);
});
