// n° 48 : groupe « Réglementaire » du panneau Couches, bandeau de la fiche parcelle et valeurs indicatives.
// Hors connexion : la dernière évaluation de la parcelle (mémorisée sur l'appareil) reste affichée.
import {html, raw} from './safe-html.js';
import {REG_DISCLAIMER, REG_LAYERS, REG_RULES_DEFAULT, evaluateParcel, evaluationMessages, evaluationRequests, geometrySignature, linesOf, normalizeRegLayers, regulatoryRules} from './regulatory.js';

const CACHE_KEY='parcelles:reglementaire';
const MAX_ENTRIES=300,STALE_MS=7*864e5,TIMEOUT_MS=15000;
// Instance active, utilisée par la préconisation (precision-ui.js) pour la bande le long des cours d'eau.
let activeUI=null;
export function regulatoryWaterLines(parcel){if(!activeUI)throw new Error('Couches réglementaires indisponibles.');return activeUI.waterLines(parcel);}
export function regulatoryRulesNow(){return activeUI?activeUI.rules():regulatoryRules();}

export function createRegulatoryUI({state, store, parcelMap, toast, modal, closeModal, fetchImpl = (...args) => globalThis.fetch(...args), storage = globalThis.localStorage, doc = globalThis.document, online = () => globalThis.navigator?.onLine !== false, now = () => Date.now()} = {}) {
  const pending = new Map();
  const rules = () => regulatoryRules(state().preferences?.regulatoryRules);
  const enabled = () => normalizeRegLayers(state().preferences?.mapRegLayers);

  function readCache() { try { return JSON.parse(storage?.getItem(CACHE_KEY) || '{}') || {}; } catch { return {}; } }
  function writeCache(cache) {
    try {
      const entries = Object.entries(cache).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, MAX_ENTRIES);
      storage?.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }
  function cached(parcel) { const entry = readCache()[parcel.id]; return entry && entry.signature === geometrySignature(parcel.geometry) ? entry : null; }

  async function getJson(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try { const response = await fetchImpl(url, {signal: controller.signal, headers: {accept: 'application/json'}}); if (!response?.ok) throw new Error(`HTTP ${response?.status}`); return await response.json(); }
    finally { clearTimeout(timer); }
  }
  /** Interroge les services publics ; un service en échec rend l'évaluation partielle sans tout bloquer. */
  async function evaluate(parcel) {
    if (pending.has(parcel.id)) return pending.get(parcel.id);
    const job = (async () => {
      const responses = {};
      await Promise.all(evaluationRequests(parcel.geometry, {rules: rules()}).map(async request => { try { responses[request.key] = await getJson(request.url); } catch { responses[request.key] = null; } }));
      if (!Object.values(responses).some(Boolean)) throw new Error('Services réglementaires injoignables.');
      const evaluation = evaluateParcel(parcel, responses, {rules: rules(), at: now()});
      evaluation.lines = linesOf([...(responses.bcae?.features || []), ...(responses.hydro?.features || [])]).map(line => line.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]));
      if (!evaluation.waterChecked) evaluation.lines = cached(parcel)?.lines; // cours d'eau non interrogés : garder les lignes connues
      const cache = readCache(); cache[parcel.id] = evaluation; writeCache(cache);
      return evaluation;
    })().finally(() => pending.delete(parcel.id));
    pending.set(parcel.id, job);
    return job;
  }

  function bannerInner(parcel, evaluation, {loading = false, error = ''} = {}) {
    const r = rules(), messages = evaluationMessages(evaluation, r);
    const date = evaluation ? new Date(evaluation.at).toLocaleDateString('fr-FR') : '';
    const lines = messages.length ? messages.map(msg => html`<p class="reg-msg is-${msg.level}">${msg.text}${(msg.links || []).slice(0, 3).map(l => html` <a href="${l.url}" target="_blank" rel="noopener">Fiche ${l.name}</a>`)}</p>`) : '';
    const status = loading ? 'Recherche des cours d’eau et zones protégées…' : error ? error : evaluation ? `Évaluée le ${date}${online() ? '' : ' · hors connexion, dernière évaluation'}` : online() ? '' : 'Hors connexion : aucune évaluation mémorisée pour cette parcelle.';
    return html`<div class="reg-head"><strong>Réglementaire</strong><span class="badge info">indicatif</span>${parcel.geometry && online() ? html`<button type="button" class="text-button" data-reg-refresh="${parcel.id}">Actualiser</button>` : ''}</div>${lines}<small class="form-note">${status}</small><small class="form-note">${REG_DISCLAIMER} Valeurs du ${r.date}${r.custom ? ' (modifiées)' : ''}.</small>`;
  }
  function parcelHtml(parcel) {
    if (!parcel?.geometry) return '';
    return String(html`<section class="reg-banner" id="reg-banner" data-parcel="${parcel.id}">${bannerInner(parcel, cached(parcel))}</section>`);
  }
  async function refresh(parcel, {force = false} = {}) {
    const box = doc.querySelector('#reg-banner'); if (!box || box.dataset.parcel !== parcel.id) return;
    const entry = cached(parcel);
    if (!online()) { box.innerHTML = String(bannerInner(parcel, entry)); return; }
    if (entry && !force && now() - entry.at < STALE_MS) return;
    box.innerHTML = String(bannerInner(parcel, entry, {loading: true}));
    try { const evaluation = await evaluate(parcel); if (box.isConnected) box.innerHTML = String(bannerInner(parcel, evaluation)); }
    catch (error) { if (box.isConnected) box.innerHTML = String(bannerInner(parcel, entry, {error: entry ? 'Services indisponibles : dernière évaluation affichée.' : 'Services réglementaires indisponibles pour le moment.'})); }
  }
  function mountParcel(parcel) {
    const box = doc.querySelector('#reg-banner'); if (!box) return;
    box.addEventListener('click', event => { if (event.target.closest('[data-reg-refresh]')) refresh(parcel, {force: true}); });
    refresh(parcel);
  }
  /** Lignes d'eau autour de la parcelle pour la bande exclue d'une préconisation (réseau, sinon dernière évaluation). */
  async function waterLines(parcel) {
    const entry = cached(parcel);
    if (online()) { try { const evaluation = await evaluate(parcel); if (evaluation.waterChecked || evaluation.lines) return evaluation.lines || []; } catch {} }
    if (entry?.lines) return entry.lines;
    throw new Error('Cours d’eau inconnus pour cette parcelle : connectez-vous une fois pour les charger.');
  }

  // ---------- Panneau Couches ----------
  function layersHtml() {
    const on = enabled();
    return String(html`<div class="ly-reg"><p class="ly-label">Réglementaire <small>· indicatif</small></p>${REG_LAYERS.map(layer => html`<div class="ly-row"><span><strong>${layer.label}</strong><small>${layer.hint} · ${layer.date}</small></span><button type="button" class="ly-switch${raw(on.includes(layer.id) ? ' is-on' : '')}" data-reg="${layer.id}" role="switch" aria-checked="${String(on.includes(layer.id))}" aria-label="${layer.label}"><i></i></button></div>`)}<p class="ly-note">Services publics IGN Géoplateforme et Sandre, sans compte.${online() ? '' : ' Hors connexion : ces couches ne se chargent pas, vos parcelles restent affichées.'} ZNT : dépend du produit (AMM). <button type="button" class="text-button" data-reg-rules="1">Valeurs indicatives</button></p></div>`);
  }
  function onLayerError(def) { toast(`${def.label} : service indisponible ou hors connexion.`, 'error'); }
  function bindLayers(root) {
    root?.addEventListener('click', async event => {
      if (event.target.closest('[data-reg-rules]')) { openRules(); return; }
      const button = event.target.closest('[data-reg]'); if (!button) return;
      const id = button.dataset.reg, def = REG_LAYERS.find(layer => layer.id === id), on = !button.classList.contains('is-on');
      button.classList.toggle('is-on', on); button.setAttribute('aria-checked', String(on));
      parcelMap.setRegulatoryLayer(def, on, {onError: onLayerError});
      if (on && !online()) toast('Hors connexion : la couche s’affichera au retour du réseau.', 'error');
      const next = new Set(enabled()); on ? next.add(id) : next.delete(id);
      try { await store.setPreferences({mapRegLayers: normalizeRegLayers([...next])}); } catch (error) { toast(error.message, 'error'); }
    });
  }
  function restore() { const on = enabled(); for (const layer of REG_LAYERS) parcelMap.setRegulatoryLayer(layer, on.includes(layer.id), {onError: onLayerError}); }

  // ---------- Valeurs indicatives modifiables ----------
  function openRules() {
    const r = rules();
    modal('Valeurs réglementaires indicatives', `Valeurs du ${r.date}, modifiables selon votre arrêté départemental.`,
      html`<form id="reg-rules-form" class="form-grid"><label>Bande tampon BCAE (m)<input name="bcaeBufferM" type="number" min="0" max="500" step="1" value="${r.bcaeBufferM}"></label><label>ZNT minimale (m)<input name="zntMinM" type="number" min="0" max="500" step="1" value="${r.zntMinM}"></label><label>ZNT possibles selon l’AMM (m)<input name="zntOptionsM" value="${r.zntOptionsM.join(', ')}"></label><label>Signaler un cours d’eau à moins de (m)<input name="nearWaterM" type="number" min="0" max="500" step="1" value="${r.nearWaterM}"></label><label class="span-2">Date des valeurs<input name="date" value="${r.date}"></label><label class="span-2">Source<textarea name="source" rows="3">${r.source}</textarea></label></form><p class="form-note">${REG_DISCLAIMER}</p>`,
      html`<button class="button secondary" id="reg-rules-reset">Valeurs par défaut</button><button class="button primary" id="reg-rules-save">Enregistrer</button>`, 'small');
    doc.querySelector('#reg-rules-reset')?.addEventListener('click', async () => { await store.setPreferences({regulatoryRules: {}}); toast('Valeurs indicatives par défaut rétablies.'); closeModal?.(); });
    doc.querySelector('#reg-rules-save')?.addEventListener('click', async () => {
      const form = new FormData(doc.querySelector('#reg-rules-form')), value = Object.fromEntries(form);
      const next = {bcaeBufferM: Number(value.bcaeBufferM), zntMinM: Number(value.zntMinM), nearWaterM: Number(value.nearWaterM), zntOptionsM: String(value.zntOptionsM || '').split(/[;,\s]+/).map(Number).filter(Number.isFinite), date: String(value.date || ''), source: String(value.source || '')};
      const clean = regulatoryRules(next), stored = {};
      for (const key of ['bcaeBufferM', 'zntMinM', 'nearWaterM', 'zntOptionsM', 'date', 'source']) if (JSON.stringify(clean[key]) !== JSON.stringify(REG_RULES_DEFAULT[key])) stored[key] = clean[key];
      await store.setPreferences({regulatoryRules: stored}); toast('Valeurs indicatives enregistrées.', 'success'); closeModal?.();
    });
  }

  const ui = {parcelHtml, mountParcel, refresh, evaluate, waterLines, layersHtml, bindLayers, restore, openRules, rules};
  activeUI = ui;
  return ui;
}
