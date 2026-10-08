// n° 57 — Portance et bilan hydrique : carte « Peut-on rentrer ? » sur la fiche parcelle, ligne de
// synthèse dans la carte météo de l’accueil, saisie du type de sol et des relevés de pluviomètre.
// Une seule requête Open-Meteo au centre de l’exploitation, gardée en cache sur l’appareil.
import {
  SOIL_TEXTURES, SOIL_DRAINAGE, LEVELS, SOIL_WATER_CACHE_KEY, GRASS_DEFICIT_FRACTION, ASSUMED_START_FRACTION,
  buildSoilWaterUrl, parseSoilWaterResponse, assessParcel, farmSummary, cacheAgeLabel, isStale,
  addGaugeReading, formatMm, isoDay
} from './soil-water.js';
import {escapeHtml as e, geometryCentroid} from './utils.js';

const RETRY_AFTER_ERROR_MS = 10 * 60 * 1000;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function createSoilWaterUI({store, state, modal, closeModal, toast, bindChipChoices = () => {}, weather = () => null, canWrite = () => true, doc = globalThis.document, storage = globalThis.localStorage, fetchImpl = (...args) => globalThis.fetch(...args), nav = globalThis.navigator} = {}) {
  let cache = readCache();
  let inflight = null, lastError = null, lastErrorAt = 0;

  function readCache() {
    try {const raw = storage?.getItem(SOIL_WATER_CACHE_KEY); const c = raw ? JSON.parse(raw) : null; return c?.days?.length ? c : null;} catch {return null;}
  }
  function writeCache(value) {
    try {storage?.setItem(SOIL_WATER_CACHE_KEY, JSON.stringify(value));} catch {/* stockage plein ou bloqué : le calcul reste en mémoire */}
  }
  const online = () => nav?.onLine !== false;
  const data = () => state() || {};
  const parcels = () => (data().parcelles || []).filter(p => p && !p.deletedAt && !p.archived);
  const stations = () => (data().weatherStations || []).filter(s => s && !s.deletedAt);

  function farmPosition() {
    const w = weather();
    if (Number.isFinite(Number(w?.latitude)) && Number.isFinite(Number(w?.longitude))) return {latitude: Number(w.latitude), longitude: Number(w.longitude), place: w.place || ''};
    const farm = data().exploitation || {};
    const lat = Number(farm.latitude), lon = Number(farm.longitude);
    if (farm.latitude !== '' && farm.latitude != null && Number.isFinite(lat) && Number.isFinite(lon)) return {latitude: lat, longitude: lon, place: farm.commune || ''};
    const centers = parcels().map(p => geometryCentroid(p.geometry)).filter(Boolean);
    if (!centers.length) return null;
    return {latitude: centers.reduce((s, c) => s + c.latitude, 0) / centers.length, longitude: centers.reduce((s, c) => s + c.longitude, 0) / centers.length, place: ''};
  }

  // Charge le bilan si le cache a plus de 3 h ; ne relance pas après un échec avant 10 min.
  function ensure({force = false} = {}) {
    if (inflight) return inflight;
    if (!force && !isStale(cache)) return Promise.resolve(cache);
    if (!online()) return Promise.resolve(cache);
    if (!force && lastErrorAt && Date.now() - lastErrorAt < RETRY_AFTER_ERROR_MS) return Promise.resolve(cache);
    const position = farmPosition();
    if (!position) return Promise.resolve(cache);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    inflight = (async () => {
      try {
        const response = await fetchImpl(buildSoilWaterUrl(position), controller ? {signal: controller.signal} : undefined);
        if (!response.ok) throw new Error(`service météo ${response.status}`);
        const parsed = parseSoilWaterResponse(await response.json(), {place: position.place});
        if (!parsed) throw new Error('données de pluie incomplètes');
        cache = parsed; lastError = null; lastErrorAt = 0;
        writeCache(cache);
      } catch (error) {
        lastError = error?.name === 'AbortError' ? 'le service met trop de temps à répondre' : (error?.message || 'service indisponible');
        lastErrorAt = Date.now();
      } finally {
        if (timer) clearTimeout(timer);
        inflight = null;
        refreshDom();
      }
      return cache;
    })();
    return inflight;
  }

  function refreshDom() {
    if (!doc) return;
    doc.querySelectorAll('[data-soil-card]').forEach(card => {
      const p = parcels().find(x => x.id === card.dataset.parcelId);
      if (p) card.outerHTML = parcelHtml(p, {silent: true});
    });
    renderHome();
    const farm = doc.getElementById('soil-farm-body');
    if (farm) farm.innerHTML = farmBody();
  }

  const gauge = (level, label) => `<div class="soil-gauge" role="img" aria-label="Portance : ${e(label)}">${['good', 'limit', 'avoid'].map(k => `<span class="soil-seg is-${k}${k === level ? ' is-on' : ''}"><i aria-hidden="true"></i><small>${LEVELS[k].label}</small></span>`).join('')}</div>`;
  const stamp = () => `${!online() ? 'Hors connexion · ' : ''}Données météo ${cacheAgeLabel(cache?.loadedAt)}${isStale(cache) ? ' · à actualiser' : ''}`;
  const sourceText = balance => balance.stationDays ? `pluie de ${plural(balance.stationDays, 'jour relevé', 'jours relevés')} par station ou pluviomètre, le reste estimé par le modèle Open-Meteo` : 'pluie et ETP estimées par le modèle Open-Meteo au centre de l’exploitation';

  function emptyState() {
    if (inflight || (!cache && online() && farmPosition() && !lastError)) return '<p class="soil-empty">Calcul du bilan hydrique…</p>';
    if (!farmPosition()) return '<p class="soil-empty">Renseignez la commune de l’exploitation ou dessinez une parcelle pour estimer la portance.</p>';
    if (!online()) return '<p class="soil-empty">Hors connexion : le bilan sera calculé au retour du réseau.</p>';
    return `<p class="soil-empty">Bilan indisponible${lastError ? ` : ${e(lastError)}` : ''}. <button type="button" class="text-button" data-soil="retry">Réessayer</button></p>`;
  }

  function hypotheses(a) {
    const {profile, balance, portance} = a;
    return `<details class="soil-how"><summary>Comment c’est estimé</summary><ul>
      <li>Réserve utile ${profile.assumed ? 'supposée' : 'retenue'} : ${profile.ru} mm (sol ${profile.label.toLowerCase()}${profile.assumed ? ', type de sol non renseigné' : ''}).</li>
      <li>Bilan sur ${plural(balance.days, 'jour', 'jours')} : ${sourceText(balance)}.</li>
      <li>${balance.initSource === 'model' ? 'Point de départ : humidité du sol en surface donnée par le modèle.' : `Point de départ supposé à ${Math.round(100 * ASSUMED_START_FRACTION)} % de la réserve, faute de mesure.`}</li>
      <li>Circulation déconseillée au-delà de ${formatMm(portance.rain3Threshold)} mm de pluie en 3 jours${a.profile.drainage !== 'normal' ? ` (seuil corrigé : sol ${SOIL_DRAINAGE[a.profile.drainage].label.toLowerCase()})` : ''}.</li>
      <li>Prairies : alerte sous ${Math.round(GRASS_DEFICIT_FRACTION * 100)} % de réserve.</li>
    </ul><p>Estimation indicative, ce n’est pas une mesure : vérifiez l’état du sol sur place avant d’engager du matériel lourd.</p></details>`;
  }

  function parcelHtml(parcel, {silent = false} = {}) {
    if (!parcel) return '';
    if (!silent) ensure();
    const a = cache ? assessParcel(parcel, cache, stations()) : null;
    const write = canWrite();
    const soilLine = (() => {
      const t = SOIL_TEXTURES[parcel.soilTexture], d = SOIL_DRAINAGE[parcel.soilDrainage];
      const text = t ? `Sol ${t.label.toLowerCase()}${d && parcel.soilDrainage !== 'normal' ? ` · ${d.label.toLowerCase()}` : ''}` : 'Type de sol non renseigné : sol limoneux supposé';
      return `<div class="soil-soil"><span>${e(text)}</span>${write ? `<button type="button" class="text-button" data-soil="soil-form" data-id="${e(parcel.id)}">${t ? 'Modifier le sol' : 'Préciser le sol'}</button>` : ''}</div>`;
    })();
    let body;
    if (!a) body = emptyState();
    else {
      const {portance, balance} = a;
      body = `<div class="soil-verdict is-${portance.level}"><strong>Portance : ${e(portance.label.toLowerCase())}</strong><span>${e(portance.reasons.join(' · '))}</span></div>
        ${gauge(portance.level, portance.label)}
        <dl class="soil-facts"><div><dt>Pluie 7 j</dt><dd>${formatMm(balance.rain7)} mm</dd></div><div><dt>ETP 7 j</dt><dd>${formatMm(balance.et07)} mm</dd></div><div><dt>Réserve utile</dt><dd>~${balance.percent} %</dd></div></dl>
        ${a.nextRain > 0 ? `<p class="soil-note">Pluie prévue sur 48 h : ${formatMm(a.nextRain)} mm.</p>` : ''}
        ${a.grassDeficit ? '<p class="soil-alert" role="status">Déficit hydrique : la pousse de l’herbe ralentit.</p>' : ''}
        ${hypotheses(a)}`;
    }
    return `<section class="panel soil-card" data-soil-card data-parcel-id="${e(parcel.id)}" aria-labelledby="soil-title-${e(parcel.id)}">
      <div class="panel-heading"><h2 id="soil-title-${e(parcel.id)}">Peut-on rentrer dans la parcelle ?</h2><span class="soil-badge">Estimation</span></div>
      ${body}${soilLine}
      <div class="soil-foot"><small>${cache ? e(stamp()) : ''}</small>${write ? '<button type="button" class="text-button" data-soil="gauge-form">Relevé de pluie</button>' : ''}</div>
    </section>`;
  }

  function homeLine() {
    const s = cache ? farmSummary(parcels(), cache, stations()) : null;
    if (!s) return '';
    const ref = s.reference.balance;
    const label = LEVELS[s.level].label;
    const worstCount = s.counts[s.level];
    const scope = s.level === 'good' ? 'partout' : `${plural(worstCount, 'parcelle', 'parcelles')}`;
    const grass = s.grass.length ? `<span class="soil-home-alert">Déficit hydrique : ${plural(s.grass.length, 'prairie', 'prairies')}</span>` : '';
    return `<button type="button" class="soil-home" data-soil="farm" aria-label="Portance des sols : ${e(label.toLowerCase())}, ${e(scope)}. Ouvrir le détail">
      <span class="soil-home-head"><span class="soil-home-title">Portance</span><span class="soil-pill is-${s.level}">${e(label)}${s.level === 'good' ? '' : ` · ${e(scope)}`}</span></span>
      <span class="soil-home-facts">Pluie 7 j ${formatMm(ref.rain7)} mm · ETP ${formatMm(ref.et07)} mm · réserve ~${ref.percent} %</span>${grass}</button>`;
  }

  function renderHome() {
    if (!doc) return;
    const card = doc.querySelector('[data-home-card="weather"]');
    if (!card) return;
    let root = doc.getElementById('soil-water-home');
    if (!root) {root = doc.createElement('div'); root.id = 'soil-water-home'; root.className = 'soil-water-home'; card.append(root);}
    if (!cache && !inflight) ensure();
    else if (isStale(cache)) ensure();
    root.innerHTML = homeLine();
  }

  function farmBody() {
    const s = cache ? farmSummary(parcels(), cache, stations()) : null;
    if (!s) return emptyState();
    const ref = s.reference;
    const counts = ['avoid', 'limit', 'good'].filter(k => s.counts[k]).map(k => `${k === 'good' ? 'Portance bonne' : k === 'limit' ? 'Portance limite' : 'À éviter'} : ${plural(s.counts[k], 'parcelle', 'parcelles')}`).join(' · ');
    return `${gauge(s.level, LEVELS[s.level].label)}
      <p class="soil-note">${e(counts)}</p>
      <dl class="soil-facts"><div><dt>Pluie 7 j</dt><dd>${formatMm(ref.balance.rain7)} mm</dd></div><div><dt>ETP 7 j</dt><dd>${formatMm(ref.balance.et07)} mm</dd></div><div><dt>Pluie 48 h</dt><dd>${formatMm(ref.nextRain)} mm</dd></div></dl>
      ${s.grass.length ? `<p class="soil-alert" role="status">Déficit hydrique sur ${plural(s.grass.length, 'prairie', 'prairies')} : la pousse de l’herbe ralentit.</p>` : ''}
      <ul class="soil-list">${s.worst.map(({parcel, a}) => `<li><button type="button" class="soil-row" data-action="open-parcel" data-id="${e(parcel.id)}"><span><strong>${e(parcel.nom || 'Parcelle')}</strong><small>${e(a.portance.reasons[0])} · réserve ~${a.balance.percent} %${a.profile.assumed ? ' · sol supposé' : ''}</small></span><span class="soil-pill is-${a.portance.level}">${e(a.portance.label)}</span></button></li>`).join('')}</ul>
      <p class="soil-how-text">Estimation indicative à partir de la pluie et de l’évapotranspiration du modèle Open-Meteo (ou de vos relevés), d’une réserve utile par type de sol et d’un seuil de pluie sur 3 jours. Ce n’est pas une mesure. ${e(stamp())}.</p>`;
  }

  function openFarm() {
    ensure();
    modal('Portance des sols', 'Peut-on rentrer dans les parcelles ?', `<div id="soil-farm-body" class="soil-farm">${farmBody()}</div>`,
      canWrite() ? '<button type="button" class="button secondary" data-soil="gauge-form">Saisir un relevé de pluie</button>' : '', 'small');
  }

  function chips(name, options, current) {
    return `<div class="chip-choices" data-chip-target="${name}" role="group">${Object.entries(options).map(([value, o]) => `<button type="button" class="choice-chip${value === current ? ' is-on' : ''}" data-value="${value}" aria-pressed="${value === current}">${e(o.label)}</button>`).join('')}</div>`;
  }

  function openSoilForm(id) {
    const p = parcels().find(x => x.id === id);
    if (!p) return;
    const texture = SOIL_TEXTURES[p.soilTexture] ? p.soilTexture : '';
    const drainage = SOIL_DRAINAGE[p.soilDrainage] ? p.soilDrainage : 'normal';
    modal('Type de sol', p.nom || 'Parcelle', `<form id="soil-form" class="form-grid soil-form" novalidate>
      <input type="hidden" name="soilTexture" value="${texture}"><input type="hidden" name="soilDrainage" value="${drainage}">
      <fieldset class="span-2"><legend>Texture dominante *</legend>${chips('soilTexture', SOIL_TEXTURES, texture)}</fieldset>
      <fieldset class="span-2"><legend>Drainage</legend>${chips('soilDrainage', SOIL_DRAINAGE, drainage)}</fieldset>
      <p class="span-2 form-note">Sableux : se ressuie vite, petite réserve. Argileux : grosse réserve, sensible au tassement quand il est humide. Hydromorphe : eau stagnante en hiver.</p>
      <p class="span-2 form-error hidden" id="soil-form-error" role="alert"></p></form>`,
    '<button type="button" class="button primary soil-save" data-soil="soil-save">Enregistrer le sol</button>', 'small');
    const form = doc.getElementById('soil-form');
    bindChipChoices(form);
    form.addEventListener('click', event => {if (event.target.closest('.choice-chip')) doc.getElementById('soil-form-error')?.classList.add('hidden');});
    doc.querySelector('.soil-save').dataset.id = id;
  }

  async function saveSoil(id) {
    const form = doc.getElementById('soil-form'), error = doc.getElementById('soil-form-error');
    const p = parcels().find(x => x.id === id);
    if (!form || !p) return;
    const soilTexture = form.elements.soilTexture.value, soilDrainage = form.elements.soilDrainage.value || 'normal';
    if (!SOIL_TEXTURES[soilTexture]) {error.textContent = 'Champ obligatoire : texture dominante.'; error.classList.remove('hidden'); form.querySelector('.choice-chip')?.focus(); return;}
    try {
      await store.upsert('parcelles', {...p, soilTexture, soilDrainage: SOIL_DRAINAGE[soilDrainage] ? soilDrainage : 'normal'}, {label: `Type de sol : ${p.nom}`});
      closeModal();
      toast(`Sol enregistré : ${p.nom || 'parcelle'}.`);
    } catch (err) {error.textContent = err?.message || 'Enregistrement impossible.'; error.classList.remove('hidden');}
  }

  function openGaugeForm() {
    const today = isoDay();
    modal('Relevé de pluie', 'Pluviomètre de l’exploitation', `<form id="soil-gauge-form" class="form-grid" novalidate>
      <label>Date du relevé *<input name="date" type="date" max="${today}" value="${today}" required></label>
      <label>Pluie mesurée (mm) *<input name="rainMm" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex. 12,5" data-autofocus required></label>
      <p class="span-2 form-note">Le relevé remplace l’estimation du modèle pour ce jour dans le bilan hydrique de toutes les parcelles.</p>
      <p class="span-2 form-error hidden" id="soil-gauge-error" role="alert"></p></form>`,
    '<button type="button" class="button primary soil-save" data-soil="gauge-save">Enregistrer le relevé</button>', 'small');
    doc.querySelector('#soil-gauge-form [name="rainMm"]')?.focus();
  }

  async function saveGauge() {
    const form = doc.getElementById('soil-gauge-form'), error = doc.getElementById('soil-gauge-error');
    if (!form) return;
    const date = form.elements.date.value, rainMm = form.elements.rainMm.value.trim();
    const fail = message => {error.textContent = message; error.classList.remove('hidden');};
    if (!date) return fail('Champ obligatoire : date du relevé.');
    if (date > isoDay()) return fail('La date du relevé ne peut pas être dans le futur.');
    if (!rainMm) {form.elements.rainMm.focus(); return fail('Champ obligatoire : pluie mesurée (mm).');}
    try {
      const existing = stations().find(s => s.source === 'manual-gauge') || null;
      const next = addGaugeReading(existing, {date, rainMm});
      await store.upsert('weatherStations', next, {label: `Relevé de pluie : ${rainMm} mm`});
      closeModal();
      const mm = next.readings.find(r => r.time.startsWith(date)).rainMm;
      toast(`Relevé enregistré : ${formatMm(mm)} mm le ${new Date(`${date}T12:00`).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'})}.`);
      refreshDom();
    } catch (err) {fail(err?.message || 'Enregistrement impossible.');}
  }

  doc?.addEventListener('click', event => {
    const control = event.target.closest?.('[data-soil]');
    if (!control) return;
    const action = control.dataset.soil;
    if (action === 'farm') openFarm();
    else if (action === 'retry') {lastErrorAt = 0; ensure({force: true}); refreshDom();}
    else if (action === 'soil-form') openSoilForm(control.dataset.id);
    else if (action === 'soil-save') saveSoil(control.dataset.id);
    else if (action === 'gauge-form') openGaugeForm();
    else if (action === 'gauge-save') saveGauge();
  });
  doc?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target?.tagName !== 'INPUT') return;
    if (!event.target.closest?.('#soil-gauge-form')) return;
    event.preventDefault(); saveGauge();
  });
  globalThis.addEventListener?.('online', () => {lastErrorAt = 0; if (isStale(cache)) ensure();});

  return {parcelHtml, renderHome, ensure, openFarm, get cache() {return cache;}};
}
