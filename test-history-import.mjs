// n° 124 — « Je viens d'un autre logiciel » : historique de travaux CSV, correspondance des colonnes,
// rattachement par nom de parcelle, dédoublonnage source/sourceId et session d'import annulable.
// Données entièrement fictives.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HISTORY_PRESETS, DAPLOS_NOTE, presetKey, presetSteps, historyMapping, cleanMapping} from './history-import.js';

globalThis.window ??= globalThis;
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const CSV = ['Parcelle;Date de réalisation;Type intervention;Produit utilisé;Dose;Unité;Surface travaillée;N° intervention',
  'Champ du Haut;12/04/2025;Traitement fongicide;Fongi Fictif;0,8;L/ha;4,4;INT-1',
  'champ du haut;20/03/2024;Fertilisation;Ammonitrate 27;150;kg/ha;;INT-2',
  'Pré Fictif;2023-09-01;Semis;Ray-grass;25;kg/ha;2,5;INT-3',
  'Inconnue;01/05/2025;Fauche;;;;;INT-4',
  'Champ du Haut;;Sans date;;;;;INT-5',
  'Champ du Haut;02/05/2025;;;;;;INT-6'].join('\n');

const farm = async () => {
  const {emptyState} = await import('./state.js');
  return {...emptyState(), parcelles: [
    {id: 'p1', nom: 'Champ du Haut', sourceId: 'telepac:1.1', surfaceHa: 4.4, createdAt: 1, updatedAt: 1, version: 1},
    {id: 'p2', nom: 'Pré Fictif', surfaceHa: 2.5, createdAt: 1, updatedAt: 1, version: 1}]};
};
const memStore = current => {
  const backups = new Map();
  const store = {snapshot: () => structuredClone(current), get state() {return current;},
    get: (type, id) => current[type].find(x => x.id === id),
    storage: {backupPut: async b => backups.set(b.id, structuredClone(b)), backupGet: async id => backups.get(id), backupDelete: async id => backups.delete(id)},
    replaceState: async next => {current = next;}};
  return store;
};

test('préréglages, aide Daplos et nettoyage de la correspondance', () => {
  assert.deepEqual(Object.keys(HISTORY_PRESETS), ['mesparcelles', 'smag', 'geofolia', 'autre']);
  assert.equal(presetKey('inconnu'), 'autre');
  assert.match(presetSteps('smag')[0], /Smag/);
  assert.ok(presetSteps('geofolia').some(t => /nom de parcelle/.test(t)));
  assert.match(DAPLOS_NOTE, /Daplos.*n’est pas lu/);
  assert.deepEqual(historyMapping('geofolia'), {historyOnly: '1', preset: 'geofolia'});
  assert.deepEqual(cleanMapping({name: 'Parcelle', date: ' Date ', type: '', evil: 'x'}, {history: true, preset: 'smag'}),
    {name: 'Parcelle', date: 'Date', historyOnly: '1', confirmed: '1', preset: 'smag'});
  assert.deepEqual(cleanMapping({name: 'Nom'}), {name: 'Nom'});
});

test('historique CSV : correspondance proposée, aperçu, import rattaché par nom, ré-import sans doublon, annulation', async () => {
  const impex = await import('./import-export.js');
  let current = await farm();
  const file = () => new File([CSV], 'interventions-mesparcelles.csv', {type: 'text/csv'});
  // 1. Premier passage : l'écran de correspondance est toujours proposé, pré-rempli.
  const first = await impex.inspectFiles([file()], current, historyMapping('mesparcelles'));
  assert.equal(first.invalid.length, 0, JSON.stringify(first.invalid));
  assert.equal(impex.previewNeedsMapping(first), true);
  assert.deepEqual(first.suggestedMapping, {name: 'Parcelle', date: 'Date de réalisation', type: 'Type intervention', product: 'Produit utilisé', dose: 'Dose', doseUnit: 'Unité', workSurface: 'Surface travaillée', workId: 'N° intervention'});
  assert.equal(impex.mappingErrors({name: 'Parcelle'}, {history: true}), 'Associez la date et le type d’intervention.');
  assert.equal(impex.mappingErrors({name: 'Parcelle', date: 'D', type: 'T'}, {history: true}), '');
  assert.equal(impex.mappingErrors({}), 'Associez le nom de parcelle.');
  // 2. Correspondance confirmée : aperçu, aucune parcelle à créer.
  const mapping = cleanMapping(first.suggestedMapping, {history: true, preset: 'mesparcelles'});
  const preview = await impex.inspectFiles([file()], current, mapping);
  assert.equal(impex.previewNeedsMapping(preview), false);
  assert.equal(preview.summary.parcels, 0);
  assert.equal(preview.summary.interventions, 4); // la ligne sans date ni produit n'est pas une intervention
  assert.ok(preview.warnings.some(w => /1 ligne\(s\) sans type/.test(w)));
  assert.ok(preview.warnings.some(w => /sans date lisible/.test(w)));
  assert.ok(preview.warnings.some(w => /sans parcelle du même nom.*Inconnue/.test(w)));
  const store = memStore(current);
  const result = await impex.applyImport(preview, store, 'merge');
  current = store.state;
  assert.deepEqual({created: result.created, updated: result.updated, interventions: result.interventions}, {created: 0, updated: 0, interventions: 3});
  assert.equal(current.parcelles.length, 2);
  const works = current.interventions;
  const fongi = works.find(w => w.type === 'Traitement fongicide');
  assert.equal(fongi.parcelId, 'p1'); // nom identique malgré l'identifiant telepac de la parcelle
  assert.equal(fongi.date, '2025-04-12');
  assert.equal(fongi.status, 'Terminé');
  assert.equal(fongi.surfaceWorked, 4.4);
  assert.equal(fongi.source, 'import');
  assert.match(fongi.sourceId, /^hist:id:int 1:[0-9a-f]{8}$/);
  assert.equal(works.find(w => w.type === 'Fertilisation').parcelId, 'p1'); // casse différente
  assert.equal(works.find(w => w.type === 'Semis').parcelId, 'p2');
  assert.equal(works.find(w => w.type === 'Semis').campaignId, '2023/24');
  const session = current.importSessions.at(-1);
  assert.equal(session.kind, 'history'); assert.equal(session.preset, 'mesparcelles');
  // 3. Ré-import du même fichier : signalé puis ignoré.
  const again = await impex.inspectFiles([file()], current, mapping);
  assert.ok(again.warnings.some(w => /3 intervention\(s\) déjà importée/.test(w)));
  const store2 = memStore(current);
  const r2 = await impex.applyImport(again, store2, 'merge');
  assert.equal(r2.interventions, 0);
  assert.equal(store2.state.interventions.length, 3);
  // 4. La session est annulable : état d'avant restauré.
  await impex.rollbackImportSession(store, result.sessionId);
  assert.equal(store.state.interventions.length, 0);
});

test('import de tableur classique : travaux dédoublonnés sans identifiant de ligne', async () => {
  const impex = await import('./import-export.js');
  let current = await farm();
  const csv = 'nom;type;date;produit;dose\nPré Fictif;Fauche;2025-06-01;;\n';
  const store = memStore(current);
  const p1 = await impex.inspectFiles([new File([csv], 'travaux.csv')], current);
  assert.equal((await impex.applyImport(p1, store, 'merge')).interventions, 1);
  current = store.state;
  assert.match(current.interventions[0].sourceId, /^hist:[0-9a-f]{8}$/);
  const store2 = memStore(current);
  const p2 = await impex.inspectFiles([new File([csv], 'travaux.csv')], current);
  assert.equal((await impex.applyImport(p2, store2, 'merge')).interventions, 0);
});

test('branchement : module différé, CORE, accueil, Mes données et écran de correspondance', () => {
  const lazy = read('./lazy-modules.js'), app = read('./app.js'), sw = read('./sw.js'), runtime = read('./runtime.js'), ui = read('./history-import-ui.js');
  assert.match(lazy, /historyImport: \(\) => import\('\.\/history-import-ui\.js'\)/);
  assert.match(lazy, /actions\('historyImport', 'open-history-import'\)/);
  for (const f of ['./history-import.js', './history-import-ui.js']) {assert.ok(sw.includes(`'${f}'`), f); assert.ok(runtime.includes(`'${f}'`), f);}
  assert.ok(read('./data-actions.js').includes("'open-history-import'() { ctx.historyImportUI?.openGuide(); }")); // n° 147 : registre d'actions
  assert.equal((app.match(/data-action="open-history-import"/g) || []).length, 2); // accueil + Mes données
  assert.ok(app.includes("lazy.run('historyImport',()=>historyImportUI.openMapping(preview,files))"));
  assert.ok(app.includes("{label:'Annuler',run:()=>rollbackImport(result.sessionId)}"));
  assert.ok(ui.includes('WORK_MAPPING_FIELDS') && ui.includes('id="mapping-error"') && ui.includes('DAPLOS_NOTE'));
});

test('historique : un même n° d’intervention sur plusieurs parcelles et produits ne fusionne pas les lignes', async () => {
  const impex = await import('./import-export.js');
  const id = (parcel, product, date = '2025-04-12') => impex.workRowSourceId({workId: '42', type: 'Traitement', product}, parcel, date);
  const keys = new Set([id('pA', 'Fongi 1'), id('pA', 'Fongi 2'), id('pB', 'Fongi 1'), id('pB', 'Fongi 2'), id('pA', 'Fongi 1', '2026-04-12')]);
  assert.equal(keys.size, 5);
  assert.equal(id('pA', 'Fongi 1'), id('pA', ' fongi 1 '), 'ré-import du même fichier : même clé');
});
