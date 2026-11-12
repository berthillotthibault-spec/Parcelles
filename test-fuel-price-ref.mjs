import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  parseFuelPrice, fuelPriceUrl, fuelSuggestion, fuelPriceHt, normalizeDept,
  createFuelPriceSource, fuelPriceSource, fuelRefNoteHtml, fuelRefConfirmHtml, FUEL_PRICE_ID
} from './fuel-price-ref.js';

const okResponse = body => ({ok: true, status: 200, json: async () => body});

test('parseFuelPrice : réponse normale', () => {
  assert.deepEqual(parseFuelPrice({results: [{p: 2.22894, maj: '2026-11-11T14:16:32+00:00'}]}), {price: 2.229, maj: '2026-11-11T14:16:32+00:00'});
  assert.deepEqual(parseFuelPrice({results: [{p: '1.9', maj: 'pas une date'}]}), {price: 1.9, maj: null});
});

test('parseFuelPrice : results vide ou absent', () => {
  assert.equal(parseFuelPrice({results: []}), null);
  assert.equal(parseFuelPrice({}), null);
  assert.equal(parseFuelPrice(null), null);
  assert.equal(parseFuelPrice({results: [{p: null}]}), null);
});

test('parseFuelPrice : valeur hors fourchette rejetée', () => {
  assert.equal(parseFuelPrice({results: [{p: 0.5}]}), null);
  assert.equal(parseFuelPrice({results: [{p: 4.5}]}), null);
  assert.equal(parseFuelPrice({results: [{p: 'abc'}]}), null);
  assert.ok(parseFuelPrice({results: [{p: 0.8}]}));
  assert.ok(parseFuelPrice({results: [{p: 4}]}));
});

test('URL avec et sans département', () => {
  const base = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?select=avg(gazole_prix)%20as%20p,max(gazole_maj)%20as%20maj&limit=1';
  assert.equal(fuelPriceUrl(), base);
  assert.equal(fuelPriceUrl('21'), `${base}&where=code_departement%3D%2221%22`);
  assert.equal(fuelPriceUrl('2a'), `${base}&where=code_departement%3D%222A%22`);
  assert.equal(fuelPriceUrl('1'), `${base}&where=code_departement%3D%2201%22`);
  assert.equal(fuelPriceUrl('21" or 1'), base, 'code invalide ignoré');
  assert.equal(normalizeDept('974'), '974');
  assert.equal(normalizeDept('00'), null);
  assert.equal(normalizeDept(''), null);
});

test('fuelSuggestion', () => {
  assert.equal(
    fuelSuggestion({price: 2.2289, maj: '2026-11-11T14:16:32+00:00', kind: 'gazole-routier'}),
    'Gazole routier du moment : 2,23 €/L TTC au 11/11 (le GNR est moins cher)');
  assert.equal(
    fuelSuggestion({price: 2.1, dept: '21', maj: null, kind: 'gazole-routier'}),
    'Gazole routier du moment (dép. 21) : 2,10 €/L TTC (le GNR est moins cher)');
  assert.equal(fuelSuggestion({price: 1.7, kind: 'defaut'}), '', 'valeur embarquée : pas de suggestion');
  assert.equal(fuelSuggestion(null), '');
  assert.equal(fuelPriceHt(2.23), 1.86);
});

test('check avec fetch simulé (national puis départemental)', async () => {
  const urls = [];
  const fetch = async (url, opts) => { urls.push(url); assert.ok(opts.signal === 'sig'); return okResponse({results: [{p: 2.2289, maj: '2026-11-11T14:16:32+00:00'}]}); };
  const national = await fuelPriceSource.check({fetch, signal: 'sig'});
  assert.deepEqual(national.value, {price: 2.229, dept: null, maj: '2026-11-11T14:16:32+00:00', kind: 'gazole-routier'});
  assert.equal(national.sourceDate, '2026-11-11T14:16:32+00:00');
  assert.ok(fuelPriceSource.validate(national));
  const local = createFuelPriceSource({getDept: () => '21'});
  const r = await local.check({fetch, signal: 'sig'});
  assert.equal(r.value.dept, '21');
  assert.match(urls[1], /code_departement%3D%2221%22$/);
  assert.equal(local.id, FUEL_PRICE_ID);
  assert.equal(local.ttlMs, 24 * 3600 * 1000);
  assert.deepEqual(local.embedded.value, {price: 1.7, kind: 'defaut'});
});

test('check : erreurs HTTP et valeur hors fourchette lèvent, validate rejette', async () => {
  await assert.rejects(fuelPriceSource.check({fetch: async () => ({ok: false, status: 503})}), /HTTP 503/);
  await assert.rejects(fuelPriceSource.check({fetch: async () => okResponse({results: [{p: 9}]})}), /hors fourchette/);
  assert.equal(fuelPriceSource.validate({value: {price: 9, kind: 'gazole-routier'}}), false);
  assert.equal(fuelPriceSource.validate({value: {price: 1.7, kind: 'defaut'}}), false);
});

test('check passe par fetchJson injecté (taille limitée)', async () => {
  let seen;
  const src = createFuelPriceSource({fetchJson: async (f, url, opts) => { seen = opts; return {results: [{p: 2}]}; }});
  const r = await src.check({fetch: () => {}, signal: null});
  assert.equal(r.value.price, 2);
  assert.equal(seen.maxBytes, 4096);
});

test('HTML de suggestion et de confirmation', () => {
  const value = {price: 2.2289, maj: '2026-11-11T14:16:32+00:00', kind: 'gazole-routier'};
  assert.equal(fuelRefNoteHtml({value: {price: 1.7, kind: 'defaut'}}), '');
  const note = fuelRefNoteHtml({value, stale: true});
  assert.match(note, /data-fuel-ref="use"/);
  assert.match(note, /Dernière valeur connue/);
  const confirm = fuelRefConfirmHtml(value);
  assert.match(confirm, /TTC/);
  assert.match(confirm, /data-fuel-ref="ht" data-price="1.86"/);
  assert.match(confirm, /data-fuel-ref="ttc" data-price="2.23"/);
  assert.match(confirm, /data-fuel-ref="cancel"/);
  assert.doesNotMatch(confirm + note, /#[0-9a-f]{3,6}\b/i, 'pas de couleur codée en dur');
});

test('le module n’écrit jamais dans preferences', async () => {
  const src = readFileSync(new URL('./fuel-price-ref.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /preferences|store\.|localStorage|setItem/);
  const state = {preferences: {fuelPrice: 1.5}};
  const frozen = JSON.stringify(state);
  await fuelPriceSource.check({fetch: async () => okResponse({results: [{p: 2.5}]}), state});
  assert.equal(JSON.stringify(state), frozen);
});

test('settings-ui : la suggestion ne remplit le champ qu’après confirmation', async () => {
  const {createSettingsUI} = await import('./settings-ui.js');
  const src = readFileSync(new URL('./settings-ui.js', import.meta.url), 'utf8');
  assert.match(src, /id="fuel-ref-slot"/);
  assert.equal(typeof createSettingsUI, 'function');
  // Aucune écriture du store dans le chemin de la suggestion.
  const block = src.slice(src.indexOf('function bindFuelRef'), src.indexOf('return {open};'));
  assert.doesNotMatch(block, /store\./);
});

// DOM minimal : seul le bloc #fuel-ref-slot et le champ fuelPrice sont simulés.
function fakeSettingsDoc() {
  const fuelInput = {value: '1.7', focused: false, focus() { this.focused = true; }};
  const btn = (step, price) => ({dataset: {fuelRef: step, ...(price != null ? {price: String(price)} : {})}, closest() { return this; }});
  const slot = {innerHTML: '', dataset: {}, onclick: null, querySelector: () => ({focus() {}})};
  const nodes = {
    '#fuel-ref-slot': slot,
    '#settings-form': {elements: {fuelPrice: fuelInput}},
    '#settings-search': {}, '#save-settings': {}, '#settings-search-empty': null
  };
  const doc = {querySelector: s => nodes[s] ?? null, querySelectorAll: () => []};
  return {doc, slot, fuelInput, click: (step, price) => slot.onclick({target: btn(step, price)})};
}

test('settings-ui : parcours Utiliser puis HT, sans écriture du store', async () => {
  const {createSettingsUI} = await import('./settings-ui.js');
  const {doc, slot, fuelInput, click} = fakeSettingsDoc();
  const writes = [];
  const store = new Proxy({}, {get: (_, k) => (...a) => { writes.push(k); }});
  let entry = {value: {price: 2.2289, maj: '2026-11-11T14:16:32+00:00', kind: 'gazole-routier'}, stale: false};
  let html = '';
  const ui = createSettingsUI({
    state: () => ({exploitation: {nom: 'Test'}, preferences: {fuelPrice: 1.7}}), store, sync: {}, toast() {}, renderAll() {}, closeModal() {},
    modal: (t, d, body) => { html = body; slot.innerHTML = body.match(/<div id="fuel-ref-slot"[^>]*>([\s\S]*?)<\/div><\/section>/)?.[1] ?? ''; },
    fuelRef: () => entry, refreshFuelRef: async () => {}, doc
  });
  ui.open();
  assert.match(html, /data-fuel-ref="use"/);
  click('use');
  assert.match(slot.innerHTML, /€\/L HT/);
  assert.equal(fuelInput.value, '1.7', 'rien n’est reporté avant le choix');
  await new Promise(r => setTimeout(r, 0));
  assert.match(slot.innerHTML, /data-fuel-ref="ht"/, 'le rafraîchissement n’efface pas la confirmation');
  click('ht', 1.86);
  assert.equal(fuelInput.value, '1.86');
  assert.match(slot.innerHTML, /Enregistrez pour l’appliquer/);
  click('cancel');
  assert.match(slot.innerHTML, /data-fuel-ref="use"/);
  assert.deepEqual(writes, [], 'aucune écriture du store sans « Enregistrer »');
  // Valeur embarquée seulement : aucun bloc.
  entry = {value: {price: 1.7, kind: 'defaut'}};
  ui.open();
  assert.doesNotMatch(html, /data-fuel-ref/);
});

test('fuelSuggestion : date de relevé aberrante dans le futur non affichée', () => {
  const now = Date.parse('2026-11-12T08:00:00Z');
  assert.equal(
    fuelSuggestion({price: 2.2, maj: '2027-03-15T10:00:00+00:00', kind: 'gazole-routier'}, {now}),
    'Gazole routier du moment : 2,20 €/L TTC (le GNR est moins cher)');
  assert.match(fuelSuggestion({price: 2.2, maj: '2026-11-12T07:09:27+00:00', kind: 'gazole-routier'}, {now}), /au 12\/11/);
});
