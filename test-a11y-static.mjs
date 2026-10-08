// Accessibilité téléphone : contrôles statiques (sans navigateur) des boutons-icônes, des fenêtres,
// des annonces VoiceOver, des tailles tactiles et de l’option « Plein champ ».
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {normalizePersonalization} from './personalization.js';

const read = file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const app = read('app.js'), html = read('index.html'), css = read('design-v3.css');
const allCss = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.css')).map(read).join('\n');
const served = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.js') && !f.startsWith('SOURCE_') && !f.endsWith('.min.js') && f !== 'support.js');

test('les boutons-icônes générés ont un aria-label', () => {
  const missing = [];
  for (const file of served) {
    const source = read(file);
    // Bouton dont le contenu n’est qu’une icône (${icon(…)}, <svg>…</svg>) ou un symbole (‹, ›, ×, ↑…).
    for (const m of source.matchAll(/<button\b([^>]*)>\s*((?:\$\{[a-zA-Z]*[iI]con\([^`<]*?\)\}|<svg[\s\S]*?<\/svg>|[^\w<]{0,3})\s*)<\/button>/g))
      if (!/aria-label(ledby)?=/.test(m[1])) missing.push(`${file} : ${m[0].slice(0, 90)}`);
  }
  assert.deepEqual(missing, []);
});

test('les boutons de index.html sans texte ont un nom accessible', () => {
  const missing = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, attrs, body]) => !body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim() && !/aria-label/.test(attrs))
    // Libellé écrit par le script au rendu (ex. pastille de filtre de la carte).
    .filter(([, attrs]) => { const id = attrs.match(/\bid="([^"]+)"/)?.[1]; return !(id && app.includes(`'#${id}'`)); })
    .map(([tag]) => tag.slice(0, 90));
  assert.deepEqual(missing, []);
});

test('modal() produit une vraie fenêtre : role dialog, aria-modal, titre, description et bouton Fermer nommé', () => {
  const body = app.slice(app.indexOf('function modal('), app.indexOf('function closeModal('));
  assert.match(body, /role="dialog" aria-modal="true" aria-labelledby="modal-title"/);
  assert.match(body, /aria-describedby="modal-description"/);
  assert.match(body, /class="modal-close" data-action="close-modal" aria-label="Fermer"/);
  assert.match(body, /lastFocused=document\.activeElement/, 'le déclencheur est mémorisé pour y rendre le focus');
  assert.match(app, /function closeModal\(\)\{[^\n]*lastFocused\.focus/, 'le focus revient au déclencheur à la fermeture');
});

test('le mode terrain est une fenêtre modale nommée, fermée par Échap, avec retour du focus', () => {
  const open = app.slice(app.indexOf('function openFieldMode('), app.indexOf('function openFieldMode(') + 1200);
  assert.match(open, /setAttribute\('role','dialog'\)/);
  assert.match(open, /setAttribute\('aria-modal','true'\)/);
  assert.match(open, /setAttribute\('aria-labelledby','field-mode-title'\)/);
  assert.match(app, /<h1 id="field-mode-title">/);
  assert.match(app, /if\(event\.key==='Escape'\)\{[^\n]*if\(fieldModeOpen\)\{?closeFieldMode\(\)/, 'Échap ferme le mode terrain');
  assert.match(app, /fieldReturnFocus\.focus/);
  assert.match(app, /const trapRoot=modalOpen\?\$\('#modal-root'\):fieldModeOpen\?\$\('#field-mode'\):null/, 'piège du focus dans la fenêtre ouverte');
});

test('annonces VoiceOver : une seule région vivante pour les messages, fenêtres non « live »', () => {
  assert.match(html, /id="live-region" class="sr-only" aria-live="polite"/);
  assert.doesNotMatch(html, /id="modal-root"[^>]*aria-live/);
  assert.doesNotMatch(html, /id="toast-root"[^>]*aria-live/);
  const toast = app.slice(app.indexOf('function toast('), app.indexOf('function routeHashForView('));
  assert.match(toast, /\$\('#live-region'\)/);
  assert.match(toast, /action\?9000:5200/, 'un message avec action (« Annuler ») reste plus longtemps');
});

test('onglets : role tab et aria-selected, pastilles : groupe nommé et aria-pressed', () => {
  assert.match(app, /function syncTabSemantics\(list\)\{[^\n]*setAttribute\('role','tablist'\)[^\n]*setAttribute\('role','tab'\)[^\n]*aria-selected/);
  assert.match(app, /watchTabSemantics\(\$\('#parcel-detail-tabs'\)\);watchTabSemantics\(\$\('#work-tabs'\)\)/);
  assert.doesNotMatch(app, /\[data-work-tab\]'\)\.forEach\(button=>\{[^}]*aria-pressed/);
  const chips = app.slice(app.indexOf('function bindChipChoices('), app.indexOf('function bindChipChoices(') + 900);
  assert.match(chips, /setAttribute\('role','group'\)/);
  assert.match(chips, /aria-labelledby/);
  assert.match(chips, /aria-pressed/);
});

test('noms accessibles qui contiennent le texte visible (WCAG 2.5.3)', () => {
  assert.doesNotMatch(html, /class="brand"[^>]*aria-label/);
  assert.doesNotMatch(html, /id="network-button"[^>]*aria-label/);
  assert.doesNotMatch(app, /class="crop-overview-body"[^>]*aria-label/);
  assert.doesNotMatch(read('soil-water-ui.js'), /class="soil-home"[^>]*aria-label/);
  assert.match(app, /class="review-bar" role="progressbar" aria-label="/);
});

test('zoom autorisé et encoche prise en compte', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.match(viewport, /viewport-fit=cover/);
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?![.\d])/);
  assert.match(allCss, /--safe-top:env\(safe-area-inset-top/);
  assert.match(css, /\.modal-footer\{[^}]*var\(--safe-bottom\)/);
  assert.match(css, /\.skip-link:focus\{top:calc\(12px \+ var\(--safe-top/);
});

test('design-v3.css : bloc « Accessibilité téléphone » (cibles, champs 16 px, contraste, Plein champ)', () => {
  const block = css.slice(css.indexOf('Accessibilité téléphone'));
  assert.ok(block.length > 1000, 'bloc présent en fin de fichier');
  assert.match(block, /:root\{--a11y-hit:44px;--field-border:/);
  assert.match(block, /\.modal-close\{width:var\(--a11y-hit\);height:var\(--a11y-hit\)/);
  assert.match(block, /select,textarea\)\{font-size:16px\}/, 'champs en 16 px : pas de zoom automatique sur iPhone');
  assert.match(block, /@media \(prefers-contrast:more\)/);
  assert.match(block, /:root\.plein-champ\{--a11y-hit:52px\}/);
  assert.match(block, /zoom:1\.12/);
});

test('option « Plein champ » : préférence facultative, désactivée par défaut, appliquée par une classe sur <html>', () => {
  assert.equal(normalizePersonalization({}).pleinChamp, false);
  assert.equal(normalizePersonalization({pleinChamp: true}).pleinChamp, true);
  assert.equal(normalizePersonalization({pleinChamp: 'oui'}).pleinChamp, false);
  const ui = read('personalization-ui.js');
  assert.match(ui, /name="pleinChamp"[^>]*>Grands boutons et texte plus lisible<\/label>/);
  assert.match(app, /classList\.toggle\('plein-champ',state\(\)\.preferences\.pleinChamp===true\)/);
});
