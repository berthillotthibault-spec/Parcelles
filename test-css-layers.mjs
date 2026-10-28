// n° 153 : cascade en couches (@layer) et jetons de couleur.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {LAZY_SHEETS, loadSheet, sheetHref} from './lazy-styles.js';

const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const LAYERS = ['reset', 'tokens', 'base', 'components', 'screens', 'features', 'theme', 'overrides'];
const VENDOR = new Set(['leaflet.min.css']);
const html = read('index.html');
const linked = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"?]+\.css)(?:\?v=([\d.]+))?"/g)].map(m => ({file: m[1], v: m[2] || ''}));
// Feuilles différées (lazy-styles.js) : liées à l'ouverture de leur écran, juste avant design-v3.css.
const lazySheets = Object.entries(LAZY_SHEETS).map(([file, v]) => ({file, v}));
// Toutes les feuilles, dans l'ordre de la cascade.
const sheets = [...linked.slice(0, -1), ...lazySheets, ...linked.slice(-1)];
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
const MAX_HEX = 107;
test(`couleurs codées en dur hors tokens.css : au plus ${MAX_HEX} (cliquet)`, () => {
  let count = 0; const detail = [];
  for (const {file} of sheets) {
    if (file === 'tokens.css' || VENDOR.has(file)) continue;
    const n = (stripComments(read(file)).match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    count += n; if (n) detail.push(`${file} ${n}`);
  }
  assert.ok(count <= MAX_HEX, `${count} couleurs hexadécimales hors tokens.css (plafond ${MAX_HEX}) : ${detail.join(', ')}`);
});

// Feuilles différées (lazy-styles.js) : hors d'index.html, servies hors connexion, liées une fois à leur place.
test('feuilles différées : absentes d’index.html, dans CORE et REQUIRED_ASSETS, attendues par leur module', () => {
  const sw = read('sw.js'), runtime = read('runtime.js');
  assert.ok(lazySheets.length >= 2);
  for (const file of [...lazySheets.map(s => s.file), 'lazy-styles.js']) {
    assert.ok(!linked.some(s => s.file === file), `${file} ne doit plus bloquer le premier rendu (index.html)`);
    assert.ok(fs.existsSync(new URL(`./${file}`, import.meta.url)), file);
    assert.ok(sw.includes(`'./${file}'`), `${file} dans CORE`);
    assert.ok(runtime.includes(`'./${file}'`), `${file} dans REQUIRED_ASSETS`);
  }
  assert.match(read('billing-docs-ui.js'), /\nawait loadSheet\('billing-docs\.css'\);\n/);
  assert.match(read('billing-hub-ui.js'), /\nawait loadSheet\('billing-hub\.css'\);\n/);
  // Nouvel essai à chaque ouverture si la feuille a échoué au chargement du module.
  assert.match(read('billing-docs-ui.js'), /api\[name\] = \(\.\.\.args\) => \{ loadSheet\('billing-docs\.css'\);/);
  assert.match(read('billing-hub-ui.js'), /\n {4}loadSheet\('billing-hub\.css'\);\n/);
});

// Sélecteurs d'une règle, découpés aux virgules hors parenthèses.
const selectors = prelude => {
  const out = []; let depth = 0, cur = '';
  for (const ch of prelude) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  return [...out, cur.trim()];
};
test('feuilles différées : seulement des classes de leurs écrans ; ce qu’affichent l’accueil et la fiche client reste chargé', () => {
  const preludes = css => [...stripComments(css).matchAll(/([^{};]+)\{/g)].map(m => m[1].trim()).filter(p => !p.startsWith('@'));
  for (const {file} of lazySheets) {
    for (const prelude of preludes(read(file))) for (const sel of selectors(prelude)) assert.match(sel, /\.(bd|bh)(-|\b)/, `${file} : « ${sel} » toucherait des éléments hors de ses écrans`);
  }
  // Classes bd-/bh- employées par les autres modules (accueil, fiche client) : définies dans une feuille d'index.html.
  const staticCss = linked.map(s => stripComments(read(s.file))).join('\n');
  for (const f of fs.readdirSync(new URL('./', import.meta.url)).filter(n => n.endsWith('.js') && !n.startsWith('billing-'))) {
    for (const m of read(f).matchAll(/(?:^|[^\w.-])((?:bh|bd)-[a-z0-9-]+)/g)) assert.ok(staticCss.includes(`.${m[1]}`), `${f} : .${m[1]} doit rester dans une feuille d'index.html`);
  }
  for (const rule of ['.client-billing summary{', '.is-late{color:var(--danger)}']) assert.ok(staticCss.includes(rule), rule);
});

// Document minimal : <head> et ses <link>, insertion avant un nœud, événements load / error.
function fakeDoc(hrefs) {
  const head = {children: [], append(n) { n.parentNode = head; head.children.push(n); }, insertBefore(n, ref) { n.parentNode = head; head.children.splice(head.children.indexOf(ref), 0, n); }};
  const make = () => {
    const ev = {};
    const l = {rel: '', href: '', dataset: {}, sheet: null, getAttribute: k => (k === 'href' ? l.href : null), addEventListener: (t, fn) => { ev[t] = fn; }, fire: t => ev[t]?.(), remove: () => { head.children.splice(head.children.indexOf(l), 1); }};
    return l;
  };
  for (const h of hrefs) { const l = make(); l.rel = 'stylesheet'; l.href = h; head.append(l); }
  return {head, createElement: make,
    querySelector: sel => head.children.find(l => sel === `link[data-lazy-sheet="${l.dataset.lazySheet}"]`) || null,
    querySelectorAll: () => head.children.filter(l => l.rel === 'stylesheet'),
    files: () => head.children.map(l => l.href.replace(/^\.\//, '').split('?')[0])};
}

test('feuille différée : liée une fois, avec son ?v=, à sa place dans la cascade, attendue avec un délai maximal', async () => {
  const doc = fakeDoc(['./tokens.css?v=1', './personalization.css?v=1', './design-v3.css?v=4.9']);
  const hub = loadSheet('billing-hub.css', {doc, timeout: 1000});
  assert.equal(loadSheet('billing-hub.css', {doc}), hub, 'une seule insertion');
  const docs = loadSheet('billing-docs.css', {doc, timeout: 1000});
  // Même ordre que l'ancien index.html, quel que soit l'ordre d'ouverture des écrans.
  assert.deepEqual(doc.files(), ['tokens.css', 'personalization.css', 'billing-docs.css', 'billing-hub.css', 'design-v3.css']);
  const link = f => doc.head.children.find(l => l.dataset.lazySheet === f);
  assert.equal(link('billing-hub.css').href, sheetHref('billing-hub.css'));
  assert.equal(sheetHref('billing-hub.css'), `./billing-hub.css?v=${LAZY_SHEETS['billing-hub.css']}`);
  link('billing-hub.css').fire('load');
  assert.equal(await hub, true);
  // Erreur : lien retiré, nouvel essai à la prochaine ouverture.
  link('billing-docs.css').fire('error');
  assert.equal(await docs, false);
  assert.ok(!doc.files().includes('billing-docs.css'));
  const again = loadSheet('billing-docs.css', {doc, timeout: 5});
  assert.notEqual(again, docs);
  // Délai maximal dépassé : l'écran s'affiche ; le lien reste en place et s'appliquera à son arrivée.
  assert.equal(await again, false);
  assert.deepEqual(doc.files(), ['tokens.css', 'personalization.css', 'billing-docs.css', 'billing-hub.css', 'design-v3.css']);
  // Sans document (Node) ou feuille inconnue : rien n'est lié.
  assert.equal(await loadSheet('billing-hub.css', {doc: null}), false);
  assert.equal(await loadSheet('inconnue.css', {doc}), false);
});
