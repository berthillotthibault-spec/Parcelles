import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {THEMES, normalizeTheme, resolveTheme, themeColor, toggledTheme} from './theme.js';

test('Auto suit le système, Clair et Sombre l’imposent, Cabine de nuit est sombre', () => {
  assert.deepEqual(THEMES.map(t => t.label), ['Auto', 'Clair', 'Sombre', 'Cabine de nuit']);
  assert.deepEqual(resolveTheme('system', true), {theme: 'system', dark: true, night: false});
  assert.deepEqual(resolveTheme('system', false), {theme: 'system', dark: false, night: false});
  assert.equal(resolveTheme('light', true).dark, false);
  assert.equal(resolveTheme('dark', false).dark, true);
  assert.deepEqual(resolveTheme('night', false), {theme: 'night', dark: true, night: true});
  assert.equal(normalizeTheme('rose'), 'system'); assert.equal(normalizeTheme(undefined), 'system');
});

test('bascule rapide et couleur de barre', () => {
  assert.equal(toggledTheme('system', true), 'light');
  assert.equal(toggledTheme('system', false), 'dark');
  assert.equal(toggledTheme('night'), 'light');
  assert.equal(themeColor({dark: false}), '#f7f5f0');
  assert.notEqual(themeColor({dark: true, night: true}), themeColor({dark: true, night: false}));
});

test('le fond de carte est assombri en thème sombre et en cabine de nuit', () => {
  const css = fs.readFileSync(new URL('./design-v3.css', import.meta.url), 'utf8');
  assert.match(css, /\.theme-dark \.leaflet-tile-pane\{filter:brightness/);
  assert.match(css, /\.theme-night \.leaflet-tile-pane\{filter:brightness/);
  assert.match(css, /:root\.theme-night\{/);
});
