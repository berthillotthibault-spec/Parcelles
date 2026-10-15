// « Vous êtes dans » contextuel (n° 111) : parcelle de la position selon précision et distance à la limite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HERE_MAX_ACCURACY_M, applyHereToEntry, dueWorksHere, hereBadge, pickHereParcel} from './here-context.js';

const square = (id, nom, lon0, lon1) => ({id, nom, geometry: {type: 'Polygon', coordinates: [[[lon0, 45], [lon1, 45], [lon1, 45.002], [lon0, 45.002], [lon0, 45]]]}});
const A = square('a', 'Grandes Terres', 0, 0.003), B = square('b', 'Pré du Moulin', 0.003, 0.006);
const parcels = [A, B];
const center = {latitude: 45.001, longitude: 0.0015};
const nearEdge = {latitude: 45.001, longitude: 0.0029}; // ~8 m de la limite commune A/B

test('position précise au milieu de la parcelle : sûre, avec pastille', () => {
  const here = pickHereParcel({...center, accuracy: 8}, parcels);
  assert.equal(here.parcel.id, 'a');
  assert.equal(here.precise, true);
  assert.equal(here.nearEdge, false);
  assert.equal(here.confident, true);
  assert.ok(here.edgeDistance > 100 && here.edgeDistance < 120);
  assert.deepEqual(hereBadge(here), {label: 'Vous êtes dans : Grandes Terres', detail: '± 8 m'});
});

test('précision au seuil de 25 m acceptée, au-delà : pas de pastille et confirmation', () => {
  assert.equal(HERE_MAX_ACCURACY_M, 25);
  assert.equal(pickHereParcel({...center, accuracy: 25}, parcels).confident, true);
  const loose = pickHereParcel({...center, accuracy: 40}, parcels);
  assert.equal(loose.parcel.id, 'a');
  assert.equal(loose.precise, false);
  assert.equal(loose.confident, false);
  assert.equal(loose.reason, 'accuracy');
  assert.equal(hereBadge(loose), null);
  const unknown = pickHereParcel(center, parcels);
  assert.equal(unknown.accuracy, null);
  assert.equal(unknown.confident, false);
});

test('près d’une limite : pastille mais confirmation, voisine proposée', () => {
  const here = pickHereParcel({...nearEdge, accuracy: 5}, parcels);
  assert.equal(here.parcel.id, 'a');
  assert.equal(here.precise, true);
  assert.equal(here.nearEdge, true);
  assert.equal(here.confident, false);
  assert.equal(here.reason, 'edge');
  assert.deepEqual(here.neighbours.map(p => p.id), ['b']);
  assert.match(hereBadge(here).detail, /près d’une limite/);
  // La marge suit la précision : à 20 m de la limite avec ± 25 m, ce n'est pas sûr.
  const mid = pickHereParcel({latitude: 45.001, longitude: 0.00275, accuracy: 25}, parcels);
  assert.ok(mid.edgeDistance > 15 && mid.edgeDistance < 25);
  assert.equal(mid.confident, false);
  assert.equal(pickHereParcel({latitude: 45.001, longitude: 0.00275, accuracy: 5}, parcels).confident, true);
});

test('hors parcelle, position absente, ancienne ou parcelle archivée : rien', () => {
  assert.equal(pickHereParcel({latitude: 46, longitude: 1, accuracy: 5}, parcels), null);
  assert.equal(pickHereParcel(null, parcels), null);
  assert.equal(pickHereParcel({latitude: 'x', longitude: 0}, parcels), null);
  const now = 10 * 60000;
  assert.equal(pickHereParcel({...center, accuracy: 5, at: 0.5 * 60000}, parcels, {now}), null);
  assert.equal(pickHereParcel({...center, accuracy: 5, at: 8 * 60000}, parcels, {now}).parcel.id, 'a');
  assert.equal(pickHereParcel({...center, accuracy: 5}, [{...A, archived: true}, B]), null);
  assert.equal(pickHereParcel({...center, accuracy: 5}, [{...A, deletedAt: 1}]), null);
});

const workEntry = (extra = {}) => ({intent: 'work', type: 'Semis', parcels: [], parcelChoices: [], parcelProbable: false, recognized: new Set(), ...extra});

test('« j’ai fini de semer » sans parcelle : la parcelle sûre est cochée', () => {
  const here = pickHereParcel({...center, accuracy: 6}, parcels);
  const entry = applyHereToEntry(workEntry(), here);
  assert.deepEqual(entry.parcels.map(p => p.id), ['a']);
  assert.equal(entry.parcelProbable, false);
  assert.equal(entry.hereParcelId, 'a');
  assert.match(entry.hereNote, /± 6 m/);
});

test('position douteuse : parcelle seulement proposée (confirmation par toucher)', () => {
  const loose = applyHereToEntry(workEntry(), pickHereParcel({...center, accuracy: 60}, parcels));
  assert.deepEqual(loose.parcels, []);
  assert.deepEqual(loose.parcelChoices.flat().map(p => p.id), ['a']);
  assert.match(loose.hereNote, /Position imprécise.*confirmer/);
  const edge = applyHereToEntry(workEntry(), pickHereParcel({...nearEdge, accuracy: 5}, parcels));
  assert.deepEqual(edge.parcelChoices.flat().map(p => p.id), ['a', 'b']);
  assert.match(edge.hereNote, /près d’une limite/);
});

test('parcelle nommée, choix ambigu, autre intention ou pas de position : saisie inchangée', () => {
  const here = pickHereParcel({...center, accuracy: 6}, parcels);
  const named = workEntry({parcels: [B]});
  assert.equal(applyHereToEntry(named, here), named);
  const ambiguous = workEntry({parcelChoices: [[A, B]]});
  assert.equal(applyHereToEntry(ambiguous, here), ambiguous);
  const stock = {intent: 'stock', parcels: [], parcelChoices: []};
  assert.equal(applyHereToEntry(stock, here), stock);
  const plain = workEntry();
  assert.equal(applyHereToEntry(plain, null), plain);
});

test('travaux dus sur place : à faire, échus ou en retard, les plus anciens d’abord', () => {
  const works = [
    {id: 'w1', parcelId: 'a', status: 'À faire', plannedDate: '2026-10-20'},
    {id: 'w2', parcelId: 'a', status: 'À faire', plannedDate: '2026-10-10'},
    {id: 'w3', parcelId: 'a', status: 'À faire', plannedDate: '2026-10-15'},
    {id: 'w4', parcelId: 'a', status: 'Terminé', date: '2026-10-01'},
    {id: 'w5', parcelId: 'b', status: 'À faire', plannedDate: '2026-10-01'},
    {id: 'w6', parcelId: 'a', status: 'À faire', plannedDate: '2026-10-01', deletedAt: 1},
    {id: 'w7', parcelId: 'a', status: 'À faire'}
  ];
  const due = dueWorksHere(works, 'a', '2026-10-15');
  assert.deepEqual(due.map(w => w.id), ['w2', 'w3', 'w7']);
  assert.equal(due[0].overdue, true);
  assert.equal(due[1].overdue, false);
  assert.equal(dueWorksHere(works, 'a', '2026-10-15', 1).length, 1);
});

test('interface différée : pastille échappée, feuille de carte et rafraîchissement au changement de parcelle', async () => {
  const {createHereUI} = await import('./here-ui.js');
  const odd = {...A, nom: '<b>Champ</b>'};
  const data = {parcelles: [odd, B], interventions: [{id: 'w"1', parcelId: 'a', status: 'À faire', plannedDate: '2026-10-01', type: 'Semis'}]};
  const changes = [];
  const ui = createHereUI({state: () => data, todayIso: () => '2026-10-15', onChange: here => changes.push(here?.parcel.id || null), initial: {...center, accuracy: 6}});
  assert.deepEqual(changes, []); // position initiale : pas de rafraîchissement
  assert.match(ui.pill(), /Vous êtes dans : &lt;b&gt;Champ&lt;\/b&gt;/);
  const sheet = ui.sheetHtml(odd);
  assert.match(sheet, /data-action="finish-work" data-id="w&quot;1"/);
  assert.match(sheet, /data-action="quick-work" data-parcel-id="a"/);
  assert.equal(ui.sheetHtml(B), '');
  ui.gps({latitude: 45.001, longitude: 0.0045, accuracy: 5});
  ui.gps({latitude: 45.001, longitude: 0.0046, accuracy: 4});
  assert.deepEqual(changes, ['b']);
  ui.gps({latitude: 45.001, longitude: 0.0045, accuracy: 80});
  assert.equal(ui.pill(), '');
  assert.match(ui.sheetHtml(B), /Vous semblez être dans cette parcelle/);
  assert.deepEqual(ui.apply(workEntry()).parcelChoices.flat().map(p => p.id), ['b']);
});

test('parcelles superposées : jamais sûre, les autres parcelles contenant le point proposées en premier', () => {
  const dup = {...A, id: 'a2', nom: 'Grandes Terres (dérobée)'};
  const here = pickHereParcel({...center, accuracy: 5}, [A, dup, B]);
  assert.equal(here.parcel.id, 'a');
  assert.equal(here.overlap, true);
  assert.equal(here.confident, false);
  assert.equal(here.reason, 'overlap');
  assert.equal(here.neighbours[0].id, 'a2');
  const entry = applyHereToEntry(workEntry(), here);
  assert.deepEqual(entry.parcels, []);
  assert.deepEqual(entry.parcelChoices.flat().map(p => p.id), ['a', 'a2']);
  assert.match(entry.hereNote, /superposées.*confirmer/);
});

test('travail daté d’un autre jour : parcelle de la position seulement proposée', () => {
  const here = pickHereParcel({...center, accuracy: 6}, parcels);
  const today = '2026-10-15';
  assert.deepEqual(applyHereToEntry(workEntry({date: today}), here, {today}).parcels.map(p => p.id), ['a']);
  for (const date of ['2026-10-14', '2026-10-16']) {
    const entry = applyHereToEntry(workEntry({date}), here, {today});
    assert.deepEqual(entry.parcels, []);
    assert.deepEqual(entry.parcelChoices.flat().map(p => p.id), ['a']);
    assert.match(entry.hereNote, /^Position actuelle : Grandes Terres \(± 6 m\)/);
  }
});

test('interface différée : feuille sans zone live, pastille à jour quand la précision change', async () => {
  const {createHereUI} = await import('./here-ui.js');
  const changes = [];
  const ui = createHereUI({state: () => ({parcelles: parcels, interventions: []}), todayIso: () => '2026-10-15', onChange: here => changes.push(here?.accuracy)});
  ui.gps({...center, accuracy: 6});
  ui.gps({...center, accuracy: 7});
  ui.gps({...center, accuracy: 20});
  assert.deepEqual(changes, [6, 20]);
  assert.doesNotMatch(ui.sheetHtml(A), /role="status"/);
  assert.match(ui.sheetHtml(A), /± 20 m/);
  assert.match(ui.pill(), /role="status"/);
  assert.deepEqual(ui.apply(workEntry({date: '2026-10-14'})).parcels, []);
});
