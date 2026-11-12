// n° W1 — Lecture locale d'un document par son texte (Scanner du texte iPhone, Google Lens, collage).
// Fonctions pures : ni DOM, ni réseau. Le texte copié d'une facture, d'un bon de livraison, d'une
// étiquette, d'un ticket de pesée ou d'un bon de gasoil devient un en-tête, des lignes au format de
// validateExtraction (stock-capture.js), des frais et des contrôles de totaux expliqués.
import {isoDay, validateExtraction, similarity} from './stock-capture.js';
import {convertQuantity} from './voice-notes.js';

export const EMPTY_TEXT_ERROR = 'Aucune ligne lisible dans ce texte. Copiez tout le document puis réessayez.';

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const near = (a, b, rel = 0.01) => Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 0.011);

// ---------- Nettoyage du texte ----------
const CONFUSABLE = /[OoIl]/g;
function fixToken(tok) {
  // « 14/O3/2026 » : une date lue avec un O se corrige comme un nombre.
  const m = /^([\dOoIl][\dOoIl.,/]*)([€%]?)$/.exec(tok);
  if (!m || !/\d/.test(m[1])) return tok;
  // « 10l » reste dix litres : un « l » final après un chiffre est une unité.
  if (/\dl$/.test(m[1])) return tok;
  const digits = (m[1].match(/\d/g) || []).length, odd = (m[1].match(CONFUSABLE) || []).length;
  // « 2OO » : commence par un chiffre et seuls des O suivent, c'est 200 ; I/l restent prudents.
  if (!odd || (digits < odd && !/^\d[\dOo.,/]*$/.test(m[1]))) return tok;
  return m[1].replace(/[Oo]/g, '0').replace(/[Il]/g, '1') + m[2];
}
// « 28 460 kg » ou « 1 500 L » seul sur sa ligne (ticket de pesée, bon de gasoil) : aussi une colonne éclatée.
// (« 10l » collé reste une ligne à part : c'est souvent un conditionnement.)
const NUMBER_ONLY = /^[-+]?\d[\d .,]*?(\s*(€|eur|euros)|\s+(kg|t|l|litres?))?\s*%?$/i;

export function normalizeDocText(raw) {
  const lines = String(raw ?? '').replace(/[   ]/g, ' ').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  const out = [];
  for (let line of lines) {
    line = line.split(/( +)/).map(t => (/^ +$/.test(t) ? t : fixToken(t))).join('').replace(/(\d) ?([,.]) ?(\d)/g, (_, a, sep, b) => `${a}${sep}${b}`).trim();
    if (!line) {out.push(''); continue;}
    // Colonnes éclatées par Live Text : un nombre seul rejoint la ligne précédente.
    const prev = out.length ? out[out.length - 1] : '';
    if (NUMBER_ONLY.test(line) && prev) out[out.length - 1] = `${prev}  ${line}`;
    else out.push(line);
  }
  return out.filter((l, i) => l || (i > 0 && out[i - 1])).join('\n').trim();
}

// ---------- Nombres français ----------
export function parseFrNumber(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = String(s ?? '').replace(/[   ]/g, ' ').trim().replace(/\s*(€|eur|euros)\s*$/i, '').replace(/^(€)\s*/, '').trim();
  if (!t) return null;
  let sign = 1;
  if (/^[-−]/.test(t)) {sign = -1; t = t.slice(1).trim();}
  if (/ /.test(t)) {
    if (!/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(t)) return null;
    t = t.replace(/ /g, '');
  }
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const dots = (t.match(/\./g) || []).length, commas = (t.match(/,/g) || []).length;
  let n;
  if (dots && commas) {
    const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.', thou = dec === ',' ? '.' : ',';
    const [int, frac, extra] = t.split(dec);
    if (extra !== undefined || !new RegExp(`^\\d{1,3}(\\${thou}\\d{3})+$`).test(int) || !/^\d+$/.test(frac)) return null;
    n = Number(`${int.split(thou).join('')}.${frac}`);
  } else if (commas) {
    if (commas > 1) return /^\d{1,3}(,\d{3})+$/.test(t) ? null : null;
    n = Number(t.replace(',', '.'));
  } else if (dots) {
    if (dots > 1) {if (!/^\d{1,3}(\.\d{3})+$/.test(t)) return null; n = Number(t.replace(/\./g, ''));}
    // « 1.234 » : millier ou décimale ? Ambigu, sauf « 0.425 ».
    else if (/^[1-9]\d{0,2}\.\d{3}$/.test(t)) return null;
    else n = Number(t);
  } else n = Number(t);
  return Number.isFinite(n) ? sign * n : null;
}

// ---------- Conditionnements ----------
const UNIT_RE = '(ml|cl|l|litres?|kg|kilos?|g|t|tonnes?|doses?|unites?|pieces?|u)';
const MEASURE = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}(?![a-z0-9/])`, 'gi');
const CONTAINERS = 'sacs?|bidons?|cartons?|big[- ]?bags?|bb|seaux?|futs?|fûts?|palettes?|cubis?|bouteilles?|flacons?|doses?|ibc';
function unitOf(u, v) {
  const k = fold(u);
  if (k === 'ml') return [v / 1000, 'L'];
  if (k === 'cl') return [v / 100, 'L'];
  if (/^l(itres?)?$/.test(k)) return [v, 'L'];
  if (/^(kg|kilos?)$/.test(k)) return [v, 'kg'];
  if (k === 'g') return [v / 1000, 'kg'];
  if (/^(t|tonnes?)$/.test(k)) return [convertQuantity(v, 't', 'kg'), 'kg'];
  return [v, 'u'];
}
const toNum = s => Number(String(s).replace(',', '.'));

export function packFactor(label) {
  const text = String(label ?? '').replace(/[  ]/g, ' ');
  const f = fold(text);
  let measure = null;
  for (const m of f.matchAll(MEASURE)) {
    const prev = f[m.index - 1] || '';
    if (prev === '/' || (/[a-z]/.test(prev) && prev !== 'x')) continue;
    measure = m;
  }
  let value, unit, start, end;
  if (measure) {
    [value, unit] = unitOf(measure[2], toNum(measure[1]));
    start = measure.index; end = measure.index + measure[0].length;
  } else {
    const bb = /\b(bb|big[- ]?bags?)\s*(\d+(?:[.,]\d+)?)/.exec(f);
    if (!bb) return null;
    value = toNum(bb[2]); unit = 'kg'; start = bb.index; end = bb.index + bb[0].length;
  }
  if (!(value > 0)) return null;
  const before = f.slice(0, start);
  let count = null, from = start;
  // « 4x5L », « 4 x 5 L », « 12 x 1 L » ; « palette 40 sacs de 25 kg » ; « 4 x ADENGO 5L ».
  // Nombre de colis : 1 à 3 chiffres isolés, pour ne pas lire une référence (« Ref 12345 sac 25 kg »).
  const c = /(?<![\d.,])(\d{1,3})\s*[x×*]\s*$/.exec(before) || new RegExp(`(?<![\\d.,])(\\d{1,3})\\s*(?:${CONTAINERS})\\s*(?:de\\s*)?$`).exec(before) || /^\s*(\d{1,3})\s*[x×*]\s+/.exec(before);
  if (c) {count = Number(c[1]); from = c.index + (c[0].length - c[0].trimStart().length);}
  if (count !== null && !(count > 0)) count = null;
  const factor = round(value * (count || 1), 6);
  return {factor, unit, count, raw: text.slice(from, end).trim()};
}

// ---------- Type de document ----------
export const DOC_KIND_KEYWORDS = {
  facture: [['FACTURE', 2], ['Avoir', 1], ['N° facture', 1], ['Total HT', 1], ['Net à payer', 1]],
  bl: [['BON DE LIVRAISON', 2], ['BL n°', 1], ['Bon de livraison n°', 1], ['Livré le', 1]],
  etiquette: [['AMM', 1], ['Contenu net', 2], ['H410', 1], ['EUH401', 1], ['Lire l’étiquette', 1]],
  pesee: [['TICKET DE PESEE', 2], ['Brut', 1], ['Tare', 1], ['Net', 1], ['Humidité', 1], ['PS', 1]],
  gasoil: [['GNR', 1], ['Gazole non routier', 2], ['FOD', 1], ['Litres livrés', 1], ['Index', 1]],
};
const kwRe = kw => new RegExp(`(^|[^a-z0-9])${fold(kw).replace(/[’']/g, '.').replace(/°/g, '.?').replace(/\s+/g, '\\s*')}($|[^a-z0-9])`, 'i');
export function detectDocKind(text) {
  const f = fold(text);
  let best = 'inconnu', top = 0;
  for (const [kind, words] of Object.entries(DOC_KIND_KEYWORDS)) {
    const score = words.reduce((s, [kw, w]) => s + (kwRe(kw).test(f) ? w : 0), 0);
    if (score > top) {top = score; best = kind;}
  }
  return top >= 2 ? best : 'inconnu';
}

// ---------- Outils de lecture ----------
const NUM_TOKEN = /^[-−]?\d[\d.,]*$/;
// Nombres d'une suite de jetons : « 1 234,56 » peut être un millier ou deux colonnes ; on garde la
// lecture où qté × PU ≈ montant, sinon la lecture en milliers.
// tokens : [{v, sep}], sep = espaces qui suivent (une seule espace : fusion en milliers possible).
// money : montants (totaux, TVA) où « qté × PU = montant » n'a pas de sens.
function readNumbers(tokens, {money = false} = {}) {
  const vals = tokens.map(t => t.v.replace(/[€%]$/, ''));
  const merges = [];
  for (let i = 0; i < vals.length - 1; i++) if (tokens[i].sep === ' ' && /^\d{1,3}$/.test(vals[i]) && /^\d{3}([.,]\d+)?$/.test(vals[i + 1])) merges.push(i);
  const options = [];
  const total = 1 << Math.min(merges.length, 8);
  for (let mask = 0; mask < total; mask++) {
    const chosen = new Set(merges.filter((_, k) => mask & (1 << k)));
    const nums = [];
    let cur = null;
    vals.forEach((v, i) => {cur = cur === null ? v : `${cur} ${v}`; if (!chosen.has(i)) {nums.push(parseFrNumber(cur)); cur = null;}});
    if (nums.some(n => n === null)) continue;
    options.push({nums, merges: chosen.size, triple: money ? null : findTriple(nums)});
  }
  if (!options.length) return {nums: vals.map(parseFrNumber).filter(n => n !== null), triple: null};
  options.sort((a, b) => (b.triple ? 1 : 0) - (a.triple ? 1 : 0) || b.merges - a.merges);
  return options[0];
}
function findTriple(nums) {
  for (let k = nums.length - 1; k >= 2; k--) for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const [a, b, c] = [nums[i], nums[j], nums[k]];
    if (a > 0 && b > 0 && c > 0 && near(a * b, c)) return {i, j, k};
  }
  return null;
}
// Jetons numériques d'un texte ; un mot entre deux nombres coupe la fusion en milliers.
function numTokens(parts) {
  const tokens = [];
  for (let i = 0; i < parts.length; i += 2) {
    const v = parts[i].replace(/€$/, '');
    if (NUM_TOKEN.test(v)) tokens.push({v, sep: parts[i + 1] === ' ' ? ' ' : '  '});
    else if (tokens.length) tokens[tokens.length - 1].sep = '  ';
  }
  return tokens;
}
const lineNumbers = (line, opts) => {const tokens = numTokens(String(line).trim().split(/(\s+)/)); return tokens.length ? readNumbers(tokens, opts).nums : [];};
const lastNumber = (line, opts) => {const n = lineNumbers(line, opts); return n.length ? n[n.length - 1] : null;};

const MONTHS = {janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12};
const yearOf = y => (String(y).length === 2 ? 2000 + Number(y) : Number(y));
function findDates(line) {
  const f = fold(line), found = [];
  for (const m of f.matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
    const iso = isoDay(`${m[1]}/${m[2]}/${yearOf(m[3])}`);
    if (iso) found.push({iso, index: m.index});
  }
  for (const m of f.matchAll(/(\d{1,2})(?:er)?\s+(janv|jan|fevr|fev|mars|avr|mai|juin|juil|aout|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})/g)) {
    const iso = isoDay(`${m[1]}/${MONTHS[m[2]]}/${m[3]}`);
    if (iso) found.push({iso, index: m.index});
  }
  return found.map(d => ({...d, before: f.slice(Math.max(0, d.index - 30), d.index)}));
}

const FEE_RE = /\b(rpd|redevance pollution|eco ?-?taxe|ecotaxe|ecocontribution|frais de port|frais de transport|frais de livraison|port et emballage|port|transport|remise|escompte|ristourne)\b/;
const TOTAL_RE = /\b(total|sous-total|sous total|montant ht|base ht|net a payer|tva|ttc|acompte|reste a payer|report|a reporter)\b/;
const INFO_RE = /\b(siret|siren|rcs|capital|iban|bic|tel|telephone|fax|email|www|adresse|client|code client|page|conditions|reglement|echeance|date|facture n|bl n|commande|livre a|facture a|vendeur|representant)\b/;
const TAIL_UNIT = /^(l|litres?|kg|t|tonnes?|u|un|unites?|pce|pces|pieces?|bid|bidons?|sacs?|sac|bb|doses?|x|€|eur|ht|ttc|%|\/l|\/kg|\/t|\/u)$/i;

function legalSupplier(lines) {
  for (const l of lines.slice(0, 25)) {
    const f = fold(l);
    if (/\b(capital|siret|rcs|tva intra|client|livre a|facture a|adresse de)\b/.test(f)) continue;
    if (/\b(sa|sas|sasu|sarl|sca|eurl|scop|cooperative|negoce)\b/.test(f) || /\bcoop\b/.test(f)) return l;
  }
  const kw = /facture|livraison|ticket|pesee|bon\b|avoir|etiquette|gazole|page/;
  for (const l of lines.slice(0, 10)) if (/[A-Z]{3}/.test(l) && l === l.toUpperCase() && !kw.test(fold(l)) && !/\d{3}/.test(l)) return l;
  if (lines.some(l => /\bFR\s?[0-9A-Z]{2}\s?\d{9}\b/.test(l))) return lines.find(l => /[A-Za-z]{3}/.test(l) && !kw.test(fold(l))) || '';
  return '';
}
function knownSuppliers(state) {
  const set = new Map();
  for (const m of state?.stockMovements || []) if (m && !m.deletedAt && m.supplier) set.set(fold(m.supplier), m.supplier);
  return [...set.values()];
}

// ---------- Lecture complète ----------
export function parseDocText(text, {state = {}, now = new Date()} = {}) {
  void now;
  const clean = normalizeDocText(text);
  if (!clean || !/[a-z]/i.test(clean)) throw new Error(EMPTY_TEXT_ERROR);
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  const kind = detectDocKind(clean), warnings = [];
  const header = {fournisseur: '', date: '', numero: '', totalHT: null, tva: [], totalTTC: null, echeance: ''};

  // Fournisseur, rapproché des fournisseurs déjà connus.
  let supplier = legalSupplier(lines).replace(/\s{2,}.*$/, '').trim().slice(0, 80);
  if (supplier) {
    let best = null;
    for (const s of knownSuppliers(state)) {const sc = similarity(supplier, s); if (sc >= 0.8 && (!best || sc > best.sc)) best = {s, sc};}
    if (best) supplier = best.s;
  }
  header.fournisseur = supplier;

  // Dates : « Date facture » avant « Livraison » ; l'échéance à part ; DLU ignorée.
  let bestDate = null;
  lines.forEach((l, li) => {
    for (const d of findDates(l)) {
      const b = d.before;
      if (/(dlu|dluo|utiliser avant|exp\.?|peremption|fabrication)\s*:?\s*$/.test(b) || /\b(dlu|exp|peremption)\b/.test(b)) continue;
      if (/echeance\s*:?\s*(le\s*)?$/.test(b) || /echeance/.test(b.slice(-15))) {if (!header.echeance) header.echeance = d.iso; continue;}
      const score = /date\s*(de\s*)?(la\s*)?(facture|facturation|piece|document)|facture\s*(n\S*\s*\S+\s*)?du\b/.test(b) ? 4 : /livraison|livre le|expedition|commande/.test(b) ? 1 : /date|du\s*$|le\s*$/.test(b) ? 3 : 2;
      if (!bestDate || score > bestDate.score || (score === bestDate.score && li < bestDate.li)) bestDate = {iso: d.iso, score, li};
    }
  });
  header.date = bestDate?.iso || '';

  // Numéro du document.
  // Recherche sans consommer (lookahead) : « FACTURE\nN° facture : FA… » essaie aussi le second mot-clé.
  for (const m of clean.matchAll(/\b(?=(facture|fact\.?|bl|bon|ticket|n°|no)\s*[:#n°]*\s*([A-Z0-9][A-Z0-9\-/]{3,}))/gi)) {
    const before = fold(clean.slice(Math.max(0, m.index - 18), m.index));
    if (!/\d/.test(m[2]) || /(tva|client|siret|siren|rcs|amm|lot|compte|tel|commande|intracom)\W*$/.test(before) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m[2])) continue;
    header.numero = m[2].replace(/(?<=\d)[Oo](?=\d)/g, '0').slice(0, 40); break;
  }

  // Totaux et TVA.
  for (const l of lines) {
    const f = fold(l);
    const tva = /\btva\b[^\d]*(\d+(?:[.,]\d+)?)\s*%/.exec(f);
    if (tva && !/intra|n°|numero/.test(f)) {
      const taux = toNum(tva[1]), rest = l.slice(l.indexOf('%') + 1), nums = lineNumbers(rest, {money: true});
      if (nums.length >= 2) header.tva.push({taux, base: nums[nums.length - 2], montant: nums[nums.length - 1]});
      else if (nums.length === 1) header.tva.push({taux, base: null, montant: nums[0]});
      continue;
    }
    if (/\b(net a payer|total ttc|montant ttc|ttc)\b/.test(f)) {const n = lastNumber(l, {money: true}); if (n !== null) header.totalTTC = n; continue;}
    if (/\b(total|montant|base|sous-total)\s*h\.?\s*t\b/.test(f) || /\btotal ht\b/.test(f)) {const n = lastNumber(l, {money: true}); if (n !== null) header.totalHT = n;}
  }

  const result = {kind, header, lignes: [], frais: [], pesee: null, gasoil: null, warnings, confidence: 'basse'};
  if (kind === 'pesee') result.pesee = readPesee(lines, warnings);
  else if (kind === 'gasoil') result.gasoil = readGasoil(lines, warnings);
  else if (kind === 'etiquette') result.lignes = readLabel(lines, clean);
  else ({lignes: result.lignes, frais: result.frais} = readArticles(lines, kind));

  if (!result.lignes.length && !result.pesee && !result.gasoil) throw new Error(EMPTY_TEXT_ERROR);

  // Contrôles des totaux.
  const fmt = n => frMoney(n);
  if (header.totalHT !== null && header.totalTTC !== null && header.tva.length) {
    const sumTva = round(header.tva.reduce((s, t) => s + (t.montant || 0), 0));
    if (Math.abs(header.totalHT + sumTva - header.totalTTC) > 0.05) warnings.push(`Les totaux ne concordent pas : HT ${fmt(header.totalHT)} + TVA ${fmt(sumTva)} ≠ TTC ${fmt(header.totalTTC)}`);
  }
  const priced = result.lignes.filter(l => l.amount !== null);
  if (header.totalHT !== null && priced.length && priced.length === result.lignes.length) {
    const sum = round(priced.reduce((s, l) => s + l.amount, 0) + result.frais.reduce((s, f) => s + f.montant, 0));
    if (!near(sum, header.totalHT)) warnings.push(`La somme des lignes (${fmt(sum)}) diffère du total HT (${fmt(header.totalHT)}).`);
  }
  if (kind === 'bl' && result.lignes.some(l => l.unitPrice === null)) warnings.push('Prix à compléter (bon de livraison).');

  // Même forme que l'extraction en ligne, plus la ligne lue et le conditionnement.
  const extra = result.lignes;
  const validated = validateExtraction({fournisseur: header.fournisseur, lignes: extra.map(l => ({produit: l.product, quantite: l.quantity, unite: l.unit, prix: l.unitPrice, amm: l.amm, lot: l.lot, peremption: l.expiryDate}))});
  result.lignes = validated.map((l, i) => ({...l, raw: extra[i].raw, pack: extra[i].pack, packs: extra[i].packs, amount: extra[i].amount}));

  const filled = [header.fournisseur, header.date, kind !== 'inconnu'].filter(Boolean).length;
  result.confidence = !warnings.filter(w => !/^Prix à compléter/.test(w)).length && filled === 3 ? 'haute' : warnings.length <= 1 && filled >= 2 ? 'moyenne' : 'basse';
  return result;
}

export function frMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`;
}

function attachInfo(target, l) {
  const amm = /AMM\s*(n°)?\s*:?\s*(\d{7})/i.exec(l);
  if (amm && !target.amm) target.amm = amm[2];
  const lot = /\b(n° de lot|lot|batch)\s*(n°)?\s*:?\s*([A-Z0-9-]{3,20})/i.exec(l);
  if (lot && !target.lot && /\d/.test(lot[3])) target.lot = lot[3];
  const exp = /(DLUO|DLU|à utiliser avant|a utiliser avant|EXP\.?|péremption|peremption)\s*:?\s*(le\s*)?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[/.-]\d{2,4})/i.exec(l);
  if (exp && !target.expiryDate) {
    const parts = exp[3].split(/[/.-]/);
    const fixed = parts.length === 3 ? `${parts[0]}/${parts[1]}/${yearOf(parts[2])}` : `${parts[0]}/${parts[1].length === 2 ? yearOf(parts[1]) : parts[1]}`;
    target.expiryDate = isoDay(fixed);
  }
  return Boolean(amm || lot || exp);
}

function readArticles(lines, kind) {
  const articles = [], frais = [];
  let last = null;
  for (const l of lines) {
    const f = fold(l);
    if (FEE_RE.test(f) && !TOTAL_RE.test(f)) {
      const n = lastNumber(l.replace(/\d+(?:[.,]\d+)?\s*%/g, ''));
      if (n !== null) frais.push({libelle: l.replace(/[-−]?\d[\d .,]*\s*(€|eur)?\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Frais', montant: /\b(remise|escompte|ristourne)\b/.test(f) && n > 0 ? -n : n});
      continue;
    }
    if (TOTAL_RE.test(f)) continue;
    const article = readArticleLine(l, kind);
    if (article) {articles.push(article); last = article; continue;}
    if (last && attachInfo(last, l)) continue;
  }
  return {lignes: articles, frais};
}

function readArticleLine(l, kind) {
  const f = fold(l);
  if (INFO_RE.test(f) && !/\d+\s*[x×]\s/.test(f)) return null;
  const tokens = l.split(/(\s+)/);
  // Queue de la ligne : nombres et unités ; tête : la désignation.
  const words = [];
  for (let i = 0; i < tokens.length; i += 2) words.push({t: tokens[i], sep: tokens[i + 1] || ''});
  let greedy = words.length;
  while (greedy > 0) {
    const t = words[greedy - 1].t.replace(/€$/, '');
    if (NUM_TOKEN.test(t) || TAIL_UNIT.test(fold(t)) || /^\d+(?:[.,]\d+)?%$/.test(t) || t === '') greedy--;
    else break;
  }
  const lead = /^(\d+)\s*[x×]\s+/.exec(l);
  const leadCount = lead ? Number(lead[1]) : null;
  const need = kind === 'bl' ? 1 : leadCount ? 1 : 2;
  // Plusieurs coupes possibles entre désignation et colonnes (« AMMONITRATE 33,5 BB 600  20 … ») :
  // on préfère celle où qté × PU ≈ montant, puis une vraie séparation de colonnes, puis la plus courte queue.
  let best = null;
  for (let c = Math.max(greedy, 1); c < words.length; c++) {
    if (!NUM_TOKEN.test(words[c].t.replace(/€$/, ''))) continue;
    const tail = words.slice(c), tailNums = numTokens(tail.filter(w => !/%$/.test(w.t)).flatMap(w => [w.t, w.sep]));
    if (tailNums.length < need) continue;
    const read = readNumbers(tailNums);
    const n = read.nums, leadTriple = leadCount && n.length >= 2 && near(leadCount * n[n.length - 2], n[n.length - 1]);
    const score = (read.triple || leadTriple ? 3 : 0) + (/\s{2,}/.test(words[c - 1].sep) ? 2 : 0) - (kind !== 'bl' && n.length < 2 ? 1 : 0);
    if (!best || score >= best.score) best = {c, score, tail, read};
  }
  if (!best) return null;
  const head = words.slice(0, best.c).map(w => w.t + w.sep).join('').trim(), tail = best.tail;
  if (!/[a-z]{2}/i.test(head)) return null;
  const tailUnitWord = tail.map(w => fold(w.t)).find(t => TAIL_UNIT.test(t) && !/^(x|€|eur|ht|ttc|%)$/.test(t) && !t.startsWith('/')) || '';
  const {nums, triple} = best.read;
  if (!nums.length && !leadCount) return null;
  let qty = null, pu = null, amount = null;
  if (triple) {
    const a = nums[triple.i], b = nums[triple.j];
    amount = nums[triple.k];
    [qty, pu] = !Number.isInteger(a) && Number.isInteger(b) ? [b, a] : [a, b];
  } else if (leadCount && nums.length >= 2 && near(leadCount * nums[nums.length - 2], nums[nums.length - 1])) {
    qty = leadCount; pu = nums[nums.length - 2]; amount = nums[nums.length - 1];
  } else if (leadCount && nums.length === 1) {
    qty = leadCount; amount = nums[0]; pu = round(amount / qty, 4);
  } else if (nums.length >= 2) {
    qty = nums[0]; pu = nums[1]; amount = nums.length >= 3 ? nums[nums.length - 1] : round(qty * pu, 2);
  } else {qty = nums[0];}
  if (kind === 'bl' && !triple && nums.length < 3) {pu = null; amount = null; qty = leadCount && !nums.length ? leadCount : nums[0] ?? leadCount;}
  if (!(qty > 0)) return null;
  const product = head.replace(/^(\d+)\s*[x×]\s+/, '').replace(/^(ref\.?|code)\s*\S+\s+/i, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const pack = packFactor(head);
  let quantity = qty, unit = '', unitPrice = pu, packs = null;
  const mass = /^(l|litres?|kg|t|tonnes?)$/.test(tailUnitWord);
  if (mass) {
    [quantity, unit] = unitOf(tailUnitWord, qty);
    if (unitPrice !== null) unitPrice = round(unitPrice * qty / quantity, 4);
  } else if (pack && pack.unit !== 'u') {
    const per = leadCount && pack.count === leadCount && qty === leadCount ? pack.factor / pack.count : pack.factor;
    quantity = round(qty * per, 6); unit = pack.unit; packs = {count: qty, per};
    if (unitPrice !== null) unitPrice = round(unitPrice / per, 4);
  } else unit = tailUnitWord && /^(u|un|unites?|pce|pces|pieces?|doses?)$/.test(tailUnitWord) ? 'u' : tailUnitWord;
  const line = {product, quantity, unit, unitPrice, amm: '', lot: '', expiryDate: '', raw: l, pack, packs, amount};
  attachInfo(line, l);
  return line;
}

function readLabel(lines, clean) {
  const skip = /\b(amm|contenu|lot|dlu|exp|danger|attention|h\d{3}|euh|p\d{3}|fabrique|distribue|detenteur|composition|lire|usage|tel|www|n°)\b/;
  const product = lines.find(l => /[a-z]{3}/i.test(l) && !skip.test(fold(l)) && !/^\d/.test(l)) || 'Produit';
  const net = /contenu\s*net\s*:?\s*([^\n]+)/i.exec(clean);
  const pack = packFactor(net ? net[1] : clean);
  const line = {product: product.slice(0, 120), quantity: pack ? pack.factor : 1, unit: pack ? pack.unit : 'u', unitPrice: null, amm: '', lot: '', expiryDate: '', raw: net ? net[0].trim() : product, pack, packs: pack ? {count: 1, per: pack.factor} : null, amount: null};
  for (const l of lines) attachInfo(line, l);
  return [line];
}

const valueAfter = (lines, re) => {
  for (const l of lines) {
    const m = re.exec(fold(l));
    if (!m) continue;
    const rest = l.slice(m.index + m[0].length);
    const unit = /\b(t|tonnes?)\b/i.test(rest) && !/\bkg\b/i.test(rest) ? 1000 : 1;
    const n = lineNumbers(rest.replace(/[a-z%/]+/gi, ' '));
    if (n.length) return round(n[0] * unit, 3);
  }
  return null;
};
function readPesee(lines, warnings) {
  const brutKg = valueAfter(lines, /\bbrut\b\s*:?/), tareKg = valueAfter(lines, /\btare\b\s*:?/);
  let netKg = valueAfter(lines, /\b(poids )?net\b(?! a payer)\s*:?/);
  const pct = re => {for (const l of lines) {const m = re.exec(fold(l)); if (m) return toNum(m[1]);} return null;};
  if (netKg === null && brutKg !== null && tareKg !== null) netKg = round(brutKg - tareKg, 3);
  else if (netKg !== null && brutKg !== null && tareKg !== null && Math.abs(brutKg - tareKg - netKg) > 1) warnings.push(`Poids net ${frMoney(netKg).replace(/,00$/, '')} kg différent de brut − tare (${frMoney(brutKg - tareKg).replace(/,00$/, '')} kg).`);
  let produit = '';
  for (const l of lines) {const m = /\b(produit|culture|espece|cereale|article)\s*:?\s*(.+)$/i.exec(fold(l)); if (m) {produit = l.slice(l.length - m[2].length).trim(); break;}}
  const plate = lines.map(l => /\b([A-Z]{2})[- ]?(\d{3})[- ]?([A-Z]{2})\b/.exec(l)).find(Boolean);
  return {brutKg, tareKg, netKg, humidite: pct(/humidite\s*:?\s*(\d+(?:[.,]\d+)?)/), ps: pct(/\bps\b\s*:?\s*(\d+(?:[.,]\d+)?)/), impuretes: pct(/impurete?s?\s*:?\s*(\d+(?:[.,]\d+)?)/), produit, plaque: plate ? `${plate[1]}-${plate[2]}-${plate[3]}` : ''};
}

function readGasoil(lines, warnings) {
  let litres = valueAfter(lines, /litres?\s*livre?s?\s*:?/);
  const indexDebut = valueAfter(lines, /index\s*(de\s*)?(debut|initial|avant|depart)\s*:?/), indexFin = valueAfter(lines, /index\s*(de\s*)?(fin|final|apres|arrivee)\s*:?/);
  if (litres === null && indexDebut !== null && indexFin !== null) litres = round(indexFin - indexDebut, 3);
  else if (litres !== null && indexDebut !== null && indexFin !== null && Math.abs(indexFin - indexDebut - litres) > 1) warnings.push(`Litres livrés (${litres}) différents de l’écart des index (${round(indexFin - indexDebut, 3)}).`);
  let prixLitre = null;
  for (const l of lines) {
    const f = fold(l);
    if (!/\bprix\b|€\s*\/|\/\s*1\s?000\s*l|\/\s*m3/.test(f)) continue;
    const per1000 = /(1\s?000\s*l|\bm3\b|m³|hl\b)/.test(f), hl = /\bhl\b/.test(f);
    const nums = lineNumbers(l.replace(/1\s?000\s*L/gi, ' ').replace(/[a-z€%/³:]+/gi, ' '));
    if (!nums.length) continue;
    const p = nums[0];
    prixLitre = round(per1000 ? p / (hl ? 100 : 1000) : p > 20 ? p / 1000 : p, 4);
    break;
  }
  const produit = lines.some(l => /\bFOD\b|fioul domestique/i.test(l)) && !lines.some(l => /\bGNR\b|gazole non routier/i.test(l)) ? 'FOD' : 'GNR';
  return {litres, prixLitre, produit, indexDebut, indexFin};
}

// Métadonnée facultative rangée avec la photo (documents[].docExtract), sans changement de schéma.
export function docExtractSummary(parsed) {
  const h = parsed?.header || {};
  return {kind: parsed?.kind || 'inconnu', numero: h.numero || '', date: h.date || '', totalHT: h.totalHT ?? null, totalTTC: h.totalTTC ?? null, tva: Array.isArray(h.tva) ? h.tva.map(t => ({taux: t.taux, base: t.base ?? null, montant: t.montant ?? null})) : []};
}
