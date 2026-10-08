// n° 12 « Ma tournée du jour » : écran plein écran étape par étape.
// Logique pure dans field-ops.js (dayRouteActions, planDayRoute, dayRouteRecap) ; la session de tournée
// réutilise la collection existante routeSessions (champs optionnels stopKeys et doneKeys).
import {dayRouteActions, dayRouteRecap, moveRouteKey, planDayRoute, stepTitle, travelMinutes} from './field-ops.js';
import {haversineMeters, routeUrl} from './utils.js';

const KIND_LABEL = {work: 'Travail', task: 'Tâche', grazing: 'Pâturage', maintenance: 'Entretien'};
const nf = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2});
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export function createDayRouteUI(deps) {
  const {store, state, active, toast, modal, closeModal, escapeHtml: e, today, getGps, startStep, finishStep, postpone} = deps;
  let overlay = null, returnFocus = null, orderOpen = false;

  const currentSession = (data = state()) => active('routeSessions', data).filter(r => r.date === today() && !r.completedAt).sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
  function startPoint(data) {
    const gps = getGps();
    if (gps && finite(gps.latitude) && finite(gps.longitude)) return {latitude: Number(gps.latitude), longitude: Number(gps.longitude), source: 'votre position'};
    const f = data.exploitation || {};
    return finite(f.latitude) && finite(f.longitude) ? {latitude: Number(f.latitude), longitude: Number(f.longitude), source: 'l’exploitation'} : null;
  }
  function compute(data = state()) {
    const session = currentSession(data), keys = Array.isArray(session?.stopKeys) ? session.stopKeys : [];
    const actions = dayRouteActions(data, today(), {include: keys, grazingDays: Number(data.preferences?.grazingAlertDays) > 0 ? Number(data.preferences.grazingAlertDays) : 7});
    const start = startPoint(data), stops = planDayRoute(actions, start, {order: keys});
    const legacy = new Set(session && !Array.isArray(session.doneKeys) ? session.completedParcelIds || [] : []);
    const done = new Set([...(session?.doneKeys || []), ...stops.filter(s => s.done || (s.parcelId && legacy.has(s.parcelId))).map(s => s.key)]);
    const current = stops.find(s => !done.has(s.key)) || null;
    if (current && start && current.point && start.source === 'votre position') current.minutes = haversineMeters(start, current.point) < 50 ? 0 : travelMinutes(haversineMeters(start, current.point));
    return {session, stops, done, current, start};
  }
  async function save(session, stops, done, label, extra = {}) {
    const parcels = [...new Set(stops.map(s => s.parcelId).filter(Boolean))];
    const completed = parcels.filter(id => stops.filter(s => s.parcelId === id).every(s => done.has(s.key)));
    return store.upsert('routeSessions', {...(session || {date: today(), startedAt: Date.now(), completedAt: null}), kind: 'day', stopKeys: stops.map(s => s.key), doneKeys: [...done], parcelIds: parcels, completedParcelIds: completed, ...extra}, {label});
  }

  // Bouton de l’accueil : « Démarrer ma journée » ou « Reprendre ma journée · 2/5 ».
  function renderEntry(root) {
    if (!root) return;
    const {session, stops, done} = compute();
    if (!stops.length) { root.innerHTML = ''; return; }
    const count = stops.filter(s => done.has(s.key)).length;
    root.innerHTML = `<button class="day-route-entry" data-action="open-day-route"><span><strong>${session ? 'Reprendre ma journée' : 'Démarrer ma journée'}</strong><small>${session ? `${count}/${stops.length} étapes faites` : `${stops.length} ${stops.length > 1 ? 'étapes ordonnées' : 'étape'} au plus court`}</small></span><b aria-hidden="true">›</b></button>`;
  }

  async function open() {
    const data = state(), {session, stops} = compute(data);
    if (!stops.length) return modal('Ma tournée du jour', '', '<div class="empty-state">Aucune action à faire aujourd’hui : ni travail, ni tâche, ni lot à déplacer, ni entretien.</div>', '<button class="button primary" data-action="close-modal">Fermer</button>', 'small');
    if (!session) {
      try { await save(null, stops, new Set(), 'Tournée du jour démarrée.'); }
      catch (error) { return toast(error?.message || 'Impossible de démarrer la tournée.', 'error'); }
    }
    show();
  }
  function show() {
    if (!overlay) {
      returnFocus = document.activeElement;
      overlay = document.createElement('section');
      overlay.id = 'day-route'; overlay.className = 'field-mode-overlay day-route-overlay';
      overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'day-route-title');
      overlay.addEventListener('click', onClick);
      overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
      document.body.append(overlay);
      window.addEventListener('parcelles:gps', onGps);
      render();
      setTimeout(() => overlay?.querySelector('[data-dr="close"]')?.focus({preventScroll: true}), 0);
    } else render();
  }
  function close() {
    if (!overlay) return;
    window.removeEventListener('parcelles:gps', onGps);
    overlay.remove(); overlay = null;
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
    returnFocus = null;
  }
  let gpsTimer = null;
  function onGps() { clearTimeout(gpsTimer); gpsTimer = setTimeout(() => overlay && render(), 400); }

  function render() {
    if (!overlay) return;
    const {stops, done, current, start} = compute(), total = stops.length, count = stops.filter(s => done.has(s.key)).length;
    const pct = total ? Math.round(count / total * 100) : 0;
    const step = current ? `<article class="day-route-step" aria-live="polite">
        <p class="eyebrow">${e(KIND_LABEL[current.kind] || 'Étape')}</p>
        <h3 id="day-route-step-title">${e(stepTitle(current, total))}</h3>
        <p class="day-route-meta">${e([current.detail, current.point?.source, current.surfaceHa ? `${nf.format(current.surfaceHa)} ha` : ''].filter(Boolean).join(' · ') || 'Sans lieu précis')}</p>
        <div class="day-route-actions">
          <button class="button secondary" data-dr="go" ${current.point ? '' : 'disabled aria-disabled="true"'}>Y aller</button>
          <button class="button secondary" data-dr="start">Commencer</button>
          <button class="button primary" data-dr="done">${count + 1 < total ? 'Fini → Suivant' : 'Fini'}</button>
        </div>
        <button class="text-button" data-dr="later">Plus tard (mettre en fin de tournée)</button>
      </article>` : `<article class="day-route-step is-complete"><p class="eyebrow">Bravo</p><h3>Toutes les étapes sont faites.</h3><button class="button primary" data-dr="recap">Voir le récapitulatif</button></article>`;
    const list = stops.map((s, i) => `<li class="${done.has(s.key) ? 'is-done' : s === current ? 'is-current' : ''}"><span class="day-route-num" aria-hidden="true">${done.has(s.key) ? '✓' : i + 1}</span><div><strong>${e(s.label)}</strong><small>${e([s.place, s.minutes === null ? '' : s.minutes === 0 ? 'sur place' : `${s.minutes} min`].filter(Boolean).join(' · '))}${done.has(s.key) ? ' · fait' : ''}</small></div><span class="day-route-move"><button class="icon-button" data-dr="up" data-key="${e(s.key)}" ${i === 0 ? 'disabled' : ''} aria-label="Monter « ${e(s.label)} »">↑</button><button class="icon-button" data-dr="down" data-key="${e(s.key)}" ${i === total - 1 ? 'disabled' : ''} aria-label="Descendre « ${e(s.label)} »">↓</button></span></li>`).join('');
    overlay.innerHTML = `<div class="field-mode-card day-route-card">
      <div class="day-route-head"><div><p class="eyebrow">Ma tournée du jour</p><h2 id="day-route-title">${count}/${total} ${total > 1 ? 'étapes' : 'étape'}</h2><p class="lead">${start ? `Ordre au plus court depuis ${e(start.source)}` : 'Position inconnue : ordre au plus court à partir de la première étape'}</p></div><button class="icon-button" data-dr="close" aria-label="Fermer la tournée">×</button></div>
      <div class="quality-progress" role="progressbar" aria-label="Avancement de la tournée" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      ${step}
      <details class="day-route-order" ${orderOpen ? 'open' : ''}><summary>Ordre de la tournée (${total})</summary><ol class="day-route-list">${list}</ol></details>
      <div class="day-route-foot"><button class="button secondary" data-dr="locate">Recalculer depuis ma position</button><button class="button secondary" data-dr="recap">Terminer la journée</button></div>
    </div>`;
    overlay.querySelector('.day-route-order')?.addEventListener('toggle', event => { orderOpen = event.target.open; });
  }

  async function onClick(event) {
    const control = event.target.closest('[data-dr]');
    if (!control || control.disabled) return;
    const action = control.dataset.dr, data = state(), {session, stops, done, current} = compute(data);
    try {
      if (action === 'close') return close();
      if (action === 'go' && current?.point) { window.open(routeUrl(data.preferences?.routeProvider || 'apple', current.point.latitude, current.point.longitude), '_blank', 'noopener'); return; }
      if (action === 'start' && current) { close(); return startStep(current); }
      if (action === 'done' && current) {
        const result = await finishStep(current);
        done.add(current.key);
        await save(session, stops, done, `Étape terminée : ${current.label}`);
        if (result?.closeOverlay) return close();
        if (stops.every(s => done.has(s.key))) return recap();
        return render();
      }
      if (action === 'later' && current) { await save(session, [...stops.filter(s => s.key !== current.key), current], done, 'Étape repoussée en fin de tournée.'); return render(); }
      if (action === 'up' || action === 'down') {
        const keys = moveRouteKey(stops.map(s => s.key), control.dataset.key, action === 'up' ? -1 : 1), byKey = new Map(stops.map(s => [s.key, s]));
        await save(session, keys.map(k => byKey.get(k)), done, 'Ordre de la tournée modifié.');
        render(); overlay?.querySelector(`[data-dr="${action}"][data-key="${CSS.escape(control.dataset.key)}"]:not([disabled])`)?.focus({preventScroll: true});
        return;
      }
      if (action === 'locate') { deps.requestGps?.(); toast('Position demandée : l’ordre se recalcule à la réception.'); return; }
      if (action === 'recap') return recap();
    } catch (error) { toast(error?.message || 'Action impossible.', 'error'); }
  }

  // Récapitulatif du soir : heures terrain par parcelle, hectares réalisés, étapes à reporter.
  function recap() {
    const data = state(), {session, stops, done} = compute(data), r = dayRouteRecap(stops, [...done], data, today());
    close();
    const hours = r.hoursByParcel.length ? `<ul class="day-route-hours">${r.hoursByParcel.map(h => `<li><span>${e(h.name)}</span><strong>${nf.format(h.hours)} h</strong></li>`).join('')}</ul>` : '<p class="form-note">Aucune session terrain chronométrée aujourd’hui.</p>';
    const left = r.remaining.length ? `<h3>À reporter (${r.remaining.length})</h3><ul class="day-route-left">${r.remaining.map(s => `<li>${e(s.label)}${s.place ? ` · ${e(s.place)}` : ''}</li>`).join('')}</ul>` : '<p class="notice success">Rien à reporter.</p>';
    const canPostpone = r.remaining.some(s => s.kind === 'work' || s.kind === 'task');
    modal('Récapitulatif de la journée', `${r.done}/${r.total} ${r.total > 1 ? 'étapes faites' : 'étape faite'} · ${nf.format(r.hectares)} ha réalisés`,
      `<h3>Heures par parcelle</h3>${hours}${left}`,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${canPostpone ? '<button class="button secondary" id="day-route-postpone">Reporter à demain</button>' : ''}<button class="button primary" id="day-route-close-day">Clore la journée</button>`, 'small');
    document.getElementById('day-route-postpone')?.addEventListener('click', async () => {
      try { const n = await postpone(r.remaining.filter(s => s.kind === 'work' || s.kind === 'task')); toast(`${n} ${n > 1 ? 'actions reportées' : 'action reportée'} à demain.`, 'success'); document.getElementById('day-route-postpone')?.remove(); }
      catch (error) { toast(error?.message || 'Report impossible.', 'error'); }
    });
    document.getElementById('day-route-close-day')?.addEventListener('click', async () => {
      try { if (session) await store.upsert('routeSessions', {...session, completedAt: Date.now()}, {label: 'Tournée du jour terminée.'}); closeModal(); toast('Journée close. Bonne soirée !', 'success'); }
      catch (error) { toast(error?.message || 'Action impossible.', 'error'); }
    });
  }

  return {open, close, renderEntry, refresh: () => overlay && render(), isOpen: () => Boolean(overlay)};
}
