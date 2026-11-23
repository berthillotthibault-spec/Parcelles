// Parcours complet facturation + messages (v13, revue de complétude) : npm run parcours.
// Profil de navigateur vierge (parcelles et travaux de démonstration seulement, tools/seed-demo.mjs), aucune
// facture semée : tout se fait par l'interface, depuis Plus › Gestion › Facturation, sur les quatre projets
// (téléphone tactile et ordinateur, clair et sombre). Aucun message ne part : les liens mailto: / sms: sont
// lus puis bloqués, le partage natif est remplacé par une fonction qui note ce qu'on lui donne.
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
// Logo PNG 1 × 1 (vert) pour le modèle visuel.
const LOGO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Une prestation réalisée de l'application, chez un client existant (pour « Prestations non facturées »).
async function semerPrestation() {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  await s.upsert('clients', {id: 'cl-commune', name: 'Commune de Malafretaz', kind: 'pro', siren: '210102304', billingAddress: 'Mairie\n01340 Malafretaz', address: 'Mairie\n01340 Malafretaz', billingEmail: 'mairie@malafretaz.fr', hourlyRate: 60});
  await s.upsert('interventions', {...s.get('interventions', 'w3'), status: 'Terminé', date: '2026-05-09', clientId: 'cl-commune', durationHours: 3});
}

test.beforeEach(async ({page, context, baseURL}) => {
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await context.addInitScript(() => {
    // Partage natif simulé : on garde la trace de ce qui serait partagé (fichiers compris).
    globalThis.__partages = [];
    Object.defineProperty(navigator, 'share', {configurable: true, value: async data => { globalThis.__partages.push({title: data?.title || '', text: data?.text || '', files: (data?.files || []).map(f => f.name)}); }});
    Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => true});
  });
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.evaluate(semerPrestation);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
});

test.use({actionTimeout: 10000});
const modale = page => page.locator('#modal-root .modal');
const pied = page => page.locator('#modal-root .modal-footer');
const action = (page, nom) => page.locator('#modal-root .bd-actions').getByRole('button', {name: nom, exact: true});
// n° 160 : onglet visible, sinon pastille de profil (modules) ou route (Planning hors de la barre du bas).
const nav = async (page, vue) => {
  if (await page.locator('#modal-root.has-modal').count()) await page.keyboard.press('Escape'); // menu profil encore ouvert
  const sel = vue === 'more' ? '.desktop-nav [data-view="more"], .profile-chip' : `.primary-nav [data-view="${vue}"], .desktop-nav [data-view="${vue}"]`;
  const bouton = page.locator(sel).locator('visible=true').first();
  if (await bouton.count()) return bouton.click();
  await page.evaluate(v => { location.hash = `#${v}`; }, vue);
};
async function enregistre(page) { await expect(page.locator('#bd-save-state')).toHaveText(/^Brouillon enregistré/, {timeout: 8000}); }
async function emettre(page, bouton) {
  await enregistre(page);
  await pied(page).locator('[data-bdoc="emit"]').click();
  await expect(modale(page).locator('.bd-confirm')).toBeVisible();
  const numero = (await modale(page).locator('.bd-number').textContent().catch(() => '')) || '';
  await pied(page).getByRole('button', {name: bouton}).click();
  await expect(modale(page).locator('.bd-doc-head')).toBeVisible();
  return numero.trim();
}
async function ouvrirFacturation(page) {
  const croix = page.locator('#modal-root.has-modal .modal-close');
  if (await croix.count()) { await croix.first().click(); await expect(page.locator('#modal-root.has-modal')).toHaveCount(0); }
  await nav(page, 'more');
  await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
  await page.locator('#modal-root .profile-menu [data-action="open-invoices"]').locator('visible=true').first().click();
  await expect(page.locator('#modal-root .bh')).toBeVisible();
}
async function fermerModale(page) {
  const croix = page.locator('#modal-root.has-modal .modal-close');
  if (await croix.count()) { await croix.first().click(); await expect(page.locator('#modal-root.has-modal')).toHaveCount(0); }
}
const etat = page => page.evaluate(async () => {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init(); return JSON.parse(JSON.stringify(s.state));
});

test('facturation : réglages, client, catalogue, devis libre, acompte, solde, paiement, relance SMS, avoir, exports, récurrence, saisie rapide, prestations', async ({page}, info) => {
  test.setTimeout(240000);
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.route(/^(mailto|sms):/, route => route.abort());
  const tel = info.project.name.startsWith('iphone');

  await test.step('réglages de l’entreprise', async () => {
    await ouvrirFacturation(page);
    await page.locator('#bh-tab-reglages').click();
    const form = page.locator('[data-bh-form="settings"]');
    await form.locator('[name="legalName"]').fill('EARL des Tilleuls');
    await form.locator('[name="legalForm"]').fill('EARL');
    await form.locator('[name="capital"]').fill('15 000 €');
    await form.locator('[name="rcs"]').fill('RCS Bourg-en-Bresse 732 829 320');
    await form.locator('[name="siret"]').fill('73282932000074');
    await form.locator('[name="vatNumber"]').fill('FR44732829320');
    await form.locator('[name="address"]').fill('2 chemin des Tilleuls\n01340 Montrevel-en-Bresse');
    await form.locator('[name="email"]').fill('contact@tilleuls.fr');
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('.form-error')).toBeHidden();
    await page.locator('.bh-subnav-item[data-value="tva"]').click();
    await form.locator('button[type="submit"]').click();
    await page.locator('.bh-subnav-item[data-value="banque"]').click();
    await form.locator('[name="iban"]').fill('FR76 3000 6000 0112 3456 7890 189');
    await form.locator('[name="bic"]').fill('AGRIFRPP');
    await expect(form.locator('#bh-iban-hint')).toContainText('IBAN valide');
    await form.locator('[name="showQr"]').check();
    await form.locator('button[type="submit"]').click();
    await page.locator('.bh-subnav-item[data-value="numerotation"]').click();
    await expect(form.locator('[data-bh-number="facture"]')).toHaveText('Prochain numéro : F2026-0001');
    await expect(form.locator('[data-bh-number="devis"]')).toHaveText('Prochain numéro : D2026-0001');
    await form.locator('button[type="submit"]').click();
    await page.locator('.bh-subnav-item[data-value="relances"]').click();
    await form.locator('button[type="submit"]').click();
    await page.locator('.bh-subnav-item[data-value="modele"]').click();
    await form.locator('[data-bh-logo]').setInputFiles({name: 'logo.png', mimeType: 'image/png', buffer: LOGO});
    await expect(form.locator('[data-bh-logo-preview] img')).toBeVisible();
    await form.locator('.bh-swatch').nth(2).click();
    await form.locator('[name="footer"]').fill('Merci de votre confiance');
    const cadre = page.frameLocator('[data-bh-preview]');
    await expect(cadre.locator('.inv-name')).toHaveText('EARL des Tilleuls');
    await expect(cadre.locator('.dz-foot')).toContainText('Merci de votre confiance');
    await expect(cadre.locator('img').first()).toBeVisible();
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('.bh-checklist li.is-warn')).toHaveCount(0);
    const s = (await etat(page)).exploitation?.invoicing || {};
    expect(s.legalName).toBe('EARL des Tilleuls');
    expect(String(s.logo || '')).toMatch(/^data:image\//);
  });

  await test.step('client professionnel créé depuis l’onglet Clients', async () => {
    await page.locator('#bh-tab-clients').click();
    await page.locator('[data-bh="client-new"]').click();
    const fiche = page.locator('#bd-client-form');
    await fiche.locator('[name="name"]').fill('SARL Bresse Paysage');
    await fiche.locator('[data-chip-target="kind"] [data-value="pro"]').click();
    await fiche.locator('[name="contact"]').fill('Julie Perrin');
    await fiche.locator('[name="phone"]').fill('06 98 76 54 32');
    await fiche.locator('[name="billingEmail"]').fill('compta@bresse-paysage.fr');
    await fiche.locator('[name="billingAddress"]').fill('5 rue du Moulin\n01000 Bourg-en-Bresse');
    await fiche.locator('[name="siren"]').fill('552 100 554');
    await fiche.locator('[name="vatNumber"]').fill('FR66552100554');
    await fiche.locator('[name="paymentDays"]').selectOption('30');
    await pied(page).getByRole('button', {name: 'Enregistrer'}).click();
    await expect(page.locator('#modal-root .bh .bh-title')).toHaveText('SARL Bresse Paysage');
  });

  await test.step('catalogue : trois articles saisis, deux importés par CSV', async () => {
    await page.locator('#bh-tab-catalogue').click();
    const articles = [['PEL', 'Pelle 8 t avec chauffeur', 'h', '70', '20', 'Terrassement'], ['BROY', 'Broyage de haies', 'h', '55', '20', 'Entretien'], ['PLANT', 'Plants de haie champêtre', 'u', '3,5', '10', 'Plantation']];
    for (const [code, label, unit, prix, tva, cat] of articles) {
      await page.locator('[data-bh="cat-new"]').click();
      const f = page.locator('[data-bh-form="catalog-item"]');
      await f.locator('[name="label"]').fill(label);
      await f.locator('[name="code"]').fill(code);
      await f.locator('[name="unit"]').selectOption(unit);
      await f.locator('[name="unitPrice"]').fill(prix);
      await f.locator('[name="vatRate"]').selectOption(tva);
      await f.locator('[name="category"]').fill(cat);
      await f.locator('button[type="submit"]').click();
      await expect(page.locator('.bh-catalog .bh-row').filter({hasText: label})).toHaveCount(1);
    }
    const csv = 'Code;Désignation;Unité;Prix HT;TVA;Catégorie\nTRANS;Transport de matériaux;t;18,5;20;Transport\nPAILL;Paillage de copeaux;m³;32;10;Plantation\n';
    await page.locator('[data-bh-file="catalog"]').setInputFiles({name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8')});
    await expect(page.locator('[data-bh-import-created]')).toHaveText('2');
    await page.locator('[data-bh="cat-import-confirm"]').click();
    await expect(page.locator('.bh-catalog .bh-row')).toHaveCount(5);
  });

  let devis = '';
  await test.step('devis libre : catalogue, section, remise, deux taux de TVA, aperçu', async () => {
    await page.locator('#bh-tab-clients').click();
    await page.locator('[data-bh="client"]').filter({hasText: 'SARL Bresse Paysage'}).click();
    await page.locator('#modal-root .bh [data-bh="new"][data-doc="devis"]').click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    await expect(page.locator('.bd-client-card')).toContainText('SARL Bresse Paysage');
    await page.locator('#bd-editor [name="subject"]').fill('Création d’une haie et accès');
    await page.locator('[data-bdoc="line-add"][data-kind="section"]').click();
    await page.locator('#bd-lines [data-line]').last().locator('[data-f="label"]').fill('Terrassement');
    await page.locator('[data-bdoc="panel"][data-panel="catalog"]').click();
    await page.locator('[name="catalogQuery"]').fill('PEL');
    await page.locator('#bd-cat-list [data-bdoc="catalog-pick"]').first().click();
    const pelle = page.locator('#bd-lines [data-line]').filter({has: page.locator('[data-f="label"][value="Pelle 8 t avec chauffeur"]')});
    await pelle.locator('[data-f="quantity"]').fill('8');
    await page.locator('[data-bdoc="line-add"][data-kind="section"]').click();
    await page.locator('#bd-lines [data-line]').last().locator('[data-f="label"]').fill('Plantation');
    await page.locator('[name="catalogQuery"]').fill('plants');
    // Attendre la liste filtrée : sinon, sous charge, le clic part sur le résultat précédent (Pelle, 20 %).
    await page.locator('#bd-cat-list [data-bdoc="catalog-pick"]').filter({hasText: 'Plants de haie'}).first().click();
    const plants = page.locator('#bd-lines [data-line]').last();
    await expect(plants.locator('[data-f="vatRate"]')).toHaveValue('10');
    await plants.locator('[data-f="quantity"]').fill('100');
    await page.locator('#bd-editor [data-chip-target="discountType"] [data-value="pct"]').click();
    await page.locator('#bd-editor [name="discountValue"]').fill('5');
    await expect(page.locator('#bd-totals .is-grand')).toContainText('1 004,15');
    await expect(page.locator('#bd-totals')).toContainText('10 %');
    await expect(page.locator('#bd-totals')).toContainText('20 %');
    await expect(page.locator('.bd-compliance')).toContainText('Prêt à émettre');
    // Aperçu : panneau à côté de l’éditeur sur un grand écran, plein écran ailleurs ; logo et client imprimés.
    await enregistre(page);
    const panneau = await page.locator('.bd-preview-frame').count();
    if (!panneau) await pied(page).locator('[data-bdoc="preview"]').click();
    const apercu = page.frameLocator(panneau ? '.bd-preview-frame' : '.dz-viewer iframe');
    await expect(apercu.locator('body')).toContainText('SARL Bresse Paysage');
    await expect(apercu.locator('body')).toContainText('Plantation');
    await expect(apercu.locator('img[src^="data:image/"]').first()).toBeVisible();
    if (!panneau) await page.locator('[data-dossier="viewer-close"]').click();
    devis = await emettre(page, 'Numéroter le devis');
    expect(devis).toBe('D2026-0001');
  });

  await test.step('envoi du devis par e-mail depuis le composeur (sans envoyer)', async () => {
    await action(page, 'Envoyer').click();
    await expect(page.locator('#msg-compose [name="subject"]')).toHaveValue(new RegExp(devis));
    await page.locator('[data-msg="prepare"]').click();
    const lien = page.locator('[data-msg-link]').first();
    const href = await lien.getAttribute('href');
    expect(href).toMatch(/^mailto:compta(@|%40)bresse-paysage\.fr\?subject=/);
    expect(decodeURIComponent(href)).toContain(devis);
    // Le lien mailto: ne porte pas de pièce jointe : partage natif avec le PDF du devis.
    await page.locator('[data-msg="share-files"]').click();
    await expect.poll(() => page.evaluate(() => globalThis.__partages.length)).toBe(1);
    const partage = await page.evaluate(() => globalThis.__partages[0]);
    expect(partage.files.some(f => f.endsWith('.pdf') && f.includes(devis))).toBe(true);
    expect(partage.text).toContain(devis);
    await expect(page.locator('[data-msg="mark-sent"]').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-msg="send-done"]').click();
    await expect(modale(page).locator('.bd-timeline')).toContainText('e-mail');
  });

  let acompte = '', solde = '';
  await test.step('acceptation signée, acompte de 30 % émis, facture de solde émise', async () => {
    await action(page, 'Accepter').click();
    await page.locator('#bd-accept-form [name="signatory"]').fill('Julie Perrin');
    await pied(page).getByRole('button', {name: 'Enregistrer l’acceptation'}).click();
    await expect(modale(page).locator('.inv-pill')).toHaveText('Accepté');
    await action(page, 'Acompte').click();
    await expect(page.locator('#bd-deposit-note')).toContainText('301,2');
    await pied(page).getByRole('button', {name: 'Préparer l’acompte'}).click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    acompte = await emettre(page, 'Émettre définitivement');
    expect(acompte).toBe('F2026-0001');
    await modale(page).locator('.bd-facts [data-bdoc="open"]').first().click();
    await action(page, 'Facture de solde').click();
    await expect(page.locator('#bd-lines .is-deduction')).toHaveCount(2);
    solde = await emettre(page, 'Émettre définitivement');
    expect(solde).toBe('F2026-0002');
    await expect(modale(page).locator('.bd-doc-head')).toContainText('702,90 € TTC');
  });

  await test.step('paiement partiel de la facture de solde', async () => {
    await action(page, 'Encaisser').click();
    await page.locator('#bd-pay-form [name="amount"]').fill('300');
    await page.locator('#bd-pay-form [data-chip-target="method"] [data-value="virement"]').click();
    await pied(page).getByRole('button', {name: 'Enregistrer le paiement'}).click();
    await expect(modale(page).locator('.inv-pill')).toHaveText('Partiellement payée');
  });

  await test.step('tableau de bord cohérent avec les pièces', async () => {
    await ouvrirFacturation(page);
    await page.locator('#bh-tab-suivi').click();
    // Acompte 259,35 HT + solde 605,15 HT = 864,50 HT du devis : chaque déduction reprend la base et la TVA exactes de l’acompte.
    await expect(page.locator('[data-kpi="invoiced"] .bh-kpi-value')).toHaveText('865 €');
    await page.locator('.bh-figures summary').first().click();
    await expect(page.locator('.bh-figures tfoot').first()).toContainText('864,50');
    await expect(page.locator('[data-kpi="collected"] .bh-kpi-value')).toHaveText('300 €');
    await expect(page.locator('[data-kpi="receivable"] .bh-kpi-value')).toHaveText('704 €');
    await expect(page.locator('[data-kpi="late"] .bh-kpi-value')).toHaveText('0 €');
    await expect(page.locator('[data-kpi="quotes"] .bh-kpi-value')).toHaveText('100 %');
  });

  await test.step('relance par SMS depuis « À faire » (lien sms: vérifié, jamais ouvert)', async () => {
    await page.clock.setFixedTime(new Date('2026-06-20T09:30:00+02:00'));
    // Mêmes montants sur l’accueil, la fiche client de l’application et le tableau de bord.
    await fermerModale(page);
    await nav(page, 'today');
    const carte = page.locator('#home-billing-card');
    await expect(carte).toContainText('2 factures en retard · 704 €');
    await expect(carte).toContainText('SARL Bresse Paysage');
    const id = (await etat(page)).clients.find(c => c.name === 'SARL Bresse Paysage').id;
    await page.evaluate(cid => { const b = document.createElement('button'); b.hidden = true; b.dataset.action = 'open-client-detail'; b.dataset.id = cid; document.body.append(b); b.click(); b.remove(); }, id);
    await expect(page.locator('#client-billing')).toContainText('704 €');
    await expect(page.locator('#client-billing [data-bh="list"]').filter({hasText: 'En retard'})).toContainText('704 €');
    await fermerModale(page);
    await carte.locator('[data-action="open-invoices"]').click();
    await expect(page.locator('#bh-tab-afaire')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#bh-tab-suivi').click();
    await expect(page.locator('[data-kpi="late"] .bh-kpi-value')).toHaveText('704 €');
    await page.locator('#bh-tab-afaire').click();
    const groupe = page.locator('.bh-todo-item').filter({hasText: 'SARL Bresse Paysage'}).filter({has: page.locator('[data-bh="remind"]')});
    await expect(groupe).toContainText('2 factures');
    await groupe.locator('[data-bh="remind"]').click();
    await page.locator('#modal-root [data-msg="channel"][data-value="sms"]').click();
    await page.locator('#modal-root [data-msg="prepare"]').click();
    const href = await page.locator('#modal-root [data-msg-link]').first().getAttribute('href');
    expect(href.startsWith(tel ? 'sms:+33698765432&body=' : 'sms:+33698765432?body=')).toBe(true);
    const texte = decodeURIComponent(href.slice(href.indexOf('body=') + 5));
    expect(texte).toContain(acompte);
    expect(texte).toContain(solde);
    expect(texte).toContain('704,15');
    await page.locator('#modal-root [data-msg="mark-sent"]').first().click();
    await page.locator('#modal-root [data-msg="send-done"]').click();
    await expect(page.locator('#modal-root .bh')).toBeVisible();
    await expect(page.locator('.bh-todo-item').filter({hasText: 'SARL Bresse Paysage'}).filter({has: page.locator('[data-bh="remind"]')})).toHaveCount(0);
  });

  let avoir = '';
  await test.step('avoir partiel sur la facture de solde', async () => {
    await page.locator('#bh-tab-clients').click();
    await page.locator('[data-bh="client"]').filter({hasText: 'SARL Bresse Paysage'}).click();
    await page.locator('#modal-root .bh [data-bh="doc"]').filter({hasText: solde}).click();
    await expect(modale(page).locator('.bd-timeline')).toContainText('SMS');
    await action(page, 'Avoir').click();
    await page.locator('#bd-credit-form [data-chip-target="mode"] [data-value="partiel"]').click();
    const ligne = page.locator('#bd-credit-form .bd-credit-line').first();
    await ligne.locator('[name="pick"]').check();
    await ligne.locator('input[inputmode="decimal"]').fill('1');
    await pied(page).getByRole('button', {name: 'Préparer l’avoir'}).click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    avoir = await emettre(page, 'Émettre définitivement');
    expect(avoir).toBe('F2026-0003');
  });

  await test.step('Factur-X contrôlé et exports comptables', async () => {
    await action(page, 'Factur-X').click();
    await expect(modale(page)).toContainText('Contrôles locaux réussis');
    const [xmlFichier] = await Promise.all([page.waitForEvent('download'), pied(page).getByRole('button', {name: 'Télécharger le XML'}).click()]);
    const xml = fs.readFileSync(await xmlFichier.path(), 'utf8');
    const {validateFacturX} = await import('../billing-export.js');
    expect(validateFacturX(xml)).toEqual({ok: true, errors: []});
    await ouvrirFacturation(page);
    await page.locator('#bh-tab-suivi').click();
    const [fec] = await Promise.all([page.waitForEvent('download'), page.locator('[data-bh="export-fec"]').click()]);
    const journal = fs.readFileSync(await fec.path(), 'utf8');
    expect(journal.split('\r\n')[0]).toMatch(/^JournalCode\|JournalLib\|/);
    for (const n of [acompte, solde, avoir]) expect(journal).toContain(n);
    expect(journal).toContain('4191');
    expect(journal).toContain('512');
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('[data-bh="export-csv"]').click()]);
    const lignes = fs.readFileSync(await csv.path(), 'utf8');
    expect(lignes).toContain('Plants de haie champêtre');
    expect(lignes).toContain('SARL Bresse Paysage');
  });

  await test.step('facture récurrente mensuelle générée en brouillon', async () => {
    await page.locator('#bh-tab-recurrences').click();
    await page.locator('[data-bh="rec-new"]').click();
    const f = page.locator('[data-bh-form="schedule"]');
    await f.locator('[name="clientId"]').selectOption({label: 'SARL Bresse Paysage'});
    await f.locator('[name="label"]').fill('Entretien mensuel des haies');
    await f.locator('[data-chip-target="frequency"] [data-value="mensuel"]').click();
    await f.locator('[data-bh-catalog-pick]').selectOption({label: 'Broyage de haies (BROY)'});
    await f.locator('[name="lQty"]').first().fill('4');
    await f.locator('button[type="submit"]').click();
    const modele = page.locator('.bh-todo-item').filter({hasText: 'Entretien mensuel des haies'});
    await expect(modele).toContainText('1 période à facturer');
    await modele.locator('[data-bh="rec-generate"]').click();
    await expect(modele).toContainText('1 facture générée');
    await expect(modele).toContainText('Prochaine facture le 20/07/2026');
    const brouillons = (await etat(page)).integrationImports.filter(r => r.farmKind === 'invoice' && r.status === 'brouillon' && r.scheduleId);
    expect(brouillons).toHaveLength(1);
    expect(brouillons[0].number || '').toBe('');
  });

  await test.step('saisie rapide en langage naturel', async () => {
    await page.locator('#bh-tab-suivi').click();
    await page.locator('[data-bh="list"][data-doc="all"]').first().click();
    await page.locator('#bd-quick-list [name="quick"]').fill('facture bresse paysage 3 h de broyage de haies et 2 m³ de paillage');
    await page.locator('[data-bdoc="quick-new"]').click();
    await expect(page.locator('.bd-client-card')).toContainText('SARL Bresse Paysage');
    await expect(page.locator('#bd-quick-result .bd-proposal')).toHaveCount(2);
    await page.locator('[data-bdoc="quick-apply"]').click();
    await expect(page.locator('#bd-lines [data-line]')).toHaveCount(2);
    await expect(page.locator('#bd-totals .is-grand')).toContainText('268,40');
    await enregistre(page);
  });

  await test.step('facturation des travaux réalisés non facturés de l’application', async () => {
    await ouvrirFacturation(page);
    await page.locator('#bh-tab-afaire').click();
    const oubli = page.locator('.bh-todo-item').filter({hasText: 'Commune de Malafretaz'}).filter({has: page.locator('[data-bh="bill-client"]')});
    await expect(oubli).toContainText('1 prestation');
    await oubli.locator('[data-bh="bill-client"]').click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    await expect(page.locator('#bd-lines [data-line]').first().locator('[data-f="label"]')).toHaveValue(/Désherbage/);
    await expect(page.locator('#bd-totals .is-grand')).toContainText('216,00');
    await emettre(page, 'Émettre définitivement');
    await ouvrirFacturation(page);
    await page.locator('#bh-tab-afaire').click();
    await expect(page.locator('.bh-todo-item').filter({hasText: 'Commune de Malafretaz'}).filter({has: page.locator('[data-bh="bill-client"]')})).toHaveCount(0);
  });
  expect(erreurs).toEqual([]);
});

test('équipe : contact chauffeur avec accord SMS, travaux et tâche confiés, planning du jour par SMS, rappel du soir', async ({page}, info) => {
  test.setTimeout(120000);
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.route(/^(mailto|sms):/, route => route.abort());
  const tel = info.project.name.startsWith('iphone');
  const fermer = async () => { const croix = page.locator('#modal-root.has-modal .modal-close'); if (await croix.count()) await croix.first().click(); };
  const planifier = async selecteur => {
    await fermer();
    await nav(page, 'more');
    await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
    await page.locator(`#modal-root .profile-menu ${selecteur}`).locator('visible=true').first().click();
  };
  const confier = async ({cible = '', titre = '', echeance = '', consigne = ''}) => {
    const f = page.locator('#team-assign-form');
    await f.locator('[data-chip-target="who"] .choice-chip').filter({hasText: 'Marc'}).first().click();
    if (cible) await f.locator('[name="target"]').selectOption(cible);
    if (titre) await f.locator('[name="title"]').fill(titre);
    if (echeance) await f.locator('[name="dueDate"]').fill(echeance);
    if (consigne) await f.locator('[name="instructions"]').fill(consigne);
    await pied(page).locator('[data-team="assign-save"]').click();
    await expect(page.locator('#modal-root.has-modal')).toHaveCount(0);
  };

  await test.step('contact chauffeur avec accord SMS daté', async () => {
    await planifier('[data-action="open-messages"]');
    await page.locator('#msg-center [data-msg="contacts"]').first().click();
    await page.locator('#modal-root [data-msg="contact-new"]').first().click();
    const f = page.locator('#msg-contact-form');
    await f.locator('[name="name"]').fill('Marc Dubois');
    await f.locator('[name="role"]').selectOption('Chauffeur');
    await f.locator('[name="phones"]').fill('06 11 22 33 44');
    await f.locator('[name="groups"]').fill('Chauffeurs');
    await f.locator('[name="assigneeNames"]').fill('Marc');
    await f.locator('[data-chip-target="consent-sms"] [data-value="oui"]').click();
    await f.locator('[name="consent-sms-at"]').fill('2026-05-01');
    await pied(page).locator('[data-msg="contact-save"]').click();
    await expect(page.locator('#modal-root')).toContainText('Marc Dubois');
    const contact = (await etat(page)).integrationImports.find(r => r.farmKind === 'contact');
    expect(contact.phones).toEqual(['+33611223344']);
    expect(contact.consent.sms).toMatchObject({status: 'oui', at: '2026-05-01'});
  });

  await test.step('deux travaux du jour (menu du travail) et une tâche confiés à Marc', async () => {
    await fermer();
    await nav(page, 'work');
    for (const [id, consigne] of [['w1', 'Benne au hangar, vider au silo 2'], ['w2', 'Semer à 180 kg/ha, commencer côté route']]) {
      await page.locator(`#view-work [data-action="work-actions"][data-id="${id}"]`).locator('visible=true').first().click();
      await page.locator('#modal-root [data-team="assign"][data-kind="work"]').click();
      await expect(page.locator('#team-assign-form [name="target"]')).toHaveValue(`work:${id}`);
      await confier({consigne});
    }
    await planifier('[data-action="open-team-work"]');
    await pied(page).locator('[data-team="assign"]').click();
    await confier({cible: 'task:t1', consigne: 'Prendre le rouleau de fil'});
  });

  await test.step('« Envoyer le planning » : SMS prérempli exact', async () => {
    await nav(page, 'work');
    await page.locator('#view-work [data-msg="plan"]').click();
    const ligne = page.locator('.msg-plan-row').filter({hasText: 'Marc'});
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText('06 11 22 33 44');
    const href = await ligne.locator('[data-msg-plan-link]').getAttribute('href');
    expect(href.startsWith(tel ? 'sms:+33611223344&body=' : 'sms:+33611223344?body=')).toBe(true);
    const texte = decodeURIComponent(href.slice(href.indexOf('body=') + 5));
    for (const attendu of ['Bonjour Marc', '08:30 Récolte maïs - Grand Champ', '14:00 Semis blé - Les Noues', 'Consigne : Benne au hangar, vider au silo 2', 'Consigne : Semer à 180 kg/ha, commencer côté route', 'Réparer clôture', 'Prendre le rouleau de fil', 'Lieu : https://']) expect(texte).toContain(attendu);
    expect(texte.indexOf('08:30')).toBeLessThan(texte.indexOf('14:00'));
    await ligne.locator('[data-msg="plan-sent"]').click();
    await page.locator('[data-msg="plan-done"]').click();
  });

  await test.step('rappel du soir : proposé après l’heure choisie pour le planning de demain', async () => {
    await planifier('[data-action="open-messages"]');
    await page.locator('#msg-center [data-msg="settings"]').click();
    await page.locator('[name="planReminderEnabled"]').check();
    await page.locator('[name="planReminderHour"]').selectOption('18');
    await pied(page).locator('[data-msg="settings-save"]').click();
    await planifier('[data-action="open-team-work"]');
    await pied(page).locator('[data-team="assign"]').click();
    await confier({titre: 'Livrer la paille au GAEC', echeance: '2026-05-13'});
    // Le soir, l’application rouverte propose le planning de demain.
    await page.clock.setFixedTime(new Date('2026-05-12T18:30:00+02:00'));
    await page.reload({waitUntil: 'load'});
    await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
    const toast = page.locator('#toast-root').getByText(/Planning de demain/);
    await expect(toast).toBeVisible({timeout: 15000});
    await expect(toast).toContainText('1 personne a des travaux demain : Marc');
    await page.locator('#toast-root').getByRole('button', {name: 'Préparer les SMS'}).click();
    const href = await page.locator('.msg-plan-row').filter({hasText: 'Marc'}).locator('[data-msg-plan-link]').getAttribute('href');
    expect(decodeURIComponent(href)).toContain('Livrer la paille au GAEC');
  });
  expect(erreurs).toEqual([]);
});

// Rôles d'un membre d'une exploitation partagée, hors connexion (sync.role lit preferences.cloudRole) :
// l'espace de travail cloud est ouvert sur ce profil vierge sans compte, Firebase étant bloqué.
async function semerRole(role) {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const s = new Store(new StorageService()); await s.init();
  await s.upsert('clients', {id: 'cl-bois', name: 'GAEC du Bois', kind: 'pro', siren: '732829320', billingEmail: 'compta@gaec-bois.fr', billingAddress: 'Le Bois\n01000 Bourg-en-Bresse'});
  await s.upsert('integrationImports', {id: 'msg-facture', farmKind: 'message', format: 'Parcelles', recordVersion: 1, channel: 'email', status: 'envoye', finance: true, recipients: [{name: 'GAEC du Bois', email: 'compta@gaec-bois.fr'}], subject: 'Facture F2026-0001', excerpt: 'Veuillez trouver la facture F2026-0001', deviceId: 'poste-bureau', createdAtMs: Date.parse('2026-05-11T10:00:00Z')});
  await s.upsert('integrationImports', {id: 'msg-autre', farmKind: 'message', format: 'Parcelles', recordVersion: 1, channel: 'sms', status: 'envoye', recipients: [{name: 'Paul', phone: '+33612345678'}], excerpt: 'Message d’un autre membre', deviceId: 'poste-bureau', createdAtMs: Date.parse('2026-05-11T11:00:00Z')});
  await s.upsert('integrationImports', {id: 'contact-marc', farmKind: 'contact', format: 'Parcelles', recordVersion: 1, name: 'Marc Dubois', role: 'Chauffeur', phones: ['+33611223344'], preferredChannel: 'sms', assigneeNames: ['Marc'], consent: {sms: {status: 'oui', at: '2026-05-01'}}});
  await s.upsert('interventions', {...s.get('interventions', 'w1'), assigneeName: 'Marc', instructions: 'Benne au hangar'});
  await s.setPreferences({syncEnabled: true, workspaceId: 'ws-essai', cloudRole: role});
}
async function ouvrirEnRole(page, role) {
  await page.evaluate(semerRole, role);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
  await expect(page.locator('html')).toHaveAttribute('data-role', role);
}

test.describe('rôles', () => {
  test('opérateur terrain : pas de facturation, envoie ses propres messages', async ({page}) => {
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await page.route(/^(mailto|sms):/, route => route.abort());
    await ouvrirEnRole(page, 'operator');
    await nav(page, 'more');
    await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
    await expect(page.locator('#modal-root .profile-menu [data-action="open-invoices"]').locator('visible=true')).toHaveCount(0);
    await nav(page, 'work');
    await page.locator('#view-work [data-msg="plan"]').click();
    const ligne = page.locator('.msg-plan-row').filter({hasText: 'Marc'});
    await expect(ligne.locator('[data-msg-plan-link]')).toHaveAttribute('href', /^sms:\+33611223344/);
    await ligne.locator('[data-msg="plan-sent"]').click();
    await page.locator('[data-msg="plan-done"]').click();
    await nav(page, 'more');
    await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
    await page.locator('#modal-root .profile-menu [data-action="open-messages"]').locator('visible=true').first().click();
    const journal = page.locator('#msg-log-list');
    await expect(journal.locator('.msg-log-row')).toHaveCount(1);
    await expect(journal).toContainText('Marc');
    await expect(journal).not.toContainText('F2026-0001');
    await expect(journal).not.toContainText('autre membre');
    await page.locator('#msg-center [data-msg="contacts"]').first().click();
    await expect(page.locator('#modal-root [data-msg="contact-new"]')).toHaveCount(0);
    expect(erreurs).toEqual([]);
  });

  test('lecteur : rien en écriture, rien d’envoyé', async ({page}) => {
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await ouvrirEnRole(page, 'viewer');
    const avant = (await etat(page)).integrationImports.length;
    await nav(page, 'work');
    await expect(page.locator('#view-work [data-msg="plan"]').locator('visible=true')).toHaveCount(0);
    await nav(page, 'more');
    await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
    await expect(page.locator('#modal-root .profile-menu [data-action="open-invoices"]').locator('visible=true')).toHaveCount(0);
    await page.locator('#modal-root .modal-close').click().catch(() => {});
    await nav(page, 'more');
    await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
    await page.locator('#modal-root .profile-menu [data-action="open-messages"]').locator('visible=true').first().click();
    await expect(page.locator('#msg-center')).toContainText('Lecture seule');
    await expect(page.locator('#msg-center [data-msg="plan"], #msg-center [data-msg="compose"]')).toHaveCount(0);
    await expect(page.locator('#msg-log-list')).not.toContainText('F2026-0001');
    expect((await etat(page)).integrationImports.length).toBe(avant);
    expect(erreurs).toEqual([]);
  });

  test('comptabilité : facturation complète, carnet en lecture', async ({page}) => {
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await ouvrirEnRole(page, 'accountant');
    await ouvrirFacturation(page);
    await expect(pied(page).locator('[data-bh="new"][data-doc="devis"]')).toBeVisible();
    await page.locator('#bh-tab-reglages').click();
    await expect(page.locator('[data-bh-form="settings"] button[type="submit"]')).toBeVisible();
    await page.locator('#bh-tab-clients').click();
    await expect(page.locator('[data-bh="client-new"]')).toBeVisible();
    await pied(page).locator('[data-bh="new"][data-doc="devis"]').click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    await fermerModale(page);
    await nav(page, 'more');
    await expect(page.locator('#modal-root .profile-menu')).toBeVisible();
    await page.locator('#modal-root .profile-menu [data-action="open-messages"]').locator('visible=true').first().click();
    await expect(page.locator('#msg-log-list')).toContainText('F2026-0001');
    expect(erreurs).toEqual([]);
  });
});

// Hors connexion : le service worker étant bloqué ici, les modules différés sont chargés une fois en ligne
// (comme le ferait son cache), puis le réseau est coupé.
test('hors connexion : devis préparé et émis, message préparé, retour en ligne sans perte', async ({page, context}) => {
  test.setTimeout(120000);
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.route(/^(mailto|sms):/, route => route.abort());
  await page.evaluate(async () => {
    const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js'); const inv = await import('./invoices.js');
    const s = new Store(new StorageService()); await s.init();
    await inv.saveSettings(s, {legalName: 'EARL des Tilleuls', address: '2 chemin des Tilleuls\n01340 Montrevel-en-Bresse', siret: '73282932000074', vatNumber: 'FR44732829320', paymentDays: 30, vatRate: 20});
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
  await ouvrirFacturation(page);
  await page.locator('#bh-tab-suivi').click();
  await page.locator('[data-bh="list"][data-doc="all"]').first().click();
  await expect(page.locator('.bd-list-screen')).toBeVisible();
  await page.evaluate(async () => { await import('./messaging-ui.js'); await import('./billing-messages.js'); await import('./pdf-lite.js'); await import('./invoice-pdf.js'); });
  await fermerModale(page);

  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await ouvrirFacturation(page);
  await pied(page).locator('[data-bh="new"][data-doc="devis"]').click();
  await page.locator('#bd-client-q').fill('Malafretaz');
  await page.locator('#bd-client-list [data-bdoc="client-pick"]').first().click();
  await expect(page.locator('.bd-client-card')).toContainText('Commune de Malafretaz');
  const ligne = page.locator('#bd-lines [data-line]').first();
  if (!(await ligne.count())) await page.locator('[data-bdoc="line-add"][data-kind="item"]').click();
  await page.locator('#bd-lines [data-line]').first().locator('[data-f="label"]').fill('Fauchage des accotements');
  await page.locator('#bd-lines [data-line]').first().locator('[data-f="quantity"]').fill('6');
  await page.locator('#bd-lines [data-line]').first().locator('[data-f="unit"]').selectOption('h');
  await page.locator('#bd-lines [data-line]').first().locator('[data-f="unitPrice"]').fill('58');
  await expect(page.locator('#bd-totals .is-grand')).toContainText('417,60');
  const devis = await emettre(page, 'Numéroter le devis');
  expect(devis).toBe('D2026-0001');
  await action(page, 'Envoyer').click();
  await page.locator('[data-msg="prepare"]').click();
  expect(await page.locator('[data-msg-link]').first().getAttribute('href')).toMatch(/^mailto:mairie(@|%40)malafretaz\.fr\?subject=/);
  await page.locator('[data-msg="mark-sent"]').first().click();
  await page.locator('[data-msg="send-done"]').click();
  await expect(modale(page).locator('.bd-timeline')).toContainText('e-mail');

  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  const s = await etat(page);
  const q = s.integrationImports.find(r => r.farmKind === 'quote' && r.number === devis);
  expect(q?.sentLog?.length).toBe(1);
  expect(s.integrationImports.filter(r => r.farmKind === 'message' && r.status === 'envoye')).toHaveLength(1);
  expect(erreurs).toEqual([]);
});
