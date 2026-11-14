// Factures électroniques fournisseurs (n° chantier 12), lues hors ligne et sans dépendance :
// - Factur-X / ZUGFeRD : PDF/A-3 qui embarque un XML CII (factur-x.xml, zugferd-invoice.xml…) ;
// - XML seul : CII (CrossIndustryInvoice) ou UBL (Invoice), formats de la réception obligatoire depuis septembre 2026.
// Le résultat a la forme attendue par validateExtraction (stock-capture.js) : {fournisseur, lignes:[{produit,
// quantité, unité, prix}]}, plus l'en-tête de la facture (numéro, dates, montants) pour le récapitulatif.
// Profils MINIMUM et BASIC WL : pas de lignes, seulement l'en-tête.

const MAX_STREAMS = 400, MAX_INFLATED = 5 * 1024 * 1024;

// ---------- XML : petit analyseur tolérant (préfixes d'espace de noms ignorés) ----------
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
// Entité numérique hors de la plage Unicode : laissée telle quelle plutôt qu'une erreur technique.
const codePoint = (m, n) => (Number.isInteger(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m);
const decodeEntities = s => s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,9}|[a-z]{2,6});/gi, (m, e) => e[0] === '#'
  ? codePoint(m, e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m);
const local = name => name.slice(name.indexOf(':') + 1);
export const MAX_XML_CHARS = 8 * 1024 * 1024, MAX_XML_DEPTH = 200;

/**
 * Arbre {name, attrs, children, text} ; name sans préfixe. Lève une erreur sur un document mal formé.
 * Lecture en un seul passage (indexOf), sans expression régulière à retour arrière : un fichier hostile ou abîmé
 * (CDATA, commentaire ou guillemet jamais fermés) ne peut pas figer l'onglet.
 */
export function parseXml(xml) {
  const src = String(xml ?? '');
  if (src.length > MAX_XML_CHARS) throw new Error('XML trop volumineux.');
  const root = {name: '#root', attrs: {}, children: [], text: ''}, stack = [root];
  const upTo = (from, token) => { const j = src.indexOf(token, from); if (j < 0) throw new Error('XML incomplet.'); return j; };
  let i = 0;
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const lt = src.indexOf('<', i);
    if (lt < 0) { top.text += decodeEntities(src.slice(i)); break; }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<![CDATA[', lt)) { const j = upTo(lt + 9, ']]>'); top.text += src.slice(lt + 9, j); i = j + 3; continue; }
    if (src.startsWith('<!--', lt)) { i = upTo(lt + 4, '-->') + 3; continue; }
    if (src.startsWith('<?', lt)) { i = upTo(lt + 2, '?>') + 2; continue; }
    if (src.startsWith('<!', lt)) { i = upTo(lt + 2, '>') + 1; continue; } // DOCTYPE : sans sous-ensemble interne
    // Fin de la balise : premier « > » hors guillemets (une valeur d'attribut peut contenir « > »). Un seul passage.
    let end = lt + 1, quote = '';
    for (; end < src.length; end++) {
      const c = src[end];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    if (end >= src.length) throw new Error('XML incomplet.');
    const tag = src.slice(lt + 1, end);
    i = end + 1;
    if (tag[0] === '/') {
      const name = local(tag.slice(1).trim());
      if (stack.length < 2 || top.name !== name) throw new Error('XML mal formé.');
      stack.pop(); continue;
    }
    const selfClosing = tag.endsWith('/'), body = selfClosing ? tag.slice(0, -1) : tag;
    const nameEnd = body.search(/[\s]/), rawName = nameEnd < 0 ? body : body.slice(0, nameEnd);
    if (!rawName) throw new Error('XML mal formé.');
    const attrs = {};
    for (const a of (nameEnd < 0 ? '' : body.slice(nameEnd)).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decodeEntities(a[2] ?? a[3]);
    const node = {name: local(rawName), attrs, children: [], text: ''};
    top.children.push(node);
    if (!selfClosing) { if (stack.length > MAX_XML_DEPTH) throw new Error('XML trop profond.'); stack.push(node); }
  }
  if (stack.length !== 1) throw new Error('XML incomplet.');
  return root;
}
const kids = (node, name) => (node?.children || []).filter(c => c.name === name);
/** Premier nœud au bout du chemin « A/B/C » (noms locaux). */
const at = (node, path) => path.split('/').reduce((n, part) => n && kids(n, part)[0], node) || null;
const txt = (node, path) => { const n = path ? at(node, path) : node; return n ? n.text.replace(/\s+/g, ' ').trim() : ''; };
const amount = (node, path) => { const s = txt(node, path).replace(',', '.'); const n = Number(s); return s && Number.isFinite(n) ? n : null; };

// Date CII format 102 (AAAAMMJJ) ou ISO.
const isoOf = s => { const v = String(s || '').trim(); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ''; };

// Unités UN/ECE (recommandation 20) les plus courantes en agrofourniture.
export const UNIT_CODES = Object.freeze({C62: 'u', H87: 'u', EA: 'u', XPP: 'u', KGM: 'kg', GRM: 'g', TNE: 't', LTR: 'L', MLT: 'mL', MTQ: 'm³', MTK: 'm²',
  MTR: 'm', HAR: 'ha', DZN: 'douzaine', XBG: 'sac', XBX: 'carton', XPA: 'paquet', XPX: 'palette', XCN: 'bidon', HUR: 'h', DAY: 'j', KWH: 'kWh'});
const unitOf = code => UNIT_CODES[String(code || '').toUpperCase()] || String(code || '');
// Avoirs EN 16931 : 381 (avoir), 261, 262, 396, 532 ; UBL : élément racine CreditNote.
export const CREDIT_CODES = new Set(['381', '261', '262', '396', '532']);
const round4 = n => Math.round(n * 10000) / 10000;
/**
 * Prix unitaire effectif : prix net ramené à l'unité, sauf si le montant net de la ligne (BT-131) dit autre chose
 * (remise ou frais de ligne, BG-27/BG-28) : alors montant / quantité, pour valoriser le stock au prix réellement payé.
 */
function unitPrice(price, basis, qty, total) {
  const net = price === null ? null : price / (basis || 1);
  if (total !== null && qty !== null && qty > 0) {
    const fromTotal = total / qty;
    if (net === null || Math.abs(total - net * qty) > Math.max(0.01, Math.abs(total) * 0.005)) return round4(fromTotal);
  }
  return net === null ? null : round4(net);
}

function fromCii(root) {
  const doc = at(root, 'CrossIndustryInvoice');
  const trade = at(doc, 'SupplyChainTradeTransaction'), agreement = at(trade, 'ApplicableHeaderTradeAgreement'), settlement = at(trade, 'ApplicableHeaderTradeSettlement');
  const totals = at(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const lignes = kids(trade, 'IncludedSupplyChainTradeLineItem').map(li => {
    const qty = at(li, 'SpecifiedLineTradeDelivery/BilledQuantity'), price = at(li, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice');
    const total = amount(li, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount'), quantity = amount(qty);
    return {produit: txt(li, 'SpecifiedTradeProduct/Name'), quantité: quantity, unité: unitOf(qty?.attrs.unitCode),
      prix: unitPrice(amount(price, 'ChargeAmount'), amount(price, 'BasisQuantity'), quantity, total), ean: txt(li, 'SpecifiedTradeProduct/GlobalID'),
      ref: txt(li, 'SpecifiedTradeProduct/SellerAssignedID'), total};
  });
  return {format: 'CII', number: txt(doc, 'ExchangedDocument/ID'), typeCode: txt(doc, 'ExchangedDocument/TypeCode'),
    date: isoOf(txt(doc, 'ExchangedDocument/IssueDateTime/DateTimeString')),
    dueDate: isoOf(txt(settlement, 'SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString')),
    fournisseur: txt(agreement, 'SellerTradeParty/Name'), sellerSiren: txt(agreement, 'SellerTradeParty/SpecifiedLegalOrganization/ID'),
    client: txt(agreement, 'BuyerTradeParty/Name'), currency: txt(settlement, 'InvoiceCurrencyCode') || 'EUR',
    totalHt: amount(totals, 'TaxBasisTotalAmount'), totalTva: amount(totals, 'TaxTotalAmount'), totalTtc: amount(totals, 'GrandTotalAmount'),
    dueAmount: amount(totals, 'DuePayableAmount'), lignes,
    tva: kids(settlement, 'ApplicableTradeTax').map(t => ({taux: amount(t, 'RateApplicablePercent'), base: amount(t, 'BasisAmount'), montant: amount(t, 'CalculatedAmount')})).filter(t => t.taux !== null)};
}

function fromUbl(root) {
  const doc = at(root, 'Invoice') || at(root, 'CreditNote'), credit = Boolean(at(root, 'CreditNote'));
  const party = p => txt(doc, `${p}/Party/PartyLegalEntity/RegistrationName`) || txt(doc, `${p}/Party/PartyName/Name`);
  const totals = at(doc, 'LegalMonetaryTotal');
  const lignes = [...kids(doc, 'InvoiceLine'), ...kids(doc, 'CreditNoteLine')].map(li => {
    const qty = at(li, 'InvoicedQuantity') || at(li, 'CreditedQuantity'), quantity = amount(qty), total = amount(li, 'LineExtensionAmount');
    return {produit: txt(li, 'Item/Name'), quantité: quantity, unité: unitOf(qty?.attrs.unitCode),
      prix: unitPrice(amount(li, 'Price/PriceAmount'), amount(li, 'Price/BaseQuantity'), quantity, total),
      ean: txt(li, 'Item/StandardItemIdentification/ID'), ref: txt(li, 'Item/SellersItemIdentification/ID'), total};
  });
  return {format: 'UBL', number: txt(doc, 'ID'), typeCode: credit ? '381' : txt(doc, 'InvoiceTypeCode'), date: isoOf(txt(doc, 'IssueDate')),
    dueDate: isoOf(txt(doc, 'DueDate') || txt(doc, 'PaymentMeans/PaymentDueDate')), fournisseur: party('AccountingSupplierParty'),
    sellerSiren: txt(doc, 'AccountingSupplierParty/Party/PartyLegalEntity/CompanyID'), client: party('AccountingCustomerParty'),
    currency: txt(doc, 'DocumentCurrencyCode') || 'EUR', totalHt: amount(totals, 'TaxExclusiveAmount'), totalTva: amount(doc, 'TaxTotal/TaxAmount'),
    totalTtc: amount(totals, 'TaxInclusiveAmount'), dueAmount: amount(totals, 'PayableAmount'), lignes,
    tva: kids(at(doc, 'TaxTotal'), 'TaxSubtotal').map(t => ({taux: amount(t, 'TaxCategory/Percent'), base: amount(t, 'TaxableAmount'), montant: amount(t, 'TaxAmount')})).filter(t => t.taux !== null)};
}

/** XML de facture (CII ou UBL) → facture lue. Lève une erreur si ce n'est pas une facture reconnue. */
export function parseInvoiceXml(xml) {
  const root = parseXml(String(xml || '').replace(/^﻿/, ''));
  const first = root.children[0]?.name;
  const invoice = first === 'CrossIndustryInvoice' ? fromCii(root) : first === 'Invoice' || first === 'CreditNote' ? fromUbl(root) : null;
  if (!invoice) throw new Error('Ce XML n’est pas une facture CII (Factur-X) ni UBL.');
  invoice.credit = CREDIT_CODES.has(String(invoice.typeCode || '').trim());
  invoice.lignes = invoice.lignes.filter(l => l.produit);
  return invoice;
}

// ---------- PDF : flux embarqués ----------
const latin1 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };

async function inflate(bytes) {
  // Format zlib (FlateDecode) : « deflate » pour DecompressionStream. Octets en trop après la fin : ignorés.
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      parts.push(value); size += value.length;
      if (size > MAX_INFLATED) throw new Error('Pièce jointe trop volumineuse.');
    }
  } catch (error) { if (!size || /volumineuse/.test(error.message)) throw error; }
  const out = new Uint8Array(size); let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/**
 * XML de facture embarqué dans un PDF (Factur-X, ZUGFeRD, Order-X ignoré), ou null.
 * Les flux « EmbeddedFile » sont lus d'abord ; à défaut, tout flux compressé dont le contenu est une facture.
 */
export async function extractEmbeddedXml(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = latin1(data), candidates = [];
  // Dictionnaire du flux (deux niveaux d'imbrication, chaînes hexadécimales comme /CheckSum <A1B2…> admises).
  const hex = '<[0-9A-Fa-f\\s]*>', inner = `<<(?:[^<>]|${hex}|<<(?:[^<>]|${hex})*>>)*>>`;
  const re = new RegExp(`<<((?:[^<>]|${hex}|${inner})*)>>\\s*stream\\r?\\n`, 'g');
  let m;
  while ((m = re.exec(text)) && candidates.length < MAX_STREAMS) {
    const dict = m[1], start = m.index + m[0].length, end = text.indexOf('endstream', start);
    if (end < 0) break;
    // /Length directe seulement : « /Length 12 0 R » est une référence (longueur écrite ailleurs), pas 12 octets.
    const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict), length = lm && !lm[2] ? lm : null;
    let stop = length ? start + Number(length[1]) : end;
    if (stop > end) stop = end;
    while (!length && stop > start && (text[stop - 1] === '\n' || text[stop - 1] === '\r')) stop -= 1;
    candidates.push({dict, start, stop, embedded: /\/Type\s*\/EmbeddedFile|\/Subtype\s*\/(?:text#2Fxml|application#2Fxml)/.test(dict)});
    re.lastIndex = end;
  }
  candidates.sort((a, b) => b.embedded - a.embedded);
  for (const c of candidates) {
    const raw = data.subarray(c.start, c.stop);
    let content;
    if (/\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(c.dict)) { try { content = await inflate(raw); } catch { continue; } }
    else if (!/\/Filter/.test(c.dict) && c.embedded) content = raw;
    else continue;
    const xml = new TextDecoder('utf-8').decode(content).replace(/^﻿/, '');
    // Élément racine cherché dans l'en-tête seulement (pas de lecture du flux entier), puis lecture complète qui tranche
    // (une autre pièce jointe XML, Order-X par exemple, est ignorée).
    if (!/<(?:[\w.-]+:)?(?:CrossIndustryInvoice|Invoice|CreditNote)[\s>/]/.test(xml.slice(0, 4096))) continue;
    try { parseInvoiceXml(xml); return xml; } catch { continue; }
  }
  return null;
}

/** Fichier reçu (PDF Factur-X ou XML) → facture lue, ou null si le fichier ne contient pas de facture électronique. */
export async function readElectronicInvoice(file) {
  const name = String(file?.name || '').toLowerCase(), type = String(file?.type || '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (type === 'application/pdf' || name.endsWith('.pdf') || latin1(bytes.subarray(0, 5)) === '%PDF-') {
    const xml = await extractEmbeddedXml(bytes);
    return xml ? {...parseInvoiceXml(xml), source: 'pdf'} : null;
  }
  if (/xml/.test(type) || name.endsWith('.xml')) return {...parseInvoiceXml(new TextDecoder('utf-8').decode(bytes)), source: 'xml'};
  return null;
}

/** Forme attendue par validateExtraction (stock-capture.js), une ligne de facture à la fois. */
const extractionLine = l => ({produit: l.produit, quantité: l.quantité, unité: l.unité, prix: l.prix, ean: l.ean});
export function invoiceToExtraction(invoice) { return {fournisseur: invoice.fournisseur, lignes: invoice.lignes.map(extractionLine)}; }

const negative = v => (v === null || v === undefined ? v : -Math.abs(v));
/**
 * Forme du texte lu par doc-text.js (parseDocText) : l'écran du stock affiche l'en-tête et ses contrôles, et le
 * document rangé porte docExtract (numéro, date, HT, TVA par taux, TTC), repris par le solde de TVA (vat-balance.js).
 * validate : validateExtraction de stock-capture.js (passée en paramètre pour garder ce module sans dépendance).
 * Chaque ligne est validée seule : son montant reste attaché au bon produit même si une autre est écartée.
 * Avoir : montants négatifs (la TVA se retranche du solde) et aucune ligne d'entrée en stock.
 */
export function invoiceToParsed(invoice, validate) {
  const warnings = [], lignes = [];
  let dropped = 0;
  if (invoice.credit) warnings.push('Avoir : aucune entrée de stock n’est proposée. Les retours sont à saisir en sortie de stock si besoin ; la TVA de l’avoir se retranche du solde.');
  else for (const l of invoice.lignes) {
    const valid = validate({fournisseur: invoice.fournisseur, lignes: [extractionLine(l)]});
    if (valid.length) lignes.push({...valid[0], amount: l.total ?? null}); else dropped += 1;
  }
  if (dropped) warnings.push(`${dropped} ligne${dropped > 1 ? 's' : ''} sans quantité positive (remise, consigne, retour) : comptée${dropped > 1 ? 's' : ''} dans les totaux, pas dans le stock.`);
  const sign = invoice.credit ? negative : v => v;
  return {kind: 'facture', source: 'factur-x', credit: Boolean(invoice.credit), warnings, lignes,
    header: {fournisseur: invoice.fournisseur, date: invoice.date, numero: invoice.number, totalHT: sign(invoice.totalHt), totalTTC: sign(invoice.totalTtc), echeance: invoice.dueDate,
      aPayer: invoice.dueAmount === null || invoice.dueAmount === undefined ? null : sign(invoice.dueAmount), devise: invoice.currency || 'EUR',
      tva: (invoice.tva || []).map(t => ({taux: t.taux, base: sign(t.base), montant: sign(t.montant)}))}};
}
