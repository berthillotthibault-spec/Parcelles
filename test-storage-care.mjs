import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaLevel, breakdownSegments, evictableAttachments, backupsToPurge, cloudCopyVerified, addEvicted, removeEvicted, protectionAdvice, formatSize, attachmentBlob} from './storage-care.js';
import {readFileSync} from 'node:fs';

test('niveau de quota : ok, alerte, critique, inconnu', () => {
  assert.equal(quotaLevel(10, 100).level, 'ok');
  assert.equal(quotaLevel(85, 100).level, 'warn');
  assert.equal(quotaLevel(95, 100).level, 'critical');
  assert.equal(quotaLevel(95, 0).level, 'unknown');
  assert.equal(quotaLevel(50, 200).pct, 25);
});

test('répartition : le reste est attribué à l’application', () => {
  const segs = breakdownSegments({usage: 1000, quota: 10000, blobBytes: 400, backupBytes: 100, tileBytes: 200});
  assert.deepEqual(segs.map(s => [s.key, s.bytes]), [['photos', 400], ['backups', 100], ['tiles', 200], ['app', 300]]);
  assert.equal(segs[0].pct, 4);
  assert.equal(breakdownSegments({usage: 0, blobBytes: 50}).find(s => s.key === 'app').bytes, 0);
});

test('pièces libérables : seulement avec copie cloud et présentes localement', () => {
  const list = evictableAttachments([
    {id: 'a', cloudPath: 'w/a', name: 'A'}, {id: 'b', name: 'B'}, {id: 'c', cloudPath: 'w/c', deletedAt: 1},
    {id: 'd', cloudPath: 'w/d'}, {id: 'e', cloudPath: 'w/e'}
  ], new Map([['a', 100], ['b', 500], ['c', 50], ['e', 300]]));
  assert.deepEqual(list.map(x => x.id), ['e', 'a']);
});

test('copie cloud vérifiée seulement si même taille', () => {
  assert.equal(cloudCopyVerified(100, 100), true);
  assert.equal(cloudCopyVerified(100, 99), false);
  assert.equal(cloudCopyVerified(0, 0), false);
});

test('sauvegardes : on garde les plus récentes par exploitation', () => {
  const rows = [1, 2, 3, 4, 5].map(i => ({id: `l${i}`, createdAt: i})).concat([{id: 'w1', workspaceId: 'w', createdAt: 1}]);
  assert.deepEqual(backupsToPurge(rows, 3).map(r => r.id).sort(), ['l1', 'l2']);
});

test('liste des pièces libérées', () => {
  assert.deepEqual(addEvicted(['a'], ['b', 'a']), ['a', 'b']);
  assert.deepEqual(removeEvicted(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(addEvicted(null, ['x']), ['x']);
});

test('guide de protection selon la plateforme', () => {
  assert.equal(protectionAdvice({persisted: true}).protected, true);
  assert.match(protectionAdvice({installState: 'ios-safari'}).steps.join(' '), /écran d’accueil/);
  assert.equal(protectionAdvice({supported: false}).steps.length, 0);
  assert.match(formatSize(5 * 1024 * 1024), /Mo/);
});

test('la synchronisation ne retélécharge pas les pièces libérées', () => {
  const src = readFileSync(new URL('./sync.js', import.meta.url), 'utf8');
  assert.match(src, /!evicted\.has\(entity\.id\)/);
  assert.match(src, /async fetchCloudBlob\(entity\)/);
});

test('une pièce libérée est rechargée depuis le cloud par tous les lecteurs (vague 8)', async () => {
  const photo = {id: 'p1', cloudPath: 'w/p1'}, blobs = new Map([['d1', 'local']]), reloaded = [];
  const store = {storage: {blobGet: async id => blobs.get(id) || null}, get: (type, id) => type === 'photos' && id === 'p1' ? photo : null, reloadAttachment: async e => {reloaded.push(e.id); return 'cloud';}};
  assert.equal(await attachmentBlob(store, 'd1'), 'local');
  assert.equal(await attachmentBlob(store, 'p1'), 'cloud');
  assert.equal(await attachmentBlob(store, 'inconnu'), null);
  assert.deepEqual(reloaded, ['p1']);
  assert.equal(await attachmentBlob({storage: {blobGet: async () => null}}, 'p1'), null);
  for (const file of ['claims-ui.js', 'photo-geo-ui.js', 'application-ui.js', 'yield-ui.js', 'voice-notes-ui.js', 'yield.js', 'spatial-analysis.js', 'import-export.js']) {
    assert.doesNotMatch(readFileSync(new URL('./' + file, import.meta.url), 'utf8'), /storage\.blobGet\(/, file);
  }
  assert.match(readFileSync(new URL('./app.js', import.meta.url), 'utf8'), /store\.reloadAttachment=entity=>storageCare\(\)\.reload\(entity\)/);
});
