// n° 110 — « Pourquoi ? » : chaque calcul renvoie {value, why[], missing[]} sans casser ses appelants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {getHomeAgenda, weatherOpportunity, localDay} from './home-priorities.js';
import {computeNotifications} from './notifications.js';
import {marginModel, buildPilotage} from './pilotage.js';
import {newAutomationFromTemplate, automationTemplates} from './automations.js';
import {explainAgendaEntry, explainDailySituation, explainNotification, explainMarginTotal, explainStockValue, explainAutomationRule} from './explain-model.js';
import {workWeatherSlot} from './work-weather.js';
import {explainFor, explainSheetHtml, createExplainUI} from './explain-ui.js';
import {explainButton, marginSummaryHtml} from './margin-ui.js';

const today = localDay();
const shift = n => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const shape = r => { assert.ok(Array.isArray(r.why), 'why[]'); assert.ok(Array.isArray(r.missing), 'missing[]'); assert.ok('value' in r, 'value'); };

test('priorité de l’accueil : faits, rang et données manquantes', () => {
  const data = {parcelles: [{id: 'p1', nom: 'Grand Champ', surfaceHa: 4.5}], interventions: [
    {id: 'w1', type: 'Semis', status: 'Planifié', plannedDate: shift(-3), parcelId: 'p1', startTime: '08:00'},
    {id: 'w2', type: 'Fauche', status: 'Planifié', plannedDate: shift(2)}
  ], tasks: []};
  const agenda = getHomeAgenda(data, today);
  const late = explainAgendaEntry(agenda.entries[0], today, {parcel: data.parcelles[0], position: 1, total: 2});
  shape(late);
  assert.equal(late.value, 'En retard');
  assert.ok(late.why.some(x => x.includes('dépassée de 3 jours')));
  assert.ok(late.why.some(x => x.includes('Grand Champ (4,5 ha)')));
  assert.ok(late.why.some(x => x.includes('Rang 1 sur 2')));
  assert.deepEqual(late.missing, []);
  const later = explainAgendaEntry(agenda.entries[1], today);
  assert.equal(later.value, 'À venir');
  assert.ok(later.missing.includes('Parcelle non renseignée'));
  assert.ok(!later.missing.some(x => x.startsWith('Heure de début')), 'heure signalée seulement le jour même');
  assert.deepEqual(explainAgendaEntry(null, today), {value: null, why: [], missing: []});
});

test('bilan du jour : travaux sans surface ni durée exclus et signalés', () => {
  const data = {parcelles: [], interventions: [
    {id: 'a', type: 'Semis', status: 'Terminé', date: today, surfaceWorked: 3, equipmentId: 'm1', duration: 2},
    {id: 'b', type: 'Fauche', status: 'Terminé', date: today, equipmentId: 'm1'},
    {id: 'c', type: 'Roulage', status: 'Planifié', plannedDate: today}
  ]};
  const r = explainDailySituation(data, today);
  shape(r);
  assert.equal(r.value, '2/3');
  assert.ok(r.why.some(x => x.includes('3 ha')));
  assert.ok(r.missing.some(x => x.startsWith('1 travail terminé sans surface')));
  assert.ok(r.missing.some(x => x.startsWith('1 travail avec matériel sans durée')));
});

test('fenêtre météo de l’accueil : seuil absent, prévision ancienne, fenêtre expliquée', () => {
  const now = new Date(`${today}T06:30:00`), hourly = {time: [], wind_speed_10m: [], precipitation: []};
  for (let h = 0; h < 24; h++) { hourly.time.push(`${today}T${String(h).padStart(2, '0')}:00`); hourly.wind_speed_10m.push(h < 12 ? 5 : 40); hourly.precipitation.push(0); }
  const weather = {loadedAt: now.getTime() - 600000, hourly};
  const none = weatherOpportunity(weather, {}, now);
  assert.equal(none.window, null);
  assert.ok(none.missing[0].includes('Seuil de vent'));
  const old = weatherOpportunity({...weather, loadedAt: now.getTime() - 7 * 3600000}, {weatherWindThreshold: 20}, now);
  assert.equal(old.stale, true);
  assert.ok(old.missing[0].includes('6 h'));
  const ok = weatherOpportunity(weather, {weatherWindThreshold: 20}, now);
  assert.ok(ok.window);
  assert.ok(ok.why[0].startsWith('Fenêtre de 7 h à 11 h'));
  assert.ok(ok.why.some(x => x.includes('20 km/h')));
  assert.ok(ok.why.some(x => x.startsWith('Première heure défavorable : 12 h')));
});

test('alertes : explication recalculée depuis l’identifiant, règle modifiable', () => {
  const state = {stockItems: [{id: 's1', name: 'Semences', quantity: 2, alertBelow: 5, unit: 'sacs'}],
    tasks: [{id: 't1', title: 'Clôture', status: 'À faire', dueDate: shift(-2)}], interventions: [], materiels: [], observations: [], preferences: {}, metadata: {}};
  const ids = computeNotifications(state).map(n => n.id);
  assert.ok(ids.includes('stock-s1') && ids.includes('task-overdue-t1'));
  const stock = explainNotification(state, 'stock-s1');
  shape(stock);
  assert.ok(stock.why.some(x => x.includes('2 sacs')) && stock.why.some(x => x.includes('5 sacs')));
  assert.deepEqual(stock.rule, {label: 'Modifier le seuil d’alerte', action: 'notification-open', entity: 'stockItems', id: 's1', edit: true});
  const task = explainNotification(state, 'task-overdue-t1');
  assert.ok(task.why.some(x => x.includes('Dépassée de 2 jours')));
  assert.ok(task.missing.includes('Parcelle non renseignée'));
  const gone = explainNotification(state, 'stock-inconnu');
  assert.equal(gone.value, null);
  assert.ok(gone.why[0].includes('plus active'));
});

test('totaux du Pilotage : exclusions dites, jamais comptées à 0 €', () => {
  const campaign = '2026/27';
  const state = {parcelles: [
    {id: 'p1', nom: 'Haut', surfaceHa: 10, culture: 'Blé', economicsByCampaign: {[campaign]: {yield: 8, salePrice: 200}}},
    {id: 'p2', nom: 'Bas', surfaceHa: 5, culture: 'Orge'}
  ], interventions: [
    {id: 'w1', parcelId: 'p1', status: 'Terminé', date: '2026-10-01', campaignId: campaign, cost: 1000},
    {id: 'w2', parcelId: 'p2', status: 'Terminé', date: '2026-10-02', campaignId: campaign}
  ], rotations: [], stockItems: [{id: 'a', name: 'Engrais', quantity: 10, unitPrice: 30}, {id: 'b', name: 'Ficelle', quantity: 4}]};
  const model = marginModel(state, {campaign});
  const realized = explainMarginTotal(model, 'realized');
  shape(realized);
  assert.equal(realized.value, '1 000 €'.replace(' ', ' '));
  assert.ok(realized.missing.some(x => x.startsWith('1 travail terminé sans coût')));
  const product = explainMarginTotal(model, 'product');
  assert.ok(product.missing.some(x => x.includes('Bas')));
  const margin = explainMarginTotal(model, 'margin');
  assert.ok(margin.why.some(x => x.startsWith('Marge = produit attendu')));
  assert.equal(margin.rule.campaign, campaign);
  assert.equal(explainMarginTotal(model, 'inconnu').value, null);
  const stock = explainStockValue(state);
  assert.ok(stock.missing[0].startsWith('1 article sans prix'));
  assert.equal(buildPilotage(state, {campaign}).stock.value, 300);
  const html = marginSummaryHtml(model);
  for (const key of ['realized', 'engaged', 'product', 'margin']) assert.ok(html.includes(`data-key="${key}"`));
});

test('règle d’automatisation : déclencheur, conditions et manques', () => {
  const custom = newAutomationFromTemplate(automationTemplates().find(t => t.kind === 'custom'));
  const r = explainAutomationRule(custom, {interventions: [{id: 'w', type: 'Semis', status: 'Planifié', plannedDate: today}]});
  shape(r);
  assert.ok(r.why.some(x => x.startsWith('Déclencheur « Lors d’une modification »')));
  assert.ok(r.why.some(x => x.startsWith('– Statut est différent de « Terminé »')));
  assert.equal(r.rule.action, 'edit-automation');
  const weather = newAutomationFromTemplate(automationTemplates().find(t => t.kind === 'weather_window'));
  assert.ok(explainAutomationRule(weather, {interventions: []}).missing.some(x => x.includes('Prévisions météo')));
  assert.equal(explainAutomationRule(null, {}).value, null);
});

test('créneau d’un travail : why[] et missing[] ajoutés sans changer text/title', () => {
  const now = new Date(2026, 9, 8, 6).getTime(), h = {time: [], temperature_2m: [], relative_humidity_2m: [], precipitation: [], wind_speed_10m: []};
  for (let i = 0; i < 72; i++) { const d = new Date(2026, 9, 8, i); h.time.push(d.toISOString()); h.temperature_2m.push(14); h.relative_humidity_2m.push(70); h.precipitation.push(0); h.wind_speed_10m.push(8); }
  const slot = workWeatherSlot({id: 'w', type: 'Semis', status: 'Planifié'}, {loadedAt: now - 3600000, hourly: h}, {now});
  assert.equal(slot.tone, 'good');
  assert.ok(slot.text.startsWith('Créneau'));
  assert.ok(slot.why.some(x => x.includes('« Semis »')));
  assert.deepEqual(slot.missing, []);
  const old = workWeatherSlot({id: 'w', type: 'Semis', status: 'Planifié'}, {loadedAt: now - 72 * 3600000, hourly: h}, {now});
  assert.ok(old.missing[0].includes('48 h'));
});

test('feuille « Pourquoi ? » : rendu échappé, aiguillage des boutons (i)', () => {
  const html = explainSheetHtml({value: '<b>', why: ['a < b'], missing: ['x']}, {extra: [{title: 'Météo', why: ['vent'], missing: []}]});
  assert.ok(html.includes('&lt;b&gt;') && html.includes('a &lt; b') && html.includes('why-missing') && html.includes('<h3>Météo</h3>'));
  assert.ok(explainSheetHtml({value: null, why: [], missing: []}).includes('Aucune donnée manquante'));
  const button = explainButton('alert', 'Stock "faible"', {id: 's1'});
  assert.ok(button.includes('data-explain="alert"') && button.includes('data-id="s1"') && button.includes('aria-label="Pourquoi ? Stock &quot;faible&quot;"'));
  const state = {parcelles: [], interventions: [{id: 'w1', type: 'Semis', status: 'Planifié', plannedDate: today}], tasks: [], preferences: {}, automationRules: []};
  const agenda = explainFor({explain: 'agenda', id: 'w1'}, {state});
  assert.equal(agenda.result.value, 'Aujourd’hui');
  assert.deepEqual(agenda.result.rule, {label: 'Ouvrir', action: 'edit-work', id: 'w1'});
  assert.ok(explainFor({explain: 'agenda', id: 'absent'}, {state}).result.why[0].includes('plus en attente'));
  assert.equal(explainFor({explain: 'weather'}, {state}).result.stale, true);
  assert.equal(explainFor({explain: 'inconnu'}, {state}), null);
});

// Document factice minimal : écouteurs du document (capture distinguée), dialogue natif, boutons tirés du HTML.
function fakeDom() {
  const listeners = [], body = {append: node => { node.isConnected = true; }};
  const doc = {body, activeElement: body, dialog: null, appKeys: [],
    addEventListener(type, fn, capture = false) { listeners.push({type, fn, capture: !!capture}); },
    createElement() {
      let html = '', buttons = [];
      const own = {};
      doc.dialog = {open: false, isConnected: false, setAttribute() {},
        addEventListener(type, fn) { (own[type] ??= []).push(fn); },
        set innerHTML(v) { html = v; buttons = [...v.matchAll(/<button[^>]*>/g)].map(m => ({tag: m[0], isConnected: true, focus() { doc.activeElement = this; }})); },
        get innerHTML() { return html; },
        querySelectorAll: () => buttons,
        querySelector: sel => sel === '.why-foot [data-why-close]' ? buttons.filter(b => b.tag.includes('data-why-close')).at(-1) : null,
        contains: node => buttons.includes(node),
        showModal() { this.open = true; },
        close() { this.open = false; (own.close || []).forEach(fn => fn()); }};
      return doc.dialog;
    },
    // Capture sur le document, puis (sauf arrêt) le gestionnaire global d’app.js en bouillonnement.
    key(key, {shiftKey = false} = {}) {
      const event = {key, shiftKey, target: doc.activeElement, stopped: false, defaultPrevented: false,
        stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }};
      for (const l of listeners) if (l.type === 'keydown' && l.capture && !event.stopped) l.fn(event);
      if (!event.stopped) doc.appKeys.push(key);
      return event;
    }};
  return doc;
}
const sheetUI = editable => {
  const state = {automationRules: [{...newAutomationFromTemplate(automationTemplates().find(t => t.kind === 'custom')), id: 'auto1'}],
    interventions: [], tasks: [], stockItems: [{id: 's1', name: 'Semences', quantity: 2, alertBelow: 5}]};
  const doc = fakeDom();
  return {doc, ui: createExplainUI({state: () => state, canEdit: () => editable, doc})};
};

test('feuille « Pourquoi ? » : lien de règle masqué ou neutre en lecture seule', () => {
  const viewer = sheetUI(false), editor = sheetUI(true);
  assert.equal(viewer.ui.open({explain: 'automation', id: 'auto1'}), true);
  assert.ok(!viewer.doc.dialog.innerHTML.includes('data-action="edit-automation"'));
  editor.ui.open({explain: 'automation', id: 'auto1'});
  assert.ok(editor.doc.dialog.innerHTML.includes('data-action="edit-automation"'));
  viewer.ui.open({explain: 'alert', id: 'stock-s1'});
  assert.ok(viewer.doc.dialog.innerHTML.includes('data-action="notification-open"'));
  assert.ok(viewer.doc.dialog.innerHTML.includes('Ouvrir l’élément') && !viewer.doc.dialog.innerHTML.includes('Modifier le seuil'));
  editor.ui.open({explain: 'alert', id: 'stock-s1'});
  assert.ok(editor.doc.dialog.innerHTML.includes('Modifier le seuil d’alerte'));
});

test('feuille « Pourquoi ? » : clavier capturé, Échap ne ferme qu’elle, focus rendu au bouton (i)', () => {
  const {doc, ui} = sheetUI(true), opener = {isConnected: true, focus() { doc.activeElement = this; }};
  ui.open({explain: 'automation', id: 'auto1'}, opener);
  const dialog = doc.dialog, [first, rule, last] = dialog.querySelectorAll();
  assert.equal(doc.activeElement, last, 'focus initial sur « Fermer »');
  // Raccourcis d’app.js (« n », « / », Ctrl+K) arrêtés tant que la feuille est ouverte.
  for (const key of ['n', '/', 'k', 'g']) assert.equal(doc.key(key).stopped, true);
  assert.deepEqual(doc.appKeys, []);
  // Tab boucle dans la feuille, et y revient si le focus en est sorti (clic sur le texte).
  assert.equal(doc.key('Tab').defaultPrevented, true);
  assert.equal(doc.activeElement, first);
  doc.key('Tab', {shiftKey: true});
  assert.equal(doc.activeElement, last);
  doc.activeElement = doc.body;
  doc.key('Tab');
  assert.equal(doc.activeElement, first);
  assert.ok(rule.tag.includes('edit-automation'));
  // Échap, focus hors des boutons : seule la feuille se ferme, closeModal d’app.js n’est pas appelé.
  doc.activeElement = doc.body;
  const esc = doc.key('Escape');
  assert.equal(esc.stopped, true);
  assert.equal(dialog.open, false);
  assert.equal(doc.activeElement, opener);
  // Feuille fermée : le clavier revient au gestionnaire global.
  doc.key('n'); doc.key('Escape');
  assert.deepEqual(doc.appKeys, ['n', 'Escape']);
});
