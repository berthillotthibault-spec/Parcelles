// 10.40 : refonte visuelle (design-v4.css, couche refresh) : liaison, couche unique, verre sûr et replis.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(read('design-v4.css'));

// Règles feuilles : [{selector, body}] (les blocs @ sont traversés).
function rules(src) {
  const out = []; const stack = []; let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') { stack.push(src.slice(start, i).trim()); start = i + 1; }
    else if (src[i] === '}') { const sel = stack.pop(); if (sel && !sel.startsWith('@')) out.push({selector: sel, body: src.slice(start, i)}); start = i + 1; }
    else if (src[i] === ';' && !stack.length) start = i + 1;
  }
  return out;
}

test('design-v4.css existe, est liée juste avant design-v3.css et servie hors connexion', () => {
  assert.ok(fs.existsSync(new URL('./design-v4.css', import.meta.url)));
  const sheets = [...read('index.html').matchAll(/<link rel="stylesheet" href="\.\/([^"?]+)(?:\?v=[\d.]+)?"/g)].map(m => m[1]);
  assert.equal(sheets.at(-1), 'design-v3.css');
  assert.equal(sheets.at(-2), 'design-v4.css');
  assert.match(read('index.html'), /href="\.\/design-v4\.css\?v=[\d.]+"/);
  assert.ok(read('sw.js').includes("'./design-v4.css'"), 'design-v4.css dans CORE');
  assert.ok(read('runtime.js').includes("'./design-v4.css'"), 'design-v4.css dans REQUIRED_ASSETS');
});

test('un seul bloc @layer refresh, déclaré entre theme et overrides', () => {
  assert.equal(css.match(/@layer\b/g)?.length, 1);
  assert.match(css.trim(), /^@layer refresh\{[\s\S]*\}$/);
  assert.match(stripComments(read('tokens.css')), /@layer [^;]*\btheme, refresh, overrides;/);
});

test('aucune couleur hexadécimale dans design-v4.css', () => {
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
});

test('backdrop-filter : toujours doublé du préfixe -webkit-, jamais sur les listes, la carte ou Leaflet', () => {
  for (const {selector, body} of rules(css)) {
    const std = (body.match(/(^|[;\s{])backdrop-filter\s*:/g) || []).length;
    const webkit = (body.match(/-webkit-backdrop-filter\s*:/g) || []).length;
    assert.equal(webkit, std, `${selector} : -webkit-backdrop-filter manquant`);
    if (std) assert.doesNotMatch(selector, /\.list-row|#map|leaflet/, `${selector} : pas de flou sur les listes ni la carte`);
  }
});

test('tokens.css porte les replis du verre (transparence réduite, contraste, @supports)', () => {
  const tokens = stripComments(read('tokens.css'));
  assert.match(tokens, /prefers-reduced-transparency/);
  assert.match(tokens, /prefers-contrast/);
  assert.match(tokens, /@supports not \(\(backdrop-filter/);
  for (const t of ['--glass-bg', '--glass-bg-strong', '--glass-blur', '--glass-edge', '--glass-shadow', '--glass-tint', '--hero-glass-bg', '--bento-bg',
    '--soft-1', '--soft-2', '--soft-3', '--soft-highlight', '--radius-tile', '--radius-field', '--radius-sheet', '--fs-display', '--fs-kpi', '--fs-eyebrow', '--surface-sunken']) {
    assert.ok(tokens.includes(`${t}:`), `jeton ${t}`);
  }
});
