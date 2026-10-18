// n° 21 - Mode gants : préférence, activation, barre du pouce et maintien de confirmation.
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLOVES_MODES,HOLD_CONFIRM_MS,DESTRUCTIVE_SELECTOR,normalizeGlovesMode,glovesActive,thumbActions,createHoldTracker,recordHoldConfirmation,consumeHoldConfirmation} from './gloves.js';
import {normalizePersonalization} from './personalization.js';
import {createGlovesUI} from './gloves-ui.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('préférence : désactivée par défaut, valeurs inconnues ramenées à off', () => {
  assert.deepEqual(GLOVES_MODES, ['off', 'on', 'field']);
  assert.equal(normalizeGlovesMode(undefined), 'off');
  assert.equal(normalizeGlovesMode('n’importe'), 'off');
  assert.equal(normalizeGlovesMode(true), 'on');
  assert.equal(normalizeGlovesMode('field'), 'field');
  assert.equal(normalizePersonalization({}).glovesMode, 'off');
  assert.equal(normalizePersonalization({glovesMode: 'field'}).glovesMode, 'field');
  assert.equal(normalizePersonalization({glovesMode: 42}).glovesMode, 'off');
});

test('activation : toujours, ou seulement en mode terrain', () => {
  assert.equal(glovesActive('off', {fieldModeOpen: true}), false);
  assert.equal(glovesActive('on'), true);
  assert.equal(glovesActive('field'), false);
  assert.equal(glovesActive('field', {fieldModeOpen: true}), true);
});

test('barre du pouce : actions primaires par écran, aucune en lecture seule ou sous une fenêtre', () => {
  const today = thumbActions('today');
  assert.ok(today.length >= 2 && today.length <= 3);
  assert.equal(today.at(-1).action, 'new-work', 'action principale sous le pouce (à droite)');
  assert.deepEqual(thumbActions('work').map(a => a.action), ['new-task', 'new-work']);
  assert.ok(thumbActions('parcels').some(a => a.action === 'new-parcel'));
  assert.deepEqual(thumbActions('more'), []);
  assert.deepEqual(thumbActions('today', {readOnly: true}), []);
  assert.deepEqual(thumbActions('today', {modalOpen: true}), []);
  assert.deepEqual(thumbActions('map', {fieldModeOpen: true}), []);
  for (const item of ['today', 'map', 'parcels', 'work'].flatMap(v => thumbActions(v))) assert.ok(item.label && item.icon);
  // Saisie express disponible : « J’ai fait » au milieu, trois boutons au plus, jamais sur la carte.
  assert.deepEqual(thumbActions('today', {quickWork: true}).map(a => a.action), ['open-field-mode', 'quick-work', 'new-work']);
  assert.deepEqual(thumbActions('work', {quickWork: true}).map(a => a.action), ['new-task', 'quick-work', 'new-work']);
  assert.deepEqual(thumbActions('parcels', {quickWork: true}).map(a => a.action), ['new-observation', 'quick-work', 'new-parcel']);
  assert.ok(!thumbActions('map', {quickWork: true}).some(a => a.action === 'quick-work'));
});

test('maintien : 600 ms sans glisser confirment, un glissement annule', () => {
  assert.equal(HOLD_CONFIRM_MS, 600);
  const hold = createHoldTracker();
  hold.start(100, 100, 0);
  assert.equal(hold.move(105, 104), true);
  assert.equal(hold.done(599), false);
  assert.equal(Math.round(hold.progress(300) * 100), 50);
  assert.equal(hold.done(600), true);
  hold.start(100, 100, 0);
  assert.equal(hold.move(140, 100), false);
  assert.equal(hold.active, false);
  assert.equal(hold.done(1000), false);
  assert.equal(hold.progress(1000), 0);
});

test('jeton de confirmation : consommé une seule fois et périmé après 1,5 s', () => {
  assert.equal(consumeHoldConfirmation(1000), false);
  recordHoldConfirmation(1000);
  assert.equal(consumeHoldConfirmation(1200), true);
  assert.equal(consumeHoldConfirmation(1300), false);
  recordHoldConfirmation(1000);
  assert.equal(consumeHoldConfirmation(4000), false);
});

test('câblage : module différé, hors connexion, confirmDelete et jetons CSS', () => {
  const app = read('./app.js'), css = read('./design-v3.css'), sw = read('./sw.js'), lazy = read('./lazy-modules.js'), ui = read('./personalization-ui.js');
  assert.ok(lazy.includes("gloves: () => import('./gloves-ui.js')"));
  assert.ok(!/from '\.\/gloves-ui\.js'/.test(app), 'gloves-ui.js reste chargé à la demande');
  for (const file of ['./gloves.js', './gloves-ui.js']) assert.ok(sw.includes(`'${file}'`), `${file} dans CORE`);
  assert.match(app, /function confirmDelete\([^)]*\)\{\s*\/\/[^\n]*\n\s*if\(consumeHoldConfirmation\(\)\)/);
  assert.ok(ui.includes('name="glovesMode"'));
  assert.match(css, /body\.gloves\{--a11y-hit:64px/);
  assert.match(css, /zoom:1\.15/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{body\.gloves \.is-holding::before\{animation:none/);
  // La jauge ne doit pas reprendre le disque de chargement de motion.css (.button[aria-busy]::before).
  assert.ok(!read('./gloves-ui.js').includes("setAttribute('aria-busy'"), 'pas d’aria-busy pendant le maintien');
  assert.match(css, /html\[data-view="map"\] body\.gloves\.has-thumb-bar \.toast-region\{bottom:calc\([^}]*--gloves-bar-h/);
  for (const part of DESTRUCTIVE_SELECTOR.split(',')) assert.ok(css.includes(part), `${part} stylé dans design-v3.css`);
});

// Faux document minimal : classes, attributs, closest() sur le sélecteur destructeur et écouteurs en capture.
function fakeDom({view = 'today', role = ''} = {}) {
  const listeners = {};
  const classList = () => { const set = new Set(); return {add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), toggle: (c, on) => (on ? set.add(c) : set.delete(c), on), contains: c => set.has(c)}; };
  const ids = new Map(), all = [];
  const el = (tag, attrs = {}) => {
    const node = {tagName: tag, classList: classList(), dataset: {}, attrs: {...attrs}, hidden: false, isConnected: true, disabled: false, innerHTML: '', clicks: 0,
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') ids.set(v, this); },
      getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
      set id(v) { this.setAttribute('id', v); }, get id() { return this.attrs.id; },
      append(child) { all.push(child); if (child.id) ids.set(child.id, child); },
      remove() { this.isConnected = false; ids.delete(this.id); },
      closest(sel) { return sel === DESTRUCTIVE_SELECTOR && this.tagName === 'button' && /^delete-/.test(this.id || '') ? this : null; },
      click() { this.clicks++; dispatch('click', {target: this}); }
    };
    if (attrs.id) ids.set(attrs.id, node);
    return node;
  };
  const dispatch = (type, init) => { const event = {type, button: 0, pointerId: 1, clientX: 10, clientY: 10, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...init}; for (const fn of listeners[type] || []) fn(event); return event; };
  const doc = {
    documentElement: {dataset: {view, role}}, body: el('body'),
    getElementById: id => ids.get(id) || null, createElement: tag => el(tag),
    querySelectorAll: sel => (sel === DESTRUCTIVE_SELECTOR ? [...ids.values()].filter(n => n.closest(sel)) : []),
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn)
  };
  doc.body.append = child => { all.push(child); if (child.id) ids.set(child.id, child); };
  return {doc, el, dispatch, all};
}

test('maintien dans le DOM : 600 ms suppriment sans fenêtre, appui court et clavier gardent la confirmation', () => {
  mock.timers.enable({apis: ['setTimeout']});
  try {
    const toasts = [], {doc, el, dispatch} = fakeDom();
    const ui = createGlovesUI({toast: m => toasts.push(m), doc});
    ui.apply('on');
    assert.equal(doc.body.classList.contains('gloves'), true);
    const button = el('button', {id: 'delete-work'});
    // Clavier / lecteur d'écran : clic sans appui suivi, propagé vers la fenêtre de confirmation.
    let click = dispatch('click', {target: button});
    assert.equal(click.stopped, false);
    assert.equal(consumeHoldConfirmation(), false);
    // Maintien complet : le bouton est déclenché une fois avec un jeton, le clic de relâchement est bloqué.
    dispatch('pointerdown', {target: button, pointerType: 'touch'});
    assert.equal(button.classList.contains('is-holding'), true);
    assert.equal(button.hasAttribute('aria-busy'), false, 'la jauge ne passe pas par aria-busy');
    mock.timers.tick(600);
    assert.equal(button.clicks, 1);
    assert.equal(button.classList.contains('is-holding'), false);
    assert.equal(consumeHoldConfirmation(), true, 'jeton inscrit');
    assert.equal(consumeHoldConfirmation(), false, 'jeton consommé une seule fois');
    dispatch('pointerup', {target: button});
    click = dispatch('click', {target: button});
    assert.equal(click.stopped, true, 'le relâchement ne rouvre pas la confirmation');
    // Appui court (ou double-tap d'un lecteur d'écran) : la confirmation s'ouvre, astuce montrée une fois.
    dispatch('pointerdown', {target: button, pointerType: 'touch'});
    mock.timers.tick(200);
    dispatch('pointerup', {target: button});
    click = dispatch('click', {target: button});
    assert.equal(click.stopped, false);
    assert.equal(consumeHoldConfirmation(), false);
    assert.equal(toasts.length, 1);
    dispatch('pointerdown', {target: button}); dispatch('pointerup', {target: button}); dispatch('click', {target: button});
    assert.equal(toasts.length, 1, 'astuce non répétée');
    // pointercancel (défilement) : aucun déclenchement.
    dispatch('pointerdown', {target: button});
    dispatch('pointercancel', {target: button});
    mock.timers.tick(1000);
    assert.equal(button.clicks, 1);
    assert.equal(consumeHoldConfirmation(), false);
    // Consigne exposée aux technologies d'assistance.
    ui.sync();
    assert.equal(button.getAttribute('aria-describedby'), 'gloves-hold-hint');
    assert.match(doc.getElementById('gloves-hold-hint').textContent, /Maintenir appuyé/);
  } finally { mock.timers.reset(); }
});

test('barre du pouce dans le DOM : présente pour un éditeur, absente en lecture seule', () => {
  const editor = fakeDom({view: 'work'});
  createGlovesUI({doc: editor.doc}).apply('on');
  const bar = editor.doc.getElementById('gloves-thumb-bar');
  assert.ok(bar && !bar.hidden);
  assert.match(bar.innerHTML, /data-action="new-work"/);
  assert.equal(editor.doc.body.classList.contains('has-thumb-bar'), true);
  const viewer = fakeDom({view: 'work', role: 'viewer'});
  createGlovesUI({doc: viewer.doc}).apply('on');
  assert.equal(viewer.doc.getElementById('gloves-thumb-bar'), null);
  assert.equal(viewer.doc.body.classList.contains('has-thumb-bar'), false);
  const off = fakeDom();
  const ui = createGlovesUI({doc: off.doc}); ui.apply('on'); ui.apply('off');
  assert.equal(off.doc.body.classList.contains('gloves'), false);
  assert.equal(off.doc.getElementById('gloves-hold-hint'), null);
});
