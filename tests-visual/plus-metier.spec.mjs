// Données métier de l'étape 3 du « + » (lot 3) : parcours réel en navigateur. Profil vierge (tools/seed-demo.mjs) :
// npx playwright test -c tests-visual/playwright.config.mjs plus-metier
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
const lire = page => page.evaluate(async () => {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  const live = list => list.filter(x => !x.deletedAt);
  return {works: live(s.state.interventions), records: live(s.state.integrationImports), rotations: live(s.state.rotations), parcels: live(s.state.parcelles)};
});
const feuille = page => page.locator('#modal-root .qw');
const tuile = async (page, type) => {
  await page.locator('.nav-plus, .sidebar-new-work').locator('visible=true').first().click();
  await expect(feuille(page)).toBeVisible();
  const direct = feuille(page).locator(`.qw-tile[data-type="${type}"]`);
  if (!await direct.count()) await feuille(page).locator('.qw-other').click();
  await direct.click();
};
const champ = page => feuille(page).locator('.qw-parcel').filter({hasText: 'Champ Test'}).click();
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
    await s.upsert('parcelles', {id: 'pc', nom: 'Champ Test', culture: 'Blé tendre', surfaceHa: 10, commune: 'Montrevel'});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
});

test('récolte : quantité et rendement, lot de récolte créé, entrée en stock proposée', async ({page}) => {
  await tuile(page, 'Récolte');
  await champ(page); await suivant(page);
  await feuille(page).locator('#qx-quantity').fill('72');
  await expect(feuille(page).locator('#qw-info')).toContainText('Rendement ≈ 7,2 t/ha');
  await feuille(page).locator('[data-qw="details"]').click();
  await feuille(page).locator('#qx-humidity').fill('14,5');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  await expect(page.locator('.toast, [role="status"]').filter({hasText: 'Entrer en stock'}).first()).toBeVisible();
  const {records, works} = await lire(page);
  const lot = records.find(r => r.farmKind === 'harvest' && r.parcelId === 'pc');
  expect(lot.quantity).toBe(72);
  expect(lot.humidity).toBe(14.5);
  expect(works.some(w => w.parcelId === 'pc' && w.type === 'Récolte' && w.status === 'Terminé')).toBe(true);
});

test('semis : culture semée, rotation et culture de la parcelle mises à jour', async ({page}) => {
  await tuile(page, 'Semis');
  await champ(page); await suivant(page);
  await expect(feuille(page).locator('#qx-culture')).toHaveValue('Blé tendre');
  await feuille(page).locator('#qx-culture').fill('Maïs grain');
  await feuille(page).locator('#qw-product').fill('LG 31.272');
  await feuille(page).locator('[data-qw="unit"][data-unit="grains/m²"]').click();
  await feuille(page).locator('#qw-dose').fill('9');
  await expect(feuille(page).locator('#qw-info')).toContainText('Blé tendre → Maïs grain');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  const {works, rotations, parcels} = await lire(page);
  const w = works.find(x => x.parcelId === 'pc' && x.type === 'Semis');
  expect(w.culture).toBe('Maïs grain');
  expect(w.seed).toMatchObject({variety: 'LG 31.272', density: 9, densityUnit: 'grains/m²'});
  expect(rotations.filter(r => r.parcelId === 'pc').map(r => [r.campaignId, r.culture]).sort()).toEqual([['2024/25', 'Blé tendre'], ['2025/26', 'Maïs grain']]);
  expect(parcels.find(p => p.id === 'pc').culture).toBe('Maïs grain');
});

test('traitement : cible, heures de fin et détails repliés enregistrés', async ({page}) => {
  await tuile(page, 'Traitement');
  await champ(page); await suivant(page);
  await expect(feuille(page).locator('.qw-more-details')).not.toHaveAttribute('open', '');
  await feuille(page).locator('#qw-product').fill('Produit A');
  await feuille(page).locator('#qx-target').fill('Septoriose');
  await feuille(page).locator('#qw-time').fill('08:00');
  await feuille(page).locator('#qx-endTime').fill('09:30');
  await feuille(page).locator('[data-qw="details"]').click();
  await feuille(page).locator('#qw-note').fill('vent nul');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  const w = (await lire(page)).works.find(x => x.parcelId === 'pc' && x.type === 'Traitement');
  expect(w).toMatchObject({target: 'Septoriose', startTime: '08:00', endTime: '09:30', duration: 1.5, note: 'vent nul'});
});

test('récolte sans quantité : aucun lot, rappel « Ajouter la quantité récoltée » qui ouvre les lots de la parcelle', async ({page}) => {
  await tuile(page, 'Récolte');
  await champ(page); await suivant(page);
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  expect((await lire(page)).records.filter(r => r.farmKind === 'harvest' && r.parcelId === 'pc')).toHaveLength(0);
  await page.getByRole('button', {name: 'Ajouter la quantité récoltée'}).first().click();
  await expect(page.locator('#modal-root .modal')).toContainText('Lots de récolte · Champ Test');
});
