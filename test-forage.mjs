// n° 75 — bilan fourrager : t MS par saisie, stock contre besoins, frise et calendrier de coupe.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tonnesMs,validateForage,forageBalance,winterSettings,needPerDay,lotsFromGrazing,forageStockItems,cutCalendar,FORAGE_KIND} from './forage.js';

let n = 0;
const rec = x => ({id: `r${++n}`, farmKind: FORAGE_KIND, createdAt: n, entry: 'harvest', ...x});
const farm = (records = [], prefs = {}, extra = {}) => ({preferences: prefs, parcelles: [], grazingSessions: [], stockItems: [], integrationImports: records, ...extra});

test('tonnes de matière sèche selon le mode de saisie', () => {
  assert.equal(tonnesMs({type: 'foin', mode: 'bales', bales: 100, baleKg: 300}), 25.5);
  assert.equal(tonnesMs({type: 'enrubannage', mode: 'bales', bales: 10}), 3.58);
  assert.equal(tonnesMs({type: 'ensilage-mais', mode: 'silo', length: 30, width: 8, height: 2.5, density: 700, msPct: 33}), 138.6);
  assert.equal(tonnesMs({type: 'ensilage-herbe', mode: 'tonnes', tonnes: 40}), 12);
  assert.equal(tonnesMs({type: 'foin', mode: 'tms', tms: '7,5'}), 7.5);
  assert.equal(tonnesMs({type: 'foin', mode: 'silo', length: 3}), null);
});

test('validation des saisies', () => {
  assert.ok(validateForage({date: 'x', type: 'foin', mode: 'tms', tms: 1}).error);
  assert.ok(validateForage({date: '2026-06-01', type: '', mode: 'tms', tms: 1}).error);
  assert.match(validateForage({date: '2026-06-01', type: 'foin', mode: 'silo'}).error, /silo/);
  assert.ok(validateForage({date: '2026-06-01', type: 'foin', mode: 'bales', bales: 10, msPct: 120}).error);
  const v = validateForage({date: '2026-06-01', type: 'foin', mode: 'bales', bales: '20', parcelId: 'p1', cut: '2'}).value;
  assert.equal(v.tms, 4.76); assert.equal(v.cut, 2); assert.equal(v.msPct, 85);
  const inv = validateForage({entry: 'inventory', date: '2026-11-01', mode: 'tms', tms: 50, parcelId: 'p1'}).value;
  assert.equal(inv.entry, 'inventory'); assert.equal(inv.parcelId, null);
});

test('réglages d’hivernage par défaut et besoins journaliers', () => {
  const w = winterSettings(farm(), {today: '2026-10-12'});
  assert.equal(w.start, '2026-11-15'); assert.equal(w.end, '2027-03-31'); assert.equal(w.lossPct, 10);
  assert.equal(winterSettings(farm(), {today: '2027-02-01'}).start, '2026-11-15');
  // Hiver enregistré une saison passée : recalé sur l’hiver en cours (mois-jour conservés).
  const old = farm([], {forageWinter: {start: '2026-11-15', end: '2027-03-31', lots: []}});
  assert.deepEqual([winterSettings(old, {today: '2027-01-10'}).start, winterSettings(old, {today: '2027-01-10'}).end], ['2026-11-15', '2027-03-31']);
  const next = winterSettings(old, {today: '2027-10-12'});
  assert.equal(next.start, '2027-11-15'); assert.equal(next.end, '2028-03-31');
  assert.equal(winterSettings(farm([], {forageWinter: {start: '2026-10-01', end: '2026-12-31'}}), {today: '2027-10-12'}).end, '2027-12-31');
  assert.equal(needPerDay({heads: 40, category: 'vache-allaitante'}), 0.52);
  assert.equal(needPerDay({heads: 10, kgMsDay: 20}), 0.2);
});

test('bilan : couvert jusqu’au…, manque et frise', () => {
  const prefs = {forageWinter: {start: '2026-12-01', end: '2027-03-31', lossPct: 0, lots: [{category: 'vache-allaitante', heads: 50, kgMsDay: 12}]}};
  const s = farm([rec({type: 'foin', date: '2026-06-10', tms: 30}), rec({type: 'ensilage-mais', date: '2026-09-20', tms: 24}), rec({type: 'foin', date: '2025-06-10', tms: 99})], prefs);
  const b = forageBalance(s, {today: '2026-10-12'});
  assert.equal(b.daily, 0.6); assert.equal(b.available, 54); assert.equal(b.consumed, 0);
  assert.equal(b.remainingDays, 120); assert.equal(b.remainingNeed, 72); assert.equal(b.missing, 18);
  assert.equal(b.coverDays, 90); assert.equal(b.coveredUntil, '2027-03-01'); assert.equal(b.coversAll, false);
  assert.equal(b.byType.foin, 30); assert.equal(b.timeline[0].date, '2026-12-01'); assert.equal(b.timeline.at(-1).date, '2027-03-31');
  assert.equal(b.timeline.find(p => p.date === '2027-01-01').stock, 35.4);
  // En cours d'hiver : consommation estimée depuis le début.
  const mid = forageBalance(s, {today: '2027-01-01'});
  assert.equal(mid.consumed, 18.6); assert.equal(mid.available, 35.4); assert.equal(mid.coveredUntil, '2027-03-01');
  // Un inventaire remet le compteur à zéro à sa date.
  const inv = forageBalance(farm([...s.integrationImports, rec({entry: 'inventory', date: '2027-01-10', tms: 40})], prefs), {today: '2027-01-20'});
  assert.equal(inv.available, 34); assert.equal(inv.consumedDays, 10);
  // Pertes de conservation.
  const loss = forageBalance(farm(s.integrationImports, {forageWinter: {...prefs.forageWinter, lossPct: 10}}), {today: '2026-10-12'});
  assert.equal(loss.available, 48.6);
});

test('lots proposés depuis le pâturage et stocks d’aliments en tonnes', () => {
  const s = farm([], {}, {
    grazingSessions: [{id: 'g1', parcelId: 'p', startDate: '2026-04-01', animalCategory: 'vache-allaitante', animalsCount: 30}, {id: 'g2', parcelId: 'p', startDate: '2026-04-01', animalsCount: 5}, {id: 'g3', parcelId: 'p', startDate: '2026-04-01', endDate: '2026-05-01', animalsCount: 9}],
    stockItems: [{id: 's1', name: 'Foin de prairie', unit: 't', quantity: 10}, {id: 's2', name: 'Maïs ensilage', unit: 't', quantity: 30}, {id: 's3', name: 'Tourteau', unit: 't', quantity: 5}, {id: 's4', name: 'Foin', unit: 'unités', quantity: 50}]
  });
  const lots = lotsFromGrazing(s, {date: '2026-10-12'});
  assert.deepEqual(lots.map(l => [l.category, l.heads]), [['vache-allaitante', 30], ['other', 5]]);
  assert.deepEqual(forageStockItems(s).map(i => [i.type, i.tms]), [['foin', 8.5], ['ensilage-mais', 9.9]]);
});

test('calendrier de coupe selon les sommes de températures', () => {
  const days = [];for (let d = new Date('2026-02-01T12:00:00Z'); d <= new Date('2026-05-20T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push({date: d.toISOString().slice(0, 10), tmin: 4, tmax: 12});
  const s = farm([rec({type: 'ensilage-herbe', date: '2026-04-20', parcelId: 'p2', tms: 5})], {}, {parcelles: [{id: 'p1', nom: 'Grand pré', culture: 'Prairie permanente'}, {id: 'p2', nom: 'Ray-grass', culture: 'Ray-grass'}, {id: 'p3', nom: 'Blé', culture: 'Blé tendre'}]});
  const cal = cutCalendar(s, {today: '2026-05-01', days});
  assert.deepEqual(cal.map(c => c.parcel.id).sort(), ['p1', 'p2']);
  const p1 = cal.find(c => c.parcel.id === 'p1'), p2 = cal.find(c => c.parcel.id === 'p2');
  assert.equal(p1.sum, 720); assert.equal(p1.status, 'soon'); assert.equal(p1.eta, '2026-05-11'); assert.equal(p1.next, 1);
  assert.equal(p2.next, 2); assert.equal(p2.target, 550); assert.equal(p2.status, 'growing');
  assert.equal(cutCalendar(s, {today: '2026-05-01'})[0].status, 'unknown');
});
