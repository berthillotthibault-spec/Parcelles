// Saisie d'un travail en 3 étapes (n° 160) : feuille du bas ouverte par le « + », « + Travail ici » (carte),
// « + Nouveau travail » (fiche), « J'ai fait » et la sélection multiple de la carte. Quoi, où, détails ;
// l'édition d'un travail garde le formulaire complet, joignable aussi d'ici sans perdre la saisie.
// Module différé (clé quickWork de lazy-modules.js) ; logique dans quick-work.js.
import {html, raw} from './safe-html.js';
import {icon} from './ui.js';
import {uid} from './utils.js';
import {isPhytoType} from './quick-entry.js';
import {checkTreatment, limitsSnapshot} from './phyto.js';
import {draftKey, readDraft, writeDraft, removeDraft, draftTimeLabel} from './form-drafts.js';
import {orderedWorkTypes, typeBadge, doseConfig, parseDose, formatDose, learnedDose, parcelChoices, parcelFilters,
  draftSummary, draftDate, buildQuickWorks, draftFields, defaultsFor} from './quick-work.js';

const KEY = draftKey('quick-work', 'nouveau');
const FROM_MAP = 'parcelles:quick-work:map';
const TITLES = ['Quel travail ?', 'Sur quelles parcelles ?', 'Les détails'];
const DATES = [['today', 'Aujourd’hui'], ['yesterday', 'Hier'], ['custom', 'Autre date']];
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);

export function createQuickWorkUI({store, state, modal, closeModal, toast, savedToast, todayIso, openWorkForm, openBatchWorkForm,
  catalog = () => null, cultureColor = () => 'var(--brand)', switchView, startMultipleSelection, win = window, doc = document}) {
  let s = null;
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const storage = () => { try { return win.localStorage; } catch { return null; } };
  const root = () => doc.querySelector('#modal-root .qw');
  const cfg = () => doseConfig(s.type);

  function fresh({parcelIds = []} = {}) {
    return {step: 1, type: null, parcelIds: [...parcelIds], dateChoice: 'today', customDate: '', product: '', dose: null, doseUnit: '',
      doseTouched: false, equipmentId: '', note: '', startTime: '', showTime: false, filter: 'all', query: '', showMore: false, reason: '', needReason: false, error: ''};
  }
  function persist() {
    if (s.step < 2 || !s.type) return;
    writeDraft(KEY, draftFields(s), {storage: storage()});
  }
  function setType(type) {
    const changed = type !== s.type;
    s.type = type;
    if (changed) {
      const c = doseConfig(type), learned = c.none ? null : learnedDose(state(), {type});
      s.dose = c.none ? null : (learned?.dose ?? c.def);
      s.doseUnit = c.none ? '' : (learned?.unit || c.unit);
      s.doseTouched = false;
      s.product = '';
      s.equipmentId = defaultsFor(type, state()).equipmentId || '';
    }
  }

  // ---------- Rendu ----------
  const badge = type => { const b = typeBadge(type); return html`<span class="wk-badge" data-family="${b.family}" aria-hidden="true">${b.ab}</span>`; };
  const chip = (attrs, label, on) => html`<button type="button" class="qw-pill${on ? ' is-on' : ''}" aria-pressed="${on ? 'true' : 'false'}" ${attrs}>${label}</button>`;

  function headHtml() {
    const summary = s.step > 1 ? draftSummary(state(), s) : '';
    return html`<div class="qw-head">
      <div class="qw-bar"><button type="button" class="qw-back" data-qw="back"${s.step > 1 ? '' : raw(' hidden')}>‹ Retour</button>
        <span class="qw-kicker">Étape ${s.step} / 3</span>
        <button type="button" class="qw-close" data-action="close-modal" aria-label="Fermer">${raw(icon('close', {size: 20}))}</button></div>
      <div class="qw-progress" aria-hidden="true">${[1, 2, 3].map(i => html`<span${i <= s.step ? raw(' class="is-on"') : ''}></span>`)}</div>
      <h3 class="qw-title" id="qw-title">${TITLES[s.step - 1]}</h3>
      ${summary ? html`<p class="qw-summary">${summary}</p>` : ''}
    </div>`;
  }

  function resumeHtml() {
    const saved = readDraft(KEY, {storage: storage()});
    if (!saved?.fields?.type) return '';
    const f = saved.fields;
    return html`<div class="qw-resume" role="status"><span><strong>Reprendre la saisie</strong><small>${draftSummary(state(), f)} · ${draftTimeLabel(saved.savedAt)}</small></span>
      <button type="button" class="button primary" data-qw="resume">Reprendre</button><button type="button" class="text-button" data-qw="discard">Ignorer</button></div>`;
  }

  function step1Html() {
    const {top, more} = orderedWorkTypes(state(), {today: todayIso()});
    const tile = t => html`<button type="button" class="qw-tile${s.type === t.type ? ' is-on' : ''}" data-qw="type" data-type="${t.type}" aria-pressed="${s.type === t.type ? 'true' : 'false'}">${badge(t.type)}<b>${t.type}</b></button>`;
    return html`${resumeHtml()}<div class="qw-tiles" role="group" aria-labelledby="qw-title">${top.map(tile)}
      <button type="button" class="qw-tile qw-other" data-qw="more" aria-expanded="${s.showMore ? 'true' : 'false'}"><span class="wk-badge" data-family="other" aria-hidden="true">…</span><b>Autre…</b></button></div>
      ${s.showMore ? html`<div class="qw-more">${more.length ? html`<div class="qw-tiles">${more.map(tile)}</div>` : ''}
        <label class="qw-field"><span>Autre type de travail</span><span class="qw-inline"><input id="qw-custom-type" autocomplete="off" placeholder="ex. Broyage"><button type="button" class="button primary" data-qw="custom-type">OK</button></span></label></div>` : ''}`;
  }

  function listHtml() {
    const rows = parcelChoices(state(), {type: s.type, today: todayIso(), selected: s.parcelIds, query: s.query, filter: s.filter});
    if (!rows.length) return html`<p class="qw-empty">Aucune parcelle ne correspond.</p>`;
    return rows.map(({parcel: p, planned, selected}) => html`<button type="button" class="qw-parcel${selected ? ' is-on' : ''}" data-qw="parcel" data-id="${p.id}" role="checkbox" aria-checked="${selected ? 'true' : 'false'}">
      <span class="qw-box" aria-hidden="true">${selected ? '✓' : ''}</span>
      <span class="qw-parcel-text"><b>${p.nom}</b><small>${[p.culture, `${formatDose(Number(p.surfaceHa) || 0, 0)} ha`].filter(Boolean).join(' · ')}</small>${planned ? html`<em class="qw-planned">Prévu aujourd’hui</em>` : ''}</span>
      <span class="qw-dot" style="background:${cultureColor(p.culture || '')}" aria-hidden="true"></span></button>`);
  }

  function step2Html() {
    return html`<label class="qw-search"><span class="sr-only">Rechercher une parcelle</span>${raw(icon('search', {size: 18}))}<input id="qw-query" type="search" value="${s.query}" placeholder="Nom, culture ou commune" autocomplete="off"></label>
      <div class="qw-filters" role="group" aria-label="Filtrer les parcelles">${parcelFilters(state()).map(f => chip(html`data-qw="filter" data-filter="${f.id}"`, f.label, s.filter === f.id))}</div>
      <div class="qw-parcels" id="qw-parcels">${listHtml()}</div>
      <button type="button" class="text-button qw-map-link" data-qw="map">Choisir sur la carte</button>`;
  }

  function phytoHtml() {
    if (!isPhytoType(s.type) || !s.parcelIds.length) return '';
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

  function step3Html() {
    const c = cfg(), data = state();
    const products = [...new Set([...live(data.stockItems).map(x => x.name), ...live(data.interventions).map(w => w.product)].filter(Boolean))].slice(0, 30);
    const machines = live(data.materiels);
    const clients = [...new Set(live(data.parcelles).filter(p => s.parcelIds.includes(p.id) && p.clientId)
      .map(p => live(data.clients).find(x => x.id === p.clientId)?.nom).filter(Boolean))];
    return html`<div class="qw-details">
      <div class="qw-field"><span id="qw-when">Quand ?</span><div class="qw-dates" role="group" aria-labelledby="qw-when">${DATES.map(([id, label]) => chip(html`data-qw="date" data-date="${id}"`, label, s.dateChoice === id))}</div>
        <input id="qw-custom-date" type="date" value="${s.customDate || todayIso()}"${s.dateChoice === 'custom' ? '' : raw(' hidden')} aria-label="Date du travail">
        ${s.showTime ? html`<label class="qw-time">Heure<input id="qw-time" type="time" value="${s.startTime}"></label>` : html`<button type="button" class="text-button" data-qw="time">+ Heure</button>`}</div>
      <label class="qw-field"><span>${c.label}</span><input id="qw-product" value="${s.product}" placeholder="${c.placeholder}" autocomplete="off"${c.none ? '' : raw(' list="qw-products"')}>
        ${c.none ? '' : html`<datalist id="qw-products">${products.map(p => html`<option value="${p}"></option>`)}</datalist>`}</label>
      <div id="qw-phyto">${phytoHtml()}</div>
      ${c.none ? '' : html`<div class="qw-field"><span id="qw-dose-label">Dose</span><div class="qw-dose" role="group" aria-labelledby="qw-dose-label">
        <button type="button" class="qw-step" data-qw="dose" data-dir="-1" aria-label="Moins">−</button>
        <label class="qw-dose-value"><input id="qw-dose" inputmode="decimal" value="${s.dose === null ? '' : formatDose(s.dose, c.digits)}" aria-label="Dose en ${s.doseUnit || c.unit}"><span>${s.doseUnit || c.unit}</span></label>
        <button type="button" class="qw-step" data-qw="dose" data-dir="1" aria-label="Plus">+</button></div></div>`}
      ${clients.length ? html`<p class="qw-client">Pour : <b>${clients.join(', ')}</b> (client de la parcelle)</p>` : ''}
      ${machines.length ? html`<div class="qw-field"><span id="qw-machine">Matériel</span><div class="qw-machines" role="group" aria-labelledby="qw-machine">
        ${chip(raw('data-qw="machine" data-id=""'), 'Aucun', !s.equipmentId)}${machines.slice(0, 6).map(m => chip(html`data-qw="machine" data-id="${m.id}"`, m.nom || 'Engin', s.equipmentId === m.id))}</div></div>` : ''}
      <button type="button" class="text-button qw-full" data-qw="full">Formulaire complet</button>
      ${s.error ? html`<p class="form-error" role="alert">${s.error}</p>` : ''}</div>`;
  }

  function footHtml() {
    if (s.step === 1) return '';
    const ready = s.step === 3 || s.parcelIds.length > 0;
    const label = s.step === 3 ? 'Enregistrer' : ready ? 'Continuer' : 'Choisissez au moins une parcelle';
    return html`<div class="qw-foot"><button type="button" class="button primary qw-next" data-qw="next"${ready ? '' : raw(' disabled')}>${label}</button></div>`;
  }

  function render({focus = ''} = {}) {
    const el = root();
    if (!el) return;
    const body = s.step === 1 ? step1Html() : s.step === 2 ? step2Html() : step3Html();
    el.innerHTML = String(html`${headHtml()}<div class="qw-body">${body}</div>${footHtml()}`);
    el.dataset.step = String(s.step);
    const target = focus && el.querySelector(focus);
    (target || el.querySelector('.qw-tile.is-on, .qw-tile, #qw-query, .qw-pill.is-on, .qw-next'))?.focus({preventScroll: true});
  }

  // ---------- Écritures ----------
  function buildDraftWorks() {
    const c = cfg();
    const dose = c.none ? null : parseDose(s.dose);
    return buildQuickWorks({type: s.type, parcelIds: s.parcelIds, date: draftDate(s.dateChoice, todayIso(), s.customDate),
      product: s.product, dose, doseUnit: s.doseUnit, equipmentId: s.equipmentId, note: s.note, startTime: s.startTime}, state(), {today: todayIso(), batchId: uid('batch')});
  }

  async function save() {
    let result;
    try { result = buildDraftWorks(); } catch (error) { s.error = error.message; render({focus: '.qw-next'}); return; }
    if (isPhytoType(s.type)) {
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
        return;
      }
    }
    const n = result.creates.length + result.updates.length;
    const label = `${s.type} · ${n} parcelle${n > 1 ? 's' : ''}`;
    if (result.creates.length) await store.upsertMany('interventions', result.creates, {label: `Travail enregistré : ${label}`});
    if (result.updates.length) await store.upsertMany('interventions', result.updates, {label: `Travail prévu terminé : ${label}`});
    if (result.tasks.length) await store.upsertMany('tasks', result.tasks, {label: `Tâche terminée : ${label}`});
    removeDraft(KEY, {storage: storage()});
    closeModal();
    savedToast(`${s.type} enregistré · ${n} parcelle${n > 1 ? 's' : ''}`);
  }

  function openFull() {
    const c = cfg(), dose = c.none ? null : parseDose(s.dose);
    const prefill = {type: s.type || '', date: draftDate(s.dateChoice, todayIso(), s.customDate), status: 'Terminé', product: c.none ? '' : s.product,
      dose: dose ?? '', doseUnit: dose === null ? '' : s.doseUnit, equipmentId: s.equipmentId, note: c.none ? s.product : s.note, startTime: s.startTime};
    persist();
    closeModal();
    if (s.parcelIds.length > 1) openBatchWorkForm(s.parcelIds, prefill);
    else openWorkForm(prefill, s.parcelIds[0] || null);
  }

  // ---------- Interactions ----------
  function go(step) { s.step = step; s.error = ''; persist(); render(); }
  function next() {
    if (s.step === 2 && s.parcelIds.length) go(3);
    else if (s.step === 3) save();
  }
  function stepDose(dir) {
    const c = cfg();
    const value = Math.max(0, +((parseDose(s.dose) ?? 0) + dir * c.step).toFixed(2));
    s.dose = value; s.doseTouched = true; persist();
    const input = root()?.querySelector('#qw-dose');
    if (input) input.value = formatDose(value, c.digits);
    refreshPhyto();
  }
  function refreshPhyto() { const box = root()?.querySelector('#qw-phyto'); if (box) box.innerHTML = String(html`${phytoHtml()}`); }

  let repeat = null;
  const stopRepeat = () => { clearTimeout(repeat); clearInterval(repeat); repeat = null; };

  function onClick(event) {
    const el = event.target.closest('[data-qw]');
    if (!el || !root()?.contains(el)) return;
    const what = el.dataset.qw;
    if (what === 'back') go(Math.max(1, s.step - 1));
    else if (what === 'type') {
      setType(el.dataset.type);
      render({focus: `.qw-tile[data-type="${CSS.escape(el.dataset.type)}"]`});
      setTimeout(() => { if (s.step === 1 && root()) go(2); }, reduced() ? 0 : 180);
    } else if (what === 'more') { s.showMore = !s.showMore; render({focus: s.showMore ? '#qw-custom-type' : '.qw-other'}); }
    else if (what === 'custom-type') {
      const value = String(root().querySelector('#qw-custom-type')?.value || '').trim();
      if (value) { setType(value); go(2); }
    } else if (what === 'resume') {
      const saved = readDraft(KEY, {storage: storage()})?.fields;
      if (saved) { s = {...fresh(), ...saved, step: Math.max(2, saved.step || 2)}; render(); }
    } else if (what === 'discard') { removeDraft(KEY, {storage: storage()}); render(); }
    else if (what === 'filter') { s.filter = el.dataset.filter; render({focus: `.qw-pill[data-filter="${CSS.escape(s.filter)}"]`}); }
    else if (what === 'parcel') {
      const id = el.dataset.id;
      s.parcelIds = s.parcelIds.includes(id) ? s.parcelIds.filter(x => x !== id) : [...s.parcelIds, id];
      persist(); render({focus: `.qw-parcel[data-id="${CSS.escape(id)}"]`});
    } else if (what === 'map') {
      persist();
      try { win.localStorage.setItem(FROM_MAP, '1'); } catch { /* stockage indisponible : la sélection repartira de l'étape 1 */ }
      closeModal(); switchView('map'); startMultipleSelection();
      toast('Touchez les parcelles, puis « Travail » pour revenir à la saisie.', 'info');
    } else if (what === 'next') next();
    else if (what === 'date') {
      s.dateChoice = el.dataset.date; persist(); render({focus: `.qw-pill[data-date="${el.dataset.date}"]`});
      if (s.dateChoice === 'custom') { const input = root().querySelector('#qw-custom-date'); try { input?.showPicker?.(); } catch { input?.focus(); } }
    } else if (what === 'time') { s.showTime = true; render({focus: '#qw-time'}); }
    else if (what === 'machine') { s.equipmentId = el.dataset.id; persist(); render({focus: `.qw-pill[data-id="${CSS.escape(el.dataset.id)}"]`}); }
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
    if (id === 'qw-query') { s.query = event.target.value; const list = root().querySelector('#qw-parcels'); if (list) list.innerHTML = String(html`${listHtml()}`); return; }
    if (id === 'qw-product') {
      s.product = event.target.value;
      const learned = !s.doseTouched && !cfg().none && learnedDose(state(), {type: s.type, product: s.product});
      if (learned && learned.product.toLowerCase() === s.product.trim().toLowerCase()) {
        s.dose = learned.dose; if (learned.unit) s.doseUnit = learned.unit;
        const input = root().querySelector('#qw-dose'); if (input) input.value = formatDose(learned.dose, cfg().digits);
      }
      refreshPhyto();
    } else if (id === 'qw-dose') { s.dose = parseDose(event.target.value); s.doseTouched = true; refreshPhyto(); }
    else if (id === 'qw-custom-date') { s.customDate = event.target.value; refreshPhyto(); }
    else if (id === 'qw-time') s.startTime = event.target.value;
    else if (id === 'qw-reason') s.reason = event.target.value;
    else return;
    persist();
  }

  function onKeyDown(event) {
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
    const cols = s.step === 1 ? 2 : 1;
    const delta = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols}[event.key];
    tiles[Math.min(tiles.length - 1, Math.max(0, i + delta))]?.focus();
  }

  function open({parcelIds = [], fromMap = false} = {}) {
    let fromMapFlag = false;
    try { fromMapFlag = win.localStorage.getItem(FROM_MAP) === '1'; win.localStorage.removeItem(FROM_MAP); } catch { /* sans stockage, pas de reprise */ }
    s = fresh({parcelIds});
    const saved = (fromMap || fromMapFlag) ? readDraft(KEY, {storage: storage()})?.fields : null;
    if (saved?.type) s = {...fresh(), ...saved, parcelIds: parcelIds.length ? [...parcelIds] : saved.parcelIds, step: 2};
    modal('Saisir un travail', '', '<div class="qw" data-step="1"></div>', '', 'quick-work-sheet');
    const el = root();
    if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', onPointerDown);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => el.addEventListener(type, stopRepeat));
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('keydown', onKeyDown);
    render();
  }

  return {open, resume: () => open({fromMap: true})};
}
