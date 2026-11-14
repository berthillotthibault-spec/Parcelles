// Rendement probable d'une parcelle pour la campagne (n° chantier 11). Logique pure, testée sous Node.
// Base : rendement saisi, sinon moyenne olympique des campagnes précédentes de même culture (cost-drift.js).
// Corrections indicatives et bornées, chacune expliquée :
// - NDVI comparé aux parcelles de même culture (ndvi-peers.js) : retard −25 % au plus, avance +10 % au plus ;
// - réserve en eau du sol basse (soil-water.js) pendant un stade sensible (floraison, remplissage) : −8 % au plus.
// Récolte mesurée (lots de récolte, measured-yield.js) : elle remplace l'estimation.
// Ordre de grandeur pour décider, jamais une prévision garantie : la fourchette le rappelle.
import {campaignFor} from './utils.js';
import {expectedYield} from './cost-drift.js';
import {harvestMeasure} from './measured-yield.js';

export const NDVI_WEIGHT = 0.5, NDVI_MAX_LOSS = 0.25, NDVI_MAX_GAIN = 0.1;
export const WATER_MAX_LOSS = 0.08, WATER_STRESS_FRACTION = 0.4, BAND = 0.15;
// Stades où le manque d'eau coûte du rendement ; à maturité, le rendement est déjà fait.
const SENSITIVE = /floraison|epiaison|remplissage|grain|bouton|siliques/i;
const AFTER = /maturite/i;
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const r2 = n => Math.round(n * 100) / 100;
const pctLabel = p => `${p > 0 ? '+' : '−'}${Math.abs(Math.round(p * 100))} %`;

/**
 * @param {object} state
 * @param {object} parcel
 * @param {{campaign?:string, culture?:string, ndvi?:object|null, water?:object|null, phenology?:object|null}} [context]
 *   ndvi : ligne de ndviPeerComparison pour la parcelle ; water : assessParcel (soil-water.js) ; phenology : estimatePhenology.
 * @returns {{status:'mesure'|'estime'|'inconnu', tPerHa:number|null, low:number|null, high:number|null, base:object|null,
 *   factors:{key:string,label:string,pct:number,why:string}[], text:string}}
 */
// Culture par défaut : rotation de la campagne demandée, sinon culture de la parcelle (pas encore mise à jour après un changement).
const cultureOf = (state, parcel, campaign) => (state?.rotations || []).find(r => !r.deletedAt && r.parcelId === parcel?.id && r.campaignId === campaign)?.culture || parcel?.culture || '';
export function yieldForecast(state, parcel, {campaign = campaignFor(), culture = cultureOf(state, parcel, campaign), ndvi = null, water = null, phenology = null} = {}) {
  const empty = {status: 'inconnu', tPerHa: null, low: null, high: null, base: null, factors: [], text: ''};
  if (!parcel) return empty;
  const measured = harvestMeasure(state, parcel, campaign);
  if (measured?.tha) {
    const t = r2(measured.tha);
    return {...empty, status: 'mesure', tPerHa: t, low: t, high: t, base: {source: 'mesure', lots: measured.lots},
      text: `Rendement mesuré : ${fr(t)} t/ha (${measured.lots} lot${measured.lots > 1 ? 's' : ''} de récolte).`};
  }
  const base = expectedYield(state, parcel, culture, campaign);
  if (!(base?.tPerHa > 0)) return {...empty, text: 'Rendement probable inconnu : saisissez un objectif de rendement ou les rendements des campagnes passées.'};
  const factors = [];
  // NDVI : écart relatif à la médiane des parcelles de même culture, pris à moitié, borné.
  if (ndvi && Number.isFinite(ndvi.gapPct) && ndvi.peers?.length) {
    const pct = Math.max(-NDVI_MAX_LOSS, Math.min(NDVI_MAX_GAIN, -NDVI_WEIGHT * ndvi.gapPct));
    if (Math.abs(pct) >= 0.02) factors.push({key: 'ndvi', label: 'Végétation (satellite)', pct,
      why: `NDVI ${fr(ndvi.ndvi)} contre ${fr(ndvi.median)} pour ${ndvi.peers.length} parcelle${ndvi.peers.length > 1 ? 's' : ''} de même culture (image du ${ndvi.date}).`});
  }
  // Eau : réserve sous 40 % pendant un stade sensible.
  const stage = phenology?.status === 'ok' ? phenology.stage?.name || '' : '';
  const fraction = water?.balance?.fraction;
  if (Number.isFinite(fraction) && fraction < WATER_STRESS_FRACTION && SENSITIVE.test(plain(stage)) && !AFTER.test(plain(stage))) {
    const pct = -WATER_MAX_LOSS * (1 - fraction / WATER_STRESS_FRACTION);
    if (Math.abs(pct) >= 0.02) factors.push({key: 'water', label: 'Manque d’eau', pct,
      why: `Réserve du sol à ${Math.round(fraction * 100)} % au stade ${stage}.`});
  }
  const factor = factors.reduce((f, x) => f * (1 + x.pct), 1);
  const t = r2(base.tPerHa * factor);
  const sourceText = base.source === 'saisi' ? 'objectif saisi' : `moyenne de ${base.count} campagne${base.count > 1 ? 's' : ''}`;
  const parts = factors.map(f => `${f.label.toLowerCase()} ${pctLabel(f.pct)}`);
  return {status: 'estime', tPerHa: t, low: r2(t * (1 - BAND)), high: r2(t * (1 + BAND)), base, factors,
    text: `Rendement probable : ${fr(t)} t/ha (${fr(r2(t * (1 - BAND)))} à ${fr(r2(t * (1 + BAND)))}) · ${sourceText}${parts.length ? ` · ${parts.join(', ')}` : ''}.`};
}

function fr(n) { return new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2}).format(n); }
