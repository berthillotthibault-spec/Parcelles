import {escapeHtml,formatNumber,localDate} from './utils.js';
import {grazingAnimalList,grazingAnimalText,grazingTotal,grazingType,grazingStatus,filterGrazingSessions,summarizeParcelGrazing,parseGrazingAnimals} from './grazing.js';
import {saveGrazingSession,endGrazingSession} from './grazing-records.js';

const labels={current:'Au pré',planned:'Prévu',ended:'Sorti',invalid:'Dates à vérifier'};
const animalLabel=animal=>[animal.number,animal.name].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')||'Animal sans numéro';
function animalHtml(animal){return `<li>${escapeHtml(animalLabel(animal))}${animal.gestation?' <span class="badge success">Gestante</span>':''}</li>`;}
export function parcelGrazingHtml(sessions,parcelId,{compact=false,date=new Date()}={}){
  const summary=summarizeParcelGrazing(sessions,parcelId,{date});
  const title=summary.total?`${formatNumber(summary.total,0)} ${summary.total===1?'animal':'animaux'} au pré`:'Aucun animal au pré';
  if(compact){
    const names=summary.animals.slice(0,4).map(animalLabel);
    if(summary.animals.length>4)names.push(`+ ${summary.animals.length-4} autres identifiés`);
    if(summary.unidentifiedCount)names.push(`${summary.unidentifiedCount} sans numéro`);
    return `<div class="grazing-map-summary"><strong>${escapeHtml(title)}</strong>${names.length?`<small>${escapeHtml(names.join(' · '))}</small>`:''}<button type="button" class="text-button" data-action="open-grazing-parcel" data-id="${escapeHtml(parcelId)}">${summary.total?'Voir les animaux':'Mettre au pré'}</button></div>`;
  }
  return `<section class="panel parcel-grazing" data-parcel-grazing="${escapeHtml(parcelId)}"><div class="panel-heading"><h2>${escapeHtml(title)}</h2><button class="text-button" data-action="open-grazing-parcel" data-id="${escapeHtml(parcelId)}">Gérer le pâturage</button></div>${summary.groups.map(group=>`<article class="grazing-group"><strong>${escapeHtml(group.type)} · ${formatNumber(group.total,0)} animaux</strong>${group.note?`<p>${escapeHtml(group.note)}</p>`:''}${group.animals.length?`<ul class="grazing-animals">${group.animals.map(animalHtml).join('')}</ul>`:''}${group.animalDescription?`<p>${escapeHtml(group.animalDescription)}</p>`:''}${group.unidentifiedCount?`<p class="form-note">${group.unidentifiedCount} animal(aux) sans numéro enregistré.</p>`:''}<small>Entrée : ${group.startDate?localDate(group.startDate):'date non renseignée'}</small></article>`).join('')||'<p class="form-note">Aucun lot présent à la date du jour.</p>'}</section>`;
}

export function createGrazingUI({store,state,modal,closeModal,toast,confirmDelete,today}){
  let filters={status:'current',parcelId:'',animalType:'',gestation:'all',query:''};
  const $=selector=>document.querySelector(selector);
  const active=key=>(state()[key]||[]).filter(row=>!row.deletedAt);
  function openList({parcelId='',reset=true}={}){
    if(reset)filters={status:'current',parcelId,animalType:'',gestation:'all',query:''};
    const parcels=active('parcelles'),types=[...new Set(active('grazingSessions').map(grazingType))].sort((a,b)=>a.localeCompare(b,'fr'));
    modal('Animaux au pré','Retrouvez les animaux, les lots et leurs parcelles.',`<form id="grazing-filters" class="form-grid"><label>Présence<select name="status">${[['current','Au pré aujourd’hui'],['planned','Entrées prévues'],['ended','Lots sortis'],['all','Tous les lots']].map(([value,label])=>`<option value="${value}" ${filters.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Parcelle<select name="parcelId"><option value="">Toutes les parcelles</option>${parcels.map(p=>`<option value="${escapeHtml(p.id)}" ${filters.parcelId===p.id?'selected':''}>${escapeHtml(p.nom)}</option>`).join('')}</select></label><label>Type d’animaux<select name="animalType"><option value="">Tous les types</option>${types.map(type=>`<option value="${escapeHtml(type)}" ${filters.animalType===type?'selected':''}>${escapeHtml(type)}</option>`).join('')}</select></label><label>Composition du lot<select name="gestation"><option value="all">Tous les animaux</option><option value="yes" ${filters.gestation==='yes'?'selected':''}>Avec animaux gestants</option><option value="no" ${filters.gestation==='no'?'selected':''}>Avec animaux identifiés non gestants</option></select></label><label class="span-2">Rechercher un numéro, un nom ou un lot<input name="query" type="search" value="${escapeHtml(filters.query)}" placeholder="FR…, génisses, lot…"></label></form><p id="grazing-counter" aria-live="polite"></p><div id="grazing-results" class="stack-list"></div>`,`<button class="button secondary" data-action="close-modal">Fermer</button><button class="button primary" id="grazing-add">Mettre au pré</button>`,'large');
    const form=$('#grazing-filters');
    const update=()=>{filters={...filters,...Object.fromEntries(new FormData(form))};renderList();};
    form.onchange=update;form.querySelector('[name="query"]').oninput=update;form.onsubmit=event=>event.preventDefault();
    $('#grazing-add').onclick=()=>openForm(null,{parcelId:filters.parcelId});renderList();
  }
  function renderList(){
    const data=state(),parcels=new Map(active('parcelles').map(p=>[p.id,p]));
    const rows=filterGrazingSessions(data.grazingSessions||[],{...filters,parcels:active('parcelles'),date:today()});
    const total=rows.reduce((sum,row)=>sum+grazingTotal(row),0);
    $('#grazing-counter').textContent=`${formatNumber(total,0)} animaux dans ${rows.length} lot(s) affiché(s)`;
    $('#grazing-results').innerHTML=rows.length?rows.map(row=>{
      const animals=grazingAnimalList(row),unknown=Math.max(0,grazingTotal(row)-animals.length),status=grazingStatus(row,{date:today()});
      return `<article class="grazing-group" data-grazing-id="${escapeHtml(row.id)}"><div class="grazing-heading"><div><strong>${escapeHtml(parcels.get(row.parcelId)?.nom||'Parcelle indisponible')}</strong><p>${grazingTotal(row)} animaux · ${escapeHtml(grazingType(row))}</p></div><span class="badge ${status==='current'?'success':'info'}">${labels[status]||'À vérifier'}</span></div>${row.note?`<p>${escapeHtml(row.note)}</p>`:''}${animals.length?`<ul class="grazing-animals">${animals.map(animalHtml).join('')}</ul>`:typeof row.animals==='string'&&row.animals?`<p>${escapeHtml(row.animals)}</p>`:''}${unknown?`<p class="form-note">${unknown} animal(aux) sans numéro enregistré.</p>`:''}<p class="form-note">Entrée : ${row.startDate?localDate(row.startDate):'non renseignée'}${row.endDate?` · Sortie : ${localDate(row.endDate)}`:''}</p><div class="grazing-actions"><button type="button" class="small-button" data-grazing-edit="${escapeHtml(row.id)}">Modifier</button>${status==='current'?`<button type="button" class="small-button" data-grazing-exit="${escapeHtml(row.id)}">Sortir du pré</button>`:''}</div></article>`;
    }).join(''):'<div class="empty-state">Aucun lot ne correspond aux filtres.</div>';
    $('#grazing-results').querySelectorAll('[data-grazing-edit]').forEach(button=>button.onclick=()=>openForm(store.get('grazingSessions',button.dataset.grazingEdit)));
    $('#grazing-results').querySelectorAll('[data-grazing-exit]').forEach(button=>button.onclick=async()=>{
      if(button.disabled)return;button.disabled=true;
      try{await endGrazingSession(store,button.dataset.grazingExit,{date:today()});if(button.isConnected)renderList();toast('Sortie du pré enregistrée.');}
      catch(error){button.disabled=false;toast(error.message,'error');}
    });
  }
  function openForm(session=null,{parcelId=''}={}){
    session=session?structuredClone(session):null;
    const parcels=active('parcelles');if(!parcels.length)return toast('Ajoutez d’abord une parcelle.','error');
    const row=session||{parcelId:parcelId||parcels[0].id,startDate:today(),animals:[],additionalAnimalsCount:0,animalType:'Bovins',note:''};
    const text=grazingAnimalText(row),unknown=Math.max(0,grazingTotal(row)-grazingAnimalList(row).length);
    modal(session?'Modifier le pâturage':'Mettre au pré','Une ligne par numéro ou nom. Ajoutez « | gestante » si nécessaire.',`<form id="grazing-form" class="form-grid"><label>Parcelle<select name="parcelId" required>${parcels.map(p=>`<option value="${escapeHtml(p.id)}" ${row.parcelId===p.id?'selected':''}>${escapeHtml(p.nom)}</option>`).join('')}</select></label><label>Type d’animaux<input name="animalType" list="grazing-animal-types" value="${escapeHtml(grazingType(row))}" placeholder="Bovins, ovins, chevaux…"><datalist id="grazing-animal-types"><option>Bovins</option><option>Ovins</option><option>Caprins</option><option>Chevaux</option></datalist></label><label>Date d’entrée<input name="startDate" required type="date" value="${escapeHtml(row.startDate||today())}"></label><label>Date de sortie (facultative)<input name="endDate" type="date" value="${escapeHtml(row.endDate||'')}"></label><label class="span-2">Numéros ou noms des animaux<textarea name="animals" rows="6" placeholder="FR1234567890&#10;FR1234567891 | gestante">${escapeHtml(text)}</textarea></label><label>Animaux sans numéro<input name="additionalAnimalsCount" type="number" required min="0" step="1" value="${unknown}"></label><label>Lot / commentaire<input name="note" value="${escapeHtml(row.note||'')}"></label></form>`,`<button class="button secondary" id="grazing-back">Retour</button>${session?'<button class="button danger" id="delete-grazing">Supprimer</button>':''}<button class="button primary" id="save-grazing">Enregistrer</button>`,'large');
    $('#grazing-back').onclick=()=>openList({reset:false});
    $('#delete-grazing')?.addEventListener('click',()=>confirmDelete('grazingSessions',row.id,'cette session de pâturage'));
    const form=$('#grazing-form'),button=$('#save-grazing');
    if(!parcels.some(parcel=>parcel.id===row.parcelId)){
      const option=document.createElement('option');option.value='';option.textContent='Parcelle indisponible — choisir une parcelle';option.selected=true;
      form.querySelector('[name="parcelId"]').prepend(option);
    }
    button.onclick=async()=>{
      if(button.disabled||!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      try{
        if(values.endDate&&values.endDate<values.startDate)throw new Error('La sortie doit être postérieure ou égale à l’entrée.');
        if(!active('parcelles').some(p=>p.id===values.parcelId))throw new Error('La parcelle n’est plus disponible.');
        const additionalAnimalsCount=Number(values.additionalAnimalsCount);
        if(!Number.isSafeInteger(additionalAnimalsCount)||additionalAnimalsCount<0)throw new Error('Indiquez un nombre entier d’animaux sans numéro.');
        const unchanged=values.animals===text;
        const animals=unchanged&&session?row.animals:parseGrazingAnimals(values.animals).map(animal=>{
          const previous=grazingAnimalList(row).find(old=>String(old.number||old.name).trim()===animal.number);
          return previous?{...previous,gestation:animal.gestation}:animal;
        });
        const count=Array.isArray(animals)?grazingAnimalList({animals}).length:0;
        if(count+additionalAnimalsCount===0)throw new Error('Ajoutez au moins un animal ou un effectif sans numéro.');
        button.disabled=true;
        if(session&&!store.get('grazingSessions',row.id))throw new Error('Ce lot n’est plus disponible.');
        await saveGrazingSession(store,{parcelId:values.parcelId,animalType:values.animalType.trim()||'Non précisé',startDate:values.startDate,endDate:values.endDate||null,animals,additionalAnimalsCount,note:values.note},{id:session?row.id:null,expected:session});
        if(form.isConnected)openList({reset:false});toast('Pâturage enregistré.');
      }catch(error){button.disabled=false;toast(error.message,'error');}
    };
  }
  return{openList,openForm};
}
