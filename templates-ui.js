// Écran « Modèles de travaux » (Plus › Planifier) : utiliser, renommer, supprimer (corbeille, annulable).
import {escapeHtml} from './utils.js';
import {templateList,templateSummary,cleanTemplateName} from './templates.js';

export function createTemplatesUI({store,state,modal,closeModal,toast,canWrite=()=>true,doc=globalThis.document}){
  const $=selector=>doc.querySelector(selector);

  function open(){
    const rows=templateList(state()),write=canWrite();
    const body=rows.length?`<div class="stack-list">${rows.map(({template:t,uses})=>`<div class="list-row"><div><strong>${escapeHtml(t.name||t.type||'Modèle')}</strong><small>${escapeHtml(templateSummary(t))}${uses?` · repris ${uses} fois`:''}</small></div><div><button class="small-button" data-action="use-template" data-id="${escapeHtml(t.id)}">Utiliser</button>${write?` <button class="small-button" data-action="rename-template" data-id="${escapeHtml(t.id)}">Renommer</button> <button class="small-button danger" data-action="delete-template" data-id="${escapeHtml(t.id)}">Supprimer</button>`:''}</div></div>`).join('')}</div>`
      :'<div class="empty-state"><p>Aucun modèle pour l’instant.</p><p class="muted">Dans le formulaire d’un travail, cochez « Enregistrer comme modèle » : il apparaîtra ici et dans la saisie rapide.</p></div>';
    modal('Modèles de travaux','Préremplissent un travail : type, produit, dose, matériel. Les plus repris sont en tête.',body,'<button class="secondary-button" data-action="close-modal">Fermer</button>');
  }

  function rename(id){
    const t=store.get('templates',id);if(!t)return;
    modal('Renommer le modèle',templateSummary(t),`<form id="template-rename-form" novalidate><label>Nom *<input name="name" maxlength="80" data-autofocus value="${escapeHtml(t.name||'')}"></label><p class="form-error hidden" role="alert"></p></form>`,
      '<button class="secondary-button" data-action="open-templates">Retour</button><button class="primary-button" type="submit" form="template-rename-form">Enregistrer</button>');
    const form=$('#template-rename-form');
    form?.addEventListener('submit',async event=>{
      event.preventDefault();
      const name=cleanTemplateName(form.elements.name.value),error=form.querySelector('.form-error');
      if(!name){error.textContent='Donnez un nom au modèle.';error.classList.remove('hidden');return;}
      await store.upsert('templates',{id,name},{label:`Modèle renommé : ${name}`,queue:false});
      open();
    });
  }

  async function remove(id){
    const t=store.get('templates',id);if(!t)return;
    await store.remove('templates',id);
    open();
    toast(`Modèle « ${t.name||t.type||'Modèle'} » placé dans la corbeille.`,'success',{label:'Annuler',run:async()=>{await store.restore('templates',id);open();}});
  }

  return {open,rename,remove};
}
