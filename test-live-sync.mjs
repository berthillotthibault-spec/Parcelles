// Collaboration en temps réel (n° 136) avec un faux Firestore en mémoire qui sait faire onSnapshot.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './state.js';
import {SyncService} from './sync.js';
import {actorName, liveChangeMessage, summarizeChanges, relativeAgo, recordAuthors, modifiedByLabel, liveAllowed, createLiveSyncController} from './live-sync.js';

const WS = 'ws1';
if (!navigator.onLine) Object.defineProperty(navigator, 'onLine', {value: true, configurable: true});

// ---------- Faux Firestore (même sous-ensemble que test-sync-horloge.mjs, plus onSnapshot) ----------
class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } static fromMillis(ms) { return new Ts(ms); } }
const SERVER_TS = {serverTimestamp: true};
const plain = v => v instanceof Ts ? v.ms : v;
const copy = v => v instanceof Ts ? new Ts(v.ms) : Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v;
const resolve = (v, at) => v === SERVER_TS ? new Ts(at) : Array.isArray(v) ? v.map(x => resolve(x, at)) : v && typeof v === 'object' && !(v instanceof Ts) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, resolve(x, at)])) : v;
const snapshot = (id, data) => ({id, exists: data !== undefined, data: () => data === undefined ? undefined : copy(data)});
class FakeDb {
  constructor() { this.docs = new Map(); this.last = 0; this.listeners = new Set(); }
  commitTime() { this.last = Math.max(Date.now(), this.last + 1); return this.last; }
  collection(name) { return new FakeQuery(this, name); }
  async notify() { for (const l of [...this.listeners]) await l.push(); }
}
class FakeDocRef {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new FakeQuery(this.db, `${this.path}/${name}`); }
  async get() { return snapshot(this.id, this.db.docs.get(this.path)); }
  async set(data, {merge = false} = {}) { const v = resolve(data, this.db.commitTime()); this.db.docs.set(this.path, merge ? {...(this.db.docs.get(this.path) || {}), ...v} : v); await this.db.notify(); }
}
class FakeQuery {
  constructor(db, path, o = {}) { this.db = db; this.path = path; this.o = {filters: [], order: null, limit: null, after: null, ...o}; }
  with(c) { return new FakeQuery(this.db, this.path, {...this.o, ...c}); }
  doc(id = `auto${Math.random().toString(36).slice(2)}`) { return new FakeDocRef(this.db, `${this.path}/${id}`); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
  where(field, op, value) { return this.with({filters: [...this.o.filters, {field, op, value}]}); }
  orderBy(field, dir = 'asc') { return this.with({order: {field, dir}}); }
  limit(n) { return this.with({limit: n}); }
  startAfter(s) { return this.with({after: s}); }
  rows() {
    const prefix = `${this.path}/`;
    let rows = [...this.db.docs.entries()].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(([p, d]) => ({id: p.slice(prefix.length), d}));
    for (const {field, value} of this.o.filters) rows = rows.filter(r => r.d[field] != null && plain(r.d[field]) > plain(value));
    const key = r => this.o.order ? plain(r.d[this.o.order.field]) : r.id;
    if (this.o.order) rows = rows.filter(r => r.d[this.o.order.field] !== undefined);
    rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    if (this.o.after) { const k = this.o.order ? plain(this.o.after.data()[this.o.order.field]) : this.o.after.id; rows = rows.filter(r => key(r) > k || (key(r) === k && r.id > this.o.after.id)); }
    if (this.o.limit) rows = rows.slice(0, this.o.limit);
    return rows;
  }
  async get() { const rows = this.rows(); return {empty: !rows.length, docs: rows.map(r => snapshot(r.id, r.d))}; }
  onSnapshot(next) {
    const seen = new Map(), db = this.db;
    const listener = {push: async () => {
      const changes = [];
      for (const r of this.rows()) { const json = JSON.stringify(r.d); if (seen.get(r.id) !== json) { changes.push({type: seen.has(r.id) ? 'modified' : 'added', doc: snapshot(r.id, r.d)}); seen.set(r.id, json); } }
      if (changes.length || !listener.started) { listener.started = true; await next({metadata: {hasPendingWrites: false}, docChanges: () => changes}); }
    }};
    db.listeners.add(listener); listener.push();
    return () => db.listeners.delete(listener);
  }
}
const fakeFirebase = {firestore: {FieldValue: {serverTimestamp: () => SERVER_TS}, Timestamp: Ts}};
function memoryStorage() { const data = new Map(); return {data, async init() {}, async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; }, async getStored(k) { return this.get(k); }, async set(k, v) { data.set(k, structuredClone(v)); }, async setIfCurrent(k, v) { data.set(k, structuredClone(v)); }, async backupPut() {}, async pruneBackups() {}, async blobDelete() {}, async blobGet() { return null; }, async syncBaseGet(k) { return data.has(`base:${k}`) ? structuredClone(data.get(`base:${k}`)) : null; }, async syncBasePut(k, v) { data.set(`base:${k}`, structuredClone(v)); }}; }
function cloud() {
  const db = new FakeDb();
  db.docs.set(`workspaces/${WS}`, {name: 'Ferme', ownerUid: 'A'});
  db.docs.set(`workspaces/${WS}/members/A`, {uid: 'A', role: 'owner'});
  db.docs.set(`workspaces/${WS}/members/B`, {uid: 'B', role: 'editor'});
  return db;
}
async function device(db, name, email) {
  const store = new Store(memoryStorage());
  await store.init(); await store.setPreferences({syncEnabled: true, workspaceId: WS, syncAutoMerge: true});
  const sync = new SyncService(store);
  Object.assign(sync, {db, firebase: fakeFirebase, user: {uid: name, email}, deviceId: `dev-${name}`, status: {configured: true, connected: true, message: ''}});
  return {store, sync};
}
function environment() {
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  const win = new EventTarget(); win.navigator = {onLine: true};
  return {doc, win, hide() { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); }, show() { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); }};
}
const pause = ms => new Promise(r => setTimeout(r, ms));

test('textes : nom, verbe et libellé du travail', () => {
  assert.equal(actorName('paul.martin@ex.fr'), 'Paul');
  assert.equal(actorName('x@ex.fr', [{email: 'x@ex.fr', displayName: 'Xavier R.'}]), 'Xavier R.');
  const lookup = {parcelName: id => id === 'p1' ? 'Les Charmes' : ''};
  const before = {id: 'w1', type: 'Fauche', parcelId: 'p1', status: 'À faire'};
  assert.equal(liveChangeMessage({entityType: 'interventions', before, after: {...before, status: 'Terminé'}, modifiedEmail: 'paul@ex.fr'}, {lookup}), 'Paul a terminé “Fauche — Les Charmes”');
  assert.equal(liveChangeMessage({entityType: 'parcelles', before: null, after: {nom: 'Le Pré'}, modifiedEmail: 'ana@ex.fr'}), 'Ana a ajouté “Le Pré”');
  assert.equal(liveChangeMessage({entityType: 'tasks', before: {title: 'A'}, after: {title: 'A', deletedAt: 1}, modifiedEmail: 'ana@ex.fr'}), 'Ana a supprimé “A”');
  assert.equal(liveChangeMessage({entityType: 'tasks', after: {title: 'A'}, modifiedBy: 'B', deviceId: 'dev-B'}, {selfUid: 'B', deviceId: 'dev-B'}), null, 'pas de toast pour ses propres modifications');
  assert.equal(summarizeChanges([{entityType: 'tasks', after: {title: 'A'}, modifiedEmail: 'a@x'}, {entityType: 'tasks', after: {title: 'B'}, modifiedEmail: 'a@x'}]), 'A a ajouté “A” et 1 autre modification');
  assert.equal(relativeAgo(0, 61000), 'il y a 1 min');
  assert.equal(relativeAgo(1000, 1000), 'à l’instant');
});

test('« Modifié par … » : mémoire locale par espace, hors schéma', () => {
  const mem = new Map(), storage = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
  recordAuthors([{entityType: 'parcelles', entityId: 'p1', before: {}, after: {}, modifiedEmail: 'paul@ex.fr'}], {storage, workspaceId: WS, now: 1000});
  assert.equal(modifiedByLabel('parcelles', 'p1', {storage, workspaceId: WS, now: 61000}), 'Modifié par Paul il y a 1 min');
  assert.equal(modifiedByLabel('parcelles', 'p1', {storage, workspaceId: 'autre', now: 61000}), '');
});

test('conditions : premier plan, en ligne, connecté, option active et Wi-Fi si demandé', () => {
  const base = {visible: true, online: true, connected: true, serverCursor: 5, preferences: {syncEnabled: true}};
  assert.ok(liveAllowed(base));
  assert.ok(!liveAllowed({...base, visible: false}));
  assert.ok(!liveAllowed({...base, online: false}));
  assert.ok(!liveAllowed({...base, serverCursor: 0}), 'avant le premier pull complet, pas de temps réel');
  assert.ok(!liveAllowed({...base, preferences: {syncEnabled: true, syncLive: false}}));
  assert.ok(!liveAllowed({...base, networkOk: false}), 'Wi-Fi seulement sur réseau mobile');
  assert.ok(!liveAllowed({...base, readOnly: true}));
});

test('Wi-Fi seulement : networkAllows({live:true}) refuse le réseau mobile', async () => {
  const db = cloud(), b = await device(db, 'B', 'bob@ex.fr');
  await b.store.setPreferences({syncLiveWifiOnly: true});
  Object.defineProperty(navigator, 'connection', {value: {type: 'cellular'}, configurable: true});
  try { assert.equal(b.sync.networkAllows({live: true}), false); assert.equal(b.sync.networkAllows(), true); }
  finally { delete navigator.connection; }
});

test('temps réel : changement reçu par le chemin du pull, toast, curseur avancé, fermé en arrière-plan', async () => {
  const db = cloud(), a = await device(db, 'A', 'paul@ex.fr'), b = await device(db, 'B', 'bob@ex.fr');
  await a.store.upsert('parcelles', {id: 'p1', nom: 'Les Charmes', surfaceHa: 2});
  await a.store.upsert('interventions', {id: 'w1', parcelId: 'p1', type: 'Fauche', date: '2026-10-12', status: 'À faire'});
  await a.sync.sync({force: true});
  await b.sync.sync({force: true});
  assert.ok(b.sync.serverCursor > 0);
  const env = environment(), received = [];
  const live = createLiveSyncController({sync: b.sync, doc: env.doc, win: env.win, onChanges: changes => received.push(...changes)});
  assert.equal(live.refresh(), true, 'abonnement ouvert au premier plan');
  await pause(10); await live.idle();
  const cursorBefore = b.sync.serverCursor;

  await pause(5);
  await a.store.upsert('interventions', {...a.store.get('interventions', 'w1'), status: 'Terminé'});
  await a.sync.sync({force: true});
  await pause(10); await live.idle();
  assert.equal(b.store.get('interventions', 'w1').status, 'Terminé', 'appliqué sur B sans pull manuel');
  const msg = summarizeChanges(received, {lookup: {parcelName: id => b.store.get('parcelles', id)?.nom}, selfUid: 'B', deviceId: 'dev-B'});
  assert.equal(msg, 'Paul a terminé “Fauche — Les Charmes”');
  assert.ok(b.sync.serverCursor > cursorBefore, 'curseur serveur avancé');

  env.hide();
  assert.equal(live.active, false, 'fermé en arrière-plan');
  assert.equal(db.listeners.size, 0);
  env.show();
  assert.equal(live.active, true, 'rouvert au premier plan');
  live.stop();
  assert.equal(db.listeners.size, 0);
});

test('temps réel : modification locale non envoyée fusionnée, jamais écrasée ; ses propres écritures ignorées', async () => {
  const db = cloud(), a = await device(db, 'A', 'paul@ex.fr'), b = await device(db, 'B', 'bob@ex.fr');
  await a.store.upsert('tasks', {id: 't1', title: 'Clôture', notes: ''});
  await a.sync.sync({force: true});
  await b.sync.sync({force: true});
  const env = environment(), received = [];
  const live = createLiveSyncController({sync: b.sync, doc: env.doc, win: env.win, onChanges: c => received.push(...c)});
  live.refresh(); await pause(10); await live.idle();
  // B modifie les notes sans envoyer ; A change le titre.
  await b.store.upsert('tasks', {...b.store.get('tasks', 't1'), notes: 'Piquets à changer'});
  await pause(5);
  await a.store.upsert('tasks', {...a.store.get('tasks', 't1'), title: 'Clôture nord'});
  await a.sync.sync({force: true});
  await pause(10); await live.idle();
  const t = b.store.get('tasks', 't1');
  assert.equal(t.title, 'Clôture nord');
  assert.equal(t.notes, 'Piquets à changer', 'la saisie locale est conservée');
  assert.ok(received.some(c => c.merged), 'fusion à trois voies');
  // Écriture de B lui-même : aucun toast.
  received.length = 0;
  await b.sync.sync({force: true});
  await pause(10); await live.idle();
  assert.equal(received.filter(c => c.modifiedBy === 'B').length, 0);
  live.stop();
});
