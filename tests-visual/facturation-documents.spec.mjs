// Documents de facturation (v13, chantier A) : parcours complet et captures de référence.
// Parcours (thèmes clairs) : client neuf -> devis libre avec catalogue -> acceptation -> acompte 30 % -> facture de solde
// -> paiement partiel -> relance (lien mailto: de la messagerie vérifié, jamais ouvert) -> avoir partiel -> Factur-X valide.
// Captures (quatre projets) : liste des factures, fiche d'une facture et éditeur d'un devis, sur un jeu semé fixe.
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {seedDemoFarm} from '../tools/seed-demo.mjs';

const MOMENT = new Date('2026-05-12T09:30:00+02:00');
const SANS_MOUVEMENT = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}#toast-root{visibility:hidden!important}';
const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
function tuileGrise(taille = 256, gris = 0xb4) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4); ihdr[8] = 8; ihdr[9] = 0;
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(taille, gris)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({length: taille}, () => ligne)))), chunk('IEND', Buffer.alloc(0))]);
}
const TUILE = tuileGrise();

// Paramètres de facturation complets et un article de catalogue ; avec captures, quelques documents à dates fixes.
async function semerFacturation({documents = false} = {}) {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const inv = await import('./invoices.js'), bill = await import('./billing.js');
  const s = new Store(new StorageService()); await s.init();
  await inv.saveSettings(s, {legalName: 'EARL du Sougey', legalForm: 'EARL', capital: '7 500 €', rcs: 'RCS Bourg-en-Bresse 123 456 789', address: '1 route du Sougey\n01340 Montrevel-en-Bresse', siret: '12345678900012', vatNumber: 'FR12345678901', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP', paymentDays: 30, vatRate: 20, prefix: 'F', email: 'contact@sougey.fr'});
  await bill.saveCatalogItem(s, {code: 'PEL', label: 'Pelle 8 t avec chauffeur', unit: 'h', unitPrice: 70, vatRate: 20, category: 'Terrassement'});
  await bill.saveCatalogItem(s, {code: 'CAIL', label: 'Cailloux 0/31,5', unit: 't', unitPrice: 18, vatRate: 20, category: 'Matériaux'});
  if (!documents) return;
  await s.upsert('clients', {id: 'cl-bois', name: 'GAEC du Bois Joli', contact: 'Paul Martin', kind: 'pro', siren: '732829320', vatNumber: 'FR44732829320', billingEmail: 'compta@gaec-bois.fr', billingAddress: 'Le Bois\n01000 Bourg-en-Bresse', address: 'Le Bois\n01000 Bourg-en-Bresse', paymentDays: 30});
  await s.upsert('clients', {id: 'cl-durand', name: 'Mme Durand', kind: 'particulier', address: '3 rue Haute\n01340 Foissiat', billingAddress: '3 rue Haute\n01340 Foissiat'});
  const L = (label, quantity, unit, unitPrice, vatRate = 20) => ({label, quantity, unit, unitPrice, vatRate});
  const emit = async (o, day) => { const d = await inv.createDraft(s, {...o, today: day}); return inv.emitDocument(s, d.id, {today: day}); };
  const a = await emit({clientId: 'cl-bois', lines: [L('Pelle 8 t avec chauffeur', 6, 'h', 70), L('Cailloux 0/31,5', 12, 't', 18)], extra: {subject: 'Empierrement du chemin'}}, '2026-03-02');
  await inv.addPayment(s, a.id, {date: '2026-03-20', amount: 300, method: 'virement'});
  const b = await emit({clientId: 'cl-durand', lines: [L('Broyage de haies', 3, 'h', 55, 10)]}, '2026-04-20');
  await emit({clientId: 'cl-bois', lines: [L('Fauche', 4, 'ha', 45)]}, '2026-05-04');
  await inv.addPayment(s, b.id, {date: '2026-05-02', amount: 181.5, method: 'cheque', reference: 'CHQ 1042'});
  const q = await emit({clientId: 'cl-bois', docType: 'devis', lines: [L('Terrassement de la cour', 16, 'h', 70), L('Évacuation des terres', 1, 'forfait', 450)]}, '2026-05-05');
  await bill.acceptQuote(s, q.id, {date: '2026-05-07', signatory: 'Paul Martin'});
  const draft = await inv.createDraft(s, {clientId: 'cl-bois', docType: 'devis', today: '2026-05-12', lines: [{kind: 'section', label: 'Terrassement'}, L('Pelle 8 t avec chauffeur', 8, 'h', 70), L('Cailloux 0/31,5', 20, 't', 18), {kind: 'subtotal', label: 'Sous-total terrassement'}, {kind: 'comment', label: '', description: 'Accès par le chemin communal.'}], extra: {subject: 'Aménagement de l’entrée', reference: 'BC-2026-118'}});
  await s.setPreferences({billingDocsDemo: {facture: a.id, devis: draft.id, accepte: q.id}});
}

async function preparer(page, context, baseURL, {documents = false, visuel = false} = {}) {
  const origin = new URL(baseURL).origin;
  await context.route(/^https?:\/\//, route => {
    const req = route.request();
    if (new URL(req.url()).origin === origin) return route.continue();
    if (req.resourceType() === 'image') return route.fulfill({status: 200, contentType: 'image/png', body: TUILE});
    return route.abort();
  });
  if (visuel) await context.addInitScript(css => { const poser = () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }; if (document.head) poser(); else document.addEventListener('DOMContentLoaded', poser, {once: true}); }, SANS_MOUVEMENT);
  await page.clock.setFixedTime(MOMENT);
  await page.goto('index.html', {waitUntil: 'load'});
  await page.evaluate(seedDemoFarm);
  await page.evaluate(semerFacturation, {documents});
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 30000});
  await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click());
}
// Bouton fantôme data-bdoc : chargé à la demande (LAZY_TRIGGERS) puis rejoué, comme un vrai bouton de l'application.
async function ouvrir(page, data) {
  await page.evaluate(d => { const b = document.createElement('button'); b.type = 'button'; Object.assign(b.dataset, d); b.hidden = true; document.body.append(b); b.click(); setTimeout(() => b.remove(), 4000); }, data);
}
const modale = page => page.locator('#modal-root .modal');
const pied = page => page.locator('#modal-root .modal-footer');
const action = (page, nom) => page.locator('#modal-root .bd-actions').getByRole('button', {name: nom, exact: true});
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

test.describe('parcours', () => {
  test.beforeEach(async ({page, context, baseURL}, info) => {
    test.skip(info.project.name.endsWith('sombre'), 'parcours fonctionnel : un thème suffit');
    await preparer(page, context, baseURL);
  });

  test('client neuf, devis, acompte, solde, paiement, relance, avoir partiel et Factur-X', async ({page}, info) => {
    test.setTimeout(120000);
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await ouvrir(page, {bdoc: 'list', type: 'devis'});
    await expect(page.locator('.bd-list-screen')).toBeVisible();
    await pied(page).getByRole('button', {name: 'Nouveau devis'}).click();
    // Client neuf depuis la recherche
    const recherche = page.locator('#bd-client-q');
    await recherche.fill('Martin TP');
    await expect(page.locator('#bd-client-list')).toContainText('Aucun client trouvé');
    await page.locator('#bd-client-list [data-bdoc="client-new"]').click();
    const fiche = page.locator('#bd-client-form');
    await expect(fiche.locator('[name="name"]')).toHaveValue('Martin TP');
    await fiche.locator('[data-chip-target="kind"] [data-value="pro"]').click();
    await fiche.locator('[name="billingEmail"]').fill('compta@martin-tp.fr');
    await fiche.locator('[name="billingAddress"]').fill('12 rue des Artisans\n01000 Bourg-en-Bresse');
    await fiche.locator('[name="siren"]').fill('732 829 320');
    await fiche.locator('[name="vatNumber"]').fill('FR44732829320');
    await fiche.locator('[name="paymentDays"]').selectOption('30');
    await pied(page).getByRole('button', {name: 'Enregistrer'}).click();
    await expect(page.locator('.bd-client-card')).toContainText('Martin TP');
    // Catalogue (recherche par code) puis ligne libre
    await page.locator('[data-bdoc="panel"][data-panel="catalog"]').click();
    await page.locator('[name="catalogQuery"]').fill('PEL');
    await page.locator('#bd-cat-list [data-bdoc="catalog-pick"]').first().click();
    const premiere = page.locator('#bd-lines [data-line]').first();
    await expect(premiere.locator('[data-f="label"]')).toHaveValue('Pelle 8 t avec chauffeur');
    await premiere.locator('[data-f="quantity"]').fill('8');
    await page.locator('[data-bdoc="line-add"][data-kind="item"]').click();
    const seconde = page.locator('#bd-lines [data-line]').nth(1);
    await seconde.locator('[data-f="label"]').fill('Évacuation des terres');
    await seconde.locator('[data-f="unit"]').selectOption('forfait');
    await seconde.locator('[data-f="unitPrice"]').fill('450');
    await expect(page.locator('#bd-totals .is-grand')).toContainText('1 212,00');
    await expect(page.locator('.bd-compliance')).toContainText('Prêt à émettre');
    const devis = await emettre(page, 'Numéroter le devis');
    expect(devis).toMatch(/^D2026-\d{4}$/);
    await expect(modale(page).locator('.inv-pill')).toHaveText('Envoyé');
    // Acceptation
    await action(page, 'Accepter').click();
    await page.locator('#bd-accept-form [name="signatory"]').fill('Jean Martin');
    await pied(page).getByRole('button', {name: 'Enregistrer l’acceptation'}).click();
    await expect(modale(page).locator('.inv-pill')).toHaveText('Accepté');
    // Acompte de 30 %
    await action(page, 'Acompte').click();
    await expect(page.locator('#bd-deposit-note')).toContainText('363,60');
    await pied(page).getByRole('button', {name: 'Préparer l’acompte'}).click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    await page.locator('#bd-editor [name="subject"]').fill('Acompte terrassement');
    const acompte = await emettre(page, 'Émettre définitivement');
    expect(acompte).toMatch(/^F2026-\d{4}$/);
    // Facture de solde depuis le devis
    await modale(page).locator('.bd-facts [data-bdoc="open"]').first().click();
    await action(page, 'Facture de solde').click();
    await expect(page.locator('#bd-lines .is-deduction')).toHaveCount(1);
    await expect(page.locator('#bd-totals .is-grand')).toContainText('848,40');
    const solde = await emettre(page, 'Émettre définitivement');
    expect(solde).toMatch(/^F2026-\d{4}$/);
    // Paiement partiel
    await action(page, 'Encaisser').click();
    await page.locator('#bd-pay-form [name="amount"]').fill('400');
    await page.locator('#bd-pay-form [data-chip-target="method"] [data-value="cheque"]').click();
    await page.locator('#bd-pay-form [name="reference"]').fill('CHQ 2231');
    await expect(page.locator('#bd-pay-note')).toContainText('448,40');
    await pied(page).getByRole('button', {name: 'Enregistrer le paiement'}).click();
    await expect(modale(page).locator('.inv-pill')).toHaveText('Partiellement payée');
    await expect(modale(page).locator('.bd-doc-due')).toContainText('448,40');
    // Relance : le composeur de la messagerie prépare le lien mailto: (vérifié, jamais ouvert)
    await action(page, 'Relancer').click();
    await expect(page.locator('#bd-remind-form [data-chip-target="level"] .is-on')).toHaveAttribute('data-value', '1');
    await pied(page).getByRole('button', {name: 'Préparer la relance'}).click();
    await expect(page.locator('#msg-compose [name="subject"]')).toHaveValue(new RegExp(`Rappel : facture ${solde}`));
    await page.locator('[data-msg="prepare"]').click();
    const lien = page.locator('[data-msg-link]').first();
    const href = await lien.getAttribute('href');
    expect(href).toMatch(/^mailto:compta(@|%40)martin-tp\.fr\?subject=/);
    expect(decodeURIComponent(href)).toContain(`la facture n° ${solde}`);
    expect(decodeURIComponent(href)).toContain('448,40');
    await page.locator('[data-msg="mark-sent"]').first().click();
    await page.locator('[data-msg="send-done"]').click();
    await expect(modale(page).locator('.bd-timeline')).toContainText('Relance 1 par e-mail');
    // Avoir partiel : une heure de pelle
    await action(page, 'Avoir').click();
    await page.locator('#bd-credit-form [data-chip-target="mode"] [data-value="partiel"]').click();
    const ligne = page.locator('#bd-credit-form .bd-credit-line').first();
    await ligne.locator('[name="pick"]').check();
    await ligne.locator('input[inputmode="decimal"]').fill('1');
    await pied(page).getByRole('button', {name: 'Préparer l’avoir'}).click();
    await expect(page.locator('#bd-editor')).toBeVisible();
    await expect(page.locator('#bd-totals .is-grand')).toContainText('−84,00');
    const avoir = await emettre(page, 'Émettre définitivement');
    expect(avoir).toMatch(/^F2026-\d{4}$/);
    // Factur-X de l'avoir : contrôle local puis fichier téléchargé, revalidé ici
    await action(page, 'Factur-X').click();
    await expect(modale(page)).toContainText('Contrôles locaux réussis');
    const [telechargement] = await Promise.all([page.waitForEvent('download'), pied(page).getByRole('button', {name: 'Télécharger le XML'}).click()]);
    const xml = fs.readFileSync(await telechargement.path(), 'utf8');
    expect(xml).toContain('<rsm:CrossIndustryInvoice');
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>');
    const {validateFacturX} = await import('../billing-export.js');
    expect(validateFacturX(xml)).toEqual({ok: true, errors: []});
    // La facture de solde garde son historique complet
    await pied(page).getByRole('button', {name: 'Retour'}).click();
    await modale(page).locator('.bd-facts [data-bdoc="open"]').first().click();
    const frise = modale(page).locator('.bd-timeline');
    for (const etape of ['préparée en brouillon', 'Issu du devis', 'Émis sous le n°', 'Paiement de 400,00', 'Relance 1', 'Avoir']) await expect(frise).toContainText(etape);
    expect(erreurs, info.title).toEqual([]);
  });
});

test.describe('fiche client', () => {
  test.beforeEach(async ({page, context, baseURL}, info) => {
    test.skip(info.project.name.endsWith('sombre'), 'parcours fonctionnel : un thème suffit');
    await preparer(page, context, baseURL);
  });
  test('champs de facturation du formulaire client, contrôlés, puis repris dans un devis', async ({page}) => {
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'new-client'; b.hidden = true; document.body.append(b); b.click(); b.remove(); });
    const f = page.locator('#client-form');
    await f.locator('[name="name"]').fill('SCEA des Prés');
    await f.locator('details.client-billing summary').click();
    await f.locator('[data-chip-target="kind"] [data-value="pro"]').click();
    await f.locator('[name="siren"]').fill('12345');
    await f.locator('[name="paymentDays"]').selectOption('45');
    await page.locator('#save-client').click();
    await expect(f.locator('.form-error')).toHaveText(/SIREN invalide/);
    await expect(f.locator('[name="siren"]')).toBeFocused();
    await f.locator('[name="siren"]').fill('732829320');
    await f.locator('[name="billingEmail"]').fill('compta@scea-pres.fr');
    await f.locator('[name="billingAddress"]').fill('Les Prés\n01340 Malafretaz');
    await f.locator('[name="discountPct"]').fill('3');
    await page.locator('#save-client').click();
    // Fiche client : boutons Documents et Devis (module chargé à la demande)
    await page.locator('#modal-root [data-bdoc="new"][data-type="devis"]').click();
    await expect(page.locator('.bd-client-card')).toContainText('SCEA des Prés');
    await expect(page.locator('.bd-client-card')).toContainText('compta@scea-pres.fr');
    await expect(page.locator('#bd-editor [name="discountValue"]')).toHaveValue('3');
    const client = await page.evaluate(async () => { const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js'); const s = new Store(new StorageService()); await s.init(); return s.state.clients.find(c => c.name === 'SCEA des Prés'); });
    expect([client.kind, client.siren, client.paymentDays, client.discountPct, client.billingEmail]).toEqual(['pro', '732829320', 45, 3, 'compta@scea-pres.fr']);
    expect(erreurs).toEqual([]);
  });
});

test.describe('captures', () => {
  test.beforeEach(async ({page, context, baseURL}) => {
    await preparer(page, context, baseURL, {documents: true, visuel: true});
  });
  const ids = page => page.evaluate(async () => { const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js'); const s = new Store(new StorageService()); await s.init(); return s.state.preferences.billingDocsDemo; });
  async function stable(page) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(500);
  }
  test('liste des factures', async ({page}) => {
    await ouvrir(page, {bdoc: 'list', type: 'facture'});
    await expect(page.locator('#bd-rows .bd-row')).toHaveCount(3);
    await stable(page);
    await expect(page).toHaveScreenshot('facturation-liste.png', {mask: [page.locator('#build-label')]});
  });
  test('fiche d’une facture', async ({page}) => {
    const {facture} = await ids(page);
    await ouvrir(page, {bdoc: 'open', id: facture});
    await expect(modale(page).locator('.bd-timeline')).toBeVisible();
    await stable(page);
    await expect(page).toHaveScreenshot('facturation-fiche.png', {mask: [page.locator('#build-label'), page.locator('.bd-preview-frame')]});
  });
  // Accessibilité des écrans remplis (axe-core, WCAG 2.1 AA) : aucune violation « serious » ou « critical ».
  test('accessibilité des écrans remplis', async ({page}) => {
    const axe = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
    const {facture, devis, accepte} = await ids(page);
    const verifier = async nom => {
      await page.waitForTimeout(250);
      await page.evaluate(axe);
      const graves = await page.evaluate(async () => (await window.axe.run({include: ['#modal-root']}, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa']}, resultTypes: ['violations']})).violations
        .filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id} : ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
      expect(graves, nom).toEqual([]);
    };
    await ouvrir(page, {bdoc: 'list', type: 'all'}); await expect(page.locator('#bd-rows .bd-row').first()).toBeVisible(); await verifier('liste');
    await ouvrir(page, {bdoc: 'open', id: facture}); await expect(modale(page).locator('.bd-timeline')).toBeVisible(); await verifier('fiche');
    await action(page, 'Encaisser').click(); await expect(page.locator('#bd-pay-form')).toBeVisible(); await verifier('paiement');
    await ouvrir(page, {bdoc: 'act', act: 'remind', id: facture}); await expect(page.locator('#bd-remind-form')).toBeVisible(); await verifier('relance');
    await ouvrir(page, {bdoc: 'act', act: 'credit', id: facture}); await page.locator('#bd-credit-form [data-value="partiel"]').click(); await verifier('avoir partiel');
    await ouvrir(page, {bdoc: 'act', act: 'deposit', id: accepte}); await expect(page.locator('#bd-deposit-note')).not.toBeEmpty(); await verifier('acompte');
    await ouvrir(page, {bdoc: 'open', id: accepte}); await expect(modale(page).locator('.bd-progress')).toBeVisible(); await verifier('fiche devis accepté');
    await ouvrir(page, {bdoc: 'open', id: devis}); await expect(page.locator('#bd-editor')).toBeVisible();
    await page.locator('[data-bdoc="panel"][data-panel="catalog"]').click(); await page.locator('#bd-quick-box summary').click(); await verifier('éditeur');
    await page.locator('[data-bdoc="client-change"]').click(); await page.locator('#bd-client-q').fill('gaec'); await expect(page.locator('#bd-client-list')).toBeVisible(); await verifier('choix du client');
  });
  test('saisie rapide : client reconnu, lignes proposées puis validées, prix habituel', async ({page}, info) => {
    test.skip(info.project.name.endsWith('sombre'), 'fonctionnel : un thème suffit');
    await ouvrir(page, {bdoc: 'list', type: 'devis'});
    await page.locator('#bd-quick-list [name="quick"]').fill('devis gaec bois 3 h de pelle 8 t avec chauffeur et 12 t de cailloux 0/31,5');
    await page.locator('[data-bdoc="quick-new"]').click();
    await expect(page.locator('.bd-client-card')).toContainText('GAEC du Bois Joli');
    const propositions = page.locator('#bd-quick-result .bd-proposal');
    await expect(propositions).toHaveCount(2);
    await expect(propositions.first()).toContainText('70,00');
    await page.locator('[data-bdoc="quick-apply"]').click();
    await expect(page.locator('#bd-lines [data-line]')).toHaveCount(2);
    await expect(page.locator('#bd-totals .is-grand')).toContainText('511,20');
    await expect(page.locator('#bd-save-state')).toHaveText(/^Brouillon enregistré à/, {timeout: 8000});
  });
  test('éditeur d’un devis', async ({page}) => {
    const {devis} = await ids(page);
    await ouvrir(page, {bdoc: 'open', id: devis});
    await expect(page.locator('#bd-editor')).toBeVisible();
    await expect(page.locator('.bd-compliance')).toBeVisible();
    await stable(page);
    await expect(page).toHaveScreenshot('facturation-editeur.png', {mask: [page.locator('#build-label'), page.locator('.bd-preview-frame')]});
  });
});
