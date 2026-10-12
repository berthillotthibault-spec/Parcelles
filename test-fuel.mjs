// n° 95 — carburant GNR : pleins, niveau de cuve, consommation l/h, dérive et TICPE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFill,tankLevel,averagePrice,consumption,consumptionAlerts,ticpeRate,validateRate,ticpeRefund,TICPE_REFERENCE,FUEL_KIND} from './fuel.js';

let n = 0;
const rec = x => ({id: `f${++n}`, farmKind: FUEL_KIND, createdAt: n, ...x});
const tank = (date, litres, unitPrice, x = {}) => rec({entry: 'tank', date, litres, unitPrice, amount: unitPrice * litres, ...x});
const fill = (equipmentId, date, litres, meter, x = {}) => rec({entry: 'machine', equipmentId, date, litres, meter, fromTank: true, ...x});
const farm = (records, prefs = {}) => ({preferences: prefs, materiels: [{id: 't1', nom: 'Tracteur A', currentMeter: 1000}, {id: 't2', nom: 'Tracteur B'}], integrationImports: records});

test('validation des pleins', () => {
  assert.ok(validateFill({date: '2026-03-01', litres: 0}, {entry: 'tank'}).error);
  assert.ok(validateFill({date: '2026-03-01', litres: 100}, {entry: 'machine'}).error);
  assert.match(validateFill({date: '2026-03-01', litres: 100, equipmentId: 't1', meter: 900}, {entry: 'machine', currentMeter: 1000}).error, /Compteur/);
  const v = validateFill({date: '2026-03-01', litres: '2000', amount: '2400'}, {entry: 'tank'}).value;
  assert.equal(v.unitPrice, 1.2); assert.equal(v.amount, 2400); assert.equal(v.meter, null);
  const m = validateFill({date: '2026-03-01', litres: 120, equipmentId: 't1', meter: 1010, fromTank: false}, {entry: 'machine', currentMeter: 1000}).value;
  assert.equal(m.fromTank, false); assert.equal(m.meter, 1010);
});

test('niveau de cuve estimé, rappel de commande et prix moyen', () => {
  const s = farm([tank('2026-01-10', 2000, 1.1), tank('2026-03-01', 1000, 1.4), fill('t1', '2026-02-01', 1500, 1010), fill('t1', '2026-03-10', 1200, 1050), fill('t2', '2026-03-12', 300, null, {fromTank: false}), tank('2025-01-01', 5000, 1)],
    {fuelTank: {capacity: 3000, initialLevel: 500, initialDate: '2026-01-01'}});
  const t = tankLevel(s, {today: '2026-04-01'});
  assert.equal(t.level, 800); assert.equal(t.pct, 27); assert.equal(t.threshold, 600); assert.equal(t.reorder, false);
  assert.equal(averagePrice(s, {today: '2026-04-01'}), 1.2);
  const low = tankLevel(farm(s.integrationImports, {fuelTank: {capacity: 3000, initialLevel: 0, initialDate: '2026-01-01', reorderBelow: 1000}}));
  assert.equal(low.reorder, true);
  assert.equal(tankLevel(farm([])).configured, false);
});

test('consommation l/h plein à plein et alerte de dérive +20 %', () => {
  const base = [fill('t1', '2026-01-01', 100, 1000), fill('t1', '2026-01-10', 100, 1010), fill('t1', '2026-01-20', 100, 1020), fill('t1', '2026-01-30', 100, 1030)];
  const ok = consumption(farm(base), 't1');
  assert.equal(ok.average, 10); assert.equal(ok.alert, false); assert.equal(ok.intervals.length, 3);
  const s = farm([...base, fill('t1', '2026-02-10', 130, 1040)]), c = consumption(s, 't1');
  assert.equal(c.last.lph, 13); assert.equal(c.reference, 10); assert.equal(c.drift, 30); assert.equal(c.alert, true);
  assert.deepEqual(consumptionAlerts(s).map(a => a.machine.id), ['t1']);
  assert.equal(consumption(farm([fill('t2', '2026-01-01', 50, null)]), 't2').average, null);
});

test('taux TICPE pré-rempli puis saisi', () => {
  const ref = ticpeRate(farm([]));
  assert.equal(ref.prefilled, true); assert.equal(ref.value, TICPE_REFERENCE.value); assert.ok(ref.date);
  const own = ticpeRate(farm([], {ticpeRate: {value: 15.2, date: '2026-01-01', source: 'Douanes'}}));
  assert.equal(own.prefilled, false); assert.equal(own.value, 15.2);
  assert.ok(validateRate({value: 200, date: '2026-01-01'}).error);
  assert.ok(validateRate({value: 15, date: ''}).error);
});

test('remboursement TICPE annuel : litres facturés × taux, factures listées', () => {
  const s = farm([tank('2025-02-01', 2000, 1.2, {invoiceRef: 'F-1'}), tank('2025-09-01', 1000, 1.3), fill('t1', '2025-05-01', 200, 1000, {fromTank: false, invoiceRef: 'S-1', amount: 300}), fill('t1', '2025-06-01', 150, 1010), tank('2026-01-05', 500, 1.2)]);
  const r = ticpeRefund(s, 2025, {value: 15});
  assert.equal(r.litres, 3200); assert.equal(r.amount, 480); assert.equal(r.invoices.length, 3); assert.equal(r.missingInvoice, 1);
  assert.equal(r.spent, 2400 + 1300 + 300);
});
