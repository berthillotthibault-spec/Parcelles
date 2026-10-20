// Actions du délégué de clics pour les travaux, les tâches, l'agenda et les filtres de l'écran Travaux
// (n° 147, sorties d'app.js sans changement de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {isPending} from './home-priorities.js';
import {armCelebration} from './celebration-ui.js';

// Statut d’avant « fait », connu pendant la session, pour qu’une réouverture le rétablisse.
const statusBeforeDone = new Map();

const work = id => ctx.store.get('interventions', id);
const task = id => ctx.store.get('tasks', id);
const restore = (type, entity) => () => ctx.store.upsert(type, entity, {label: 'Statut restauré'});
// Fête la fin (n° 22) et prépare le glissement vers la prochaine action (n° 104).
function armDone(control, id, kind) {
  armCelebration(control, {id, kind, preferences: ctx.state().preferences, native: ctx.nativeBridge});
  ctx.nextAction().armFlip(control, id);
}

export const workActions = {
  // Travaux : saisie, reprise, duplication
  'new-work'({id, control}) { ctx.closeModal(); ctx.closeFieldMode(); ctx.openWorkForm(null, control.dataset.parcelId || id || null); },
  'quick-work'({control}) {
    const fieldParcel = ctx.fieldModeOpen ? (ctx.activeFieldSession()?.parcelId || ctx.$('#field-parcel-choice')?.value || null) : null;
    ctx.closeModal(); ctx.closeFieldMode();
    ctx.quickEntryUI?.open({parcelId: fieldParcel || control.dataset.parcelId || null});
  },
  'batch-work'() { ctx.closeModal(); ctx.openBatchWorkForm(); },
  'map-multiple-work'() { const ids = [...ctx.parcelMap.selectedIds]; if (ids.length) ctx.openBatchWorkForm(ids); },
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
    armDone(control, id, 'work');
    statusBeforeDone.set(`work:${id}`, w.status);
    const doneWork = await ctx.store.upsert('interventions', {...w, status: 'Terminé', plannedDate: w.plannedDate || w.date || '', date: ctx.todayIso()},
      {label: `Travail terminé : ${w.type}`});
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
    armDone(control, id, 'task');
    statusBeforeDone.set(`task:${id}`, t.status);
    await ctx.store.upsert('tasks', {...t, status: 'Terminé'}, {label: `Tâche terminée : ${t.title}`});
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
