// Saisie du « + » (lot 4, PF-24, AT-M6) : parcours réels en navigateur. Profil vierge (tools/seed-demo.mjs) :
// npm run saisie-plus, ou npx playwright test -c tests-visual/playwright.config.mjs saisie-plus
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
const lire = page => page.evaluate(async () => {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  const live = list => (list || []).filter(x => !x.deletedAt);
  return {sessions: live(s.state.grazingSessions), works: live(s.state.interventions), tasks: live(s.state.tasks), parcels: live(s.state.parcelles)};
});
const feuille = page => page.locator('#modal-root .qw');
const titre = page => feuille(page).locator('.qw-title');
const plus = async page => {
  await page.locator('.nav-plus, .sidebar-new-work').locator('visible=true').first().click();
  await expect(feuille(page)).toBeVisible();
};
const tuile = async (page, type) => {
  const direct = feuille(page).locator(`.qw-tile[data-type="${type}"]`);
  if (!await direct.count()) await feuille(page).locator('.qw-other').click();
  await direct.click();
};
const pre = (page, nom) => feuille(page).locator('.qw-parcel').filter({hasText: nom}).click();
const suivant = page => feuille(page).locator('.qw-next').click();
const toasts = page => page.locator('#toast-root, .toast-region');
const pret = async page => {
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
};
// Action du délégué de clics, comme un bouton de l'écran (fiche, carte, accueil).
const action = (page, name, data = {}) => page.evaluate(([nom, champs]) => {
  const b = document.createElement('button');
  b.dataset.action = nom; Object.assign(b.dataset, champs);
  document.querySelector('main, body').append(b); b.click(); b.remove();
}, [name, data]);

test.use({actionTimeout: 10000});
test.beforeEach(async ({page, context, baseURL}, info) => {
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  if (info.title.startsWith('sans parcelle')) {
    // Accueil de première ouverture passé, aucune parcelle.
    await page.evaluate(async () => {
      const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
      const s = new Store(new StorageService()); await s.init(); await s.setPreferences({onboardingComplete: true});
    });
    return pret(page);
  }
  await page.evaluate(seedDemoFarm);
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.upsert('parcelles', {id: 'pa', nom: 'Pré Neuf', culture: 'Prairie permanente', surfaceHa: 6, commune: 'Montrevel'});
    await s.upsert('parcelles', {id: 'pz', nom: 'Zénith', culture: 'Orge', surfaceHa: 4, commune: 'Montrevel'});
    await s.upsert('tasks', {id: 'tt', parcelId: 'pz', title: 'Traitement Zénith', dueDate: '2026-05-12', status: 'À faire'});
  });
  await pret(page);
});

test('pâturage de bout en bout : un passage d’animaux, aucune intervention', async ({page}) => {
  const avant = await lire(page);
  await plus(page);
  await tuile(page, 'Pâturage');
  await feuille(page).locator('[data-qg^="go-"]').filter({hasText: 'Mettre au pré'}).click();
  await pre(page, 'Pré Neuf');
  await suivant(page);
  await feuille(page).locator('[data-qg-count="0"]').fill('12');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  const apres = await lire(page);
  expect(apres.sessions.length).toBe(avant.sessions.length + 1);
  expect(apres.sessions.find(s => s.parcelId === 'pa' && !s.endDate)?.animalsCount).toBe(12);
  expect(apres.works.length).toBe(avant.works.length);
});

test('reprise de brouillon : heure, produit et tâche écartée survivent ; « Brouillon gardé » à la fermeture', async ({page}) => {
  await plus(page);
  await tuile(page, 'Traitement');
  await expect(titre(page)).toHaveText('Sur quelles parcelles ?');
  await pre(page, 'Zénith');
  await suivant(page);
  await expect(titre(page)).toHaveText('Les détails');
  await feuille(page).locator('#qw-time').fill('07:15');
  await feuille(page).locator('#qw-product').fill('Produit Y');
  const tache = feuille(page).locator('[data-qw-skip="tt"]');
  await expect(tache).toBeChecked();
  await tache.uncheck();
  await feuille(page).locator('.qw-close').click();
  await expect(feuille(page)).toHaveCount(0);
  await expect(toasts(page)).toContainText('Brouillon gardé');
  await plus(page);
  await feuille(page).locator('[data-qw="resume"]').click();
  await expect(titre(page)).toHaveText('Les détails');
  await expect(feuille(page).locator('#qw-time')).toHaveValue('07:15');
  await expect(feuille(page).locator('#qw-product')).toHaveValue('Produit Y');
  await expect(feuille(page).locator('[data-qw-skip="tt"]')).not.toBeChecked();
});

test('retour matériel : recule d’une étape au lieu de fermer la feuille', async ({page}) => {
  await plus(page);
  await tuile(page, 'Semis');
  await pre(page, 'Zénith');
  await suivant(page);
  await expect(titre(page)).toHaveText('Les détails');
  await page.evaluate(() => { history.pushState({}, '', '#retour-essai'); history.back(); });
  await expect(titre(page)).toHaveText('Sur quelles parcelles ?');
  await expect(feuille(page)).toHaveCount(1);
});

test('contexte connu : l’étape 2 est sautée, « Changer » y revient ; date future : « Planifier », travail prévu', async ({page}) => {
  const avant = await lire(page);
  await action(page, 'new-work', {parcelId: 'pz'});
  await expect(feuille(page)).toBeVisible();
  await tuile(page, 'Semis');
  await expect(titre(page)).toHaveText('Les détails');
  await expect(feuille(page).locator('.qw-summary')).toContainText('1 parcelle');
  await feuille(page).locator('[data-qw="change-parcels"]').click();
  await expect(titre(page)).toHaveText('Sur quelles parcelles ?');
  await expect(feuille(page).locator('.qw-parcel[aria-checked="true"]')).toContainText('Zénith');
  await suivant(page);
  await feuille(page).locator('[data-qw="date"][data-date="custom"]').click();
  await feuille(page).locator('#qw-custom-date').fill('2026-05-20');
  await feuille(page).locator('#qw-custom-date').dispatchEvent('change');
  await expect(feuille(page).locator('.qw-next')).toHaveText('Planifier');
  await expect(feuille(page).locator('#qw-date-note')).toContainText('non terminé');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  await expect(toasts(page)).toContainText('prévu le 20/05/2026');
  const neuf = (await lire(page)).works.filter(w => !avant.works.some(x => x.id === w.id));
  expect(neuf.map(w => [w.parcelId, w.type, w.status])).toEqual([['pz', 'Semis', 'À faire']]);
});

test('étape 2 : l’ordre ne bouge pas à la coche, compte visible, « Tout cocher » sur le filtre', async ({page}) => {
  await plus(page);
  await tuile(page, 'Semis');
  const noms = () => feuille(page).locator('.qw-parcel b').allTextContents();
  await expect(feuille(page).locator('.qw-parcel b').first()).not.toBeEmpty();
  const ordre = await noms();
  await pre(page, ordre.at(-1));
  expect(await noms()).toEqual(ordre);
  await expect(feuille(page).locator('#qw-count')).toContainText('1 parcelle');
  await feuille(page).locator('[data-qw="all"]').click();
  await expect(feuille(page).locator('.qw-parcel[aria-checked="false"]')).toHaveCount(0);
  await expect(feuille(page).locator('[data-qw="all"]')).toHaveText('Tout décocher');
});

test('lecteur : le « + » ne s’ouvre pas, rien n’est écrit', async ({page}) => {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.setPreferences({syncEnabled: true, workspaceId: 'ws-essai', cloudRole: 'viewer'});
  });
  await pret(page);
  await expect(page.locator('html')).toHaveAttribute('data-role', 'viewer');
  const avant = await lire(page);
  await action(page, 'new-work');
  await page.waitForTimeout(300);
  await expect(feuille(page)).toHaveCount(0);
  const apres = await lire(page);
  expect([apres.works.length, apres.sessions.length]).toEqual([avant.works.length, avant.sessions.length]);
});

test('opérateur terrain : met au pré sans « Annuler » (pas de suppression), note un travail', async ({page}) => {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.setPreferences({syncEnabled: true, workspaceId: 'ws-essai', cloudRole: 'operator'});
  });
  await pret(page);
  await expect(page.locator('html')).toHaveAttribute('data-role', 'operator');
  const avant = await lire(page);
  await plus(page);
  await tuile(page, 'Pâturage');
  await feuille(page).locator('[data-qg^="go-"]').filter({hasText: 'Mettre au pré'}).click();
  await pre(page, 'Pré Neuf');
  await suivant(page);
  await feuille(page).locator('[data-qg-count="0"]').fill('8');
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  await expect(page.locator('#toast-root').getByRole('button', {name: 'Annuler'})).toHaveCount(0);
  expect((await lire(page)).sessions.length).toBe(avant.sessions.length + 1);

  await plus(page);
  await tuile(page, 'Semis');
  await pre(page, 'Zénith');
  await suivant(page);
  await suivant(page);
  await expect(feuille(page)).toHaveCount(0);
  expect((await lire(page)).works.length).toBe(avant.works.length + 1);
});

test('sans parcelle : état vide dès l’étape 1, avec import, création et carte PAC', async ({page}) => {
  expect((await lire(page)).parcels).toHaveLength(0);
  await plus(page);
  const vide = feuille(page).locator('.qw-noparcel');
  await expect(vide).toContainText('Aucune parcelle');
  for (const name of ['choose-import', 'new-parcel', 'rpg-onboarding']) await expect(vide.locator(`[data-action="${name}"]`)).toHaveCount(1);
  await tuile(page, 'Semis');
  await expect(feuille(page).locator('.qw-noparcel')).toBeVisible();
  await expect(feuille(page).locator('.qw-next')).toBeDisabled();
  await feuille(page).locator('.qw-noparcel [data-action="new-parcel"]').click();
  await expect(page.locator('#modal-root .modal')).not.toHaveClass(/quick-work-sheet/);
});
