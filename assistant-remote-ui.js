// n° 104 : assistant distant, côté interface. Module différé (lazy-modules.js : assistantRemote).
// - Fiches de confirmation des actions d'écriture (observation, mouvement de stock, sortie de lot,
//   travaux planifiés) : elles montrent exactement ce qui sera écrit, puis écrivent avec « Annuler ».
// - Aperçu « Ce que j'envoie » : le JSON exact de la requête, affiché dans le fil avant le premier
//   envoi (préférence remoteAiContextReviewed) et ensuite sur demande.
// La logique est dans assistant-actions.js (brouillons, permissions) et remote-ai.js (corps, alias).
import {buildActionDraft, NEW_WRITE_ACTIONS} from './assistant-actions.js';
import {buildRemoteRequest} from './remote-ai.js';
import {endGrazingSession} from './grazing-records.js';
import {escapeHtml as e} from './utils.js';

export {NEW_WRITE_ACTIONS};

export function draftRowsHtml(draft) {
  return `<table class="econ-table assistant-diff"><thead><tr><th scope="col">Champ</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead><tbody>${draft.rows.map(r => `<tr><th scope="row">${e(r.label)}</th><td>${r.before ? e(r.before) : '<span class="muted">—</span>'}</td><td><strong>${e(r.after)}</strong></td></tr>`).join('')}</tbody></table>`;
}

export function requestJson(request) { return JSON.stringify(request.body, null, 2); }

export function createAssistantRemoteUI({store, state, modal, closeModal, toast, role = () => 'owner', today, saveMessage = async () => {}} = {}) {
  async function write(action, draft) {
    if (action.type === 'create_observation') {
      const saved = await store.upsert('observations', {...draft.writes[0].after, observedAt: new Date().toISOString()}, {label: `Observation : ${draft.writes[0].after.title}`});
      return () => store.remove('observations', saved.id);
    }
    if (action.type === 'stock_movement') {
      const m = draft.movement, item = draft.writes[1].before;
      await store.recordStockMovement(m);
      const back = m.type === 'Entrée' ? {type: 'Sortie', quantity: m.quantity} : m.type === 'Sortie' ? {type: 'Entrée', quantity: m.quantity} : {type: 'Ajustement', quantity: Number(item.quantity) || 0};
      return () => store.recordStockMovement({stockItemId: m.stockItemId, ...back, date: m.date, note: 'Annulation d’un mouvement proposé par l’assistant'});
    }
    if (action.type === 'grazing_exit') {
      const id = draft.session.id, previous = draft.session.endDate ?? null;
      await endGrazingSession(store, id, {date: draft.date});
      return () => store.upsert('grazingSessions', {id, endDate: previous}, {label: 'Sortie du pré annulée.'});
    }
    if (action.type === 'plan_works') {
      const saved = [];
      for (const w of draft.writes) saved.push(await store.upsert('interventions', w.after, {label: `Travail planifié : ${w.after.type}`}));
      return async () => { for (const w of saved) await store.remove('interventions', w.id); };
    }
    throw new Error('Action non prise en charge.');
  }

  // Fiche de confirmation : rien n'est écrit avant « Confirmer ».
  function confirm(action) {
    const draft = buildActionDraft(action, state(), {role: role(), today: today()});
    if (!draft.ok) { toast(draft.error, 'error'); return false; }
    modal('Confirmer l’action', 'L’assistant ne modifie jamais vos données sans confirmation. Voici exactement ce qui sera écrit.',
      `<p><strong>${e(draft.title)}</strong></p>${draftRowsHtml(draft)}<p class="form-error" id="assistant-write-error" role="alert" hidden></p>`,
      `<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="assistant-confirm-write">Confirmer</button>`, 'small');
    const button = document.getElementById('assistant-confirm-write');
    button.onclick = async () => {
      button.disabled = true;
      try {
        const undo = await write(action, draft);
        await saveMessage(`${draft.title} : enregistré avec confirmation.`);
        closeModal();
        toast(`${draft.title} : enregistré.`, 'success', {label: 'Annuler', run: undo});
      } catch (error) {
        button.disabled = false;
        const box = document.getElementById('assistant-write-error');
        if (box) { box.textContent = error?.message || 'Enregistrement impossible.'; box.hidden = false; }
      }
    };
    return true;
  }

  // Aperçu dans le fil de l'assistant. Avec onSend, propose « Envoyer » / « Ne pas envoyer ».
  function preview(thread, {question, context, anonymize}, {ask = false} = {}) {
    if (!thread) return Promise.resolve(false);
    const request = buildRemoteRequest({question, state: state(), context, stream: true, anonymize});
    const box = thread.ownerDocument.createElement('div');
    box.className = 'assistant-answer is-query assistant-sent-preview';
    const size = new Blob([JSON.stringify(request.body)]).size;
    box.innerHTML = `<strong>Ce que j’envoie</strong><p>${ask ? 'Avant le premier envoi, voici le contenu exact transmis au service' : 'Contenu exact transmis au service'} (${Math.ceil(size / 1024)} Ko${anonymize ? ', noms remplacés par des alias' : ''}). Rien d’autre ne part.</p><details${ask ? ' open' : ''}><summary>Voir le JSON</summary><pre class="assistant-json" tabindex="0"></pre></details>${ask ? '<div class="assistant-actions"><button type="button" class="small-button" data-preview="cancel">Ne pas envoyer</button><button type="button" class="small-button primary" data-preview="send">Envoyer</button></div>' : ''}`;
    box.querySelector('pre').textContent = requestJson(request);
    thread.append(box); thread.scrollTop = thread.scrollHeight;
    if (!ask) return Promise.resolve(true);
    return new Promise(resolve => {
      box.querySelectorAll('[data-preview]').forEach(b => b.onclick = async () => {
        const ok = b.dataset.preview === 'send';
        box.querySelector('.assistant-actions')?.remove();
        if (ok) { try { await store.setPreferences({remoteAiContextReviewed: true}); } catch {} }
        resolve(ok);
      });
    });
  }

  // Avant un envoi : aperçu obligatoire tant que la personne ne l'a pas validé une première fois.
  function beforeSend(thread, input) {
    if (state().preferences?.remoteAiContextReviewed) return Promise.resolve(true);
    return preview(thread, input, {ask: true});
  }

  return {confirm, preview, beforeSend, handles: type => NEW_WRITE_ACTIONS.includes(type)};
}
