import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {skeletonHtml, initialCloudSyncPending} from './skeletons.js';

test('squelette accessible : statut occupé et libellé lu', () => {
  const html = skeletonHtml('weather', {label: 'Chargement <météo>'});
  assert.match(html, /role="status" aria-busy="true"/);
  assert.match(html, /sr-only">Chargement &lt;météo&gt;</);
  assert.match(html, /skeleton-line/);
  assert.match(html, /sk-weather/);
});

test('formes : liste bornée, type inconnu ramené à la liste, note optionnelle', () => {
  assert.equal((skeletonHtml('list', {rows: 3}).match(/sk-item/g) || []).length, 3);
  assert.equal((skeletonHtml('list', {rows: 99}).match(/sk-item/g) || []).length, 12);
  assert.match(skeletonHtml('inconnu'), /sk-list/);
  assert.match(skeletonHtml('list', {note: 'Récupération…'}), /sk-note">Récupération…</);
  assert.equal((skeletonHtml('photos').match(/sk-square/g) || []).length, 4);
});

test('synchronisation initiale : seulement ferme cloud jamais synchronisée, connectée, vide', () => {
  const base = {cloud: true, connected: true, online: true, lastSyncAt: null, lastSyncError: null, parcelCount: 0};
  assert.equal(initialCloudSyncPending(base), true);
  assert.equal(initialCloudSyncPending({...base, cloud: false}), false);
  assert.equal(initialCloudSyncPending({...base, lastSyncAt: 1}), false);
  assert.equal(initialCloudSyncPending({...base, lastSyncError: 'réseau'}), false);
  assert.equal(initialCloudSyncPending({...base, online: false}), false);
  assert.equal(initialCloudSyncPending({...base, parcelCount: 2}), false);
  // Wi-Fi seul en données mobiles ou synchro auto coupée : aucune synchro ne part, pas de squelette sans fin.
  assert.equal(initialCloudSyncPending({...base, syncAllowed: false}), false);
});

test('animation coupée si mouvement réduit (motion.css)', () => {
  assert.match(readFileSync(new URL('./motion.css', import.meta.url), 'utf8'), /\.skeleton-line::after\{display:none\}/);
});
