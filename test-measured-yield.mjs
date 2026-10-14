// n° 90 · Rendement mesuré relié à la marge et rentabilité intra-parcellaire (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {harvestMeasure, yieldMapMeasure, measureRules, lotCampaign, measuredYieldProposal, applyMeasuredYield, profitZones, measuredCampaigns, parseHarvestDate, yieldMapCampaign, toUnit, formatYield, pricePerTon} from './measured-yield.js';
import {economicColor, economicClass, ECONOMIC_CLASSES} from './pilotage.js';

const C = '2025/26', NOW = '2026/27';
const LON = 4, LAT = 46, DLAT = 200 / 111320, DLON = 200 / (111320 * Math.cos(LAT * Math.PI / 180));
const square = {type: 'Polygon', coordinates: [[[LON, LAT], [LON + DLON, LAT], [LON + DLON, LAT + DLAT], [LON, LAT + DLAT], [LON, LAT]]]};
const parcel = (extra = {}) => ({id: 'p1', nom: 'Grande pièce', surfaceHa: 4, geometry: square, ...extra});
const lot = (quantity, unit = 't', date = '2026-07-12', extra = {}) => ({id: 'l' + Math.random(), farmKind: 'harvest', parcelId: 'p1', code: 'L', date, quantity, unit, ...extra});

// Relevé : moitié ouest à 4 t/ha, moitié est à 9 t/ha, un point à 30 t/ha (exclu par le seuil de la carte).
function source() {
  const rows = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const lon = LON + DLON * (i + .5) / 20, lat = LAT + DLAT * (j + .5) / 20;
    rows.push({properties: {lon: String(lon), lat: String(lat), rdt: i < 10 ? '4' : '9', date: '15/07/2026'}});
  }
  rows.push({properties: {lon: String(LON + DLON * .52), lat: String(LAT + DLAT * .51), rdt: '30', date: '15/07/2026'}});
  return {format: 'csv', headers: ['lon', 'lat', 'rdt', 'date'], rows};
}
const doc = (rules = {minYield: .01, maxYield: 20, maxSpeed: 60, spikes: false}) => ({id: 'd1', parcelId: 'p1', name: 'Rendement.zip', yieldMap: {version: 1, mapping: {longitude: 'lon', latitude: 'lat', yield: 'rdt', date: 'date'}, rules, unit: 't/ha', importedAt: Date.parse('2026-08-02')}});

test('lots de récolte : quantité de la campagne / surface, kg convertis, autres campagnes ignorées', () => {
  const state = {integrationImports: [lot(20), lot(11400, 'kg'), lot(5, 't', '2025-07-10'), lot(99, 't', '2026-07-01', {deletedAt: 1}), lot(3, 't', '2026-07-01', {parcelId: 'p2'}), lot('', 't')]};
  const m = harvestMeasure(state, parcel(), C);
  assert.equal(m.lots, 2);
  assert.equal(m.ignored, 1);
  assert.equal(m.quantityT, 31.4);
  assert.equal(m.tha, 31.4 / 4);
  assert.equal(harvestMeasure(state, parcel(), '2023/24'), null);
  assert.equal(harvestMeasure(state, parcel({surfaceHa: null, geometry: null}), C).tha, null);
  assert.deepEqual(measuredCampaigns(state, parcel()), ['2025/26', '2024/25']);
});

test('carte de rendement : moyenne nettoyée avec les seuils de la carte et le nettoyage standard', () => {
  const m = yieldMapMeasure(doc(), source(), parcel());
  assert.equal(m.used, 400);
  assert.equal(m.excluded, 1);
  assert.equal(m.tha, 6.5);
  assert.equal(m.campaign, C);
  assert.equal(m.dated, true);
  assert.equal(parseHarvestDate('2026-7-3'), '2026-07-03');
  assert.equal(parseHarvestDate('03.07.2026'), '2026-07-03');
  assert.equal(parseHarvestDate('n/a'), null);
  assert.deepEqual(yieldMapCampaign({yieldMap: {importedAt: Date.parse('2025-09-01')}}, [{date: ''}]), {campaign: C, dated: false});
});

test('carte de betterave : les seuils de la carte (120 t/ha) remplacent les 25 t/ha par défaut ; pics toujours exclus (vague 9)', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({properties: {lon: String(LON + DLON * (i + .5) / 20), lat: String(LAT + DLAT / 2), rdt: String(80 + i % 10), date: '20/10/2026'}});
  const beet = {format: 'csv', headers: ['lon', 'lat', 'rdt', 'date'], rows};
  const m = yieldMapMeasure(doc({minYield: 1, maxYield: 120, maxSpeed: 25, spikes: true}), beet, parcel());
  assert.equal(m.used, 20);
  assert.equal(m.tha, 84.5);
  assert.equal(m.reason, '');
  // Réglage d'affichage sans exclusion des pics : la mesure les exclut quand même.
  rows.push({properties: {lon: String(LON + DLON * .3), lat: String(LAT + DLAT * .3), rdt: '600', date: '20/10/2026'}});
  const spiky = yieldMapMeasure(doc({minYield: 1, maxYield: 1000, maxSpeed: 25, spikes: false}), beet, parcel());
  assert.equal(spiky.used, 20);
  assert.equal(spiky.excluded, 1);
  // Seuils absents ou incohérents : nettoyage standard complet.
  assert.equal(measureRules({minYield: 50, maxYield: 10}).maxYield, 25);
  assert.equal(measureRules(null).maxYield, 25);
  assert.equal(measureRules({minYield: '', maxYield: '120'}).maxYield, 25);
});

test('campagne d’un lot du 1er août : même campagne que la carte, quel que soit le fuseau (vague 9)', () => {
  const tz = process.env.TZ;
  try {
    for (const zone of ['America/Guadeloupe', 'Pacific/Tahiti', 'Europe/Paris', 'Pacific/Noumea']) {
      process.env.TZ = zone;
      assert.equal(lotCampaign({date: '2026-08-01'}), '2026/27', zone);
      assert.equal(lotCampaign({date: '2026-07-31'}), '2025/26', zone);
      assert.equal(yieldMapCampaign({}, [{date: '01/08/2026'}]).campaign, '2026/27', zone);
    }
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test('proposition : source, unité de la fiche, écart avec la valeur saisie, conforme si identique', () => {
  const state = {integrationImports: [lot(31.2)]};
  const empty = measuredYieldProposal(state, parcel(), {campaign: C, current: NOW});
  assert.equal(empty.unit, 't/ha');
  assert.equal(empty.best.source, 'harvest');
  assert.equal(empty.best.value, 7.8);
  assert.equal(empty.best.status, 'empty');
  assert.equal(formatYield(empty.best.value, empty.unit), '7,8 t/ha');

  const quintals = parcel({economicsByCampaign: {[C]: {yield: 70, yieldUnit: 'q/ha', salePrice: 21}}});
  const q = measuredYieldProposal(state, quintals, {campaign: C, current: NOW});
  assert.equal(q.unit, 'q/ha');
  assert.equal(q.best.value, 78);
  assert.equal(q.best.status, 'differs');
  assert.equal(q.best.delta, 8);
  assert.equal(q.best.deltaPct, 11.4);
  assert.equal(q.price, 21);

  const same = measuredYieldProposal(state, parcel({economicsByCampaign: {[C]: {yield: 7.8, yieldUnit: 't/ha'}}}), {campaign: C, current: NOW});
  assert.equal(same.best.status, 'same');

  // Pas de lot : la carte de rendement de la campagne prend le relais ; une carte d'une autre campagne est ignorée.
  const map = {...yieldMapMeasure(doc(), source(), parcel()), points: undefined};
  const fromMap = measuredYieldProposal({}, parcel(), {campaign: C, maps: [map, {...map, campaign: '2024/25', tha: 3}], current: NOW});
  assert.equal(fromMap.best.source, 'yieldMap');
  assert.equal(fromMap.best.value, 6.5);
  assert.equal(fromMap.candidates.length, 1);
  // Les deux sources : les lots pesés passent avant la carte.
  assert.deepEqual(measuredYieldProposal(state, parcel(), {campaign: C, maps: [map], current: NOW}).candidates.map(c => c.source), ['harvest', 'yieldMap']);
  // Lots inexploitables : signalés, jamais proposés.
  const bad = measuredYieldProposal({integrationImports: [lot(0)]}, parcel(), {campaign: C, current: NOW});
  assert.equal(bad.best, null);
  assert.equal(bad.unusable.length, 1);
});

test('application : seule la campagne visée change, la fiche courante suit la campagne en cours', () => {
  const p = parcel({economics: {yield: 5, salePrice: 200}, economicsByCampaign: {[NOW]: {yield: 5, salePrice: 200}, [C]: {salePrice: 190, inputCostHa: 300}}});
  const past = applyMeasuredYield(p, C, {value: 7.8, unit: 't/ha'}, {current: NOW});
  assert.deepEqual(past.economicsByCampaign[C], {salePrice: 190, inputCostHa: 300, yield: 7.8, yieldUnit: 't/ha'});
  assert.deepEqual(past.economics, p.economics);
  assert.deepEqual(past.economicsByCampaign[NOW], p.economicsByCampaign[NOW]);
  const cur = applyMeasuredYield({...p, economicsByCampaign: {}}, NOW, {value: 8, unit: 't/ha'}, {current: NOW});
  assert.deepEqual(cur.economics, {yield: 8, salePrice: 200, yieldUnit: 't/ha'});
  assert.deepEqual(cur.economicsByCampaign[NOW], cur.economics);
  assert.throws(() => applyMeasuredYield(p, C, {value: 0, unit: 't/ha'}), /invalide/);
  assert.throws(() => applyMeasuredYield(p, C, {value: 7, unit: 'kg'}), /Unité/);
});

test('rentabilité intra-parcellaire : zones non rentables, surface et perte estimée', () => {
  const points = yieldMapMeasure(doc(), source(), parcel()).points;
  const z = profitZones({parcel: parcel(), points, costHa: 1200, price: 200, unit: 't/ha'});
  assert.equal(z.cellMeters, 30);
  assert.equal(z.breakEvenTha, 6);
  assert.equal(z.pricePerTon, 200);
  assert.ok(z.cells.length > 10);
  // Moitié ouest à 4 t/ha : 800 − 1 200 = −400 €/ha ; moitié est à 9 t/ha : +600 €/ha.
  const west = z.cells.filter(c => c.tha < 5), east = z.cells.filter(c => c.tha > 8.5);
  assert.ok(west.length && east.length);
  for (const c of west) { assert.ok(Math.abs(c.marginHa + 400) < 1e-6); assert.equal(c.classIndex, 0); }
  const westHa = west.reduce((s, c) => s + c.areaHa, 0);
  assert.ok(Math.abs(z.unprofitable.areaHa - westHa) < 1e-9);
  assert.ok(Math.abs(z.unprofitable.loss - westHa * 400) < 1e-6);
  assert.ok(z.unprofitable.share > 0 && z.unprofitable.share < 1);
  assert.equal(z.classes.length, ECONOMIC_CLASSES.margin.length);
  assert.ok(z.yieldZones.find(y => y.id === 'C').marginHa < 0);
  // Prix au quintal : 20 €/q = 200 €/t.
  assert.equal(pricePerTon(20, 'q/ha'), 200);
  assert.equal(profitZones({parcel: parcel(), points, costHa: 1200, price: 20, unit: 'q/ha'}).unprofitable.loss, z.unprofitable.loss);
  assert.throws(() => profitZones({parcel: parcel(), points, costHa: 1200, price: null}), /Prix de vente absent/);
  assert.throws(() => profitZones({parcel: parcel(), points, costHa: null, price: 200}), /Charges/);
});

test('légende chiffrée : classes en €/ha, valeur détaillée conservée', () => {
  assert.equal(economicClass(-1, 'margin').label, 'Marge négative (< 0 €/ha)');
  assert.equal(economicClass(0, 'margin').label, 'Marge 0 à 250 €/ha');
  assert.equal(economicClass(900, 'margin').label, 'Marge ≥ 750 €/ha');
  assert.equal(economicClass(250, 'cost').label, 'Coût 100 à 300 €/ha');
  const c = economicColor(512, 'margin');
  assert.equal(c.classLabel, 'Marge 250 à 750 €/ha');
  assert.match(c.label, /512 €\/ha · marge estimée/);
  assert.equal(c.color, '#548e61');
  assert.equal(economicColor(null, 'cost').classLabel, 'Données insuffisantes');
  assert.equal(toUnit(7.8456, 't/ha'), 7.85);
  assert.equal(toUnit(7.8456, 'q/ha'), 78.5);
});
