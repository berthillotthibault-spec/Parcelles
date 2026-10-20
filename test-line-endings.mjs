// Fins de ligne (n° 155) : le dépôt est normalisé en LF par .gitattributes ; un téléversement
// par le web depuis Windows peut réintroduire des CRLF, ce test le signale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const root = new URL('./', import.meta.url);
const TEXT = /\.(js|mjs|css|html|json|webmanifest|md|txt|yml|yaml|svg|xml|rules)$/i;

function trackedFiles(){
  try { return execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean); }
  catch { return null; }
}

test('.gitattributes impose LF et protège les binaires', () => {
  const attributes = fs.readFileSync(new URL('.gitattributes', root), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  for (const ext of ['png', 'woff2', 'zip', 'shp', 'dbf']) assert.match(attributes, new RegExp(`^\\*\\.${ext} binary$`, 'm'));
  assert.match(fs.readFileSync(new URL('.editorconfig', root), 'utf8'), /end_of_line = lf/);
});

test('aucun fichier texte suivi ne contient de retour chariot', t => {
  const files = trackedFiles();
  if (!files) return t.skip('git indisponible');
  const offenders = files.filter(file => TEXT.test(file) && fs.existsSync(new URL(file, root))
    && fs.readFileSync(new URL(file, root)).includes(13));
  assert.deepEqual(offenders, [], `CRLF présents : ${offenders.join(', ')}`);
});
