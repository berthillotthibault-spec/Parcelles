// n° 153 : cascade en couches (@layer) et jetons de couleur.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const LAYERS = ['reset', 'tokens', 'base', 'components', 'screens', 'features', 'theme', 'overrides'];
const VENDOR = new Set(['leaflet.min.css']);
const html = read('index.html');
const sheets = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"?]+\.css)(?:\?v=([\d.]+))?"/g)].map(m => ({file: m[1], v: m[2] || ''}));
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Règles de premier niveau : [{prelude, body}] (accolades équilibrées, chaînes ignorées).
function topLevel(css) {
  const out = []; let depth = 0, start = 0, open = -1, quote = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') { if (depth++ === 0) open = i; }
    else if (ch === '}') { if (--depth === 0) { out.push({prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i)}); start = i + 1; } }
    else if (ch === ';' && depth === 0) { out.push({prelude: css.slice(start, i).trim(), body: null}); start = i + 1; }
  }
  return out;
}

test('ordre des couches déclaré en tête de la première feuille chargée', () => {
  assert.equal(sheets[0].file, 'tokens.css', 'tokens.css est la première feuille liée');
  const first = topLevel(stripComments(read('tokens.css')))[0];
  assert.equal(first.body, null);
  assert.equal(first.prelude.replace(/\s+/g, ' '), `@layer ${LAYERS.join(', ')}`);
  assert.match(sheets.at(-1).file, /^design-v3\.css$/, 'design-v3.css reste la dernière feuille');
});

test('chaque feuille est entièrement rangée dans des couches connues', () => {
  for (const {file} of sheets) {
    for (const {prelude, body} of topLevel(stripComments(read(file)))) {
      if (body === null) { assert.match(prelude, /^@layer [\w, ]+$/, `${file} : instruction de premier niveau inattendue « ${prelude} »`); continue; }
      if (prelude.startsWith('@font-face')) continue;
      const m = prelude.match(/^@layer ([\w-]+)$/);
      assert.ok(m, `${file} : règle hors couche « ${prelude.slice(0, 60)} » (elle l'emporterait sur toutes les couches)`);
      assert.ok(LAYERS.includes(m[1]), `${file} : couche inconnue ${m[1]}`);
      assert.doesNotMatch(body, /@layer\s+[\w-]+\s*\{/, `${file} : @layer imbriqué (créerait une sous-couche ${m[1]}.x)`);
    }
  }
});

test('chaque feuille liée porte un ?v= (cache des navigateurs)', () => {
  assert.ok(sheets.length >= 15);
  for (const {file, v} of sheets) assert.ok(v, `${file} sans ?v=`);
});

test('variables de :root et variante sombre uniquement dans tokens.css', () => {
  for (const {file} of sheets) {
    if (file === 'tokens.css') continue;
    const css = stripComments(read(file));
    assert.doesNotMatch(css, /(^|[}\s])(:root|html)(\.theme-dark|\.theme-night)?\s*\{\s*--/m, `${file} définit des variables globales : les ranger dans tokens.css`);
  }
  const tokens = stripComments(read('tokens.css'));
  assert.equal(tokens.match(/:root\.theme-dark,\.theme-dark\{/g)?.length, 1, 'une seule variante sombre');
});

// Cliquet : nombre de couleurs hexadécimales hors tokens.css (et hors feuille vendor). Il peut baisser, jamais monter :
// une nouvelle couleur passe par un jeton de tokens.css (sémantique, ou palette fixe --c-*). Après une baisse, abaisser MAX_HEX.
const MAX_HEX = 189;
test(`couleurs codées en dur hors tokens.css : au plus ${MAX_HEX} (cliquet)`, () => {
  let count = 0; const detail = [];
  for (const {file} of sheets) {
    if (file === 'tokens.css' || VENDOR.has(file)) continue;
    const n = (stripComments(read(file)).match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    count += n; if (n) detail.push(`${file} ${n}`);
  }
  assert.ok(count <= MAX_HEX, `${count} couleurs hexadécimales hors tokens.css (plafond ${MAX_HEX}) : ${detail.join(', ')}`);
});
