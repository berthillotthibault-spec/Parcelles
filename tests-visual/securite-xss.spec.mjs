// Sécurité (n° 152) : un nom de parcelle piégé ne doit jamais devenir du HTML actif.
// On crée une parcelle nommée « <img src=x onerror=alert(1)> » (comme un nom importé d'un SHP ou proposé
// par l'assistant distant), puis on parcourt les écrans qui l'affichent : aucune boîte de dialogue ne doit
// s'ouvrir, aucun <img src="x"> ne doit exister dans la page, et le nom doit apparaître tel quel, en texte.
// Sans capture d'écran : un seul projet suffit (bureau clair), lancé aussi dans le job « tests » de la CI.
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const NOM = '<img src=x onerror=alert(1)>';

async function semerParcellePiegee(nom) {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  const sq = {type: 'Polygon', coordinates: [[[5.15, 46.35], [5.154, 46.35], [5.154, 46.353], [5.15, 46.353], [5.15, 46.35]]]};
  await s.upsert('parcelles', {id: 'p-xss', nom, culture: nom, commune: nom, surfaceHa: 1.2, favorite: true, geometry: sq});
  await s.upsert('tasks', {id: 't-xss', title: nom, parcelId: 'p-xss', dueDate: new Date().toISOString().slice(0, 10), status: 'À faire'});
}

test.beforeEach(async ({page, context, baseURL}, info) => {
  test.skip(info.project.name !== 'bureau-clair', 'test fonctionnel : un projet suffit');
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.evaluate(semerParcellePiegee, NOM);
});

test('un nom de parcelle <img onerror> reste du texte', async ({page}) => {
  const dialogues = [];
  const erreurs = [];
  page.on('dialog', d => { dialogues.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', e => erreurs.push(e.message));
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  const piege = () => page.locator('img[src="x"]');
  const aller = async vue => {
    await page.locator(`.primary-nav [data-view="${vue}"], .desktop-nav [data-view="${vue}"]`).locator('visible=true').first().click();
    await expect(page.locator(`#view-${vue}`)).toBeVisible();
  };

  for (const vue of ['today', 'parcels', 'work', 'map']) {
    await aller(vue);
    await page.waitForTimeout(300);
    await expect(piege(), `<img src=x> injecté dans la vue ${vue}`).toHaveCount(0);
  }

  await aller('parcels');
  const ligne = page.locator('#parcel-list [data-action="open-parcel"][data-id="p-xss"]').first();
  await expect(ligne).toContainText(NOM);
  await ligne.click();
  await expect(page.getByText('Voir sur la carte').first()).toBeVisible();
  await expect(page.getByText(NOM, {exact: false}).locator('visible=true').first()).toBeVisible();
  await expect(piege()).toHaveCount(0);

  // Le texte affiché contient les chevrons littéraux : le nom a bien été échappé, pas supprimé.
  expect(await page.evaluate(nom => document.body.textContent.includes(nom), NOM)).toBe(true);
  await page.waitForTimeout(500); // laisse le temps à un éventuel onerror de se déclencher
  expect(dialogues, 'boîte de dialogue ouverte par le nom piégé').toEqual([]);
  expect(erreurs, 'erreurs JavaScript').toEqual([]);
});
