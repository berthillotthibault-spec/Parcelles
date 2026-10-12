// n° 93 — foncier : baux, fermages indexés, avis par bailleur, rappels et couleur carte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLease,fermageIndex,validateIndex,parcelRent,rentNotices,leaseReminders,ownerColorInfo,noticePdfBlocks,FERMAGE_INDEX_REFERENCE} from './land.js';
import {flowPdf} from './pdf-lite.js';

const lease = x => ({ownerName: 'M. Durand', ownerContact: '06 00 00 00 00', cadastre: 'AB 12', leaseType: 'fermage', startDate: '2019-11-11', endDate: '2027-11-10', rentMode: 'eur', rent: 150, baseIndex: 100, landTaxShare: 40, ...x});
const farm = () => ({preferences: {}, parcelles: [
  {id: 'p1', nom: 'Les Noues', surfaceHa: 10, lease: lease()},
  {id: 'p2', nom: 'Grand Champ', surfaceHa: 5, lease: lease({cadastre: 'AB 13', rentMode: 'q', rent: 3, baseIndex: null, landTaxShare: 10})},
  {id: 'p3', nom: 'Pré', surfaceHa: 4, lease: lease({ownerName: 'Mme Petit', endDate: '2032-01-01', baseIndex: null})},
  {id: 'p4', nom: 'Côte', surfaceHa: 6, lease: {leaseType: 'propriete'}},
  {id: 'p5', nom: 'Sans bail', surfaceHa: 2}]});

test('indice : pré-rempli et daté, puis saisi', () => {
  const ref = fermageIndex(farm());
  assert.equal(ref.prefilled, true); assert.equal(ref.value, FERMAGE_INDEX_REFERENCE.value); assert.ok(ref.date);
  const own = fermageIndex({preferences: {fermageIndex: {year: 2026, value: 125.4, enteredAt: Date.parse('2026-07-20')}}});
  assert.equal(own.prefilled, false); assert.equal(own.value, 125.4); assert.equal(own.date, '2026-07-20');
  assert.ok(validateIndex({year: 2026, value: 5}).error);
  assert.deepEqual(validateIndex({year: '2026', value: '125,4', quintalPrice: '20'}).value, {year: 2026, value: 125.4, quintalPrice: 20});
});

test('fermage indexé en €/ha, en quintaux, sans indice de référence', () => {
  const s = farm(), index = {value: 123.06};
  assert.deepEqual(parcelRent(s.parcelles[0], {index}), {perHa: 184.59, total: 1845.9, indexed: true, mode: 'eur', factor: 1.2306});
  assert.equal(parcelRent(s.parcelles[1], {index}).missing, 'prix du quintal');
  assert.equal(parcelRent(s.parcelles[1], {index, quintalPrice: 20}).total, 300);
  assert.equal(parcelRent(s.parcelles[2], {index}).indexed, false);
  assert.equal(parcelRent(s.parcelles[3], {index}).total, null);
});

test('avis d’échéance groupés par bailleur avec la taxe foncière', () => {
  const n = rentNotices(farm(), {index: {value: 123.06}, quintalPrice: 20});
  assert.deepEqual(n.map(x => x.owner), ['M. Durand', 'Mme Petit']);
  assert.equal(n[0].rent, 2145.9); assert.equal(n[0].tax, 50); assert.equal(n[0].total, 2195.9); assert.equal(n[0].parcels.length, 2);
  const bytes = flowPdf(noticePdfBlocks(n[0], {farm: {nom: 'GAEC'}, index: fermageIndex(farm()), quintalPrice: 20, today: '2026-10-12'}), {title: 'Avis'});
  assert.ok(bytes.length > 500);
});

test('rappels 18 mois avant l’échéance et validation du bail', () => {
  const r = leaseReminders(farm(), {today: '2026-10-12'});
  assert.deepEqual(r.map(x => x.parcel.id), ['p1', 'p2']);
  assert.equal(leaseReminders(farm(), {today: '2028-01-01'})[0].expired, true);
  assert.ok(normalizeLease({startDate: '2026-01-01', endDate: '2025-01-01'}).error);
  assert.ok(normalizeLease({rentMode: 'q', rent: 500}).error);
  assert.equal(normalizeLease({rent: '150,5', leaseType: 'inconnu'}).value.rent, 150.5);
  assert.equal(normalizeLease({leaseType: 'inconnu'}).value.leaseType, '');
});

test('couleur « Propriétaires » stable par bailleur', () => {
  const s = farm();
  assert.equal(ownerColorInfo(s.parcelles[0]).color, ownerColorInfo(s.parcelles[1]).color);
  assert.equal(ownerColorInfo(s.parcelles[3]).label, 'Propriété de l’exploitant');
  assert.equal(ownerColorInfo(s.parcelles[4]).label, 'Bailleur non renseigné');
});
