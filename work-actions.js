// Actions du délégué de clics pour les travaux, les tâches, l'agenda et les filtres de l'écran Travaux
// (n° 147, sorties d'app.js sans changement de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {isPending} from './home-priorities.js';
import {armCelebration} from './celebration-ui.js';

// Statut d’avant « fait », connu pendant la session, pour qu’une réouverture le rétablisse.
const statusBeforeDone = new Map();
// Fin en cours (double appui : le second clic arrive avant que la fiche soit marquée terminée).
const finishing = new Set();

const work = id => ctx.store.get('interventions', id);
const task = id => ctx.store.get('tasks', id);
// Ne restaure pas une fiche placée entre-temps dans la corbeille (le snapshot n'a pas de deletedAt).
const restore = (type, entity) => () => {
  if (!ctx.store.get(type, entity.id)) { ctx.toast('Élément supprimé entre-temps : rien à annuler.', 'error'); return; }
  return ctx.store.upsert(type, entity, {label: 'Statut restauré'});
};
// Fête la fin (n° 22) et prépare le glissement vers la prochaine action (n° 104).
function armDone(control, id, kind) {
  armCelebration(control, {id, kind, preferences: ctx.state().preferences, native: ctx.nativeBridge});
  ctx.nextAction().armFlip(control, id);
}

export const workActions = {
  // Travaux : saisie, reprise, duplication
  // n° 160 : création par la saisie en 3 étapes (le formulaire complet reste joignable depuis elle et pour l'édition).
  'new-work'({id, control}) {
    ctx.closeModal(); ctx.closeFieldMode();
    const pid = control.dataset.parcelId || id;
    ctx.openQuickWork({parcelIds: pid ? [pid] : []});
  },
  'quick-work'({control}) {
    const fieldParcel = ctx.fieldModeOpen ? (ctx.activeFieldSession()?.parcelId || ctx.$('#field-parcel-choice')?.value || null) : null;
    ctx.closeModal(); ctx.closeFieldMode();
    const pid = fieldParcel || control.dataset.parcelId;
    ctx.openQuickWork({parcelIds: pid ? [pid] : []});
  },
  'batch-work'() { ctx.closeModal(); ctx.openBatchWorkForm(); },
  'map-multiple-work'() { const ids = [...ctx.parcelMap.selectedIds]; if (ids.length) ctx.openQuickWork({parcelIds: ids}); },
  'edit-work'({id}) { ctx.closeModal(); ctx.openWorkForm(work(id)); },
  'duplicate-work'({id}) { ctx.closeModal(); ctx.openWorkForm(work(id), null, {duplicate: true}); },
  'review-finished-work'({id}) { const w = work(id); if (w) ctx.openWorkForm({...w, status: 'Terminé', date: ctx.todayIso()}); },
  'start-planned-work'({id}) {
    const w = work(id);
    if (w && isPending(w)) { ctx.closeFieldMode(); ctx.closeModal(); ctx.openWorkForm({...w, status: 'En cours'}); }
  },
  'work-actions'({id}) { ctx.openWorkActions(id); },
  async 'postpone-work'({id}) { ctx.closeModal(); await ctx.workSwipe().postpone(id); },
  'open-team-work'() { ctx.closeModal(); ctx.teamWorkUI?.open(); },
  // Terminer et rouvrir : la date d'échéance reste dans plannedDate (finish-work).
  async 'finish-work'({id, control}) {
    const w = work(id);
    if (!w || !isPending(w) || finishing.has(`work:${id}`)) return; // double appui : déjà terminé ou en cours
    finishing.add(`work:${id}`);
    let doneWork;
    try {
      armDone(control, id, 'work');
      statusBeforeDone.set(`work:${id}`, w.status);
      doneWork = await ctx.store.upsert('interventions', {...w, status: 'Terminé', plannedDate: w.plannedDate || w.date || '', date: ctx.todayIso()},
        {label: `Travail terminé : ${w.type}`});
    } finally { finishing.delete(`work:${id}`); }
    ctx.toast('Travail marqué terminé.', 'success', {label: 'Annuler', run: restore('interventions', w)});
    ctx.lazy.need('habits', {silent: true}).then(ok => ok && ctx.habitsUI.afterFinish(doneWork));
  },
  async 'reopen-work'({id}) {
    const w = work(id);
    if (!w) return;
    const previous = statusBeforeDone.get(`work:${id}`);
    statusBeforeDone.delete(`work:${id}`);
    await ctx.store.upsert('interventions', {...w, status: previous && isPending({status: previous}) ? previous : 'À faire', date: w.plannedDate || w.date},
      {label: `Travail rouvert : ${w.type}`});
    ctx.toast('Travail rouvert.', 'success', {label: 'Annuler', run: restore('interventions', w)});
  },
  'add-photo'({id}) { ctx.closeModal(); ctx.photoGeo().open(id); },
  'attach-file'({id}) { ctx.closeModal(); ctx.openAttachmentForm(id); },
  // Tâches
  'open-tasks'() { ctx.openTasks(); },
  'new-task'() { ctx.closeModal(); ctx.openTaskForm(); },
  'edit-task'({id}) { ctx.closeModal(); ctx.openTaskForm(task(id)); },
  'map-multiple-task'() { const ids = [...ctx.parcelMap.selectedIds]; if (ids.length) ctx.openTaskForm(null, {parcelIds: ids}); },
  async 'finish-task'({id, control}) {
    const t = task(id);
    if (!t || !isPending(t, 'task') || finishing.has(`task:${id}`)) return; // double appui : déjà terminée ou en cours
    finishing.add(`task:${id}`);
    try {
      armDone(control, id, 'task');
      statusBeforeDone.set(`task:${id}`, t.status);
      await ctx.store.upsert('tasks', {...t, status: 'Terminé'}, {label: `Tâche terminée : ${t.title}`});
    } finally { finishing.delete(`task:${id}`); }
    if (ctx.$('#modal-root').classList.contains('has-modal')) ctx.openTasks(); else ctx.renderToday(ctx.state());
    ctx.toast('Tâche terminée.', 'success', {label: 'Annuler', run: restore('tasks', t)});
  },
  async 'reopen-task'({id}) {
    const t = task(id);
    if (!t) return;
    const previous = statusBeforeDone.get(`task:${id}`);
    statusBeforeDone.delete(`task:${id}`);
    await ctx.store.upsert('tasks', {...t, status: previous && isPending({status: previous}, 'task') ? previous : 'À faire'},
      {label: `Tâche rouverte : ${t.title}`});
    ctx.toast('Tâche rouverte.', 'success', {label: 'Annuler', run: restore('tasks', t)});
  },
  // Agenda
  'open-calendar'() { ctx.openCalendar(); },
  'calendar-day-overview'() { ctx.openCalendar(new Date(), 'week'); },
  'calendar-mode'({control}) { ctx.workSubviews().setCalendar({mode: control.dataset.mode || 'month'}); },
  'calendar-today'() { ctx.workSubviews().setCalendar({date: new Date()}); },
  'calendar-day'({control}) { ctx.workSubviews().selectDay(control.dataset.date); },
  // Filtres de l'écran Travaux
  'work-filters'() { ctx.openWorkFilters(); },
  'clear-work-filter'({control}) { ctx.workFilters = {...ctx.workFilters, [control.dataset.filter]: ''}; ctx.renderWork(ctx.state()); },
  'clear-work-filters'() {
    ctx.workFilters = {parcel: '', type: ''};
    if (ctx.$('#work-search')) ctx.$('#work-search').value = '';
    ctx.renderWork(ctx.state());
  }
};
