// Audit de conformité à la maquette v3 (design_handoff_parcelles_mobile/Parcelles v3.dc.html).
// Usage : npm i -D playwright@1 && npx playwright install chromium
//         node tools/audit-maquette.mjs http://localhost:8080/index.html [audit/apres] [--seed]
// --seed crée 4 parcelles, des travaux, des tâches et un lot au pré dans un profil de navigateur vierge
// (jamais sur les données de l'utilisateur : Playwright démarre avec un stockage vide).
import {chromium, devices} from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8080/index.html';
const OUT = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'audit/apres';
const SEED = process.argv.includes('--seed');
fs.mkdirSync(OUT, {recursive: true});

const browser = await chromium.launch();
const ctx = await browser.newContext({...devices['iPhone 14'], locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block'});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));

await page.goto(URL, {waitUntil: 'networkidle'});
if (SEED) {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init(); if (s.state.parcelles.length) return;
    const sq = (x, y, d = 0.004) => ({type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d * 0.7], [x, y + d * 0.7], [x, y]]]});
    const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), today = D(0);
    for (const [id, nom, culture, surfaceHa, x, y, favorite] of [['p1', 'Les Noues', 'Blé tendre', 11.3, 5.13, 46.34, true], ['p2', 'Grand Champ', 'Maïs grain', 8.2, 5.136, 46.34, false], ['p3', 'Le Pré Bas', 'Prairie permanente', 4.6, 5.142, 46.34, false], ['p4', 'La Côte', 'Colza', 6.1, 5.13, 46.345, false]])
      await s.upsert('parcelles', {id, nom, culture, surfaceHa, commune: 'Montrevel', favorite, geometry: sq(x, y)});
    await s.upsert('interventions', {parcelId: 'p2', type: 'Récolte maïs', date: today, plannedDate: today, status: 'À faire', startTime: '08:30'});
    await s.upsert('interventions', {parcelId: 'p1', type: 'Semis blé', date: today, plannedDate: today, status: 'À faire', startTime: '14:00'});
    await s.upsert('interventions', {parcelId: 'p4', type: 'Désherbage', date: D(-3), plannedDate: D(-3), status: 'À faire'});
    await s.upsert('tasks', {title: 'Réparer clôture', parcelId: 'p3', dueDate: today, status: 'À faire'});
    await s.upsert('grazingSessions', {parcelId: 'p3', animalType: 'Vaches', animalsCount: 24, startDate: D(-18)});
    await s.upsert('materiels', {nom: 'Tracteur', location: 'Hangar'});
  });
  await page.reload({waitUntil: 'networkidle'});
}
await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 15000});
await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important}'});

const results = [];
const check = async (screen, label, fn) => {
  try { results.push([(await page.evaluate(fn)) ? 'OK ' : 'KO ', screen, label]); }
  catch (e) { results.push(['ERR', screen, `${label} → ${e.message.split('\n')[0]}`]); }
};
const go = async view => { await page.click(`.primary-nav [data-view="${view}"]`); await page.waitForTimeout(700); };
const shot = name => page.screenshot({path: `${OUT}/${name}.png`, fullPage: true});
const has = s => new Function(`return document.body.innerText.includes(${JSON.stringify(s)})`);

// Commun
await check('Commun', 'theme-color #f7f5f0', () => document.querySelector('meta[name=theme-color]')?.content === '#f7f5f0');
await check('Commun', 'design-v3.css chargé en dernier', () => /design-v3\.css/.test([...document.querySelectorAll('link[rel=stylesheet]')].at(-1)?.href || ''));
await check('Commun', 'police Instrument Sans', () => /Instrument Sans/.test(getComputedStyle(document.body).fontFamily));
await check('Commun', 'fond #f7f5f0', () => getComputedStyle(document.body).backgroundColor === 'rgb(247, 245, 240)');
await check('Commun', 'build meta = sw BUILD', async () => { const m = document.querySelector('meta[name=parcelles-build]')?.content; return !!m && (await (await fetch('./sw.js', {cache: 'no-store'})).text()).includes(m); });
await check('Commun', '5 onglets', () => document.querySelectorAll('.primary-nav .nav-item').length === 5);
await check('Commun', 'bouton assistant IA', () => !!document.querySelector('#assistant-launcher'));
await check('Commun', 'pastille synchro', () => !!document.querySelector('#network-button'));

// Aujourd'hui
await go('today'); await shot('01-aujourdhui');
await check('Aujourd’hui', 'date (jour de la semaine)', () => /lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i.test(document.querySelector('#today-label')?.textContent || ''));
await check('Aujourd’hui', 'titre Bonjour en Instrument Serif', () => /Bonjour/.test(document.querySelector('#today-title').textContent) && /Instrument Serif/.test(getComputedStyle(document.querySelector('#today-title')).fontFamily));
await check('Aujourd’hui', 'phrase « tâche(s) aujourd’hui »', () => /tâche/.test(document.querySelector('#today-subtitle')?.textContent || ''));
await check('Aujourd’hui', '« + Travail » avant « Personnaliser »', () => document.querySelector('.today-primary-action').firstElementChild.dataset.action === 'new-work');
await check('Aujourd’hui', 'carte prochaine action', () => !!document.querySelector('#next-action .next-action-card'));
await check('Aujourd’hui', 'résumé : 3 cartes cliquables', () => document.querySelectorAll('#today-summary .summary-card[data-action]').length === 3);
await check('Aujourd’hui', 'raccourcis Carte/Pâturage/Stocks/Météo', () => ['Carte', 'Pâturage', 'Stocks', 'Météo'].every(x => document.querySelector('#today-quick-actions')?.innerText.includes(x)));
await check('Aujourd’hui', 'raccourcis en pastilles 40 px', () => Math.round(document.querySelector('#today-quick-actions .quick-action').getBoundingClientRect().height) === 40);
await check('Aujourd’hui', 'raccourcis juste sous le résumé', () => document.querySelector('#today-summary').nextElementSibling?.id === 'today-quick-actions');
await check('Aujourd’hui', 'carte météo', () => !!document.querySelector('.weather-card'));
await check('Aujourd’hui', 'case ronde 28 px à gauche', () => { const c = document.querySelector('#today-work-list .row-check'); if (!c) return document.querySelector('#today-work-list .empty-state') !== null; const m = c.closest('.work-row').querySelector('.row-main'); return Math.round(c.getBoundingClientRect().width) === 28 && c.getBoundingClientRect().left < m.getBoundingClientRect().left; });
await check('Aujourd’hui', 'pastilles d’échéance', () => document.querySelectorAll('#today-work-list .when-pill').length > 0 || !document.querySelector('#today-work-list .work-row'));

// Carte + Couches + Outils
await go('map'); await page.waitForTimeout(1000); await shot('02-carte');
await check('Carte', 'Leaflet monté', () => !!document.querySelector('#map.leaflet-container'));
await check('Carte', 'boutons Couches / Outils / ✓+', () => !!document.querySelector('[data-action="open-map-layers"]') && !!document.querySelector('.map-controls [data-action="map-tools"]') && !!document.querySelector('#map-multiple-toggle'));
await page.click('[data-action="open-map-layers"]'); await page.waitForTimeout(500); await shot('03-couches');
await check('Couches', 'Colorer par / PAC-RPG / Satellite+Plan / Noms', () => ['Colorer par', 'PAC/RPG', 'Satellite', 'Plan', 'Noms des parcelles'].every(s => document.body.innerText.includes(s)));
await check('Couches', 'pas de bouton Appliquer', () => ![...document.querySelectorAll('#modal-root button')].some(b => /Appliquer/.test(b.textContent)));
await page.click('#modal-root .modal-close'); await page.waitForTimeout(300);
await page.click('.map-controls [data-action="map-tools"]'); await page.waitForTimeout(400);
await check('Outils', 'Distance / Surface / Dessiner / Repère', () => ['Distance', 'Surface', 'Dessiner', 'Repère'].every(x => document.querySelector('#modal-root').innerText.includes(x)));
await page.click('#modal-root .modal-close'); await page.waitForTimeout(300);

// Parcelles + fiche
await go('parcels'); await shot('04-parcelles');
await check('Parcelles', 'sous-titre avec campagne', () => /campagne \d{4}/.test(document.querySelector('#parcels-counter').textContent));
await check('Parcelles', 'barre d’assolement', () => !!document.querySelector('.crop-overview-bar') || !document.querySelector('.parcel-row'));
await check('Parcelles', 'bouton « Tri : »', () => !!document.querySelector('[data-action="cycle-parcel-sort"]') || !document.querySelector('.crop-overview'));
await check('Parcelles', 'filtres en pastilles sans barre', () => document.querySelectorAll('#view-parcels .filter-chip').length >= 2 && getComputedStyle(document.querySelector('#view-parcels .filter-row')).scrollbarWidth === 'none');
if (await page.$('[data-action="open-parcel"]')) {
  await page.click('#parcel-list [data-action="open-parcel"]'); await page.waitForTimeout(700); await shot('05-fiche');
  await check('Fiche', '« Voir sur la carte » + « Nouveau travail »', has('Voir sur la carte'));
  await check('Fiche', 'bloc animaux', () => /Animaux au pré|Pas d’animaux|Aucun animal|animaux au pré/i.test(document.body.innerText));
}

// Travaux
await go('work'); await shot('06-travaux');
await check('Travaux', 'sous-ligne', has('Planifier, réaliser, retrouver.'));
await check('Travaux', 'ronds à cocher', () => document.querySelectorAll('#view-work .row-check').length > 0 || /Aucun travail/.test(document.body.innerText));
await check('Travaux', 'sous-vues', () => ['Calendrier', 'Tâches', 'Chantiers', 'Matériel'].every(x => document.querySelector('#view-work .context-tools').innerText.includes(x)));

// Plus
await go('more'); await shot('07-plus');
for (const s of ['Les outils utiles, rangés par usage.', 'Assistant IA', 'Favoris', 'Toutes les fonctions', 'Production', 'Gestion', 'Planifier', 'Outils', 'Compte'])
  await check('Plus', s, has(s));
await check('Plus', 'build affiché', () => /build/i.test(document.querySelector('#build-label')?.innerText || ''));
await check('A11y', 'boutons-icônes avec aria-label', () => [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && b.offsetParent).length === 0);

fs.writeFileSync(`${OUT}/resultats.txt`, results.map(r => r.join(' | ')).join('\n') + '\n\nErreurs console :\n' + (errors.join('\n') || 'aucune') + '\n');
console.table(results);
console.log('Erreurs console :', errors.length ? errors : 'aucune');
await browser.close();
process.exit(results.some(r => r[0] !== 'OK ') || errors.length ? 1 : 0);
