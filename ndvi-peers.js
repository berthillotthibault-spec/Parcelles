// Idée 10 : NDVI comparé à culture égale. Logique pure, sans DOM ni réseau ni import.
// On compare le dernier NDVI exploitable de chaque parcelle à la médiane des autres parcelles
// de même culture mesurées à une date proche (± 5 jours). Les valeurs viennent du cache satellite
// (satellite-ui.js les publie ici) ; rien n'est écrit dans les données de l'exploitation.
export const PEER_WINDOW_DAYS = 5, PEER_MIN = 2, PEER_GAP_ABS = 0.1, PEER_GAP_REL = 0.15;
// Au-delà de 30 jours, la dernière image ne dit plus rien de l'état actuel (et la culture a pu changer de campagne).
export const PEER_MAX_AGE_DAYS = 30;
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DAY = 86400000;
const iso = /^\d{4}-\d{2}-\d{2}$/;
const ms = date => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fr = (value, digits = 2) => value.toFixed(digits).replace('.', ',');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 12 mai » (jour sans zéro, mois en toutes lettres). */
export function dayLabel(date) {return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] || ''}`.trim();}
/** Clé de culture : casse, accents et espaces ignorés (« Blé tendre » = « ble  tendre »). */
export function cropKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Médiane d'une liste de nombres (null si vide). */
export function median(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b), n = list.length;
  if (!n) return null;
  return n % 2 ? list[(n - 1) / 2] : (list[n / 2 - 1] + list[n / 2]) / 2;
}
const usableRows = series => (Array.isArray(series) ? series : [])
  .filter(r => r && r.usable && Number.isFinite(r.ndvi) && iso.test(String(r.date || '')))
  .sort((a, b) => a.date.localeCompare(b.date));
/** Mesure exploitable la plus proche d'une date, à ± window jours (la plus récente en cas d'égalité). */
export function nearestReading(series, date, window = PEER_WINDOW_DAYS) {
  let best = null, bestGap = Infinity;
  for (const r of usableRows(series)) {
    const gap = Math.abs(ms(r.date) - ms(date)) / DAY;
    if (gap <= window && gap <= bestGap) {best = r; bestGap = gap;}
  }
  return best;
}
function dateSpan(dates) {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length === 1) return `le ${dayLabel(sorted[0])}`;
  return `entre le ${dayLabel(sorted[0])} et le ${dayLabel(sorted.at(-1))}`;
}

/**
 * parcels : [{id, nom, culture, surfaceHa}] ; seriesFor(parcel) : série NDVI fusionnée (lignes {date, ndvi, usable}).
 * Renvoie une ligne par parcelle comparée (au moins PEER_MIN autres parcelles de même culture à ± PEER_WINDOW_DAYS jours) :
 * {parcelId, name, culture, date, ndvi, median, peers, gap, gapPct, lagging, level, text, why}.
 */
export function ndviPeerComparison(parcels, seriesFor, {window = PEER_WINDOW_DAYS, minPeers = PEER_MIN, gapAbs = PEER_GAP_ABS, gapRel = PEER_GAP_REL,
  today = localToday(), maxAgeDays = PEER_MAX_AGE_DAYS} = {}) {
  const list = (Array.isArray(parcels) ? parcels : []).filter(p => p && p.id && !p.deletedAt && cropKey(p.culture));
  const seriesById = new Map();
  for (const p of list) {
    let rows = [];
    try {rows = usableRows(seriesFor(p));} catch {rows = [];}
    if (rows.length) seriesById.set(p.id, rows);
  }
  const out = [];
  for (const p of list) {
    const own = seriesById.get(p.id), last = own?.at(-1);
    if (!last) continue;
    // Image trop ancienne (ou datée dans le futur) : pas de comparaison, la carte serait trompeuse.
    const age = iso.test(String(today)) ? (ms(today) - ms(last.date)) / DAY : 0;
    if (age > maxAgeDays || age < -1) continue;
    const key = cropKey(p.culture), peers = [];
    for (const q of list) {
      if (q.id === p.id || cropKey(q.culture) !== key || !seriesById.has(q.id)) continue;
      const r = nearestReading(seriesById.get(q.id), last.date, window);
      if (r) peers.push({parcelId: q.id, name: q.nom || 'Parcelle', date: r.date, ndvi: r.ndvi});
    }
    if (peers.length < minPeers) continue;
    const med = median(peers.map(x => x.ndvi)), gap = med - last.ndvi, gapPct = med > 0 ? gap / med : 0;
    const lagging = gap >= gapAbs - 1e-9 && med > 0 && gapPct >= gapRel - 1e-9;
    const name = p.nom || 'Parcelle', crop = String(p.culture).trim(), n = peers.length;
    const text = `${name} : NDVI ${fr(last.ndvi)} contre ${fr(med)} pour les ${n} autres parcelles de ${crop} mesurées ${dateSpan(peers.map(x => x.date))}`;
    const why = [
      `${text}.`,
      `Écart de ${fr(gap)} (${Math.round(gapPct * 100)} %) avec la médiane ; seuil : ${fr(gapAbs, 1)} et ${Math.round(gapRel * 100)} %.`,
      `Image de ${name} du ${dayLabel(last.date)} ; parcelles comparées : ${peers.map(x => x.name).join(', ')}.`,
      'Signal à vérifier sur le terrain : variété, date de semis, sol ou nuages peuvent l’expliquer.'
    ];
    out.push({parcelId: p.id, name, culture: crop, surfaceHa: Number.isFinite(Number(p.surfaceHa)) ? Number(p.surfaceHa) : null,
      date: last.date, ndvi: last.ndvi, median: med, peers, gap, gapPct, lagging,
      level: lagging && (gap >= 0.2 || gapPct >= 0.3) ? 'warning' : 'info', text, why});
  }
  return out;
}
/** Parcelles nettement en retard, la plus grande différence d'abord. */
export function ndviPeerAlerts(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && r.lagging).sort((a, b) => b.gap - a.gap || String(a.parcelId).localeCompare(String(b.parcelId)));
}

// Dernier calcul publié par l'écran satellite (cache local), lu par le fil « À décider » de l'accueil.
let published = [];
export function publishNdviPeers(rows) {published = Array.isArray(rows) ? rows : [];}
export function publishedNdviPeers() {return published;}
