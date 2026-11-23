// Centre « Facturation » (v13, chantier B) : captures de référence (Suivi, À faire, Catalogue, Réglages ›
// Modèle visuel) en clair et sombre, mobile et ordinateur, puis un parcours fonctionnel complet sur les
// projets clairs : réglages -> aperçu du modèle -> catalogue (création + import CSV) -> tableau de bord semé
// (chiffres vérifiés) -> relance groupée (lien généré, jamais ouvert) -> récurrence générée en brouillon.
// Profil vierge semé (tools/seed-demo.mjs) puis factures fictives émises par le moteur, horloge figée.
import {test, expect} from '@playwright/test';
import {seedDemoFarm} from '../tools/seed-demo.mjs';
import {semerFacturation} from './semis-facturation.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
const SANS_MOUVEMENT = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}#toast-root{visibility:hidden!important}';

test.beforeEach(async ({page, context, baseURL}) => {
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await context.addInitScript(css => {
    const poser = () => { const s = document.createElement('style'); s.dataset.testsVisuels = ''; s.textContent = css; document.head.appendChild(s); };
    if (document.head) poser(); else document.addEventListener('DOMContentLoaded', poser, {once: true});
  }, SANS_MOUVEMENT);
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.evaluate(semerFacturation);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.fonts.ready);
});

// Ouvre le centre sur un onglet par l'action historique « open-invoices » (bouton fantôme, comme un vrai clic).
async function ouvrir(page, onglet = 'suivi') {
  await page.evaluate(tab => { const b = document.createElement('button'); b.type = 'button'; b.dataset.action = 'open-invoices'; b.dataset.tab = tab; b.hidden = true; document.body.append(b); b.click(); b.remove(); }, onglet);
  await expect(page.locator('#modal-root.has-modal .bh')).toBeVisible();
  await expect(page.locator(`#bh-tab-${onglet}`)).toHaveAttribute('aria-selected', 'true');
}
async function stable(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
}
const capture = (page, nom) => expect(page).toHaveScreenshot(`${nom}.png`, {fullPage: false, mask: [page.locator('#build-label')]});

test.describe('captures', () => {
  test('Facturation : suivi', async ({page}) => {
    await ouvrir(page, 'suivi');
    await expect(page.locator('[data-kpi="late"] .bh-kpi-value')).toHaveText('1 080 €');
    await stable(page);
    await capture(page, 'facturation-suivi');
  });
  test('Facturation : à faire', async ({page}) => {
    await ouvrir(page, 'afaire');
    await expect(page.locator('.bh-todo-item').first()).toContainText('GAEC du Bois');
    await stable(page);
    await capture(page, 'facturation-a-faire');
  });
  test('Facturation : catalogue', async ({page}) => {
    await ouvrir(page, 'catalogue');
    await expect(page.locator('.bh-catalog .bh-row')).toHaveCount(2);
    await stable(page);
    await capture(page, 'facturation-catalogue');
  });
  test('Facturation : modèle visuel', async ({page}) => {
    await ouvrir(page, 'reglages');
    await page.locator('.bh-subnav-item[data-value="modele"]').click();
    const cadre = page.frameLocator('[data-bh-preview]');
    await expect(cadre.locator('.inv-doc')).toContainText('EARL du Sougey');
    await stable(page);
    await capture(page, 'facturation-modele');
  });
});

test.describe('parcours', () => {
  test('réglages, modèle, catalogue, suivi, relance groupée et récurrence', async ({page}, info) => {
    test.skip(info.project.name.endsWith('sombre'), 'parcours fonctionnel : un thème suffit');
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await page.route(/^(mailto|sms):/, route => route.abort()); // aucun envoi réel
    // Point d'entrée : menu profil › Gestion › Facturation (n° 160).
    await page.locator('.desktop-nav [data-view="more"], .profile-chip').locator('visible=true').first().click(); // n° 160 : pastille de profil sur mobile
    await page.locator('#modal-root .profile-menu [data-action="open-invoices"]').locator('visible=true').first().click();
    await expect(page.locator('#modal-root .bh')).toBeVisible();

    // 1. Réglages complets : identité, TVA, banque, numérotation, conditions, relances.
    await page.locator('#bh-tab-reglages').click();
    const form = page.locator('[data-bh-form="settings"]');
    await form.locator('[name="legalName"]').fill('EARL du Sougey et fils');
    await form.locator('[name="siret"]').fill('12345');
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('.form-error')).toContainText('SIRET');
    await form.locator('[name="siret"]').fill('73282932000074');
    await expect(form.locator('#bh-siret-hint')).toContainText('SIREN 732829320');
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('[name="legalName"]')).toHaveValue('EARL du Sougey et fils');
    await page.locator('.bh-subnav-item[data-value="tva"]').click();
    await form.locator('.chip-choices[data-chip-target="vatTiming"] [data-value="debits"]').click();
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('.chip-choices[data-chip-target="vatTiming"] [data-value="debits"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.bh-subnav-item[data-value="banque"]').click();
    await form.locator('[name="iban"]').fill('FR76 3000 6000 0112 3456 7890 180');
    await expect(form.locator('#bh-iban-hint')).toContainText('Clé de contrôle incorrecte');
    await form.locator('[name="iban"]').fill('FR76 3000 6000 0112 3456 7890 189');
    await expect(form.locator('#bh-iban-hint')).toContainText('IBAN valide');
    await form.locator('[name="showQr"]').check();
    await expect(form.locator('[data-bh-qr] svg')).toBeVisible();
    await form.locator('button[type="submit"]').click();
    await page.locator('.bh-subnav-item[data-value="numerotation"]').click();
    await expect(form.locator('[data-bh-number="facture"]')).toHaveText('Prochain numéro : F2026-0006');
    await form.locator('[name="devisFormat"]').fill('{PREFIXE}{AA}{MM}-{NUM:3}');
    await expect(form.locator('[data-bh-number="devis"]')).toHaveText('Prochain numéro : D2605-001');
    await form.locator('[name="devisFormat"]').fill('{PREFIXE}-{NUM:3}');
    await expect(form.locator('[data-bh-number="devis"]')).toContainText('Format à corriger');
    await form.locator('.chip-choices[data-chip-target="devisReset"] [data-value="jamais"]').click();
    await expect(form.locator('[data-bh-number="devis"]')).toHaveText('Prochain numéro : D-001');
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('.bh-card').filter({hasText: 'Contrôle de la numérotation'})).toContainText('Aucun doublon');
    await page.locator('.bh-subnav-item[data-value="conditions"]').click();
    await form.locator('.chip-choices[data-chip-target="paymentDays"] [data-value="45"]').click();
    await form.locator('[name="quoteValidityDays"]').fill('45');
    await form.locator('button[type="submit"]').click();
    await page.locator('.bh-subnav-item[data-value="relances"]').click();
    await form.locator('[name="r1Subject"]').fill('Petit rappel : facture {numero}');
    await expect(form.locator('[data-bh-msg-subject]')).toHaveText(/^Petit rappel : facture F2026-/);
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('.bh-checklist li.is-warn')).toHaveCount(0);

    // 2. Aperçu en direct du modèle visuel.
    await page.locator('.bh-subnav-item[data-value="modele"]').click();
    const cadre = page.frameLocator('[data-bh-preview]');
    await expect(cadre.locator('.inv-name')).toHaveText('EARL du Sougey et fils');
    await form.locator('.bh-swatch[data-value="#7d2f3a"]').click();
    await form.locator('[name="footer"]').fill('Merci de votre confiance');
    await expect(cadre.locator('.dz-foot')).toContainText('Merci de votre confiance');
    await form.locator('[name="col_vat"]').uncheck();
    await expect(cadre.locator('.inv-table thead th')).toHaveCount(4);
    await expect(cadre.locator('.inv-qr svg')).toBeVisible();
    await form.locator('button[type="submit"]').click();
    const reglages = await page.evaluate(() => JSON.parse(JSON.stringify(window.parcellesStore?.state?.exploitation?.invoicing || null)));
    if (reglages) { expect(reglages.accent).toBe('#7d2f3a'); expect(reglages.template.columns.vat).toBe(false); }

    // 3. Catalogue : création puis import CSV (aperçu, puis écriture).
    await page.locator('#bh-tab-catalogue').click();
    await page.locator('[data-bh="cat-new"]').click();
    const article = page.locator('[data-bh-form="catalog-item"]');
    await article.locator('[name="label"]').fill('Broyage de branches');
    await article.locator('[name="code"]').fill('broyage');
    await article.locator('[name="unitPrice"]').fill('55,5');
    await article.locator('[name="category"]').fill('Entretien');
    await article.locator('button[type="submit"]').click();
    await expect(page.locator('.bh-catalog .bh-row')).toHaveCount(3);
    await expect(page.locator('.bh-catalog')).toContainText('55,50');
    const csv = 'Code;Désignation;Unité;Prix HT;TVA;Catégorie\nPELLE;Pelle mécanique avec chauffeur;heure;68;20;Terrassement\nTRANSPORT;Transport de matériaux;t;18,5;20;Transport\n;;;;;\nERREUR;;h;12;20;\n';
    await page.locator('[data-bh-file="catalog"]').setInputFiles({name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8')});
    await expect(page.locator('[data-bh-import-created]')).toHaveText('1');
    await expect(page.locator('.bh-table tbody tr')).toHaveCount(2);
    await page.locator('[data-bh="cat-import-confirm"]').click();
    await expect(page.locator('.bh-catalog .bh-row')).toHaveCount(4);
    await expect(page.locator('.bh-catalog .bh-row').filter({hasText: 'Pelle mécanique'})).toContainText('68,00');
    await page.locator('.bh-search [name="q"]').fill('transp');
    await expect(page.locator('.bh-catalog .bh-row')).toHaveCount(1);

    // 4. Tableau de bord semé : chiffres attendus.
    await page.locator('#bh-tab-suivi').click();
    await expect(page.locator('[data-kpi="invoiced"] .bh-kpi-value')).toHaveText('2 550 €');
    await expect(page.locator('[data-kpi="collected"] .bh-kpi-value')).toHaveText('980 €');
    await expect(page.locator('[data-kpi="receivable"] .bh-kpi-value')).toHaveText('2 080 €');
    await expect(page.locator('[data-kpi="late"] .bh-kpi-value')).toHaveText('1 080 €');
    await page.locator('.bh-figures summary').first().click();
    await expect(page.locator('.bh-table tbody tr').filter({hasText: 'mars 2026'})).toContainText('700,00');
    await page.locator('.bh-filters select[name="clientId"]').selectOption('c1');
    await expect(page.locator('[data-kpi="late"] .bh-kpi-value')).toHaveText('840 €');
    await page.locator('.bh-filters .choice-chip[data-value="mois"]').click();
    await expect(page.locator('[data-kpi="invoiced"] .bh-kpi-value')).toHaveText('0 €');

    // 5. Relance groupée : un message pour les deux factures du GAEC, lien généré sans être ouvert.
    await page.locator('#bh-tab-afaire').click();
    const groupe = page.locator('.bh-todo-item').filter({hasText: 'GAEC du Bois'}).filter({has: page.locator('[data-bh="remind"]')});
    await expect(groupe).toContainText('2 factures');
    await expect(groupe).toContainText('Relance 2 groupée');
    await groupe.locator('[data-bh="remind"]').click();
    await expect(page.locator('#modal-root [data-msg="prepare"]')).toBeVisible();
    await page.locator('#modal-root [data-msg="prepare"]').click();
    const lien = page.locator('#modal-root [data-msg-link]').first();
    const href = await lien.getAttribute('href');
    expect(href.startsWith('mailto:gaec@exemple.fr') || href.startsWith('sms:')).toBe(true);
    const texte = decodeURIComponent(href);
    expect(texte).toContain('Deuxième relance');
    expect(texte).toContain('F2026-0002');
    expect(texte).toContain('F2026-0003');
    expect(texte).toContain('840,00');
    await page.locator('#modal-root [data-msg="mark-sent"]').first().click();
    await page.locator('#modal-root [data-msg="send-done"]').click();
    await expect(page.locator('#modal-root .bh')).toBeVisible();
    await expect(page.locator('.bh-todo-item').filter({hasText: 'Mme Durand'}).filter({has: page.locator('[data-bh="remind"]')})).toHaveCount(1);
    await expect(page.locator('.bh-todo-item').filter({hasText: 'GAEC du Bois'}).filter({has: page.locator('[data-bh="remind"]')})).toHaveCount(0);

    // 6. Récurrence due : brouillon préparé, jamais émis.
    await page.locator('#bh-tab-recurrences').click();
    const modele = page.locator('.bh-todo-item').filter({hasText: 'Pension des génisses'});
    await expect(modele).toContainText('1 période à facturer');
    await modele.locator('[data-bh="rec-generate"]').click();
    await expect(modele).toContainText('Prochaine facture le 01/06/2026');
    await expect(modele).toContainText('1 facture générée');
    await modele.locator('.bh-history summary').click();
    await expect(modele.locator('.bh-docs')).toContainText('Brouillon');
    expect(erreurs).toEqual([]);
  });
});

// Correctifs de relecture : clavier, Échap, compteur, focus, double envoi, saisies non enregistrées, import.
test.describe('correctifs', () => {
  test.beforeEach(({page: _page}, info) => { test.skip(info.project.name.endsWith('sombre'), 'comportement : un thème suffit'); });
  const actif = page => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.dataset?.bh || a.dataset?.value || a.tagName) : null; });
  const toasts = page => page.evaluate(() => [...document.querySelectorAll('#toast-root .toast')].map(t => t.textContent));
  // Lignes ajoutées au jeu semé (dans la page, puis rechargement).
  async function semer(page, fn) {
    await page.evaluate(fn);
    await page.reload({waitUntil: 'load'});
    await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  }

  test('onglets au clavier : flèches, focus et sélection suivent le même onglet', async ({page}) => {
    await ouvrir(page, 'suivi');
    await page.locator('#bh-tab-suivi').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#bh-tab-afaire')).toBeFocused();
    await expect(page.locator('#bh-tab-afaire')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#bh-tab-clients')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#bh-tab-reglages')).toBeFocused();
    await expect(page.locator('#bh-tab-reglages')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#bh-tab-suivi')).toHaveAttribute('aria-selected', 'false');
  });

  test('relance : Échap dans le composeur ramène sur « À faire » avec « Noter comme envoyée »', async ({page}) => {
    await page.route(/^(mailto|sms):/, route => route.abort());
    await ouvrir(page, 'afaire');
    await page.locator('.bh-todo-item').filter({hasText: 'GAEC du Bois'}).locator('[data-bh="remind"]').click();
    await expect(page.locator('#modal-root [data-msg="prepare"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-root.has-modal .bh')).toBeVisible();
    await expect(page.locator('#bh-tab-afaire')).toHaveAttribute('aria-selected', 'true');
    expect((await toasts(page)).some(t => t.includes('Message préparé mais non confirmé') && t.includes('Noter comme envoyée'))).toBe(true);
  });

  test('compteur « À faire » : nom accessible à jour, focus gardé après « Ce n’est pas un doublon »', async ({page}) => {
    await semer(page, async () => {
      const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js'); const inv = await import('./invoices.js');
      const s = new Store(new StorageService()); await s.init();
      for (let i = 0; i < 2; i++) await inv.createDraft(s, {clientId: 'c3', docType: 'facture', lines: [{label: 'Curage', quantity: 2, unit: 'h', unitPrice: 50, vatRate: 20}], today: '2026-05-11'});
    });
    await ouvrir(page, 'afaire');
    const badge = page.locator('#bh-tab-afaire .bh-count');
    const avant = Number(await badge.textContent());
    await page.locator('[data-bh="dup-ignore"]').first().click();
    await expect(badge).toHaveText(String(avant - 1));
    await expect(badge).toHaveAttribute('aria-label', `${avant - 1} élément${avant - 1 > 1 ? 's' : ''}`);
    expect(await actif(page)).not.toBe('BODY');
  });

  test('catalogue : double clic sans doublon, prix « 55 € », import qui ne modifie que les colonnes du fichier', async ({page}) => {
    await ouvrir(page, 'catalogue');
    const lignes = page.locator('.bh-catalog .bh-row');
    await expect(lignes).toHaveCount(2);
    await page.locator('[data-bh="cat-new"]').click();
    const article = page.locator('[data-bh-form="catalog-item"]');
    await article.locator('[name="label"]').fill('Broyage');
    await article.locator('[name="unitPrice"]').fill('cinquante');
    await article.locator('button[type="submit"]').click();
    await expect(article.locator('.form-error')).toContainText('illisible');
    await expect(article.locator('[name="unitPrice"]')).toBeFocused();
    await article.locator('[name="unitPrice"]').fill('55 €');
    await article.locator('button[type="submit"]').dblclick();
    await expect(lignes).toHaveCount(3);
    await expect(lignes.filter({hasText: 'Broyage'})).toContainText('55,00');
    expect(await actif(page)).not.toBe('BODY');
    // Mise à jour du prix seul : unité (hectare) et catégorie de LABOUR conservées.
    await page.locator('[data-bh-file="catalog"]').setInputFiles({name: 'prix.csv', mimeType: 'text/csv', buffer: Buffer.from('Code;Désignation;Prix HT\nLABOUR;Labour;99\n;Article sans code;10\n', 'utf8')});
    await expect(page.locator('[data-bh-import-created]')).toHaveText('1');
    await page.locator('[data-bh="cat-import-confirm"]').dblclick();
    await expect(lignes).toHaveCount(4);
    await expect(lignes.filter({hasText: 'Article sans code'})).toHaveCount(1);
    const labour = lignes.filter({hasText: 'Labour'});
    await expect(labour).toContainText('99,00');
    await expect(labour).toContainText('par hectare');
    await expect(labour).toContainText('Travaux des champs');
    // Fichier trop long : les lignes au-delà de 1 000 sont signalées et comptées.
    const gros = ['Code;Désignation;Prix HT', ...Array.from({length: 1005}, (_, i) => `G${i};Article ${i};${i}`)].join('\n');
    await page.locator('[data-bh-file="catalog"]').setInputFiles({name: 'gros.csv', mimeType: 'text/csv', buffer: Buffer.from(gros, 'utf8')});
    await expect(page.locator('[data-bh-import-truncated]')).toContainText('5 lignes ne sont pas prises en compte');
    await expect(page.locator('.bh-kpi').filter({hasText: 'Lignes ignorées'})).toContainText('5');
  });

  test('récurrence : double clic sur « Enregistrer le modèle » sans doublon', async ({page}) => {
    await ouvrir(page, 'recurrences');
    const modeles = page.locator('.bh-todo-item');
    await expect(modeles).toHaveCount(1);
    await page.locator('[data-bh="rec-new"]').click();
    const form = page.locator('[data-bh-form="schedule"]');
    await form.locator('[name="clientId"]').selectOption('c1');
    await form.locator('[name="label"]').fill('Rec double');
    await form.locator('[name="lLabel"]').fill('Location');
    await form.locator('[name="lPrice"]').fill('100');
    await form.locator('button[type="submit"]').dblclick();
    await expect(modeles).toHaveCount(2);
    await expect(modeles.filter({hasText: 'Rec double'})).toHaveCount(1);
  });

  test('saisie non enregistrée : confirmation avant de changer de section, d’onglet ou de revenir', async ({page}) => {
    await ouvrir(page, 'reglages');
    const form = page.locator('[data-bh-form="settings"]');
    await form.locator('[name="legalName"]').fill('NOUVEAU NOM NON ENREGISTRE');
    page.once('dialog', d => d.dismiss());
    await page.locator('.bh-subnav-item[data-value="tva"]').click();
    await expect(form.locator('[name="legalName"]')).toHaveValue('NOUVEAU NOM NON ENREGISTRE');
    page.once('dialog', d => d.dismiss());
    await page.locator('#bh-tab-catalogue').click();
    await expect(page.locator('#bh-tab-reglages')).toHaveAttribute('aria-selected', 'true');
    page.once('dialog', d => d.accept());
    await page.locator('.bh-subnav-item[data-value="tva"]').click();
    await expect(form).toHaveAttribute('data-section', 'tva');
    // Sans modification : aucune question.
    let questions = 0; page.on('dialog', d => { questions += 1; d.dismiss(); });
    await page.locator('.bh-subnav-item[data-value="identite"]').click();
    await expect(form.locator('[name="legalName"]')).toHaveValue('EARL du Sougey');
    await page.locator('#bh-tab-catalogue').click();
    await page.locator('[data-bh="cat-new"]').click();
    await page.locator('[data-bh-form="catalog-item"] [name="label"]').fill('Brouillon');
    await page.locator('.bh-back').click();
    await expect(page.locator('[data-bh-form="catalog-item"]')).toBeVisible();
    expect(questions).toBe(1);
  });

  test('focus : réglage enregistré, retour de fiche client, « Masquer » de la carte d’accueil', async ({page}) => {
    await page.locator('#home-billing-card [data-billing-home-hide]').click();
    await expect(page.locator('#home-billing-card')).toBeHidden();
    await expect.poll(() => actif(page)).not.toBe('BODY');
    await ouvrir(page, 'reglages');
    await page.locator('[data-bh-form="settings"] button[type="submit"]').click();
    await expect.poll(async () => (await toasts(page)).some(t => t.includes('Réglages de facturation enregistrés'))).toBe(true);
    expect(await actif(page)).not.toBe('BODY');
    await page.locator('#bh-tab-clients').click();
    await page.locator('[data-bh="client"][data-id="c2"]').click();
    await page.locator('.bh-back').click();
    await expect(page.locator('[data-bh="client"][data-id="c2"]')).toBeFocused();
  });
});
