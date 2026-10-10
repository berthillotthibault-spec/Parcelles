// n° 131 : conflit de synchronisation champ par champ (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMergedEntity, clockLabel, conflictFieldRows, conflictSources, entityTitle, fieldLabel, formatFieldValue, missingChoices, openConflicts} from './sync-conflict.js';
import {conflictRemoteMeta} from './sync.js';

const at = (h, m, day = 10) => new Date(2026, 9, day, h, m).getTime();
const NOW = at(15, 0);
const conflict = {
  entity: 'interventions', entityId: 'w1', status: 'open',
  local: {id: 'w1', type: 'Désherbage', parcelId: 'p1', date: '2026-10-09', dose: 1.5, doseUnit: 'L/ha', note: '', surfaceWorked: 11.3, updatedAt: at(14, 2), version: 4, modifiedEmail: 'x'},
  remote: {id: 'w1', type: 'Désherbage', parcelId: 'p1', date: '2026-10-08', dose: 2, doseUnit: 'L/ha', note: 'Vent faible', surfaceWorked: 11.3, updatedAt: at(13, 40), version: 5, operator: 'Paul'},
  remoteMeta: {modifiedEmail: 'paul@exemple.fr', deviceId: 'device_x', updatedAt: at(13, 40)}
};

test('libellés métier et valeurs formatées en français', () => {
  assert.equal(fieldLabel('surfaceHa'), 'Surface');
  assert.equal(fieldLabel('animalsCount'), 'Nombre d’animaux');
  assert.equal(fieldLabel('harvestMoisture'), 'Harvest moisture');
  assert.equal(formatFieldValue('date', '2026-10-08'), '08/10/2026');
  assert.equal(formatFieldValue('surfaceHa', 11.3), '11,3 ha');
  assert.equal(formatFieldValue('dose', 1.5, {doseUnit: 'L/ha'}), '1,5 L/ha');
  assert.equal(formatFieldValue('note', ''), '(vide)');
  assert.equal(formatFieldValue('favorite', true), 'Oui');
  assert.equal(formatFieldValue('parcelId', 'p1', {}, {parcelName: id => id === 'p1' ? 'Les Noues' : ''}), 'Les Noues');
  assert.match(formatFieldValue('geometry', {type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]]}), /2 morceaux, 8 points/);
  assert.match(formatFieldValue('animals', [{id: 'a', name: 'Rosette'}, {id: 'b', name: 'Bella'}]), /2 éléments : Rosette, Bella/);
  assert.equal(clockLabel(at(14, 2), NOW), '14 h 02');
  assert.equal(clockLabel(at(9, 5, 3), NOW), '03/10/2026 à 9 h 05');
});

test('lignes : vrais conflits d’abord, champs remplis d’un côté proposés, identiques repliés, techniques ignorés', () => {
  const rows = conflictFieldRows(conflict);
  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));
  assert.deepEqual(rows.filter(r => r.kind === 'conflict').map(r => r.key).sort(), ['date', 'dose']);
  assert.equal(byKey.note.kind, 'fill');assert.equal(byKey.note.suggested, 'remote');
  assert.equal(byKey.operator.kind, 'fill');assert.equal(byKey.operator.suggested, 'remote');
  assert.equal(byKey.type.kind, 'same');assert.equal(byKey.surfaceWorked.kind, 'same');
  for (const key of ['id', 'updatedAt', 'version', 'modifiedEmail']) assert.ok(!(key in byKey), `${key} masqué`);
  assert.equal(rows[0].kind, 'conflict');
  assert.equal(byKey.date.localText, '09/10/2026');assert.equal(byKey.dose.remoteText, '2 L/ha');
});

test('suppression d’un côté : toujours un vrai conflit, jamais complétée automatiquement', () => {
  const rows = conflictFieldRows({local: {id: 'p', nom: 'A'}, remote: {id: 'p', nom: 'A', deletedAt: at(12, 0)}});
  assert.equal(rows.find(r => r.key === 'deletedAt').kind, 'conflict');
});

test('pastilles d’origine : ce téléphone / le cloud avec auteur et heure', () => {
  const s = conflictSources(conflict, {deviceNoun: 'ce téléphone', now: NOW});
  assert.equal(s.local, 'Sur ce téléphone · vous, 14 h 02');
  assert.equal(s.remote, 'Dans le cloud · paul@exemple.fr, 13 h 40');
  assert.equal(conflictSources({local: {}, remote: {}}, {now: NOW}).remote, 'Dans le cloud · un autre appareil');
});

test('fusion : seulement des choix explicites, valeurs absentes remplacées par null', () => {
  const rows = conflictFieldRows(conflict);
  assert.deepEqual(missingChoices(rows, {date: 'local'}), ['dose']);
  assert.throws(() => buildMergedEntity(conflict, {date: 'local'}, rows), /Dose/);
  const merged = buildMergedEntity(conflict, {date: 'local', dose: 'remote'}, rows);
  assert.equal(merged.date, '2026-10-09');assert.equal(merged.dose, 2);
  assert.equal(merged.note, 'Vent faible');assert.equal(merged.operator, 'Paul');
  assert.equal(merged.type, 'Désherbage');assert.equal(merged.id, 'w1');
  // Choix du côté où le champ n’existe pas : null explicite (store.upsert fusionne avec la fiche existante).
  const opposite = buildMergedEntity(conflict, {date: 'remote', dose: 'local', operator: 'local', note: 'local'}, rows);
  assert.equal(opposite.operator, null);assert.equal(opposite.note, '');assert.equal(opposite.date, '2026-10-08');
  // Les objets d’origine ne sont pas modifiés.
  assert.equal(conflict.local.note, '');
});

test('titre lisible et compteur de conflits ouverts', () => {
  assert.equal(entityTitle('interventions', conflict.local, {parcelName: () => 'Les Noues'}), 'Désherbage — Les Noues');
  assert.equal(entityTitle('parcelles', {nom: 'Grand Champ'}), 'Grand Champ');
  assert.equal(entityTitle('tasks', {}), 'Fiche sans nom');
  assert.equal(openConflicts({syncConflicts: [{status: 'open'}, {status: 'resolved-local'}, {status: 'open', deletedAt: 1}]}).length, 1);
});

test('métadonnées distantes conservées sans uid ni jeton', () => {
  const meta = conflictRemoteMeta({modifiedBy: 'uid_secret', modifiedEmail: 'paul@exemple.fr', deviceId: 'd1', updatedAt: 5, serverUpdatedAt: {seconds: 2, nanoseconds: 0}});
  assert.deepEqual(meta, {modifiedEmail: 'paul@exemple.fr', deviceId: 'd1', updatedAt: 5, serverUpdatedAt: 2000});
  assert.equal(conflictRemoteMeta(null), null);
});
