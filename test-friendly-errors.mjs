import assert from 'node:assert/strict';
import {test} from 'node:test';
import {friendlyError, errorKind, errorReport, redact, stackFrames} from './friendly-errors.js';

const err = (message, extra = {}) => Object.assign(new Error(message), extra);

test('erreurs Firebase auth/* traduites avec titre, cause et action', () => {
  const f = friendlyError(err('Firebase: Error (auth/invalid-credential).', {code: 'auth/invalid-credential'}));
  assert.equal(f.title, 'Connexion refusée'); assert.match(f.action, /Mot de passe oublié/);
  assert.equal(friendlyError(err('x', {code: 'auth/too-many-requests'})).title, 'Trop de tentatives');
  assert.equal(friendlyError(err('x', {code: 'auth/network-request-failed'})).kind, 'offline');
  assert.equal(friendlyError(err('x', {code: 'auth/inconnue'})).title, 'Problème de connexion au compte');
});

test('quota, réseau, SHP sans .dbf, projection inconnue et fichier trop gros', () => {
  assert.equal(errorKind(Object.assign(new Error('The quota has been exceeded.'), {name: 'QuotaExceededError'})), 'quota');
  assert.equal(errorKind(err('x', {code: 'resource-exhausted'})), 'quota');
  assert.equal(errorKind(new TypeError('Failed to fetch')), 'offline');
  assert.equal(errorKind(err('Erreur'), {online: false}), 'offline');
  assert.equal(errorKind(err('Jeu SHP incomplet « Ilots » : .shp et .dbf sont obligatoires.')), 'shp-incomplete');
  assert.equal(errorKind(err('Projection SHP inconnue. Fournissez un fichier .prj ou un GeoJSON WGS84.')), 'projection');
  assert.equal(errorKind(err('Logo invalide ou trop lourd (500 Ko max).')), 'too-big');
  assert.equal(errorKind(err('x', {code: 'permission-denied'})), 'permission');
  for (const kind of ['quota', 'offline', 'shp-incomplete', 'projection', 'too-big', 'permission']) {
    const f = friendlyError({quota: Object.assign(new Error('quota'), {name: 'QuotaExceededError'}), offline: new TypeError('Failed to fetch'), 'shp-incomplete': err('Fichiers .shp et .dbf obligatoires.'), projection: err('projection inconnue'), 'too-big': err('too large'), permission: err('x', {code: 'permission-denied'})}[kind]);
    assert.equal(f.kind, kind); assert.ok(f.title && f.cause && f.action, kind);
  }
});

test('un message métier déjà rédigé en français est conservé, une erreur technique est reformulée', () => {
  assert.equal(friendlyError(err('Sélectionnez au moins une parcelle.')).cause, 'Sélectionnez au moins une parcelle.');
  const f = friendlyError(new TypeError("Cannot read properties of undefined (reading 'nom')"));
  assert.equal(f.kind, 'unknown'); assert.equal(f.title, 'L’action n’a pas abouti');
  assert.equal(friendlyError('texte').kind, 'unknown');
  assert.equal(friendlyError(undefined).kind, 'unknown');
});

test('le rapport ne contient ni données métier ni jeton', () => {
  const e = err('Parcelle « Les Noues » refusée pour jean.dupont@ferme.fr token=abcdefghijklmnopqrstuvwxyz123456 à 46.3412345,5.1309876');
  e.stack = 'Error: x\n    at saveWork (http://localhost:8113/app.js?v=3&token=secret:12:34)\n    at http://localhost:8113/state.js:5:6';
  const report = errorReport(e, {buildId: 'b1', userAgent: 'Test', at: new Date('2026-10-10T10:00:00Z')});
  for (const secret of ['Les Noues', 'jean.dupont', 'abcdefghijklmnop', 'secret', '46.341', '5.1309']) assert.ok(!report.includes(secret), secret);
  assert.match(report, /saveWork app\.js:12:34/); assert.match(report, /state\.js:5:6/); assert.match(report, /Version : b1/);
  assert.equal(redact('apiKey: AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'apiKey <masqué>');
  assert.deepEqual(stackFrames(''), []);
});

test('les accroches de app.js ne sont pas masquées par un commentaire', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  for (const hook of ['function friendlyErrors()', 'function help()', 'function activities()']) {
    const line = app.split('\n').find(row => row.includes(hook));
    assert.ok(line, hook); assert.ok(!line.slice(0, line.indexOf(hook)).includes('//'), hook);
  }
});
