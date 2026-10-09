// n° 36 — Calendrier, Tâches et Chantiers en sous-vues de Travaux : logique pure (routes).
// #work = liste des travaux ; #work/week (n° 107), #work/calendar, #work/tasks, #work/chantiers = sous-vues intégrées.
export const WORK_SUBVIEWS = ['list', 'week', 'calendar', 'tasks', 'chantiers'];
export const WORK_SUBVIEW_LABELS = {list: 'Liste', week: 'Semaine', calendar: 'Calendrier', tasks: 'Tâches', chantiers: 'Chantiers'};
export const CALENDAR_MODES = ['month', 'week', 'list'];

export const normalizeSubview = value => (WORK_SUBVIEWS.includes(value) ? value : 'list');

// Route (sans « # ») → sous-vue, ou null si la route n’est pas celle de Travaux.
export function parseWorkRoute(route) {
  const [view, sub = ''] = String(route ?? '').replace(/^#/, '').split('/');
  if (view !== 'work') return null;
  return normalizeSubview(sub || 'list');
}

export const workSubviewHash = sub => (normalizeSubview(sub) === 'list' ? '#work' : `#work/${normalizeSubview(sub)}`);

export const normalizeCalendarMode = mode => (CALENDAR_MODES.includes(mode) ? mode : 'month');

// Onglet suivant au clavier (flèches, Début, Fin), en boucle.
export function nextTabIndex(index, key, count) {
  if (!count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  return index;
}
