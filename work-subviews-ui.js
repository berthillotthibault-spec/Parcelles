// n° 36 — Calendrier, Tâches et Chantiers intégrés à l’écran Travaux (contrôle segmenté).
// Les rendus restent ceux d’app.js (calendarView, tasksView, chantiersView) : ce module les place
// dans #work-panel-sub au lieu d’une feuille modale et garde l’état du calendrier (date, mode, jour).
import {WORK_SUBVIEWS, WORK_SUBVIEW_LABELS, normalizeSubview, normalizeCalendarMode, workSubviewHash, nextTabIndex} from './work-subviews.js';

export function createWorkSubviewsUI({doc = globalThis.document, views = {}, dayDetail = () => {}, navigate = () => {}} = {}) {
  let current = 'list';
  const calendar = {date: new Date(), mode: 'month', day: ''};
  let bound = false, focusTab = '', focusTimer = 0;
  const $ = selector => doc?.querySelector(selector);
  const tabs = () => [...(doc?.querySelectorAll('#work-subviews [role="tab"]') || [])];

  function bind() {
    const list = $('#work-subviews');
    if (bound || !list) return;
    bound = true;
    list.addEventListener('click', event => {
      const tab = event.target.closest('[role="tab"][data-tab]');
      if (!tab) return;
      // Le changement de route replace le focus sur #main : on le rend à l’onglet ensuite.
      if (list.contains(doc.activeElement)) focusTab = normalizeSubview(tab.dataset.tab);
      navigate(normalizeSubview(tab.dataset.tab));
    });
    // Flèches gauche/droite : gestionnaire commun d’app.js ; Début/Fin ici.
    list.addEventListener('keydown', event => {
      if (event.key !== 'Home' && event.key !== 'End') return;
      const all = tabs(), index = nextTabIndex(all.indexOf(event.target), event.key, all.length);
      if (index < 0) return;
      event.preventDefault();
      all[index].focus();
      all[index].click();
    });
  }

  function syncTabs() {
    for (const tab of tabs()) {
      const on = tab.dataset.tab === current;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    const listPanel = $('#work-panel-list'), sub = $('#work-panel-sub');
    if (listPanel) listPanel.hidden = current !== 'list';
    if (sub) {
      sub.hidden = current === 'list';
      sub.dataset.subview = current;
      if (current !== 'list') sub.setAttribute('aria-labelledby', `work-subview-tab-${current}`);
    }
  }

  // Focus conservé après un nouveau rendu (ex. « Terminer » une tâche) quand c’est possible.
  function focusKey(root) {
    const el = doc.activeElement;
    if (!el || !root.contains(el)) return null;
    return {action: el.dataset?.action || '', id: el.dataset?.id || '', mode: el.dataset?.mode || '', elId: el.id || ''};
  }
  function restoreFocus(root, key) {
    if (!key) return;
    const target = (key.elId && root.querySelector(`#${CSS.escape(key.elId)}`))
      || (key.action && root.querySelector(`[data-action="${CSS.escape(key.action)}"]${key.id ? `[data-id="${CSS.escape(key.id)}"]` : ''}${key.mode ? `[data-mode="${CSS.escape(key.mode)}"]` : ''}`));
    (target || root).focus?.({preventScroll: true});
  }

  function render() {
    const root = $('#work-panel-sub');
    if (!root || current === 'list') return;
    const view = views[current];
    if (typeof view !== 'function') return;
    const key = focusKey(root);
    const out = view({...calendar}) || {};
    root.innerHTML = `<div class="work-subview-head"><h2 class="sr-only">${WORK_SUBVIEW_LABELS[current]}</h2>${out.description ? `<p class="work-subview-lead">${out.description}</p>` : ''}${out.actions ? `<div class="work-subview-actions">${out.actions}</div>` : ''}</div><div class="work-subview-body work-subview-${current}">${out.body || ''}</div>`;
    if (current === 'calendar') {
      const modes = root.querySelector('.calendar-modes');
      if (modes) {
        modes.setAttribute('role', 'tablist');
        modes.setAttribute('aria-label', 'Affichage du calendrier');
        modes.querySelectorAll(':scope>button').forEach(button => {
          const on = button.classList.contains('is-active');
          button.setAttribute('role', 'tab');
          button.setAttribute('aria-selected', String(on));
        });
      }
      const prev = root.querySelector('#calendar-prev'), next = root.querySelector('#calendar-next');
      if (prev && out.prev) prev.onclick = () => setCalendar({date: out.prev});
      if (next && out.next) next.onclick = () => setCalendar({date: out.next});
      if (calendar.mode === 'month' && calendar.day) selectDay(calendar.day, {focus: false});
    }
    restoreFocus(root, key);
  }

  function show(sub = 'list', opts = {}) {
    bind();
    current = normalizeSubview(sub);
    if (current === 'calendar') configureCalendar(opts);
    syncTabs();
    render();
    // hashchange et popstate rappellent tous deux la route : le focus est rendu à l’onglet à chaque fois.
    if (focusTab) {
      if (focusTab === current) doc.getElementById(`work-subview-tab-${current}`)?.focus({preventScroll: true});
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {focusTab = '';}, 200);
    }
  }

  function configureCalendar({date, mode} = {}) {
    if (date !== undefined) {
      const d = new Date(date);
      if (!Number.isNaN(d.getTime())) {calendar.date = d; calendar.day = '';}
    }
    if (mode !== undefined) calendar.mode = normalizeCalendarMode(mode);
  }

  function setCalendar(opts = {}) {
    configureCalendar(opts);
    if (current === 'calendar') render();
  }

  function selectDay(date, {focus = true} = {}) {
    calendar.day = String(date || '');
    const root = $('#work-panel-sub');
    root?.querySelectorAll('.calendar-day[data-date]').forEach(button => {
      const on = button.dataset.date === calendar.day;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', String(on));
    });
    dayDetail(calendar.day);
    if (focus) root?.querySelector('#calendar-day-detail')?.scrollIntoView?.({block: 'nearest'});
  }

  return {
    show,
    // Prépare la sous-vue avant une navigation (#work/calendar…) ; show() l’affichera.
    configure(sub, opts = {}) {if (normalizeSubview(sub) === 'calendar') configureCalendar(opts);},
    refresh() {if (current !== 'list' && !$('#work-panel-sub')?.hidden) render();},
    setCalendar,
    selectDay,
    current: () => current,
    hash: () => workSubviewHash(current),
    subviews: WORK_SUBVIEWS
  };
}
