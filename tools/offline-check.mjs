// Contrôle du service worker hors connexion (n° 149), dans un profil de navigateur vierge.
// Usage : npm run offline-check   (démarre son propre petit serveur statique sur un port libre)
// Étapes : précache complet de CORE, passage hors ligne et rechargement, 5 onglets, création d'un travail
// hors ligne (présent dans la file de synchronisation), puis nouveau BUILD servi par une route :
// l'invite « Mettre à jour » apparaît et l'activation recharge une seule version (page, modules, SW, cache).
import {chromium, devices} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startStaticServer} from './static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const BUILD = sw.match(/const BUILD='([^']+)'/)[1];
const CORE = [...sw.match(/const CORE=\[([\s\S]*?)\];/)[1].matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);
const NEXT = `${BUILD}-essai`;
const VIEWS = ['today', 'map', 'parcels', 'herd', 'work']; // n° 160 : « Plus » est devenu le menu profil (feuille, pas une vue)

// Le serveur intégré « publie » le nouveau BUILD : la vérification de mise à jour du service worker
// (registration.update) ne passe pas par les routes Playwright.
let newRelease = false;
const server = await startStaticServer(root, {rewrite: (rel, body) => newRelease && ['sw.js', 'index.html', 'utils.js'].includes(rel) ? body.toString('utf8').replaceAll(BUILD, NEXT) : null});
const {origin, url: URL_} = server;

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({name, ok: true, detail: detail || '', ms: Date.now() - t0}); }
  catch (error) { results.push({name, ok: false, detail: error.message.split('\n')[0], ms: Date.now() - t0}); throw error; }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({...devices['iPhone 14'], locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'allow'});
const errors = [];
// Réseau externe coupé (tuiles, météo, Firebase).
await ctx.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text()) && errors.push(`console: ${m.text()}`));
page.on('dialog', d => { errors.push(`dialogue natif : ${d.message()}`); d.dismiss(); });

const appReady = async () => {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important}'}).catch(() => {});
  await page.locator('#install-sheet button').filter({hasText: /Plus tard|Fermer|Non merci/}).first().click({timeout: 800}).catch(() => {});
};
const staticCache = build => page.evaluate(async build => {
  const keys = await caches.keys();
  const name = keys.find(k => k.endsWith(`static-${build}`));
  return {name, keys, entries: name ? (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname) : []};
}, build);
const persistedQueue = () => page.evaluate(async () => {
  const {StorageService} = await import('./storage.js');
  const st = new StorageService(); await st.init();
  // n° 137 : l'état est rangé sous 'state/meta' et 'state/c/*' ; readState le recompose (ancienne forme en repli).
  const data = (await st.readState('state')).value;
  return {queue: data?.queue || [], works: data?.interventions || []};
});

try {
  await step('premier chargement en ligne', async () => {
    await page.goto(URL_, {waitUntil: 'load'});
    await page.evaluate(async () => {
      const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
      const s = new Store(new StorageService()); await s.init(); if (s.state.parcelles.length) return;
      // La file de synchronisation n'est alimentée que si la synchronisation est activée.
      await s.mutate('Essai hors ligne', state => { state.preferences.syncEnabled = true; }, {queue: false});
      await s.upsert('parcelles', {id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 11.3, geometry: {type: 'Polygon', coordinates: [[[5.13, 46.34], [5.134, 46.34], [5.134, 46.343], [5.13, 46.343], [5.13, 46.34]]]}});
    });
    await page.reload({waitUntil: 'load'});
    await appReady();
  });

  await step('tout CORE est en cache', async () => {
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, {timeout: 30000}).catch(async () => { await page.reload({waitUntil: 'load'}); await appReady(); });
    const base = new URL('./', URL_).pathname;
    const expected = CORE.map(p => new URL(p, `${origin}${base}`).pathname);
    let missing = expected;
    for (let i = 0; i < 60 && missing.length; i++) {
      const {entries} = await staticCache(BUILD);
      missing = expected.filter(p => !entries.includes(p));
      if (missing.length) await page.waitForTimeout(500);
    }
    if (missing.length) throw new Error(`absents du cache : ${missing.slice(0, 8).join(', ')}`);
    return `${expected.length} fichiers`;
  });

  await step('rechargement hors connexion', async () => {
    await ctx.setOffline(true);
    await page.reload({waitUntil: 'load'});
    await appReady();
    if (await page.evaluate(() => navigator.onLine)) throw new Error('le navigateur se croit en ligne');
  });

  await step('les vues principales hors connexion', async () => {
    for (const view of VIEWS) {
      await page.evaluate(v => document.querySelector(`button[data-view="${v}"]`)?.click(), view); // n° 160 : Planning et modules hors de la barre du bas
      await page.waitForFunction(v => document.documentElement.dataset.view === v, view, {timeout: 5000})
        .catch(async () => { throw new Error(`onglet ${view} non affiché (vue ${await page.evaluate(() => document.documentElement.dataset.view)})`); });
    }
    return VIEWS.join(', ');
  });

  await step('travail créé hors ligne et mis en file de synchronisation', async () => {
    await page.evaluate(() => document.querySelector('button[data-view="work"]')?.click());
    await page.locator('[data-action="new-work"]:visible').first().click();
    // n° 160 : saisie en 3 étapes ; « Autre… » donne un type libre.
    const sheet = page.locator('#modal-root .qw');
    await sheet.waitFor({timeout: 5000});
    await sheet.locator('[data-qw="more"]').click();
    await sheet.locator('#qw-custom-type').fill('Essai hors ligne');
    await sheet.locator('[data-qw="custom-type"]').click();
    await sheet.locator('.qw-parcel').first().click();
    await sheet.locator('[data-qw="next"]').click();
    await sheet.locator('[data-qw="next"]').click();
    await sheet.waitFor({state: 'detached', timeout: 5000});
    let saved;
    for (let i = 0; i < 20; i++) { saved = await persistedQueue(); if (saved.works.some(w => w.type === 'Essai hors ligne')) break; await page.waitForTimeout(250); }
    const work = saved.works.find(w => w.type === 'Essai hors ligne');
    if (!work) throw new Error('travail absent de la base');
    const queued = saved.queue.find(q => q.entityId === work.id && ['pending', 'error'].includes(q.status));
    if (!queued) throw new Error('travail absent de la file de synchronisation');
    return `file : ${saved.queue.length} opération(s)`;
  });

  await step('nouveau BUILD : invite « Mettre à jour »', async () => {
    await ctx.setOffline(false);
    newRelease = true;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await page.locator('#toast-root button', {hasText: 'Mettre à jour'}).waitFor({timeout: 30000});
  });

  await step('activation sans mélange de versions', async () => {
    const reloaded = page.waitForEvent('load', {timeout: 30000});
    await page.locator('#toast-root button', {hasText: 'Mettre à jour'}).click();
    await reloaded;
    await appReady();
    const seen = await page.evaluate(async () => {
      const meta = document.querySelector('meta[name="parcelles-build"]')?.content;
      const {BUILD_ID} = await import('./utils.js');
      const swBuild = await new Promise(resolve => {
        const channel = new MessageChannel(); channel.port1.onmessage = e => resolve(e.data?.build);
        navigator.serviceWorker.controller.postMessage({type: 'GET_STATUS'}, [channel.port2]);
        setTimeout(() => resolve(null), 3000);
      });
      return {meta, BUILD_ID, swBuild};
    });
    for (const [k, v] of Object.entries(seen)) if (v !== NEXT) throw new Error(`${k} = ${v}, attendu ${NEXT}`);
    const {keys} = await staticCache(NEXT);
    if (keys.some(k => k.endsWith(`static-${BUILD}`))) throw new Error('ancien cache statique non supprimé');
    const {works} = await persistedQueue();
    if (!works.some(w => w.type === 'Essai hors ligne')) throw new Error('travail hors ligne perdu après la mise à jour');
    return `page, modules et SW en ${NEXT}`;
  });

  await step('aucune erreur console', async () => { if (errors.length) throw new Error(errors.slice(0, 3).join(' | ')); });
} catch {}
await browser.close();
await server.close();

console.log(`\n| Étape | Résultat | Détail | Durée |\n|---|---|---|---|`);
for (const r of results) console.log(`| ${r.name} | ${r.ok ? 'OK' : 'KO'} | ${r.detail.replaceAll('|', '/')} | ${(r.ms / 1000).toFixed(1)} s |`);
if (errors.length) console.log(`\nErreurs console :\n${errors.map(e => `- ${e}`).join('\n')}`);
const ok = results.length === 8 && results.every(r => r.ok);
console.log(ok ? '\nHors connexion : OK' : '\nHors connexion : KO');
process.exitCode = ok ? 0 : 1;
