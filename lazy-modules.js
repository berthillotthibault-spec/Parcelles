// Chargement différé des écrans secondaires (n° 144 étape 2, n° 147 étape 4).
// Ces modules ne servent pas au premier rendu des cinq onglets : app.js les charge par import() à
// l'ouverture de l'écran qui les utilise, puis les précharge pendant les temps morts. Les chemins restent
// littéraux : test-static.mjs vérifie qu'ils figurent dans CORE de sw.js (fonctionnement hors connexion).
export const LAZY_MODULES = Object.freeze({
  // Gestion et économie
  costs: () => import('./costs-ui.js'),
  sales: () => import('./sales-ui.js'),
  herdEconomics: () => import('./herd-economics-ui.js'),
  herd: () => import('./herd-ui.js'), // n° 79 : troupeau bovin
  netMargin: () => import('./net-margin-ui.js'),
  treasury: () => import('./treasury-ui.js'), // n° 86
  cropMargins: () => import('./crop-margins-ui.js'),
  land: () => import('./land-ui.js'),
  claims: () => import('./claims-ui.js'),
  fuel: () => import('./fuel-ui.js'),
  machineCosts: () => import('./machine-costs-ui.js'),
  accountingExport: () => import('./accounting-export-ui.js'),
  campaignHistory: () => import('./campaign-history-ui.js'),
  forage: () => import('./forage-ui.js'),
  soilAnalysis: () => import('./soil-analysis-ui.js'),
  grainStock: () => import('./grain-stock-ui.js'),
  simulator: () => import('./simulator-ui.js'),
  stockCapture: () => import('./stock-capture-ui.js'),
  machineMission: () => import('./machine-mission-ui.js'),
  // Agronomie et réglementaire
  compliance: () => import('./compliance-ui.js'),
  nitrogen: () => import('./nitrogen-ui.js'),
  pac: () => import('./pac-ui.js'),
  covers: () => import('./covers-ui.js'),
  rotationAdvice: () => import('./rotation-advice-ui.js'),
  habits: () => import('./habits-ui.js'),
  telepac: () => import('./telepac-ui.js'),
  parcelCheck: () => import('./parcel-check-ui.js'),
  regulatedOps: () => import('./regulated-ops-ui.js'),
  greenIndicators: () => import('./green-indicators-ui.js'), // n° 71 : chiffres verts et auto-diagnostic HVE
  rpgOnboarding: () => import('./rpg-onboarding-ui.js'),
  seeds: () => import('./seeds-ui.js'),
  parcelComments: () => import('./parcel-comments-ui.js'), // n° 129 : commentaires et préconisations de parcelle
  // Compte, équipe et données
  settings: () => import('./settings-ui.js'),
  automations: () => import('./automations-ui.js'),
  techCenters: () => import('./tech-centers-ui.js'),
  teamRoles: () => import('./team-roles-ui.js'),
  messaging: () => import('./messaging-ui.js'), // v13 : messages, SMS, e-mail, planning du jour
  activityLog: () => import('./activity-ui.js'),
  trash: () => import('./trash-ui.js'),
  restore: () => import('./restore-ui.js'),
  backupVault: () => import('./backup-vault-ui.js'), // n° 4 : sauvegardes automatiques (dossier, instantané cloud)
  syncConflict: () => import('./sync-conflict-ui.js'),
  // Outils de carte, agenda et exports
  mapLayers: () => import('./map-layers-ui.js'),
  contourEdit: () => import('./contour-edit-ui.js'),
  walkMeasure: () => import('./walk-measure-ui.js'),
  parcelSplit: () => import('./parcel-split-ui.js'),
  ics: () => import('./ics-ui.js'),
  parcelFormats: () => import('./parcel-formats-ui.js'),
  yield: () => import('./yield-ui.js'),
  measuredYield: () => import('./measured-yield-ui.js'), // n° 90
  share: () => import('./share-ui.js'), // n° 19
  farmPlan: () => import('./farm-plan-ui.js'), // n° 54 : plan A4 imprimable
  dayReview: () => import('./day-review-ui.js'), // n° 105 : carte « Votre journée » après 17 h
  gloves: () => import('./gloves-ui.js'), // n° 21 : mode gants, chargé si la préférence est active
  here: () => import('./here-ui.js'), // n° 111 : « Vous êtes dans », chargé à la première position GPS
  voiceIntents: () => import('./voice-intents-ui.js'), // n° 13 : brouillons vocaux entretien, observation, sortie de stock, heures TP
  explain: () => import('./explain-ui.js'), // n° 110 : feuille « Pourquoi ? » des boutons (i)
  publicWorks: () => import('./public-works-ui.js'),
  fieldTracker: () => import('./field-tracker-ui.js'),
  fieldCoverage: () => import('./field-coverage-ui.js'),
  // n° 147 : formulaires Travail / Travail groupé, écrans Compte & équipe, Synchronisation et Diagnostic sortis d'app.js
  workForm: () => import('./work-form-ui.js'),
  account: () => import('./account-ui.js'),
  diagnostic: () => import('./diagnostic-ui.js'), // écran Santé de l’application
  // n° 147 : logique servie seulement à l’enregistrement ou à l’import (le graphe de démarrage ne grossit pas)
  mapRecords: () => import('./map-records.js'),
  integrations: () => import('./integrations.js'),
  measureLib: () => import('./walk-measure.js'), // périmètre de l’outil Mesurer de la carte
  treasuryLogic: () => import('./treasury.js'), // n° 88 : point bas de trésorerie de la carte « Ma campagne »
  // Imports, exports et sauvegardes complètes ; assistant
  importExport: () => import('./import-export.js'),
  historyImport: () => import('./history-import-ui.js'),
  shareTarget: () => import('./share-target-ui.js'),
  demoFarm: () => import('./demo-farm.js'),
  remoteAi: () => import('./remote-ai.js'),
  assistantRemote: () => import('./assistant-remote-ui.js'), // n° 104 : fiches de confirmation et aperçu « Ce que j’envoie »
  billingDocs: () => import('./billing-docs-ui.js'), // v13 : devis, factures, acomptes, avoirs, pro forma (éditeur et actions)
  intelligence: () => import('./intelligence.js'),
  billingHub: () => import('./billing-hub-ui.js') // v13 : centre Facturation (suivi, relances, catalogue, réglages)
});

// Actions du délégué de clics d'app.js dont le gestionnaire appelle un module différé : le clic est
// retenu, le module chargé, puis le clic rejoué (test-lazy-modules.mjs vérifie la liste dans app.js).
const actions = (keys, ...names) => names.map(name => [name, [].concat(keys)]);
export const LAZY_ACTIONS = Object.freeze(Object.fromEntries([
  ...actions('herdEconomics', 'open-herd-economics'),
  ...actions('herd', 'open-herd', 'open-herd-animal'),
  ...actions('netMargin', 'open-net-margin'),
  ...actions('treasury', 'open-treasury'),
  ...actions('cropMargins', 'open-crop-margins'),
  ...actions('land', 'open-land'),
  ...actions('claims', 'open-claims'),
  ...actions('fuel', 'open-fuel'),
  ...actions('machineCosts', 'open-machine-costs'),
  ...actions('accountingExport', 'open-accounting-export'),
  ...actions('campaignHistory', 'open-campaign-history'),
  ...actions('forage', 'open-forage'),
  ...actions('soilAnalysis', 'open-soil-analyses'),
  ...actions('grainStock', 'open-lot-sheet'),
  ...actions('simulator', 'open-simulator'),
  ...actions('stockCapture', 'stock-capture'),
  ...actions('machineMission', 'new-machine-mission'),
  ...actions('compliance', 'open-compliance'),
  ...actions('nitrogen', 'open-nitrogen'),
  ...actions('pac', 'open-pac'),
  ...actions('covers', 'open-covers'),
  ...actions('rotationAdvice', 'rotation-delays'),
  ...actions('telepac', 'open-telepac-import'),
  ...actions('parcelCheck', 'open-parcel-check'),
  ...actions('regulatedOps', 'open-regulated-ops'),
  ...actions('greenIndicators', 'open-green-indicators'),
  ...actions('rpgOnboarding', 'rpg-onboarding'),
  ...actions('seeds', 'open-seeds'),
  ...actions('settings', 'open-settings'),
  ...actions('techCenters', 'open-native', 'open-platform', 'platform-run-job', 'open-security', 'repair-text', 'open-integrations', 'open-integration-track'),
  ...actions('automations', 'open-automations', 'new-automation', 'edit-automation', 'add-automation-template', 'toggle-automation', 'delete-automation', 'toggle-automation-engine'),
  ...actions('teamRoles', 'open-team-roles'),
  ...actions('messaging', 'open-messages'),
  ...actions('trash', 'restore-trash', 'purge-trash'),
  ...actions('backupVault', 'open-backup-vault'),
  ...actions('historyImport', 'open-history-import'),
  ...actions('mapLayers', 'open-map-layers'),
  ...actions('contourEdit', 'edit-contour'),
  ...actions('walkMeasure', 'walk-measure'),
  ...actions('parcelSplit', 'split-parcel', 'map-multiple-merge'),
  ...actions('ics', 'ics-work', 'ics-task', 'open-ics-agenda', 'ics-export-30', 'ics-enable-reminders'),
  ...actions('parcelFormats', 'export-parcels-format'),
  ...actions('publicWorks', 'open-public-works'),
  ...actions('demoFarm', 'open-demo'),
  ...actions('fieldCoverage', 'field-track-map', 'field-track-gpx'),
  ...actions('importExport', 'export-work-csv', 'export-geojson', 'export-parcels-csv'),
  ...actions('billingHub', 'open-invoices', 'new-invoice')
]));

// Boutons traités par l'écouteur propre d'un module différé mais affichés par un module chargé au
// démarrage (carte de campagne de l’accueil, légende de la carte n° 90, boutons Partager n° 19, Imprimer un plan n° 54,
// boutons Messages v13 : « Envoyer le planning », « Envoyer la consigne », commentaires de parcelle n° 129) : même traitement que les actions ci-dessus.
export const LAZY_TRIGGERS = Object.freeze({'[data-cost]': 'costs', '[data-my]': 'measuredYield', '[data-share]': 'share', '[data-explain]': 'explain', '[data-plan]': 'farmPlan', '[data-msg]': 'messaging', '[data-bdoc]': 'billingDocs', '[data-pc]': 'parcelComments'});

const keyList = keys => [].concat(keys ?? []).filter(Boolean);
// Chemin littéral d'un module différé, lu dans sa fonction d'import (nouvelle tentative après un échec).
export const lazyPath = key => String(LAZY_MODULES[key]).match(/import\('([^']+)'\)/)?.[1] || null;

// Chargeur mémoïsé : une promesse par module ; un échec est oublié pour permettre de réessayer.
// progress(label) renvoie {finish({error})} (barre d'activité affichée au-delà de 150 ms) ;
// onError(error, keys, {retried}) traduit l'échec pour la personne (toast).
// Chromium garde en mémoire l'échec d'un import() : retry(key, attempt) importe alors une autre adresse
// du même fichier (paramètre ?essai=n, ignoré par le cache hors connexion de sw.js).
export function createModuleLoader(importers, {actions: actionMap = {}, triggers = {}, progress, onError, retry = null, warn = console.warn} = {}) {
  const modules = new Map(), pending = new Map(), setups = new Map(), failed = new Set(), attempts = new Map();
  const check = key => { if (typeof importers[key] !== 'function') throw new Error(`Module différé inconnu : ${key}`); };
  const ready = keys => keyList(keys).every(key => modules.has(key));

  function load(key) {
    check(key);
    if (modules.has(key)) return Promise.resolve(modules.get(key));
    if (!pending.has(key)) {
      const attempt = attempts.get(key) || 0;
      attempts.set(key, attempt + 1);
      pending.set(key, Promise.resolve().then(() => attempt && retry ? retry(key, attempt) : importers[key]()).then(mod => {
        for (const setup of setups.get(key) || []) setup(mod);
        setups.delete(key); modules.set(key, mod); failed.delete(key); pending.delete(key);
        return mod;
      }, error => { pending.delete(key); failed.add(key); throw error; }));
    }
    return pending.get(key);
  }

  // Charge les modules ; renvoie true quand ils sont prêts, false après un échec (déjà signalé).
  async function need(keys, {silent = false, label = 'Ouverture…'} = {}) {
    const list = keyList(keys);
    if (ready(list)) return true;
    const bar = silent ? null : progress?.(label);
    try { await Promise.all(list.map(load)); bar?.finish(); return true; }
    catch (error) {
      bar?.finish({error: true});
      if (silent) warn?.('[Parcelles] module différé indisponible', list.join(', '), error);
      else onError?.(error, list, {retried: list.some(key => (attempts.get(key) || 0) > 1)});
      return false;
    }
  }

  return {
    ready, load, need,
    get: key => modules.get(key) || null,
    // Fonction de création appelée une fois, à l'arrivée du module (tout de suite s'il est déjà là).
    onLoad(key, setup) { check(key); if (modules.has(key)) setup(modules.get(key)); else setups.set(key, [...(setups.get(key) || []), setup]); },
    // Exécute fn tout de suite si les modules sont prêts, sinon après leur chargement.
    run(keys, fn) { return ready(keys) ? fn() : need(keys).then(ok => ok ? fn() : undefined); },
    // Ouverture d'écran : true si les modules manquent ; retry() est rappelé quand ils arrivent.
    wait(keys, retry) { if (ready(keys)) return false; need(keys).then(ok => { if (ok) retry?.(); }); return true; },
    // Section d'un écran déjà affiché : même principe, sans relancer en boucle un chargement qui a échoué.
    soon(keys, rerender) {
      if (ready(keys)) return false;
      const list = keyList(keys);
      if (!list.some(key => failed.has(key))) need(list, {label: 'Chargement…'}).then(ok => { if (ok) rerender?.(); });
      return true;
    },
    // Retient un clic qui a besoin d'un module absent, le charge puis rejoue le clic. Si le bouton a
    // disparu entre-temps (écran redessiné, menu refermé), une copie invisible porte le clic.
    gateClicks(root, body = root.body) {
      root.addEventListener('click', event => {
        const target = event.target;
        if (!target?.closest) return;
        let control = target.closest('[data-action]'), keys = control && actionMap[control.dataset.action];
        if (!keys) for (const [selector, key] of Object.entries(triggers)) { const found = target.closest(selector); if (found) { control = found; keys = key; break; } }
        if (!keys || ready(keys)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (control.dataset.lazyLoading) return;
        control.dataset.lazyLoading = '1'; control.setAttribute('aria-busy', 'true');
        need(keys).then(ok => {
          delete control.dataset.lazyLoading; control.removeAttribute('aria-busy');
          if (!ok) return;
          if (control.isConnected) { control.click(); return; }
          if (!body) return;
          const copy = control.cloneNode(false); copy.hidden = true; body.append(copy);
          try { copy.click(); } finally { copy.remove(); }
        });
      }, true);
    },
    // Préchargement pendant les temps morts, un module à la fois, sans indicateur ni message.
    prefetch(keys, {delay = 10000, idle = globalThis.requestIdleCallback} = {}) {
      const list = keyList(keys);
      const pause = () => new Promise(resolve => idle ? idle(() => resolve(), {timeout: 3000}) : setTimeout(resolve, 200));
      return new Promise(resolve => setTimeout(resolve, delay)).then(async () => {
        for (const key of list) {
          if (modules.has(key)) continue;
          await pause();
          await load(key).catch(error => warn?.('[Parcelles] préchargement impossible', key, error));
        }
      });
    }
  };
}

// Nouvelle tentative après un échec (vague 9) : Chromium garde aussi l'échec de chaque dépendance
// (./fuel.js de fuel-ui.js). Les dépendances statiques encore en échec sont repérées en les important
// (un module déjà chargé répond tout de suite, sans doublon) puis redemandées sous une autre adresse
// grâce à une import map limitée à l'adresse ?essai=n de leur importateur. Les import() dynamiques
// ne font pas partie du graphe et ne sont pas sondés. Sans import map dynamique (navigateur ancien),
// la tentative échoue comme avant et le message propose de recharger.
let retrySeq = 0;
const STATIC_IMPORT = /(?:\bfrom|^\s*import)\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
const readSource = url => fetch(url).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); });
export async function retryImport(entry, {load = url => import(url), source = readSource, addMap = null} = {}) {
  const tag = url => `${url}${url.includes('?') ? '&' : '?'}essai=${++retrySeq}`;
  const scopes = {}, fresh = new Map(); // dépendance -> nouvelle adresse (null si elle se charge)
  async function remap(url, tagged) {
    const text = await source(url).catch(() => '');
    for (const [, specifier] of text.matchAll(STATIC_IMPORT)) {
      const dep = new URL(specifier, url).href;
      if (!fresh.has(dep)) {
        const ok = await load(dep).then(() => true, () => false);
        fresh.set(dep, ok ? null : tag(dep));
        if (!ok) await remap(dep, fresh.get(dep));
      }
      if (fresh.get(dep)) (scopes[tagged] ||= {})[dep] = fresh.get(dep);
    }
  }
  const target = tag(entry);
  await remap(entry, target);
  if (Object.keys(scopes).length) addMap?.({scopes});
  return load(target);
}
function addImportMap(map) {
  const script = document.createElement('script');
  script.type = 'importmap'; script.textContent = JSON.stringify(map);
  document.head.append(script);
}

// Chargeur d'app.js : barre d'activité au-delà de 150 ms, échec traduit en toast, clics retenus,
// préchargement de tous les modules.
export function createAppLoader({startProgress, toast}) {
  const loader = createModuleLoader(LAZY_MODULES, {
    actions: LAZY_ACTIONS, triggers: LAZY_TRIGGERS,
    progress: label => startProgress(label, {delay: 150}),
    retry: key => retryImport(new URL(lazyPath(key), import.meta.url).href, {addMap: globalThis.document ? addImportMap : null}),
    onError: (error, keys, {retried} = {}) => toast(retried ? 'Cet écran n’a toujours pas pu être chargé. Rechargez Parcelles une fois la connexion revenue.' : 'Cet écran n’a pas pu être chargé. Vérifiez la connexion, puis réessayez.', 'error', retried && globalThis.location ? {label: 'Recharger', run: () => location.reload()} : undefined)
  });
  if (globalThis.document) loader.gateClicks(document); // clics retenus avant le délégué d'app.js (phase de capture)
  return {...loader, prefetch: (keys = Object.keys(LAZY_MODULES), options) => loader.prefetch(keys, options)};
}
