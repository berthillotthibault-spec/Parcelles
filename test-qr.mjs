import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentPositions, byteCapacity, codewords, encodeQR, formatBits, gfMul, qrRuns, qrSvg, rsEncode, versionBits} from './qr.js';
import {appBaseUrl, labelSheetPdf, parseQrRoute, qrLink} from './qr-labels.js';

test('Reed-Solomon : vecteur connu « HELLO WORLD » 1-M (thonky.com)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.equal(gfMul(0x02, 0x80), 0x1D);
});

test('information de format et de version : valeurs de la norme', () => {
  assert.equal(formatBits(0).toString(2).padStart(15, '0'), '101010000010010'); // M, masque 0
  assert.equal(formatBits(0, 1).toString(2).padStart(15, '0'), '111011111000100'); // L, masque 0
  assert.equal(formatBits(7).toString(2).padStart(15, '0'), '100101010100000'); // M, masque 7
  assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
  assert.equal(versionBits(10).toString(2).padStart(18, '0'), '001010010011010011');
});

test('capacités en mode octet (niveau M) et motifs d’alignement', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(byteCapacity), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(10), [6, 28, 50]);
});

test('mots de code : longueur totale par version, remplissage 0xEC/0x11', () => {
  assert.equal(codewords([65], 1).length, 26);
  assert.equal(codewords([65], 7).length, 196);
  assert.equal(codewords([65], 10).length, 346);
  // 1-M, « A » : en-tête 0100, longueur 00000001, 01000001, terminateur puis remplissage.
  assert.deepEqual(codewords([65], 1).slice(0, 5), [0x40, 0x14, 0x10, 0xEC, 0x11]);
});

test('matrice : taille, motifs de repérage, module sombre, choix de version', () => {
  const url = 'https://berthillotthibault-spec.github.io/Parcelles/#equipment/materiel_abcdef123456/log';
  const q = encodeQR(url);
  assert.equal(q.version, 6);
  assert.equal(q.size, 41);
  const m = q.modules, s = q.size;
  for (const [x, y] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
    assert.equal(m[y][x], true); assert.equal(m[y + 1][x + 1], false); assert.equal(m[y + 3][x + 3], true);
  }
  assert.equal(m[s - 8][8], true, 'module sombre fixe');
  for (let i = 8; i < s - 8; i++) assert.equal(m[6][i], i % 2 === 0, 'motif de synchronisation');
  assert.equal(encodeQR('x'.repeat(14)).version, 1);
  assert.equal(encodeQR('x'.repeat(15)).version, 2);
  assert.equal(encodeQR('é').version, 1);
  assert.throws(() => encodeQR('x'.repeat(300), {maxVersion: 10}), RangeError);
  assert.ok(qrRuns(m).every(([x, y, w]) => m[y].slice(x, x + w).every(Boolean)));
  assert.match(qrSvg(url, {label: 'Tracteur'}), /^<svg[^>]+aria-label="Tracteur"/);
});

test('liens et routes des étiquettes', () => {
  assert.equal(appBaseUrl('https://exemple.github.io/Parcelles/index.html?x=1#today'), 'https://exemple.github.io/Parcelles/');
  assert.equal(appBaseUrl('https://exemple.github.io/Parcelles/'), 'https://exemple.github.io/Parcelles/');
  const base = 'https://exemple.github.io/Parcelles/';
  assert.equal(qrLink(base, 'equipment', 'm 1'), base + '#equipment/m%201/log');
  assert.equal(qrLink(base, 'point', 'p1'), base + '#point/p1');
  assert.deepEqual(parseQrRoute('#equipment/m%201/log'), {kind: 'equipment', id: 'm 1', log: true});
  assert.deepEqual(parseQrRoute('equipment/m1'), {kind: 'equipment', id: 'm1', log: false});
  assert.deepEqual(parseQrRoute('point/p1'), {kind: 'point', id: 'p1', log: false});
  assert.equal(parseQrRoute('point/p1/log'), null);
  assert.equal(parseQrRoute('parcel/p1'), null);
  assert.equal(parseQrRoute('equipment/%E0%A4%A'), null);
});

test('planche A4 en PDF : 12 étiquettes par page', () => {
  const items = Array.from({length: 13}, (_, i) => ({kind: i % 2 ? 'point' : 'equipment', id: 'id' + i, name: `Tracteur 6155M n° ${i}`}));
  const bytes = labelSheetPdf(items, {base: 'https://exemple.github.io/Parcelles/', farm: 'GAEC du Bois'});
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Count 2 >>/);
  assert.ok(text.includes('Tracteur 6155M n'));
  assert.throws(() => labelSheetPdf([], {base: 'x'}), /Aucune étiquette/);
});
