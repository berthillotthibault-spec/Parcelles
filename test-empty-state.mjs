// n° 35 : états vides illustrés (emptyState / emptyArt dans ui.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState, emptyArt, EMPTY_ART_NAMES} from './ui.js';

test('6 à 8 illustrations au trait, colorées par currentColor et masquées aux lecteurs d’écran', () => {
  assert.ok(EMPTY_ART_NAMES.length >= 6 && EMPTY_ART_NAMES.length <= 8, String(EMPTY_ART_NAMES.length));
  for (const name of ['tractor', 'fence', 'cow', 'furrow', 'cloud', 'box']) assert.ok(EMPTY_ART_NAMES.includes(name), name);
  for (const name of EMPTY_ART_NAMES) {
    const svg = emptyArt(name);
    assert.match(svg, /^<svg class="empty-art"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /fill="none"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}/i, 'pas de couleur codée en dur');
  }
  assert.equal(emptyArt('inconnu'), emptyArt('furrow'), 'repli sur le sillon');
});

test('emptyState échappe le texte et rend les actions en boutons délégués', () => {
  const out = emptyState({icon: 'tractor', title: 'Rien <b>', text: 'A & B', action: {label: 'Planifier', action: 'new-work'}});
  assert.match(out, /^<div class="empty-state empty-rich">/);
  assert.match(out, /<strong class="empty-title">Rien &lt;b&gt;<\/strong>/);
  assert.match(out, /<span class="empty-text">A &amp; B<\/span>/);
  assert.match(out, /<button type="button" class="button primary empty-action empty-write" data-action="new-work">Planifier<\/button>/);
  assert.doesNotMatch(out, /data-id=/, 'attributs vides omis');
});

test('plusieurs actions : la première seule est mise en avant, write:false reste visible en lecture seule', () => {
  const out = emptyState({action: [{label: 'Créer', action: 'new-parcel'}, {label: 'Importer', action: 'choose-import'}, false, {label: 'Effacer', action: 'clear-work-filters', write: false}]});
  assert.equal((out.match(/button primary/g) || []).length, 1);
  assert.equal((out.match(/button secondary/g) || []).length, 2);
  assert.match(out, /class="button secondary empty-action" data-action="clear-work-filters"/);
  assert.doesNotMatch(out, /empty-title|empty-text/);
});

test('variante compacte : une ligne, petit dessin, lien texte', () => {
  const out = emptyState({icon: 'check', text: 'Aucune alerte importante.', compact: true, action: {label: 'Noter', action: 'new-work', id: 'x"1'}});
  assert.match(out, /empty-rich is-compact/);
  assert.match(out, /width="28"/);
  assert.match(out, /class="text-button empty-action empty-write"/);
  assert.match(out, /data-id="x&quot;1"/);
  assert.equal(emptyState({text: 'x'}).includes('<button'), false);
});

test('états vides principaux branchés et masquage des actions en lecture seule', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{icon,emptyState\} from '\.\/ui\.js'/);
  for (const icon of ['tractor', 'fence', 'furrow', 'box']) assert.ok(app.includes(`emptyState({icon:'${icon}'`), icon);
  assert.match(fs.readFileSync(new URL('./grazing-ui.js', import.meta.url), 'utf8'), /emptyState\(\{icon:'cow'/);
  assert.match(fs.readFileSync(new URL('./activity-ui.js', import.meta.url), 'utf8'), /emptyState\(\{icon: 'search'/);
  const css = fs.readFileSync(new URL('./design-v3.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-role="viewer"\] \.empty-rich \.empty-write\{display:none\}/);
  assert.match(css, /prefers-reduced-motion:no-preference\)\{\.empty-rich/);
});

test('Travaux : la recherche texte compte comme un filtre actif et « Effacer les filtres » la vide', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(app, /const workFiltered=\(\)=>Boolean\(workFilters\.parcel\|\|workFilters\.type\|\|\$\('#work-search'\)\?\.value\.trim\(\)\)/);
  assert.match(app, /text:workFiltered\(\)\?/);
  assert.match(app, /workFiltered\(\)&&\{label:'Effacer les filtres',action:'clear-work-filters'/);
  assert.match(app, /action==='clear-work-filters'\)\{workFilters=\{parcel:'',type:''\};if\(\$\('#work-search'\)\)\$\('#work-search'\)\.value='';renderWork/);
});
