import {escapeHtml} from './utils.js';
import {TP_STATUSES,isPublicWorks,savePublicWorksProject,savePublicWorksLog,deletePublicWorksLog,publicWorksTotals,filterPublicWorksProjects} from './public-works.js';

const esc=value=>escapeHtml(String(value??''));
const number=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(value??0);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'Non prévue';
const quantityInput=(name,label,value)=>`<label>${label}<input name="${name}" type="number" min="0" max="1000000000" step="any" inputmode="decimal" value="${esc(value??'')}"></label>`;
const statusOptions=selected=>TP_STATUSES.map(status=>`<option value="${esc(status)}" ${status===selected?'selected':''}>${esc(status)}</option>`).join('');
const metrics=totals=>`<div class="tp-metrics"><div><strong>${number(totals.hours)}</strong><span>heures réalisées</span></div><div><strong>${number(totals.volumeM3)}</strong><span>m³ réalisés</span></div><div><strong>${number(totals.tonnage)}</strong><span>tonnes réalisées</span></div></div>`;

/** All persistence uses the existing Store. A TP chantier needs no agricultural parcel. */
export function createPublicWorksUI({store,state,modal,closeModal,toast,confirmDelete,openEquipment,openAttachment}){
  const $=selector=>document.querySelector(selector);
  const active=type=>(state()[type]||[]).filter(row=>row&&!row.deletedAt);
  const record=id=>{const value=store.get('chantiers',id);return isPublicWorks(value)?value:null;};
  const name=(type,id)=>active(type).find(row=>row.id===id)?.[type==='clients'?'name':'nom']||'—';
  const options=(type,selected,empty)=>`<option value="">${esc(empty)}</option>${active(type).map(row=>`<option value="${esc(row.id)}" ${row.id===selected?'selected':''}>${esc(row[type==='clients'?'name':'nom'])}</option>`).join('')}${selected&&!active(type).some(row=>row.id===selected)?`<option value="${esc(selected)}" selected>Élément indisponible — à remplacer</option>`:''}`;
  const bind=(selector,callback)=>$(selector)?.addEventListener('click',callback);
  let filters={status:'',clientId:'',equipmentId:'',query:''};

  async function save(button,form,operation,onSuccess){
    if(button.disabled||!form.reportValidity())return;
    button.disabled=true;
    try{const saved=await operation(Object.fromEntries(new FormData(form)));if(form.isConnected){onSuccess(saved);toast('Enregistré.');}}
    catch(error){if(form.isConnected){const target=form.querySelector('[data-tp-error]');if(target){target.textContent=error.message||'Enregistrement impossible.';target.hidden=false;}toast(error.message||'Enregistrement impossible.','error');}}
    finally{if(button.isConnected)button.disabled=false;}
  }

  function openList(){
    modal('Travaux publics','Chantiers, engins, heures et quantités réalisées.',`<section class="tp-screen"><div class="form-grid tp-filters"><label>État<select id="tp-filter-status"><option value="">Tous les états</option>${statusOptions(filters.status)}</select></label><label>Client<select id="tp-filter-client">${options('clients',filters.clientId,'Tous les clients')}</select></label><label>Engin<select id="tp-filter-equipment">${options('materiels',filters.equipmentId,'Tous les engins')}</select></label><label>Rechercher<input id="tp-filter-query" type="search" value="${esc(filters.query)}" placeholder="Chantier, adresse, opérateur…"></label></div><div id="tp-project-list"></div></section>`,`<button class="button secondary" data-action="close-modal">Fermer</button>${openEquipment?'<button class="button secondary" id="tp-manage-equipment">Engins</button>':''}<button class="button primary" id="tp-new-project">＋ Chantier TP</button>`,'large');
    const render=()=>{
      const rows=filterPublicWorksProjects(active('chantiers'),filters),totals=rows.reduce((sum,row)=>{const current=publicWorksTotals(row);for(const key of ['hours','volumeM3','tonnage'])sum[key]+=current[key];return sum;},{hours:0,volumeM3:0,tonnage:0});
      $('#tp-project-list').innerHTML=`<p class="form-note">${rows.length} chantier${rows.length>1?'s':''} affiché${rows.length>1?'s':''}</p>${metrics(totals)}${rows.length?`<div class="stack-list">${rows.map(row=>{const t=publicWorksTotals(row);return `<button class="menu-row" data-tp-project="${esc(row.id)}"><span aria-hidden="true">▥</span><span><strong>${esc(row.type)}</strong><small>${esc(row.status)} · ${dateLabel(row.plannedDate)}${row.clientId?` · ${esc(name('clients',row.clientId))}`:''}</small><small>${esc(row.address||'Adresse non renseignée')}</small><small>${number(t.hours)} h · ${number(t.volumeM3)} m³ · ${number(t.tonnage)} t</small></span><b aria-hidden="true">›</b></button>`;}).join('')}</div>`:'<div class="empty-state">Aucun chantier TP pour ces filtres. Créez un chantier pour commencer le suivi.</div>'}`;
      $('#tp-project-list').querySelectorAll('[data-tp-project]').forEach(button=>button.onclick=()=>openDetail(button.dataset.tpProject));
    };
    for(const [key,id,event] of [['status','status','change'],['clientId','client','change'],['equipmentId','equipment','change'],['query','query','input']])$(`#tp-filter-${id}`).addEventListener(event,e=>{filters[key]=e.target.value;render();});
    bind('#tp-new-project',()=>openForm());bind('#tp-manage-equipment',()=>{closeModal();openEquipment();});render();
  }

  function openForm(id=null){
    const existing=id?record(id):null;if(id&&!existing){toast('Chantier TP introuvable.','error');return openList();}
    const c=existing||{type:'',status:'Planifié',plannedDate:today(),operator:state().preferences.defaultOperator||'',parcelIds:[]};
    modal(existing?'Modifier le chantier TP':'Nouveau chantier TP','Une adresse suffit : le rattachement à une parcelle agricole est facultatif.',`<form id="tp-project-form" class="form-grid"><label class="span-2">Nom du chantier *<input name="type" required maxlength="200" value="${esc(c.type)}" placeholder="Terrassement maison, accès, tranchée…"></label><label>État<select name="status">${statusOptions(c.status)}</select></label><label>Date prévue<input name="plannedDate" type="date" value="${esc(c.plannedDate)}"></label><label>Client<select name="clientId">${options('clients',c.clientId,'Sans client / usage interne')}</select></label><label>Engin principal<select name="equipmentId">${options('materiels',c.equipmentId,'À préciser')}</select></label><label class="span-2">Adresse / lieu<input name="address" maxlength="500" value="${esc(c.address)}" placeholder="Adresse, commune ou repère d’accès"></label><label>Opérateur<input name="operator" maxlength="200" value="${esc(c.operator)}"></label><label>Parcelle associée (facultatif)<select name="parcelId">${options('parcelles',c.parcelIds?.[0],'Aucune parcelle')}</select></label><label class="span-2">Consignes / notes<textarea name="note" maxlength="4000">${esc(c.note)}</textarea></label><p class="form-error span-2" data-tp-error role="alert" hidden></p></form>`,`<button class="button secondary" id="tp-cancel-project">Annuler</button><button class="button primary" id="tp-save-project" type="submit" form="tp-project-form">Enregistrer</button>`,'large');
    bind('#tp-cancel-project',()=>existing?openDetail(id):openList());
    bind('#tp-save-project',event=>save(event.currentTarget,$('#tp-project-form'),values=>savePublicWorksProject(store,values,{id}),saved=>openDetail(saved.id)));
  }

  function openDetail(id){
    const c=record(id);if(!c)return openList();
    const logs=(Array.isArray(c.tpLogs)?c.tpLogs:[]).filter(log=>log&&!log.deletedAt).sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.createdAt||0)-(a.createdAt||0));
    modal(c.type||'Chantier TP',`Travaux publics · ${c.status||'Planifié'}`,`<section class="tp-screen">${metrics(publicWorksTotals(c))}<dl class="definition-list"><div><dt>Client</dt><dd>${esc(c.clientId?name('clients',c.clientId):'Usage interne / non renseigné')}</dd></div><div><dt>Lieu</dt><dd>${esc(c.address||'Non renseigné')}</dd></div><div><dt>Date prévue</dt><dd>${dateLabel(c.plannedDate)}</dd></div><div><dt>Engin principal</dt><dd>${esc(name('materiels',c.equipmentId))}</dd></div><div><dt>Opérateur</dt><dd>${esc(c.operator||'—')}</dd></div>${c.parcelIds?.length?`<div><dt>Parcelle associée</dt><dd>${esc(name('parcelles',c.parcelIds[0]))}</dd></div>`:''}</dl>${c.note?`<p class="tp-note">${esc(c.note)}</p>`:''}<div class="panel-heading"><h3>Journal de réalisation</h3><button class="button primary" id="tp-add-log">＋ Réalisation</button></div><p class="form-note">Les heures et les quantités s’additionnent séparément. Une même réalisation peut préciser des heures, un volume et un tonnage.</p>${logs.length?`<div class="stack-list">${logs.map(log=>`<button class="menu-row" data-tp-log="${esc(log.id)}"><span aria-hidden="true">◷</span><span><strong>${dateLabel(log.date)}${log.equipmentId?` · ${esc(name('materiels',log.equipmentId))}`:''}</strong><small>${[['hours','h'],['volumeM3','m³'],['tonnage','t']].filter(([key])=>log[key]!==null&&log[key]!==undefined).map(([key,unit])=>`${number(log[key])} ${unit}`).join(' · ')||'Note de réalisation'}${log.operator?` · ${esc(log.operator)}`:''}</small>${log.note?`<small class="tp-note">${esc(log.note)}</small>`:''}</span><b aria-hidden="true">›</b></button>`).join('')}</div>`:'<div class="empty-state">Aucune réalisation enregistrée. Ajoutez les heures et les quantités effectuées sur le chantier.</div>'}</section>`,`<button class="button secondary" id="tp-back-list">Retour</button><button class="button secondary" id="tp-edit-project">Modifier</button>${openAttachment?'<button class="button secondary" id="tp-add-document">Document</button>':''}${confirmDelete?'<button class="button danger" id="tp-delete-project">Supprimer</button>':''}`,'large');
    bind('#tp-back-list',openList);bind('#tp-edit-project',()=>openForm(id));bind('#tp-add-log',()=>openLogForm(id));
    bind('#tp-delete-project',()=>confirmDelete('chantiers',id,'ce chantier TP et son journal'));
    bind('#tp-add-document',()=>openAttachment({chantierId:id,clientId:c.clientId||null,equipmentId:c.equipmentId||null}));
    document.querySelectorAll('[data-tp-log]').forEach(button=>button.onclick=()=>openLogForm(id,button.dataset.tpLog));
  }

  function openLogForm(chantierId,id=null){
    const c=record(chantierId);if(!c)return openList();
    const existing=id?(Array.isArray(c.tpLogs)?c.tpLogs:[]).find(log=>log.id===id&&!log.deletedAt):null;
    if(id&&!existing){toast('Réalisation introuvable.','error');return openDetail(chantierId);}
    const log=existing||{date:today(),equipmentId:c.equipmentId,operator:c.operator};
    modal(existing?'Modifier une réalisation':'Nouvelle réalisation',c.type,`<form id="tp-log-form" class="form-grid"><label>Date *<input name="date" type="date" required value="${esc(log.date)}"></label><label>Engin utilisé<select name="equipmentId">${options('materiels',log.equipmentId,'Non renseigné')}</select></label><label class="span-2">Opérateur<input name="operator" maxlength="200" value="${esc(log.operator)}"></label>${quantityInput('hours','Heures réalisées (h)',log.hours)}${quantityInput('volumeM3','Volume réalisé (m³)',log.volumeM3)}${quantityInput('tonnage','Tonnage réalisé (t)',log.tonnage)}<p class="form-note">Renseignez seulement les quantités utiles. Une valeur vide reste non renseignée ; zéro est conservé.</p><label class="span-2">Travaux effectués / notes<textarea name="note" maxlength="4000" placeholder="Décapage, déblais, évacuation, matériaux…">${esc(log.note)}</textarea></label><p class="form-error span-2" data-tp-error role="alert" hidden></p></form>`,`<button class="button secondary" id="tp-cancel-log">Annuler</button>${existing?'<button class="button danger" id="tp-delete-log">Supprimer</button>':''}<button class="button primary" id="tp-save-log" type="submit" form="tp-log-form">Enregistrer</button>`,'large');
    bind('#tp-cancel-log',()=>openDetail(chantierId));
    bind('#tp-save-log',event=>save(event.currentTarget,$('#tp-log-form'),values=>savePublicWorksLog(store,chantierId,values,{id}),()=>openDetail(chantierId)));
    bind('#tp-delete-log',()=>{
      modal('Supprimer cette réalisation ?',`${dateLabel(log.date)} · ${c.type}`,'<p>Cette ligne sera retirée du journal et des totaux du chantier.</p>','<button class="button secondary" id="tp-keep-log">Conserver</button><button class="button danger" id="tp-confirm-delete-log">Supprimer</button>','small');
      bind('#tp-keep-log',()=>openLogForm(chantierId,id));
      bind('#tp-confirm-delete-log',async event=>{const button=event.currentTarget;if(button.disabled)return;button.disabled=true;try{await deletePublicWorksLog(store,chantierId,id);if(button.isConnected){openDetail(chantierId);toast('Réalisation supprimée.');}}catch(error){toast(error.message,'error');if(button.isConnected)button.disabled=false;}});
    });
  }

  return {openList,openForm,openDetail,openLogForm};
}
