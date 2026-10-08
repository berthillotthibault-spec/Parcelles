// n° 34 — Formulaires unifiés en pastilles : logique pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {addDaysIso, dateOptions, workTypeOptions, parcelOptions, fieldCaption, validityMessage, WORK_STATUSES, WORK_STATUS_CHIPS, TYPE_CHIP_LIMIT} from './form-chips.js';

test('addDaysIso passe les fins de mois et d’année sans fuseau', () => {
  assert.equal(addDaysIso('2026-10-08', 1), '2026-10-09');
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysIso('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysIso('pas une date', 1), '');
});

test('dateOptions : Aujourd’hui puis Demain au format ISO', () => {
  assert.deepEqual(dateOptions('2026-10-08'), [{value: '2026-10-08', label: 'Aujourd’hui'}, {value: '2026-10-09', label: 'Demain'}]);
});

test('workTypeOptions : types fréquents de l’exploitation, complétés, type courant conservé', () => {
  const data = {interventions: [
    {type: 'Fauche', status: 'Terminé'}, {type: 'fauche', status: 'Terminé'}, {type: 'Épandage lisier', status: 'Terminé'}, {type: 'Gyrobroyage', status: 'À faire', deletedAt: 1}
  ]};
  const out = workTypeOptions(data);
  assert.equal(out.length, TYPE_CHIP_LIMIT);
  assert.equal(out[0].value.toLowerCase(), 'fauche');
  assert.equal(out[0].family, 'mow');
  assert.ok(!out.some(o => o.value === 'Gyrobroyage'), 'les travaux supprimés sont ignorés');
  assert.equal(out.filter(o => o.value.toLowerCase() === 'fauche').length, 1);
  const edited = workTypeOptions(data, 'Taille des haies');
  assert.equal(edited.length, TYPE_CHIP_LIMIT);
  assert.equal(edited[0].value, 'Taille des haies');
  assert.equal(workTypeOptions(data, 'fauche').filter(o => o.value.toLowerCase() === 'fauche').length, 1);
});

test('parcelOptions : choisie, favorites, récentes, puis travaillées ; archivées exclues', () => {
  const data = {
    parcelles: [{id: 'a', nom: 'A'}, {id: 'b', nom: 'B', favorite: true}, {id: 'c', nom: 'C'}, {id: 'd', nom: 'D', archived: true}, {id: 'e', nom: 'E'}, {id: 'f', nom: 'F', deletedAt: 3}],
    interventions: [{parcelId: 'e', updatedAt: 5}, {parcelId: 'a', updatedAt: 1}]
  };
  assert.deepEqual(parcelOptions(data, {current: 'c', recentIds: ['d', 'f', 'a']}).map(o => o.value), ['c', 'b', 'a', 'e']);
  assert.deepEqual(parcelOptions(data, {limit: 2}).map(o => o.value), ['b', 'e']);
  assert.equal(parcelOptions(data).find(o => o.value === 'b').favorite, true);
});

test('messages d’erreur en ligne en français', () => {
  assert.equal(fieldCaption('Type *'), 'Type');
  assert.equal(validityMessage({valueMissing: true}, 'Type *'), 'Champ obligatoire : Type');
  assert.equal(validityMessage({rangeUnderflow: true}, 'Surface travaillée (ha)'), 'Valeur trop petite : Surface travaillée (ha)');
  assert.equal(validityMessage({badInput: true}, ''), 'Valeur invalide : ce champ');
});

test('les pastilles de statut sont des statuts existants', () => {
  assert.ok(WORK_STATUS_CHIPS.every(s => WORK_STATUSES.includes(s)));
});
