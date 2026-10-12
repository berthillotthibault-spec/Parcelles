// n° 94 — dossier sinistre : pré-remplissage, surface, perte, statuts, météo, EXIF, trésorerie et PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import {claimDraft,claimArea,estimateLoss,validateClaim,nextStatus,causeFromObservation,weatherUrl,parseWeather,weatherText,claimPdfBlocks,exifDate,claimsTreasury,CLAIM_KIND} from './claims.js';
import {flowPdf} from './pdf-lite.js';

const farm = (records = []) => ({exploitation: {nom: 'Ferme fictive'}, preferences: {},
  parcelles: [{id: 'p1', nom: 'Les Noues', surfaceHa: 10, culture: 'Maïs', geometry: {type: 'Polygon', coordinates: [[[4.9, 46.3], [4.91, 46.3], [4.91, 46.31], [4.9, 46.31], [4.9, 46.3]]]}, economicsByCampaign: {'2025/26': {yield: 10, yieldUnit: 't/ha', salePrice: 200}}}],
  interventions: [{id: 'w1', parcelId: 'p1', type: 'Semis', date: '2026-04-20', variety: 'Variété A'}],
  points: [{id: 'z1', type: 'Zone', areaHa: 1.5}],
  integrationImports: records});
const obs = {id: 'o1', parcelId: 'p1', date: '2026-07-02', type: 'Dégâts gibier', title: 'Sangliers', note: 'Retournement'};

test('pré-remplissage depuis l’observation', () => {
  const d = claimDraft(farm(), obs);
  assert.equal(d.cause, 'gibier'); assert.equal(d.status, 'ouvert'); assert.equal(d.parcelId, 'p1');
  assert.equal(d.variety, 'Variété A'); assert.equal(d.expectedYield, 10); assert.equal(d.price, 200);
  assert.ok(d.latitude > 46 && d.longitude > 4.8);
  assert.equal(causeFromObservation({type: 'Grêle'}), 'grele');
  assert.equal(causeFromObservation({type: 'Sécheresse'}), 'secheresse');
});

test('surface touchée : saisie, zone mesurée, part de parcelle', () => {
  const s = farm();
  assert.equal(claimArea(s, {areaMode: 'saisie', areaHa: '2,5'}), 2.5);
  assert.equal(claimArea(s, {areaMode: 'zone', zoneId: 'z1'}), 1.5);
  assert.equal(claimArea(s, {areaMode: 'parcelle', parcelId: 'p1', areaPct: 25}), 2.5);
  assert.equal(claimArea(s, {areaMode: 'zone', zoneId: 'absente'}), null);
});

test('perte estimée en t et en €, en t/ha ou q/ha', () => {
  assert.deepEqual(estimateLoss({areaHa: 2, expectedYield: 10, lossPct: 50, price: 200}), {tonnes: 10, euros: 2000});
  assert.deepEqual(estimateLoss({areaHa: 2, expectedYield: 80, yieldUnit: 'q/ha', lossPct: 50, price: 20}), {tonnes: 8, euros: 1600});
  assert.deepEqual(estimateLoss({areaHa: 2, expectedYield: 10, lossPct: null}), {tonnes: null, euros: null});
});

test('validation et suivi par statut', () => {
  assert.ok(validateClaim({cause: 'x', date: '2026-07-02'}).error);
  assert.ok(validateClaim({cause: 'grele', date: '2026-07-02', lossPct: 120}).error);
  assert.ok(validateClaim({cause: 'grele', date: '2026-07-02', indemnity: -1}).error);
  const v = validateClaim({cause: 'grele', date: '2026-07-02', lossPct: '30', indemnity: '500'}).value;
  assert.equal(v.lossPct, 30); assert.equal(v.indemnity, 500);
  const c = nextStatus({status: 'ouvert'}, 'déclaré', '2026-07-05');
  assert.equal(c.status, 'déclaré'); assert.equal(c.statusHistory.length, 1);
  assert.throws(() => nextStatus(c, 'perdu', '2026-07-06'));
});

test('météo de la date : URL d’archive et lecture', () => {
  const url = weatherUrl(46.3, 4.9, '2026-07-02');
  assert.match(url, /archive-api\.open-meteo\.com/); assert.match(url, /start_date=2026-07-02/);
  const w = parseWeather({daily: {time: ['2026-07-02'], temperature_2m_max: [31.2], temperature_2m_min: [14], precipitation_sum: [22.5], wind_gusts_10m_max: [70]}}, '2026-07-02');
  assert.equal(w.precipitation, 22.5); assert.match(weatherText(w), /22,5 mm/);
  assert.equal(parseWeather({daily: {time: []}}, '2026-07-02'), null);
});

test('date EXIF lue sans décoder l’image', () => {
  // JPEG minimal : SOI + APP1 Exif (TIFF little-endian, IFD0 avec DateTime) + EOI.
  const date = '2026:07:02 18:45:10\0', enc = new TextEncoder();
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + date.length), dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, 8, true); dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x0132, true); dv.setUint16(12, 2, true); dv.setUint32(14, date.length, true); dv.setUint32(18, 26, true);
  tiff.set(enc.encode(date), 26);
  const app1 = [...enc.encode('Exif'), 0, 0, ...tiff], len = app1.length + 2;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]);
  assert.equal(exifDate(jpeg), '2026-07-02T18:45');
  assert.equal(exifDate(new Uint8Array([1, 2, 3])), null);
});

test('trésorerie : indemnités attendues et reçues', () => {
  const rec = (x) => ({farmKind: CLAIM_KIND, parcelId: 'p1', areaMode: 'saisie', areaHa: 2, expectedYield: 10, yieldUnit: 't/ha', lossPct: 50, price: 200, indemnity: null, ...x});
  const t = claimsTreasury(farm([rec({id: 'c1', date: '2026-07-02', status: 'déclaré'}), rec({id: 'c2', date: '2026-06-01', status: 'expertisé', indemnity: 1500}), rec({id: 'c3', date: '2026-05-01', status: 'indemnisé', indemnity: 900})]));
  assert.equal(t.pending, 3500); assert.equal(t.received, 900); assert.equal(t.open, 2);
});

test('PDF du dossier', () => {
  const s = farm(), claim = {...claimDraft(s, obs), areaHa: 2, lossPct: 40, statusHistory: [{status: 'déclaré', date: '2026-07-05'}]};
  const {blocks, loss} = claimPdfBlocks(s, claim, {photos: [{bytes: null, caption: 'photo.heic'}], today: '2026-07-10'});
  assert.equal(loss.tonnes, 8); assert.equal(loss.euros, 1600);
  assert.ok(blocks.some(b => b.type === 'p' && /Fédération départementale des chasseurs/.test(b.text)));
  const bytes = flowPdf(blocks, {title: 'Dossier sinistre'});
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});
