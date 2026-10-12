// n° 112 — Recommandations de rotation et bilan d'exploitation, fonctions pures.
// - Alertes douces de rotation : une culture prévue revient sur la même parcelle avant le délai de
//   retour conseillé (en campagnes, réglable par culture : preferences.rotationDelays).
// - Classement des parcelles par marge brute/ha (marginModel de pilotage.js), avec l'écart à la
//   moyenne pondérée par la surface et les données manquantes.
import {normalize, campaignFor} from './utils.js';
import {marginModel} from './pilotage.js';

export const ROTATION_SOURCE = 'Délais de retour indicatifs (Terres Inovia, Arvalis), à adapter à votre situation sanitaire';
export const ROTATION_DELAYS = {colza: 3, tournesol: 3, pois: 5, feverole: 5, lin: 5, soja: 3, betterave: 3, 'pomme de terre': 4, lentille: 5};
const LABELS = {colza: 'Colza', tournesol: 'Tournesol', pois: 'Pois', feverole: 'Féverole', lin: 'Lin', soja: 'Soja', betterave: 'Betterave', 'pomme de terre': 'Pomme de terre', lentille: 'Lentille'};

export function rotationFamily(culture = '') {
  const c = normalize(culture);
  return Object.keys(ROTATION_DELAYS).find(k => c.includes(k)) || null;
}
export const campaignYear = id => Number(String(id || '').slice(0, 4));
export function rotationDelay(family, prefs = {}) {
  const o = Number(prefs?.rotationDelays?.[family]);
  return Number.isFinite(o) && o > 0 ? o : ROTATION_DELAYS[family];
}

// Cultures par parcelle et par campagne : rotations saisies, plus la culture actuelle pour la campagne en cours.
export function cultureHistory(state = {}, parcelId, {current = campaignFor()} = {}) {
  const map = new Map();
  for (const r of state.rotations || []) if (!r.deletedAt && r.parcelId === parcelId && r.campaignId && r.culture) map.set(r.campaignId, r.culture);
  const p = (state.parcelles || []).find(x => x.id === parcelId);
  if (p?.culture && !map.has(current)) map.set(current, p.culture);
  return [...map].map(([campaignId, culture]) => ({campaignId, culture})).sort((a, b) => a.campaignId.localeCompare(b.campaignId));
}

export function rotationAlerts(state = {}, {current = campaignFor()} = {}) {
  const out = [];
  for (const p of (state.parcelles || []).filter(x => !x.deletedAt && !x.archived)) {
    const hist = cultureHistory(state, p.id, {current});
    hist.forEach((entry, i) => {
      if (entry.campaignId < current) return; // seulement le prévu (campagne en cours et suivantes)
      const family = rotationFamily(entry.culture);
      if (!family) return;
      const prev = hist.slice(0, i).reverse().find(h => rotationFamily(h.culture) === family);
      if (!prev) return;
      const gap = campaignYear(entry.campaignId) - campaignYear(prev.campaignId), delay = rotationDelay(family, state.preferences);
      if (gap >= delay) return;
      out.push({parcelId: p.id, parcelName: p.nom, family, campaignId: entry.campaignId, previous: prev.campaignId, gap, delay,
        message: `${p.nom} : ${LABELS[family].toLowerCase()} prévu en ${entry.campaignId}, dernier ${LABELS[family].toLowerCase()} en ${prev.campaignId} (délai conseillé ${delay} ans, réglable).`});
    });
  }
  return out;
}

// Classement par marge/ha, de la plus faible à la plus forte ; les parcelles sans produit connu
// sont listées à part avec ce qui manque.
export function marginRanking(state = {}, {campaign = campaignFor()} = {}) {
  const model = marginModel(state, {campaign});
  const rows = model.rows.map(r => {
    const missing = [];
    if (r.product === null) missing.push(r.yield !== null || r.price !== null ? 'rendement ou prix incomplet' : 'rendement et prix');
    if (r.unknownRealized) missing.push(`${r.unknownRealized} travail${r.unknownRealized > 1 ? 'aux' : ''} réalisé${r.unknownRealized > 1 ? 's' : ''} sans coût`);
    if (r.unknownPlanned) missing.push(`${r.unknownPlanned} travail${r.unknownPlanned > 1 ? 'aux' : ''} prévu${r.unknownPlanned > 1 ? 's' : ''} non chiffré${r.unknownPlanned > 1 ? 's' : ''}`);
    return {parcelId: r.parcelId, parcelName: r.parcel?.nom || '', culture: r.culture, area: r.area, marginHa: r.margin !== null && r.area > 0 ? r.margin / r.area : null, reliability: r.reliability, missing};
  });
  const ranked = rows.filter(r => r.marginHa !== null);
  const area = ranked.reduce((s, r) => s + r.area, 0);
  const average = area > 0 ? ranked.reduce((s, r) => s + r.marginHa * r.area, 0) / area : null;
  ranked.forEach(r => {r.gap = average === null ? null : r.marginHa - average;});
  ranked.sort((a, b) => a.marginHa - b.marginHa);
  return {campaign, average, ranked, unranked: rows.filter(r => r.marginHa === null), reliability: model.reliability};
}
