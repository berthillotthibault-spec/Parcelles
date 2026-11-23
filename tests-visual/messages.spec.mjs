// Messages (v13) : parcours « envoyer le planning à un chauffeur », sans capture d'écran.
// Profil vierge semé (tools/seed-demo.mjs) + un contact « Paul » (chauffeur) à qui un travail est confié.
// On vérifie le lien sms: généré (format iOS sur iPhone, RFC 5724 sur ordinateur) sans jamais l'ouvrir,
// puis la confirmation « Envoyé ? » qui passe le message à « Envoyé » dans le journal.
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');

async function semerChauffeur() {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  const w = s.get('interventions', 'w1');
  await s.upsert('interventions', {...w, assigneeName: 'Paul', product: 'Ammonitrate', dose: 150, doseUnit: 'kg/ha', equipmentId: 'm1', instructions: 'Commencer par le bas'});
  await s.upsert('integrationImports', {id: 'contact-paul', farmKind: 'contact', format: 'Parcelles', recordVersion: 1, name: 'Paul Martin', role: 'Chauffeur', phones: ['+33612345678'], email: '', preferredChannel: 'sms', groups: ['Chauffeurs'], assigneeNames: ['Paul'], consent: {sms: {status: 'oui', at: '2026-05-01', source: 'saisie'}}});
}

test.beforeEach(async ({page, context, baseURL}, info) => {
  test.skip(info.project.name.endsWith('sombre'), 'parcours fonctionnel : un thème suffit');
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.evaluate(semerChauffeur);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
});

test('envoyer le planning du jour à un chauffeur par SMS', async ({page}, info) => {
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  // Un lien sms: ne doit jamais partir pendant le test.
  await page.route(/^sms:/, route => route.abort());
  // n° 160 : sur mobile, le Planning n'est plus dans la barre du bas (lien de l'accueil, route #work).
  const travaux = page.locator('.primary-nav [data-view="work"], .desktop-nav [data-view="work"]').locator('visible=true').first();
  if (await travaux.count()) await travaux.click(); else await page.evaluate(() => { location.hash = '#work'; });
  const bouton = page.locator('#view-work [data-msg="plan"]');
  await expect(bouton).toHaveText('Envoyer le planning');
  await bouton.click();
  const ligne = page.locator('.msg-plan-row').filter({hasText: 'Paul'});
  await expect(ligne).toHaveCount(1);
  await expect(ligne).toContainText('06 12 34 56 78');
  const lien = ligne.locator('[data-msg-plan-link]');
  const href = await lien.getAttribute('href');
  const ios = info.project.name.startsWith('iphone');
  expect(href.startsWith(ios ? 'sms:+33612345678&body=' : 'sms:+33612345678?body=')).toBe(true);
  const texte = decodeURIComponent(href.slice(href.indexOf('body=') + 5));
  expect(texte).toContain('Bonjour Paul');
  expect(texte).toContain('08:30 Récolte maïs - Grand Champ');
  expect(texte).toContain('Produit : Ammonitrate 150 kg/ha');
  expect(texte).toContain('Materiel : Tracteur');
  expect(texte).toContain('Consigne : Commencer par le bas');
  expect(texte).toContain('Lieu : https://');
  expect(texte).not.toContain('Semis blé'); // travail non confié à Paul
  // Le texte modifié met le lien à jour.
  await ligne.locator('textarea').fill('Bonjour Paul, rendez-vous au hangar à 8 h.');
  await expect(lien).toHaveAttribute('href', /body=Bonjour%20Paul%2C%20rendez-vous/);
  // Confirmation manuelle : le journal passe à « Envoyé ».
  const confirmer = ligne.locator('[data-msg="plan-sent"]');
  await confirmer.click();
  await expect(confirmer).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-msg="plan-done"]').click();
  await page.locator('.desktop-nav [data-view="more"], .profile-chip').locator('visible=true').first().click(); // n° 160 : pastille de profil sur mobile
  await page.locator('#modal-root .profile-menu [data-action="open-messages"]').locator('visible=true').first().click();
  const journal = page.locator('.msg-log-row').first();
  await expect(journal).toContainText('Envoyé');
  await expect(journal).toContainText('Paul Martin');
  await expect(journal).toContainText('rendez-vous au hangar');
  expect(erreurs).toEqual([]);
});
