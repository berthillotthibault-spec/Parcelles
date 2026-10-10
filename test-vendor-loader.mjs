// n° 144 : chargement différé de SheetJS et shpjs (une seule injection, repli interne si échec).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {VENDORS, loadVendor} from './vendor-loader.js';

function fakeDoc() {
  const scripts = [];
  return {scripts, head: {append: s => scripts.push(s)}, createElement: () => ({dataset: {}, remove() {}})};
}

test('un seul script injecté, la promesse renvoie la bibliothèque', async () => {
  const doc = fakeDoc(), root = {};
  const a = loadVendor('xlsx', {doc, root}), b = loadVendor('xlsx', {doc, root});
  assert.equal(a, b);assert.equal(doc.scripts.length, 1);assert.equal(doc.scripts[0].src, './xlsx.full.min.js');
  root.XLSX = {read() {}};doc.scripts[0].onload();
  assert.equal(await a, root.XLSX);
  assert.equal(await loadVendor('xlsx', {doc, root}), root.XLSX);assert.equal(doc.scripts.length, 1);
});

test('échec de chargement : null (repli interne), nouvel essai possible ensuite', async () => {
  const doc = fakeDoc(), root = {};
  const first = loadVendor('shp', {doc, root});doc.scripts[0].onerror();
  assert.equal(await first, null);
  loadVendor('shp', {doc, root});assert.equal(doc.scripts.length, 2);
  assert.equal(await loadVendor('shp', {doc: undefined, root: {}}), null, 'sans DOM : null');
  await assert.rejects(loadVendor('inconnu', {doc, root}));
});

test('index.html ne charge plus les bibliothèques lourdes ; elles restent précachées, replis conservés', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8'), sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), runtime = fs.readFileSync(new URL('./runtime.js', import.meta.url), 'utf8');
  for (const {src} of Object.values(VENDORS)) {
    assert.ok(!html.includes(`src="${src}"`), `${src} encore chargé au démarrage`);
    assert.ok(sw.includes(`'${src}'`), `${src} absent de CORE`);assert.ok(runtime.includes(`'${src}'`), `${src} absent de REQUIRED_ASSETS`);
  }
  for (const file of ['./shapefile-fallback.js', './zip-lite.js', './vendor-loader.js']) assert.ok(sw.includes(`'${file}'`), file);
  const io = fs.readFileSync(new URL('./import-export.js', import.meta.url), 'utf8');
  assert.doesNotMatch(io, /window\.(XLSX|shp)\b/);
  assert.match(io, /spreadsheetRowsInternal\(buffer\)/);assert.match(io, /parseShpDbf|parseShapefileParts/);
});

test('écrans secondaires (factures, étiquettes QR) chargés par import() au premier clic', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  for (const file of ['invoices-ui.js', 'equipment-qr-ui.js']) {
    assert.doesNotMatch(app, new RegExp(`from '\\./${file.replace('.', '\\.')}'`), `${file} encore importé statiquement`);
    assert.match(app, new RegExp(`import\\('\\./${file.replace('.', '\\.')}'\\)`), `${file} : import() attendu`);
  }
});
