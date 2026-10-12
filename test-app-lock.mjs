import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import {DEFAULT_PBKDF2_ITERATIONS, decryptJsonPayload, encryptJsonPayload, encryptedHint, normalizeHint} from './security.js';
import {normalizeLockConfig, validPin, createPinRecord, verifyPin, shouldLock, registerFailure, resetFailures, waitSeconds,
  platformAuthAvailable, unlockWithPlatform} from './app-lock.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const password = 'Champ-du-Haut 2026!';

test('sauvegarde chiffrée : 600 000 itérations par défaut et indice en clair', async () => {
  assert.equal(DEFAULT_PBKDF2_ITERATIONS, 600000);
  const box = await encryptJsonPayload({a: 1}, password, {hint: '  le carnet   bleu '});
  assert.equal(box.iterations, 600000);
  assert.equal(encryptedHint(box), 'le carnet bleu');
  assert.deepEqual(await decryptJsonPayload(box, password), {a: 1});
  await assert.rejects(encryptJsonPayload({a: 1}, password, {hint: `indice ${password}`}), /ne doit pas contenir/);
  assert.equal(normalizeHint(''), '');
});

test('compatibilité : une ancienne sauvegarde à 250 000 itérations (ou sans le champ) reste lisible', async () => {
  const old = await encryptJsonPayload({parcelles: [{id: 'p1'}]}, password, {iterations: 250000});
  assert.equal(old.iterations, 250000);
  assert.deepEqual(await decryptJsonPayload(old, password), {parcelles: [{id: 'p1'}]});
  const legacy = {...old}; delete legacy.iterations; // format v1 d'origine : 250 000 implicite
  assert.deepEqual(await decryptJsonPayload(legacy, password), {parcelles: [{id: 'p1'}]});
  assert.equal(encryptedHint(old), '');
  await assert.rejects(decryptJsonPayload({...old, iterations: 1e9}, password), /invalides/);
  await assert.rejects(decryptJsonPayload(old, 'mauvais mot de passe'), /incorrect/);
});

test('verrouillage : jamais actif sans code, délai d’inactivité', async () => {
  assert.equal(normalizeLockConfig({enabled: true}).enabled, false);
  assert.equal(normalizeLockConfig({minutes: 7}).minutes, 5);
  assert.ok(validPin('123456') && !validPin('1234') && !validPin('12345a'));
  const config = normalizeLockConfig({enabled: true, minutes: 2, ...await createPinRecord('482913')});
  assert.equal(config.enabled, true);
  assert.equal(await verifyPin(config, '482913'), true);
  assert.equal(await verifyPin(config, '482914'), false);
  const t = 1_000_000;
  assert.equal(shouldLock(config, t - 60000, t), false);
  assert.equal(shouldLock(config, t - 120000, t), true);
  assert.equal(shouldLock({...config, enabled: false}, 0, t), false);
});

test('codes erronés : attente croissante plafonnée, jamais de blocage définitif', () => {
  let c = normalizeLockConfig(null); const t = 0;
  for (let i = 0; i < 5; i++) c = registerFailure(c, t);
  assert.equal(waitSeconds(c, t), 0);
  c = registerFailure(c, t); assert.equal(waitSeconds(c, t), 30);
  for (let i = 0; i < 20; i++) c = registerFailure(c, t);
  assert.equal(waitSeconds(c, t), 300);
  assert.equal(waitSeconds(c, t + 300000), 0);
  assert.equal(resetFailures(c).failedAttempts, 0);
});

test('WebAuthn : absence ou échec retombe sur le code', async () => {
  assert.equal(await platformAuthAvailable(undefined, undefined), false);
  assert.equal(await platformAuthAvailable({credentials: {}}, {isUserVerifyingPlatformAuthenticatorAvailable: async () => { throw new Error('x'); }}), false);
  const nav = {credentials: {get: async () => { throw new DOMException('Annulé', 'NotAllowedError'); }}};
  assert.equal(await unlockWithPlatform({credentialId: 'AAEC'}, {nav}), false);
  const ok = {credentials: {get: async () => ({rawId: new Uint8Array([0, 1, 2]).buffer})}};
  assert.equal(await unlockWithPlatform({credentialId: 'AAEC'}, {nav: ok}), true);
  assert.equal(await unlockWithPlatform({credentialId: ''}, {nav: ok}), false);
});
