// n° 106 — Photo d'étiquette ou de facture vers le stock, fonctions pures.
// - Hors ligne : code EAN lu par BarcodeDetector (ou saisi à la main) et recherché dans le
//   dictionnaire local EAN → article (champ « ean » des articles de stock).
// - En ligne, en option et avec consentement : l'image part vers l'endpoint IA configuré (mode
//   'extract-document') qui renvoie {lignes:[{produit, quantité, unité, prix, AMM, lot}]}.
// - Chaque ligne est rapprochée d'un article existant (correspondance floue) ; rien n'est écrit
//   avant la validation ligne par ligne. Pas d'OCR embarqué.
import {normalize} from './utils.js';

export const EXTRACT_MODE = 'extract-document';
export const MAX_LINES = 50;
export const MATCH_MIN = 0.5;

export function eanValid(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
  const digits = [...s].map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
export const cleanEan = code => String(code || '').replace(/\s+/g, '');

export function itemByEan(items = [], code) {
  const ean = cleanEan(code);
  return ean ? items.find(i => !i.deletedAt && cleanEan(i.ean) === ean) || null : null;
}

const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = s ? Number(s) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const pick = (o, keys) => {for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined;};

// Réponse de l'endpoint → lignes propres ; les lignes sans produit ou sans quantité positive sont écartées.
export function validateExtraction(raw) {
  const list = Array.isArray(raw?.lignes) ? raw.lignes : Array.isArray(raw?.lines) ? raw.lines : null;
  if (!list) throw new Error('Réponse d’extraction invalide : « lignes » attendu.');
  const lines = [];
  for (const l of list.slice(0, MAX_LINES)) {
    if (!l || typeof l !== 'object') continue;
    const product = str(pick(l, ['produit', 'product', 'designation']));
    const quantity = num(pick(l, ['quantité', 'quantite', 'quantity', 'qte']));
    if (!product || quantity === null || quantity <= 0) continue;
    const price = num(pick(l, ['prix', 'price', 'unitPrice', 'prix_unitaire']));
    lines.push({product, quantity, unit: str(pick(l, ['unité', 'unite', 'unit']), 20), unitPrice: price !== null && price >= 0 ? price : null,
      amm: str(pick(l, ['AMM', 'amm']), 20).replace(/\D/g, '').slice(0, 10), lot: str(pick(l, ['lot', 'Lot']), 40)});
  }
  return lines;
}

const bigrams = s => {const t = ` ${s} `, out = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out;};
export function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x), B = bigrams(y), counts = new Map();
  for (const g of B) counts.set(g, (counts.get(g) || 0) + 1);
  let common = 0;
  for (const g of A) if (counts.get(g) > 0) {common++; counts.set(g, counts.get(g) - 1);}
  const dice = 2 * common / (A.length + B.length);
  // Un nom contenu dans l'autre (« Adengo » / « ADENGO 5 L ») compte presque comme identique.
  const contained = x.includes(y) || y.includes(x) ? 0.85 : 0;
  return Math.round(Math.max(dice, contained) * 100) / 100;
}

// Meilleur article pour une ligne : l'AMM identique l'emporte, sinon le nom le plus proche.
export function matchLine(line, items = []) {
  const live = items.filter(i => !i.deletedAt);
  if (line.amm) {const byAmm = live.find(i => String(i.amm || '').replace(/\D/g, '') === line.amm); if (byAmm) return {item: byAmm, score: 1, by: 'AMM'};}
  let best = null;
  for (const item of live) {const score = similarity(line.product, item.name); if (!best || score > best.score) best = {item, score, by: 'nom'};}
  return best && best.score >= MATCH_MIN ? best : {item: null, score: best?.score || 0, by: null};
}
export const matchLines = (lines, items) => lines.map(line => ({line, ...matchLine(line, items)}));

// Mouvement d'entrée pour une ligne validée.
export function entryMovement(line, stockItemId, {date, source = 'Facture'} = {}) {
  return {stockItemId, type: 'Entrée', quantity: line.quantity, unitPrice: line.unitPrice, date,
    lot: line.lot || '', note: `${source} : ${line.product}${line.lot ? ` · lot ${line.lot}` : ''}${line.amm ? ` · AMM ${line.amm}` : ''}`};
}
