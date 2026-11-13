// Écarts de marge à culture égale : chaque parcelle est comparée aux AUTRES parcelles de la même culture
// sur la même campagne (moyenne pondérée par la surface), et l’écart €/ha est décomposé : produit (rendement
// et prix), engrais, phyto, semences, mécanisation et autres travaux, forfait de charges.
// Moteur unique : les chiffres viennent de marginModel (pilotage.js), les postes des coûts des travaux.
// Lecture seule. C’est une comparaison, pas une explication causale : le nombre de parcelles comparées
// et les données manquantes sont toujours affichés.
import {normalize} from './utils.js';
import {marginModel, workCampaignOf, CANCELLED as PILOTAGE_CANCELLED} from './pilotage.js';
import {typeFamily} from './quick-entry.js';
import {isTreatment} from './phyto.js';

export const GAP_POSTS = Object.freeze([
  {key: 'product', label: 'produit'},
  {key: 'fertilize', label: 'engrais'},
  {key: 'spray', label: 'phyto'},
  {key: 'seed', label: 'semences'},
  {key: 'other', label: 'mécanisation et autres travaux'},
  {key: 'forfait', label: 'forfait de charges'}
]);
// Écart signalé à partir de 50 €/ha et 10 % de la marge des parcelles comparées.
export const GAP_MIN_EUR_HA = 50, GAP_MIN_SHARE = 0.1;
// Même filtre que parcelMargin (pilotage.js) : la somme des postes doit retomber exactement sur l’écart de marge.
const CANCELLED = new Set(PILOTAGE_CANCELLED);
// Culture inconnue (« Non renseignée ») : rien à quoi comparer.
const UNKNOWN_CULTURE = 'non renseignee';

const num = v => {if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null;};
const r0 = v => Math.round(v);
const eur = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(r0(v)).toLocaleString('fr-FR')} €/ha`;
// Facteur vers la tonne par hectare ; null pour une unité non convertible (hl/ha, bottes…).
const unitFactor = unit => {const u = String(unit || 't/ha').toLowerCase().replace(/\s+/g, ''); return u === 't/ha' ? 1 : u === 'q/ha' ? 0.1 : null;};
const fr = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');

/** Poste d’un travail chiffré : genre saisi (kind), sinon famille du libellé ; un traitement du registre est du phyto. */
export function workPost(work) {
  const kind = work?.kind;
  if (kind === 'spray' || work?.isPhytosanitary) return 'spray';
  if (kind === 'fertilize' || kind === 'seed') return kind;
  // Genre « Rien » choisi par l’utilisateur : il prime sur le libellé.
  if (kind === 'none') return 'other';
  if (isTreatment(work || {})) return 'spray';
  const family = typeFamily(work?.type || '');
  return family === 'fertilize' || family === 'seed' || family === 'spray' ? family : 'other';
}

/** Charges €/ha par poste d’une parcelle sur la campagne (mêmes travaux et même forfait que marginModel). */
function postsHa(state, row, campaign) {
  const out = {fertilize: 0, spray: 0, seed: 0, other: 0, forfait: 0};
  if (!(row.area > 0)) return out;
  for (const w of state.interventions || []) {
    if (!w || w.deletedAt || w.parcelId !== row.parcelId || workCampaignOf(w) !== campaign || CANCELLED.has(w.status)) continue;
    const c = num(w.cost);
    if (c !== null && c > 0) out[workPost(w)] += c / row.area;
  }
  out.forfait = row.forfait / row.area;
  return out;
}

/**
 * Écarts de la campagne pour les parcelles comparables (marge connue, surface, au moins une autre parcelle
 * de même culture avec marge connue). Triés du plus défavorable au plus favorable.
 */
export function marginGaps(state, {campaign} = {}) {
  const m = marginModel(state, campaign ? {campaign} : {});
  const rows = m.rows.filter(r => r.area > 0 && r.margin !== null && r.product !== null && normalize(r.culture) !== UNKNOWN_CULTURE)
    .map(r => ({r, key: normalize(r.culture), marginHa: r.margin / r.area, productHa: r.product / r.area, posts: postsHa(state, r, m.campaign)}));
  const byCulture = new Map();
  for (const x of rows) {if (!byCulture.has(x.key)) byCulture.set(x.key, []); byCulture.get(x.key).push(x);}
  const out = [];
  for (const x of rows) {
    const peers = byCulture.get(x.key).filter(p => p !== x);
    if (!peers.length) continue;
    const area = peers.reduce((s, p) => s + p.r.area, 0);
    const avg = f => peers.reduce((s, p) => s + f(p) * p.r.area, 0) / area;
    const peerMarginHa = avg(p => p.marginHa), gapHa = x.marginHa - peerMarginHa;
    // Contribution de chaque poste à l’écart de marge : produit en plus = +, charge en plus = −.
    const parts = GAP_POSTS.map(({key, label}) => ({key, label,
      deltaHa: key === 'product' ? x.productHa - avg(p => p.productHa) : -(x.posts[key] - avg(p => p.posts[key]))}))
      .filter(p => Math.abs(p.deltaHa) >= 1).sort((a, b) => Math.abs(b.deltaHa) - Math.abs(a.deltaHa));
    // Rendements comparés dans l’unité de la parcelle (t/ha ou q/ha, 1 t = 10 q) ; autre unité : pas de rendement affiché.
    const toUnit = p => {const y = p.r.yield, from = unitFactor(p.r.yieldUnit), to = unitFactor(x.r.yieldUnit); return y === null || !from || !to ? null : y * from / to;};
    const peerYield = x.r.yield !== null && unitFactor(x.r.yieldUnit) && peers.every(p => toUnit(p) !== null) ? avg(toUnit) : null;
    const partial = [x, ...peers].some(p => p.r.reliability < 100);
    out.push({parcelId: x.r.parcelId, name: x.r.parcel?.nom || 'Parcelle', culture: x.r.culture, campaign: m.campaign, marginHa: x.marginHa, peerMarginHa, gapHa,
      peers: peers.length, parts, yield: x.r.yield, peerYield, yieldUnit: x.r.yieldUnit, partial,
      significant: Math.abs(gapHa) >= GAP_MIN_EUR_HA && Math.abs(gapHa) >= GAP_MIN_SHARE * Math.abs(peerMarginHa || 0)});
  }
  return out.sort((a, b) => a.gapHa - b.gapHa || a.name.localeCompare(b.name, 'fr'));
}

/** « Les Brosses : −180 €/ha par rapport aux 2 autres parcelles de Blé tendre, dont engrais −120 €/ha, produit −50 €/ha (rendement 6,8 contre 7,9 t/ha). » */
export function gapText(g) {
  const main = g.parts.filter(p => Math.sign(p.deltaHa) === Math.sign(g.gapHa) || Math.abs(p.deltaHa) >= Math.abs(g.gapHa) / 2).slice(0, 3);
  const detail = main.map(p => {
    const yieldNote = p.key === 'product' && g.yield !== null && g.peerYield !== null ? ` (rendement ${fr(g.yield)} contre ${fr(g.peerYield)} ${g.yieldUnit})` : '';
    return `${p.label} ${eur(p.deltaHa)}${yieldNote}`;
  });
  const others = g.peers > 1 ? `aux ${g.peers} autres parcelles` : 'à l’autre parcelle';
  const of = /^[aeiouyhàâéèêëîïôöûüœ]/i.test(g.culture) ? `d’${g.culture}` : `de ${g.culture}`;
  return `${g.name} : ${eur(g.gapHa)} par rapport ${others} ${of}${detail.length ? `, dont ${detail.join(', ')}` : ''}.`;
}
