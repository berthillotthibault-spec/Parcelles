// Historique des fiches et « Annuler » (n° 130) : toast « Enregistré — Annuler », Ctrl/Cmd+Z et frise « Historique ».
// Toute annulation repasse par store.upsert / store.remove : elle est donc synchronisée, soumise aux rôles,
// refusée en lecture seule (autre fenêtre, données d’une version plus récente) et elle-même historisée.
import {describeEntry,formatHistoryDate,historyAuthor,historyKey,revertEntity} from './history.js';
import {escapeHtml} from './utils.js';

// Modifications d’un même enregistrement : écrites à quelques millisecondes d’intervalle.
const BURST_MS=3000;
const UNDO_WINDOW_MS=30*60*1000;

export function createHistoryUI({store,state,toast}){
  let consumedSeq=0;
  const usable=change=>change&&!change.undone&&change.action!=='revert'&&change.workspaceId===store.workspaceId;
  // Dernière rafale de modifications (un enregistrement de formulaire), plus récente que le dernier toast.
  function lastBurst({after=0,maxAgeMs=UNDO_WINDOW_MS}={}){
    const changes=(store.recentChanges||[]).filter(c=>usable(c)&&c.seq>after&&Date.now()-c.at<=maxAgeMs);
    if(!changes.length)return[];
    const last=changes[changes.length-1];
    return changes.filter(c=>last.at-c.at<=BURST_MS);
  }

  async function revertChange(change){
    const current=store.get(change.type,change.entityId,{includeDeleted:true});
    const before=change.before;
    if(!before||before.deletedAt){if(current&&!current.deletedAt)await store.remove(change.type,change.entityId);return;}
    await store.upsert(change.type,revertEntity(current,before),{label:'Modification annulée',historyAction:'revert'});
  }

  async function undoChanges(changes){
    const pending=changes.filter(c=>!c.undone);if(!pending.length){toast('Cette modification a déjà été annulée.');return false;}
    const mark=store.historySeq,created=pending.every(c=>!c.before);
    try{
      for(const change of [...pending].reverse()){await revertChange(change);change.undone=true;}
      toast(created?'Enregistrement annulé : la fiche est dans la corbeille.':'Modification annulée.');
      return true;
    }catch(error){toast(error?.message||'Annulation impossible.','error');return false;}
    finally{
      // Les écritures faites pour annuler ne sont pas elles-mêmes proposées à Ctrl+Z.
      for(const change of store.recentChanges||[])if(change.seq>mark)change.undone=true;
    }
  }

  // Toast « Enregistré — Annuler » après un enregistrement de formulaire. `extra` : seconde action (ex. « Ouvrir »).
  function savedToast(message,extra=null){
    const changes=lastBurst({after:consumedSeq,maxAgeMs:15000});
    if(changes.length)consumedSeq=changes[changes.length-1].seq;
    const actions=[];
    if(changes.length)actions.push({label:'Annuler',run:()=>undoChanges(changes)});
    if(extra)actions.push(extra);
    toast(message,'success',actions.length?actions:null);
  }

  function undoLast(){
    const changes=lastBurst();
    if(!changes.length){toast('Aucune modification récente à annuler.');return Promise.resolve(false);}
    consumedSeq=Math.max(consumedSeq,changes[changes.length-1].seq);
    return undoChanges(changes);
  }

  function installShortcut(target=document){
    target.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey)||String(event.key).toLowerCase()!=='z')return;
      const el=event.target;
      // Dans un champ, Ctrl+Z reste l’annulation de frappe du navigateur ; une fenêtre ouverte garde la main.
      if(el?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]'))return;
      if(document.querySelector('#modal-root.has-modal'))return;
      event.preventDefault();undoLast();
    });
  }

  async function loadRows(type,id){
    try{return await store.storage.historyList?.(historyKey(store.workspaceId,type,id))||[];}
    catch(error){console.warn('[Parcelles] historique illisible.',error);return[];}
  }

  function rowsHtml(rows,entity){
    const members=state().members||[];
    if(!rows.length)return '<p class="history-empty">Aucune modification conservée pour cette fiche. Les prochaines apparaîtront ici (90 jours, 50 versions au plus, sur cet appareil).</p>';
    return `<ol class="history-timeline">${rows.map((row,index)=>{
      const target=index>0?rows[index-1]:null,canRevert=Boolean(target?.before);
      return `<li class="history-item"><div class="history-text"><strong>${escapeHtml(formatHistoryDate(row.at))} · ${escapeHtml(historyAuthor(row.by,members))}</strong><span>${escapeHtml(describeEntry(row,entity))}</span></div>${index===0?'<em class="history-current">Version actuelle</em>':canRevert?`<button type="button" class="button secondary history-revert" data-history-index="${index}" aria-label="Revenir à la version du ${escapeHtml(formatHistoryDate(row.at))}">Revenir à cette version</button>`:''}</li>`;}).join('')}</ol>`;
  }

  // Frise dans un conteneur existant ; « Revenir à cette version » rétablit l’état juste après la ligne choisie.
  async function mount(container,type,id){
    if(!container)return;
    container.innerHTML='<p class="history-empty">Chargement de l’historique…</p>';
    const rows=await loadRows(type,id);
    if(!container.isConnected)return;
    const entity=store.get(type,id,{includeDeleted:true});
    container.innerHTML=`<p class="history-note">Modifications conservées sur cet appareil (90 jours). Revenir à une version l’enregistre comme une nouvelle modification, synchronisée.</p>${rowsHtml(rows,entity)}`;
    container.querySelectorAll('[data-history-index]').forEach(button=>button.addEventListener('click',async()=>{
      const index=Number(button.dataset.historyIndex),row=rows[index],target=rows[index-1];
      const current=store.get(type,id,{includeDeleted:true});if(!target?.before||!current)return;
      button.disabled=true;
      try{
        await store.upsert(type,revertEntity(current,target.before,target.omitted),{label:'Retour à une version précédente',historyAction:'revert'});
        savedToast(`Version du ${formatHistoryDate(row.at)} rétablie.`);
        if(container.isConnected)mount(container,type,id);
      }catch(error){button.disabled=false;toast(error?.message||'Retour impossible.','error');}
    }));
  }

  // Section repliable « Historique » ajoutée en bas d’un formulaire de fiche ; chargée à l’ouverture.
  function attach(form,type,id){
    if(!form||!id)return;
    const details=document.createElement('details');details.className='form-section history-section';
    details.innerHTML='<summary>Historique</summary><div class="history-panel"></div>';
    details.addEventListener('toggle',()=>{if(details.open)mount(details.querySelector('.history-panel'),type,id);});
    form.append(details);
  }

  return {savedToast,undoLast,undoChanges,installShortcut,mount,attach,lastBurst};
}
