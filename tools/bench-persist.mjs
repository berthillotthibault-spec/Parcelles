// Mesure du coût d’un enregistrement (n° 137, étape 2) dans Chromium, avec le vrai IndexedDB.
// État réaliste : 500 parcelles avec géométrie (150 sommets), 3 000 interventions, 400 tâches.
// Profil vierge (contexte Playwright neuf), jamais les données de l’utilisateur.
// Usage : PORT=8320 node tools/bench-persist.mjs [--runs 15] [--cpu 4]
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startStaticServer} from './static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 15;
const CPU = args.includes('--cpu') ? Number(args[args.indexOf('--cpu') + 1]) || 1 : 1;

const server = await startStaticServer(root, {port: Number(process.env.PORT || 8320)});
const browser = await chromium.launch();
try {
  const context = await browser.newContext({serviceWorkers: 'block'});
  const page = await context.newPage();
  await page.goto(`${server.origin}/parcelles.svg`);
  if (CPU > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', {rate: CPU}); }
  const result = await page.evaluate(async runs => {
    const {Store, emptyState} = await import('/state.js');
    const {StorageService} = await import('/storage.js');
    const median = values => { const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const t = Date.now(), state = emptyState();
    state.preferences.autoBackup = false;
    for (let i = 0; i < 500; i++) {
      const ring = [];
      for (let k = 0; k < 150; k++) { const a = k / 150 * Math.PI * 2; ring.push([4.5 + (i % 25) * 0.01 + Math.cos(a) * 0.003, 46.2 + Math.floor(i / 25) * 0.01 + Math.sin(a) * 0.002]); }
      ring.push(ring[0]);
      state.parcelles.push({id: `p${i}`, nom: `Parcelle ${i}`, surfaceHa: 3 + (i % 9), culture: ['Blé tendre', 'Maïs', 'Prairie'][i % 3], ilot: `Îlot ${i % 40}`, geometry: {type: 'Polygon', coordinates: [ring]}, createdAt: t, updatedAt: t, version: 1});
    }
    for (let i = 0; i < 3000; i++) state.interventions.push({id: `i${i}`, parcelId: `p${i % 500}`, type: ['Semis', 'Traitement', 'Fertilisation'][i % 3], date: '2026-04-12', status: 'Terminé', notes: 'Passage réalisé dans de bonnes conditions.', createdAt: t, updatedAt: t, version: 1});
    for (let i = 0; i < 400; i++) state.tasks.push({id: `t${i}`, title: `Tâche ${i}`, status: 'À faire', createdAt: t, updatedAt: t, version: 1});
    const bytes = new Blob([JSON.stringify(state)]).size;
    const store = new Store(new StorageService());
    await store.init();
    await store.replaceState(state, 'Banc d’essai', {log: false, bypassPermissions: true});
    const persist = [], upsert = [], init = [];
    for (let i = 0; i < runs; i++) { const s = performance.now(); await store.persist(); persist.push(performance.now() - s); }
    for (let i = 0; i < runs; i++) { const s = performance.now(); await store.upsert('tasks', {title: `Nouvelle ${i}`}); upsert.push(performance.now() - s); }
    for (let i = 0; i < Math.max(3, runs / 3 | 0); i++) { const other = new Store(new StorageService()); const s = performance.now(); await other.init(); init.push(performance.now() - s); other.storage.db?.close(); }
    const keys = await store.storage.appKeys();
    return {bytes, persist: median(persist), upsert: median(upsert), init: median(init), appKeys: keys.length};
  }, RUNS);
  console.log(`État : ${(result.bytes / 1048576).toFixed(2)} Mio JSON, ${result.appKeys} entrées dans « app », processeur ×${CPU}, ${RUNS} mesures`);
  console.log(`| Mesure (médiane) | Durée |\n|---|---|\n| persist() seul | ${result.persist.toFixed(1)} ms |\n| upsert d’une tâche (mutation complète) | ${result.upsert.toFixed(1)} ms |\n| init() (lecture + enregistrement de démarrage) | ${result.init.toFixed(1)} ms |`);
} finally {
  await browser.close();
  await server.close();
}
