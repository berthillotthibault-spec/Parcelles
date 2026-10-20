// Registre d'actions et découpage d'app.js (n° 147) : chaque data-action affiché a un gestionnaire,
// le délégué consulte d'abord le registre, les modules extraits restent petits et lisibles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerAction, registerActions, hasAction, registeredActions, runAction} from './actions.js';
import {ctx, initContext} from './app-context.js';
import {LAZY_ACTIONS, LAZY_MODULES} from './lazy-modules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const sw = read('sw.js');
const runtime = read('runtime.js');

// Modules d'actions par domaine : nom du fichier -> export de la table des gestionnaires.
const ACTION_MODULES = {'work-actions.js': 'workActions', 'parcel-actions.js': 'parcelActions'};
// Modules créés ou déplacés par le n° 147 : taille et largeur contrôlées.
const NEW_MODULES = ['app-context.js', 'actions.js', ...Object.keys(ACTION_MODULES), 'work-form-ui.js', 'account-ui.js', 'diagnostic-ui.js'];

// Exceptions légitimes : data-action affiché sans gestionnaire détectable (action: raison). Aucune aujourd'hui ;
// toute entrée ajoutée ici doit rester exacte (le test vérifie qu'elle est toujours affichée et toujours non gérée).
const EXCEPTIONS = {};

async function actionTables() {
  const tables = {};
  for (const [file, name] of Object.entries(ACTION_MODULES)) tables[file] = (await import(`./${file}`))[name];
  return tables;
}

// Corps du délégué de clics d'app.js : de l'écouteur jusqu'au catch qui traduit les erreurs.
function delegateSource() {
  const start = app.indexOf("document.addEventListener('click',async event=>{");
  const end = app.indexOf('\n    }catch(error){', start);
  assert.ok(start > 0 && end > start, 'délégué de clics introuvable');
  return app.slice(start, end);
}

// Fichiers servis : index.html et la liste CORE de sw.js (modules différés compris), sans les bibliothèques minifiées.
function servedSources() {
  const core = [...sw.matchAll(/'\.\/([^']+\.(?:js|html))'/g)].map(m => m[1]);
  return [...new Set(['index.html', ...core])].filter(file => fs.existsSync(path.join(root, file)) && !file.endsWith('.min.js'))
    .map(file => [file, read(file)]);
}

// data-action affichés : attributs littéraux, noms cités dans une expression data-action="${…}",
// et objets {action:'…'} rendus en boutons (états vides, raccourcis, notifications).
function renderedActions(sources) {
  const rendered = new Map();
  const add = (action, file) => { if (!rendered.has(action)) rendered.set(action, new Set()); rendered.get(action).add(file); };
  for (const [file, source] of sources) {
    for (const m of source.matchAll(/data-action=\\?["']([a-z0-9-]+)\\?["']/g)) add(m[1], file);
    for (const m of source.matchAll(/data-action=\\?["']\$\{([^}]*)\}/g)) for (const x of m[1].matchAll(/'([a-z0-9]+-[a-z0-9-]+)'/g)) add(x[1], file);
    for (const m of source.matchAll(/\baction:\s*'([a-z0-9]+-[a-z0-9-]+)'/g)) add(m[1], file);
  }
  return rendered;
}

// Gestionnaires des modules (écouteur propre) : comparaisons sur l'action, case, listes d'actions.
function moduleHandled(sources) {
  const handled = new Map();
  const patterns = [/action\s*===?\s*'([a-z0-9-]+)'/g, /'([a-z0-9-]+)'\s*===?\s*(?:action|[\w.]*dataset\.action)/g,
    /dataset\.action\s*===?\s*'([a-z0-9-]+)'/g, /case\s+'([a-z0-9-]+)'/g];
  const lists = /(?:ACTIONS|actions)\s*=\s*(?:Object\.freeze\()?(?:new Set\()?\[([^\]]*)\]/g;
  for (const [file, source] of sources) {
    if (file === 'app.js' || ACTION_MODULES[file]) continue;
    for (const re of patterns) for (const m of source.matchAll(re)) handled.set(m[1], file);
    for (const m of source.matchAll(lists)) for (const x of m[1].matchAll(/'([a-z0-9-]+)'/g)) handled.set(x[1], file);
  }
  // Hors du délégué, app.js gère aussi quelques actions par son propre code (comparaisons sur l'action).
  const delegate = delegateSource(), outside = app.replace(delegate, '');
  for (const m of outside.matchAll(/action\s*===?\s*'([a-z0-9-]+)'/g)) if (!handled.has(m[1])) handled.set(m[1], 'app.js (hors délégué)');
  return handled;
}

test('registre : enregistrement unique, appel avec l’identifiant, action inconnue', async () => {
  const seen = [];
  registerAction('essai-registre', ({action, id, control, event}) => { seen.push([action, id, control.dataset.id, event.type]); return 'fait'; });
  registerActions({'essai-registre-async': async ({id}) => { seen.push(['async', id]); }});
  assert.equal(hasAction('essai-registre'), true);
  assert.ok(registeredActions().includes('essai-registre-async'));
  assert.throws(() => registerAction('essai-registre', () => {}), /déjà enregistrée/);
  assert.throws(() => registerAction('essai-sans-gestionnaire'), TypeError);
  const control = {dataset: {id: 'w1'}};
  assert.equal(runAction('essai-registre', control, {type: 'click'}), 'fait');
  await runAction('essai-registre-async', control, {type: 'click'});
  assert.equal(runAction('essai-inconnue', control, {type: 'click'}), false);
  assert.deepEqual(seen, [['essai-registre', 'w1', 'w1', 'click'], ['async', 'w1']]);
});

test('contexte partagé : les accesseurs restent vivants (valeurs lues au moment de l’appel)', () => {
  let filters = {parcel: ''};
  initContext({state: () => 'état', get workFilters() { return filters; }, set workFilters(value) { filters = value; }});
  assert.equal(ctx.state(), 'état');
  filters = {parcel: 'p1'};
  assert.equal(ctx.workFilters.parcel, 'p1');
  ctx.workFilters = {parcel: 'p2'};
  assert.equal(filters.parcel, 'p2');
});

// Découpe une liste au niveau 0 (hors parenthèses, accolades, crochets et chaînes).
function splitTopLevel(source, separator = ',') {
  const parts = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === separator && depth === 0) { parts.push(source.slice(start, i)); start = i + 1; }
  }
  parts.push(source.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

test('contexte partagé : app.js transmet ses variables `let` par accesseur, jamais par copie de valeur', () => {
  // initContext est appelé au début d'init(), avant la création de store, sync, parcelMap… :
  // une copie de valeur figerait null pour toute la session et ferait planter les actions du registre.
  const call = app.indexOf('initContext({');
  assert.ok(call > 0, 'appel initContext({...}) introuvable dans app.js');
  let depth = 0, end = call + 'initContext('.length;
  for (; end < app.length; end++) {
    if (app[end] === '{') depth++;
    else if (app[end] === '}' && --depth === 0) break;
  }
  const props = splitTopLevel(app.slice(call + 'initContext({'.length, end));
  const lets = new Set();
  // Déclarations en tête de ligne ou après un « ; » (app.js en enchaîne plusieurs par ligne, après les imports).
  for (const [, declarations] of app.matchAll(/(?<=^|;)let ([^;]+);/gm)) {
    for (const declarator of splitTopLevel(declarations)) lets.add(declarator.split('=')[0].trim());
  }
  const expected = ['store', 'sync', 'parcelMap', 'nativeBridge', 'weatherCache', 'lastGps', 'fieldModeOpen', 'currentView', 'currentParcelTab',
    'selectedParcelId', 'workFilters', 'pendingInviteToken', 'quickEntryUI', 'teamWorkUI', 'phytoUI', 'hedgesUI', 'historyUI', 'habitsUI', 'seedsUI'];
  for (const name of expected) assert.ok(lets.has(name), `${name} : n'est plus une variable let d'app.js, liste à revoir`);
  const getters = new Set();
  for (const prop of props) {
    const getter = prop.match(/^get (\w+)\(\)\{return (\w+);\}$/);
    if (getter) { assert.equal(getter[2], getter[1], `accesseur ${getter[1]} : renvoie ${getter[2]}`); getters.add(getter[1]); continue; }
    if (/^set \w+\(/.test(prop)) continue;
    const name = prop.match(/^(\w+)\s*(?::|$)/)?.[1];
    assert.ok(!lets.has(name), `${name} : variable let d'app.js transmise par valeur à initContext, utiliser get ${name}(){return ${name};}`);
  }
  for (const name of expected) assert.ok(getters.has(name), `${name} : accesseur absent de initContext`);
});

test('chaque data-action affiché est géré (registre, branche d’app.js ou module), exceptions comprises', async () => {
  const tables = await actionTables();
  const registry = new Set(Object.values(tables).flatMap(table => Object.keys(table)));
  const branches = new Set([...delegateSource().matchAll(/action===?'([a-z0-9-]+)'/g)].map(m => m[1]));
  const sources = servedSources();
  const rendered = renderedActions(sources), modules = moduleHandled(sources);
  assert.ok(rendered.size > 200, `${rendered.size} actions seulement : inventaire incomplet ?`);
  const missing = [...rendered].filter(([action]) => !registry.has(action) && !branches.has(action) && !modules.has(action) && !EXCEPTIONS[action])
    .map(([action, files]) => `${action} (${[...files].join(', ')})`);
  assert.deepEqual(missing, []);
  for (const [action, reason] of Object.entries(EXCEPTIONS)) {
    assert.ok(reason, `${action} : raison de l’exception absente`);
    assert.ok(rendered.has(action), `${action} : exception obsolète (plus affichée)`);
    assert.ok(!registry.has(action) && !branches.has(action) && !modules.has(action), `${action} : exception obsolète (désormais gérée)`);
  }
  // Inverse : une action enregistrée doit être affichée quelque part (sinon gestionnaire mort).
  const named = sources.filter(([file]) => !ACTION_MODULES[file]).map(([, source]) => source).join('\n');
  for (const action of registry) assert.ok(rendered.has(action) || named.includes(`'${action}'`), `${action} : enregistrée mais jamais affichée`);
});

test('délégué : le registre d’abord, sans doublon ni action différée, enregistré au démarrage', async () => {
  const tables = await actionTables();
  const delegate = delegateSource();
  const registryCall = delegate.indexOf('if(hasAction(action))await runAction(action,control,event);');
  assert.ok(registryCall > 0, 'le délégué ne consulte pas le registre');
  // Le registre passe après la sortie des modes de carte et la navigation, dans le try qui traduit les erreurs
  // (lecture seule, garde-fou de rôle du Store), et avant toute branche if(action==='…').
  assert.ok(delegate.indexOf('mapModes.leave(') < registryCall && delegate.indexOf('if(control.dataset.view)') < registryCall);
  assert.ok(delegate.lastIndexOf('try{', registryCall) > delegate.indexOf('const action=control.dataset.action'));
  assert.doesNotMatch(delegate.slice(0, registryCall), /\baction===?'/, 'une branche if(action===…) passe avant le registre');
  const seen = new Set();
  for (const [file, table] of Object.entries(tables)) {
    for (const action of Object.keys(table)) {
      assert.ok(!seen.has(action), `${action} : enregistrée deux fois`);
      seen.add(action);
      assert.equal(typeof table[action], 'function', `${file} : ${action}`);
      assert.ok(!new RegExp(`action===?'${action}'`).test(delegate), `${action} : branche morte restée dans app.js`);
      assert.ok(!LAZY_ACTIONS[action], `${action} : action différée, à laisser au délégué (gateClicks)`);
    }
    assert.match(app, new RegExp(`registerActions\\(${ACTION_MODULES[file]}\\)`), `${file} non enregistré dans init`);
  }
});

test('modules extraits : moins de 400 lignes, 160 colonnes au plus, fins de ligne LF, servis hors connexion', () => {
  for (const file of NEW_MODULES) {
    const source = read(file), lines = source.split('\n');
    assert.ok(lines.length < 400, `${file} : ${lines.length} lignes`);
    const wide = lines.map((line, n) => [n + 1, line.length]).filter(([, width]) => width > 160);
    assert.deepEqual(wide, [], `${file} : lignes de plus de 160 colonnes`);
    assert.ok(!source.includes('\r'), `${file} : fins de ligne CRLF`);
    assert.ok(sw.includes(`'./${file}'`), `${file} absent de CORE (sw.js)`);
    assert.ok(runtime.includes(`'./${file}'`), `${file} absent de REQUIRED_ASSETS (runtime.js)`);
  }
  // Formulaire Travail et écrans de compte : modules différés, jamais importés statiquement.
  assert.equal(String(LAZY_MODULES.workForm).includes('./work-form-ui.js'), true);
  assert.equal(String(LAZY_MODULES.account).includes('./account-ui.js'), true);
  assert.equal(String(LAZY_MODULES.diagnostic).includes('./diagnostic-ui.js'), true);
  assert.doesNotMatch(app, /from '\.\/diagnostic-ui\.js'/);
  assert.match(app, /function openDiagnostic\(\)\{return Promise\.resolve\(lazy\.run\('diagnostic',/);
  assert.doesNotMatch(app, /from '\.\/(?:work-form-ui|account-ui)\.js'/);
  assert.match(app, /function openWorkForm\([^)]*\)\{return lazy\.run\('workForm',/);
  assert.match(app, /function openAccountTeam\(\)\{return Promise\.resolve\(lazy\.run\('account',/);
});

test('modules extraits : un module différé n’est utilisé qu’après son chargement (ou en ?.)', () => {
  const lazyUses = {habitsUI: 'habits', seedsUI: 'seeds'};
  for (const file of NEW_MODULES) {
    const source = read(file);
    for (const [id, key] of Object.entries(lazyUses)) {
      for (const m of source.matchAll(new RegExp(`ctx\\.${id}(\\??\\.)`, 'g'))) {
        if (m[1] === '?.') continue;
        const before = source.slice(Math.max(0, m.index - 400), m.index);
        assert.match(before, new RegExp(`lazy\\.(?:need|ready)\\((?:\\[[^\\]]*)?'${key}'`), `${file} : ctx.${id} sans attente de ${key}`);
      }
    }
  }
});

test('travaux : terminer puis rouvrir rétablit le statut d’avant ; filtres écrits dans le contexte', async () => {
  const {workActions} = await import('./work-actions.js');
  const saved = [], toasts = [], rendered = [];
  let works = {w1: {id: 'w1', type: 'Semis', status: 'En cours', date: '2026-05-01', plannedDate: ''}};
  const previousDocument = globalThis.document;
  globalThis.document = {querySelector: () => null};
  let filters = {parcel: 'p1', type: 'Semis'};
  initContext({
    store: {get: (type, id) => works[id], upsert: async (type, entity) => { saved.push(entity); works = {...works, [entity.id]: entity}; return entity; }},
    state: () => ({preferences: {nativeHaptics: false}}), nativeBridge: null, nextAction: () => ({armFlip() {}}), todayIso: () => '2026-05-12',
    toast: (message, type, undo) => toasts.push([message, Boolean(undo)]), lazy: {need: async () => false}, renderWork: () => rendered.push('work'),
    $: () => null, get workFilters() { return filters; }, set workFilters(value) { filters = value; }
  });
  try {
    const control = {dataset: {id: 'w1'}};
    await workActions['finish-work']({id: 'w1', control});
    assert.deepEqual([saved[0].status, saved[0].date, saved[0].plannedDate], ['Terminé', '2026-05-12', '2026-05-01']);
    await workActions['reopen-work']({id: 'w1', control});
    assert.deepEqual([saved[1].status, saved[1].date], ['En cours', '2026-05-01']);
    assert.deepEqual(toasts, [['Travail marqué terminé.', true], ['Travail rouvert.', true]]);
    workActions['clear-work-filter']({control: {dataset: {filter: 'type'}}});
    assert.deepEqual(filters, {parcel: 'p1', type: ''});
    workActions['clear-work-filters']();
    assert.deepEqual([filters, rendered.length], [{parcel: '', type: ''}, 2]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('parcelles : la transition partagée ne part que d’une liste, l’archivage bascule et prévient', async () => {
  const {parcelActions} = await import('./parcel-actions.js');
  const calls = [], parcels = {p1: {id: 'p1', nom: 'Les Noues', archived: false}};
  let view = 'parcels';
  initContext({
    closeModal: () => calls.push('close'), closeFieldMode: () => calls.push('field'), openParcel: id => calls.push(`open ${id}`),
    viewTransitions: () => ({shareFromRow: () => calls.push('share')}), get currentView() { return view; },
    parcelById: id => parcels[id], toast: message => calls.push(message),
    store: {upsert: async (type, entity, {label}) => { calls.push(label); parcels[entity.id] = entity; return entity; }}
  });
  parcelActions['open-parcel']({id: 'p1', control: {}});
  view = 'parcel';
  parcelActions['open-parcel']({id: 'p1', control: {}});
  assert.deepEqual(calls.splice(0), ['close', 'field', 'share', 'open p1', 'close', 'field', 'open p1']);
  await parcelActions['archive-parcel']({id: 'p1'});
  assert.deepEqual(calls.splice(0), ['Parcelle archivée : Les Noues', 'close', 'Parcelle archivée.']);
  assert.equal(parcels.p1.archived, true);
  await parcelActions['archive-parcel']({id: 'inconnue'});
  assert.deepEqual(calls, []);
});

test('formulaire Travail groupé : parcelles précochées depuis la sélection de la carte', async () => {
  const {createWorkFormUI} = await import('./work-form-ui.js');
  const opened = [], nodes = {};
  const ui = createWorkFormUI({
    $: selector => (nodes[selector] ||= {}), $$: () => [], state: () => ({}), todayIso: () => '2026-05-12', toast: () => {},
    active: type => (type === 'parcelles' ? [{id: 'p1', nom: 'Les <Noues>', surfaceHa: 2}, {id: 'p2', nom: 'Grand Champ', surfaceHa: 3}] : []),
    modal: (title, description, body, footer) => opened.push({title, body, footer})
  });
  ui.openBatch(['p2']);
  assert.equal(opened[0].title, 'Travail groupé');
  assert.match(opened[0].body, /value="p1"><span><strong>Les &lt;Noues&gt;<\/strong>/);
  assert.match(opened[0].body, /value="p2" checked><span><strong>Grand Champ<\/strong>/);
  assert.equal(typeof nodes['#save-batch-work'].onclick, 'function');
});

test('écran Synchronisation : file, conflits et boutons selon la connexion', async () => {
  const {createAccountUI} = await import('./account-ui.js');
  const opened = [];
  const data = {queue: [{status: 'pending'}, {status: 'error'}], metadata: {lastSyncError: 'Réseau <coupé>'},
    syncConflicts: [{id: 'c1', status: 'open', entity: 'parcelles', conflictFields: ['nom']}]};
  const ui = createAccountUI({
    $: () => null, $$: () => [], state: () => data, active: (type, d) => d[type] || [], entityTypeLabel: () => 'Parcelle',
    sync: {status: {message: 'Connecté', connected: false}, roleName: 'Propriétaire', lastResult: {sent: 2, pulled: 1}},
    modal: (title, description, body, footer) => opened.push({title, body, footer})
  });
  await ui.openSync();
  assert.equal(opened[0].title, 'Synchronisation');
  assert.match(opened[0].body, /<dt>Conflits<\/dt><dd>1<\/dd>/);
  assert.match(opened[0].body, /Réseau &lt;coupé&gt;/);
  assert.match(opened[0].body, /2 envoyées, 1 reçue, 0 fusion sûre, 0 erreur, 0 fichier envoyé, 0 reçu\./);
  assert.match(opened[0].body, /data-action="open-sync-conflict" data-id="c1"/);
  assert.doesNotMatch(opened[0].footer, /run-sync/);
});

test('écran Santé de l’application : décalage d’horloge lisible, seuil de 5 minutes', async () => {
  const {clockSkewLabel, clockSkewIsLarge} = await import('./diagnostic-ui.js');
  assert.equal(clockSkewLabel(null), 'Non mesuré (synchronisation cloud requise)');
  assert.equal(clockSkewLabel({deviceOffsetMs: 1500}), 'À l’heure (écart inférieur à 2 s)');
  assert.equal(clockSkewLabel({deviceOffsetMs: 4000, uncertaintyMs: 5000}), 'À l’heure (écart inférieur à 5 s)');
  assert.match(clockSkewLabel({deviceOffsetMs: -90000, measuredAt: 0}), /^−1,5 min \(l’appareil retarde\) · mesuré le /);
  assert.match(clockSkewLabel({deviceOffsetMs: 12000, measuredAt: 0}), /^\+12 s \(l’appareil avance\)/);
  assert.deepEqual([clockSkewIsLarge({deviceOffsetMs: 300000}), clockSkewIsLarge({deviceOffsetMs: -300001}), clockSkewIsLarge()], [false, true, false]);
});

// Les quatre nouveaux modules statiques (contexte, registre, actions) sont compensés : la logique servie seulement
// à l'enregistrement, à l'import ou à la mesure est chargée à la demande, et l'import mort de statistics.js a disparu.
test('logique chargée à la demande : attendue avant usage, jamais importée statiquement', () => {
  for (const [key, file] of [['mapRecords', 'map-records.js'], ['integrations', 'integrations.js'], ['measureLib', 'walk-measure.js']]) {
    assert.equal(String(LAZY_MODULES[key]).includes(`./${file}`), true, key);
    assert.doesNotMatch(app, new RegExp(`from '\\./${file.replace('.', '\\.')}'`), `${file} importé statiquement par app.js`);
    for (const m of app.matchAll(new RegExp(`lazy\\.get\\('${key}'\\)`, 'g'))) {
      const before = app.slice(Math.max(0, m.index - 200), m.index);
      assert.match(before, new RegExp(`lazy\\.(?:need|wait)\\('${key}'`), `${key} lu sans attente`);
    }
  }
  assert.doesNotMatch(app, /from '\.\/statistics\.js'/, 'import mort de statistics.js revenu');
});
