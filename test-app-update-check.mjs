import assert from 'node:assert/strict';
import {test} from 'node:test';

// Faux environnement navigateur : navigator.serviceWorker, document et window sont des EventTarget.
const doc = new EventTarget();
doc.visibilityState = 'visible';
doc.documentElement = {dataset: {}};
const win = new EventTarget();
const sw = new EventTarget();
sw.controller = {};
const nav = {onLine: true, serviceWorker: sw};
let registration = null;
sw.register = async () => registration;
Object.defineProperty(globalThis, 'navigator', {value: nav, configurable: true, writable: true});
Object.defineProperty(globalThis, 'document', {value: doc, configurable: true, writable: true});
Object.defineProperty(globalThis, 'window', {value: win, configurable: true, writable: true});
Object.defineProperty(globalThis, 'location', {value: {href: 'https://exemple.test/Parcelles/', reload() { location.reloads++; }, reloads: 0}, configurable: true, writable: true});

const {registerAppServiceWorker, lastUpdateCheck, UPDATE_CHECK_MIN_MS, UPDATE_CHECK_INTERVAL_MS} = await import('./runtime.js');

const MIN = 60 * 1000;
let clock = Date.UTC(2026, 10, 12, 8, 0);
function fakeRegistration({waiting = null, reject = false} = {}) {
  const r = new EventTarget();
  r.installing = null; r.waiting = waiting; r.updates = 0;
  r.update = () => { r.updates++; return reject ? Promise.reject(new Error('réseau')) : Promise.resolve(); };
  return r;
}
async function setup(opts = {}, regOpts = {}) {
  registration = fakeRegistration(regOpts);
  const intervals = [];
  const result = await registerAppServiceWorker({now: () => clock, setIntervalFn: (fn, ms) => { intervals.push({fn, ms}); return intervals.length; }, clearIntervalFn() {}, ...opts});
  return {result, registration, intervals};
}
const setVisibility = state => { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')); };

test('contrôle au démarrage, puis au passage en visible, limité à une fois par 15 min', async () => {
  clock += 60 * MIN; doc.documentElement.dataset.appReady = '1';
  const {result, registration: r, intervals} = await setup();
  assert.equal(r.updates, 1, 'contrôle au démarrage');
  assert.equal(lastUpdateCheck(), clock);
  clock += 5 * MIN; setVisibility('hidden'); setVisibility('visible');
  assert.equal(r.updates, 1, 'moins de 15 min : rien');
  clock += UPDATE_CHECK_MIN_MS; setVisibility('visible');
  assert.equal(r.updates, 2, 'visible après 15 min');
  assert.equal(lastUpdateCheck(), clock);
  clock += UPDATE_CHECK_MIN_MS; win.dispatchEvent(new Event('online'));
  assert.equal(r.updates, 3, 'retour du réseau');
  assert.equal(intervals[0].ms, UPDATE_CHECK_INTERVAL_MS);
  clock += UPDATE_CHECK_INTERVAL_MS; doc.visibilityState = 'hidden'; intervals[0].fn();
  assert.equal(r.updates, 3, 'minuteur sans effet si l’onglet est caché');
  doc.visibilityState = 'visible'; intervals[0].fn();
  assert.equal(r.updates, 4, 'minuteur, onglet visible');
  result.stop();
});

test('hors ligne : aucun appel à update()', async () => {
  clock += 60 * MIN; nav.onLine = false;
  const {result, registration: r} = await setup();
  clock += 60 * MIN; setVisibility('visible'); win.dispatchEvent(new Event('online'));
  assert.equal(r.updates, 0);
  nav.onLine = true; win.dispatchEvent(new Event('online'));
  assert.equal(r.updates, 1);
  result.stop();
});

test('update() rejeté : aucune exception', async () => {
  clock += 60 * MIN;
  const {result, registration: r} = await setup({}, {reject: true});
  clock += 60 * MIN; assert.doesNotThrow(() => setVisibility('visible'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(r.updates, 2);
  result.stop();
});

test('démarrage à froid avec une version en attente : activée tout de suite', async () => {
  clock += 60 * MIN; delete doc.documentElement.dataset.appReady;
  const posted = [], announced = [];
  const waiting = {postMessage: m => posted.push(m)};
  const {result} = await setup({onUpdate: u => announced.push(u)}, {waiting});
  assert.deepEqual(posted, [{type: 'SKIP_WAITING'}]);
  assert.equal(announced.length, 0);
  sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(location.reloads, 1, 'un seul rechargement');
  result.stop();
});

test('version en attente une fois l’appli prête, ou option coupée : annonce sans activation', async () => {
  for (const [ready, opts] of [['1', {}], [undefined, {autoActivateOnBoot: false}]]) {
    clock += 60 * MIN;
    if (ready) doc.documentElement.dataset.appReady = ready; else delete doc.documentElement.dataset.appReady;
    const posted = [], announced = [];
    const {result} = await setup({onUpdate: u => announced.push(u), ...opts}, {waiting: {postMessage: m => posted.push(m)}});
    assert.equal(posted.length, 0); assert.equal(announced.length, 1);
    result.stop();
  }
});

test('ordre réel d’app.js : markAppReady() juste après l’appel, sans attendre l’enregistrement', async () => {
  clock += 60 * MIN; delete doc.documentElement.dataset.appReady;
  const posted = [], announced = [];
  registration = fakeRegistration({waiting: {postMessage: m => posted.push(m)}});
  const pending = registerAppServiceWorker({onUpdate: u => announced.push(u), now: () => clock, setIntervalFn: () => 1, clearIntervalFn() {}, locks: null});
  doc.documentElement.dataset.appReady = '1'; // markAppReady() synchrone
  const result = await pending;
  assert.deepEqual(posted, [{type: 'SKIP_WAITING'}], 'le démarrage à froid est lu avant le premier await');
  assert.equal(announced.length, 0);
  result.stop();
});

test('démarrage à froid avec un autre onglet ouvert : annonce, pas d’activation', async () => {
  clock += 60 * MIN; delete doc.documentElement.dataset.appReady;
  const posted = [], announced = [];
  const locks = {query: async () => ({held: [{name: 'parcelles-writer'}], pending: [{name: 'parcelles-writer'}]})};
  const {result} = await setup({onUpdate: u => announced.push(u), locks}, {waiting: {postMessage: m => posted.push(m)}});
  assert.equal(posted.length, 0); assert.equal(announced.length, 1);
  result.stop();
  const alone = {query: async () => ({held: [{name: 'parcelles-writer'}, {name: 'autre'}], pending: []})};
  const posted2 = [];
  const second = await setup({locks: alone}, {waiting: {postMessage: m => posted2.push(m)}});
  assert.equal(posted2.length, 1, 'seul onglet : activation');
  second.result.stop();
});
