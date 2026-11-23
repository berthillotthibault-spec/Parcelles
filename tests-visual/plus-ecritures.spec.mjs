// Écritures du « + » (lot 2) : parcours réel en navigateur. Profil vierge (tools/seed-demo.mjs) :
// npx playwright test -c tests-visual/playwright.config.mjs plus-ecritures
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
const lire = page => page.evaluate(async () => {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  const live = list => list.filter(x => !x.deletedAt);
  return {works: live(s.state.interventions), observations: live(s.state.observations)};
});
const feuille = page => page.locator('#modal-root .qw');
const plus = async page => {
  await page.locator('.nav-plus, .sidebar-new-work').locator('visible=true').first().click();
  await expect(feuille(page)).toBeVisible();
};
const tuile = async (page, type) => {
  await plus(page);
  const direct = feuille(page).locator(`.qw-tile[data-type="${type}"]`);
  if (!await direct.count()) await feuille(page).locator('.qw-other').click();
  await direct.click();
};
const pre = page => feuille(page).locator('.qw-parcel').filter({hasText: 'Pré Neuf'}).click();
const suivant = page => feuille(page).locator('.qw-next').click();

test.use({actionTimeout: 10000});
test.beforeEach(async ({page, context, baseURL}) => {
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.upsert('parcelles', {id: 'pa', nom: 'Pré Neuf', culture: 'Prairie permanente', surfaceHa: 6, commune: 'Montrevel'});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
});

test('la tuile Observation ouvre le formulaire d’observation, sans intervention', async ({page}) => {
  const avant = (await lire(page)).works.length;
  await tuile(page, 'Observation');
  await expect(feuille(page)).toHaveCount(0);
  await expect(page.locator('#modal-root .modal')).toContainText(/observation/i);
  expect((await lire(page)).works.length).toBe(avant);
});

test('traitement : produit exigé, aucune dose inventée, puis écriture', async ({page}) => {
  await tuile(page, 'Traitement');
  await pre(page); await suivant(page);
  await expect(feuille(page).locator('#qw-dose')).toHaveValue('');
  await expect(feuille(page).locator('#qw-dose-warn')).toContainText('Dose non renseignée');
  await suivant(page);
  await expect(feuille(page).locator('.form-error')).toContainText('produit');
  await feuille(page).locator('#qw-product').fill('Produit A');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  const w = (await lire(page)).works.find(x => x.parcelId === 'pa' && x.product === 'Produit A');
  expect([w.status, w.isPhytosanitary, w.dose, w.doseUnit]).toEqual(['Terminé', true, '', '']);
});

test('le bouton + part de la suggestion ; « Habituel » applique la dernière dose du produit', async ({page}) => {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.upsert('interventions', {parcelId: 'pa', type: 'Traitement', status: 'Terminé', date: '2026-05-01', product: 'Elatus', dose: 0.75, doseUnit: 'L/ha'});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await tuile(page, 'Traitement');
  await pre(page); await suivant(page);
  await feuille(page).locator('#qw-product').fill('Elatus');
  await expect(feuille(page).locator('#qw-dose')).toHaveValue('');
  await feuille(page).locator('.qw-step[data-dir="1"]').click();
  await expect(feuille(page).locator('#qw-dose')).toHaveValue('0,85');
  await feuille(page).locator('#qw-dose').fill('');
  await feuille(page).locator('[data-qw="habit"]').click();
  await expect(feuille(page).locator('#qw-dose')).toHaveValue('0,75');
  await expect(feuille(page).locator('#qw-dose-warn')).toBeEmpty();
});

test('haie en période interdite : bloquée, la case de dérogation débloque', async ({page}) => {
  await plus(page);
  await feuille(page).locator('.qw-other').click();
  await feuille(page).locator('#qw-custom-type').fill('Taille haie');
  await feuille(page).locator('[data-qw="custom-type"]').click();
  await pre(page); await suivant(page);
  await suivant(page);
  await expect(feuille(page).locator('.form-error')).toContainText('BCAE 8');
  await feuille(page).locator('#qw-hedge').check();
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  const w = (await lire(page)).works.find(x => x.type === 'Taille haie');
  expect(w.hedgeDerogation).toBe(true);
});

test('genre choisi sous Autre… : texte gardé, produit demandé, work.kind écrit', async ({page}) => {
  await plus(page);
  await feuille(page).locator('.qw-other').click();
  await feuille(page).locator('#qw-custom-type').fill('Application X');
  await feuille(page).locator('[data-qw="kind"][data-kind="spray"]').click();
  await expect(feuille(page).locator('#qw-custom-type')).toHaveValue('Application X');
  await feuille(page).locator('[data-qw="custom-type"]').click();
  await pre(page); await suivant(page);
  await feuille(page).locator('#qw-product').fill('P');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  const w = (await lire(page)).works.find(x => x.type === 'Application X');
  expect([w.kind, w.isPhytosanitary]).toEqual(['spray', true]);
});

test('rangée compacte : la Tâche ouvre son formulaire ; libellé Ajouter', async ({page}) => {
  await plus(page);
  await expect(feuille(page).locator('.qw-title')).toHaveText('Quel travail ?');
  await expect(page.locator('.nav-plus:visible, .sidebar-new-work:visible').first()).toHaveAccessibleName('Ajouter');
  await feuille(page).locator('.qw-route[data-action="new-task"]').click();
  await expect(feuille(page)).toHaveCount(0);
  await expect(page.locator('#modal-root .modal')).toContainText(/tâche/i);
});

test('deux parcelles et Formulaire complet : le contrôle haies reste actif', async ({page}) => {
  await plus(page);
  await feuille(page).locator('.qw-other').click();
  await feuille(page).locator('#qw-custom-type').fill('Taille haie');
  await feuille(page).locator('[data-qw="custom-type"]').click();
  await pre(page);
  await feuille(page).locator('.qw-parcel').filter({hasNotText: 'Pré Neuf'}).first().click();
  await suivant(page);
  await feuille(page).locator('[data-qw="full"]').click();
  await expect(page.locator('#batch-work-form')).toBeVisible();
  await page.locator('#save-batch-work').click();
  await expect(page.locator('#batch-work-form')).toBeVisible();
  await expect(page.locator('.toast').filter({hasText: 'BCAE 8'}).first()).toBeVisible();
  expect((await lire(page)).works.filter(x => x.type === 'Taille haie')).toEqual([]);
});

test('onglet secondaire : refus à l’ouverture, avec Utiliser ici', async ({page}) => {
  const ouvert = await page.context().newPage();
  await ouvert.goto(page.url(), {waitUntil: 'load'});
  await expect(ouvert.locator('.tab-readonly-banner, [data-tab-takeover]').first()).toBeVisible({timeout: 15000});
  await ouvert.locator('.nav-plus, .sidebar-new-work').locator('visible=true').first().click();
  await expect(ouvert.locator('#modal-root .qw')).toHaveCount(0);
  await expect(ouvert.locator('.toast').filter({hasText: 'Utiliser ici'}).first()).toBeVisible();
  await ouvert.close();
});

test('lecteur : aucun bouton de saisie visible, la barre garde sa case', async ({page}) => {
  await page.evaluate(() => { document.documentElement.dataset.role = 'viewer'; });
  await expect(page.locator('[data-action="new-work"]:visible')).toHaveCount(0);
});
