// n° 90 · Rendement mesuré relié à la marge et rentabilité intra-parcellaire.
// Logique pure : aucune écriture, aucun accès au DOM. L'interface propose la valeur mesurée et
// n'écrit qu'après confirmation ; une valeur déjà saisie n'est jamais remplacée sans afficher l'écart.
//  - lots de récolte (enregistrements « harvest ») : quantité totale de la campagne / surface de la parcelle ;
//  - carte de rendement : moyenne des points retenus par analyzeYield avec le nettoyage standard (DEFAULT_RULES) et les seuils de rendement de la carte.
import {campaignFor, geometryAreaHa} from './utils.js';
import {analyzeYield, DEFAULT_RULES} from './yield.js';
import {managementZones} from './management-zones.js';
import {economicClass, ECONOMIC_CLASSES} from './pilotage.js';

export const YIELD_UNITS = Object.freeze({'t/ha': 1, 'q/ha': 10});
export const SOURCE_LABELS = Object.freeze({harvest: 'Lots de récolte', yieldMap: 'Carte de rendement'});
const LOT_FACTORS = {t: 1, kg: .001, q: .1};
const num = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** Unité de rendement de la fiche : celle saisie, sinon t/ha (convention de marginModel). */
export const yieldUnitOf = econ => YIELD_UNITS[econ?.yieldUnit] ? econ.yieldUnit : 't/ha';
/** t/ha → unité affichée, arrondie comme la saisie (0,01 t/ha ou 0,1 q/ha). */
export function toUnit(tha, unit = 't/ha') {
  if (!Number.isFinite(tha)) return null;
  const factor = YIELD_UNITS[unit] || 1, digits = unit === 'q/ha' ? 10 : 100;
  return Math.round(tha * factor * digits) / digits;
}
export const formatYield = (value, unit = 't/ha') => value === null || value === undefined ? '—' : `${new Intl.NumberFormat('fr-FR', {maximumFractionDigits: unit === 'q/ha' ? 1 : 2}).format(value)} ${unit}`;

/** Économie d'une campagne, lue comme marginModel (campagne, sinon fiche courante pour la campagne en cours). */
export function economicsFor(parcel, campaign, {current = campaignFor()} = {}) {
  return parcel?.economicsByCampaign?.[campaign] || (campaign === current ? parcel?.economics : null) || {};
}
export function parcelAreaHa(parcel) {
  const surface = num(parcel?.surfaceHa);
  if (surface > 0) return surface;
  try { const area = parcel?.geometry ? geometryAreaHa(parcel.geometry) : 0; return area > 0 ? area : 0; } catch { return 0; }
}

const harvestLots = (state, parcelId) => (state?.integrationImports || []).filter(r => !r.deletedAt && r.farmKind === 'harvest' && r.parcelId === parcelId);
export const lotCampaign = lot => lot?.campaignId || (lot?.date ? campaignFor(lot.date) : null);

/** Rendement des lots de récolte d'une parcelle pour une campagne (quantité brute, humidité non corrigée). */
export function harvestMeasure(state, parcel, campaign) {
  const lots = harvestLots(state, parcel?.id).filter(l => lotCampaign(l) === campaign);
  if (!lots.length) return null;
  const valid = [], ignored = [];
  for (const lot of lots) {
    const q = num(lot.quantity), factor = LOT_FACTORS[String(lot.unit || 't').trim().toLowerCase()];
    if (q !== null && q > 0 && factor) valid.push({lot, tons: q * factor}); else ignored.push(lot);
  }
  const areaHa = parcelAreaHa(parcel), quantityT = valid.reduce((s, x) => s + x.tons, 0);
  const wet = valid.filter(x => num(x.lot.humidity) !== null), humidity = wet.length ? wet.reduce((s, x) => s + num(x.lot.humidity) * x.tons, 0) / wet.reduce((s, x) => s + x.tons, 0) : null;
  const dates = valid.map(x => String(x.lot.date || '')).filter(Boolean).sort();
  return {
    source: 'harvest', label: SOURCE_LABELS.harvest, campaign, lots: valid.length, ignored: ignored.length, quantityT, areaHa, humidity,
    from: dates[0] || null, to: dates.at(-1) || null,
    tha: areaHa > 0 && quantityT > 0 ? quantityT / areaHa : null,
    reason: !valid.length ? 'Quantités des lots absentes ou invalides.' : areaHa > 0 ? '' : 'Surface de la parcelle inconnue.'
  };
}

// Date d'un point de récolte : AAAA-MM-JJ, JJ/MM/AAAA, JJ-MM-AAAA ou JJ.MM.AAAA.
export function parseHarvestDate(text) {
  const s = String(text || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m && Number(m[2]) <= 12) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
/** Campagne d'une carte de rendement : date des points, sinon date d'import. */
export function yieldMapCampaign(doc, points = []) {
  for (const p of points) { const d = parseHarvestDate(p.date); if (d) return {campaign: campaignFor(`${d}T12:00:00`), dated: true}; }
  const at = doc?.yieldMap?.importedAt || doc?.createdAt;
  return {campaign: campaignFor(at || Date.now()), dated: false};
}

/** Règles de la mesure : vitesse maximale et pics extrêmes standard (DEFAULT_RULES), quel que soit le réglage
 * d'affichage ; seuils de rendement de la carte quand ils sont valides, car ils dépendent de la culture
 * (betterave, ensilage : bien au-delà des 25 t/ha par défaut) (vague 9). */
export function measureRules(rules = {}) {
  const min = num(rules?.minYield), max = num(rules?.maxYield);
  return min !== null && max !== null && min >= 0 && max > min ? {...DEFAULT_RULES, minYield: min, maxYield: max} : {...DEFAULT_RULES};
}

/** Moyenne nettoyée d'une carte de rendement (nettoyage standard, seuils de la culture : measureRules). */
export function yieldMapMeasure(doc, source, parcel) {
  const result = analyzeYield(source, {...doc.yieldMap, rules: measureRules(doc.yieldMap?.rules)}, parcel);
  const {campaign, dated} = yieldMapCampaign(doc, result.points);
  return {
    source: 'yieldMap', label: SOURCE_LABELS.yieldMap, campaign, dated, docId: doc.id, parcelId: doc.parcelId, name: doc.name || 'Carte de rendement',
    importedAt: doc.yieldMap?.importedAt || doc.createdAt || 0, tha: result.stats.mean, used: result.points.length,
    excluded: result.excluded.length, total: result.total, cv: result.stats.cv, points: result.points,
    reason: result.points.length ? '' : 'Aucun point retenu après nettoyage.'
  };
}

/** Campagnes pour lesquelles une mesure existe (lots ou cartes déjà analysées), la plus récente d'abord. */
export function measuredCampaigns(state, parcel, maps = []) {
  const set = new Set([...harvestLots(state, parcel?.id).map(lotCampaign), ...maps.filter(m => m?.parcelId === undefined || m.parcelId === parcel?.id).map(m => m.campaign)].filter(Boolean));
  return [...set].sort().reverse();
}

const candidate = (measure, unit, entered) => {
  const value = toUnit(measure.tha, unit);
  if (value === null || !(value > 0)) return null;
  const delta = entered === null ? null : Math.round((value - entered) * 100) / 100;
  const deltaPct = entered > 0 && delta !== null ? Math.round(delta / entered * 1000) / 10 : null;
  const same = entered !== null && Math.abs(value - entered) < (unit === 'q/ha' ? .05 : .005);
  return {...measure, points: undefined, value, unit, delta, deltaPct, status: entered === null ? 'empty' : same ? 'same' : 'differs'};
};

/**
 * Proposition de rendement mesuré pour une campagne.
 * Lots de récolte en premier (pesée), puis la carte de rendement la plus récente de la campagne.
 */
export function measuredYieldProposal(state, parcel, {campaign = campaignFor(), maps = [], current = campaignFor()} = {}) {
  const econ = economicsFor(parcel, campaign, {current}), unit = yieldUnitOf(econ), enteredRaw = num(econ.yield), entered = enteredRaw !== null && enteredRaw > 0 ? enteredRaw : null;
  const harvest = harvestMeasure(state, parcel, campaign);
  const mapList = maps.filter(m => m && m.campaign === campaign && (m.parcelId === undefined || m.parcelId === parcel?.id)).sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
  const candidates = [harvest, ...mapList].filter(Boolean).map(m => candidate(m, unit, entered)).filter(Boolean);
  const price = num(econ.salePrice);
  return {
    campaign, parcelId: parcel?.id, parcelName: parcel?.nom || 'Parcelle', unit, entered, price: price > 0 ? price : null,
    candidates, best: candidates[0] || null,
    unusable: [harvest, ...mapList].filter(m => m && !(toUnit(m.tha, unit) > 0)).map(m => ({source: m.source, label: m.label, name: m.name, reason: m.reason || 'Mesure inexploitable.'}))
  };
}

/** Parcelle mise à jour (non enregistrée) avec le rendement confirmé pour la campagne. */
export function applyMeasuredYield(parcel, campaign, {value, unit}, {current = campaignFor()} = {}) {
  if (!(Number(value) > 0)) throw Error('Rendement mesuré invalide.');
  if (!YIELD_UNITS[unit]) throw Error('Unité de rendement invalide.');
  const next = {...economicsFor(parcel, campaign, {current}), yield: Number(value), yieldUnit: unit};
  return {...parcel, economicsByCampaign: {...(parcel.economicsByCampaign || {}), [campaign]: next}, economics: campaign === current ? next : parcel.economics};
}

/** Prix de vente exprimé en €/t (le prix de la fiche est par unité de rendement : €/t ou €/q). */
export const pricePerTon = (price, unit = 't/ha') => num(price) > 0 ? num(price) * (YIELD_UNITS[unit] || 1) : null;

const ZONE_LABELS = {A: 'Zone haute (> +10 %)', B: 'Zone moyenne (±10 %)', C: 'Zone basse (< −10 %)'};
/**
 * Rentabilité intra-parcellaire : cellules mesurées de la carte de rendement × charges €/ha de la campagne.
 * Marge/ha d'une cellule = rendement × prix − charges/ha (charges réparties uniformément sur la parcelle).
 */
export function profitZones({parcel, points, costHa, price, unit = 't/ha', cellSizes = [30, 50, 100, 200]}) {
  const perTon = pricePerTon(price, unit);
  if (perTon === null) throw Error('Prix de vente absent : renseignez-le dans la fiche Économie de la parcelle.');
  if (!Number.isFinite(costHa) || costHa < 0) throw Error('Charges de la campagne inconnues.');
  let zones = null, lastError = null;
  for (const cellMeters of cellSizes) {
    try { zones = managementZones(parcel, points, {cellMeters, minSamples: 2, sourceType: 'yield'}); break; }
    catch (error) { lastError = error; if (!/maille|Aucune cellule/i.test(error.message)) throw error; }
  }
  if (!zones) throw lastError || Error('Zones de rendement non calculables.');
  const cells = zones.cells.map(c => {
    const productHa = c.value * perTon, marginHa = productHa - costHa, cls = economicClass(marginHa, 'margin');
    return {id: c.id, geometry: c.geometry, areaHa: c.areaHa, tha: c.value, group: c.group, productHa, marginHa, classIndex: cls.index, color: cls.color, classLabel: cls.label};
  });
  const measuredHa = cells.reduce((s, c) => s + c.areaHa, 0);
  const sum = list => { const areaHa = list.reduce((s, c) => s + c.areaHa, 0); return {areaHa, cells: list.length, tha: areaHa ? list.reduce((s, c) => s + c.tha * c.areaHa, 0) / areaHa : null, marginHa: areaHa ? list.reduce((s, c) => s + c.marginHa * c.areaHa, 0) / areaHa : null, share: measuredHa ? areaHa / measuredHa : 0}; };
  const classes = ECONOMIC_CLASSES.margin.map((c, index) => ({index, label: c.label, color: c.color, ...sum(cells.filter(x => x.classIndex === index))}));
  const yieldZones = ['A', 'B', 'C'].map(id => ({id, label: ZONE_LABELS[id], ...sum(cells.filter(c => c.group === id))})).filter(z => z.cells);
  const losing = cells.filter(c => c.marginHa < 0);
  return {
    cellMeters: zones.cellMeters, cells, classes, yieldZones, measuredHa, parcelHa: parcelAreaHa(parcel), averageTha: sum(cells).tha,
    costHa, pricePerTon: perTon, breakEvenTha: perTon > 0 ? costHa / perTon : null,
    unprofitable: {...sum(losing), loss: losing.reduce((s, c) => s - c.marginHa * c.areaHa, 0)}
  };
}
