// Tests du registre auto-update.js et de la liste « Données de référence » (chantier A0).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoUpdater, fetchTextLimited, fetchJson, isSaveData, CACHE_PREFIX} from './auto-update.js';
import {referenceStatusHtml, referenceStatusLine} from './reference-status-ui.js';
import {referenceSectionHtml, referenceNothingCheckedMessage} from './diagnostic-ui.js';

const HOUR = 3600 * 1000;

function memStorage() {
  const map = new Map();
  return {map, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k)};
}

function setup({onlineFlag = true, check, validate, ttlMs = 24 * HOUR, timeoutMs, failBackoffMs, storage = memStorage(), when} = {}) {
  let t = Date.UTC(2026, 10, 12, 8);
  const clock = {now: () => t, advance: ms => { t += ms; }};
  let online = onlineFlag;
  const calls = {count: 0};
  const fetch = async () => ({ok: true, json: async () => ({})});
  const updater = createAutoUpdater({storage, fetch, now: clock.now, online: () => online});
  const def = {
    id: 'tarif', label: 'Tarif GNR', ttlMs, embedded: {value: 1, version: '2026-01', label: 'barème 2026'},
    check: async ctx => { calls.count++; return check ? check(ctx, calls.count) : {value: 2, version: 'v2', sourceDate: '2026-11-01'}; }
  };
  if (validate) def.validate = validate;
  if (timeoutMs) def.timeoutMs = timeoutMs;
  if (failBackoffMs) def.failBackoffMs = failBackoffMs;
  if (when) def.when = when;
  updater.register(def);
  return {updater, clock, calls, storage, fetch, setOnline: v => { online = v; }, def};
}

test('repli embarqué quand rien n’est en cache', () => {
  const {updater} = setup();
  const r = updater.get('tarif');
  assert.equal(r.value, 1);
  assert.equal(r.version, '2026-01');
  assert.equal(r.origin, 'embarque');
  assert.equal(r.stale, true);
  assert.equal(updater.value('tarif'), 1);
  assert.equal(updater.get('inconnu'), null);
});

test('résultat valide : mis en cache, origine réseau puis cache après rechargement', async () => {
  const {updater, storage, clock, def} = setup();
  const r = await updater.ensure('tarif');
  assert.equal(r.value, 2);
  assert.equal(r.origin, 'reseau');
  assert.equal(r.okAt, clock.now());
  assert.equal(r.stale, false);
  const saved = JSON.parse(storage.map.get(CACHE_PREFIX + 'tarif'));
  assert.equal(saved.value, 2);
  assert.equal(saved.sourceDate, '2026-11-01');
  const reloaded = createAutoUpdater({storage, fetch: async () => ({}), now: clock.now, online: () => true});
  reloaded.register(def);
  const again = reloaded.get('tarif');
  assert.equal(again.origin, 'cache');
  assert.equal(again.value, 2);
});

test('TTL respecté : pas de vérification si le cache est frais', async () => {
  const {updater, calls, clock} = setup({ttlMs: 2 * HOUR});
  await updater.ensure('tarif');
  clock.advance(HOUR);
  const r = await updater.ensure('tarif');
  assert.equal(r.skipped, 'frais');
  assert.equal(calls.count, 1);
  clock.advance(2 * HOUR);
  assert.equal(updater.get('tarif').stale, true);
  await updater.ensure('tarif');
  assert.equal(calls.count, 2);
  await updater.ensure('tarif', {force: true});
  assert.equal(calls.count, 3);
});

test('hors ligne : aucune vérification', async () => {
  const {updater, calls, setOnline} = setup({onlineFlag: false});
  const r = await updater.ensure('tarif', {force: true});
  assert.equal(r.skipped, 'hors-ligne');
  assert.equal(calls.count, 0);
  setOnline(true);
  await updater.ensure('tarif');
  assert.equal(calls.count, 1);
});

test('garde when() fausse : rien n’est lancé', async () => {
  const {updater, calls} = setup({when: () => false});
  const r = await updater.ensure('tarif');
  assert.equal(r.skipped, 'desactive');
  assert.equal(calls.count, 0);
});

test('échec : valeur conservée, erreur renseignée, backoff respecté', async () => {
  const {updater, calls, clock} = setup({ttlMs: HOUR, failBackoffMs: 10 * 60 * 1000,
    check: (_ctx, n) => { if (n === 1) return {value: 5, version: 'v5'}; throw new Error('http-503'); }});
  await updater.ensure('tarif');
  clock.advance(2 * HOUR);
  const failed = await updater.ensure('tarif');
  assert.equal(failed.value, 5);
  assert.equal(failed.error, 'http-503');
  assert.equal(failed.errorAt, clock.now());
  clock.advance(5 * 60 * 1000);
  const skipped = await updater.ensure('tarif');
  assert.equal(skipped.skipped, 'backoff');
  assert.equal(calls.count, 2);
  clock.advance(6 * 60 * 1000);
  await updater.ensure('tarif');
  assert.equal(calls.count, 3);
  assert.equal(updater.get('tarif').value, 5);
});

test('valeur rejetée par validate : pas d’écrasement', async () => {
  const {updater} = setup({validate: r => typeof r.value === 'number' && r.value > 0,
    check: (_ctx, n) => (n === 1 ? {value: 3, version: 'ok'} : {value: -1, version: 'bad'})});
  await updater.ensure('tarif');
  const r = await updater.ensure('tarif', {force: true});
  assert.equal(r.value, 3);
  assert.equal(r.version, 'ok');
  assert.equal(r.error, 'invalide');
});

test('résultat sans valeur ou exception de validate : rejeté', async () => {
  const {updater} = setup({validate: () => { throw new Error('boum'); }});
  const r = await updater.ensure('tarif');
  assert.equal(r.origin, 'embarque');
  assert.equal(r.value, 1);
  assert.equal(r.error, 'invalide');
});

test('timeout via AbortController', async () => {
  let aborted = false;
  const {updater} = setup({timeoutMs: 20, check: ({signal}) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; });
  })});
  const r = await updater.ensure('tarif');
  assert.equal(aborted, true);
  assert.equal(r.error, 'timeout');
  assert.equal(r.value, 1);
});

test('deux ensure() simultanés donnent un seul appel', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const {updater, calls} = setup({check: async () => { await gate; return {value: 9, version: 'v9'}; }});
  const a = updater.ensure('tarif'), b = updater.ensure('tarif');
  assert.equal(updater.status()[0].pending, true);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls.count, 1);
  assert.equal(ra.value, 9);
  assert.equal(rb.value, 9);
});

test('localStorage qui lève à chaque accès : cache en mémoire, pas de plantage', async () => {
  const throwing = {getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }};
  const {updater, calls} = setup({storage: throwing});
  assert.equal(updater.get('tarif').origin, 'embarque');
  const r = await updater.ensure('tarif');
  assert.equal(r.value, 2);
  await updater.ensure('tarif');
  assert.equal(calls.count, 1);
});

test('ensureAll : séquentiel, anti-rebond de 60 s par raison, notifications', async () => {
  const {updater, clock} = setup({ttlMs: 0});
  let running = 0, maxRunning = 0;
  updater.register({id: 'b', label: 'B', ttlMs: 0, embedded: {value: 0, version: 'e'},
    check: async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise(r => setTimeout(r, 5)); running--; return {value: 1}; }});
  updater.register({id: 'c', label: 'C', ttlMs: 0, embedded: {value: 0, version: 'e'},
    check: async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise(r => setTimeout(r, 5)); running--; return {value: 1}; }});
  let notified = 0;
  const off = updater.subscribe(list => { notified++; assert.ok(Array.isArray(list)); });
  const first = await updater.ensureAll({reason: 'start'});
  assert.equal(first.length, 3);
  assert.equal(maxRunning, 1);
  assert.ok(notified >= 6);
  clock.advance(1000);
  assert.deepEqual(await updater.ensureAll({reason: 'start'}), []);
  assert.equal((await updater.ensureAll({reason: 'online'})).length, 3);
  assert.equal((await updater.ensureAll({reason: 'start', force: true})).length, 3);
  clock.advance(60 * 1000);
  assert.equal((await updater.ensureAll({reason: 'start'})).length, 3);
  off();
});

function streamResponse(chunks, headers = {}) {
  let i = 0;
  let cancelled = false;
  return {
    ok: true, status: 200, headers: {get: k => headers[k.toLowerCase()] ?? null},
    body: {getReader: () => ({read: async () => (i < chunks.length ? {done: false, value: new TextEncoder().encode(chunks[i++])} : {done: true}),
      cancel: async () => { cancelled = true; }})},
    get cancelled() { return cancelled; }
  };
}

test('fetchTextLimited lève au-delà de maxBytes', async () => {
  const res = streamResponse(['abcd', 'efgh', 'ijkl']);
  await assert.rejects(fetchTextLimited(async () => res, 'u', {maxBytes: 6}), /too-large/);
  assert.equal(res.cancelled, true);
  assert.equal(await fetchTextLimited(async () => streamResponse(['ab', 'é']), 'u', {maxBytes: 10}), 'abé');
  await assert.rejects(fetchTextLimited(async () => streamResponse(['a'], {'content-length': '999'}), 'u', {maxBytes: 10}), /too-large/);
  await assert.rejects(fetchTextLimited(async () => ({ok: true, text: async () => 'x'.repeat(20)}), 'u', {maxBytes: 10}), /too-large/);
  await assert.rejects(fetchTextLimited(async () => ({ok: false, status: 404}), 'u'), /http-404/);
});

test('fetchJson : direct ou borné', async () => {
  assert.deepEqual(await fetchJson(async () => ({ok: true, json: async () => ({a: 1})}), 'u'), {a: 1});
  assert.deepEqual(await fetchJson(async () => streamResponse(['{"b":', '2}']), 'u', {maxBytes: 100}), {b: 2});
  await assert.rejects(fetchJson(async () => ({ok: false, status: 500}), 'u'), /http-500/);
});

test('isSaveData', () => {
  assert.equal(isSaveData({connection: {saveData: true}}), true);
  assert.equal(isSaveData({connection: {saveData: false}}), false);
  assert.equal(isSaveData({}), false);
  assert.equal(isSaveData(undefined), false);
});

test('referenceStatusHtml : à jour le, valeur embarquée, échec, échappement', () => {
  const okAt = new Date(2026, 10, 3, 12).getTime();
  const html = referenceStatusHtml([
    {id: 'gnr', label: 'Tarif <GNR>', origin: 'cache', okAt, version: 'v2', ttlMs: 10 * 24 * HOUR, stale: false, error: null},
    {id: 'ift"x', label: 'Doses IFT', origin: 'embarque', okAt: null, version: '2026-01', embeddedVersion: '2026-01', error: 'http-503'}
  ], okAt + HOUR);
  assert.match(html, /Données de référence/);
  assert.match(html, /à jour le 03\/11\/2026/);
  assert.match(html, /valeur embarquée \(2026-01\)/);
  assert.match(html, /vérification en échec/);
  assert.match(html, /Tarif &lt;GNR&gt;/);
  assert.match(html, /data-action="ref-refresh" data-id="gnr"/);
  assert.match(html, /data-id="ift&quot;x"/);
  assert.doesNotMatch(html, /<GNR>/);
  assert.equal(referenceStatusHtml([]), '');
  assert.match(referenceStatusLine({origin: 'cache', okAt, stale: true}, okAt), /à revérifier/);
});

test('section Diagnostic : absente sans registre, présente avec', async () => {
  assert.equal(referenceSectionHtml(undefined), '');
  const {updater} = setup();
  await updater.ensure('tarif');
  const html = referenceSectionHtml(updater, () => Date.UTC(2026, 10, 12, 7));
  assert.match(html, /id="ref-refresh-all"/);
  assert.match(html, /Tout vérifier/);
  assert.match(html, /Dernier contrôle de version/);
  assert.match(html, /Tarif GNR/);
  assert.doesNotMatch(referenceSectionHtml(updater), /Dernier contrôle/);
});

test('ensureAll hors ligne : l’anti-rebond de 60 s n’est pas consommé', async () => {
  const {updater, calls, setOnline} = setup({onlineFlag: false});
  const offline = await updater.ensureAll({reason: 'start'});
  assert.ok(offline.length && offline.every(r => r.skipped === 'hors-ligne'));
  setOnline(true);
  const again = await updater.ensureAll({reason: 'start'});
  assert.ok(again.length);
  assert.equal(calls.count, 1);
  assert.deepEqual(await updater.ensureAll({reason: 'start'}), []);
});

test('section Diagnostic : « Tout vérifier » désactivé pendant une vérification en cours', () => {
  const fake = pending => ({status: () => [{id: 'a', label: 'A', pending}]});
  assert.match(referenceSectionHtml(fake(true)), /id="ref-refresh-all" disabled/);
  assert.doesNotMatch(referenceSectionHtml(fake(false)), /id="ref-refresh-all" disabled/);
});

test('revue : durées undefined/NaN reprennent les valeurs par défaut (pas de délai immédiat)', async () => {
  const storage = memStorage();
  let t = Date.UTC(2026, 10, 12, 8), calls = 0;
  const updater = createAutoUpdater({storage, fetch: async () => ({}), now: () => t, online: () => true});
  updater.register({id: 'x', ttlMs: undefined, timeoutMs: undefined, failBackoffMs: Number.NaN, embedded: {value: 0},
    check: async () => { calls++; await new Promise(r => setTimeout(r, 5)); return {value: 1}; }});
  const r = await updater.ensure('x');
  assert.equal(r.value, 1);
  assert.equal(r.error, null);
  t += 3600 * 1000;
  assert.equal((await updater.ensure('x')).skipped, 'frais');
  assert.equal(calls, 1);
});

test('revue : horodatage dans le futur (horloge corrigée) = périmé, pas de backoff infini', async () => {
  const storage = memStorage();
  const future = Date.UTC(2030, 0, 1);
  storage.setItem(CACHE_PREFIX + 'tarif', JSON.stringify({value: 9, okAt: future, checkedAt: future, error: null, errorAt: null}));
  const {updater, calls} = setup({storage});
  assert.equal(updater.get('tarif').stale, true);
  await updater.ensure('tarif');
  assert.equal(calls.count, 1);
  const s2 = memStorage();
  s2.setItem(CACHE_PREFIX + 'tarif', JSON.stringify({checkedAt: future, error: 'http-503', errorAt: future}));
  const b = setup({storage: s2});
  assert.notEqual((await b.updater.ensure('tarif')).skipped, 'backoff');
  assert.equal(b.calls.count, 1);
});

test('revue : quota dépassé, la mémoire fait foi plutôt que l’ancienne entrée du stockage', async () => {
  const storage = memStorage();
  storage.setItem(CACHE_PREFIX + 'tarif', JSON.stringify({value: 5, version: 'ancienne', okAt: Date.UTC(2026, 0, 1), checkedAt: 1}));
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const {updater, calls} = setup({storage});
  const r = await updater.ensure('tarif');
  assert.equal(r.value, 2);
  assert.equal(r.version, 'v2');
  assert.equal((await updater.ensure('tarif')).skipped, 'frais');
  assert.equal(calls.count, 1);
});

test('revue : message quand aucune source n’est vérifiée', () => {
  assert.equal(referenceNothingCheckedMessage([]), 'Aucune source à vérifier.');
  assert.match(referenceNothingCheckedMessage([{skipped: 'desactive'}]), /désactivée/);
  assert.equal(referenceNothingCheckedMessage([{skipped: 'en-cours'}]), 'Vérification déjà en cours.');
});

test('TTL donné par un accesseur : relu à chaque vérification', async () => {
  let t = Date.UTC(2026, 10, 12, 8);
  let ttl = 7 * 24 * HOUR;
  let count = 0;
  const updater = createAutoUpdater({storage: memStorage(), fetch: async () => ({}), now: () => t, online: () => true});
  updater.register(Object.freeze({id: 'bcae', get ttlMs() { return ttl; }, check: async () => { count++; return {value: {year: 2026}}; }}));
  await updater.ensure('bcae');
  t += 2 * 24 * HOUR;
  await updater.ensure('bcae');
  assert.equal(count, 1, 'cache frais avec un TTL de 7 jours');
  ttl = 24 * HOUR;
  await updater.ensure('bcae');
  assert.equal(count, 2, 'TTL raccourci pris en compte sans nouvel enregistrement');
  assert.equal(updater.status()[0].ttlMs, 24 * HOUR);
});

test('requête coupée par la fermeture de la page : ni échec affiché ni backoff au démarrage suivant', async () => {
  const storage = memStorage();
  let leaving = false, calls = 0;
  const now = () => Date.UTC(2026, 10, 12, 8);
  const def = {id: 'rpg', check: async () => { calls++; if (leaving) throw new TypeError('Failed to fetch'); return {value: 2025}; }};
  const closing = createAutoUpdater({storage, fetch: async () => ({}), now, online: () => true, unloading: () => leaving}).register(def);
  leaving = true;
  await closing.ensure('rpg');
  assert.equal(storage.getItem(CACHE_PREFIX + 'rpg'), null);
  // Démarrage suivant : la source est revérifiée tout de suite (pas de « backoff ») et passe à jour.
  leaving = false;
  const next = createAutoUpdater({storage, fetch: async () => ({}), now, online: () => true, unloading: () => false}).register(def);
  const r = await next.ensure('rpg');
  assert.equal(r.skipped, null);
  assert.equal(r.value, 2025);
  assert.equal(r.error, null);
  assert.equal(calls, 2);
});

test('sans fenêtre, une vraie panne reste enregistrée (unloading par défaut à faux)', async () => {
  const storage = memStorage();
  const updater = createAutoUpdater({storage, fetch: async () => ({}), now: () => 1e12, online: () => true});
  updater.register({id: 'x', check: async () => { throw new Error('http-503'); }});
  assert.equal((await updater.ensure('x')).error, 'http-503');
});
