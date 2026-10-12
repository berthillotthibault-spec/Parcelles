import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateIncoming, guessKinds, kindAccepts, SHARE_EXTENSIONS, SHARE_MAX_BYTES, SHARE_MAX_FILES, extensionOf} from './share-target.js';

const f = (name, size = 1000) => ({name, size});

test('types et tailles validés', () => {
  const {accepted, rejected} = validateIncoming([f('ilots.zip'), f('trace.GPX'), f('virus.exe'), f('vide.pdf', 0), f('gros.jpg', SHARE_MAX_BYTES + 1)]);
  assert.deepEqual(accepted.map(x => x.name), ['ilots.zip', 'trace.GPX']);
  assert.deepEqual(rejected.map(x => x.reason), ['type non pris en charge', 'fichier vide', 'plus de 25 Mo']);
  assert.equal(validateIncoming(Array.from({length: 12}, (_, i) => f(`p${i}.pdf`))).accepted.length, SHARE_MAX_FILES);
  assert.equal(extensionOf('a.b.KMZ'), 'kmz');
});

test('« C’est quoi ? » : proposition selon le fichier', () => {
  assert.equal(guessKinds([f('trace.gpx')])[0], 'trace');
  assert.equal(guessKinds([f('ilots.shp'), f('ilots.dbf.zip')])[0], 'contour');
  assert.equal(guessKinds([f('Facture-Agri-0425.pdf')])[0], 'facture');
  assert.equal(guessKinds([f('ordonnance_veto.jpg')])[0], 'ordonnance');
  assert.equal(guessKinds([f('Analyse terre labo.pdf')])[0], 'analyse');
  assert.deepEqual(guessKinds([f('scan.jpg')]), ['facture', 'ordonnance', 'analyse', 'document']);
  assert.equal(kindAccepts('contour', f('a.pdf')), false);
  assert.equal(kindAccepts('trace', f('a.gpx')), true);
  assert.equal(kindAccepts('facture', f('a.gpx')), false);
});

test('manifeste et service worker cohérents', () => {
  const m = JSON.parse(fs.readFileSync(new URL('./manifest.webmanifest', import.meta.url)));
  assert.equal(m.share_target.action, './share-target');
  assert.equal(m.share_target.method, 'POST');
  assert.equal(m.share_target.enctype, 'multipart/form-data');
  const accept = m.share_target.params.files[0].accept;
  for (const ext of SHARE_EXTENSIONS) assert.ok(accept.includes(`.${ext}`), ext);
  const handled = Object.values(m.file_handlers[0].accept).flat();
  for (const ext of SHARE_EXTENSIONS) assert.ok(handled.includes(`.${ext}`), ext);
  const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  const list = JSON.parse(sw.match(/const SHARE_EXTENSIONS=(\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(list, SHARE_EXTENSIONS, 'liste recopiée dans sw.js');
  assert.match(sw, /SHARE_MAX_BYTES=25\*1024\*1024,SHARE_MAX_FILES=10/);
  assert.match(sw, /req\.method==='POST'.*share-target/);
});
