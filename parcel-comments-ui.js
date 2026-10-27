// n° 129 — Fil de commentaires et préconisations d'une parcelle (module différé, clé « parcelComments »,
// boutons [data-pc] de LAZY_TRIGGERS). Section de la fiche parcelle (Résumé), formulaire, « Transformer en tâche »
// pour la gestion, et liste des nouvelles préconisations ouverte depuis les notifications.
import {escapeHtml as e, localDateTime, uid} from './utils.js';
import {
  COMMENT_KINDS, COMMENT_MAX_LENGTH, authorLabel, authorRoleLabel, buildComment, canComment, canConvertToTask,
  canDeleteComment, canEditComment, commentsForParcel, dueDateHint, markCommentsSeen, taskFromComment
} from './parcel-comments.js';
import {newParcelComments} from './home-priorities.js';

export function createParcelCommentsUI({store, sync, modal, closeModal, toast, bindChipChoices = () => {}, openParcel = () => {}, openTask = () => {}, today, doc = globalThis.document}) {
  const $ = s => doc.querySelector(s);
  const data = () => store.state;
  const me = () => ({uid: sync?.user?.uid || '', role: sync?.role || 'owner', name: sync?.user?.displayName || '', email: sync?.user?.email || ''});
  const live = key => (data()[key] || []).filter(x => !x.deletedAt);
  const parcelName = id => live('parcelles').find(p => p.id === id)?.nom || 'Parcelle';
  const fail = err => { const box = $('#pc-error'); if (box) { box.textContent = err.message; box.hidden = false; } else toast(err.message, 'error'); };

  function itemHtml(c, who) {
    const work = c.workId ? live('interventions').find(w => w.id === c.workId) : null;
    const task = c.taskId ? store.get('tasks', c.taskId) : null;
    const actions = [
      canEditComment(who, c) ? `<button type="button" class="text-button" data-pc="edit" data-id="${e(c.id)}">Modifier</button>` : '',
      canDeleteComment(who, c) ? `<button type="button" class="text-button" data-pc="delete" data-id="${e(c.id)}">Supprimer</button>` : '',
      task ? `<button type="button" class="text-button" data-pc="open-task" data-id="${e(task.id)}">Voir la tâche</button>`
        : canConvertToTask(who.role) ? `<button type="button" class="text-button" data-pc="task" data-id="${e(c.id)}">Transformer en tâche</button>` : ''
    ].filter(Boolean).join('');
    const meta = [authorLabel(c, who), authorRoleLabel(c), localDateTime(c.createdAt), c.editedAt ? 'modifié' : ''].filter(Boolean).join(' · ');
    return `<li class="pc-item"><div class="pc-head"><span class="badge${c.kind === 'preco' ? ' info' : ''}">${e(COMMENT_KINDS[c.kind] || 'Commentaire')}</span><small>${e(meta)}</small></div>
      <p class="pc-text">${e(c.text).replace(/\n/g, '<br>')}</p>${work ? `<small>Travail lié : ${e(work.type || 'Travail')}</small>` : ''}${actions ? `<div class="pc-actions">${actions}</div>` : ''}</li>`;
  }

  /** Section de la fiche parcelle (onglet Résumé). */
  function parcelHtml(p) {
    if (!p) return '';
    const who = me(), list = commentsForParcel(data(), p.id);
    // Ouvrir la fiche vaut lecture : les commentaires de cette parcelle ne sont plus signalés comme nouveaux.
    const unread = newParcelComments(data(), {uid: who.uid}).comments.filter(c => c.parcelId === p.id).map(c => c.id);
    if (unread.length) queueMicrotask(() => markSeen(unread));
    return `<section class="panel pc-panel" id="parcel-comments"><div class="panel-heading"><h2>Commentaires et préconisations</h2>${canComment(who.role) ? `<button type="button" class="text-button" data-pc="new" data-id="${e(p.id)}">Commenter</button>` : ''}</div>
      ${list.length ? `<ul class="pc-list">${list.slice(0, 20).map(c => itemHtml(c, who)).join('')}</ul>${list.length > 20 ? `<small>${list.length - 20} commentaire(s) plus ancien(s) non affiché(s).</small>` : ''}` : '<div class="empty-state">Aucun commentaire. Le conseiller ou l’équipe peut laisser ici une préconisation.</div>'}</section>`;
  }

  function markSeen(commentIds) {
    const prefs = data().preferences || {};
    return store.setPreferences({parcelCommentsSeen: markCommentsSeen(prefs.parcelCommentsSeen, commentIds)}).catch(() => {});
  }

  function openForm(parcelId, comment = null) {
    const who = me();
    if (!canComment(who.role)) { toast('Votre rôle ne permet pas de commenter.', 'info'); return; }
    const kind = comment?.kind || (who.role === 'advisor' ? 'preco' : 'comment');
    const works = live('interventions').filter(w => w.parcelId === parcelId).slice(-30).reverse();
    const chips = `<div class="chip-choices" data-chip-target="kind">${Object.entries(COMMENT_KINDS).map(([v, t]) => `<button type="button" class="choice-chip${v === kind ? ' is-on' : ''}" aria-pressed="${v === kind}" data-value="${e(v)}">${e(t)}</button>`).join('')}</div><input type="hidden" name="kind" value="${e(kind)}">`;
    modal(comment ? 'Modifier le commentaire' : 'Commenter la parcelle', parcelName(parcelId), `<form id="pc-form" class="form-grid">
      <div class="span-2">${chips}</div>
      <label class="span-2">Texte *<textarea name="text" rows="4" maxlength="${COMMENT_MAX_LENGTH}" required data-autofocus placeholder="Préco : fongicide T2 la semaine prochaine">${e(comment?.text || '')}</textarea></label>
      ${works.length ? `<label class="span-2">Travail lié<select name="workId"><option value="">Aucun</option>${works.map(w => `<option value="${e(w.id)}" ${comment?.workId === w.id ? 'selected' : ''}>${e(w.type || 'Travail')} · ${e(w.plannedDate || w.date || '')}</option>`).join('')}</select></label>` : ''}
      <p class="form-error span-2" id="pc-error" role="alert" hidden></p></form>`,
    `<button type="button" class="button secondary" data-action="close-modal">Annuler</button><button type="button" class="button primary" id="pc-save">Enregistrer</button>`, 'small');
    const form = $('#pc-form'); bindChipChoices(form);
    const button = $('#pc-save');
    button.onclick = async () => {
      if (button.disabled) return;
      const v = Object.fromEntries(new FormData(form));
      try {
        const record = buildComment({parcelId, text: v.text, kind: v.kind, workId: v.workId || null}, {author: who, existing: comment, id: uid('comment')});
        button.disabled = true;
        await store.upsert('parcelComments', record, {label: comment ? 'Commentaire modifié' : `Commentaire ajouté : ${parcelName(parcelId)}`});
        closeModal(); toast(comment ? 'Commentaire modifié.' : 'Commentaire ajouté.', 'success');
      } catch (err) { button.disabled = false; fail(err); }
    };
  }

  async function remove(id) {
    const c = store.get('parcelComments', id);
    if (!c || !canDeleteComment(me(), c)) return;
    await store.remove('parcelComments', id);
    toast('Commentaire placé dans la corbeille.', 'success', {label: 'Annuler', run: () => store.restore('parcelComments', id)});
  }

  // « Transformer en tâche » : tâche préremplie (titre, parcelle, échéance déduite du texte), liée au commentaire.
  async function toTask(id) {
    const c = store.get('parcelComments', id), who = me();
    if (!c || !canConvertToTask(who.role)) return;
    if (c.taskId && store.get('tasks', c.taskId)) { openTask(c.taskId); return; }
    const task = await store.upsert('tasks', taskFromComment(c, {id: uid('task'), parcelName: parcelName(c.parcelId), dueDate: dueDateHint(c.text, today())}), {label: 'Tâche créée depuis un commentaire'});
    try { await store.upsert('parcelComments', {...c, taskId: task.id}, {label: 'Commentaire relié à sa tâche'}); }
    catch (err) { toast(err.message, 'error'); }
    toast(`Tâche créée pour le ${task.dueDate.slice(8, 10)}/${task.dueDate.slice(5, 7)}.`, 'success', {label: 'Ouvrir', run: () => openTask(task.id)});
  }

  /** Nouvelles préconisations (notification « 2 nouvelles préconisations ») ; les afficher vaut lecture. */
  function openInbox() {
    const who = me(), fresh = newParcelComments(data(), {uid: who.uid});
    const list = fresh.comments.length ? fresh.comments : live('parcelComments').sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 10);
    modal('Préconisations et commentaires', fresh.count ? `${fresh.count} nouveau${fresh.count > 1 ? 'x' : ''} depuis votre dernière lecture` : 'Derniers commentaires', list.length
      ? `<div class="stack-list">${list.map(c => `<button type="button" class="list-row is-button" data-pc="parcel" data-id="${e(c.parcelId)}"><div><strong>${e(parcelName(c.parcelId))}</strong><small>${e(authorLabel(c, who))}${c.authorRole ? ` · ${e(authorRoleLabel(c))}` : ''} · ${e(localDateTime(c.createdAt))}</small><small>${e(c.text.length > 140 ? `${c.text.slice(0, 139)}…` : c.text)}</small></div><span class="badge${c.kind === 'preco' ? ' info' : ''}">${e(COMMENT_KINDS[c.kind] || 'Commentaire')}</span></button>`).join('')}</div>`
      : '<div class="empty-state">Aucun commentaire pour le moment.</div>',
    '<button type="button" class="button secondary" data-action="close-modal">Fermer</button>', 'small');
    if (fresh.count) markSeen(fresh.comments.map(c => c.id));
  }

  const handlers = {
    new: c => openForm(c.dataset.id),
    edit: c => { const x = store.get('parcelComments', c.dataset.id); if (x) openForm(x.parcelId, x); },
    delete: c => remove(c.dataset.id),
    task: c => toTask(c.dataset.id),
    'open-task': c => openTask(c.dataset.id),
    parcel: c => { closeModal(); openParcel(c.dataset.id); },
    inbox: () => openInbox()
  };
  doc?.addEventListener('click', event => {
    const control = event.target?.closest?.('[data-pc]');
    const run = control && handlers[control.dataset.pc];
    if (!run) return;
    event.preventDefault();
    if (control.dataset.pcBusy) return;
    control.dataset.pcBusy = '1';
    Promise.resolve().then(() => run(control)).catch(error => toast(error?.message || 'Action impossible.', 'error')).finally(() => { delete control.dataset.pcBusy; });
  });

  return {parcelHtml, openForm, openInbox, toTask, remove, markSeen};
}
