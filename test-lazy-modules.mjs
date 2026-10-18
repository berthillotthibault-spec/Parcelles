// Chargement différé des écrans secondaires (n° 144 étape 2, n° 147 étape 4) : chargeur mémoïsé et
// garde-fous statiques sur app.js (aucune action orpheline, aucun module différé tiré au démarrage).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LAZY_MODULES, LAZY_ACTIONS, LAZY_TRIGGERS, createModuleLoader, lazyPath, retryImport} from './lazy-modules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const lazyPaths = Object.fromEntries(Object.entries(LAZY_MODULES).map(([key, importer]) => [key, String(importer).match(/import\('\.\/([^']+)'\)/)[1]]));

function fakeLoader(overrides = {}) {
  const calls = {}, errors = [], bars = [];
  const importers = {
    a: async () => { calls.a = (calls.a || 0) + 1; return {name: 'a'}; },
    b: async () => { calls.b = (calls.b || 0) + 1; return {name: 'b'}; },
    ko: async () => { calls.ko = (calls.ko || 0) + 1; if (calls.ko === 1) throw new Error('réseau'); return {name: 'ko'}; },
    ...overrides
  };
  const loader = createModuleLoader(importers, {
    actions: {'open-a': ['a']}, triggers: {'[data-b]': 'b'},
    progress: label => { const bar = {label, finished: null, finish(opts = {}) { this.finished = opts; }}; bars.push(bar); return bar; },
    onError: (error, keys) => errors.push([error.message, keys]), warn: () => {}
  });
  return {loader, calls, errors, bars};
}

test('une seule importation par module, création appelée une fois à l’arrivée', async () => {
  const {loader, calls} = fakeLoader();
  const created = [];
  loader.onLoad('a', mod => created.push(mod.name));
  assert.equal(loader.ready('a'), false);
  const [x, y] = await Promise.all([loader.load('a'), loader.load('a')]);
  assert.equal(x, y);
  assert.equal(calls.a, 1);
  assert.deepEqual(created, ['a']);
  assert.equal(loader.ready(['a']), true);
  assert.equal(loader.get('a').name, 'a');
  loader.onLoad('a', mod => created.push(`${mod.name} déjà là`));
  assert.deepEqual(created, ['a', 'a déjà là']);
  assert.throws(() => loader.load('inconnu'), /inconnu/);
});

test('échec traduit une fois, puis nouvelle tentative possible', async () => {
  const {loader, calls, errors, bars} = fakeLoader();
  assert.equal(await loader.need(['a', 'ko']), false);
  assert.deepEqual(errors, [['réseau', ['a', 'ko']]]);
  assert.deepEqual(bars[0].finished, {error: true});
  assert.equal(await loader.need('ko'), true);
  assert.equal(calls.ko, 2);
  assert.equal(errors.length, 1);
  assert.equal(await loader.need('a', {silent: true}), true);
});

test('run, wait et soon : immédiat si prêt, sinon après le chargement', async () => {
  const {loader} = fakeLoader();
  let opened = 0;
  const result = loader.run('a', () => 'ouvert');
  assert.ok(result instanceof Promise);
  assert.equal(await result, 'ouvert');
  assert.equal(loader.run('a', () => 'tout de suite'), 'tout de suite');
  assert.equal(loader.wait('b', () => opened++), true);
  await tick(); await tick();
  assert.equal(opened, 1);
  assert.equal(loader.wait('b', () => opened++), false);
  assert.equal(loader.soon([], () => opened++), false);
});

test('nouvelle tentative : autre adresse du même fichier (échec d’import gardé par le navigateur)', async () => {
  const errors = [], retries = [];
  const loader = createModuleLoader({ko: async () => { throw new Error('réseau'); }}, {
    retry: async (key, attempt) => { retries.push([key, attempt]); if (attempt > 1) return {name: key}; throw new Error('encore'); },
    onError: (error, keys, info) => errors.push([error.message, info.retried]), warn: () => {}
  });
  assert.equal(await loader.need('ko'), false);
  assert.equal(await loader.need('ko'), false);
  assert.equal(await loader.need('ko'), true);
  assert.deepEqual(retries, [['ko', 1], ['ko', 2]]);
  assert.deepEqual(errors, [['réseau', false], ['encore', true]]);
  assert.equal(lazyPath('land'), './land-ui.js');
  assert.equal(lazyPath('inconnu'), null);
});

test('nouvelle tentative : une dépendance en échec est redemandée sous une autre adresse (import map de portée)', async () => {
  // Graphe : entrée -> ./utils.js (déjà chargé) et ./fuel.js (échec gardé) -> ./outils.js (échec gardé) et ./utils.js.
  const root = 'https://x.test/app/';
  const sources = {[root + 'fuel-ui.js']: "import {a} from './utils.js';\nimport {b} from './fuel.js';\nconst c = () => import('./autre-ui.js');",
    [root + 'fuel.js']: "export {c} from './outils.js';\nimport './utils.js';"};
  const stuck = new Set([root + 'fuel.js', root + 'outils.js']), loaded = [], maps = [];
  const result = await retryImport(root + 'fuel-ui.js', {
    source: async url => sources[url] ?? '',
    load: async url => { loaded.push(url); if (stuck.has(url)) throw new Error('échec gardé'); return {url}; },
    addMap: map => maps.push(map)
  });
  const fresh = result.url;
  assert.match(fresh, /^https:\/\/x\.test\/app\/fuel-ui\.js\?essai=\d+$/);
  assert.equal(maps.length, 1);
  const scopes = maps[0].scopes, fuel = scopes[fresh][root + 'fuel.js'];
  assert.match(fuel, /fuel\.js\?essai=\d+$/);
  assert.deepEqual(Object.keys(scopes[fresh]), [root + 'fuel.js'], 'utils.js déjà chargé garde son adresse (instance partagée)');
  assert.match(scopes[fuel][root + 'outils.js'], /outils\.js\?essai=\d+$/);
  assert.ok(!loaded.includes(root + 'autre-ui.js'), 'les import() dynamiques ne sont pas sondés');
  // Aucune dépendance bloquée : pas d'import map.
  const none = [];
  await retryImport(root + 'fuel-ui.js', {source: async () => '', load: async url => ({url}), addMap: map => none.push(map)});
  assert.equal(none.length, 0);
});

test('soon ne relance pas en boucle un module en échec ; un clic explicite réessaie', async () => {
  const {loader, calls} = fakeLoader({ko: async () => { calls.ko = (calls.ko || 0) + 1; throw new Error('hors ligne'); }});
  let rendered = 0;
  assert.equal(loader.soon('ko', () => rendered++), true);
  await tick(); await tick();
  assert.equal(calls.ko, 1);
  assert.equal(loader.soon('ko', () => rendered++), true);
  await tick();
  assert.equal(calls.ko, 1, 'pas de nouvel essai automatique');
  await loader.need('ko');
  assert.equal(calls.ko, 2);
  assert.equal(rendered, 0);
});

test('un clic sur une action différée est retenu puis rejoué', async () => {
  const {loader} = fakeLoader();
  let listener = null;
  loader.gateClicks({addEventListener: (type, fn, capture) => { assert.equal(type, 'click'); assert.equal(capture, true); listener = fn; }});
  const control = {dataset: {action: 'open-a'}, isConnected: true, attrs: {}, clicks: 0,
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, click() { this.clicks++; }};
  const event = target => ({target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }});
  const target = {closest: selector => selector === '[data-action]' ? control : null};
  const first = event(target);
  listener(first);
  assert.ok(first.prevented && first.stopped);
  assert.equal(control.attrs['aria-busy'], 'true');
  listener(event(target)); // double clic pendant le chargement : ignoré
  await tick(); await tick();
  assert.equal(control.clicks, 1);
  assert.equal(control.attrs['aria-busy'], undefined);
  const again = event(target);
  listener(again);
  assert.equal(again.prevented, false, 'module prêt : le clic passe directement');
  // Bouton géré par l'écouteur propre du module (déclencheur par sélecteur).
  const button = {...control, dataset: {}, clicks: 0, attrs: {}};
  const other = event({closest: selector => selector === '[data-b]' ? button : null});
  listener(other);
  assert.ok(other.prevented);
  await tick(); await tick();
  assert.equal(button.clicks, 1);
  // Bouton retiré pendant le chargement (menu refermé) : une copie invisible rejoue le clic.
  const {loader: second} = fakeLoader();
  let gate = null;
  const body = {children: [], append(node) { this.children.push(node); node.isConnected = true; }};
  second.gateClicks({addEventListener: (type, fn) => { gate = fn; }}, body);
  const copies = [];
  const gone = {...control, dataset: {action: 'open-a'}, attrs: {}, clicks: 0,
    cloneNode(deep) { assert.equal(deep, false); const copy = {dataset: {...this.dataset}, hidden: false, clicks: 0, click() { this.clicks++; this.wasHidden = this.hidden; }, remove() { this.isConnected = false; }}; copies.push(copy); return copy; }};
  gate(event({closest: selector => selector === '[data-action]' ? gone : null}));
  gone.isConnected = false;
  await tick(); await tick();
  assert.equal(gone.clicks, 0);
  assert.equal(copies.length, 1);
  assert.deepEqual([copies[0].clicks, copies[0].wasHidden, copies[0].isConnected, copies[0].dataset.action], [1, true, false, 'open-a']);
});

test('préchargement : un module à la fois, sans erreur bloquante', async () => {
  const {loader, calls} = fakeLoader();
  await loader.prefetch(['a', 'ko', 'b'], {delay: 0, idle: null});
  assert.deepEqual([calls.a, calls.ko, calls.b], [1, 1, 1]);
  assert.equal(loader.ready(['a', 'b']), true);
});

test('modules différés : fichiers présents, en cache hors connexion et absents du graphe statique', () => {
  const sw = read('sw.js');
  for (const file of Object.values(lazyPaths)) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} absent`);
    assert.ok(sw.includes(`'./${file}'`), `${file} doit figurer dans CORE de sw.js`);
  }
  // Graphe des imports statiques depuis app.js : aucun module différé ne doit y revenir.
  const seen = new Set(), stack = ['app.js'];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?['"]\.\/([^'"]+\.js)['"]/g)) stack.push(m[1]);
  }
  for (const [key, file] of Object.entries(lazyPaths)) assert.ok(!seen.has(file), `${file} (${key}) est encore importé statiquement`);
});

// Identifiants d'app.js qui désignent chaque module différé : instances, et accesseurs sous la forme « nom() ».
function lazyIdentifiers() {
  const ids = Object.fromEntries(Object.keys(LAZY_MODULES).map(key => [key, new Set()]));
  // Un module autonome (écouteur propre, ex. share) peut s'enregistrer sans variable d'instance : lazy.onLoad('x',m=>m.create…).
  for (const m of app.matchAll(/lazy\.onLoad\('(\w+)',m=>(?:\{?([\w$]+)=|m\.create)/g)) ids[m[1]].add(m[2] || `onLoad:${m[1]}`);
  for (const m of app.matchAll(/(?:function ([\w$]+)\(\)\{return (?:[\w$]+\|\|\()?)?([\w$]+)(?:\?\?=|\|\|=|=)lazy\.get\('(\w+)'\)/g)) { ids[m[3]].add(m[2]); if (m[1]) ids[m[3]].add(`${m[1]}()`); }
  // Un module chargé au démarrage peut tirer un module différé avec le chargeur qu'app.js lui passe (n° 13, saisie vocale).
  if (/createVoiceNotesUI\(\{[^}]*\blazy\b/.test(app)) for (const m of read('voice-notes-ui.js').matchAll(/host\.lazy\.need\('(\w+)'[^]*?host\.lazy\.get\('\1'\)/g)) ids[m[1]].add(`voice-notes-ui:${m[1]}`);
  return ids;
}

test('chaque module différé est rattaché à app.js', () => {
  const ids = lazyIdentifiers();
  for (const [key, set] of Object.entries(ids)) assert.ok(set.size, `${key} : aucune instance ni accesseur dans app.js`);
  for (const [action, keys] of Object.entries(LAZY_ACTIONS)) {
    assert.ok(new RegExp(`action===?'${action}'`).test(app), `${action} : aucun gestionnaire dans app.js`);
    for (const key of keys) assert.ok(LAZY_MODULES[key], `${action} : module ${key} inconnu`);
  }
  for (const key of Object.values(LAZY_TRIGGERS)) assert.ok(LAZY_MODULES[key]);
});

// Références tolérées sans attente : l'absence du module signifie qu'il n'y a rien à faire.
const SAFE_WITHOUT_MODULE = [
  /yieldUI\?\.cancel\(\)/, // aucune superposition de rendement à annuler
  /fieldTrackerUI\?\.refresh\(\)/, // mode terrain jamais ouvert : rien à rafraîchir
  /intel\(\)\?\.assistantActionRequiresConfirmation\(action\)\?\?true/, // sans le module, confirmation exigée par défaut
  /\(mode==='edit'\?contourEditUI\(\):walkMeasureUI\(\)\)\.askAbandon/, // outil actif, donc déjà chargé
  /hereUI\?(?:\.(?:pill|sheetHtml)\(|hereUI\.apply\()/ // n° 111 : sans position connue, ni pastille ni parcelle contextuelle
];

test('aucune utilisation d’un module différé sans attente de son chargement', () => {
  const ids = lazyIdentifiers();
  const problems = [];
  const lineStart = i => app.lastIndexOf('\n', i - 1) + 1;
  const lineEnd = i => { const e = app.indexOf('\n', i); return e < 0 ? app.length : e; };
  const namesKey = (text, key) => [...text.matchAll(/lazy\.(?:onLoad|get|run|wait|soon|need)\(([^()]*)/g)].some(m => m[1].includes(`'${key}'`));
  const escape = text => text.replace(/[$()]/g, '\\$&');
  for (const [key, set] of Object.entries(ids)) for (const id of set) {
    // Accesseur « nom() » : seuls les appels comptent (le mot peut figurer dans un texte affiché).
    const pattern = id.endsWith('()') ? `(?<![\\w$.])${escape(id.slice(0, -1))}` : `(?<![\\w$.'"-])${escape(id)}(?![\\w$'"-])`;
    for (const m of app.matchAll(new RegExp(pattern, 'g'))) {
      const i = m.index, after = app.slice(i, i + 140);
      if (/^[\w$]+(?:\(\)\{return [\w$]+(?:\|\|\([\w$]+)?)?(?:\?\?=|\|\|=|=)lazy\.get\('/.test(after) || /^[\w$]+\|\|\([\w$]+=lazy\.get\('/.test(after)) continue; // définition de l'accesseur
      if (/^[\w$]+=null/.test(after) || /^\s*let\s[\w$=,\s]*$/.test(app.slice(lineStart(i), i).replace(/=null/g, ''))) continue; // déclaration
      if (SAFE_WITHOUT_MODULE.some(re => re.test(app.slice(Math.max(0, i - 60), i + 80)))) continue;
      // Branche du délégué de clics : l'action doit être retenue tant que le module manque.
      const before = app.slice(lineStart(i), i), branch = before.slice(Math.max(0, before.lastIndexOf('else if(')));
      const branchActions = [...branch.matchAll(/action===?'([^']+)'/g)].map(x => x[1]);
      if (branchActions.length) {
        if (branchActions.every(action => LAZY_ACTIONS[action]?.includes(key)) || namesKey(branch + app.slice(i, lineEnd(i)), key)) continue;
        problems.push(`${id} (${key}) dans la branche ${branchActions.join(', ')} : action absente de LAZY_ACTIONS`);
        continue;
      }
      // Ailleurs : la fonction englobante doit attendre le module avant de s'en servir.
      const from = Math.max(0, i - 20000);
      const fnStart = Math.max(0, ...[...app.slice(from, i).matchAll(/function\s*[\w$]*\s*\(/g)].map(x => from + x.index));
      if (namesKey(app.slice(fnStart, i + id.length + 2), key)) continue;
      problems.push(`${id} (${key}) : « ${app.slice(Math.max(0, i - 70), i + 50).replace(/\s+/g, ' ')} »`);
    }
  }
  assert.deepEqual(problems, []);
});


test('chaque data-action littéral garde un gestionnaire', () => {
  const files = fs.readdirSync(root).filter(f => /\.(js|html)$/.test(f) && !/\.min\.js$/.test(f) && f !== 'support.js' && !f.startsWith('Parcelles v3'));
  const sources = files.map(read);
  const rendered = new Map();
  files.forEach((file, n) => { for (const m of sources[n].matchAll(/data-action=\\?["']([a-z0-9-]+)\\?["']/g)) rendered.set(m[1], file); });
  const handled = new Set();
  for (const s of sources) {
    for (const re of [/action\s*===?\s*'([a-z0-9-]+)'/g, /'([a-z0-9-]+)'\s*===?\s*(?:action|[\w.]*dataset\.action)/g, /dataset\.action\s*===?\s*'([a-z0-9-]+)'/g, /\[data-action=\\?["']([a-z0-9-]+)\\?["']\]/g, /case\s+'([a-z0-9-]+)'/g, /'([a-z0-9-]+)'\s*:\s*(?:\(|async|\w+\s*=>|function)/g])
      for (const m of s.matchAll(re)) handled.add(m[1]);
    for (const m of s.matchAll(/(?:ACTIONS|actions)\s*=\s*(?:Object\.freeze\()?(?:new Set\()?\[([^\]]*)\]/g)) for (const x of m[1].matchAll(/'([a-z0-9-]+)'/g)) handled.add(x[1]);
  }
  assert.ok(rendered.size > 100);
  assert.deepEqual([...rendered].filter(([action]) => !handled.has(action)).map(([action, file]) => `${action} (${file})`), []);
});

test('mission machine différée : parcelles avec contour, contrôle des champs, export ISOXML', async () => {
  const {createMachineMissionUI} = await import('./machine-mission-ui.js');
  const square = {type: 'Polygon', coordinates: [[[5, 46], [5.01, 46], [5.01, 46.01], [5, 46.01], [5, 46]]]};
  const parcels = [{id: 'p1', nom: 'Les <Noues>', surfaceHa: 2, geometry: square}, {id: 'p2', nom: 'Sans contour'}, {id: 'p3', nom: 'Archivée', archived: true, geometry: square}];
  const nodes = {}, opened = [], toasts = [];
  const node = () => ({textContent: '', classList: {hidden: true, remove() { this.hidden = false; }}});
  const doc = {querySelector: selector => nodes[selector] || null};
  let checked = [], fields = {};
  globalThis.FormData = class { constructor() {} getAll() { return checked; } entries() { return Object.entries(fields)[Symbol.iterator](); } [Symbol.iterator]() { return this.entries(); } };
  const ui = createMachineMissionUI({parcels: () => parcels, parcelById: id => parcels.find(p => p.id === id), selectedParcelId: () => 'p1', doc,
    modal: (title, description, body, footer) => { opened.push({title, body, footer}); nodes['#mission-form'] = {}; nodes['#mission-error'] = node(); nodes['#save-mission'] = {}; },
    closeModal: () => {}, toast: message => toasts.push(message), openZones: id => toasts.push(`zones ${id}`)});
  ui.open();
  assert.equal(opened[0].title, 'Nouvelle mission');
  assert.match(opened[0].body, /value="p1" checked> Les &lt;Noues&gt;/);
  assert.doesNotMatch(opened[0].body, /Sans contour|Archivée/);
  nodes['#save-mission'].onclick();
  assert.equal(nodes['#mission-error'].textContent, 'Champ obligatoire : Parcelles');
  checked = ['p1']; fields = {operation: 'Semis', product: ' Blé ', dose: '180', unit: 'kg/ha', modulation: 'Selon zones'};
  nodes['#save-mission'].onclick();
  assert.deepEqual(toasts.splice(0), ['zones p1', 'Préparez les zones de modulation de la parcelle, puis exportez la préconisation ISOXML.']);
  delete globalThis.FormData;
});

test('paramètres différés : formulaire échappé, recherche et enregistrement', async () => {
  const {createSettingsUI} = await import('./settings-ui.js');
  const nodes = {}, opened = [], calls = [];
  const sections = [{dataset: {keywords: 'météo vent'}, textContent: 'Météo', classList: {hidden: false, toggle(_, on) { this.hidden = Boolean(on); }}}];
  const doc = {querySelector: selector => nodes[selector] || null, querySelectorAll: () => sections};
  const check = on => ({checked: on});
  const form = {querySelectorAll: () => [{value: 'weather'}], highContrast: check(true)};
  for (const name of ['compactMode', 'gpsConsent', 'fieldAutoDetect', 'fieldKeepAwake', 'autoBackup', 'syncEnabled', 'notificationsEnabled', 'syncAttachments', 'syncWifiOnly', 'syncLive', 'syncLiveWifiOnly', 'syncAttachmentsWifiOnly', 'syncAutoMerge', 'securityAuditEnabled', 'assistantHistory', 'assistantLocalFirst', 'assistantTerrainContext', 'voiceEnabled', 'assistantVoiceReplies', 'remoteAiEnabled']) form[name] = check(false);
  globalThis.FormData = class { constructor() {} [Symbol.iterator]() { return Object.entries({nom: ' ', commune: 'Brou', latitude: '46,1', longitude: '', mapLayer: 'osm', mapColorMode: 'culture', theme: 'system', routeProvider: 'apple', weatherDays: '14', weatherWindThreshold: '30', weatherRainThreshold: '4', defaultOperator: '', fuelPrice: '1.5', syncRetryMax: '40', syncRetryBaseSeconds: '1', remoteAiEndpoint: ' https://x.test '})[Symbol.iterator](); } };
  const ui = createSettingsUI({doc, state: () => ({exploitation: {nom: 'Ferme <A>'}, preferences: {}}),
    store: {setExploitation: async v => calls.push(['farm', v]), setPreferences: async v => calls.push(['prefs', v])}, sync: {init: async () => calls.push('sync')},
    modal: (title, description, body) => { opened.push({title, body}); nodes['#settings-search'] = {}; nodes['#save-settings'] = {}; nodes['#settings-form'] = form; },
    closeModal: () => calls.push('close'), toast: message => calls.push(message), renderAll: () => calls.push('render')});
  ui.open();
  assert.equal(opened[0].title, 'Paramètres');
  assert.match(opened[0].body, /value="Ferme &lt;A&gt;"/);
  nodes['#settings-search'].oninput({target: {value: 'pluie'}});
  assert.equal(sections[0].classList.hidden, true);
  await nodes['#save-settings'].onclick();
  assert.deepEqual(calls[0], ['farm', {nom: 'Mon exploitation', commune: 'Brou', latitude: 46.1, longitude: null}]);
  assert.deepEqual([calls[1][1].weatherDays, calls[1][1].syncRetryMax, calls[1][1].syncRetryBaseSeconds, calls[1][1].homeCards, calls[1][1].remoteAiEndpoint], [14, 12, 5, ['weather'], 'https://x.test']);
  assert.deepEqual(calls.slice(2), ['sync', 'close', 'render', 'Paramètres enregistrés.']);
  delete globalThis.FormData;
});

test('couches de la carte différées : carte et satellite lus à l’ouverture', async () => {
  const {createMapLayersUI} = await import('./map-layers-ui.js');
  const opened = [], bound = [], listeners = {};
  const root = {isConnected: true, querySelector: () => null, querySelectorAll: () => [], addEventListener: (type, fn) => { listeners[type] = fn; }};
  const nodes = {'#map-layer-form': root, '#rpg-load-progress': {textContent: ''}, '#modal-root': {classList: {add() {}}}};
  let map = null;
  const data = {preferences: {mapColorMode: 'ndvi'}, parcelles: [{id: 'p1', nom: 'A', geometry: {}}], interventions: []};
  const ui = createMapLayersUI({state: () => data, store: {}, active: type => data[type] || [], toast: () => {}, doc: {querySelector: s => nodes[s] || null},
    modal: (title, description, body) => opened.push({title, body}), getMap: () => map,
    getSatellite: () => ({ndviControls: () => '<i id="ndvi"></i>', mapControls: () => ''}),
    regulatory: () => ({layersHtml: () => '', bindLayers: node => bound.push(node)}), photoGeo: () => ({layerOn: () => false})});
  map = {rpgVisible: false, selectedId: 'p<1>'};
  ui.open();
  assert.equal(opened[0].title, 'Couches');
  assert.match(opened[0].body, /data-value="ndvi">Vigueur \(NDVI\)/);
  assert.match(opened[0].body, /<div id="ly-ndvi-wrap"><i id="ndvi"><\/i>/);
  assert.match(opened[0].body, /data-id="p&lt;1&gt;"/);
  assert.deepEqual(bound, [root]);
  assert.equal(typeof listeners.click, 'function');
});

test('automatisations différées : liste, formulaire et test sans écriture', async () => {
  const {createAutomationsUI} = await import('./automations-ui.js');
  const nodes = {}, opened = [];
  const data = {preferences: {}, automationRules: [{id: 'r1', name: 'Règle <1>', kind: 'custom', target: 'tasks', trigger: 'interval', conditions: [], actions: [{type: 'notify'}], enabled: true}], automationRuns: []};
  const ui = createAutomationsUI({state: () => data, store: {}, active: type => data[type] || [], toast: () => {}, weather: () => null,
    doc: {querySelector: s => nodes[s] || null, querySelectorAll: () => []},
    modal: (title, description, body, footer) => { opened.push({title, body, footer}); nodes['#automation-target'] = {}; nodes['#save-automation-rule'] = {}; }});
  ui.open();
  assert.equal(opened[0].title, 'Automatisations');
  assert.match(opened[0].body, /Règle &lt;1&gt;/);
  assert.match(opened[0].footer, /data-action="new-automation"/);
  ui.openRuleForm(data.automationRules[0]);
  assert.equal(opened[1].title, 'Modifier l’automatisation');
  assert.match(opened[1].body, /<option value="">— Aucune —<\/option>/);
  assert.match(opened[1].footer, /id="test-automation-rule"/);
  ui.openRuleForm();
  assert.equal(opened[2].title, 'Nouvelle automatisation');
  assert.doesNotMatch(opened[2].footer, /test-automation-rule/);
});

test('centres techniques différés : intégrations, trace GPS et réparation des accents', async () => {
  const {createTechCentersUI} = await import('./tech-centers-ui.js');
  const nodes = {}, opened = [], waits = [];
  const data = {preferences: {}, gpsTracks: [{id: 'g1', name: 'Trace <1>', distanceMeters: 1500, points: [{}, {}], matchedParcels: [{parcelId: 'p1', share: 0.5}], createdAt: 1}], integrationImports: [], weatherStations: [], parcelles: [{id: 'p1', nom: 'Les <Noues>', culture: 'Blé'}]};
  const ui = createTechCentersUI({state: () => data, store: {get: (type, id) => data[type].find(x => x.id === id)}, active: type => data[type] || [],
    parcelById: id => data.parcelles.find(p => p.id === id), toast: () => {}, closeModal: () => {},
    lazy: {wait: (key, fn) => { waits.push(key); return false; }}, impex: () => ({}),
    doc: {querySelector: s => nodes[s] || null, querySelectorAll: () => []},
    modal: (title, description, body, footer) => { opened.push({title, body, footer}); nodes['#repair-load-source'] = {}; nodes['#repair-source-files'] = {}; }});
  ui.openIntegrations();
  assert.equal(opened[0].title, 'Intégrations agricoles');
  assert.match(opened[0].body, /data-action="open-integration-track" data-id="g1"><span>⌁<\/span><span><strong>Trace &lt;1&gt;<\/strong>/);
  ui.openIntegrationTrack('g1');
  assert.equal(opened[1].title, 'Trace <1>');
  assert.match(opened[1].body, /Les &lt;Noues&gt;<\/strong><small>50 % des points/);
  ui.openTextRepair();
  assert.deepEqual(waits, ['importExport']);
  assert.equal(opened[2].title, 'Réparer les accents');
  assert.equal(typeof nodes['#repair-source-files'].onchange, 'function');
});
