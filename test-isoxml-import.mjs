// n° 124 · Import ISOXML TASKDATA : travaux réalisés de la console (logique pure).
// Fixture fictive embarquée (test-static n'autorise pas de .xml publié hors fixtures déclarées).
import test from 'node:test';
import assert from 'node:assert/strict';
import {interiorPoint, isTaskDataXml, parseXmlLite, parseTaskData, guessWorkType, matchIsoxmlParcel, isoxmlImportRows, isoxmlInterventionFields, isoxmlSourceId} from './isoxml-import.js';
import {createZip, readZip} from './zip-lite.js';

const ring = (lon, lat, d = 0.002) => `<PNT A="2" C="${lat}" D="${lon}"/><PNT A="2" C="${lat}" D="${lon + d}"/><PNT A="2" C="${lat + d}" D="${lon + d}"/><PNT A="2" C="${lat + d}" D="${lon}"/>`;
export const TASKDATA = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Données entièrement fictives -->
<ISO11783_TaskData VersionMajor="4" VersionMinor="2" DataTransferOrigin="1">
  <CTP A="CTP1" B="Blé tendre"/>
  <CPC A="CPC1" B="Pulvérisation"/>
  <PDT A="PDT1" B="Fongicide Fictif &amp; Co"/>
  <PDT A="PDT2" B="Ammonitrate 27"/>
  <WKR A="WKR1" B="Martin" C="Paul"/>
  <PFD A="PFD1" B="P01" C="Champ du Haut" D="44000" G="CTP1">
    <PLN A="1"><LSG A="1">${ring(4.001, 46.001)}</LSG></PLN>
  </PFD>
  <PFD A="PFD2" C="Pré Fictif" D="25000">
    <PLN A="1"><LSG A="1">${ring(4.101, 46.101)}</LSG></PLN>
  </PFD>
  <PFD A="PFD3" C="Les Noues" D="30000">
    <PLN A="1"><LSG A="1">${ring(4.201, 46.201, 0.003)}</LSG><LSG A="2">${ring(4.202, 46.202, 0.0005)}</LSG></PLN>
  </PFD>
  <TSK A="TSK1" B="Traitement fongicide" E="PFD1" F="WKR1" G="4">
    <OTP A="CPC1" B="OTQ1"/>
    <TZN A="1"><PDV A="0001" B="12000" C="PDT1"/></TZN>
    <TIM A="2026-04-12T08:30:00" B="2026-04-12T10:00:00" D="4"><DLV A="0002" B="11500"/></TIM>
  </TSK>
  <TSK A="TSK2" B="Apport azote" E="PFD2" G="4">
    <TZN A="1"><PDV A="0006" B="15000" C="PDT2"/></TZN>
    <TIM A="2026-03-02T14:00:00" C="2700" D="4"/>
  </TSK>
  <TSK A="TSK3" B="Semis" E="PFD3" G="1"/>
  <TSK A="TSK4" B="Déchaumage" E="PFD3" G="4">
    <TIM A="2026-08-20T07:00:00" B="2026-08-20T09:30:00" D="4"/>
  </TSK>
  <TSK A="TSK5" B="Inconnue" E="PFD9" G="4"><TIM A="2026-05-01T07:00:00" B="2026-05-01T08:00:00" D="4"/></TSK>
</ISO11783_TaskData>`;

const sq = (lon, lat, d = 0.002) => ({type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]});
const state = () => ({
  parcelles: [
    {id: 'p1', nom: 'Grande pièce', geometry: sq(4.0005, 46.0005, 0.003)}, // contient le centroïde de PFD1
    {id: 'p2', nom: 'pré fictif'}, // rapprochée par nom
    {id: 'p3', nom: 'Ancienne', geometry: sq(4.0005, 46.0005, 0.003), deletedAt: 5},
  ],
  interventions: [],
});

test('détection et lecteur minimal : attributs, entités, imbrication', () => {
  assert.equal(isTaskDataXml(TASKDATA), true);
  assert.equal(isTaskDataXml('<gpx></gpx>'), false);
  const root = parseXmlLite(TASKDATA);
  assert.equal(root.tag, 'ISO11783_TaskData');
  assert.equal(root.children.find(c => c.attrs.A === 'PDT1').attrs.B, 'Fongicide Fictif & Co');
  assert.throws(() => parseXmlLite('<A><B></A>'), /mal formé/);
  assert.throws(() => parseTaskData('<gpx/>', {parseXml: parseXmlLite}), /ISO11783_TaskData/);
});

test('PFD : contour WGS84 fermé, enclave, surface et culture', () => {
  const {parcels} = parseTaskData(TASKDATA, {parseXml: parseXmlLite});
  assert.equal(parcels.length, 3);
  const [p1, , p3] = parcels;
  assert.equal(p1.name, 'Champ du Haut');
  assert.equal(p1.areaHa, 4.4);
  assert.equal(p1.crop, 'Blé tendre');
  assert.equal(p1.geometry.type, 'Polygon');
  const outer = p1.geometry.coordinates[0];
  assert.equal(outer.length, 5);
  assert.deepEqual(outer[0], outer[4]);
  assert.deepEqual(outer[0], [4.001, 46.001]); // [longitude, latitude]
  assert.equal(p3.geometry.coordinates.length, 2);
});

test('TSK : date, horaires, durée, dose relevée prioritaire, produit, opérateur, statut', () => {
  const {tasks} = parseTaskData(TASKDATA, {parseXml: parseXmlLite});
  const [t1, t2, t3] = tasks;
  assert.deepEqual({date: t1.date, start: t1.startTime, end: t1.endTime, h: t1.durationHours, done: t1.done}, {date: '2026-04-12', start: '08:30', end: '10:00', h: 1.5, done: true});
  assert.equal(t1.dose, 115); // 11500 mm³/m² relevés = 115 L/ha (plutôt que la consigne 120)
  assert.equal(t1.doseUnit, 'L/ha');
  assert.equal(t1.product, 'Fongicide Fictif & Co');
  assert.equal(t1.operator, 'Paul Martin');
  assert.equal(t1.practice, 'Pulvérisation');
  assert.equal(t2.dose, 150);
  assert.equal(t2.doseUnit, 'kg/ha');
  assert.equal(t2.durationHours, 0.75); // durée C en secondes
  assert.equal(t3.done, false);
});

test('type de travail : pratique, désignation, unité de dose', () => {
  assert.equal(guessWorkType({practice: 'Pulvérisation', name: 'x'}), 'Traitement');
  assert.equal(guessWorkType({name: 'Déchaumage'}), 'Travail du sol');
  assert.equal(guessWorkType({name: 'Tâche 7', doseUnit: 'kg/ha'}), 'Fertilisation');
  assert.equal(guessWorkType({name: ''}), 'Travail console');
});

test('rapprochement : contour (centroïde) puis nom, parcelles supprimées ignorées', () => {
  const {parcels} = parseTaskData(TASKDATA, {parseXml: parseXmlLite});
  const s = state();
  assert.deepEqual(matchIsoxmlParcel(parcels[0], s.parcelles).parcel.id, 'p1');
  assert.equal(matchIsoxmlParcel(parcels[0], s.parcelles).by, 'géométrie');
  assert.equal(matchIsoxmlParcel(parcels[1], s.parcelles).by, 'nom');
  assert.equal(matchIsoxmlParcel(parcels[2], s.parcelles), null);
  // Deux contours contenant le centroïde : ambigu, pas de rapprochement par contour.
  const twice = [...s.parcelles, {id: 'p4', nom: 'Doublon', geometry: sq(4.0005, 46.0005, 0.003)}];
  assert.equal(matchIsoxmlParcel(parcels[0], twice), null);
});

test('lignes d’aperçu : travaux terminés rattachés, parcelle proposée, dédoublonnage', () => {
  const data = parseTaskData(TASKDATA, {parseXml: parseXmlLite});
  const s = state();
  const result = isoxmlImportRows(data, s);
  assert.equal(result.workRows.length, 3);
  assert.equal(result.parcelRows.length, 1);
  assert.equal(result.parcelRows[0].nom, 'Les Noues');
  assert.equal(result.parcelRows[0].sourceId, 'isoxml:PFD3:les-noues');
  assert.deepEqual(result.stats, {tasks: 5, done: 4, planned: 1, duplicates: 0, matchedByGeometry: 1, matchedByName: 1, newParcels: 1, orphans: 1});
  const [w1, w2, w4] = result.workRows;
  assert.equal(w1.parcelId, 'p1');
  assert.equal(w1.type, 'Traitement');
  assert.equal(w1.sourceId, 'isoxml:2026-04-12:08h30:champ-du-haut:traitement-fongicide');
  assert.equal(w2.parcelId, 'p2');
  assert.equal(w4.parcelSourceId, 'isoxml:PFD3:les-noues');
  assert.equal(w4.parcelId, undefined);
  // Ré-import : les tâches déjà présentes sont écartées.
  s.interventions.push({source: 'isoxml', sourceId: isoxmlSourceId(data.tasks[0], data.parcels[0]), parcelId: 'p1'});
  const again = isoxmlImportRows(data, s);
  assert.equal(again.stats.duplicates, 1);
  assert.equal(again.workRows.length, 2);
  assert.ok(again.warnings.some(w => /déjà importée/.test(w)));
  // Une intervention supprimée ne bloque pas le ré-import.
  s.interventions[0].deletedAt = 1;
  assert.equal(isoxmlImportRows(data, s).stats.duplicates, 0);
});

test('champs d’intervention : source isoxml, durée, opérateur, horaires', () => {
  const data = parseTaskData(TASKDATA, {parseXml: parseXmlLite});
  const [w1, w2] = isoxmlImportRows(data, state()).workRows;
  assert.deepEqual(isoxmlInterventionFields(w1), {source: 'isoxml', sourceId: 'isoxml:2026-04-12:08h30:champ-du-haut:traitement-fongicide', note: 'Console ISOXML : Traitement fongicide', duration: 1.5, operator: 'Paul Martin', startTime: '08:30', endTime: '10:00'});
  assert.equal(isoxmlInterventionFields(w2).operator, undefined);
});

test('ZIP : TASKDATA/TASKDATA.XML lisible via zip-lite', async () => {
  const zip = await createZip([{name: 'TASKDATA/TASKDATA.XML', data: new TextEncoder().encode(TASKDATA)}]);
  const entries = await readZip(zip);
  const entry = entries.find(e => /(^|\/)TASKDATA\.XML$/i.test(e.name));
  assert.ok(entry);
  const {tasks} = parseTaskData(await entry.text(), {parseXml: parseXmlLite});
  assert.equal(tasks.length, 5);
});

// Flux d'import complet : aperçu, import en une session annulable, ré-import dédoublonné.
test('inspectFiles + applyImport : XML seul puis ZIP TASKDATA, sans doublon au ré-import', async () => {
  const {inspectFiles, applyImport, importPreviewHtml, previewNeedsMapping} = await import('./import-export.js');
  const {emptyState} = await import('./state.js');
  let current = {...emptyState(), parcelles: state().parcelles.slice(0, 2).map(p => ({...p, createdAt: 1, updatedAt: 1, version: 1}))};
  const store = {snapshot: () => structuredClone(current), storage: {backupPut: async () => {}}, replaceState: async next => {current = next;}};
  const file = new File([TASKDATA], 'TASKDATA.XML', {type: 'application/xml'});
  const preview = await inspectFiles([file], current);
  assert.equal(preview.invalid.length, 0, JSON.stringify(preview.invalid));
  assert.equal(preview.sources[0].engine, 'ISOXML');
  assert.equal(preview.summary.interventions, 3);
  assert.equal(preview.summary.parcels, 1);
  assert.equal(previewNeedsMapping(preview), false);
  assert.ok(preview.warnings.some(w => /1 rapprochée\(s\) par contour, 1 par nom/.test(w)));
  assert.match(importPreviewHtml(preview), /Les Noues/);
  assert.doesNotMatch(importPreviewHtml(preview), /NaN/);
  const result = await applyImport(preview, store, 'merge');
  assert.deepEqual({created: result.created, interventions: result.interventions, skipped: result.skipped}, {created: 1, interventions: 3, skipped: 0});
  const works = current.interventions;
  const w1 = works.find(w => w.sourceId === 'isoxml:2026-04-12:08h30:champ-du-haut:traitement-fongicide');
  assert.equal(w1.parcelId, 'p1');
  assert.equal(w1.source, 'isoxml');
  assert.equal(w1.status, 'Terminé');
  assert.equal(w1.dose, 115);
  assert.equal(w1.operator, 'Paul Martin');
  assert.equal(w1.duration, 1.5);
  const noues = current.parcelles.find(p => p.nom === 'Les Noues');
  assert.equal(works.find(w => w.sourceId === 'isoxml:2026-08-20:07h00:les-noues:dechaumage').parcelId, noues.id);
  assert.equal(current.importSessions.length, 1);
  // Ré-import du même export dans un ZIP : rien de nouveau (la parcelle créée est reconnue par contour).
  const zip = await createZip([{name: 'TASKDATA/TASKDATA.XML', data: new TextEncoder().encode(TASKDATA)}]);
  const again = await inspectFiles([new File([zip instanceof Blob ? await zip.arrayBuffer() : zip], 'console.zip')], current);
  assert.equal(again.invalid.length, 0, JSON.stringify(again.invalid));
  assert.equal(again.summary.interventions, 0);
  assert.equal(again.summary.parcels, 0);
  assert.ok(again.warnings.some(w => /3 tâche\(s\) déjà importée/.test(w)));
});

// Constats de relecture (n° 124).
const doc = body => `<ISO11783_TaskData VersionMajor="4"><PFD A="PFD1" C="Champ du Haut"><PLN A="1"><LSG A="1">${ring(4.001, 46.001)}</LSG></PLN></PFD>${body}</ISO11783_TaskData>`;

test('statut ISO 11783 : planifiée, modèle, annulée et temps planifiés seuls ne sont pas réalisés', () => {
  const {tasks} = parseTaskData(doc(`
    <TSK A="TSK1" E="PFD1" G="6"><TIM A="2026-04-01T08:00:00" B="2026-04-01T09:00:00" D="4"/></TSK>
    <TSK A="TSK2" E="PFD1" G="5"><TIM A="2026-04-02T08:00:00" B="2026-04-02T09:00:00" D="1"/></TSK>
    <TSK A="TSK3" E="PFD1" G="3"><TIM A="2026-04-03T08:00:00" B="2026-04-03T09:00:00" D="1"/></TSK>
    <TSK A="TSK4" E="PFD1" G="1"><TIM A="2026-04-04T08:00:00" B="2026-04-04T09:00:00" D="4"/></TSK>
    <TSK A="TSK5" E="PFD1" G="3"><TIM A="2026-04-05T08:00:00" B="2026-04-05T09:00:00" D="4"/></TSK>
    <TSK A="TSK6" E="PFD1" G="4"><TIM A="2026-04-06T08:00:00" B="2026-04-06T09:00:00" D="1"/></TSK>`), {parseXml: parseXmlLite});
  assert.deepEqual(tasks.map(t => t.done), [false, false, false, false, true, true]);
  assert.equal(tasks[2].date, null, 'un temps planifié seul ne date pas une tâche en pause');
  assert.equal(tasks[5].date, '2026-04-06', 'repli sur tous les TIM pour une tâche terminée');
  assert.equal(isoxmlImportRows({parcels: [], tasks}, {}).stats.done, 2);
});

test('dédoublonnage : même TSK1 le même jour dans deux exports, sur deux parcelles, donne deux travaux', () => {
  const exportA = parseTaskData(doc(`<TSK A="TSK1" B="Semis" E="PFD1" G="4"><TIM A="2026-04-01T08:00:00" B="2026-04-01T09:00:00" D="4"/></TSK>`), {parseXml: parseXmlLite});
  const exportB = parseTaskData(`<ISO11783_TaskData><PFD A="PFD1" C="Pré Fictif"><PLN A="1"><LSG A="1">${ring(4.101, 46.101)}</LSG></PLN></PFD><TSK A="TSK1" B="Semis" E="PFD1" G="4"><TIM A="2026-04-01T14:00:00" B="2026-04-01T15:00:00" D="4"/></TSK></ISO11783_TaskData>`, {parseXml: parseXmlLite});
  const s = state();
  const first = isoxmlImportRows(exportA, s);
  s.interventions.push(...first.workRows.map(r => ({source: 'isoxml', sourceId: r.sourceId, parcelId: r.parcelId})));
  const second = isoxmlImportRows(exportB, s);
  assert.equal(second.stats.duplicates, 0);
  assert.equal(second.workRows.length, 1);
  assert.notEqual(second.workRows[0].sourceId, first.workRows[0].sourceId);
  // Le même travail réexporté sous un autre identifiant TSK reste reconnu.
  const renamed = {...exportA, tasks: exportA.tasks.map(t => ({...t, id: 'TSK7'}))};
  assert.equal(isoxmlImportRows(renamed, s).stats.duplicates, 1);
});

test('contour concave : rapprochement par point intérieur, pas de parcelle en double', () => {
  // L dont le centre de l'emprise tombe hors du contour.
  const L = [[4, 46], [4.004, 46], [4.004, 46.001], [4.001, 46.001], [4.001, 46.004], [4, 46.004], [4, 46]];
  const geometry = {type: 'Polygon', coordinates: [L]};
  const p = interiorPoint(geometry);
  assert.ok(p);
  const parcels = [{id: 'tp', nom: 'Autre nom', sourceId: 'telepac:1.1', geometry}, {id: 'voisine', nom: 'Voisine', geometry: sq(4.0015, 46.0015, 0.0025)}];
  const pfd = {id: 'PFD1', name: 'Le Coude', geometry};
  assert.deepEqual(matchIsoxmlParcel(pfd, parcels), {parcel: parcels[0], by: 'géométrie'});
  const rows = isoxmlImportRows({parcels: [pfd], tasks: [{id: 'TSK1', name: 'Semis', parcelRef: 'PFD1', done: true, date: '2026-04-01', startTime: '08:00'}]}, {parcelles: parcels});
  assert.equal(rows.parcelRows.length, 0);
  assert.equal(rows.workRows[0].parcelId, 'tp');
});

test('dates avec décalage horaire converties en heure locale ; durée exacte', () => {
  const {tasks} = parseTaskData(doc(`<TSK A="TSK1" E="PFD1" G="4"><TIM A="2026-03-10T23:30:00Z" B="2026-03-11T01:00:00+00:00" D="4"/></TSK>`), {parseXml: parseXmlLite});
  const start = new Date('2026-03-10T23:30:00Z'), pad = n => String(n).padStart(2, '0');
  assert.equal(tasks[0].date, `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
  assert.equal(tasks[0].startTime, `${pad(start.getHours())}:${pad(start.getMinutes())}`);
  assert.equal(tasks[0].durationHours, 1.5);
  // Sans décalage : heure locale telle quelle.
  const local = parseTaskData(doc(`<TSK A="TSK1" E="PFD1" G="4"><TIM A="2026-03-10T23:30:00" D="4"/></TSK>`), {parseXml: parseXmlLite}).tasks[0];
  assert.deepEqual([local.date, local.startTime], ['2026-03-10', '23:30']);
});

test('contour invalide : parcelle proposée sans contour, travaux conservés', () => {
  const bad = {type: 'Polygon', coordinates: [[[4, 46], [4.1, 46], [4.1, 46.1]]]};
  const rows = isoxmlImportRows({parcels: [{id: 'PFD1', name: 'Bancale', areaHa: 1, geometry: bad}], tasks: [{id: 'TSK1', name: 'Semis', parcelRef: 'PFD1', done: true, date: '2026-04-01'}]}, {parcelles: []});
  assert.equal(rows.parcelRows[0].geometry, null);
  assert.equal(rows.workRows.length, 1);
  assert.ok(rows.warnings.some(w => /contour de « Bancale » invalide/.test(w)));
});
