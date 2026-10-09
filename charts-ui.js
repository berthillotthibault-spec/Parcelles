// Branchement des graphiques SVG (n° 27) : anneau d'assolement, sparklines des KPI de
// l'accueil, frise de pâturage et courbe NDVI dans la fiche parcelle. Lecture seule.
import {donutChart, cropSegments, grazingTimeline, sparkline, homeKpiSeries, ndviChart} from './charts.js';
import {SATELLITE_CACHE} from './satellite.js';
import {escapeHtml as e, formatNumber} from './utils.js';

const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const KPI_LABELS = {today: 'Travaux et tâches prévus par jour', overdue: 'En retard', grazing: 'Animaux au pré'};

export function createChartsUI({doc = globalThis.document, getState = () => ({}), storage = null, cultureColor = () => 'var(--brand)', now = () => Date.now()} = {}) {
  // Ajoute une sparkline sous chaque KPI de l'accueil (data-target : today, overdue, grazing).
  function decorateSummary(root) {
    if (!root) return;
    const series = homeKpiSeries(getState(), isoDay(new Date(now())));
    for (const card of root.querySelectorAll('[data-target]')) {
      const values = series[card.dataset.target];
      if (!values || card.querySelector('.chart-spark')) continue;
      card.insertAdjacentHTML('beforeend', sparkline(values, {label: KPI_LABELS[card.dataset.target], days: series.days}));
    }
  }

  // Anneau + légende (texte en jetons, pastille colorée pour l'identité).
  function rotationHtml(parcels = getState().parcelles || []) {
    const segments = cropSegments(parcels, cultureColor);
    if (!segments.length) return '';
    const total = segments.reduce((s, x) => s + x.value, 0);
    return `<div class="chart-donut-wrap">${donutChart(segments, {caption: 'Assolement'})}<ul class="chart-legend">${segments.map(s => `<li><i style="background:${e(s.color)}" aria-hidden="true"></i><span>${e(s.label)}</span><b>${formatNumber(s.value)} ha · ${Math.round(s.value / total * 100)} %</b></li>`).join('')}</ul></div>`;
  }

  // Frise des 12 derniers mois pour une parcelle, et emplacement NDVI.
  // Largeur réelle du panneau : le SVG est dessiné à l'échelle 1, sans déformation du texte.
  const panelWidth = () => Math.max(260, Math.min(960, (doc?.querySelector?.('#parcel-detail-body')?.clientWidth || 360) - 34));

  function parcelHtml(parcel) {
    if (!parcel) return '';
    const to = isoDay(new Date(now())), fromDate = new Date(now()); fromDate.setFullYear(fromDate.getFullYear() - 1); fromDate.setDate(fromDate.getDate() + 1);
    const sessions = (getState().grazingSessions || []).filter(s => !s.deletedAt && s.parcelId === parcel.id && s.startDate)
      .map(s => ({start: String(s.startDate).slice(0, 10), end: s.endDate ? String(s.endDate).slice(0, 10) : '', count: Array.isArray(s.animals) && s.animals.length ? s.animals.length : Number(s.animalsCount ?? s.count) || 0, type: s.animalType || ''}));
    const frise = sessions.length ? `<section class="panel chart-panel"><div class="panel-heading"><h2>Pâturage sur 12 mois</h2></div>${grazingTimeline([{label: parcel.nom, sessions}], {from: isoDay(fromDate), to, today: to, width: panelWidth()})}</section>` : '';
    return `${frise}<div class="chart-ndvi-slot" data-chart-ndvi="${e(parcel.id)}" hidden></div>`;
  }

  // Courbe NDVI seulement si des données satellite sont déjà en cache (aucun appel réseau).
  async function mountParcel(parcel) {
    const slot = doc?.querySelector?.(`[data-chart-ndvi="${CSS.escape(parcel?.id || '')}"]`);
    if (!slot || !storage?.get) return;
    let entries = [];
    try { entries = (await storage.get(SATELLITE_CACHE)) || []; } catch { return; }
    const entry = entries.filter(x => x?.parcelId === parcel.id && Array.isArray(x.series)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
    const width = panelWidth(), svg = entry ? ndviChart(entry.series, {width, height: Math.round(Math.min(200, Math.max(140, width * 0.32)))}) : '';
    if (!svg || !slot.isConnected) return;
    slot.innerHTML = `<section class="panel chart-panel"><div class="panel-heading"><h2>NDVI</h2></div>${svg}<p class="form-note">Images satellite en cache du ${e(new Date(entry.savedAt).toLocaleDateString('fr-FR'))} ; nuages et images partielles exclus.</p></section>`;
    slot.hidden = false;
  }

  return {decorateSummary, rotationHtml, parcelHtml, mountParcel};
}
