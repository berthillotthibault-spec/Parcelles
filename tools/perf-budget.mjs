// Budget de performance (n° 150) : médiane de 3 chargements à froid, profil vierge avec un petit jeu de données.
// Conditions : iPhone 14, processeur ralenti ×4 (CDP), réseau « Fast 3G » (562,5 ms, 1,44 Mbit/s).
// Fichiers servis en gzip comme sur GitHub Pages (static-server.mjs). Limite connue : le serveur local parle HTTP/1.1
// (6 connexions par hôte) quand Pages sert en HTTP/2 ; avec ~220 modules, appReadyMs reste très pessimiste (≈ 27 s ici,
// dont l'essentiel en files d'attente de connexions). C'est un garde-fou de régression, pas le temps vécu. Démarrage
// depuis le cache (appli installée), processeur ×4 : ≈ 0,3 s jusqu'à appReady le 2026-11-14.
// Usage : npm run perf                 compare à perf-budget.json, tableau Markdown, code 1 si dépassement
//         npm run perf -- --update     réécrit perf-budget.json (valeurs mesurées + 5 %)
//         npm run perf -- --runs 5     nombre de chargements (3 par défaut)
//         npm run perf -- --measured   rafraîchit seulement la section « measured » (budgets inchangés)
// En CI (variable GITHUB_STEP_SUMMARY), le tableau est aussi ajouté au résumé de la GitHub Action.
// Couverture JS inutilisée au démarrage (CDP Profiler.startPreciseCoverage) : un chargement de plus, sans
// ralentissement, car le profilage fausserait le temps mesuré. Elle est rapportée, jamais bloquante.
import {chromium, devices} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startStaticServer} from './static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(root, 'perf-budget.json');
const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const MEASURED_ONLY = args.includes('--measured');
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 3;
const FAST_3G = {offline: false, latency: 562.5, downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8 * 0.9), uploadThroughput: Math.round(750 * 1024 / 8 * 0.9)};
const LONG_TASK_MS = 200;

export const METRICS = {
  appReadyMs: {label: 'Temps jusqu’à appReady', unit: 'ms'},
  initialJsBytes: {label: 'Octets JS initiaux', unit: 'o'},
  longTasks: {label: `Tâches longues > ${LONG_TASK_MS} ms`, unit: ''},
  appJsBytes: {label: 'Taille d’app.js', unit: 'o'}
};
export const median = values => { const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Seuil = valeur actuelle + 5 %, arrondi au supérieur. Exception : on tolère toujours une tâche longue,
// sinon un seul blocage aléatoire de la machine de mesure ferait échouer un budget mesuré à 0.
export const budgetFrom = measured => Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, k === 'longTasks' ? Math.max(1, Math.ceil(v * 1.05)) : Math.ceil(v * 1.05)]));
const fmt = (v, unit) => unit === 'o' ? `${(v / 1024).toFixed(1)} Kio` : unit === 'ms' ? `${Math.round(v)} ms` : String(v);
export function markdownTable(measured, budget) {
  const rows = Object.entries(METRICS).map(([k, {label, unit}]) => {
    const limit = budget?.[k];
    const ok = limit == null || measured[k] <= limit;
    return `| ${label} | ${fmt(measured[k], unit)} | ${limit == null ? '—' : fmt(limit, unit)} | ${ok ? 'OK' : 'DÉPASSÉ'} |`;
  });
  const lines = ['| Mesure | Médiane | Budget | État |', '|---|---|---|---|', ...rows];
  if (measured.unusedJsBytes != null) lines.push(`| JS inutilisé au démarrage | ${fmt(measured.unusedJsBytes, 'o')} (${measured.unusedJsPercent} %) | — | rapporté |`);
  return lines.join('\n');
}

// Octets jamais exécutés d'un script, d'après ses plages de couverture précise (detailed: true).
// Les plages sont imbriquées : la plus large d'abord, chaque plage intérieure repeint son compteur.
export function unusedBytes(functions) {
  const ranges = functions.flatMap(f => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const length = ranges.reduce((n, r) => Math.max(n, r.endOffset), 0);
  const used = new Uint8Array(length);
  for (const r of ranges) used.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
  return {length, unused: used.reduce((n, v) => n + (v ? 0 : 1), 0)};
}

async function measureOnce(browser, url, {coverage = false} = {}) {
  const ctx = await browser.newContext({...devices['iPhone 14'], locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block'});
  const origin = new URL(url).origin;
  await ctx.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await ctx.addInitScript(longTaskMs => {
    window.__perf = {longTasks: [], appReadyAt: 0};
    // PerformanceObserver('longtask') ne remonte rien en Chromium sans interface : on mesure les blocages
    // du fil principal par l'écart entre deux minuteries de 16 ms (un écart > 200 ms = une tâche longue).
    let last = performance.now();
    const tick = () => { const now = performance.now(); if (now - last - 16 > longTaskMs) window.__perf.longTasks.push(now - last - 16); last = now; if (!window.__perf.stop) setTimeout(tick, 16); };
    setTimeout(tick, 16);
    new MutationObserver((_, obs) => { if (document.documentElement.dataset.appReady === '1') { window.__perf.appReadyAt = performance.now(); obs.disconnect(); } })
      .observe(document, {attributes: true, subtree: true, attributeFilter: ['data-app-ready']}); // <html> n'existe pas encore ici
    window.__perf.longTaskMs = longTaskMs;
  }, LONG_TASK_MS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Données semées sans ralentissement, puis chargement mesuré à froid.
  await page.goto(url, {waitUntil: 'load'});
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init(); if (s.state.parcelles.length) return;
    const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d * 0.7], [x, y + d * 0.7], [x, y]]]});
    const today = new Date().toISOString().slice(0, 10);
    for (const [id, nom, culture, surfaceHa, x] of [['p1', 'Les Noues', 'Blé tendre', 11.3, 5.13], ['p2', 'Grand Champ', 'Maïs grain', 8.2, 5.136], ['p3', 'Le Pré Bas', 'Prairie permanente', 4.6, 5.142]])
      await s.upsert('parcelles', {id, nom, culture, surfaceHa, geometry: sq(x, 46.34)});
    await s.upsert('interventions', {id: 'w1', parcelId: 'p2', type: 'Récolte maïs', date: today, plannedDate: today, status: 'À faire'});
    await s.upsert('tasks', {id: 't1', title: 'Réparer clôture', parcelId: 'p3', dueDate: today, status: 'À faire'});
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  if (coverage) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', {callCount: false, detailed: true});
  } else {
    await cdp.send('Network.emulateNetworkConditions', FAST_3G);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
  }
  await page.reload({waitUntil: 'load', timeout: 180000});
  for (let waited = 0; !(await page.evaluate(() => window.__perf?.appReadyAt > 0)); waited += 1000) {
    if (waited > 180000) throw new Error('appReady non atteint en 3 min');
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000); // tâches longues juste après le premier rendu
  if (coverage) {
    const {result: scripts} = await cdp.send('Profiler.takePreciseCoverage');
    await cdp.send('Profiler.stopPreciseCoverage');
    const origin = new URL(url).origin;
    let total = 0, unused = 0;
    for (const sc of scripts) {
      if (!sc.url.startsWith(origin) || !/\.m?js(\?|$)/.test(sc.url)) continue;
      const r = unusedBytes(sc.functions); total += r.length; unused += r.unused;
    }
    await ctx.close();
    return {jsBytes: total, unusedJsBytes: unused, unusedJsPercent: total ? Math.round(unused / total * 1000) / 10 : 0};
  }
  const result = await page.evaluate(() => {
    const until = window.__perf.appReadyAt;
    const js = performance.getEntriesByType('resource').filter(e => e.startTime <= until && (e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)));
    return {appReadyMs: Math.round(until), initialJsBytes: js.reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0), longTasks: (window.__perf.stop = true, window.__perf.longTasks.length)};
  });
  await ctx.close();
  if (errors.length) throw new Error(`erreur pendant le chargement : ${errors[0]}`);
  return result;
}

export async function run() {
  const server = await startStaticServer(root);
  const browser = await chromium.launch();
  const runs = [];
  let cov;
  try {
    for (let i = 0; i < RUNS; i++) { runs.push(await measureOnce(browser, server.url)); process.stderr.write(`chargement ${i + 1}/${RUNS} : ${runs.at(-1).appReadyMs} ms\n`); }
    cov = await measureOnce(browser, server.url, {coverage: true});
  } finally { await browser.close(); await server.close(); }
  const measured = {
    appReadyMs: median(runs.map(r => r.appReadyMs)),
    initialJsBytes: median(runs.map(r => r.initialJsBytes)),
    longTasks: median(runs.map(r => r.longTasks)),
    appJsBytes: fs.statSync(path.join(root, 'app.js')).size,
    unusedJsBytes: cov.unusedJsBytes,
    unusedJsPercent: cov.unusedJsPercent
  };
  let budget = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')).budget : null;
  if (UPDATE || MEASURED_ONLY || !budget) {
    const budgeted = Object.fromEntries(Object.keys(METRICS).map(k => [k, measured[k]]));
    if (UPDATE || !budget) budget = budgetFrom(budgeted);
    const doc = {conditions: 'iPhone 14, CPU x4, Fast 3G, médiane de 3 chargements à froid', measuredAt: new Date().toISOString().slice(0, 10), measured, budget};
    fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(MEASURED_ONLY && !UPDATE ? 'perf-budget.json : section measured rafraîchie, budgets inchangés.' : 'perf-budget.json écrit (valeurs mesurées + 5 %).');
  }
  const table = markdownTable(measured, budget);
  console.log(`\n${table}\n`);
  const over = Object.keys(METRICS).filter(k => measured[k] > budget[k]);
  if (over.length) console.log(`Budget dépassé : ${over.map(k => METRICS[k].label).join(', ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const verdict = over.length ? `Budget dépassé : ${over.map(k => METRICS[k].label).join(', ')}.` : 'Budget respecté.';
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Budget de performance\n\nConditions : iPhone 14, CPU ×4, Fast 3G, médiane de ${RUNS} chargements à froid.\n\n${table}\n\n${verdict}\n`);
  }
  return over.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run();
