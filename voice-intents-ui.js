// Brouillons vocaux des intentions ajoutées par l'idée n° 13 : entretien et compteur, observation,
// sortie de stock, heures de chantier TP ; écran « Noms et surnoms » (champ facultatif « aliases »
// des parcelles et des engins). Chargé à la demande (lazy-modules.js) par voice-notes-ui.js.
// Rien n'est enregistré sans validation explicite ; aucune donnée ne quitte l'appareil.
import {escapeHtml, formatNumber, toNullableNumber, uid} from './utils.js';
import {MAINTENANCE_TYPES, OBSERVATION_TYPES, formatAliases, maintenanceRecordType, parseAliases} from './voice-grammar.js';
import {convertQuantity} from './voice-notes.js';
import {deletePublicWorksLog, savePublicWorksLog} from './public-works.js';

const SEVERITIES=[['info','Information'],['warning','À surveiller'],['urgent','Urgent']];

export function createVoiceIntentsUI(kit){
  const {store,active,parcelById,modal,closeModal,toast}=kit;
  const $=selector=>document.querySelector(selector);
  const can=(entity,action='create')=>!store.writeGuard||store.writeGuard({entity,action});
  const number=value=>{const n=toNullableNumber(value);return n===null||!Number.isFinite(n)?null:n;};
  const note=entry=>`Dicté : « ${entry.text} »`;
  const machineName=id=>active('materiels').find(m=>m.id===id)?.nom||'l’engin';

  // ---------- Champs communs ----------
  function machineField(entry,{required=true,label='Engin'}={}){
    const machines=active('materiels'),chosen=entry.equipment?.id||entry.equipmentId||'',choices=(entry.equipmentChoices||[]).filter(m=>m.id!==chosen);
    if(!chosen&&choices.length>1&&choices.length<=6)return `<div class="field-label"><span>${label}${required?' *':''}</span><input type="hidden" name="equipmentId" value="">${kit.chips('equipmentId',choices.map(m=>[m.id,m.nom]),'',{label:'Engins proposés'})}<p class="form-note">Plusieurs engins correspondent : touchez le bon.</p></div>`;
    const probable=chosen&&entry.equipmentProbable?'<small>Engin probable : vérifiez-le.</small>':'';
    return `<label class="${chosen?'vn-hit':''}">${label}${required?' *':''}<select name="equipmentId"><option value="">${required?'Choisir…':'Aucun'}</option>${machines.map(m=>`<option value="${escapeHtml(m.id)}"${m.id===chosen?' selected':''}>${escapeHtml(m.nom||'Matériel')}${m.currentMeter!==undefined&&m.currentMeter!==null&&m.currentMeter!==''?` · ${formatNumber(m.currentMeter)} h`:''}</option>`).join('')}</select>${probable}</label>`;
  }
  function numberField(name,label,value,{step='any',recognized=false,unit=''}={}){
    return `<label class="${recognized?'vn-hit':''}">${label}${unit?` (${unit})`:''}<input name="${name}" type="number" min="0" step="${step}" inputmode="decimal" value="${value===null||value===undefined?'':escapeHtml(String(value))}"></label>`;
  }
  const readOnly=entity=>can(entity)?'':'<div class="notice warning">Votre rôle est en lecture seule : ce brouillon ne peut pas être enregistré.</div>';

  // ---------- Entretien et compteur ----------
  function renderMaintenance(entry){
    const machines=active('materiels');
    if(!machines.length){
      kit.draftModal(`<div class="notice warning">Aucun matériel n’est enregistré. Ajoutez vos engins depuis Plus › Matériel, puis dictez à nouveau.</div>${kit.quote(entry)}`,kit.footer('Fermer',{complete:false}));
      $('#vn-save').onclick=()=>{kit.markHandled();closeModal();};return;
    }
    const body=`${readOnly('maintenanceRecords')}${machineField(entry)}
      <div class="field-label vn-hit"><span>Opération *</span><input type="hidden" name="opType" value="${escapeHtml(entry.opType?maintenanceRecordType(entry.opType):'')}">${kit.chips('opType',MAINTENANCE_TYPES.map(t=>[t,t]),entry.opType?maintenanceRecordType(entry.opType):'',{label:'Opération'})}</div>
      ${numberField('meter','Compteur',entry.meter,{step:'0.1',recognized:entry.meter!==null,unit:'h'})}<p class="form-note hidden" id="vi-meter-note" role="status"></p>
      ${numberField('liters','Litres',entry.liters,{recognized:entry.liters!==null,unit:'L'})}
      ${numberField('cost','Coût',entry.cost,{step:'0.01',recognized:entry.cost!==null,unit:'€'})}
      ${kit.dateField(entry,{max:kit.todayIso()})}${kit.quote(entry)}`;
    const form=kit.draftModal(body,kit.footer('Enregistrer l’entretien',{complete:false}));
    const checkMeter=()=>{
      const out=$('#vi-meter-note'),m=machines.find(x=>x.id===form.elements.equipmentId.value),meter=number(form.elements.meter.value),current=number(m?.currentMeter);
      const low=m&&meter!==null&&current!==null&&meter<current;
      out.textContent=low?`Inférieur au compteur actuel du ${m.nom} (${formatNumber(current)} h) : vérifiez le chiffre.`:'';out.classList.toggle('hidden',!low);
    };
    form.addEventListener('input',checkMeter);form.addEventListener('change',checkMeter);form.addEventListener('click',()=>setTimeout(checkMeter));checkMeter();
    $('#vn-save').onclick=async()=>{
      const v=form.elements,equipmentId=v.equipmentId.value,type=v.opType.value.trim(),date=v.date.value,m=machines.find(x=>x.id===equipmentId);
      if(!m)return kit.draftError('Champ obligatoire : engin.');
      if(!type)return kit.draftError('Champ obligatoire : opération.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return kit.draftError('Champ obligatoire : date.');
      if(date>kit.todayIso())return kit.draftError('Un entretien enregistré est déjà fait : la date ne peut pas être dans le futur.');
      const meter=number(v.meter.value),liters=number(v.liters.value),cost=number(v.cost.value);
      // Plein, panne ou entretien général : enregistré en « Autre », l'opération dictée en tête de note.
      const detail=type==='Autre'&&entry.opType&&entry.opType!=='Autre'&&maintenanceRecordType(entry.opType)==='Autre'?`${entry.opType} · `:'';
      const record={id:uid('maintenance'),equipmentId,date,type,meter,cost:cost??0,note:`${detail}${note(entry)}`,nextDue:null};
      if(liters!==null)record.liters=liters;
      const button=$('#vn-save');button.disabled=true;
      const previousMeter=m.currentMeter??null,raise=meter!==null&&(number(previousMeter)===null||meter>number(previousMeter));
      try{
        await store.upsert('maintenanceRecords',record,{label:`Entretien enregistré : ${m.nom}`});
        if(raise)await store.upsert('materiels',{...store.get('materiels',equipmentId),currentMeter:meter},{label:`Compteur mis à jour : ${m.nom}`});
      }catch(error){button.disabled=false;return kit.draftError(error.message||'Enregistrement impossible.');}
      kit.finish(`Entretien enregistré : ${type} · ${m.nom}${raise?` · compteur ${formatNumber(meter)} h`:''}.`,async()=>{
        await store.remove('maintenanceRecords',record.id);
        if(raise){const now=store.get('materiels',equipmentId);if(now&&now.currentMeter===meter)await store.upsert('materiels',{...now,currentMeter:previousMeter},{label:`Compteur rétabli : ${m.nom}`});}
      });
    };
  }

  // ---------- Observation ----------
  function renderObservation(entry){
    const body=`${readOnly('observations')}${kit.parcelPicker(entry)}
      <label class="vn-hit">Titre *<input name="title" value="${escapeHtml(entry.title||'')}" maxlength="120" autocomplete="off"></label>
      <label class="vn-hit">Type<select name="obsType">${OBSERVATION_TYPES.map(t=>`<option${t===entry.obsType?' selected':''}>${escapeHtml(t)}</option>`).join('')}</select></label>
      <div class="field-label"><span>Niveau</span><input type="hidden" name="severity" value="${escapeHtml(entry.severity||'info')}">${kit.chips('severity',SEVERITIES,entry.severity||'info',{label:'Niveau'})}</div>
      ${kit.dateField(entry,{max:kit.todayIso()})}${kit.quote(entry)}`;
    const form=kit.draftModal(body,kit.footer('Enregistrer l’observation',{complete:false}));
    form.querySelectorAll('.vn-multi').forEach(group=>{group.dataset.single='1';});
    $('#vn-save').onclick=async()=>{
      const v=form.elements,ids=kit.chosenParcels(form),title=v.title.value.trim(),date=v.date.value;
      if(active('parcelles').length&&ids.length!==1)return kit.draftError('Champ obligatoire : parcelle (une seule).');
      if(!title)return kit.draftError('Champ obligatoire : titre.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return kit.draftError('Champ obligatoire : date.');
      const observation={id:uid('observation'),parcelId:ids[0]||'',date,type:v.obsType.value||'Observation',title,note:note(entry),severity:v.severity.value||'info',status:'À surveiller',latitude:null,longitude:null,accuracy:null,observedAt:new Date().toISOString(),resolvedAt:null};
      const button=$('#vn-save');button.disabled=true;
      try{await store.upsert('observations',observation,{label:`Observation : ${title}`});}
      catch(error){button.disabled=false;return kit.draftError(error.message||'Enregistrement impossible.');}
      const parcel=parcelById(observation.parcelId);
      kit.finish(`Observation enregistrée : ${title}${parcel?` sur ${parcel.nom}`:''}.`,()=>store.remove('observations',observation.id));
    };
  }

  // ---------- Sortie de stock ----------
  function renderStockOut(entry){
    const items=active('stockItems'),choices=entry.productChoices||[],item=items.find(s=>s.id===entry.stockItemId);
    const picker=choices.length>1?`<div class="field-label"><span>Produit *</span><input type="hidden" name="stockItemId" value="">${kit.chips('stockItemId',choices.map(c=>[c.id,c.name]),'',{label:'Produits'})}<p class="form-note">Plusieurs produits correspondent : touchez le bon.</p></div>`
      :item?`<div class="field-label vn-hit"><span>Produit</span><strong>${escapeHtml(item.name)}</strong><input type="hidden" name="stockItemId" value="${escapeHtml(item.id)}"></div>`
      :`<div class="notice warning">« ${escapeHtml(entry.product?.name||'Ce produit')} » n’a pas de fiche de stock. Créez-la depuis Stock, puis dictez à nouveau.</div>`;
    const qty=item&&entry.unitOk?`<p class="vn-stock-line vn-hit">− ${formatNumber(entry.stockQuantity)} ${escapeHtml(item.unit||'')} <small>(dit : ${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)} · stock actuel ${formatNumber(item.quantity)} ${escapeHtml(item.unit||'')})</small></p>${entry.stockQuantity>Number(item.quantity||0)?'<div class="notice warning">Stock insuffisant pour cette sortie : vérifiez la quantité ou enregistrez d’abord l’entrée manquante.</div>':''}`
      :item?`<div class="notice warning">Unité à vérifier : vous avez dit « ${escapeHtml(entry.unit)} », le stock est suivi en « ${escapeHtml(item.unit||'?')} ». Utilisez « Compléter le formulaire ».</div>`:'';
    const canSave=Boolean((item&&entry.unitOk)||choices.length>1);
    const form=kit.draftModal(`${readOnly('stockMovements')}${picker}${qty}${kit.dateField(entry,{max:kit.todayIso()})}${kit.quote(entry)}`,kit.footer(canSave?'Enregistrer la sortie de stock':'Ouvrir le stock',{complete:Boolean(item||choices.length>1)}));
    $('#vn-complete')?.addEventListener('click',()=>{const id=form.elements.stockItemId?.value;if(!id)return kit.draftError('Champ obligatoire : produit.');kit.markHandled();kit.openStockMovement?.(id);});
    $('#vn-save').onclick=async()=>{
      if(!canSave){kit.markHandled();closeModal();kit.openStock?.();return;}
      const id=form.elements.stockItemId?.value,stock=items.find(s=>s.id===id),date=form.elements.date.value;
      if(!stock)return kit.draftError('Champ obligatoire : produit.');
      const quantity=id===entry.stockItemId?entry.stockQuantity:convertQuantity(entry.quantity,entry.unit,stock.unit);
      if(quantity===null)return kit.draftError(`Unité à vérifier : le stock « ${stock.name} » est suivi en « ${stock.unit||'?'} ». Utilisez « Compléter le formulaire ».`);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return kit.draftError('Champ obligatoire : date.');
      const button=$('#vn-save');button.disabled=true;
      try{await store.recordStockMovement({stockItemId:id,type:'Sortie',quantity,date,note:note(entry)});}
      catch(error){button.disabled=false;return kit.draftError(error.message);}
      kit.finish(`Sortie de stock enregistrée : − ${formatNumber(quantity)} ${stock.unit||''} de ${stock.name}.`);
    };
  }

  // ---------- Heures de chantier TP ----------
  function renderPublicWorks(entry){
    const projects=active('chantiers').filter(c=>c.kind==='tp'&&!['Terminé','Annulé'].includes(c.status));
    const choices=entry.project?[]:(entry.projectChoices||[]);
    const picker=entry.project?`<div class="field-label vn-hit"><span>Chantier</span><strong>${escapeHtml(entry.project.type||'Chantier')}</strong><input type="hidden" name="projectId" value="${escapeHtml(entry.project.id)}"></div>`
      :choices.length>1&&choices.length<=6?`<div class="field-label"><span>Chantier *</span><input type="hidden" name="projectId" value="">${kit.chips('projectId',choices.map(c=>[c.id,c.type||'Chantier']),'',{label:'Chantiers en cours'})}<p class="form-note">Chantier non reconnu : touchez le bon.</p></div>`
      :`<label>Chantier *<select name="projectId"><option value="">Choisir…</option>${projects.map(c=>`<option value="${escapeHtml(c.id)}"${projects.length===1?' selected':''}>${escapeHtml(c.type||'Chantier')}</option>`).join('')}</select></label>`;
    const body=`${readOnly('chantiers')}${picker}
      ${numberField('hours','Heures',entry.hours,{step:'0.25',recognized:entry.hours!==null,unit:'h'})}
      ${numberField('volumeM3','Volume',entry.volumeM3,{recognized:entry.volumeM3!==null,unit:'m³'})}
      ${numberField('tonnage','Tonnage',entry.tonnage,{recognized:entry.tonnage!==null,unit:'t'})}
      ${machineField(entry,{required:false})}
      ${kit.dateField(entry,{max:kit.todayIso()})}${kit.quote(entry)}`;
    const form=kit.draftModal(body,kit.footer('Enregistrer au journal du chantier',{complete:false}));
    $('#vn-save').onclick=async()=>{
      const v=form.elements,projectId=v.projectId.value,date=v.date.value,project=projects.find(c=>c.id===projectId);
      if(!project)return kit.draftError('Champ obligatoire : chantier.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return kit.draftError('Champ obligatoire : date.');
      const hours=number(v.hours.value),volumeM3=number(v.volumeM3.value),tonnage=number(v.tonnage.value);
      if(hours===null&&volumeM3===null&&tonnage===null)return kit.draftError('Renseignez des heures, un volume ou un tonnage.');
      const button=$('#vn-save');button.disabled=true;let saved;
      try{saved=await savePublicWorksLog(store,projectId,{date,hours,volumeM3,tonnage,equipmentId:v.equipmentId.value||'',note:note(entry)});}
      catch(error){button.disabled=false;return kit.draftError(error.message||'Enregistrement impossible.');}
      const logId=saved?.tpLogs?.[saved.tpLogs.length-1]?.id;
      const what=[hours!==null?`${formatNumber(hours)} h`:'',volumeM3!==null?`${formatNumber(volumeM3)} m³`:'',tonnage!==null?`${formatNumber(tonnage)} t`:''].filter(Boolean).join(', ');
      kit.finish(`Journal du chantier « ${project.type} » : ${what}${v.equipmentId.value?` (${machineName(v.equipmentId.value)})`:''}.`,logId?()=>deletePublicWorksLog(store,projectId,logId):null);
    };
  }

  function render(entry){
    if(entry.intent==='maintenance')return renderMaintenance(entry);
    if(entry.intent==='observation')return renderObservation(entry);
    if(entry.intent==='stock-out')return renderStockOut(entry);
    if(entry.intent==='pw-hours')return renderPublicWorks(entry);
    return false;
  }

  // ---------- Noms et surnoms ----------
  function aliasRows(rows,prefix,nameOf){
    return rows.map(row=>{const id=`vi-alias-${prefix}-${row.id}`;return `<label class="vi-alias" for="${escapeHtml(id)}"><span>${escapeHtml(nameOf(row))}</span><input id="${escapeHtml(id)}" data-alias="${prefix}" data-id="${escapeHtml(row.id)}" value="${escapeHtml(formatAliases(row))}" placeholder="ex. le grand champ, chez Bernard" autocomplete="off" spellcheck="false"></label>`;}).join('');
  }
  function openVocabulary(){
    const parcels=active('parcelles').slice().sort((a,b)=>String(a.nom||'').localeCompare(String(b.nom||''),'fr')),machines=active('materiels');
    const writable=can('parcelles','update')||can('materiels','update');
    const body=`<form class="vn-draft vi-vocab" id="vi-vocab" novalidate>${writable?'':'<div class="notice warning">Votre rôle est en lecture seule : les surnoms sont affichés sans pouvoir être modifiés.</div>'}
      <p class="form-note">Indiquez les noms que vous employez à l’oral, séparés par des virgules. La saisie vocale les reconnaît comme le nom officiel. Ils restent dans les données de l’exploitation.</p>
      ${parcels.length>8?'<label class="vi-alias-filter">Rechercher<input type="search" id="vi-alias-filter" placeholder="Nom de parcelle ou d’engin" autocomplete="off"></label>':''}
      <section class="vn-draft" aria-labelledby="vi-alias-parcels"><h3 id="vi-alias-parcels">Parcelles</h3>${parcels.length?aliasRows(parcels,'p',p=>p.nom||'Parcelle'):'<p class="form-note">Aucune parcelle.</p>'}</section>
      <section class="vn-draft" aria-labelledby="vi-alias-machines"><h3 id="vi-alias-machines">Engins</h3>${machines.length?aliasRows(machines,'m',m=>m.nom||'Matériel'):'<p class="form-note">Aucun matériel.</p>'}</section>
      <p class="form-error hidden" id="vi-alias-error" role="alert"></p></form>`;
    modal('Noms et surnoms','Comment vous appelez vos parcelles et vos engins.',body,writable?'<button type="button" class="button secondary" data-action="close-modal">Annuler</button><button type="button" class="button primary" id="vi-alias-save">Enregistrer</button>':'<button type="button" class="button secondary" data-action="close-modal">Fermer</button>');
    document.querySelectorAll('[data-alias]').forEach(input=>{input.disabled=!can(input.dataset.alias==='p'?'parcelles':'materiels','update');});
    $('#vi-alias-filter')?.addEventListener('input',event=>{
      const q=event.target.value.trim().toLocaleLowerCase('fr');
      document.querySelectorAll('.vi-alias').forEach(row=>{row.hidden=Boolean(q)&&!row.textContent.toLocaleLowerCase('fr').includes(q)&&!row.querySelector('input').value.toLocaleLowerCase('fr').includes(q);});
    });
    $('#vi-alias-save')?.addEventListener('click',async event=>{
      const button=event.currentTarget,changes={parcelles:[],materiels:[]};
      document.querySelectorAll('[data-alias]:not(:disabled)').forEach(input=>{
        const type=input.dataset.alias==='p'?'parcelles':'materiels',row=store.get(type,input.dataset.id);if(!row)return;
        const next=parseAliases(input.value);if(JSON.stringify(next)!==JSON.stringify(parseAliases(formatAliases(row))))changes[type].push({...row,aliases:next});
      });
      const total=changes.parcelles.length+changes.materiels.length;
      if(!total){closeModal();return;}
      button.disabled=true;
      try{
        if(changes.parcelles.length)await store.upsertMany('parcelles',changes.parcelles,{label:`Surnoms de ${changes.parcelles.length} parcelle${changes.parcelles.length>1?'s':''}`});
        if(changes.materiels.length)await store.upsertMany('materiels',changes.materiels,{label:`Surnoms de ${changes.materiels.length} engin${changes.materiels.length>1?'s':''}`});
      }catch(error){button.disabled=false;const out=$('#vi-alias-error');out.textContent=error.message||'Enregistrement impossible.';out.classList.remove('hidden');return;}
      closeModal();toast(`Surnoms enregistrés (${total} fiche${total>1?'s':''}).`,'success');
    });
  }

  return {render,openVocabulary};
}
