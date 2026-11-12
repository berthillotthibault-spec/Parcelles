import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDocText, parseFrNumber, packFactor, detectDocKind, parseDocText, docExtractSummary, DOC_KIND_KEYWORDS, EMPTY_TEXT_ERROR} from './doc-text.js';
import {validateExtraction} from './stock-capture.js';

// Textes fictifs (aucune donnée réelle) : noms, numéros et montants inventés.
const BL_COOP = `COOPERATIVE AGRICOLE DU VAL FICTIF
Silo de Boisvert
BON DE LIVRAISON
BL n° BL-26-00871
Date : 14/10/2026
Client : EARL DES TESTS
Désignation\tQté
AMMONITRATE 33,5 BB 600\t4
SEMENCES BLE TENOR dose 500 000 grains\t12 DOSES
Livré le 14/10/2026`;

const FACT_PHYTO = `AGRO NEGOCE FICTIF SAS
12 rue des Essais 00000 Nulle-Part
TVA intracom : FR12345678901
FACTURE N° FA-2026-0412
Date facture : 3 oct. 2026
Échéance : 02/12/2026
Désignation  Qté  PU HT  Montant HT
4 x ADENGO 5L  225,00  900,00
AMM 2090016 Lot : B12345 DLU 06/2028
GLYPHOSATE 360 g/L 20L  2  110,50  221,00
RPD  18,40
Frais de port  25,00
Total HT  1 164,40
TVA 20 %  1 164,40  232,88
Net à payer  1 397,28 €`;

const FACT_ENGRAIS = `NEGOCE DES PLAINES SARL
FACTURE n° F2611-0098
Date : 05.11.26
AMMONITRATE 33,5 BB 600  20  228,00  4 560,00
SEMENCES COLZA DK EXSTAR  3  150,00  450,00
Total HT 5 010,00
TVA 5,5 % 4 560,00 250,80
TVA 10 % 450,00 45,00
Total TTC 5 305,80`;

const ETIQUETTE = `ADENGO
Herbicide maïs
AMM n° 2090016
Contenu net : 5 L
Lot : B12345
À utiliser avant : 06/2028
H410 Très toxique pour les organismes aquatiques
EUH401 Respectez les instructions d'utilisation`;

const PESEE = `SILO DE BOISVERT
TICKET DE PESEE n° T-2026-1544
Date : 18/07/2026
Produit : Blé tendre
Véhicule : AB-123-CD
Brut : 32 540 kg
Tare : 14 220 kg
Net : 18 320 kg
Humidité : 14,2 %
PS : 77,5
Impuretés : 1,1 %`;

const GNR = `PETROLE DU BOCAGE SAS
BON DE LIVRAISON CARBURANT n° G-77812
Date : 20/10/2026
Gazole non routier (GNR)
Index début : 104 220
Index fin : 105 720
Prix : 1 150,00 € / 1000 L`;

test('nettoyage : espaces insécables, O/0, « 12 ,5 », colonnes éclatées', () => {
  const t = normalizeDocText('Total HT 1 234,56\r\nQté 1O ,5\nADENGO 5L\n4\n225,00\n10l');
  assert.equal(t.split('\n')[0], 'Total HT 1 234,56');
  assert.match(t, /Qté 10,5/);
  assert.match(t, /ADENGO 5L {2}4 {2}225,00\n10l/);
  assert.equal(normalizeDocText('BOLO 3'), 'BOLO 3');
});

test('nombres français', () => {
  assert.equal(parseFrNumber('1 234,56'), 1234.56);
  assert.equal(parseFrNumber('1.234,56'), 1234.56);
  assert.equal(parseFrNumber('12,5'), 12.5);
  assert.equal(parseFrNumber('1234.56'), 1234.56);
  assert.equal(parseFrNumber('45 €'), 45);
  assert.equal(parseFrNumber('0.425'), 0.425);
  assert.equal(parseFrNumber('-12,40'), -12.4);
  assert.equal(parseFrNumber('1.234'), null);
  assert.equal(parseFrNumber('12 34'), null);
  assert.equal(parseFrNumber('abc'), null);
  assert.equal(parseFrNumber(''), null);
});

test('conditionnements sur 15 libellés', () => {
  const cases = [
    ['4x5L', 20, 'L', 4], ['4 x 5 L', 20, 'L', 4], ['bidon 10 L', 10, 'L', null], ['sac 25 kg', 25, 'kg', null],
    ['BB 600', 600, 'kg', null], ['big-bag 600 kg', 600, 'kg', null], ['1 t', 1000, 'kg', null],
    ['palette 40 sacs de 25 kg', 1000, 'kg', 40], ['500 mL', 0.5, 'L', null], ['4 x ADENGO 5L', 20, 'L', 4],
    ['12 x 1 L', 12, 'L', 12], ['GLYPHOSATE 360 g/L 20L', 20, 'L', null], ['fût 200 litres', 200, 'L', null],
    ['seau 500 g', 0.5, 'kg', null], ['carton 25 cl', 0.25, 'L', null],
  ];
  for (const [label, factor, unit, count] of cases) {
    const p = packFactor(label);
    assert.ok(p, label);
    assert.deepEqual([p.factor, p.unit, p.count], [factor, unit, count], label);
  }
  assert.equal(packFactor('4x5L').raw, '4x5L');
  assert.equal(packFactor('Ammonitrate 33,5'), null);
  assert.equal(packFactor(''), null);
});

test('type de document par mots-clés', () => {
  assert.ok(DOC_KIND_KEYWORDS.pesee.some(([k]) => k === 'Tare'));
  assert.equal(detectDocKind(BL_COOP), 'bl');
  assert.equal(detectDocKind(FACT_PHYTO), 'facture');
  assert.equal(detectDocKind(FACT_ENGRAIS), 'facture');
  assert.equal(detectDocKind(ETIQUETTE), 'etiquette');
  assert.equal(detectDocKind(PESEE), 'pesee');
  assert.equal(detectDocKind(GNR), 'gasoil');
  assert.equal(detectDocKind('Bonjour, rappel réunion mardi'), 'inconnu');
});

test('(a) BL de coopérative sans prix', () => {
  const r = parseDocText(BL_COOP);
  assert.equal(r.kind, 'bl');
  assert.equal(r.header.fournisseur, 'COOPERATIVE AGRICOLE DU VAL FICTIF');
  assert.equal(r.header.numero, 'BL-26-00871');
  assert.equal(r.header.date, '2026-10-14');
  assert.equal(r.lignes.length, 2);
  assert.deepEqual([r.lignes[0].quantity, r.lignes[0].unit, r.lignes[0].unitPrice], [2400, 'kg', null]);
  assert.deepEqual([r.lignes[1].quantity, r.lignes[1].unit], [12, 'u']);
  assert.ok(r.warnings.includes('Prix à compléter (bon de livraison).'));
});

test('(b) facture phyto : 4 x 5 L, RPD et port en frais, totaux contrôlés', () => {
  const r = parseDocText(FACT_PHYTO);
  assert.equal(r.kind, 'facture');
  assert.equal(r.header.fournisseur, 'AGRO NEGOCE FICTIF SAS');
  assert.equal(r.header.numero, 'FA-2026-0412');
  assert.equal(r.header.date, '2026-10-03');
  assert.equal(r.header.echeance, '2026-12-02');
  assert.equal(r.header.totalHT, 1164.4);
  assert.deepEqual(r.header.tva, [{taux: 20, base: 1164.4, montant: 232.88}]);
  assert.equal(r.header.totalTTC, 1397.28);
  assert.equal(r.lignes.length, 2);
  const [adengo, glypho] = r.lignes;
  assert.equal(adengo.product, 'ADENGO 5L');
  assert.deepEqual([adengo.quantity, adengo.unit, adengo.unitPrice, adengo.amm, adengo.lot, adengo.expiryDate], [20, 'L', 45, '2090016', 'B12345', '2028-06-30']);
  assert.equal(adengo.pack.raw, '4 x ADENGO 5L');
  assert.deepEqual([glypho.quantity, glypho.unit, glypho.unitPrice], [40, 'L', 5.525]);
  assert.deepEqual(r.frais.map(f => f.libelle), ['RPD', 'Frais de port']);
  assert.ok(!r.lignes.some(l => /RPD|port/i.test(l.product)));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.confidence, 'haute');
  // Totaux faux : les deux contrôles parlent.
  const bad = parseDocText(FACT_PHYTO.replace('Net à payer  1 397,28 €', 'Net à payer  1 450,00 €').replace('Total HT  1 164,40', 'Total HT  1 200,00'));
  assert.ok(bad.warnings.some(w => w.startsWith('Les totaux ne concordent pas : HT 1 200,00 + TVA 232,88 ≠ TTC 1 450,00')), bad.warnings.join('|'));
  assert.ok(bad.warnings.some(w => /^La somme des lignes \(1 164,40\) diffère du total HT \(1 200,00\)/.test(w)));
  assert.notEqual(bad.confidence, 'haute');
});

test('(c) facture engrais : BB 600, TVA 5,5 et 10 %', () => {
  const r = parseDocText(FACT_ENGRAIS, {state: {stockMovements: [{supplier: 'Negoce des Plaines SARL'}]}});
  assert.equal(r.header.fournisseur, 'Negoce des Plaines SARL');
  assert.equal(r.header.date, '2026-11-05');
  assert.equal(r.header.numero, 'F2611-0098');
  assert.deepEqual(r.header.tva.map(t => t.taux), [5.5, 10]);
  assert.equal(r.header.totalTTC, 5305.8);
  assert.equal(r.lignes.length, 2);
  assert.deepEqual([r.lignes[0].quantity, r.lignes[0].unit, r.lignes[0].unitPrice], [12000, 'kg', 0.38]);
  assert.deepEqual(r.lignes[0].packs, {count: 20, per: 600});
  assert.deepEqual([r.lignes[1].quantity, r.lignes[1].unitPrice], [3, 150]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(docExtractSummary(r), {kind: 'facture', numero: 'F2611-0098', date: '2026-11-05', totalHT: 5010, totalTTC: 5305.8, tva: [{taux: 5.5, base: 4560, montant: 250.8}, {taux: 10, base: 450, montant: 45}]});
});

test('(d) étiquette : AMM à 7 chiffres, lot, contenu net', () => {
  const r = parseDocText(ETIQUETTE);
  assert.equal(r.kind, 'etiquette');
  assert.equal(r.lignes.length, 1);
  assert.deepEqual([r.lignes[0].product, r.lignes[0].quantity, r.lignes[0].unit, r.lignes[0].amm, r.lignes[0].lot, r.lignes[0].expiryDate], ['ADENGO', 5, 'L', '2090016', 'B12345', '2028-06-30']);
});

test('(e) ticket de pesée : brut, tare, net, humidité, PS', () => {
  const r = parseDocText(PESEE);
  assert.equal(r.kind, 'pesee');
  assert.deepEqual(r.pesee, {brutKg: 32540, tareKg: 14220, netKg: 18320, humidite: 14.2, ps: 77.5, impuretes: 1.1, produit: 'Blé tendre', plaque: 'AB-123-CD'});
  assert.equal(r.lignes.length, 0);
  assert.deepEqual(r.warnings, []);
  assert.equal(parseDocText(PESEE.replace('Net : 18 320 kg\n', '')).pesee.netKg, 18320);
  assert.match(parseDocText(PESEE.replace('18 320', '18 400')).warnings[0], /Poids net 18 400 kg différent de brut − tare \(18 320 kg\)/);
});

test('(f) bon GNR : litres par index, prix aux 1000 L', () => {
  const r = parseDocText(GNR);
  assert.equal(r.kind, 'gasoil');
  assert.deepEqual(r.gasoil, {litres: 1500, prixLitre: 1.15, produit: 'GNR', indexDebut: 104220, indexFin: 105720});
  assert.equal(r.header.numero, 'G-77812');
});

test('texte vide ou illisible : message clair', () => {
  assert.throws(() => parseDocText(''), {message: EMPTY_TEXT_ERROR});
  assert.throws(() => parseDocText('   \n  '), {message: EMPTY_TEXT_ERROR});
  assert.throws(() => parseDocText('Bonjour, à mardi'), {message: EMPTY_TEXT_ERROR});
});

test('les lignes lues passent validateExtraction sans perte', () => {
  for (const text of [BL_COOP, FACT_PHYTO, FACT_ENGRAIS, ETIQUETTE]) {
    const r = parseDocText(text);
    const again = validateExtraction({lignes: r.lignes});
    assert.equal(again.length, r.lignes.length);
    again.forEach((l, i) => {for (const k of Object.keys(l)) assert.deepEqual(l[k], r.lignes[i][k], `${k} ${l.product}`);});
  }
});

test('colonnes éclatées par Live Text et O lu pour 0', () => {
  const r = parseDocText('AGRO NEGOCE FICTIF SAS\nFACTURE N° FA-2026-0500\nDate : 10/10/2026\nADENGO 5L\n4\n225,0O\n900,00\nTotal HT\n900,00');
  assert.equal(r.lignes.length, 1);
  assert.deepEqual([r.lignes[0].quantity, r.lignes[0].unitPrice], [20, 45]);
  assert.equal(r.header.totalHT, 900);
});

test('revue : une référence produit n’est pas lue comme un nombre de colis', () => {
  assert.deepEqual(packFactor('Ref 12345 sac 25kg'), {factor: 25, unit: 'kg', count: null, raw: '25kg'});
  assert.equal(packFactor('12345x5L').count, null);
  assert.equal(packFactor('palette 40 sacs de 25 kg').factor, 1000);
  const r = parseDocText('FACTURE n° F-1234\nNEGOCE X SAS\nDate : 01/02/2026\nRef 12345 sac 25kg  2  10,00  20,00\nTotal HT 20,00');
  assert.deepEqual([r.lignes[0].quantity, r.lignes[0].unit], [50, 'kg']);
});

// Textes fictifs « tels que Live Text les rend » : colonnes éclatées une valeur par ligne, O lu pour 0.
test('Live Text : facture phyto avec AMM et lots, date et numéro lus avec des O', () => {
  const r = parseDocText('AGRI NEGOCE DU VAL SAS\nCapital 150 000 €  RCS Reims 412 345 678\nFACTURE\nN° facture : FA24-1O387\nDate facture : 14/O3/2026\nCode client : 004512\nDésignation\nQté\nP.U. HT\nMontant HT\nADENGO 5L\n4\n212,50\n850,00\nAMM n° 2090147  Lot : 23O9AB12\nPROSARO 5 L\n2\n189,90\n379,80\nAMM 2070086 Lot 24F117\nRPD\n21,60\nTotal HT\n1 251,40\nTVA 20 %  1 251,40  250,28\nNet à payer\n1 501,68 €');
  assert.equal(r.header.date, '2026-03-14');
  assert.equal(r.header.numero, 'FA24-10387');
  assert.deepEqual(r.header.tva, [{taux: 20, base: 1251.4, montant: 250.28}]);
  assert.deepEqual([r.header.totalHT, r.header.totalTTC], [1251.4, 1501.68]);
  assert.deepEqual(r.lignes.map(l => [l.product, l.quantity, l.unit, l.unitPrice, l.amm, l.lot]), [['ADENGO 5L', 20, 'L', 42.5, '2090147', '23O9AB12'], ['PROSARO 5 L', 10, 'L', 37.98, '2070086', '24F117']]);
  assert.deepEqual(r.frais, [{libelle: 'RPD', montant: 21.6}]);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.confidence, 'haute');
});

test('Live Text : ticket de pesée, poids seuls sur leur ligne avec « kg »', () => {
  const r = parseDocText('COOPERATIVE TERRES DE L\'AUBE\nTICKET DE PESEE N° 58214\nDate : 22/07/2026  14:32\nProduit : Blé tendre\nImmatriculation : AB-123-CD\nBrut\n28 46O kg\nTare\n14 2OO kg\nNet\n14 26O kg\nHumidité : 14,8 %\nPS : 76,5\nImpuretés : 1,2 %');
  assert.deepEqual(r.pesee, {brutKg: 28460, tareKg: 14200, netKg: 14260, humidite: 14.8, ps: 76.5, impuretes: 1.2, produit: 'Blé tendre', plaque: 'AB-123-CD'});
  assert.deepEqual([r.header.date, r.header.numero, r.warnings.length], ['2026-07-22', '58214', 0]);
});

test('Live Text : bon de GNR, index éclatés et prix aux 1000 L', () => {
  const r = parseDocText('CHAMPAGNE ENERGIES SARL\nBON DE LIVRAISON N° 77812\nLivré le 03/11/2026\nGazole non routier GNR\nIndex début\nO12 345\nIndex fin\n013 845\nLitres livrés\n1 5OO\nPrix 1 145,00 € / 1000 L');
  assert.equal(r.kind, 'gasoil');
  assert.deepEqual(r.gasoil, {litres: 1500, prixLitre: 1.145, produit: 'GNR', indexDebut: 12345, indexFin: 13845});
  assert.equal(r.header.date, '2026-11-03');
});

test('Live Text : étiquette de bidon, AMM avec des O', () => {
  const r = parseDocText('PROSARO\nFongicide céréales\nAMM n° 2O7OO86\nContenu net : 5 L\nLot : 24F117\nDLU : 11/2028\nH410 Très toxique pour les organismes aquatiques\nEUH401 Respectez les instructions d\'utilisation\nBayer SAS');
  assert.equal(r.kind, 'etiquette');
  assert.deepEqual(r.lignes.map(l => [l.product, l.quantity, l.unit, l.amm, l.lot, l.expiryDate]), [['PROSARO', 5, 'L', '2070086', '24F117', '2028-11-30']]);
});
