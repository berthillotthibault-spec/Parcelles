// n° 104 et n° 111 : actions d'écriture de l'assistant distant (brouillons, permissions, confirmation),
// aperçu « Ce que j'envoie », mode anonyme et réponses-cartes « Voir sur la carte ».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildActionDraft, NEW_WRITE_ACTIONS} from './assistant-actions.js';
import {sanitizeAction, buildRemoteRequest, buildAliases, anonymizeValue, deanonymizeValue, askRemoteAssistant} from './remote-ai.js';
import {filterParcelsStructured, answerLocalIntelligence, assistantActionRequiresConfirmation} from './intelligence.js';
import {createAssistantRemoteUI, draftRowsHtml} from './assistant-remote-ui.js';
import {campaignFor} from './utils.js';

globalThis.location ??= {href: 'https://exemple.test/'};
const square = [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]];
const TODAY = '2026-10-27';

function farm() {
  return {
    exploitation: {nom: 'GAEC des Tilleuls', commune: 'Sougey'},
    preferences: {defaultOperator: 'Julien Martin'},
    parcelles: [
      {id: 'p1', nom: 'Grand Pré', surfaceHa: 4, culture: 'Prairie', createdAt: 1, geometry: {type: 'Polygon', coordinates: square}},
      {id: 'p2', nom: 'Les Combes', surfaceHa: 6, culture: 'Maïs', createdAt: 2, geometry: {type: 'Polygon', coordinates: square}},
      {id: 'p3', nom: 'Champ du Bas', surfaceHa: 3, culture: 'Blé', createdAt: 3}
    ],
    interventions: [
      {id: 'w1', parcelId: 'p1', type: 'Fauche', date: '2026-06-10', status: 'Terminé', campaignId: campaignFor(new Date(`${TODAY}T12:00:00`).getTime())},
      {id: 'w2', parcelId: 'p2', type: 'Fauche', date: '2026-11-02', plannedDate: '2026-11-02', status: 'À faire'},
      {id: 'w3', parcelId: 'p3', type: 'Semis', date: '2026-10-05', status: 'Terminé', operator: 'Paul Durand'}
    ],
    tasks: [], observations: [], stockMovements: [], members: [],
    clients: [{id: 'c1', name: 'Coopérative Bresse', createdAt: 1}],
    stockItems: [{id: 's1', name: 'Ammonitrate', quantity: 10, unit: 't'}, {id: 's2', name: 'Gazole', quantity: 500, unit: 'L'}],
    grazingSessions: [{id: 'g1', parcelId: 'p1', animalType: 'Génisses', startDate: '2026-10-01', endDate: null, animals: [], additionalAnimalsCount: 12, animalsCount: 12}],
    integrationImports: [], assistantMessages: []
  };
}

test('les quatre nouvelles actions sont autorisées, nettoyées et demandent une confirmation', () => {
  for (const type of NEW_WRITE_ACTIONS) {
    const payload = type === 'plan_works' ? {works: [{parcelId: 'p1', type: 'Fauche'}]} : {parcelId: 'p1'};
    const action = sanitizeAction({type, label: 'Proposé', payload});
    assert.ok(action, type);
    assert.equal(action.requiresConfirmation, true, type);
    assert.equal(assistantActionRequiresConfirmation(action), true, type);
  }
  assert.equal(sanitizeAction({type: 'plan_works', payload: {works: []}}), null);
  assert.equal(sanitizeAction({type: 'delete_everything', payload: {}}), null);
  assert.deepEqual(sanitizeAction({type: 'show_on_map', payload: {parcelIds: ['p1', 3, '', 'p2'], extra: 1}}).payload, {parcelIds: ['p1', 'p2']});
  assert.equal(sanitizeAction({type: 'show_on_map', payload: {}}), null);
  assert.equal(sanitizeAction({type: 'show_on_map', payload: {parcelIds: ['p1']}}).requiresConfirmation, false);
});

test('brouillons : chaque fiche montre exactement ce qui sera écrit', () => {
  const state = farm();
  const obs = buildActionDraft({type: 'create_observation', payload: {parcelName: 'grand pré', title: 'Rumex', type: 'Adventices', severity: 'warning'}}, state, {today: TODAY});
  assert.equal(obs.ok, true);
  assert.equal(obs.writes[0].entity, 'observations');
  assert.equal(obs.writes[0].after.parcelId, 'p1');
  assert.equal(obs.writes[0].after.date, TODAY);
  assert.deepEqual(obs.rows.map(r => r.label), ['Parcelle', 'Titre', 'Type', 'Niveau', 'Date']);

  const stock = buildActionDraft({type: 'stock_movement', payload: {stockName: 'ammonitrate', type: 'Sortie', quantity: '2,5', unit: 't'}}, state, {today: TODAY});
  assert.equal(stock.ok, true);
  assert.deepEqual(stock.rows.find(r => r.label === 'Quantité en stock'), {label: 'Quantité en stock', before: '10 t', after: '7.5 t'});
  assert.equal(stock.movement.quantity, 2.5);
  assert.match(buildActionDraft({type: 'stock_movement', payload: {stockId: 's1', type: 'Sortie', quantity: 20}}, state, {today: TODAY}).error, /insuffisant/);
  assert.match(buildActionDraft({type: 'stock_movement', payload: {stockId: 's1', type: 'Sortie', quantity: 1, unit: 'kg'}}, state, {today: TODAY}).error, /Unité/);
  assert.match(buildActionDraft({type: 'stock_movement', payload: {stockId: 's1', type: 'Vol', quantity: 1}}, state, {today: TODAY}).error, /Entrée, Sortie/);

  const exit = buildActionDraft({type: 'grazing_exit', payload: {parcelId: 'p1'}}, state, {today: TODAY});
  assert.equal(exit.ok, true);
  assert.equal(exit.writes[0].after.endDate, TODAY);
  assert.deepEqual(exit.rows.at(-1), {label: 'Sortie', before: 'Au pré', after: TODAY});
  assert.match(buildActionDraft({type: 'grazing_exit', payload: {parcelId: 'p2'}}, state, {today: TODAY}).error, /Aucun lot/);
  assert.match(buildActionDraft({type: 'grazing_exit', payload: {grazingId: 'g1', date: '2026-09-01'}}, state, {today: TODAY}).error, /Date de sortie/);

  const plan = buildActionDraft({type: 'plan_works', payload: {works: [{parcelId: 'p2', type: 'Labour', plannedDate: '2026-11-03'}, {parcelName: 'Champ du Bas', type: 'Semis'}]}}, state, {today: TODAY});
  assert.equal(plan.ok, true);
  assert.equal(plan.writes.length, 2);
  assert.deepEqual(plan.writes.map(w => [w.after.status, w.after.plannedDate, w.after.surfaceWorked]), [['À faire', '2026-11-03', 6], ['À faire', TODAY, 3]]);
  assert.match(buildActionDraft({type: 'plan_works', payload: {works: [{parcelId: 'p2', type: 'Labour', plannedDate: '2020-01-01'}]}}, state, {today: TODAY}).error, /date prévue/);
  assert.match(buildActionDraft({type: 'plan_works', payload: {works: [{parcelId: 'zz', type: 'Labour'}]}}, state, {today: TODAY}).error, /introuvable/);

  const html = draftRowsHtml({rows: [{label: '<b>', before: '', after: '<script>'}]});
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});

test('brouillons : les permissions du rôle s’appliquent avant la fiche', () => {
  const state = farm();
  const obs = {type: 'create_observation', payload: {parcelId: 'p1', title: 'Rumex'}};
  const stock = {type: 'stock_movement', payload: {stockId: 's1', type: 'Entrée', quantity: 1}};
  assert.match(buildActionDraft(obs, state, {role: 'viewer', today: TODAY}).error, /Lecture seule/);
  assert.equal(buildActionDraft(obs, state, {role: 'operator', today: TODAY}).ok, true);
  assert.match(buildActionDraft(stock, state, {role: 'operator', today: TODAY}).error, /ne permet pas/);
  assert.equal(buildActionDraft(stock, state, {role: 'accountant', today: TODAY}).ok, true);
  assert.match(buildActionDraft({type: 'grazing_exit', payload: {grazingId: 'g1'}}, state, {role: 'advisor', today: TODAY}).error, /ne permet pas/);
  assert.match(buildActionDraft({type: 'plan_works', payload: {works: [{parcelId: 'p1', type: 'Fauche'}]}}, state, {role: 'accountant', today: TODAY}).error, /ne permet pas/);
});

test('fiche de confirmation : rien n’est écrit avant « Confirmer », puis toast avec Annuler', async () => {
  const state = farm(), calls = [], toasts = [];
  let footer = '', button = null, closed = 0;
  const box = {hidden: true, textContent: ''};
  globalThis.document = {getElementById: id => id === 'assistant-confirm-write' ? button : id === 'assistant-write-error' ? box : null};
  const store = {
    upsert: async (type, entity) => { calls.push(['upsert', type, entity]); return {id: `${type}-${calls.length}`, ...entity}; },
    remove: async (type, id) => { calls.push(['remove', type, id]); },
    recordStockMovement: async m => { calls.push(['stock', m]); return m; }
  };
  const ui = createAssistantRemoteUI({store, state: () => state, modal: (_t, _d, _b, f) => { footer = f; button = {disabled: false}; }, closeModal: () => closed++, toast: (...a) => toasts.push(a), role: () => 'owner', today: () => TODAY});
  assert.equal(ui.confirm({type: 'plan_works', payload: {works: [{parcelId: 'p1', type: 'Fauche'}, {parcelId: 'p2', type: 'Labour'}]}}), true);
  assert.match(footer, /assistant-confirm-write/);
  assert.equal(calls.length, 0);
  await button.onclick();
  assert.equal(calls.filter(c => c[0] === 'upsert').length, 2);
  assert.equal(closed, 1);
  const [message, type, undo] = toasts.at(-1);
  assert.equal(type, 'success');
  assert.match(message, /2 travaux/);
  assert.equal(undo.label, 'Annuler');
  await undo.run();
  assert.equal(calls.filter(c => c[0] === 'remove').length, 2);

  ui.confirm({type: 'stock_movement', payload: {stockId: 's1', type: 'Sortie', quantity: 3}});
  await button.onclick();
  await toasts.at(-1)[2].run();
  assert.deepEqual(calls.filter(c => c[0] === 'stock').map(c => [c[1].type, c[1].quantity]), [['Sortie', 3], ['Entrée', 3]]);

  // Refus du rôle : un toast d'erreur, aucune fiche.
  footer = '';
  const viewer = createAssistantRemoteUI({store, state: () => state, modal: () => { footer = 'ouverte'; }, closeModal() {}, toast: (...a) => toasts.push(a), role: () => 'viewer', today: () => TODAY});
  assert.equal(viewer.confirm({type: 'create_observation', payload: {title: 'x'}}), false);
  assert.equal(footer, '');
  assert.equal(toasts.at(-1)[1], 'error');

  // Erreur à l'écriture : message en ligne (.form-error), bouton réactivé.
  const failing = createAssistantRemoteUI({store: {...store, upsert: async () => { throw new Error('Stock verrouillé'); }}, state: () => state, modal: () => { button = {disabled: false}; }, closeModal() {}, toast() {}, today: () => TODAY});
  failing.confirm({type: 'create_observation', payload: {title: 'Rumex'}});
  await button.onclick();
  assert.equal(box.hidden, false);
  assert.equal(box.textContent, 'Stock verrouillé');
  assert.equal(button.disabled, false);
  delete globalThis.document;
});

test('aperçu « Ce que j’envoie » : obligatoire avant le premier envoi seulement', async () => {
  const state = farm();
  const ui = createAssistantRemoteUI({store: {}, state: () => ({...state, preferences: {remoteAiContextReviewed: true}}), modal() {}, closeModal() {}, toast() {}, today: () => TODAY});
  assert.equal(await ui.beforeSend(null, {question: 'x'}), true);
  const first = createAssistantRemoteUI({store: {}, state: () => state, modal() {}, closeModal() {}, toast() {}, today: () => TODAY});
  assert.equal(await first.beforeSend(null, {question: 'x'}), false, 'sans fil affiché, rien ne part');
  // Le corps affiché est celui envoyé : même fonction (buildRemoteRequest) des deux côtés.
  const src = fs.readFileSync(new URL('./remote-ai.js', import.meta.url), 'utf8');
  assert.match(src, /const stream=typeof onDelta==='function',\{body,aliases\}=buildRemoteRequest\(/);
  assert.match(src, /body:JSON\.stringify\(body\)/);
});

test('mode anonyme : alias stables à l’envoi, réponse retraduite sur l’appareil', async () => {
  const state = farm();
  const aliases = buildAliases(state);
  assert.equal(aliases.get('Parcelle #1'), 'Grand Pré');
  assert.equal(aliases.get('Client #1'), 'Coopérative Bresse');
  assert.equal(aliases.get('Exploitation #1'), 'GAEC des Tilleuls');
  assert.ok([...aliases.values()].includes('Julien Martin') && [...aliases.values()].includes('Paul Durand'));
  assert.deepEqual([...buildAliases(farm())], [...aliases], 'mêmes alias d’un appel à l’autre');

  const {body} = buildRemoteRequest({question: 'Quand Paul Durand a-t-il fauché le grand pré ?', state, context: {now: Date.parse(`${TODAY}T12:00:00`)}, anonymize: true});
  const json = JSON.stringify(body);
  for (const name of ['Grand Pré', 'grand pré', 'Les Combes', 'Paul Durand', 'GAEC des Tilleuls']) assert.ok(!json.includes(name), name);
  assert.equal(body.anonymized, true);
  assert.match(body.question, /Personne #\d+ .*Parcelle #1/);
  assert.equal(buildRemoteRequest({question: 'Grand Pré', state}).body.question, 'Grand Pré');
  // « Parcelle #12 » n'est pas pris pour « Parcelle #1 ».
  assert.equal(deanonymizeValue('Parcelle #1 et Parcelle #12', aliases), 'Grand Pré et Parcelle #12');
  assert.equal(anonymizeValue({a: ['Les Combes !']}, aliases).a[0], 'Parcelle #2 !');

  let sent = null;
  const fetchImpl = async (_url, init) => { sent = JSON.parse(init.body); return {ok: true, headers: {get: () => 'application/json'}, json: async () => ({answer: 'Parcelle #2 à faucher.', actions: [{type: 'create_observation', label: 'Noter sur Parcelle #2', payload: {parcelName: 'Parcelle #2', title: 'Rumex'}}]})}; };
  const out = await askRemoteAssistant({endpoint: 'https://ia.exemple.test/', question: 'Les Combes ?', state, anonymize: true, fetchImpl});
  assert.equal(sent.question, 'Parcelle #2 ?');
  assert.equal(out.answer, 'Les Combes à faucher.');
  assert.equal(out.actions[0].payload.parcelName, 'Les Combes');
  assert.equal(out.actions[0].label, 'Noter sur Les Combes');
});

test('n° 111 : parcelles non fauchées / non semées cette campagne, avec « Voir sur la carte »', () => {
  const state = farm(), now = Date.parse(`${TODAY}T12:00:00`);
  const notMown = filterParcelsStructured('montre les parcelles non fauchées', state, {now});
  assert.equal(notMown.recognized, true);
  assert.deepEqual(notMown.rows.map(p => p.id), ['p2', 'p3'], 'une fauche à faire ne compte pas');
  assert.match(notMown.applied[0], /^sans fauche \d{4}\/\d{2}$/);
  assert.deepEqual(filterParcelsStructured('parcelles non semées', state, {now}).rows.map(p => p.id), ['p1', 'p2']);
  assert.deepEqual(filterParcelsStructured('parcelles sans désherbage cette campagne', state, {now}).rows.length, 3);
  assert.deepEqual(filterParcelsStructured('non fauchées culture:maïs', state, {now}).rows.map(p => p.id), ['p2']);
  assert.equal(filterParcelsStructured('parcelles fauchées', state, {now}).recognized, false);

  const answer = answerLocalIntelligence('montre les parcelles non fauchées', state, {now});
  assert.equal(answer.intent, 'parcel_filter');
  assert.deepEqual(answer.matches, ['p2', 'p3']);
  assert.deepEqual(answer.actions[0], {type: 'show_on_map', label: 'Voir sur la carte (1)', payload: {parcelIds: ['p2']}}, 'seules les parcelles avec contour');
});

test('branchement : module différé, CORE, carte et réglage', () => {
  const read = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  const app = read('app.js');
  assert.match(read('lazy-modules.js'), /assistantRemote: \(\) => import\('\.\/assistant-remote-ui\.js'\)/);
  for (const f of ['sw.js', 'runtime.js']) assert.ok(read(f).includes("'./assistant-actions.js','./assistant-remote-ui.js'"), f);
  assert.match(app, /action\.type==='show_on_map'.*highlightGeometries\(/);
  assert.match(app, /\['create_observation','stock_movement','grazing_exit','plan_works'\]\.includes\(action\.type\)/);
  assert.match(app, /assistantRemote\(\)\.beforeSend\(/);
  assert.match(app, /id="assistant-sent">Ce que j’envoie/);
  assert.match(read('settings-ui.js'), /name="remoteAiAnonymize"/);
  assert.match(read('settings-ui.js'), /remoteAiAnonymize:f\.remoteAiAnonymize\.checked/);
});
