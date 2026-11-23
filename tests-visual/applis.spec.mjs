// Applis dans l'appli (n° 161) : parcours fonctionnel sans capture d'écran.
// Lanceur, barre propre à une appli, réouverture sur la dernière appli, bascule automatique avec pastille
// « Retour à … » (et retour arrière qui ne rouvre pas l'appli quittée), adresse d'une appli cachée.
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');

test.beforeEach(async ({page, context, baseURL}, info) => {
  test.skip(info.project.name.endsWith('sombre'), 'parcours fonctionnel : un thème suffit');
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
});

const appli = page => page.evaluate(() => document.documentElement.dataset.app);
const logo = (page, info) => page.locator(info.project.name.startsWith('iphone') ? '.app-header .brand' : '.desktop-brand');

test('lanceur, barre de l’appli et réouverture sur la dernière appli', async ({page}, info) => {
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  expect(await appli(page)).toBe('champs');
  await logo(page, info).click();
  await expect(page.locator('.apps-sheet .app-tile')).toHaveCount(8);
  await page.locator('.apps-sheet [data-app="facturation"]').click();
  await expect(page).toHaveURL(/#app\/facturation$/);
  expect(await appli(page)).toBe('facturation');
  await expect(page.locator('#app-space-title')).toHaveText('Facturation');
  await expect(page.locator('#app-space-watch')).toContainText(/relancer|Rien/);
  if (info.project.name.startsWith('iphone')) {
    await expect(page.locator('#app-nav .nav-plus')).toBeVisible();
    await expect(page.locator('.primary-nav:not(.app-nav)')).toBeHidden();
  } else {
    await expect(page.locator('#sidebar-app-nav .sidebar-new-work')).toContainText('Nouvelle facture');
  }
  // Rouvrir Parcelles (adresse vide) : la dernière appli revient.
  await page.goto('index.html', {waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1');
  await expect(page).toHaveURL(/#app\/facturation$/);
  expect(await appli(page)).toBe('facturation');
  expect(erreurs).toEqual([]);
});

test('bascule automatique, pastille de retour et retour arrière', async ({page}) => {
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.evaluate(() => { location.hash = '#parcels'; });
  await expect(page.locator('#view-parcels')).toHaveClass(/is-active/);
  // Un bouton d'une autre appli (ici l'outil Matériel) y bascule et ouvre l'outil par-dessus.
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'open-equipment'; document.body.append(b); b.click(); b.remove(); });
  await expect(page.locator('#modal-title')).toHaveText('Matériel');
  expect(await appli(page)).toBe('materiel');
  const pastille = page.locator('.app-return');
  await expect(pastille).toHaveText('Retour à Champs');
  // La pastille reste sous la fenêtre ouverte : on la ferme d'abord, comme sur le terrain.
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-root')).not.toHaveClass(/has-modal/);
  await pastille.click();
  await expect(page).toHaveURL(/#parcels$/);
  expect(await appli(page)).toBe('champs');
  await expect(pastille).toHaveCount(0);
  // Le retour arrière ne rouvre pas l'appli quittée.
  await page.goBack();
  await page.waitForTimeout(300);
  expect(await appli(page)).toBe('champs');
  expect(erreurs).toEqual([]);
});

test('l’adresse d’une appli cachée ramène à l’accueil', async ({page}) => {
  // Sans le module Prestations, Facturation et Travaux publics disparaissent du lanceur.
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init(); await s.setPreferences({activeModules: ['crops', 'livestock']});
  });
  // Changer seulement l'ancre ne recharge pas la page : on la recharge vraiment sur l'adresse de l'appli.
  await page.evaluate(() => history.replaceState(null, '', '#app/facturation'));
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1');
  await expect(page).toHaveURL(/#today$/);
  expect(await appli(page)).toBe('champs');
});
