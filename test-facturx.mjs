// Factures électroniques fournisseurs (facturx.js) : XML CII et UBL, PDF Factur-X, passage vers le stock.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {parseXml, parseInvoiceXml, extractEmbeddedXml, readElectronicInvoice, invoiceToExtraction, invoiceToParsed} from './facturx.js';
import {docExtractSummary} from './doc-text.js';
import {treasuryFlows} from './treasury.js';
import {emptyState} from './state.js';
import {validateExtraction} from './stock-capture.js';

export const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>FA-2026-0412</ram:ID><ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20261105</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedTradeProduct><ram:GlobalID schemeID="0160">3760000000017</ram:GlobalID><ram:Name>Ammonitrate 27 &amp; soufre</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>420.00</ram:ChargeAmount><ram:BasisQuantity unitCode="TNE">1</ram:BasisQuantity></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="TNE">2.5</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>1050.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedTradeProduct><ram:Name>Fongix Fictif 5 L</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>180</ram:ChargeAmount><ram:BasisQuantity unitCode="LTR">10</ram:BasisQuantity></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="LTR">20</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Coopérative Fictive</ram:Name><ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">123456789</ram:ID></ram:SpecifiedLegalOrganization></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>EARL Exemple</ram:Name></ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax><ram:CalculatedAmount>282.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>1410.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261205</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:TaxBasisTotalAmount>1410.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">282.00</ram:TaxTotalAmount><ram:GrandTotalAmount>1692.00</ram:GrandTotalAmount><ram:DuePayableAmount>1692.00</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-889</cbc:ID><cbc:IssueDate>2026-10-02</cbc:IssueDate><cbc:DueDate>2026-11-01</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Négoce Fictif</cbc:Name></cac:PartyName><cac:PartyLegalEntity><cbc:RegistrationName>SAS Négoce Fictif</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">11.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">200.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">11.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>5.5</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">200.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">211.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">211.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="XBG">8</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">200.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Semence blé tendre 25 kg</cbc:Name><cac:SellersItemIdentification><cbc:ID>SB-25</cbc:ID></cac:SellersItemIdentification></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">25.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;

// PDF minimal Factur-X : la pièce jointe est un flux FlateDecode avec /Params et une somme de contrôle hexadécimale.
export function facturxPdf(xml, {length = true} = {}) {
  const body = zlib.deflateSync(Buffer.from(xml, 'utf8'));
  const head = Buffer.from(`%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `4 0 obj\n<< /Length 12 /Filter /FlateDecode >>\nstream\n`, 'latin1');
  const junk = zlib.deflateSync(Buffer.from('BT /F1 12 Tf (Facture) Tj ET'));
  const mid = Buffer.from(`\nendstream\nendobj\n5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode ${length ? `/Length ${body.length} ` : ''}/Params << /Size ${xml.length} /CheckSum <0A1B2C3D> /ModDate (D:20261105) >> >>\nstream\n`, 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
  return new Uint8Array(Buffer.concat([head, junk, mid, body, tail]));
}

test('XML : préfixes ignorés, entités, attributs, document mal formé refusé', () => {
  const root = parseXml('<a:x k="1 &amp; 2"><b:y>t&lt;u</b:y><b:z/></a:x>');
  assert.equal(root.children[0].name, 'x');
  assert.equal(root.children[0].attrs.k, '1 & 2');
  assert.equal(root.children[0].children[0].text, 't<u');
  assert.throws(() => parseXml('<a><b></a>'), /mal formé/);
  assert.throws(() => parseXml('<a><b>'), /incomplet/);
});

test('CII (Factur-X EN 16931) : en-tête, lignes, prix ramené à l’unité, unités UN/ECE', () => {
  const inv = parseInvoiceXml(CII);
  assert.equal(inv.format, 'CII');
  assert.equal(inv.number, 'FA-2026-0412');
  assert.equal(inv.date, '2026-11-05');
  assert.equal(inv.dueDate, '2026-12-05');
  assert.equal(inv.fournisseur, 'Coopérative Fictive');
  assert.equal(inv.sellerSiren, '123456789');
  assert.deepEqual([inv.totalHt, inv.totalTva, inv.totalTtc], [1410, 282, 1692]);
  assert.equal(inv.lignes.length, 2);
  assert.deepEqual(inv.lignes[0], {produit: 'Ammonitrate 27 & soufre', quantité: 2.5, unité: 't', prix: 420, ean: '3760000000017', ref: '', total: 1050});
  assert.equal(inv.lignes[1].prix, 18, '180 € les 10 L → 18 €/L');
  assert.equal(inv.lignes[1].unité, 'L');
});

test('UBL : fournisseur (raison sociale), lignes, montants', () => {
  const inv = parseInvoiceXml(UBL);
  assert.equal(inv.format, 'UBL');
  assert.equal(inv.fournisseur, 'SAS Négoce Fictif');
  assert.equal(inv.dueDate, '2026-11-01');
  assert.deepEqual(inv.lignes, [{produit: 'Semence blé tendre 25 kg', quantité: 8, unité: 'sac', prix: 25, ean: '', ref: 'SB-25', total: 200}]);
  assert.deepEqual([inv.totalHt, inv.totalTva, inv.totalTtc], [200, 11, 211]);
  assert.throws(() => parseInvoiceXml('<Order/>'), /pas une facture/);
});

test('PDF Factur-X : XML embarqué retrouvé, avec ou sans /Length direct ; PDF sans pièce jointe : null', async () => {
  assert.equal(await extractEmbeddedXml(facturxPdf(CII)), CII);
  assert.equal(await extractEmbeddedXml(facturxPdf(CII, {length: false})), CII);
  const plain = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 5 >>\nstream\nhello\nendstream\nendobj\n%%EOF', 'latin1'));
  assert.equal(await extractEmbeddedXml(plain), null);
});

test('fichier reçu → lignes de stock validées (même chemin que la lecture d’une photo)', async () => {
  const pdf = new File([facturxPdf(CII)], 'facture.pdf', {type: 'application/pdf'});
  const inv = await readElectronicInvoice(pdf);
  assert.equal(inv.source, 'pdf');
  const lines = validateExtraction(invoiceToExtraction(inv));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].product, 'Ammonitrate 27 & soufre');
  assert.equal(lines[0].quantity, 2.5);
  assert.equal(lines[0].unitPrice, 420);
  assert.equal(lines[0].supplier, 'Coopérative Fictive');
  const xml = await readElectronicInvoice(new File([UBL], 'f.xml', {type: 'text/xml'}));
  assert.equal(xml.source, 'xml');
  assert.equal(await readElectronicInvoice(new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {type: 'image/jpeg'})), null);
});

test('TVA par taux et récapitulatif rangé avec le document (solde de TVA)', async () => {
  const cii = parseInvoiceXml(CII);
  assert.deepEqual(cii.tva, [{taux: 20, base: 1410, montant: 282}]);
  assert.deepEqual(parseInvoiceXml(UBL).tva, [{taux: 5.5, base: 200, montant: 11}]);
  const parsed = invoiceToParsed(cii, validateExtraction);
  assert.equal(parsed.lignes[0].amount, 1050);
  assert.deepEqual(docExtractSummary(parsed), {kind: 'facture', numero: 'FA-2026-0412', date: '2026-11-05', totalHT: 1410, totalTTC: 1692, tva: [{taux: 20, base: 1410, montant: 282}], echeance: '2026-12-05', fournisseur: 'Coopérative Fictive', aPayer: 1692});
  // Avoir : montants négatifs (la TVA se retranche du solde), aucune ligne de stock.
  const credit = invoiceToParsed({...cii, credit: true}, validateExtraction);
  assert.match(credit.warnings[0], /Avoir/);
  assert.deepEqual(credit.lignes, []);
  assert.deepEqual(docExtractSummary(credit), {kind: 'facture', numero: 'FA-2026-0412', date: '2026-11-05', totalHT: -1410, totalTTC: -1692, tva: [{taux: 20, base: -1410, montant: -282}], echeance: '2026-12-05', fournisseur: 'Coopérative Fictive', aPayer: -1692});
});

const withLines = (lines, typeCode = '380') => CII.replace(/<ram:TypeCode>380<\/ram:TypeCode>/, `<ram:TypeCode>${typeCode}</ram:TypeCode>`)
  .replace(/<ram:IncludedSupplyChainTradeLineItem>[\s\S]*<\/ram:IncludedSupplyChainTradeLineItem>/, lines.map(([name, qty, price, total]) => `<ram:IncludedSupplyChainTradeLineItem><ram:SpecifiedTradeProduct><ram:Name>${name}</ram:Name></ram:SpecifiedTradeProduct>
    <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${price}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
    <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
    <ram:SpecifiedLineTradeSettlement><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${total}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`).join(''));

test('relecture : ligne écartée sans décaler les montants, remise de ligne, codes d’avoir', () => {
  const inv = parseInvoiceXml(withLines([['Bidons consignés', -2, 5, -10], ['Herbicide', 5, 30, 150]]));
  const parsed = invoiceToParsed(inv, validateExtraction);
  assert.deepEqual(parsed.lignes.map(l => [l.product, l.amount]), [['Herbicide', 150]]);
  assert.match(parsed.warnings[0], /1 ligne sans quantité positive/);
  // Remise de 50 € sur 2,5 t à 380 € : 900 € payés, donc 360 €/t au stock.
  assert.equal(parseInvoiceXml(withLines([['Ammonitrate', 2.5, 380, 900]])).lignes[0].prix, 360);
  assert.equal(parseInvoiceXml(withLines([['Ammonitrate', 2.5, 380, 950]])).lignes[0].prix, 380);
  for (const code of ['381', '261', '262', '396', '532']) assert.equal(parseInvoiceXml(withLines([['x', 1, 1, 1]], code)).credit, true, code);
  assert.equal(parseInvoiceXml(withLines([['x', 1, 1, 1]], '380')).credit, false);
});

test('relecture PDF : /Length indirecte à plusieurs chiffres, flux hostile sans blocage', async () => {
  for (const ref of ['7 0 R', '12 0 R', '123 0 R']) {
    const pdf = Buffer.from(facturxPdf(CII, {length: false})).toString('latin1').replace('/Filter /FlateDecode /Params', `/Filter /FlateDecode /Length ${ref} /Params`);
    assert.equal(await extractEmbeddedXml(new Uint8Array(Buffer.from(pdf, 'latin1'))), CII, ref);
  }
  const hostile = facturxPdf('<Invoice '.repeat(110000));
  const t = performance.now();
  assert.equal(await extractEmbeddedXml(hostile), null);
  assert.ok(performance.now() - t < 2000, `${Math.round(performance.now() - t)} ms`);
});

test('relecture XML : documents hostiles refusés vite, entité hors plage gardée', () => {
  for (const x of ['<a>' + 'x<![CDATA['.repeat(50000), '<a>' + 'x<!--'.repeat(50000), '<a>' + 'x<?'.repeat(50000), '<a><b x="' + '>'.repeat(200000), '<a>'.repeat(5000)]) {
    const t = performance.now();
    assert.throws(() => parseXml(x));
    assert.ok(performance.now() - t < 500, `${Math.round(performance.now() - t)} ms`);
  }
  assert.equal(parseXml('<a>&#x110000;&#65;</a>').children[0].text, '&#x110000;A');
  assert.equal(parseXml('<a><b x="1 > 0"/></a>').children[0].children[0].attrs.x, '1 > 0');
});

test('trésorerie : facture fournisseur à payer à l’échéance, avoir en déduction, entrées de stock non recomptées', () => {
  const cii = parseInvoiceXml(CII), extract = docExtractSummary(invoiceToParsed(cii, validateExtraction));
  const credit = docExtractSummary(invoiceToParsed({...cii, number: 'AV-1', credit: true, dueDate: '2027-01-10'}, validateExtraction));
  const s = emptyState();
  s.documents = [{id: 'd1', name: 'fa.pdf', purchaseKey: 'k1', docExtract: extract}, {id: 'd2', name: 'av.pdf', docExtract: credit},
    {id: 'd3', name: 'old.pdf', docExtract: {...extract, numero: 'OLD', echeance: '2026-10-01'}}];
  s.stockItems = [{id: 'i1', name: 'Ammonitrate', unit: 't'}];
  s.stockMovements = [{id: 'm1', stockItemId: 'i1', type: 'Entrée', quantity: 2.5, unitPrice: 420, date: '2026-11-14', note: 'Facture : Ammonitrate', purchaseKey: 'k1', purchaseVat: extract}];
  const {lines} = treasuryFlows(s, {start: '2026-11', today: '2026-11-14'});
  const rows = lines.filter(l => l.source === 'fournisseur' || l.source === 'appro').map(l => [l.source, l.month, l.amount, l.label]);
  assert.deepEqual(rows, [
    ['fournisseur', '2026-12', -1692, 'Facture fournisseur · Coopérative Fictive n° FA-2026-0412'],
    ['fournisseur', '2027-01', 1692, 'Facture fournisseur · Coopérative Fictive n° AV-1']]);
});

test('trésorerie (relecture) : une fois par facture, reste à payer, devise, entrée sans échéance gardée', () => {
  const cii = parseInvoiceXml(CII), x = docExtractSummary(invoiceToParsed(cii, validateExtraction));
  const base = () => { const s = emptyState(); s.stockItems = [{id: 'i1', name: 'Ammo', unit: 't'}]; return s; };
  const fournisseur = s => treasuryFlows(s, {start: '2026-11', today: '2026-11-14'}).lines.filter(l => l.source === 'fournisseur' || l.source === 'appro').map(l => [l.source, l.amount]);
  // Même facture rangée deux fois (partage puis photo) : comptée une fois.
  let s = base(); s.documents = [{id: 'd1', docExtract: x}, {id: 'd2', docExtract: x}];
  assert.deepEqual(fournisseur(s), [['fournisseur', -1692]]);
  // Déjà payée (reste 0) : rien ; acompte : le reste seulement.
  s = base(); s.documents = [{id: 'd1', docExtract: {...x, aPayer: 0}}, {id: 'd2', docExtract: {...x, numero: 'B', aPayer: 500}}];
  assert.deepEqual(fournisseur(s), [['fournisseur', -500]]);
  // Devise étrangère : écartée et signalée.
  s = base(); s.documents = [{id: 'd1', docExtract: {...x, devise: 'USD'}}];
  const r = treasuryFlows(s, {start: '2026-11', today: '2026-11-14'});
  assert.equal(r.lines.filter(l => l.source === 'fournisseur').length, 0);
  assert.equal(r.missing.currency, 1);
  // Entrée « Facture : » sans facture à échéance (extraction distante) : reste un achat d'appro.
  s = base(); s.stockMovements = [{id: 'm1', stockItemId: 'i1', type: 'Entrée', quantity: 2, unitPrice: 400, date: '2026-11-14', note: 'Facture : Ammo'}];
  assert.deepEqual(fournisseur(s), [['appro', -800]]);
  // Achat lu avec échéance, sans document rangé : l'échéance vient de l'entrée, l'achat n'est pas recompté.
  s = base(); s.stockMovements = [{id: 'm1', stockItemId: 'i1', type: 'Entrée', quantity: 2.5, unitPrice: 420, date: '2026-11-14', note: 'Facture : Ammo', purchaseKey: 'k9', purchaseVat: {...x, supplier: 'Coopérative Fictive'}}];
  assert.deepEqual(fournisseur(s), [['fournisseur', -1692]]);
});
