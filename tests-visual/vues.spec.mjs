// Régression visuelle (n° 146) : les cinq onglets, la fiche parcelle et le formulaire Travail,
// pour chaque projet de playwright.config.mjs (iPhone 14 et 1280×800, clair et sombre).
// Conditions figées : profil vierge semé (tools/seed-demo.mjs), date et heure fixes, tuiles de carte
// remplacées par une image grise, tout autre accès extérieur coupé, animations désactivées, service worker bloqué.
import {test, expect} from '@playwright/test';
import zlib from 'node:zlib';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

// Mardi 12 mai 2026, 9 h 30 à Paris : salutation, pastilles d'échéance et campagne restent stables.
const MOMENT = new Date('2026-05-12T09:30:00+02:00');

// Tuile PNG 256×256 gris neutre, construite sans dépendance (en-tête, IHDR, IDAT, IEND).
const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
function tuileGrise(taille = 256, gris = 0xb4) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4); ihdr[8] = 8; ihdr[9] = 0; // 8 bits, niveaux de gris
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(taille, gris)]);
  const brut = Buffer.concat(Array.from({length: taille}, () => ligne));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(brut)), chunk('IEND', Buffer.alloc(0))]);
}
const TUILE = tuileGrise();

// Feuille injectée à chaque chargement : plus d'animation, de transition ni de curseur clignotant,
// et les toasts (éphémères, leur apparition dépend du minutage) sont masqués.
const SANS_MOUVEMENT = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}#toast-root{visibility:hidden!important}';

// Zones dont le texte change à chaque publication (numéro de build) : masquées.
const masques = page => [page.locator('#build-label')];

async function preparer(page, context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => {
    const req = route.request();
    if (new URL(req.url()).origin === origin) return route.continue();
    if (req.resourceType() === 'image') return route.fulfill({status: 200, contentType: 'image/png', body: TUILE});
    return route.abort(); // météo, Firebase, satellite, polices distantes : hors ligne, donc déterministe
  });
  await context.addInitScript(css => {
    const poser = () => { const s = document.createElement('style'); s.dataset.testsVisuels = ''; s.textContent = css; document.head.appendChild(s); };
    if (document.head) poser(); else document.addEventListener('DOMContentLoaded', poser, {once: true});
  }, SANS_MOUVEMENT);
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await stabiliser(page);
}

// Attend les polices, les tuiles de carte éventuelles et quelques images pour que le rendu soit posé.
async function stabiliser(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => ![...document.querySelectorAll('.leaflet-tile')].some(t => !t.classList.contains('leaflet-tile-loaded')), null, {timeout: 15000});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
}

async function aller(page, vue) {
  // Barre du bas sur mobile, barre latérale sur ordinateur : on clique celle qui est affichée.
  // n° 160 : les modules passent par la pastille de profil, le Planning (hors barre du bas) par sa route.
  if (await page.locator('#modal-root.has-modal').count()) await page.keyboard.press('Escape');
  const sel = vue === 'more' ? '.desktop-nav [data-view="more"], .profile-chip' : `.primary-nav [data-view="${vue}"], .desktop-nav [data-view="${vue}"]`;
  const bouton = page.locator(sel).locator('visible=true').first();
  if (await bouton.count()) await bouton.click(); else await page.evaluate(v => { location.hash = `#${v}`; }, vue);
  await expect(page.locator(vue === 'more' ? '#modal-root .profile-menu' : `#view-${vue}`)).toBeVisible();
  await stabiliser(page);
}

// En capture pleine page, Chromium recolle la page sous une fenêtre fixe : la barre du bas, la barre latérale,
// le bouton « J'ai fait » et le dock micro/IA (position fixe) resteraient peints au milieu de l'image, à l'endroit
// du bas de l'écran initial, et cacheraient le contenu dessous. On les cache le temps de la capture pleine page ;
// la capture « aujourdhui-ecran » (fenêtre seule) les vérifie à leur vraie position.
const SANS_FIXES = '.primary-nav,.desktop-sidebar,#quick-work-fab,#assistant-dock{visibility:hidden!important}';
// (toHaveScreenshot n'accepte que stylePath, pas style : la feuille est posée puis retirée autour de la capture.)
async function capture(page, nom, {pleinePage = true} = {}) {
  const feuille = pleinePage ? await page.addStyleTag({content: SANS_FIXES}) : null;
  try { await expect(page).toHaveScreenshot(`${nom}.png`, {fullPage: pleinePage, mask: masques(page)}); }
  finally { await feuille?.evaluate(s => s.remove()); }
}

test.beforeEach(async ({page, context, baseURL}) => {
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await preparer(page, context, baseURL);
  expect(erreurs, 'erreurs JavaScript au démarrage').toEqual([]);
});

test('Aujourd’hui', async ({page}) => {
  await aller(page, 'today');
  await capture(page, 'aujourdhui');
  await capture(page, 'aujourdhui-ecran', {pleinePage: false});
});

test('Carte', async ({page}) => {
  await aller(page, 'map');
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await stabiliser(page);
  await capture(page, 'carte', {pleinePage: false});
});

test('Parcelles', async ({page}) => {
  await aller(page, 'parcels');
  await capture(page, 'parcelles');
});

test('Travaux', async ({page}) => {
  await aller(page, 'work');
  await capture(page, 'travaux');
});

test('Menu profil', async ({page}) => {
  await aller(page, 'more');
  await capture(page, 'menu-profil', {pleinePage: false});
});

test('Fiche parcelle', async ({page}) => {
  await aller(page, 'parcels');
  await page.locator('#parcel-list [data-action="open-parcel"]').first().click();
  await expect(page.getByText('Voir sur la carte').first()).toBeVisible();
  await stabiliser(page);
  await capture(page, 'fiche-parcelle');
});

// n° 160 : le « + » ouvre la saisie en 3 étapes ; le formulaire complet reste joignable depuis l'étape 3.
test('Formulaire Travail', async ({page}) => {
  await aller(page, 'today');
  await page.locator('[data-action="new-work"]:visible').first().click();
  const saisie = page.locator('#modal-root .qw');
  await expect(saisie.locator('.qw-tile').first()).toBeVisible();
  await stabiliser(page);
  await capture(page, 'saisie-etape-1', {pleinePage: false});
  await saisie.locator('.qw-tile:not([data-type="Pâturage"])').first().click();
  await expect(saisie).toHaveAttribute('data-step', '2');
  await saisie.locator('.qw-parcel').first().click();
  await saisie.locator('[data-qw="next"]').click();
  await expect(saisie).toHaveAttribute('data-step', '3');
  await stabiliser(page);
  await capture(page, 'saisie-etape-3', {pleinePage: false});
  await saisie.locator('[data-qw="full"]').click();
  await expect(page.locator('#modal-root form').first()).toBeVisible();
  await stabiliser(page);
  await capture(page, 'formulaire-travail', {pleinePage: false});
});

// n° 153 : couverture élargie avant la refonte de la cascade CSS (@layer, jetons de couleur) : fenêtres,
// feuilles et états très utilisés, en plus des sept vues ci-dessus.
async function ouvrirModale(page, selecteur) {
  await page.locator(selecteur).locator('visible=true').first().click();
  await expect(page.locator('#modal-root.has-modal')).toBeVisible();
  await stabiliser(page);
}

test('Édition parcelle', async ({page}) => {
  await aller(page, 'parcels');
  await page.locator('#parcel-list [data-action="open-parcel"]').first().click();
  await expect(page.getByText('Voir sur la carte').first()).toBeVisible();
  // Menu d'actions de la parcelle (feuille basse sur téléphone), puis le formulaire de modification.
  await ouvrirModale(page, '[data-action="parcel-actions"]');
  await capture(page, 'actions-parcelle', {pleinePage: false});
  await ouvrirModale(page, '#modal-root [data-action="edit-parcel"]');
  await expect(page.locator('#modal-root form').first()).toBeVisible();
  await stabiliser(page);
  await capture(page, 'edition-parcelle', {pleinePage: false});
});

test('Paramètres', async ({page}) => {
  // Lien profond #more/<catégorie> : la liste d'une catégorie reste joignable (n° 160).
  await page.evaluate(() => { location.hash = '#more/account'; });
  await expect(page.locator('#view-more-category')).toBeVisible();
  await stabiliser(page);
  await capture(page, 'plus-compte');
  await ouvrirModale(page, '#view-more-category [data-action="open-settings"]');
  await capture(page, 'parametres', {pleinePage: false});
});

test('Personnaliser', async ({page}) => {
  await aller(page, 'today');
  await ouvrirModale(page, '[data-action="personalize"]');
  await capture(page, 'personnaliser', {pleinePage: false});
});

test('Recherche', async ({page}) => {
  await aller(page, 'today');
  await ouvrirModale(page, '[data-action="global-search"]');
  await page.locator('#global-search-input').fill('maïs');
  await expect(page.locator('#global-search-results')).toContainText('Grand Champ');
  await stabiliser(page);
  await capture(page, 'recherche', {pleinePage: false});
});

test('Feuille Pourquoi ?', async ({page}) => {
  await aller(page, 'today');
  await page.locator('[data-explain]').locator('visible=true').first().click();
  await expect(page.locator('dialog.why-dialog[open]')).toBeVisible();
  await stabiliser(page);
  await capture(page, 'pourquoi', {pleinePage: false});
});

test('Toast', async ({page}) => {
  // Personnaliser enregistré sans changement : toast de succès simple, sans effet sur l'écran dessous.
  await aller(page, 'today');
  await ouvrirModale(page, '[data-action="personalize"]');
  await page.locator('#modal-root form').first().evaluate(form => form.requestSubmit());
  await expect(page.locator('#toast-root .toast').first()).toBeAttached();
  await expect(page.locator('#modal-root.has-modal')).toBeHidden();
  // D'autres toasts arrivent selon le minutage (rappel de stockage persistant…) : seul celui-ci reste.
  await page.waitForTimeout(800);
  await page.locator('#toast-root').evaluate(root => { for (const t of root.querySelectorAll('.toast')) if (!t.textContent.includes('Votre espace est personnalisé')) t.remove(); });
  // Les toasts sont masqués partout ailleurs (SANS_MOUVEMENT) : réaffichés pour cette seule capture.
  await page.addStyleTag({content: '#toast-root{visibility:visible!important}'});
  await stabiliser(page);
  await capture(page, 'toast', {pleinePage: false});
});

test('Carte, panneau Couches', async ({page}) => {
  await aller(page, 'map');
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await ouvrirModale(page, '[data-action="open-map-layers"]');
  await capture(page, 'carte-couches', {pleinePage: false});
});

test('Mode gants (n° 21)', async ({page}) => {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init(); await s.setPreferences({glovesMode: 'on'});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await expect(page.locator('body.gloves')).toBeAttached();
  await aller(page, 'today');
  await capture(page, 'gants', {pleinePage: false});
  await aller(page, 'work');
  await capture(page, 'gants-travaux', {pleinePage: false});
});

// Correctif n° 153 : le mode terrain est capturé aussi à 820×1180 (tablette), où ses actions rapides
// doivent rester sur 3 colonnes malgré la grille à 5 colonnes de responsive.css, puis en plein soleil
// (libellés à 13 px). Le mode compact est couvert par la fiche parcelle (lignes « Situation »).
test('Mode terrain (tablette)', async ({page}) => {
  await aller(page, 'today');
  await page.setViewportSize({width: 820, height: 1180});
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'open-field-mode'; b.hidden = true; document.body.append(b); b.click(); b.remove(); });
  const grilles = page.locator('.field-mode-overlay .field-quick-actions');
  await expect(grilles.first()).toBeVisible();
  const colonnes = await grilles.evaluateAll(els => els.map(e => getComputedStyle(e).gridTemplateColumns.split(' ').length));
  expect(colonnes.every(n => n === 3), `colonnes des actions rapides : ${colonnes}`).toBe(true);
  await stabiliser(page);
  await capture(page, 'mode-terrain-820', {pleinePage: false});
  await page.locator('#field-sun').click();
  await expect(page.locator('.field-mode-overlay.field-sun-mode')).toBeAttached();
  await stabiliser(page);
  await capture(page, 'mode-terrain-soleil-820', {pleinePage: false});
});

test('Mode compact', async ({page}) => {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init(); await s.setPreferences({compactMode: true});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await expect(page.locator('html.compact-mode')).toBeAttached();
  await aller(page, 'parcels');
  await page.locator('#parcel-list [data-action="open-parcel"]').first().click();
  await expect(page.getByText('Voir sur la carte').first()).toBeVisible();
  await stabiliser(page);
  await capture(page, 'compact-fiche-parcelle');
});

// n° 160 : zones refondues (barre, pastille de profil, accueil, saisie, Troupeau, menu) : cibles de 48 px au moins.
test('Cibles de 48 px (n° 160)', async ({page}) => {
  const petites = async selecteur => page.locator(selecteur).evaluateAll(els => els
    .filter(e => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden')
    .map(e => ({e, r: e.getBoundingClientRect()}))
    .filter(({r}) => r.width && (Math.round(r.height) < 48 || Math.round(r.width) < 44))
    .map(({e, r}) => `${e.className || e.tagName} « ${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)} » ${Math.round(r.width)}×${Math.round(r.height)}`));
  await aller(page, 'today');
  expect(await petites('.primary-nav .nav-item, .nav-plus, .profile-chip, .home-row-main, .home-row-more, .home-late, .home-animals, #view-today .panel-heading [data-view="work"]')).toEqual([]);
  await aller(page, 'herd');
  await expect(page.locator('#herd-home .herd-action').first()).toBeVisible();
  expect(await petites('.herd-action, .herd-lot-button, .herd-event, .herd-more .text-button')).toEqual([]);
  await page.locator('[data-action="new-work"]:visible').first().click();
  await expect(page.locator('#modal-root .qw-tile').first()).toBeVisible();
  expect(await petites('.qw-tile, .qw-close')).toEqual([]);
  // Pâturage (n° 160, lot 1) ouvre la saisie des animaux : on prend une tuile de travail.
  await page.locator('#modal-root .qw-tile:not([data-type="Pâturage"])').first().click();
  await expect(page.locator('#modal-root .qw')).toHaveAttribute('data-step', '2');
  expect(await petites('.qw-back, .qw-parcel, .qw-pill, .qw-map-link, .qw-next, .qw-count .text-button')).toEqual([]);
  // Étape 3 : dates, heure et matériel aussi (PF-22).
  await page.locator('#modal-root .qw-parcel').first().click();
  await page.locator('#modal-root .qw-next').click();
  await expect(page.locator('#modal-root .qw')).toHaveAttribute('data-step', '3');
  expect(await petites('.qw-dates .qw-pill, #qw-time, .qw-machines .qw-pill, .qw-next, .qw-summary .qw-change')).toEqual([]);
  await page.keyboard.press('Escape');
  await aller(page, 'more');
  expect(await petites('#modal-root .pm-dark, #modal-root .menu-row, #modal-root .modal-close')).toEqual([]);
});
