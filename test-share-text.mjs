// n° 19 : texte de partage d'un travail, d'une observation et du récapitulatif du jour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRows} from './phyto.js';
import {dayShareText, mapsLink, observationPhoto, observationShareText, phytoMissing, shareDate, workShareText} from './share-text.js';

const square = {type: 'Polygon', coordinates: [[[2, 48], [2.002, 48], [2.002, 48.002], [2, 48.002], [2, 48]]]};
const parcel = {id: 'p1', nom: 'Grand Champ', surfaceHa: 12.5, culture: 'Blé tendre', geometry: square};

test('date et lien Maps', () => {
  assert.equal(shareDate('2026-10-15'), '15/10/2026');
  assert.equal(shareDate(''), '');
  assert.equal(mapsLink({latitude: 48.1, longitude: 2.5}), 'https://www.google.com/maps?q=48.100000,2.500000');
  assert.equal(mapsLink({latitude: 120, longitude: 2}), null);
  assert.equal(mapsLink(null), null);
});

test('travail terminé : parcelle, date, produit, opérateur, centroïde, sans coûts', () => {
  const w = {id: 'w1', parcelId: 'p1', type: 'Semis', status: 'Terminé', date: '2026-10-14', product: 'Semences RGT', dose: 180, doseUnit: 'kg/ha', operator: 'Paul', cost: 999, inputCost: 450, note: 'interne'};
  const r = workShareText(w, {parcel, equipment: {nom: 'Semoir 4 m'}});
  assert.equal(r.provisional, false);
  assert.equal(r.title, 'Semis · Grand Champ');
  assert.match(r.text, /Fait le 14\/10\/2026/);
  assert.match(r.text, /Parcelle : Grand Champ \(12,5 ha\)/);
  assert.match(r.text, /Produit : Semences RGT · 180 kg\/ha/);
  assert.match(r.text, /Opérateur : Paul/);
  assert.match(r.text, /Matériel : Semoir 4 m/);
  assert.match(r.text, /https:\/\/www\.google\.com\/maps\?q=48\.001000,2\.001000/);
  assert.doesNotMatch(r.text, /999|450|interne|w1|p1/);
});

test('travail prévu : échéance', () => {
  const r = workShareText({type: 'Labour', status: 'À faire', date: '2026-10-01', plannedDate: '2026-10-20'}, {});
  assert.match(r.text, /Prévu le 20\/10\/2026/);
  assert.match(r.text, /Statut : À faire/);
  assert.doesNotMatch(r.text, /Position/);
});

test('traitement phyto incomplet : mention provisoire', () => {
  const w = {parcelId: 'p1', type: 'Désherbage', isPhytosanitary: true, status: 'Terminé', date: '2026-10-14', product: 'Herbi X', dose: 1.2};
  const r = workShareText(w, {parcel});
  assert.equal(r.provisional, true);
  assert.match(r.title, /\(provisoire\)$/);
  assert.match(r.text, /^\[PROVISOIRE\]/);
  assert.ok(r.missing.includes('Unité') && r.missing.includes('Opérateur'));
  const full = {...w, amm: '2000001', doseUnit: 'l/ha', target: 'Graminées', surfaceWorked: 12, startTime: '08:00', operator: 'Paul'};
  assert.deepEqual(phytoMissing(full, {parcel}), []);
  assert.equal(workShareText(full, {parcel}).provisional, false);
  assert.deepEqual(phytoMissing({type: 'Semis'}, {parcel}), []);
});

test('traitement sans AMM ni culture : provisoire, comme le registre', () => {
  const noCrop = {id: 'p9', nom: 'Sans culture', surfaceHa: 3};
  const w = {id: 'w9', parcelId: 'p9', type: 'Désherbage', isPhytosanitary: true, status: 'Terminé', date: '2026-10-14', product: 'Herbi X', dose: 1.2, doseUnit: 'l/ha', target: 'Graminées', surfaceWorked: 3, startTime: '08:00', operator: 'Paul'};
  const data = {parcelles: [noCrop], interventions: [w]};
  const r = workShareText(w, {parcel: noCrop, state: data});
  assert.equal(r.provisional, true);
  assert.deepEqual(r.missing, ['Culture', 'AMM']);
  const row = registerRows(data, '2026/27')[0];
  assert.deepEqual(r.missing, row.missing);
  // AMM retrouvée dans la fiche du stock : même résultat que le registre.
  const withStock = {...data, stockItems: [{id: 's1', name: 'Herbi X', phyto: {amm: '2000001'}}]};
  assert.deepEqual(phytoMissing(w, {state: withStock, parcel: noCrop}), registerRows(withStock, '2026/27')[0].missing);
  // Parcelle supprimée : comptée manquante (pas l'identifiant seul).
  assert.ok(phytoMissing({...w, culture: 'Blé', amm: '1'}, {state: {parcelles: [{...noCrop, deletedAt: 1}]}}).includes('Parcelle'));
  // Heure illisible : manquante, comme clock() du registre.
  assert.ok(phytoMissing({...w, culture: 'Blé', amm: '1', startTime: 'matin'}, {parcel: noCrop}).includes('Heure de début'));
});

test('traitement prévu : jamais provisoire, rappel à compléter après réalisation', () => {
  const w = {parcelId: 'p1', type: 'Désherbage', isPhytosanitary: true, status: 'À faire', plannedDate: '2026-10-20', product: 'Herbi X'};
  const r = workShareText(w, {parcel});
  assert.equal(r.provisional, false);
  assert.deepEqual(r.missing, []);
  assert.doesNotMatch(r.text, /PROVISOIRE/);
  assert.match(r.text, /registre à compléter après réalisation/);
  const day = dayShareText({parcelles: [parcel], interventions: [{...w, plannedDate: '2026-10-15'}]}, '2026-10-15');
  assert.doesNotMatch(day.text, /provisoire/i);
  assert.equal(day.provisional, false);
});

test('observation : position GPS propre, sinon centroïde ; photo la plus récente', () => {
  const o = {id: 'o1', parcelId: 'p1', date: '2026-10-15', type: 'Maladie', title: 'Rouille', severity: 'urgent', status: 'À surveiller', note: 'Foyer en bordure', latitude: 48.2, longitude: 2.3};
  const r = observationShareText(o, {parcel});
  assert.equal(r.title, 'Rouille · Grand Champ');
  assert.match(r.text, /Observé le 15\/10\/2026/);
  assert.match(r.text, /Type : Maladie/);
  assert.match(r.text, /Niveau : Urgent · Statut : À surveiller/);
  assert.match(r.text, /Position : https:\/\/www\.google\.com\/maps\?q=48\.200000,2\.300000/);
  const noGps = observationShareText({...o, latitude: null, longitude: null}, {parcel});
  assert.match(noGps.text, /Parcelle : https:\/\/www\.google\.com\/maps\?q=48\.001000/);
  const data = {photos: [
    {id: 'a', observationId: 'o1', capturedAt: 1, mimeType: 'image/jpeg'},
    {id: 'b', observationId: 'o1', capturedAt: 5, mimeType: 'image/jpeg'},
    {id: 'c', observationId: 'o1', capturedAt: 9, mimeType: 'image/jpeg', deletedAt: 10},
    {id: 'd', observationId: 'o2', capturedAt: 20}
  ]};
  assert.equal(observationPhoto(data, 'o1').id, 'b');
  assert.equal(observationPhoto(data, 'zz'), null);
});

test('récapitulatif du jour : fait, reste, observations, provisoire', () => {
  const data = {
    exploitation: {nom: 'GAEC des Prés'},
    parcelles: [parcel, {id: 'p2', nom: 'Les Noues', surfaceHa: 4}],
    interventions: [
      {parcelId: 'p1', type: 'Semis', status: 'Terminé', date: '2026-10-15', surfaceWorked: 10, operator: 'Paul', cost: 321},
      {parcelId: 'p2', type: 'Fongicide', status: 'Terminé', date: '2026-10-15', product: 'Fongi'},
      {parcelId: 'p2', type: 'Labour', status: 'À faire', plannedDate: '2026-10-15'},
      {parcelId: 'p2', type: 'Roulage', status: 'Annulé', plannedDate: '2026-10-15'},
      {parcelId: 'p1', type: 'Semis', status: 'Terminé', date: '2026-10-14'},
      {parcelId: 'p1', type: 'Semis', status: 'Terminé', date: '2026-10-15', deletedAt: 1}
    ],
    tasks: [
      {title: 'Réparer la clôture', status: 'Terminé', dueDate: '2026-10-15', parcelId: 'p1'},
      {title: 'Commander engrais', status: 'À faire', dueDate: '2026-10-15'},
      {title: 'Vieille tâche', status: 'À faire', dueDate: '2026-10-01'},
      {title: 'Tâche annulée', status: 'Annulé', dueDate: '2026-10-15'}
    ],
    observations: [{parcelId: 'p1', date: '2026-10-15', title: 'Limaces', severity: 'urgent'}, {parcelId: 'p1', date: '2026-10-10', title: 'Ancienne'}]
  };
  const r = dayShareText(data, '2026-10-15');
  assert.equal(r.title, 'Journée du 15/10/2026 · GAEC des Prés');
  assert.deepEqual(r.counts, {done: 2, left: 1, tasksDone: 1, tasksLeft: 1, observations: 1});
  assert.match(r.text, /Tâches faites : 1\n- Réparer la clôture · Grand Champ/);
  assert.match(r.text, /Tâches restantes : 1\n- Commander engrais/);
  assert.doesNotMatch(r.text, /Vieille tâche|Tâche annulée/);
  assert.match(r.text, /Fait : 2 travaux, 14 ha/);
  assert.match(r.text, /- Fongicide · Les Noues · Fongi \(provisoire\)/);
  assert.match(r.text, /Reste : 1 travail\n- Labour · Les Noues/);
  assert.match(r.text, /- Limaces · Grand Champ \(urgent\)/);
  assert.equal(r.provisional, true);
  assert.doesNotMatch(r.text, /Roulage|Ancienne|321/);
  assert.match(dayShareText({}, '2026-10-15').text, /aucun travail terminé/);
});

test('interface : feuille de partage avec photo, sinon copie et toast', async () => {
  const {createShareUI} = await import('./share-ui.js');
  const blob = new Blob(['x'], {type: 'image/jpeg'});
  const data = {parcelles: [parcel], observations: [{id: 'o1', parcelId: 'p1', date: '2026-10-15', title: 'Rouille'}], photos: [{id: 'ph1', observationId: 'o1', name: 'rouille.jpg', mimeType: 'image/jpeg'}]};
  const store = {get: (type, id) => (data[type] || []).find(x => x.id === id), storage: {blobGet: async id => id === 'ph1' ? blob : null}};
  const shared = [], toasts = [], copies = [];
  const nav = {share: async payload => { shared.push(payload); }, canShare: () => true};
  const ui = createShareUI({store, state: () => data, toast: (...a) => toasts.push(a), copyText: async t => { copies.push(t); return true; }, today: () => '2026-10-15', doc: null, nav});
  await ui.share('observation', 'o1');
  assert.equal(shared[0].title, 'Rouille · Grand Champ');
  assert.equal(shared[0].files[0].name, 'rouille.jpg');
  const plain = createShareUI({store, state: () => data, toast: (...a) => toasts.push(a), copyText: async t => { copies.push(t); return true; }, today: () => '2026-10-15', doc: null, nav: {}});
  await plain.share('observation', 'o1');
  assert.match(copies[0], /Rouille/);
  assert.match(toasts.at(-1)[0], /copié.*photo non jointe/);
  await plain.share('day');
  assert.match(copies[1], /^Journée du 15\/10\/2026/);
  await plain.share('work', 'absent');
  // Feuille de partage sans prise en charge des fichiers : texte partagé et photo signalée non jointe.
  const noFiles = [];
  const textOnly = createShareUI({store, state: () => data, toast: (...a) => noFiles.push(a), copyText: async () => true, today: () => '2026-10-15', doc: null, nav: {share: async payload => { shared.push(payload); }, canShare: () => false}});
  await textOnly.share('observation', 'o1');
  assert.equal(shared.at(-1).files, undefined);
  assert.match(noFiles.at(-1)[0], /photo non jointe/);
  assert.equal(noFiles.at(-1)[1], 'warning');
  assert.equal(toasts.at(-1)[1], 'error');
});
