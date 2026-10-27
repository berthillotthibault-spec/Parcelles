import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {privacyServices, isLocalOnly, settingValue, ownLocalKeys, LOCAL_ITEMS} from './privacy.js';

const byId = (list, id) => list.find(s => s.id === id);

test('par défaut : cloud et assistant éteints, météo et carte décrites', () => {
  const list = privacyServices({}, {firebaseConfigured: true, satelliteEndpoint: 'https://x.workers.dev'});
  assert.equal(byId(list, 'cloud').state, 'off');
  assert.equal(byId(list, 'assistant').state, 'off');
  assert.equal(byId(list, 'weather').state, 'on');
  assert.match(byId(list, 'weather').recipient, /Open-Meteo/);
  assert.match(byId(list, 'map').recipient, /IGN/);
  assert.match(byId(list, 'satellite').data, /contour/);
  assert.equal(byId(list, 'satellite').state, 'ready');
  assert.ok(LOCAL_ITEMS.length >= 4);
});

test('états suivant les préférences', () => {
  const prefs = {syncEnabled: true, syncAttachments: true, remoteAiEnabled: true, remoteAiEndpoint: 'https://ia.example.org/a', weatherAutoRefresh: false};
  const list = privacyServices(prefs, {firebaseConfigured: true, cloudConnected: true, satelliteEndpoint: 'https://x'});
  assert.equal(byId(list, 'cloud').state, 'on');
  assert.equal(byId(list, 'attachments').state, 'on');
  assert.equal(byId(list, 'assistant').state, 'on');
  assert.match(byId(list, 'assistant').recipient, /ia\.example\.org/);
  assert.equal(byId(list, 'weather').state, 'on-demand');
  assert.equal(byId(list, 'satellite').state, 'on-demand');
});

test('badge 100 % local et interrupteurs', () => {
  assert.equal(isLocalOnly({}), true);
  assert.equal(isLocalOnly({syncEnabled: true}), false);
  assert.equal(isLocalOnly({remoteAiEnabled: true}), true);
  assert.equal(isLocalOnly({remoteAiEnabled: true, remoteAiEndpoint: 'https://a'}), false);
  const weather = byId(privacyServices({}), 'weather');
  assert.equal(settingValue({}, weather), true);
  assert.equal(settingValue({weatherAutoRefresh: false}, weather), false);
});

test('effacement : seules les clés de Parcelles sont visées', () => {
  assert.deepEqual(ownLocalKeys(['parcelles:weather', 'autre', 'parcelles.x', 'Parcelles-y']), ['parcelles:weather', 'parcelles.x', 'Parcelles-y']);
});

test('textes fidèles au code : hôtes réellement appelés', () => {
  const read = f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  assert.match(read('app.js'), /api\.open-meteo\.com/);
  assert.match(read('rpg.js'), /apicarto\.ign\.fr/);
  assert.match(read('satellite.js'), /operation:'series',geometry:parcel\.geometry/);
  assert.match(read('sync.js'), /if\(!prefs\.syncEnabled\)/);
  assert.match(read('app.js'), /weatherAutoRefresh!==false&&refreshWeather/);
});

test('« Tout effacer » ferme la session cloud et supprime la persistance Firebase', async () => {
  const {createPrivacyUI} = await import('./privacy-ui.js');
  const handlers = {}, deleted = [], calls = [];
  const el = id => ({value: id === '#privacy-wipe-word' ? 'EFFACER' : '', classList: {remove() {}, add() {}}, addEventListener: (type, fn) => {handlers[id] = fn;}});
  const saved = {document: globalThis.document, indexedDB: globalThis.indexedDB, location: globalThis.location};
  globalThis.document = {querySelector: el, querySelectorAll: () => []};
  globalThis.indexedDB = {deleteDatabase(name) {deleted.push(name); const req = {addEventListener() {}}; setTimeout(() => req.onsuccess?.(), 0); return req;}};
  globalThis.location = {reload() {calls.push('reload');}};
  try {
    const ui = createPrivacyUI({store: {}, state: () => ({preferences: {}}), modal() {}, closeModal() {}, toast() {}, getSync: () => ({signOut: async () => {calls.push(`signOut:${deleted.length}`);}})});
    ui.open();
    handlers['#privacy-wipe']();
    await handlers['#privacy-wipe-confirm']({currentTarget: {}});
    assert.deepEqual(calls, ['signOut:0', 'reload']);
    assert.ok(deleted.includes('firebaseLocalStorageDb'));
    assert.ok(deleted.includes('parcelles-app'));
  } finally {Object.assign(globalThis, saved);}
});

test('n° 114 : heures pointées et affectation des salariés citées, avec qui les voit (conseiller compris)', async () => {
  const {PEOPLE_ITEMS} = await import('./privacy.js');
  const hours = PEOPLE_ITEMS.find(i => /Heures pointées/.test(i.title));
  assert.ok(hours, 'rubrique heures pointées');
  assert.match(hours.text, /Démarrer \/ Terminer/);
  assert.match(hours.text, /confié/);
  for (const who of ['propriétaire', 'opérateur', 'comptabilité', 'lecteur', 'conseiller']) assert.match(hours.who, new RegExp(who));
  assert.ok(PEOPLE_ITEMS.some(i => /Bailleurs/.test(i.title)) && PEOPLE_ITEMS.some(i => /Riverains/.test(i.title)) && PEOPLE_ITEMS.some(i => i.title === 'Équipe'));
  // Fidèle au code : champs de team-work.js et lecture du conseiller dans firestore.rules.
  const tw = readFileSync(new URL('./team-work.js', import.meta.url), 'utf8'), rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
  assert.match(tw, /timeLog/); assert.match(tw, /assigneeName/);
  assert.match(rules, /function advisorReadable\(d\) \{\s*return d\.entityType in \['parcelles','interventions','tasks'/);
  const ui = readFileSync(new URL('./privacy-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /PEOPLE_ITEMS\.map/); assert.match(ui, /escapeHtml\(i\.who\)/);
});
