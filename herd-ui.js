// n° 79 — Interface du troupeau bovin (module différé, clé « herd ») : liste filtrable, fiche animal,
// saillie / insémination, vêlage (veau prérempli et tâche BDNI), pesée, lien avec les lots de pâturage,
// reprise des numéros déjà saisis dans les lots et import CSV de l'inventaire (session annulable).
import {escapeHtml as e,localDate,uid,clone} from './utils.js';
import {normalizeEntity} from './state.js';
import {validateForm} from './form-chips-ui.js';
import {grazingStatus,grazingTotal} from './grazing.js';
import {SEXES,ENTRY_REASONS,EXIT_REASONS,EVENT_KINDS,BREEDS,BDNI_NOTICE,BDNI_REMINDER_DAYS,IMPORT_SOURCE,HERD_CSV_FIELDS,
  normalizeAnimal,normalizeAnimalEvent,calvingPlan,animalLot,lotLabel,lotAssignment,ageLabel,filterAnimals,animalTimeline,lastWeight,dailyGain,offspring,herdSummary,
  expectedCalvings,pendingBdni,animalLabel,formatNationalId,isPresent,grazingCandidates,candidatesToAnimals,readHerdCsv,guessColumns,herdImportPreview,herdImportEntities,bdniDeadline,addIsoDays} from './herd.js';

const fr=d=>d?localDate(`${d}T12:00:00`):'—';
const ddmm=d=>`${d.slice(8,10)}/${d.slice(5,7)}`;

export function createHerdUI({store,modal,closeModal,toast,bindChipChoices=()=>{},confirmDelete,rollbackImport,today}){
  const $=s=>document.querySelector(s);
  const data=()=>store.state;
  const live=key=>(data()[key]||[]).filter(x=>!x.deletedAt);
  const can=(entity,action,payload=null)=>!store.writeGuard||store.writeGuard({entity,action,...(payload?.id?{entityId:payload.id}:{}),payload});
  const filters={query:'',status:'present',sex:'',sessionId:''};

  const chips=(name,options,value)=>`<div class="chip-choices" data-chip-target="${e(name)}">${options.map(([v,t])=>`<button type="button" class="choice-chip${v===value?' is-on':''}" aria-pressed="${v===value}" data-value="${e(v)}">${e(t)}</button>`).join('')}</div><input type="hidden" name="${e(name)}" value="${e(value)}">`;
  const lots=selected=>live('grazingSessions').filter(s=>['current','planned'].includes(grazingStatus(s,{date:today()}))||s.id===selected);
  const lotOptions=selected=>lots(selected).map(s=>`<option value="${e(s.id)}" ${s.id===selected?'selected':''}>${e(lotLabel(s))} · ${grazingTotal(s)} · ${e(live('parcelles').find(p=>p.id===s.parcelId)?.nom||'Parcelle')}</option>`).join('');
  const fail=(selector,err)=>{const box=$(selector);if(box){box.textContent=err.message;box.hidden=false;}else toast(err.message,'error');};

  function animalRow(a){
    const lot=animalLot(data(),a,{today:today()}),w=lastWeight(data(),a.id);
    const due=expectedCalvings(data(),{today:today(),horizon:300,past:60}).find(c=>c.animal.id===a.id);
    const meta=[a.nationalId?formatNationalId(a.nationalId):'sans numéro',SEXES[a.sex]||'',a.breed,ageLabel(a.birthDate,today()),lot?`lot ${lotLabel(lot)}`:'',w?`${w.weightKg} kg`:''].filter(Boolean).join(' · ');
    const badge=!isPresent(a,today())?`<span class="badge">Sorti${a.sex==='F'?'e':''}</span>`:due?`<span class="badge info">Vêlage ${e(ddmm(due.date))}</span>`:'';
    return `<button type="button" class="list-row is-button" data-herd-animal="${e(a.id)}"><div><strong>${e(a.name||formatNationalId(a.nationalId))}</strong><small>${e(meta)}</small></div>${badge}</button>`;
  }
  function listHtml(){
    const rows=filterAnimals(data(),{...filters,today:today()});
    return rows.length?rows.map(animalRow).join(''):'<div class="empty-state">Aucun animal ne correspond.</div>';
  }
  function bdniHtml(pending){
    if(!pending.length)return '';
    return `<div class="notice ${pending.some(p=>p.status==='late')?'danger':'warning'}" role="status"><strong>Naissances à notifier à l’EDE / BDNI</strong>
      <div class="stack-list">${pending.map(p=>`<div class="list-row"><div><strong>${e(p.calf?animalLabel(p.calf):`Veau de ${animalLabel(p.mother)}`)}</strong><br><small>Né le ${e(fr(p.event.date))} · avant le ${e(ddmm(p.deadline))}${p.status==='late'?' · délai dépassé':p.status==='remind'?' · rappel':''}</small></div><label><input type="checkbox" data-herd-notified="${e(p.event.id)}"> Notifié</label></div>`).join('')}</div>
      <p class="form-note">${e(BDNI_NOTICE)}</p></div>`;
  }

  function open(){
    const d=data(),sum=herdSummary(d,{today:today()}),coming=expectedCalvings(d,{today:today(),horizon:60,past:30}),candidates=grazingCandidates(d);
    const writable=can('animals','create',{origin:'manual'});
    modal('Troupeau','Identification, reproduction et naissances à notifier.',`
      <div class="preview-summary"><div class="preview-stat"><strong>${sum.present}</strong><small>présents (${sum.females} F · ${sum.males} M)</small></div><div class="preview-stat"><strong>${sum.calvings}</strong><small>vêlages à 60 jours</small></div><div class="preview-stat"><strong>${sum.bdni.length}</strong><small>naissance${sum.bdni.length>1?'s':''} à notifier</small></div></div>
      ${bdniHtml(sum.bdni)}
      ${coming.length?`<h3>Vêlages à venir</h3><div class="stack-list">${coming.slice(0,6).map(c=>`<button type="button" class="list-row is-button" data-herd-animal="${e(c.animal.id)}"><div><strong>${e(c.label)}</strong><small>Prévu le ${e(fr(c.date))} (${e(EVENT_KINDS[c.event.kind])} du ${e(fr(c.event.date))} + 283 j)</small></div><span class="badge ${c.days<0?'danger':'info'}">${c.days<0?`${-c.days} j de retard`:c.days===0?'aujourd’hui':`J−${c.days}`}</span></button>`).join('')}</div>`:''}
      ${candidates.length&&writable?`<div class="notice info"><strong>${candidates.length} numéro${candidates.length>1?'s':''} déjà saisi${candidates.length>1?'s':''} dans vos lots de pâturage</strong><p>Vous pouvez créer leurs fiches en une fois ; rien n’est créé sans votre accord.</p><button type="button" class="small-button" id="herd-takeover">Voir et reprendre</button></div>`:''}
      <div class="toolbar-panel compact-toolbar"><label class="search-field"><span class="sr-only">Rechercher</span><input id="herd-query" type="search" value="${e(filters.query)}" placeholder="Nom, numéro, n° de travail, race…" autocomplete="off"></label>
        <div class="filter-row" role="group" aria-label="Présence">${[['present','Présents'],['exited','Sortis'],['all','Tous']].map(([v,t])=>`<button type="button" class="filter-chip${filters.status===v?' is-active':''}" aria-pressed="${filters.status===v}" data-herd-status="${v}">${t}</button>`).join('')}</div>
        <div class="filter-row" role="group" aria-label="Sexe">${[['','F et M'],['F','Femelles'],['M','Mâles']].map(([v,t])=>`<button type="button" class="filter-chip${filters.sex===v?' is-active':''}" aria-pressed="${filters.sex===v}" data-herd-sex="${v}">${t}</button>`).join('')}</div>
        <label class="compact-select">Lot<select id="herd-lot"><option value="">Tous</option>${lotOptions(filters.sessionId)}</select></label></div>
      <div class="stack-list" id="herd-list" aria-live="polite">${live('animals').length?listHtml():'<div class="empty-state">Aucun animal. Ajoutez un animal, importez l’inventaire de votre portail éleveur (CSV) ou reprenez les numéros de vos lots.</div>'}</div>`,
      `<button type="button" class="button secondary" data-action="close-modal">Fermer</button>${writable?'<button type="button" class="button secondary" id="herd-import">Importer un CSV</button><button type="button" class="button primary" id="herd-new">Nouvel animal</button>':''}`,'large');
    const refresh=()=>{const list=$('#herd-list');if(list)list.innerHTML=listHtml();};
    $('#herd-query')?.addEventListener('input',ev=>{filters.query=ev.target.value;refresh();});
    $('#herd-lot')?.addEventListener('change',ev=>{filters.sessionId=ev.target.value;refresh();});
    document.querySelectorAll('[data-herd-status],[data-herd-sex]').forEach(b=>b.addEventListener('click',()=>{
      const key=b.dataset.herdStatus!==undefined?'status':'sex',value=b.dataset.herdStatus??b.dataset.herdSex;filters[key]=value;
      document.querySelectorAll(key==='status'?'[data-herd-status]':'[data-herd-sex]').forEach(x=>{const on=x===b;x.classList.toggle('is-active',on);x.setAttribute('aria-pressed',String(on));});refresh();}));
    bindRows();$('#herd-list')?.addEventListener('click',ev=>{const row=ev.target.closest('[data-herd-animal]');if(row)openAnimal(row.dataset.herdAnimal);});
    bindNotified(open);
    $('#herd-new')?.addEventListener('click',()=>openForm());
    $('#herd-import')?.addEventListener('click',()=>openImport());
    $('#herd-takeover')?.addEventListener('click',()=>openTakeover());
  }

  // Lignes « animal » rendues avec la fenêtre (la liste filtrée #herd-list a son propre écouteur délégué).
  function bindRows(){document.querySelectorAll('#modal-root [data-herd-animal]').forEach(b=>{if(!b.closest('#herd-list'))b.onclick=()=>openAnimal(b.dataset.herdAnimal);});}
  function bindNotified(back){
    document.querySelectorAll('[data-herd-notified]').forEach(box=>box.addEventListener('change',async()=>{
      const ev=store.get('animalEvents',box.dataset.herdNotified);if(!ev)return;
      try{
        await setNotified(ev,box.checked);toast(box.checked?'Naissance notée comme notifiée.':'Case « notifié » retirée.','success');back();
      }catch(err){box.checked=!box.checked;toast(err.message,'error');}
    }));
  }
  async function setNotified(ev,on){
    await store.upsert('animalEvents',{...ev,bdniNotifiedAt:on?Date.now():null},{label:on?'Naissance notifiée à la BDNI':'Notification BDNI retirée'});
    const task=ev.bdniTaskId?store.get('tasks',ev.bdniTaskId):null;
    if(task)await store.upsert('tasks',{...task,status:on?'Terminé':'À faire'},{label:on?'Tâche BDNI terminée':'Tâche BDNI rouverte'});
  }

  function openAnimal(id){
    const d=data(),a=store.get('animals',id);if(!a){toast('Animal introuvable.','error');return;}
    const lot=animalLot(d,a,{today:today()}),mother=a.motherId?store.get('animals',a.motherId):null,kids=offspring(d,a.id),w=lastWeight(d,a.id),gain=dailyGain(d,a.id);
    const due=expectedCalvings(d,{today:today(),horizon:300,past:60}).find(c=>c.animal.id===a.id);
    const birth=live('animalEvents').find(x=>x.kind==='calving'&&x.calfId===a.id),pending=pendingBdni(d,today()).filter(p=>p.calf?.id===a.id||p.event.animalId===a.id);
    const timeline=animalTimeline(d,a),female=a.sex!=='M',present=isPresent(a,today());
    const canEdit=can('animals','update',a),canEvent=kind=>can('animalEvents','create',{kind,animalId:a.id}),canDelete=can('animals','delete',a),canLot=can('grazingSessions','update');
    const dl=[['Numéro national',a.nationalId?formatNationalId(a.nationalId):'Non renseigné'],['Sexe',SEXES[a.sex]||'Non précisé'],['Race',a.breed||'—'],['Naissance',a.birthDate?`${fr(a.birthDate)} (${ageLabel(a.birthDate,today())})`:'—'],
      ['Entrée',[fr(a.entryDate),a.entryReason].filter(x=>x&&x!=='—').join(' · ')||'—'],...(a.exitDate?[['Sortie',`${fr(a.exitDate)} · ${a.exitReason}`]]:[]),['Lot actuel',lot?lotLabel(lot):'Aucun'],...(w?[['Dernière pesée',`${w.weightKg} kg le ${fr(w.date)}${gain!==null?` · GMQ ${gain} g/j`:''}`]]:[]),...(due?[['Vêlage prévu',fr(due.date)]]:[])];
    modal(animalLabel(a),a.nationalId?formatNationalId(a.nationalId):'Animal sans numéro national',`
      ${bdniHtml(pending)}
      <dl class="definition-list">${dl.map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}
        <div><dt>Mère</dt><dd>${mother?`<button type="button" class="text-button" data-herd-animal="${e(mother.id)}">${e(animalLabel(mother))}</button>`:e(a.motherNationalId?formatNationalId(a.motherNationalId):'—')}</dd></div></dl>
      ${kids.length?`<h3>Descendance</h3><div class="stack-list">${kids.map(k=>`<button type="button" class="list-row is-button" data-herd-animal="${e(k.id)}"><div><strong>${e(animalLabel(k))}</strong><small>${e([SEXES[k.sex],fr(k.birthDate)].filter(Boolean).join(' · '))}</small></div><b>›</b></button>`).join('')}</div>`:''}
      ${present&&canLot&&lots(lot?.id).length?`<label class="field-label">Lot de pâturage<select id="herd-move-lot"><option value="">Aucun lot</option>${lotOptions(lot?.id)}</select></label>`:''}
      <h3>Historique</h3>
      <ul class="timeline">${timeline.map(r=>`<li><strong>${e(fr(r.date))} · ${e(r.label)}</strong><small>${e(timelineText(r,birth))}</small></li>`).join('')||'<li><small>Aucun événement. Les soins se saisissent dans le carnet sanitaire (champ « Animal » : numéro ou nom).</small></li>'}</ul>
      <p class="form-note">Traitements : carnet sanitaire (délais d’attente, ordonnances). Ils apparaissent ici quand le soin cite le numéro, le n° de travail ou le nom de l’animal.</p>`,
      `<button type="button" class="button secondary" id="herd-back">Retour</button>${canDelete?'<button type="button" class="button danger" id="herd-delete">Supprimer</button>':''}${canEdit?'<button type="button" class="button secondary" id="herd-edit">Modifier</button>':''}<button type="button" class="button secondary" data-action="open-herd-health">Soin</button>${present&&canEvent('weighing')?'<button type="button" class="button secondary" id="herd-weigh">Pesée</button>':''}${present&&female&&canEvent('insemination')?'<button type="button" class="button secondary" id="herd-service">Insémination / saillie</button>':''}${present&&female&&canEvent('calving')?'<button type="button" class="button primary" id="herd-calving">Vêlage</button>':''}`,'large');
    bindRows();
    bindNotified(()=>openAnimal(a.id));
    $('#herd-back').onclick=()=>open();
    $('#herd-edit')?.addEventListener('click',()=>openForm(a));
    $('#herd-delete')?.addEventListener('click',()=>confirmDelete('animals',a.id,`la fiche de ${animalLabel(a)}`));
    $('#herd-weigh')?.addEventListener('click',()=>openEvent(a,'weighing'));
    $('#herd-service')?.addEventListener('click',()=>openEvent(a,'insemination'));
    $('#herd-calving')?.addEventListener('click',()=>openCalving(a));
    $('#herd-move-lot')?.addEventListener('change',async ev=>{
      try{
        const sessions=lotAssignment(data(),a,ev.target.value||null,{today:today()});
        if(sessions.length)await store.upsertMany('grazingSessions',sessions,{label:`Lot de ${animalLabel(a)} modifié`});
        if(can('animals','update',a))await store.upsert('animals',{...store.get('animals',a.id),sessionId:ev.target.value||null},{label:`Lot de ${animalLabel(a)} modifié`});
        toast('Lot mis à jour.','success');openAnimal(a.id);
      }catch(err){toast(err.message,'error');openAnimal(a.id);}
    });
  }
  function timelineText(r,birth){
    const x=r.event||{};
    if(r.type==='insemination'||r.type==='mating')return [x.sire?`Taureau ${x.sire}`:'',`vêlage prévu le ${fr(x.expectedCalvingDate||addIsoDays(x.date,283))}`,x.note].filter(Boolean).join(' · ');
    if(r.type==='calving'){const calf=x.calfId?store.get('animals',x.calfId):null;return [calf?`Veau : ${animalLabel(calf)}`:'',x.birthWeightKg?`${x.birthWeightKg} kg`:'',x.calvingEase,x.bdniNotifiedAt?'naissance notifiée':`à notifier avant le ${ddmm(x.bdniDeadline||bdniDeadline(x.date))}`].filter(Boolean).join(' · ');}
    if(r.type==='birth')return [birth?.birthWeightKg?`${birth.birthWeightKg} kg à la naissance`:'',birth?.bdniNotifiedAt?'naissance notifiée':'naissance à notifier'].filter(Boolean).join(' · ');
    if(r.type==='weighing')return `${x.weightKg} kg${x.note?` · ${x.note}`:''}`;
    const t=r.treatment||{};return [t.dose?`${t.dose} ${t.doseUnit||''}`.trim():'',t.meatUntil?`attente viande jusqu’au ${fr(t.meatUntil)}`:'',t.milkUntil?`lait jusqu’au ${fr(t.milkUntil)}`:'',t.veterinarian].filter(Boolean).join(' · ')||'Carnet sanitaire';
  }

  function openForm(a=null){
    const x=a||{sex:'F',entryReason:'Achat',origin:'manual'};
    const mothers=live('animals').filter(m=>m.id!==x.id&&m.sex!=='M').sort((p,q)=>animalLabel(p).localeCompare(animalLabel(q),'fr'));
    modal(a?'Modifier l’animal':'Nouvel animal','Identification et mouvements (entrée, sortie).',`<form id="herd-animal-form" class="form-grid" novalidate>
      <label>Numéro national<input name="nationalId" value="${e(x.nationalId||'')}" placeholder="FR1234567890" autocapitalize="characters"></label>
      <label>Nom<input name="name" value="${e(x.name||'')}"></label>
      <div class="field-label"><span>Sexe</span>${chips('sex',[['F','Femelle'],['M','Mâle'],['','Non précisé']],x.sex||'')}</div>
      <label>Race<input name="breed" list="herd-breeds" value="${e(x.breed||'')}"><datalist id="herd-breeds">${BREEDS.map(b=>`<option>${e(b)}</option>`).join('')}</datalist></label>
      <label>Date de naissance<input name="birthDate" type="date" value="${e(x.birthDate||'')}" max="${e(today())}"></label>
      <label>Mère<select name="motherId"><option value="">${x.motherNationalId?`Hors troupeau (${e(formatNationalId(x.motherNationalId))})`:'Inconnue ou hors troupeau'}</option>${mothers.map(m=>`<option value="${e(m.id)}" ${m.id===x.motherId?'selected':''}>${e(animalLabel(m))}</option>`).join('')}</select></label>
      <label>Date d’entrée<input name="entryDate" type="date" value="${e(x.entryDate||'')}"></label>
      <label>Motif d’entrée<select name="entryReason">${ENTRY_REASONS.map(r=>`<option ${r===x.entryReason?'selected':''}>${e(r)}</option>`).join('')}</select></label>
      <label>Date de sortie<input name="exitDate" type="date" value="${e(x.exitDate||'')}"></label>
      <label>Motif de sortie<select name="exitReason"><option value="">—</option>${EXIT_REASONS.map(r=>`<option ${r===x.exitReason?'selected':''}>${e(r)}</option>`).join('')}</select></label>
      <label>Lot de pâturage noté<select name="sessionId"><option value="">Aucun</option>${lotOptions(x.sessionId)}</select></label>
      <label>Note<input name="note" value="${e(x.note||'')}"></label>
      <p class="form-error span-2" id="herd-error" role="alert" hidden></p></form>
      <p class="form-note">Le numéro national figure sur le passeport et les boucles : FR suivi de 10 chiffres. Les 4 derniers forment le n° de travail. Une entrée ou une sortie se notifie aussi à l’EDE : Parcelles ne le fait pas.</p>`,
      `<button type="button" class="button secondary" id="herd-cancel">Retour</button><button type="button" class="button primary" id="herd-save">Enregistrer</button>`,'large');
    const form=$('#herd-animal-form');bindChipChoices(form);
    $('#herd-cancel').onclick=()=>a?openAnimal(a.id):open();
    $('#herd-save').onclick=async()=>{
      const button=$('#herd-save');if(button.disabled||!validateForm(form))return;
      try{
        const v=Object.fromEntries(new FormData(form));
        const value=normalizeAnimal({...v,origin:x.origin,motherNationalId:v.motherId?'':x.motherNationalId},{state:data(),id:a?.id||null,today:today()});
        button.disabled=true;
        const saved=await store.upsert('animals',{...(a||{}),...value},{label:a?`Animal modifié : ${animalLabel(value)}`:`Animal ajouté : ${animalLabel(value)}`});
        toast('Animal enregistré.','success');openAnimal(saved.id);
      }catch(err){button.disabled=false;fail('#herd-error',err);}
    };
  }

  function openEvent(a,kind){
    const service=kind!=='weighing';
    modal(service?'Insémination ou saillie':'Pesée',animalLabel(a),`<form id="herd-event-form" class="form-grid" novalidate>
      ${service?`<div class="field-label span-2"><span>Nature</span>${chips('kind',[['insemination','Insémination'],['mating','Saillie naturelle']],'insemination')}</div>`:'<input type="hidden" name="kind" value="weighing">'}
      <label>Date *<input name="date" type="date" required value="${e(today())}" max="${e(today())}"></label>
      ${service?'<label>Taureau (nom ou code)<input name="sire"></label>':'<label>Poids (kg) *<input name="weightKg" type="number" min="1" max="3000" step="0.1" inputmode="decimal" required></label>'}
      <label class="span-2">Note<input name="note"></label>
      ${service?`<p class="form-note span-2" id="herd-due">Vêlage prévu le ${e(fr(addIsoDays(today(),283)))} (date + 283 jours), affiché dans le calendrier et sur l’accueil.</p>`:''}
      <p class="form-error span-2" id="herd-error" role="alert" hidden></p></form>`,
      `<button type="button" class="button secondary" id="herd-cancel">Retour</button><button type="button" class="button primary" id="herd-save">Enregistrer</button>`);
    const form=$('#herd-event-form');bindChipChoices(form);
    form.querySelector('[name="date"]').addEventListener('input',ev=>{const due=$('#herd-due');if(due&&ev.target.value)due.textContent=`Vêlage prévu le ${fr(addIsoDays(ev.target.value,283))} (date + 283 jours), affiché dans le calendrier et sur l’accueil.`;});
    $('#herd-cancel').onclick=()=>openAnimal(a.id);
    $('#herd-save').onclick=async()=>{
      const button=$('#herd-save');if(button.disabled||!validateForm(form))return;
      try{
        const value=normalizeAnimalEvent({...Object.fromEntries(new FormData(form)),animalId:a.id},{state:data(),today:today()});
        button.disabled=true;
        await store.upsert('animalEvents',value,{label:`${EVENT_KINDS[value.kind]} : ${animalLabel(a)}`});
        toast(value.expectedCalvingDate?`Enregistré. Vêlage prévu le ${fr(value.expectedCalvingDate)}.`:'Pesée enregistrée.','success');openAnimal(a.id);
      }catch(err){button.disabled=false;fail('#herd-error',err);}
    };
  }

  function openCalving(mother){
    const date=today();
    modal('Vêlage',animalLabel(mother),`<form id="herd-calving-form" class="form-grid" novalidate>
      <label>Date du vêlage *<input name="date" type="date" required value="${e(date)}" max="${e(date)}"></label>
      <label>Déroulement<select name="calvingEase"><option value="">Non précisé</option><option>Sans aide</option><option>Aide facile</option><option>Aide difficile</option><option>Césarienne</option></select></label>
      <div class="field-label"><span>Sexe du veau</span>${chips('calfSex',[['F','Femelle'],['M','Mâle'],['','À préciser']],'')}</div>
      <label>N° national du veau (boucle)<input name="calfNationalId" placeholder="FR1234567890" autocapitalize="characters"></label>
      <label>Nom du veau<input name="calfName"></label>
      <label>Poids de naissance (kg)<input name="birthWeightKg" type="number" min="1" max="200" step="0.5" inputmode="decimal"></label>
      <label class="span-2">Note<input name="note"></label>
      <p class="form-error span-2" id="herd-error" role="alert" hidden></p></form>
      <div class="notice warning"><p id="herd-bdni-text">Une tâche « Notifier la naissance à l’EDE/BDNI avant le ${e(ddmm(bdniDeadline(date)))} » sera créée, avec un rappel à J+${BDNI_REMINDER_DAYS}.</p><p>${e(BDNI_NOTICE)}</p></div>`,
      `<button type="button" class="button secondary" id="herd-cancel">Retour</button><button type="button" class="button primary" id="herd-save">Enregistrer le vêlage</button>`,'large');
    const form=$('#herd-calving-form');bindChipChoices(form);
    form.querySelector('[name="date"]').addEventListener('input',ev=>{if(ev.target.value)$('#herd-bdni-text').textContent=`Une tâche « Notifier la naissance à l’EDE/BDNI avant le ${ddmm(bdniDeadline(ev.target.value))} » sera créée, avec un rappel à J+${BDNI_REMINDER_DAYS}.`;});
    $('#herd-cancel').onclick=()=>openAnimal(mother.id);
    $('#herd-save').onclick=async()=>{
      const button=$('#herd-save');if(button.disabled||!validateForm(form))return;
      try{
        const plan=calvingPlan({...Object.fromEntries(new FormData(form)),animalId:mother.id},{state:data(),today:today(),ids:{event:uid('animalEvent'),calf:uid('animal'),task:uid('task')}});
        button.disabled=true;
        await writeCalving(plan,mother);
        toast(`Vêlage enregistré. Notifiez la naissance avant le ${ddmm(plan.event.bdniDeadline)}.`,'success');openAnimal(plan.calf.id);
      }catch(err){button.disabled=false;fail('#herd-error',err);}
    };
  }
  // Événement, veau et tâche BDNI écrits ensemble (une seule mutation, comme l'ajout groupé des parcelles PAC).
  function writeCalving(plan,mother){
    return store.enqueueWrite(async()=>{
      const rows=[['animalEvents',plan.event],['animals',plan.calf],['tasks',plan.task]];
      for(const [entity,rec] of rows)if(!can(entity,'create',rec))throw new Error('Votre rôle ne permet pas cette modification.');
      const normalized=rows.map(([entity,rec])=>[entity,normalizeEntity(entity,rec)]);
      await store._mutate(`Vêlage enregistré : ${animalLabel(mother)}`,state=>{
        for(const [entity,rec] of normalized){(state[entity]||(state[entity]=[])).push(rec);store.queue({entity,entityId:rec.id,action:'create',payload:clone(rec)});}
      },{entity:'animalEvents',entityId:plan.event.id,action:'create',payload:normalized[0][1],queue:false});
    });
  }

  function openTakeover(){
    const candidates=grazingCandidates(data());
    if(!candidates.length){toast('Aucun numéro à reprendre.');open();return;}
    modal('Reprendre les animaux des lots',`${candidates.length} numéro${candidates.length>1?'s':''} nationa${candidates.length>1?'ux':'l'} trouvé${candidates.length>1?'s':''} dans les lots de pâturage.`,`
      <p class="form-note">Une fiche est créée pour chaque numéro coché (lot en cours rattaché ; « gestante » → femelle). Les noms seuls ne sont pas repris. Vous compléterez sexe, race et naissance ensuite, ou par l’import CSV.</p>
      <div class="stack-list">${candidates.map((c,i)=>`<label class="list-row"><span><strong>${e(formatNationalId(c.nationalId))}${c.name?` · ${e(c.name)}`:''}</strong><br><small>${e(c.lot)}${c.gestation?' · gestante':''}</small></span><input type="checkbox" data-herd-pick="${i}" checked></label>`).join('')}</div>`,
      `<button type="button" class="button secondary" id="herd-cancel">Retour</button><button type="button" class="button primary" id="herd-save">Créer les fiches</button>`,'large');
    $('#herd-cancel').onclick=()=>open();
    $('#herd-save').onclick=async()=>{
      const picked=[...document.querySelectorAll('[data-herd-pick]:checked')].map(b=>candidates[Number(b.dataset.herdPick)]);
      if(!picked.length){toast('Cochez au moins un animal.','error');return;}
      try{
        const saved=await store.upsertMany('animals',candidatesToAnimals(picked,{today:today()}),{label:`Troupeau : ${picked.length} animaux repris des lots`});
        toast(`${saved.length} fiche${saved.length>1?'s':''} créée${saved.length>1?'s':''}.`,'success');open();
      }catch(err){toast(err.message,'error');}
    };
  }

  // ---------- Import CSV de l'inventaire ----------
  function openImport(){
    modal('Importer l’inventaire','Fichier CSV exporté du portail éleveur (inventaire du cheptel).',`
      <label class="field-label">Fichier CSV<input type="file" id="herd-csv" accept=".csv,.txt,text/csv"></label>
      <p class="form-note">Colonnes attendues : numéro national, nom, sexe, race, date de naissance, numéro de la mère (l’ordre et les intitulés peuvent varier : vous choisirez la correspondance). Un animal déjà présent (même numéro) est complété, jamais dupliqué. L’import peut être annulé depuis Mes données › Historique des imports.</p>
      <div id="herd-import-step"></div>`,
      `<button type="button" class="button secondary" id="herd-cancel">Retour</button><button type="button" class="button primary" id="herd-save" disabled>Importer</button>`,'large');
    $('#herd-cancel').onclick=()=>open();
    let parsed=null,fileName='';
    $('#herd-csv').addEventListener('change',async ev=>{
      const file=ev.target.files?.[0];if(!file)return;fileName=file.name;
      try{parsed=readHerdCsv(await file.text());if(!parsed.rows.length)throw new Error('Fichier vide ou illisible.');renderMapping(parsed,guessColumns(parsed.headers));}
      catch(err){$('#herd-import-step').innerHTML=`<p class="form-error" role="alert">${e(err.message)}</p>`;}
    });
    function renderMapping({headers,rows},mapping){
      const step=$('#herd-import-step');
      step.innerHTML=`<h3>Correspondance des colonnes</h3><div class="form-grid">${HERD_CSV_FIELDS.map(f=>`<label>${e(f.label)}${f.required?' *':''}<select data-herd-col="${e(f.key)}"><option value="">Ignorer</option>${headers.map(h=>`<option ${mapping[f.key]===h?'selected':''}>${e(h)}</option>`).join('')}</select></label>`).join('')}</div><div id="herd-preview"></div>`;
      const read=()=>Object.fromEntries([...step.querySelectorAll('[data-herd-col]')].map(s=>[s.dataset.herdCol,s.value]));
      const show=()=>{
        const p=herdImportPreview(data(),rows,read(),{today:today()}),button=$('#herd-save');
        button.disabled=Boolean(p.error)||!(p.create+p.update);button.textContent=p.create+p.update?`Importer ${p.create+p.update} animal${p.create+p.update>1?'aux':''}`:'Importer';
        const label={create:'Nouveau',update:'Complété',skip:'Ignoré'};
        $('#herd-preview').innerHTML=p.error?`<p class="form-error" role="alert">${e(p.error)}</p>`:`<div class="preview-summary"><div class="preview-stat"><strong>${p.create}</strong><small>nouveaux</small></div><div class="preview-stat"><strong>${p.update}</strong><small>déjà présents (complétés)</small></div><div class="preview-stat"><strong>${p.skip}</strong><small>ignorés</small></div></div>
          <div class="table-wrap"><table><thead><tr><th>Ligne</th><th>Numéro</th><th>Nom</th><th>Sexe</th><th>Naissance</th><th>Résultat</th></tr></thead><tbody>${p.rows.slice(0,50).map(r=>`<tr><td>${r.line}</td><td>${e(r.nationalId?formatNationalId(r.nationalId):'—')}</td><td>${e(r.value?.name||'')}</td><td>${e(SEXES[r.value?.sex]||'')}</td><td>${e(r.value?.birthDate?fr(r.value.birthDate):'')}</td><td>${e(label[r.action])}${r.reason?` · ${e(r.reason)}`:''}</td></tr>`).join('')}</tbody></table></div>${p.rows.length>50?`<p class="form-note">${p.rows.length-50} autres lignes non affichées.</p>`:''}`;
        return p;
      };
      step.querySelectorAll('[data-herd-col]').forEach(s=>s.addEventListener('change',show));show();
      $('#herd-save').onclick=async()=>{
        const button=$('#herd-save'),p=show();if(button.disabled)return;button.disabled=true;
        try{const r=await importAnimals(p,fileName);toast(`Inventaire importé : ${r.created} nouveau${r.created>1?'x':''}, ${r.updated} complété${r.updated>1?'s':''}.`,'success',{label:'Annuler',run:()=>rollbackImport?.(r.sessionId)});open();}
        catch(err){button.disabled=false;toast(err.message,'error');}
      };
    }
  }
  // Session d'import annulable : point de restauration local, puis écriture en une mutation (comme rpg-onboarding).
  function importAnimals(preview,fileName){
    return store.enqueueWrite(async()=>{
      if(!can('animals','create',{origin:'import'}))throw new Error('Votre rôle ne permet pas cette modification.');
      const writes=herdImportEntities(store.state,preview,{newId:()=>uid('animal'),today:today()});
      const normalized=writes.map(w=>{const existing=store.get('animals',w.id,{includeDeleted:true});return{value:normalizeEntity('animals',w,existing),existing};});
      const timestamp=Date.now(),sessionId=uid('import_session'),rollbackBackupId=`preimport_${sessionId}`;
      await store.storage.backupPut({id:rollbackBackupId,period:'preimport',createdAt:timestamp,state:store.snapshot()});
      const created=normalized.filter(n=>!n.existing).length,updated=normalized.length-created;
      const session=normalizeEntity('importSessions',{id:sessionId,fileNames:[fileName||'Inventaire CSV'],created,updated,skipped:preview.skip,interventions:0,surface:0,strategy:IMPORT_SOURCE,rollbackBackupId,source:'local'});
      await store._mutate(`Inventaire du troupeau importé : ${created} création${created>1?'s':''}, ${updated} mise${updated>1?'s':''} à jour`,state=>{
        state.animals||(state.animals=[]);
        for(const {value,existing} of normalized){const i=state.animals.findIndex(x=>x.id===value.id);if(i>=0)state.animals[i]=value;else state.animals.push(value);store.queue({entity:'animals',entityId:value.id,action:existing?'update':'create',payload:clone(value)});}
        state.importSessions.push(session);state.metadata.lastImportAt=timestamp;
      },{entity:'animals',action:'create',kind:'import',queue:false});
      return{created,updated,sessionId};
    });
  }

  return{open,openAnimal,openForm,openImport,setNotified};
}
