// Jeu de facturation fictif des tests Playwright du centre Facturation (v13) : exécuté DANS la page
// (page.evaluate), donc sans rien capturer de ce module. Profil de navigateur vierge uniquement.
// Exécuté dans la page : réglages, trois clients, factures émises (payée, en retard, partielle), devis,
// catalogue et modèle récurrent dû. Dates fixes (horloge au 12 mai 2026).
export async function semerFacturation() {
  const {Store} = await import('./state.js'); const {StorageService} = await import('./storage.js');
  const inv = await import('./invoices.js'); const bil = await import('./billing.js');
  const s = new Store(new StorageService()); await s.init();
  if (s.state.integrationImports.some(r => r.farmKind === 'invoice')) return false;
  await inv.saveSettings(s, {legalName: 'EARL du Sougey', legalForm: 'EARL', capital: '7 500 €', rcs: 'RCS Bourg-en-Bresse', address: '1 route du Sougey\n01340 Montrevel', siret: '73282932000074', vatNumber: 'FR12732829320', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP', paymentDays: 30, vatRate: 20, prefix: 'F'});
  await s.upsertMany('clients', [
    {id: 'c1', name: 'GAEC du Bois', address: 'Le Bois\n01000 Bourg-en-Bresse', contact: 'Paul Martin', email: 'gaec@exemple.fr', phone: '06 12 34 56 78', kind: 'pro', siren: '732829320'},
    {id: 'c2', name: 'Mme Durand', address: '3 rue Haute\n01340 Foissiat', email: 'durand@exemple.fr', kind: 'particulier'},
    {id: 'c3', name: 'SCEA des Prés', address: 'Les Prés\n01340 Malafretaz', email: 'scea@exemple.fr', kind: 'pro', siren: '552100554'}
  ]);
  const L = (label, quantity, unitPrice, unit = 'h') => ({label, quantity, unit, unitPrice, vatRate: 20});
  const emit = async (clientId, today, lines, docType = 'facture') => { const d = await inv.createDraft(s, {clientId, docType, lines, today}); return inv.emitDocument(s, d.id, {today}); };
  const f1 = await emit('c1', '2026-01-15', [L('Labour', 10, 65)]); // 780 TTC, payée le 10 février
  await inv.addPayment(s, f1.id, {date: '2026-02-10', amount: 780, method: 'virement'});
  await emit('c1', '2026-03-02', [L('Pressage', 8, 50)]); // 480 TTC, échue le 1er avril
  await emit('c1', '2026-03-20', [L('Broyage', 5, 60)]); // 360 TTC, échue le 19 avril
  await emit('c2', '2026-04-01', [L('Fauche', 4, 50)]); // 240 TTC, échue le 1er mai
  const f5 = await emit('c3', '2026-05-05', [L('Transport', 10, 100)]); // 1 200 TTC, acompte de 200
  await inv.addPayment(s, f5.id, {date: '2026-05-08', amount: 200, method: 'cheque'});
  const q1 = await inv.createDraft(s, {clientId: 'c3', docType: 'devis', lines: [L('Terrassement', 20, 70)], today: '2026-04-20', extra: {validUntil: '2026-05-15'}});
  await inv.emitDocument(s, q1.id, {today: '2026-04-20'});
  await bil.saveCatalogItem(s, {code: 'PELLE', label: 'Pelle mécanique avec chauffeur', unit: 'h', unitPrice: 65, vatRate: 20, category: 'Terrassement', clientPrices: [{clientId: 'c1', unitPrice: 60}]});
  await bil.saveCatalogItem(s, {code: 'LABOUR', label: 'Labour', unit: 'ha', unitPrice: 95, vatRate: 20, category: 'Travaux des champs'});
  await bil.saveSchedule(s, {clientId: 'c2', label: 'Pension des génisses', frequency: 'mensuel', nextDate: '2026-05-01', lines: [{label: 'Pension (10 génisses)', quantity: 10, unit: 'u', unitPrice: 30, vatRate: 10}]});
  return true;
}
