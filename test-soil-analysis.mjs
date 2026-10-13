// n° 68 — analyses de sol : validation, alerte d'ancienneté, chaulage, couleur pH, grille et guidage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnalysis,latestAnalysis,ageYears,limingNeed,phClass,soilColorInfo,analysisAlerts,samplingGrid,guidance,nextPoint,SOIL_KIND} from './soil-analysis.js';
import {pointInGeometry} from './utils.js';

const rec = (id, parcelId, date, x = {}) => ({id, farmKind: SOIL_KIND, parcelId, date, createdAt: 1, ...x});
// Carré d'environ 400 m × 250 m (≈ 10 ha) près de 46,3° N.
const lat = 46.3, dLat = 250 / 111320, dLon = 400 / (111320 * Math.cos(lat * Math.PI / 180));
const square = {type: 'Polygon', coordinates: [[[5, lat], [5 + dLon, lat], [5 + dLon, lat + dLat], [5, lat + dLat], [5, lat]]]};

test('validation d’une analyse', () => {
  assert.ok(validateAnalysis({date: '2026-01-01'}).error);
  assert.ok(validateAnalysis({parcelId: 'p', date: '2026-01-01'}).error);
  assert.match(validateAnalysis({parcelId: 'p', date: '2026-01-01', ph: 12}).error, /pH/);
  assert.ok(validateAnalysis({parcelId: 'p', date: '2026-01-01', ph: 6, latitude: 46}).error);
  assert.ok(validateAnalysis({parcelId: 'p', date: '2026-01-01', ph: 6, targetPh: 9}).error);
  const v = validateAnalysis({parcelId: 'p', date: '2026-01-01', ph: '5,8', om: '2.1', texture: 'limoneux', lab: ' Labo '}).value;
  assert.equal(v.ph, 5.8); assert.equal(v.om, 2.1); assert.equal(v.k2o, null); assert.equal(v.lab, 'Labo');
});

test('besoin de chaulage indicatif selon la texture', () => {
  assert.equal(limingNeed({ph: null}).status, 'no-ph');
  assert.equal(limingNeed({ph: 5.5}).status, 'no-texture');
  assert.equal(limingNeed({ph: 7.9, texture: 'calcaire'}).status, 'calcareous');
  assert.equal(limingNeed({ph: 6.6, texture: 'limoneux'}).status, 'ok');
  const n = limingNeed({ph: 5.5, texture: 'limoneux'});
  assert.equal(n.cao, 2.5); assert.equal(n.years, 2); assert.equal(n.perYear, 1.3); assert.equal(n.productTonnes, 5);
  const c = limingNeed({ph: 6, texture: 'argileux', targetPh: 6.5}, {product: 'chaux-vive'});
  assert.equal(c.cao, 1.8); assert.equal(c.years, 1); assert.equal(c.productTonnes, 2.1);
});

test('dernière analyse, ancienneté, alertes et couleur de carte', () => {
  const s = {parcelles: [{id: 'p1', nom: 'A'}, {id: 'p2', nom: 'B'}, {id: 'p3', nom: 'C'}], integrationImports: [
    rec('a', 'p1', '2019-03-01', {ph: 6.4}), rec('b', 'p1', '2024-03-01', {ph: 5.2}), rec('c', 'p2', '2020-02-01', {ph: 7.2})]};
  assert.equal(latestAnalysis(s, 'p1').id, 'b');
  assert.equal(ageYears('2020-02-01', '2026-10-12'), 6.7);
  assert.deepEqual(analysisAlerts(s, {today: '2026-10-12'}).map(x => x.parcel.id), ['p3', 'p2']);
  assert.equal(soilColorInfo(s, {id: 'p1'}, {today: '2026-10-12'}).color, '#b5452b');
  assert.equal(soilColorInfo(s, {id: 'p2'}, {today: '2026-10-12'}).label, 'Analyse de plus de 5 ans');
  assert.equal(soilColorInfo(s, {id: 'p3'}).label, 'Pas d’analyse de pH');
  assert.equal(phClass(6.5).color, '#5e9a4a'); assert.equal(phClass(null), null);
});

test('grille d’échantillonnage : un point par hectare, dans le contour, en zigzag', () => {
  const pts = samplingGrid(square);
  assert.ok(pts.length >= 8 && pts.length <= 12, String(pts.length));
  assert.ok(pts.every(p => pointInGeometry(p.longitude, p.latitude, square)));
  assert.deepEqual(pts.map(p => p.n), pts.map((_, i) => i + 1));
  // Rangées alternées : le premier point de la 2e rangée est du côté où finit la 1re.
  const rows = [...new Set(pts.map(p => p.latitude))];
  const first = pts.filter(p => p.latitude === rows[0]), second = pts.filter(p => p.latitude === rows[1]);
  assert.ok(first.at(-1).longitude >= first[0].longitude && second[0].longitude >= second.at(-1).longitude);
  assert.equal(samplingGrid(square, {haPerPoint: 5}).length >= 2, true);
  assert.deepEqual(samplingGrid(null), []);
});

test('guidage vers le prochain point', () => {
  const g = guidance({latitude: 46.3, longitude: 5}, {latitude: 46.301, longitude: 5});
  assert.equal(g.cardinal, 'N'); assert.equal(g.bearing, 0); assert.ok(Math.abs(g.distance - 111) <= 1);
  assert.equal(guidance({latitude: 46.3, longitude: 5}, {latitude: 46.3, longitude: 5.001}).cardinal, 'E');
  assert.equal(nextPoint({points: [{n: 1, sampledAt: 1}, {n: 2}]}).n, 2);
  assert.equal(nextPoint({points: [{n: 1, sampledAt: 1}]}), null);
});

test('nouvelle analyse sans parcelle : texture reprise de la parcelle présélectionnée', async () => {
  globalThis.document ??= {addEventListener() {}, querySelector: () => null};
  const {createSoilAnalysisUI} = await import('./soil-analysis-ui.js');
  const state = {parcelles: [{id: 'pA', nom: 'A'}, {id: 'pB', nom: 'B'}],
    integrationImports: [rec('s1', 'pA', '2024-03-01', {texture: 'sableux'}), rec('s2', 'pB', '2025-03-01', {texture: 'argileux'})]};
  let body = '';
  const ui = createSoilAnalysisUI({store: {snapshot: () => state}, modal: (t, d, b) => { body = b; }, toast() {}});
  ui.openForm(null, '');
  assert.match(body, /<option value="pA" selected>/);
  assert.match(body, /value="sableux" selected/);
  assert.doesNotMatch(body, /value="argileux" selected/);
});
