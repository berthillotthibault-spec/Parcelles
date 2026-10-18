import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PLAN_INLINE_LINES,PLAN_INLINE_ROWS,farmPlanHtml,farmPlanModel,farmPlanPdf,normalizePlanOptions,planLayout,planParcels,planTableInline,planTiles,project,roundScale,scaleBar} from './farm-plan.js';

const square = (lon, lat, d) => ({type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]});
const parcels = [
  {id: 'a', nom: 'Grand champ', culture: 'Blé tendre', surfaceHa: 12.5, commune: 'Sougey', geometry: square(4.80, 45.70, .01)},
  {id: 'b', nom: 'Pré du bas', culture: 'Prairie', surfaceHa: 4, geometry: square(4.82, 45.71, .005)},
  {id: 'c', nom: 'Sans contour', culture: 'Maïs', surfaceHa: 3},
  {id: 'd', nom: 'Supprimée', culture: 'Colza', surfaceHa: 9, deletedAt: '2026-01-01', geometry: square(4.9, 45.8, .01)},
  {id: 'e', nom: '<Puits>', culture: 'Prairie', geometry: {type: 'Point', coordinates: [4.805, 45.705]}}
];
const colors = {'Blé tendre': '#d9a441', Prairie: '#6fb37a', 'Maïs': '#e0873a'};
const infoFor = p => ({label: p.culture || 'Sans culture', color: colors[p.culture] || '#8a8f88'});

test('emprise : exploitation, parcelle, sélection (supprimées exclues)', () => {
  assert.deepEqual(planParcels(parcels).map(p => p.id), ['a', 'b', 'c', 'e']);
  assert.deepEqual(planParcels(parcels, {scope: 'parcel', parcelId: 'b'}).map(p => p.id), ['b']);
  assert.deepEqual(planParcels(parcels, {scope: 'selection', ids: ['a', 'd', 'e']}).map(p => p.id), ['a', 'e']);
  assert.deepEqual(planParcels(parcels, {scope: 'selection'}), []);
});

test('options normalisées', () => {
  assert.deepEqual(normalizePlanOptions({scope: 'x', background: 'osm', colorMode: 'bw', labels: false}), {scope: 'farm', background: 'none', colorMode: 'bw', labels: false, table: true});
});

test('projection Web Mercator et échelle', () => {
  const [x, y] = project(0, 0, 0);
  assert.equal(x, 128); assert.ok(Math.abs(y - 128) < 1e-9);
  assert.equal(roundScale(12345), 12000);
  assert.equal(roundScale(4321), 4300);
  const bar = scaleBar(10, 36);
  assert.deepEqual([bar.meters, bar.label], [200, '200 m']);
  assert.equal(bar.mm, 20);
  assert.equal(scaleBar(100, 36).label, '2 km');
  assert.equal(scaleBar(0), null);
});

test('cadrage : toutes les formes dans le cadre, tuiles plafonnées', () => {
  const layout = planLayout(planParcels(parcels).filter(p => p.geometry));
  assert.ok(layout.zoom >= 14 && layout.zoom <= 19);
  assert.ok(layout.scale > 1000 && layout.scale < 50000);
  const tiles = planTiles(layout, 'https://t/{z}/{x}/{y}.jpg');
  assert.ok(tiles.length > 0 && tiles.length <= 110);
  assert.match(tiles[0].url, new RegExp(`^https://t/${layout.zoom}/\\d+/\\d+\\.jpg$`));
  // Une seule petite parcelle : emprise minimale, pas de zoom au-delà de 19.
  const tiny = planLayout([{geometry: square(4.8, 45.7, .0001)}]);
  assert.ok(tiny.zoom <= 19 && tiny.metersPerMm * 188 >= 300);
  assert.equal(planLayout([{id: 'z'}]), null);
});

test('modèle : légende en hectares, numéros, parcelles hors carte', () => {
  const m = farmPlanModel({parcels: planParcels(parcels), farmName: 'EARL du Sougey', campaign: '2026/27', options: {background: 'ign-photo'}, infoFor});
  assert.deepEqual(m.rows.map(r => r.name), ['<Puits>', 'Grand champ', 'Pré du bas', 'Sans contour']);
  assert.deepEqual(m.rows.map(r => r.n), [1, 2, 3, 4]);
  assert.equal(m.totals.offMap, 1);
  assert.equal(m.legend[0].label, 'Blé tendre');
  assert.equal(m.legend.find(g => g.label === 'Prairie').count, 2);
  assert.ok(m.tiles.length && m.tiles[0].url.includes('ORTHOIMAGERY'));
  const bw = farmPlanModel({parcels: planParcels(parcels), options: {colorMode: 'bw'}, infoFor});
  assert.ok(bw.legend.every(g => /^#(..)\1\1$/.test(g.color)));
  assert.equal(farmPlanModel({parcels: planParcels(parcels)}).tiles.length, 0);
});

test('document HTML : A4 paysage, cartouche, échelle, nord, échappement', () => {
  const m = farmPlanModel({parcels: planParcels(parcels), farmName: 'EARL <Sougey>', campaign: '2026/27', infoFor, today: new Date('2026-10-18T10:00:00Z')});
  const html = farmPlanHtml(m);
  assert.match(html, /@page\{size:A4 landscape/);
  assert.match(html, /<title>Plan EARL &lt;Sougey&gt; · 2026\/27<\/title>/);
  assert.match(html, /Campagne 2026\/27/);
  assert.match(html, /class="fp-north"/);
  assert.match(html, /class="fp-bar"/);
  assert.match(html, /1\/\d/);
  assert.match(html, /18 oct\. 2026/);
  assert.match(html, /Total · 4 parcelles<\/span><b>19,5 ha/);
  assert.match(html, /hors carte/);
  assert.ok(!html.includes('<Puits>') && html.includes('&lt;Puits&gt;'));
  assert.match(html, /role="img" aria-label="Plan de 3 parcelles/);
  // Tableau long : page suivante.
  const many = Array.from({length: PLAN_INLINE_ROWS + 1}, (_, i) => ({id: `p${i}`, nom: `P${i}`, culture: 'Blé', surfaceHa: 1, geometry: square(4.8 + i * .002, 45.7, .001)}));
  const long = farmPlanHtml(farmPlanModel({parcels: many, infoFor}));
  assert.match(long, /fp-table-page/);
  assert.doesNotMatch(farmPlanHtml(farmPlanModel({parcels: many, infoFor, options: {table: false}})), /<table/);
});

test('Cartouche : tableau en page suivante si légende et tableau ne tiennent pas ensemble', () => {
  const make = (n, cultures) => farmPlanModel({parcels: Array.from({length: n}, (_, i) => ({id: `p${i}`, nom: `P${i}`, culture: `C${i % cultures}`, surfaceHa: 1, geometry: square(4.8 + i * .002, 45.7, .001)})), infoFor});
  assert.ok(planTableInline(make(12, 2)));
  assert.ok(!planTableInline(make(10, 10)));
  assert.ok(!planTableInline(make(12, 12)));
  assert.ok(!planTableInline(make(PLAN_INLINE_ROWS + 1, 1)));
  const m = make(10, 10);
  assert.ok(m.rows.length + m.legend.length > PLAN_INLINE_LINES);
  assert.match(farmPlanHtml(m), /fp-table-page/);
  assert.match(farmPlanHtml(m), /Tableau des parcelles en page suivante/);
});

test('Parcelles archivées exclues du plan, comme sur la carte', () => {
  const list = [{id: 'a', nom: 'A'}, {id: 'b', nom: 'B', archived: true}, {id: 'c', nom: 'C', deletedAt: '2026-01-01'}];
  assert.deepEqual(planParcels(list).map(p => p.id), ['a']);
  assert.deepEqual(planParcels(list, {scope: 'parcel', parcelId: 'b'}), []);
  assert.deepEqual(planParcels(list, {scope: 'selection', ids: ['a', 'b']}).map(p => p.id), ['a']);
});

test('PDF vectoriel : en-tête valide, page paysage, pages de tableau', () => {
  const pdf = farmPlanPdf(farmPlanModel({parcels: planParcels(parcels), farmName: 'EARL', campaign: '2026/27', infoFor}));
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.\d+\]/);
  assert.match(text, / f\* Q/);
  const many = Array.from({length: 60}, (_, i) => ({id: `p${i}`, nom: `P${i}`, culture: 'Blé', surfaceHa: 1, geometry: square(4.8 + i * .002, 45.7, .001)}));
  const big = Buffer.from(farmPlanPdf(farmPlanModel({parcels: many, infoFor}))).toString('latin1');
  assert.ok((big.match(/\/Type \/Page /g) || []).length >= 3);
  assert.ok(farmPlanPdf(farmPlanModel({parcels: [{id: 'x', nom: 'X', surfaceHa: 2}], infoFor})).length > 500);
});

test('branchements : module différé, cache hors connexion, échelle de la carte', () => {
  const lazy = readFileSync(new URL('./lazy-modules.js', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./map.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(lazy, /farmPlan: \(\) => import\('\.\/farm-plan-ui\.js'\)/);
  assert.match(lazy, /'\[data-plan\]': 'farmPlan'/);
  for (const file of ['farm-plan.js', 'farm-plan-ui.js']) assert.ok(sw.includes(`'./${file}'`), file);
  assert.match(map, /L\.control\.scale\(\{imperial:false/);
  assert.doesNotMatch(app, /from '\.\/farm-plan(-ui)?\.js'/);
});
