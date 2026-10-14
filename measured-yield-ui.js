// n° 90 · Rendement mesuré (fiche Économie, Pilotage) et rentabilité intra-parcellaire sur la carte.
// Module chargé à la demande (lazy-modules.js). Rien n'est écrit sans confirmation : le bouton
// « Utiliser … mesuré ? » ouvre une confirmation en place qui rappelle la valeur saisie et l'écart.
import {escapeHtml as e, campaignFor} from './utils.js';
import {YieldRepository} from './yield.js';
import {parcelMargin} from './pilotage.js';
import {measuredYieldProposal, measuredCampaigns, yieldMapMeasure, applyMeasuredYield, profitZones, economicsFor, formatYield, parcelAreaHa, SOURCE_LABELS} from './measured-yield.js';

const fmt = (v, digits = 1) => v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('fr-FR', {maximumFractionDigits: digits}).format(v);
const eur = v => v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0}).format(v);
const signed = (v, unit) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatYield(Math.abs(v), unit)}`;
const MAX_PILOTAGE_MAPS = 12;

export function createMeasuredYieldUI({store, state = () => store.snapshot(), map, modal, closeModal, toast, showMap, canWrite = () => true, onApplied = null}) {
  const repo = new YieldRepository(store), cache = new Map(), pending = new Map();
  let parcelCtx = null, pilotageCtx = null, ticket = 0;
  const data = () => state();
  const parcelById = id => (data().parcelles || []).find(p => p.id === id && !p.deletedAt) || null;
  const liveMaps = parcelId => repo.list(parcelId).filter(d => !d.deletedAt);

  // Analyse d'une carte (fichier brut lu sur l'appareil) : mémorisée par import et par contour.
  async function measureOf(doc, parcel) {
    const key = `${store.workspaceContext().key}:${doc.id}:${doc.updatedAt || doc.version || ''}:${JSON.stringify(parcel.geometry || null).length}`;
    if (cache.has(key)) return cache.get(key);
    if (!pending.has(key)) pending.set(key, (async () => {
      try { const m = yieldMapMeasure(doc, await repo.source(doc), parcel); cache.set(key, m); while (cache.size > 8) cache.delete(cache.keys().next().value); return m; }
      catch (error) { return {source: 'yieldMap', docId: doc.id, name: doc.name, error: error.message}; }
      finally { pending.delete(key); }
    })());
    return pending.get(key);
  }
  async function mapsFor(parcel) {
    if (!parcel?.geometry) return [];
    return Promise.all(liveMaps(parcel.id).map(doc => measureOf(doc, parcel)));
  }

  function sourceText(c) {
    if (c.source === 'harvest') return `${c.lots} lot${c.lots > 1 ? 's' : ''} · ${fmt(c.quantityT, 2)} t sur ${fmt(c.areaHa, 2)} ha${c.humidity !== null ? ` · humidité moyenne ${fmt(c.humidity)} %` : ''} · quantité brute, humidité non corrigée${c.ignored ? ` · ${c.ignored} lot${c.ignored > 1 ? 's' : ''} sans quantité ignoré${c.ignored > 1 ? 's' : ''}` : ''}`;
    return `« ${c.name} » · moyenne de ${fmt(c.used, 0)} points retenus (${fmt(c.excluded, 0)} exclus, nettoyage standard)${c.dated ? '' : ' · campagne déduite de la date d’import'}`;
  }
  function gapText(p, c) {
    if (c.status === 'empty') return 'Aucun rendement saisi pour cette campagne.';
    if (c.status === 'same') return `Conforme au rendement saisi (${formatYield(p.entered, p.unit)}).`;
    return `Rendement saisi : ${formatYield(p.entered, p.unit)} · écart ${signed(c.delta, p.unit)}${c.deltaPct !== null ? ` (${c.deltaPct > 0 ? '+' : ''}${fmt(c.deltaPct)} %)` : ''}.`;
  }
  const askButton = (p, c) => !canWrite() || c.status === 'same' ? '' : `<button type="button" class="button ${c === p.best ? 'primary' : 'secondary'}" data-my="ask" data-parcel-id="${e(p.parcelId)}" data-campaign="${e(p.campaign)}" data-source="${e(c.source)}"${c.docId ? ` data-doc-id="${e(c.docId)}"` : ''}>Utiliser ${e(formatYield(c.value, p.unit))} mesuré ?</button>`;
  function candidateHtml(p, c, {compact = false} = {}) {
    return `<div class="my-candidate" data-my-source="${e(c.source)}"${c.docId ? ` data-my-doc="${e(c.docId)}"` : ''}><p><strong>${e(formatYield(c.value, p.unit))} mesuré</strong> · ${e(c.label)}${compact ? '' : `<br><small>${e(sourceText(c))}</small>`}</p><p class="${c.status === 'differs' ? 'my-gap is-different' : 'my-gap'}"><small>${e(gapText(p, c))}</small></p>${askButton(p, c)}<div class="my-confirm" hidden></div></div>`;
  }
  function campaignHtml(p, {mapsLoading = false, errors = []} = {}) {
    const items = p.candidates.map(c => candidateHtml(p, c)).join('');
    const unusable = p.unusable.map(u => `<p class="form-note">${e(u.label)}${u.name ? ` « ${e(u.name)} »` : ''} : ${e(u.reason)}</p>`).join('');
    return `<article class="my-campaign" data-campaign="${e(p.campaign)}"><h3>Campagne ${e(p.campaign)}</h3>${items || '<p class="form-note">Aucune mesure exploitable pour cette campagne.</p>'}${unusable}${mapsLoading ? '<p class="form-note">Lecture des cartes de rendement…</p>' : ''}${errors.map(x => `<p class="form-note">Carte « ${e(x.name)} » : ${e(x.error)}</p>`).join('')}</article>`;
  }

  // ---------- Fiche Économie de la parcelle ----------
  function parcelInner(parcel, maps, {loading = false} = {}) {
    const ok = maps.filter(m => !m.error), errors = maps.filter(m => m.error);
    const campaigns = measuredCampaigns(data(), parcel, ok).slice(0, 4);
    const hasMaps = liveMaps(parcel.id).length > 0;
    const body = campaigns.map((campaign, i) => campaignHtml(measuredYieldProposal(data(), parcel, {campaign, maps: ok}), {errors: i === 0 ? errors : []})).join('');
    const intra = hasMaps ? `<div class="satellite-actions"><button type="button" class="button secondary" data-my="profit-zones" data-id="${e(parcel.id)}">Rentabilité intra-parcellaire sur la carte</button></div>` : '';
    return `<div class="panel-heading"><h2>Rendement mesuré</h2></div><p class="form-note">Rendement réel calculé à partir des lots de récolte (quantité / surface) ou de la carte de rendement (moyenne nettoyée). Rien n’est enregistré sans votre confirmation.</p>${body || (loading ? '' : `<div class="empty-state">Aucune mesure : enregistrez un lot de récolte (Plus › Lots de récolte) ou importez une carte dans l’onglet Rendement.</div>`)}${loading ? '<p class="form-note" role="status">Lecture des cartes de rendement…</p>' : ''}${!body && errors.length ? errors.map(x => `<p class="form-note">Carte « ${e(x.name)} » : ${e(x.error)}</p>`).join('') : ''}${intra}`;
  }
  function parcelHtml(parcel) {
    if (!parcel) return '';
    const loading = Boolean(parcel.geometry && liveMaps(parcel.id).length);
    return `<section class="panel measured-yield" id="measured-yield-panel" data-parcel-id="${e(parcel.id)}">${parcelInner(parcel, [], {loading})}</section>`;
  }
  async function mount(parcel) {
    const root = document.querySelector('#measured-yield-panel');
    if (!root || !parcel) return;
    const ctx = parcelCtx = {id: parcel.id, root, n: ++ticket};
    if (!liveMaps(parcel.id).length || !parcel.geometry) return;
    const maps = await mapsFor(parcel);
    if (parcelCtx !== ctx || !root.isConnected) return;
    ctx.maps = maps;
    root.innerHTML = parcelInner(parcelById(parcel.id) || parcel, maps);
  }

  // ---------- Pilotage ----------
  const ownParcels = () => (data().parcelles || []).filter(p => !p.deletedAt && (p.ownershipType || 'own') === 'own' && !p.archived);
  function pilotageInner(campaign, mapsByParcel = new Map(), {loading = false} = {}) {
    const rows = [], same = [];
    let other = new Set();
    for (const parcel of ownParcels()) {
      const maps = (mapsByParcel.get(parcel.id) || []).filter(m => !m.error);
      const p = measuredYieldProposal(data(), parcel, {campaign, maps});
      if (p.best?.status === 'same') same.push(parcel);
      else if (p.best) rows.push(p);
      for (const c of measuredCampaigns(data(), parcel, maps)) if (c !== campaign) other.add(c);
    }
    other = [...other].sort().reverse();
    const list = rows.map(p => `<div class="list-row my-pilotage-row" data-parcel-id="${e(p.parcelId)}"><div><strong>${e(p.parcelName)}</strong>${candidateHtml(p, p.best, {compact: true})}</div></div>`).join('');
    const hint = !rows.length && !same.length && other.length ? `<p class="form-note">Mesures disponibles pour ${other.slice(0, 3).map(c => `<button type="button" class="text-button" data-action="pilotage-campaign" data-campaign="${e(c)}">${e(c)}</button>`).join(', ')}.</p>` : '';
    return `<h3>Rendements mesurés · ${e(campaign)}</h3>${list ? `<div class="stack-list">${list}</div>` : ''}${same.length ? `<p class="form-note">${same.length} parcelle${same.length > 1 ? 's' : ''} déjà conforme${same.length > 1 ? 's' : ''} à la mesure.</p>` : ''}${!list && !same.length && !hint && !loading ? '<p class="form-note">Aucun lot de récolte ni carte de rendement pour cette campagne.</p>' : ''}${hint}${loading ? '<p class="form-note" role="status">Lecture des cartes de rendement…</p>' : ''}`;
  }
  function pilotageSection(campaign = campaignFor()) {
    const loading = ownParcels().some(p => p.geometry && liveMaps(p.id).length);
    return `<section class="measured-yield" id="measured-yield-pilotage" data-campaign="${e(campaign)}">${pilotageInner(campaign, new Map(), {loading})}</section>`;
  }
  async function mountPilotage(campaign = campaignFor()) {
    const root = document.querySelector('#measured-yield-pilotage');
    if (!root) return;
    const ctx = pilotageCtx = {campaign, root, n: ++ticket};
    const parcels = ownParcels().filter(p => p.geometry && liveMaps(p.id).length).slice(0, MAX_PILOTAGE_MAPS);
    if (!parcels.length) return;
    const mapsByParcel = new Map();
    for (const parcel of parcels) mapsByParcel.set(parcel.id, await mapsFor(parcel));
    if (pilotageCtx !== ctx || !root.isConnected) return;
    ctx.maps = mapsByParcel;
    root.innerHTML = pilotageInner(campaign, mapsByParcel);
  }

  // ---------- Confirmation et écriture ----------
  async function currentProposal(parcelId, campaign) {
    const parcel = parcelById(parcelId);
    if (!parcel) throw Error('Parcelle introuvable.');
    const maps = (await mapsFor(parcel)).filter(m => !m.error);
    return {parcel, proposal: measuredYieldProposal(data(), parcel, {campaign, maps})};
  }
  const pick = (proposal, source, docId) => proposal.candidates.find(c => c.source === source && (source !== 'yieldMap' || !docId || c.docId === docId)) || null;
  async function ask(button) {
    const box = button.parentElement?.querySelector('.my-confirm');
    if (!box) return;
    const {parcel, proposal} = await currentProposal(button.dataset.parcelId, button.dataset.campaign);
    const c = pick(proposal, button.dataset.source, button.dataset.docId);
    if (!c) { box.hidden = false; box.innerHTML = '<p class="form-error">Mesure introuvable : elle a peut-être changé.</p>'; return; }
    const price = proposal.price, product = price ? c.value * price : null;
    box.hidden = false;
    box.innerHTML = `<div class="notice ${c.status === 'differs' ? 'warning' : 'info'}"><p><strong>Enregistrer ${e(formatYield(c.value, proposal.unit))} comme rendement ${e(proposal.campaign)} de ${e(parcel.nom || 'la parcelle')} ?</strong></p><p>Source : ${e(SOURCE_LABELS[c.source])}. ${c.status === 'differs' ? `Remplace la valeur saisie ${e(formatYield(proposal.entered, proposal.unit))} (écart ${e(signed(c.delta, proposal.unit))}${c.deltaPct !== null ? `, ${c.deltaPct > 0 ? '+' : ''}${e(fmt(c.deltaPct))} %` : ''}).` : 'Aucune valeur saisie n’est remplacée.'}</p><p>${product !== null ? `Produit estimé : ${e(formatYield(c.value, proposal.unit))} × ${e(eur(price))} = ${e(eur(product))}/ha.` : 'Prix de vente non renseigné pour cette campagne : la marge restera incomplète.'}</p><div class="satellite-actions"><button type="button" class="button primary" data-my="confirm" data-parcel-id="${e(parcel.id)}" data-campaign="${e(proposal.campaign)}" data-source="${e(c.source)}"${c.docId ? ` data-doc-id="${e(c.docId)}"` : ''} data-value="${e(c.value)}" data-unit="${e(proposal.unit)}">Confirmer</button><button type="button" class="button secondary" data-my="cancel">Annuler</button></div></div>`;
    box.querySelector('[data-my="confirm"]')?.focus();
  }
  async function confirm(button) {
    if (!canWrite()) throw Error('Votre rôle ne permet pas de modifier cette parcelle.');
    const {parcel, proposal} = await currentProposal(button.dataset.parcelId, button.dataset.campaign);
    const c = pick(proposal, button.dataset.source, button.dataset.docId);
    // La mesure a changé depuis l'affichage de la confirmation : on ne valide pas une autre valeur en silence.
    if (!c || c.value !== Number(button.dataset.value) || proposal.unit !== button.dataset.unit) throw Error('La mesure a changé : vérifiez la nouvelle valeur avant de confirmer.');
    button.disabled = true;
    const next = applyMeasuredYield(parcel, proposal.campaign, {value: c.value, unit: proposal.unit});
    await store.upsert('parcelles', next, {label: `Rendement mesuré ${proposal.campaign} : ${formatYield(c.value, proposal.unit)} (${SOURCE_LABELS[c.source]}) · ${parcel.nom || ''}`.trim()});
    toast?.(`Rendement ${proposal.campaign} enregistré : ${formatYield(c.value, proposal.unit)}.`);
    refresh();
    onApplied?.({parcelId: parcel.id, campaign: proposal.campaign, value: c.value, unit: proposal.unit});
  }
  function refresh() {
    if (parcelCtx?.root?.isConnected) { const p = parcelById(parcelCtx.id); if (p) parcelCtx.root.innerHTML = parcelInner(p, parcelCtx.maps || []); }
    if (pilotageCtx?.root?.isConnected) pilotageCtx.root.innerHTML = pilotageInner(pilotageCtx.campaign, pilotageCtx.maps || new Map());
  }

  // ---------- Carte : rentabilité intra-parcellaire ----------
  function chooseParcel(id) {
    const withMaps = (data().parcelles || []).filter(p => !p.deletedAt && p.geometry && liveMaps(p.id).length);
    if (id) { const p = withMaps.find(x => x.id === id); if (!p) toast?.(`${parcelById(id)?.nom || 'Cette parcelle'} n’a pas de carte de rendement exploitable (contour et import nécessaires).`, 'warning'); return p || null; }
    const selected = map?.selectedId && withMaps.find(p => p.id === map.selectedId);
    if (selected) return selected;
    if (!withMaps.length) { toast?.('Aucune carte de rendement : importez-en une dans l’onglet Rendement d’une parcelle.', 'warning'); return null; }
    if (withMaps.length === 1) return withMaps[0];
    modal('Rentabilité intra-parcellaire', 'Choisissez une parcelle qui possède une carte de rendement.', `<div class="stack-list">${withMaps.map(p => `<button type="button" class="list-row is-button" data-my="profit-zones" data-id="${e(p.id)}"><div><strong>${e(p.nom || 'Parcelle')}</strong><small>${e(p.culture || '')} · ${fmt(parcelAreaHa(p), 2)} ha · ${liveMaps(p.id).length} carte${liveMaps(p.id).length > 1 ? 's' : ''}</small></div></button>`).join('')}</div>`, '<button class="button secondary" data-action="close-modal">Fermer</button>', 'small');
    return null;
  }
  async function showProfitZones(id) {
    const parcel = chooseParcel(id);
    if (!parcel) return;
    const docs = liveMaps(parcel.id).sort((a, b) => (b.yieldMap?.importedAt || 0) - (a.yieldMap?.importedAt || 0));
    const measure = await measureOf(docs[0], parcel);
    if (measure.error) throw Error(measure.error);
    if (!measure.points?.length) throw Error('Aucun point retenu après nettoyage standard.');
    const campaign = measure.campaign, econ = economicsFor(parcel, campaign), margin = parcelMargin(data(), parcel, {campaign});
    const area = margin.area || parcelAreaHa(parcel), price = Number(econ.salePrice) > 0 ? econ.salePrice : parcel.economics?.salePrice;
    const priceUnit = Number(econ.salePrice) > 0 ? econ.yieldUnit : parcel.economics?.yieldUnit;
    if (!(margin.charges > 0) || !(area > 0)) throw Error(`Aucune charge enregistrée pour ${campaign} sur ${parcel.nom || 'cette parcelle'} : chiffrez les travaux ou saisissez des charges €/ha.`);
    const zones = profitZones({parcel, points: measure.points, costHa: margin.charges / area, price, unit: priceUnit === 'q/ha' ? 'q/ha' : 't/ha'});
    closeModal?.();
    draw(parcel, campaign, measure, zones, {missing: margin.unknownRealized + margin.unknownPlanned, borrowedPrice: !(Number(econ.salePrice) > 0)});
  }
  function draw(parcel, campaign, measure, zones, {missing = 0, borrowedPrice = false} = {}) {
    showMap?.(parcel.id);
    map.clearFarmOverlay(); map.clearSatelliteOverlay(); map.clearYieldOverlay(); map.init();
    if (!map.map) throw Error('Carte Leaflet indisponible.');
    const L = window.L;
    if (!map.map.getPane('yieldPane')) { const pane = map.map.createPane('yieldPane'); pane.style.zIndex = '440'; pane.style.pointerEvents = 'none'; }
    const renderer = L.canvas({pane: 'yieldPane', padding: .3});
    map.yieldRenderer = renderer; map.yieldParcelId = parcel.id; map.yieldOverlay = L.layerGroup().addTo(map.map);
    for (const c of zones.cells) L.geoJSON(c.geometry, {renderer, pane: 'yieldPane', interactive: false, style: {stroke: true, color: c.color, weight: .5, opacity: .8, fillColor: c.color, fillOpacity: .78}}).addTo(map.yieldOverlay);
    const u = zones.unprofitable, control = L.control({position: 'topleft'});
    control.onAdd = () => {
      const div = L.DomUtil.create('div', 'satellite-map-label yield-map-label profit-map-label');
      div.innerHTML = `<strong>Rentabilité · ${e(parcel.nom || 'Parcelle')} · ${e(campaign)}</strong><small>Seuil de rentabilité ${fmt(zones.breakEvenTha, 2)} t/ha · charges ${e(eur(zones.costHa))}/ha · prix ${e(eur(zones.pricePerTon))}/t${borrowedPrice ? ' (prix de la fiche courante)' : ''}</small><p class="profit-loss"><strong>${u.cells ? `Zones non rentables : ${fmt(u.areaHa, 2)} ha (${fmt(u.share * 100, 0)}&nbsp;% mesuré) · perte estimée ${e(eur(u.loss))}` : 'Aucune zone non rentable mesurée'}</strong></p><div class="profit-legend">${zones.classes.filter(c => c.cells).map(c => `<div><span style="color:${c.color}">●</span> ${e(c.label)} · ${fmt(c.areaHa, 2)} ha · moy. ${e(eur(c.marginHa))}/ha</div>`).join('')}</div><details><summary>Zones de rendement × charges</summary>${zones.yieldZones.map(z => `<div>${e(z.label)} · ${fmt(z.areaHa, 2)} ha · ${fmt(z.tha, 2)} t/ha · marge ${e(eur(z.marginHa))}/ha</div>`).join('')}<small>Mailles de ${zones.cellMeters} m entièrement dans le contour, ${fmt(zones.measuredHa, 2)} ha mesurés sur ${fmt(zones.parcelHa, 2)} ha. Charges connues de la campagne réparties uniformément${missing ? ` ; ${missing} travail${missing > 1 ? 'aux' : ''} sans coût : perte sous-estimée` : ''}. Carte « ${e(measure.name)} », nettoyage standard.</small></details><button type="button" class="button secondary">Désactiver</button>`;
      div.querySelector('button').onclick = () => map.clearYieldOverlay();
      L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    control.addTo(map.map); map.yieldControl = control; map.render(map.lastState);
  }

  document.addEventListener('click', async event => {
    const b = event.target.closest?.('[data-my]');
    if (!b) return;
    const action = b.dataset.my;
    try {
      if (action === 'ask') await ask(b);
      else if (action === 'cancel') { const box = b.closest('.my-confirm'); if (box) { box.hidden = true; box.innerHTML = ''; } }
      else if (action === 'confirm') await confirm(b);
      else if (action === 'profit-zones') await showProfitZones(b.dataset.id || null);
    } catch (error) {
      b.disabled = false;
      const box = b.closest('.my-confirm');
      if (box) { box.hidden = false; box.insertAdjacentHTML('afterbegin', `<p class="form-error">${e(error.message)}</p>`); }
      else toast?.(error.message, 'error');
    }
  });

  return {parcelHtml, mount, pilotageSection, mountPilotage, showProfitZones, refresh};
}
