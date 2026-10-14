// n° 118 : exploitation de démonstration (demo-farm.js) et espace séparé du Store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDemoFarm, DEMO_FARM_NAME, DEMO_WORKSPACE_ID} from './demo-farm.js';
import {Store, migrateData, emptyState, externalBackupStatus, isDemoState} from './state.js';
import {APP_VERSION, ENTITY_TYPES, campaignFor, validateIntervention, validateParcel} from './utils.js';
import {parcelMargin} from './pilotage.js';
import {SyncService, DEMO_SYNC_MESSAGE} from './sync.js';

const REF = '2026-10-14';
const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY);
const active = (data, type) => data[type].filter(x => !x.deletedAt);
const PENDING = ['À faire', 'Planifié', 'En cours'];

test('même date de référence : mêmes données', () => {
  assert.deepEqual(buildDemoFarm(REF), buildDemoFarm(REF));
  assert.deepEqual(buildDemoFarm(new Date(`${REF}T08:00:00`)), buildDemoFarm(new Date(`${REF}T22:00:00`)));
});

test('structure valide après migrateData, sans rien perdre', () => {
  const demo = buildDemoFarm(REF), migrated = migrateData(demo);
  assert.equal(migrated.version, APP_VERSION);
  for (const type of ENTITY_TYPES) {
    assert.ok(Array.isArray(migrated[type]), `${type} manquant`);
    assert.deepEqual(migrated[type].map(x => x.id), (demo[type] || []).map(x => x.id), type);
  }
  for (const key of Object.keys(emptyState().preferences)) assert.ok(key in demo.preferences, `préférence ${key} manquante`);
  for (const key of Object.keys(emptyState().metadata)) assert.ok(key in demo.metadata, `métadonnée ${key} manquante`);
  assert.equal(migrated.exploitation.nom, DEMO_FARM_NAME);
  assert.ok(isDemoState(migrated));
  assert.equal(migrated.preferences.workspaceId, DEMO_WORKSPACE_ID);
  for (const key of ['syncEnabled', 'autoSync', 'autoBackup', 'platformBackendEnabled', 'remoteAiEnabled']) assert.equal(migrated.preferences[key], false, key);
  assert.equal(migrated.preferences.onboardingComplete, true);
  assert.deepEqual(migrated.queue, []);
});

test('chaque fiche porte ses champs communs et des références valides', () => {
  const demo = buildDemoFarm(REF), ids = new Set();
  for (const type of ENTITY_TYPES) for (const item of demo[type] || []) {
    for (const key of ['id', 'createdAt', 'updatedAt', 'version', 'source']) assert.ok(item[key] !== undefined && item[key] !== '', `${type}.${key}`);
    assert.ok('sourceId' in item && 'deletedAt' in item, `${type} ${item.id}`);
    assert.ok(item.id.startsWith('demo_'), item.id);
    assert.ok(!ids.has(item.id), `identifiant en double ${item.id}`); ids.add(item.id);
  }
  const has = (type, id) => demo[type].some(x => x.id === id);
  for (const p of demo.parcelles) assert.deepEqual(validateParcel(p), [], p.nom);
  for (const w of demo.interventions) {
    assert.deepEqual(validateIntervention(w), [], w.id);
    assert.ok(has('parcelles', w.parcelId), w.id);
    if (w.equipmentId) assert.ok(has('materiels', w.equipmentId), w.id);
    assert.equal(w.campaignId, campaignFor(`${w.date}T12:00:00`), w.id);
  }
  for (const r of demo.rotations) { assert.ok(has('parcelles', r.parcelId)); assert.match(r.campaignId, /^\d{4}\/\d{2}$/); assert.ok(r.culture); }
  for (const g of demo.grazingSessions) assert.ok(has('parcelles', g.parcelId));
  for (const t of demo.tasks) if (t.parcelId) assert.ok(has('parcelles', t.parcelId));
  for (const c of demo.chantiers) { assert.ok(has('clients', c.clientId)); assert.ok(has('materiels', c.equipmentId)); for (const log of c.tpLogs) assert.ok(has('materiels', log.equipmentId)); }
});

test('contenu attendu : 15 parcelles, 3 campagnes, un lot au pré, 2 engins, un chantier TP', () => {
  const demo = buildDemoFarm(REF), current = campaignFor(`${REF}T12:00:00`);
  assert.equal(demo.parcelles.length, 15);
  const campaigns = [...new Set(demo.rotations.map(r => r.campaignId))].sort();
  assert.equal(campaigns.length, 3); assert.equal(campaigns[2], current);
  for (const p of demo.parcelles) {
    assert.equal(demo.rotations.filter(r => r.parcelId === p.id).length, 3, p.nom);
    assert.equal(demo.rotations.find(r => r.parcelId === p.id && r.campaignId === current).culture, p.culture);
  }
  const onPasture = demo.grazingSessions.filter(g => !g.endDate);
  assert.equal(onPasture.length, 1); assert.ok(onPasture[0].animalsCount > 0);
  assert.equal(demo.materiels.length, 2);
  assert.equal(demo.chantiers.filter(c => c.kind === 'tp').length, 1);
  assert.ok(demo.chantiers[0].tpLogs.length >= 1);
});

test('travaux faits, à faire et en retard, datés par rapport à la référence', () => {
  for (const ref of [REF, '2027-03-02', '2026-08-03']) {
    const demo = buildDemoFarm(ref), works = demo.interventions;
    const done = works.filter(w => w.status === 'Terminé'), pending = works.filter(w => PENDING.includes(w.status));
    assert.ok(done.length >= 10, ref);
    assert.ok(done.every(w => days(w.date, ref) <= 0), `${ref} : un travail fait est dans le futur`);
    assert.ok(pending.some(w => days(w.plannedDate || w.date, ref) < 0), `${ref} : aucun retard`);
    assert.ok(pending.some(w => days(w.plannedDate || w.date, ref) === 0), `${ref} : rien aujourd’hui`);
    assert.ok(pending.some(w => days(w.plannedDate || w.date, ref) > 0), `${ref} : rien à venir`);
    assert.ok(demo.tasks.some(t => t.status === 'À faire' && days(t.dueDate, ref) < 0), `${ref} : aucune tâche en retard`);
  }
  // Décalage de la référence : les dates relatives suivent.
  const a = buildDemoFarm(REF), b = buildDemoFarm('2026-11-13');
  const recent = a.interventions.filter(w => Math.abs(days(w.date, REF)) < 65);
  for (const w of recent) assert.equal(days(b.interventions.find(x => x.id === w.id).date, w.date), 30, w.id);
});

test('contours fictifs plausibles : anneaux fermés, surfaces cohérentes, sans chevauchement', () => {
  const demo = buildDemoFarm(REF), boxes = [];
  for (const p of demo.parcelles) {
    const ring = p.geometry.coordinates[0];
    assert.equal(p.geometry.type, 'Polygon');
    assert.deepEqual(ring[0], ring.at(-1));
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]; area += (x1 * 76900) * (y2 * 111200) - (x2 * 76900) * (y1 * 111200); }
    const ha = Math.abs(area) / 2 / 10000;
    assert.ok(Math.abs(ha - p.surfaceHa) / p.surfaceHa < 0.2, `${p.nom} : ${ha.toFixed(1)} ha dessinés pour ${p.surfaceHa}`);
    const xs = ring.map(c => c[0]), ys = ring.map(c => c[1]);
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), p.nom]);
    assert.ok(xs.every(x => x > 5 && x < 5.3) && ys.every(y => y > 46.2 && y < 46.4), p.nom);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    assert.ok(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1], `${a[4]} chevauche ${b[4]}`);
  }
});

test('Pilotage et marges ont des chiffres : coûts et rendements sur les campagnes', () => {
  const demo = migrateData(buildDemoFarm(REF)), current = campaignFor(`${REF}T12:00:00`);
  const crops = active(demo, 'parcelles').filter(p => !/Prairie/.test(p.culture));
  const margins = crops.map(p => parcelMargin(demo, p, {campaign: current}));
  assert.ok(margins.some(m => m.product > 0), 'aucun produit attendu');
  assert.ok(margins.some(m => m.charges > 0), 'aucune charge');
  const previous = [...new Set(demo.rotations.map(r => r.campaignId))].sort()[1];
  assert.ok(crops.some(p => parcelMargin(demo, p, {campaign: previous}).product > 0), 'campagne précédente vide');
});

test('aucun rappel de sauvegarde pour la démonstration', () => {
  const demo = buildDemoFarm(REF);
  const old = {...demo, metadata: {...demo.metadata, lastExternalBackupAt: Date.parse('2020-01-01')}};
  assert.equal(externalBackupStatus(old, Date.parse(`${REF}T12:00:00Z`)).due, false);
});

// Stockage en mémoire qui journalise les écritures, pour prouver que les données réelles ne sont jamais réécrites.
function memoryStorage() {
  const data = new Map(), backups = new Map(), writes = [];
  return {
    data, backups, writes,
    async init() {},
    async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; },
    async getStored(k) { return this.get(k); },
    async set(k, v) { writes.push(k); data.set(k, structuredClone(v)); },
    async setIfCurrent(k, v, isCurrent) { if (!isCurrent(await this.get(k))) { const e = new Error('stale'); e.name = 'StaleStateError'; throw e; } writes.push(k); data.set(k, structuredClone(v)); },
    async delete(k) { writes.push(`delete:${k}`); data.delete(k); },
    async backupPut(row) { backups.set(row.id, structuredClone(row)); return row; },
    async backupList() { return [...backups.values()]; },
    async backupDelete(id) { backups.delete(id); },
    async pruneBackups() {},
    async historyAdd() { writes.push('history'); }
  };
}

async function realStore() {
  const storage = memoryStorage(), store = new Store(storage);
  await store.init();
  await store.upsert('parcelles', {id: 'vraie_p1', nom: 'Ma vraie parcelle', culture: 'Blé tendre', surfaceHa: 3.2});
  await store.upsert('interventions', {id: 'vrai_w1', parcelId: 'vraie_p1', type: 'Semis', date: '2026-10-01', status: 'Terminé'});
  return {storage, store};
}

test('entrée puis sortie de démonstration : données réelles intactes et jamais réécrites', async () => {
  const {storage, store} = await realStore();
  const before = structuredClone(storage.data.get('state'));
  const backupsBefore = [...storage.backups.keys()].sort();
  storage.writes.length = 0;
  assert.equal(await store.enterDemo(buildDemoFarm(REF)), true);
  assert.equal(store.isDemo, true);
  assert.equal(store.storageKey, 'state:workspace:demo');
  assert.equal(store.state.parcelles.length, 15);
  assert.equal(store.state.metadata.demoReturnWorkspace, 'local');
  assert.deepEqual((await storage.get('active-workspace')).id, DEMO_WORKSPACE_ID);
  // Modifications pendant la visite : ni file d’envoi, ni sauvegarde automatique, ni historique durable.
  await store.setPreferences({syncEnabled: true});
  await store.upsert('parcelles', {id: 'demo_p01', nom: 'Renommée en démo'});
  await store.remove?.('parcelles', 'demo_p02');
  assert.deepEqual(store.state.queue, []);
  assert.ok(!storage.writes.includes('history'));
  assert.deepEqual([...storage.backups.keys()].sort(), backupsBefore);
  // Instantané pris par un import annulable pendant la visite (sans espace précisé) : retiré à la sortie.
  await storage.backupPut({id: 'preimport_demo', period: 'preimport', createdAt: 1, state: store.snapshot()});
  assert.equal(await store.exitDemo(), true);
  assert.deepEqual([...storage.backups.keys()].sort(), backupsBefore);
  assert.equal(store.isDemo, false);
  assert.equal(store.storageKey, 'state');
  assert.deepEqual((await storage.get('active-workspace')).id, 'local');
  assert.ok(!storage.data.has('state:workspace:demo'), 'espace démo non vidé');
  assert.ok(!storage.writes.some(k => k === 'state'), `données réelles réécrites : ${storage.writes.join(', ')}`);
  assert.deepEqual(storage.data.get('state'), before);
  assert.deepEqual(store.state.parcelles.map(p => p.nom), ['Ma vraie parcelle']);
  // L’espace réel reste modifiable après le retour.
  await store.upsert('parcelles', {id: 'vraie_p2', nom: 'Deuxième', surfaceHa: 1});
  assert.equal(storage.data.get('state').parcelles.length, 2);
});

test('démonstration : une seconde entrée repart d’un jeu neuf ; lecture seule refusée', async () => {
  const {storage, store} = await realStore();
  await store.enterDemo(buildDemoFarm(REF));
  await store.upsert('parcelles', {id: 'demo_p01', nom: 'Modifiée'});
  assert.equal(await store.enterDemo(buildDemoFarm(REF)), false, 'déjà en démo');
  await store.exitDemo();
  await store.enterDemo(buildDemoFarm(REF));
  assert.equal(store.get('parcelles', 'demo_p01').nom, 'Les Noues');
  await store.exitDemo();
  store.setTabReadOnly(true);
  await assert.rejects(store.enterDemo(buildDemoFarm(REF)), {name: 'TabReadOnlyError'});
  assert.equal(store.isDemo, false);
  assert.ok(!storage.data.has('state:workspace:demo'));
});

test('retour vers un espace cloud mémorisé, et redémarrage dans la démo', async () => {
  const storage = memoryStorage();
  storage.data.set('active-workspace', {id: 'ws42'});
  const store = new Store(storage); await store.init();
  await store.upsert('parcelles', {id: 'c1', nom: 'Cloud'});
  const before = structuredClone(storage.data.get('state:workspace:ws42')), backupsBefore = [...storage.backups.keys()].sort();
  await store.enterDemo(buildDemoFarm(REF));
  assert.equal(store.state.metadata.demoReturnWorkspace, 'ws42');
  // Rechargement de la page pendant la démo : on rouvre la démo.
  const reopened = new Store(storage); await reopened.init();
  assert.equal(reopened.isDemo, true);
  assert.equal(reopened.state.parcelles.length, 15);
  assert.equal(reopened.state.metadata.lastAutoBackupDay, null);
  await reopened.exitDemo();
  assert.equal(reopened.workspaceId, 'ws42');
  assert.equal(reopened.state.preferences.workspaceId, 'ws42');
  assert.deepEqual(storage.data.get('state:workspace:ws42'), before);
  assert.deepEqual([...storage.backups.keys()].sort(), backupsBefore);
  assert.ok([...storage.backups.values()].every(row => row.workspaceId !== DEMO_WORKSPACE_ID && !isDemoState(row.state)));
});

test('sync.js : aucune synchronisation tant que la démo est active', async () => {
  const {store} = await realStore();
  await store.enterDemo(buildDemoFarm(REF));
  const sync = new SyncService(store);
  assert.equal(sync.demoActive, true);
  assert.equal(sync.workspaceId, '');
  const status = await sync.init();
  assert.equal(status.connected, false);
  assert.equal(status.message, DEMO_SYNC_MESSAGE);
  await assert.rejects(sync.sync({force: true}), {message: DEMO_SYNC_MESSAGE});
  await assert.rejects(sync.signIn('a@b.c', 'motdepasse'), {message: DEMO_SYNC_MESSAGE});
  await assert.rejects(sync.selectWorkspace('ws1'), {message: DEMO_SYNC_MESSAGE});
  assert.deepEqual(await sync.pushPending(), {sent: 0, conflicts: 0, merged: 0, errors: 0, waiting: 0});
  await store.exitDemo();
  assert.equal(sync.demoActive, false);
});
