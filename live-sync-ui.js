// Collaboration en temps réel visible (n° 136) : toast, liseré bref sur la ligne modifiée, « Modifié par … ».
import {createLiveSyncController, summarizeChanges, recordAuthors, modifiedByLabel} from './live-sync.js';

export function createLiveSyncUI({store, sync, toast, parcelName = () => '', isReadOnly = () => false, doc = document, win = window} = {}) {
  let members = [];
  const workspaceId = () => sync?.workspaceId || '';
  // Le pull complet et le temps réel alimentent la même mémoire « qui a modifié quoi ».
  if (sync) sync.onRemoteChanges = changes => recordAuthors(changes, {workspaceId: workspaceId()});
  const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  function flash(changes) {
    // Après le rendu de la vue visible (render-scheduler) : un liseré de 1,6 s sur chaque ligne concernée.
    win.setTimeout(() => {
      for (const c of changes) {
        for (const el of doc.querySelectorAll(`[data-id="${CSS.escape(String(c.entityId))}"]`)) {
          const row = el.closest('li, tr, article, .list-row, .work-row, .parcel-row, .card') || el;
          row.classList.remove('live-flash'); void row.offsetWidth; row.classList.add('live-flash');
          win.setTimeout(() => row.classList.remove('live-flash'), reduced() ? 2400 : 1600);
        }
      }
    }, 150);
  }

  async function onChanges(changes) {
    const message = summarizeChanges(changes, {members, selfUid: sync?.user?.uid || '', deviceId: sync?.deviceId || '', lookup: {parcelName}});
    if (message) toast(message);
    flash(changes);
  }

  const controller = createLiveSyncController({sync, doc, win, isReadOnly, onChanges, onError: error => console.warn('[Parcelles] temps réel', error)});
  async function refresh() {
    if (controller.refresh() && !members.length) members = await sync.listMembers?.().catch(() => []) || [];
    return controller.active;
  }
  return {
    refresh,
    stop: () => controller.stop(),
    get active() { return controller.active; },
    modifiedBy: (type, id) => modifiedByLabel(type, id, {workspaceId: workspaceId(), members})
  };
}
