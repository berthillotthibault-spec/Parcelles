// Sous-vue « Semaine » de Travaux (n° 107) : 7 colonnes avec bande météo et charge,
// « Proposer » place les travaux non datés, glisser-déposer (souris ou doigt) ou boutons
// ← → pour corriger, « Appliquer » écrit toutes les dates en une seule écriture annulable.
import {weekStart, shiftWeek, buildWeek, proposeWeek, checkPlacement, moveDate, planChanges, isUndated, dayLoadAfter, weekRangeLabel, DAY_CAPACITY} from './week-planner.js';
import {escapeHtml as e, formatNumber} from './utils.js';

const works = n => `${n} ${n > 1 ? 'travaux' : 'travail'}`;
const LEVEL_LABEL = {favorable: 'favorable', watch: 'à surveiller', unfavorable: 'défavorable', none: 'pas de prévision', past: 'passé', unknown: 'données incomplètes'};

export function createWeekPlannerUI({doc = globalThis.document, store, getState = () => store?.state || {}, getWeather = () => null, toast = () => {}, refresh = () => {}, now = () => Date.now()} = {}) {
  let start = weekStart(new Date(now()));
  let plan = null;
  let drag = null;
  const parcels = () => new Map((getState().parcelles || []).map(p => [p.id, p]));
  const machines = () => new Map((getState().materiels || []).map(m => [m.id, m]));

  function band(dw, date) {
    if (!dw.known) { const over = dw.hours.length && dw.hours.every(h => h.level === 'past'); return `<div class="week-band is-unknown" role="img" aria-label="Météo du ${e(date)} : ${over ? 'journée terminée' : 'pas de prévision'}"><span>${over ? 'Journée terminée' : 'Météo inconnue'}</span></div>`; }
    const summary = `${formatNumber(dw.rain)} mm${dw.wind !== null ? ` · vent ${formatNumber(dw.wind)} km/h` : ''}`;
    const label = `Météo : ${dw.favorable} h favorables, ${dw.watch} h à surveiller, ${dw.unfavorable} h défavorables entre 6 h et 20 h ; ${summary}`;
    return `<div class="week-band" role="img" aria-label="${e(label)}"><div class="week-band-cells">${dw.hours.map(h => `<i class="is-${h.level}" title="${h.hour} h : ${LEVEL_LABEL[h.level] || h.level}"></i>`).join('')}</div><small>${e(summary)}</small></div>`;
  }

  function loadBar(hours) {
    const ratio = Math.min(1, hours / DAY_CAPACITY), over = hours > DAY_CAPACITY;
    return `<div class="week-load${over ? ' is-over' : ''}" aria-label="Charge ${formatNumber(hours)} heures sur ${DAY_CAPACITY}"><span style="--load:${ratio}"></span><small>${formatNumber(hours)} h</small></div>`;
  }

  function card(item, date) {
    const w = item.work, p = parcels().get(w.parcelId), m = machines().get(w.equipmentId);
    const warnings = checkPlacement(getState(), plan, w.id, date, {weather: getWeather(), now: now()});
    const title = `${w.type || 'Travail'} · ${p?.nom || 'Parcelle'}`;
    return `<article class="week-card is-proposed${warnings.length ? ' has-warning' : ''}" data-week-card="${e(w.id)}" aria-label="${e(title)}, proposé le ${e(date)}">
<button type="button" class="week-grip" data-week-grip="${e(w.id)}" aria-label="Glisser ${e(title)} vers un autre jour"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>
<div class="week-card-text"><strong>${e(w.type || 'Travail')}</strong><span>${e(p?.nom || 'Parcelle')}${m ? ` · ${e(m.nom)}` : ''}${item.hours ? ` · ${formatNumber(item.hours)} h` : ''}</span><small class="week-why">${e(item.reasons.join(' ; '))}</small>${warnings.length ? `<small class="week-warn">Attention : ${e(warnings.join(' ; '))}</small>` : ''}</div>
<div class="week-move"><button type="button" class="week-step" data-week-move="-1" data-id="${e(w.id)}" aria-label="Jour précédent : ${e(title)}">←</button><button type="button" class="week-step" data-week-move="1" data-id="${e(w.id)}" aria-label="Jour suivant : ${e(title)}">→</button></div>
</article>`;
  }

  function fixed(w) {
    const p = parcels().get(w.parcelId);
    return `<button type="button" class="week-card is-fixed" data-action="edit-work" data-id="${e(w.id)}"><strong>${e(w.type || 'Travail')}</strong><span>${e(p?.nom || 'Parcelle')}</span></button>`;
  }

  // Sur écran étroit, la grille s'ouvre sur le premier jour encore utilisable,
  // puis garde sa position de défilement d'un rendu à l'autre (déplacement d'une carte).
  let shownWeek = '';
  function keepScroll() {
    const old = doc.querySelector?.('#work-panel-sub .week-grid'), prev = old && shownWeek === start ? old.scrollLeft : null;
    shownWeek = start;
    setTimeout(() => {
      const grid = doc.querySelector?.('#work-panel-sub .week-grid');
      if (!grid) return;
      if (prev !== null) { grid.scrollLeft = prev; return; }
      const col = grid.querySelector('.week-col:not(.is-past)');
      if (col) grid.scrollLeft = Math.max(0, col.offsetLeft - grid.offsetLeft - 4);
    }, 0);
  }

  function view() {
    keepScroll();
    const state = getState(), weather = getWeather(), t = now();
    if (plan && plan.start !== start) plan = null;
    const week = plan ? plan.week : buildWeek(state, start, {weather, now: t});
    const undated = (state.interventions || []).filter(w => !w.deletedAt && isUndated(w));
    const changes = plan ? planChanges(plan).length : 0;
    const cols = week.map(day => {
      const proposed = plan ? plan.placed.filter(p => p.date === day.date) : [];
      const hours = plan ? dayLoadAfter(plan, day.date) : day.hours;
      const d = new Date(`${day.date}T00:00:00`);
      return `<section class="week-col${day.isToday ? ' is-today' : ''}${day.past ? ' is-past' : ''}" data-week-day="${day.date}" aria-label="${e(d.toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long'}))}">
<header class="week-col-head"><span>${e(day.name)}</span><b>${d.getDate()}</b></header>
${band(day.weather, day.date)}${loadBar(hours)}
<div class="week-col-body">${day.chantiers.map(c => `<p class="week-chantier">Chantier · ${e(c.type || 'sans nom')}${c.equipmentId && machines().get(c.equipmentId) ? ` · ${e(machines().get(c.equipmentId).nom)}` : ''}</p>`).join('')}${day.works.map(fixed).join('')}${proposed.map(p => card(p, day.date)).join('')}</div>
</section>`;
    }).join('');
    const pending = plan ? plan.unplaced : undated.map(work => ({work, reasons: []}));
    const aside = pending.length ? `<section class="week-unplaced"><h3>${plan ? 'Non placés' : 'À placer'} <span>${pending.length}</span></h3>${pending.map(u => { const p = parcels().get(u.work.parcelId); return `<p><strong>${e(u.work.type || 'Travail')}</strong> · ${e(p?.nom || 'Parcelle')}${u.reasons.length ? `<small>${e(u.reasons.slice(0, 3).join(' ; '))}</small>` : ''}</p>`; }).join('')}</section>` : '';
    const actions = `<div class="week-toolbar"><button type="button" class="small-button" data-week-nav="-1" aria-label="Semaine précédente">‹</button><strong class="week-range">${e(weekRangeLabel(start))}</strong><button type="button" class="small-button" data-week-nav="1" aria-label="Semaine suivante">›</button></div><div class="week-buttons"><button type="button" class="button secondary" data-week-propose ${undated.length ? '' : 'disabled'}>Proposer</button>${plan ? `<button type="button" class="button secondary" data-week-reset>Effacer</button>` : ''}<button type="button" class="button primary" data-week-apply ${changes ? '' : 'disabled'}>Appliquer${changes ? ` (${changes})` : ''}</button></div>`;
    const lead = `${undated.length ? `${works(undated.length)} sans date à placer.` : 'Aucun travail sans date.'} ${plan ? 'Glissez une carte ou utilisez ← → pour la déplacer.' : '« Proposer » tient compte de la météo, des parcelles voisines, des engins et des chantiers.'}`;
    return {description: e(lead), actions, body: `<div class="week-grid" role="group" aria-label="Semaine du ${e(weekRangeLabel(start))}">${cols}</div>${aside}<p class="form-note week-disclaimer">${e(plan?.disclaimer || 'Bande météo : cases vertes favorables, ambre à surveiller, rouges défavorables (6 h–20 h).')}</p>`};
  }

  function propose() {
    const res = proposeWeek(getState(), start, {weather: getWeather(), now: now()});
    plan = {...res, start};
    refresh();
    toast(res.placed.length ? `${works(res.placed.length)} proposé${res.placed.length > 1 ? 's' : ''}. Vérifiez puis appliquez.` : 'Aucun jour ne convient cette semaine.', res.placed.length ? 'success' : 'info');
  }

  function move(id, date) {
    const item = plan?.placed.find(p => p.work.id === id);
    if (!item || !date || item.date === date) return;
    item.date = date;
    if (!item.reasons.includes('déplacé à la main')) item.reasons = ['déplacé à la main', ...item.reasons.filter(r => !/^regroupé|journée/.test(r))];
    refresh();
    doc.querySelector(`[data-week-card="${CSS.escape(id)}"] [data-week-grip]`)?.focus({preventScroll: true});
  }

  async function apply() {
    if (!plan) return;
    const changes = planChanges(plan);
    if (!changes.length) return;
    const current = new Map((getState().interventions || []).map(w => [w.id, w]));
    const before = changes.map(w => current.get(w.id)).filter(Boolean).map(w => ({...w}));
    await store.upsertMany('interventions', changes.map(w => ({...current.get(w.id), plannedDate: w.plannedDate})), {label: `Semaine organisée : ${works(changes.length)} daté${changes.length > 1 ? 's' : ''}`});
    plan = null;
    refresh();
    toast(`${works(changes.length)} planifié${changes.length > 1 ? 's' : ''}.`, 'success', {label: 'Annuler', run: async () => { await store.upsertMany('interventions', before, {label: 'Organisation de la semaine annulée'}); refresh(); }});
  }

  // Glisser-déposer au pointeur (souris, doigt, stylet) depuis la poignée.
  function dayAt(x, y) { return doc.elementFromPoint?.(x, y)?.closest?.('[data-week-day]') || null; }
  function onDown(event) {
    const grip = event.target.closest?.('[data-week-grip]');
    if (!grip || !plan || (event.button !== undefined && event.button > 0)) return;
    const cardEl = grip.closest('[data-week-card]');
    drag = {id: grip.dataset.weekGrip, card: cardEl, x: event.clientX, y: event.clientY, moved: false, target: null, pointerId: event.pointerId};
    try { grip.setPointerCapture?.(event.pointerId); } catch { /* pointeur synthétique ou déjà relâché */ }
  }
  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    event.preventDefault();
    drag.card.classList.add('is-dragging');
    drag.card.style.transform = `translate(${dx}px, ${dy}px)`;
    // Défilement automatique de la grille près des bords (écran étroit).
    const grid = drag.card.closest('.week-grid');
    if (grid) { const r = grid.getBoundingClientRect(), edge = 36; if (event.clientX < r.left + edge) grid.scrollLeft -= 14; else if (event.clientX > r.right - edge) grid.scrollLeft += 14; }
    const target = dayAt(event.clientX, event.clientY);
    if (target !== drag.target) { drag.target?.classList.remove('is-drop'); target?.classList.add('is-drop'); drag.target = target; }
  }
  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const {id, target, moved, card: el} = drag;
    drag = null;
    el.classList.remove('is-dragging'); el.style.transform = '';
    target?.classList.remove('is-drop');
    if (moved && target && !target.classList.contains('is-past')) move(id, target.dataset.weekDay);
  }

  function onClick(event) {
    const t = event.target.closest?.('[data-week-nav],[data-week-propose],[data-week-reset],[data-week-apply],[data-week-move]');
    if (!t || !t.closest('#work-panel-sub')) return;
    if (t.dataset.weekNav) { start = shiftWeek(start, Number(t.dataset.weekNav)); plan = null; refresh(); }
    else if (t.hasAttribute('data-week-propose')) propose();
    else if (t.hasAttribute('data-week-reset')) { plan = null; refresh(); }
    else if (t.hasAttribute('data-week-apply')) apply().catch(error => toast(error.message || 'Écriture impossible.', 'error'));
    else if (t.dataset.weekMove && plan) {
      const item = plan.placed.find(p => p.work.id === t.dataset.id);
      if (!item) return;
      let next = moveDate(plan.week, item.date, Number(t.dataset.weekMove));
      if (plan.week.find(d => d.date === next)?.past) next = item.date;
      move(item.work.id, next);
      doc.querySelector(`[data-week-move="${t.dataset.weekMove}"][data-id="${CSS.escape(item.work.id)}"]`)?.focus({preventScroll: true});
    }
  }

  if (doc?.addEventListener) {
    doc.addEventListener('click', onClick);
    doc.addEventListener('pointerdown', onDown);
    doc.addEventListener('pointermove', onMove, {passive: false});
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  }

  return {view, propose, apply, move, plan: () => plan, setStart: value => { start = weekStart(new Date(value)); plan = null; }};
}
