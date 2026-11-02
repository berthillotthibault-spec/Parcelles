// Saisie d'un travail en 3 étapes (n° 160) : feuille du bas ouverte par le « + », « + Travail ici » (carte),
// « + Nouveau travail » (fiche), « J'ai fait » et la sélection multiple de la carte. Quoi, où, détails ;
// l'édition d'un travail garde le formulaire complet, joignable aussi d'ici sans perdre la saisie.
// Module différé (clé quickWork de lazy-modules.js) ; logique dans quick-work.js.
import {html, raw} from './safe-html.js';
import {icon, emptyState} from './ui.js';
import {uid, campaignFor as campaignOf} from './utils.js';
import {rankParcels} from './quick-entry.js';
import {checkTreatment, limitsSnapshot, registerMissing, productFor, limitsFor} from './phyto.js';
import {weatherSnapshotOf, workWindow} from './spray-window.js';
import {applyWorkEffects} from './work-effects.js';
import {CUT_TYPES, forageType} from './forage.js';
import {productLotChoices} from './stock-lots.js';
import {draftKey, readDraft, writeDraft, removeDraft, draftTimeLabel} from './form-drafts.js';
import {orderedWorkTypes, typeBadge, doseConfig, parseDose, formatDose, parcelChoices, parcelFilters,
  draftSummary, draftDate, buildQuickWorks, closingCandidates, fullFormLeftovers, draftFields, defaultsFor, isGrazingType,
  isObservationType, WORK_KINDS, workFamily, addRoutes, doseSuggestion, plannedPrefill, quickWorksProblem, missingDose, hedgeBlock, assignWriteIds, writeQuickWorks, writesStarted, prefillHolds,
  freshDetails, productChoices, entryWorks, quickEffects, coversToDestroy, nitrogenHint, harvestDarWarnings, billingProblem, dropForbidden,
  isSoilBase, SOIL_TYPES, isMowCut, isForageFollowup, isGrainHarvest, HARVEST_UNITS, nextCut, hoursBetween, dateNotice} from './quick-work.js';
import {createQuickGrazingUI} from './quick-grazing-ui.js';

const KEY = draftKey('quick-work', 'nouveau');
const FROM_MAP = 'parcelles:quick-work:map';
const TITLES = ['Quel travail ?', 'Sur quelles parcelles ?', 'Les détails'];
const DATES = [['today', 'Aujourd’hui'], ['yesterday', 'Hier'], ['custom', 'Autre date']];
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);

export function createQuickWorkUI({store, state, modal, closeModal, toast, savedToast, todayIso, openWorkForm, openBatchWorkForm,
  catalog = () => null, cultureColor = () => 'var(--brand)', gps = () => null, switchView, startMultipleSelection, openGrazingForm = () => {}, openGrazingList = () => {},
  openObservationForm = () => {}, afterFinish = () => {}, routeVisible = () => true, takeOver = null, win = window, doc = document,
  weather = () => null, openHarvestLots = () => {}, openForageRecord = () => {}, stockInLot = null}) {
  let s = null;
  let saving = false;
  // Fermeture voulue par la saisie (enregistrement, carte, formulaire complet) : pas de « Brouillon gardé ».
  let leaving = false;
  // Passage automatique de l'étape 1 à la suivante, et appuis ignorés juste après un changement d'étape (PF-21).
  // Double appui sur une tuile : le second appui, au même endroit, tomberait sur une parcelle de l'étape suivante.
  // Il est ignoré s'il suit l'appui sur la tuile de moins de 180 ms (passage d'étape) + 250 ms. Horloge des événements :
  // jamais Date.now(), que les tests figent. Le clavier (detail 0) n'est jamais concerné.
  let tileTimer = null, tileTap = null;
  const STEP_LOCK_MS = 180 + 250;
  const doubleTap = event => tileTap !== null && event.detail !== 0 && s?.step !== tileTap.step
    && event.timeStamp - tileTap.t < STEP_LOCK_MS && Math.hypot(event.clientX - tileTap.x, event.clientY - tileTap.y) < 24;
  const close = () => { leaving = true; try { closeModal(); } finally { leaving = false; } };
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const storage = () => { try { return win.localStorage; } catch { return null; } };
  const root = () => doc.querySelector('#modal-root .qw');
  const cfg = () => doseConfig(s.type, s.kind, s.product);
  const isSpray = () => workFamily(s.type, s.kind) === 'spray';
  // Un vrai geste d'animaux quitte le parcours des travaux (isGrazingType, jamais typeFamily).
  const grazing = createQuickGrazingUI({store, state, toast, closeModal: close, todayIso, root, cultureColor, openGrazingForm, openGrazingList,
    persistDraft: fields => writeDraft(KEY, draftFields(fields), {storage: storage()}),
    clearDraft: () => removeDraft(KEY, {storage: storage()}),
    onBack: () => { s = {...fresh(), parcelIds: s.parcelIds}; render(); }});

  function fresh({parcelIds = []} = {}) {
    return {step: 1, type: null, kind: '', typeKind: '', customType: '', hedgeOk: false, needHedge: false, writeIds: {}, pending: null, prefill: null, parcelIds: [...parcelIds], dateChoice: 'today', customDate: '', product: '', dose: null, doseUnit: '',
      doseTouched: false, equipmentId: '', note: '', startTime: '', showTime: false, filter: 'all', query: '', showMore: false, reason: '', needReason: false, error: '', skip: [], include: [],
      details: freshDetails(), showDetails: false, soilBase: '', otherMachine: false, unitTouched: false,
      // order : ordre de l'étape 2 figé (PF-16) ; fixed : parcelles venues du contexte, l'étape 2 est sautée (PF-17).
      order: null, fixed: false, gpsId: '', gpsAccuracy: null};
  }
  function persist() {
    if (s.step < 2 || !s.type) return;
    writeDraft(KEY, draftFields(s), {storage: storage()});
  }
  function setType(type, kind = '') {
    // Le genre peut avoir été changé à l'étape 1 (s.kind) : on compare au genre du dernier choix de type.
    const changed = type !== s.type || kind !== s.typeKind;
    const before = s.type ? workFamily(s.type, s.typeKind) : '';
    if (changed) clearPrefill(); // les valeurs reprises d'un prévu ne valent que pour l'ancien type
    s.type = type;
    s.kind = kind;
    s.typeKind = kind;
    if (changed) {
      const c = doseConfig(type, kind);
      // Dérogation, prévus écartés ou ajoutés : propres à l'ancien choix, jamais reportés sur un autre travail (PF-14).
      s.reason = ''; s.needReason = false; s.skip = []; s.include = [];
      // Même famille (Traitement puis Désherbage) : produit et dose saisis restent ; sinon ils repartent de zéro, en le disant.
      if (before !== workFamily(type, kind) || c.none) {
        if (before && (s.product.trim() || s.dose !== null)) toast('Autre genre de travail : produit et dose effacés.', 'info');
        // Aucune dose sans geste : la suggestion s'affiche, seul un appui l'enregistre.
        s.dose = null;
        s.doseUnit = c.none ? '' : c.unit;
        s.doseTouched = false;
        s.unitTouched = false;
        s.product = '';
      } else if (!s.unitTouched && !s.doseTouched) s.doseUnit = doseConfig(type, kind, s.product).unit; // même famille : unité de départ du nouveau type (lisier en m³/ha, fumier en t/ha)
      s.prefill = null;
      s.equipmentId = defaultsFor(type, state()).equipmentId || '';
      s.details = freshDetails();
      s.soilBase = isSoilBase(type) ? type : '';
    }
  }

  // ---------- Rendu ----------
  const badge = type => { const b = typeBadge(type); return html`<span class="wk-badge" data-family="${b.family}" aria-hidden="true">${b.ab}</span>`; };
  const chip = (attrs, label, on) => html`<button type="button" class="qw-pill${on ? ' is-on' : ''}" aria-pressed="${on ? 'true' : 'false'}" ${attrs}>${label}</button>`;

  function headHtml() {
    const summary = s.step > 1 ? draftSummary(state(), {...s, date: s.step === 3 ? dateOf() : '', today: todayIso()}) : '';
    return html`<div class="qw-head">
      <div class="qw-bar"><button type="button" class="qw-back" data-qw="back"${s.step > 1 && !s.pending ? '' : raw(' hidden')}>‹ Retour</button>
        <span class="qw-kicker" aria-hidden="true">Étape ${s.step} / 3</span>
        <button type="button" class="qw-close" data-action="close-modal" aria-label="Fermer">${raw(icon('close', {size: 20}))}</button></div>
      <div class="qw-progress" aria-hidden="true">${[1, 2, 3].map(i => html`<span${i <= s.step ? raw(' class="is-on"') : ''}></span>`)}</div>
      <h3 class="qw-title" id="qw-title">${TITLES[s.step - 1]}</h3>
      ${summary ? html`<p class="qw-summary"><span id="qw-summary-text">${summary}</span>${s.step === 3 && !s.pending ? html` <button type="button" class="text-button qw-change" data-qw="change-parcels">Changer</button>` : ''}</p>` : ''}
    </div>`;
  }

  function resumeHtml() {
    const saved = readDraft(KEY, {storage: storage()});
    if (!saved?.fields?.type) return '';
    const f = saved.fields;
    return html`<div class="qw-resume" role="status"><span><strong>Reprendre la saisie</strong><small>${draftSummary(state(), {...f, date: draftDate(f.dateChoice, todayIso(), f.customDate), today: todayIso()})} · ${draftTimeLabel(saved.savedAt)}</small></span>
      <button type="button" class="button primary" data-qw="resume">Reprendre</button><button type="button" class="text-button" data-qw="discard">Ignorer</button></div>`;
  }

  function step1Html() {
    const {top, more} = orderedWorkTypes(state(), {today: todayIso()});
    const tile = t => html`<button type="button" class="qw-tile${s.type === t.type ? ' is-on' : ''}" data-qw="type" data-type="${t.type}" aria-pressed="${s.type === t.type ? 'true' : 'false'}">${badge(t.type)}<b>${t.type}</b></button>`;
    return html`${resumeHtml()}${hasParcels() ? '' : noParcelHtml()}<div class="qw-tiles" role="group" aria-labelledby="qw-title">${top.map(tile)}
      <button type="button" class="qw-tile qw-other" data-qw="more" aria-expanded="${s.showMore ? 'true' : 'false'}"><span class="wk-badge" data-family="other" aria-hidden="true">…</span><b>Autre…</b></button></div>
      ${s.showMore ? html`<div class="qw-more">${more.length ? html`<div class="qw-tiles">${more.map(tile)}</div>` : ''}
        <label class="qw-field"><span>Autre type de travail</span><span class="qw-inline"><input id="qw-custom-type" autocomplete="off" placeholder="ex. Broyage" value="${s.customType}"><button type="button" class="button primary" data-qw="custom-type">OK</button></span></label>
        <div class="qw-field"><span id="qw-kind">Ce travail utilise (facultatif)</span><div class="qw-machines" role="group" aria-labelledby="qw-kind">${WORK_KINDS.map(([id, label]) => chip(html`data-qw="kind" data-kind="${id}"`, label, s.kind === id))}</div></div></div>` : ''}
      ${routesHtml()}`;
  }

  // Autres saisies, à part des travaux : les actions existantes, filtrées par activité et rôle.
  function routesHtml() {
    const routes = addRoutes({visible: routeVisible, canWrite: guard => !store.writeGuard || store.writeGuard(guard)});
    if (!routes.length) return '';
    return html`<div class="qw-routes" role="group" aria-label="Autre saisie">${routes.map(r => html`<button type="button" class="qw-route" data-action="${r.action}"${r.kind ? html` data-kind="${r.kind}"` : ''}>${r.label}</button>`)}</div>`;
  }

  // Aucune parcelle du tout : on le dit dès l'étape 1, avec les moyens d'en avoir une (PF-20).
  const hasParcels = () => live(state().parcelles).some(p => !p.archived);
  function noParcelHtml() {
    return raw(emptyState({icon: 'furrow', compact: true, className: 'qw-noparcel', title: 'Aucune parcelle pour l’instant',
      text: 'Un travail se note sur une parcelle : importez vos parcelles ou créez-en une.',
      action: [{label: 'Importer un fichier', action: 'choose-import'}, {label: 'Créer une parcelle', action: 'new-parcel'}, {label: 'Carte PAC (RPG)', action: 'rpg-onboarding'}]}));
  }
  // Ordre calculé à l'entrée de l'étape et à chaque filtre ou recherche, jamais à la coche (PF-16).
  function rowsOf() {
    const options = {type: s.type, today: todayIso(), date: draftDate(s.dateChoice, todayIso(), s.customDate), selected: s.parcelIds, query: s.query, filter: s.filter};
    if (!s.order) s.order = parcelChoices(state(), options).map(r => r.parcel.id);
    return parcelChoices(state(), {...options, order: s.order});
  }
  function listHtml() {
    if (!hasParcels()) return noParcelHtml();
    const rows = rowsOf();
    if (!rows.length) return html`<p class="qw-empty">Aucune parcelle ne correspond.</p>${s.filter !== 'all' || s.query ? html`<button type="button" class="button secondary qw-clear" data-qw="clear-filter">Effacer le filtre</button>` : ''}`;
    return rows.map(({parcel: p, plannedLabel, selected, outside}) => html`<button type="button" class="qw-parcel${selected ? ' is-on' : ''}" data-qw="parcel" data-id="${p.id}" role="checkbox" aria-checked="${selected ? 'true' : 'false'}">
      <span class="qw-box" aria-hidden="true">${selected ? '✓' : ''}</span>
      <span class="qw-parcel-text"><b>${p.nom}</b><small>${[p.culture, `${formatDose(Number(p.surfaceHa) || 0, 0)} ha`, p.id === s.gpsId ? 'détectée par GPS' : '', outside ? 'cochée, hors filtre' : ''].filter(Boolean).join(' · ')}</small>${plannedLabel ? html`<em class="qw-planned">${plannedLabel}</em>` : ''}</span>
      <span class="qw-dot" style="background:${cultureColor(p.culture || '')}" aria-hidden="true"></span></button>`);
  }

  // Compte des cochées, toujours visible au-dessus de la liste, et « Tout cocher » sur le filtre courant (PF-16).
  function countText() {
    const n = s.parcelIds.length;
    return n ? `Cochée${n > 1 ? 's' : ''} : ${draftSummary(state(), {parcelIds: s.parcelIds})}` : 'Aucune parcelle cochée';
  }
  function countHtml() {
    if (!hasParcels()) return '';
    const shown = rowsOf().filter(r => !r.outside).map(r => r.parcel.id);
    const all = shown.length > 1 && shown.every(id => s.parcelIds.includes(id));
    const located = s.gpsId && s.parcelIds.includes(s.gpsId) ? live(state().parcelles).find(p => p.id === s.gpsId) : null;
    return html`<div class="qw-count"><span id="qw-count">${countText()}</span>${shown.length > 1 ? html`<button type="button" class="text-button" data-qw="all">${all ? 'Tout décocher' : 'Tout cocher'}</button>` : ''}</div>
      ${located ? html`<p class="qw-keep qw-gps">${located.nom} : détectée par GPS${s.gpsAccuracy !== null ? ` (± ${Math.round(s.gpsAccuracy)} m)` : ''}. Touchez une autre parcelle pour la remplacer.</p>` : ''}`;
  }
  function step2Html() {
    if (!hasParcels()) return html`<div class="qw-parcels" id="qw-parcels">${noParcelHtml()}</div>`;
    return html`<label class="qw-search"><span class="sr-only">Rechercher une parcelle</span>${raw(icon('search', {size: 18}))}<input id="qw-query" type="search" value="${s.query}" placeholder="Nom, culture ou commune" autocomplete="off"></label>
      <div class="qw-filters" role="group" aria-label="Filtrer les parcelles">${parcelFilters(state()).map(f => chip(html`data-qw="filter" data-filter="${f.id}"`, f.label, s.filter === f.id))}</div>
      <div id="qw-count-box">${countHtml()}</div>
      <div class="qw-parcels" id="qw-parcels" role="group" aria-labelledby="qw-title">${listHtml()}</div>
      <button type="button" class="text-button qw-map-link" data-qw="map">Choisir sur la carte</button>`;
  }

  function phytoHtml() {
    if (!isSpray() || !s.parcelIds.length) return '';
    let result;
    try { result = buildDraftWorks(); } catch { return ''; }
    const blocking = new Map(), warnings = new Map();
    for (const work of [...result.creates, ...result.updates]) {
      const r = checkTreatment(state(), work, {catalog: catalog()});
      if (!r.applies) continue;
      r.blocking.forEach(b => blocking.set(b.message, b));
      r.warnings.forEach(w => warnings.set(w.message, w));
    }
    if (!blocking.size && !warnings.size) return '';
    return html`<div class="qw-phyto${blocking.size ? ' is-blocking' : ''}" role="status">
      ${[...blocking.keys()].map(m => html`<p class="qw-phyto-line is-error">${m}</p>`)}${[...warnings.keys()].map(m => html`<p class="qw-phyto-line">${m}</p>`)}
      ${blocking.size && s.needReason ? html`<label class="qw-field"><span>Motif de la dérogation (inscrit au registre) *</span><textarea id="qw-reason" rows="2" placeholder="Ex. préconisation écrite du conseiller">${s.reason}</textarea></label>` : ''}</div>`;
  }

  // Travaux et tâches prévus que l'enregistrement va clôturer : visibles et décochables (rien n'est fermé en silence).
  function closingHtml() {
    const date = draftDate(s.dateChoice, todayIso(), s.customDate);
    const {works, tasks, looseTasks, looseWorks, ignored} = closingCandidates(state(), {type: s.type, kind: s.kind, parcelIds: s.parcelIds, date, today: todayIso(), product: cfg().none ? '' : s.product});
    const items = [...works.map(w => ({id: w.id, label: w.type || 'Travail', kind: 'travail prévu', parcelId: w.parcelId})),
      // Autre type du même genre, ou retard ancien : proposé, jamais coché d'office.
      ...looseWorks.map(w => ({id: w.id, label: w.type || 'Travail', kind: w.overdue ? `en retard depuis le ${String(w.plannedDate || w.date || '').slice(0, 10).split('-').reverse().join('/')}` : 'autre travail prévu', parcelId: w.parcelId, loose: true})),
      ...tasks.map(t => ({id: t.id, label: t.title || 'Tâche', kind: 'tâche', parcelId: t.parcelId})),
      // Même genre sans citer le type : proposé, jamais coché d'office.
      ...looseTasks.map(t => ({id: t.id, label: t.title || 'Tâche', kind: 'tâche', parcelId: t.parcelId, loose: true}))];
    const names = new Map(live(state().parcelles).map(p => [p.id, p.nom]));
    const kept = ignored.length ? html`<p class="qw-keep">Reste à faire : ${ignored.map(i => `${i.work.type || 'Travail'} · ${names.get(i.work.parcelId) || 'Parcelle'} (${i.reason})`).join(', ')}</p>` : '';
    if (!items.length) return kept;
    return html`${kept}<fieldset class="qw-closing"><legend>Sera aussi marqué fait</legend>${items.map(i => html`<label class="qw-close-item">
      <input type="checkbox" ${i.loose ? html`data-qw-include="${i.id}"${s.include.includes(i.id) ? raw(' checked') : ''}` : html`data-qw-skip="${i.id}"${s.skip.includes(i.id) ? '' : raw(' checked')}`}><span><b>${i.label}</b><small>${i.kind} · ${names.get(i.parcelId) || 'Parcelle'}</small></span></label>`)}</fieldset>`;
  }

  // BCAE 8 : mêmes règle et dérogation que le formulaire complet (trimCheck).
  function hedgeHtml() {
    if (!s.parcelIds.length) return '';
    let result;
    try { result = buildDraftWorks(); } catch { return ''; }
    const {message} = hedgeBlock(result, state(), {remark: cfg().none ? s.product : ''});
    if (!message) return '';
    return html`<div class="qw-phyto is-blocking" role="status"><p class="qw-phyto-line is-error">${message}</p>
      <label class="qw-close-item"><input type="checkbox" id="qw-hedge"${s.hedgeOk ? raw(' checked') : ''}><span><b>Dérogation ou cas autorisé : je confirme</b></span></label></div>`;
  }
  // Dose vide : l'enregistrement reste possible, sans que rien ne soit inventé.
  function doseWarnHtml() {
    if (cfg().none || !s.parcelIds.length) return '';
    try { return missingDose(buildDraftWorks()) ? html`<p class="qw-keep" role="status">Dose non renseignée : le travail sera enregistré sans dose.</p>` : ''; } catch { return ''; }
  }
  function habitHtml() {
    if (cfg().none || s.dose !== null) return '';
    const hint = doseSuggestion(state(), {type: s.type, kind: s.kind, product: s.product});
    if (!hint?.learned) return '';
    return html`<button type="button" class="text-button qw-habit" data-qw="habit">Habituel : ${formatDose(hint.value, cfg().digits)} ${hint.unit}${hint.product ? ` (${hint.product})` : ''}</button>`;
  }
  const dosePlaceholder = () => { const hint = doseSuggestion(state(), {type: s.type, kind: s.kind, product: s.product}); return hint ? `ex. ${formatDose(hint.value, cfg().digits)}` : ''; };

  // ---------- Étape 3 par famille (lot 3) ----------
  const det = () => s.details || (s.details = freshDetails());
  const dateOf = () => draftDate(s.dateChoice, todayIso(), s.customDate);
  const family = () => workFamily(s.type, s.kind);
  const line = (text, cls = '') => html`<p class="qw-keep${cls ? ` ${cls}` : ''}">${text}</p>`;
  const num = v => Number(v).toLocaleString('fr-FR', {maximumFractionDigits: 2});
  const day = iso => String(iso || '').slice(5, 10).split('-').reverse().join('/');
  const monthDay = md => String(md || '').split('-').reverse().join('/');
  // Champ texte de s.details : data-qx porte le nom du champ.
  const field = (name, label, {type = 'text', mode = '', placeholder = '', list = ''} = {}) => html`<label class="qw-field"><span>${label}</span><input id="qx-${name}" data-qx="${name}" type="${type}"${mode ? html` inputmode="${mode}"` : ''}${list ? html` list="${list}"` : ''} value="${det()[name] ?? ''}" placeholder="${placeholder}" autocomplete="off"></label>`;
  const check = (name, label, {disabled = false} = {}) => html`<label class="qw-close-item"><input type="checkbox" id="qx-${name}" data-qx="${name}"${det()[name] && !disabled ? raw(' checked') : ''}${disabled ? raw(' disabled') : ''}><span><b>${label}</b></span></label>`;
  const options = (id, values) => html`<datalist id="${id}">${values.map(v => html`<option value="${v}"></option>`)}</datalist>`;

  // Date future : travail prévu, pas fait ; année ou campagne inhabituelle signalée (PF-19).
  function dateNoteHtml() {
    return dateNotice(dateOf(), todayIso()).messages.map(m => line(m.text, m.warn ? 'is-warn' : ''));
  }
  const isFuture = () => dateOf() > todayIso();
  const footLabel = () => s.pending ? 'Terminer l’enregistrement' : isFuture() ? 'Planifier' : 'Enregistrer';

  // Traitement : heures de début et de fin visibles (registre) ; ailleurs « + Heure ».
  function timeHtml() {
    if (!isSpray() && !s.showTime) return html`<button type="button" class="text-button" data-qw="time">+ Heure</button>`;
    return html`<span class="qw-inline qw-times"><label class="qw-time">${isSpray() ? 'Début' : 'Heure'}<input id="qw-time" type="time" value="${s.startTime}"></label>${isSpray() ? html`<label class="qw-time">Fin<input id="qx-endTime" data-qx="endTime" type="time" value="${det().endTime}"></label>` : ''}</span>`;
  }

  // Travail du sol : le sous-type choisi devient le type du travail.
  function soilHtml() {
    if (!s.soilBase) return '';
    return html`<div class="qw-field"><span id="qw-soil">Quel travail du sol ?</span><div class="qw-machines" role="group" aria-labelledby="qw-soil">${SOIL_TYPES.map(t => chip(html`data-qw="soil" data-type="${t}"`, t, s.type === t))}</div></div>`;
  }

  // Semis : culture semée avant la variété, ou couvert d'interculture (AT-04).
  function cultureHtml() {
    if (family() !== 'seed') return '';
    const cultures = parcelFilters(state()).filter(f => f.id.startsWith('culture:')).map(f => f.label);
    const cover = det().cover;
    return html`<div class="qw-field qw-group">${field('culture', cover ? 'Espèces du couvert' : 'Culture semée', {placeholder: cover ? 'ex. moutarde, phacélie' : 'ex. Colza', list: 'qw-cultures'})}${options('qw-cultures', cultures)}
      ${check('cover', 'Couvert d’interculture (la culture de la parcelle ne change pas)')}</div>`;
  }

  // Traitement : cible, et rappel des DAR et ZNT de la fiche produit.
  function sprayHtml() {
    if (!isSpray()) return '';
    const sheet = s.product.trim() ? productFor(state(), {product: s.product}, {catalog: catalog()})?.sheet : null;
    const targets = [...new Set((sheet?.usages || []).map(u => u.target).filter(Boolean))];
    return html`${field('target', 'Cible', {placeholder: 'ex. septoriose', list: 'qw-targets'})}${options('qw-targets', targets)}`;
  }
  function sheetHtml() {
    if (!isSpray() || !s.product.trim()) return '';
    const parcel = live(state().parcelles).find(p => s.parcelIds.includes(p.id));
    const sheet = productFor(state(), {product: s.product}, {catalog: catalog()})?.sheet;
    if (!sheet) return '';
    const l = limitsFor(sheet, {culture: det().culture || parcel?.culture, target: det().target}, parcel);
    const bits = [sheet.amm ? `AMM ${sheet.amm}` : '', l.dar !== null && l.dar !== undefined ? `DAR ${l.dar} j` : '', l.zntWater ? `ZNT eau ${l.zntWater} m` : '', l.maxDose !== null && l.maxDose !== undefined ? `dose max ${num(l.maxDose)} ${l.doseUnit || ''}` : ''].filter(Boolean);
    return bits.length ? line(`Fiche produit : ${bits.join(' · ')}`) : '';
  }

  // Unités de dose (AT-07) : pastilles selon le genre, l'unité apprise ou reprise reste visible.
  function unitsHtml() {
    const c = cfg();
    const units = [...new Set([...(c.units || []), ...(s.doseUnit ? [s.doseUnit] : [])])];
    if (units.length < 2) return '';
    return html`<div class="qw-machines qw-units" role="group" aria-label="Unité de dose">${units.map(u => chip(html`data-qw="unit" data-unit="${u}"`, u, (s.doseUnit || c.unit) === u))}</div>`;
  }

  // Récolte : quantité, unité, rendement ; Fauche : type de fourrage, coupe, balles ou tonnes (AT-02, AT-03).
  function harvestHtml() {
    if (isGrainHarvest(s.type, s.kind)) {
      return html`<div class="qw-field"><span id="qw-qty">Quantité récoltée (facultatif)</span><span class="qw-inline"><input id="qx-quantity" data-qx="quantity" inputmode="decimal" value="${det().quantity}" placeholder="ex. 85" aria-labelledby="qw-qty" autocomplete="off">
        ${HARVEST_UNITS.map(u => chip(html`data-qw="qty-unit" data-unit="${u}"`, u, det().quantityUnit === u))}</span></div>`;
    }
    if (!isMowCut(s.type)) return isForageFollowup(s.type) ? line('Après l’enregistrement : ajoutez la récolte de fourrage (balles, tonnes).') : '';
    const cut = det().cut || (s.parcelIds[0] ? nextCut(state(), s.parcelIds[0], dateOf()) : 1);
    return html`<div class="qw-field"><span id="qw-forage">Fourrage (facultatif)</span><div class="qw-machines" role="group" aria-labelledby="qw-forage">${CUT_TYPES.map(key => chip(html`data-qw="forage" data-key="${key}"`, forageType(key)?.label || key, det().forageType === key))}</div></div>
      ${det().forageType ? html`<div class="qw-field"><span id="qw-forage-qty">Quantité</span><span class="qw-inline">${chip(raw('data-qw="forage-mode" data-mode="bales"'), 'Balles', det().forageMode !== 'tonnes')}${chip(raw('data-qw="forage-mode" data-mode="tonnes"'), 'Tonnes', det().forageMode === 'tonnes')}
        <input id="qx-${det().forageMode === 'tonnes' ? 'tonnes' : 'bales'}" data-qx="${det().forageMode === 'tonnes' ? 'tonnes' : 'bales'}" inputmode="decimal" value="${det()[det().forageMode === 'tonnes' ? 'tonnes' : 'bales']}" aria-labelledby="qw-forage-qty" autocomplete="off"></span></div>
        ${field('cut', 'Coupe n°', {mode: 'numeric', placeholder: String(cut)})}` : ''}`;
  }

  // Lignes calculées, rafraîchies à chaque saisie : culture, azote, DAR, rendement, stock, couvert, compteur.
  function infoHtml() {
    if (!s.parcelIds.length || !s.type) return '';
    let result;
    try { result = buildDraftWorks(); } catch (error) { return line(error.message, 'is-error'); }
    const data = state(), date = dateOf(), future = date > todayIso(), x = det(), out = [];
    if (result.changes.length) out.push(line(`Culture : ${[...new Set(result.changes.map(c => `${c.from || 'non renseignée'} → ${c.to}`))].join(', ')} sur ${result.changes.length} parcelle${result.changes.length > 1 ? 's' : ''}`));
    if (result.coverSkipped.length) out.push(line(`Couvert non inscrit (culture de la parcelle inconnue) : ${result.coverSkipped.map(p => p.nom).join(', ')}`));
    if (family() === 'seed' && !String(x.culture || '').trim() && !future) out.push(line('Culture semée non indiquée : la culture de la parcelle ne changera pas.'));
    if (family() === 'fertilize') {
      const hint = nitrogenHint(data, {product: s.product, dose: parseDose(s.dose), doseUnit: s.doseUnit || cfg().unit, parcelIds: s.parcelIds, date, today: todayIso()});
      if (hint.perHa) out.push(line(`≈ ${num(hint.perHa.nTotal)} kg N/ha (${num(hint.perHa.nEff)} efficaces)${hint.rest.length ? ` · reste ${hint.rest.map(r => `${num(r.left)} kg N/ha (${r.parcel.nom})`).join(', ')} sur le plan` : ''}`));
      if (hint.unknown) out.push(line('Composition inconnue : cet apport ne sera pas compté au bilan azote. Renseignez la composition sur l’article de stock.', 'is-warn'));
      hint.bans.forEach(({parcel, ban}) => out.push(line(`${parcel.nom} : épandage interdit du ${monthDay(ban.from)} au ${monthDay(ban.to)} (type ${ban.type}, zone vulnérable).`, 'is-warn')));
    }
    if (['harvest', 'mow'].includes(family()) || isMowCut(s.type)) harvestDarWarnings(data, {parcelIds: s.parcelIds, date, catalog: catalog()}).forEach(w => out.push(line(w.message, 'is-warn')));
    if (isGrainHarvest(s.type, s.kind)) {
      const q = parseDose(x.quantity), area = entryWorks(result).reduce((a, w) => a + (parseDose(w.surfaceWorked) || 0), 0);
      if (q !== null && area > 0) out.push(line(`Rendement ≈ ${num((x.quantityUnit === 'kg' ? q / 1000 : q) / area)} t/ha`));
      result.existingLots.forEach(({parcel, lot}) => out.push(line(`${parcel.nom} : lot ${lot.code || ''} déjà enregistré ce jour, pas de second lot.`)));
      if (q !== null && future) out.push(line('Date future : le lot de récolte sera créé une fois la récolte faite.'));
    }
    // Sortie de stock (AT-10) : cochée par défaut, refusée si le stock manque.
    const fx = effectsOf(result, future);
    const {item, preview} = fx;
    if (preview?.error) out.push(line(preview.error));
    else if (preview) {
      out.push(check('stockOut', `Sortir ${num(preview.quantity)} ${preview.unit} du stock « ${item.name} »${preview.available !== null ? ` (disponible : ${num(preview.available)} ${preview.unit})` : ''}`, {disabled: preview.short}));
      if (preview.short) out.push(line('Stock insuffisant : corrigez le stock avant la sortie.', 'is-warn'));
    }
    // Couvert détruit par ce passage (AT-12).
    const covers = future ? [] : coversToDestroy(data, {type: s.type, kind: s.kind, parcelIds: s.parcelIds, date});
    if (covers.length) {
      const names = new Map(live(data.parcelles).map(p => [p.id, p.nom]));
      out.push(check('destroyCover', `Ce passage détruit le couvert (${covers.map(c => `${c.ic.especes}, ${names.get(c.rotation.parcelId) || 'parcelle'}`).join(' ; ')})`));
      const early = covers.find(c => c.early);
      if (x.destroyCover && early) out.push(line(`Avant la date minimale de destruction du ${day(early.early)} : vérifiez la dérogation.`, 'is-warn'));
    }
    // Compteur horaire (AT-13) : la durée saisie s'ajoute au compteur de l'engin.
    if (fx.meterable) out.push(check('meter', `Ajouter ${num(fx.hours)} h au compteur de ${fx.machine.nom || 'l’engin'}`));
    return out;
  }

  // Droits du rôle sur le stock (article et mouvement) et le compteur, communs à l'aperçu et à l'enregistrement.
  const allowed = op => !store.writeGuard || store.writeGuard(op);
  const canStockOut = () => allowed({entity: 'stockItems', action: 'update'}) && allowed({entity: 'stockMovements', action: 'create'});
  function effectsOf(result, future) {
    return quickEffects(result, state(), {details: det(), type: s.type, kind: s.kind, product: s.product, equipmentId: s.equipmentId, startTime: s.startTime,
      future, canStock: canStockOut(), canMeter: allowed({entity: 'materiels', action: 'update'})});
  }

  // Plus de détails (AT-13, PF-18) : replié, la saisie rapide reste courte.
  function moreHtml() {
    const c = cfg(), data = state(), one = s.parcelIds.length === 1, x = det();
    const parcel = one ? live(data.parcelles).find(p => p.id === s.parcelIds[0]) : null;
    const operator = x.operator ?? defaultsFor(s.type, data).operator;
    const lots = isSpray() && s.product.trim() ? productLotChoices(data, {product: s.product}).map(l => l.lotNumber) : [];
    const fields = [
      one ? field('surface', 'Surface travaillée (ha)', {mode: 'decimal', placeholder: parcel ? String(parcel.surfaceHa ?? '') : ''}) : '',
      isSpray() ? '' : html`<label class="qw-field"><span>Heure de fin</span><input id="qx-endTime" data-qx="endTime" type="time" value="${x.endTime}"></label>`,
      field('duration', 'Durée (h)', {mode: 'decimal', placeholder: hoursBetween(s.startTime, x.endTime) === null ? '' : String(hoursBetween(s.startTime, x.endTime))}),
      field('fuel', 'Carburant (L)', {mode: 'decimal'}),
      isSpray() ? field('stage', 'Stade de la culture', {placeholder: 'ex. 2 nœuds'}) : '',
      isSpray() ? html`${field('productLot', 'Lot du produit', {list: 'qw-lots'})}${options('qw-lots', lots)}` : '',
      family() === 'seed' ? html`${field('seedTgw', 'PMG (g)', {mode: 'decimal'})}${field('seedLot', 'Lot de semence')}${field('seedOrigin', 'Origine (certifiée ou ferme)', {list: 'qw-origins'})}${options('qw-origins', ['certifiée', 'ferme'])}${field('seedTreatment', 'Traitement de semence')}` : '',
      isGrainHarvest(s.type, s.kind) ? html`${field('humidity', 'Humidité (%)', {mode: 'decimal'})}${field('impurities', 'Impuretés (%)', {mode: 'decimal'})}${field('silo', 'Silo / stockage')}` : '',
      family() === 'soil' ? field('depth', 'Profondeur (cm)', {mode: 'decimal'}) : '',
      isSpray() ? '' : html`<label class="qw-field"><span>Opérateur</span><input id="qx-operator" data-qx="operator" value="${operator}" autocomplete="off"></label>`,
      c.none ? '' : html`<label class="qw-field"><span>Note</span><textarea id="qw-note" rows="2" placeholder="ex. vent nul">${s.note}</textarea></label>`];
    return html`<details class="qw-more-details"${s.showDetails ? raw(' open') : ''}><summary data-qw="details">Plus de détails${!isSpray() && operator ? ` · ${operator}` : ''}</summary><div class="qw-grid">${fields}</div></details>`;
  }

  // Matériel : six pastilles, l'engin choisi toujours visible, les autres derrière « Autre engin » (PF-18).
  function machinesHtml() {
    const machines = live(state().materiels);
    if (!machines.length) return '';
    const shown = machines.slice(0, 6);
    const chosen = machines.find(m => m.id === s.equipmentId);
    if (chosen && !shown.includes(chosen)) shown.push(chosen);
    const rest = machines.filter(m => !shown.includes(m));
    return html`<div class="qw-field"><span id="qw-machine">Matériel</span><div class="qw-machines" role="group" aria-labelledby="qw-machine">
      ${chip(raw('data-qw="machine" data-id=""'), 'Aucun', !s.equipmentId)}${shown.map(m => chip(html`data-qw="machine" data-id="${m.id}"`, m.nom || 'Engin', s.equipmentId === m.id))}</div>
      ${rest.length ? html`<label class="qw-field"><span class="sr-only">Autre engin</span><select id="qw-machine-more"><option value="">Autre engin…</option>${rest.map(m => html`<option value="${m.id}">${m.nom || 'Engin'}</option>`)}</select></label>` : ''}</div>`;
  }

  // Client de la parcelle : à facturer, sauf si décoché (AT-15).
  function clientHtml() {
    const data = state();
    const clients = [...new Set(live(data.parcelles).filter(p => s.parcelIds.includes(p.id) && p.clientId)
      .map(p => live(data.clients).find(x => x.id === p.clientId)?.nom).filter(Boolean))];
    if (!clients.length) return '';
    return html`<p class="qw-client">Pour : <b>${clients.join(', ')}</b> (client de la parcelle)</p>${check('billable', 'À facturer')}`;
  }

  function step3Html() {
    const c = cfg(), data = state();
    const products = productChoices(data, {type: s.type, kind: s.kind, culture: det().culture});
    const operator = det().operator ?? defaultsFor(s.type, data).operator;
    return html`<div class="qw-details">
      <div class="qw-field"><span id="qw-when">Quand ?</span><div class="qw-dates" role="group" aria-labelledby="qw-when">${DATES.map(([id, label]) => chip(html`data-qw="date" data-date="${id}"`, label, s.dateChoice === id))}</div>
        <input id="qw-custom-date" type="date" value="${s.customDate || todayIso()}"${s.dateChoice === 'custom' ? '' : raw(' hidden')} aria-label="Date du travail">
        <div id="qw-date-note">${dateNoteHtml()}</div>
        ${timeHtml()}</div>
      ${soilHtml()}${cultureHtml()}
      <label class="qw-field"><span>${c.label}</span><input id="qw-product" value="${s.product}" placeholder="${c.placeholder}" autocomplete="off"${c.none ? '' : raw(' list="qw-products"')}>
        ${c.none ? '' : html`<datalist id="qw-products">${products.map(p => html`<option value="${p}"></option>`)}</datalist>`}</label>
      <div id="qw-sheet">${sheetHtml()}</div>
      ${sprayHtml()}
      ${isSpray() ? html`<label class="qw-field"><span>Opérateur</span><input id="qx-operator" data-qx="operator" value="${operator}" autocomplete="off"></label>` : ''}
      <div id="qw-phyto">${phytoHtml()}</div>
      <div id="qw-hedge-box">${hedgeHtml()}</div>
      <div id="qw-closing">${closingHtml()}</div>
      ${c.none ? '' : html`<div class="qw-field"><span id="qw-dose-label">Dose</span><div class="qw-dose" role="group" aria-labelledby="qw-dose-label">
        <button type="button" class="qw-step" data-qw="dose" data-dir="-1" aria-label="Moins">−</button>
        <label class="qw-dose-value"><input id="qw-dose" inputmode="decimal" value="${s.dose === null ? '' : formatDose(s.dose, c.digits)}" placeholder="${dosePlaceholder()}" aria-label="Dose en ${s.doseUnit || c.unit}"><span>${s.doseUnit || c.unit}</span></label>
        <button type="button" class="qw-step" data-qw="dose" data-dir="1" aria-label="Plus">+</button></div>
        <div id="qw-units">${unitsHtml()}</div>
        <div id="qw-habit-box">${habitHtml()}</div><div id="qw-dose-warn">${doseWarnHtml()}</div></div>`}
      ${harvestHtml()}
      <div id="qw-info" class="qw-info">${infoHtml()}</div>
      ${clientHtml()}
      ${machinesHtml()}
      ${moreHtml()}
      <div id="qw-full-box">${fullHtml()}</div>
      ${s.error ? html`<p class="form-error" role="alert">${s.error}</p>` : ''}</div>`;
  }

  function footHtml() {
    if (s.step === 1) return '';
    const ready = s.step === 3 || s.parcelIds.length > 0;
    const label = s.step === 3 ? footLabel() : ready ? 'Continuer' : hasParcels() ? 'Choisissez au moins une parcelle' : 'Aucune parcelle';
    return html`<div class="qw-foot"><button type="button" class="button primary qw-next" data-qw="next"${ready ? '' : raw(' disabled')}>${label}</button></div>`;
  }

  function render({focus = ''} = {}) {
    const el = root();
    if (!el) return;
    const body = s.step === 1 ? step1Html() : s.step === 2 ? step2Html() : step3Html();
    el.innerHTML = String(html`${headHtml()}<div class="qw-body">${body}</div>${footHtml()}`);
    // Changement d'étape annoncé (la barre de progression est décorative) (PF-22).
    if (el.dataset.step !== String(s.step) || !announced) announce(`Étape ${s.step} sur 3 : ${TITLES[s.step - 1]}${s.step === 2 ? `. ${countText()}` : ''}`);
    el.dataset.step = String(s.step);
    const target = focus && el.querySelector(focus);
    // Pas de focus par défaut dans un champ texte : le clavier virtuel cacherait la liste.
    const fallback = s.step === 1 ? el.querySelector('.qw-tile.is-on') || el.querySelector('.qw-tile')
      : s.step === 2 ? el.querySelector('.qw-parcel.is-on') || el.querySelector('.qw-parcel') || el.querySelector('.qw-next')
        : el.querySelector('.qw-dates .qw-pill.is-on');
    (target || fallback)?.focus({preventScroll: true});
  }

  // Région vivante hors de .qw (qui est réécrite à chaque rendu) : étape, parcelles cochées, dose.
  let announced = false;
  function announce(text) {
    const region = doc.querySelector('#modal-root #qw-live');
    if (!region) return;
    region.textContent = text;
    announced = true;
  }

  // ---------- Écritures ----------
  function buildDraftWorks() {
    const c = cfg();
    const dose = c.none ? null : parseDose(s.dose);
    return buildQuickWorks({type: s.type, kind: s.kind, parcelIds: s.parcelIds, date: draftDate(s.dateChoice, todayIso(), s.customDate),
      product: s.product, dose, doseUnit: s.doseUnit, equipmentId: s.equipmentId, note: s.note, startTime: s.startTime, details: det()}, state(), {today: todayIso(), batchId: uid('batch'), skip: s.skip, include: s.include, catalog: catalog()});
  }

  async function save() {
    if (saving) return; // double appui : une seule écriture
    saving = true;
    const button = root()?.querySelector('.qw-next');
    if (button) button.disabled = true;
    try { await saveNow(); } finally {
      saving = false;
      const again = root()?.querySelector('.qw-next');
      if (again) again.disabled = false;
    }
  }

  // Onglet secondaire ou version plus récente : le dire tout de suite, avec la reprise de la main.
  function tabBlocked() {
    try { store.assertTabWritable?.(); return false; } catch (error) {
      toast(error.message, 'error', error.name === 'TabReadOnlyError' && takeOver ? {label: 'Utiliser ici', run: takeOver} : undefined);
      return true;
    }
  }

  // Tout ce qui précède la première écriture ; null si la saisie doit être corrigée.
  function prepareWrites() {
    let result;
    try { result = buildDraftWorks(); } catch (error) { s.error = error.message; render({focus: '.qw-next'}); return null; }
    const problem = quickWorksProblem(result);
    if (problem) { s.error = problem; render({focus: '#qw-product'}); return null; }
    const hedge = hedgeBlock(result, state(), {derogation: s.hedgeOk, remark: cfg().none ? s.product : ''});
    if (hedge.blocked) { s.error = hedge.message; render({focus: '#qw-hedge'}); return null; }
    const billing = billingProblem(result, state());
    if (billing) { s.error = billing; s.showDetails = true; render({focus: '#qx-duration'}); return null; }
    if (isSpray()) {
      // Météo du moment, seulement pour un traitement daté d'aujourd'hui : celle d'« Hier » serait fausse (AT-09).
      const w = weather();
      if (w && draftDate(s.dateChoice, todayIso(), s.customDate) === todayIso()) {
        for (const work of [...result.creates, ...result.updates]) {
          if (work.status !== 'Terminé' || work.weatherSnapshot) continue;
          const slot = work.startTime ? workWindow(w, work) : null;
          work.weatherSnapshot = {...weatherSnapshotOf(w), ...(slot ? {window: slot} : {})};
        }
      }
      const blocked = [];
      for (const work of [...result.creates, ...result.updates]) {
        const r = checkTreatment(state(), work, {catalog: catalog()});
        if (!r.applies) continue;
        if (r.blocking.length) { blocked.push(work); work.phytoOverride = {reason: s.reason.trim(), codes: r.blocking.map(b => b.code), at: Date.now()}; }
        const snap = limitsSnapshot(r);
        if (snap) work.phytoLimits = snap;
      }
      if (blocked.length && !s.reason.trim()) {
        s.needReason = true;
        s.error = 'Traitement hors limites de la fiche produit : corrigez la saisie ou indiquez le motif de la dérogation.';
        render({focus: '#qw-reason'});
        return null;
      }
    }
    // Rotation, culture ou lots que le rôle n'écrit pas : retirés, le message suit l'enregistrement.
    const roleNote = dropForbidden(result, op => !store.writeGuard || store.writeGuard(op));
    // Sortie de stock et compteur : décidés ici, appliqués après l'écriture des travaux (applyWorkEffects).
    const x = det(), date = draftDate(s.dateChoice, todayIso(), s.customDate), future = date > todayIso();
    const {stockItemId, countMachine} = effectsOf(result, future);
    // Le type part avec l'écriture : la reprise d'une écriture partielle annonce ce qui est réellement écrit.
    return {...assignWriteIds(result, s.writeIds, (prefix = 'work') => uid(prefix)), type: s.type, kind: s.kind, roleNote,
      effects: stockItemId || countMachine ? {stockItemId, countMachine} : null, cut: parseDose(x.cut) || ''};
  }

  async function saveNow() {
    if (tabBlocked()) return;
    // Une écriture partielle est reprise telle quelle : la reconstruire recréerait ce qui est déjà clôturé.
    const pending = s.pending || prepareWrites();
    if (!pending) return;
    const n = new Set([...pending.creates, ...pending.updates].map(w => w.parcelId)).size;
    const type = pending.type || s.type;
    const label = `${type} · ${n} parcelle${n > 1 ? 's' : ''}`;
    try {
      await writeQuickWorks(store, pending, {creates: `Travail enregistré : ${label}`, updates: `Travail prévu terminé : ${label}`, tasks: `Tâche terminée : ${label}`});
    } catch (error) {
      // Avant tout, retenir ce qui est déjà écrit : un nouvel essai ne doit rien recréer, même après la perte du verrou.
      const started = writesStarted(store, pending);
      s.pending = started ? pending : null;
      if (error?.name === 'TabReadOnlyError') { persist(); tabBlocked(); render({focus: '.qw-next'}); return; }
      s.error = started ? `Enregistrement partiel : ${error?.message || 'erreur inconnue'}. La saisie est figée : appuyez sur « Terminer l’enregistrement », rien ne sera créé en double.`
        : `Enregistrement impossible : ${error?.message || 'erreur inconnue'}`;
      persist();
      render({focus: '.qw-next'});
      return;
    }
    removeDraft(KEY, {storage: storage()});
    close();
    const effectsError = await applyEffects(pending);
    const followUp = followUpOf(pending);
    if (pending.roleNote || effectsError) toast([pending.roleNote, effectsError].filter(Boolean).join(' '), 'error', followUp?.action || undefined);
    else if (followUp) savedToast(`${type} enregistré · ${followUp.message}`, followUp.action);
    else if (pending.creates.length && !pending.updates.length && pending.creates.every(w => w.status === 'À faire')) {
      // Date future : le travail est prévu, pas fait ; le message le dit (PF-19).
      const due = String(pending.creates[0].plannedDate || pending.creates[0].date || '').slice(0, 10);
      savedToast(`${type} prévu le ${due.split('-').reverse().join('/')} · ${n} parcelle${n > 1 ? 's' : ''}`);
    } else savedToast(`${type} enregistré · ${n} parcelle${n > 1 ? 's' : ''}`);
    // Une seule proposition par saisie, même sur plusieurs parcelles ; jamais par-dessus un rappel à compléter.
    const finished = [...pending.creates, ...pending.updates].find(w => w.status === 'Terminé');
    if (finished && !followUp) afterFinish(finished);
  }

  // Sortie de stock et heures au compteur, travail par travail, après l'écriture (AT-10, AT-13). Message si refus.
  async function applyEffects(pending) {
    if (!pending.effects) return '';
    const {stockItemId, countMachine} = pending.effects;
    const done = entryWorks(pending).filter(w => w.status === 'Terminé');
    const errors = [];
    // Stock puis compteur, en deux écritures : un refus du compteur n'annule pas la sortie de stock.
    for (const work of done) {
      let stocked = false;
      if (stockItemId) {
        const saved = store.get?.('interventions', work.id);
        if (!saved) continue;
        try { await applyWorkEffects(store, work.id, {stockItemId, countMachine: false}, {expectedVersion: saved.version}); stocked = true; }
        catch (error) { errors.push(`Sortie de stock non faite : ${error?.message || 'erreur inconnue'}.`); }
      }
      if (countMachine) {
        const saved = store.get?.('interventions', work.id);
        if (!saved) continue;
        try { await applyWorkEffects(store, work.id, {stockItemId: stocked ? stockItemId : '', countMachine: true}, {expectedVersion: saved.version}); }
        catch (error) { errors.push(`Compteur non mis à jour : ${error?.message || 'erreur inconnue'}.`); }
      }
    }
    if (errors.length) return `${[...new Set(errors)].join(' ')} À reprendre depuis la fiche du travail (Stocks / heures / coûts).`;
    return '';
  }

  // Rappel après l'enregistrement quand une donnée métier reste à saisir (lot 3) : une seule action proposée.
  function followUpOf(pending) {
    const works = [...pending.creates, ...pending.updates].filter(w => w.status === 'Terminé');
    if (!works.length) return null;
    const first = works[0], type = pending.type || '', kind = pending.kind || '';
    const lots = (pending.records || []).filter(r => r.farmKind === 'harvest');
    if (lots.length) {
      const run = async () => {
        try {
          const stockIn = stockInLot || (await import('./grain-stock-ui.js')).stockInLot;
          for (const lot of lots) await stockIn(store, lot.id);
          toast(`Lot${lots.length > 1 ? 's' : ''} entré${lots.length > 1 ? 's' : ''} en stock.`, 'success');
        } catch (error) { toast(error?.message || 'Entrée en stock impossible.', 'error'); }
      };
      // Entrée en stock : article créé ou mis à jour et mouvement ; sinon le code du lot seul (rôle sans le stock).
      const canStockIn = allowed({entity: 'stockItems', action: 'create'}) && canStockOut();
      return {message: `lot ${lots.map(l => l.code).join(', ')}`, action: canStockIn ? {label: 'Entrer en stock', run} : null};
    }
    if (isGrainHarvest(type, kind) && !(pending.existingLots || []).length)
      return {message: 'quantité non saisie', action: {label: 'Ajouter la quantité récoltée', run: () => openHarvestLots(first.parcelId)}};
    if ((isMowCut(type) && !(pending.records || []).some(r => r.farmKind !== 'harvest')) || isForageFollowup(type))
      return {message: 'récolte de fourrage à saisir', action: {label: 'Ajouter la récolte de fourrage', run: () => openForageRecord(first.parcelId, pending.cut || '')}};
    const missing = [...new Set(works.flatMap(w => registerMissing(store.snapshot?.() || state(), store.get?.('interventions', w.id) || w, {catalog: catalog()})))];
    if (missing.length) return {message: `registre à compléter : ${missing.join(', ')}`, action: {label: 'Compléter', run: () => openWorkForm(store.get?.('interventions', first.id) || first, first.parcelId)}};
    return null;
  }

  // Prévus et tâches cochés que le formulaire complet ne fermerait pas (seul l'unique prévu d'une parcelle est repris).
  function fullLeftovers() {
    const date = draftDate(s.dateChoice, todayIso(), s.customDate);
    return fullFormLeftovers(closingCandidates(state(), {type: s.type, kind: s.kind, parcelIds: s.parcelIds, date, today: todayIso(), product: cfg().none ? '' : s.product}),
      {skip: s.skip, include: s.include, parcelCount: s.parcelIds.length});
  }
  function fullHtml() {
    if (s.pending) return '';
    const left = fullLeftovers().length;
    return html`<button type="button" class="text-button qw-full" data-qw="full"${left ? raw(' disabled aria-describedby="qw-full-note"') : ''}>Formulaire complet</button>${left
      ? html`<p class="qw-keep" id="qw-full-note">Les prévus et tâches cochés ci-dessus ne seraient pas marqués faits par le formulaire complet : décochez-les pour l'ouvrir.</p>` : ''}`;
  }

  function openFull() {
    if (s.pending) return; // écriture partielle : seule la reprise termine, sans doublon
    if (fullLeftovers().length) return; // rien de coché n'est laissé ouvert en silence
    const c = cfg(), dose = c.none ? null : parseDose(s.dose), date = draftDate(s.dateChoice, todayIso(), s.customDate);
    // Même statut que l'enregistrement rapide : une date future reste « À faire » (PF-15, AT-17).
    const prefill = {type: s.type || '', date, status: date > todayIso() ? 'À faire' : 'Terminé', product: c.none ? '' : s.product,
      dose: dose ?? '', doseUnit: dose === null ? '' : s.doseUnit, equipmentId: s.equipmentId, note: c.none ? s.product : s.note, startTime: s.startTime,
      ...(det().endTime ? {endTime: det().endTime} : {}), ...(det().target ? {target: det().target} : {}), ...(det().operator !== null ? {operator: det().operator} : {}),
      ...(family() === 'seed' && det().culture && !det().cover ? {culture: det().culture} : {}),
      // Le motif de dérogation ne suit pas : le formulaire le redemande, encadré visible, s'il reste des limites dépassées.
      ...(s.hedgeOk ? {hedgeDerogation: true} : {}), ...(s.kind ? {kind: s.kind} : {}), ...(isSpray() ? {isPhytosanitary: true} : {})};
    // Le brouillon reste jusqu'à l'enregistrement du formulaire : l'annuler ne perd pas la saisie (« Reprendre » au prochain +).
    persist();
    const onSaved = () => removeDraft(KEY, {storage: storage()});
    // Une parcelle et un seul travail prévu clôturable : on termine ce prévu, au lieu d'en créer un second à côté.
    const planned = s.parcelIds.length === 1 && date <= todayIso()
      ? closingCandidates(state(), {type: s.type, kind: s.kind, parcelIds: s.parcelIds, date, today: todayIso(), product: c.none ? '' : s.product}).works.filter(w => !s.skip.includes(w.id)) : [];
    close();
    if (s.parcelIds.length > 1) openBatchWorkForm(s.parcelIds, prefill, {onSaved});
    else if (planned.length === 1) {
      const kept = Object.fromEntries(Object.entries(prefill).filter(([, v]) => v !== '' && v !== null && v !== undefined));
      openWorkForm({...planned[0], ...kept, plannedDate: planned[0].plannedDate || planned[0].date || ''}, s.parcelIds[0], {onSaved});
    } else openWorkForm(prefill, s.parcelIds[0] || null, {onSaved});
  }

  // ---------- Interactions ----------
  // Étape 3 : une parcelle et un seul travail prévu, on repart de ce qui était prévu, visible et modifiable.
  function clearPrefill() {
    if (!s.prefill) return;
    if (s.product === s.prefill.product) s.product = '';
    if (!s.doseTouched) { s.dose = null; s.doseUnit = cfg().none ? '' : cfg().unit; }
    s.prefill = null;
  }
  function applyPrefill() {
    if (cfg().none) return;
    clearPrefill();
    if (s.product.trim() || s.dose !== null) return;
    const plan = plannedPrefill(state(), {type: s.type, kind: s.kind, parcelIds: s.parcelIds, date: draftDate(s.dateChoice, todayIso(), s.customDate), today: todayIso()});
    if (!plan || (!plan.product && plan.dose === null)) return;
    s.prefill = plan;
    s.product = plan.product;
    if (plan.dose !== null) { s.dose = plan.dose; if (plan.doseUnit) s.doseUnit = plan.doseUnit; }
  }
  // Le prévu repris n'est plus clôturé (autre produit, autre date) : sa dose ne part pas sur la nouvelle fiche.
  function checkPrefill() {
    if (!s.prefill || prefillHolds(state(), s.prefill, {type: s.type, kind: s.kind, parcelIds: s.parcelIds,
      date: draftDate(s.dateChoice, todayIso(), s.customDate), today: todayIso(), product: cfg().none ? '' : s.product})) return;
    clearPrefill();
    const input = root()?.querySelector('#qw-dose');
    if (input) { input.value = s.dose === null ? '' : formatDose(s.dose, cfg().digits); input.placeholder = dosePlaceholder(); }
    showUnit(s.doseUnit || cfg().unit);
  }
  // Unité affichée = unité enregistrée.
  function showUnit(unit) {
    const span = root()?.querySelector('.qw-dose-value span'); if (span) span.textContent = unit;
    root()?.querySelector('#qw-dose')?.setAttribute('aria-label', `Dose en ${unit}`);
  }
  function go(step) {
    if (s.pending && step !== 3) return; // saisie figée : seule la reprise de l'écriture reste possible
    clearTimeout(tileTimer); tileTimer = null;
    if (step === 2) s.order = null;
    s.step = step; s.error = ''; if (step === 3) { applyPrefill(); prefillCulture(); } persist(); render(); }
  // Après le choix du type : parcelles déjà connues par le contexte (fiche, carte, terrain), on passe aux détails (PF-17).
  const afterType = () => go(s.fixed && s.parcelIds.length ? 3 : 2);
  // Semis : culture de la rotation de la campagne, sinon celle de la parcelle, si toutes les parcelles choisies l'ont.
  function prefillCulture() {
    if (family() !== 'seed' || det().culture) return;
    const date = draftDate(s.dateChoice, todayIso(), s.customDate), campaign = campaignOf(date), data = state();
    // Un semis prévu qui sera clôturé garde sa culture (jamais celle de la parcelle à sa place).
    const planned = closingCandidates(data, {type: s.type, kind: s.kind, parcelIds: s.parcelIds, date, today: todayIso()}).works;
    const cultures = new Set(live(data.parcelles).filter(p => s.parcelIds.includes(p.id))
      .map(p => planned.find(w => w.parcelId === p.id)?.culture || live(data.rotations).find(r => r.parcelId === p.id && r.campaignId === campaign)?.culture || p.culture || ''));
    if (cultures.size === 1) det().culture = [...cultures][0];
  }
  function next() {
    if (s.step === 2 && s.parcelIds.length) go(3);
    else if (s.step === 3) save();
  }
  function stepDose(dir) {
    const c = cfg();
    const hint = parseDose(s.dose) === null ? doseSuggestion(state(), {type: s.type, kind: s.kind, product: s.product}) : null;
    const value = Math.max(0, +((parseDose(s.dose) ?? hint?.value ?? 0) + dir * c.step).toFixed(2));
    if (hint?.unit) { s.doseUnit = hint.unit; showUnit(hint.unit); }
    s.dose = value; s.doseTouched = true; persist();
    const input = root()?.querySelector('#qw-dose');
    if (input) input.value = formatDose(value, c.digits);
    announce(`Dose ${formatDose(value, c.digits)} ${s.doseUnit || c.unit}`);
    refreshPhyto();
  }
  // Rien n'est réécrit si le contenu ne change pas : quitter le champ produit ne doit pas retirer le bouton qu'on touche.
  function setBox(selector, content) {
    const box = root()?.querySelector(selector), markup = String(html`${content}`);
    if (!box || box.innerHTML === markup) return;
    const focused = box.contains(doc.activeElement) ? doc.activeElement.id : '';
    box.innerHTML = markup;
    if (focused) box.querySelector(`#${CSS.escape(focused)}`)?.focus({preventScroll: true}); // une case cochée garde le focus
  }
  function refreshPhyto() {
    setBox('#qw-phyto', phytoHtml());
    setBox('#qw-closing', closingHtml());
    setBox('#qw-hedge-box', hedgeHtml());
    setBox('#qw-habit-box', habitHtml());
    setBox('#qw-dose-warn', doseWarnHtml());
    setBox('#qw-info', infoHtml());
    setBox('#qw-sheet', sheetHtml());
    setBox('#qw-units', unitsHtml());
    setBox('#qw-full-box', fullHtml());
    if (s.step === 3) {
      setBox('#qw-date-note', dateNoteHtml());
      const summary = root()?.querySelector('#qw-summary-text'), text = draftSummary(state(), {...s, date: dateOf(), today: todayIso()});
      if (summary && summary.textContent !== text) summary.textContent = text;
      const button = root()?.querySelector('.qw-next'); if (button && button.textContent !== footLabel()) button.textContent = footLabel();
    }
  }

  let repeat = null;
  const stopRepeat = () => { clearTimeout(repeat); clearInterval(repeat); repeat = null; };

  function onClick(event) {
    const el = event.target.closest('[data-qw]');
    if (!el || !root()?.contains(el)) return;
    const what = el.dataset.qw;
    if (doubleTap(event)) return; // appui de trop, au même endroit, juste après un changement d'étape
    tileTap = what === 'type' && event.detail !== 0 ? {x: event.clientX, y: event.clientY, t: event.timeStamp, step: s.step} : null;
    if (what === 'back') go(Math.max(1, s.step - 1));
    else if (what === 'type') {
      clearTimeout(tileTimer); tileTimer = null;
      if (isGrazingType(el.dataset.type)) { grazing.start({type: el.dataset.type, parcelIds: s.parcelIds}); return; }
      if (isObservationType(el.dataset.type)) { openObservation(); return; }
      setType(el.dataset.type);
      render({focus: `.qw-tile[data-type="${CSS.escape(el.dataset.type)}"]`});
      tileTimer = setTimeout(() => { tileTimer = null; if (s?.step === 1 && s.type && root()) afterType(); }, reduced() ? 0 : 180);
    } else if (what === 'more') { s.showMore = !s.showMore; render({focus: s.showMore ? '#qw-custom-type' : '.qw-other'}); }
    else if (what === 'custom-type') {
      const value = String(root().querySelector('#qw-custom-type')?.value || '').trim();
      if (value && isGrazingType(value)) grazing.start({type: value, parcelIds: s.parcelIds});
      else if (value && isObservationType(value)) openObservation();
      else if (value) { setType(value, s.kind); afterType(); }
    } else if (what === 'kind') {
      s.kind = s.kind === el.dataset.kind ? '' : el.dataset.kind;
      render({focus: `.qw-pill[data-kind="${el.dataset.kind}"]`});
    } else if (what === 'habit') {
      const hint = doseSuggestion(state(), {type: s.type, kind: s.kind, product: s.product});
      if (hint) {
        s.dose = hint.value; s.doseUnit = hint.unit; s.doseTouched = true; persist();
        const input = root().querySelector('#qw-dose'); if (input) input.value = formatDose(hint.value, cfg().digits);
        showUnit(hint.unit);
        refreshPhyto();
      }
    } else if (what === 'resume') {
      const saved = readDraft(KEY, {storage: storage()})?.fields;
      if (saved?.grazing) grazing.start({type: saved.type, entry: saved.grazing.entry, screen: saved.grazing.screen, workId: saved.grazing.workId});
      else if (saved && isGrazingType(saved.type)) grazing.start({type: saved.type, parcelIds: saved.parcelIds || []}); // brouillon d'avant cette saisie : jamais de faux pâturage
      else if (saved && isObservationType(saved.type)) { removeDraft(KEY, {storage: storage()}); s = {...s, parcelIds: saved.parcelIds || []}; openObservation(); }
      else if (saved) { s = {...fresh(), ...saved, typeKind: saved.kind || '', step: saved.pending ? 3 : Math.max(2, saved.step || 2)}; render(); }
    } else if (what === 'discard') { removeDraft(KEY, {storage: storage()}); render(); }
    else if (what === 'filter') { s.filter = el.dataset.filter; s.order = null; render({focus: `.qw-pill[data-filter="${CSS.escape(s.filter)}"]`}); }
    else if (what === 'clear-filter') { s.filter = 'all'; s.query = ''; s.order = null; render({focus: '#qw-query'}); }
    else if (what === 'change-parcels') go(2);
    else if (what === 'parcel') {
      const id = el.dataset.id;
      // La parcelle présélectionnée par GPS cède la place au premier choix manuel (PF-17).
      if (s.gpsId) { if (id !== s.gpsId) s.parcelIds = s.parcelIds.filter(x => x !== s.gpsId); s.gpsId = ''; }
      s.parcelIds = s.parcelIds.includes(id) ? s.parcelIds.filter(x => x !== id) : [...s.parcelIds, id];
      persist(); render({focus: `.qw-parcel[data-id="${CSS.escape(id)}"]`}); announce(countText());
    } else if (what === 'all') {
      const shown = rowsOf().filter(r => !r.outside).map(r => r.parcel.id);
      const all = shown.every(id => s.parcelIds.includes(id));
      s.gpsId = '';
      s.parcelIds = all ? s.parcelIds.filter(id => !shown.includes(id)) : [...new Set([...s.parcelIds, ...shown])];
      persist(); render({focus: '[data-qw="all"]'}); announce(countText());
    } else if (what === 'map') {
      persist();
      try { win.localStorage.setItem(FROM_MAP, '1'); } catch { /* stockage indisponible : la sélection repartira de l'étape 1 */ }
      close(); switchView('map'); startMultipleSelection();
      toast('Touchez les parcelles, puis « Travail » pour revenir à la saisie.', 'info');
    } else if (what === 'next') next();
    else if (what === 'date') {
      s.dateChoice = el.dataset.date; checkPrefill(); persist(); render({focus: `.qw-pill[data-date="${el.dataset.date}"]`});
      if (s.dateChoice === 'custom') { const input = root().querySelector('#qw-custom-date'); try { input?.showPicker?.(); } catch { input?.focus(); } }
    } else if (what === 'time') { s.showTime = true; render({focus: '#qw-time'}); }
    else if (what === 'machine') { s.equipmentId = el.dataset.id; persist(); render({focus: `.qw-pill[data-id="${CSS.escape(el.dataset.id)}"]`}); }
    else if (what === 'unit') { s.doseUnit = el.dataset.unit; s.unitTouched = true; persist(); render({focus: `.qw-pill[data-unit="${CSS.escape(el.dataset.unit)}"]`}); }
    else if (what === 'qty-unit') { det().quantityUnit = el.dataset.unit; persist(); render({focus: `[data-qw="qty-unit"][data-unit="${CSS.escape(el.dataset.unit)}"]`}); }
    else if (what === 'forage') { det().forageType = det().forageType === el.dataset.key ? '' : el.dataset.key; persist(); render({focus: `.qw-pill[data-key="${CSS.escape(el.dataset.key)}"]`}); }
    else if (what === 'forage-mode') { det().forageMode = el.dataset.mode; persist(); render({focus: `.qw-pill[data-mode="${CSS.escape(el.dataset.mode)}"]`}); }
    else if (what === 'soil') { s.type = s.type === el.dataset.type ? s.soilBase : el.dataset.type; s.skip = []; s.include = []; persist(); render({focus: `.qw-pill[data-type="${CSS.escape(el.dataset.type)}"]`}); }
    else if (what === 'details') { event.preventDefault(); s.showDetails = !s.showDetails; render({focus: '[data-qw="details"]'}); }
    else if (what === 'dose' && event.detail === 0) stepDose(Number(el.dataset.dir)); // clavier ; le doigt et la souris passent par pointerdown
    else if (what === 'full') openFull();
  }

  function onPointerDown(event) {
    const el = event.target.closest('[data-qw="dose"]');
    if (!el) return;
    event.preventDefault();
    const dir = Number(el.dataset.dir);
    stepDose(dir);
    stopRepeat();
    repeat = setTimeout(() => { repeat = setInterval(() => stepDose(dir), 110); }, 420); // appui long : le pas se répète
  }

  function onInput(event) {
    const id = event.target.id;
    if (id === 'qw-query') { s.query = event.target.value; s.order = null; const list = root().querySelector('#qw-parcels'); if (list) list.innerHTML = String(html`${listHtml()}`); setBox('#qw-count-box', countHtml()); return; }
    if (id === 'qw-product') {
      // Un motif de dérogation vaut pour le produit pour lequel il a été écrit, pas pour le suivant (PF-14).
      if (event.target.value.trim() !== s.product.trim()) s.reason = '';
      s.product = event.target.value;
      // La dose du produit précédent ne suit pas : le produit saisi a sa propre suggestion (bouton « Habituel »).
      const dose = root().querySelector('#qw-dose');
      if (dose) dose.placeholder = dosePlaceholder();
      // Unité de départ selon le produit (lisier en m³/ha, fumier en t/ha), tant que la dose n'est pas saisie.
      if (!s.doseTouched && !s.unitTouched && !s.prefill && !cfg().none && s.doseUnit !== cfg().unit && (cfg().units || []).includes(s.doseUnit || cfg().unit)) { s.doseUnit = cfg().unit; showUnit(s.doseUnit); }
      checkPrefill();
      refreshPhyto();
    } else if (id === 'qw-custom-type') { s.customType = event.target.value; return; }
    else if (id === 'qw-hedge') { s.hedgeOk = event.target.checked; }
    else if (id === 'qw-dose') { s.dose = parseDose(event.target.value); s.doseTouched = true; refreshPhyto(); }
    else if (id === 'qw-custom-date') { s.customDate = event.target.value; checkPrefill(); refreshPhyto(); }
    else if (id === 'qw-time') { s.startTime = event.target.value; refreshPhyto(); }
    else if (id === 'qw-note') s.note = event.target.value;
    else if (id === 'qw-machine-more') { if (event.type !== 'change' || !event.target.value) return; s.equipmentId = event.target.value; persist(); render({focus: '#qw-machine-more'}); return; }
    else if (event.target.dataset?.qx) {
      const name = event.target.dataset.qx;
      det()[name] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      if (name === 'cover') { det().culture = ''; if (!det().cover) prefillCulture(); render({focus: '#qx-cover'}); persist(); return; }
      refreshPhyto();
    }
    else if (id === 'qw-reason') s.reason = event.target.value;
    else if (event.target.dataset?.qwInclude) {
      const sid = event.target.dataset.qwInclude;
      s.include = event.target.checked ? [...s.include, sid] : s.include.filter(x => x !== sid);
      setBox('#qw-full-box', fullHtml());
      persist();
      return;
    } else if (event.target.dataset?.qwSkip) {
      const sid = event.target.dataset.qwSkip;
      s.skip = event.target.checked ? s.skip.filter(x => x !== sid) : [...s.skip, sid];
      // Le travail prévu n'est plus clôturé : ses valeurs reprises ne vont pas à la nouvelle fiche.
      if (!event.target.checked && s.prefill?.workId === sid) { clearPrefill(); render({focus: `[data-qw-skip="${CSS.escape(sid)}"]`}); }
      setBox('#qw-full-box', fullHtml());
      persist(); // un prévu décoché le reste après la carte ou une reprise (PF-13)
      return;
    } else return;
    persist();
  }

  function onKeyDown(event) {
    if (grazing.active()) return;
    if (event.key === 'Enter' && !event.isComposing && !['TEXTAREA', 'BUTTON'].includes(event.target.tagName)) {
      if (event.target.id === 'qw-custom-type') { event.preventDefault(); root().querySelector('[data-qw="custom-type"]')?.click(); return; }
      if (s.step > 1) { event.preventDefault(); next(); }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const tiles = [...root().querySelectorAll('.qw-tile, .qw-parcel')];
    const i = tiles.indexOf(doc.activeElement);
    if (i < 0) return;
    event.preventDefault();
    // Colonnes réelles de la grille (2 sur téléphone, plus sur ordinateur).
    const grid = doc.activeElement.parentElement;
    const cols = s.step === 1 && grid ? Math.max(1, String(win.getComputedStyle?.(grid)?.gridTemplateColumns || '').split(' ').filter(Boolean).length) : 1;
    const delta = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols}[event.key];
    tiles[Math.min(tiles.length - 1, Math.max(0, i + delta))]?.focus();
  }

  // Ouvre la feuille (en-tête de modal() masqué, écouteurs posés) sans encore rien afficher dedans.
  function mount() {
    modal('Ajouter', '', '<div class="qw" data-step="1"></div><p class="sr-only" id="qw-live" role="status" aria-live="polite"></p>', '', 'quick-work-sheet');
    announced = false;
    const el = root();
    if (!el) return null;
    // En-tête de modal() masqué (titre gardé pour le nom du dialogue) : ses boutons sortent de l'ordre du focus.
    el.closest('.modal')?.querySelectorAll(':scope > .modal-header button').forEach(b => { b.hidden = true; });
    el.addEventListener('click', onClick);
    el.addEventListener('click', grazing.onClick);
    el.addEventListener('pointerdown', onPointerDown);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => el.addEventListener(type, stopRepeat));
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('input', grazing.onInput);
    el.addEventListener('change', grazing.onInput);
    el.addEventListener('keydown', onKeyDown);
    return el;
  }

  function openObservation() {
    const parcelId = s.parcelIds[0] || null;
    close();
    openObservationForm(null, {parcelId, useGps: true});
  }

  function open({parcelIds = [], fromMap = false} = {}) {
    grazing.stop();
    if (tabBlocked()) return;
    // Le rôle se contrôle avant la saisie, pas à l'enregistrement (firestore.rules reste la barrière).
    if (store.writeGuard && !store.writeGuard({entity: 'interventions', action: 'create'})) { toast('Votre rôle ne permet pas d’ajouter un travail.', 'error'); return; }
    let fromMapFlag = false;
    try { fromMapFlag = win.localStorage.getItem(FROM_MAP) === '1'; win.localStorage.removeItem(FROM_MAP); } catch { /* sans stockage, pas de reprise */ }
    clearTimeout(tileTimer); tileTimer = null; stopRepeat();
    s = fresh({parcelIds});
    // Parcelles données par l'écran d'origine (fiche, carte, mode terrain) : l'étape 2 sera sautée (PF-17).
    s.fixed = parcelIds.length > 0;
    // Reprise après « Choisir sur la carte » : seulement au retour de la sélection multiple (map-multiple-work).
    const saved = fromMap && fromMapFlag ? readDraft(KEY, {storage: storage()})?.fields : null;
    if (saved?.type) s = {...fresh(), ...saved, typeKind: saved.kind || '', parcelIds: parcelIds.length ? [...parcelIds] : saved.parcelIds, step: 2};
    else if (!parcelIds.length) {
      // Parcelle sous les pieds (GPS précis et récent), comme l'ancienne saisie « J'ai fait » : signalée, jamais muette.
      const located = rankParcels(state(), {gps: gps()});
      if (located.reason === 'gps' && located.selectedId) { s.parcelIds = [located.selectedId]; s.gpsId = located.selectedId; s.gpsAccuracy = located.accuracy; }
    }
    if (!mount()) return;
    if (saved?.grazing) grazing.start({type: saved.type, entry: saved.grazing.entry, screen: saved.grazing.screen, workId: saved.grazing.workId});
    else if (saved?.type && isGrazingType(saved.type)) grazing.start({type: saved.type, parcelIds: s.parcelIds});
    else render();
  }

  // Mettre au pré direct : parcelle, date et travail à clore préremplis (recherche, finish-work, assistant, dictée…).
  function openGrazing({parcelIds = [], date = '', workId = '', finishPlain = null, note = '', type = 'Pâturage'} = {}) {
    if (tabBlocked()) return;
    s = fresh({parcelIds});
    if (!mount()) return;
    grazing.start({type, parcelIds, date, workId, finishPlain, note});
  }

  // Retour matériel (Android) : recule d'une étape au lieu de fermer la feuille ; false si rien à reculer (PF-21).
  function back() {
    if (!s || !root() || grazing.active() || s.pending || s.step < 2) return false;
    go(s.step - 1);
    return true;
  }
  // Appelé par closeModal d'app.js quand la feuille se ferme : minuteurs arrêtés ; brouillon gardé et annoncé.
  function closing() {
    clearTimeout(tileTimer); tileTimer = null; stopRepeat();
    if (leaving || !s || grazing.active() || s.step < 2 || !s.type) return;
    persist();
    toast('Brouillon gardé : le « + » propose de reprendre la saisie.', 'info');
  }

  return {open, openGrazing, resume: () => open({fromMap: true}), back, closing};
}
