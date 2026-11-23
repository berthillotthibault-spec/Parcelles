// Pâturage dans le « + » : parcours réel en navigateur. Profil vierge (tools/seed-demo.mjs) :
// npx playwright test -c tests-visual/playwright.config.mjs paturage-plus
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
const lire = page => page.evaluate(async () => {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  const live = list => list.filter(x => !x.deletedAt);
  return {sessions: live(s.state.grazingSessions), works: live(s.state.interventions), tasks: live(s.state.tasks)};
});
const feuille = page => page.locator('#modal-root .qw');
const plus = async page => {
  await page.locator('.nav-plus, .sidebar-new-work').locator('visible=true').first().click();
  await expect(feuille(page)).toBeVisible();
};
const tuilePaturage = async page => { await plus(page); await feuille(page).locator('.qw-tile[data-type="Pâturage"]').click(); };
const suivant = page => feuille(page).locator('.qw-next').click();
const geste = (page, nom) => feuille(page).locator('[data-qg^="go-"]').filter({hasText: nom}).click();
const pre = (page, nom) => feuille(page).locator('.qw-parcel').filter({hasText: nom}).click();
const compte = page => feuille(page).locator('[data-qg-count="0"]');

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
    await s.upsert('parcelles', {id: 'pb', nom: 'Pré Long', culture: 'Prairie', surfaceHa: 2, commune: 'Montrevel'});
    await s.upsert('interventions', {id: 'wp', parcelId: 'pa', type: 'Pâturage', date: '2026-05-12', plannedDate: '2026-05-12', status: 'À faire'});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
});

test('mettre au pré : un passage, aucune nouvelle intervention, clôture du travail prévu décochable', async ({page}) => {
  const avant = await lire(page);
  await tuilePaturage(page);
  await geste(page, 'Mettre au pré');
  await expect(feuille(page).locator('.qw-parcel').first()).toContainText(/Pré|prairie/i);
  await pre(page, 'Pré Neuf');
  await suivant(page);
  await compte(page).fill('24');
  await feuille(page).locator('[data-qg-cat="0"]').selectOption('vache-laitiere');
  await feuille(page).locator('#qg-lot').fill('Laitières');
  await expect(feuille(page).locator('#qg-closing')).toContainText('Pâturage');
  await expect(feuille(page).locator('#qg-closing')).not.toContainText('clôture');
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  const apres = await lire(page);
  const neuf = apres.sessions.find(s => s.parcelId === 'pa');
  expect([neuf.animalsCount, neuf.animalCategory, neuf.note]).toEqual([24, 'vache-laitiere', 'Laitières']);
  expect(apres.works.length).toBe(avant.works.length);
  expect(apres.works.find(w => w.id === 'wp').status).toBe('Terminé');
  expect(apres.tasks.find(t => t.id === 't1').status).toBe('À faire');
});

test('plusieurs prés : somme contrôlée, puis un passage par pré sans recopier le total', async ({page}) => {
  await tuilePaturage(page);
  await geste(page, 'Mettre au pré');
  await pre(page, 'Pré Neuf');
  await pre(page, 'Pré Long');
  await suivant(page);
  await compte(page).fill('24');
  await expect(feuille(page).locator('[data-qg-alloc="0"][data-parcel="pa"]')).toHaveValue('18');
  await feuille(page).locator('[data-qg-alloc="0"][data-parcel="pa"]').fill('20');
  await expect(feuille(page).locator('#qg-sum-0')).toContainText('à corriger');
  await suivant(page);
  await expect(feuille(page).locator('.form-error')).toContainText('Répartition');
  await expect(feuille(page).locator('.form-error')).toBeInViewport();
  await feuille(page).locator('[data-qg-alloc="0"][data-parcel="pa"]').fill('18');
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  const {sessions} = await lire(page);
  expect(sessions.filter(s => ['pa', 'pb'].includes(s.parcelId)).map(s => s.animalsCount).sort((a, b) => a - b)).toEqual([6, 18]);
});

test('prés : pas de focus dans la recherche ; brouillon abandonné effacé au retour ; note prévue sans préfixe doublé', async ({page}) => {
  await tuilePaturage(page);
  await geste(page, 'Mettre au pré');
  await expect(feuille(page).locator('#qg-query')).not.toBeFocused();
  await pre(page, 'Pré Neuf');
  await feuille(page).locator('[data-qg="back"]').click();
  await feuille(page).locator('.qw-close').click();
  await plus(page);
  await expect(feuille(page).getByText('Reprendre la saisie')).toHaveCount(0);
  await feuille(page).locator('.qw-close').click();
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.upsert('interventions', {...s.get('interventions', 'wp'), note: 'Prévu : 12 animaux · Bovins', grazingPlan: {animalType: 'Bovins', lotName: 'Lot prévu', lines: [{category: '', count: '12'}], picks: [], numbers: ''}});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.action = 'finish-work'; b.dataset.id = 'wp'; document.querySelector('#today-work-list, main, body').append(b); b.click(); b.remove();
  });
  await expect(feuille(page).locator('.notice.info')).toHaveText('Prévu : 12 animaux · Bovins');
  await expect(compte(page)).toHaveValue('12');
  await expect(feuille(page).locator('#qg-lot')).toHaveValue('Lot prévu');
  await expect(feuille(page).locator('[data-qg="full"]')).toHaveCount(0);
});

test('le lot tourne : un seul passage ; date future : travail à faire, aucun passage', async ({page}) => {
  await tuilePaturage(page);
  await geste(page, 'Mettre au pré');
  await pre(page, 'Pré Neuf');
  await pre(page, 'Pré Long');
  await suivant(page);
  await compte(page).fill('5');
  await feuille(page).locator('[data-qg="rotate"][data-on="1"]').click();
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  expect((await lire(page)).sessions.filter(s => ['pa', 'pb'].includes(s.parcelId)).map(s => [s.parcelId, s.animalsCount, s.note])).toEqual([['pa', 5, '']]);

  const avant = (await lire(page));
  await tuilePaturage(page);
  await geste(page, 'Mettre au pré');
  await pre(page, 'Pré Long');
  await suivant(page);
  await feuille(page).locator('[data-qg="date"][data-date="custom"]').click();
  await feuille(page).locator('#qg-custom-date').fill('2026-05-20');
  await feuille(page).locator('#qg-custom-date').dispatchEvent('change');
  await compte(page).fill('7');
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  const apres = await lire(page);
  expect(apres.sessions.length).toBe(avant.sessions.length);
  const prevu = apres.works.find(w => !avant.works.some(x => x.id === w.id));
  expect([prevu.type, prevu.status, prevu.plannedDate]).toEqual(['Pâturage', 'À faire', '2026-05-20']);
  expect(prevu.note).toContain('7 animaux');
});

test('rentrer et changer de pré : lot existant, catégorie et effectif conservés', async ({page}) => {
  await tuilePaturage(page);
  await geste(page, 'Changer de pré');
  await feuille(page).locator('[data-qg="move-lot"]').first().click();
  await feuille(page).locator('[data-qg="move-dest"]').filter({hasText: 'Pré Long'}).click();
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  let {sessions} = await lire(page);
  expect(sessions.find(s => s.id === 'g1').endDate).toBeTruthy();
  const nouveau = sessions.find(s => s.parcelId === 'pb' && !s.endDate);
  expect(nouveau.animalsCount).toBe(24);

  await tuilePaturage(page);
  await geste(page, 'Rentrer ou retirer du pré');
  await feuille(page).locator(`[data-qg-exit="${nouveau.id}"]`).check();
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  ({sessions} = await lire(page));
  expect(sessions.find(s => s.id === nouveau.id).endDate).toBe('2026-05-12');
});

test('type libre « Mise à l’herbe » : saisie d’animaux ; « Broyage pâture » : un travail ; brouillon repris', async ({page}) => {
  await plus(page);
  await feuille(page).locator('.qw-other').click();
  await feuille(page).locator('#qw-custom-type').fill('Broyage pâture');
  await feuille(page).locator('[data-qw="custom-type"]').click();
  await expect(feuille(page).locator('.qw-title')).toHaveText('Sur quelles parcelles ?');
  await page.evaluate(() => document.querySelector('#modal-root [data-action="close-modal"]')?.click());
  await page.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (k.includes('quick-work')) localStorage.removeItem(k); } catch { /* */ } });

  await plus(page);
  await feuille(page).locator('.qw-other').click();
  await feuille(page).locator('#qw-custom-type').fill('Mise à l’herbe');
  await feuille(page).locator('[data-qw="custom-type"]').click();
  await geste(page, 'Mettre au pré');
  await pre(page, 'Pré Neuf');
  await suivant(page);
  await compte(page).fill('11');
  await compte(page).blur();
  await page.evaluate(() => document.querySelector('#modal-root [data-action="close-modal"]')?.click());
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  await plus(page);
  await feuille(page).locator('[data-qw="resume"]').click();
  await expect(compte(page)).toHaveValue('11');
});

test('terminer un Pâturage prévu ouvre la saisie préremplie ; « Terminer sans animaux » reste possible', async ({page}) => {
  const clic = () => page.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.action = 'finish-work'; b.dataset.id = 'wp'; document.querySelector('#today-work-list, main, body').append(b); b.click(); b.remove();
  });
  await clic();
  await expect(feuille(page).locator('.qw-title')).toHaveText('Mettre au pré');
  await expect(feuille(page).locator('.qw-summary')).toContainText('1 parcelle');
  await compte(page).fill('3');
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  let data = await lire(page);
  expect(data.works.find(w => w.id === 'wp').status).toBe('Terminé');
  expect(data.sessions.find(s => s.parcelId === 'pa').animalsCount).toBe(3);

  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.upsert('interventions', {...s.get('interventions', 'wp'), status: 'À faire'});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  const avant = (await lire(page)).sessions.length;
  await clic();
  await feuille(page).locator('[data-qg="finish-plain"]').click();
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  await expect.poll(async () => (await lire(page)).works.find(w => w.id === 'wp').status).toBe('Terminé');
  data = await lire(page);
  expect(data.sessions.length).toBe(avant);
});

test('troupeau groupé : tout cocher, effectif calculé, fiche reliée, Annuler rétablit tout', async ({page}) => {
  await tuilePaturage(page);
  await geste(page, 'Mettre au pré');
  await pre(page, 'Pré Neuf');
  await suivant(page);
  await feuille(page).locator('.qg-group').filter({hasText: 'Au bâtiment'}).locator('[data-qg="check-all"]').click();
  await expect(feuille(page).locator('#qg-picked')).toContainText('2 animaux cochés');
  await page.screenshot({path: process.env.CAPTURE_PATURAGE || test.info().outputPath('details.png'), fullPage: false});
  await suivant(page);
  await expect(page.locator('#modal-root .qw')).toHaveCount(0);
  const lireFiches = () => page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    return s.state.animals.filter(a => a.id !== 'a1').map(a => a.sessionId || '');
  });
  const neuf = (await lire(page)).sessions.find(s => s.parcelId === 'pa');
  expect([neuf.animalsCount, neuf.animals.map(a => a.animalId).sort()]).toEqual([2, ['a2', 'a3']]);
  expect(await lireFiches()).toEqual([neuf.id, neuf.id]);
  await page.locator('#toast-root').getByRole('button', {name: 'Annuler'}).click();
  await expect.poll(async () => (await lire(page)).sessions.filter(s => s.parcelId === 'pa').length).toBe(0);
  await expect.poll(lireFiches).toEqual(['', '']);
});

test('animal vendu encore dans un lot : le retrait est proposé et réduit l’effectif', async ({page}) => {
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
    const s = new Store(new StorageService()); await s.init();
    await s.upsert('grazingSessions', {id: 'gv', parcelId: 'pa', animalType: 'Bovins', note: 'Lot V', startDate: '2026-05-01', animals: [{number: 'FR0112344388', name: 'Bella', animalId: 'a2', gestation: false}], additionalAnimalsCount: 3, animalsCount: 4});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'open-herd'; document.body.append(b); b.click(); b.remove(); });
  await page.locator('#modal-root [data-herd-animal="a2"]').first().click();
  await page.locator('#herd-edit').click();
  await page.locator('#modal-root [name="exitDate"]').fill('2026-05-10');
  await page.locator('#modal-root [name="exitReason"]').selectOption('Vente');
  await page.locator('#herd-save').click();
  await page.locator('#herd-remove').click();
  await expect(page.locator('#herd-remove')).toHaveCount(0);
  const {sessions} = await lire(page);
  expect(sessions.find(s => s.id === 'gv').endDate).toBe('2026-05-10');
  const suite = sessions.find(s => s.parcelId === 'pa' && !s.endDate);
  expect([suite.animalsCount, suite.startDate, suite.note]).toEqual([3, '2026-05-10', 'Lot V']);
});
