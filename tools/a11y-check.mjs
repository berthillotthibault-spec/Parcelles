// Accessibilité automatisée (n° 154) : axe-core sur chaque vue principale et les fenêtres les plus courantes,
// en clair et en sombre, sur ordinateur et sur mobile. Profil vierge semé d'un petit jeu de données fictives,
// service worker bloqué, aucune requête hors du serveur local.
// Règles : wcag2a, wcag2aa, wcag21aa. Échoue (code 1) sur toute violation « serious » ou « critical ».
// Usage : npm run a11y                     (port libre, ou PORT=8340 npm run a11y)
//         npm run a11y -- --all            affiche aussi les violations « minor » / « moderate »
//         npm run a11y -- --only=travaux   limite aux vues/fenêtres dont le nom contient ce texte
import {chromium, devices} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {startStaticServer} from './static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const args = process.argv.slice(2);
const SHOW_ALL = args.includes('--all');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).toLowerCase();
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];
export const BLOCKING = new Set(['serious', 'critical']);

// Vues : bouton de navigation (data-view) ou fonction d'ouverture évaluée dans la page.
const VIEWS = [
  {name: 'Aujourd’hui', view: 'today'},
  {name: 'Carte', view: 'map'},
  {name: 'Parcelles', view: 'parcels'},
  {name: 'Troupeau', view: 'herd'},
  {name: 'Travaux', view: 'work'},
  {name: 'Plus', view: 'more'},
  {name: 'Fiche parcelle', open: () => document.querySelector('#parcel-list [data-action="open-parcel"],[data-action="open-parcel"]')?.click(), view: 'parcels', wait: '#view-parcel.active'}
];
// Fenêtres : action déléguée (data-action) déclenchée par un bouton fantôme, comme un vrai clic.
const MODALS = [
  {name: 'Recherche', action: 'global-search'},
  {name: 'Nouveau travail', action: 'new-work'},
  {name: 'Nouvelle parcelle', action: 'new-parcel'},
  {name: 'Réglages', action: 'open-settings'},
  {name: 'Nouvelle tâche', action: 'new-task'},
  {name: 'Modifier un travail', action: 'edit-work', id: 'w1'},
  {name: 'Nouvelle observation', action: 'new-observation'},
  {name: 'Synchronisation', action: 'open-sync'},
  {name: 'Stocks', action: 'open-stock'},
  {name: 'Matériel', action: 'open-equipment'},
  {name: 'Couches de la carte', action: 'open-map-layers', view: 'map'},
  {name: 'Notifications', action: 'open-notifications'},
  {name: 'Personnaliser', action: 'personalize'},
  // Messages (v13, module différé) : boutons [data-msg] retenus puis rejoués une fois le module chargé.
  {name: 'Messages & SMS', action: 'open-messages'},
  {name: 'Nouveau message', msg: 'compose'},
  {name: 'Envoyer le planning', msg: 'plan'},
  {name: 'Nouveau contact', msg: 'contact-new'},
  {name: 'Modèle de message', msg: 'template', key: 'planning-jour'},
  // Documents de facturation (v13, module différé) : boutons [data-bdoc] retenus puis rejoués une fois le module chargé.
  {name: 'Documents de facturation', data: {bdoc: 'list', type: 'facture'}},
  {name: 'Nouveau devis', data: {bdoc: 'new', type: 'devis'}},
  {name: 'Nouvelle facture', data: {bdoc: 'new', type: 'facture'}},
  {name: 'Nouveau client (facturation)', data: {bdoc: 'client-new'}},
  // Facturation (v13, module différé « billingHub ») : onglets, formulaires et sections des réglages.
  ...['suivi', 'afaire', 'clients', 'clients:c1', 'catalogue', 'catalogue:nouveau', 'recurrences', 'recurrences:nouveau', ...['identite', 'tva', 'banque', 'numerotation', 'conditions', 'relances', 'messages', 'modele', 'accueil'].map(x => `reglages:${x}`)]
    .map(id => ({name: `Facturation ${id}`, action: 'open-invoices', id})),
  {name: 'Fiche client (facturation)', action: 'open-client-detail', id: 'c1'}
];
const CONFIGS = [
  {name: 'ordinateur clair', device: {viewport: {width: 1280, height: 860}}, colorScheme: 'light'},
  {name: 'ordinateur sombre', device: {viewport: {width: 1280, height: 860}}, colorScheme: 'dark'},
  {name: 'mobile clair', device: devices['iPhone 14'], colorScheme: 'light'},
  {name: 'mobile sombre', device: devices['iPhone 14'], colorScheme: 'dark'}
];

async function seed(page) {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init(); if (s.state.parcelles.length) return;
    const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d * 0.7], [x, y + d * 0.7], [x, y]]]});
    const today = new Date().toISOString().slice(0, 10);
    await s.setPreferences({onboardingComplete: true});
    for (const [id, nom, culture, surfaceHa, x] of [['p1', 'Les Noues', 'Blé tendre', 11.3, 5.13], ['p2', 'Grand Champ', 'Maïs grain', 8.2, 5.136], ['p3', 'Le Pré Bas', 'Prairie permanente', 4.6, 5.142]])
      await s.upsert('parcelles', {id, nom, culture, surfaceHa, geometry: sq(x, 46.34)});
    await s.upsert('interventions', {id: 'w1', parcelId: 'p2', type: 'Récolte maïs', date: today, plannedDate: today, status: 'À faire'});
    await s.upsert('interventions', {id: 'w2', parcelId: 'p1', type: 'Semis', date: today, status: 'Terminé'});
    await s.upsert('tasks', {id: 't1', title: 'Réparer clôture', parcelId: 'p3', dueDate: today, status: 'À faire'});
    // Facturation (v13) : réglages, clients, factures émises (payée, en retard), devis, catalogue, récurrence due.
    const inv = await import('./invoices.js'), bil = await import('./billing.js'), D = n => inv.isoDay(new Date(Date.now() + n * 864e5));
    await inv.saveSettings(s, {legalName: 'EARL du Sougey', legalForm: 'EARL', address: '1 route du Sougey\n01340 Montrevel', siret: '73282932000074', vatNumber: 'FR12732829320', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP', paymentDays: 30, vatRate: 20, prefix: 'F'});
    await s.upsertMany('clients', [{id: 'c1', name: 'GAEC du Bois', address: 'Le Bois\n01000 Bourg-en-Bresse', email: 'gaec@exemple.fr', phone: '06 12 34 56 78', kind: 'pro', siren: '732829320'}, {id: 'c2', name: 'Mme Durand', address: '3 rue Haute\n01340 Foissiat', kind: 'particulier'}]);
    for (const [clientId, days, label, quantity, unitPrice, paid] of [['c1', -120, 'Labour', 10, 65, true], ['c1', -70, 'Pressage', 8, 50, false], ['c2', -45, 'Fauche', 4, 50, false], ['c1', -5, 'Transport', 10, 100, false]]) {
      const d = await inv.createDraft(s, {clientId, lines: [{label, quantity, unit: 'h', unitPrice, vatRate: 20}], today: D(days)});
      const e = await inv.emitDocument(s, d.id, {today: D(days)});
      if (paid) await inv.addPayment(s, e.id, {date: D(days + 20), amount: e.totals.ttc, method: 'virement'});
    }
    const q = await inv.createDraft(s, {clientId: 'c2', docType: 'devis', lines: [{label: 'Terrassement', quantity: 20, unit: 'h', unitPrice: 70, vatRate: 20}], today: D(-20)});
    await inv.emitDocument(s, q.id, {today: D(-20)});
    await bil.saveCatalogItem(s, {code: 'PELLE', label: 'Pelle mécanique', unit: 'h', unitPrice: 65, vatRate: 20, category: 'Terrassement'});
    await bil.saveSchedule(s, {clientId: 'c2', label: 'Pension des génisses', frequency: 'mensuel', nextDate: D(-3), lines: [{label: 'Pension', quantity: 10, unit: 'u', unitPrice: 30, vatRate: 10}]});
  });
}

const settle = page => page.waitForTimeout(450);
async function analyze(page, include) {
  await page.evaluate(AXE);
  return page.evaluate(async ({include: target, tags}) => {
    const result = await window.axe.run(target ? {include: [target]} : document, {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations']});
    return result.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map(n => ({target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(1, 3).join(' ').trim()})), count: v.nodes.length}));
  }, {include, tags: TAGS});
}

async function goView(page, view) {
  await page.evaluate(v => { const b = document.querySelector(`[data-view="${v}"]`); b?.click(); }, view);
  await settle(page);
}

async function closeAnyModal(page) {
  await page.evaluate(() => { document.querySelector('.why-dialog[open] [data-why-close]')?.click(); document.querySelector('#modal-root .modal-close')?.click(); });
  await settle(page);
}

async function checkConfig(browser, origin, config) {
  const ctx = await browser.newContext({...config.device, colorScheme: config.colorScheme, reducedMotion: 'reduce', locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block'});
  await ctx.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = `${origin}/index.html`;
  await page.goto(url, {waitUntil: 'load'});
  // Semis après le démarrage : l'application n'écrit plus pendant que le jeu de données s'enregistre.
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 60000}).catch(() => {});
  await page.waitForTimeout(500);
  await seed(page);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 60000});
  await page.waitForTimeout(800);
  await closeAnyModal(page); // « Quoi de neuf » ou autre fenêtre d'accueil éventuelle
  const results = [];
  for (const v of VIEWS) {
    if (ONLY && !v.name.toLowerCase().includes(ONLY)) continue;
    await goView(page, v.view);
    if (v.open) { await page.evaluate(v.open); await settle(page); }
    results.push({config: config.name, target: `vue ${v.name}`, violations: await analyze(page, null)});
  }
  for (const m of MODALS) {
    if (ONLY && !m.name.toLowerCase().includes(ONLY)) continue;
    await goView(page, m.view || 'today');
    await page.evaluate(({action, msg, id, key, data}) => { const b = document.createElement('button'); b.type = 'button'; if (action) b.dataset.action = action; if (msg) b.dataset.msg = msg; if (id) b.dataset.id = id; if (key) b.dataset.key = key; Object.assign(b.dataset, data || {}); b.hidden = true; document.body.append(b); b.click(); b.remove(); }, m);
    // n° 154 : la fenêtre est le <dialog> #modal-root ouvert avec showModal().
    const opened = await page.waitForFunction(() => { const d = document.querySelector('#modal-root'); return d?.classList.contains('has-modal') && d.open && d.matches(':modal'); }, null, {timeout: 8000}).then(() => true, () => false);
    if (!opened) { results.push({config: config.name, target: `fenêtre ${m.name}`, violations: [], error: 'non ouverte'}); continue; }
    await settle(page);
    results.push({config: config.name, target: `fenêtre ${m.name}`, violations: await analyze(page, '#modal-root')});
    await closeAnyModal(page);
  }
  // Feuille « Pourquoi ? » (explain-ui.js, <dialog> séparé) ouverte depuis l’accueil si un bouton existe.
  if (!ONLY || 'pourquoi'.includes(ONLY)) {
    await goView(page, 'today');
    const why = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-explain]')].find(x => x.getClientRects().length); b?.click(); return Boolean(b); });
    if (why && await page.waitForSelector('.why-dialog[open]', {timeout: 4000}).then(() => true, () => false)) {
      await settle(page);
      results.push({config: config.name, target: 'feuille Pourquoi ?', violations: await analyze(page, '.why-dialog')});
      await closeAnyModal(page);
    }
  }
  await ctx.close();
  return {results, errors};
}

export async function run() {
  const server = await startStaticServer(root);
  const browser = await chromium.launch();
  let blocking = 0, notOpened = 0;
  const pageErrors = new Set();
  try {
    for (const config of CONFIGS) {
      const {results, errors} = await checkConfig(browser, server.origin, config);
      errors.forEach(e => pageErrors.add(e));
      for (const r of results) {
        if (r.error) { notOpened++; console.log(`! ${r.config} · ${r.target} : ${r.error}`); continue; }
        const shown = r.violations.filter(v => SHOW_ALL || BLOCKING.has(v.impact));
        const serious = r.violations.filter(v => BLOCKING.has(v.impact));
        blocking += serious.length;
        console.log(`${serious.length ? 'ÉCHEC' : 'OK   '} ${r.config} · ${r.target}${r.violations.length - serious.length ? ` (${r.violations.length - serious.length} mineure(s))` : ''}`);
        for (const v of shown) {
          console.log(`  - [${v.impact}] ${v.id} : ${v.help} (${v.count} élément(s))`);
          for (const n of v.nodes) console.log(`      ${n.target}${n.summary ? ` · ${n.summary}` : ''}`);
        }
      }
    }
  } finally { await browser.close(); await server.close(); }
  if (pageErrors.size) console.log(`\nErreurs JavaScript pendant l’audit :\n${[...pageErrors].map(e => `  - ${e}`).join('\n')}`);
  console.log(blocking ? `\n${blocking} violation(s) « serious »/« critical » à corriger.` : '\nAucune violation « serious »/« critical ».');
  return blocking || notOpened ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run();
